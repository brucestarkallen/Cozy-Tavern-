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
# M676: THE BAKE WRITES THE HOME INTO THE LINE ABOVE, AND NOWHERE ELSE. The bake (install.sh's sed, and the re-arm
# below) replaces the mark wherever it stands in this file — and it stood three times: above, in the self-heal's own
# test, and in the re-arm's own sed. Baked, the re-arm's sed looked for the HOME instead of the mark and changed
# nothing: every update wrote the word back unbaked, and the update after that baked it again (found running his
# update end to end, tests/upgrade_in_place.py; held by tests/launcher.py). And the self-heal's test, baked, held
# the home itself: it was true on every run, so a clone in a usual place won over the folder the word was installed
# for. Where the mark is only looked for, it is spelled in two halves, which no bake reaches.
MARK="__COZY""_HOME__"

# Self-heal (M26 hotfix): if the home was never baked in — a word an update
# wrote back before M676 — find the tavern in the usual places instead of
# failing into a wall of text; and bake it in (below), so it is found, not guessed.
UNBAKED=''
case "$REPO_DIR" in
  *"$MARK"* | '')
    UNBAKED=1
    for guess in "$HOME/cozytavern" "$HOME/cozy-tavern" "$HOME/Cozy-Tavern-"; do
      if [ -d "$guess/.git" ]; then REPO_DIR="$guess"; break; fi
    done
    ;;
esac

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

# Re-arm the word itself if the coat changed — same word, better hands. M676: and if it had to guess its home (above),
# the home it found is baked in now.
if { [ -n "$HEAD_BEFORE" ] && [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; } || [ -n "$UNBAKED" ]; then
  if [ -f cozytavern.sh ] && [ -n "$PREFIX" ]; then
    cp cozytavern.sh "$PREFIX/bin/cozytavern.tmp" \
      && sed -i "s|$MARK|$REPO_DIR|g" "$PREFIX/bin/cozytavern.tmp" \
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

# M158: THE LAMPS ARE ALWAYS RELIT. M157 relit them only when the coat
# changed — but the launcher that ran the pull was the OLD copy of this file,
# so the relight code was not in it yet, and the old server kept the port
# once more. Like Marinara's launcher, every run starts a fresh server:
# whatever holds the port for this folder's serve.py is doused first.
# Only this folder's lamp — never Cozy Chat's (its serve.py answers another port).
pkill -f "$REPO_DIR/serve.py" 2>/dev/null || true
for try in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if ! (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then break; fi
  sleep 0.25
done

# Light the lamps — unless they're already lit. If something answers the port
# but it isn't the tavern (a ghost lamp from a deleted folder), say how to douse it.
if ! (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then
  (python3 "$REPO_DIR/serve.py" >/dev/null 2>&1 &)
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
