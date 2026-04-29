import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { ToolDefinition } from "./llm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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
    } else if (name === "list_dir") {
      result = await runPythonTool("list_dir.py", parsedArgs);
    } else if (name === "web_search") {
      result = await runPythonTool("web_search.py", parsedArgs);
    } else if (name === "web_fetch") {
      result = await runPythonTool("web_fetch.py", parsedArgs);
    } else {
      return { name, result: null, error: `Unbekanntes Tool: ${name}` };
    }
    return { name, result };
  } catch (err: any) {
    return { name, result: null, error: err.message };
  }
}
