$ErrorActionPreference = 'Stop'

$serviceScript = Join-Path $PSScriptRoot 'bgl_anomaly_service\run_server.ps1'
if (-not (Test-Path $serviceScript)) {
    throw "Service launch script not found: $serviceScript"
}

& $serviceScript
