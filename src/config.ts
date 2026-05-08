import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

export const LLM_BASE_URL = process.env.LLM_BASE_URL || "http://127.0.0.1:8091";
export const LLM_MODEL = process.env.LLM_MODEL || "default-model";
export const LLM_TIMEOUT = parseInt(process.env.LLM_TIMEOUT || "120", 10) * 1000;

function isTemplate(content: string): boolean {
  return content.includes("Template") || content.includes("Configure this file") || content.includes("Replace this template");
}

export function getSystemPrompt(): string {
  const soul = readFileSync(join(ROOT, "config", "soul.md"), "utf-8");
  const user = readFileSync(join(ROOT, "config", "user.md"), "utf-8");

  if (isTemplate(soul) || isTemplate(user)) {
    console.warn("⚠️  WARNING: config/soul.md and/or config/user.md are still using templates.");
    console.warn("   Please customize these files to configure your agent's personality and user profile.");
  }

  const now = new Date();
  const dateStr = now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${soul}\n\n--- User Profile ---\n${user}\n\n--- Current Context ---\nToday is ${dateStr}.`.trim();
}
