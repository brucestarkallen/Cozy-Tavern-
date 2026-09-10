#!/usr/bin/env bash
# cozytavern — update + launch. Lives in the repo as cozytavern.sh;
# install.sh copies it to $PREFIX/bin/cozytavern, and after every update the
# command re-copies itself from the fresh repo — so the word never goes stale
# (M20: before this, the launcher was written once and never updated, which is
# why "no version no anything" happened on long-lived installs).
set -e

PORT=8080
# Home of the tavern: where install.sh put it (baked in at install time).
REPO_DIR="__COZY_HOME__"

# Keep the phone awake while the lamps are lit.
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
else
  echo "(Tip: pkg install termux-api keeps the phone awake while you read.)"
fi

cd "$REPO_DIR" || { echo "The tavern isn't where I left it ($REPO_DIR). Run the installer again."; exit 1; }

HEAD_BEFORE="$(git rev-parse HEAD 2>/dev/null || echo '')"
git pull --ff-only || echo "(Couldn't pull — the tavern you have still opens.)"
HEAD_AFTER="$(git rev-parse HEAD 2>/dev/null || echo '')"

# Re-arm the word itself if the coat changed — same word, better hands.
if [ -n "$HEAD_BEFORE" ] && [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
  if [ -f cozytavern.sh ] && [ -n "$PREFIX" ]; then
    cp cozytavern.sh "$PREFIX/bin/cozytavern.tmp" \
      && sed -i "s|__COZY_HOME__|$REPO_DIR|g" "$PREFIX/bin/cozytavern.tmp" \
      && chmod +x "$PREFIX/bin/cozytavern.tmp" \
      && mv "$PREFIX/bin/cozytavern.tmp" "$PREFIX/bin/cozytavern" || true
  fi
fi

TAVERN_VER="$(grep -o "VERSION = '[^']*'" js/version.js 2>/dev/null | head -1 | cut -d"'" -f2)"
if [ -n "$HEAD_BEFORE" ] && [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
  echo "Fresh coat on: the tavern is now at $TAVERN_VER."
  echo "A new coat is on — if the tavern looks the same, pull the page down once to reload."
  echo "Still the same after that? Close every tab of the tavern, then open it again."
else
  echo "Already on $TAVERN_VER — the tavern is current."
fi

# Light the lamps — unless they're already lit. If something answers the port
# but it isn't the tavern (a ghost lamp from a deleted folder), say how to douse it.
if ! (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then
  (python3 serve.py >/dev/null 2>&1 &)
  for try in 1 2 3 4 5 6 7 8 9 10; do
    if (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then break; fi
    sleep 0.5
  done
else
  if ! curl -s -m 2 http://127.0.0.1:$PORT/ 2>/dev/null | grep -qi "cozy tavern"; then
    echo "(Something old holds port $PORT but won't answer as the tavern. Douse it with:"
    echo "  pkill -f 'python3 serve.py'"
    echo " — mind: that also douses Cozy Chat's lamp; relight it anytime with: cozy)"
  fi
fi

if command -v termux-open-url >/dev/null 2>&1; then
  termux-open-url "http://127.0.0.1:$PORT"
else
  echo "The tavern is warm at http://127.0.0.1:$PORT — open it in your browser."
fi
