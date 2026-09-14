import { writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { compactGearData, downloadGearData } from "../services/gear-data";

const data = compactGearData(await downloadGearData());
await writeFile(new URL("../data/gear-reference.json.gz", import.meta.url), gzipSync(JSON.stringify(data)));
console.log(`Bundled gear reference ${data.metadata.wowBuild} / ${data.metadata.contentHash}`);
