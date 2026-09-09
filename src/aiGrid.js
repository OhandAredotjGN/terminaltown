const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const TMUX_BIN = (() => {
  const candidates = [
    process.env.SUMMONER_TMUX_BIN,
    '/usr/local/bin/tmux',
    '/opt/homebrew/bin/tmux',
    '/usr/bin/tmux',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return 'tmux';
})();

const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const DATA_DIR = process.env.TERMINALTOWN_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'terminaltown-public');
const LEGACY_DATA_DIR = DATA_DIR;
const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json');
const LEGACY_LAYOUT_FILE = path.join(LEGACY_DATA_DIR, 'layout.json');
const BOARDS_DIR = path.join(DATA_DIR, 'boards');
const MANIFEST_FILE = process.env.TERMINALTOWN_MANIFEST || path.join(DATA_DIR, 'sessions-manifest.json');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');
const PASTE_DIR = path.join(DATA_DIR, 'pastes');
const SUMMON_DIR = path.join(DATA_DIR, 'labels');
const SUMMON_QUEUE = path.join(SUMMON_DIR, 'queue.jsonl');
const TITLES_FILE = path.join(SUMMON_DIR, 'titles.json');
const PROJECT_ROOT = process.env.TERMINALTOWN_PROJECT_ROOT || process.cwd();
const TERMINALS_JSON = path.join(PROJECT_ROOT, '.vscode', 'terminals.json');
const EXTERNAL_TERMINAL_URL = process.env.TERMINALTOWN_EXTERNAL_TERMINAL_URL || '';
const SLOT_COUNT = 12;
const DEFAULT_BOARD_ID = 'default';
const DEFAULT_BOARD_TITLE = 'TerminalTown';
const DEFAULT_GRID = { columns: 3, rows: 4 };
const GRID_OPTIONS = [
  { label: '2x2', columns: 2, rows: 2 },
  { label: '2x3', columns: 2, rows: 3 },
  { label: '3x3', columns: 3, rows: 3 },
  { label: '3x4', columns: 3, rows: 4 },
  { label: '4x3', columns: 4, rows: 3 },
  { label: '4x4', columns: 4, rows: 4 },
];
const CAPTURE_LINES = Math.max(24, Number(process.env.TERMINALTOWN_LINES || process.env.AI_GRID_LINES || 72) || 72);
const FOCUSED_CAPTURE_LINES = Math.max(CAPTURE_LINES, Number(process.env.TERMINALTOWN_FOCUSED_LINES || process.env.AI_GRID_FOCUSED_LINES || 260) || 260);
const MAX_CAPTURE_LINES = Math.max(FOCUSED_CAPTURE_LINES, Number(process.env.TERMINALTOWN_MAX_LINES || 1200) || 1200);
const MIN_TERMINAL_COLS = 40;
const MAX_TERMINAL_COLS = 320;
const MIN_TERMINAL_ROWS = 12;
const MAX_TERMINAL_ROWS = 180;
const SID_RE = /^[0-9a-f-]{36}$/i;
const WAIT_GRACE_MS = 2000;
const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
const ATTENTION_DIR = path.join(os.homedir(), '.claude', 'attention');
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const CODEX_STATE_DB = process.env.CODEX_STATE_DB || path.join(CODEX_HOME, 'state_5.sqlite');
const CODEX_LOCK_DIR = path.join(CODEX_HOME, 'thread-writer-locks');
const CODEX_TAIL_BYTES = 192 * 1024;
const INITIAL_PROMPT_READY_TIMEOUT_MS = Math.max(15000, Number(process.env.TERMINALTOWN_INITIAL_PROMPT_TIMEOUT_MS || 60000) || 60000);
const INITIAL_PROMPT_POLL_MS = 1000;
const COLLECT_TIMEOUT_MS = Math.max(3000, Number(process.env.TERMINALTOWN_COLLECT_TIMEOUT_MS || 8000) || 8000);
const RECOVERY_BACKOFF_MS = Math.max(3000, Number(process.env.TERMINALTOWN_RECOVERY_BACKOFF_MS || 15000) || 15000);
const MAX_RECOVERY_BACKOFF_MS = Math.max(RECOVERY_BACKOFF_MS, Number(process.env.TERMINALTOWN_MAX_RECOVERY_BACKOFF_MS || 120000) || 120000);
const AGENT_RESTART_COOLDOWN_MS = Math.max(15000, Number(process.env.TERMINALTOWN_AGENT_RESTART_COOLDOWN_MS || 60000) || 60000);
const DISCO_SETTINGS_DEFAULTS = {
  maskShavePx: 0,
  scalePct: 115,
  visibleCenterTopPx: 4,
  stringJoinOverlapPx: 2,
  refractionOpacityPct: 62,
  refractionSizeVmax: 142,
  refractionTurnDeg: 81,
  hueDeg: 4,
  saturationPct: 112,
  brightnessPct: 85,
  spriteLoopDurationMs: 1280,
  frameBlend: false,
};
const DISCO_GIF_WIDTH = 119;
const DISCO_GIF_HEIGHT = 111;
const TERMINALTOWN_BUILD_TAG = 'grid-shape-slots-20260904a';
const TMUX_SOCKET_NAMES = Array.from(new Set(
  String(process.env.TERMINALTOWN_TMUX_SOCKETS || 'default')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
));

const SQLITE_BIN = (() => {
  const candidates = [
    process.env.SQLITE3_BIN,
    '/usr/bin/sqlite3',
    '/opt/homebrew/bin/sqlite3',
    '/usr/local/bin/sqlite3',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return 'sqlite3';
})();

const LSOF_BIN = (() => {
  const candidates = [
    process.env.LSOF_BIN,
    '/usr/sbin/lsof',
    '/usr/bin/lsof',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return 'lsof';
})();

const OSASCRIPT_BIN = (() => {
  const candidates = [
    process.env.OSASCRIPT_BIN,
    '/usr/bin/osascript',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return 'osascript';
})();

let codexPathCache = { at: 0, paths: new Map() };
let codexLockCache = { at: 0, locks: new Map() };
let collectHealth = { failures: 0, retryAt: 0, reason: '' };
const agentRestartAttempts = new Map();
const pendingPromptDeliveries = new Set();
const terminalSizeCache = new Map();

const CODEX_DEFAULT_COMMAND = 'codex';

function codexDefaultCommand(args = '') {
  const suffix = String(args || '').trim();
  return suffix
    ? `${CODEX_DEFAULT_COMMAND} ${suffix}`
    : CODEX_DEFAULT_COMMAND;
}

function normalizeCodexLaunchCommand(command = '') {
  const raw = String(command || '').trim();
  if (raw === 'codex') return codexDefaultCommand();
  const resume = raw.match(/^codex\s+resume\s+([0-9a-f-]{36})$/i);
  return resume ? codexDefaultCommand(`resume ${resume[1]}`) : raw;
}

function collectErrorMessage(error) {
  const message = String(error && error.message || error || 'unknown collection error').replace(/\s+/g, ' ').trim();
  return message.slice(0, 180) || 'unknown collection error';
}

function recordCollectionFailure(error) {
  const failures = Math.min(6, collectHealth.failures + 1);
  const delay = Math.min(MAX_RECOVERY_BACKOFF_MS, RECOVERY_BACKOFF_MS * (2 ** (failures - 1)));
  collectHealth = { failures, retryAt: Date.now() + delay, reason: collectErrorMessage(error) };
}

function recordCollectionSuccess() {
  collectHealth = { failures: 0, retryAt: 0, reason: '' };
}

function automaticRecoveryActive() {
  return collectHealth.retryAt > Date.now();
}

function withinTimeout(work, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

const PRIORITY = [
  'MOTHER',
  'TB-Consultant',
  'TB-Developer',
  'TB-Manager',
  'claude-tasks',
  'codex',
  'codex-DEP',
  'codex-apparel-reconcile',
  'codex-asset-text',
  'codex-assets-panel',
  'codex-bedroom-weekdays',
  'codex-control',
];

function exec(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      encoding: 'utf8',
      timeout: opts.timeout || 5000,
      maxBuffer: opts.maxBuffer || 2 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

async function tmux(args, opts) {
  return exec(TMUX_BIN, args, opts);
}

async function tmuxSocket(socket, args, opts) {
  const label = socket && socket !== 'default' ? socket : '';
  return exec(TMUX_BIN, label ? ['-L', label, ...args] : args, opts);
}

function socketLabel(socket) {
  return socket && socket !== 'default' ? socket : 'default';
}

function socketArg(socket) {
  return socket && socket !== 'default' ? socket : '';
}

function cleanText(s) {
  return String(s || '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .trimEnd();
}

function stripTrailingCodexPrompt(output) {
  const text = String(output || '');
  const lines = text.split('\n');
  let askIndex = -1;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i -= 1) {
    if (/Ask Codex to do anything/i.test(lines[i])) {
      askIndex = i;
      break;
    }
  }
  if (askIndex < 0) return text;

  let start = askIndex;
  for (let i = askIndex - 1; i >= Math.max(0, askIndex - 4); i -= 1) {
    const line = lines[i].trim();
    if (!line) {
      start = i;
      continue;
    }
    if (/^[\u2500\s]*Worked for\s+.+[\u2500\s]*$/i.test(line)) {
      start = i;
      break;
    }
    break;
  }

  const trailing = lines.slice(askIndex).filter((line) => line.trim());
  const promptOnly = trailing.every((line) =>
    /Ask Codex to do anything/i.test(line) ||
    /\bContext\s+\d+%\s+left\b/i.test(line) ||
    /\bgpt-\S+/i.test(line) ||
    /^\s*esc\s+again\s+to\s+edit\s+previous\s+message\s*$/i.test(line)
  );
  return promptOnly ? lines.slice(0, start).join('\n').trimEnd() : text;
}

function isClaudeIdleChromeLine(line) {
  const text = String(line || '').trim();
  if (!text) return true;
  return /^─{3,}(?:\s+[^─]+)?\s*─*$/.test(text) ||
    /^❯(?:\s| |$)/.test(text) ||
    /^✻\s+.+\s+for\s+.+\s+·\s+done(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?$/i.test(text) ||
    /^✔\s+Update installed\s+·\s+Restart to update$/i.test(text) ||
    /^new task\?\s+\/clear\b/i.test(text) ||
    /^\/Volumes\/.+/i.test(text) ||
    /^⏵⏵\s+.+(?:mode|permissions) on\b.*(?:agents|shift\+tab|permissions)/i.test(text) ||
    /^\/rc$/i.test(text);
}

function stripTrailingClaudePrompt(output) {
  const text = String(output || '');
  const lines = text.split('\n');
  let promptIndex = -1;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 18); i -= 1) {
    if (/^\s*❯(?:\s| |$)/.test(lines[i])) {
      promptIndex = i;
      break;
    }
  }
  if (promptIndex < 0) return text;

  const tail = lines.slice(promptIndex);
  const hasClaudeStatus = tail.some((line) =>
    /(?:auto|bypass) mode on|shift\+tab|agents|\/rc|ctx:\d+%|Sonnet|Opus|Haiku/i.test(line)
  );
  if (!hasClaudeStatus) return text;

  let start = promptIndex;
  for (let i = promptIndex - 1; i >= Math.max(0, promptIndex - 8); i -= 1) {
    const line = lines[i].trim();
    if (!line) {
      start = i;
      continue;
    }
    if (/^✻\s+.+\s+for\s+.+\s+·\s+done/i.test(line) ||
      /^✔\s+Update installed\s+·\s+Restart to update$/i.test(line) ||
      /^─{3,}(?:\s+[^─]+)?\s*─*$/.test(line) ||
      /^new task\?\s+\/clear\b/i.test(line)) {
      start = i;
      continue;
    }
    break;
  }

  const stripped = lines.slice(start).filter((line) => line.trim());
  if (!stripped.length || stripped.every(isClaudeIdleChromeLine)) {
    return lines.slice(0, start).join('\n').trimEnd();
  }
  return text;
}

function displayPaneOutput(output, command = '', session = {}) {
  if (/\bcodex\b/i.test(command) || /Ask Codex to do anything/i.test(output)) {
    return stripTrailingCodexPrompt(output);
  }
  if (/\bclaude\b/i.test(command) || session.resumeId || /(?:auto|bypass) mode on.*(?:agents|shift\+tab)|^\s*❯(?:\s| |$)/im.test(output)) {
    return stripTrailingClaudePrompt(output);
  }
  return output;
}

function cleanTitle(s) {
  const title = String(s || '')
    .split('')
    .map((c) => {
      const n = c.charCodeAt(0);
      return n < 32 || n === 127 ? ' ' : c;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return title || '';
}

function cleanKind(s) {
  const kind = String(s || '').toLowerCase();
  return ['claude', 'codex', 'shell', 'unknown'].includes(kind) ? kind : 'unknown';
}

function kindForCommand(command) {
  const text = String(command || '');
  if (/(?:\bclaude\b|^claude_)/i.test(text)) return 'claude';
  if (/(?:\bcodex\b|^codex_)/i.test(text)) return 'codex';
  return 'shell';
}

function cleanBoardId(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === DEFAULT_BOARD_ID) return DEFAULT_BOARD_ID;
  const cleaned = kebab(raw).slice(0, 48);
  return cleaned && NAME_RE.test(cleaned) ? cleaned : DEFAULT_BOARD_ID;
}

function cleanBoardTitle(value, id = DEFAULT_BOARD_ID) {
  const title = cleanTitle(value);
  if (title) return title;
  if (id === DEFAULT_BOARD_ID) return DEFAULT_BOARD_TITLE;
  return id.split('-').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || DEFAULT_BOARD_TITLE;
}

function boardContext(options = {}) {
  const raw = typeof options === 'string' ? options : (options.boardId || options.id);
  const id = cleanBoardId(raw);
  const title = cleanBoardTitle(typeof options === 'object' ? (options.boardTitle || options.title) : '', id);
  return {
    id,
    title,
    isDefault: id === DEFAULT_BOARD_ID,
    layoutFile: id === DEFAULT_BOARD_ID ? LAYOUT_FILE : path.join(BOARDS_DIR, `${id}.json`),
    legacyLayoutFile: id === DEFAULT_BOARD_ID ? LEGACY_LAYOUT_FILE : '',
  };
}

function readBoardSummaries() {
  const boards = new Map();
  const add = (file, fallbackId, fallbackTitle = '') => {
    const fallback = boardContext({ boardId: fallbackId, boardTitle: fallbackTitle });
    let parsed = {};
    try {
      if (fs.existsSync(file)) parsed = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch {
      parsed = {};
    }
    const ctx = boardContext({
      boardId: parsed.boardId || fallback.id,
      boardTitle: parsed.boardTitle || parsed.title || fallback.title,
    });
    const grid = normalizeGrid(parsed.grid || { columns: parsed.columns, rows: parsed.rows });
    const rawSlots = Array.isArray(parsed.slots) ? parsed.slots : [];
    const used = new Set();
    const slots = Array.from({ length: grid.slotCount }, (_, index) => {
      const name = typeof rawSlots[index] === 'string' && NAME_RE.test(rawSlots[index]) ? rawSlots[index] : '';
      if (!name || used.has(name)) return '';
      used.add(name);
      return name;
    });
    boards.set(ctx.id, { id: ctx.id, title: ctx.title, grid, slots });
  };

  add(LAYOUT_FILE, DEFAULT_BOARD_ID, DEFAULT_BOARD_TITLE);
  try {
    for (const name of fs.readdirSync(BOARDS_DIR)) {
      if (!/\.json$/i.test(name)) continue;
      add(path.join(BOARDS_DIR, name), path.basename(name, '.json'));
    }
  } catch {}

  return [...boards.values()].sort((a, b) => (
    a.id === DEFAULT_BOARD_ID ? -1 : b.id === DEFAULT_BOARD_ID ? 1 : a.title.localeCompare(b.title)
  ));
}

function sessionBoardMembership(boardSummaries) {
  const membership = {};
  for (const board of boardSummaries || []) {
    for (const name of board.slots || []) {
      if (!NAME_RE.test(String(name || ''))) continue;
      if (!membership[name]) membership[name] = [];
      if (!membership[name].some((item) => item.id === board.id)) {
        membership[name].push({ id: board.id, title: board.title || board.id });
      }
    }
  }
  return membership;
}

function normalizeGrid(value = {}) {
  let columns = Number(value.columns);
  let rows = Number(value.rows);
  const gridText = String(value.grid || value.shape || '').trim();
  const match = gridText.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (match) {
    columns = Number(match[1]);
    rows = Number(match[2]);
  }
  if (!Number.isInteger(columns) || columns < 1 || columns > 6) columns = DEFAULT_GRID.columns;
  if (!Number.isInteger(rows) || rows < 1 || rows > 8) rows = DEFAULT_GRID.rows;
  if (columns * rows > 24) return { ...DEFAULT_GRID, slotCount: DEFAULT_GRID.columns * DEFAULT_GRID.rows };
  return { columns, rows, slotCount: columns * rows };
}

function gridLabel(grid) {
  const g = normalizeGrid(grid);
  return `${g.columns}x${g.rows}`;
}

function parseTmuxEndpoint(value, socket = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  const [sessionPart, rest = ''] = text.split(':');
  if (!NAME_RE.test(sessionPart || '')) return null;
  const target = { socket: socketArg(socket), session: sessionPart };
  if (rest) {
    const [windowPart = '', panePart = ''] = rest.split('.');
    if (/^@\d+$/.test(windowPart)) target.windowId = windowPart;
    else if (/^\d+$/.test(windowPart)) target.window = windowPart;
    else if (windowPart && NAME_RE.test(windowPart)) target.window = windowPart;
    if (/^%\d+$/.test(panePart)) target.paneId = panePart;
  }
  return target;
}

function normalizeTarget(target, fallbackSession = '') {
  const raw = target && typeof target === 'object' ? target : {};
  const session = String(raw.session || fallbackSession || '').trim();
  if (!NAME_RE.test(session)) return null;
  const out = { socket: socketArg(raw.socket || ''), session };
  if (/^%\d+$/.test(String(raw.paneId || ''))) out.paneId = String(raw.paneId);
  if (/^@\d+$/.test(String(raw.windowId || ''))) out.windowId = String(raw.windowId);
  if (/^\d+$/.test(String(raw.window || '')) || NAME_RE.test(String(raw.window || ''))) out.window = String(raw.window);
  return out;
}

function defaultTarget(name) {
  return normalizeTarget({ session: name }, name);
}

function targetSpec(target) {
  const t = normalizeTarget(target);
  if (!t) return '';
  if (t.paneId) return t.paneId;
  if (t.windowId) return t.windowId;
  if (t.window) return `=${t.session}:${t.window}`;
  return `=${t.session}:`;
}

function sessionSpec(target) {
  const t = normalizeTarget(target);
  return t ? `=${t.session}` : '';
}

function targetLabel(target) {
  const t = normalizeTarget(target);
  if (!t) return '';
  const prefix = socketLabel(t.socket) === 'default' ? '' : `${socketLabel(t.socket)}/`;
  if (t.paneId) return `${prefix}${t.session}:${t.paneId}`;
  if (t.windowId) return `${prefix}${t.session}:${t.windowId}`;
  if (t.window) return `${prefix}${t.session}:${t.window}`;
  return `${prefix}${t.session}`;
}

function manifestRecordName(name) {
  return NAME_RE.test(String(name || '')) ? String(name) : '';
}

function readManifest() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    const records = parsed && parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {};
    const sessions = {};
    for (const [name, raw] of Object.entries(records)) {
      const cleanName = manifestRecordName(name);
      if (!cleanName || !raw || typeof raw !== 'object') continue;
      const target = normalizeTarget(raw.target, cleanName) || defaultTarget(cleanName);
      sessions[cleanName] = {
        name: cleanName,
        kind: cleanKind(raw.kind),
        title: cleanTitle(raw.title),
        cwd: String(raw.cwd || ''),
        command: String(raw.command || ''),
        resumeId: SID_RE.test(String(raw.resumeId || '')) ? String(raw.resumeId) : '',
        threadId: SID_RE.test(String(raw.threadId || '')) ? String(raw.threadId) : '',
        target,
        slot: raw.slot !== null && raw.slot !== undefined && Number.isInteger(Number(raw.slot)) ? Number(raw.slot) : null,
        createdAt: String(raw.createdAt || ''),
        updatedAt: String(raw.updatedAt || ''),
        lastSeenAt: String(raw.lastSeenAt || ''),
        lastSnapshot: String(raw.lastSnapshot || ''),
        pendingPrompt: String(raw.pendingPrompt || '').slice(0, 65536),
        pendingPromptQueuedAt: String(raw.pendingPromptQueuedAt || ''),
      };
    }
    return { version: 1, sessions };
  } catch {
    return { version: 1, sessions: {} };
  }
}

function writeManifest(manifest) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    MANIFEST_FILE,
    JSON.stringify({ version: 1, sessions: manifest.sessions || {}, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    { mode: 0o600 }
  );
}

function upsertManifestRecord(manifest, name, patch = {}) {
  const cleanName = manifestRecordName(name);
  if (!cleanName) return null;
  const now = new Date().toISOString();
  const prev = manifest.sessions[cleanName] || { name: cleanName, createdAt: now };
  const next = {
    ...prev,
    ...patch,
    name: cleanName,
    kind: cleanKind(patch.kind || prev.kind),
    title: cleanTitle(patch.title !== undefined ? patch.title : prev.title),
    target: normalizeTarget(patch.target || prev.target, cleanName) || defaultTarget(cleanName),
    updatedAt: now,
  };
  manifest.sessions[cleanName] = next;
  return next;
}

function slotForName(name, slots) {
  const index = slots.indexOf(name);
  return index >= 0 ? index : null;
}

function updateManifestSlot(name, slot) {
  const cleanName = manifestRecordName(name);
  if (!cleanName) return;
  const manifest = readManifest();
  const prev = manifest.sessions[cleanName] || {};
  upsertManifestRecord(manifest, cleanName, {
    ...prev,
    target: prev.target || defaultTarget(cleanName),
    slot,
  });
  writeManifest(manifest);
}

function snapshotPathFor(name) {
  return path.join(SNAPSHOT_DIR, `${name}.txt`);
}

function writePaneSnapshot(name, output) {
  if (!NAME_RE.test(String(name || '')) || !String(output || '').trim()) return '';
  const file = snapshotPathFor(name);
  try {
    const prev = fs.existsSync(file) ? fs.statSync(file) : null;
    if (prev && Date.now() - prev.mtimeMs < 60000) return file;
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${output}\n`, { mode: 0o600 });
    return file;
  } catch {
    return '';
  }
}

function tailFileText(file, bytes = 32768) {
  try {
    const stat = fs.statSync(file);
    if (stat.size <= bytes) return fs.readFileSync(file, 'utf8');
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    fs.readSync(fd, buf, 0, bytes, stat.size - bytes);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    const nl = text.indexOf('\n');
    return nl >= 0 ? text.slice(nl + 1) : text;
  } catch {
    return '';
  }
}

function sqlString(s) {
  return "'" + String(s || '').replace(/'/g, "''") + "'";
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function discoSettingsPath(context) {
  return path.join(context.extensionPath, 'data', 'disco-settings.json');
}

function readDiscoSettings(context, log = () => {}) {
  let raw = {};
  try {
    const file = discoSettingsPath(context);
    if (fs.existsSync(file)) raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    log(`disco settings read failed: ${e && e.message ? e.message : e}`);
  }
  return {
    maskShavePx: clampNumber(raw.maskShavePx, DISCO_SETTINGS_DEFAULTS.maskShavePx, 0, 48),
    scalePct: clampNumber(raw.scalePct, DISCO_SETTINGS_DEFAULTS.scalePct, 60, 180),
    visibleCenterTopPx: clampNumber(raw.visibleCenterTopPx, DISCO_SETTINGS_DEFAULTS.visibleCenterTopPx, 0, 24),
    stringJoinOverlapPx: clampNumber(raw.stringJoinOverlapPx, DISCO_SETTINGS_DEFAULTS.stringJoinOverlapPx, 0, 12),
    refractionOpacityPct: clampNumber(raw.refractionOpacityPct, DISCO_SETTINGS_DEFAULTS.refractionOpacityPct, 0, 100),
    refractionSizeVmax: clampNumber(raw.refractionSizeVmax, DISCO_SETTINGS_DEFAULTS.refractionSizeVmax, 80, 190),
    refractionTurnDeg: clampNumber(raw.refractionTurnDeg, DISCO_SETTINGS_DEFAULTS.refractionTurnDeg, -90, 120),
    hueDeg: clampNumber(raw.hueDeg, DISCO_SETTINGS_DEFAULTS.hueDeg, -180, 180),
    saturationPct: clampNumber(raw.saturationPct, DISCO_SETTINGS_DEFAULTS.saturationPct, 0, 220),
    brightnessPct: clampNumber(raw.brightnessPct, DISCO_SETTINGS_DEFAULTS.brightnessPct, 40, 180),
    spriteLoopDurationMs: clampNumber(raw.spriteLoopDurationMs, DISCO_SETTINGS_DEFAULTS.spriteLoopDurationMs, 400, 6000),
    frameBlend: Boolean(raw.frameBlend),
  };
}

async function sqliteJson(db, sql) {
  if (!fs.existsSync(db)) return [];
  try {
    const out = await exec(SQLITE_BIN, ['-json', db, sql], { timeout: 3000, maxBuffer: 8 * 1024 * 1024 });
    if (!out.trim()) return [];
    const rows = JSON.parse(out);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function readCodexPathMap() {
  const now = Date.now();
  if (now - codexPathCache.at < 15000) return codexPathCache.paths;
  const rows = await sqliteJson(CODEX_STATE_DB,
    'select id, rollout_path from threads where archived = 0 and source = ' + sqlString('cli') +
    ' order by coalesce(recency_at_ms, updated_at_ms, created_at_ms, 0) desc limit 80');
  const paths = new Map();
  for (const r of rows) {
    const id = String(r.id || '');
    const rollout = String(r.rollout_path || '');
    if (SID_RE.test(id) && rollout && fs.existsSync(rollout)) paths.set(id, rollout);
  }
  codexPathCache = { at: now, paths };
  return paths;
}

async function readCodexLockIndex() {
  const now = Date.now();
  if (now - codexLockCache.at < 12000) return codexLockCache.locks;
  const locks = new Map();
  let files = [];
  try {
    files = fs.readdirSync(CODEX_LOCK_DIR)
      .filter((f) => SID_RE.test(f.replace(/\.lock$/, '')) && f.endsWith('.lock'))
      .map((f) => path.join(CODEX_LOCK_DIR, f));
  } catch {
    codexLockCache = { at: now, locks };
    return locks;
  }
  if (!files.length) {
    codexLockCache = { at: now, locks };
    return locks;
  }
  let out = '';
  try {
    out = await exec(LSOF_BIN, ['-nP', '-F', 'pn', ...files], { timeout: 2500, maxBuffer: 512 * 1024 });
  } catch (e) {
    out = e.stdout || '';
  }
  let pid = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1)) || 0;
      continue;
    }
    if (!pid || !line.startsWith('n')) continue;
    const id = path.basename(line.slice(1), '.lock');
    if (SID_RE.test(id)) locks.set(pid, id);
  }
  codexLockCache = { at: now, locks };
  return locks;
}

async function readProcessIndex() {
  const byPid = new Map();
  const children = new Map();
  let out = '';
  try {
    out = await exec('ps', ['-axo', 'pid=', '-o', 'ppid=', '-o', 'command='], { timeout: 2500, maxBuffer: 2 * 1024 * 1024 });
  } catch {
    return { byPid, children };
  }
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const command = m[3] || '';
    byPid.set(pid, { pid, ppid, command });
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  return { byPid, children };
}

function descendantPids(rootPid, procIndex, limit = 30) {
  const root = Number(rootPid);
  if (!root) return [];
  const out = [];
  const queue = [root];
  const seen = new Set();
  while (queue.length && out.length < limit) {
    const pid = queue.shift();
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
    for (const child of procIndex.children.get(pid) || []) queue.push(child);
  }
  return out;
}

function codexThreadForPane(panePid, procIndex, lockIndex) {
  const pids = descendantPids(panePid, procIndex);
  for (const pid of pids) {
    const id = lockIndex.get(pid);
    if (id) return id;
  }
  for (const pid of pids) {
    const command = (procIndex.byPid.get(pid) || {}).command || '';
    if (!/(?:\bcodex\b|^codex_)/i.test(command)) continue;
    const m = command.match(/\bcodex(?:\s+\S+)*\s+resume\s+([0-9a-f-]{36})\b/i) ||
      command.match(/\b([0-9a-f-]{36})\b/i);
    if (m && SID_RE.test(m[1])) return m[1];
  }
  return '';
}

function readCodexSignal(threadId, codexPaths, output) {
  if (!SID_RE.test(threadId || '')) return fallbackCodexSignal(output);
  const file = codexPaths.get(threadId);
  if (!file) return fallbackCodexSignal(output);
  const lines = tailFileText(file, CODEX_TAIL_BYTES).split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const p = e.payload || {};
    const ts = e.timestamp || '';
    if (e.type === 'event_msg' && p.type === 'task_complete') {
      return { state: 'waiting', noticeKind: 'codex-final', noticeKey: `codex:${threadId}:${ts}:task_complete` };
    }
    if (e.type !== 'response_item') continue;
    if (p.type === 'message' && p.role === 'assistant' && p.phase === 'final_answer') {
      return { state: 'waiting', noticeKind: 'codex-final', noticeKey: `codex:${threadId}:${ts}:final_answer` };
    }
    if (p.type === 'function_call' || p.type === 'function_call_output' || p.type === 'reasoning' ||
        (p.type === 'message' && p.role === 'assistant' && p.phase === 'commentary') ||
        (p.type === 'message' && p.role === 'user')) {
      return { state: 'busy', noticeKind: '', noticeKey: '' };
    }
  }
  return fallbackCodexSignal(output);
}

function fallbackCodexSignal(output) {
  const text = String(output || '');
  if (/› Ask Codex to do anything/.test(text) && /─ Worked for /.test(text)) {
    const tail = text.split(/─ Worked for /).slice(-1)[0].slice(0, 500);
    return { state: 'waiting', noticeKind: 'codex-final', noticeKey: `codex:terminal:${tail}` };
  }
  return { state: looksWorkingServer(text) ? 'busy' : 'idle', noticeKind: '', noticeKey: '' };
}

function readAttentionIndex() {
  const map = new Map();
  let files = [];
  try { files = fs.readdirSync(ATTENTION_DIR); } catch { return map; }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const a = JSON.parse(fs.readFileSync(path.join(ATTENTION_DIR, file), 'utf8'));
      if (a && SID_RE.test(a.session_id || '')) map.set(a.session_id, a);
    } catch {}
  }
  return map;
}

function readClaudeSessionRecords() {
  const records = [];
  let files = [];
  try { files = fs.readdirSync(CLAUDE_SESSIONS_DIR); } catch { return records; }
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(CLAUDE_SESSIONS_DIR, file), 'utf8'));
      const name = String(r.tmux || '').split(':')[0];
      if (!NAME_RE.test(name) || !SID_RE.test(r.sessionId || '')) continue;
      records.push({
        ...r,
        tmuxName: name,
        target: parseTmuxEndpoint(r.tmux, ''),
      });
    } catch {}
  }
  return records;
}

function readClaudeSessionIndex(records = null) {
  const map = new Map();
  for (const r of records || readClaudeSessionRecords()) {
    const name = String(r.tmuxName || r.tmux || '').split(':')[0];
    if (!NAME_RE.test(name) || !SID_RE.test(r.sessionId || '')) continue;
    const prev = map.get(name);
    if (!prev || Number(r.updatedAt || 0) > Number(prev.updatedAt || 0)) map.set(name, r);
  }
  return map;
}

function readClaudeSignal(name, titles, claudeIndex, attentionIndex) {
  const record = claudeIndex.get(name) || {};
  const sid = record.sessionId || (titles.get(name) || {}).sid || '';
  if (!SID_RE.test(sid)) return { state: 'idle', noticeKind: '', noticeKey: '' };
  const attention = attentionIndex.get(sid);
  const status = String(record.status || '');
  const activityAt = Number(record.updatedAt || record.statusUpdatedAt || 0);
  const since = Number(attention && attention.since || 0);
  const stillWaiting = attention && (!activityAt || activityAt <= since + WAIT_GRACE_MS || status === 'waiting');
  if (stillWaiting) {
    return {
      state: 'waiting',
      noticeKind: 'claude-attention',
      noticeKey: `claude:${sid}:${since}`,
      attention: { message: String(attention.message || ''), since },
    };
  }
  if (status === 'busy') return { state: 'busy', noticeKind: '', noticeKey: '' };
  return { state: 'idle', noticeKind: '', noticeKey: '' };
}

function looksWorkingServer(output) {
  return /working|thinking|running|reading|editing|searching|building|testing/i
    .test(String(output || '').split('\n').slice(-10).join('\n'));
}

async function listAllSessions() {
  const rows = (await tmux(['list-sessions', '-F', '#{session_name}']))
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'AI-GRID-SERVER');
  const seen = new Set(rows);
  const ordered = PRIORITY.filter((name) => seen.has(name));
  for (const name of rows) {
    if (!ordered.includes(name)) ordered.push(name);
  }
  return ordered;
}

async function listLiveTargetsForSocket(socket = '', options = {}) {
  const sessions = new Set();
  const windows = new Set();
  const panes = new Set();
  const paneTargets = [];
  const label = socketArg(socket);
  try {
    const out = await tmuxSocket(label, ['list-sessions', '-F', '#{session_name}'], { timeout: 2500 });
    for (const row of out.split('\n')) {
      const name = row.trim();
      if (name && name !== 'AI-GRID-SERVER') sessions.add(name);
    }
  } catch {}
  if (options.safeMode || process.env.TERMINALTOWN_RECOVERY_MODE === '1') {
    return { socket: label, sessions, windows, panes, paneTargets };
  }
  try {
    const out = await tmuxSocket(label, ['list-panes', '-a', '-F', '#{session_name}\t#{window_index}\t#{window_id}\t#{window_name}\t#{pane_id}\t#{pane_current_command}\t#{pane_pid}'], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
    for (const row of out.split('\n')) {
      const parts = row.split('\t');
      if (parts.length < 7 || !NAME_RE.test(parts[0] || '')) continue;
      const target = normalizeTarget({
        socket: label,
        session: parts[0],
        window: parts[1],
        windowId: parts[2],
        paneId: parts[4],
      });
      if (!target) continue;
      if (target.windowId) windows.add(target.windowId);
      if (target.window) windows.add(`${target.session}:${target.window}`);
      panes.add(parts[4]);
      paneTargets.push({
        target,
        windowName: parts[3] || '',
        cwd: '',
        command: parts[5] || '',
        panePid: Number(parts[6]) || 0,
      });
    }
  } catch {}
  return { socket: label, sessions, windows, panes, paneTargets };
}

async function readLiveTargets(manifest = null, options = {}) {
  const sockets = new Set(TMUX_SOCKET_NAMES);
  sockets.add('default');
  for (const record of Object.values((manifest && manifest.sessions) || {})) {
    if (record.target && record.target.socket) sockets.add(record.target.socket);
  }
  const bySocket = new Map();
  for (const socket of sockets) {
    const live = await listLiveTargetsForSocket(socket, options);
    bySocket.set(socketLabel(socketArg(socket)), live);
  }
  return bySocket;
}

function liveSocket(liveTargets, socket = '') {
  return liveTargets.get(socketLabel(socketArg(socket))) || { sessions: new Set(), windows: new Set(), panes: new Set(), paneTargets: [] };
}

function targetIsLive(target, liveTargets) {
  const t = normalizeTarget(target);
  if (!t) return false;
  const live = liveSocket(liveTargets, t.socket);
  if (t.paneId && live.panes.has(t.paneId)) return true;
  if (t.paneId) return false;
  if (t.windowId && live.windows.has(t.windowId)) return true;
  if (t.windowId) return false;
  if (t.window && live.windows.has(`${t.session}:${t.window}`)) return true;
  if (t.window) return false;
  return live.sessions.has(t.session);
}

function findLivePaneByPid(liveTargets, panePid) {
  const pid = Number(panePid);
  if (!pid) return null;
  for (const live of liveTargets.values()) {
    const found = live.paneTargets.find((pane) => Number(pane.panePid) === pid);
    if (found) return found;
  }
  return null;
}

function findLivePaneByTarget(liveTargets, target) {
  const t = normalizeTarget(target);
  if (!t) return null;
  const live = liveSocket(liveTargets, t.socket);
  if (t.paneId) return live.paneTargets.find((pane) => pane.target.paneId === t.paneId) || null;
  if (t.windowId) return live.paneTargets.find((pane) => pane.target.windowId === t.windowId) || null;
  if (t.window) return live.paneTargets.find((pane) => pane.target.session === t.session && pane.target.window === t.window) || null;
  return live.paneTargets.find((pane) => pane.target.session === t.session) || null;
}

function findLiveSessionTarget(liveTargets, name) {
  if (!NAME_RE.test(String(name || ''))) return null;
  const hits = [];
  for (const live of liveTargets.values()) {
    if (live.sessions.has(name)) hits.push(normalizeTarget({ socket: live.socket, session: name }, name));
  }
  if (!hits.length) return null;
  return hits.find((target) => !target.socket) || hits[0];
}

function allLiveSessionNames(liveTargets) {
  const names = [];
  for (const live of liveTargets.values()) {
    for (const name of live.sessions) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

function cleanSpanMap(slots, spans) {
  const placed = new Set(slots.filter(Boolean));
  const clean = {};
  if (!spans || typeof spans !== 'object') return clean;
  for (const [name, span] of Object.entries(spans)) {
    if (placed.has(name) && Number(span) === 2) clean[name] = 2;
  }
  return clean;
}

function normalizeCaptureLineHints(value, slotCount) {
  const hints = new Map();
  if (!value || typeof value !== 'object') return hints;
  for (const [rawSlot, rawLines] of Object.entries(value)) {
    const slot = Number(rawSlot);
    const lines = Math.round(Number(rawLines));
    if (!Number.isInteger(slot) || slot < 0 || slot >= slotCount) continue;
    if (!Number.isFinite(lines) || lines < 1) continue;
    hints.set(slot, clampNumber(lines, CAPTURE_LINES, CAPTURE_LINES, MAX_CAPTURE_LINES));
  }
  return hints;
}

function normalizeTerminalSizeHints(value, slotCount) {
  const hints = new Map();
  if (!value || typeof value !== 'object') return hints;
  for (const [rawSlot, rawSize] of Object.entries(value)) {
    const slot = Number(rawSlot);
    const cols = Math.round(Number(rawSize && rawSize.cols));
    const rows = Math.round(Number(rawSize && rawSize.rows));
    if (!Number.isInteger(slot) || slot < 0 || slot >= slotCount) continue;
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) continue;
    hints.set(slot, {
      cols: clampNumber(cols, MIN_TERMINAL_COLS, MIN_TERMINAL_COLS, MAX_TERMINAL_COLS),
      rows: clampNumber(rows, MIN_TERMINAL_ROWS, MIN_TERMINAL_ROWS, MAX_TERMINAL_ROWS),
    });
  }
  return hints;
}

function readLayoutState(allSessions, board = {}) {
  const ctx = boardContext(board);
  let saved = [];
  let spans = {};
  let grid = { ...DEFAULT_GRID };
  let title = ctx.title;
  let hasSaved = false;
  try {
    const source = fs.existsSync(ctx.layoutFile) ? ctx.layoutFile : ctx.legacyLayoutFile;
    const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
    if (Array.isArray(parsed.slots)) {
      saved = parsed.slots;
      hasSaved = true;
    }
    if (parsed.spans && typeof parsed.spans === 'object') spans = parsed.spans;
    if (parsed.grid && typeof parsed.grid === 'object') grid = normalizeGrid(parsed.grid);
    else grid = normalizeGrid({ columns: Number(parsed.columns), rows: Number(parsed.rows) });
    title = cleanBoardTitle(parsed.boardTitle || parsed.title || title, ctx.id);
  } catch {}

  grid = normalizeGrid(grid);
  const used = new Set();
  const slots = Array.from({ length: grid.slotCount }, (_, i) => {
    const name = typeof saved[i] === 'string' ? saved[i] : '';
    if (!name || used.has(name)) return '';
    used.add(name);
    return name;
  });

  if (hasSaved || !ctx.isDefault) return { boardId: ctx.id, boardTitle: title, grid, slots, spans: cleanSpanMap(slots, spans) };

  for (const name of allSessions) {
    if (used.has(name)) continue;
    const open = slots.indexOf('');
    if (open === -1) break;
    slots[open] = name;
    used.add(name);
  }
  return { boardId: ctx.id, boardTitle: title, grid, slots, spans: {} };
}

function readLayout(allSessions, board = {}) {
  return readLayoutState(allSessions, board).slots;
}

function writeLayoutState(state, board = {}) {
  const ctx = boardContext({ ...board, boardId: state.boardId || (typeof board === 'object' ? board.boardId : board), boardTitle: state.boardTitle || (typeof board === 'object' ? board.boardTitle : '') });
  const grid = normalizeGrid(state.grid || {});
  const slots = Array.from({ length: grid.slotCount }, (_, i) => typeof state.slots[i] === 'string' ? state.slots[i] : '');
  const spans = cleanSpanMap(slots, state.spans);
  fs.mkdirSync(ctx.isDefault ? DATA_DIR : BOARDS_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    ctx.layoutFile,
    JSON.stringify({
      boardId: ctx.id,
      boardTitle: cleanBoardTitle(state.boardTitle || ctx.title, ctx.id),
      grid: { columns: grid.columns, rows: grid.rows },
      slots,
      spans,
      updatedAt: new Date().toISOString(),
    }, null, 2),
    { mode: 0o600 }
  );
}

function writeLayout(slots, spans = {}, board = {}) {
  writeLayoutState({ ...readLayoutState([], board), slots, spans }, board);
}

function readTitleRecords() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TITLES_FILE, 'utf8'));
    return Array.isArray(parsed.titles) ? parsed.titles.filter((r) => r && NAME_RE.test(r.tmux || '')) : [];
  } catch {
    return [];
  }
}

function titleMap() {
  const map = new Map();
  for (const record of readTitleRecords()) {
    const title = cleanTitle(record.title);
    if (title) map.set(record.tmux, { ...record, title });
  }
  return map;
}

function writeTitleRecords(records) {
  fs.mkdirSync(SUMMON_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    TITLES_FILE,
    JSON.stringify({ titles: records, host: os.hostname().split('.')[0], at: Date.now() }, null, 2),
    { mode: 0o600 }
  );
}

function queueLiveRename(sid, title) {
  if (!/^[0-9a-f-]{36}$/i.test(String(sid || ''))) return;
  fs.mkdirSync(SUMMON_DIR, { recursive: true, mode: 0o700 });
  fs.appendFileSync(
    SUMMON_QUEUE,
    JSON.stringify({ sid, rename: title, ts: Date.now() }) + '\n',
    { mode: 0o600 }
  );
}

async function renameSessionLabel(session, title) {
  if (!NAME_RE.test(session)) throw new Error('bad session');
  const clean = cleanTitle(title);
  if (!clean) throw new Error('rename needs a non-empty title');
  const records = readTitleRecords();
  const kept = records.filter((r) => r.tmux !== session);
  const old = records.find((r) => r.tmux === session) || {};
  const next = {
    ...old,
    tmux: session,
    title: clean,
    source: 'manual',
  };
  kept.push(next);
  kept.sort((a, b) => String(a.tmux).localeCompare(String(b.tmux)));
  writeTitleRecords(kept);
  queueLiveRename(next.sid, clean);
  const manifest = readManifest();
  const record = manifest.sessions[session];
  if (record) {
    upsertManifestRecord(manifest, session, { ...record, title: clean });
    writeManifest(manifest);
  }
  return clean;
}

function kebab(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'session';
}

function normalizeProjectPath(p) { return path.resolve(String(p || PROJECT_ROOT)); }

function parseJsonWithComments(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const clean = raw
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  return JSON.parse(clean);
}

function presetSessions() { return []; }

async function exactSessionExists(name) {
  if (!NAME_RE.test(name)) return false;
  const rows = (await tmux(['list-sessions', '-F', '#{session_name}']).catch(() => ''))
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return rows.includes(name);
}

async function uniqueSessionName(base) {
  let name = kebab(base);
  if (!NAME_RE.test(name)) name = 'session';
  let candidate = name;
  let n = 2;
  while (await exactSessionExists(candidate)) {
    candidate = `${name}-${n}`;
    n += 1;
  }
  return candidate;
}

async function placeNewSession(name, placement, board = {}) {
  const allSessions = await listAllSessions();
  const state = readLayoutState(allSessions, board);
  const { slots, spans } = state;
  for (let i = 0; i < slots.length; i += 1) {
    if (slots[i] === name) slots[i] = '';
  }
  delete spans[name];
  if (placement === 'holding') {
    writeLayoutState(state, board);
    return;
  }
  let slot = Number(placement);
  if (!Number.isInteger(slot) || slot < 0 || slot >= slots.length) {
    slot = slots.findIndex((s) => !s);
  }
  if (slot >= 0) slots[slot] = name;
  writeLayoutState(state, board);
}

async function createAiSession({ session, cwd, command, initialPrompt, placement, title, board }) {
  if (!NAME_RE.test(session)) throw new Error('Session names can use only letters, numbers, dot, underscore, and dash.');
  if (await exactSessionExists(session)) throw new Error(`${session} already exists`);
  const ctx = boardContext(board);
  const dir = normalizeProjectPath(cwd || PROJECT_ROOT);
  if (!fs.existsSync(dir)) throw new Error(`Directory does not exist: ${dir}`);
  const launchCommand = normalizeCodexLaunchCommand(command);
  await tmux(['new-session', '-d', '-s', session, '-c', dir], { timeout: 5000 });
  await tmux(['send-keys', '-t', `=${session}:`, launchCommand, 'Enter'], { timeout: 5000 });
  if (cleanTitle(title)) await renameSessionLabel(session, title);
  await placeNewSession(session, placement, board);
  const placedState = readLayoutState(await listAllSessions(), board);
  const manifest = readManifest();
  const patch = {
    kind: kindForCommand(launchCommand),
    title: cleanTitle(title) || session,
    cwd: dir,
    command: launchCommand,
    target: defaultTarget(session),
    lastSeenAt: new Date().toISOString(),
  };
  const pendingPrompt = String(initialPrompt || '').trim();
  if (pendingPrompt) {
    patch.pendingPrompt = pendingPrompt;
    patch.pendingPromptQueuedAt = new Date().toISOString();
  }
  if (ctx.isDefault) patch.slot = slotForName(session, placedState.slots);
  upsertManifestRecord(manifest, session, patch);
  writeManifest(manifest);
  if (pendingPrompt) schedulePendingPromptDelivery(session);
  return session;
}

function codexPromptReady(output) {
  return /Ask Codex to do anything/i.test(String(output || ''));
}

function schedulePendingPromptDelivery(name) {
  if (!NAME_RE.test(String(name || '')) || pendingPromptDeliveries.has(name)) return;
  setTimeout(() => deliverPendingPrompt(name).catch(() => {}), 0);
}

async function deliverPendingPrompt(name) {
  if (!NAME_RE.test(String(name || '')) || pendingPromptDeliveries.has(name)) return false;
  pendingPromptDeliveries.add(name);
  try {
    const deadline = Date.now() + INITIAL_PROMPT_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const manifest = readManifest();
      const record = manifest.sessions[name];
      const prompt = String(record && record.pendingPrompt || '').trim();
      if (!record || !prompt) return true;
      const target = normalizeTarget(record.target, name) || defaultTarget(name);
      let output = '';
      try {
        output = await tmuxSocket(target.socket, ['capture-pane', '-pt', targetSpec(target), '-S', '-80'], { timeout: 2500 });
      } catch {}
      const kind = record.kind === 'unknown' ? kindForCommand(record.command) : record.kind;
      if (kind !== 'codex' || codexPromptReady(output)) {
        await sendPrompt(name, prompt);
        const latest = readManifest();
        const current = latest.sessions[name];
        if (current && current.pendingPrompt === prompt) {
          upsertManifestRecord(latest, name, { ...current, pendingPrompt: '', pendingPromptQueuedAt: '' });
          writeManifest(latest);
        }
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, INITIAL_PROMPT_POLL_MS));
    }
    return false;
  } finally {
    pendingPromptDeliveries.delete(name);
  }
}

function schedulePendingPromptSweep(manifest) {
  for (const [name, record] of Object.entries((manifest && manifest.sessions) || {})) {
    if (String(record.pendingPrompt || '').trim()) schedulePendingPromptDelivery(name);
  }
}

async function byeSession(session, board = {}) {
  if (!NAME_RE.test(session)) throw new Error('bad session');
  await tmux(['kill-session', '-t', `=${session}`], { timeout: 3000 });
  const allSessions = await listAllSessions();
  const state = readLayoutState(allSessions, board);
  state.slots = state.slots.map((name) => (name === session ? '' : name));
  delete state.spans[session];
  writeLayoutState(state, board);
  const manifest = readManifest();
  if (manifest.sessions[session]) {
    delete manifest.sessions[session];
    writeManifest(manifest);
  }
}

async function assignSlot(slot, session, board = {}) {
  const ctx = boardContext(board);
  const allSessions = await listKnownSessions();
  session = canonicalSessionName(session, allSessions);
  const existing = new Set(allSessions);
  const state = readLayoutState(allSessions, board);
  if (!Number.isInteger(slot) || slot < 0 || slot >= state.slots.length) throw new Error(`slot must be 0-${state.slots.length - 1}`);
  if (session && !existing.has(session)) throw new Error(`unknown session: ${session}`);
  const { slots, spans } = state;
  const displaced = slots[slot];
  if (displaced && displaced !== session) delete spans[displaced];
  for (let i = 0; i < slots.length; i += 1) {
    if (slots[i] === session) slots[i] = '';
  }
  if (session) delete spans[session];
  slots[slot] = session || '';
  writeLayoutState(state, board);
  if (ctx.isDefault && displaced && displaced !== session) updateManifestSlot(displaced, null);
  if (ctx.isDefault && session) updateManifestSlot(session, slot);
}

async function moveSlot(fromSlot, toSlot, session, board = {}) {
  const ctx = boardContext(board);
  const allSessions = await listKnownSessions();
  session = canonicalSessionName(session, allSessions);
  const existing = new Set(allSessions);
  const state = readLayoutState(allSessions, board);
  if (!Number.isInteger(toSlot) || toSlot < 0 || toSlot >= state.slots.length) throw new Error(`target slot must be 0-${state.slots.length - 1}`);
  const { slots, spans } = state;

  if (Number.isInteger(fromSlot) && fromSlot >= 0 && fromSlot < slots.length) {
    const moving = slots[fromSlot];
    if (!moving) return;
    const displaced = slots[toSlot];
    slots[toSlot] = moving;
    slots[fromSlot] = fromSlot === toSlot ? moving : displaced || '';
    delete spans[moving];
    if (displaced) delete spans[displaced];
    writeLayoutState(state, board);
    if (ctx.isDefault) {
      updateManifestSlot(moving, toSlot);
      if (displaced) updateManifestSlot(displaced, fromSlot === toSlot ? toSlot : fromSlot);
    }
    return;
  }

  if (!session || !existing.has(session)) throw new Error(`unknown session: ${session}`);
  for (let i = 0; i < slots.length; i += 1) {
    if (slots[i] === session) slots[i] = '';
  }
  const displaced = slots[toSlot];
  if (displaced) delete spans[displaced];
  delete spans[session];
  slots[toSlot] = session;
  writeLayoutState(state, board);
  if (ctx.isDefault && displaced) updateManifestSlot(displaced, null);
  if (ctx.isDefault) updateManifestSlot(session, toSlot);
}

async function resizeSlot(slot, direction, columns, span, board = {}) {
  const allSessions = await listAllSessions();
  const state = readLayoutState(allSessions, board);
  const { slots, spans } = state;
  const cols = Number(columns);
  if (!Number.isInteger(slot) || slot < 0 || slot >= slots.length) throw new Error(`slot must be 0-${slots.length - 1}`);
  if (!Number.isInteger(cols) || cols < 1 || cols > 6) throw new Error('bad grid width');
  const session = slots[slot];
  if (!session) throw new Error('empty slot cannot be resized');

  if (Number(span) !== 2) {
    delete spans[session];
    writeLayoutState(state, board);
    return { session, span: 1 };
  }

  const neighbor = direction === 'up' ? slot - cols : direction === 'down' ? slot + cols : -1;
  if (neighbor < 0 || neighbor >= slots.length) throw new Error(`No ${direction === 'up' ? 'upper' : 'lower'} slot to span into.`);

  if (direction === 'up') {
    const displaced = slots[neighbor];
    if (displaced && displaced !== session) delete spans[displaced];
    slots[slot] = '';
    slots[neighbor] = session;
  } else {
    const displaced = slots[neighbor];
    if (displaced && displaced !== session) delete spans[displaced];
    slots[neighbor] = '';
  }
  spans[session] = 2;
  writeLayoutState(state, board);
  return { session, span: 2 };
}

async function resetSlots(board = {}) {
  const allSessions = await listAllSessions();
  const state = readLayoutState(allSessions, board);
  writeLayout(allSessions.slice(0, state.grid.slotCount), {}, board);
}

async function setGridShape(columns, rows, board = {}) {
  const allSessions = await listAllSessions();
  const state = readLayoutState(allSessions, board);
  const nextGrid = normalizeGrid({ columns, rows });
  const nextSlots = Array.from({ length: nextGrid.slotCount }, (_, i) => state.slots[i] || '');
  const seen = new Set();
  for (let i = 0; i < nextSlots.length; i += 1) {
    if (!nextSlots[i] || seen.has(nextSlots[i])) nextSlots[i] = '';
    else seen.add(nextSlots[i]);
  }
  writeLayoutState({ ...state, grid: nextGrid, slots: nextSlots }, board);
  return nextGrid;
}

function titleRecordsBySid(records = readTitleRecords()) {
  const map = new Map();
  for (const record of records) {
    const sid = String(record.sid || '');
    if (!SID_RE.test(sid)) continue;
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid).push(record);
  }
  return map;
}

function titleRecordForName(name, records = readTitleRecords()) {
  return records.find((record) => record.tmux === name) || null;
}

function claudeBySid(records) {
  const map = new Map();
  for (const record of records || []) {
    const sid = String(record.sessionId || '');
    if (!SID_RE.test(sid)) continue;
    const prev = map.get(sid);
    if (!prev || Number(record.updatedAt || 0) > Number(prev.updatedAt || 0)) map.set(sid, record);
  }
  return map;
}

function liveClaudeRecordBySid(records, liveTargets, sid) {
  if (!SID_RE.test(String(sid || ''))) return null;
  const matches = (records || [])
    .filter((record) => record.sessionId === sid && record.target && targetIsLive(record.target, liveTargets))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  return matches[0] || null;
}

function recordNameForClaude(record, titleBySid, existingNames, savedSlots = []) {
  const sid = String(record.sessionId || '');
  const titleRecords = titleBySid.get(sid) || [];
  const existing = titleRecords.find((item) => existingNames.has(item.tmux));
  if (existing && NAME_RE.test(existing.tmux)) return existing.tmux;
  const cwdBase = path.basename(String(record.cwd || ''));
  const cwdSlot = savedSlots.find((name) => name === cwdBase);
  if (cwdSlot) return cwdSlot;
  const inactive = titleRecords.find((item) => NAME_RE.test(item.tmux) && item.tmux !== record.tmuxName);
  if (inactive) return inactive.tmux;
  if (NAME_RE.test(record.windowName || '') && !savedSlots.includes(record.windowName)) return record.windowName;
  if (NAME_RE.test(record.tmuxName || '') && record.tmuxName !== 'fleet') return record.tmuxName;
  return `claude-${sid.slice(0, 8)}`;
}

function adoptLiveClaudeRecords(manifest, slots, titles, claudeRecords, liveTargets, options = {}) {
  let changed = 0;
  const writeSlots = options.writeSlots !== false;
  const titleRecords = readTitleRecords();
  const bySid = titleRecordsBySid(titleRecords);
  const existingNames = new Set([...slots.filter(Boolean), ...Object.keys(manifest.sessions)]);

  for (const record of claudeRecords) {
    if (!record.target || !targetIsLive(record.target, liveTargets)) continue;
    const livePane = findLivePaneByTarget(liveTargets, record.target) || {};
    if (livePane.windowName) record.windowName = livePane.windowName;
    const existingBySid = Object.entries(manifest.sessions)
      .find(([, item]) => item && item.resumeId === record.sessionId);
    const name = existingBySid
      ? existingBySid[0]
      : recordNameForClaude(record, bySid, existingNames, slots);
    if (!NAME_RE.test(name)) continue;
    const titleRecord = titleRecordForName(name, titleRecords);
    const prev = manifest.sessions[name];
    const title = cleanTitle((prev && prev.title) || (titleRecord && titleRecord.title) || titles.get(name)?.title || record.title || record.windowName || name);
    const now = Date.now();
    const prevSeen = Date.parse(prev && prev.lastSeenAt || '') || 0;
    const patch = {
      kind: 'claude',
      title,
      cwd: record.cwd || livePane.cwd || '',
      command: `claude --resume ${record.sessionId}`,
      resumeId: record.sessionId,
      threadId: '',
      target: record.target,
      lastSeenAt: now - prevSeen > 60000 ? new Date(now).toISOString() : prev && prev.lastSeenAt || '',
    };
    if (writeSlots) patch.slot = slotForName(name, slots);
    const material = !prev ||
      patch.kind !== prev.kind ||
      patch.title !== prev.title ||
      patch.cwd !== prev.cwd ||
      patch.command !== prev.command ||
      patch.resumeId !== prev.resumeId ||
      patch.threadId !== prev.threadId ||
      (writeSlots && patch.slot !== prev.slot) ||
      JSON.stringify(patch.target || null) !== JSON.stringify(prev.target || null);
    if (material) {
      upsertManifestRecord(manifest, name, patch);
      changed += 1;
    }
    existingNames.add(name);
  }
  return changed;
}

function mergeSessionNames(liveSessionNames, manifest, liveTargets) {
  const names = [];
  const add = (name) => {
    if (NAME_RE.test(String(name || '')) && !names.includes(name)) names.push(name);
  };
  for (const name of PRIORITY) add(name);
  for (const name of liveSessionNames) add(name);
  for (const [name, record] of Object.entries(manifest.sessions || {})) {
    if (targetIsLive(record.target || defaultTarget(name), liveTargets) || recordCanRecover(record)) add(name);
  }
  return names.filter((name) => liveSessionNames.includes(name) || (manifest.sessions[name] && (targetIsLive(manifest.sessions[name].target, liveTargets) || recordCanRecover(manifest.sessions[name]))));
}

function recordCanRecover(record) {
  return Boolean(record && (record.resumeId || record.threadId || record.command));
}

function restoreManifestSlots(state, manifest, liveTargets) {
  if (!state || !manifest || !manifest.sessions) return { state, changed: false };
  const slots = [...state.slots];
  const used = new Set(slots.filter(Boolean));
  let changed = false;
  const records = Object.entries(manifest.sessions)
    .filter(([name, record]) => NAME_RE.test(String(name || '')) && Number.isInteger(record.slot))
    .sort((a, b) => Number(a[1].slot) - Number(b[1].slot));

  for (const [name, record] of records) {
    const slot = Number(record.slot);
    if (slot < 0 || slot >= slots.length) continue;
    if (used.has(name) || slots[slot]) continue;
    if (!targetIsLive(record.target || defaultTarget(name), liveTargets) && !recordCanRecover(record)) continue;
    slots[slot] = name;
    used.add(name);
    changed = true;
  }

  return changed ? { state: { ...state, slots }, changed } : { state, changed: false };
}

async function listKnownSessions() {
  const manifest = readManifest();
  const liveTargets = await readLiveTargets(manifest);
  return mergeSessionNames(allLiveSessionNames(liveTargets), manifest, liveTargets);
}

function canonicalSessionName(session, knownSessions = []) {
  const value = String(session || '');
  if (!value) return '';
  if (knownSessions.includes(value)) return value;
  const lower = value.toLowerCase();
  return knownSessions.find((name) => name.toLowerCase() === lower) || value;
}

async function spawnRecoveredSession(name, record) {
  if (!NAME_RE.test(name)) throw new Error(`bad session name: ${name}`);
  if (await exactSessionExists(name)) throw new Error(`${name} already exists`);
  const cwd = normalizeProjectPath(record.cwd || PROJECT_ROOT);
  if (!fs.existsSync(cwd)) throw new Error(`Directory does not exist: ${cwd}`);
  let command = String(record.command || '').trim();
  if (record.kind === 'claude' && SID_RE.test(record.resumeId || '')) {
    command = `claude --resume ${record.resumeId}`;
  } else if (record.kind === 'codex' && SID_RE.test(record.threadId || '')) {
    command = codexDefaultCommand(`resume ${record.threadId}`);
  }
  if (!command) throw new Error(`${name} has no recovery command`);
  await tmux(['new-session', '-d', '-s', name, '-c', cwd], { timeout: 5000 });
  await tmux(['send-keys', '-t', `=${name}:`, command, 'Enter'], { timeout: 5000 });
  return defaultTarget(name);
}

function agentResumeCommand(record) {
  if (record && record.kind === 'claude' && SID_RE.test(record.resumeId || '')) {
    return `claude --resume ${record.resumeId}`;
  }
  if (record && record.kind === 'codex' && SID_RE.test(record.threadId || '')) {
    return codexDefaultCommand(`resume ${record.threadId}`);
  }
  return '';
}

async function reviveExitedAiSessions(sessions, manifest) {
  const now = Date.now();
  for (const session of sessions || []) {
    const record = manifest.sessions && manifest.sessions[session.name];
    const command = agentResumeCommand(record);
    const paneCommand = String(session.command || '').trim().toLowerCase();
    if (!command || Number(session.clients || 0) > 0 || !/^(?:zsh|bash|sh|fish)$/.test(paneCommand)) continue;
    if (now - (agentRestartAttempts.get(session.name) || 0) < AGENT_RESTART_COOLDOWN_MS) continue;
    const target = normalizeTarget(session.targetRaw || record.target, session.name);
    if (!target) continue;
    agentRestartAttempts.set(session.name, now);
    try {
      await tmuxSocket(target.socket, ['send-keys', '-t', targetSpec(target), command, 'Enter'], { timeout: 5000 });
    } catch {}
  }
}

async function recoverMissingSessions(options = {}) {
  const board = boardContext(options);
  const manifest = readManifest();
  const liveTargets = await readLiveTargets(manifest);
  const liveNames = allLiveSessionNames(liveTargets);
  const restoredLayout = board.isDefault
    ? restoreManifestSlots(readLayoutState(liveNames, board), manifest, liveTargets)
    : { state: readLayoutState(liveNames, board), changed: false };
  const { slots } = restoredLayout.state;
  if (restoredLayout.changed) writeLayoutState(restoredLayout.state, board);
  const titleRecords = readTitleRecords();
  const titles = titleMap();
  const claudeRecords = readClaudeSessionRecords();
  const byClaudeSid = claudeBySid(claudeRecords);
  const result = { indexed: 0, adopted: 0, spawned: 0, skipped: 0, errors: [] };
  result.indexed = adoptLiveClaudeRecords(manifest, slots, titles, claudeRecords, liveTargets, { writeSlots: board.isDefault });

  for (const name of slots.filter(Boolean)) {
    const current = manifest.sessions[name];
    if (current && targetIsLive(current.target || defaultTarget(name), liveTargets)) continue;
    const titleRecord = titleRecords.find((record) => record.tmux === name) || {};
    const resumeId = current && current.resumeId || titleRecord.sid || '';
    const title = cleanTitle((current && current.title) || titleRecord.title || name);
    const liveClaude = liveClaudeRecordBySid(claudeRecords, liveTargets, resumeId);
    if (liveClaude) {
      const livePane = findLivePaneByTarget(liveTargets, liveClaude.target) || {};
      upsertManifestRecord(manifest, name, {
        kind: 'claude',
        title,
        cwd: liveClaude.cwd || livePane.cwd || (current && current.cwd) || PROJECT_ROOT,
        command: `claude --resume ${resumeId}`,
        resumeId,
        target: liveClaude.target,
        ...(board.isDefault ? { slot: slotForName(name, slots) } : {}),
        lastSeenAt: new Date().toISOString(),
      });
      result.adopted += 1;
      continue;
    }

    const fallbackClaude = byClaudeSid.get(resumeId);
    const recoveryRecord = current || (SID_RE.test(resumeId) ? {
      kind: 'claude',
      title,
      cwd: fallbackClaude && fallbackClaude.cwd || PROJECT_ROOT,
      resumeId,
      command: `claude --resume ${resumeId}`,
    } : null);
    if (!recoveryRecord || (!recoveryRecord.resumeId && !recoveryRecord.threadId && !recoveryRecord.command)) {
      result.skipped += 1;
      continue;
    }
    try {
      const target = await spawnRecoveredSession(name, recoveryRecord);
      upsertManifestRecord(manifest, name, {
        ...recoveryRecord,
        title,
        target,
        ...(board.isDefault ? { slot: slotForName(name, slots) } : {}),
        lastSeenAt: new Date().toISOString(),
      });
      result.spawned += 1;
    } catch (e) {
      result.errors.push(`${name}: ${e.message}`);
    }
  }

  writeManifest(manifest);
  return result;
}

function collapseWarning(slots, sessions, allSessions) {
  const expected = slots.filter(Boolean).length;
  const missing = sessions.filter((session) => session.missing).length;
  const live = allSessions.length;
  if (expected >= 6 && missing >= 3 && live <= Math.max(3, Math.ceil(expected / 2))) {
    return `${missing} of ${expected} saved slots are missing. A tmux server may have restarted; use Recover before creating duplicates.`;
  }
  if (missing > 0) return `${missing} saved slot${missing === 1 ? ' is' : 's are'} missing.`;
  return '';
}

function recoverySnapshot(name, slot, spans = {}, signalContext = {}) {
  if (!name) {
    return { slot, rowSpan: 1, name: '', title: '', display: '', command: '', clients: '0', output: '', state: 'idle', noticeKey: '', noticeKind: '', empty: true };
  }
  const manifestRecord = signalContext.manifest && signalContext.manifest.sessions && signalContext.manifest.sessions[name] || null;
  const title = manifestRecord && manifestRecord.title || '';
  const liveTargets = signalContext.liveTargets || new Map();
  const target = manifestRecord && normalizeTarget(manifestRecord.target, name) ||
    findLiveSessionTarget(liveTargets, name) ||
    defaultTarget(name);
  const live = targetIsLive(target, liveTargets);
  return {
    slot,
    rowSpan: spans[name] === 2 ? 2 : 1,
    name,
    title,
    display: title || name,
    command: live ? 'recovery-mode' : 'missing',
    clients: '0',
    output: live
      ? 'Recovery mode: pane output and live cwd capture are disabled to avoid blocked removable-volume reads.'
      : `tmux target "${targetLabel(target) || name}" is not running.`,
    state: live ? 'idle' : 'missing',
    noticeKey: '',
    noticeKind: '',
    attention: null,
    target: targetLabel(target),
    targetRaw: target,
    threadId: manifestRecord && manifestRecord.threadId || '',
    resumeId: manifestRecord && manifestRecord.resumeId || '',
    missing: !live,
  };
}

async function resizeTerminal(target, size) {
  if (!size) return;
  const key = targetLabel(target);
  const previous = terminalSizeCache.get(key);
  if (previous && previous.cols === size.cols && previous.rows === size.rows) return;
  await tmuxSocket(target.socket, ['resize-window', '-t', targetSpec(target), '-x', String(size.cols), '-y', String(size.rows)], { timeout: 3000 });
  terminalSizeCache.set(key, size);
}

async function snapshot(name, slot, titles = new Map(), spans = {}, signalContext = {}) {
  if (!name) {
    return { slot, rowSpan: 1, name: '', title: '', display: '', command: '', clients: '0', output: '', state: 'idle', noticeKey: '', noticeKind: '', empty: true };
  }
  const manifestRecord = signalContext.manifest && signalContext.manifest.sessions && signalContext.manifest.sessions[name] || null;
  const title = (titles.get(name) || {}).title || (manifestRecord && manifestRecord.title) || '';
  const liveTargets = signalContext.liveTargets || new Map();
  const savedTarget = manifestRecord && normalizeTarget(manifestRecord.target, name);
  const target = savedTarget ||
    findLiveSessionTarget(liveTargets, name) ||
    defaultTarget(name);
  if (!targetIsLive(target, liveTargets)) {
    const lastSnapshot = snapshotPathFor(name);
    const lastOutput = fs.existsSync(lastSnapshot) ? `\n\nLast saved snapshot:\n${tailFileText(lastSnapshot, 16384)}` : '';
    return {
      slot,
      rowSpan: spans[name] === 2 ? 2 : 1,
      name,
      title,
      display: title || name,
      command: 'missing',
      clients: '0',
      output: `tmux target "${targetLabel(target) || name}" is not running.\n\nThe slot assignment is still saved. Use Recover to adopt a live resume or restart from the manifest before creating a duplicate.${lastOutput}`,
      state: 'missing',
      noticeKey: '',
      noticeKind: '',
      missing: true,
      target: targetLabel(target),
    };
  }
  let command = '';
  let panePid = 0;
  let cwd = '';
  let clients = '0';
  let output = '';
  let rawOutput = '';
  try {
    const pane = (await tmuxSocket(target.socket, ['list-panes', '-t', targetSpec(target), '-F', '#{pane_current_command}\t#{pane_pid}']))
      .split('\n')[0] || '';
    const parts = pane.split('\t');
    command = parts[0] || '';
    panePid = Number(parts[1]) || 0;
    cwd = manifestRecord && manifestRecord.cwd || '';
  } catch {}
  try {
    clients = String((await tmuxSocket(target.socket, ['list-clients', '-t', sessionSpec(target), '-F', '#{client_tty}']))
      .split('\n')
      .filter(Boolean)
      .length);
  } catch {}
  try {
    await resizeTerminal(target, signalContext.terminalSizesBySlot && signalContext.terminalSizesBySlot.get(slot));
  } catch {}
  try {
    const captureLines = Number(signalContext.captureLinesBySlot && signalContext.captureLinesBySlot.get(slot)) || CAPTURE_LINES;
    rawOutput = cleanText(await tmuxSocket(target.socket, ['capture-pane', '-p', '-J', '-t', targetSpec(target), '-S', `-${captureLines}`], { timeout: 2500 }));
    writePaneSnapshot(name, rawOutput);
  } catch {
    rawOutput = `(could not capture ${name})`;
  }
  let signal = { state: looksWorkingServer(rawOutput) ? 'busy' : 'idle', noticeKey: '', noticeKind: '' };
  let threadId = '';
  let resumeId = manifestRecord && manifestRecord.resumeId || '';
  if (/(?:\bcodex\b|^codex_)/i.test(command) || codexThreadForPane(panePid, signalContext.procIndex || { byPid: new Map(), children: new Map() }, signalContext.codexLocks || new Map())) {
    threadId = codexThreadForPane(panePid, signalContext.procIndex || { byPid: new Map(), children: new Map() }, signalContext.codexLocks || new Map());
    signal = readCodexSignal(threadId, signalContext.codexPaths || new Map(), rawOutput);
  } else {
    const claudeRecord = manifestRecord && manifestRecord.resumeId ? (signalContext.claudeBySid || new Map()).get(manifestRecord.resumeId) : null;
    if (claudeRecord && claudeRecord.sessionId) resumeId = claudeRecord.sessionId;
    const claude = claudeRecord
      ? readClaudeSignal(claudeRecord.tmuxName || name, titles, new Map([[claudeRecord.tmuxName || name, claudeRecord]]), signalContext.attentionIndex || new Map())
      : readClaudeSignal(name, titles, signalContext.claudeIndex || new Map(), signalContext.attentionIndex || new Map());
    signal = claude.state !== 'idle' || claude.noticeKey ? claude : signal;
  }
  output = displayPaneOutput(rawOutput, command, { resumeId, threadId });
  return {
    slot,
    rowSpan: spans[name] === 2 ? 2 : 1,
    name,
    title,
    display: title || name,
    command,
    cwd,
    clients,
    output,
    state: signal.state || 'idle',
    noticeKey: signal.noticeKey || '',
    noticeKind: signal.noticeKind || '',
    attention: signal.attention || null,
    target: targetLabel(target),
    targetRaw: target,
    threadId,
    resumeId,
  };
}

function updateManifestFromSnapshots(manifest, sessions, options = {}) {
  let changed = false;
  const writeSlots = boardContext(options).isDefault;
  for (const session of sessions || []) {
    if (!session.name || session.missing) continue;
    const prev = manifest.sessions[session.name] || {};
    const now = Date.now();
    const prevSeen = Date.parse(prev.lastSeenAt || '') || 0;
    const touch = now - prevSeen > 60000;
    const detectedKind = session.threadId ? 'codex' : session.resumeId ? 'claude' : kindForCommand(session.command);
    const patch = {
      ...prev,
      kind: detectedKind === 'codex' || detectedKind === 'claude' ? detectedKind : cleanKind(prev.kind || detectedKind),
      title: session.title || prev.title || session.name,
      cwd: session.cwd || prev.cwd || '',
      target: prev.target || session.targetRaw || defaultTarget(session.name),
      lastSeenAt: touch ? new Date(now).toISOString() : prev.lastSeenAt,
    };
    if (writeSlots) patch.slot = session.slot;
    patch.threadId = session.threadId || (patch.kind === 'codex' ? prev.threadId || '' : '');
    patch.resumeId = session.resumeId || (patch.kind === 'claude' ? prev.resumeId || '' : '');
    if (patch.kind === 'codex' && SID_RE.test(patch.threadId || '')) {
      patch.command = codexDefaultCommand(`resume ${patch.threadId}`);
    } else {
      patch.command = normalizeCodexLaunchCommand(prev.command || session.command || '');
    }
    const needsUpdate = touch ||
      patch.kind !== prev.kind ||
      patch.title !== prev.title ||
      patch.cwd !== prev.cwd ||
      patch.threadId !== prev.threadId ||
      patch.resumeId !== prev.resumeId ||
      patch.command !== prev.command ||
      JSON.stringify(patch.target || null) !== JSON.stringify(prev.target || null) ||
      (writeSlots && patch.slot !== prev.slot);
    if (!needsUpdate) continue;
    const before = JSON.stringify(prev);
    upsertManifestRecord(manifest, session.name, patch);
    if (JSON.stringify(manifest.sessions[session.name]) !== before) changed = true;
  }
  return changed;
}

async function collectRecovery(options = {}, mode = 'automatic', reason = '') {
  const board = boardContext(options);
  const manifest = readManifest();
  const liveTargets = await readLiveTargets(manifest, { safeMode: true });
  const liveSessionNames = allLiveSessionNames(liveTargets);
  const allSessions = mergeSessionNames(liveSessionNames, manifest, liveTargets);
  const restoredLayout = board.isDefault
    ? restoreManifestSlots(readLayoutState(allSessions, board), manifest, liveTargets)
    : { state: readLayoutState(allSessions, board), changed: false };
  const { slots, spans, grid, boardTitle } = restoredLayout.state;
  if (restoredLayout.changed || (!board.isDefault && !fs.existsSync(board.layoutFile))) {
    writeLayoutState(restoredLayout.state, board);
  }
  const boardSummaries = readBoardSummaries();
  const holdingMembership = sessionBoardMembership(boardSummaries);
  const signalContext = { liveSessions: new Set(allSessions), liveTargets, manifest };
  const sessions = slots.map((name, slot) => recoverySnapshot(name, slot, spans, signalContext));
  const warning = collapseWarning(slots, sessions, allSessions);
  const recoveryWarning = reason
    ? `Temporary recovery mode: live pane capture is paused after ${reason}. Retrying automatically.`
    : 'Recovery mode is active: pane output, live cwd capture, process indexing, and status DB reads are disabled.';
  return {
    at: Date.now(),
    board: {
      id: board.id,
      title: boardTitle || board.title,
      grid,
      gridOptions: GRID_OPTIONS,
    },
    slots,
    spans,
    allSessions,
    titles: {},
    sessions,
    holding: allSessions.slice().sort(),
    holdingBoards: boardSummaries.map((item) => ({ id: item.id, title: item.title })),
    holdingMembership,
    warning: warning || recoveryWarning,
    recovery: { mode, retryAt: mode === 'automatic' ? collectHealth.retryAt : 0 },
  };
}

async function collectLive(options = {}) {
  const board = boardContext(options);
  const manifest = readManifest();
  const liveTargets = await readLiveTargets(manifest);
  const liveSessionNames = allLiveSessionNames(liveTargets);
  const allSessions = mergeSessionNames(liveSessionNames, manifest, liveTargets);
  const restoredLayout = board.isDefault
    ? restoreManifestSlots(readLayoutState(allSessions, board), manifest, liveTargets)
    : { state: readLayoutState(allSessions, board), changed: false };
  const { slots, spans, grid, boardTitle } = restoredLayout.state;
  if (restoredLayout.changed || (!board.isDefault && !fs.existsSync(board.layoutFile))) {
    writeLayoutState(restoredLayout.state, board);
  }
  const boardSummaries = readBoardSummaries();
  const holdingMembership = sessionBoardMembership(boardSummaries);
  const titles = titleMap();
  const claudeRecords = readClaudeSessionRecords();
  const adopted = adoptLiveClaudeRecords(manifest, readLayoutState(liveSessionNames, board).slots, titles, claudeRecords, liveTargets, { writeSlots: board.isDefault });
  if (adopted) writeManifest(manifest);
  const focusedSlot = Number(options.focusedSlot);
  const captureLinesBySlot = new Map();
  for (const [slot, lines] of normalizeCaptureLineHints(options.captureLinesBySlot, grid.slotCount)) {
    captureLinesBySlot.set(slot, lines);
  }
  for (let slot = 0; slot < slots.length; slot += 1) {
    const name = slots[slot];
    if (name && spans[name] === 2 && !captureLinesBySlot.has(slot)) {
      captureLinesBySlot.set(slot, Math.max(CAPTURE_LINES * 2, FOCUSED_CAPTURE_LINES));
    }
  }
  if (Number.isInteger(focusedSlot) && focusedSlot >= 0 && focusedSlot < grid.slotCount) {
    captureLinesBySlot.set(focusedSlot, Math.max(captureLinesBySlot.get(focusedSlot) || 0, FOCUSED_CAPTURE_LINES));
  }
  const terminalSizesBySlot = normalizeTerminalSizeHints(options.terminalSizesBySlot, grid.slotCount);
  const [procIndex, codexPaths, codexLocks] = await Promise.all([
    readProcessIndex(),
    readCodexPathMap(),
    readCodexLockIndex(),
  ]);
  const signalContext = {
    liveSessions: new Set(allSessions),
    liveTargets,
    manifest,
    captureLinesBySlot,
    terminalSizesBySlot,
    procIndex,
    codexPaths,
    codexLocks,
    claudeIndex: readClaudeSessionIndex(claudeRecords),
    claudeBySid: claudeBySid(claudeRecords),
    attentionIndex: readAttentionIndex(),
  };
  const sessions = await Promise.all(slots.map((name, slot) => snapshot(name, slot, titles, spans, signalContext)));
  if (process.env.TERMINALTOWN_AUTO_RECOVER === '1') await reviveExitedAiSessions(sessions, manifest);
  if (updateManifestFromSnapshots(manifest, sessions, board)) writeManifest(manifest);
  schedulePendingPromptSweep(manifest);
  const warning = collapseWarning(slots, sessions, allSessions);
  return {
    at: Date.now(),
    board: {
      id: board.id,
      title: boardTitle || board.title,
      grid,
      gridOptions: GRID_OPTIONS,
    },
    slots,
    spans,
    allSessions,
    titles: Object.fromEntries([...titles.entries()].map(([name, record]) => [name, record.title])),
    holding: allSessions,
    holdingBoards: boardSummaries.map((item) => ({ id: item.id, title: item.title })),
    holdingMembership,
    sessions,
    warning,
    manifestPath: MANIFEST_FILE,
  };
}

async function collect(options = {}) {
  if (process.env.TERMINALTOWN_RECOVERY_MODE === '1') {
    return collectRecovery(options, 'manual');
  }
  if (automaticRecoveryActive()) {
    return collectRecovery(options, 'automatic', collectHealth.reason);
  }
  try {
    const data = await withinTimeout(collectLive(options), COLLECT_TIMEOUT_MS, 'TerminalTown live collection');
    recordCollectionSuccess();
    return data;
  } catch (error) {
    recordCollectionFailure(error);
    return collectRecovery(options, 'automatic', collectHealth.reason);
  }
}

async function sendPrompt(session, prompt, submitKey = 'enter') {
  if (!NAME_RE.test(session) || !String(prompt || '').trim()) throw new Error('bad prompt request');
  const keyName = tmuxKeyName(submitKey || 'enter');
  if (!keyName) throw new Error(`unsupported submit key: ${submitKey}`);
  const { record, target } = await resolveSessionActionTarget(session);
  const buffer = `terminaltown-${process.pid}-${Date.now()}`;
  await tmuxSocket(target.socket, ['set-buffer', '-b', buffer, String(prompt)], { timeout: 5000, maxBuffer: 512 * 1024 });
  try {
    await tmuxSocket(target.socket, ['paste-buffer', '-b', buffer, '-t', targetSpec(target)], { timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.TMUX_SEND_PROMPT_DELAY || 0.15) * 1000));
    await tmuxSocket(target.socket, ['send-keys', '-t', targetSpec(target), keyName], { timeout: 3000 });
  } finally {
    await tmuxSocket(target.socket, ['delete-buffer', '-b', buffer], { timeout: 2000 }).catch(() => {});
  }
}

async function pasteText(session, text) {
  const value = String(text || '');
  if (!NAME_RE.test(session) || !value) throw new Error('bad paste request');
  const { target } = await resolveSessionActionTarget(session);
  const buffer = `terminaltown-paste-${process.pid}-${Date.now()}`;
  await tmuxSocket(target.socket, ['set-buffer', '-b', buffer, value], { timeout: 5000, maxBuffer: Math.max(2 * 1024 * 1024, Buffer.byteLength(value) + 1024) });
  try {
    await tmuxSocket(target.socket, ['paste-buffer', '-b', buffer, '-t', targetSpec(target)], { timeout: 5000 });
  } finally {
    await tmuxSocket(target.socket, ['delete-buffer', '-b', buffer], { timeout: 2000 }).catch(() => {});
  }
}

function pastedImageExt(mime) {
  switch (String(mime || '').toLowerCase()) {
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    case 'image/png':
    default: return 'png';
  }
}

function decodePastedImage(raw) {
  const mime = String(raw && raw.type || '').toLowerCase();
  if (!/^image\/(?:png|jpeg|gif|webp)$/.test(mime)) throw new Error(`unsupported image paste type: ${mime || 'unknown'}`);
  const dataUrl = String(raw && raw.dataUrl || '');
  const match = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('bad image paste payload');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length) throw new Error('empty image paste');
  if (buffer.length > 20 * 1024 * 1024) throw new Error('image paste is too large');
  return { buffer, ext: pastedImageExt(mime) };
}

function savePastedImages(images) {
  const list = Array.isArray(images) ? images : [];
  if (!list.length) throw new Error('no image data in clipboard');
  fs.mkdirSync(PASTE_DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return list.slice(0, 8).map((image, index) => {
    const decoded = decodePastedImage(image);
    const file = path.join(PASTE_DIR, `${stamp}-${process.pid}-${index + 1}.${decoded.ext}`);
    fs.writeFileSync(file, decoded.buffer, { mode: 0o600 });
    return file;
  });
}

async function pasteImages(session, images) {
  if (!NAME_RE.test(session)) throw new Error('bad session');
  const files = savePastedImages(images);
  await pasteText(session, files.join(' '));
  return files;
}

function appleScriptQuoted(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function saveMacClipboardImageFile(file, clipboardClass) {
  const fileExpr = appleScriptQuoted(file);
  const script = [
    `set outPath to ${fileExpr}`,
    `set imageData to the clipboard as ${clipboardClass}`,
    'set outFile to open for access (POSIX file outPath) with write permission',
    'try',
    '  set eof of outFile to 0',
    '  write imageData to outFile',
    '  close access outFile',
    'on error errMsg',
    '  try',
    '    close access outFile',
    '  end try',
    '  error errMsg',
    'end try',
  ];
  await exec(OSASCRIPT_BIN, script.flatMap((line) => ['-e', line]), { timeout: 5000, maxBuffer: 128 * 1024 });
  const stat = fs.statSync(file);
  if (!stat.size) throw new Error('empty image clipboard output');
  return file;
}

async function saveMacClipboardImage() {
  if (process.platform !== 'darwin') return [];
  fs.mkdirSync(PASTE_DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const attempts = [
    { ext: 'png', clipboardClass: '«class PNGf»' },
    { ext: 'tiff', clipboardClass: 'TIFF picture' },
  ];
  for (const attempt of attempts) {
    const file = path.join(PASTE_DIR, `${stamp}-${process.pid}-system.${attempt.ext}`);
    try {
      await saveMacClipboardImageFile(file, attempt.clipboardClass);
      return [file];
    } catch {
      try { fs.unlinkSync(file); } catch {}
    }
  }
  return [];
}

async function pasteSystemClipboardImage(session) {
  if (!NAME_RE.test(session)) throw new Error('bad session');
  const files = await saveMacClipboardImage();
  if (!files.length) return [];
  await pasteText(session, files.join(' '));
  return files;
}

async function sendKey(session, key) {
  if (!NAME_RE.test(session)) throw new Error('bad session');
  const { target } = await resolveSessionActionTarget(session);
  const mapped = tmuxKeyName(key);
  if (!mapped) throw new Error(`unsupported key: ${key}`);
  await tmuxSocket(target.socket, ['send-keys', '-t', targetSpec(target), mapped], { timeout: 3000 });
}

function tmuxKeyName(key) {
  switch (String(key || '').toLowerCase()) {
    case 'ctrl-c': return 'C-c';
    case 'ctrl-d': return 'C-d';
    case 'enter': return 'Enter';
    case 'escape':
    case 'esc': return 'Escape';
    case 'tab': return 'C-i';
    case 'shift-tab':
    case 'backtab':
    case 'btab': return 'BTab';
    case 'up': return 'Up';
    case 'down': return 'Down';
    case 'left': return 'Left';
    case 'right': return 'Right';
    default: return '';
  }
}

async function openFullTerminal(vscode, session, title = '') {
  if (!NAME_RE.test(session)) throw new Error('bad session');
  const { target } = await resolveSessionActionTarget(session);
  await postJson(EXTERNAL_TERMINAL_URL, {
    session,
    title: cleanTitle(title) || session,
    target,
  });
  return 'queued';
}

async function resolveSessionActionTarget(session) {
  if (!NAME_RE.test(session)) throw new Error('bad session');
  const manifest = readManifest();
  const record = manifest.sessions[session] || null;
  const liveTargets = await readLiveTargets(manifest);
  const savedTarget = normalizeTarget(record && record.target, session);
  const liveTarget = savedTarget && targetIsLive(savedTarget, liveTargets)
    ? savedTarget
    : findLiveSessionTarget(liveTargets, session);
  const target = liveTarget || savedTarget || defaultTarget(session);
  if (liveTarget && (!record || JSON.stringify(record.target || null) !== JSON.stringify(liveTarget))) {
    upsertManifestRecord(manifest, session, {
      ...(record || {}),
      target: liveTarget,
      lastSeenAt: new Date().toISOString(),
    });
    writeManifest(manifest);
  }
  return { record: manifest.sessions[session] || record || null, target, live: Boolean(liveTarget) };
}

function postJson(urlText, body) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlText); } catch { return reject(new Error(`bad terminal launch URL: ${urlText}`)); }
    const payload = JSON.stringify(body || {});
    const lib = url.protocol === 'https:' ? require('https') : require('http');
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname || '/',
      method: 'POST',
      timeout: 3000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) resolve();
      else reject(new Error(`terminal launcher returned HTTP ${res.statusCode}`));
    });
    req.on('timeout', () => req.destroy(new Error('terminal launcher timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}

async function pickSession(vscode, title) {
  const data = await collect();
  const items = (data.allSessions || []).map((name) => {
    const session = (data.sessions || []).find((item) => item.name === name);
    return {
      label: data.titles && data.titles[name] || name,
      description: name,
      detail: session && session.target ? session.target : '',
      name,
    };
  });
  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: 'Choose the tmux session to control',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return picked ? picked.name : null;
}

async function pickPlacement(vscode, defaultSlot = null, board = {}) {
  const allSessions = await listAllSessions();
  const { grid } = readLayoutState(allSessions, board);
  const items = [
    { label: 'First empty slot', placement: 'first' },
    { label: 'Holding area', placement: 'holding' },
  ];
  if (Number.isInteger(defaultSlot) && defaultSlot >= 0 && defaultSlot < grid.slotCount) {
    items.push({ label: `Selected slot ${defaultSlot + 1}`, placement: String(defaultSlot) });
  }
  for (let i = 0; i < grid.slotCount; i += 1) {
    items.push({ label: `Slot ${i + 1}`, placement: String(i) });
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Place New Session',
    placeHolder: 'Choose where the new session should appear',
    ignoreFocusOut: true,
  });
  if (!picked) return null;
  return picked.placement;
}

async function newSessionWizard(vscode, defaultSlot = null, forcedKind = '', board = {}) {
  const presets = presetSessions();
  const choices = [
    { label: 'Blank Claude session', kind: 'claude', description: 'claude' },
    { label: 'Blank Codex session', kind: 'codex', description: CODEX_DEFAULT_COMMAND },
    ...presets.map((preset) => ({ ...preset, kind: 'preset' })),
  ];
  const source = forcedKind === 'claude' || forcedKind === 'codex'
    ? choices.find((choice) => choice.kind === forcedKind)
    : await vscode.window.showQuickPick(choices, {
      title: 'New AI Session',
      placeHolder: 'Choose Claude or Codex',
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
    });
  if (!source) return null;

  let session = source.session || '';
  let cwd = source.cwd || PROJECT_ROOT;
  let command = source.command || '';
  let title = source.kind === 'preset' ? source.label : '';

  if (source.kind === 'claude') {
    cwd = await vscode.window.showInputBox({
      title: 'Project Directory',
      value: PROJECT_ROOT,
      ignoreFocusOut: true,
    });
    if (!cwd) return null;
    session = await uniqueSessionName(path.basename(cwd));
    command = 'claude';
  } else if (source.kind === 'codex') {
    cwd = await vscode.window.showInputBox({
      title: 'Project Directory',
      value: PROJECT_ROOT,
      ignoreFocusOut: true,
    });
    if (!cwd) return null;
    session = await uniqueSessionName(`codex-${path.basename(cwd)}`);
    command = codexDefaultCommand();
  } else {
    session = await uniqueSessionName(source.session || source.label);
  }

  session = await vscode.window.showInputBox({
    title: 'Tmux Session Name',
    value: session,
    validateInput: (value) => NAME_RE.test(value) ? null : 'Use letters, numbers, dot, underscore, or dash.',
    ignoreFocusOut: true,
  });
  if (!session) return null;

  title = await vscode.window.showInputBox({
    title: 'Display Name',
    value: cleanTitle(title) || session,
    prompt: 'Shown on the AI board and reused by restored VS Code terminal tabs.',
    ignoreFocusOut: true,
  });
  if (title === undefined) return null;

  const initialPrompt = await vscode.window.showInputBox({
    title: 'Initial Prompt',
    prompt: 'Optional. Leave blank to start at the CLI prompt.',
    ignoreFocusOut: true,
  });
  if (initialPrompt === undefined) return null;

  const placement = await pickPlacement(vscode, defaultSlot, board);
  if (placement === null) return null;

  return createAiSession({
    session,
    cwd,
    command,
    initialPrompt,
    placement,
    title,
    board,
  });
}

async function renameWizard(vscode, session, currentTitle = '') {
  if (!session) return null;
  const title = await vscode.window.showInputBox({
    title: `Rename ${session}`,
    value: currentTitle || session,
    prompt: 'This changes the board label and the restored VS Code terminal label. It does not rename the tmux session.',
    ignoreFocusOut: true,
  });
  if (title === undefined) return null;
  if (!cleanTitle(title)) {
    vscode.window.showWarningMessage('Enter a non-empty label.');
    return null;
  }
  return renameSessionLabel(session, title);
}

function nonce() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function html(webview, discoBallSrc = '', purrSrc = '', refractionSrc = '', discoSettings = DISCO_SETTINGS_DEFAULTS) {
  const n = nonce();
  const initialDiscoSettings = Object.assign({}, DISCO_SETTINGS_DEFAULTS, discoSettings || {});
  const discoScale = Math.max(0.6, Math.min(1.8, Number(initialDiscoSettings.scalePct) / 100 || 1.15));
  const discoSize = Math.round(DISCO_GIF_WIDTH * discoScale);
  const discoGifWidth = Math.round(DISCO_GIF_WIDTH * discoScale);
  const discoGifHeight = Math.round(DISCO_GIF_HEIGHT * discoScale);
  const discoVisibleCenterTopPx = Math.max(0, Math.min(24, Number(initialDiscoSettings.visibleCenterTopPx) || 0));
  const discoStringJoinOverlapPx = Math.max(0, Math.min(12, Number(initialDiscoSettings.stringJoinOverlapPx) || 0));
  const discoAnchorLiftY = Math.max(0, Math.round(((discoSize - discoGifHeight) / 2) + (discoVisibleCenterTopPx * discoScale) + discoStringJoinOverlapPx));
  const discoHalfSize = Math.round(discoSize / 2);
  const discoRight = Math.round(26 - ((discoSize - DISCO_GIF_WIDTH) / 2));
  const refractionOpacity = Math.max(0, Math.min(1, (Number(initialDiscoSettings.refractionOpacityPct) || 62) / 100));
  const refractionIdleOpacity = Math.max(0, Math.min(0.5, refractionOpacity * 0.72));
  const refractionSizeVmax = Math.max(80, Math.min(190, Number(initialDiscoSettings.refractionSizeVmax) || 142));
  const refractionScale = Math.max(4.2, Math.min(7.4, refractionSizeVmax / 27));
  const refractionScaleY = Math.max(3.8, refractionScale * 0.92);
  const refractionTurnRaw = Number(initialDiscoSettings.refractionTurnDeg);
  const refractionTurnDeg = Number.isFinite(refractionTurnRaw) ? Math.max(-90, Math.min(120, refractionTurnRaw)) : 81;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource}; style-src 'nonce-${n}'; script-src 'nonce-${n}';">
<title>TerminalTown</title>
<style nonce="${n}">
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  --skin-page: var(--vscode-editor-background, #ffffff);
  --skin-board: var(--vscode-editor-background, #ffffff);
  --skin-toolbar: var(--vscode-sideBar-background, #f6f8fa);
  --skin-tile: var(--vscode-terminal-background, var(--vscode-editor-background, #ffffff));
  --skin-head: var(--vscode-tab-activeBackground, #f6f8fa);
  --skin-border: var(--vscode-panel-border, #d0d7de);
  --skin-text: var(--vscode-editor-foreground, #111827);
  --skin-muted: var(--vscode-descriptionForeground, #6b7280);
  --skin-input: var(--vscode-input-background, #ffffff);
  --skin-input-text: var(--vscode-input-foreground, #111827);
  --skin-button: var(--vscode-input-background, #ffffff);
  --skin-button-text: var(--vscode-input-foreground, #111827);
  --skin-accent: var(--vscode-focusBorder, #2563eb);
  --skin-good: #53df9a;
  --skin-work: #4f8fff;
  --skin-danger: #ef4444;
  --skin-shadow: rgba(0,0,0,.25);
}
body[data-skin="circuit"] {
  --skin-page: #070a0d;
  --skin-board: #090d10;
  --skin-toolbar: #0e1617;
  --skin-tile: #0a1012;
  --skin-head: #10201f;
  --skin-border: #24514c;
  --skin-text: #e7fff6;
  --skin-muted: #8fb8ad;
  --skin-input: #06100d;
  --skin-input-text: #eafff8;
  --skin-button: #112522;
  --skin-button-text: #eafff8;
  --skin-accent: #5eead4;
  --skin-good: #86efac;
  --skin-work: #38bdf8;
  --skin-danger: #fb7185;
  --skin-shadow: rgba(0,0,0,.42);
}
body[data-skin="aurora"] {
  --skin-page: #111018;
  --skin-board: #12131c;
  --skin-toolbar: #1b1823;
  --skin-tile: #151820;
  --skin-head: #222033;
  --skin-border: #4b5563;
  --skin-text: #f8fafc;
  --skin-muted: #b7bfd1;
  --skin-input: #10131a;
  --skin-input-text: #f8fafc;
  --skin-button: #24283a;
  --skin-button-text: #f8fafc;
  --skin-accent: #f0abfc;
  --skin-good: #34d399;
  --skin-work: #60a5fa;
  --skin-danger: #fb7185;
  --skin-shadow: rgba(0,0,0,.4);
}
body[data-skin="daybook"] {
  --skin-page: #f4f7f6;
  --skin-board: #e8efed;
  --skin-toolbar: #dce7e3;
  --skin-tile: #fbfdfc;
  --skin-head: #d3e4df;
  --skin-border: #9db8b0;
  --skin-text: #17211f;
  --skin-muted: #566965;
  --skin-input: #ffffff;
  --skin-input-text: #17211f;
  --skin-button: #eff6f4;
  --skin-button-text: #17211f;
  --skin-accent: #0f766e;
  --skin-good: #16a34a;
  --skin-work: #2563eb;
  --skin-danger: #b91c1c;
  --skin-shadow: rgba(23,33,31,.16);
}
body[data-skin="arcade"] {
  --skin-page: #09090b;
  --skin-board: #0c0a13;
  --skin-toolbar: #18131f;
  --skin-tile: #111018;
  --skin-head: #21182a;
  --skin-border: #6d5d86;
  --skin-text: #fff7ed;
  --skin-muted: #c9bfd9;
  --skin-input: #0b0b12;
  --skin-input-text: #fff7ed;
  --skin-button: #261c33;
  --skin-button-text: #fff7ed;
  --skin-accent: #facc15;
  --skin-good: #22c55e;
  --skin-work: #22d3ee;
  --skin-danger: #f43f5e;
  --skin-shadow: rgba(0,0,0,.44);
}
body[data-skin="mono"] {
  --skin-page: #080808;
  --skin-board: #101010;
  --skin-toolbar: #151515;
  --skin-tile: #050505;
  --skin-head: #1e1e1e;
  --skin-border: #666666;
  --skin-text: #eeeeee;
  --skin-muted: #a8a8a8;
  --skin-input: #0a0a0a;
  --skin-input-text: #f5f5f5;
  --skin-button: #202020;
  --skin-button-text: #f0f0f0;
  --skin-accent: #ffffff;
  --skin-good: #d8d8d8;
  --skin-work: #b8b8b8;
  --skin-danger: #ffffff;
  --skin-shadow: rgba(0,0,0,.56);
}
body[data-skin="sepia"] {
  --skin-page: #150f09;
  --skin-board: #1b130c;
  --skin-toolbar: #24180f;
  --skin-tile: #120d08;
  --skin-head: #2b1c10;
  --skin-border: #6d4b2c;
  --skin-text: #f4dfbd;
  --skin-muted: #c2a77e;
  --skin-input: #0f0a06;
  --skin-input-text: #f7e7c8;
  --skin-button: #2b1d11;
  --skin-button-text: #f4dfbd;
  --skin-accent: #d99a4e;
  --skin-good: #d0b36c;
  --skin-work: #b98a4a;
  --skin-danger: #e08961;
  --skin-shadow: rgba(0,0,0,.5);
}
body[data-skin="disco"] {
  --skin-page: #08050d;
  --skin-board: #0d0714;
  --skin-toolbar: rgba(22,13,29,.88);
  --skin-tile: rgba(16,9,21,.68);
  --skin-head: rgba(36,16,44,.78);
  --skin-border: #8b5cf6;
  --skin-text: #fff4ff;
  --skin-muted: #d7c6e9;
  --skin-input: rgba(11,6,16,.82);
  --skin-input-text: #fff4ff;
  --skin-button: #25112f;
  --skin-button-text: #fff4ff;
  --skin-accent: #f472b6;
  --skin-good: #a3e635;
  --skin-work: #22d3ee;
  --skin-danger: #fb7185;
  --skin-shadow: rgba(0,0,0,.36);
}
body {
  --disco-shave: ${Number(initialDiscoSettings.maskShavePx) || 0}px;
  --disco-size: ${discoSize}px;
  --disco-gif-width: ${discoGifWidth}px;
  --disco-gif-height: ${discoGifHeight}px;
  --disco-anchor-lift-y: ${discoAnchorLiftY}px;
  --disco-half-size: ${discoHalfSize}px;
  --disco-right: ${discoRight}px;
  --disco-hue: ${Number(initialDiscoSettings.hueDeg) || 0}deg;
  --disco-sat: ${Number(initialDiscoSettings.saturationPct) || 100}%;
  --disco-bright: ${Number(initialDiscoSettings.brightnessPct) || 100}%;
  --disco-refraction-opacity: ${refractionOpacity};
  --disco-refraction-idle-opacity: ${refractionIdleOpacity};
  --disco-refraction-size: ${refractionSizeVmax}vmax;
  --disco-refraction-scale: ${refractionScale};
  --disco-refraction-scale-y: ${refractionScaleY};
  --disco-refraction-turn: ${refractionTurnDeg}deg;
  background: var(--skin-page);
  color: var(--skin-text);
  font: 12px/1.35 var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  overflow: hidden;
}
button, select, input {
  font: inherit;
  color: var(--skin-button-text);
  background: var(--skin-button);
  border: 1px solid var(--skin-border);
}
button { cursor: pointer; }
button:hover, select:hover { border-color: var(--skin-accent); }
button:active { color: var(--skin-page); background: var(--skin-accent); }
.clipboard-proxy {
  position: fixed;
  left: -1000px;
  top: -1000px;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.page {
  position: fixed;
  inset: 0;
  z-index: 1;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
}
.toolbar {
  position: relative;
  z-index: 3;
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 4px 8px;
  border-bottom: 1px solid var(--skin-border);
  background: var(--skin-toolbar);
  min-width: 0;
}
.toolbar button { height: 24px; padding: 0 8px; }
.toolbar select { height: 24px; padding: 0 7px; }
.toolbar .spacer { flex: 1 1 auto; }
.toolbar-toggle { flex: 0 0 24px; min-width: 24px; padding: 0 !important; }
.toolbar.collapsed {
  min-height: 24px;
  flex-wrap: nowrap;
  padding-block: 3px;
}
.toolbar.collapsed > :not(.toolbar-toggle):not(.board-label) { display: none; }
.toolbar.collapsed .board-label { flex: 0 1 auto; min-width: 0; }
.status { color: var(--skin-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.board-label {
  flex: 0 1 180px;
  min-width: 72px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--skin-text);
  font-weight: 700;
}
.recovery {
  display: none;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 5px 8px;
  border-bottom: 1px solid var(--skin-danger);
  background: var(--skin-toolbar);
  color: var(--skin-text);
}
.recovery.visible { display: flex; }
.recovery span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recovery button { height: 24px; padding: 0 8px; border-color: var(--skin-danger); }
.board-picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(0, 0, 0, 0.34);
}
.board-picker-backdrop.visible { display: flex; }
.board-picker {
  width: min(460px, 100%);
  max-height: min(620px, calc(100vh - 36px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--skin-border);
  border-radius: 8px;
  background: var(--skin-panel);
  color: var(--skin-text);
  box-shadow: 0 18px 52px rgba(0, 0, 0, 0.32);
}
.board-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}
.board-picker-header strong {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 14px;
}
.board-picker-close {
  width: 28px;
  height: 28px;
  padding: 0;
}
.board-picker-list {
  display: grid;
  gap: 6px;
  min-height: 0;
  overflow: auto;
}
.board-picker-item {
  width: 100%;
  min-height: 44px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  text-align: left;
  border: 1px solid var(--skin-border);
  border-radius: 8px;
  background: var(--skin-toolbar);
  color: var(--skin-text);
}
.board-picker-item.active { border-color: var(--skin-accent); }
.board-picker-title,
.board-picker-id {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.board-picker-title { font-weight: 700; }
.board-picker-id { color: var(--skin-muted); font-size: 11px; }
.board-picker-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
.board-picker-form input {
  min-width: 0;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--skin-border);
  border-radius: 8px;
  background: var(--skin-input);
  color: var(--skin-text);
}
.board-picker-form button { height: 30px; padding: 0 10px; }
.board {
  display: grid;
  --board-columns: 3;
  --board-rows: 4;
  --board-slots: 12;
  grid-template-columns: repeat(var(--board-columns), minmax(0, 1fr));
  grid-template-rows: repeat(var(--board-rows), minmax(0, 1fr));
  grid-auto-rows: minmax(0, 1fr);
  align-content: stretch;
  gap: 8px;
  padding: 8px;
  min-height: 0;
  height: 100%;
  overflow: auto;
  background: var(--skin-board);
}
.board.compact { grid-template-rows: repeat(var(--board-rows), minmax(150px, 1fr)); }
body[data-skin="arcade"] .board {
  gap: 22px;
  padding: 14px;
}
body[data-skin="disco"] .board { background: transparent; }
.tile {
  --spectacle-hue: 316;
  --spectacle-delay: 0ms;
  --tile-head-height: 58px;
  position: relative;
  container-type: inline-size;
  container-name: tile;
  display: grid;
  grid-template-rows: var(--tile-head-height) minmax(0, 1fr) 32px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  border: 1px solid var(--skin-border);
  background: var(--skin-tile);
  box-shadow: 0 1px 2px var(--skin-shadow);
  overflow: hidden;
}
.tile::before {
  content: "";
  position: absolute;
  top: var(--tile-head-height);
  bottom: 32px;
  left: 0;
  width: 3px;
  background: var(--skin-border);
  opacity: .75;
  pointer-events: none;
  z-index: 2;
}
.tile::after {
  content: "";
  position: absolute;
  inset: var(--tile-head-height) 0 32px 0;
  background: var(--skin-good);
  opacity: 0;
  pointer-events: none;
  z-index: 1;
}
.tile.covered { display: none; }
.tile.row-span-2 { min-height: 0; }
.tile.controls-collapsed { --tile-head-height: 28px; }
.tile.controls-collapsed .head {
  grid-template-rows: 23px;
  padding-bottom: 3px;
}
.tile.controls-collapsed .head-main {
  grid-template-columns: 28px minmax(42px, 1fr) minmax(68px, 96px) 52px;
}
.tools-toggle { display: none; min-width: 52px; padding: 0 5px; font-weight: 700; }
.tile.controls-collapsed .tools-toggle { display: block; }
.tile.controls-collapsed .head-actions {
  position: absolute;
  top: 27px;
  left: 0;
  right: 0;
  z-index: 5;
  display: none;
  min-height: 25px;
  padding: 3px 6px;
  border-top: 1px solid var(--skin-border);
  border-bottom: 1px solid var(--skin-border);
  background: var(--skin-head);
  box-shadow: 0 3px 8px var(--skin-shadow);
}
.tile.controls-collapsed.controls-open .head-actions { display: flex; }
.tile.drop-target { outline: 2px solid var(--skin-good); outline-offset: -2px; }
.tile.selected { outline: 2px solid var(--skin-accent); outline-offset: -2px; }
.tile.changed { border-color: var(--skin-good); box-shadow: 0 0 0 1px var(--skin-good) inset; }
.tile.working { border-color: var(--skin-work); }
.tile.missing { border-color: var(--skin-danger); }
.tile.working::before { background: var(--skin-work); }
.tile.changed::before { background: var(--skin-good); }
.tile.missing::before { background: var(--skin-danger); }
body[data-skin="disco"] .tile:nth-child(3n + 1) { --skin-border: #f472b6; }
body[data-skin="disco"] .tile:nth-child(3n + 2) { --skin-border: #22d3ee; }
body[data-skin="disco"] .tile:nth-child(3n + 3) { --skin-border: #facc15; }
body[data-motion="subtle"] .tile.changed::after { animation: flashChanged 1100ms steps(5, end); }
body[data-motion="subtle"] .tile.working::before { animation: pulseWorking 2600ms steps(4, end) infinite; }
body[data-skin="disco"][data-motion="subtle"][data-spectacle="disco"] .tile {
  border-color: hsl(var(--spectacle-hue) 48% 58%);
  box-shadow: 0 0 0 1px hsla(var(--spectacle-hue), 56%, 58%, .2) inset;
}
body[data-skin="disco"][data-motion="subtle"][data-spectacle="disco"] .tile::before {
  background: hsl(var(--spectacle-hue) 54% 58%);
  opacity: .5;
}
body[data-skin="disco"][data-motion="subtle"][data-spectacle="disco"] .tile::after {
  background: hsl(var(--spectacle-hue) 64% 58%);
  animation: discoTileGlimmer 1400ms ease-in-out infinite;
  animation-delay: var(--spectacle-delay);
}
body[data-skin="disco"][data-motion="subtle"][data-spectacle="disco"] .idx {
  background: hsl(var(--spectacle-hue) 54% 58%);
}
.disco-lightwash {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  opacity: .34;
}
body[data-skin="disco"][data-motion="subtle"] .disco-lightwash {
  display: none;
}
.disco-party-dim {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 8;
  pointer-events: none;
  background: #000;
  opacity: 0;
  contain: paint;
}
body[data-skin="disco"][data-spectacle="disco"] .disco-party-dim {
  display: block;
  will-change: opacity;
  animation: discoPartyDim 5400ms linear both;
}
.disco-refractions {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  overflow: hidden;
  contain: strict;
  opacity: 0;
  transform: translate3d(0, 0, 0);
}
body[data-skin="disco"][data-spectacle="disco"] .disco-refractions {
  display: block;
  opacity: var(--disco-refraction-opacity);
  transform: translate3d(0, 0, 0);
  will-change: opacity;
  animation: discoRefractionsSweep 3000ms linear 1800ms both;
}
.disco-refraction-map {
  position: absolute;
  left: calc(100vw - var(--disco-right) - var(--disco-half-size) - 384px);
  top: calc(52px - 384px);
  width: 768px;
  height: 768px;
  max-width: none;
  opacity: 1;
  object-fit: fill;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  backface-visibility: hidden;
  transform: rotateZ(-24deg) skewX(-7deg) scale3d(var(--disco-refraction-scale), var(--disco-refraction-scale-y), 1);
  transform-origin: 50% 50%;
}
body[data-skin="disco"][data-spectacle="disco"] .disco-refraction-map {
  will-change: transform;
  animation: discoRefractionsOrbit 3000ms linear 1800ms both;
}
.disco-lightwash span {
  position: absolute;
  width: 52vw;
  height: 42vh;
  min-width: 360px;
  min-height: 240px;
  border-radius: 46%;
  opacity: .62;
  contain: paint;
}
.wash-a {
  left: -16vw;
  top: -10vh;
  background: radial-gradient(ellipse at center, rgba(244,114,182,.42) 0 12%, rgba(244,114,182,.14) 34%, transparent 72%);
  animation: washA 180s steps(6, end) infinite;
}
.wash-b {
  right: -18vw;
  top: 10vh;
  background: radial-gradient(ellipse at center, rgba(34,211,238,.34) 0 14%, rgba(139,92,246,.12) 38%, transparent 74%);
  animation: washB 210s steps(7, end) infinite;
}
.wash-c {
  display: none;
}
.disco-ball {
  display: none;
  position: fixed;
  top: 46px;
  right: var(--disco-right);
  width: var(--disco-size);
  height: var(--disco-size);
  z-index: 9;
  pointer-events: none;
  border: 0;
  background: transparent;
  box-shadow: none;
  image-rendering: pixelated;
  transform: translate3d(0, -175px, 0);
}
.disco-ball::before {
  content: "";
  position: absolute;
  left: calc(50% - 1px);
  top: -76px;
  width: 3px;
  height: 79px;
  background: #f8fafc;
  box-shadow: 1px 0 0 rgba(0,0,0,.28);
}
body[data-skin="disco"][data-motion="subtle"] .disco-ball {
  display: grid;
  place-items: center;
  animation: discoDrop 1800ms cubic-bezier(.2,.8,.25,1) forwards;
}
body[data-skin="disco"][data-spectacle="disco"] .disco-ball {
  display: grid;
  place-items: center;
  animation: discoDrop 1800ms cubic-bezier(.2,.8,.25,1) 360ms forwards;
}
.disco-disc {
  display: grid;
  place-items: center;
  width: var(--disco-size);
  height: var(--disco-size);
  overflow: hidden;
  contain: paint;
  transform: translate3d(0, calc(0px - var(--disco-anchor-lift-y)), 0);
  -webkit-mask-image: radial-gradient(circle at 50% 50%, #000 calc(50% - var(--disco-shave)), transparent calc(50% - var(--disco-shave) + 1px));
  mask-image: radial-gradient(circle at 50% 50%, #000 calc(50% - var(--disco-shave)), transparent calc(50% - var(--disco-shave) + 1px));
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
}
.disco-gif {
  display: block;
  width: var(--disco-gif-width);
  height: var(--disco-gif-height);
  object-fit: contain;
  image-rendering: pixelated;
  filter: hue-rotate(var(--disco-hue)) saturate(var(--disco-sat)) brightness(var(--disco-bright));
}
.kart-layer {
  display: none;
  position: fixed;
  inset: 34px 0 44px 0;
  z-index: 7;
  overflow: hidden;
  pointer-events: none;
}
body[data-skin="arcade"][data-motion="subtle"] .kart-layer { display: block; }
.kart {
  position: absolute;
  width: 22px;
  height: 16px;
  left: 0;
  top: 0;
  image-rendering: pixelated;
  transform-origin: 50% 50%;
  will-change: transform, opacity;
  transition: opacity 120ms steps(2, end);
  filter: drop-shadow(0 1px 0 rgba(0,0,0,.6));
}
.kart::before {
  content: "";
  position: absolute;
  left: 4px;
  top: 5px;
  width: 14px;
  height: 7px;
  background: var(--kart);
  box-shadow:
    -4px 2px 0 #0b0610,
    14px 2px 0 #0b0610,
    2px -3px 0 var(--helmet),
    6px -3px 0 #fff7ed,
    0 7px 0 #27272a,
    10px 7px 0 #27272a;
}
.kart::after {
  content: "";
  position: absolute;
  left: 1px;
  top: 11px;
  width: 5px;
  height: 3px;
  background: #f8fafc;
  box-shadow: 15px 0 0 #f8fafc;
}
.kart.crashed { opacity: 0; }
.kart-1 { --kart: #f43f5e; --helmet: #fde047; }
.kart-2 { --kart: #22d3ee; --helmet: #fb7185; }
.kart-3 { --kart: #a3e635; --helmet: #f0abfc; }
.kart-4 { --kart: #facc15; --helmet: #67e8f9; }
.smoke {
  position: absolute;
  width: 26px;
  height: 18px;
  left: 0;
  top: 0;
  opacity: 0;
  transform-origin: center;
}
.smoke::before {
  content: "";
  position: absolute;
  left: 7px;
  top: 7px;
  width: 5px;
  height: 5px;
  background: #e5e7eb;
  box-shadow:
    7px -4px 0 #cbd5e1,
    13px 1px 0 #f8fafc,
    2px 6px 0 #d4d4d8,
    12px 8px 0 #a1a1aa;
}
.smoke.boom { animation: smokePuff 620ms steps(5, end); }
@keyframes flashChanged {
  0% { opacity: .18; }
  55% { opacity: .06; }
  100% { opacity: 0; }
}
@keyframes pulseWorking {
  0%, 100% { opacity: .42; }
  50% { opacity: 1; }
}
@keyframes discoTileGlimmer {
  0%, 100% { opacity: .012; }
  50% { opacity: .075; }
}
@keyframes discoPartyDim {
  0% { opacity: 0; }
  8% { opacity: .58; }
  88% { opacity: .58; }
  100% { opacity: 0; }
}
@keyframes discoRefractionsSweep {
  0% { opacity: 0; transform: translate3d(0, 0, 0); }
  14% { opacity: var(--disco-refraction-opacity); transform: translate3d(0, 0, 0); }
  72% { opacity: var(--disco-refraction-opacity); transform: translate3d(0, 0, 0); }
  88% { opacity: var(--disco-refraction-idle-opacity); transform: translate3d(0, 0, 0); }
  100% { opacity: 0; transform: translate3d(0, 0, 0); }
}
@keyframes discoRefractionsOrbit {
  0% { transform: rotateZ(-24deg) skewX(-7deg) scale3d(var(--disco-refraction-scale), var(--disco-refraction-scale-y), 1); }
  38% { transform: rotateZ(-8deg) skewX(-7deg) scale3d(var(--disco-refraction-scale), var(--disco-refraction-scale-y), 1); }
  72% { transform: rotateZ(8deg) skewX(-7deg) scale3d(var(--disco-refraction-scale), var(--disco-refraction-scale-y), 1); }
  100% { transform: rotateZ(18deg) skewX(-7deg) scale3d(var(--disco-refraction-scale), var(--disco-refraction-scale-y), 1); }
}
@keyframes discoDrop {
  0% { transform: translate3d(0, -175px, 0); }
  72% { transform: translate3d(0, 4px, 0); }
  100% { transform: translate3d(0, 0, 0); }
}
@keyframes washA {
  0% { transform: translate3d(0, 0, 0) rotate(0deg); }
  50% { transform: translate3d(34vw, 20vh, 0) rotate(5deg); }
  100% { transform: translate3d(0, 0, 0) rotate(0deg); }
}
@keyframes washB {
  0% { transform: translate3d(0, 0, 0) rotate(0deg); }
  50% { transform: translate3d(-30vw, 14vh, 0) rotate(-5deg); }
  100% { transform: translate3d(0, 0, 0) rotate(0deg); }
}
@keyframes washC {
  0% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: .36; }
  50% { transform: translate3d(28vw, -34vh, 0) rotate(6deg); opacity: .5; }
  100% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: .36; }
}
@keyframes smokePuff {
  0% { opacity: 0; transform: translate3d(var(--smoke-x), var(--smoke-y), 0) scale(.5); }
  28% { opacity: .9; transform: translate3d(var(--smoke-x), var(--smoke-y), 0) scale(1); }
  100% { opacity: 0; transform: translate3d(var(--smoke-x), var(--smoke-y), 0) scale(1.8); }
}
@media (prefers-reduced-motion: reduce) {
  body[data-motion="subtle"] .tile.changed::after,
  body[data-skin="disco"][data-motion="subtle"][data-spectacle="disco"] .tile::after,
  body[data-motion="subtle"] .tile.working::before,
  body[data-skin="disco"][data-motion="subtle"] .disco-lightwash span,
  body[data-skin="disco"][data-spectacle="disco"] .disco-party-dim,
  body[data-skin="disco"][data-spectacle="disco"] .disco-refractions,
  body[data-skin="disco"][data-spectacle="disco"] .disco-refraction-map,
  body[data-skin="disco"][data-motion="subtle"] .disco-ball,
  body[data-skin="arcade"][data-motion="subtle"] .kart,
  body[data-skin="arcade"][data-motion="subtle"] .smoke { animation: none; }
  body[data-skin="disco"][data-spectacle="disco"] .disco-party-dim { opacity: .42; }
  body[data-skin="disco"][data-spectacle="disco"] .disco-refractions { opacity: var(--disco-refraction-opacity); transform: translate3d(0, 0, 0); }
  body[data-skin="disco"][data-spectacle="disco"] .disco-refraction-map { transform: translate3d(0, 0, 0); }
  body[data-skin="disco"] .disco-ball { transform: translate3d(0, 0, 0); }
}
.resize-edge {
  position: absolute;
  left: 0;
  right: 0;
  height: 8px;
  z-index: 4;
  cursor: ns-resize;
  background: transparent;
}
.resize-edge:hover { background: color-mix(in srgb, var(--skin-good) 24%, transparent); }
.resize-top { top: 0; }
.resize-bottom { bottom: 0; }
.empty .resize-edge { display: none; }
.head {
  position: relative; z-index: 2;
  display: grid;
  grid-template-rows: 23px 24px;
  gap: 3px;
  min-width: 0;
  padding: 4px 6px 3px;
  border-bottom: 1px solid var(--skin-border);
  background: var(--skin-head);
  user-select: none;
  overflow: hidden;
}
.head[draggable="true"] { cursor: grab; }
.head[draggable="true"]:active { cursor: grabbing; }
.head-main {
  display: grid;
  grid-template-columns: 28px minmax(48px, 1fr) minmax(0, .72fr) minmax(72px, 112px);
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.head-actions {
  display: flex;
  gap: 3px;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.head-actions::-webkit-scrollbar { display: none; }
.idx {
  width: 24px; height: 18px; display: inline-grid; place-items: center;
  color: var(--skin-page); background: var(--skin-good); font-weight: 700;
}
.working .idx { background: var(--skin-work); }
.changed .idx { background: var(--skin-good); }
.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--skin-muted); white-space: nowrap; }
.head button, .head select {
  height: 22px;
  padding: 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.head button {
  flex: 0 0 auto;
  min-width: 27px;
}
.head select { width: 100%; }
@container tile (max-width: 420px) {
  .head-main { grid-template-columns: 28px minmax(42px, 1fr) minmax(68px, 96px); }
  .meta { display: none; }
  .head-actions { gap: 2px; }
  .head button { min-width: 25px; padding: 0 2px; font-size: 11px; }
}
@container tile (max-width: 300px) {
  .tile { --tile-head-height: 71px; }
  .head {
    grid-template-rows: 23px 48px;
    padding-inline: 5px;
  }
  .head-actions {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    grid-auto-rows: 22px;
    align-items: stretch;
    overflow: hidden;
  }
  .head button {
    min-width: 0;
    max-width: none;
  }
}
pre {
  position: relative; z-index: 2;
  min-width: 0;
  min-height: 0;
  height: 100%;
  margin: 0; padding: 7px 8px; overflow: auto; white-space: pre-wrap; word-break: break-word;
  scrollbar-width: thin;
}
.terminal-output { min-width: 0; min-height: 0; height: 100%; box-sizing: border-box; }
.terminal-output a {
  color: var(--skin-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.terminal-output a:hover { text-decoration-thickness: 2px; }
.terminal-output a:focus-visible { outline: 2px solid var(--skin-accent); outline-offset: 2px; }
form {
  position: relative; z-index: 2;
  display: grid; grid-template-columns: minmax(0, 1fr) 48px;
  border-top: 1px solid var(--skin-border);
}
input { min-width: 0; border: 0; outline: 0; padding: 0 7px; color: var(--skin-input-text); background: var(--skin-input); }
form button { border-width: 0 0 0 1px; }
.rename-editor {
  position: absolute;
  z-index: 6;
  left: 8px;
  right: 8px;
  top: 36px;
  padding: 8px;
  border: 1px solid var(--skin-accent);
  background: var(--skin-toolbar);
  box-shadow: 0 8px 24px var(--skin-shadow);
}
.rename-editor[hidden] { display: none; }
.rename-editor form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px 60px;
  gap: 6px;
  border: 0;
}
.rename-editor input {
  height: 26px;
  border: 1px solid var(--skin-border);
}
.rename-editor button {
  min-width: 0;
  height: 26px;
  padding: 0 6px;
}
.rename-error {
  grid-column: 1 / -1;
  min-height: 16px;
  color: var(--skin-danger);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty pre { display: grid; place-items: center; color: var(--skin-muted); }
.holding-drawer {
  position: fixed;
  z-index: 10;
  inset: 0 auto 0 0;
  width: min(360px, 100vw);
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px;
  transform: translateX(-100%);
  transition: transform 140ms ease;
  filter: drop-shadow(0 8px 18px var(--skin-shadow));
  overflow: hidden;
  pointer-events: none;
}
body.holding-open .holding-drawer {
  transform: translateX(0);
  pointer-events: auto;
}
.holding-panel {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 8px;
  padding: 10px;
  border-right: 1px solid var(--skin-border);
  background: var(--skin-page);
  box-shadow: 1px 0 0 var(--skin-border) inset;
  overflow: hidden;
}
.holding-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 28px;
  align-items: center;
  gap: 8px;
  background: var(--skin-page);
}
.holding-header strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--skin-text);
}
.holding-count {
  color: var(--skin-muted);
  white-space: nowrap;
}
.holding-close,
.holding-tab {
  min-width: 0;
  padding: 0;
}
.holding-close { width: 28px; height: 26px; }
.holding-tab {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  align-items: center;
  justify-items: center;
  gap: 8px;
  width: 36px;
  min-height: 0;
  border-width: 0 1px 0 0;
  border-color: var(--skin-border);
  background: var(--skin-head);
}
.holding-tab span {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.holding-tab b {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  margin-bottom: 8px;
  padding: 0 4px;
  color: var(--skin-page);
  background: var(--skin-good);
}
.holding-tools {
  position: sticky;
  top: 34px;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
  padding-bottom: 2px;
  background: var(--skin-page);
}
.holding-tools input,
.holding-tools select {
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
}
.holding-list {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 2px;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.holding-item {
  flex: 0 0 auto;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  min-height: 44px;
  padding: 6px 8px;
  text-align: left;
  border-radius: 6px;
}
.holding-item-title,
.holding-item-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.holding-item-title { color: var(--skin-button-text); font-weight: 700; }
.holding-item-name { color: var(--skin-muted); font-size: 12px; }
.holding-empty {
  min-height: 72px;
  display: grid;
  place-items: center;
  padding: 12px;
  color: var(--skin-muted);
  border: 1px solid var(--skin-border);
  border-radius: 6px;
  text-align: center;
}
@media (max-width: 900px) {
  .toolbar { gap: 5px; }
  .toolbar > * { min-width: 0; }
  .toolbar .status:last-child { display: none; }
  .toolbar button { padding: 0 6px; }
  .toolbar select { max-width: 118px; }
  .board { gap: 6px; padding: 6px; }
}
@media (min-width: 641px) and (max-width: 900px) {
  .tile {
    --tile-head-height: 82px;
  }
  .tile::before {
    top: var(--tile-head-height);
  }
  .tile::after {
    inset: var(--tile-head-height) 0 32px 0;
  }
}
@media (max-width: 640px) {
  .toolbar {
    align-items: flex-start;
    overflow: hidden;
  }
  .toolbar button {
    flex: 0 0 auto;
    padding: 0 5px;
  }
  .toolbar select {
    flex: 0 1 94px;
    max-width: 104px;
    padding: 0 4px;
  }
  .toolbar .spacer,
  .toolbar .status {
    display: none;
  }
  .board-label {
    flex-basis: 132px;
    max-width: 132px;
  }
  .board {
    grid-template-columns: 1fr;
    grid-template-rows: none;
    grid-auto-rows: minmax(260px, 44vh);
  }
  .tile { min-height: 260px; }
  .tile::before { top: var(--tile-head-height); }
  .tile::after { inset: var(--tile-head-height) 0 32px 0; }
  .head {
    grid-template-rows: 23px 24px;
    padding-inline: 5px;
  }
  .head-main {
    grid-template-columns: 28px minmax(0, 1fr) minmax(70px, 92px);
    gap: 5px;
  }
  .meta { display: none; }
  .head select { min-width: 0; }
  .head-actions { overflow-x: auto; }
  .head button {
    min-width: 25px;
    max-width: 34px;
    padding: 0 2px;
    font-size: 11px;
  }
  .holding-drawer { width: min(330px, 100vw); }
}
.holding-item[draggable="true"] { cursor: grab; }
</style>
</head>
<body data-skin="system" data-build="${TERMINALTOWN_BUILD_TAG}">
<audio id="purrSound" src="${purrSrc}" preload="auto"></audio>
<div class="disco-lightwash" aria-hidden="true"><span class="wash-a"></span><span class="wash-b"></span><span class="wash-c"></span></div>
<div class="disco-party-dim" aria-hidden="true"></div>
<div class="disco-refractions" aria-hidden="true"><img class="disco-refraction-map" src="${refractionSrc}" alt=""></div>
<div class="disco-ball" aria-hidden="true"><span class="disco-disc"><img class="disco-gif" src="${discoBallSrc}" alt=""></span></div>
<div class="page">
  <div class="kart-layer" aria-hidden="true">
    <span class="kart kart-1"></span>
    <span class="kart kart-2"></span>
    <span class="kart kart-3"></span>
    <span class="kart kart-4"></span>
    <span class="smoke smoke-1"></span>
    <span class="smoke smoke-2"></span>
    <span class="smoke smoke-3"></span>
  </div>
  <div class="toolbar">
    <button id="toggleToolbar" class="toolbar-toggle" type="button" title="Hide page controls" aria-label="Hide page controls" aria-expanded="true">-</button>
    <button id="newBoard">New Board</button>
    <button id="openBoard">Boards</button>
    <button id="openMap" hidden>Map</button>
    <button id="toggleHolding">Holding</button>
    <span class="board-label" id="boardLabel">TerminalTown</span>
    <select id="gridShape" title="Grid size">
      <option value="3x4">3x4</option>
      <option value="2x2">2x2</option>
      <option value="2x3">2x3</option>
      <option value="3x3">3x3</option>
      <option value="4x3">4x3</option>
      <option value="4x4">4x4</option>
    </select>
    <button id="newSession">New</button>
    <button id="newClaude">Claude</button>
    <button id="newCodex">Codex</button>
    <button id="refresh">Refresh</button>
    <button id="recover">Recover</button>
    <button id="reloadUi">Reload UI</button>
    <button id="reloadWindow" hidden>Reload VS Code</button>
    <button id="auto">Auto Fill</button>
    <button id="compact">Compact</button>
    <button id="sound">Sound On</button>
    <button id="playDisco">FX</button>
    <select id="skin" title="Board skin">
      <option value="system">System</option>
      <option value="circuit">Circuit</option>
      <option value="aurora">Aurora</option>
      <option value="daybook">Daybook</option>
      <option value="arcade">Arcade</option>
      <option value="mono">Mono</option>
      <option value="sepia">Sepia Night</option>
      <option value="disco">Disco</option>
    </select>
    <select id="motion" title="Board motion">
      <option value="subtle">Subtle</option>
      <option value="still">Still</option>
    </select>
    <span class="status" id="status">Starting...</span>
    <span class="spacer"></span>
    <span class="status">Click a panel, type a prompt, or press Esc for selected session.</span>
  </div>
  <div class="recovery" id="recovery"><span></span><button type="button">Recover</button></div>
  <div class="board-picker-backdrop" id="boardPicker" aria-hidden="true">
    <section class="board-picker" role="dialog" aria-modal="true" aria-labelledby="boardPickerTitle">
      <div class="board-picker-header">
        <strong id="boardPickerTitle">Boards</strong>
        <button type="button" class="board-picker-close" id="boardPickerClose" title="Close">X</button>
      </div>
      <div class="board-picker-list" id="boardPickerList"></div>
      <form class="board-picker-form" id="boardPickerForm">
        <input id="boardPickerInput" autocomplete="off" placeholder="Board ID" aria-label="Board ID">
        <button type="submit">Open</button>
      </form>
    </section>
  </div>
  <textarea id="clipboardProxy" class="clipboard-proxy" aria-hidden="true" tabindex="-1" autocomplete="off"></textarea>
  <main class="board" id="board"></main>
  <aside class="holding-drawer" id="holdingDrawer" aria-label="Holding sessions" aria-hidden="true">
    <div class="holding-panel">
      <div class="holding-header">
        <strong>Holding</strong>
        <span class="holding-count" id="holdingCount">0</span>
        <button type="button" class="holding-close" id="closeHolding" title="Close Holding drawer">X</button>
      </div>
      <div class="holding-tools">
        <input id="holdingSearch" autocomplete="off" placeholder="Search Holding" aria-label="Search Holding">
        <select id="holdingBoardFilter" title="Filter Holding by board" aria-label="Filter Holding by board">
          <option value="all">All boards</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <select id="holdingFilter" title="Filter Holding sessions" aria-label="Filter Holding sessions">
          <option value="all">All</option>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
          <option value="other">Shell/Other</option>
        </select>
        <select id="holdingSort" title="Sort Holding sessions" aria-label="Sort Holding sessions">
          <option value="recent">Recent</option>
          <option value="title">Title</option>
          <option value="name">Session</option>
        </select>
      </div>
      <div class="holding-list" id="holding"></div>
    </div>
    <button type="button" class="holding-tab" id="holdingTab" title="Open Holding drawer"><span>Holding</span><b id="holdingTabCount">0</b></button>
  </aside>
</div>
<script nonce="${n}">
const vscode = acquireVsCodeApi();
const board = document.getElementById('board');
const holding = document.getElementById('holding');
const holdingDrawer = document.getElementById('holdingDrawer');
const toggleHoldingButton = document.getElementById('toggleHolding');
const closeHoldingButton = document.getElementById('closeHolding');
const holdingTabButton = document.getElementById('holdingTab');
const holdingSearch = document.getElementById('holdingSearch');
const holdingBoardFilter = document.getElementById('holdingBoardFilter');
const holdingFilter = document.getElementById('holdingFilter');
const holdingSort = document.getElementById('holdingSort');
const holdingCount = document.getElementById('holdingCount');
const holdingTabCount = document.getElementById('holdingTabCount');
const kartLayer = document.querySelector('.kart-layer');
const kartEls = Array.from(document.querySelectorAll('.kart'));
const smokeEls = Array.from(document.querySelectorAll('.smoke'));
const statusEl = document.getElementById('status');
const clipboardProxy = document.getElementById('clipboardProxy');
const toolbar = document.querySelector('.toolbar');
const toggleToolbarButton = document.getElementById('toggleToolbar');
const newBoardButton = document.getElementById('newBoard');
const openBoardButton = document.getElementById('openBoard');
const openMapButton = document.getElementById('openMap');
const boardLabel = document.getElementById('boardLabel');
const gridShapeSelect = document.getElementById('gridShape');
const newButton = document.getElementById('newSession');
const newClaudeButton = document.getElementById('newClaude');
const newCodexButton = document.getElementById('newCodex');
const refreshButton = document.getElementById('refresh');
const recoverButton = document.getElementById('recover');
const reloadUiButton = document.getElementById('reloadUi');
const reloadWindowButton = document.getElementById('reloadWindow');
const autoButton = document.getElementById('auto');
const compactButton = document.getElementById('compact');
const soundButton = document.getElementById('sound');
const playDiscoButton = document.getElementById('playDisco');
const skinSelect = document.getElementById('skin');
const motionSelect = document.getElementById('motion');
const recoveryEl = document.getElementById('recovery');
const boardPicker = document.getElementById('boardPicker');
const boardPickerList = document.getElementById('boardPickerList');
const boardPickerClose = document.getElementById('boardPickerClose');
const boardPickerForm = document.getElementById('boardPickerForm');
const boardPickerInput = document.getElementById('boardPickerInput');
const purrSound = document.getElementById('purrSound');
const initialDiscoSettings = ${jsonForScript(initialDiscoSettings)};
let slotCount = 12;
let gridShape = '3x4';
const tiles = new Map();
const last = new Map();
let slotSessions = [];
let slotSpans = [];
let allSessions = [];
let titles = {};
let activeRenderedBoardId = '';
function syncTileControls(el) {
  if (!el) return;
  const collapsed = el.clientHeight < 340 || el.clientWidth < 340;
  el.classList.toggle('controls-collapsed', collapsed);
  if (!collapsed) {
    el.classList.remove('controls-open');
    const toggle = el.querySelector('.tools-toggle');
    if (toggle) {
      toggle.textContent = 'Tools';
      toggle.title = 'Show panel tools';
      toggle.setAttribute('aria-expanded', 'false');
    }
  }
}
const tileResizeObserver = window.ResizeObserver
  ? new ResizeObserver((entries) => entries.forEach((entry) => syncTileControls(entry.target)))
  : null;
let selectedSlot = 0;
let renamingSlot = null;
function migratedStorageValue(key, legacyKey, fallback) {
  const current = localStorage.getItem(key);
  if (current !== null) return current;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy !== null) {
    localStorage.setItem(key, legacy);
    return legacy;
  }
  return fallback;
}
let compact = migratedStorageValue('terminaltown-compact', 'terminaltown-public-compact', '0') === '1';
let sound = migratedStorageValue('terminaltown-sound', 'terminaltown-public-sound', '0') !== '0';
let skin = migratedStorageValue('terminaltown-skin', 'terminaltown-public-skin', 'system') || 'system';
let motion = migratedStorageValue('terminaltown-motion', 'terminaltown-public-motion', 'subtle') || 'subtle';
let holdingOpen = localStorage.getItem('terminaltown-holding-open') === '1';
let holdingNames = [];
let holdingBoards = [];
let holdingMembership = {};
let holdingQuery = localStorage.getItem('terminaltown-holding-query') || '';
let holdingBoardFilterValue = localStorage.getItem('terminaltown-holding-board-filter') || 'all';
let holdingFilterValue = localStorage.getItem('terminaltown-holding-filter') || 'all';
let holdingSortValue = localStorage.getItem('terminaltown-holding-sort') || 'recent';
let audioCtx = null;
let audioReady = false;
let renderSeen = false;
let arcadeTimers = new Set();
let arcadeTrack = null;
let arcadeKarts = [];
let arcadeLayoutSig = '';
let smokeCursor = 0;
const kartHitRadius = 11;
const chimeAt = new Map();
const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const DISCO_SPECTACLE_MS = 5400;
const spectacleHues = [320, 188, 48, 136, 278, 18, 214, 82, 344, 164, 6, 252];
let spectacleTimer = null;
let pendingRefresh = false;
let pendingData = null;
let initialDiscoSpectaclePending = skin === 'disco';
let pasteEventSerial = 0;
document.body.dataset.skin = skin;
document.body.dataset.motion = motion;
skinSelect.value = skin;
motionSelect.value = motion;
holdingSearch.value = holdingQuery;
holdingBoardFilter.value = holdingBoardFilterValue;
holdingFilter.value = holdingFilterValue;
holdingSort.value = holdingSortValue;
updateSoundButton();
setHoldingOpen(holdingOpen, false);
applyDiscoSettings(initialDiscoSettings);

holdingDrawer.addEventListener('dragover', (ev) => ev.preventDefault());
holdingDrawer.addEventListener('drop', (ev) => {
  ev.preventDefault();
  const payload = dragPayload(ev);
  if (Number.isInteger(payload.fromSlot)) post('assign', { slot: payload.fromSlot, session: '' });
});
holdingDrawer.addEventListener('keydown', (ev) => {
  ev.stopPropagation();
  if (ev.key === 'Escape') {
    ev.preventDefault();
    setHoldingOpen(false);
    focusClipboardProxy();
  }
});
toggleHoldingButton.addEventListener('click', () => setHoldingOpen(!holdingOpen));
holdingTabButton.addEventListener('click', () => setHoldingOpen(true));
closeHoldingButton.addEventListener('click', () => setHoldingOpen(false));
holdingSearch.addEventListener('input', () => {
  holdingQuery = holdingSearch.value || '';
  localStorage.setItem('terminaltown-holding-query', holdingQuery);
  renderHoldingList();
});
holdingBoardFilter.addEventListener('change', () => {
  holdingBoardFilterValue = holdingBoardFilter.value || 'all';
  localStorage.setItem('terminaltown-holding-board-filter', holdingBoardFilterValue);
  renderHoldingList();
});
holdingFilter.addEventListener('change', () => {
  holdingFilterValue = holdingFilter.value || 'all';
  localStorage.setItem('terminaltown-holding-filter', holdingFilterValue);
  renderHoldingList();
});
holdingSort.addEventListener('change', () => {
  holdingSortValue = holdingSort.value || 'recent';
  localStorage.setItem('terminaltown-holding-sort', holdingSortValue);
  renderHoldingList();
});

function note(msg) { statusEl.textContent = msg; }
function post(type, body) { vscode.postMessage(Object.assign({ type }, body || {})); }
function cleanInlineTitle(value) { return String(value || '').trim().replace(/\\s+/g, ' '); }
function closeRenameEditor(slot) {
  const targetSlot = Number.isInteger(slot) ? slot : renamingSlot;
  const el = Number.isInteger(targetSlot) ? tiles.get(targetSlot) : null;
  if (el) {
    const editor = el.querySelector('.rename-editor');
    if (editor) editor.hidden = true;
    el.classList.remove('renaming');
  }
  if (!Number.isInteger(slot) || renamingSlot === slot) renamingSlot = null;
}
function closeOtherRenameEditors(slot) {
  for (const [key] of tiles) {
    if (key !== slot) closeRenameEditor(key);
  }
}
function startRenameEditor(slot) {
  const session = slotSessions[slot] || '';
  if (!session) {
    note('No session in slot ' + (slot + 1));
    return;
  }
  setSelected(slot);
  closeOtherRenameEditors(slot);
  const el = tiles.get(slot);
  if (!el) return;
  const editor = el.querySelector('.rename-editor');
  const input = el.querySelector('.rename-input');
  const error = el.querySelector('.rename-error');
  if (!editor || !input || !error) return;
  input.value = titles[session] || session;
  error.textContent = '';
  editor.hidden = false;
  el.classList.add('renaming');
  renamingSlot = slot;
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}
function submitRenameEditor(slot) {
  const session = slotSessions[slot] || '';
  const el = tiles.get(slot);
  const input = el && el.querySelector('.rename-input');
  const error = el && el.querySelector('.rename-error');
  const title = cleanInlineTitle(input ? input.value : '');
  if (!session) {
    closeRenameEditor(slot);
    note('No session in slot ' + (slot + 1));
    return;
  }
  if (!title) {
    if (error) error.textContent = 'Enter a non-empty label.';
    if (input) input.focus();
    return;
  }
  closeRenameEditor(slot);
  note('Renaming ' + session + '...');
  post('rename', { slot, title });
}
function submitPrompt(slot, submitKey) {
  const el = tiles.get(slot);
  const input = el && el.querySelector('.prompt-input');
  const prompt = input ? input.value.trim() : '';
  if (!prompt) {
    post('key', { slot, key: submitKey || 'enter' });
    return;
  }
  input.value = '';
  post('prompt', { slot, prompt, submitKey: submitKey || 'enter' });
  burstRefresh();
}
function isClipboardProxy(target) {
  return Boolean(target && target.closest && target.closest('#clipboardProxy'));
}
function editableTarget(target) {
  if (isClipboardProxy(target)) return false;
  return Boolean(target && target.closest && target.closest('input,select,textarea,.rename-editor'));
}
function focusClipboardProxy() {
  if (!clipboardProxy) return;
  const active = document.activeElement;
  if (active && active !== document.body && editableTarget(active)) return;
  try {
    clipboardProxy.value = '';
    clipboardProxy.focus({ preventScroll: true });
    clipboardProxy.select();
  } catch {}
}
function selectedText() {
  const selection = window.getSelection && window.getSelection();
  return selection ? String(selection.toString() || '') : '';
}
function slotOutput(slot) {
  const el = tiles.get(slot);
  const pre = el && el.querySelector('pre');
  return pre ? String(pre.textContent || '') : '';
}
async function copySlot(slot) {
  const text = selectedText() || slotOutput(slot);
  if (!text) {
    note('Nothing to copy from slot ' + (slot + 1));
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    note('Copied slot ' + (slot + 1));
  } catch {
    post('copyText', { slot, text });
    note('Copying slot ' + (slot + 1) + '...');
  }
}
function pasteTextToSlot(slot, text) {
  const value = String(text || '');
  if (!value) return false;
  setSelected(slot);
  post('pasteText', { slot, text: value });
  note('Pasting text to slot ' + (slot + 1) + '...');
  burstRefresh();
  return true;
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('image paste read failed'));
    reader.readAsDataURL(file);
  });
}
async function clipboardImagesFromItems(items) {
  const images = [];
  for (const item of Array.from(items || [])) {
    if (!item || !String(item.type || '').startsWith('image/')) continue;
    const file = item.getAsFile && item.getAsFile();
    if (!file) continue;
    images.push({ type: file.type || item.type || 'image/png', dataUrl: await fileToDataUrl(file) });
  }
  return images;
}
async function pasteImagesToSlot(slot, images) {
  if (!images || !images.length) return false;
  setSelected(slot);
  post('pasteImages', { slot, images });
  note('Saving image paste for slot ' + (slot + 1) + '...');
  burstRefresh();
  return true;
}
async function readClipboardAndPaste(slot) {
  setSelected(slot);
  if (!navigator.clipboard) {
    post('pasteClipboardText', { slot });
    note('Pasting clipboard text to slot ' + (slot + 1) + '...');
    return;
  }
  if (navigator.clipboard.read) {
    try {
      const items = await navigator.clipboard.read();
      const images = [];
      for (const item of items || []) {
        for (const type of item.types || []) {
          if (!String(type).startsWith('image/')) continue;
          const blob = await item.getType(type);
          images.push({ type, dataUrl: await fileToDataUrl(blob) });
        }
      }
      if (await pasteImagesToSlot(slot, images)) return;
    } catch {}
  }
  try {
    if (navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (pasteTextToSlot(slot, text)) return;
    }
  } catch (e) {
    post('pasteClipboardText', { slot });
    note('Pasting clipboard text to slot ' + (slot + 1) + '...');
    return;
  }
  post('pasteClipboardText', { slot });
  note('Pasting clipboard text to slot ' + (slot + 1) + '...');
}
function spectacleActive() { return document.body.dataset.spectacle === 'disco'; }
function captureLinesBySlotHint() {
  const hints = {};
  for (const [slot, el] of tiles) {
    if (!slotSessions[slot] || el.classList.contains('covered')) continue;
    const pre = el.querySelector('pre');
    if (!pre) continue;
    const styles = getComputedStyle(pre);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 16;
    const visibleRows = Math.max(1, Math.ceil((pre.clientHeight || 0) / lineHeight));
    hints[slot] = Math.min(1200, Math.max(24, visibleRows + 80));
  }
  return hints;
}
function terminalSizesBySlotHint() {
  const hints = {};
  for (const [slot, el] of tiles) {
    if (!slotSessions[slot] || el.classList.contains('covered')) continue;
    const pre = el.querySelector('pre');
    if (!pre) continue;
    const styles = getComputedStyle(pre);
    const fontSize = Number.parseFloat(styles.fontSize) || 12;
    const lineHeight = Number.parseFloat(styles.lineHeight) || 16;
    const charWidth = Math.max(6, fontSize * 0.62);
    hints[slot] = {
      cols: Math.max(40, Math.min(320, Math.floor(Math.max(0, pre.clientWidth - 16) / charWidth))),
      rows: Math.max(12, Math.min(180, Math.floor(Math.max(0, pre.clientHeight - 14) / lineHeight))),
    };
  }
  return hints;
}
function requestRefresh(options = {}) {
  if (!options.force && spectacleActive()) {
    pendingRefresh = true;
    return;
  }
  post('refresh', { focusedSlot: selectedSlot, force: Boolean(options.force), captureLinesBySlot: captureLinesBySlotHint(), terminalSizesBySlot: terminalSizesBySlotHint() });
}
function applyDiscoSettings(raw) {
  const settings = raw || {};
  const clampSetting = (value, fallback, lo, hi) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  const shave = clampSetting(settings.maskShavePx, 0, 0, 48);
  const scale = clampSetting(settings.scalePct, 115, 60, 180) / 100;
  const visibleCenterTopPx = clampSetting(settings.visibleCenterTopPx, 4, 0, 24);
  const stringJoinOverlapPx = clampSetting(settings.stringJoinOverlapPx, 2, 0, 12);
  const refractionOpacity = clampSetting(settings.refractionOpacityPct, 62, 0, 100) / 100;
  const refractionSize = clampSetting(settings.refractionSizeVmax, 142, 80, 190);
  const refractionTurn = clampSetting(settings.refractionTurnDeg, 81, -90, 120);
  const size = Math.round(${DISCO_GIF_WIDTH} * scale);
  const gifWidth = Math.round(${DISCO_GIF_WIDTH} * scale);
  const gifHeight = Math.round(${DISCO_GIF_HEIGHT} * scale);
  const anchorLiftY = Math.max(0, Math.round(((size - gifHeight) / 2) + (visibleCenterTopPx * scale) + stringJoinOverlapPx));
  const right = Math.round(26 - ((size - ${DISCO_GIF_WIDTH}) / 2));
  const hue = clampSetting(settings.hueDeg, 4, -180, 180);
  const sat = clampSetting(settings.saturationPct, 112, 0, 220);
  const bright = clampSetting(settings.brightnessPct, 85, 40, 180);
  document.body.style.setProperty('--disco-shave', shave + 'px');
  document.body.style.setProperty('--disco-size', size + 'px');
  document.body.style.setProperty('--disco-gif-width', gifWidth + 'px');
  document.body.style.setProperty('--disco-gif-height', gifHeight + 'px');
  document.body.style.setProperty('--disco-anchor-lift-y', anchorLiftY + 'px');
  document.body.style.setProperty('--disco-half-size', Math.round(size / 2) + 'px');
  document.body.style.setProperty('--disco-right', right + 'px');
  document.body.style.setProperty('--disco-hue', hue + 'deg');
  document.body.style.setProperty('--disco-sat', sat + '%');
  document.body.style.setProperty('--disco-bright', bright + '%');
  document.body.style.setProperty('--disco-refraction-opacity', refractionOpacity);
  document.body.style.setProperty('--disco-refraction-idle-opacity', Math.max(0, Math.min(0.5, refractionOpacity * 0.72)));
  document.body.style.setProperty('--disco-refraction-size', refractionSize + 'vmax');
  document.body.style.setProperty('--disco-refraction-scale', Math.max(4.2, Math.min(7.4, refractionSize / 27)));
  document.body.style.setProperty('--disco-refraction-scale-y', Math.max(3.8, Math.max(4.2, Math.min(7.4, refractionSize / 27)) * 0.92));
  document.body.style.setProperty('--disco-refraction-turn', refractionTurn + 'deg');
}
function seedSpectacleHues() {
  for (const [slot, el] of tiles) {
    const hue = spectacleHues[slot % spectacleHues.length];
    el.style.setProperty('--spectacle-hue', String(hue));
    el.style.setProperty('--spectacle-delay', '-' + ((slot * 70) % 360) + 'ms');
  }
}
function canRunDiscoSpectacle() {
  return skin === 'disco';
}
function startDiscoSpectacle() {
  if (!canRunDiscoSpectacle()) return;
  seedSpectacleHues();
  pendingRefresh = true;
  if (spectacleActive()) {
    delete document.body.dataset.spectacle;
    void document.body.offsetWidth;
  }
  document.body.dataset.spectacle = 'disco';
  post('spectacle', { name: 'disco', phase: 'start', durationMs: DISCO_SPECTACLE_MS, focusedSlot: selectedSlot });
  clearTimeout(spectacleTimer);
  spectacleTimer = setTimeout(endDiscoSpectacle, DISCO_SPECTACLE_MS);
}
function endDiscoSpectacle() {
  clearTimeout(spectacleTimer);
  spectacleTimer = null;
  if (spectacleActive()) delete document.body.dataset.spectacle;
  post('spectacle', { name: 'disco', phase: 'end', focusedSlot: selectedSlot });
  const data = pendingData;
  pendingData = null;
  if (data) render(data);
  if (pendingRefresh || !data) {
    pendingRefresh = false;
    requestRefresh({ force: true });
    setTimeout(() => requestRefresh({ force: true }), 700);
  }
}
function cancelDiscoSpectacle() {
  if (!spectacleTimer && !spectacleActive()) return;
  clearTimeout(spectacleTimer);
  spectacleTimer = null;
  if (spectacleActive()) delete document.body.dataset.spectacle;
  post('spectacle', { name: 'disco', phase: 'end', focusedSlot: selectedSlot });
  if (pendingData) {
    const data = pendingData;
    pendingData = null;
    render(data);
  }
  if (pendingRefresh) {
    pendingRefresh = false;
    requestRefresh({ force: true });
  }
}
function burstRefresh() {
  requestRefresh();
  setTimeout(requestRefresh, 800);
  setTimeout(requestRefresh, 1800);
  setTimeout(requestRefresh, 3500);
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function dragPayload(ev) {
  try { return JSON.parse(ev.dataTransfer.getData('application/json') || '{}'); } catch { return {}; }
}
function fingerprint(output) {
  return String(output || '').split('\\n').map((s) => s.trim()).filter(Boolean)
    .filter((s) => !/tokens?|weekly limit|interrupt/i.test(s))
    .slice(-8).join('\\n');
}
function looksWorking(output) {
  return /working|thinking|running|reading|editing|searching|building|testing/i.test(String(output || '').split('\\n').slice(-10).join('\\n'));
}
function updateSoundButton() {
  soundButton.textContent = sound ? 'Sound On' : 'Sound Off';
  soundButton.title = sound ? 'Purr when a visible agent reaches final/needs-input state' : 'Chimes disabled';
}
async function unlockAudio() {
  if (!sound) return;
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    audioCtx = audioCtx || new AudioCtor();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    audioReady = audioCtx.state === 'running';
  } catch {
    audioReady = false;
  }
}
function playChime(session) {
  if (!sound) return;
  const now = Date.now();
  if (now - (chimeAt.get(session) || 0) < 30000) return;
  chimeAt.set(session, now);
  if (purrSound && purrSound.src) {
    try {
      purrSound.pause();
      purrSound.currentTime = 0;
      purrSound.volume = 0.55;
      const played = purrSound.play();
      if (played && played.catch) played.catch(() => playSynthChime());
      return;
    } catch {}
  }
  playSynthChime();
}
function playSynthChime() {
  if (!audioReady || !audioCtx) return;
  const start = audioCtx.currentTime;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.045, start + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
  gain.connect(audioCtx.destination);
  for (const [freq, delay, level] of [[880, 0, 1], [1320, 0.035, 0.42]]) {
    const osc = audioCtx.createOscillator();
    const trim = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start + delay);
    trim.gain.setValueAtTime(level, start + delay);
    osc.connect(trim);
    trim.connect(gain);
    osc.start(start + delay);
    osc.stop(start + 0.44);
  }
  setTimeout(() => gain.disconnect(), 520);
}
function maybeChime(session, noticeKey, state, prev) {
  if (!renderSeen || !session || state !== 'waiting' || !noticeKey) return;
  if (!prev || prev.name !== session || prev.noticeKey === noticeKey) return;
  playChime(session);
}
function setSelected(slot, options = {}) {
  const changed = selectedSlot !== slot;
  selectedSlot = slot;
  for (const [key, el] of tiles) el.classList.toggle('selected', Number(key) === slot);
  if (options.focusProxy !== false) focusClipboardProxy();
  if (changed) {
    post('focusSlot', { slot });
    requestRefresh();
  }
}
function reflowCapturedOutput(text) {
  const lines = String(text || '').split('\\n');
  const output = [];
  const controlLine = /^(?:[>#$]|[-*+] |[0-9]+[.)] |[■□◼◻✻❯✔]|[-─]{3,})/;
  for (const line of lines) {
    const previous = output[output.length - 1];
    const prevTrimmed = String(previous || '').trimEnd();
    const nextTrimmed = line.trim();
    const join = prevTrimmed.length >= 52 && nextTrimmed &&
      !/[.!?;:…]$/.test(prevTrimmed) &&
      !controlLine.test(prevTrimmed) && !controlLine.test(nextTrimmed) &&
      /^[a-z("']/.test(nextTrimmed) && /[A-Za-z0-9,)]$/.test(prevTrimmed);
    if (join) output[output.length - 1] = prevTrimmed + ' ' + nextTrimmed;
    else output.push(line);
  }
  return output.join('\\n');
}
function renderTerminalOutput(pre, text) {
  const rawValue = String(text || '');
  if (pre._terminaltownRawOutput === rawValue) return;
  pre._terminaltownRawOutput = rawValue;
  const value = reflowCapturedOutput(rawValue);
  pre.textContent = '';
  const fragment = document.createDocumentFragment();
  const re = /https?:\\/\\/[^\\s<>"']+/g;
  let lastIndex = 0;
  let match;
  while ((match = re.exec(value))) {
    if (match.index > lastIndex) fragment.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
    const raw = match[0];
    const trailing = raw.match(/[),.;:!?\\]]+$/);
    const suffix = trailing ? trailing[0] : '';
    const href = suffix ? raw.slice(0, -suffix.length) : raw;
    const link = document.createElement('a');
    link.href = href;
    link.textContent = href;
    link.title = 'Open ' + href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    fragment.appendChild(link);
    if (suffix) fragment.appendChild(document.createTextNode(suffix));
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < value.length) fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
  pre.appendChild(fragment);
}
function currentColumns() {
  const value = getComputedStyle(board).gridTemplateColumns.trim();
  return value ? value.split(/\\s+/).length : 3;
}
function coveredSlots(columns) {
  const covered = new Set();
  for (let slot = 0; slot < slotCount; slot += 1) {
    if (!slotSessions[slot] || slotSpans[slot] !== 2) continue;
    const below = slot + columns;
    if (below < slotCount) covered.add(below);
  }
  return covered;
}
function placeTiles() {
  const columns = currentColumns();
  const covered = coveredSlots(columns);
  for (const [slot, el] of tiles) {
    const span = !covered.has(slot) && slotSessions[slot] && slotSpans[slot] === 2 && slot + columns < slotCount ? 2 : 1;
    el.style.gridColumn = String((slot % columns) + 1);
    el.style.gridRow = String(Math.floor(slot / columns) + 1) + ' / span ' + span;
    el.classList.toggle('covered', covered.has(slot));
    el.classList.toggle('row-span-2', span === 2);
  }
  syncArcade();
}
function arcadeActive() {
  return skin === 'arcade' && motion === 'subtle' && !(reduceMotion && reduceMotion.matches);
}
function arcadeLayoutSignature() {
  if (!kartLayer) return '';
  const lr = kartLayer.getBoundingClientRect();
  if (lr.width < 120 || lr.height < 120) return '';
  const parts = [Math.round(lr.width), Math.round(lr.height), currentColumns()];
  for (const [slot, el] of tiles) {
    if (el.classList.contains('covered')) {
      parts.push(slot + ':covered');
      continue;
    }
    const r = el.getBoundingClientRect();
    parts.push([
      slot,
      Math.round(r.left - lr.left),
      Math.round(r.top - lr.top),
      Math.round(r.width),
      Math.round(r.height),
    ].join(':'));
  }
  return parts.join('|');
}
function buildArcadeTrack() {
  if (!kartLayer) return null;
  const lr = kartLayer.getBoundingClientRect();
  const cs = getComputedStyle(board);
  const gap = Math.min(Number.parseFloat(cs.columnGap) || 22, Number.parseFloat(cs.rowGap) || 22);
  const lane = Math.max(8, Math.min(11, gap / 2));
  const horizontals = [];
  const verticals = [];
  for (const el of tiles.values()) {
    if (el.classList.contains('covered')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) continue;
    const x1 = clamp(Math.round(r.left - lr.left - lane), 0, Math.max(0, lr.width - 1));
    const x2 = clamp(Math.round(r.right - lr.left + lane), 0, Math.max(0, lr.width - 1));
    const y1 = clamp(Math.round(r.top - lr.top - lane), 0, Math.max(0, lr.height - 1));
    const y2 = clamp(Math.round(r.bottom - lr.top + lane), 0, Math.max(0, lr.height - 1));
    if (x2 - x1 < 24 || y2 - y1 < 24) continue;
    horizontals.push({ y: y1, x1, x2 }, { y: y2, x1, x2 });
    verticals.push({ x: x1, y1, y2 }, { x: x2, y1, y2 });
  }
  if (!horizontals.length || !verticals.length) return null;

  const nodes = [];
  const ids = new Map();
  const edges = new Map();
  function nodeId(x, y) {
    const key = Math.round(x) + ',' + Math.round(y);
    if (ids.has(key)) return ids.get(key);
    const id = nodes.length;
    ids.set(key, id);
    nodes.push({ x: Math.round(x), y: Math.round(y) });
    edges.set(id, new Set());
    return id;
  }
  function edge(a, b) {
    if (a === b) return;
    edges.get(a).add(b);
    edges.get(b).add(a);
  }
  function uniq(values) {
    const out = [];
    for (const v of values.map((n) => Math.round(n)).sort((a, b) => a - b)) {
      if (!out.length || Math.abs(v - out[out.length - 1]) > 2) out.push(v);
    }
    return out;
  }

  for (const h of horizontals) {
    const xs = [h.x1, h.x2];
    for (const v of verticals) {
      if (v.x >= h.x1 - 1 && v.x <= h.x2 + 1 && h.y >= v.y1 - 1 && h.y <= v.y2 + 1) xs.push(v.x);
    }
    const points = uniq(xs);
    for (let i = 0; i < points.length - 1; i += 1) {
      if (points[i + 1] - points[i] < 8) continue;
      edge(nodeId(points[i], h.y), nodeId(points[i + 1], h.y));
    }
  }
  for (const v of verticals) {
    const ys = [v.y1, v.y2];
    for (const h of horizontals) {
      if (h.y >= v.y1 - 1 && h.y <= v.y2 + 1 && v.x >= h.x1 - 1 && v.x <= h.x2 + 1) ys.push(h.y);
    }
    const points = uniq(ys);
    for (let i = 0; i < points.length - 1; i += 1) {
      if (points[i + 1] - points[i] < 8) continue;
      edge(nodeId(v.x, points[i]), nodeId(v.x, points[i + 1]));
    }
  }
  if (nodes.length < 4) return null;
  return { nodes, edges, w: lr.width, h: lr.height };
}
function resetArcadeTrack() {
  arcadeTrack = null;
  arcadeLayoutSig = '';
}
function pointAt(id) {
  return arcadeTrack.nodes[id];
}
function neighbors(kart) {
  const here = pointAt(kart.node);
  return Array.from(arcadeTrack.edges.get(kart.node) || []).map((id) => {
    const p = pointAt(id);
    const dx = Math.sign(p.x - here.x);
    const dy = Math.sign(p.y - here.y);
    const a = dx < 0 ? 180 : dx > 0 ? 0 : dy < 0 ? 270 : 90;
    return { id, dx, dy, a };
  });
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function arcadeNow() {
  return window.performance ? window.performance.now() : Date.now();
}
function projectedKartPoint(kart, at = arcadeNow()) {
  if (!kart.moving || !arcadeTrack || kart.from === kart.target) return { x: kart.x, y: kart.y };
  const from = pointAt(kart.from);
  const to = pointAt(kart.target);
  const span = Math.max(1, kart.arriveAt - kart.departAt);
  const t = clamp((at - kart.departAt) / span, 0, 1);
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}
function nearestRival(kart) {
  let best = null;
  const here = projectedKartPoint(kart);
  for (const other of arcadeKarts) {
    if (other === kart || other.crashed) continue;
    const point = projectedKartPoint(other);
    const d = dist(here, point);
    if (!best || d < best.d) best = { kart: other, point, d };
  }
  return best;
}
function chooseTurn(kart) {
  const rival = nearestRival(kart);
  const options = neighbors(kart);
  if (!options.length) return;
  const close = rival && rival.d < 145;
  let best = options[0];
  let bestScore = -Infinity;
  for (const option of options) {
    const p = pointAt(option.id);
    const d = rival ? dist(p, rival.point) : 0;
    let score = close ? d : -d;
    if (option.dx === kart.dx && option.dy === kart.dy) score += close ? -18 : 28;
    if (option.dx === -kart.dx && option.dy === -kart.dy) score -= 36;
    score += (Math.random() - 0.5) * 90;
    if (score > bestScore) {
      bestScore = score;
      best = option;
    }
  }
  kart.dx = best.dx;
  kart.dy = best.dy;
  kart.angle = best.a;
  kart.target = best.id;
  kart.turnBoost = 0.74 + Math.random() * 0.18;
}
function placeKart(kart, node) {
  const p = pointAt(node);
  kart.from = node;
  kart.node = node;
  kart.target = node;
  kart.x = p.x;
  kart.y = p.y;
  kart.moving = false;
  kart.departAt = 0;
  kart.arriveAt = 0;
  chooseTurn(kart);
}
function nearestNode(x, y) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < arcadeTrack.nodes.length; i += 1) {
    const d = Math.hypot(arcadeTrack.nodes[i].x - x, arcadeTrack.nodes[i].y - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
function initArcade() {
  arcadeTrack = buildArcadeTrack();
  if (!arcadeTrack) return false;
  const starts = [
    nearestNode(0, 0),
    nearestNode(arcadeTrack.w, arcadeTrack.h),
    nearestNode(arcadeTrack.w / 2, 0),
    nearestNode(0, arcadeTrack.h / 2),
  ];
  arcadeKarts = kartEls.map((el, i) => ({
    el,
    node: 0,
    target: 0,
    x: 0,
    y: 0,
    from: 0,
    dx: 1,
    dy: 0,
    angle: 0,
    speed: 115 + i * 18 + Math.random() * 34,
    jitterSeed: i * 11,
    seq: 0,
    moving: false,
    departAt: 0,
    arriveAt: 0,
    crashed: false,
  }));
  for (let i = 0; i < arcadeKarts.length; i += 1) {
    placeKart(arcadeKarts[i], starts[i]);
    kartEls[i].style.transition = 'none';
    renderKart(arcadeKarts[i], i);
  }
  return true;
}
function renderKart(kart, tick) {
  const jitter = ((tick + kart.jitterSeed) % 3) - 1;
  kart.el.style.transform = 'translate3d(' + Math.round(kart.x - 11 + jitter) + 'px,' + Math.round(kart.y - 8 - jitter) + 'px,0) rotate(' + kart.angle + 'deg)';
}
function puffSmoke(x, y) {
  if (!smokeEls.length) return;
  const smoke = smokeEls[smokeCursor % smokeEls.length];
  smokeCursor += 1;
  smoke.style.setProperty('--smoke-x', Math.round(x - 13) + 'px');
  smoke.style.setProperty('--smoke-y', Math.round(y - 9) + 'px');
  smoke.classList.remove('boom');
  void smoke.offsetWidth;
  smoke.classList.add('boom');
}
function schedule(fn, ms) {
  const id = setTimeout(() => {
    arcadeTimers.delete(id);
    fn();
  }, ms);
  arcadeTimers.add(id);
  return id;
}
function crash(a, b, point) {
  if (a.crashed || b.crashed) return;
  a.seq += 1;
  b.seq += 1;
  a.crashed = true;
  b.crashed = true;
  a.moving = false;
  b.moving = false;
  a.el.classList.add('crashed');
  b.el.classList.add('crashed');
  puffSmoke(point ? point.x : (a.x + b.x) / 2, point ? point.y : (a.y + b.y) / 2);
  schedule(() => {
    if (!arcadeActive() || !arcadeTrack) return;
    for (const kart of [a, b]) {
      kart.crashed = false;
      kart.el.classList.remove('crashed');
      kart.speed = 120 + Math.random() * 88;
      placeKart(kart, Math.floor(Math.random() * arcadeTrack.nodes.length));
      kart.el.style.transition = 'none';
      renderKart(kart, kart.seq);
      schedule(() => moveKart(kart), 90 + Math.random() * 160);
    }
  }, 620);
}
function checkCrashes(kart) {
  const now = arcadeNow();
  const here = projectedKartPoint(kart, now);
  for (let i = 0; i < arcadeKarts.length; i += 1) {
    const other = arcadeKarts[i];
    if (other === kart || other.crashed || kart.crashed) continue;
    const there = projectedKartPoint(other, now);
    if (dist(here, there) <= kartHitRadius) {
      crash(kart, other, { x: (here.x + there.x) / 2, y: (here.y + there.y) / 2 });
      return true;
    }
  }
  return false;
}
function sameLaneCollisionTime(a, b) {
  if (!a.moving || !b.moving || a.crashed || b.crashed) return null;
  const a0 = pointAt(a.from);
  const a1 = pointAt(a.target);
  const b0 = pointAt(b.from);
  const b1 = pointAt(b.target);
  const horizontal = a0.y === a1.y && b0.y === b1.y && a0.y === b0.y;
  const vertical = a0.x === a1.x && b0.x === b1.x && a0.x === b0.x;
  if (!horizontal && !vertical) return null;
  const axis = horizontal ? 'x' : 'y';
  const av = (a1[axis] - a0[axis]) / Math.max(1, a.arriveAt - a.departAt);
  const bv = (b1[axis] - b0[axis]) / Math.max(1, b.arriveAt - b.departAt);
  if (Math.abs(av - bv) < 0.001) return null;
  const t = (b0[axis] - a0[axis] + av * a.departAt - bv * b.departAt) / (av - bv);
  const earliest = Math.max(a.departAt, b.departAt);
  const latest = Math.min(a.arriveAt, b.arriveAt);
  if (t < earliest || t > latest) return null;
  const ap = projectedKartPoint(a, t);
  const bp = projectedKartPoint(b, t);
  if (dist(ap, bp) > kartHitRadius) return null;
  return { t, point: { x: (ap.x + bp.x) / 2, y: (ap.y + bp.y) / 2 } };
}
function scheduleLaneCollision(kart, token) {
  let hit = null;
  for (const other of arcadeKarts) {
    if (other === kart || other.crashed) continue;
    const collision = sameLaneCollisionTime(kart, other);
    if (collision && (!hit || collision.t < hit.t)) hit = { other, t: collision.t, point: collision.point };
  }
  if (!hit) return;
  schedule(() => {
    if (!arcadeActive() || !arcadeTrack || kart.crashed || hit.other.crashed || kart.seq !== token) return;
    const here = projectedKartPoint(kart);
    const there = projectedKartPoint(hit.other);
    if (dist(here, there) <= kartHitRadius) {
      crash(kart, hit.other, { x: (here.x + there.x) / 2, y: (here.y + there.y) / 2 });
    }
  }, Math.max(0, hit.t - arcadeNow()));
}
function moveKart(kart) {
  if (!arcadeActive() || !arcadeTrack || kart.crashed) return;
  if (checkCrashes(kart)) return;
  const token = ++kart.seq;
  const now = arcadeNow();
  const from = pointAt(kart.node);
  const target = pointAt(kart.target);
  const d = dist(from, target);
  const rival = nearestRival(kart);
  const panic = rival && rival.d < 110 ? 1.28 : 1;
  const duration = clamp(Math.round((d / (kart.speed * panic)) * 1000 * (kart.turnBoost || 1)), 130, 1250);
  kart.from = kart.node;
  kart.moving = true;
  kart.departAt = now;
  kart.arriveAt = now + duration;
  kart.el.style.transition = 'transform ' + duration + 'ms linear, opacity 120ms steps(2, end)';
  kart.x = target.x;
  kart.y = target.y;
  renderKart(kart, token);
  scheduleLaneCollision(kart, token);
  schedule(() => {
    if (!arcadeActive() || !arcadeTrack || kart.crashed || kart.seq !== token) return;
    kart.node = kart.target;
    kart.from = kart.node;
    kart.moving = false;
    if (checkCrashes(kart)) return;
    chooseTurn(kart);
    const brake = Math.round(35 + Math.random() * 85);
    schedule(() => moveKart(kart), brake);
  }, duration);
}
function startArcade() {
  if (arcadeTimers.size && arcadeTrack) return;
  for (const id of arcadeTimers) clearTimeout(id);
  arcadeTimers.clear();
  if (!initArcade()) {
    arcadeLayoutSig = '';
    return;
  }
  for (const kart of arcadeKarts) {
    schedule(() => moveKart(kart), 80 + Math.random() * 220);
  }
}
function stopArcade() {
  for (const id of arcadeTimers) clearTimeout(id);
  arcadeTimers.clear();
  arcadeTrack = null;
  arcadeKarts = [];
  arcadeLayoutSig = '';
  for (const el of kartEls) {
    el.classList.remove('crashed');
    el.style.transform = '';
  }
  for (const el of smokeEls) el.classList.remove('boom');
}
function syncArcade() {
  if (!arcadeActive()) {
    stopArcade();
    return;
  }
  const sig = arcadeLayoutSignature();
  if (!sig) {
    stopArcade();
    return;
  }
  if (arcadeTimers.size && arcadeTrack && arcadeLayoutSig === sig) return;
  stopArcade();
  arcadeLayoutSig = sig;
  startArcade();
}
function makeOptions(select, selected) {
  const names = [''].concat(selected && !allSessions.includes(selected) ? [selected] : [], allSessions);
  const sig = names.join('\\u0000') + '\\u0001' + selected + '\\u0001' + JSON.stringify(titles);
  if (select.dataset.sig === sig) return;
  select.innerHTML = '';
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name ? ((titles[name] || name) + (allSessions.includes(name) ? '' : ' (missing)')) : 'Assign';
    option.selected = name === selected;
    option.title = name;
    select.appendChild(option);
  }
  select.dataset.sig = sig;
}
function createTile(slot) {
  const el = document.createElement('section');
  el.className = 'tile';
  el.dataset.slot = String(slot);
  el.innerHTML = '<div class="resize-edge resize-top" title="Drag up to span upward; drag down to shrink"></div><div class="resize-edge resize-bottom" title="Drag down to span downward; drag up to shrink"></div><div class="head" draggable="true"><div class="head-main"><span class="idx"></span><span class="name"></span><span class="meta"></span><select title="Assign session"></select><button type="button" class="tools-toggle" title="Show panel tools" aria-label="Show panel tools" aria-expanded="false">Tools</button></div><div class="head-actions"><button type="button" class="openTerm" title="Open this local tmux session in macOS Terminal">Tm</button><button type="button" class="rename" title="Rename label">Nm</button><button type="button" class="hold" title="Move to holding">Hld</button><button type="button" class="bye" title="End this tmux session">Bye</button><button type="button" class="shiftTab" title="Send Shift+Tab">S-T</button><button type="button" class="tab" title="Send Tab">Tab</button><button type="button" class="enter" title="Send Enter">Ent</button><button type="button" class="esc" title="Send Escape">Esc</button><button type="button" class="ctrlc" title="Send Ctrl-C">C-c</button><button type="button" class="copy" title="Copy selected text or visible output">Cp</button><button type="button" class="paste" title="Paste clipboard text or image path">Pst</button></div></div><pre class="terminal-output"></pre><form><input class="prompt-input" autocomplete="off" placeholder="Prompt"><button type="submit">Send</button></form>';
  const renameEditor = document.createElement('div');
  renameEditor.className = 'rename-editor';
  renameEditor.hidden = true;
  renameEditor.innerHTML = '<form class="rename-label-form"><input class="rename-input" autocomplete="off" aria-label="Session label"><button type="submit">OK</button><button type="button" class="rename-cancel">Cancel</button><div class="rename-error"></div></form>';
  el.appendChild(renameEditor);
  board.appendChild(el);
  tiles.set(slot, el);
  if (tileResizeObserver) tileResizeObserver.observe(el);
  syncTileControls(el);
  el.addEventListener('pointerdown', (ev) => {
    setSelected(slot, { focusProxy: !ev.target.closest('pre,a') });
  });
  el.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', (ev) => {
    ev.preventDefault();
    el.classList.remove('drop-target');
    const payload = dragPayload(ev);
    if (Number.isInteger(payload.fromSlot)) post('move', { fromSlot: payload.fromSlot, toSlot: slot });
    else if (payload.session) post('move', { session: payload.session, toSlot: slot });
  });
  el.querySelector('.head').addEventListener('dragstart', (ev) => {
    const session = slotSessions[slot] || '';
    if (!session) {
      ev.preventDefault();
      return;
    }
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('application/json', JSON.stringify({ fromSlot: slot, session }));
    ev.dataTransfer.setData('text/plain', session);
  });
  function finishResize(direction, startY, ev) {
    const delta = ev.clientY - startY;
    if (Math.abs(delta) < 24 || !slotSessions[slot]) return;
    const currentSpan = slotSpans[slot] || 1;
    if (direction === 'bottom') {
      if (delta > 0) post('resize', { slot, direction: 'down', columns: currentColumns(), span: 2 });
      else if (currentSpan === 2) post('resize', { slot, columns: currentColumns(), span: 1 });
    } else {
      if (delta < 0) post('resize', { slot, direction: 'up', columns: currentColumns(), span: 2 });
      else if (currentSpan === 2) post('resize', { slot, columns: currentColumns(), span: 1 });
    }
  }
  for (const direction of ['top', 'bottom']) {
    const handle = el.querySelector('.resize-' + direction);
    handle.addEventListener('pointerdown', (ev) => {
      if (!slotSessions[slot]) return;
      ev.preventDefault();
      ev.stopPropagation();
      const startY = ev.clientY;
      const id = ev.pointerId;
      handle.setPointerCapture(id);
      const done = (endEv) => {
        try { handle.releasePointerCapture(id); } catch {}
        finishResize(direction, startY, endEv);
      };
      handle.addEventListener('pointerup', done, { once: true });
      handle.addEventListener('pointercancel', () => {
        try { handle.releasePointerCapture(id); } catch {}
      }, { once: true });
    });
  }
  el.querySelector('select').addEventListener('change', (ev) => post('assign', { slot, session: ev.target.value }));
  el.querySelector('.openTerm').addEventListener('click', () => post('openTerminal', { slot }));
  el.querySelector('.rename').addEventListener('click', () => startRenameEditor(slot));
  el.querySelector('.hold').addEventListener('click', () => post('assign', { slot, session: '' }));
  el.querySelector('.bye').addEventListener('click', () => browserConfirmBye(slot));
  el.querySelector('.shiftTab').addEventListener('click', () => post('key', { slot, key: 'shift-tab' }));
  el.querySelector('.tab').addEventListener('click', () => submitPrompt(slot, 'tab'));
  el.querySelector('.enter').addEventListener('click', () => post('key', { slot, key: 'enter' }));
  el.querySelector('.esc').addEventListener('click', () => post('key', { slot, key: 'escape' }));
  el.querySelector('.ctrlc').addEventListener('click', () => post('key', { slot, key: 'ctrl-c' }));
  el.querySelector('.copy').addEventListener('click', () => copySlot(slot).catch(() => note('Copy blocked by clipboard permissions.')));
  el.querySelector('.paste').addEventListener('click', () => readClipboardAndPaste(slot));
  el.querySelector('.tools-toggle').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const open = el.classList.toggle('controls-open');
    ev.currentTarget.setAttribute('aria-expanded', String(open));
    ev.currentTarget.textContent = open ? 'Close' : 'Tools';
    ev.currentTarget.title = open ? 'Hide panel tools' : 'Show panel tools';
  });
  el.querySelector('form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    submitPrompt(slot, 'enter');
  });
  el.querySelector('.prompt-input').addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Tab') {
      ev.preventDefault();
      submitPrompt(slot, ev.shiftKey ? 'shift-tab' : 'tab');
    }
  });
  renameEditor.querySelector('form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    submitRenameEditor(slot);
  });
  renameEditor.querySelector('.rename-cancel').addEventListener('click', () => {
    closeRenameEditor(slot);
    note('Rename canceled');
  });
  renameEditor.querySelector('.rename-input').addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeRenameEditor(slot);
      note('Rename canceled');
    }
  });
  return el;
}
function paintEmptyTile(slot, el = tiles.get(slot) || createTile(slot)) {
  el.classList.add('empty');
  el.classList.remove('missing', 'changed', 'working', 'covered', 'row-span-2');
  el.querySelector('.idx').textContent = String(slot + 1).padStart(2, '0');
  el.querySelector('.name').textContent = 'Empty';
  el.querySelector('.name').title = '';
  el.querySelector('.meta').textContent = '';
  makeOptions(el.querySelector('select'), '');
  const pre = el.querySelector('pre');
  const text = 'Drag/resize this panel, or assign a session.';
  if (pre._terminaltownRawOutput !== text) renderTerminalOutput(pre, text);
  last.set(slot, { name: '', fp: fingerprint(text), working: false, waiting: false, noticeKey: '' });
}
function applyBoardShape(boardInfo, sessionCount) {
  const grid = (boardInfo && boardInfo.grid) || {};
  const columns = Number(grid.columns) || 3;
  const rows = Number(grid.rows) || 4;
  slotCount = Number(grid.slotCount) || (columns * rows) || Number(sessionCount) || 12;
  gridShape = columns + 'x' + rows;
  board.style.setProperty('--board-columns', String(columns));
  board.style.setProperty('--board-rows', String(rows));
  board.style.setProperty('--board-slots', String(slotCount));
  if (gridShapeSelect) {
    const options = Array.isArray(boardInfo && boardInfo.gridOptions) ? boardInfo.gridOptions : [];
    const sig = options.map((option) => option.columns + 'x' + option.rows).join('|');
    if (gridShapeSelect.dataset.sig !== sig) {
      gridShapeSelect.innerHTML = '';
      for (const option of options.length ? options : [{ columns, rows, label: gridShape }]) {
        const value = option.columns + 'x' + option.rows;
        const el = document.createElement('option');
        el.value = value;
        el.textContent = option.label || value;
        gridShapeSelect.appendChild(el);
      }
      gridShapeSelect.dataset.sig = sig;
    }
    gridShapeSelect.value = gridShape;
  }
  if (boardInfo && boardInfo.title) {
    if (boardLabel) {
      boardLabel.textContent = boardInfo.title;
      boardLabel.title = boardInfo.id || boardInfo.title;
    }
    if (openBoardButton) openBoardButton.title = boardInfo.id ? ('Open board. Current: ' + boardInfo.id) : 'Open board';
  }
  if (selectedSlot >= slotCount) selectedSlot = Math.max(0, slotCount - 1);
  for (const [slot, el] of Array.from(tiles.entries())) {
    if (slot < slotCount) continue;
    if (tileResizeObserver) tileResizeObserver.unobserve(el);
    el.remove();
    tiles.delete(slot);
    last.delete(slot);
  }
  slotSessions = Array.from({ length: slotCount }, (_, slot) => slotSessions[slot] || '');
  slotSpans = Array.from({ length: slotCount }, (_, slot) => slotSpans[slot] || 1);
  for (let slot = 0; slot < slotCount; slot += 1) {
    if (!tiles.has(slot)) paintEmptyTile(slot, createTile(slot));
  }
}
function render(data) {
  const previousGridShape = gridShape;
  const previousSpans = slotSpans;
  const boardId = data.board && data.board.id ? String(data.board.id) : '';
  if (boardId && activeRenderedBoardId && boardId !== activeRenderedBoardId) {
    last.clear();
    selectedSlot = 0;
  }
  if (boardId) activeRenderedBoardId = boardId;
  applyBoardShape(data.board || {}, (data.sessions || []).length);
  allSessions = data.allSessions || [];
  titles = data.titles || {};
  const sessions = Array.from({ length: slotCount }, (_, slot) => (data.sessions || [])[slot] || { slot, name: '' });
  const layoutChanged = previousGridShape !== gridShape || sessions.some((session, slot) => (session.rowSpan || 1) !== (previousSpans[slot] || 1));
  slotSessions = sessions.map((session) => session.name || '');
  slotSpans = sessions.map((session) => session.rowSpan || 1);
  board.classList.toggle('compact', compact);
  for (const session of sessions) {
    const slot = session.slot;
    const el = tiles.get(slot) || createTile(slot);
    el.classList.toggle('empty', !session.name);
    el.classList.toggle('missing', Boolean(session.missing || session.state === 'missing'));
    el.querySelector('.idx').textContent = String(slot + 1).padStart(2, '0');
    el.querySelector('.name').textContent = session.display || session.name || 'Empty';
    el.querySelector('.name').title = session.target ? ((session.name || '') + ' -> ' + session.target) : (session.name || '');
    el.querySelector('.meta').textContent = session.name ? ((session.command || 'pane') + ' c:' + session.clients + (session.target ? ' @ ' + session.target : '')) : '';
    makeOptions(el.querySelector('select'), session.name || '');
    const pre = el.querySelector('pre');
    const nearBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 18;
    const oldTop = pre.scrollTop;
    const text = session.name ? session.output : 'Drag/resize this panel, or assign a session.';
    const fp = fingerprint(text);
    const prev = last.get(slot);
    const changed = prev && prev.name === session.name && prev.fp && fp && prev.fp !== fp;
    const activeWork = Boolean(session.name && session.state !== 'missing' && ((session.state === 'busy') || (!session.state && looksWorking(text))));
    const waiting = Boolean(session.name && session.state === 'waiting');
    if (pre._terminaltownRawOutput !== text) {
      renderTerminalOutput(pre, text);
      if (nearBottom) pre.scrollTop = pre.scrollHeight;
      else pre.scrollTop = oldTop;
    }
    el.classList.toggle('changed', changed);
    el.classList.toggle('working', activeWork);
    maybeChime(session.name, session.noticeKey || '', session.state || '', prev);
    if (changed) setTimeout(() => el.classList.remove('changed'), 1400);
    last.set(slot, { name: session.name, fp, working: activeWork, waiting, noticeKey: session.noticeKey || '' });
  }
  renderSeen = true;
  if (recoveryEl) {
    recoveryEl.classList.toggle('visible', Boolean(data.warning));
    const span = recoveryEl.querySelector('span');
    if (span) span.textContent = data.warning || '';
  }
  placeTiles();
  renderHolding(data.holding || [], data);
  setSelected(selectedSlot);
  note(data.error ? data.error : gridShape + ' updated ' + new Date(data.at || Date.now()).toLocaleTimeString());
  if (layoutChanged) setTimeout(() => requestRefresh({ force: true }), 40);
  if (initialDiscoSpectaclePending) {
    initialDiscoSpectaclePending = false;
    setTimeout(startDiscoSpectacle, 40);
  }
}
function renderHolding(names, data = {}) {
  holdingNames = Array.isArray(names) ? names.slice() : [];
  holdingBoards = Array.isArray(data.holdingBoards) ? data.holdingBoards.slice() : [];
  holdingMembership = data.holdingMembership && typeof data.holdingMembership === 'object' ? data.holdingMembership : {};
  renderHoldingBoardFilter();
  renderHoldingList();
}
function renderHoldingBoardFilter() {
  const seen = new Set();
  const valid = new Set();
  const current = holdingBoardFilterValue || 'all';
  holdingBoardFilter.innerHTML = '';
  for (const item of [{ id: 'all', title: 'All boards' }, { id: 'unassigned', title: 'Unassigned' }, ...holdingBoards]) {
    const id = String(item.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    valid.add(id);
    const option = document.createElement('option');
    option.value = id;
    option.textContent = item.title || id;
    option.title = id;
    holdingBoardFilter.appendChild(option);
  }
  if (!valid.has(current)) holdingBoardFilterValue = 'all';
  holdingBoardFilter.value = holdingBoardFilterValue;
}
function setHoldingOpen(open, persist = true) {
  holdingOpen = Boolean(open);
  document.body.classList.toggle('holding-open', holdingOpen);
  if (holdingDrawer) holdingDrawer.setAttribute('aria-hidden', holdingOpen ? 'false' : 'true');
  if (toggleHoldingButton) {
    toggleHoldingButton.textContent = 'Holding ' + holdingNames.length;
    toggleHoldingButton.title = holdingOpen ? 'Close Holding drawer' : 'Open Holding drawer';
  }
  if (persist) localStorage.setItem('terminaltown-holding-open', holdingOpen ? '1' : '0');
  if (holdingOpen && holdingSearch && document.activeElement !== holdingSearch) {
    setTimeout(() => {
      if (holdingOpen) holdingSearch.focus({ preventScroll: true });
    }, 0);
  }
}
function holdingKind(name, title) {
  const text = (String(name || '') + ' ' + String(title || '')).toLowerCase();
  if (/\\bclaude\\b|^claude-|claude-code/.test(text)) return 'claude';
  if (/\\bcodex\\b|^codex-/.test(text)) return 'codex';
  return 'other';
}
function holdingRecord(name, index) {
  const title = titles[name] || name;
  const boards = Array.isArray(holdingMembership[name]) ? holdingMembership[name] : [];
  const boardIds = boards.map((board) => String(board.id || '')).filter(Boolean);
  const boardText = boards.map((board) => String(board.title || board.id || '')).filter(Boolean).join(', ');
  return {
    name,
    title,
    index,
    kind: holdingKind(name, title),
    boardIds,
    boardText,
    search: (String(name || '') + ' ' + String(title || '') + ' ' + boardText + ' ' + boardIds.join(' ')).toLowerCase(),
  };
}
function renderHoldingList() {
  holding.innerHTML = '';
  const query = String(holdingQuery || '').trim().toLowerCase();
  const boardFilter = holdingBoardFilterValue || 'all';
  const filter = ['all', 'claude', 'codex', 'other'].includes(holdingFilterValue) ? holdingFilterValue : 'all';
  const sort = ['recent', 'title', 'name'].includes(holdingSortValue) ? holdingSortValue : 'recent';
  if (holdingBoardFilter && holdingBoardFilter.value !== boardFilter) holdingBoardFilter.value = boardFilter;
  if (holdingFilter && holdingFilter.value !== filter) holdingFilter.value = filter;
  if (holdingSort && holdingSort.value !== sort) holdingSort.value = sort;

  let records = holdingNames.map(holdingRecord)
    .filter((record) => boardFilter === 'all' || (boardFilter === 'unassigned' ? !record.boardIds.length : record.boardIds.includes(boardFilter)))
    .filter((record) => filter === 'all' || record.kind === filter)
    .filter((record) => !query || record.search.includes(query));
  if (sort === 'title') {
    records = records.slice().sort((a, b) => a.title.localeCompare(b.title) || a.name.localeCompare(b.name));
  } else if (sort === 'name') {
    records = records.slice().sort((a, b) => a.name.localeCompare(b.name) || a.title.localeCompare(b.title));
  }
  if (holdingCount) holdingCount.textContent = String(records.length);
  if (holdingTabCount) holdingTabCount.textContent = String(records.length);
  if (toggleHoldingButton) toggleHoldingButton.textContent = 'Holding ' + records.length;

  if (!holdingNames.length || !records.length) {
    const empty = document.createElement('div');
    empty.className = 'holding-empty';
    empty.textContent = holdingNames.length ? 'No matching sessions' : 'No parked sessions';
    holding.appendChild(empty);
    return;
  }
  for (const record of records) {
    const name = record.name;
    const b = document.createElement('button');
    b.className = 'holding-item';
    b.draggable = true;
    const titleEl = document.createElement('span');
    titleEl.className = 'holding-item-title';
    titleEl.textContent = record.title;
    const nameEl = document.createElement('span');
    nameEl.className = 'holding-item-name';
    nameEl.textContent = record.name + (record.boardText ? ' @ ' + record.boardText : ' @ Unassigned');
    b.appendChild(titleEl);
    b.appendChild(nameEl);
    b.title = name + ' - ' + (record.boardText || 'Unassigned') + ' - drag onto a slot, or click to place in the selected slot';
    b.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('application/json', JSON.stringify({ session: name }));
      ev.dataTransfer.setData('text/plain', name);
    });
    b.addEventListener('click', () => post('showHeld', { session: name, slot: selectedSlot }));
    holding.appendChild(b);
  }
}
function basenameForBrowserPath(value) {
  const parts = String(value || '').split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || 'session';
}
function kebabForBrowser(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'session';
}
function browserPlacementValue(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'first' || raw === 'empty') return 'first';
  if (raw === 'selected') return String(selectedSlot);
  if (raw === 'holding' || raw === 'hold') return 'holding';
  const n = Number(raw.replace(/^slot\\s+/i, ''));
  if (Number.isInteger(n) && n >= 1 && n <= slotCount) return String(n - 1);
  return 'first';
}
function browserNewSession(kind = '') {
  if (!window.terminalTownBrowserHost) {
    post('newSession', { slot: selectedSlot, kind });
    return;
  }
  const pickedKind = kind || String(prompt('Session type: claude, codex, or shell', 'codex') || '').trim().toLowerCase();
  if (!pickedKind) return;
  const normalizedKind = ['claude', 'codex', 'shell'].includes(pickedKind) ? pickedKind : 'codex';
  const cwd = prompt('Project directory', '.');
  if (!cwd) return;
  const base = basenameForBrowserPath(cwd);
  const defaultSession = normalizedKind === 'codex' ? 'codex-' + kebabForBrowser(base) : kebabForBrowser(base);
  const session = prompt('Tmux session name', defaultSession);
  if (!session) return;
  const title = prompt('Display name', session);
  if (title === null) return;
  const defaultCommand = normalizedKind === 'claude'
    ? 'claude'
    : normalizedKind === 'codex'
      ? '${CODEX_DEFAULT_COMMAND}'
      : 'zsh';
  const command = prompt('Command', defaultCommand);
  if (!command) return;
  const initialPrompt = prompt('Initial prompt (optional)', '');
  if (initialPrompt === null) return;
  const placement = browserPlacementValue(prompt('Place in: first, selected, holding, or slot number', 'first'));
  post('newSession', { slot: selectedSlot, kind: normalizedKind, cwd, session, title, command, initialPrompt, placement });
}
async function browserOpenBoard(create = false) {
  if (!window.terminalTownBrowserHost) {
    post(create ? 'newBoard' : 'openBoard');
    return;
  }
  if (create) {
    const title = prompt('New board name', 'New board');
    if (!title) return;
    post('newBoard', { title });
    return;
  }
  await showBoardPicker();
}
function closeBoardPicker() {
  if (!boardPicker) return;
  boardPicker.classList.remove('visible');
  boardPicker.setAttribute('aria-hidden', 'true');
}
function openBoardFromPicker(board) {
  if (!board) return;
  const id = String(board.id || board.boardId || '').trim();
  if (!id) return;
  closeBoardPicker();
  post('openBoard', { boardId: id, boardTitle: board.title || board.boardTitle || id });
}
function renderBoardPicker(active, boards) {
  if (!boardPickerList || !boardPickerInput) return;
  boardPickerList.innerHTML = '';
  const activeId = active && active.id ? active.id : '';
  const list = Array.isArray(boards) ? boards : [];
  boardPickerInput.value = activeId || (list[0] && list[0].id) || 'default';
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'holding-empty';
    empty.textContent = 'No boards found';
    boardPickerList.appendChild(empty);
    return;
  }
  for (const board of list) {
    const id = String(board.id || '').trim();
    if (!id) continue;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'board-picker-item' + (id === activeId ? ' active' : '');
    item.title = 'Open ' + id;
    const title = document.createElement('span');
    title.className = 'board-picker-title';
    title.textContent = board.title || id;
    const label = document.createElement('span');
    label.className = 'board-picker-id';
    label.textContent = id;
    item.appendChild(title);
    item.appendChild(label);
    item.addEventListener('click', () => openBoardFromPicker({ id, title: board.title || id }));
    boardPickerList.appendChild(item);
  }
}
async function showBoardPicker() {
  if (!boardPicker || !boardPickerList || !boardPickerInput) return;
  let list = [];
  let active = null;
  try {
    const res = await fetch('/api/boards' + (window.terminalTownBrowserBoardQuery || ''));
    const payload = await res.json();
    list = Array.isArray(payload.boards) ? payload.boards : [];
    active = payload.active || null;
  } catch {}
  renderBoardPicker(active, list);
  boardPicker.classList.add('visible');
  boardPicker.setAttribute('aria-hidden', 'false');
  boardPickerInput.focus();
  boardPickerInput.select();
}
function browserOpenMap() {
  if (window.terminalTownBrowserHost) {
    window.open('/map', '_blank', 'noopener,noreferrer');
    return;
  }
  post('openMap');
}
function browserConfirmBye(slot) {
  if (!window.terminalTownBrowserHost || confirm('End tmux session in slot ' + (slot + 1) + '?')) post('bye', { slot });
}
function setToolbarCollapsed(collapsed) {
  if (!toolbar || !toggleToolbarButton) return;
  toolbar.classList.toggle('collapsed', collapsed);
  toggleToolbarButton.textContent = collapsed ? '+' : '-';
  toggleToolbarButton.title = collapsed ? 'Show page controls' : 'Hide page controls';
  toggleToolbarButton.setAttribute('aria-label', toggleToolbarButton.title);
  toggleToolbarButton.setAttribute('aria-expanded', String(!collapsed));
}
try { setToolbarCollapsed(localStorage.getItem('terminaltown-toolbar-collapsed') === '1'); } catch {}
toggleToolbarButton.addEventListener('click', () => {
  const collapsed = !toolbar.classList.contains('collapsed');
  setToolbarCollapsed(collapsed);
  try { localStorage.setItem('terminaltown-toolbar-collapsed', collapsed ? '1' : '0'); } catch {}
});
newBoardButton.addEventListener('click', () => browserOpenBoard(true));
openBoardButton.addEventListener('click', () => browserOpenBoard(false));
openMapButton.addEventListener('click', browserOpenMap);
if (boardPickerClose) boardPickerClose.addEventListener('click', closeBoardPicker);
if (boardPicker) {
  boardPicker.addEventListener('click', (ev) => {
    if (ev.target === boardPicker) closeBoardPicker();
  });
}
if (boardPickerForm) {
  boardPickerForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const id = String(boardPickerInput && boardPickerInput.value || '').trim();
    if (id) openBoardFromPicker({ id, title: id });
  });
}
gridShapeSelect.addEventListener('change', () => {
  const parts = String(gridShapeSelect.value || '').split('x').map((part) => Number(part));
  if (parts.length !== 2 || !parts[0] || !parts[1]) return;
  applyBoardShape({ grid: { columns: parts[0], rows: parts[1], slotCount: parts[0] * parts[1] } }, slotCount);
  placeTiles();
  note('Grid set to ' + parts[0] + 'x' + parts[1]);
  post('setGrid', { columns: parts[0], rows: parts[1] });
});
newButton.addEventListener('click', () => browserNewSession(''));
newClaudeButton.addEventListener('click', () => browserNewSession('claude'));
newCodexButton.addEventListener('click', () => browserNewSession('codex'));
refreshButton.addEventListener('click', requestRefresh);
recoverButton.addEventListener('click', () => post('recoverMissing'));
if (recoveryEl) recoveryEl.querySelector('button').addEventListener('click', () => post('recoverMissing'));
reloadUiButton.addEventListener('click', () => post('reloadUi'));
reloadWindowButton.addEventListener('click', () => post('reloadWindow'));
autoButton.addEventListener('click', () => post('resetSlots'));
compactButton.addEventListener('click', () => {
  compact = !compact;
  localStorage.setItem('terminaltown-compact', compact ? '1' : '0');
  board.classList.toggle('compact', compact);
});
soundButton.addEventListener('click', async () => {
  sound = !sound;
  localStorage.setItem('terminaltown-sound', sound ? '1' : '0');
  updateSoundButton();
  await unlockAudio();
  note(sound ? 'Sound armed' : 'Sound off');
});
playDiscoButton.addEventListener('click', () => {
  skin = 'disco';
  skinSelect.value = skin;
  localStorage.setItem('terminaltown-skin', skin);
  document.body.dataset.skin = skin;
  resetArcadeTrack();
  syncArcade();
  startDiscoSpectacle();
});
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);
skinSelect.addEventListener('change', () => {
  skin = skinSelect.value || 'system';
  localStorage.setItem('terminaltown-skin', skin);
  document.body.dataset.skin = skin;
  resetArcadeTrack();
  syncArcade();
  if (skin === 'disco') startDiscoSpectacle();
  else cancelDiscoSpectacle();
});
motionSelect.addEventListener('change', () => {
  motion = motionSelect.value || 'subtle';
  localStorage.setItem('terminaltown-motion', motion);
  document.body.dataset.motion = motion;
  resetArcadeTrack();
  syncArcade();
  if (skin === 'disco') startDiscoSpectacle();
  else cancelDiscoSpectacle();
});
if (reduceMotion && reduceMotion.addEventListener) {
  reduceMotion.addEventListener('change', () => {
    syncArcade();
  });
}
document.addEventListener('copy', (ev) => {
  if (selectedText()) return;
  const text = slotOutput(selectedSlot);
  if (!text || !ev.clipboardData) return;
  ev.clipboardData.setData('text/plain', text);
  ev.preventDefault();
  note('Copied slot ' + (selectedSlot + 1));
});
if (clipboardProxy) {
  clipboardProxy.addEventListener('input', () => {
    clipboardProxy.value = '';
  });
}
document.addEventListener('paste', async (ev) => {
  pasteEventSerial += 1;
  try {
    const images = await clipboardImagesFromItems(ev.clipboardData && ev.clipboardData.items);
    if (images.length) {
      ev.preventDefault();
      await pasteImagesToSlot(selectedSlot, images);
      return;
    }
    if (editableTarget(ev.target)) return;
    const text = ev.clipboardData ? ev.clipboardData.getData('text/plain') : '';
    if (text) {
      ev.preventDefault();
      pasteTextToSlot(selectedSlot, text);
    }
  } catch (e) {
    note(e && e.message ? e.message : 'Paste failed');
  }
});
document.addEventListener('click', (ev) => {
  const link = ev.target && ev.target.closest && ev.target.closest('.terminal-output a[href]');
  if (!link) return;
  if (window.terminalTownBrowserHost) return;
  ev.preventDefault();
  post('openExternal', { url: link.href });
});
window.addEventListener('keydown', (ev) => {
  if (boardPicker && boardPicker.classList.contains('visible')) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeBoardPicker();
    }
    return;
  }
  const key = String(ev.key || '').toLowerCase();
  const editable = editableTarget(ev.target);
  if (ev.metaKey && !ev.altKey && key === 'c' && !editable) {
    ev.preventDefault();
    copySlot(selectedSlot).catch(() => note('Copy failed'));
    return;
  }
  if (ev.metaKey && !ev.altKey && key === 'v' && !editable) {
    const beforePaste = pasteEventSerial;
    setTimeout(() => {
      if (pasteEventSerial === beforePaste) readClipboardAndPaste(selectedSlot);
    }, 90);
    return;
  }
  if (editable) return;
  if (renamingSlot !== null) return;
  if (ev.key === 'Tab') {
    ev.preventDefault();
    post('key', { slot: selectedSlot, key: ev.shiftKey ? 'shift-tab' : 'tab' });
    return;
  }
  if (ev.key === 'Escape') {
    ev.preventDefault();
    post('key', { slot: selectedSlot, key: 'escape' });
    return;
  }
  if (ev.key === 'Enter') {
    ev.preventDefault();
    post('key', { slot: selectedSlot, key: 'enter' });
    return;
  }
  if (ev.altKey || ev.metaKey) return;
  if (ev.ctrlKey && ev.key.toLowerCase() === 'c') {
    if (selectedText()) return;
    ev.preventDefault();
    post('key', { slot: selectedSlot, key: 'ctrl-c' });
    return;
  }
  if (ev.ctrlKey && ev.key.toLowerCase() === 'd') {
    ev.preventDefault();
    post('key', { slot: selectedSlot, key: 'ctrl-d' });
    return;
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.key)) {
    ev.preventDefault();
    post('key', { slot: selectedSlot, key: ev.key.replace('Arrow', '').toLowerCase() });
  }
});
window.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'data') {
    if (spectacleActive()) {
      pendingData = msg.data || {};
      pendingRefresh = false;
      return;
    }
    render(msg.data || {});
  }
  if (msg.type === 'navigate' && window.terminalTownBrowserHost && msg.url) {
    window.location.assign(String(msg.url));
  }
  if (msg.type === 'discoSettings') applyDiscoSettings(msg.settings || {});
  if (msg.type === 'note') note(msg.message || '');
  if (msg.type === 'copyRequest') copySlot(selectedSlot).catch(() => note('Copy failed'));
  if (msg.type === 'pasteRequest') readClipboardAndPaste(Number.isInteger(Number(msg.slot)) ? Number(msg.slot) : selectedSlot);
});
let resizeRefreshTimer = null;
function handleViewportResize() {
  placeTiles();
  clearTimeout(resizeRefreshTimer);
  resizeRefreshTimer = setTimeout(() => requestRefresh({ force: true }), 180);
}
window.addEventListener('resize', handleViewportResize);
if (window.ResizeObserver) {
  new ResizeObserver(handleViewportResize).observe(board);
}
requestRefresh();
setInterval(requestRefresh, 6000);
</script>
</body>
</html>`;
}

module.exports = {html, collect, assignSlot, moveSlot, resizeSlot, resetSlots, setGridShape, displayPaneOutput, recoverMissingSessions, renameSessionLabel, sendPrompt, sendKey, pasteText, pasteImages, pasteSystemClipboardImage, openFullTerminal, byeSession, createAiSession, readManifest, readDiscoSettings};
