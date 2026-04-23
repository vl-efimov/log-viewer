$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path $PSScriptRoot
Set-Location $repoRoot

docker compose down
