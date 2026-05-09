import { spawn, exec } from "child_process";
import { promisify } from "util";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { ToolDefinition } from "./llm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const execAsync = promisify(exec);

export interface ToolResult {
  name: string;
  result: unknown;
  error?: string;
}

export const TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Liest den kompletten Inhalt einer Datei und gibt ihn als Text zurück.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absoluter oder relativer Pfad zur Datei.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Schreibt Text in eine Datei. Erstellt Verzeichnisse bei Bedarf.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absoluter oder relativer Pfad zur Datei.",
          },
          content: {
            type: "string",
            description: "Der vollständige Text, der geschrieben werden soll.",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Editiert eine existierende Datei präzise: ersetzt old_string durch new_string. old_string muss exakt einmal in der Datei vorkommen. NIE zum Erstellen neuer Dateien verwenden – dafür write_file nutzen.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absoluter oder relativer Pfad zur Datei.",
          },
          old_string: {
            type: "string",
            description: "Der exakte Text, der ersetzt werden soll. Muss eindeutig in der Datei sein.",
          },
          new_string: {
            type: "string",
            description: "Der neue Text, der eingefügt werden soll.",
          },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "Listet den Inhalt eines Verzeichnisses auf. Zeigt Dateien und Unterverzeichnisse mit Größe und Änderungsdatum.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absoluter oder relativer Pfad zum Verzeichnis. Standard ist das aktuelle Verzeichnis.",
          },
          show_hidden: {
            type: "boolean",
            description: "Ob versteckte Dateien (beginnend mit .) angezeigt werden sollen. Standard: false.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Sucht im Internet über SearXNG (Meta-Suchmaschine). Gibt Titel, URL und Kurzbeschreibung der Top-Ergebnisse zurück.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Der Suchbegriff (z. B. 'aktuelle Nachrichten', 'Wetter Zürich', 'Python Tutorial').",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Lädt eine Webseite herunter und konvertiert sie zu lesbarem Text. Nützlich nach web_search, um Details zu einer Seite zu lesen.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Die vollständige URL der Webseite (z. B. 'https://example.com/article').",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "exec_command",
      description: "Führt einen Shell-Befehl im Projektverzeichnis aus. Nützlich für Systemabfragen (date, uname, ps), um neue Tools zu erstellen oder existierende zu testen. Darf keine interaktiven Befehle (vim, nano, less) oder gefährlichen Operationen (sudo, rm -rf /, rm -rf ~, mkfs, dd) enthalten.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Der auszuführende Shell-Befehl (z. B. 'date', 'uname -a', 'ls -la src/').",
          },
        },
        required: ["command"],
      },
    },
  },
];

function runPythonTool(scriptName: string, args: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const scriptPath = join(ROOT, "tools", scriptName);
    const proc = spawn("python3", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Tool ${scriptName} exited with ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ raw: stdout.trim() });
      }
    });

    proc.stdin.write(JSON.stringify(args));
    proc.stdin.end();
  });
}

export async function executeTool(name: string, args: string): Promise<ToolResult> {
  let parsedArgs: Record<string, unknown>;
  try {
    parsedArgs = JSON.parse(args);
  } catch {
    return { name, result: null, error: `Ungültige JSON-Argumente: ${args}` };
  }

  try {
    let result: unknown;
    if (name === "read_file") {
      result = await runPythonTool("read.py", parsedArgs);
    } else if (name === "write_file") {
      result = await runPythonTool("write.py", parsedArgs);
    } else if (name === "edit_file") {
      result = await runPythonTool("edit.py", parsedArgs);
    } else if (name === "list_dir") {
      result = await runPythonTool("list_dir.py", parsedArgs);
    } else if (name === "web_search") {
      result = await runPythonTool("web_search.py", parsedArgs);
    } else if (name === "web_fetch") {
      result = await runPythonTool("web_fetch.py", parsedArgs);
    } else if (name === "exec_command") {
      const cmd = String(parsedArgs.command || "").trim();
      if (!cmd) {
        return { name, result: null, error: "Kein Befehl angegeben." };
      }

      // Blacklist für gefährliche Befehle/Substrings
      const forbidden = [
        "sudo", "su -", "su ",
        "rm -rf /", "rm -rf ~/", "rm -rf ~ ", "rm -rf $HOME",
        "mkfs", "dd if=/dev/zero", "dd if=/dev/random",
        "shutdown", "reboot", "poweroff", "halt",
        "> /dev/sda", ">/dev/sda",
        ":(){ :|:& };:", // Fork Bomb
      ];
      const lowerCmd = cmd.toLowerCase();
      const blocked = forbidden.find((f) => lowerCmd.includes(f.toLowerCase()));
      if (blocked) {
        return { name, result: null, error: `Befehl enthält verbotenen Inhalt: "${blocked}"` };
      }

      const { stdout, stderr } = await execAsync(cmd, {
        cwd: ROOT,
        timeout: 30000,
        maxBuffer: 1024 * 1024, // 1 MB
      });
      result = {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
    } else {
      return { name, result: null, error: `Unbekanntes Tool: ${name}` };
    }
    return { name, result };
  } catch (err: any) {
    return { name, result: null, error: err.message };
  }
}
