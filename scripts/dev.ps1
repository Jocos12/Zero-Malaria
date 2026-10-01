# ZeroMalaria local dev: API (uvicorn --reload) + Vite web
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Py = Join-Path $Root '.venv\Scripts\python.exe'
$ApiDir = Join-Path $Root 'apps\api'
$WebDir = Join-Path $Root 'apps\web'

if (-not (Test-Path $Py)) {
  Write-Host "ERROR: missing $Py" -ForegroundColor Red
  Write-Host "Run: make install   (or: python -m venv .venv && .\.venv\Scripts\python -m pip install -r apps\api\requirements.txt)"
  exit 1
}

Write-Host '==> ZeroMalaria dev' -ForegroundColor Cyan
Write-Host '==> API  http://127.0.0.1:8000  (uvicorn --reload)'
Write-Host '==> WEB  http://127.0.0.1:5173'

$api = Start-Process -FilePath $Py -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--reload', '--host', '127.0.0.1', '--port', '8000') `
  -WorkingDirectory $ApiDir -PassThru -WindowStyle Normal
try {
  Set-Location $WebDir
  npm run dev
} finally {
  if ($api -and -not $api.HasExited) {
    Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
  }
}
