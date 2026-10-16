# Start Noodle on http://localhost:8765. Double-click "Start Noodle.bat" to run this.
#
# The first run sets everything up inside this folder, with nothing installed system-wide:
#   .noodle\tools\  uv (installs Python) and, only when the web app needs building, a portable Node
#   .venv\          Python and Noodle's packages
# Later runs skip whatever is already done, so they start in a few seconds. Delete the folder to uninstall.
#
# A second person on the same laptop, to try Friends with yourself:
#   .\start.ps1 -NoodleProfile friend -Port 8766 -NoBuild
param([string]$NoodleProfile = "", [int]$Port = 8765, [switch]$NoBuild)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # Invoke-WebRequest is very slow with its progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$tools = "$root\.noodle\tools"
$venv = "$root\.venv"
$python = "$venv\Scripts\python.exe"
$url = "http://localhost:$Port"
$UV_VERSION = "0.9.5"
$NODE_VERSION = "22.20.0"
$arm = $env:PROCESSOR_ARCHITECTURE -eq "ARM64"
try { $Host.UI.RawUI.WindowTitle = "Noodle" } catch {}

function Say($text) { Write-Host "  $text" -ForegroundColor Cyan }
function Fail($text) { throw $text }

function Get-Download($from, $to) {
    New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
    # curl.exe ships with Windows and shows progress; fall back to PowerShell's downloader
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        & curl.exe -L --fail --progress-bar -o $to $from
        if ($LASTEXITCODE -eq 0) { return }
    }
    Invoke-WebRequest $from -OutFile $to -UseBasicParsing
}

function Expand-Zip($zip, $into) {
    New-Item -ItemType Directory -Force $into | Out-Null
    & tar.exe -xf $zip -C $into 2>$null  # much faster than Expand-Archive
    if ($LASTEXITCODE -ne 0) { Expand-Archive $zip $into -Force }
    Remove-Item $zip
}

# One hash over a set of files, so we redo a step only when its inputs changed.
function Get-Fingerprint([string[]]$paths) {
    $files = foreach ($p in $paths) { if (Test-Path $p) { Get-ChildItem $p -Recurse -File } }
    $lines = $files | Sort-Object FullName | ForEach-Object {
        $_.FullName.Substring($root.Length) + " " + (Get-FileHash $_.FullName -Algorithm SHA1).Hash
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
    -join ([Security.Cryptography.SHA1]::Create().ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") })
}

# 127.0.0.1, not localhost: localhost tries IPv6 first and times out, and Noodle listens on IPv4 only
function Test-Noodle {
    try { (Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 2).Content -match "<title>Noodle</title>" }
    catch { $false }
}

function Install-Python {
    $stamp = "$venv\noodle-requirements.sha1"
    $want = Get-Fingerprint @("$root\requirements.txt")
    if ((Test-Path $python) -and (Test-Path $stamp) -and ((Get-Content $stamp) -eq $want)) { return }

    $uv = (Get-Command uv.exe -ErrorAction SilentlyContinue).Source
    if (-not $uv) {
        $uv = "$tools\uv\uv.exe"
        if (-not (Test-Path $uv)) {
            Say "Downloading the Python installer (uv, about 20 MB)..."
            $target = if ($arm) { "aarch64" } else { "x86_64" }
            Get-Download "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-$target-pc-windows-msvc.zip" "$tools\uv.zip"
            Expand-Zip "$tools\uv.zip" "$tools\uv"
        }
    }
    $env:UV_PYTHON_INSTALL_DIR = "$tools\python"  # keep Python inside this folder
    $env:UV_CACHE_DIR = "$tools\uv-cache"
    $env:UV_NATIVE_TLS = "1"                        # trust the Windows certificate store (antivirus HTTPS scanning)
    if (-not (Test-Path $python)) {
        Say "Setting up Python..."
        & $uv venv $venv --python ">=3.11,<3.14" --quiet
        if ($LASTEXITCODE -ne 0) { Fail "Couldn't set up Python." }
    }
    Say "Installing Noodle's Python packages (a few minutes the first time)..."
    & $uv pip install --python $python -r "$root\requirements.txt"
    if ($LASTEXITCODE -ne 0) { Fail "Couldn't install Noodle's Python packages." }
    Set-Content $stamp $want
}

function Find-Node {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($node -and ((& $node.Source --version) -match "^v(\d+)") -and [int]$Matches[1] -ge 18) {
        return Split-Path $node.Source
    }
    $platform = if ($arm) { "win-arm64" } else { "win-x64" }
    $dir = "$tools\node-v$NODE_VERSION-$platform"
    if (-not (Test-Path "$dir\node.exe")) {
        Say "Downloading Node to build the web app (about 30 MB, only once)..."
        Get-Download "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$platform.zip" "$tools\node.zip"
        Expand-Zip "$tools\node.zip" $tools
    }
    $dir
}

function Build-WebApp {
    $front = "$root\frontend"
    $stamp = "$front\dist\noodle-build.sha1"
    $want = Get-Fingerprint @("$front\src", "$front\index.html", "$front\package.json", "$front\package-lock.json", "$front\vite.config.js")
    if ((Test-Path "$front\dist\index.html") -and (Test-Path $stamp) -and ((Get-Content $stamp) -eq $want)) { return }

    $env:PATH = (Find-Node) + ";" + $env:PATH
    $lock = Get-Fingerprint @("$front\package-lock.json")
    $installed = "$front\node_modules\noodle-install.sha1"
    Push-Location $front  # npm's --prefix breaks on folder names with spaces
    try {
        if (-not ((Test-Path $installed) -and ((Get-Content $installed) -eq $lock))) {
            Say "Installing the web app's packages..."
            & npm.cmd install --no-fund --no-audit
            if ($LASTEXITCODE -ne 0) {
                # Antivirus HTTPS scanning re-signs traffic; let Node trust the Windows certificate store and retry
                $env:NODE_OPTIONS = "--use-system-ca"
                & npm.cmd install --no-fund --no-audit
                if ($LASTEXITCODE -ne 0) { Fail "Couldn't install the web app's packages." }
            }
            Set-Content $installed $lock
        }
        Say "Building the web app..."
        & npm.cmd run build -- --logLevel error
        if ($LASTEXITCODE -ne 0) { Fail "Couldn't build the web app." }
    } finally { Pop-Location }
    Set-Content $stamp $want
}

function Add-Shortcut {
    # Once: a Noodle icon on the desktop. If you delete it, it stays deleted.
    $flag = "$root\.noodle\shortcut-made"
    if ($NoodleProfile -or (Test-Path $flag)) { return }
    try {
        $desktop = [Environment]::GetFolderPath("Desktop")
        $link = (New-Object -ComObject WScript.Shell).CreateShortcut("$desktop\Noodle.lnk")
        $link.TargetPath = "$root\Start Noodle.bat"
        $link.WorkingDirectory = $root
        $link.IconLocation = "$root\noodle.ico"
        $link.Description = "Start Noodle"
        $link.Save()
        Say "Added a Noodle icon to your desktop. Next time, just double-click that."
    } catch {}
    New-Item -ItemType File -Force $flag | Out-Null
}

try {
    Write-Host ""
    Write-Host "  Noodle" -ForegroundColor Yellow
    Write-Host ""
    if (Test-Noodle) {
        Say "Noodle is already running. Opening it in your browser."
        Start-Process $url
        exit 0
    }

    Install-Python
    if (-not $NoBuild) { Build-WebApp }
    Add-Shortcut

    if ($NoodleProfile) { $env:NOODLE_PROFILE = $NoodleProfile }
    # Antivirus (e.g. Avast) points SSLKEYLOGFILE at a pipe that uv's Python builds crash on; Noodle doesn't need it
    $env:SSLKEYLOGFILE = $null
    Say "Starting Noodle..."
    $server = Start-Process $python -NoNewWindow -PassThru -ArgumentList @(
        "-m", "uvicorn", "noodle.app:app", "--app-dir", "`"$root\backend`"", "--port", $Port, "--log-level", "warning")
    $null = $server.Handle  # keeps the exit code readable after it ends
    for ($i = 0; $i -lt 120 -and -not $server.HasExited -and -not (Test-Noodle); $i++) { Start-Sleep -Milliseconds 500 }
    if ($server.HasExited) { Fail "Noodle stopped while starting. Is port $Port in use by another program?" }

    Start-Process $url
    Write-Host ""
    Write-Host "  Noodle is open at $url" -ForegroundColor Green
    Write-Host "  Keep this window open while you use Noodle. Close it to stop Noodle."
    Write-Host ""
    $server.WaitForExit()
} catch {
    Write-Host ""
    Write-Host "  Something went wrong: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  Check your internet connection and try again. If it keeps happening, send a screenshot of this window."
    Write-Host ""
    exit 1
}
