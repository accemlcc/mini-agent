const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const statusEl = document.getElementById('status');
const sessionListEl = document.getElementById('session-list');
const newSessionBtn = document.getElementById('new-session');
const sessionInfoEl = document.getElementById('session-info');
const menuBtn = document.getElementById('menu-btn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const fileInput = document.getElementById('file-input');
const uploadBtn = document.getElementById('upload-btn');
const uploadPreview = document.getElementById('upload-preview');

let isBusy = false;
let currentMsg = null;
let pendingFiles = [];

// --- Auto-resize textarea ---
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 150) + 'px';
}

inputEl.addEventListener('input', () => autoResize(inputEl));

// --- Mobile Sidebar Toggle ---

function isMobile() {
  return window.innerWidth <= 768;
}

function openSidebar() {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('open');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('open');
}

function updateMenuBtn() {
  if (menuBtn) {
    menuBtn.style.display = isMobile() ? 'flex' : 'none';
  }
}

if (menuBtn) {
  menuBtn.addEventListener('click', openSidebar);
}

if (sidebarOverlay) {
  sidebarOverlay.addEventListener('click', closeSidebar);
}

window.addEventListener('resize', updateMenuBtn);
updateMenuBtn();

// --- File Upload ---

uploadBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    pendingFiles.push(file);
    renderUploadPreview();
  });
  fileInput.value = '';
});

function renderUploadPreview() {
  uploadPreview.innerHTML = '';
  pendingFiles.forEach((file, idx) => {
    const div = document.createElement('div');
    div.className = 'upload-thumb';
    
    if (file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      div.appendChild(img);
    } else {
      div.textContent = file.name.slice(0, 8) + '...';
    }
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      pendingFiles.splice(idx, 1);
      renderUploadPreview();
    });
    
    div.appendChild(removeBtn);
    uploadPreview.appendChild(div);
  });
}

// --- Markdown Rendering ---
function renderMarkdown(text) {
  if (!text) return '';
  try {
    const html = marked.parse(text, { breaks: true, gfm: true });
    return DOMPurify.sanitize(html);
  } catch (e) {
    console.error('Markdown render error:', e);
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// --- Safe JSON parse helper ---
async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('Server returned non-JSON:', text.slice(0, 200));
    throw new Error('Server hat keine gültige JSON-Antwort zurückgegeben. Siehe Konsole.');
  }
}

// --- Session Management ---

async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    const data = await safeJson(res);
    renderSessionList(data.sessions, data.current);
    if (data.current) {
      sessionInfoEl.textContent = `Session: ${data.current.slice(0, 8)}...`;
    }
  } catch (err) {
    console.warn('Sessions laden fehlgeschlagen:', err);
    sessionInfoEl.textContent = 'Fehler beim Laden';
  }
}

function renderSessionList(sessions, currentId) {
  sessionListEl.innerHTML = '';
  if (!sessions || sessions.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch keine Sessions';
    sessionListEl.appendChild(li);
    return;
  }
  
  sessions.forEach(session => {
    const li = document.createElement('li');
    li.className = session.id === currentId ? 'active' : '';
    
    const date = new Date(session.updatedAt).toLocaleString('de-DE', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    
    li.innerHTML = `
      <div class="session-name">${session.id.slice(0, 8)}...</div>
      <div class="session-meta">${date} · ${session.messageCount} Nachrichten</div>
    `;
    
    li.addEventListener('click', () => {
      switchSession(session.id);
      if (isMobile()) closeSidebar();
    });
    sessionListEl.appendChild(li);
  });
}

async function switchSession(id) {
  try {
    const res = await fetch(`/api/sessions/${id}/switch`, { method: 'POST' });
    const data = await safeJson(res);
    if (res.ok) {
      chatEl.innerHTML = '';
      addMsg(`Session gewechselt: ${id.slice(0, 8)}... (${data.messages} Nachrichten im Kontext)`, 'system');
      loadSessions();
    } else {
      addMsg('Fehler: ' + (data.error || 'Unbekannter Fehler'), 'error');
    }
  } catch (err) {
    addMsg('Fehler beim Wechseln: ' + err.message, 'error');
  }
}

async function startNewSession() {
  try {
    const res = await fetch('/api/sessions/new', { method: 'POST' });
    const data = await safeJson(res);
    chatEl.innerHTML = '';
    addMsg('Neue Session gestartet.', 'system');
    if (data.id) {
      sessionInfoEl.textContent = `Session: ${data.id.slice(0, 8)}...`;
    }
    loadSessions();
    if (isMobile()) closeSidebar();
  } catch (err) {
    addMsg('Fehler: ' + err.message, 'error');
    console.error('startNewSession error:', err);
  }
}

// --- Chat ---

function addMsg(text, cls = 'assistant', imageUrl = null) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.dataset.rawText = text || '';
  div.innerHTML = renderMarkdown(text);
  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = 'Hochgeladenes Bild';
    div.appendChild(img);
  }
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
  return div;
}

function appendToMsg(el, text) {
  el.dataset.rawText = (el.dataset.rawText || '') + text;
  // Während Streaming: rohen Text anzeigen (schneller, kein Flackern)
  // Markdown-Rendering passiert erst bei done
  el.textContent = el.dataset.rawText;
  chatEl.scrollTop = chatEl.scrollHeight;
}

function finalizeMsg(el) {
  // Nach Streaming: Markdown rendern
  el.classList.remove('streaming');
  el.innerHTML = renderMarkdown(el.dataset.rawText || '');
  chatEl.scrollTop = chatEl.scrollHeight;
}

function setBusy(b) {
  isBusy = b;
  sendBtn.disabled = b;
  statusEl.textContent = b ? 'Denkt...' : 'Bereit';
  statusEl.className = b ? 'status-busy' : 'status-idle';
}

async function send() {
  const text = inputEl.value.trim();
  if ((!text && pendingFiles.length === 0) || isBusy) return;
  
  // Zeige User-Nachricht an
  if (text) {
    addMsg(text, 'user');
  }
  if (pendingFiles.length > 0) {
    pendingFiles.forEach(file => {
      if (file.type.startsWith('image/')) {
        addMsg(`📷 ${file.name}`, 'user', URL.createObjectURL(file));
      } else {
        addMsg(`📎 ${file.name}`, 'user');
      }
    });
  }
  
  inputEl.value = '';
  inputEl.style.height = 'auto';
  setBusy(true);

  currentMsg = null;

  try {
    const formData = new FormData();
    if (text) formData.append('message', text);
    pendingFiles.forEach(file => formData.append('files', file));
    
    const response = await fetch('/api/chat', {
      method: 'POST',
      body: formData,
    });

    pendingFiles = [];
    renderUploadPreview();

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      const data = await safeJson(response);
      addMsg('❌ ' + (data.error || 'Serverfehler'), 'error');
      setBusy(false);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6);
        if (!json) continue;
        try {
          const ev = JSON.parse(json);
          handleEvent(ev);
          if (ev.type === 'done') {
            loadSessions();
          }
        } catch (e) {
          console.warn('SSE parse error:', e, 'Line:', json.slice(0, 100));
        }
      }
    }
  } catch (err) {
    addMsg('❌ Netzwerkfehler: ' + err.message, 'error');
    console.error('send() error:', err);
  } finally {
    setBusy(false);
  }
}

function handleEvent(ev) {
  switch (ev.type) {
    case 'thought':
      if (!document.querySelector('.msg.think:last-child')) {
        addMsg('💭 ' + ev.data, 'think');
      } else {
        appendToMsg(document.querySelector('.msg.think:last-child'), ev.data);
      }
      break;
    case 'tool_call': {
      let data = ev.data;
      try {
        const parsed = JSON.parse(ev.data);
        data = '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
      } catch { /* not valid JSON */ }
      addMsg(`🔧 Tool: ${ev.toolName}\n${data}`, 'tool');
      break;
    }
    case 'tool_result':
      const txt = ev.error ? `❌ Fehler: ${ev.error}` : `✅ Ergebnis:\n${formatResult(ev.result)}`;
      addMsg(txt, 'tool');
      break;
    case 'content':
      if (!currentMsg) {
        currentMsg = addMsg(ev.data, 'assistant');
        // Während Streaming: rohen Text anzeigen
        currentMsg.classList.add('streaming');
        currentMsg.textContent = currentMsg.dataset.rawText;
      } else {
        appendToMsg(currentMsg, ev.data);
      }
      break;
    case 'done':
      if (currentMsg) {
        finalizeMsg(currentMsg);
      }
      currentMsg = null;
      break;
    case 'error':
      addMsg('❌ ' + ev.error, 'error');
      currentMsg = null;
      break;
  }
}

function formatResult(result) {
  if (result === null || result === undefined) return '(leer)';
  if (typeof result === 'string') return result;
  try {
    if (result.content && typeof result.content === 'string') {
      return result.content;
    }
    if (result.entries && Array.isArray(result.entries)) {
      return result.entries.map(e => {
        const size = e.size !== undefined ? ` (${formatBytes(e.size)})` : '';
        return `${e.type === 'directory' ? '📁' : '📄'} ${e.name}${size}`;
      }).join('\n');
    }
    return '```json\n' + JSON.stringify(result, null, 2) + '\n```';
  } catch {
    return String(result);
  }
}

function formatBytes(bytes) {
  if (bytes === undefined) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// --- Event Listeners ---

sendBtn.addEventListener('click', send);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

newSessionBtn.addEventListener('click', startNewSession);

// Init
loadSessions();
