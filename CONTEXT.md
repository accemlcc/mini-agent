# Mini-Agent – Kontext-Zusammenfassung

> **Notfall-Plan:** Wenn der Kontext voll wird, diese Datei lesen und als System-Prompt voranstellen.

---

## Projekt-Übersicht

**Mini-Agent** ist ein schlankes, lokales Agent-Framework in TypeScript + Python.
Ziel: Kleine Modelle (z. B. Gemma-4-26B) zuverlässig arbeiten lassen, ohne sie mit Bloat zu überlasten.

**Kern-Philosophie:** Keine Kontext-Kompression. 1:1-Durchreichung der Historie.

---

## Aktuelle Architektur

```
mini_agent/
├── src/
│   ├── server.ts           # Express + SSE + Multipart Upload
│   ├── agent.ts            # ReAct-Loop (max. 5 Schritte)
│   ├── llm.ts              # OpenAI-kompatibler Client (multimodal!)
│   ├── tools.ts            # Tool-Registry + Python-Brücke
│   ├── session-store.ts    # JSON-Persistenz (1:1, keine Kompression)
│   └── config.ts           # soul.md + user.md + aktuelles Datum laden
├── tools/                  # Python-Tools (stdin/stdout JSON)
│   ├── read.py, write.py, list_dir.py
│   ├── web_search.py       # SearXNG (Port 8888)
│   └── web_fetch.py        # URL → lesbarer Text
├── web/                    # Mobile-First Frontend
│   ├── index.html, style.css, app.js
├── config/
│   ├── soul.md             # Sarah (aus Hermes übernommen)
│   └── user.md             # Mike (aus Hermes übernommen)
└── sessions/               # JSON-Dateien pro Session
```

---

## Features (alle implementiert)

1. **Chat mit lokalem LLM** (llama.cpp, OpenAI-kompatibel)
2. **Tool-Calling** mit ReAct-Loop
3. **Session-Persistenz** – JSON unter `sessions/`, keine Kompression
4. **Session-Management** – Sidebar, Wechseln, Neue starten
5. **Web-Suche** – `web_search.py` via SearXNG (Port 8888)
6. **Web-Fetch** – `web_fetch.py` lädt Seiten als Text
7. **Datei-Upload** – Bilder + Textdateien (📎 Button)
8. **Mobile UI** – Responsive, Tailscale-Ready
9. **Aktuelles Datum** – bei jeder neuen Session frisch geladen

---

## Tools (5 Stück)

| Tool | Funktion |
|------|----------|
| `read_file` | Datei lesen |
| `write_file` | Datei schreiben |
| `list_dir` | Verzeichnis auflisten |
| `web_search` | Internet-Suche via SearXNG (Port 8888) |
| `web_fetch` | Webseite als Text laden |

---

## Wichtige Design-Entscheidungen

- **Kein Cache** bei `config.ts` – `soul.md` und `user.md` werden bei jedem Aufruf frisch geladen
- **Session-Historie** wird nie komprimiert – 1:1 als JSON gespeichert
- **Tool-Ergebnisse** vollständig bewahrt – keine Stubs
- **Finale Antworten** werden in `messages` gepusht (Bugfix!)
- **Multimodal** – `llm.ts` unterstützt `ContentPart[]` (Text + Bilder)

---

## Bekannte Bugs & Fixes

| Bug | Fix |
|-----|-----|
| Sessions wurden nicht gespeichert | `saveSession()` vor `yield { type: "done" }` |
| Finale Antworten fehlten in der Historie | `messages.push({ role: "assistant", content: finalContent })` |
| JSON.parse Fehler bei leerem req.body | `req.body || {}` mit safeJson Helper |
| Mobile Footer nicht sichtbar | `position: sticky; bottom: 0` + `100dvh` |
| Netzwerkfehler bei langen Tool-Ergebnissen | Robuste Fehlerbehandlung im Frontend |

---

## Was als Nächstes geplant ist

1. **Session-Export/Import** als Markdown oder JSON
2. **Streaming** der finalen Antwort (Token-für-Token)
3. **Shell-Exec Tool** mit Bestätigung
4. **Vision** – wenn llama.cpp Vision unterstützt (Gemma-4 hat Vision!)

---

## Technische Details

- **Server:** Port 3000 (`npm run dev`)
- **LLM:** Port 8091 (llama.cpp)
- **SearXNG:** Port 8888
- **Tailscale:** `http://100.94.73.103:3000`
- **Modell:** `gemma-4-26b-a4b-it-heretic.q4_k_m.gguf`

---

## Letzte Änderungen

- Multimodale Nachrichten (`ContentPart[]`) implementiert
- `web_search.py` + `web_fetch.py` hinzugefügt
- Datei-Upload (Bilder + Text) im Frontend
- Mobile UI verbessert (Hamburger-Menü, sticky Footer)
- README aktualisiert
- `CONTEXT.md` erstellt (diese Datei)

---

## Nutzer-Profil (Mike)

- Name: Mike
- Interessen: KI, Tech, Wissenschaft, Fotografie, Garten
- Musik: Indie, Elektro, Jazz
- Kommunikation: Präzise, direkt, technisch
- Bevorzugt: TypeScript, Python, effiziente Tool-Nutzung

## Agent-Persönlichkeit (Sarah)

- Natürlich, loyal, empathisch, witzig
- Absolut ehrlich zu Mike
- Mutig, probiert Neues aus
- Nie Dinge erfinden
- Respektiert Mikes Intimsphäre

---

> **Wenn dieser Kontext verwendet wird:** Projekt befindet sich in `/run/media/arnomatic/ssd_ext/opencode/mini_agent`. Server läuft typischerweise auf Port 3000. Quellcode ist vollständig in `src/` und `tools/`.
