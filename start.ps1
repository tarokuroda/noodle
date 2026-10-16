# Start Noodle on http://localhost:8765.
# A second person on the same laptop, to try Friends with yourself:
#   .\start.ps1 -NoodleProfile friend -Port 8766 -NoBuild
param([string]$NoodleProfile = "", [int]$Port = 8765, [switch]$NoBuild)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $NoBuild) {
    if (-not (Test-Path "$root\frontend\node_modules")) { npm --prefix "$root\frontend" install }
    npm --prefix "$root\frontend" run build
}
if ($NoodleProfile) { $env:NOODLE_PROFILE = $NoodleProfile }
Start-Process "http://localhost:$Port"
python -m uvicorn noodle.app:app --app-dir "$root\backend" --port $Port
