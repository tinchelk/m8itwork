#!/bin/sh
set -eu
umask 077
mkdir -p "$HOME/.m8itwork" "$HOME/.codex" "$HOME/.claude"
chmod 700 "$HOME/.m8itwork" "$HOME/.codex" "$HOME/.claude"
lock="$HOME/.m8itwork/container.lock"
mode="${1:-run}"
# Kernel locking survives PID reuse and prevents two containers sharing a volume.
# --no-fork keeps the worker as the init process's direct child for signal delivery.
case "$mode" in
  run|once)
    exec flock --no-fork --nonblock --conflict-exit-code 75 "$lock" /app/run-worker.sh "$mode"
    ;;
  configure|doctor)
    exec flock --no-fork --nonblock --conflict-exit-code 75 "$lock" node /app/dist/worker/main.js "$mode"
    ;;
  login-codex)
    exec flock --no-fork --nonblock --conflict-exit-code 75 "$lock" codex -c 'cli_auth_credentials_store="file"' login --device-auth
    ;;
  login-claude)
    exec flock --no-fork --nonblock --conflict-exit-code 75 "$lock" claude auth login
    ;;
  smoke)
    exec flock --no-fork --nonblock --conflict-exit-code 75 "$lock" node /app/smoke.mjs "${2:-codex}"
    ;;
  versions)
    node --version
    codex --version
    claude --version
    ;;
  *)
    echo 'Commands: run, once, configure (JSON on stdin), login-codex, login-claude, doctor, smoke [codex|claude], versions' >&2
    exit 64
    ;;
esac
