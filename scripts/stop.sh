#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
PIDFILE="server.pid"

if [ ! -f "$PIDFILE" ]; then
  echo "Kein PID-File gefunden – Server scheint nicht zu laufen."
  exit 1
fi

PID=$(cat "$PIDFILE")

if ! kill -0 "$PID" 2>/dev/null; then
  echo "Server (PID: $PID) läuft nicht mehr. Entferne stale PID-File."
  rm -f "$PIDFILE"
  exit 1
fi

echo "Stoppe Mini-Agent Server (PID: $PID)..."
kill "$PID"

# Warte bis der Prozess wirklich beendet ist (max. 5 Sek.)
for i in {1..10}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Server gestoppt."
    rm -f "$PIDFILE"
    exit 0
  fi
  sleep 0.5
done

echo "Server reagiert nicht, erzwinge Beendigung..."
kill -9 "$PID" 2>/dev/null || true
rm -f "$PIDFILE"
echo "Server gestoppt."
