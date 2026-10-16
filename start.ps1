# Start Noodle on http://localhost:8765.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path "$root\frontend\node_modules")) { npm --prefix "$root\frontend" install }
npm --prefix "$root\frontend" run build
Start-Process "http://localhost:8765"
python -m uvicorn noodle.app:app --app-dir "$root\backend" --port 8765
