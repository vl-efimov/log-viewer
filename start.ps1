$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path $PSScriptRoot
Set-Location $repoRoot

function Test-CommandExists([string] $name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

if (-not (Test-CommandExists 'docker')) {
    Write-Host 'Docker was not found. Install Docker Desktop and try again.'
    exit 1
}

try {
    docker compose version | Out-Null
} catch {
    Write-Host 'docker compose plugin was not found. Update Docker Desktop and try again.'
    exit 1
}

Write-Host 'Starting (first run can take a while due to image builds)...'

# Ensure BuildKit is enabled (Dockerfile uses RUN --mount=type=cache)
$env:DOCKER_BUILDKIT = '1'
$env:COMPOSE_DOCKER_CLI_BUILD = '1'

docker compose up -d --build

$healthUrl = 'http://127.0.0.1:8001/health'
$appUrl = 'http://127.0.0.1:8001/'

# Best-effort: warmup health check
$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) {
    try {
        $resp = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) { break }
    } catch {
        Start-Sleep -Seconds 2
    }
}

Write-Host "Open: $appUrl"
Start-Process $appUrl
