#!/usr/bin/env bash
# Starts Alpha-Sales and restarts it after an in-app update (exit code 75).
cd "$(dirname "$0")"
[ -d node_modules ] || npm install || exit 1
while true; do
  node src/cli.js start "$@"
  code=$?
  [ "$code" -eq 75 ] || exit "$code"
done
