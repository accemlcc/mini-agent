#!/usr/bin/env python3
"""Tool: list_dir -- Listet den Inhalt eines Verzeichnisses auf."""
import json, sys, os

def run(args: dict) -> dict:
    path = args.get("path", ".")
    show_hidden = args.get("show_hidden", False)
    
    try:
        entries = []
        with os.scandir(path) as it:
            for entry in it:
                if not show_hidden and entry.name.startswith("."):
                    continue
                entry_info = {
                    "name": entry.name,
                    "type": "directory" if entry.is_dir(follow_symlinks=False) else "file",
                }
                try:
                    stat = entry.stat(follow_symlinks=False)
                    entry_info["size"] = stat.st_size
                    entry_info["modified"] = stat.st_mtime
                except (OSError, PermissionError):
                    pass
                entries.append(entry_info)
        
        # Sortieren: Verzeichnisse zuerst, dann alphabetisch
        entries.sort(key=lambda x: (0 if x["type"] == "directory" else 1, x["name"].lower()))
        
        return {
            "path": os.path.abspath(path),
            "entries": entries,
            "count": len(entries),
        }
    except FileNotFoundError:
        return {"error": f"Verzeichnis nicht gefunden: {path}"}
    except PermissionError:
        return {"error": f"Keine Berechtigung für: {path}"}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    raw = sys.stdin.read()
    args = json.loads(raw) if raw else {}
    result = run(args)
    print(json.dumps(result, ensure_ascii=False))
