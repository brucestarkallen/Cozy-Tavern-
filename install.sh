#!/usr/bin/env bash
# Cozy Tavern — the Termux one-shot (M20).
# Installs the deps, clones (or updates) the tavern, and leaves a
# `cozytavern` command behind that updates itself + launches forever after.
#
#   bash <(curl -sL <raw install.sh>)   # fetched straight down, or:
#   bash install.sh                     # from a clone of the repo
#
# Idempotent: run it as often as you like; it only ever tops things up.
set -e

REPO_URL="${COZY_REPO_URL:-https://github.com/brucestarkallen/Cozy-Tavern-.git}"
REPO_DIR="${COZY_HOME:-$HOME/cozytavern}"

# If this script already sits inside a checkout, that checkout is home.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo '')"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/serve.py" ]; then
  REPO_DIR="$SCRIPT_DIR"
fi

echo "The tavern is being made ready…"

# 1. The two things the tavern needs.
pkg install git python -y

# 2. The tavern itself — cloned fresh, or topped up where it stands.
if [ -d "$REPO_DIR/.git" ]; then
  HEAD_BEFORE="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo '')"
  git -C "$REPO_DIR" pull --ff-only || echo "(Couldn't pull — the tavern you have still opens.)"
  HEAD_AFTER="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo '')"
else
  git clone "$REPO_URL" "$REPO_DIR"
  HEAD_BEFORE=""
  HEAD_AFTER="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo '')"
fi

TAVERN_VER="$(grep -o "VERSION = '[^']*'" "$REPO_DIR/js/version.js" 2>/dev/null | head -1 | cut -d"'" -f2)"

# 3. The `cozytavern` command, copied fresh from the repo EVERY install — so
#    the word itself is never an old coat (M20).
mkdir -p "$PREFIX/bin"
sed "s|__COZY_HOME__|$REPO_DIR|g" "$REPO_DIR/cozytavern.sh" > "$PREFIX/bin/cozytavern"
chmod +x "$PREFIX/bin/cozytavern"

# 4. The launch report (the cozy-chat lesson: say the version, every time).
if [ -n "$HEAD_BEFORE" ] && [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
  echo "Fresh coat on: the tavern is now at $TAVERN_VER."
  echo "A new coat is on — if the tavern looks the same, pull the page down once to reload."
  echo "Still the same after that? Close every tab of the tavern, then open it again."
elif [ -z "$HEAD_BEFORE" ]; then
  echo "The tavern moves in at $TAVERN_VER."
else
  echo "Already on $TAVERN_VER — the tavern is current."
fi

echo ""
echo "The tavern is ready. From now on, one word does everything:"
echo "  cozytavern"
echo "It updates itself, updates the tales, lights the lamps, and opens the door."
