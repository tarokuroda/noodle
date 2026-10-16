#!/bin/bash
# Start Noodle on http://localhost:8765 (macOS). Double-click this file in Finder to run it.
# The Mac twin of "Start Noodle.bat" / start.ps1. Not tested on a Mac yet.
#
# The first run sets everything up inside this folder, with nothing installed system-wide:
#   .noodle/tools/  uv (installs Python) and, only when the web app needs building, a portable Node
#   .venv/          Python and Noodle's packages
# Later runs skip whatever is already done, so they start in a few seconds. Outside this folder it adds only a
# "Noodle" link on the desktop, and the server registers .noodle/Noodle.app for Moodle's login link
# (backend/noodle/app_link_mac.py). "Uninstall Noodle.command" (this script with --uninstall) removes both;
# then delete the folder.
#
# If macOS won't open this file the first time ("Apple could not verify..."), see "Get started (Mac)" in README.md.
#
# A second person on the same laptop, to try Friends with yourself:
#   ./"Start Noodle.command" --profile friend --port 8766 --no-build
#
# Written for the bash 3.2 that ships with macOS.
set -uo pipefail

# This folder, also when started from the desktop link (a symlink to this file)
self="$0"
while [ -L "$self" ]; do
    link="$(readlink "$self")"
    case "$link" in /*) self="$link" ;; *) self="$(dirname "$self")/$link" ;; esac
done
root="$(cd "$(dirname "$self")" && pwd -P)"
cd "$root" || exit 1
tools="$root/.noodle/tools"
venv="$root/.venv"
python="$venv/bin/python"
UV_VERSION="0.9.5"
NODE_VERSION="22.20.0"

profile=""
port=8765
no_build=0
uninstall=0
while [ $# -gt 0 ]; do
    case "$1" in
        --profile|-NoodleProfile) profile="${2:-}"; shift ;;
        --port|-Port) port="${2:-}"; shift ;;
        --no-build|-NoBuild) no_build=1 ;;
        --uninstall|-Uninstall) uninstall=1 ;;
        *) echo "Usage: \"Start Noodle.command\" [--profile NAME] [--port N] [--no-build] [--uninstall]" >&2; exit 2 ;;
    esac
    shift
done
case "$port" in ''|*[!0-9]*) echo "--port needs a number, like --port 8766" >&2; exit 2 ;; esac
url="http://localhost:$port"

# Apple silicon, even when this Terminal runs under Rosetta
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then arm=1; else arm=0; fi
printf '\033]0;Noodle\007'  # window title

say() { printf '  \033[36m%s\033[0m\n' "$*"; }

fail() {
    printf '\n  \033[31mSomething went wrong: %s\033[0m\n' "$*"
    echo "  Check your internet connection and try again. If it keeps happening, send a screenshot of this window."
    echo ""
    exit 1
}

download() {  # url, file
    mkdir -p "$(dirname "$2")"
    curl -L --fail --progress-bar -o "$2" "$1"
}

# One hash over a set of files (paths relative to this folder), so we redo a step only when its inputs changed.
# Finder's .DS_Store files don't count.
fingerprint() {
    local p
    for p in "$@"; do
        [ -e "$p" ] && find "$p" -type f ! -name .DS_Store -print0
    done | LC_ALL=C sort -z | xargs -0 shasum -a 1 | shasum -a 1 | cut -d ' ' -f 1
}

stamp_matches() {  # stamp file, wanted fingerprint
    [ -f "$1" ] && [ "$(cat "$1")" = "$2" ]
}

# 127.0.0.1, not localhost: localhost tries IPv6 first, and Noodle listens on IPv4 only
noodle_running() {
    curl -s --max-time 2 "http://127.0.0.1:$port/" 2>/dev/null | grep -q "<title>Noodle</title>"
}

install_python() {
    local stamp="$venv/noodle-requirements.sha1" want uv target
    want="$(fingerprint requirements.txt)"
    if [ -x "$python" ] && stamp_matches "$stamp" "$want"; then return; fi

    uv="$(command -v uv || true)"
    if [ -z "$uv" ]; then
        uv="$tools/uv/uv"
        if [ ! -x "$uv" ]; then
            say "Downloading the Python installer (uv, about 20 MB)..."
            if [ "$arm" = 1 ]; then target="aarch64"; else target="x86_64"; fi
            download "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-$target-apple-darwin.tar.gz" \
                "$tools/uv.tar.gz" || fail "Couldn't download the Python installer."
            mkdir -p "$tools/uv"
            tar -xzf "$tools/uv.tar.gz" -C "$tools/uv" --strip-components 1 || fail "Couldn't unpack the Python installer."
            rm -f "$tools/uv.tar.gz"
        fi
    fi
    export UV_PYTHON_INSTALL_DIR="$tools/python"  # keep Python inside this folder
    export UV_CACHE_DIR="$tools/uv-cache"
    export UV_NATIVE_TLS=1                         # trust the macOS keychain (company or antivirus HTTPS scanning)
    if [ ! -x "$python" ]; then
        say "Setting up Python..."
        # --clear: a .venv left half-made by an interrupted first run would otherwise make uv ask what to do
        "$uv" venv "$venv" --python ">=3.11,<3.14" --quiet --clear || fail "Couldn't set up Python."
    fi
    say "Installing Noodle's Python packages (a few minutes the first time)..."
    "$uv" pip install --python "$python" -r requirements.txt || fail "Couldn't install Noodle's Python packages."
    echo "$want" > "$stamp"
}

# Prints the folder to put on PATH for node and npm
find_node() {
    local v platform dir
    if command -v node >/dev/null 2>&1; then
        v="$(node --version 2>/dev/null)"; v="${v#v}"; v="${v%%.*}"
        case "$v" in ''|*[!0-9]*) ;; *) if [ "$v" -ge 18 ]; then dirname "$(command -v node)"; return; fi ;; esac
    fi
    if [ "$arm" = 1 ]; then platform="darwin-arm64"; else platform="darwin-x64"; fi
    dir="$tools/node-v$NODE_VERSION-$platform"
    if [ ! -x "$dir/bin/node" ]; then
        say "Downloading Node to build the web app (about 50 MB, only once)..." >&2
        download "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$platform.tar.gz" "$tools/node.tar.gz" >&2 \
            || return 1
        tar -xzf "$tools/node.tar.gz" -C "$tools" || return 1
        rm -f "$tools/node.tar.gz"
    fi
    echo "$dir/bin"
}

build_web_app() {
    local stamp="frontend/dist/noodle-build.sha1" installed="frontend/node_modules/noodle-install.sha1"
    local want lock node_dir
    want="$(fingerprint frontend/src frontend/index.html frontend/package.json frontend/package-lock.json \
        frontend/vite.config.js)"
    if [ -f frontend/dist/index.html ] && stamp_matches "$stamp" "$want"; then return; fi

    node_dir="$(find_node)" || fail "Couldn't download Node."
    export PATH="$node_dir:$PATH"
    lock="$(fingerprint frontend/package-lock.json)"
    if ! stamp_matches "$installed" "$lock"; then
        say "Installing the web app's packages..."
        if ! (cd frontend && npm install --no-fund --no-audit); then
            # Antivirus or company HTTPS scanning re-signs traffic; let Node trust the macOS keychain and retry
            (cd frontend && NODE_OPTIONS=--use-system-ca npm install --no-fund --no-audit) \
                || fail "Couldn't install the web app's packages."
        fi
        echo "$lock" > "$installed"
    fi
    say "Building the web app..."
    (cd frontend && npm run build -- --logLevel error) || fail "Couldn't build the web app."
    echo "$want" > "$stamp"
}

desktop_link="$HOME/Desktop/Noodle.command"

add_shortcut() {
    # Once: a Noodle link on the desktop. If you delete it, it stays deleted.
    local flag="$root/.noodle/shortcut-made"
    if [ -n "$profile" ] || [ -e "$flag" ]; then return; fi
    if [ ! -e "$desktop_link" ] && ln -s "$root/Start Noodle.command" "$desktop_link" 2>/dev/null; then
        say "Added a Noodle link to your desktop. Next time, just double-click that."
    fi
    mkdir -p "$root/.noodle" && touch "$flag"
}

# You already let macOS open this file, so don't make it ask again for the uninstaller next to it
trust_launchers() {
    xattr -d com.apple.quarantine "$root/Start Noodle.command" "$root/Uninstall Noodle.command" 2>/dev/null || true
}

remove_noodle() {
    local app="$root/.noodle/Noodle.app"
    local lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
    if [ -x "$python" ] && [ -f backend/noodle/app_link_mac.py ]; then
        PYTHONPATH="$root/backend" "$python" -m noodle.app_link_mac --uninstall
    elif [ -d "$app" ]; then
        "$lsregister" -u "$app" 2>/dev/null
        rm -rf "$app"
    fi
    if [ -L "$desktop_link" ]; then
        case "$(readlink "$desktop_link")" in "$root"/*) rm -f "$desktop_link" ;; esac
    fi
    rm -f "$root/.noodle/shortcut-made"
    say "Removed Noodle's desktop link and its Moodle link handler."
    say "To finish, close this window and drag this folder to the Bin: $root"
}

echo ""
printf '  \033[33mNoodle\033[0m\n'
echo ""
if [ "$(uname -s)" != "Darwin" ]; then
    say "This launcher is for macOS. On Windows, double-click \"Start Noodle.bat\"."
    exit 1
fi
if [ "$uninstall" = 1 ]; then remove_noodle; exit 0; fi
if noodle_running; then
    say "Noodle is already running. Opening it in your browser."
    open "$url"
    exit 0
fi

install_python
if [ "$no_build" = 0 ]; then build_web_app; fi
add_shortcut
trust_launchers

if [ -n "$profile" ]; then export NOODLE_PROFILE="$profile"; fi
unset SSLKEYLOGFILE  # some antivirus points it at a pipe that uv's Python builds crash on; Noodle doesn't need it
say "Starting Noodle..."
"$python" -m uvicorn noodle.app:app --app-dir "$root/backend" --port "$port" --log-level warning &
server=$!
# Closing the window or pressing Ctrl+C stops Noodle too (a background job ignores Ctrl+C on its own)
trap 'kill "$server" 2>/dev/null' EXIT
trap 'exit 130' INT HUP TERM
i=0
while [ $i -lt 120 ] && kill -0 "$server" 2>/dev/null && ! noodle_running; do
    sleep 0.5
    i=$((i + 1))
done
kill -0 "$server" 2>/dev/null || fail "Noodle stopped while starting. Is port $port in use by another program?"

open "$url"
echo ""
printf '  \033[32mNoodle is open at %s\033[0m\n' "$url"
echo "  Keep this window open while you use Noodle. Close it (or press Ctrl+C) to stop Noodle."
echo ""
wait "$server"
