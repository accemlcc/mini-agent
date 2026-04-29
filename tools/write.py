#!/usr/bin/env python3
"""Tool: write_file -- Schreibt Inhalt in eine Datei."""
import json, sys, os

def run(args: dict) -> dict:
    path = args.get("path", "")
    content = args.get("content", "")
    if not path:
        return {"error": "Kein Pfad angegeben."}
    try:
        # Sicherstellen, dass das Verzeichnis existiert
        dir_name = os.path.dirname(path)
        if dir_name:
            os.makedirs(dir_name, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return {"success": True, "path": path, "bytes_written": len(content.encode("utf-8"))}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    raw = sys.stdin.read()
    args = json.loads(raw) if raw else {}
    result = run(args)
    print(json.dumps(result, ensure_ascii=False))
