$ErrorActionPreference = 'Stop'

$backendRoot = Resolve-Path $PSScriptRoot
$pythonExe = Join-Path $backendRoot '.venv\Scripts\python.exe'
$port = 8001

if (-not (Test-Path $pythonExe)) {
    throw "Python executable not found: $pythonExe"
}

$env:TF_USE_LEGACY_KERAS = '1'

if (-not $env:CLICKHOUSE_HOST) { $env:CLICKHOUSE_HOST = '127.0.0.1' }
if (-not $env:CLICKHOUSE_PORT) { $env:CLICKHOUSE_PORT = '8123' }
if (-not $env:CLICKHOUSE_USER) { $env:CLICKHOUSE_USER = 'logviewer' }
if (-not $env:CLICKHOUSE_PASSWORD) { $env:CLICKHOUSE_PASSWORD = 'logviewer' }
if (-not $env:CLICKHOUSE_DB) { $env:CLICKHOUSE_DB = 'log_viewer' }

$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
    $pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $pids) {
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
        } catch {
            Write-Warning "Could not stop process ${procId}: $($_.Exception.Message)"
        }
    }
}

Set-Location $backendRoot
& $pythonExe -m uvicorn bgl_anomaly_service.api:app --host 127.0.0.1 --port $port
