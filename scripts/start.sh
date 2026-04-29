#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
PIDFILE="server.pid"
LOGFILE="server.log"

if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Server läuft bereits (PID: $PID)"
    exit 0
  else
    echo "Stale PID-File gefunden, entferne..."
    rm -f "$PIDFILE"
  fi
fi

echo "Starte Mini-Agent Server..."
nohup npx tsx src/server.ts >> "$LOGFILE" 2>&1 &
PID=$!
echo $PID > "$PIDFILE"
echo "Server gestartet (PID: $PID)"
echo "Logs: $LOGFILE"
