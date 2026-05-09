#!/usr/bin/env python3
"""
Edit-Tool für den Mini-Agent.
Ersetzt oldString durch newString in einer Datei.
"""
import sys
import json
import os


def edit_file(path: str, old_string: str, new_string: str) -> dict:
    if not os.path.isfile(path):
        return {"success": False, "error": f"Datei nicht gefunden: {path}"}

    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        return {"success": False, "error": f"Lesefehler: {e}"}

    if old_string not in content:
        return {"success": False, "error": "oldString nicht in Datei gefunden."}

    occurrences = content.count(old_string)
    if occurrences > 1:
        return {
            "success": False,
            "error": f"oldString kommt {occurrences}x vor – nicht eindeutig. Bitte mehr Kontext mitgeben.",
        }

    new_content = content.replace(old_string, new_string, 1)

    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)
    except Exception as e:
        return {"success": False, "error": f"Schreibfehler: {e}"}

    # Diff-Statistik
    old_lines = content.splitlines()
    new_lines = new_content.splitlines()
    added = max(0, len(new_lines) - len(old_lines))
    removed = max(0, len(old_lines) - len(new_lines))

    return {
        "success": True,
        "path": path,
        "message": f"Ersetzt: {len(old_string)} Zeichen → {len(new_string)} Zeichen",
        "lines_added": added,
        "lines_removed": removed,
    }


if __name__ == "__main__":
    args = json.loads(sys.stdin.read())
    result = edit_file(
        path=args.get("path", ""),
        old_string=args.get("old_string", ""),
        new_string=args.get("new_string", ""),
    )
    print(json.dumps(result))
