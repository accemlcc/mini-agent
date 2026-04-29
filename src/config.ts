import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

export const LLM_BASE_URL = process.env.LLM_BASE_URL || "http://127.0.0.1:8091";
export const LLM_MODEL = process.env.LLM_MODEL || "gemma-4-26b-a4b-it-heretic.q4_k_m.gguf";

export function getSystemPrompt(): string {
  const soul = readFileSync(join(ROOT, "config", "soul.md"), "utf-8");
  const user = readFileSync(join(ROOT, "config", "user.md"), "utf-8");
  const now = new Date();
  const dateStr = now.toLocaleString("de-DE", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${soul}\n\n--- Nutzer-Profil ---\n${user}\n\n--- Aktueller Kontext ---\nHeute ist ${dateStr}.`.trim();
}
