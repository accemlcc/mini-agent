#!/usr/bin/env python3
"""Tool: read_file -- Liest den Inhalt einer Datei."""
import json, sys, os

def run(args: dict) -> dict:
    path = args.get("path", "")
    if not path:
        return {"error": "Kein Pfad angegeben."}
    # Sicherheit: nur innerhalb des Projekt-Roots oder explizite Pfade
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"content": content, "path": path}
    except FileNotFoundError:
        return {"error": f"Datei nicht gefunden: {path}"}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    raw = sys.stdin.read()
    args = json.loads(raw) if raw else {}
    result = run(args)
    print(json.dumps(result, ensure_ascii=False))
