param([ValidateSet('synthetic', 'sample')][string]$Dataset = 'synthetic')
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$resultsPath = Join-Path $repoRoot 'backups/commodity-packing-20261005'
$benchmarkContainer = 'copper-commodity-packing-20261005'
New-Item -ItemType Directory -Force -Path $resultsPath | Out-Null
$dockerEndpoint = docker context inspect --format '{{.Endpoints.docker.Host}}'
if ($LASTEXITCODE -ne 0 -or $dockerEndpoint -notmatch '^(npipe|unix)://' -or $env:DOCKER_HOST -match '^(ssh|tcp)://') {
    throw 'Use a local Docker engine for this experiment.'
}
$purpose = docker inspect --format '{{index .Config.Labels "purpose"}}' $benchmarkContainer
if ($LASTEXITCODE -ne 0 -or $purpose -ne 'commodity-packing-benchmark') {
    throw 'Create the dedicated benchmark container using the documented command first.'
}
if ($Dataset -eq 'sample' -and !(Test-Path -LiteralPath (Join-Path $resultsPath 'production.ndjson'))) {
    throw 'No bounded sample exists. This runner never extracts production data.'
}
$dockerArguments = @(
    'run', '--rm', '--network', "container:$benchmarkContainer", '--cpus=2', '--memory=1g',
    '--mount', "type=bind,source=$repoRoot,target=/workspace,readonly",
    '--mount', "type=bind,source=$resultsPath,target=/results",
    '-w', '/workspace/backend',
    '-e', 'DATABASE_URL=postgresql://copper_bench:copper_bench@127.0.0.1:5432/copper_commodity_packing_test',
    '-e', 'BLIZZARD_CLIENT_ID=synthetic-test', '-e', 'BLIZZARD_CLIENT_SECRET=synthetic-test',
    '-e', 'BENCH_OUTPUT=/results'
)
if ($Dataset -eq 'sample') { $dockerArguments += @('-e', 'BENCH_SAMPLE=/results/production.ndjson') }
$dockerArguments += @('oven/bun:1.3.14-alpine', 'bun', 'run', '--no-env-file', 'experiments/commodity-packing/benchmark.ts')
& docker @dockerArguments
if ($LASTEXITCODE -ne 0) { throw "Benchmark failed with exit code $LASTEXITCODE" }
