#!/usr/bin/env node
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const { URL } = require('url');

const {
  html,
  collect,
  assignSlot,
  moveSlot,
  resizeSlot,
  resetSlots,
  setGridShape,
  recoverMissingSessions,
  renameSessionLabel,
  sendPrompt,
  sendKey,
  pasteText,
  pasteImages,
  pasteSystemClipboardImage,
  openFullTerminal,
  byeSession,
  createAiSession,
  readDiscoSettings,
} = require(process.env.TERMINALTOWN_LIVE === '1' ? '../src/aiGrid' : '../src/demo');

const ROOT = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'assets');
const HOST = '127.0.0.1';
const PORT = Number(process.env.TERMINALTOWN_BROWSER_PORT || process.env.PORT || 17896);
const DEFAULT_BOARD = {
  boardId: process.env.TERMINALTOWN_BROWSER_BOARD_ID || 'default',
  boardTitle: process.env.TERMINALTOWN_BROWSER_BOARD_TITLE || 'TerminalTown',
};
const CODEX_DEFAULT_COMMAND = 'codex';
const DATA_DIR = path.join(process.env.HOME || '', '.local', 'share', 'terminaltown-public');
const BOARDS_DIR = path.join(DATA_DIR, 'boards');

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function contentType(file) {
  switch (path.extname(file).toLowerCase()) {
    case '.gif': return 'image/gif';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.aiff': return 'audio/aiff';
    case '.json': return 'application/json; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.html': return 'text/html; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function kebab(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'session';
}

function cleanTitle(value, fallback = 'TerminalTown') {
  const title = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return title || fallback;
}

function boardContext(input = {}) {
  const raw = String(input.boardId || input.id || input.title || 'default').trim();
  const id = raw === 'default' ? 'default' : kebab(raw);
  const boardId = id && id !== 'session' ? id : 'default';
  return {
    boardId,
    boardTitle: cleanTitle(input.boardTitle || input.title || (boardId === 'default' ? 'TerminalTown' : boardId), boardId),
  };
}

function boardForRequest(input = {}) {
  const requestedId = String(input.boardId || input.id || '').trim();
  return boardContext({
    boardId: requestedId || DEFAULT_BOARD.boardId,
    boardTitle: input.boardTitle || input.title || (requestedId ? requestedId : DEFAULT_BOARD.boardTitle),
  });
}

function boardLocation(board) {
  return `/?board=${encodeURIComponent(board.boardId)}`;
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function knownBoards() {
  const boards = new Map();
  const add = (file, fallbackId) => {
    const parsed = readJsonFile(file) || {};
    const board = boardContext({
      boardId: parsed.boardId || fallbackId,
      boardTitle: parsed.boardTitle || parsed.title || '',
    });
    boards.set(board.boardId, { id: board.boardId, title: board.boardTitle });
  };
  add(path.join(DATA_DIR, 'layout.json'), 'default');
  try {
    for (const name of fs.readdirSync(BOARDS_DIR)) {
      if (/\.json$/i.test(name)) add(path.join(BOARDS_DIR, name), path.basename(name, '.json'));
    }
  } catch {}
  return [...boards.values()].sort((a, b) => (a.id === 'default' ? -1 : b.id === 'default' ? 1 : a.title.localeCompare(b.title)));
}

function safeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function browserHtml() {
  const webview = { cspSource: "'self'" };
  const doc = html(
    webview,
    '/assets/disco-ball.svg',
    '',
    '/assets/refractions.svg',
    readDiscoSettings({ globalStorageUri: { fsPath: path.join(process.env.HOME || '', '.local', 'share', 'terminaltown-public') } })
  ).replace(
    /<meta http-equiv="Content-Security-Policy" content="[^"]+">/,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self';">`
  );
  const shim = `
window.terminalTownBrowserHost = true;
const terminalTownBrowserParams = new URLSearchParams(window.location.search);
window.terminalTownBrowserBoard = terminalTownBrowserParams.get('board') || '';
window.terminalTownBrowserBoardQuery = window.terminalTownBrowserBoard
  ? '?board=' + encodeURIComponent(window.terminalTownBrowserBoard)
  : '';
function acquireVsCodeApi() {
  return {
    postMessage: async (message) => {
      try {
        const requestPayload = { ...(message || {}) };
        if (window.terminalTownBrowserBoard && !requestPayload.boardId) requestPayload.boardId = window.terminalTownBrowserBoard;
        const response = await fetch('/api/message' + window.terminalTownBrowserBoardQuery, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(requestPayload)
        });
        const payload = await response.json();
        for (const item of payload.messages || []) {
          window.dispatchEvent(new MessageEvent('message', { data: item }));
        }
      } catch (err) {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'note', message: err && err.message ? err.message : 'TerminalTown browser host unavailable' }
        }));
      }
    }
  };
}
`;
  return doc.replace('<title>TerminalTown</title>', '<title>TerminalTown · ' + (process.env.TERMINALTOWN_LIVE === '1' ? 'Live' : 'Demo') + '</title>').replace('const vscode = acquireVsCodeApi();', `${shim}\nconst vscode = acquireVsCodeApi();`);
}

async function sessionForSlot(slot, board) {
  const data = await collect(board);
  const session = data.sessions[Number(slot)] && data.sessions[Number(slot)].name;
  if (!session) throw new Error(`No session in slot ${Number(slot) + 1}`);
  return { data, session };
}

async function refreshMessages(board, extra = []) {
  return [
    ...extra,
    { type: 'data', data: await collect(board) },
  ];
}

async function refreshMessagesFor(message, board, extra = []) {
  return [
    ...extra,
    {
      type: 'data',
      data: await collect({
        ...board,
        focusedSlot: Number(message && message.focusedSlot),
        captureLinesBySlot: message && message.captureLinesBySlot,
        terminalSizesBySlot: message && message.terminalSizesBySlot,
      }),
    },
  ];
}

function readSystemClipboardText() {
  return new Promise((resolve) => {
    execFile('/usr/bin/pbpaste', [], { encoding: 'utf8', timeout: 3000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

function defaultCommand(kind, command) {
  const raw = String(command || '').trim();
  if (raw) return raw;
  if (kind === 'claude') return 'claude';
  if (kind === 'shell') return 'zsh';
  return CODEX_DEFAULT_COMMAND;
}

async function handleMessage(message) {
  const msg = message || {};
  if (process.env.TERMINALTOWN_LIVE !== '1' && msg.type === 'pasteClipboardText') return [{type:'note',message:'Host clipboard access is disabled in demo mode.'}];
  const board = boardForRequest(msg);
  const note = (messageText) => ({ type: 'note', message: messageText });

  if (msg.type === 'focusSlot') return [];
  if (msg.type === 'refresh') return refreshMessagesFor(msg, board);
  if (msg.type === 'spectacle') return [];
  if (msg.type === 'reloadUi' || msg.type === 'reloadWindow') return refreshMessages(board, [note('Reloaded browser view')]);
  if (msg.type === 'newBoard') {
    const destination = boardContext({ title: msg.title || 'New board' });
    return [{ type: 'navigate', url: boardLocation(destination) }];
  }
  if (msg.type === 'openBoard') {
    const destination = boardForRequest({ boardId: msg.boardId || 'default', boardTitle: msg.boardTitle || msg.boardId || 'TerminalTown' });
    return [{ type: 'navigate', url: boardLocation(destination) }];
  }
  if (msg.type === 'openMap') return [note('Project maps are not part of this standalone edition.')];
  if (msg.type === 'openTerminal') {
    const {session} = await sessionForSlot(msg.slot, board);
    return [note(`Attach in your terminal: tmux attach -t =${session}`)];
  }
  if (msg.type === 'openExternal') return [note(`Open link: ${String(msg.url || '')}`)];
  if (msg.type === 'newSession') {
    const kind = ['claude', 'codex', 'shell'].includes(String(msg.kind || '').toLowerCase()) ? String(msg.kind).toLowerCase() : 'codex';
    const session = await createAiSession({
      session: String(msg.session || '').trim(),
      cwd: String(msg.cwd || process.cwd()),
      command: defaultCommand(kind, msg.command),
      initialPrompt: String(msg.initialPrompt || ''),
      placement: msg.placement !== undefined ? String(msg.placement) : String(Number(msg.slot) || 0),
      title: String(msg.title || msg.session || ''),
      board,
    });
    const pending = String(msg.initialPrompt || '').trim();
    return refreshMessages(board, [note(pending ? `Started ${session}; waiting to deliver its first prompt.` : `Started ${session}`)]);
  }
  if (msg.type === 'bye') {
    const { session } = await sessionForSlot(msg.slot, board);
    await byeSession(session, board);
    return refreshMessages(board, [note(`Ended ${session}`)]);
  }
  if (msg.type === 'copyText') return [note(`Copied slot ${Number(msg.slot) + 1}`)];
  if (msg.type === 'pasteClipboardText') {
    const { session } = await sessionForSlot(msg.slot, board);
    const text = await readSystemClipboardText();
    if (text) {
      await pasteText(session, text);
      return refreshMessages(board, [note(`Pasted host clipboard text to ${session}`)]);
    }
    const files = await pasteSystemClipboardImage(session);
    if (files.length) return refreshMessages(board, [note(`Pasted ${files.length} host clipboard image path${files.length === 1 ? '' : 's'} to ${session}`)]);
    return [note('Clipboard has no usable text or image.')];
  }

  if (msg.type === 'setGrid') {
    const grid = await setGridShape(Number(msg.columns), Number(msg.rows), board);
    return refreshMessages(board, [note(`Grid set to ${grid.columns}x${grid.rows}`)]);
  }

  if (msg.type === 'recoverMissing') {
    const result = await recoverMissingSessions(board);
    return refreshMessages(board, [note(`Recovery: indexed ${result.indexed}, adopted ${result.adopted}, spawned ${result.spawned}, skipped ${result.skipped}`)]);
  }

  if (msg.type === 'assign') {
    await assignSlot(Number(msg.slot), String(msg.session || ''), board);
    return refreshMessages(board);
  }

  if (msg.type === 'assignFirstEmpty') {
    const data = await collect(board);
    const slot = data.sessions.findIndex((session) => !session.name);
    if (slot === -1) return refreshMessages(board, [note('No empty slot; use a slot Assign menu.')]);
    await assignSlot(slot, String(msg.session || ''), board);
    return refreshMessages(board);
  }

  if (msg.type === 'move') {
    await moveSlot(Number.isInteger(msg.fromSlot) ? msg.fromSlot : null, Number(msg.toSlot), String(msg.session || ''), board);
    return refreshMessages(board);
  }

  if (msg.type === 'showHeld') {
    const data = await collect(board);
    let slot = Number(msg.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= data.sessions.length) {
      slot = data.sessions.findIndex((session) => !session.name);
    }
    if (slot === -1) return refreshMessages(board, [note('No empty slot; drag onto a slot to swap/replace.')]);
    await moveSlot(null, slot, String(msg.session || ''), board);
    return refreshMessages(board);
  }

  if (msg.type === 'resetSlots') {
    await resetSlots(board);
    return refreshMessages(board);
  }

  if (msg.type === 'resize') {
    const result = await resizeSlot(Number(msg.slot), String(msg.direction || ''), Number(msg.columns), Number(msg.span), board);
    return refreshMessages(board, [note(result.span === 2 ? `${result.session} is tall` : `${result.session} is normal height`)]);
  }

  if (msg.type === 'prompt') {
    const { session } = await sessionForSlot(msg.slot, board);
    const submitKey = String(msg.submitKey || 'enter');
    await sendPrompt(session, String(msg.prompt || ''), submitKey);
    return refreshMessages(board, [note(`${submitKey === 'tab' ? 'Queued' : 'Sent'} to ${session}`)]);
  }

  if (msg.type === 'pasteText') {
    const { session } = await sessionForSlot(msg.slot, board);
    await pasteText(session, String(msg.text || ''));
    return refreshMessages(board, [note(`Pasted text to ${session}`)]);
  }

  if (msg.type === 'pasteImages') {
    const { session } = await sessionForSlot(msg.slot, board);
    const files = await pasteImages(session, msg.images);
    return refreshMessages(board, [note(`Pasted ${files.length} image path${files.length === 1 ? '' : 's'} to ${session}`)]);
  }

  if (msg.type === 'rename') {
    const { session } = await sessionForSlot(msg.slot, board);
    const title = await renameSessionLabel(session, String(msg.title || session));
    return refreshMessages(board, [note(`Renamed ${session} to ${title}`)]);
  }

  if (msg.type === 'key') {
    const { session } = await sessionForSlot(msg.slot, board);
    await sendKey(session, msg.key);
    return refreshMessages(board, [note(`${msg.key === 'ctrl-c' ? 'Ctrl-C' : msg.key === 'enter' ? 'Enter' : msg.key === 'escape' ? 'Esc' : msg.key} sent to ${session}`)]);
  }

  return [note(`Unsupported browser message: ${msg.type || 'unknown'}`)];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const allowed = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
    if (!allowed.has(req.headers.host)) { sendText(res, 403, 'Local access only'); return; }
    if (req.headers.origin && !allowed.has(new URL(req.headers.origin).host)) { sendText(res, 403, 'Origin rejected'); return; }
    if (req.method === 'POST' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { sendText(res, 415, 'JSON required'); return; }
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (req.method === 'GET' && url.pathname === '/') {
      sendText(res, 200, browserHtml(), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
      const name = path.basename(decodeURIComponent(url.pathname.slice('/assets/'.length)));
      const file = path.join(ASSETS_DIR, name);
      if (!file.startsWith(ASSETS_DIR + path.sep) || !fs.existsSync(file)) {
        sendText(res, 404, 'not found');
        return;
      }
      res.writeHead(200, { 'content-type': contentType(file) });
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/message') {
      const body = await readBody(req);
      const message = JSON.parse(body || '{}');
      if (!message.boardId && url.searchParams.get('board')) message.boardId = url.searchParams.get('board');
      const messages = await handleMessage(message);
      sendJson(res, 200, { messages });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      sendJson(res, 200, await collect(boardForRequest({ boardId: url.searchParams.get('board') || '' })));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/boards') {
      const board = boardForRequest({ boardId: url.searchParams.get('board') || '' });
      sendJson(res, 200, { active: { id: board.boardId, title: board.boardTitle }, boards: knownBoards() });
      return;
    }
    sendText(res, 404, 'not found');
  } catch (err) {
    sendJson(res, 500, {
      messages: [{ type: 'note', message: err && err.message ? err.message : String(err) }],
      error: err && err.message ? err.message : String(err),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`TerminalTown browser running at http://${HOST}:${PORT}/`);
});
