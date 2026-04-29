#!/usr/bin/env python3
"""Tool: web_search -- Sucht über SearXNG (Meta-Suchmaschine)."""
import json, sys, urllib.request, urllib.parse

SEARXNG_URL = "http://localhost:8888/search"

def run(args: dict) -> dict:
    query = args.get("query", "").strip()
    if not query:
        return {"error": "Kein Suchbegriff angegeben."}
    
    try:
        params = {
            "q": query,
            "format": "json",
            "language": "de",
            "safesearch": "0",
        }
        url = f"{SEARXNG_URL}?{urllib.parse.urlencode(params)}"
        
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; Mini-Agent/1.0)",
                "Accept": "application/json",
            }
        )
        
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        
        results = data.get("results", [])
        if not results:
            return {"results": [], "message": "Keine Ergebnisse gefunden."}
        
        # Nur die Top 5 Ergebnisse zurückgeben (damit das LLM nicht überlastet wird)
        formatted = []
        for r in results[:5]:
            formatted.append({
                "title": r.get("title", "Kein Titel"),
                "url": r.get("url", ""),
                "snippet": r.get("content", "")[:300],  # Erster Satz/Teaser
                "engine": r.get("engine", "unbekannt"),
            })
        
        return {
            "query": query,
            "results": formatted,
            "total": len(results),
            "engines": list(set(r.get("engine", "") for r in results[:5])),
        }
        
    except Exception as e:
        return {"error": f"Suche fehlgeschlagen: {str(e)}"}

if __name__ == "__main__":
    raw = sys.stdin.read()
    args = json.loads(raw) if raw else {}
    result = run(args)
    print(json.dumps(result, ensure_ascii=False))
