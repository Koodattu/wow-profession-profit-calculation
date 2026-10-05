"""One bounded, read-only SSH extraction. Never reads a dump or creates remote files.

Keep the destination under the repository's ignored backups/ directory. Failed
attempts consume their full reservation; do not delete the budget ledger to retry.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
DEST = ROOT / "backups" / "commodity-packing-20261005"
ROW_LIMIT = 32_000
BYTE_LIMIT = 24 * 1024 * 1024
TOTAL_ROWS = 100_000
TOTAL_BYTES = 100 * 1024 * 1024
ANCHOR = "2026-10-05"


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    lock = DEST / "extraction.lock"
    # A leftover lock after a crash needs inspection, never an automatic retry.
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        ledger_path = DEST / "extraction-budget.json"
        ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {"attempts": []}
        attempts = ledger["attempts"]
        if sum(a["reserved_rows"] for a in attempts) + ROW_LIMIT > TOTAL_ROWS:
            raise RuntimeError("Project observation budget exhausted")
        if sum(a["reserved_bytes"] for a in attempts) + BYTE_LIMIT > TOTAL_BYTES:
            raise RuntimeError("Project extraction byte budget exhausted")
        path = DEST / "production.ndjson"
        if path.exists():
            raise RuntimeError("Sample already exists; reuse it, do not extract again")
        attempt = {"reserved_rows": ROW_LIMIT, "reserved_bytes": BYTE_LIMIT, "status": "reserved"}
        attempts.append(attempt)
        ledger_path.write_text(json.dumps(ledger, indent=2) + "\n")
        # Each item/day lookup uses the existing item/time index; the daily cohort
        # reads only three indexed dates. No broad snapshot scan or row payload output.
        query = f"""
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='1s';
SET LOCAL idle_in_transaction_session_timeout='20s';
SET LOCAL timezone='UTC';
WITH population AS MATERIALIZED (
  SELECT region_id,item_id,min(sample_count) AS samples
  FROM commodity_daily WHERE date IN ('2026-09-29','2026-10-01','2026-10-02')
    AND region_id IN ('eu','us') AND sample_count>0 GROUP BY region_id,item_id
), ranked AS (
  SELECT *,CASE WHEN samples>=20 THEN 'dense' WHEN samples<=12 THEN 'sparse' ELSE 'middle' END AS cohort,
    row_number() OVER(PARTITION BY region_id,CASE WHEN samples>=20 THEN 'dense' WHEN samples<=12 THEN 'sparse' ELSE 'middle' END
      ORDER BY md5(item_id::text||':commodity-packing-20261005')) AS rank
  FROM population
), selected AS MATERIALIZED (
  SELECT region_id,item_id FROM ranked WHERE rank<=CASE WHEN cohort='dense' THEN 32 ELSE 16 END
), limited AS MATERIALIZED (
  SELECT s.* FROM selected c CROSS JOIN unnest(ARRAY[1,2,3,4,7,10,14,21,28]) age
  CROSS JOIN LATERAL (
    SELECT s.* FROM commodity_snapshots s
    WHERE s.region_id=c.region_id AND s.item_id=c.item_id
      AND s.snapshot_time>=('{ANCHOR}'::date-age) AT TIME ZONE 'UTC'
      AND s.snapshot_time<('{ANCHOR}'::date-age+1) AT TIME ZONE 'UTC'
    ORDER BY s.snapshot_time,s.id LIMIT 32
  ) s ORDER BY s.snapshot_time,s.region_id,s.item_id,s.id LIMIT {ROW_LIMIT}
), payloads AS (
  SELECT row_to_json(s)::text AS payload,row_number() OVER(ORDER BY snapshot_time,region_id,item_id,id) AS ordinal FROM limited s
), bounded AS (
  SELECT payload,ordinal,sum(octet_length(payload)+1) OVER(ORDER BY ordinal) AS bytes FROM payloads
) SELECT payload FROM bounded WHERE bytes<={BYTE_LIMIT} ORDER BY ordinal;
COMMIT;
"""
        script = """set -eu
docker exec -i wow-profession-profit-calculation-db-1 sh -c 'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
""" + query + "\nSQL\n"
        rows = byte_count = 0
        sha = hashlib.sha256()
        try:
            with (DEST / "extraction-stderr.log").open("xb") as errors, path.open("xb") as output:
                process = subprocess.Popen(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                    "vaarattu-server", "bash -s"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors)
                process.stdin.write(script.encode("utf8"))
                process.stdin.close()
                for line in process.stdout:
                    # Independent client cap, in addition to caps enforced by SQL.
                    if rows+1 > ROW_LIMIT or byte_count+len(line) > BYTE_LIMIT or not line.startswith(b'{'):
                        process.kill()
                        process.wait()
                        raise RuntimeError("Extraction exceeded a cap or returned unexpected output")
                    rows += 1
                    byte_count += len(line)
                    sha.update(line)
                    output.write(line)
                if process.wait() != 0:
                    raise RuntimeError("Read-only SSH extraction failed; see private diagnostic")
                if not rows:
                    raise RuntimeError("No observations extracted")
                output.flush()
                os.fsync(output.fileno())
            attempt.update(status="complete",actual_rows=rows,actual_bytes=byte_count,sha256=sha.hexdigest())
        except BaseException:
            attempt.update(status="failed",actual_rows=rows,actual_bytes=byte_count)
            raise
        finally:
            ledger_path.write_text(json.dumps(ledger, indent=2)+"\n")
        print(json.dumps({"rows": rows, "uncompressed_bytes": byte_count, "sha256": sha.hexdigest(),
            "reserved_total_rows": sum(a["reserved_rows"] for a in attempts),
            "reserved_total_bytes": sum(a["reserved_bytes"] for a in attempts)}))
    finally:
        os.close(fd)
        lock.unlink()


if __name__ == "__main__":
    main()
