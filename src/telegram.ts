import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { getSystemPrompt } from './config.js';
import { runAgent } from './telegram-agent.js';
import {
  loadSession,
  saveSession,
  listSessions,
  deleteSession,
  getCurrentSessionId,
  setCurrentSessionId,
  type Session,
} from './telegram-session-store.js';
import type { ChatMessage, ContentPart } from './llm.js';
import { extractPdfText } from './pdf-parser.js';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Konfiguration ──────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHATS = (process.env.TELEGRAM_ALLOWED_CHATS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.error('❌ FEHLER: TELEGRAM_BOT_TOKEN nicht gesetzt!');
  console.error('   Erstelle eine .env Datei mit: TELEGRAM_BOT_TOKEN=dein_token');
  process.exit(1);
}

if (ALLOWED_CHATS.length === 0) {
  console.warn('⚠️  WARNUNG: TELEGRAM_ALLOWED_CHATS ist leer. Der Bot akzeptiert Nachrichten von JEDEM!');
} else {
  console.log(`🔒 Erlaubte Chats: ${ALLOWED_CHATS.join(', ')}`);
}

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 180_000 });

// ─── Auth-Middleware ────────────────────────────────────────────
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id.toString();
  if (!chatId) return;

  if (ALLOWED_CHATS.length > 0 && !ALLOWED_CHATS.includes(chatId)) {
    console.log(`🚫 Blockierter Chat: ${chatId}`);
    return;
  }

  await next();
});

// ─── Hilfsfunktionen ────────────────────────────────────────────
function getChatSessionId(chatId: string): string {
  return `tg_${chatId}`;
}

function getOrCreateChatSession(chatId: string): Session {
  const sessionId = getChatSessionId(chatId);
  let session = loadSession(sessionId);
  if (!session) {
    session = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    saveSession(session);
  }
  setCurrentSessionId(sessionId);
  return session;
}

function escapeMarkdownV2(text: string): string {
  return text.replace(/([_\*\[\]\(\)~`>#+=|{}.!])/g, '\\$1');
}

// ─── Commands (MUSSEN vor text/photo Handlern kommen!) ──────────
bot.command('new', async (ctx) => {
  try {
    const chatId = ctx.chat.id.toString();
    const sessionId = getChatSessionId(chatId);

    console.log(`[${chatId}] /new called - deleting session ${sessionId}`);

    deleteSession(sessionId);
    setCurrentSessionId(sessionId);
    saveSession({
      id: sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    });
    console.log(`[${chatId}] New empty session saved`);

    await ctx.reply('✅ Neue Session gestartet. Der Kontext wurde zurückgesetzt.');
  } catch (err: any) {
    console.error('Error in /new command:', err);
    await ctx.reply(`❌ Fehler beim Zurücksetzen: ${err.message}`);
  }
});

bot.command('sessions', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const allSessions = listSessions();
  const chatSessions = allSessions.filter((s) => s.id.startsWith(`tg_${chatId}`));

  if (chatSessions.length === 0) {
    await ctx.reply('📁 Keine Sessions vorhanden.');
    return;
  }

  let text = '📁 Deine Sessions:\n\n';
  chatSessions.forEach((s, i) => {
    const shortId = s.id;
    const date = new Date(s.updatedAt).toLocaleString('de-DE');
    text += `${i + 1}\. ${escapeMarkdownV2(shortId)}\n`;
    text += `   ${s.messageCount} Nachrichten \- ${escapeMarkdownV2(date)}\n\n`;
  });

  try {
    await ctx.reply(text, { parse_mode: 'MarkdownV2' });
  } catch {
    await ctx.reply(text.replace(/\\/g, ''));
  }
});

bot.command('current', async (ctx) => {
  const id = getCurrentSessionId();
  const session = loadSession(id);
  const msgCount = session?.messages.length || 0;
  await ctx.reply(
    `💾 Aktive Session: \`${escapeMarkdownV2(id)}\`\nNachrichten: ${msgCount}`,
    { parse_mode: 'MarkdownV2' }
  );
});

bot.command('delete', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) {
    await ctx.reply('Usage: /delete \<session\-id\>\nBeispiel: `/delete tg_123456789`', {
      parse_mode: 'MarkdownV2',
    });
    return;
  }
  const targetId = args[0];
  const current = getCurrentSessionId();

  if (targetId === current) {
    await ctx.reply('❌ Die aktive Session kann nicht gelöscht werden. Nutze zuerst /new.');
    return;
  }

  if (deleteSession(targetId)) {
    await ctx.reply('✅ Session gelöscht.');
  } else {
    await ctx.reply('❌ Session nicht gefunden.');
  }
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    '🤖 *Mini\-Agent Telegram Bot*\n\n' +
      '*Befehle:*\n' +
      '/new \- Neue Session starten\n' +
      '/sessions \- Alle Sessions anzeigen\n' +
      '/current \- Aktuelle Session anzeigen\n' +
      '/delete \<id\> \- Session löschen\n' +
      '/help \- Diese Hilfe\n\n' +
      '*Nutzen:*\n' +
      'Sende einfach eine Nachricht oder ein Bild, um mit dem Agent zu chatten\.\n' +
      'Der Kontext bleibt pro Chat erhalten, bis du /new nutzest.',
    { parse_mode: 'MarkdownV2' }
  );
});

// ─── Text-Nachrichten ───────────────────────────────────────────
bot.on(message('text'), async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const text = ctx.message.text;

  const session = getOrCreateChatSession(chatId);

  const systemPrompt = session.systemPrompt || getSystemPrompt();
  const messages: ChatMessage[] =
    session.messages.length > 0
      ? [{ role: 'system', content: systemPrompt }, ...session.messages]
      : [{ role: 'system', content: systemPrompt }];

  messages.push({ role: 'user', content: text });

  await ctx.sendChatAction('typing');

  let responseText = '';
  const toolCalls: string[] = [];

  try {
    for await (const event of runAgent(text, messages)) {
      if (event.type === 'tool_call') {
        toolCalls.push(event.toolName || 'unknown');
        await ctx.sendChatAction('typing');
      }
      if (event.type === 'content') {
        responseText += event.data || '';
      }
      if (event.type === 'error') {
        await ctx.reply(`❌ Fehler: ${event.error}`);
        return;
      }
    }

    if (responseText) {
      try {
        await ctx.reply(responseText, { parse_mode: 'Markdown' });
      } catch {
        await ctx.reply(responseText);
      }
    }

    if (toolCalls.length > 0) {
      console.log(`[${chatId}] Tools: ${toolCalls.join(', ')}`);
    }
  } catch (err: any) {
    console.error('Agent-Fehler:', err);
    await ctx.reply(`❌ Fehler: ${err.message || 'Unbekannter Fehler'}`);
  }
});

// ─── Dokumente / Dateien ────────────────────────────────────────
bot.on(message('document'), async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const caption = ctx.message.caption || '';
  const doc = ctx.message.document;

  const session = getOrCreateChatSession(chatId);

  let fileContent: string;
  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const fileRes = await fetch(fileLink.href);
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    const textMimeTypes = [
      'text/',
      'application/json',
      'application/javascript',
      'application/typescript',
      'application/xml',
    ];
    const isText =
      textMimeTypes.some((t) => doc.mime_type?.startsWith(t)) ||
      /\.(txt|md|json|js|ts|jsx|tsx|py|sh|yaml|yml|css|html|xml|csv|log)$/i.test(doc.file_name || '');

    const isPdf = doc.mime_type === 'application/pdf' || /\.pdf$/i.test(doc.file_name || '');

    if (!isText && !isPdf) {
      await ctx.reply(
        `📎 Datei erhalten: *${doc.file_name}* (${((doc.file_size ?? 0) / 1024).toFixed(1)} KB)\nIch kann aktuell nur Text- und PDF-Dateien verarbeiten.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (isPdf) {
      try {
        fileContent = await extractPdfText(buffer);
      } catch (err: any) {
        await ctx.reply(`❌ PDF konnte nicht gelesen werden: ${err.message}`);
        return;
      }
    } else {
      fileContent = buffer.toString('utf-8');
    }

    const MAX_CHARS = 50000;
    if (fileContent.length > MAX_CHARS) {
      fileContent = fileContent.slice(0, MAX_CHARS) + '\n\n... [Datei wurde gekürzt]';
    }
  } catch (err: any) {
    await ctx.reply(`❌ Datei konnte nicht geladen werden: ${err.message}`);
    return;
  }

  const userText = caption
    ? `${caption}\n\n--- Inhalt von ${doc.file_name} ---\n\`\`\`\n${fileContent}\n\`\`\``
    : `--- Inhalt von ${doc.file_name} ---\n\`\`\`\n${fileContent}\n\`\`\``;

  const systemPrompt = session.systemPrompt || getSystemPrompt();
  const messages: ChatMessage[] =
    session.messages.length > 0
      ? [{ role: 'system', content: systemPrompt }, ...session.messages]
      : [{ role: 'system', content: systemPrompt }];

  messages.push({ role: 'user', content: userText });

  await ctx.sendChatAction('typing');

  let responseText = '';

  try {
    for await (const event of runAgent(caption || `[Datei: ${doc.file_name}]`, messages)) {
      if (event.type === 'content') {
        responseText += event.data || '';
      }
      if (event.type === 'error') {
        await ctx.reply(`❌ Fehler: ${event.error}`);
        return;
      }
    }

    if (responseText) {
      try {
        await ctx.reply(responseText, { parse_mode: 'Markdown' });
      } catch {
        await ctx.reply(responseText);
      }
    }
  } catch (err: any) {
    console.error('Agent-Fehler (Dokument):', err);
    await ctx.reply(`❌ Fehler: ${err.message || 'Unbekannter Fehler'}`);
  }
});

// ─── Bilder ─────────────────────────────────────────────────────
bot.on(message('photo'), async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const caption = ctx.message.caption || '';

  const photos = ctx.message.photo;
  const largest = photos[photos.length - 1];

  const session = getOrCreateChatSession(chatId);

  let base64: string;
  try {
    const fileLink = await ctx.telegram.getFileLink(largest.file_id);
    const imageRes = await fetch(fileLink.href);
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
    base64 = imageBuffer.toString('base64');
  } catch (err: any) {
    await ctx.reply(`❌ Bild konnte nicht geladen werden: ${err.message}`);
    return;
  }

  const mimeType = 'image/jpeg';

  const contentParts: ContentPart[] = [
    { type: 'text', text: caption || '[Bild]' },
    {
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'auto' },
    },
  ];

  const systemPrompt = session.systemPrompt || getSystemPrompt();
  const messages: ChatMessage[] =
    session.messages.length > 0
      ? [{ role: 'system', content: systemPrompt }, ...session.messages]
      : [{ role: 'system', content: systemPrompt }];

  messages.push({ role: 'user', content: contentParts });

  await ctx.sendChatAction('typing');

  let responseText = '';

  try {
    for await (const event of runAgent(caption, messages)) {
      if (event.type === 'content') {
        responseText += event.data || '';
      }
      if (event.type === 'error') {
        await ctx.reply(`❌ Fehler: ${event.error}`);
        return;
      }
    }

    if (responseText) {
      try {
        await ctx.reply(responseText, { parse_mode: 'Markdown' });
      } catch {
        await ctx.reply(responseText);
      }
    }
  } catch (err: any) {
    console.error('Agent-Fehler (Bild):', err);
    await ctx.reply(`❌ Fehler: ${err.message || 'Unbekannter Fehler'}`);
  }
});

// ─── Error Handler ──────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error('Telegram Fehler:', err);
  ctx.reply('❌ Ein interner Fehler ist aufgetreten.').catch(() => {});
});

// ─── Start ──────────────────────────────────────────────────────
bot.launch();
console.log('🤖 Telegram Bot gestartet');
console.log('   Sessions werden gespeichert unter: telegram-sessions/');

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
