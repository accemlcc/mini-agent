#!/usr/bin/env python3
"""
Edit-Tool für den Mini-Agent.
Ersetzt oldString durch newString in einer Datei.
Führt nach dem Edit automatisch Syntax-Validierung durch (JSON, JS/TS, Python).
Bei Syntaxfehler wird ein Rollback durchgeführt.
"""
import sys
import json
import os
import subprocess


def validate_syntax(path: str, content: str, ext: str) -> tuple[bool, str]:
    """
    Prüft die Syntax der geänderten Datei.
    Gibt (ok, error_message) zurück.
    """
    if ext == ".json":
        try:
            json.loads(content)
            return True, ""
        except json.JSONDecodeError as e:
            return False, f"JSON Syntaxfehler: {e}"

    elif ext in (".js", ".ts"):
        try:
            result = subprocess.run(
                ["node", "--check", path],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode != 0:
                err = result.stderr.strip() if result.stderr else "Unbekannter JS/TS Fehler"
                return False, f"JS/TS Syntaxfehler: {err}"
            return True, ""
        except FileNotFoundError:
            # node nicht installiert – nicht blockieren
            return True, ""
        except subprocess.TimeoutExpired:
            return False, "JS/TS Syntax-Check: Timeout"
        except Exception as e:
            return False, f"JS/TS Check fehlgeschlagen: {e}"

    elif ext == ".py":
        try:
            result = subprocess.run(
                [sys.executable, "-m", "py_compile", path],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode != 0:
                err = result.stderr.strip() if result.stderr else "Unbekannter Python Fehler"
                return False, f"Python Syntaxfehler: {err}"
            return True, ""
        except subprocess.TimeoutExpired:
            return False, "Python Syntax-Check: Timeout"
        except Exception as e:
            return False, f"Python Check fehlgeschlagen: {e}"

    return True, ""


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

    # Schreiben
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)
    except Exception as e:
        return {"success": False, "error": f"Schreibfehler: {e}"}

    # Syntax-Validierung
    _, ext = os.path.splitext(path)
    ext = ext.lower()

    if ext in (".json", ".js", ".ts", ".py"):
        ok, error = validate_syntax(path, new_content, ext)
        if not ok:
            # ROLLBACK: alten Inhalt zurückschreiben
            try:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(content)
            except Exception as rb_err:
                return {
                    "success": False,
                    "error": f"{error}\nROLLBACK FEHLGESCHLAGEN: {rb_err}",
                }
            return {
                "success": False,
                "error": f"{error}\nEdit wurde rückgängig gemacht (Rollback).",
            }

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
