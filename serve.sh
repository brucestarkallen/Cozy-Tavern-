#!/usr/bin/env bash
# Cozy Tavern — light the lamps on localhost:8080.
set -e
cd "$(dirname "$0")"
exec python3 serve.py
