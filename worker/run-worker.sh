#!/bin/sh
set -eu
# This script is reached only while holding the exclusive container kernel lock.
# A killed container can leave a PID file; the next container can reuse that PID.
rm -f "$HOME/.m8itwork/worker.lock"
exec node /app/dist/worker/main.js "$1"
