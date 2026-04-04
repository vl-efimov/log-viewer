$ErrorActionPreference = 'Stop'

$backendRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$pythonExe = Join-Path $backendRoot '.venv\Scripts\python.exe'
$port = 8001

if (-not (Test-Path $pythonExe)) {
	throw "Python executable not found: $pythonExe"
}

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
	Start-Sleep -Milliseconds 250
}

Set-Location $backendRoot
& $pythonExe -m uvicorn bgl_anomaly_service.api:app --host 127.0.0.1 --port $port
