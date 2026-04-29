#!/usr/bin/env python3
"""Tool: web_fetch -- Lädt eine URL und konvertiert zu lesbarem Text."""
import json, sys, urllib.request, urllib.parse, re
from html import unescape

def html_to_text(html: str) -> str:
    """Einfache HTML-zu-Text Konvertierung."""
    # Scripts und Styles entfernen
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<nav[^>]*>.*?</nav>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<header[^>]*>.*?</header>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<footer[^>]*>.*?</footer>', '', html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r'<aside[^>]*>.*?</aside>', '', html, flags=re.DOTALL | re.IGNORECASE)
    
    # Zeilenumbrüche
    html = re.sub(r'<br\s*/?>', '\n', html, flags=re.IGNORECASE)
    html = re.sub(r'<p[^>]*>', '\n\n', html, flags=re.IGNORECASE)
    html = re.sub(r'</p>', '', html, flags=re.IGNORECASE)
    html = re.sub(r'<div[^>]*>', '\n', html, flags=re.IGNORECASE)
    html = re.sub(r'</div>', '', html, flags=re.IGNORECASE)
    html = re.sub(r'<li[^>]*>', '\n- ', html, flags=re.IGNORECASE)
    html = re.sub(r'<h[1-6][^>]*>', '\n\n### ', html, flags=re.IGNORECASE)
    html = re.sub(r'</h[1-6]>', '\n', html, flags=re.IGNORECASE)
    
    # Restliche Tags entfernen
    html = re.sub(r'<[^>]+>', '', html)
    
    # HTML-Entities decodieren
    html = unescape(html)
    
    # Aufräumen
    lines = html.split('\n')
    cleaned = []
    for line in lines:
        line = line.strip()
        if line and not line.startswith('function') and not line.startswith('var '):
            cleaned.append(line)
    
    result = '\n'.join(cleaned)
    
    # Max 8000 Zeichen (Token-Limit schonen)
    if len(result) > 8000:
        result = result[:4000] + "\n\n[... Inhalt gekürzt ...]\n\n" + result[-4000:]
    
    return result

def run(args: dict) -> dict:
    url = args.get("url", "").strip()
    if not url:
        return {"error": "Keine URL angegeben."}
    
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "de,en;q=0.9",
            }
        )
        
        with urllib.request.urlopen(req, timeout=20) as resp:
            content_type = resp.headers.get('Content-Type', '')
            raw = resp.read()
            
            # Encoding bestimmen
            encoding = 'utf-8'
            if 'charset=' in content_type:
                encoding = content_type.split('charset=')[-1].split(';')[0].strip()
            
            try:
                html = raw.decode(encoding, errors='replace')
            except:
                html = raw.decode('utf-8', errors='replace')
            
            text = html_to_text(html)
            
            return {
                "url": url,
                "title": extract_title(html),
                "text": text,
                "length": len(text),
            }
            
    except Exception as e:
        return {"error": f"Laden fehlgeschlagen: {str(e)}"}

def extract_title(html: str) -> str:
    match = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
    if match:
        return unescape(match.group(1).strip())
    return "Kein Titel"

if __name__ == "__main__":
    raw = sys.stdin.read()
    args = json.loads(raw) if raw else {}
    result = run(args)
    print(json.dumps(result, ensure_ascii=False))
