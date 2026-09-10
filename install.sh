#!/usr/bin/env bash
# Cozy Tavern — the Termux one-shot (M13).
# Installs the deps, clones (or updates) the tavern, and leaves a
# `cozytavern` command behind that updates + launches it forever after.
#
#   bash install.sh          # from a clone of the repo, or:
#   curl -sL <raw install.sh> | bash   # fetched straight down
#
# Idempotent: run it as often as you like; it only ever tops things up.
set -e

REPO_URL="${COZY_REPO_URL:-https://github.com/brucestarkallen/Cozy-Tavern-.git}"
REPO_DIR="${COZY_HOME:-$HOME/cozytavern}"
PORT=8080

# If this script already sits inside a checkout, that checkout is home.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo '')"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/serve.py" ]; then
  REPO_DIR="$SCRIPT_DIR"
fi

echo "The tavern is being made ready…"

# 1. The two things the tavern needs.
pkg install git python -y

# 2. The tavern itself — cloned fresh, or topped up where it stands.
#    M18: when the pull brings something new, say the one thing older
#    shells can't say for themselves (pre-M16 taverns have no in-app
#    nudge): pull the page down once to reload.
if [ -d "$REPO_DIR/.git" ]; then
  HEAD_BEFORE="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo '')"
  git -C "$REPO_DIR" pull --ff-only || echo "(Couldn't pull — the tavern you have still opens.)"
  HEAD_AFTER="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo '')"
  TAVERN_VER="$(grep -o "VERSION = '[^']*'" "$REPO_DIR/js/version.js" 2>/dev/null | head -1 | cut -d"'" -f2)"
  if [ -n "$HEAD_BEFORE" ] && [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
    echo "Fresh coat on: the tavern is now at $TAVERN_VER."
    echo "A new coat is on — if the tavern looks the same, pull the page down once to reload."
    echo "Still the same after that? Close every tab of the tavern, then open it again."
  else
    echo "Already on $TAVERN_VER — the tavern is current."
  fi
else
  git clone "$REPO_URL" "$REPO_DIR"
  TAVERN_VER="$(grep -o "VERSION = '[^']*'" "$REPO_DIR/js/version.js" 2>/dev/null | head -1 | cut -d"'" -f2)"
  echo "The tavern moves in at $TAVERN_VER."
fi

# 3. The `cozytavern` command: wake the phone, top up the tales, light the
#    lamps if they aren't lit, and open the door.
mkdir -p "$PREFIX/bin"
cat > "$PREFIX/bin/cozytavern" <<TAVERN
#!/usr/bin/env bash
# cozytavern — update + launch. Written by install.sh; safe to re-run.
set -e

# Keep the phone awake while the lamps are lit (a hint when termux-api
# isn't installed — the tavern works regardless).
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
else
  echo "(Tip: pkg install termux-api keeps the phone awake while you read.)"
fi

cd "$REPO_DIR" || exit 1
# M18: if the pull brought a new coat, say so — older taverns have no
# in-app nudge, so this line is the bridge: pull the page down once.
HEAD_BEFORE="\$(git rev-parse HEAD 2>/dev/null || echo '')"
git pull --ff-only || echo "(Couldn't pull — the tavern you have still opens.)"
HEAD_AFTER="\$(git rev-parse HEAD 2>/dev/null || echo '')"
TAVERN_VER="\$(grep -o "VERSION = '[^']*'" js/version.js 2>/dev/null | head -1 | cut -d"'" -f2)"
if [ -n "\$HEAD_BEFORE" ] && [ "\$HEAD_BEFORE" != "\$HEAD_AFTER" ]; then
  echo "Fresh coat on: the tavern is now at \$TAVERN_VER."
  echo "A new coat is on — if the tavern looks the same, pull the page down once to reload."
  echo "Still the same? Close every tab of the tavern, then open it again."
else
  echo "Already on \$TAVERN_VER — the tavern is current."
fi

# Light the lamps — unless they're already lit on the port.
if ! (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then
  (python3 serve.py >/dev/null 2>&1 &)
  for try in 1 2 3 4 5 6 7 8 9 10; do
    if (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then
      break
    fi
    sleep 0.5
  done
fi

if command -v termux-open-url >/dev/null 2>&1; then
  termux-open-url "http://127.0.0.1:$PORT"
else
  echo "The tavern is warm at http://127.0.0.1:$PORT — open it in your browser."
fi
TAVERN
chmod +x "$PREFIX/bin/cozytavern"

echo ""
echo "The tavern is ready. From now on, one word does everything:"
echo "  cozytavern"
echo "It updates the tales, lights the lamps, and opens the door."
