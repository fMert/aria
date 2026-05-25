#!/usr/bin/env bash
# Start the Aria backend on a given port (or let uvicorn pick)
PORT=${ARIA_PORT:-8000}
cd "$(dirname "$0")"
exec python3 -m uvicorn main:app --host 127.0.0.1 --port "$PORT"
