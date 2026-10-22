const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { activeQuestionFromJsonl, buildAnswerSteps } = require('./codexQuestions');
const {
  normalizeSessionMemory,
  seedSessionMemory,
  composeHydrationPrompt,
  composeLandingPrompt,
  rotationDecision,
  ROTATE_CONTEXT_TOKENS,
  applyMemoryOperation,
  reconcileConversation,
  parseResetCommand,
  updateSessionMemoryFile,
} = require('./sessionMemory');

const { readDirectory, searchDirectory, resolveSessionName, sessionNameFor, roleTitle, genericName, slug } = require('./sessionDirectory');

const TMUX_BIN = (() => {
  const candidates = [
    process.env.SUMMONER_TMUX_BIN,
    '/usr/local/bin/tmux',
    '/opt/homebrew/bin/tmux',
    path.join(os.homedir(), 'JARGAN', '.homebrew', 'bin', 'tmux'),
    '/usr/bin/tmux',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return 'tmux';
})();

const LARSON_DESKTOP_SESSION = 'remote:larson-desktop';
const isPanelName = name => NAME_RE.test(String(name || '')) || name === LARSON_DESKTOP_SESSION;
function desktopSnapshot(name, slot, spans = {}) {
  return { slot, name, type: 'larson-desktop', display: 'Larson Desktop', title: 'Larson Desktop',
    rowSpan: spans[name] === 2 ? 2 : 1, output: '', state: 'idle', missing: false, clients: '0', noticeKey: '' };
}

const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const DATA_DIR = path.join(os.homedir(), '.local', 'share', 'terminaltown');
const LEGACY_DATA_DIR = path.join(os.homedir(), '.local', 'share', 'ai-grid');
const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json');
const LEGACY_LAYOUT_FILE = path.join(LEGACY_DATA_DIR, 'layout.json');
const BOARDS_DIR = path.join(DATA_DIR, 'boards');
const MANIFEST_FILE = process.env.TERMINALTOWN_MANIFEST || path.join(DATA_DIR, 'sessions-manifest.json');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');
const SCROLLBACK_DIR = path.join(DATA_DIR, 'scrollback');
const PASTE_DIR = path.join(DATA_DIR, 'pastes');
const SESSION_MEMORY_COMMAND = path.resolve(__dirname, '..', 'scripts', 'terminaltown-session-memory.js');
const HYDRATION_DIR = path.join(os.homedir(), '.local', 'share', 'terminaltown', 'hydration');
const PANEL_ROTATE_TOKENS = Number(process.env.TERMINALTOWN_ROTATE_TOKENS) || ROTATE_CONTEXT_TOKENS;
const PANEL_ROTATION_ENABLED = process.env.TERMINALTOWN_ROTATION !== '0';
const panelIdleSince = new Map();
let panelRotationRunning = false;
const SUMMON_DIR = path.join(os.homedir(), '.vscode-summon');
const SUMMON_QUEUE = path.join(SUMMON_DIR, 'queue.jsonl');
const TITLES_FILE = path.join(SUMMON_DIR, 'titles.json');
const JARGAN_ROOT = process.env.TERMINALTOWN_PROJECT_ROOT || process.cwd();
const TERMINALS_JSON = process.env.TERMINALTOWN_TERMINALS_FILE || path.join(JARGAN_ROOT, '.vscode', 'terminals.json');
const EXTERNAL_TERMINAL_URL = process.env.TERMINALTOWN_EXTERNAL_TERMINAL_URL || process.env.AI_GRID_EXTERNAL_TERMINAL_URL || '';
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
const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
const ATTENTION_DIR = path.join(os.homedir(), '.claude', 'attention');
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const CODEX_STATE_DB = process.env.CODEX_STATE_DB || path.join(CODEX_HOME, 'state_5.sqlite');
const CODEX_LOCK_DIR = path.join(CODEX_HOME, 'thread-writer-locks');
const CODEX_TAIL_BYTES = 192 * 1024;
const SIGNAL_MONITOR_STARTED_AT = Date.now();
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
  String(process.env.TERMINALTOWN_TMUX_SOCKETS || 'default,t7')
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
const paneScrollbackLatest = new Map();
const paneDisplayLatest = new Map();
const PANE_SCROLLBACK_BYTES = 256 * 1024;

const CODEX_FULL_PERMISSION_COMMAND = String(process.env.TERMINALTOWN_CODEX_COMMAND || 'codex').trim() || 'codex';

function codexFullPermissionCommand(args = '') {
  const suffix = String(args || '').trim();
  return suffix
    ? `${CODEX_FULL_PERMISSION_COMMAND} ${suffix}`
    : CODEX_FULL_PERMISSION_COMMAND;
}

// Profiles are session policy, not conversation history. Carry them into every
// generated launch rather than falling back to the global tool inventory.
function cleanCodexProfile(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(value || '')) ? String(value) : '';
}

// Read literal shell arguments without evaluating a command or treating text
// inside a quoted prompt as options. Complex shell programs are not argv.
function codexCommandArgs(command) {
  const words = [];
  let word = '', quote = '', started = false;
  const text = String(command || '');
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = ''; else word += c;
    } else if (c === '\\' && quote !== "'") {
      if (i + 1 >= text.length) return null;
      const next = text[++i];
      word += quote === '"' && !['$', '`', '"', '\\', '\n'].includes(next) ? `\\${next}` : next === '\n' ? '' : next;
      started = true;
    } else if (quote === '"') {
      if (c === '"') quote = ''; else word += c;
    } else if (c === '"' || c === "'") {
      quote = c; started = true;
    } else if (/\s/.test(c)) {
      if (started) words.push(word);
      word = ''; started = false;
    } else if (/[;&|<>]/.test(c)) {
      return null;
    } else {
      word += c; started = true;
    }
  }
  if (quote) return null;
  if (started) words.push(word);
  return words;
}

function codexCommandOptions(command) {
  const args = codexCommandArgs(command);
  const options = { args, profile: '', remote: false, resume: -1, profileIndexes: new Set() };
  const takesValue = new Set(['-c', '--config', '-C', '--cd', '--add-dir', '-m', '--model', '-s', '--sandbox', '-a', '--ask-for-approval', '-i', '--image', '--remote-auth-token-env', '--code-mode-host']);
  for (let i = 1; args && i < args.length && args[i] !== '--'; i += 1) {
    const word = args[i];
    if (word === '-p' || word === '--profile') {
      options.profileIndexes.add(i); options.profileIndexes.add(i + 1);
      options.profile = cleanCodexProfile(args[++i]);
    } else if (word.startsWith('--profile=')) {
      options.profileIndexes.add(i); options.profile = cleanCodexProfile(word.slice(10));
    } else if (word === '--remote') { options.remote = true; i += 1; }
    else if (word.startsWith('--remote=')) options.remote = true;
    else if (takesValue.has(word)) i += 1;
    else if (word === 'resume' && options.resume < 0 && SID_RE.test(args[i + 1] || '')) { options.resume = i; i += 1; }
    else if (!word.startsWith('-')) break;
  }
  return options;
}

function codexProfileFor(record) {
  return record ? cleanCodexProfile(record.codexProfile) || codexCommandOptions(record.command).profile : '';
}

function codexPanelCommand(record, args = '') {
  const profile = codexProfileFor(record);
  const raw = String(record && record.command || '');
  const options = codexCommandOptions(raw);
  const words = options.args;
  if (!words && /(?:^|\s)--remote(?:\s|=)/.test(raw)) throw new Error('Cannot safely rebuild the saved remote Codex command');
  if (options.remote) {
    const resume = options.resume;
    const base = resume < 0 ? words : words.slice(0, resume);
    const filtered = [];
    for (let i = 0; i < base.length; i += 1) {
      if (options.profileIndexes.has(i)) continue;
      // A remote endpoint with shell expansion needs its owner to resolve it;
      // never silently replace it with a locally owned process.
      if (/[$`]/.test(base[i])) throw new Error('Cannot rebuild a remote Codex command containing shell expansion');
      filtered.push(/^[A-Za-z0-9_./:=@,+-]+$/.test(base[i]) ? base[i] : shellSingleQuote(base[i]));
    }
    return `${filtered.join(' ')}${profile ? ` -p ${profile}` : ''}${args ? ` ${args}` : ''}`;
  }
  return codexFullPermissionCommand(`${profile ? `-p ${profile} ` : ''}${args}`);
}

function codexPanelResumeCommand(record, threadId = record && record.threadId) {
  return codexPanelCommand(record, `resume ${threadId}`);
}

function normalizeCodexLaunchCommand(command = '') {
  const raw = String(command || '').trim();
  if (raw === 'codex') return codexFullPermissionCommand();
  const resume = raw.match(/^codex\s+resume\s+([0-9a-f-]{36})$/i);
  return resume ? codexFullPermissionCommand(`resume ${resume[1]}`) : raw;
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

  // Claude's active composer is framed by two full-width rules. It belongs to
  // the captured terminal, but TerminalTown provides the interactive composer.
  // Remove that one visual-only block without touching submitted prompt history.
  for (let end = lines.length - 1; end >= 1; end -= 1) {
    if (!/^\s*(?:\u2500|-){20,}\s*$/.test(lines[end])) continue;
    let start = end - 1;
    while (start >= 0 && !/^\s*(?:\u2500|-){20,}\s*$/.test(lines[start])) start -= 1;
    if (start < 0) continue;
    const promptLine = lines.slice(start + 1, end).find((line) => line.trim());
    if (!promptLine || !/^\s*❯(?:\s|\u00a0|$)/.test(promptLine)) continue;
    return [...lines.slice(0, start), ...lines.slice(end + 1)]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();
  }

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
  if (/\bcodex\b/i.test(command)) return compactCodexTranscript(output, command);
  if (/Ask Codex to do anything/i.test(output)) {
    return stripTrailingCodexPrompt(output);
  }
  const looksLikeClaudePane = session.resumeId ||
    /\bclaude\b/i.test(command) ||
    /(?:auto|bypass) mode on\b.*(?:agents|shift\+tab)|\b(?:Opus|Sonnet|Haiku)\b.*\bctx:\d+%|^\s*\/rc\s*$/im.test(String(output || ''));
  if (looksLikeClaudePane) {
    return stripTrailingClaudePrompt(output);
  }
  return output;
}

// Agent panels are conversation viewports, not copies of tmux's 300-row screen.
// Keep meaningful whitespace and active input, but discard idle screen chrome
// and long runs of empty rows left by alternate-screen redraws.
function compactCodexTranscript(output, command = '') {
  const text = cleanText(output);
  if (!/\bcodex\b/i.test(command)) return text;
  let lines = text.split('\n');
  const prompt = /^\s*(?:[›❯>]\s*)?Ask Codex to do anything\s*$/i;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i -= 1) {
    if (!prompt.test(lines[i])) continue;
    const chrome = lines.slice(i + 1).every(line => !line.trim() ||
      /^\s*(?:gpt-\S+(?:\s+(?:minimal|low|medium|high|xhigh|max|ultra))?\s*·\s*)?Context\s+\d+%\s+left(?:\s*·\s*(?:\/|~).*)?\s*$/i.test(line) ||
      /^\s*\? for shortcuts\b/i.test(line) ||
      /^\s*⚠\s*\d+ warnings?\b/i.test(line) ||
      /^\s*esc again to edit previous message\s*$/i.test(line));
    if (chrome) lines = lines.slice(0, i);
    break;
  }
  const compact = [];
  let blanks = [], fence = '';
  const flush = () => { compact.push(...(blanks.length >= 8 ? [''] : blanks)); blanks = []; };
  for (const line of lines) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (!fence && !line.trim()) { blanks.push(line); continue; }
    flush(); compact.push(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) fence = '';
    }
  }
  flush();
  return compact.join('\n').trimEnd();
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
      const name = typeof rawSlots[index] === 'string' && (NAME_RE.test(rawSlots[index]) || rawSlots[index] === LARSON_DESKTOP_SESSION) ? rawSlots[index] : '';
      if (!name || used.has(name)) return '';
      used.add(name);
      return name;
    });
    boards.set(ctx.id, { id: ctx.id, title: ctx.title, grid, slots, heldSessions: Array.isArray(parsed.heldSessions) ? [...new Set(parsed.heldSessions)].filter(name => isPanelName(name) && !slots.includes(name)) : [] });
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
    for (const [names, held] of [[board.slots || [], false], [board.heldSessions || [], true]]) {
      for (const name of names) {
        if (!isPanelName(name)) continue;
        if (!membership[name]) membership[name] = [];
        if (!membership[name].some(item => item.id === board.id)) {
          membership[name].push({ id: board.id, title: board.title || board.id, ...(held ? {held:true} : {}) });
        }
      }
    }
  }
  return membership;
}

// Board affiliation survives parking; only grid placement excludes Holding.
function unassignedSessions(names, membership, slots = []) {
  const placed = new Set(slots.filter(Boolean));
  return names.filter(name => !name.startsWith('terminaltown-meta-') && !placed.has(name) && !(membership[name] || []).some(board => !board.held));
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

function normalizeRotation(raw) {
  if (!raw || typeof raw !== 'object' || !['landing', 'cleared', 'hydrating', 'stalled'].includes(raw.state)) return null;
  const id = (value) => SID_RE.test(String(value || '')) ? String(value) : '';
  return {
    state: raw.state,
    at: Number(raw.at) || 0,
    fromConversation: id(raw.fromConversation),
    toConversation: id(raw.toConversation),
    contextTokens: Math.max(0, Math.floor(Number(raw.contextTokens) || 0)),
  };
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
        aliases: Array.isArray(raw.aliases) ? [...new Set(raw.aliases.filter(alias => NAME_RE.test(String(alias)) && alias !== cleanName))] : [],
        kind: cleanKind(raw.kind),
        title: cleanTitle(raw.title),
        cwd: String(raw.cwd || ''),
        command: String(raw.command || ''),
        codexProfile: cleanCodexProfile(raw.codexProfile),
        resumeId: SID_RE.test(String(raw.resumeId || '')) ? String(raw.resumeId) : '',
        threadId: SID_RE.test(String(raw.threadId || '')) ? String(raw.threadId) : '',
        target,
        slot: raw.slot !== null && raw.slot !== undefined && Number.isInteger(Number(raw.slot)) ? Number(raw.slot) : null,
        createdAt: String(raw.createdAt || ''),
        updatedAt: String(raw.updatedAt || ''),
        lastSeenAt: String(raw.lastSeenAt || ''),
        lastSnapshot: String(raw.lastSnapshot || ''),
        minTerminalRows: Math.floor(clampNumber(raw.minTerminalRows, 0, 0, 1200)),
        pendingPrompt: String(raw.pendingPrompt || '').slice(0, 65536),
        pendingPromptQueuedAt: String(raw.pendingPromptQueuedAt || ''),
        pendingPromptKind: ['memory', 'rotation'].includes(raw.pendingPromptKind) ? raw.pendingPromptKind : '',
        pendingPromptConversationId: SID_RE.test(String(raw.pendingPromptConversationId || '')) ? String(raw.pendingPromptConversationId) : '',
        memory: normalizeSessionMemory(raw.memory),
        rotation: normalizeRotation(raw.rotation),
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

function scrollbackPathFor(name) {
  return path.join(SCROLLBACK_DIR, `${name}.txt`);
}

function retainPaneScrollback(name, output) {
  const screen = String(output || '').trimEnd();
  if (!NAME_RE.test(String(name || '')) || !screen) return screen;
  const file = scrollbackPathFor(name);
  try {
    if (paneScrollbackLatest.get(name) !== screen) {
      paneScrollbackLatest.set(name, screen);
      fs.mkdirSync(SCROLLBACK_DIR, { recursive: true, mode: 0o700 });
      const marker = `\n\n--- TerminalTown screen ${new Date().toISOString()} ---\n`;
      fs.appendFileSync(file, marker + screen + '\n', { mode: 0o600 });
      const stat = fs.statSync(file);
      if (stat.size > PANE_SCROLLBACK_BYTES) {
        fs.writeFileSync(file, tailFileText(file, PANE_SCROLLBACK_BYTES), { mode: 0o600 });
      }
    }
    // The archive is for recovery only. Returning it here replays overlapping
    // capture-pane screens as though they were new terminal output.
    return screen;
  } catch {
    return screen;
  }
}

function stabilizeAlternateScreenCapture(target, panePid, alternateScreen, output, allowCached = false) {
  const screen = String(output || '').trimEnd();
  if (!panePid) return screen;
  const key = `${socketLabel(target && target.socket)}:${targetLabel(target)}:${panePid}`;
  if (!alternateScreen) return allowCached && !screen.trim() ? paneDisplayLatest.get(key) || screen : screen;
  if (screen.trim()) {
    paneDisplayLatest.set(key, screen);
    if (paneDisplayLatest.size > 256) paneDisplayLatest.delete(paneDisplayLatest.keys().next().value);
    return screen;
  }
  return paneDisplayLatest.get(key) || screen;
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
    out = await exec(LSOF_BIN, ['-nP', '-F', 'pn', ...files], { timeout: 5000, maxBuffer: 512 * 1024 });
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
    if (SID_RE.test(id)) {
      const ids = locks.get(pid) || [];
      if (!ids.includes(id)) ids.push(id);
      locks.set(pid, ids);
    }
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

function codexThreadForPane(panePid, procIndex, lockIndex, knownThreads = new Map(), lastVerifiedThread = '') {
  const pids = descendantPids(panePid, procIndex);
  for (const pid of pids) {
    const value = lockIndex.get(pid);
    const ids = Array.isArray(value) ? value : value ? [value] : [];
    const id = ids.find(candidate => !knownThreads.size || knownThreads.has(candidate));
    if (id) return id;
  }
  if (SID_RE.test(lastVerifiedThread) && (!knownThreads.size || knownThreads.has(lastVerifiedThread))) {
    return lastVerifiedThread;
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

function claudeRecordForPane(name, panePid, target, signalContext) {
  const record = (signalContext.claudeIndex || new Map()).get(name);
  if (!record || !record.target || !SID_RE.test(record.sessionId || '') || !Number(record.pid)) return null;
  const recordTarget = normalizeTarget(record.target, name);
  const paneTarget = normalizeTarget(target, name);
  if (!recordTarget || !paneTarget || recordTarget.session !== paneTarget.session || recordTarget.socket !== paneTarget.socket) return null;
  return descendantPids(panePid, signalContext.procIndex || { byPid: new Map(), children: new Map() }).includes(Number(record.pid)) ? record : null;
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
    const noticeAt = Date.parse(e.timestamp) || 0;
    if (e.type === 'event_msg') {
      if (p.type === 'task_complete' && (p.turn_id || noticeAt)) {
        return { state: 'waiting', noticeKind: 'codex-final', noticeKey: `codex:${threadId}:${p.turn_id || e.timestamp}:task_complete`, noticeAt, signalAvailable: true };
      }
      if (p.type === 'turn_aborted') return { state: 'idle', noticeKind: '', noticeKey: '', signalAvailable: true };
      if (p.type === 'task_started' || p.type === 'user_message') return { state: 'busy', noticeKind: '', noticeKey: '', signalAvailable: true };
    }
    // A turn can contain multiple final_answer items (and more tools afterwards).
    // Only task_complete closes it. Custom tools are used by the installed Codex.
    if (e.type === 'response_item' && (
      ['function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output', 'reasoning'].includes(p.type) ||
      (p.type === 'message' && ['assistant', 'user'].includes(p.role)))) {
      return { state: 'busy', noticeKind: '', noticeKey: '', signalAvailable: true };
    }
  }
  return fallbackCodexSignal(output);
}

function readCodexInteraction(threadId, codexPaths) {
  if (!SID_RE.test(threadId || '')) return null;
  const file = codexPaths.get(threadId);
  if (!file) return null;
  return activeQuestionFromJsonl(tailFileText(file, CODEX_TAIL_BYTES));
}

function fallbackCodexSignal(output) {
  // Scrollback, prompt suggestions and reflow have no durable event identity.
  return { state: looksWorkingServer(output) ? 'busy' : 'idle', noticeKind: '', noticeKey: '', signalAvailable: false };
}

function readAttentionIndex() {
  const map = new Map();
  let files = [];
  try { files = fs.readdirSync(ATTENTION_DIR); } catch { return map; }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const a = JSON.parse(fs.readFileSync(path.join(ATTENTION_DIR, file), 'utf8'));
      if (a && SID_RE.test(a.session_id || '')) {
        // Legacy hooks round since to whole seconds. Recover ordering within that
        // same second from the write time, never from a later copied/touched file.
        const written = fs.statSync(path.join(ATTENTION_DIR, file)).mtimeMs;
        const since = Number(a.since);
        map.set(a.session_id, { ...a, recordedAt: Math.floor(written / 1000) === Math.floor(since / 1000) ? Math.max(since, written) : since });
      }
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

function readClaudeTranscriptSignal(record, sid) {
  // Claude's transcript schema and end_turn boundary are unrelated to Codex rollouts.
  const file = record.transcriptPath || (record.cwd && path.join(os.homedir(), '.claude', 'projects',
    String(record.cwd).replace(/[^a-zA-Z0-9]/g, '-'), `${sid}.jsonl`));
  if (!file) return null;
  const lines = tailFileText(file, CODEX_TAIL_BYTES).split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e.isSidechain) continue;
    const m = e.message || {};
    if (e.type !== 'assistant' && e.type !== 'user') continue;
    const at = Date.parse(e.timestamp) || 0;
    if (e.type === 'assistant' && m.stop_reason === 'end_turn' &&
        Array.isArray(m.content) && m.content.some(item => item.type === 'text') && (m.id || e.uuid)) {
      return { state: 'waiting', noticeKind: 'claude-final', noticeKey: `claude:${sid}:${m.id || e.uuid}:end_turn`, noticeAt: at, activityAt: at, signalAvailable: true };
    }
    return { state: 'busy', noticeKind: '', noticeKey: '', activityAt: at, signalAvailable: true };
  }
  return null;
}

function readClaudeSignal(name, titles, claudeIndex, attentionIndex) {
  const record = claudeIndex.get(name) || {};
  const sid = record.sessionId || (titles.get(name) || {}).sid || '';
  if (!SID_RE.test(sid)) return { state: 'idle', noticeKind: '', noticeKey: '', signalAvailable: false };
  const attention = attentionIndex.get(sid);
  const status = String(record.status || '');
  const activityAt = Number(record.statusUpdatedAt || record.updatedAt || 0);
  const transcript = readClaudeTranscriptSignal(record, sid);
  const since = Number(attention && attention.since || 0);
  const attentionAt = Number(attention && attention.recordedAt) || since;
  const superseded = (status !== 'waiting' && activityAt > attentionAt) || (transcript && transcript.activityAt > attentionAt);
  if (attention && Number.isFinite(since) && since > 0 && !superseded) {
    return {
      state: 'waiting', noticeKind: 'claude-attention', noticeKey: `claude:${sid}:${since}`,
      noticeAt: attentionAt, signalAvailable: true,
      attention: { message: String(attention.message || ''), since },
    };
  }
  if (status === 'busy' && (!transcript || activityAt >= transcript.activityAt)) {
    return { state: 'busy', noticeKind: '', noticeKey: '', signalAvailable: true };
  }
  return transcript || { state: 'idle', noticeKind: '', noticeKey: '', signalAvailable: Boolean(record.sessionId) };
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
  const panes = Array.isArray(live.paneTargets) ? live.paneTargets : [];
  if (t.paneId) return panes.find((pane) => pane.target.paneId === t.paneId) || null;
  if (t.windowId) return panes.find((pane) => pane.target.windowId === t.windowId) || null;
  if (t.window) return panes.find((pane) => pane.target.session === t.session && pane.target.window === t.window) || null;
  return panes.find((pane) => pane.target.session === t.session) || null;
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
  let heldSessions = [];
  let grid = { ...DEFAULT_GRID };
  let title = ctx.title;
  let hasSaved = false;
  let layoutRevision = 0;
  try {
    const source = fs.existsSync(ctx.layoutFile) ? ctx.layoutFile : ctx.legacyLayoutFile;
    const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
    layoutRevision = Number(parsed.layoutRevision) || 0;
    if (Array.isArray(parsed.slots)) {
      saved = parsed.slots;
      hasSaved = true;
    }
    if (parsed.spans && typeof parsed.spans === 'object') spans = parsed.spans;
    if (Array.isArray(parsed.heldSessions)) heldSessions = parsed.heldSessions.filter(isPanelName);
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

  if (hasSaved || !ctx.isDefault) {
    const state = { boardId: ctx.id, boardTitle: title, grid, slots, spans: cleanSpanMap(slots, spans), heldSessions, layoutRevision };
    // Older installed writers omit revisions. Stamp their saved layout before
    // collection so a newer panel's stale-capture guard cannot reject it forever.
    if (hasSaved && !layoutRevision && !board.observeOnly) writeLayoutState(state, board);
    return state;
  }

  for (const name of allSessions) {
    if (name === LARSON_DESKTOP_SESSION || used.has(name)) continue;
    const open = slots.indexOf('');
    if (open === -1) break;
    slots[open] = name;
    used.add(name);
  }
  return { boardId: ctx.id, boardTitle: title, grid, slots, spans: {}, layoutRevision };
}

function readLayout(allSessions, board = {}) {
  return readLayoutState(allSessions, board).slots;
}

function writeLayoutState(state, board = {}) {
  const ctx = boardContext({ ...board, boardId: state.boardId || (typeof board === 'object' ? board.boardId : board), boardTitle: state.boardTitle || (typeof board === 'object' ? board.boardTitle : '') });
  const grid = normalizeGrid(state.grid || {});
  const slots = Array.from({ length: grid.slotCount }, (_, i) => typeof state.slots[i] === 'string' ? state.slots[i] : '');
  const spans = cleanSpanMap(slots, state.spans);
  let savedRevision = 0;
  try { savedRevision = Number(JSON.parse(fs.readFileSync(ctx.layoutFile, 'utf8')).layoutRevision) || 0; } catch {}
  state.layoutRevision = Math.max(Date.now(), savedRevision + 1, (state.layoutRevision || 0) + 1);
  fs.mkdirSync(ctx.isDefault ? DATA_DIR : BOARDS_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    ctx.layoutFile,
    JSON.stringify({
      boardId: ctx.id,
      layoutRevision: state.layoutRevision,
      boardTitle: cleanBoardTitle(state.boardTitle || ctx.title, ctx.id),
      grid: { columns: grid.columns, rows: grid.rows },
      slots,
      spans,
      heldSessions: [...new Set(state.heldSessions || [])].filter(name => isPanelName(name) && !slots.includes(name)),
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
  session = canonicalSessionName(session);
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

function normalizeJarganPath(p) {
  const value = String(p || '').trim();
  if (!value) return JARGAN_ROOT;
  if (/^\/Users\/[^/]+\/JARGAN(?:\/|$)/.test(value)) return value.replace(/^\/Users\/[^/]+\/JARGAN/, JARGAN_ROOT);
  return value;
}

function parseJsonWithComments(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const clean = raw
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  return JSON.parse(clean);
}

function presetSessions() {
  try {
    const parsed = parseJsonWithComments(TERMINALS_JSON);
    return (parsed.terminals || [])
      .map((t) => {
        let command = ((t.commands || [])[0] || '').trim();
        if (!/claude --/.test(command)) return null;
        let session = '';
        const wrapped = command.match(/^bash \$HOME\/JARGAN\/scripts\/tmux-attach-and-reap\.sh (\S+) -- (.+)$/);
        const tmuxWrapped = command.match(/^tmux new -A -s ([\w.-]+) '(.+)'$/);
        if (wrapped) {
          session = wrapped[1];
          command = wrapped[2];
        } else if (tmuxWrapped) {
          session = tmuxWrapped[1];
          command = tmuxWrapped[2];
        } else {
          session = kebab(t.name);
        }
        if (/^claude /.test(command) && !/\s--rc\b/.test(command)) command += ' --rc --ide';
        return {
          label: t.name,
          description: session,
          detail: normalizeJarganPath(t.cwd || JARGAN_ROOT),
          session,
          cwd: normalizeJarganPath(t.cwd || JARGAN_ROOT),
          command,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

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
  const manifest = readManifest();
  const reserved = new Set(Object.entries(manifest.sessions).flatMap(([name, record]) => [name, ...(record.aliases || [])]));
  while (reserved.has(candidate) || await exactSessionExists(candidate)) {
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
    state.heldSessions = [...new Set([...(state.heldSessions || []), name])];
    writeLayoutState(state, board);
    return;
  }
  let slot = Number(placement);
  if (!Number.isInteger(slot) || slot < 0 || slot >= slots.length) {
    slot = slots.findIndex((s) => !s);
  }
  if (slot >= 0) {
    const displaced = slots[slot];
    if (displaced && displaced !== name) {
      state.heldSessions = [...new Set([...(state.heldSessions || []), displaced])];
      delete spans[displaced];
      if (boardContext(board).isDefault) updateManifestSlot(displaced, null);
    }
    slots[slot] = name;
  }
  writeLayoutState(state, board);
}

async function createAiSession({ session, cwd, command, initialPrompt, placement, title, board }) {
  const requestedName = session;
  session = sessionNameFor(session, title, initialPrompt);
  if (session !== requestedName) session = await uniqueSessionName(session);
  if (!NAME_RE.test(session)) throw new Error('Session names can use only letters, numbers, dot, underscore, and dash.');
  if (readManifest().sessions[session] || Object.values(readManifest().sessions).some(record => (record.aliases || []).includes(session)) || await exactSessionExists(session)) throw new Error(`${session} already exists; choose a different session name.`);
  const ctx = boardContext(board);
  const dir = normalizeJarganPath(cwd || JARGAN_ROOT);
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
    // A reused tmux name must not inherit a prior agent's recovery target.
    threadId: '',
    resumeId: '',
    lastSnapshot: '',
    target: defaultTarget(session),
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  const pendingPrompt = String(initialPrompt || '').trim();
  if (pendingPrompt) {
    patch.pendingPrompt = pendingPrompt;
    patch.pendingPromptQueuedAt = new Date().toISOString();
    patch.pendingPromptKind = '';
    patch.pendingPromptConversationId = '';
    patch.memory = seedSessionMemory(pendingPrompt, patch.pendingPromptQueuedAt);
  }
  if (ctx.isDefault) patch.slot = slotForName(session, placedState.slots);
  upsertManifestRecord(manifest, session, patch);
  writeManifest(manifest);
  if (pendingPrompt) schedulePendingPromptDelivery(session);
  return session;
}

// Meta Terminal reuses the normal tmux/session lifecycle and only adds a
// guarded natural-language entry point for an explicitly empty board slot.
async function createMetaSession({ goal, slot, kind, cwd, board }) {
  const text = String(goal || '').trim();
  const requestedSlot = Number(slot);
  const state = readLayoutState(await listAllSessions(), board);
  if (!text) throw new Error('Describe what the new terminal should do.');
  if (!Number.isInteger(requestedSlot) || requestedSlot < 0 || requestedSlot >= state.grid.slotCount) {
    throw new Error(`Choose a panel from 1 to ${state.grid.slotCount}.`);
  }
  if (state.slots[requestedSlot]) throw new Error(`Panel ${requestedSlot + 1} is occupied by ${state.slots[requestedSlot]}.`);
  const sessionKind = String(kind || '').toLowerCase() === 'claude' ? 'claude' : 'codex';
  const title = cleanTitle(roleTitle(text));
  const session = await uniqueSessionName(title);
  const command = sessionKind === 'claude'
    ? 'claude --dangerously-skip-permissions --model opus --effort max --rc --ide'
    : codexFullPermissionCommand();
  return createAiSession({ session, cwd: String(cwd || JARGAN_ROOT), command, initialPrompt: text, placement: String(requestedSlot), title, board });
}

function codexPromptReady(output) {
  return /Ask Codex to do anything/i.test(String(output || ''));
}

// The move-session helper documents skipping this menu without upgrading or
// restarting a pane. Inspect only the current screen, never old scrollback.
// Older running Codex processes may still show this modal after the global
// opt-out is saved. Handle only its explicit keep-model/never-again choice.
const codexNudgeDismissals = new Map();
function codexRateLimitNudgeVisible(output) {
  const text = cleanText(output).replace(/[›❯]/g, ' ').replace(/\s+/g, ' ').trim();
  return /Approaching rate limits Switch to [a-zA-Z0-9._-]+ for lower credit usage\?/.test(text)
    && /1\. Switch to [a-zA-Z0-9._-]+ .*2\. Keep current model 3\. Keep current model \(never show again\) Hide future rate limit reminders about switching models\. Press enter to confirm or esc to go back$/.test(text);
}

async function dismissCodexRateLimitNudge(target, observed) {
  if (!codexRateLimitNudgeVisible(observed)) return false;
  const key = targetLabel(target);
  if (Date.now() - (codexNudgeDismissals.get(key) || 0) < 3000) return false;
  codexNudgeDismissals.set(key, Date.now());
  // Recheck the current screen, without scrollback, immediately before input.
  // Historical/quoted menus and a dialog the user already closed are ignored.
  const current = await tmuxSocket(target.socket, ['capture-pane', '-p', '-J', '-t', targetSpec(target)], { timeout: 2500 });
  if (!codexRateLimitNudgeVisible(current)) return false;
  await tmuxSocket(target.socket, ['send-keys', '-t', targetSpec(target), '3', 'Enter'], { timeout: 2500 });
  return true;
}

function codexUpdatePromptVisible(output) {
  const text = String(output || '');
  return /Update available!/i.test(text) && /^\s*[›>]?\s*1\. Update now/m.test(text) &&
    /^\s*[›>]?\s*2\. Skip\s*$/m.test(text) && /Press enter to continue/i.test(text) &&
    !codexPromptReady(text);
}

function queuePendingPrompt(name, prompt) {
  name = canonicalSessionName(name);
  const manifest = readManifest();
  const record = manifest.sessions[name];
  if (!record) throw new Error(`${name} has no saved session record`);
  if (!record.pendingPrompt) {
    upsertManifestRecord(manifest, name, {
      ...record, pendingPrompt: String(prompt), pendingPromptQueuedAt: new Date().toISOString(),
      pendingPromptKind: '', pendingPromptConversationId: '',
    });
    writeManifest(manifest);
  }
  schedulePendingPromptDelivery(name);
}

function observedConversation(record) {
  if (!record) return { kind: '', id: '' };
  if (record.kind === 'codex' && SID_RE.test(String(record.threadId || ''))) return { kind: 'codex', id: record.threadId };
  if (record.kind === 'claude' && SID_RE.test(String(record.resumeId || ''))) return { kind: 'claude', id: record.resumeId };
  return { kind: '', id: '' };
}

function memoryHydrationPatch(name, record, conversation) {
  const current = normalizeSessionMemory(record && record.memory);
  const result = reconcileConversation(current, conversation);
  if (result.action === 'bind') return { memory: result.memory };
  if (result.action !== 'hydrate' || String(record.pendingPrompt || '').trim()) return {};
  return {
    pendingPrompt: composeHydrationPrompt(current, { session: name, memoryCommand: SESSION_MEMORY_COMMAND }),
    pendingPromptQueuedAt: new Date().toISOString(),
    pendingPromptKind: 'memory',
    pendingPromptConversationId: conversation.id,
  };
}

function queueMemoryHydration(name, conversation) {
  name = canonicalSessionName(name);
  const manifest = readManifest();
  const record = manifest.sessions[name];
  if (!record) throw new Error(`${name} has no saved session record`);
  const patch = memoryHydrationPatch(name, record, conversation);
  if (Object.keys(patch).length) {
    upsertManifestRecord(manifest, name, { ...record, ...patch });
    writeManifest(manifest);
  }
  if (manifest.sessions[name] && manifest.sessions[name].pendingPromptKind === 'memory') schedulePendingPromptDelivery(name);
}

function updateSessionMemory(session, messageType, payload = {}) {
  session = canonicalSessionName(session);
  if (!NAME_RE.test(String(session || ''))) throw new Error('A valid session is required');
  const revision = Number(payload.revision);
  if (!Number.isInteger(revision) || revision < 0) throw new Error('A current session memory revision is required');
  const operations = {
    memoryUpdateContext: { type: 'replace-context', contextSummary: payload.value },
    memoryUpdateCharter: { type: 'replace-approved-charter', approvedCharter: payload.value },
    memoryApproveCharter: { type: 'approve-charter', revision },
    memoryRejectCharter: { type: 'reject-charter', revision },
  };
  const operation = operations[messageType];
  if (!operation) throw new Error(`Unsupported session memory message: ${messageType || 'missing'}`);
  return updateSessionMemoryFile({ manifestFile: MANIFEST_FILE, session, expectedRevision: revision, operation });
}

function codexTrustPromptVisible(output) {
  const text = String(output || '');
  return /Do you trust the contents of this directory\?/i.test(text) && /1\. Yes, continue/i.test(text);
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
      if (record.pendingPromptKind === 'memory') {
        const conversation = observedConversation(record);
        if (!conversation.id || conversation.id !== record.pendingPromptConversationId) return false;
      }
      const target = normalizeTarget(record.target, name) || defaultTarget(name);
      let output = '';
      try {
        output = await tmuxSocket(target.socket, ['capture-pane', '-p', '-J', '-t', targetSpec(target)], { timeout: 2500 });
      } catch {}
      const kind = record.kind === 'unknown' ? kindForCommand(record.command) : record.kind;
      if (kind === 'codex' && codexUpdatePromptVisible(output)) {
        await tmuxSocket(target.socket, ['send-keys', '-t', targetSpec(target), '2', 'Enter'], { timeout: 3000 });
        await new Promise((resolve) => setTimeout(resolve, INITIAL_PROMPT_POLL_MS));
        continue;
      }
      if (kind === 'codex' && codexTrustPromptVisible(output)) {
        await sendKey(name, 'enter');
        await new Promise((resolve) => setTimeout(resolve, INITIAL_PROMPT_POLL_MS));
        continue;
      }
      if (kind !== 'codex' || codexPromptReady(output)) {
        await sendPrompt(name, prompt, 'enter', { startup: true });
        const latest = readManifest();
        const current = latest.sessions[name];
        if (current && current.pendingPrompt === prompt) {
          let memory = current.memory;
          if (current.pendingPromptKind === 'memory') {
            const conversation = observedConversation(current);
            if (!conversation.id || conversation.id !== current.pendingPromptConversationId) return false;
            memory = applyMemoryOperation(memory, { type: 'mark-hydrated', conversation });
          }
          upsertManifestRecord(latest, name, {
            ...current, memory, pendingPrompt: '', pendingPromptQueuedAt: '', pendingPromptKind: '', pendingPromptConversationId: '',
          });
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

function clearHeldBoardMembership(session) {
  for (const item of readBoardSummaries()) {
    if (!(item.heldSessions || []).includes(session)) continue;
    const context = boardContext({ boardId: item.id, boardTitle: item.title });
    const state = readLayoutState([], context);
    state.heldSessions = (state.heldSessions || []).filter(name => name !== session);
    writeLayoutState(state, context);
  }
}

function holdSession(session, { forgetBoard = false } = {}) {
  session = canonicalSessionName(session);
  if (!isPanelName(session)) throw new Error('bad session');
  let removedFromDefault = false;
  for (const item of readBoardSummaries()) {
    const context = boardContext({ boardId: item.id, boardTitle: item.title });
    const state = readLayoutState([], context);
    const placed = state.slots.includes(session) || Object.prototype.hasOwnProperty.call(state.spans, session);
    const held = (state.heldSessions || []).includes(session);
    if (!placed && !(forgetBoard && held)) continue;
    state.slots = state.slots.map(name => name === session ? '' : name);
    delete state.spans[session];
    state.heldSessions = forgetBoard
      ? (state.heldSessions || []).filter(name => name !== session)
      : [...new Set([...(state.heldSessions || []), session])];
    writeLayoutState(state, context);
    if (placed && context.isDefault) removedFromDefault = true;
  }
  if (removedFromDefault) updateManifestSlot(session, null);
}

async function assignHeldBoard(session, boardId) {
  const allSessions = await listKnownSessions();
  session = canonicalSessionName(session, allSessions);
  if (!session || (session !== LARSON_DESKTOP_SESSION && !allSessions.includes(session))) throw new Error(`unknown session: ${session || 'empty'}`);
  const summaries = readBoardSummaries();
  if (summaries.some(board => board.slots.includes(session))) throw new Error('This session is no longer in Holding. Refresh its placement.');
  const requested = String(boardId || '').trim();
  const summary = requested ? summaries.find(board => board.id === requested) : null;
  if (requested && !summary) throw new Error(`unknown board: ${requested}`);
  clearHeldBoardMembership(session);
  updateManifestSlot(session, null);
  if (summary) {
    const context = boardContext({boardId:summary.id, boardTitle:summary.title});
    const state = readLayoutState([], context);
    state.heldSessions = [...new Set([...(state.heldSessions || []), session])];
    writeLayoutState(state, context);
  }
  return {held:true, board:summary ? {id:summary.id, title:summary.title} : null};
}

async function byeSession(session, board = {}) {
  session = canonicalSessionName(session);
  if (!NAME_RE.test(session)) throw new Error('bad session');
  const { target } = await resolveSessionActionTarget(session);
  try {
    // The trailing colon forces tmux to parse dotted names as complete session
    // names. Without it, an already-exited session such as 2.1.251 is parsed as
    // a window/pane target and reports the wrong missing-target error.
    await tmuxSocket(target.socket, ['kill-session', '-t', `${sessionSpec(target)}:`], { timeout: 3000 });
  } catch (err) {
    // End also removes saved assignments for sessions that already exited.
    // Keep state intact on real failures (permissions, timeouts, etc.).
    const stderr = String(err.stderr || '').trim();
    const alreadyGone = /^can't find session:/m.test(stderr)
      || /^no server running on /m.test(stderr)
      || /^error connecting to .+ \(No such file or directory\)$/m.test(stderr);
    if (!alreadyGone) throw err;
  }
  holdSession(session, {forgetBoard:true});
  const manifest = readManifest();
  if (manifest.sessions[session]) {
    delete manifest.sessions[session];
    writeManifest(manifest);
  }
}

function moveSessionFiles(from, to) {
  for (const directory of [SNAPSHOT_DIR, SCROLLBACK_DIR, HYDRATION_DIR]) {
    const source = path.join(directory, `${from}.txt`);
    const destination = path.join(directory, `${to}.txt`);
    try {
      if (fs.existsSync(source) && !fs.existsSync(destination)) {
        if (directory === HYDRATION_DIR) fs.copyFileSync(source, destination);
        else fs.renameSync(source, destination);
      }
    } catch {}
  }
}

async function renameBoardTitle(title, board = {}) {
  const ctx = boardContext(board);
  const nextTitle = cleanBoardTitle(title, ctx.id);
  let state = {};
  try {
    const source = fs.existsSync(ctx.layoutFile) ? ctx.layoutFile : ctx.legacyLayoutFile;
    state = JSON.parse(fs.readFileSync(source, 'utf8')) || {};
  } catch {}
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
  // A rename must not run the layout through normalization: stale or
  // temporarily unavailable sessions must not change panel placement or span.
  state.boardId = ctx.id;
  state.boardTitle = nextTitle;
  state.updatedAt = new Date().toISOString();
  fs.mkdirSync(ctx.isDefault ? DATA_DIR : BOARDS_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(ctx.layoutFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  return { id: ctx.id, title: nextTitle };
}

async function renameTmuxSession(session, nextName) {
  session = canonicalSessionName(session);
  if (!NAME_RE.test(session) || !NAME_RE.test(nextName)) throw new Error('tmux names may use only letters, numbers, dot, underscore, and dash');
  if (session === nextName) return nextName;
  if (readManifest().sessions[nextName] || Object.values(readManifest().sessions).some(record => (record.aliases || []).includes(nextName)) || await exactSessionExists(nextName)) throw new Error(`${nextName} already exists`);
  const { target, live, record: savedRecord } = await resolveSessionActionTarget(session);
  if (!live && !savedRecord) throw new Error(`Unknown session: ${session}`);
  const renameLiveSurface = live && target.session === session;
  if (renameLiveSurface) await tmuxSocket(target.socket, ['rename-session', '-t', sessionSpec(target), nextName], { timeout: 3000 });

  const titleRecords = readTitleRecords();
  let titlesChanged = false;
  for (const record of titleRecords) {
    if (record.tmux !== session) continue;
    record.tmux = nextName;
    titlesChanged = true;
  }
  if (titlesChanged) writeTitleRecords(titleRecords);

  const manifest = readManifest();
  const record = manifest.sessions[session] || {};
  delete manifest.sessions[session];
  upsertManifestRecord(manifest, nextName, {
    ...record,
    name: nextName,
    aliases: [...new Set([...(record.aliases || []), session])],
    lastSnapshot: record.lastSnapshot === snapshotPathFor(session) ? snapshotPathFor(nextName) : record.lastSnapshot,
    target: { ...target, session: target.session === session ? nextName : target.session },
    lastSeenAt: new Date().toISOString(),
  });
  writeManifest(manifest);

  for (const item of readBoardSummaries()) {
    const context = boardContext({ boardId: item.id, boardTitle: item.title });
    const state = readLayoutState([], context);
    let changed = false;
    state.slots = state.slots.map((name) => {
      if (name !== session) return name;
      changed = true;
      return nextName;
    });
    state.heldSessions = (state.heldSessions || []).map(name => { if (name !== session) return name; changed = true; return nextName; });
    if (state.spans[session] !== undefined) {
      state.spans[nextName] = state.spans[session];
      delete state.spans[session];
      changed = true;
    }
    if (changed) writeLayoutState(state, context);
  }
  if (paneScrollbackLatest.has(session)) {
    paneScrollbackLatest.set(nextName, paneScrollbackLatest.get(session));
    paneScrollbackLatest.delete(session);
  }
  moveSessionFiles(session, nextName);
  if (record.pendingPrompt) schedulePendingPromptDelivery(nextName);
  return nextName;
}

async function moveSessionToBoard(session, boardId) {
  const allSessions = await listKnownSessions();
  session = canonicalSessionName(session, allSessions);
  if (!session || (session !== LARSON_DESKTOP_SESSION && !allSessions.includes(session))) throw new Error(`unknown session: ${session || 'empty'}`);
  const requestedBoardId = String(boardId || '').trim();
  if (!requestedBoardId) {
    holdSession(session, {forgetBoard:true});
    updateManifestSlot(session, null);
    return { held: true };
  }
  const summary = readBoardSummaries().find((item) => item.id === requestedBoardId);
  if (!summary) throw new Error(`unknown board: ${requestedBoardId}`);
  const destination = boardContext({ boardId: summary.id, boardTitle: summary.title });
  const state = readLayoutState(allSessions, destination);
  let slot = state.slots.indexOf(session);
  if (slot === -1) slot = state.slots.findIndex((name) => !name);
  if (slot === -1) throw new Error(`No empty slot on ${destination.title}`);
  holdSession(session, {forgetBoard:true});
  await assignSlot(slot, session, destination);
  return { held: false, board: destination, slot };
}

async function assignSlot(slot, session, board = {}) {
  const ctx = boardContext(board);
  const allSessions = await listKnownSessions();
  session = canonicalSessionName(session, allSessions);
  const existing = new Set(allSessions);
  const state = readLayoutState(allSessions, board);
  if (!Number.isInteger(slot) || slot < 0 || slot >= state.slots.length) throw new Error(`slot must be 0-${state.slots.length - 1}`);
  if (session && session !== LARSON_DESKTOP_SESSION && !existing.has(session)) throw new Error(`unknown session: ${session}`);
  const { slots, spans } = state;
  const displaced = slots[slot];
  if (displaced && displaced !== session) {
    delete spans[displaced];
    state.heldSessions = [...new Set([...(state.heldSessions || []), displaced])];
  }
  for (let i = 0; i < slots.length; i += 1) {
    if (slots[i] === session) slots[i] = '';
  }
  if (session) { delete spans[session]; clearHeldBoardMembership(session); }
  slots[slot] = session || '';
  writeLayoutState(state, board);
  if (ctx.isDefault && displaced && displaced !== session) updateManifestSlot(displaced, null);
  if (ctx.isDefault && session) updateManifestSlot(session, slot);
}

async function moveSlot(fromSlot, toSlot, session, board = {}, expectedTarget) {
  const ctx = boardContext(board);
  // Existing placements are authoritative: swapping them needs no tmux discovery.
  const allSessions = Number.isInteger(fromSlot) && fs.existsSync(ctx.layoutFile) ? [] : await listKnownSessions();
  if (allSessions.length) session = canonicalSessionName(session, allSessions);
  const existing = new Set(allSessions);
  const state = readLayoutState(allSessions, board);
  if (!Number.isInteger(toSlot) || toSlot < 0 || toSlot >= state.slots.length) throw new Error(`target slot must be 0-${state.slots.length - 1}`);
  const { slots, spans } = state;

  if (Number.isInteger(fromSlot) && fromSlot >= 0 && fromSlot < slots.length) {
    const moving = slots[fromSlot];
    if (!moving || (session && moving !== session)) throw new Error('The source panel changed. Try the move again.');
    if (expectedTarget !== undefined && (slots[toSlot] || '') !== expectedTarget) throw new Error('The destination panel changed. Try the move again.');
    if (fromSlot === toSlot) return state;
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
    return state;
  }

  if (!session || (session !== LARSON_DESKTOP_SESSION && !existing.has(session))) throw new Error(`unknown session: ${session}`);
  for (let i = 0; i < slots.length; i += 1) {
    if (slots[i] === session) slots[i] = '';
  }
  const displaced = slots[toSlot];
  if (displaced) {
    delete spans[displaced];
    state.heldSessions = [...new Set([...(state.heldSessions || []), displaced])];
  }
  clearHeldBoardMembership(session);
  delete spans[session];
  slots[toSlot] = session;
  writeLayoutState(state, board);
  if (ctx.isDefault && displaced) updateManifestSlot(displaced, null);
  if (ctx.isDefault) updateManifestSlot(session, toSlot);
  return state;
}

async function movePanelResult(msg, board = {}) {
  try {
    if (msg.hues && ![msg.hues.from, msg.hues.to].every(hue => hue === null || Number.isInteger(hue) && hue >= 0 && hue <= 359)) throw new Error('Invalid panel hues');
    const priorLayout = msg.hues ? readLayoutState([], board) : null;
    const layout = await moveSlot(Number.isInteger(msg.fromSlot) ? msg.fromSlot : null, Number(msg.toSlot), String(msg.session || ''), board, msg.expectedTarget);
    let hues;
    if (msg.hues && Number.isInteger(msg.fromSlot) && msg.fromSlot !== Number(msg.toSlot)) {
      hues = { from: layout.slots[msg.fromSlot] ? msg.hues.to : null, to: msg.hues.from };
      const key = 'terminaltown-panel-hues-' + layout.boardId;
      try {
        extensionPreferenceStore.patch('panel_moves', [
          { key, field: String(msg.fromSlot), value: hues.from },
          { key, field: String(msg.toSlot), value: hues.to },
        ]);
      } catch (error) {
        // A failed color write must not leave a successful-looking, mismatched move.
        if (readLayoutState([], board).layoutRevision === layout.layoutRevision) {
          writeLayoutState(priorLayout, board);
          if (boardContext(board).isDefault) {
            for (const slot of [msg.fromSlot, Number(msg.toSlot)]) {
              if (priorLayout.slots[slot]) updateManifestSlot(priorLayout.slots[slot], slot);
            }
          }
        }
        throw error;
      }
    }
    return { type: 'moveResult', moveId: msg.moveId, ok: true, layout, ...(hues ? { hues } : {}) };
  } catch (error) {
    return { type: 'moveResult', moveId: msg.moveId, ok: false, error: error.message, layout: readLayoutState([], board) };
  }
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

  const displaced = slots[neighbor] && slots[neighbor] !== session ? slots[neighbor] : '';
  if (displaced === LARSON_DESKTOP_SESSION) throw new Error('Move the Larson Desktop panel before expanding into it.');
  if (displaced) {
    delete spans[displaced];
    state.heldSessions = [...new Set([...(state.heldSessions || []), displaced])];
  }
  const destination = direction === 'up' ? neighbor : slot;
  if (direction === 'up') {
    slots[slot] = '';
    slots[neighbor] = session;
  } else {
    slots[neighbor] = '';
  }
  spans[session] = 2;
  // Keep recovery metadata in sync: otherwise polling restores the displaced
  // session into the empty cell underneath the expanded panel.
  if (boardContext(board).isDefault) {
    if (displaced) updateManifestSlot(displaced, null);
    updateManifestSlot(session, destination);
  }
  writeLayoutState(state, board);
  return { session, span: 2, slot: destination, displaced, displacedSlot: displaced ? neighbor : null };
}

async function resetCellSizes(board = {}) {
  const state = readLayoutState([], board);
  writeLayoutState({ ...state, spans: {} }, board);
}

async function resetSlots(board = {}) {
  const state = readLayoutState([], board);
  // Auto Fill is a layout action, not a global session discovery action.
  // Keep only sessions already assigned to this board and pack them into slots.
  const assigned = state.slots.filter(Boolean);
  writeLayout(assigned.slice(0, state.grid.slotCount), {}, board);
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
  const parked = state.slots.slice(nextGrid.slotCount).filter(Boolean);
  const heldSessions = [...new Set([...(state.heldSessions || []), ...parked])];
  writeLayoutState({ ...state, grid: nextGrid, slots: nextSlots, heldSessions }, board);
  if (boardContext(board).isDefault) for (const name of parked) updateManifestSlot(name, null);
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

function recordNameForClaude(record, titleBySid, existingNames, savedSlots = [], reservedNames = existingNames) {
  const available = (base, reserveSlots = false) => {
    if (!(reserveSlots ? existingNames : reservedNames).has(base)) return base;
    let suffix = 2; let name;
    do {
      const ending = `-${suffix++}`;
      name = base.slice(0, 64 - ending.length) + ending;
    } while (existingNames.has(name) || reservedNames.has(name));
    return name;
  };
  const sid = String(record.sessionId || '');
  const titleRecords = titleBySid.get(sid) || [];
  const existing = titleRecords.find((item) => existingNames.has(item.tmux) && !genericName(item.tmux));
  if (existing && NAME_RE.test(existing.tmux)) return available(existing.tmux);
  const cwdBase = path.basename(String(record.cwd || ''));
  const cwdSlot = savedSlots.find((name) => name === cwdBase && name === record.tmuxName);
  if (cwdSlot) return available(cwdSlot);
  const inactive = titleRecords.find((item) => NAME_RE.test(item.tmux) && !genericName(item.tmux) && item.tmux !== record.tmuxName);
  if (inactive) return available(inactive.tmux);
  if (NAME_RE.test(record.tmuxName || '') && !genericName(record.tmuxName) && record.tmuxName !== 'fleet') return available(record.tmuxName);
  if (NAME_RE.test(record.windowName || '') && !genericName(record.windowName) && !savedSlots.includes(record.windowName)) return available(record.windowName);
  const base = slug(record.title && !genericName(record.title) ? roleTitle(record.title) : `${cwdBase || 'workspace'} session`);
  return available(base, true);
}

function adoptLiveClaudeRecords(manifest, slots, titles, claudeRecords, liveTargets, options = {}) {
  let changed = 0;
  const writeSlots = options.writeSlots !== false;
  const titleRecords = readTitleRecords();
  const bySid = titleRecordsBySid(titleRecords);
  const reservedNames = new Set(Object.entries(manifest.sessions).flatMap(([name, record]) => [name, ...(record.aliases || [])]));
  const existingNames = new Set([...slots.filter(Boolean), ...reservedNames]);

  for (const record of claudeRecords) {
    if (!record.target || !targetIsLive(record.target, liveTargets)) continue;
    const livePane = findLivePaneByTarget(liveTargets, record.target) || {};
    if (livePane.windowName) record.windowName = livePane.windowName;
    const existingBySid = Object.entries(manifest.sessions)
      .find(([, item]) => item && item.resumeId === record.sessionId);
    const existingByTarget = Object.entries(manifest.sessions)
      .find(([existingName, item]) => {
        const target = normalizeTarget(item && item.target, existingName);
        return target && target.session === record.target.session && target.socket === record.target.socket;
      });
    const name = existingBySid || existingByTarget
      ? (existingBySid || existingByTarget)[0]
      : recordNameForClaude(record, bySid, existingNames, slots, reservedNames);
    if (!NAME_RE.test(name)) continue;
    existingNames.add(name);
    reservedNames.add(name);
    const titleRecord = titleRecordForName(name, titleRecords);
    const prev = manifest.sessions[name];
    const title = cleanTitle((prev && prev.title) || (titleRecord && titleRecord.title) || titles.get(name)?.title || record.title || record.windowName || name);
    const now = Date.now();
    const prevSeen = Date.parse(prev && prev.lastSeenAt || '') || 0;
    const patch = {
      kind: 'claude',
      title,
      cwd: record.cwd || livePane.cwd || '',
      command: `claude --dangerously-skip-permissions --resume ${record.sessionId} --rc --ide`,
      resumeId: record.sessionId,
      threadId: '',
      target: normalizeTarget({ socket: record.target.socket, session: record.target.session }, name),
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
  names.push(LARSON_DESKTOP_SESSION);
  return names.filter((name) => name === LARSON_DESKTOP_SESSION || liveSessionNames.includes(name) || (manifest.sessions[name] && (targetIsLive(manifest.sessions[name].target, liveTargets) || recordCanRecover(manifest.sessions[name]))));
}

function recordCanRecover(record) {
  return Boolean(record && (record.resumeId || record.threadId || record.command));
}

function restoreManifestSlots(state, manifest, liveTargets) {
  if (!state || !manifest || !manifest.sessions) return { state, changed: false };
  const slots = [...state.slots];
  const used = new Set(slots.filter(Boolean));
  const summaries = readBoardSummaries();
  const heldOnAnyBoard = new Set(summaries.flatMap(board => board.heldSessions || []));
  const placedOnOtherBoards = new Set(summaries
    .filter(board => board.id !== DEFAULT_BOARD_ID)
    .flatMap(board => board.slots.filter(Boolean)));
  let changed = false;
  const latest = fs.existsSync(MANIFEST_FILE) ? readManifest() : manifest;
  const records = Object.entries(manifest.sessions)
    .filter(([name, record]) => NAME_RE.test(String(name || '')) && Number.isInteger(record.slot))
    .sort((a, b) => Number(a[1].slot) - Number(b[1].slot));

  for (const [name, record] of records) {
    const slot = Number(record.slot);
    const current = latest.sessions[name];
    if (!current || current.slot !== record.slot) continue;
    if (slot < 0 || slot >= slots.length) continue;
    // Legacy and external writers can record a named-board slot in the shared
    // manifest. Only an unassigned record may recover into a default-board gap.
    if (placedOnOtherBoards.has(name) && !used.has(name)) continue;
    // A resize may have parked this session after the caller read its manifest.
    if (heldOnAnyBoard.has(name) || (state.heldSessions || []).includes(name) || used.has(name) || slots[slot]) continue;
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
  return resolveSessionName(session, readManifest(), knownSessions, readTitleRecords());
}

async function sessionDirectory(query = '') {
  const manifest = readManifest();
  const liveTargets = await readLiveTargets(manifest);
  const liveNames = allLiveSessionNames(liveTargets);
  for (const [name, record] of Object.entries(manifest.sessions)) if (targetIsLive(record.target || defaultTarget(name), liveTargets) && !liveNames.includes(name)) liveNames.push(name);
  return searchDirectory(readDirectory({ dataDir: DATA_DIR, manifestFile: MANIFEST_FILE, titlesFile: TITLES_FILE, liveNames }), query);
}

// Live context = what the last request re-sent. Every turn pays for all of it.
function readCodexContextTokens(threadId, codexPaths) {
  const file = SID_RE.test(threadId || '') && codexPaths && codexPaths.get(threadId);
  if (!file) return 0;
  const lines = tailFileText(file, CODEX_TAIL_BYTES).split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const p = e && e.payload || {};
    if (e.type === 'event_msg' && p.type === 'token_count' && p.info && p.info.last_token_usage) {
      return Number(p.info.last_token_usage.input_tokens) || 0;
    }
  }
  return 0;
}

function claudeTranscriptFile(record) {
  if (!record) return '';
  if (record.transcriptPath) return record.transcriptPath;
  if (!record.cwd || !SID_RE.test(record.sessionId || '')) return '';
  return path.join(os.homedir(), '.claude', 'projects', String(record.cwd).replace(/[^A-Za-z0-9]/g, '-'), `${record.sessionId}.jsonl`);
}

function readClaudeContextTokens(record) {
  const file = claudeTranscriptFile(record);
  if (!file) return 0;
  const lines = tailFileText(file, 262144).split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const u = e && e.type === 'assistant' && e.message && e.message.usage;
    if (u) return (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0);
  }
  return 0;
}

// A chartered panel restarts from charter + context, never from its old
// transcript. The prompt rides on the launch command so no follow-up turn is needed.
function agentFreshStartCommand(name, record) {
  const memory = normalizeSessionMemory(record && record.memory);
  const kind = record && record.kind;
  if (!NAME_RE.test(String(name || '')) || !memory.approvedCharter || !['claude', 'codex'].includes(kind)) return '';
  return launchWithPromptFile(name, kind, composeHydrationPrompt(memory, { session: name, memoryCommand: SESSION_MEMORY_COMMAND, mode: 'standby' }), record);
}

function isRunningAgent(record, command) {
  const current = String(command || '').trim();
  if (/^(?:codex|claude)(?:\s|$)/i.test(current)) return true;
  // Native Claude installs can expose their version as the process name.
  // Match only the saved Claude executable, never an arbitrary numeric command.
  const executable = String(record?.command || '').trim().split(/\s+/)[0];
  return record?.kind === 'claude' && /^\d+\.\d+\.\d+$/.test(current) &&
    /\/claude\/versions\//.test(executable) && path.basename(executable) === current;
}

function isDormantAgent(record, command) {
  return Boolean(record && ['claude', 'codex'].includes(record.kind) &&
    /^(?:zsh|bash|sh|fish|-zsh|-bash|missing)$/.test(String(command || '')));
}

// What a sleeping panel shows instead of the dead shell it left behind.
function readyPanelText(record, { compact = false } = {}) {
  const memory = normalizeSessionMemory(record && record.memory);
  const first = (value) => (String(value || '').split('\n').find((line) => line.trim()) || '').trim().slice(0, 240);
  const agent = record && record.kind === 'codex' ? 'Codex' : 'Claude';
  const lines = ['READY', '', compact
    ? `${agent} starts a fresh conversation${memory.approvedCharter ? ' with the saved role and context' : ''}.`
    : `Type a message below to start this panel. ${agent} starts fresh with this panel's charter and saved memory plus your message, in one launch. Nothing runs or spends tokens until then.`];
  if (first(memory.approvedCharter)) lines.push('', `Role: ${first(memory.approvedCharter)}`);
  if (first(memory.contextSummary)) lines.push(`Last context: ${first(memory.contextSummary)}`);
  return lines.join('\n');
}

// The launch prompt travels in a private file so the shell never parses it.
function launchWithPromptFile(name, kind, text, record = null) {
  fs.mkdirSync(HYDRATION_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(HYDRATION_DIR, `${name}.txt`);
  fs.writeFileSync(file, String(text), { mode: 0o600 });
  const arg = `"$(cat ${shellSingleQuote(file)})"`;
  return kind === 'claude'
    ? `claude --dangerously-skip-permissions --rc --ide ${arg}`
    : codexPanelCommand(record, arg);
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// A dead panel costs nothing while idle. The user's first message starts a
// fresh agent with charter + context + that message in one launch prompt.
async function startAgentOnFirstMessage(session, record, target, live, prompt) {
  if (!record || !['claude', 'codex'].includes(record.kind)) return false;
  // Only an explicit "not live" recreates the tmux session.
  live = live !== false;
  if (live) {
    let paneCommand = '';
    try {
      paneCommand = String(await tmuxSocket(target.socket, ['display-message', '-p', '-t', targetSpec(target), '#{pane_current_command}'], { timeout: 3000 })).trim();
    } catch { return false; }
    if (!/^(?:zsh|bash|sh|fish|-zsh|-bash)$/.test(paneCommand)) return false;
  }
  const memory = normalizeSessionMemory(record.memory);
  const text = memory.approvedCharter
    ? `${composeHydrationPrompt(memory, { session, memoryCommand: SESSION_MEMORY_COMMAND })}\n\nUSER REQUEST\n${String(prompt).trim()}`
    : String(prompt).trim();
  const command = launchWithPromptFile(session, record.kind, text, record);
  const cwd = record.cwd && fs.existsSync(record.cwd) ? record.cwd : '';
  let liveTarget = target;
  if (live) {
    await tmuxSocket(target.socket, ['send-keys', '-t', targetSpec(target), cwd ? `cd ${shellSingleQuote(cwd)} && ${command}` : command, 'Enter'], { timeout: 5000 });
  } else {
    liveTarget = await spawnRecoveredSession(session, record, command);
  }
  const manifest = readManifest();
  const current = manifest.sessions[session] || record;
  upsertManifestRecord(manifest, session, {
    ...current,
    ...(memory.approvedCharter ? freshStartPatch(current) : { resumeId: '', threadId: '', rotation: null }),
    target: liveTarget,
    lastSeenAt: new Date().toISOString(),
  });
  writeManifest(manifest);
  return true;
}

function freshStartPatch(record) {
  return {
    resumeId: '', threadId: '',
    memory: applyMemoryOperation(normalizeSessionMemory(record.memory), { type: 'await-initial-conversation' }),
    rotation: null,
  };
}

// Code-driven rotation: land (agent saves context) -> /clear -> hydrate.
async function applyPanelRotations(sessions) {
  if (panelRotationRunning) return [];
  panelRotationRunning = true;
  const actions = [];
  try {
    const now = Date.now();
    for (const s of sessions || []) {
      if (!s || !NAME_RE.test(String(s.name || '')) || s.missing) continue;
      // Saved conversation IDs and token counts outlive killed agents. Only a
      // running agent may receive a landing prompt or /clear.
      if (!/^(?:codex|claude)(?:\s|$)/i.test(String(s.command || ''))) {
        panelIdleSince.delete(s.name);
        continue;
      }
      const idle = ['idle', 'waiting'].includes(s.state);
      if (!idle) panelIdleSince.delete(s.name);
      else if (!panelIdleSince.has(s.name)) panelIdleSince.set(s.name, now);
      const manifest = readManifest();
      const record = manifest.sessions && manifest.sessions[s.name];
      if (!record || !normalizeSessionMemory(record.memory).approvedCharter) continue;
      if (String(record.pendingPrompt || '').trim()) continue;
      const kind = s.threadId ? 'codex' : (s.resumeId ? 'claude' : '');
      const conversationId = s.threadId || s.resumeId || '';
      const decision = rotationDecision({
        memory: record.memory, rotation: record.rotation || null, contextTokens: s.contextTokens,
        state: s.state, clients: s.clients, conversationId, idleSince: panelIdleSince.get(s.name) || 0,
        now, threshold: PANEL_ROTATE_TOKENS,
      });
      if (decision.action === 'none') continue;
      const patch = { rotation: decision.rotation };
      if (kind === 'codex') Object.assign(patch, { kind, threadId: s.threadId });
      if (kind === 'claude') Object.assign(patch, { kind, resumeId: s.resumeId });
      if (decision.action === 'land') {
        Object.assign(patch, {
          pendingPrompt: composeLandingPrompt(s.contextTokens, SESSION_MEMORY_COMMAND),
          pendingPromptQueuedAt: new Date(now).toISOString(),
          pendingPromptKind: 'rotation',
          pendingPromptConversationId: conversationId,
        });
      }
      upsertManifestRecord(manifest, s.name, { ...record, ...patch });
      writeManifest(manifest);
      if (decision.action === 'land') schedulePendingPromptDelivery(s.name);
      if (decision.action === 'clear') { panelIdleSince.delete(s.name); await sendPrompt(s.name, '/clear'); }
      if (decision.action === 'hydrate') queueMemoryHydration(s.name, { kind, id: conversationId });
      actions.push({ name: s.name, action: decision.action });
    }
  } finally {
    panelRotationRunning = false;
  }
  return actions;
}

async function spawnRecoveredSession(name, record, freshCommand = '') {
  if (!NAME_RE.test(name)) throw new Error(`bad session name: ${name}`);
  if (await exactSessionExists(name)) throw new Error(`${name} already exists`);
  const cwd = normalizeJarganPath(record.cwd || JARGAN_ROOT);
  if (!fs.existsSync(cwd)) throw new Error(`Directory does not exist: ${cwd}`);
  let command = String(record.command || '').trim();
  if (freshCommand) {
    command = freshCommand;
  } else if (record.kind === 'claude' && SID_RE.test(record.resumeId || '')) {
    command = `claude --dangerously-skip-permissions --resume ${record.resumeId} --rc --ide`;
  } else if (record.kind === 'codex' && SID_RE.test(record.threadId || '')) {
    command = codexPanelResumeCommand(record);
  }
  if (!command) throw new Error(`${name} has no recovery command`);
  await tmux(['new-session', '-d', '-s', name, '-c', cwd], { timeout: 5000 });
  await tmux(['send-keys', '-t', `=${name}:`, command, 'Enter'], { timeout: 5000 });
  return defaultTarget(name);
}

function agentResumeCommand(record) {
  if (record && record.kind === 'claude' && SID_RE.test(record.resumeId || '')) {
    return `claude --dangerously-skip-permissions --resume ${record.resumeId} --rc --ide`;
  }
  if (record && record.kind === 'codex' && SID_RE.test(record.threadId || '')) {
    return codexPanelResumeCommand(record);
  }
  return '';
}

async function reviveExitedAiSessions(sessions, manifest) {
  const now = Date.now();
  for (const session of sessions || []) {
    const record = manifest.sessions && manifest.sessions[session.name];
    const fresh = agentFreshStartCommand(session.name, record);
    const command = fresh || agentResumeCommand(record);
    const paneCommand = String(session.command || '').trim().toLowerCase();
    if (!command || Number(session.clients || 0) > 0 || !/^(?:zsh|bash|sh|fish)$/.test(paneCommand)) continue;
    if (now - (agentRestartAttempts.get(session.name) || 0) < AGENT_RESTART_COOLDOWN_MS) continue;
    const target = normalizeTarget(session.targetRaw || record.target, session.name);
    if (!target) continue;
    agentRestartAttempts.set(session.name, now);
    try {
      await tmuxSocket(target.socket, ['send-keys', '-t', targetSpec(target), command, 'Enter'], { timeout: 5000 });
      if (fresh) {
        const latest = readManifest();
        if (latest.sessions[session.name]) {
          upsertManifestRecord(latest, session.name, { ...latest.sessions[session.name], ...freshStartPatch(latest.sessions[session.name]) });
          writeManifest(latest);
          Object.assign(manifest.sessions[session.name], freshStartPatch(manifest.sessions[session.name]));
        }
      }
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
    if (name === LARSON_DESKTOP_SESSION) continue;
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
        cwd: liveClaude.cwd || livePane.cwd || (current && current.cwd) || JARGAN_ROOT,
        command: `claude --dangerously-skip-permissions --resume ${resumeId} --rc --ide`,
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
      cwd: fallbackClaude && fallbackClaude.cwd || JARGAN_ROOT,
      resumeId,
      command: `claude --dangerously-skip-permissions --resume ${resumeId} --rc --ide`,
    } : null);
    if (!recoveryRecord || (!recoveryRecord.resumeId && !recoveryRecord.threadId && !recoveryRecord.command)) {
      result.skipped += 1;
      continue;
    }
    try {
      const fresh = agentFreshStartCommand(name, recoveryRecord);
      const target = await spawnRecoveredSession(name, recoveryRecord, fresh);
      upsertManifestRecord(manifest, name, {
        ...recoveryRecord,
        ...(fresh ? freshStartPatch(recoveryRecord) : {}),
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
  // The Recover button also retries live output after a collection timeout.
  // Existing sessions need no restart, but the automatic backoff would
  // otherwise keep the following refresh in recovery mode for up to 2 minutes.
  recordCollectionSuccess();
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
  if (name === LARSON_DESKTOP_SESSION) return desktopSnapshot(name, slot, spans);
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
    memory: normalizeSessionMemory(manifestRecord && manifestRecord.memory),
    missing: !live,
  };
}

async function resizeTerminal(target, size, actualSize) {
  if (!size) return;
  const key = targetLabel(target);
  const previous = terminalSizeCache.get(key);
  if (previous && previous.cols === size.cols && previous.rows === size.rows &&
      (!actualSize || (actualSize.cols === size.cols && actualSize.rows === size.rows))) return;
  await tmuxSocket(target.socket, ['resize-window', '-t', targetSpec(target), '-x', String(size.cols), '-y', String(size.rows)], { timeout: 3000 });
  terminalSizeCache.set(key, size);
}

async function snapshot(name, slot, titles = new Map(), spans = {}, signalContext = {}) {
  if (name === LARSON_DESKTOP_SESSION) return desktopSnapshot(name, slot, spans);
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
      dormant: isDormantAgent(manifestRecord, 'missing'),
      output: isDormantAgent(manifestRecord, 'missing') ? readyPanelText(manifestRecord) : `tmux target "${targetLabel(target) || name}" is not running.\n\nThe slot assignment is still saved. Use Recover to adopt a live resume or restart from the manifest before creating a duplicate.${lastOutput}`,
      state: 'missing',
      noticeKey: '',
      noticeKind: '',
      missing: true,
      target: targetLabel(target),
      memory: normalizeSessionMemory(manifestRecord && manifestRecord.memory),
    };
  }
  const knownPane = findLivePaneByTarget(liveTargets, target);
  let command = knownPane && knownPane.command || '';
  let panePid = Number(knownPane && knownPane.panePid) || 0;
  let paneMetadataAvailable = false;
  let actualSize;
  let alternateScreen = false;
  let cwd = '';
  let clients = '0';
  let attachedSize;
  let output = '';
  let rawOutput = '';
  let liveClaudeRecord = null;
  try {
    // tmux sanitizes literal tabs to underscores in a non-UTF-8 service
    // environment. Use printable separators, with the free-form command last.
    const pane = (await tmuxSocket(target.socket, ['list-panes', '-t', targetSpec(target), '-F', '#{pane_pid}|#{pane_width}|#{pane_height}|#{alternate_on}|#{pane_current_command}']))
      .split('\n')[0] || '';
    paneMetadataAvailable = Boolean(pane);
    const parts = pane.split('|');
    panePid = Number(parts[0]) || 0;
    command = parts.slice(4).join('|');
    alternateScreen = parts[3] === '1';
    if (Number(parts[1]) > 0 && Number(parts[2]) > 0) {
      actualSize = { cols: Number(parts[1]), rows: Number(parts[2]) };
    }
    cwd = manifestRecord && manifestRecord.cwd || '';
  } catch {}
  liveClaudeRecord = claudeRecordForPane(name, panePid, target, signalContext);
  try {
    const clientRows = (await tmuxSocket(target.socket, ['list-clients', '-t', sessionSpec(target), '-F', '#{client_tty}|#{client_width}|#{client_height}']))
      .split('\n').filter(Boolean);
    clients = String(clientRows.length);
    const dimensions = clientRows.map(row => row.split('|')).filter(parts => Number(parts[1]) > 0 && Number(parts[2]) > 1);
    if (dimensions.length) attachedSize = {
      cols: Math.max(...dimensions.map(parts => Number(parts[1]))),
      rows: Math.max(...dimensions.map(parts => Number(parts[2]))) - 1,
    };
  } catch {}
  // An attached terminal owns tmux's physical grid. Resizing it from the
  // browser leaves a large macOS Terminal window around a tiny tmux viewport.
  // allowViewportResize lets a display-only board (no adoption or revival)
  // still give detached fullscreen agents scroll room. Health reads omit it.
  const mayResize = !signalContext.observeOnly || signalContext.allowViewportResize;
  if (mayResize && clients === '0' && paneMetadataAvailable) {
    try {
      let size = signalContext.terminalSizesBySlot && signalContext.terminalSizesBySlot.get(slot);
      // An alternate screen has no tmux scrollback. A tile-sized physical grid
      // hides the earlier response, so keep enough rows for browser scrolling
      // even when a refresh requests a short viewport.
      // This covered Claude only until 2026-09-29. Codex is equally fullscreen,
      // so it kept a 13-row grid and the board's only "history" was the dead
      // shell output underneath it - see the -S 0 note in the capture below.
      // Both halves are required: -S 0 alone leaves codex a 13-row keyhole.
      const fullscreenClaude = alternateScreen && (
        liveClaudeRecord || (manifestRecord && manifestRecord.kind === 'claude') || /\bclaude\b/i.test(command) ||
        descendantPids(panePid, signalContext.procIndex || { byPid: new Map(), children: new Map() })
          .some(pid => /(?:^|[\s/])claude(?:\s|$)/.test(((signalContext.procIndex && signalContext.procIndex.byPid.get(pid)) || {}).command || ''))
      );
      const fullscreenCodex = alternateScreen && (
        (manifestRecord && manifestRecord.kind === 'codex') || /\bcodex\b/i.test(command)
      );
      const minRows = Math.max((manifestRecord && manifestRecord.minTerminalRows) || 0,
        (fullscreenClaude || fullscreenCodex) ? 300 : 0);
      if (minRows && (size || actualSize)) {
        size = { ...(size || actualSize), rows: Math.max((size || actualSize).rows, minRows) };
      }
      await resizeTerminal(target, size, actualSize);
    } catch {}
  } else if (mayResize && attachedSize && actualSize &&
      (actualSize.cols < attachedSize.cols || actualSize.rows < attachedSize.rows)) {
    // Browser resizing selects tmux's manual window-size mode. Once a native
    // client attaches, release that stale small grid to the client's dimensions.
    // Let tmux account for status lines and client sizing rather than forcing
    // the browser's alternate-screen minimum onto the attached terminal.
    try { await tmuxSocket(target.socket, ['resize-window', '-t', targetSpec(target), '-A'], { timeout: 3000 }); } catch {}
  }
  try {
    const captureLines = Number(signalContext.captureLinesBySlot && signalContext.captureLinesBySlot.get(slot)) || CAPTURE_LINES;
    // tmux's scrollback belongs to the NORMAL screen. An agent drawing on the
    // alternate screen (codex, fullscreen Claude) never writes to it, so asking
    // for history splices whatever the SHELL last printed onto the live UI -
    // on 2026-09-29 that was a dead crash loop of "Operation not permitted",
    // redelivered to the board every refresh long after the session recovered.
    const captureStart = alternateScreen ? '0' : `-${captureLines}`;
    rawOutput = cleanText(await tmuxSocket(target.socket, ['capture-pane', '-p', '-J', '-t', targetSpec(target), '-S', captureStart], { timeout: 2500 }));
    if ((manifestRecord && manifestRecord.kind === 'codex') || /\bcodex\b/i.test(command)) {
      if (!signalContext.observeOnly && await dismissCodexRateLimitNudge(target, rawOutput)) {
        rawOutput = cleanText(await tmuxSocket(target.socket, ['capture-pane', '-p', '-J', '-t', targetSpec(target), '-S', captureStart], { timeout: 2500 }));
      }
    }
    if (!signalContext.observeOnly) writePaneSnapshot(name, rawOutput);
  } catch {
    rawOutput = `(could not capture ${name})`;
  }
  const signalObservedAt = Date.now();
  let signal = { state: looksWorkingServer(rawOutput) ? 'busy' : 'idle', noticeKey: '', noticeKind: '', signalAvailable: false };
  let signalId = '';
  let threadId = '';
  let resumeId = manifestRecord && manifestRecord.resumeId || '';
  const liveCodexThread = codexThreadForPane(
    panePid,
    signalContext.procIndex || { byPid: new Map(), children: new Map() },
    signalContext.codexLocks || new Map(),
    signalContext.codexPaths || new Map(),
    manifestRecord && manifestRecord.threadId || '',
  );
  let contextTokens = 0;
  if (!liveClaudeRecord && (/(?:\bcodex\b|^codex_)/i.test(command) || liveCodexThread)) {
    threadId = liveCodexThread;
    contextTokens = readCodexContextTokens(threadId, signalContext.codexPaths || new Map());
    signal = readCodexSignal(threadId, signalContext.codexPaths || new Map(), rawOutput);
    signalId = `codex:${threadId}:${panePid}`;
  } else {
    const claudeRecord = liveClaudeRecord || (manifestRecord && manifestRecord.resumeId ? (signalContext.claudeBySid || new Map()).get(manifestRecord.resumeId) : null);
    if (claudeRecord && claudeRecord.sessionId) resumeId = claudeRecord.sessionId;
    const claude = claudeRecord
      ? readClaudeSignal(claudeRecord.tmuxName || name, titles, new Map([[claudeRecord.tmuxName || name, claudeRecord]]), signalContext.attentionIndex || new Map())
      : readClaudeSignal(name, titles, signalContext.claudeIndex || new Map(), signalContext.attentionIndex || new Map());
    signal = claude.state !== 'idle' || claude.signalAvailable ? claude : signal;
    const record = claudeRecord || (signalContext.claudeIndex || new Map()).get(name) || {};
    contextTokens = readClaudeContextTokens(record.sessionId ? record : null);
    signalId = `claude:${record.sessionId || (titles.get(name) || {}).sid || ''}:${record.pid || panePid}:${record.startedAt || ''}`;
  }
  const interaction = readCodexInteraction(threadId, signalContext.codexPaths || new Map());
  const dormant = isDormantAgent(manifestRecord, command);
  output = dormant ? readyPanelText(manifestRecord) : stabilizeAlternateScreenCapture(target, panePid, alternateScreen,
    displayPaneOutput(signalContext.observeOnly ? rawOutput.trimEnd() : retainPaneScrollback(name, rawOutput), command, { resumeId, threadId }),
    !paneMetadataAvailable);
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
    // A service restart/deploy is not a new task, including for tabs running older JS.
    noticeKey: signal.noticeAt >= SIGNAL_MONITOR_STARTED_AT ? signal.noticeKey || '' : '',
    noticeKind: signal.noticeKind || '',
    noticeAt: signal.noticeAt || 0,
    signalId,
    signalObservedAt,
    signalAvailable: Boolean(signal.signalAvailable && !rawOutput.startsWith('(could not capture ')),
    attention: signal.attention || null,
    target: targetLabel(target),
    targetRaw: target,
    threadId,
    resumeId,
    interaction,
    contextTokens,
    rotation: manifestRecord && manifestRecord.rotation || null,
    // Agent exited or tmux session gone: the next message starts it fresh.
    dormant,
    memory: normalizeSessionMemory(manifestRecord && manifestRecord.memory),
  };
}

function updateManifestFromSnapshots(manifest, sessions, options = {}) {
  let changed = false;
  const writeSlots = boardContext(options).isDefault && !options.preserveSlots;
  for (const session of sessions || []) {
    if (!session.name || session.missing || session.name === LARSON_DESKTOP_SESSION) continue;
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
    patch.memory = normalizeSessionMemory(prev.memory);
    const conversation = observedConversation(patch);
    if (conversation.id) Object.assign(patch, memoryHydrationPatch(session.name, patch, conversation));
    if (patch.kind === 'codex' && SID_RE.test(patch.threadId || '')) {
      patch.command = codexPanelResumeCommand(patch);
    } else if (patch.kind === 'claude' && SID_RE.test(patch.resumeId || '')) {
      patch.command = `claude --dangerously-skip-permissions --resume ${patch.resumeId} --rc --ide`;
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
      JSON.stringify(patch.memory) !== JSON.stringify(normalizeSessionMemory(prev.memory)) ||
      patch.pendingPrompt !== prev.pendingPrompt ||
      patch.pendingPromptQueuedAt !== prev.pendingPromptQueuedAt ||
      patch.pendingPromptKind !== prev.pendingPromptKind ||
      patch.pendingPromptConversationId !== prev.pendingPromptConversationId ||
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
  const board = { ...boardContext(options), observeOnly: Boolean(options.observeOnly) };
  const manifest = readManifest();
  const liveTargets = await readLiveTargets(manifest, { safeMode: true });
  const liveSessionNames = allLiveSessionNames(liveTargets);
  const allSessions = mergeSessionNames(liveSessionNames, manifest, liveTargets);
  const restoredLayout = board.isDefault
    ? restoreManifestSlots(readLayoutState(allSessions, board), manifest, liveTargets)
    : { state: readLayoutState(allSessions, board), changed: false };
  const { slots, spans, grid, boardTitle } = restoredLayout.state;
  if (!options.observeOnly && (restoredLayout.changed || (!board.isDefault && !fs.existsSync(board.layoutFile)))) {
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
      layoutRevision: restoredLayout.state.layoutRevision || 0,
      grid,
      gridOptions: GRID_OPTIONS,
    },
    slots,
    spans,
    allSessions,
    titles: Object.fromEntries(Object.entries(manifest.sessions).filter(([, record]) => record.title).map(([name, record]) => [name, record.title])),
    sessions,
    holding: unassignedSessions(allSessions, holdingMembership, slots).sort(),
    holdingBoards: boardSummaries.map((item) => ({ id: item.id, title: item.title })),
    holdingMembership,
    warning: warning || recoveryWarning,
    recovery: { mode, retryAt: mode === 'automatic' ? collectHealth.retryAt : 0 },
  };
}

async function collectLive(options = {}) {
  const board = { ...boardContext(options), observeOnly: Boolean(options.observeOnly) };
  const manifest = readManifest();
  const liveTargets = await readLiveTargets(manifest);
  const liveSessionNames = allLiveSessionNames(liveTargets);
  const allSessions = mergeSessionNames(liveSessionNames, manifest, liveTargets);
  const restoredLayout = board.isDefault
    ? restoreManifestSlots(readLayoutState(allSessions, board), manifest, liveTargets)
    : { state: readLayoutState(allSessions, board), changed: false };
  const { slots, spans, grid, boardTitle } = restoredLayout.state;
  if (!options.observeOnly && (restoredLayout.changed || (!board.isDefault && !fs.existsSync(board.layoutFile)))) {
    writeLayoutState(restoredLayout.state, board);
  }
  const boardSummaries = readBoardSummaries();
  const holdingMembership = sessionBoardMembership(boardSummaries);
  const titles = titleMap();
  for (const [name, record] of Object.entries(manifest.sessions)) {
    if (!titles.has(name) && record.title) titles.set(name, {title:record.title});
  }
  const claudeRecords = readClaudeSessionRecords();
  const adopted = !options.observeOnly && adoptLiveClaudeRecords(manifest, readLayoutState(liveSessionNames, board).slots, titles, claudeRecords, liveTargets, { writeSlots: board.isDefault });
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
    observeOnly: Boolean(options.observeOnly),
    allowViewportResize: Boolean(options.allowViewportResize),
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
  if (PANEL_ROTATION_ENABLED && (!options.observeOnly || options.allowRotation)) {
    try { await applyPanelRotations(sessions); } catch {}
  }
  if (!options.observeOnly) {
    await reviveExitedAiSessions(sessions, manifest);
    if (updateManifestFromSnapshots(manifest, sessions, board)) writeManifest(manifest);
  }
  // Meta lives outside the grid, but still needs its live conversation ID for
  // safe future resume. Do not place it in a slot or auto-restart it here.
  const metaName = `terminaltown-meta-${kebab(board.id).slice(0, 36)}`;
  if (!options.observeOnly && liveSessionNames.includes(metaName) && !slots.includes(metaName)) {
    const metaSnapshot = await snapshot(metaName, null, titles, {}, {
      ...signalContext, terminalSizesBySlot: new Map(), captureLinesBySlot: new Map(),
    });
    // Other prompt deliveries may have written the manifest during capture.
    const latest = readManifest();
    if (updateManifestFromSnapshots(latest, [metaSnapshot], { ...board, preserveSlots: true })) writeManifest(latest);
  }
  if (!options.observeOnly) schedulePendingPromptSweep(manifest);
  const warning = collapseWarning(slots, sessions, allSessions);
  return {
    at: Date.now(),
    board: {
      id: board.id,
      title: boardTitle || board.title,
      layoutRevision: restoredLayout.state.layoutRevision || 0,
      grid,
      gridOptions: GRID_OPTIONS,
    },
    slots,
    spans,
    allSessions,
    titles: Object.fromEntries([...titles.entries()].map(([name, record]) => [name, record.title])),
    holding: unassignedSessions(allSessions, holdingMembership, slots),
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

async function loadTmuxBufferFromFile(target, buffer, value) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'terminaltown-prompt-'));
  const file = path.join(directory, 'prompt.txt');
  try {
    fs.writeFileSync(file, String(value), { mode: 0o600 });
    await tmuxSocket(target.socket, ['load-buffer', '-b', buffer, file], { timeout: 5000, maxBuffer: 512 * 1024 });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function sendPrompt(session, prompt, submitKey = 'enter', { startup = false, agentOnly = false } = {}) {
  session = canonicalSessionName(session);
  if (!NAME_RE.test(session) || !String(prompt || '').trim()) throw new Error('bad prompt request');
  const keyName = tmuxKeyName(submitKey || 'enter');
  if (!keyName) throw new Error(`unsupported submit key: ${submitKey}`);
  const { record, target, live } = await resolveSessionActionTarget(session);
  if (!startup && record && keyName === 'Enter' && !parseResetCommand(record.kind, prompt) &&
      await startAgentOnFirstMessage(session, record, target, live, prompt)) {
    return;
  }
  if (agentOnly) {
    // A failed first-message probe must never fall through to paste + Enter
    // at a shell. Meta only delivers ordinary input to a confirmed agent.
    const command = String(await tmuxSocket(target.socket, ['display-message', '-p', '-t', targetSpec(target), '#{pane_current_command}'], { timeout: 3000 })).trim();
    if (!isRunningAgent(record, command)) {
      throw new Error(`Cannot confirm a running agent for ${session}; no input was sent.`);
    }
  }
  if (!startup && record && keyName === 'Enter' && parseResetCommand(record.kind, prompt)) {
    const manifest = readManifest();
    const current = manifest.sessions[session];
    if (current && current.memory.approvedCharter) {
      let memory = current.memory;
      const conversation = observedConversation(current);
      if (conversation.id && (
        memory.hydratedConversation.kind !== conversation.kind ||
        memory.hydratedConversation.id !== conversation.id
      )) {
        memory = applyMemoryOperation(memory, { type: 'mark-hydrated', conversation });
      }
      upsertManifestRecord(manifest, session, {
        ...current,
        memory: applyMemoryOperation(memory, { type: 'expect-new-conversation' }),
      });
      writeManifest(manifest);
    }
  }
  const buffer = `terminaltown-${process.pid}-${Date.now()}`;
  await loadTmuxBufferFromFile(target, buffer, prompt);
  try {
    // Mark every prompt as an explicit paste. Otherwise Codex's typing-burst
    // detector can consume the following Enter as a pasted newline, leaving
    // the draft unsent even though tmux reports successful delivery.
    await tmuxSocket(target.socket, ['paste-buffer', '-p', '-b', buffer, '-t', targetSpec(target)], { timeout: 5000 });
    // Startup additionally waits for the TUI to finish consuming its setup.
    const delay = Number(process.env.TMUX_SEND_PROMPT_DELAY || 0.15) * 1000;
    await new Promise((resolve) => setTimeout(resolve, startup ? Math.max(1000, delay) : delay));
    await tmuxSocket(target.socket, ['send-keys', '-t', targetSpec(target), keyName], { timeout: 3000 });
  } finally {
    await tmuxSocket(target.socket, ['delete-buffer', '-b', buffer], { timeout: 2000 }).catch(() => {});
  }
}

async function pasteText(session, text) {
  session = canonicalSessionName(session);
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
  const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + require('crypto').randomBytes(4).toString('hex');
  return list.slice(0, 8).map((image, index) => {
    const decoded = decodePastedImage(image);
    const file = path.join(PASTE_DIR, `${stamp}-${process.pid}-${index + 1}.${decoded.ext}`);
    fs.writeFileSync(file, decoded.buffer, { mode: 0o600 });
    return file;
  });
}

async function pasteImages(session, images) {
  session = canonicalSessionName(session);
  if (!NAME_RE.test(session)) throw new Error('bad session');
  const files = savePastedImages(images);
  await pasteText(session, files.join(' '));
  return files;
}

async function stageImageDraft(session, message) {
  try {
    if (!NAME_RE.test(session) || message.session !== session) throw new Error('The panel changed; paste into its current prompt.');
    if (!Array.isArray(message.images) || !message.images.length || message.images.length > 8) throw new Error('Paste up to 8 images at a time.');
    message.images.forEach(decodePastedImage);
    return { type: 'imageDraftResult', stageId: message.stageId, session, ok: true, files: savePastedImages(message.images) };
  } catch (error) {
    return { type: 'imageDraftResult', stageId: message.stageId, session: message.session, ok: false, error: error.message };
  }
}

async function sendPanelPrompt(session, message) {
  try {
    if (message.session && message.session !== session) throw new Error('The panel changed; your draft was kept.');
    await sendPrompt(session, String(message.prompt || ''), String(message.submitKey || 'enter'));
    return { type: 'promptResult', draftId: message.draftId, session, ok: true };
  } catch (error) {
    if (!message.draftId) throw error;
    return { type: 'promptResult', draftId: message.draftId, session: message.session, ok: false, error: error.message };
  }
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

async function systemClipboardImageDraft(session) {
  if (!NAME_RE.test(session)) throw new Error('bad session');
  const files = await saveMacClipboardImage();
  return { type: 'clipboardImageDraft', session, images: files.map(file => ({
    path: file, dataUrl: 'data:image/' + (file.endsWith('.tiff') ? 'tiff' : 'png') + ';base64,' + fs.readFileSync(file).toString('base64'),
  })) };
}

async function sendKey(session, key) {
  session = canonicalSessionName(session);
  if (!NAME_RE.test(session)) throw new Error('bad session');
  const { target } = await resolveSessionActionTarget(session);
  const mapped = tmuxKeyName(key);
  if (!mapped) throw new Error(`unsupported key: ${key}`);
  if (mapped === 'Escape') {
    const paneMode = (await tmuxSocket(target.socket, ['display-message', '-p', '-t', targetSpec(target), '#{pane_mode}'], { timeout: 3000 })).trim();
    if (paneMode === 'copy-mode') {
      await tmuxSocket(target.socket, ['send-keys', '-X', '-t', targetSpec(target), 'cancel'], { timeout: 3000 });
    }
  }
  await tmuxSocket(target.socket, ['send-keys', '-t', targetSpec(target), mapped], { timeout: 3000 });
}

function createTerminalKeyDispatcher({ resolveSession, send }) {
  const pending = new Map();
  return function dispatch(boardId, slot, key, context) {
    const queueId = `${String(boardId || 'default')}:${Number(slot)}`;
    const previous = pending.get(queueId) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const { session } = await resolveSession(Number(slot), context);
      await send(session, key);
    });
    pending.set(queueId, operation);
    const cleanup = () => { if (pending.get(queueId) === operation) pending.delete(queueId); };
    operation.then(cleanup, cleanup);
    return operation;
  };
}

async function answerCodexQuestion(session, submission) {
  if (!NAME_RE.test(session)) throw new Error('bad session');
  const { target } = await resolveSessionActionTarget(session);
  const pane = (await tmuxSocket(target.socket, ['list-panes', '-t', targetSpec(target), '-F', '#{pane_pid}'], { timeout: 3000 })).split('\n')[0];
  const [procIndex, codexPaths, codexLocks] = await Promise.all([
    readProcessIndex(), readCodexPathMap(), readCodexLockIndex(),
  ]);
  const threadId = codexThreadForPane(Number(pane), procIndex, codexLocks, codexPaths);
  const interaction = readCodexInteraction(threadId, codexPaths);
  const steps = buildAnswerSteps(interaction, submission || {});
  for (const step of steps) {
    if (step.type === 'key') {
      const mapped = tmuxKeyName(step.value);
      if (!mapped) throw new Error(`unsupported Codex answer key: ${step.value}`);
      await tmuxSocket(target.socket, ['send-keys', '-t', targetSpec(target), mapped], { timeout: 3000 });
    } else if (step.type === 'paste') {
      const buffer = `terminaltown-answer-${process.pid}-${Date.now()}`;
      await tmuxSocket(target.socket, ['set-buffer', '-b', buffer, step.value], { timeout: 5000, maxBuffer: 512 * 1024 });
      try {
        await tmuxSocket(target.socket, ['paste-buffer', '-b', buffer, '-t', targetSpec(target)], { timeout: 5000 });
      } finally {
        await tmuxSocket(target.socket, ['delete-buffer', '-b', buffer], { timeout: 2000 }).catch(() => {});
      }
    }
    await new Promise(resolve => setTimeout(resolve, 60));
  }
}

function tmuxKeyName(key) {
  const normalized = String(key || '').toLowerCase();
  // Interactive TUIs commonly use numbered choices (for example, rate-limit
  // model prompts). tmux accepts the digit itself as a key name.
  if (/^[0-9]$/.test(normalized)) return normalized;
  switch (normalized) {
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
    case 'shift-left': return 'S-Left';
    case 'right': return 'Right';
    case 'space': return 'Space';
    case 'delete': return 'DC';
    default: return '';
  }
}

async function openFullTerminal(vscode, session, title = '') {
  session = canonicalSessionName(session);
  if (!NAME_RE.test(session)) throw new Error('bad session');
  if (!EXTERNAL_TERMINAL_URL) throw new Error('External terminal handoff is not configured for this host.');
  const { target } = await resolveSessionActionTarget(session);
  await postJson(EXTERNAL_TERMINAL_URL, {
    session,
    title: cleanTitle(title) || session,
    target,
  });
  return 'queued';
}

async function resolveSessionActionTarget(session) {
  session = canonicalSessionName(session);
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
  const items = (await sessionDirectory()).filter(record => record.kind !== 'desktop').map(record => ({
    label: record.title,
    description: record.locations.map(loc => `${loc.boardTitle} · ${loc.surface === 'meta' ? 'Meta Terminal' : loc.surface === 'holding' ? 'Holding' : 'Panel '+loc.panel}`).join(', ') || 'Holding',
    detail: [record.charter, record.cwd, record.name, ...record.aliases].filter(Boolean).join(' · '),
    name: record.name,
  }));
  const picked = await vscode.window.showQuickPick(items, { title, placeHolder: 'Find a session by name or purpose', matchOnDescription: true, matchOnDetail: true });
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
    { label: 'Blank Claude session', kind: 'claude', description: 'claude --dangerously-skip-permissions --model opus --effort max --rc --ide' },
    { label: 'Blank Codex session', kind: 'codex', description: CODEX_FULL_PERMISSION_COMMAND },
    ...presets.map((preset) => ({ ...preset, kind: 'preset' })),
  ];
  const source = forcedKind === 'claude' || forcedKind === 'codex'
    ? choices.find((choice) => choice.kind === forcedKind)
    : await vscode.window.showQuickPick(choices, {
      title: 'New AI Session',
      placeHolder: 'Choose Claude, Codex, or a JARGAN preset',
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
    });
  if (!source) return null;

  let session = source.session || '';
  let cwd = source.cwd || JARGAN_ROOT;
  let command = source.command || '';
  let title = source.kind === 'preset' ? source.label : '';

  if (source.kind === 'claude') {
    cwd = await vscode.window.showInputBox({
      title: 'Project Directory',
      value: JARGAN_ROOT,
      ignoreFocusOut: true,
    });
    if (!cwd) return null;
    command = 'claude --dangerously-skip-permissions --model opus --effort max --rc --ide';
  } else if (source.kind === 'codex') {
    cwd = await vscode.window.showInputBox({
      title: 'Project Directory',
      value: JARGAN_ROOT,
      ignoreFocusOut: true,
    });
    if (!cwd) return null;
    command = codexFullPermissionCommand();
  }

  title = await vscode.window.showInputBox({
    title: 'Session name',
    value: cleanTitle(title),
    placeHolder: 'Feature Requests',
    validateInput: value => cleanTitle(value) ? null : 'Enter a name for the work this session owns.',
    ignoreFocusOut: true,
  });
  if (!cleanTitle(title)) return null;
  session = await uniqueSessionName(title);

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
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource}; style-src 'nonce-${n}'; script-src 'nonce-${n}';">
<title>TerminalTown</title>
<link rel="icon" id="terminalTownFavicon" type="image/png">
<style nonce="${n}">
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  --page-top-inset: 4px; /* TT-DESKTOP-PADDING-20260910 */
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
  --skin-muted: #536660;
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
/* Native scroll containers keep their history, scroll anchoring and touch chaining. */
body * {
  scrollbar-color: var(--skin-muted) var(--skin-page);
  scrollbar-width: auto;
}
@supports selector(::-webkit-scrollbar) {
  body * { scrollbar-color: auto; }
  body ::-webkit-scrollbar { width: 10px; height: 10px; }
  body ::-webkit-scrollbar-track, body ::-webkit-scrollbar-corner { background: var(--skin-page); }
  body ::-webkit-scrollbar-thumb {
    background: var(--skin-muted);
    border: 2px solid var(--skin-page);
    border-radius: 6px;
    min-height: 28px;
    min-width: 28px;
  }
  body ::-webkit-scrollbar-thumb:hover { background: var(--skin-accent); }
  body ::-webkit-scrollbar-thumb:active { background: var(--skin-text); }
  @media (pointer: coarse) {
    body ::-webkit-scrollbar { width: 12px; height: 12px; }
  }
}
@media (forced-colors: active) {
  body * { scrollbar-color: auto; scrollbar-width: auto; }
  body ::-webkit-scrollbar-track, body ::-webkit-scrollbar-corner { background: Canvas; }
  body ::-webkit-scrollbar-thumb { background: ButtonText; border-color: Canvas; }
  body ::-webkit-scrollbar-thumb:hover, body ::-webkit-scrollbar-thumb:active { background: Highlight; }
}
button, select, input, textarea {
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
.layout-notice {
  position: fixed; z-index: 45; top: calc(var(--page-top-inset) + 38px);
  left: 8px; right: 8px; width: max-content; max-width: min(600px, calc(100% - 16px));
  padding: 10px; border: 1px solid var(--skin-accent); border-radius: 6px;
  background: var(--skin-page); color: var(--skin-text); box-shadow: 0 4px 16px var(--skin-shadow);
}
.layout-notice[hidden] { display: none; }
.layout-notice p { margin: 0 0 8px; overflow-wrap: anywhere; }
.layout-notice button { min-height: 32px; padding: 4px 10px; margin-right: 6px; }
.layout-notice button:focus-visible { outline: 2px solid var(--skin-accent); outline-offset: 2px; }
.page {
  position: fixed;
  inset: 0;
  top: var(--page-top-inset);
  z-index: 1;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
}
/* The command bar stays one row; related controls live in bounded popovers. */
.toolbar {
  position: relative; z-index: 19;
  display: flex; align-items: center; flex-wrap: nowrap; gap: 6px;
  height: 32px; padding: 3px 8px; min-width: 0;
  border-bottom: 1px solid var(--skin-border); background: var(--skin-toolbar);
}
.toolbar button { height: 24px; padding: 0 7px; border-radius: 4px; }
.toolbar select { height: 28px; padding: 0 7px; }
.toolbar button:focus-visible, .toolbar select:focus-visible, .command-popover button:focus-visible, .command-popover select:focus-visible {
  outline: 2px solid var(--skin-accent); outline-offset: 2px;
}
.toolbar .command { display: inline-flex; align-items: center; justify-content: center; gap: 5px; white-space: nowrap; }
.command-icon { width: 15px; height: 15px; flex: 0 0 15px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.toolbar-toggle { flex: 0 0 24px; min-width: 24px; padding: 0 !important; }
.toolbar-toggle .command-icon { transition: transform .12s; }
.toolbar.collapsed .toolbar-toggle .command-icon { transform: rotate(180deg); }
.toolbar.collapsed { height: 31px; }
.toolbar.collapsed > :not(.toolbar-toggle):not(.board-control):not(#muteChimes) { display: none; }
#muteChimes { flex: 0 0 28px; width: 28px; padding: 0; }
#muteChimes .mute-slash { display: none; }
#muteChimes[aria-pressed="true"] .mute-slash { display: block; }
.toolbar-group { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.toolbar-group + .toolbar-group { border-left: 1px solid var(--skin-border); padding-left: 6px; }
.board-control { min-width: 0; flex: 0 1 220px; }
.board-control > .command { width: 100%; justify-content: flex-start; }
.board-label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: inherit; font-weight: 700; min-width: 0; }
.command-caret { font-size: 10px; margin-left: auto; }
.toolbar .primary-command { border-color: var(--skin-accent); font-weight: 700; }
.toolbar [aria-expanded="true"], .toolbar [aria-pressed="true"] { border-color: var(--skin-accent); box-shadow: inset 0 -2px var(--skin-accent); }
.status { color: var(--skin-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.toolbar > .status { flex: 1 1 80px; color: var(--skin-text); font-size: 11px; text-align: right; }
.command-popover {
  position: fixed; width: 260px; max-width: calc(100vw - 12px); max-height: calc(100dvh - 42px);
  overflow-y: auto; overscroll-behavior: contain; padding: 8px;
  border: 1px solid var(--skin-border); border-radius: 7px;
  background: var(--skin-board); color: var(--skin-text); box-shadow: 0 8px 28px var(--skin-shadow);
}
.command-popover[hidden] { display: none; }
.command-popover button { width: 100%; height: auto; min-height: 30px; text-align: left; padding: 6px 8px; margin: 1px 0; }
.command-popover h2 { margin: 3px 8px 6px; font-size: 11px; font-weight: 700; }
.command-popover hr { border: 0; border-top: 1px solid var(--skin-border); margin: 7px 0; }
.command-popover label { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 8px; }
.command-popover select { min-width: 118px; max-width: 145px; }
.command-popover .command-help { margin: 6px 8px; font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.command-popover [aria-pressed]::after { content: 'Off'; float: right; font-size: 11px; }
.command-popover [aria-pressed="true"]::after { content: 'On'; }
.command-count { font-size: 10px; min-width: 12px; }
@media (max-width: 700px) {
  .toolbar { gap: 4px; padding-inline: 5px; }
  .toolbar > .status { display: none; }
  .board-control { flex: 1 1 auto; }
  .toolbar .command-label { display: none; }
  .toolbar-group + .toolbar-group { padding-left: 4px; }
}
@media (max-width: 380px) {
  .toolbar { gap: 3px; }
  .toolbar .command { padding-inline: 5px; gap: 3px; }
  .board-control > .command > .command-icon { display: none; }
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
  align-items: flex-start;
  justify-content: flex-start;
  padding: calc(36px + var(--page-top-inset)) 8px 8px;
  background: transparent;
}
.board-picker-backdrop.visible { display: flex; }
.session-memory-dialog {
  width: min(680px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); padding: 0;
  border: 1px solid var(--skin-border); border-radius: 9px; background: var(--skin-board); color: var(--skin-text);
  box-shadow: 0 20px 64px rgba(0, 0, 0, .4);
}
.session-memory-dialog::backdrop { background: rgba(0, 0, 0, .42); }
.memory-dialog-body { display: grid; gap: 12px; padding: 14px; overflow: auto; }
.memory-dialog-header, .memory-dialog-actions, .memory-field-actions { display: flex; align-items: center; gap: 8px; }
.memory-dialog-header { justify-content: space-between; }
.memory-dialog-header h2 { margin: 0; font-size: 15px; }
.memory-dialog-header button { width: 30px; height: 30px; padding: 0; }
.memory-field { display: grid; gap: 5px; font-weight: 700; }
.memory-field textarea {
  box-sizing: border-box; width: 100%; min-height: 88px; resize: vertical; padding: 8px;
  font: inherit; font-weight: 400; line-height: 1.4; color: var(--skin-input-text); background: var(--skin-input);
  border: 1px solid var(--skin-border); border-radius: 5px;
}
.memory-field-actions { justify-content: space-between; min-height: 28px; }
.memory-field-actions button, .memory-dialog-actions button { min-height: 30px; padding: 5px 10px; }
.memory-meta { color: var(--skin-muted); font-size: 11px; font-weight: 400; }
.memory-proposal { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--skin-accent); border-radius: 6px; }
.memory-proposal[hidden] { display: none; }
.memory-proposal h3 { margin: 0; font-size: 13px; }
.memory-diff { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.memory-diff section { min-width: 0; }
.memory-diff h4 { margin: 0 0 4px; font-size: 11px; }
.memory-diff pre { box-sizing: border-box; height: auto; max-height: 150px; padding: 7px; border: 1px solid var(--skin-border); background: var(--skin-input); }
.memory-dialog-actions { justify-content: flex-end; }
.memory-badge { display: none; flex: 0 0 auto; min-height: 18px; padding: 1px 5px; border-radius: 8px; border: 1px solid var(--skin-border); background: var(--skin-head); color: var(--skin-text); font-size: 9px; font-weight: 700; white-space: nowrap; }
.tile.has-memory .memory-badge { display: inline-block; }
.tile.memory-review .memory-badge { background: var(--skin-accent); color: var(--skin-page); }
@media (max-width: 560px) {
  .session-memory-dialog { width: calc(100vw - 12px); max-height: calc(100dvh - 12px); }
  .memory-dialog-body { padding: 10px; }
  .memory-diff { grid-template-columns: 1fr; }
}
.board-picker {
  width: min(420px, 100%);
  max-height: min(620px, calc(100dvh - 44px));
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--skin-border);
  border-radius: 8px;
  background: var(--skin-board);
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
.board-picker-row { display: flex; gap: 5px; min-width: 0; }
.board-picker-item {
  flex: 1; min-width: 0; min-height: 40px; display: flex; align-items: center; gap: 8px;
  padding: 6px 9px; text-align: left; border-radius: 5px; background: var(--skin-button); color: var(--skin-button-text);
}
.board-picker-item.active { border-color: var(--skin-accent); }
.board-picker-item .board-picker-title { flex: 1; }
.board-picker-row .pin-board { flex: 0 0 30px; border-radius: 4px; }
.board-picker-footer { border-top: 1px solid var(--skin-border); padding-top: 8px; display: grid; gap: 8px; font-size: 11px; }
.board-picker-footer label { display: flex; justify-content: space-between; align-items: center; }
.board-picker-footer select { height: 26px; }
.board-management { display: flex; flex-wrap: wrap; gap: 5px; }
.board-management button { min-height: 28px; }
.board-pins { display: flex; align-items: center; gap: 4px; min-width: 0; }
.board-pins button { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.board-pins [aria-current="page"] { border-color: var(--skin-accent); font-weight: 700; }
@media (max-width: 1150px) { .toolbar .board-pins { display: none; } }
.board-picker-title,
.board-picker-id {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.board-picker-title { font-weight: 700; }
.board-picker-id { color: inherit; font-size: 11px; }
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
  --tile-head-height: 28px;
  position: relative;
  container-type: inline-size;
  container-name: tile;
  display: grid;
  grid-template-rows: var(--tile-head-height) minmax(0, 1fr) var(--prompt-height, 32px);
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
  bottom: var(--prompt-height, 32px);
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
  inset: var(--tile-head-height) 0 var(--prompt-height, 32px) 0;
  background: var(--skin-good);
  opacity: 0;
  pointer-events: none;
  z-index: 1;
}
.chime-glow {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  border-radius: inherit;
  color: var(--panel-hue-color, var(--skin-accent));
  border: 2px solid currentColor;
  box-shadow: inset 0 0 12px 1px currentColor;
  opacity: .45;
}
.tile.covered { display: none; }
.tile.row-span-2 { min-height: 0; }
 .tools-toggle { display: inline-flex; }
.tools-label { display: none; }
.empty .tools-label { display: inline; }
.empty .panel-menu > :not(.panel-menu-title):not(.assign-field) { display: none; }
.empty .head-actions > :not(.tools-toggle) { display: none; }
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
  border-color: hsl(var(--spectacle-hue) 54% 58%);
  opacity: .5;
}
body[data-skin="disco"][data-motion="subtle"][data-spectacle="disco"] .tile::after {
  background: hsl(var(--spectacle-hue) 64% 58%);
  animation: discoTileGlimmer 1400ms ease-in-out infinite;
  animation-delay: var(--spectacle-delay);
}
body[data-skin="disco"][data-motion="subtle"][data-spectacle="disco"] .idx {
  border-color: hsl(var(--spectacle-hue) 54% 58%);
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
.disco-skip {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  cursor: pointer;
}
.disco-skip, .disco-skip:hover, .disco-skip:active { background: transparent; }
body[data-spectacle="disco"] .disco-skip { display: block; }
.disco-skip:focus-visible { outline: 2px solid var(--skin-accent); outline-offset: -4px; }
.disco-ball {
  display: none;
  position: fixed;
  top: 46px;
  right: var(--disco-right);
  width: var(--disco-size);
  height: var(--disco-size);
  z-index: 2147483647;
  pointer-events: auto;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  image-rendering: pixelated;
  transform: translate3d(0, -175px, 0);
}
.disco-ball:hover, .disco-ball:active { background: transparent; }
.disco-ball:focus-visible { outline: 2px solid var(--skin-accent); outline-offset: 3px; border-radius: 50%; }
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
body[data-skin="disco"] .disco-ball[data-state="settled"],
body[data-skin="disco"] .disco-ball[data-state="dismissing"] { animation: none; transform: translate3d(0, 0, 0); }
body[data-skin="disco"] .disco-ball[data-state="dismissed"] { display: none; }
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
  position: relative; z-index: 2; display: flex; align-items: center; gap: 6px;
  min-width: 0; padding: 2px 5px; border-bottom: 1px solid var(--skin-border);
  background: var(--skin-head); user-select: none;
}
.head[draggable="true"] { cursor: grab; }
.head-main { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0; }
.head-actions { display: flex; align-items: center; gap: 3px; flex: 0 0 auto; }
.idx { width: 24px; height: 18px; flex: 0 0 24px; display: inline-grid; place-items: center; color: var(--skin-text); background: var(--skin-head); border: 1px solid var(--skin-good); font-weight: 700; }
.working .idx { border-color: var(--skin-work); }
.changed .idx { border-color: var(--skin-good); }
.name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.meta { max-width: 30%; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--skin-text); white-space: nowrap; font-size: 10px; }
.head-actions > button { height: 22px; min-width: 24px; border-radius: 4px; padding: 0 4px; }
.icon-button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
.header-chime { width: 24px; padding: 0 !important; touch-action: none; }
.header-chime .chime-slash { display: none; }
.header-chime[aria-pressed="false"] .chime-slash { display: block; }
.chime-cadence-picker {
  position: fixed; z-index: 70; width: min(292px, calc(100vw - 12px)); box-sizing: border-box;
  padding: 8px 12px 7px; border: 1px solid var(--skin-accent); border-radius: 7px;
  background: var(--skin-board); color: var(--skin-text); box-shadow: 0 8px 28px var(--skin-shadow);
  pointer-events: none;
}
.chime-cadence-picker[hidden] { display: none; }
.chime-cadence-picker output { display: block; margin-bottom: 3px; text-align: center; font-size: 11px; font-weight: 700; }
.chime-cadence-picker input { display: block; width: 100%; margin: 0; accent-color: var(--skin-accent); }
.chime-cadence-ticks { display: flex; justify-content: space-between; padding: 0 6px; color: var(--skin-muted); font-size: 8px; line-height: 1; }
.head button:focus-visible, .head select:focus-visible, .board-picker :focus-visible { outline: 2px solid var(--skin-accent); outline-offset: 1px; }
.head [aria-expanded="true"], .panel-menu [aria-pressed="true"] { border-color: var(--skin-accent); }
.move-board.board-moving { cursor: wait; opacity: .72; }
.panel-menu { margin: 0; inset: auto; color: var(--skin-text); }
.panel-menu::backdrop { background: transparent; }
.panel-menu select { height: 28px; min-width: 0; width: 140px; }
.panel-chime { border-top: 1px solid var(--skin-border); margin-top: 4px; padding-top: 4px; }
.panel-chime > label { display: grid; grid-template-columns: 1fr; gap: 4px; }
.panel-menu .chime-mode { width: 100%; max-width: none; }
.chime-interval { padding: 4px 8px; }
.chime-interval[hidden] { display: none; }
.chime-interval > label { display: grid; grid-template-columns: 1fr; gap: 4px; padding: 0; }
.panel-menu .chime-frequency { width: 100%; max-width: none; }
.panel-menu input:focus-visible { outline: 2px solid var(--skin-accent); outline-offset: 1px; }
.panel-menu .key-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3px; }
.panel-menu .terminal-key-grid { grid-template-columns: repeat(12, minmax(0, 1fr)); }
.panel-menu .terminal-key-grid button { grid-column: span 4; padding-inline: 5px; white-space: nowrap; }
.panel-menu .terminal-key-grid button:nth-child(-n+4) { grid-column: span 3; }
.font-controls { display: grid; grid-template-columns: 32px minmax(0, 1fr) 32px; gap: 5px; padding: 4px 8px; }
.font-controls button { text-align: center; }
.font-controls input { width: 100%; box-sizing: border-box; border: 1px solid var(--skin-border); border-radius: 3px; }
.head .font-select { width: 14px; height: 14px; margin: 0 5px 0 0; accent-color: var(--skin-accent); cursor: pointer; }
.tile.font-selected .head { box-shadow: inset 0 -2px var(--skin-accent); }
.tile.empty .font-select { display: none; }
.tile .terminal-output { font-size: var(--panel-font-size, 12px); line-height: 1.35; }
.panel-menu .danger-command { border-color: var(--skin-danger); }
@container tile (max-width: 420px) { .head .meta { display: none; } }
pre {
  position: relative; z-index: 2;
  min-width: 0;
  min-height: 0;
  height: 100%;
  margin: 0; padding: 7px 8px; overflow: auto; white-space: pre-wrap; word-break: break-word;
}
.prompt-input::placeholder, #boardPickerInput::placeholder { color: var(--skin-muted); opacity: 1; }
.terminal-output { min-width: 0; min-height: 0; height: 100%; box-sizing: border-box; }
.terminal-output a {
  color: var(--skin-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.terminal-file[data-artifact-state="unavailable"] { color: var(--muted, #9ca9bb); text-decoration: underline dotted; }
.terminal-file[data-artifact-state="unavailable"]::after { content: " [unavailable]"; font-size: .85em; }
.terminal-output a:hover { text-decoration-thickness: 2px; }
.terminal-output a:focus-visible { outline: 2px solid var(--skin-accent); outline-offset: 2px; }
form {
  position: relative; z-index: 2;
  display: grid; grid-template-columns: minmax(0, 1fr) 48px;
  border-top: 1px solid var(--skin-border);
}
input, textarea { min-width: 0; border: 0; outline: 0; padding: 0 7px; color: var(--skin-input-text); background: var(--skin-input); }
.prompt-input { box-sizing: border-box; width: 100%; height: 31px; padding: 5px 7px; line-height: 1.35; resize: none; overflow-y: auto; white-space: pre-wrap; }
form button { border-width: 0 0 0 1px; }
.terminal-composer.has-images { grid-template-rows: 40px minmax(0, 1fr); }
.draft-images { grid-column: 1 / -1; display: flex; align-items: center; gap: 4px; padding: 2px 5px; overflow-x: auto; background: var(--skin-input); }
.draft-image { display: inline-flex; flex: 0 0 auto; align-items: center; height: 34px; border: 1px solid var(--skin-border); border-radius: 3px; }
.draft-image img { width: 32px; height: 28px; object-fit: contain; margin: 2px; }
.draft-image button { width: 28px; min-width: 28px; height: 30px; padding: 0; border: 0; }
.draft-image[data-ready="false"] img { opacity: .5; }
.draft-image button:focus-visible { outline: 2px solid var(--skin-accent); outline-offset: -2px; }
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
  inset: calc(32px + var(--page-top-inset)) auto 0 0;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding-bottom: 2px;
  background: var(--skin-page);
}
.holding-tools input, #holdingBoardFilter { grid-column: 1 / -1; }
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
}
.holding-item {
  flex: 0 0 auto;
  min-width: 0;
  display: grid;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--skin-border);
  background: var(--skin-toolbar);
  border-radius: 6px;
  cursor: grab;
}
.holding-item:active { cursor: grabbing; }
.holding-item-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
}
.holding-field {
  display: grid;
  grid-template-rows: auto 28px;
  gap: 2px;
  min-width: 0;
}
.holding-field-display,
.holding-field-tmux { grid-column: 1 / -1; }
.holding-field label { color: var(--skin-muted); font-size: 10px; }
.holding-field input,
.holding-field select { min-width: 0; width: 100%; height: 28px; padding: 0 6px; border: 1px solid var(--skin-border); }
.holding-item-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto 28px;
  align-items: end;
  gap: 6px;
}
.holding-item-actions::before {
  content: 'Board';
  grid-column: 1 / -1;
  color: var(--skin-muted);
  font-size: 10px;
}
.holding-item-actions button { min-width: 0; height: 28px; padding: 0 8px; }
.holding-restore-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; }
.holding-restore-controls select, .holding-restore-controls button { min-width: 0; height: 32px; }
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
.meta-terminal { position: fixed; z-index: 18; display: none; background: var(--skin-board); color: var(--skin-text); border: 1px solid var(--skin-border); box-shadow: 0 14px 38px var(--skin-shadow); }
.meta-terminal.open { display: block; }
.meta-terminal.side { top: calc(32px + var(--page-top-inset)); right: 0; bottom: 0; width: min(560px, 96vw); border-width: 0 0 0 1px; }
.meta-terminal.bottom { left: 0; right: 0; bottom: 0; height: min(440px, 68vh); border-width: 1px 0 0; }
.meta-terminal-inner { height: 100%; padding: 8px; }
.meta-terminal .meta-panel-surface { position: relative; inset: auto; width: 100%; height: 100%; box-shadow: none; }
.meta-terminal .meta-panel-surface .head { position: static; cursor: default; }
.meta-terminal .meta-panel-surface .head-actions { display: flex; }
@media (max-width: 900px) {
  .board { gap: 6px; padding: 6px; }
}
@media (min-width: 641px) and (max-width: 900px) {
  .tile {
    --tile-head-height: 28px;
  }
  .tile::before {
    top: var(--tile-head-height);
  }
  .tile::after {
    inset: var(--tile-head-height) 0 var(--prompt-height, 32px) 0;
  }
}
@media (max-width: 640px) {
  .board {
    grid-template-columns: 1fr;
    grid-template-rows: none;
    grid-auto-rows: minmax(260px, 44vh);
  }
  .tile { min-height: 260px; }
  .tile::before { top: var(--tile-head-height); }
  .tile::after { inset: var(--tile-head-height) 0 var(--prompt-height, 32px) 0; }
  .holding-drawer { width: min(330px, 100vw); }
}
.holding-item[draggable="true"] { cursor: grab; }
${fs.readFileSync(path.join(__dirname, 'mobile.css'), 'utf8')}
${fs.readFileSync(path.join(__dirname, 'panelHues.css'), 'utf8')}
${fs.readFileSync(path.join(__dirname, 'boardReset.css'), 'utf8')}
${fs.readFileSync(path.join(__dirname, 'larsonDesktop.css'), 'utf8')}
${fs.readFileSync(path.join(__dirname, 'codexQuestions.css'), 'utf8')}
${fs.readFileSync(path.join(__dirname, 'panelHealth.css'), 'utf8')}
</style>
</head>
<body data-skin="system" data-build="${TERMINALTOWN_BUILD_TAG}">
<audio id="purrSound" src="${purrSrc}" preload="auto"></audio>
<div class="disco-lightwash" aria-hidden="true"><span class="wash-a"></span><span class="wash-b"></span><span class="wash-c"></span></div>
<div class="disco-party-dim" aria-hidden="true"></div>
<div class="disco-refractions" aria-hidden="true"><img class="disco-refraction-map" src="${refractionSrc}" alt=""></div>
<button type="button" class="disco-skip" aria-label="Skip Disco transition" title="Skip Disco transition"></button>
<button type="button" class="disco-ball" aria-label="Dismiss disco ball" title="Dismiss disco ball"><span class="disco-disc"><img class="disco-gif" src="${discoBallSrc}" alt="" draggable="false"></span></button>
<aside id="layoutNotice" class="layout-notice" aria-label="Panel layout notice" hidden><p role="status" aria-live="polite" aria-atomic="true"></p><button type="button" id="layoutNoticeHolding">Open Holding</button><button type="button" id="layoutNoticeDismiss">Dismiss</button></aside>
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
  <style>${fs.readFileSync(path.join(__dirname, 'sessionFinder.css'), 'utf8')}</style>
  <nav class="toolbar" aria-label="Board controls" data-menu-version="controls-20260910">
    <button id="toggleToolbar" class="toolbar-toggle command" type="button" title="Hide page controls" aria-label="Hide page controls" aria-expanded="true"><svg class="command-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button>
    <div class="board-control">
      <button type="button" id="boardMenuButton" class="command" title="Switch board (Alt+Shift+B)" aria-label="Switch board" aria-controls="boardPicker" aria-haspopup="dialog" aria-expanded="false"><svg class="command-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span class="board-label" id="boardLabel">TerminalTown</span><span class="command-caret" aria-hidden="true">▾</span></button>
    </div>
    <div class="toolbar-group">
      <button type="button" id="sessionMenuButton" class="command primary-command" title="New session" aria-label="New session" data-popover="sessionMenu" aria-controls="sessionMenu" aria-haspopup="dialog" aria-expanded="false"><svg class="command-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span class="command-label">New</span><span class="command-caret" aria-hidden="true">▾</span></button>
      <section id="sessionMenu" class="command-popover" role="dialog" aria-label="New session" hidden>
        <h2>New session</h2><button type="button" id="newClaude">Claude…</button><button type="button" id="newCodex">Codex…</button><button type="button" id="newSession" title="Choose an agent, shell, or preset">Choose session type…</button>
      </section>
      <button type="button" id="findSession" class="command" aria-label="Find session" title="Find session"><svg class="command-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg><span class="command-label">Find</span></button>
      <button id="toggleHolding" type="button" class="command" title="Open Holding drawer" aria-label="Open Holding drawer" aria-controls="holdingDrawer" aria-expanded="false"><svg class="command-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16l2 12v4H2v-4L4 4Z"/><path d="M2 16h6l2 3h4l2-3h6"/></svg><span class="command-label">Holding</span><span class="command-count" id="toolbarHoldingCount">0</span></button>
      <button type="button" id="toggleMeta" class="command " title="Meta Terminal" aria-label="Meta Terminal" ><svg class="command-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 9 3 3-3 3m6 0h5"/></svg><span class="command-label">Meta Terminal</span></button>
    </div>
    <div class="toolbar-group">
      <button type="button" id="viewMenuButton" class="command " title="View" aria-label="View" data-popover="viewMenu" aria-controls="viewMenu" aria-haspopup="dialog" aria-expanded="false"><svg class="command-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M10 9v12"/></svg><span class="command-label">View</span><span class="command-caret" aria-hidden="true">▾</span></button>
      <section id="viewMenu" class="command-popover" role="dialog" aria-label="View settings" hidden>
        ${fs.readFileSync(path.join(__dirname, 'boardReset.html'), 'utf8')}<hr>
        <h2>Text size (px)</h2>
        <label for="fontScope">Apply to<select id="fontScope"><option value="all">All panels</option><option value="selected">Selected (0)</option></select></label>
        <div class="font-controls"><button type="button" id="fontDecrease" aria-label="Decrease text size">−</button><input type="number" id="fontSize" min="8" max="40" step="1" aria-label="Text size in pixels" placeholder="Mixed"><button type="button" id="fontIncrease" aria-label="Increase text size">+</button></div>
        ${fs.readFileSync(path.join(__dirname, 'panelHues.html'), 'utf8')}
        <p id="preferenceSyncStatus" class="command-help" role="status" hidden></p><hr><h2>Layout &amp; appearance</h2>
        <label for="gridShape">Grid<select id="gridShape" title="Grid size"><option value="3x4">3x4</option><option value="2x2">2x2</option><option value="2x3">2x3</option><option value="3x3">3x3</option><option value="4x3">4x3</option><option value="4x4">4x4</option></select></label>
        <button type="button" id="compact" title="Keep rows at least 150 px tall; allow the board to scroll when needed">Roomier rows</button>
        <hr><label for="skin">Skin<select id="skin" title="Board skin"><option value="system">System</option><option value="circuit">Circuit</option><option value="aurora">Aurora</option><option value="daybook">Daybook</option><option value="arcade">Arcade</option><option value="mono">Mono</option><option value="sepia">Sepia Night</option><option value="disco">Disco</option></select></label>
        <label for="motion">Motion<select id="motion" title="Board motion"><option value="subtle">Subtle</option><option value="still">Still</option></select></label>
        <button type="button" id="sound">Completion sound</button><button type="button" id="playDisco" title="Switch to the Disco skin and play its effects">Play Disco effects</button>
      </section>
      <button type="button" id="toolsMenuButton" class="command" title="Maintenance &amp; help" aria-label="Maintenance &amp; help" data-popover="toolsMenu" aria-controls="toolsMenu" aria-haspopup="dialog" aria-expanded="false"><svg class="command-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button>
      <section id="toolsMenu" class="command-popover" role="dialog" aria-label="Maintenance and help" hidden>
        <h2>Maintenance</h2><button type="button" id="refresh" title="Fetch the latest terminal output">Refresh snapshots</button><button type="button" id="recover" title="Retry live output, adopt resumed panes, or restart missing saved sessions">Recover sessions / live output</button><button type="button" id="reloadUi">Reload UI</button><button type="button" id="reloadWindow" title="Reload the entire VS Code window; in browser mode, reload this page">Reload VS Code window</button><hr><button type="button" id="auto" title="Reset saved slot assignments and automatically fill the board">Auto-fill / reset slots</button>
        <hr><p class="command-help">Click a panel to select it. Type in its prompt, or press Esc to send Escape to that session.</p>
        <p class="command-help" id="menuStatus" role="status">Starting…</p>
      </section>
    </div>
    <button type="button" id="muteChimes" class="command" aria-label="Mute all chimes" title="Mute all chimes" aria-pressed="false"><svg class="command-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8"/><path class="mute-slash" d="m3 3 18 18"/></svg></button>
    <div id="boardPins" class="board-pins" aria-label="Pinned boards"></div>
    <button type="button" id="panelHealthButton" class="panel-health-button" data-state="unknown" aria-haspopup="dialog" aria-controls="panelHealthDialog" aria-label="Panel health: waiting"><span class="panel-health-dot" aria-hidden="true"></span><span class="health-label">Health</span></button>
    <span class="status" id="status" role="status">Starting…</span>
  </nav>
  <div class="recovery" id="recovery"><span></span><button type="button">Recover</button></div>
  <div class="board-picker-backdrop" id="boardPicker" aria-hidden="true">
    <section class="board-picker" role="dialog" aria-modal="true" aria-labelledby="boardPickerTitle">
      <div class="board-picker-header">
        <strong id="boardPickerTitle">Boards</strong>
        <button type="button" class="board-picker-close" id="boardPickerClose" title="Close">X</button>
      </div>
      <form class="board-picker-form" id="boardPickerForm">
        <input id="boardPickerInput" autocomplete="off" placeholder="Find a board…" aria-label="Find a board" aria-controls="boardPickerList">
        <button type="submit" title="Switch to matching board">Go</button>
      </form>
      <div class="board-picker-list" id="boardPickerList" aria-label="Boards"></div>
      <div class="board-picker-footer">
        <div class="board-management"><button type="button" id="previousBoard">Previous board</button><button type="button" id="newBoard">New…</button><button type="button" id="renameBoard">Rename…</button><button type="button" id="openMap">Git Map ↗</button><button type="button" id="openEnvironments">Environments ↗</button></div>
        <label for="boardShortcut">Shortcuts<select id="boardShortcut"><option value="alt">Ctrl + Alt shortcuts</option><option value="ctrl">Ctrl shortcuts</option><option value="off">Off</option></select></label>
        <span id="boardShortcutHint">Ctrl+B / Ctrl+Shift+B: next · Ctrl+V: back</span>
      </div>
    </section>
  </div>
  ${fs.readFileSync(path.join(__dirname, 'sessionFinder.html'), 'utf8')}
  <textarea id="clipboardProxy" class="clipboard-proxy" aria-hidden="true" tabindex="-1" autocomplete="off"></textarea>
  ${fs.readFileSync(path.join(__dirname, 'panelHealth.html'), 'utf8')}
  <dialog id="sessionMemoryDialog" class="session-memory-dialog" aria-labelledby="sessionMemoryTitle">
    <div class="memory-dialog-body">
      <header class="memory-dialog-header"><h2 id="sessionMemoryTitle">Session memory</h2><button type="button" id="memoryClose" aria-label="Close session memory">×</button></header>
      <label class="memory-field">Approved charter<textarea id="memoryApprovedCharter" maxlength="65536"></textarea><span class="memory-field-actions"><span id="memoryCharterMeta" class="memory-meta"></span><button type="button" id="memorySaveCharter">Save charter</button></span></label>
      <label class="memory-field">Current context<textarea id="memoryContext" maxlength="65536"></textarea><span class="memory-field-actions"><span id="memoryContextMeta" class="memory-meta"></span><button type="button" id="memorySaveContext">Save context</button></span></label>
      <section id="memoryProposalReview" class="memory-proposal" aria-labelledby="memoryProposalTitle" hidden>
        <h3 id="memoryProposalTitle">Charter change awaiting approval</h3>
        <div class="memory-diff"><section><h4>Approved</h4><pre id="memoryProposalBefore"></pre></section><section><h4>Proposed</h4><pre id="memoryProposalAfter"></pre></section></div>
        <p id="memoryProposalReason" class="memory-meta"></p>
        <div class="memory-dialog-actions"><button type="button" id="memoryReject" aria-label="Reject proposed session charter">Reject</button><button type="button" id="memoryApprove" aria-label="Approve proposed session charter">Approve</button></div>
      </section>
    </div>
  </dialog>
  <main class="board" id="board"></main>
  ${fs.readFileSync(path.join(__dirname, 'mobile.html'), 'utf8')}
  <aside class="holding-drawer" id="holdingDrawer" aria-label="Holding sessions" aria-hidden="true">
    <div class="holding-panel">
      <div class="holding-header">
        <strong>Holding</strong>
        <span class="holding-count" id="holdingCount">0</span>
        <button type="button" class="holding-close" id="closeHolding" title="Close Holding drawer">X</button>
      </div>
      <div class="holding-tools">
        <input id="holdingSearch" autocomplete="off" placeholder="Search Holding" aria-label="Search Holding">
        <select id="holdingBoardFilter" title="Filter Holding by board" aria-label="Filter Holding by board"><option value="all">All boards</option></select>
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
  <aside class="meta-terminal side" id="metaTerminal" aria-label="Meta Terminal" aria-hidden="true"><div class="meta-terminal-inner"><section class="tile meta-panel-surface">
    <div class="head"><div class="head-main"><span class="idx">MT</span><span class="name">Meta Terminal</span><button type="button" id="metaMemory" class="memory-badge" title="Open saved Meta memory">Memory saved</button><span class="meta" id="metaStatus">Starting</span></div>
      <div class="head-actions"><button type="button" id="metaEsc" title="Send Escape" aria-label="Send Escape to Meta Terminal">Esc</button><button type="button" id="metaPaste" class="icon-button" data-icon="paste" title="Paste host clipboard into terminal" aria-label="Paste into Meta Terminal"></button><button type="button" id="metaTools" class="icon-button" data-icon="more" title="Meta Terminal controls" aria-label="Meta Terminal controls" aria-haspopup="dialog" aria-controls="metaMenu" aria-expanded="false"></button><button type="button" id="closeMeta" class="icon-button" data-icon="close" title="Close Meta Terminal dock" aria-label="Close Meta Terminal dock"></button></div>
      <section id="metaMenu" class="command-popover panel-menu" popover="manual" role="dialog" aria-label="Meta Terminal controls" hidden>
        <h2>Meta Terminal</h2><button type="button" id="metaCopy">Copy terminal history</button>
        <hr><h2>Terminal keys</h2><div class="key-grid"><button type="button" id="metaTab" title="Send draft with Tab, or send Tab">Tab ⇥</button><button type="button" id="metaEnter" title="Send Enter without submitting the draft">Enter ↵</button><button type="button" id="metaCtrlC" title="Interrupt the running command">Interrupt · Ctrl+C</button></div>
        <hr><h2>Dock position</h2><button type="button" id="metaSide">Side</button><button type="button" id="metaBottom">Bottom</button>
      </section>
    </div><pre id="metaTranscript" class="terminal-output" aria-live="polite">Starting Meta Terminal…</pre><form id="metaComposer"><textarea id="metaGoal" class="prompt-input" rows="1" autocomplete="off" placeholder="Prompt" aria-label="Meta Terminal prompt" aria-description="Enter to send; Shift+Enter for a new line"></textarea><button type="submit" id="metaLaunch">Send</button></form>
  </section></div></aside>
</div>
<script nonce="${n}">
window.terminalTownHealthUiBuild = ${JSON.stringify(require('./panelHealth').frontendIdentity(__dirname))};
const vscode = acquireVsCodeApi();
${fs.readFileSync(path.join(__dirname, 'preferenceSchema.js'), 'utf8')}
${fs.readFileSync(path.join(__dirname, 'preferences.js'), 'utf8')}
${fs.readFileSync(path.join(__dirname, 'artifactReferences.js'), 'utf8')}
${fs.readFileSync(path.join(__dirname, 'artifactLinksClient.js'), 'utf8')}
const preferenceRequests = new Map();
let preferenceRequestId = 0;
const preferenceStorage = createPreferenceStorage(async request => {
  if (window.terminalTownBrowserHost) {
    const response = await fetch('/api/preferences?device=' + encodeURIComponent(request.device), {
      method: request.operations ? 'PATCH' : 'GET',
      headers: { 'content-type': 'application/json' },
      ...(request.operations ? { body: JSON.stringify(request) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Preference server unavailable');
    return response.json();
  }
  return new Promise((resolve, reject) => {
    const requestId = ++preferenceRequestId;
    const timeout = setTimeout(() => { preferenceRequests.delete(requestId); reject(new Error('Preference host unavailable')); }, 10000);
    preferenceRequests.set(requestId, { resolve, reject, timeout });
    vscode.postMessage({ type: 'preferences', requestId, ...request });
  });
});
window.addEventListener('message', event => {
  const msg = event.data;
  if (msg?.type !== 'preferencesResult') return;
  const request = preferenceRequests.get(msg.requestId);
  if (!request) return;
  clearTimeout(request.timeout); preferenceRequests.delete(msg.requestId);
  if (msg.error) request.reject(new Error(msg.error)); else request.resolve(msg.payload);
});

var mobileReady = false;
const board = document.getElementById('board');
const holding = document.getElementById('holding');
const holdingDrawer = document.getElementById('holdingDrawer');
const toggleHoldingButton = document.getElementById('toggleHolding');
const closeHoldingButton = document.getElementById('closeHolding');
const holdingTabButton = document.getElementById('holdingTab');
const holdingSearch = document.getElementById('holdingSearch');
const holdingFilter = document.getElementById('holdingFilter');
const holdingBoardFilter = document.getElementById('holdingBoardFilter');
const holdingSort = document.getElementById('holdingSort');
const holdingCount = document.getElementById('holdingCount');
const holdingTabCount = document.getElementById('holdingTabCount');
const kartLayer = document.querySelector('.kart-layer');
const kartEls = Array.from(document.querySelectorAll('.kart'));
const smokeEls = Array.from(document.querySelectorAll('.smoke'));
const statusEl = document.getElementById('status');
const clipboardProxy = document.getElementById('clipboardProxy');
const sessionMemoryDialog = document.getElementById('sessionMemoryDialog');
const memoryApprovedCharter = document.getElementById('memoryApprovedCharter');
const memoryContext = document.getElementById('memoryContext');
const memoryProposalReview = document.getElementById('memoryProposalReview');
const toolbar = document.querySelector('.toolbar');
const toggleToolbarButton = document.getElementById('toggleToolbar');
const newBoardButton = document.getElementById('newBoard');
const openBoardButton = document.getElementById('boardMenuButton');
const renameBoardButton = document.getElementById('renameBoard');
const openMapButton = document.getElementById('openMap');
const boardLabel = document.getElementById('boardLabel');
const gridShapeSelect = document.getElementById('gridShape');
const newButton = document.getElementById('newSession');
const newClaudeButton = document.getElementById('newClaude');
const newCodexButton = document.getElementById('newCodex');
const toggleMetaButton = document.getElementById('toggleMeta'); const metaTerminal = document.getElementById('metaTerminal'); const closeMetaButton = document.getElementById('closeMeta'); const metaSideButton = document.getElementById('metaSide'); const metaBottomButton = document.getElementById('metaBottom'); const metaComposer = document.getElementById('metaComposer'); const metaGoal = document.getElementById('metaGoal'); const metaLaunchButton = document.getElementById('metaLaunch'); const metaStatus = document.getElementById('metaStatus'); const metaTabButton = document.getElementById('metaTab'); const metaEnterButton = document.getElementById('metaEnter'); const metaEscButton = document.getElementById('metaEsc'); const metaCtrlCButton = document.getElementById('metaCtrlC'); const metaCopyButton = document.getElementById('metaCopy'); const metaPasteButton = document.getElementById('metaPaste');
const metaTranscript = document.getElementById('metaTranscript');
const refreshButton = document.getElementById('refresh');
const recoverButton = document.getElementById('recover');
const reloadUiButton = document.getElementById('reloadUi');
const reloadWindowButton = document.getElementById('reloadWindow');
const autoButton = document.getElementById('auto');
const compactButton = document.getElementById('compact');
const soundButton = document.getElementById('sound');
const muteChimesButton = document.getElementById('muteChimes');
const playDiscoButton = document.getElementById('playDisco');
const skinSelect = document.getElementById('skin');
const terminalTownFavicon = document.getElementById('terminalTownFavicon');
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
let slotRecords = [];
let allSessions = [];
let titles = {};
let activeRenderedBoardId = '';
let lastBoardData = null, confirmedBoardData = null, renderedLayoutRevision = 0;
let panelMoveSequence = 0, panelMoveTimer = null;
const pendingPanelMoves = [];
const deferredPanelActions = [];

function syncTileControls(el) {
  if (el) el.classList.toggle('controls-collapsed', el.clientWidth < 340);
  if (el) sizeDesktopFrame(el);
}
let tileGeometryRefreshTimer = null;
let lastTerminalGeometrySignature = '';
function scheduleTileGeometryRefresh() {
  clearTimeout(tileGeometryRefreshTimer);
  tileGeometryRefreshTimer = setTimeout(() => {
    // Measure after the browser has committed grid placement. The first
    // refresh often happens before a row-spanning tile has its final height.
    const signature = JSON.stringify(terminalSizesBySlotHint());
    if (signature === lastTerminalGeometrySignature) return;
    lastTerminalGeometrySignature = signature;
    requestRefresh({ force: true });
  }, 160);
}
const tileResizeObserver = window.ResizeObserver
  ? new ResizeObserver((entries) => entries.forEach((entry) => {
    syncTileControls(entry.target);
    scheduleTileGeometryRefresh();
  }))
  : null;
let selectedSlot = 0;
let renamingSlot = null;
function migratedStorageValue(key, legacyKey, fallback) {
  const current = preferenceStorage.getItem(key);
  if (current !== null) return current;
  const legacy = preferenceStorage.getItem(legacyKey);
  if (legacy !== null) {
    preferenceStorage.setItem(key, legacy);
    return legacy;
  }
  return fallback;
}
let compact = migratedStorageValue('terminaltown-compact', 'larson-ai-board-compact', '0') === '1';
let sound = migratedStorageValue('terminaltown-sound', 'larson-ai-board-sound', '1') !== '0';
// A local emergency latch cannot be undone by a delayed server preference response.
let chimesMuted = preferenceStorage.getItem('terminaltown-chimes-muted') === '1';
function boardSkinKey(id = currentBoardId()) { return 'terminaltown-skin:' + id; }
function readBoardSkin(id = currentBoardId()) {
  const key = boardSkinKey(id);
  // Seed each board once from the old preference; later changes stay on that board.
  const saved = preferenceStorage.getItem(key);
  const value = saved || migratedStorageValue('terminaltown-skin', 'larson-ai-board-skin', 'system') || 'system';
  return value;
}
let skin = readBoardSkin();
let motion = migratedStorageValue('terminaltown-motion', 'larson-ai-board-motion', 'subtle') || 'subtle';
let holdingOpen = preferenceStorage.getItem('terminaltown-holding-open') === '1';
let holdingNames = [];
let holdingBoards = [];
let holdingMembership = {};
let holdingQuery = preferenceStorage.getItem('terminaltown-holding-query') || '';
let holdingFilterValue = preferenceStorage.getItem('terminaltown-holding-filter') || 'all';
let holdingBoardFilterValue = preferenceStorage.getItem('terminaltown-holding-board-filter') || 'all';
let holdingSortValue = preferenceStorage.getItem('terminaltown-holding-sort') || 'recent';
let audioCtx = null;
let audioReady = false;
let renderSeen = false;
let arcadeTimers = new Set();
let arcadeTrack = null;
let arcadeKarts = [];
let arcadeLayoutSig = '';
let smokeCursor = 0;
const kartHitRadius = 11;
const pendingChimes = new Map();
const chimePlaybackTokens = new Map();
const chimeObservations = new Map();
const chimeVoices = new Set();
const chimePulses = new Map();
let mediaChimeSlot = null;
const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const DISCO_SPECTACLE_MS = 5400;
const spectacleHues = [320, 188, 48, 136, 278, 18, 214, 82, 344, 164, 6, 252];
let spectacleTimer = null;
const discoBall = document.querySelector('.disco-ball');
const discoSkip = document.querySelector('.disco-skip');
let discoDismissAnimation = null;
let terminalTownFaviconSource = null;
function resolvedSkinColor(token) {
  const probe = document.createElement('span');
  probe.style.color = 'var(' + token + ')';
  probe.hidden = true;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
  return Array.from(context.getImageData(0, 0, 1, 1).data);
}
function updateTerminalTownFavicon() {
  if (!window.terminalTownBrowserHost || !terminalTownFavicon) return;
  if (!terminalTownFaviconSource) {
    terminalTownFaviconSource = new Image();
    terminalTownFaviconSource.addEventListener('load', updateTerminalTownFavicon, { once: true });
    terminalTownFaviconSource.src = '/assets/terminaltown-favicon.png';
    return;
  }
  if (!terminalTownFaviconSource.complete || !terminalTownFaviconSource.naturalWidth) return;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(terminalTownFaviconSource, 0, 0, 64, 64);
  const pixels = context.getImageData(0, 0, 64, 64);
  const page = resolvedSkinColor('--skin-page');
  const text = resolvedSkinColor('--skin-text');
  const accent = resolvedSkinColor('--skin-accent');
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (!pixels.data[i + 3]) continue;
    const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
    const luminance = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
    const color = g > r * 1.08 && g > b * 1.03 ? accent : (luminance > 0.55 ? text : page);
    pixels.data[i] = color[0]; pixels.data[i + 1] = color[1]; pixels.data[i + 2] = color[2];
  }
  context.putImageData(pixels, 0, 0);
  terminalTownFavicon.href = canvas.toDataURL('image/png');
}
for (const control of [discoSkip, discoBall]) {
  // Consume the whole gesture before it can focus, select or activate a panel.
  control.addEventListener('pointerdown', ev => { ev.preventDefault(); ev.stopPropagation(); });
  control.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Escape' && spectacleActive()) { ev.preventDefault(); endDiscoSpectacle(); }
  });
}
discoSkip.addEventListener('click', ev => {
  ev.preventDefault(); ev.stopPropagation();
  if (spectacleActive()) endDiscoSpectacle();
});
discoBall.addEventListener('click', ev => {
  ev.preventDefault(); ev.stopPropagation();
  dismissDiscoBall();
});
let pendingRefresh = false;
let pendingData = null;
let initialDiscoSpectaclePending = skin === 'disco';
let pasteEventSerial = 0;
document.body.dataset.skin = skin;
updateTerminalTownFavicon();
document.body.dataset.motion = motion;
skinSelect.value = skin;
motionSelect.value = motion;
holdingSearch.value = holdingQuery;
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
try { setMetaDock(preferenceStorage.getItem('terminaltown-meta-dock') || 'side'); } catch { setMetaDock('side'); }
toggleMetaButton.addEventListener('click', () => setMetaOpen(!metaTerminal.classList.contains('open'))); closeMetaButton.addEventListener('click', () => setMetaOpen(false)); metaSideButton.addEventListener('click', () => setMetaDock('side')); metaBottomButton.addEventListener('click', () => setMetaDock('bottom')); metaComposer.addEventListener('submit', (ev) => { ev.preventDefault(); launchMetaTerminal(); }); bindPromptInput(metaGoal, key => metaSubmitPrompt(key)); metaTabButton.addEventListener('click', () => metaSubmitPrompt('tab')); metaEnterButton.addEventListener('click', () => metaSendKey('enter')); metaEscButton.addEventListener('click', () => metaSendKey('esc')); metaCtrlCButton.addEventListener('click', () => metaSendKey('ctrl-c')); metaCopyButton.addEventListener('click', copyMetaTerminal); metaPasteButton.addEventListener('click', () => { metaFollowOutput = true; post('metaPasteClipboard'); });
setInterval(() => { if (metaTerminal.classList.contains('open') && window.terminalTownBrowserHost) post('metaPoll'); }, 1800);
holdingSearch.addEventListener('input', () => {
  holdingQuery = holdingSearch.value || '';
  preferenceStorage.setItem('terminaltown-holding-query', holdingQuery);
  renderHoldingList();
});
holdingFilter.addEventListener('change', () => {
  holdingFilterValue = holdingFilter.value || 'all';
  preferenceStorage.setItem('terminaltown-holding-filter', holdingFilterValue);
  renderHoldingList();
});
holdingBoardFilter.addEventListener('change', () => {
  holdingBoardFilterValue = holdingBoardFilter.value || 'all';
  preferenceStorage.setItem('terminaltown-holding-board-filter', holdingBoardFilterValue);
  renderHoldingList();
});
holdingSort.addEventListener('change', () => {
  holdingSortValue = holdingSort.value || 'recent';
  preferenceStorage.setItem('terminaltown-holding-sort', holdingSortValue);
  renderHoldingList();
});

let layoutNoticeKind = '';
let layoutHeldSession = '';
let lastSpanConflict = '';
const layoutNotice = document.getElementById('layoutNotice');
const layoutNoticeHolding = document.getElementById('layoutNoticeHolding');
function showLayoutNotice(message, kind = 'held') {
  layoutNoticeKind = kind;
  layoutNotice.hidden = false;
  layoutNotice.querySelector('p').textContent = message;
  layoutNoticeHolding.hidden = kind !== 'held';
}
layoutNotice.addEventListener('keydown', ev => {
  ev.stopPropagation();
  if (ev.key === 'Escape') { ev.preventDefault(); document.getElementById('layoutNoticeDismiss').click(); }
});
layoutNotice.addEventListener('pointerdown', ev => ev.stopPropagation());
document.getElementById('layoutNoticeDismiss').addEventListener('click', () => {
  const restore = layoutNotice.contains(document.activeElement);
  layoutNotice.hidden = true;
  if (restore) (isMobileView() ? document.getElementById('mobileControlsButton') : toggleHoldingButton).focus({ preventScroll: true });
});
layoutNoticeHolding.addEventListener('click', () => {
  // A previous search or session filter must not conceal the session just parked.
  holdingQuery = layoutHeldSession; holdingFilterValue = 'all'; resetHoldingBoardFilter();
  holdingSearch.value = holdingQuery; holdingFilter.value = 'all';
  preferenceStorage.setItem('terminaltown-holding-query', holdingQuery);
  preferenceStorage.setItem('terminaltown-holding-filter', 'all');
  layoutNotice.hidden = true;
  renderHoldingList(); setHoldingOpen(true);
  holdingSearch.focus({ preventScroll: true });
});
function showResizeResult(result) {
  if (!result || !result.displaced) return;
  layoutHeldSession = result.displaced;
  const label = titles[result.displaced] || result.displaced;
  showLayoutNotice('Moved “' + label + '” from panel ' + (result.displacedSlot + 1) + ' to Holding so panel ' + (result.slot + 1) + ' can expand. The session keeps running.');
}
function note(msg) { statusEl.textContent = msg; statusEl.title = msg; document.getElementById('menuStatus').textContent = msg; }
function post(type, body) {
  if (pendingPanelMoves.length && Number.isInteger(body?.slot) && !['focusSlot', 'refresh'].includes(type)) {
    return new Promise(resolve => deferredPanelActions.push({ type, body, session: slotSessions[body.slot], boardId: currentBoardId(), resolve }));
  }
  return vscode.postMessage(Object.assign({ type }, body || {}));
}
let memoryDialogSlot = null;
let memoryReturnFocus = null;
let metaMemoryRecord = null;
function memoryTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : '';
}
function memoryRecord() { return memoryDialogSlot === 'meta' ? metaMemoryRecord : Number.isInteger(memoryDialogSlot) ? slotRecords[memoryDialogSlot] : null; }
function populateMemoryDialog(force = false) {
  const record = memoryRecord();
  if (!record || !record.name) return;
  const memory = record.memory || {};
  const revision = String(Number(memory.revision) || 0);
  const changed = sessionMemoryDialog.dataset.revision !== revision;
  if (force || sessionMemoryDialog.dataset.pending === '1' || (changed && sessionMemoryDialog.dataset.dirty !== '1')) {
    memoryApprovedCharter.value = String(memory.approvedCharter || '');
    memoryContext.value = String(memory.contextSummary || '');
    sessionMemoryDialog.dataset.revision = revision;
    sessionMemoryDialog.dataset.dirty = '';
    sessionMemoryDialog.dataset.pending = '';
  }
  document.getElementById('sessionMemoryTitle').textContent = 'Session memory · ' + (record.display || record.name);
  document.getElementById('memoryCharterMeta').textContent = memoryTimestamp(memory.approvedAt);
  document.getElementById('memoryContextMeta').textContent = memoryTimestamp(memory.contextUpdatedAt);
  const pending = memory.reviewState === 'pending' && Boolean(memory.proposedCharter);
  memoryProposalReview.hidden = !pending;
  document.getElementById('memoryProposalBefore').textContent = String(memory.approvedCharter || '');
  document.getElementById('memoryProposalAfter').textContent = String(memory.proposedCharter || '');
  document.getElementById('memoryProposalReason').textContent = String(memory.proposalReason || '');
}
function openMemoryDialog(slot, trigger) {
  const record = slot === 'meta' ? metaMemoryRecord : slotRecords[slot];
  if (!record || !record.name || !record.memory || !record.memory.approvedCharter) return;
  memoryDialogSlot = slot;
  memoryReturnFocus = trigger.closest('.tile').querySelector('.tools-toggle') || trigger;
  sessionMemoryDialog.dataset.dirty = '';
  sessionMemoryDialog.dataset.pending = '';
  populateMemoryDialog(true);
  sessionMemoryDialog.showModal();
  setTimeout(() => memoryApprovedCharter.focus({ preventScroll: true }), 0);
}
function closeMemoryDialog() { if (sessionMemoryDialog.open) sessionMemoryDialog.close(); }
function submitMemoryMutation(type, value) {
  const record = memoryRecord();
  if (!record || !record.name) return;
  sessionMemoryDialog.dataset.pending = '1';
  const request = post(type, {
    slot: memoryDialogSlot, meta: memoryDialogSlot === 'meta', session: record.name,
    revision: Number(sessionMemoryDialog.dataset.revision) || 0,
    ...(value === undefined ? {} : { value }),
  });
  if (request && typeof request.then === 'function') request.then(result => {
    if (result && result.ok === false) sessionMemoryDialog.dataset.pending = '';
  }).catch(() => { sessionMemoryDialog.dataset.pending = ''; });
}
for (const field of [memoryApprovedCharter, memoryContext]) field.addEventListener('input', () => { sessionMemoryDialog.dataset.dirty = '1'; });
document.getElementById('memoryClose').addEventListener('click', closeMemoryDialog);
document.getElementById('memorySaveCharter').addEventListener('click', () => submitMemoryMutation('memoryUpdateCharter', memoryApprovedCharter.value));
document.getElementById('memorySaveContext').addEventListener('click', () => submitMemoryMutation('memoryUpdateContext', memoryContext.value));
document.getElementById('memoryApprove').addEventListener('click', () => submitMemoryMutation('memoryApproveCharter'));
document.getElementById('memoryReject').addEventListener('click', () => submitMemoryMutation('memoryRejectCharter'));
document.getElementById('metaMemory').addEventListener('click', event => openMemoryDialog('meta', event.currentTarget));
sessionMemoryDialog.addEventListener('cancel', event => { event.preventDefault(); closeMemoryDialog(); });
sessionMemoryDialog.addEventListener('close', () => {
  const target = memoryReturnFocus;
  memoryDialogSlot = null; memoryReturnFocus = null;
  if (target && target.isConnected) setTimeout(() => target.focus({ preventScroll: true }), 0);
});
function flushPanelActions() {
  for (const action of deferredPanelActions.splice(0)) {
    const slot = action.session ? slotSessions.indexOf(action.session) : action.body.slot;
    if (action.boardId !== currentBoardId() || slot < 0) { action.resolve({ ok: false }); continue; }
    Promise.resolve(post(action.type, { ...action.body, slot })).then(action.resolve, () => action.resolve({ ok: false }));
  }
}
let metaFollowOutput = true;
function setMetaOpen(open) { if (!open) { closePanelMenu(); (isMobileView() ? document.getElementById('mobileControlsButton') : toggleMetaButton).focus({ preventScroll: true }); } toggleMetaButton.setAttribute('aria-expanded', String(Boolean(open))); toggleMetaButton.setAttribute('aria-controls', 'metaTerminal'); metaTerminal.classList.toggle('open', Boolean(open)); metaTerminal.setAttribute('aria-hidden', open ? 'false' : 'true'); if (open) { if (isMobileView()) installMobileIosInputScaling(metaTerminal); requestAnimationFrame(() => resizePromptInput(metaGoal)); metaStatus.textContent = 'Starting…'; if (metaTranscript && !metaTranscript.textContent.trim()) metaTranscript.textContent = 'Starting Meta Terminal…'; if (window.terminalTownBrowserHost) post('metaEnsure'); setTimeout(() => (isMobileView() ? closeMetaButton : metaGoal).focus({ preventScroll: true }), 0); } }
function setMetaDock(dock) { const next = dock === 'bottom' ? 'bottom' : 'side'; metaTerminal.classList.toggle('side', next === 'side'); metaTerminal.classList.toggle('bottom', next === 'bottom'); preferenceStorage.setItem('terminaltown-meta-dock', next); metaSideButton.setAttribute('aria-pressed', String(next === 'side')); metaBottomButton.setAttribute('aria-pressed', String(next === 'bottom')); }
function updateMetaTranscript(output, basePath = '') { if (!metaTranscript || !output) return; updateTerminalViewport(metaTranscript, output, 'meta:' + activeRenderedBoardId, metaFollowOutput, 'agent', basePath); }
let pendingMetaDraft = null;
let metaSendError = '';
async function metaSubmitPrompt(submitKey) {
  if (pendingMetaDraft !== null) return;
  const draft = metaGoal.value;
  const prompt = draft.trim();
  if (!prompt) { metaSendKey(submitKey || 'enter'); return; }
  metaSendError = '';
  pendingMetaDraft = draft; metaFollowOutput = true; metaLaunchButton.disabled = true; metaStatus.textContent = 'Sending…';
  const result = await post('metaPrompt', { prompt, submitKey: submitKey || 'enter' });
  if (result && !result.ok) { pendingMetaDraft = null; metaLaunchButton.disabled = false; metaSendError = 'Send failed — draft kept'; metaStatus.textContent = metaSendError; }
}
function launchMetaTerminal() { metaSubmitPrompt('enter'); }
function metaSendKey(key) { metaFollowOutput = true; post('metaKey', { key }); }
async function copyMetaTerminal() { metaStatus.textContent = await writeClipboardText(String(metaTranscript && (metaTranscript._terminaltownRawOutput || metaTranscript.textContent) || '')) ? 'Copied' : 'Copy failed. Select the text and use your browser’s Copy command.'; }
if (metaTranscript) metaTranscript.addEventListener('scroll', () => { metaFollowOutput = metaTranscript.scrollTop + metaTranscript.clientHeight >= metaTranscript.scrollHeight - 2; });
function postBoardAssignment(select, type, body) {
  if (!window.terminalTownBrowserHost) {
    post(type, body);
    return;
  }
  const options = Array.from(select.options).map((option) => ({
    value: option.value,
    text: option.textContent || '',
    title: option.title || '',
    selected: option.selected,
  }));
  select.disabled = true;
  select.classList.add('board-moving');
  select.innerHTML = '';
  const pending = document.createElement('option');
  pending.textContent = 'Moving...';
  pending.selected = true;
  select.appendChild(pending);
  const restore = () => {
    select.disabled = false;
    select.classList.remove('board-moving');
    select.innerHTML = '';
    for (const saved of options) {
      const option = document.createElement('option');
      option.value = saved.value;
      option.textContent = saved.text;
      option.title = saved.title;
      option.selected = saved.selected;
      select.appendChild(option);
    }
  };
  note('Moving ' + String(body.session || '') + '...');
  const request = post(type, body);
  if (request && typeof request.then === 'function') {
    request.then((result) => {
      if (result && result.ok === false) restore();
    }).catch(restore);
  }
}
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
function resizePromptInput(input) {
  const tile = input.closest('.tile');
  if (!tile || !input.getClientRects().length) return;
  const style = getComputedStyle(input);
  const line = parseFloat(style.lineHeight) || 16;
  const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  input.style.setProperty('height', '0px', input.parentElement?.classList.contains('ios-input-wrapper') ? 'important' : '');
  const rows = Math.max(1, Math.ceil((input.scrollHeight - padding - 0.5) / line));
  const limit = Math.max(32, Math.min(32 + 7 * line, tile.clientHeight * 0.5));
  const height = Math.ceil(Math.min(limit, 32 + (rows - 1) * line));
  const iosWrapper = input.parentElement?.classList.contains('ios-input-wrapper') ? input.parentElement : null;
  if (iosWrapper) {
    iosWrapper.style.setProperty('--ios-input-visual-height', (height - 1) + 'px');
    input.style.setProperty('height', (height - 1) + 'px', 'important');
  } else input.style.height = (height - 1) + 'px';
  tile.style.setProperty('--prompt-height', (height + (tile.querySelector('.draft-images') ? 40 : 0)) + 'px');
  scheduleTileGeometryRefresh();
}
function bindPromptInput(input, submit) {
  input.addEventListener('input', () => resizePromptInput(input));
  input.addEventListener('paste', ev => {
    if (ev.defaultPrevented || !input.isConnected || input.disabled || input.readOnly) return;
    const clipboard = ev.clipboardData;
    if (!clipboard || Array.from(clipboard.items || []).some(item => item.type.startsWith('image/'))) return;
    const text = clipboard.getData('text/plain');
    if (!text) return;
    // Snapshot and insert during paste: with dictation, clipboard text can be
    // present here but missing from the browser's later native insertion.
    ev.preventDefault();
    let inserted = false;
    if (document.activeElement === input) {
      try { inserted = document.execCommand('insertText', false, text); } catch {}
    }
    if (!inserted) {
      input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  input.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); submit('enter'); }
    else if (ev.key === 'Tab') { ev.preventDefault(); submit(ev.shiftKey ? 'shift-tab' : 'tab'); }
    else if (!input.value && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
      const terminalKey = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', ' ': 'space' })[ev.key];
      if (terminalKey) { ev.preventDefault(); submit(terminalKey); }
    }
  });
}
function submitPrompt(slot, submitKey) {
  const el = tiles.get(slot);
  const input = el && el.querySelector('.prompt-input');
  const prompt = input ? input.value.trim() : '';
  const draft = imageDrafts.get(imageDraftKey(slot));
  if (draft?.length) { submitImageDraft(slot, submitKey || 'enter', prompt); return; }
  if (!prompt) {
    post('key', { slot, key: submitKey || 'enter' });
    return;
  }
  input.value = '';
  resizePromptInput(input);
  post('prompt', { slot, prompt, submitKey: submitKey || 'enter' });
  burstRefresh();
}
function isClipboardProxy(target) {
  return Boolean(target && target.closest && target.closest('#clipboardProxy'));
}
function editableTarget(target) {
  if (isClipboardProxy(target)) return false;
  return Boolean(target && target.closest && target.closest('input,select,textarea,.rename-editor,[contenteditable]:not([contenteditable="false"])'));
}
function focusClipboardProxy() {
  if (!clipboardProxy || isMobileView() || selectedText()) return;
  const active = document.activeElement;
  if (active && active.closest && active.closest('.toolbar,.head,.board-picker,.panel-menu,.mobile-ui')) return;
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
  return pre ? String(pre._terminaltownRawOutput || pre.textContent || '') : '';
}
let forcedClipboardCopy = null;
function copyTextWithSelection(text) {
  // The Clipboard API is unavailable at plain HTTP LAN/Tailscale addresses.
  // Execute the browser copy command during the user's click activation instead.
  const active = document.activeElement;
  const selection = window.getSelection();
  const ranges = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange());
  const inputSelection = active && typeof active.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
  const proxy = document.createElement('textarea');
  proxy.value = text; proxy.readOnly = true;
  proxy.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;';
  document.body.appendChild(proxy);
  const copy = { text, written: false };
  forcedClipboardCopy = copy;
  try {
    proxy.focus({ preventScroll: true }); proxy.select();
    return document.execCommand('copy') && copy.written;
  } catch { return false; }
  finally {
    forcedClipboardCopy = null; proxy.remove();
    if (active && active.isConnected) active.focus({ preventScroll: true });
    selection.removeAllRanges();
    for (const range of ranges) selection.addRange(range);
    if (inputSelection) active.setSelectionRange(...inputSelection);
  }
}
async function writeClipboardText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  return copyTextWithSelection(text);
}
async function copySlot(slot) {
  const text = selectedText() || slotOutput(slot);
  if (!text) {
    note('Nothing to copy from slot ' + (slot + 1));
    return;
  }
  if (await writeClipboardText(text)) note('Copied slot ' + (slot + 1));
  else if (!window.terminalTownBrowserHost) post('copyText', { slot, text });
  else note('Copy failed. Select the text and use your browser’s Copy command.');
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
const imageDrafts = new Map();
const imageStages = new Map();
const imageSends = new Map();
let imageDraftSerial = 0;
function imageDraftKey(slot) { return currentBoardId() + ':' + (slotSessions[slot] || ''); }
function imageDraftPreview(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 64 / img.width, 56 / img.height);
      canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}
function renderImageDraft(slot) {
  const tile = tiles.get(slot), form = tile?.querySelector('.terminal-composer');
  if (!form) return;
  const key = imageDraftKey(slot), entries = imageDrafts.get(key) || [];
  const busy = [...imageSends.values()].some(send => send.key === key);
  form.querySelector('button[type="submit"]').disabled = busy;
  form.classList.toggle('has-images', Boolean(entries.length));
  let tray = form.querySelector('.draft-images');
  if (!entries.length) { if (tray) { tray.remove(); resizePromptInput(form.querySelector('.prompt-input')); } return; }
  if (!tray) { tray = document.createElement('div'); tray.className = 'draft-images'; tray.setAttribute('role', 'group'); tray.setAttribute('aria-label', 'Draft images'); form.prepend(tray); }
  const signature = JSON.stringify([entries, busy]);
  if (tray.dataset.signature !== signature) {
    tray.replaceChildren(); tray.dataset.signature = signature;
    entries.forEach((entry, index) => {
      const chip = document.createElement('span'); chip.className = 'draft-image'; chip.dataset.ready = String(Boolean(entry.path));
      const img = document.createElement('img'); img.alt = 'Pasted image ' + (index + 1); if (entry.preview) img.src = entry.preview;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.disabled = busy;
      remove.setAttribute('aria-label', 'Remove image ' + (index + 1)); remove.title = 'Remove image ' + (index + 1);
      remove.addEventListener('click', () => {
        imageDrafts.set(key, (imageDrafts.get(key) || []).filter(image => image.id !== entry.id));
        renderAllImageDrafts(); saveBoardDrafts();
        const next = form.querySelectorAll('.draft-image button');
        (next[Math.min(index, next.length - 1)] || form.querySelector('.prompt-input')).focus({ preventScroll: true });
      });
      chip.append(img, remove); tray.append(chip);
    });
  }
  resizePromptInput(form.querySelector('.prompt-input'));
}
function renderAllImageDrafts() { for (const [slot] of tiles) renderImageDraft(slot); }
function finishImageStage(message) {
  const stage = imageStages.get(message.stageId);
  if (!stage) return;
  imageStages.delete(message.stageId);
  if (message.ok) stage.entries.forEach((entry, index) => { entry.path = message.files[index] || ''; });
  else note(message.error || 'Image upload failed. Remove it and paste again.');
  renderAllImageDrafts(); saveBoardDrafts();
}
async function acceptClipboardImageDraft(message) {
  if (!message.images?.length) { note('Clipboard has no usable text or image.'); return; }
  const key = currentBoardId() + ':' + message.session;
  const entries = imageDrafts.get(key) || [];
  if (entries.length + message.images.length > 8) { note('A draft can contain up to 8 images.'); return; }
  const additions = message.images.map(image => ({ id: 'host-' + Date.now() + '-' + (++imageDraftSerial), path: image.path, preview: '' }));
  imageDrafts.set(key, entries.concat(additions));
  const previews = await Promise.all(message.images.map(image => imageDraftPreview(image.dataUrl)));
  additions.forEach((entry, index) => { entry.preview = previews[index]; });
  renderAllImageDrafts(); saveBoardDrafts();
}
async function submitImageDraft(slot, submitKey, prompt) {
  if (!['enter', 'tab'].includes(submitKey)) return;
  const key = imageDraftKey(slot), entries = imageDrafts.get(key) || [];
  if ([...imageSends.values()].some(send => send.key === key)) return;
  if (entries.some(entry => !entry.path)) { note('Wait for image uploads to finish, or remove them.'); return; }
  const draftId = 'send-' + Date.now() + '-' + (++imageDraftSerial);
  const session = slotSessions[slot];
  imageSends.set(draftId, { key, session, prompt, ids: entries.map(entry => entry.id) });
  renderImageDraft(slot);
  const text = [prompt, ...entries.map(entry => JSON.stringify(entry.path))].filter(Boolean).join(String.fromCharCode(10));
  const result = await post('prompt', { slot, session, draftId, prompt: text, submitKey });
  if (result?.ok === false) finishImageSend({ draftId, ok: false, error: 'Send failed; your draft was kept.' });
}
function finishImageSend(message) {
  const send = imageSends.get(message.draftId);
  if (!send) return;
  imageSends.delete(message.draftId);
  if (message.ok) {
    imageDrafts.set(send.key, (imageDrafts.get(send.key) || []).filter(entry => !send.ids.includes(entry.id)));
    for (const [slot, tile] of tiles) if (imageDraftKey(slot) === send.key) {
      const input = tile.querySelector('.prompt-input'); if (input.value.trim() === send.prompt) input.value = '';
      resizePromptInput(input);
    }
    burstRefresh();
  } else note(message.error || 'Send failed; your draft was kept.');
  renderAllImageDrafts(); saveBoardDrafts();
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
  const session = slotSessions[slot];
  if (!session || session === LARSON_DESKTOP_SESSION) { note('Choose a terminal panel before pasting images.'); return false; }
  const key = imageDraftKey(slot);
  const draft = imageDrafts.get(key) || [];
  if (draft.length + images.length > 8) { note('A draft can contain up to 8 images.'); return false; }
  if (images.reduce((sum, image) => sum + String(image.dataUrl || '').length, 0) > 16 * 1024 * 1024) { note('Images are too large to paste together.'); return false; }
  const stageId = 'image-' + Date.now() + '-' + (++imageDraftSerial);
  const entries = images.map((image, index) => ({ id: stageId + '-' + index, preview: '', path: '' }));
  imageDrafts.set(key, draft.concat(entries));
  imageStages.set(stageId, { key, entries });
  renderImageDraft(slot);
  const previews = await Promise.all(images.map(image => imageDraftPreview(image.dataUrl)));
  entries.forEach((entry, index) => { entry.preview = previews[index]; });
  renderAllImageDrafts();
  const result = await post('stageImages', { slot, session, stageId, images });
  if (result?.ok === false) finishImageStage({ stageId, ok: false, error: 'Image upload failed. Remove it and paste again.' });
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
    if (!slotSessions[slot] || slotSessions[slot] === LARSON_DESKTOP_SESSION || el.classList.contains('covered')) continue;
    const pre = el.querySelector('pre');
    if (!pre || (isMobileView() && !mobileTileOnScreen(el))) continue;
    const styles = getComputedStyle(pre);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 16;
    const visibleRows = Math.max(1, Math.ceil((pre.clientHeight || 0) / lineHeight));
    // Ask tmux for enough real scrollback to support panel scrolling without
    // mixing in TerminalTown's own recovery archive.
    hints[slot] = Math.min(1200, Math.max(180, visibleRows + 80));
  }
  return hints;
}
function terminalSizesBySlotHint() {
  const hints = {};
  if (isMobileView() && mobileOverviewOpen) return hints;
  for (const [slot, el] of tiles) {
    if (!slotSessions[slot] || slotSessions[slot] === LARSON_DESKTOP_SESSION || el.classList.contains('covered')) continue;
    const pre = el.querySelector('pre');
    if (!pre || (isMobileView() && !mobileTileOnScreen(el))) continue;
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
let browserRefreshInFlight = null;
let queuedBrowserRefresh = null;
function browserRefreshSignature(payload) {
  return JSON.stringify({
    focusedSlot: payload.focusedSlot,
    captureLinesBySlot: payload.captureLinesBySlot,
    terminalSizesBySlot: payload.terminalSizesBySlot,
  });
}
function sendBrowserRefresh(payload) {
  const signature = browserRefreshSignature(payload);
  if (browserRefreshInFlight) {
    queuedBrowserRefresh = { payload, signature };
    return browserRefreshInFlight;
  }
  const activeSignature = signature;
  browserRefreshInFlight = Promise.resolve(post('refresh', payload)).finally(() => {
    browserRefreshInFlight = null;
    const queued = queuedBrowserRefresh;
    queuedBrowserRefresh = null;
    // Resize observers often report the same settled geometry together. Only
    // collect again when the request that arrived in flight has new geometry.
    if (queued && queued.signature !== activeSignature) sendBrowserRefresh(queued.payload);
  });
  return browserRefreshInFlight;
}
function requestRefresh(options = {}) {
  preferenceStorage.sync();
  if (pendingPanelMoves.length) return;
  if (!options.force && spectacleActive()) {
    pendingRefresh = true;
    return;
  }
  const payload = { focusedSlot: selectedSlot, force: Boolean(options.force), captureLinesBySlot: captureLinesBySlotHint(), terminalSizesBySlot: terminalSizesBySlotHint() };
  if (window.terminalTownBrowserHost) sendBrowserRefresh(payload);
  else post('refresh', payload);
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
function dismissDiscoBall() {
  if (discoBall.dataset.state === 'dismissing' || discoBall.dataset.state === 'dismissed') return;
  const from = getComputedStyle(discoBall).transform;
  discoBall.dataset.state = 'dismissing';
  const animation = discoBall.animate([
    { transform: from },
    { transform: 'translateY(calc(-100% - 60px))' }
  ], { duration: reduceMotion && reduceMotion.matches ? 0 : 380, easing: 'ease-in', fill: 'forwards' });
  discoDismissAnimation = animation;
  animation.onfinish = () => {
    discoBall.dataset.state = 'dismissed';
    if (document.activeElement === discoBall) focusDiscoControl();
    animation.cancel();
    discoDismissAnimation = null;
  };
}
function focusDiscoControl() {
  const target = isMobileView() ? document.getElementById('mobileControlsButton')
    : toolbar.classList.contains('collapsed') ? toggleToolbarButton : document.getElementById('viewMenuButton');
  target.focus({ preventScroll: true });
}
function settleDiscoBall() {
  if (!['dismissing', 'dismissed'].includes(discoBall.dataset.state)) discoBall.dataset.state = 'settled';
  if (document.activeElement === discoSkip) focusDiscoControl();
}
function startDiscoSpectacle() {
  if (!canRunDiscoSpectacle()) return;
  closePanelMenu();
  if (discoDismissAnimation) discoDismissAnimation.cancel();
  discoDismissAnimation = null;
  delete discoBall.dataset.state;
  seedSpectacleHues();
  pendingRefresh = true;
  if (spectacleActive()) {
    delete document.body.dataset.spectacle;
    void document.body.offsetWidth;
  }
  // Restart the drop even after a settled or dismissed ball.
  void discoBall.offsetWidth;
  document.body.dataset.spectacle = 'disco';
  post('spectacle', { name: 'disco', phase: 'start', durationMs: DISCO_SPECTACLE_MS, focusedSlot: selectedSlot });
  clearTimeout(spectacleTimer);
  spectacleTimer = setTimeout(endDiscoSpectacle, DISCO_SPECTACLE_MS);
  if (reduceMotion && reduceMotion.matches) endDiscoSpectacle();
}
function endDiscoSpectacle() {
  if (!spectacleActive()) return;
  settleDiscoBall();
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
function projectPanelLayout(data, layout) {
  const sessions = new Map((data.sessions || []).filter(s => s.name).map(s => [s.name, s]));
  return { ...data, board: { ...data.board, id: layout.boardId, grid: layout.grid, layoutRevision: layout.layoutRevision },
    slots: layout.slots, spans: layout.spans,
    sessions: layout.slots.map((name, slot) => ({ ...(sessions.get(name) || { name, output: '' }), slot, rowSpan: layout.spans?.[name] || 1 })) };
}
function movePanelImmediately(fromSlot, toSlot, draggedSession) {
  if (!lastBoardData || fromSlot === toSlot || !tiles.has(toSlot)) return;
  const session = slotSessions[fromSlot];
  if (!session || (draggedSession && draggedSession !== session)) { note('The source panel changed. Try the move again.'); return; }
  const target = slotSessions[toSlot] || '';
  const slots = slotSessions.slice(); slots[toSlot] = session; slots[fromSlot] = target;
  const spans = { ...(lastBoardData.spans || {}) }; delete spans[session]; if (target) delete spans[target];
  const move = { fromSlot, toSlot, session, expectedTarget: target, moveId: ++panelMoveSequence, boardId: currentBoardId() };
  const hues = panelHueState();
  move.hues = { from: hues[fromSlot] ?? null, to: hues[toSlot] ?? null };
  pendingPanelMoves.push(move);
  board.setAttribute('aria-busy', 'true');
  closePanelMenu();
  const before = new Map([fromSlot, toSlot].map(slot => [slotSessions[slot], tiles.get(slot).getBoundingClientRect()]));
  swapPanelHueHistory(fromSlot, toSlot);
  render(projectPanelLayout(lastBoardData, { boardId: currentBoardId(), grid: lastBoardData.board.grid, slots, spans, layoutRevision: renderedLayoutRevision }), true);
  setSelected(toSlot, { focusProxy: false });
  note('Moving panels…');
  if (motion !== 'still' && !reduceMotion?.matches) for (const slot of [fromSlot, toSlot]) {
    const tile = tiles.get(slot), prior = before.get(slotSessions[slot]);
    if (!prior || !slotSessions[slot]) continue;
    const next = tile.getBoundingClientRect();
    tile.animate([{ transform: 'translate(' + (prior.left - next.left) + 'px,' + (prior.top - next.top) + 'px)' }, { transform: 'none' }], { duration: 140, easing: 'ease-out' });
  }
  if (pendingPanelMoves.length === 1) sendNextPanelMove();
}
function sendNextPanelMove() {
  const move = pendingPanelMoves[0];
  if (!move) return;
  clearTimeout(panelMoveTimer);
  panelMoveTimer = setTimeout(() => finishPanelMove({ moveId: move.moveId, ok: false, error: 'Move confirmation timed out. Refreshing the board.' }), 10000);
  preferenceStorage.flush().then(ready => {
    if (pendingPanelMoves[0] !== move) return { ok: true };
    if (!ready) return { ok: false };
    return post('move', move);
  }).then(result => {
    if (result?.ok === false) finishPanelMove({ moveId: move.moveId, ok: false, error: 'Could not save the move. Refreshing the board.' });
  }).catch(() => finishPanelMove({ moveId: move.moveId, ok: false, error: 'Could not save the move. Refreshing the board.' }));
}
function finishPanelMove(result) {
  if (pendingPanelMoves[0]?.moveId !== result.moveId) return;
  clearTimeout(panelMoveTimer);
  if (result.layout) {
    renderedLayoutRevision = Math.max(renderedLayoutRevision, result.layout.layoutRevision || 0);
    confirmedBoardData = projectPanelLayout(lastBoardData, result.layout);
  }
  if (result.ok && result.hues) {
    const state = savedPanelHueState(), move = pendingPanelMoves[0];
    state[move.fromSlot] = result.hues.from;
    state[move.toSlot] = result.hues.to;
    preferenceStorage.setItem(panelHueKey(), JSON.stringify(state));
  } else if (!result.ok) {
    for (const move of pendingPanelMoves.slice().reverse()) swapPanelHueHistory(move.fromSlot, move.toSlot);
    if (!result.layout) {
      // A lost acknowledgement cannot establish which placement history belongs to.
      const history = hueHistory(); history.undo.length = 0; history.redo.length = 0;
    }
    preferenceStorage.sync();
  }
  pendingPanelMoves.shift();
  if (!result.ok) pendingPanelMoves.length = 0;
  if (pendingPanelMoves.length) sendNextPanelMove();
  else {
    board.setAttribute('aria-busy', 'false');
    if (confirmedBoardData) render(confirmedBoardData);
    flushPanelActions();
    requestRefresh({ force: true });
    if (!result.ok) note(result.error || 'Could not save the move.');
  }
}
document.addEventListener('dragend', () => document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target')));
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
function panelChimeKey() { return 'terminaltown-panel-chimes-' + currentBoardId(); }
const PANEL_CHIME_CADENCES = [
  { mode: 'once', seconds: null, label: '1 chime' },
  { mode: 'repeat', seconds: 60, label: 'Once a minute' },
  { mode: 'repeat', seconds: 30, label: 'Once every 30 seconds' },
  { mode: 'repeat', seconds: 10, label: 'Once every 10 seconds' },
  { mode: 'repeat', seconds: 5, label: 'Once every 5 seconds' },
  { mode: 'repeat', seconds: 1, label: 'Once every 1 second' },
  { mode: 'repeat', seconds: 0.5, label: 'Once every 0.5 seconds' },
];
const PANEL_CHIME_SECONDS = PANEL_CHIME_CADENCES.filter(item => item.mode === 'repeat').map(item => item.seconds);
let chimeCadencePicker = null;
function getChimeCadencePicker() {
  if (chimeCadencePicker) return chimeCadencePicker;
  chimeCadencePicker = document.createElement('div');
  chimeCadencePicker.className = 'chime-cadence-picker';
  chimeCadencePicker.hidden = true;
  chimeCadencePicker.innerHTML = '<output aria-live="polite"></output><input type="range" min="0" max="6" step="1" tabindex="-1" aria-label="Panel chime cadence"><div class="chime-cadence-ticks" aria-hidden="true"><span>●</span><span>●</span><span>●</span><span>●</span><span>●</span><span>●</span><span>●</span></div>';
  document.body.appendChild(chimeCadencePicker);
  return chimeCadencePicker;
}
function panelChimeCadenceIndex(settings) {
  const mode = settings.mode === 'off' ? settings.resume : settings.mode;
  if (mode === 'once') return 0;
  const index = PANEL_CHIME_CADENCES.findIndex(item => item.mode === 'repeat' && item.seconds === settings.seconds);
  return index < 0 ? 4 : index;
}
function showChimeCadencePicker(button, index) {
  const picker = getChimeCadencePicker();
  picker.querySelector('input').value = String(index);
  picker.querySelector('output').textContent = PANEL_CHIME_CADENCES[index].label;
  picker.hidden = false;
  const rect = button.getBoundingClientRect();
  const width = picker.offsetWidth;
  picker.style.left = Math.max(6, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - 6)) + 'px';
  picker.style.top = Math.min(rect.bottom + 5, innerHeight - picker.offsetHeight - 6) + 'px';
}
function updateChimeCadencePicker(index) {
  const picker = getChimeCadencePicker();
  picker.querySelector('input').value = String(index);
  picker.querySelector('output').textContent = PANEL_CHIME_CADENCES[index].label;
}
function hideChimeCadencePicker() { if (chimeCadencePicker) chimeCadencePicker.hidden = true; }
function nearestPanelChimeSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 5;
  return PANEL_CHIME_SECONDS.reduce((nearest, candidate) => Math.abs(candidate - seconds) < Math.abs(nearest - seconds) ? candidate : nearest, 5);
}
function panelChimeSettings(slot) {
  const saved = storedBoardValue(panelChimeKey(), {})?.[slot];
  const mode = ['off', 'once', 'repeat'].includes(saved?.mode) ? saved.mode : 'once';
  return {
    mode,
    seconds: nearestPanelChimeSeconds(saved?.seconds),
    resume: ['once', 'repeat'].includes(saved?.resume) ? saved.resume : (mode === 'repeat' ? 'repeat' : 'once'),
  };
}
function panelChimeLabel(settings) {
  return PANEL_CHIME_CADENCES[panelChimeCadenceIndex(settings)].label.toLowerCase();
}
function updatePanelChimeControls(el, slot) {
  const settings = panelChimeSettings(slot);
  el.querySelector('.chime-mode').value = settings.mode;
  el.querySelector('.chime-interval').hidden = settings.mode !== 'repeat';
  for (const input of el.querySelectorAll('.chime-frequency')) {
    if (document.activeElement !== input) input.value = String(settings.seconds);
  }
  const header = el.querySelector('.header-chime');
  const enabled = settings.mode !== 'off';
  const action = enabled ? 'Mute' : 'Enable';
  header.setAttribute('aria-pressed', String(enabled));
  header.title = action + ' panel chime — ' + panelChimeLabel(settings);
  header.setAttribute('aria-label', header.title);
}
function bindPanelChimeControls(el, slot) {
  el.addEventListener('panelslotchange', () => { slot = Number(el.dataset.slot); });
  const group = document.createElement('div');
  group.className = 'panel-chime';
  group.innerHTML = '<label>Chime notification<select class="chime-mode" aria-label="Panel chime notification"><option value="off">No chime</option><option value="once">Chime once</option><option value="repeat">Chime repeatedly</option></select></label><div class="chime-interval" hidden><label>Repeat cadence<select class="chime-frequency" aria-label="Chime repeat cadence"><option value="60">Once a minute</option><option value="30">Once every 30 seconds</option><option value="10">Once every 10 seconds</option><option value="5">Once every 5 seconds</option><option value="1">Once every 1 second</option><option value="0.5">Once every 0.5 seconds</option></select></label></div>';
  el.querySelector('.panel-font').after(group);
  const mode = group.querySelector('.chime-mode');
  const frequency = group.querySelector('.chime-frequency');
  function save(changes) {
    const saved = storedBoardValue(panelChimeKey(), {});
    const current = panelChimeSettings(slot);
    const next = { ...current, ...changes };
    if (changes.mode === 'off') next.resume = current.mode === 'off' ? current.resume : current.mode;
    else if (['once', 'repeat'].includes(changes.mode)) next.resume = changes.mode;
    preferenceStorage.setItem(panelChimeKey(), JSON.stringify({ ...saved, [slot]: next }));
    reconcilePanelChime(slot);
    updatePanelChimeControls(el, slot);
    positionPanelMenu();
  }
  const header = el.querySelector('.header-chime');
  let holdTimer = null;
  let hold = null;
  let suppressClick = false;
  header.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    header.focus({ preventScroll: true });
    clearTimeout(holdTimer);
    suppressClick = false;
    const startIndex = panelChimeCadenceIndex(panelChimeSettings(slot));
    hold = { pointerId: ev.pointerId, startX: ev.clientX, startIndex, index: startIndex, active: false };
    try { header.setPointerCapture(ev.pointerId); } catch {}
    holdTimer = setTimeout(() => {
      if (!hold || hold.pointerId !== ev.pointerId) return;
      hold.active = true;
      suppressClick = true;
      showChimeCadencePicker(header, hold.index);
    }, 350);
  });
  header.addEventListener('pointermove', ev => {
    if (!hold?.active || hold.pointerId !== ev.pointerId) return;
    hold.index = Math.max(0, Math.min(PANEL_CHIME_CADENCES.length - 1, hold.startIndex + Math.round((ev.clientX - hold.startX) / 32)));
    updateChimeCadencePicker(hold.index);
  });
  function finishHold(ev, commit) {
    if (!hold || hold.pointerId !== ev.pointerId) return;
    clearTimeout(holdTimer);
    const completed = hold;
    hold = null;
    try { header.releasePointerCapture(ev.pointerId); } catch {}
    if (!completed.active) return;
    hideChimeCadencePicker();
    if (!commit) return;
    const cadence = PANEL_CHIME_CADENCES[completed.index];
    save({ mode: cadence.mode, ...(cadence.seconds === null ? {} : { seconds: cadence.seconds }) });
  }
  window.addEventListener('pointerup', ev => finishHold(ev, true));
  window.addEventListener('pointercancel', ev => finishHold(ev, false));
  header.addEventListener('click', ev => {
    if (suppressClick) { suppressClick = false; ev.preventDefault(); ev.stopPropagation(); return; }
    const settings = panelChimeSettings(slot);
    save({ mode: settings.mode === 'off' ? settings.resume : 'off' });
  });
  mode.addEventListener('change', () => save({ mode: mode.value }));
  frequency.addEventListener('change', () => save({ seconds: Number(frequency.value) }));
  const prompt = el.querySelector('.prompt-input');
  prompt.addEventListener('pointerdown', () => clearPanelChime(slot));
  prompt.addEventListener('focus', () => clearPanelChime(slot));
  updatePanelChimeControls(el, slot);
}
function updateSoundButton() {
  const enabled = sound && !chimesMuted;
  soundButton.textContent = 'Completion sound';
  soundButton.setAttribute('aria-pressed', String(enabled));
  soundButton.title = enabled ? 'Completion sounds enabled' : 'Chimes disabled';
  muteChimesButton.setAttribute('aria-pressed', String(!enabled));
  muteChimesButton.title = enabled ? 'Mute all chimes' : 'Unmute chimes';
  muteChimesButton.setAttribute('aria-label', muteChimesButton.title);
}
async function unlockAudio() {
  if (!sound || chimesMuted) return;
  let context;
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    context = audioCtx || (audioCtx = new AudioCtor());
    if (context.state === 'suspended') await context.resume();
    if (context === audioCtx && sound && !chimesMuted) audioReady = context.state === 'running';
  } catch { if (context === audioCtx) audioReady = false; }
}
function clearChimePulse(slot) {
  const pulse = chimePulses.get(slot);
  if (!pulse) return;
  clearTimeout(pulse.timer);
  pulse.animation?.cancel();
  pulse.edge.remove();
  chimePulses.delete(slot);
}
function pulseChimePanel(slot) {
  clearChimePulse(slot);
  const tile = tiles.get(slot);
  if (!tile || !slotSessions[slot]) return;
  const settings = panelChimeSettings(slot);
  const duration = settings.mode === 'repeat' ? Math.min(900, settings.seconds * 850) : 900;
  const edge = document.createElement('span');
  edge.className = 'chime-glow';
  edge.setAttribute('aria-hidden', 'true');
  tile.append(edge);
  const pulse = { edge };
  // One animation per actual playback, never an independent repeating clock.
  // Fast repeat settings use a lower peak to keep the perimeter gentle.
  if (motion !== 'still' && !reduceMotion?.matches) {
    pulse.animation = edge.animate([
      { opacity: 0 }, { opacity: duration < 400 ? .3 : .65, offset: .22 }, { opacity: 0 },
    ], { duration, easing: 'ease-in-out', fill: 'forwards' });
  }
  pulse.timer = setTimeout(() => { if (chimePulses.get(slot) === pulse) clearChimePulse(slot); }, duration);
  chimePulses.set(slot, pulse);
}
function stopChimeAudio(slot) {
  clearChimePulse(slot);
  chimePlaybackTokens.delete(slot);
  if (mediaChimeSlot === slot) {
    mediaChimeSlot = null;
    try { purrSound.pause(); purrSound.currentTime = 0; } catch {}
  }
  for (const voice of chimeVoices) if (voice.slot === slot) voice.stop();
}
function clearPanelChime(slot) {
  const pending = pendingChimes.get(slot);
  if (pending) clearTimeout(pending.timer);
  pendingChimes.delete(slot);
  stopChimeAudio(slot);
}
function stopAllChimes() {
  for (const slot of new Set([...pendingChimes.keys(), ...chimePlaybackTokens.keys(), ...chimePulses.keys()])) clearPanelChime(slot);
  // Silence the output sinks as well as timers, including any untracked playback.
  if (purrSound) { purrSound.muted = true; try { purrSound.pause(); purrSound.currentTime = 0; } catch {} }
  for (const voice of chimeVoices) voice.stop();
  const context = audioCtx;
  audioCtx = null; audioReady = false;
  if (context) { try { context.close().catch(() => {}); } catch {} }
}
function setChimeSound(enabled) {
  sound = enabled; chimesMuted = !enabled;
  if (!enabled) stopAllChimes();
  updateSoundButton();
  // Muting must take effect even when storage is unavailable.
  try {
    preferenceStorage.setItem('terminaltown-chimes-muted', chimesMuted ? '1' : '0');
    preferenceStorage.setItem('terminaltown-sound', enabled ? '1' : '0');
  } catch {}
  if (enabled) unlockAudio();
}
function playChime(slot) {
  if (!sound || chimesMuted) return;
  const token = {};
  chimePlaybackTokens.set(slot, token);
  const stillAllowed = () => sound && !chimesMuted && chimePlaybackTokens.get(slot) === token;
  if (purrSound && purrSound.src) {
    try {
      // The shared media element has only one owner, so rapid reminders cannot pile up.
      if (mediaChimeSlot !== null) chimePlaybackTokens.delete(mediaChimeSlot);
      chimePlaybackTokens.set(slot, token);
      mediaChimeSlot = slot;
      purrSound.pause(); purrSound.currentTime = 0;
      purrSound.muted = false; purrSound.volume = 0.55;
      const played = purrSound.play();
      if (played && played.then) played.then(() => {
        if (stillAllowed()) pulseChimePanel(slot);
      }).catch(() => { if (stillAllowed()) playSynthChime(slot); });
      else if (stillAllowed()) pulseChimePanel(slot);
      return;
    } catch {}
  }
  if (stillAllowed()) playSynthChime(slot);
}
function playSynthChime(slot) {
  if (!sound || chimesMuted || !audioReady || !audioCtx) return;
  pulseChimePanel(slot);
  const start = audioCtx.currentTime;
  const gain = audioCtx.createGain();
  const oscillators = [];
  let cleanup;
  const voice = { slot, stop() {
    clearTimeout(cleanup);
    for (const osc of oscillators) { try { osc.stop(); osc.disconnect(); } catch {} }
    gain.disconnect(); chimeVoices.delete(voice);
  } };
  chimeVoices.add(voice);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.045, start + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
  gain.connect(audioCtx.destination);
  for (const [freq, delay, level] of [[880, 0, 1], [1320, 0.035, 0.42]]) {
    const osc = audioCtx.createOscillator();
    const trim = audioCtx.createGain();
    oscillators.push(osc);
    osc.type = 'sine'; osc.frequency.setValueAtTime(freq, start + delay);
    trim.gain.setValueAtTime(level, start + delay);
    osc.connect(trim); trim.connect(gain);
    osc.start(start + delay); osc.stop(start + 0.44);
  }
  cleanup = setTimeout(() => voice.stop(), 520);
}
function schedulePanelChime(slot, pending) {
  clearTimeout(pending.timer);
  pending.seconds = panelChimeSettings(slot).seconds;
  pending.timer = setTimeout(() => {
    if (pendingChimes.get(slot) !== pending) return;
    const previous = last.get(slot);
    if (!sound || chimesMuted || pending.board !== currentBoardId() || slotSessions[slot] !== pending.session
        || !previous?.waiting || previous.noticeKey !== pending.noticeKey || panelChimeSettings(slot).mode !== 'repeat') {
      clearPanelChime(slot); return;
    }
    playChime(slot);
    schedulePanelChime(slot, pending);
  }, pending.seconds * 1000);
}
function reconcilePanelChime(slot) {
  const settings = panelChimeSettings(slot);
  if (settings.mode !== 'repeat') { clearPanelChime(slot); return; }
  const pending = pendingChimes.get(slot);
  if (pending && pending.seconds !== settings.seconds) schedulePanelChime(slot, pending);
}
function maybeChime(slot, session, noticeKey, state, prev, snapshot = {}) {
  if (prev?.name !== session || state !== 'waiting') clearPanelChime(slot);
  const pending = pendingChimes.get(slot);
  if (pending && (pending.session !== session || state !== 'waiting' || pending.noticeKey !== noticeKey)) clearPanelChime(slot);
  if (!session) return;
  const identity = currentBoardId() + ':' + session;
  let observed = chimeObservations.get(identity);
  const signalId = snapshot.signalId || '';
  const available = snapshot.signalAvailable !== false && state !== 'missing' && snapshot.command !== 'recovery-mode';
  const baseline = !observed || observed.signalId !== signalId || !observed.available || !prev || prev.name !== session;
  if (!observed || observed.signalId !== signalId) {
    observed = { signalId, seen: new Set(), at: 0, available: false };
    chimeObservations.set(identity, observed);
  }
  observed.available = available;
  if (!available) { clearPanelChime(slot); return; }
  const noticeAt = Number(snapshot.noticeAt) || 0;
  const duplicate = observed.seen.has(noticeKey) || (noticeAt > 0 && noticeAt < observed.at);
  if (noticeKey) observed.seen.add(noticeKey);
  observed.at = Math.max(observed.at, noticeAt, Number(snapshot.signalObservedAt) || 0);
  if (!renderSeen || baseline || duplicate || state !== 'waiting' || !noticeKey) return;
  const settings = panelChimeSettings(slot);
  if (!sound || chimesMuted || settings.mode === 'off') return;
  playChime(slot);
  if (settings.mode === 'repeat') {
    const pending = { session, noticeKey, board: currentBoardId() };
    pendingChimes.set(slot, pending);
    schedulePanelChime(slot, pending);
  }
}
window.addEventListener('pagehide', stopAllChimes);
window.addEventListener('storage', ev => {
  if (ev.key !== 'terminaltown-chimes-muted') return;
  chimesMuted = ev.newValue === '1';
  if (chimesMuted) stopAllChimes();
  updateSoundButton();
});
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
// A capture is a sliding window, not an append-only transcript. Keep the
// displayed snapshot intact while someone reads history; retaining scrollTop
// alone moves the text underneath them when tmux drops or prepends old lines.
function hasTerminalSelection(pre) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  for (let i = 0; i < selection.rangeCount; i += 1) {
    if (selection.getRangeAt(i).intersectsNode(pre)) return true;
  }
  return false;
}
document.addEventListener('selectionchange', () => {
  for (const pre of document.querySelectorAll('.terminal-output')) {
    const pending = pre._terminaltownPendingOutput;
    if (pending && !hasTerminalSelection(pre) && pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 2) {
      updateTerminalViewport(pre, pending.text, pending.sessionKey, false, pending.displayMode, pending.basePath);
    }
  }
});
function updateTerminalViewport(pre, text, sessionKey, forceFollow = false, displayMode = '', basePath = '') {
  if (!pre._terminaltownScrollListener) {
    pre._terminaltownScrollListener = true;
    pre.addEventListener('wheel', () => { pre._terminaltownHealthReading = true; }, { passive: true });
    pre.addEventListener('touchmove', () => { pre._terminaltownHealthReading = true; }, { passive: true });
    pre.addEventListener('scroll', () => {
      if (pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 2) pre._terminaltownHealthReading = false;
      else if (pre._terminaltownRawOutput && pre.textContent) pre._terminaltownHealthReading = true;
      const pending = pre._terminaltownPendingOutput;
      if (pending && !hasTerminalSelection(pre) && pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 2) {
        updateTerminalViewport(pre, pending.text, pending.sessionKey, true, pending.displayMode, pending.basePath);
      }
    });
  }
  const sameSession = pre._terminaltownSessionKey === sessionKey;
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 2;
  if (sameSession && displayMode === 'agent' && !String(text || '').trim() && String(pre._terminaltownRawOutput || '').trim()) return;
  if (sameSession && (hasTerminalSelection(pre) || (!forceFollow && !atBottom))) {
    pre._terminaltownPendingOutput = { text, sessionKey, displayMode, basePath };
    return;
  }
  if (!sameSession) pre._terminaltownHealthReading = false;
  pre._terminaltownSessionKey = sessionKey;
  pre._terminaltownPendingOutput = null;
  if (sameSession && !forceFollow && pre._terminaltownRawOutput === String(text || '') && pre._terminaltownDisplayMode === displayMode && pre._terminaltownBasePath === basePath) return;
  renderTerminalOutput(pre, text, displayMode, basePath);
  pre.scrollTop = pre.scrollHeight;
}
function stripPastedPromptGutters(value) {
  const lines = String(value || '').split('\\n');
  const formatted = [];
  const gutterLine = /^\\s{2,}>\\s?(.*)$/;
  for (let index = 0; index < lines.length;) {
    const start = index;
    if (!lines[index].match(gutterLine)) { formatted.push(lines[index]); index += 1; continue; }
    const block = [];
    while (index < lines.length) {
      const line = lines[index].match(gutterLine);
      if (!line) break;
      block.push(line[1]); index += 1;
    }
    formatted.push(...block);
  }
  return formatted.join('\\n');
}
function terminalFileHref(rawPath, basePath) {
  const ref = TerminalTownArtifactReferences.parseReference(rawPath,basePath);
  if (!ref) return '';
  return window.terminalTownBrowserHost ? TerminalTownArtifactReferences.hrefFor(ref) : 'file://' + ref.path.split('/').map(encodeURIComponent).join('/') + (ref.fragment ? '#' + ref.fragment : '');
}
function renderTerminalOutput(pre, text, displayMode = '', basePath = '') {
  const rawValue = String(text || '');
  if (pre._terminaltownRawOutput === rawValue && pre._terminaltownDisplayMode === displayMode && pre._terminaltownBasePath === basePath) return;
  pre._terminaltownRawOutput = rawValue;
  pre._terminaltownDisplayMode = displayMode;
  pre._terminaltownBasePath = basePath;
  // capture-pane -J has already joined tmux's soft-wrapped terminal lines.
  // Reflowing again here made a newly captured response change its displayed height.
  const value = displayMode === 'agent' ? stripPastedPromptGutters(rawValue) : rawValue;
  pre.textContent = '';
  const fragment = document.createDocumentFragment();
  const httpRe = /https?:\\/\\/[^\\s<>"']+/g;

  // Agent TUIs hard-wrap parenthesized/angle-bracket URLs, including padding.
  // Require an enclosing delimiter and URL-only continuation lines so ordinary
  // prose below a bare URL cannot silently become part of its destination.
  const wrappedHttpRe = /([(<])(https?:\\/\\/[^\\s<>"'()]*(?:[ \\t]*\\r?\\n[ \\t]{2,}[^\\s<>"'()]+)+)([)>])/g;
  const matches = [];
  let match;
  while ((match = wrappedHttpRe.exec(value))) {
    if ((match[1] === '(' && match[3] !== ')') || (match[1] === '<' && match[3] !== '>')) continue;
    const raw = match[2];
    matches.push({ index: match.index + 1, end: match.index + 1 + raw.length,
      raw, href: raw.replace(/[ \\t]*\\r?\\n[ \\t]+/g, ''), kind: 'http' });
  }
  // Bare TUI screenshot/report links have no enclosing delimiter. Recover a
  // concrete resource across indented hard wraps, stopping at its filename;
  // never append prose to an already complete link or consume a following URL.
  const completeResource = href => {
    try { return /\\.(?:png|jpe?g|gif|webp|svg|avif|pdf|html?|md|txt|json|csv|log|zip|docx?|xlsx?|pptx?)(?:$)/i.test(new URL(href).pathname); }
    catch { return false; }
  };
  const bareWrappedHttpRe = /https?:\\/\\/[^\\s<>"'()]*(?:[ \\t]*\\r?\\n[ \\t]{2,}[^\\s<>"'()]+)+/g;
  while ((match = bareWrappedHttpRe.exec(value))) {
    const parts = match[0].split(/([ \\t]*\\r?\\n[ \\t]{2,})/);
    let raw = parts[0], href = raw;
    if (completeResource(href.replace(/[),.;:!?\\]]+$/, '')) && !/[?&=#%]$/.test(href)) continue;
    for (let index = 2; index < parts.length; index += 2) {
      if (/^https?:\\/\\//.test(parts[index])) break;
      raw += parts[index - 1] + parts[index]; href += parts[index];
      const suffix = (href.match(/[),.;:!?\\]]+$/) || [''])[0];
      const destination = suffix ? href.slice(0, -suffix.length) : href;
      if (!completeResource(destination)) continue;
      const text = suffix ? raw.slice(0, -suffix.length) : raw;
      matches.push({ index: match.index, end: match.index + text.length, raw: text, href: destination, kind: 'http' });
      break;
    }
  }
  while ((match = httpRe.exec(value))) matches.push({ index: match.index, end: match.index + match[0].length, raw: match[0], kind: 'http' });
  matches.push(...TerminalTownArtifactReferences.findReferences(value,basePath));
  if (window.terminalTownBrowserHost) {
    for (const item of matches) {
      if (item.kind !== 'http') continue;
      try {
        const url = new URL(item.href || item.raw.replace(/[),.;:!?\\]]+$/, ''),location.href);
        if (url.pathname !== '/api/terminal-file' || url.hostname !== location.hostname) continue;
        const ref = TerminalTownArtifactReferences.referenceFromFileUrl(url.href);
        if (ref) { item.reference=ref;item.kind='file'; }

      } catch {}
    }
  }
  matches.sort((left, right) => left.index - right.index || right.end - left.end);
  let lastIndex = 0;
  for (const item of matches) {
    if (item.index < lastIndex) continue;
    if (item.index > lastIndex) fragment.appendChild(document.createTextNode(value.slice(lastIndex, item.index)));
    const raw = item.raw;
    const trailing = item.kind === 'http' && !item.href ? raw.match(/[),.;:!?\\]]+$/) : null;
    const suffix = trailing ? trailing[0] : '';
    const href = item.href || (suffix ? raw.slice(0, -suffix.length) : raw);
    const gated = item.kind === 'file' && window.terminalTownBrowserHost;
    const link = document.createElement(gated ? 'span' : 'a');
    if (!gated) link.href = item.kind === 'file' ? terminalFileHref(item.raw,basePath) : href;
    link.textContent = suffix ? raw.slice(0, -suffix.length) : raw;
    link.title = 'Open ' + (item.kind === 'file' ? raw.replace(/[ \\t]*\\r?\\n\\s+/g, '') : href);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    fragment.appendChild(link);
    if (gated) terminalArtifactLinks.bind(link,item.reference);
    if (suffix) fragment.appendChild(document.createTextNode(suffix));
    lastIndex = item.end;
  }
  if (lastIndex < value.length) fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
  pre.appendChild(fragment);
}
function currentColumns() {
  if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) return 1;
  // Old tile positions can create implicit tracks while changing grid shape.
  // Count the configured columns, not those temporary extra tracks.
  const columns = Number(getComputedStyle(board).getPropertyValue('--board-columns'));
  return Number.isInteger(columns) && columns >= 1 && columns <= 6 ? columns : 3;
}

function coveredSlots(columns) {
  const covered = new Set();
  // In a one-column layout "the slot below" is the next session, not an
  // empty grid cell; spanning would hide that session entirely.
  if (columns <= 1) return covered;
  for (let slot = 0; slot < slotCount; slot += 1) {
    if (!slotSessions[slot] || slotSpans[slot] !== 2) continue;
    const below = slot + columns;
    if (below < slotCount && !covered.has(slot) && !slotSessions[below]) covered.add(below);
  }
  return covered;
}
function placeTiles() {
  if (isMobileView()) { placeMobileTiles(); return; }
  const columns = currentColumns();
  const covered = coveredSlots(columns);
  for (const [slot, el] of tiles) {
    const span = columns > 1 && !covered.has(slot) && slotSessions[slot] && slotSpans[slot] === 2 && covered.has(slot + columns) ? 2 : 1;
    el.style.gridColumn = String((slot % columns) + 1);
    el.style.gridRow = String(Math.floor(slot / columns) + 1) + ' / span ' + span;
    el.classList.toggle('covered', covered.has(slot));
    el.classList.toggle('row-span-2', span === 2);
  }
  const conflict = [...tiles.keys()].find(slot => slotSpans[slot] === 2 && slotSessions[slot] && columns > 1 && slotSessions[slot + columns]);
  const signature = conflict === undefined ? '' : [currentBoardId(), columns, conflict, slotSessions[conflict], slotSessions[conflict + columns]].join(':');
  if (signature && signature !== lastSpanConflict && (layoutNotice.hidden || layoutNoticeKind === 'conflict')) {
    const below = conflict + columns;
    showLayoutNotice('Panel ' + (conflict + 1) + ' stays single-height because panel ' + (below + 1) + ' contains “' + (titles[slotSessions[below]] || slotSessions[below]) + '”. Expand it again to move that session to Holding.', 'conflict');
  }
  if (!signature && layoutNoticeKind === 'conflict') layoutNotice.hidden = true;
  lastSpanConflict = signature;
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
${fs.readFileSync(path.join(__dirname, 'larsonDesktop.js'), 'utf8')}
${fs.readFileSync(path.join(__dirname, 'codexQuestionsClient.js'), 'utf8')}
function makeOptions(select, selected) {
  const names = ['', LARSON_DESKTOP_SESSION].concat(selected && selected !== LARSON_DESKTOP_SESSION && !allSessions.includes(selected) ? [selected] : [], allSessions);
  const sig = names.join('\\u0000') + '\\u0001' + selected + '\\u0001' + JSON.stringify(titles);
  if (select.dataset.sig === sig) return;
  select.innerHTML = '';
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name === LARSON_DESKTOP_SESSION ? 'Larson Desktop' : name ? ((titles[name] || name) + (allSessions.includes(name) ? '' : ' (missing)')) : 'Assign';
    option.selected = name === selected;
    option.title = name === LARSON_DESKTOP_SESSION ? 'Larson Desktop' : name;
    select.appendChild(option);
  }
  select.dataset.sig = sig;
}
function makeBoardOptions(select, selected) {
  const boards = [{ id: '', title: 'Unassigned' }].concat(holdingBoards || []);
  const sig = boards.map((item) => item.id + '\\u0000' + item.title).join('\\u0001') + '\\u0002' + selected;
  if (select.dataset.boardSig === sig) return;
  select.innerHTML = '';
  for (const boardInfo of boards) {
    const option = document.createElement('option');
    option.value = boardInfo.id;
    option.textContent = boardInfo.title || boardInfo.id || 'Unassigned';
    option.title = boardInfo.id || 'Unassigned';
    option.selected = boardInfo.id === selected;
    select.appendChild(option);
  }
  select.dataset.boardSig = sig;
}
function createTile(slot) {
  const el = document.createElement('section');
  el.addEventListener('panelslotchange', () => { slot = Number(el.dataset.slot); });
  el.className = 'tile';
  if (isMobileView() && mobileAll) el.classList.add('mobile-visible');
  el.dataset.slot = String(slot);
  el.innerHTML = '<div class="resize-edge resize-top" title="Drag up to span upward; drag down to shrink"></div><div class="resize-edge resize-bottom" title="Drag down to span downward; drag up to shrink"></div><div class="head" draggable="true"><div class="head-main"><input type="checkbox" class="font-select"><span class="idx"></span><span class="name"></span><button type="button" class="memory-badge" title="Open saved session memory">Memory saved</button><span class="meta"></span></div><div class="head-actions"><button type="button" class="esc" title="Send Escape" aria-label="Send Escape">Esc</button><button type="button" class="paste icon-button" data-icon="paste" title="Paste clipboard text or image path" aria-label="Paste into terminal"></button><button type="button" class="tools-toggle icon-button" data-icon="more" title="Panel controls" aria-label="Panel controls" aria-haspopup="dialog" aria-expanded="false"><span class="tools-label">Assign</span></button></div><section class="command-popover panel-menu" popover="manual" role="dialog" aria-label="Panel controls" hidden><h2 class="panel-menu-title">Panel controls</h2><h2>Terminal keys</h2><div class="key-grid terminal-key-grid"><button type="button" class="up" title="Send Up arrow" aria-label="Send Up arrow">↑</button><button type="button" class="down" title="Send Down arrow" aria-label="Send Down arrow">↓</button><button type="button" class="left" title="Send Left arrow" aria-label="Send Left arrow">←</button><button type="button" class="right" title="Send Right arrow" aria-label="Send Right arrow">→</button><button type="button" class="space" title="Send Space">Space</button><button type="button" class="enter" title="Send Enter without submitting the draft">Enter ↵</button><button type="button" class="tab" title="Send draft with Tab, or send Tab">Tab ⇥</button><button type="button" class="shiftTab" title="Send Shift+Tab">Shift+Tab ⇤</button><button type="button" class="answerQuestion" title="Open queued Codex question · Shift+Left Arrow" aria-label="Open queued Codex question (Shift+Left Arrow)">Answer ⇧←</button><button type="button" class="ctrlc" title="Interrupt the running command">Interrupt · Ctrl+C</button></div><hr><div class="panel-font"><h2>Text size (px)</h2><div class="font-controls"><button type="button" class="font-decrease" aria-label="Decrease panel text size">−</button><input type="number" class="font-size" min="8" max="40" step="1" aria-label="Panel text size in pixels"><button type="button" class="font-increase" aria-label="Increase panel text size">+</button></div></div><button type="button" class="copy">Copy selected text / output</button><button type="button" class="openTerm">Open in Mac Terminal ↗</button><hr><h2>Session</h2><label class="assign-field">Assign<select class="assign-session" aria-label="Assign session" title="Assign session"></select></label><label>Board<select class="move-board" title="Change board assignment" aria-label="Change board assignment"></select></label><button type="button" class="memory">Session memory…</button><button type="button" class="rename">Rename label…</button><button type="button" class="hold">Move to Holding</button><hr><button type="button" class="bye danger-command" title="Permanently end this tmux session after confirmation">End session…</button></section></div><pre class="terminal-output"></pre><section class="codex-question" role="region" aria-label="Codex question" aria-live="polite" hidden><form class="codex-question-form"></form></section><form class="terminal-composer"><textarea class="prompt-input" rows="1" autocomplete="off" placeholder="Prompt" aria-description="Enter to send; Shift+Enter for a new line"></textarea><button type="submit">Send</button></form>';
  el.querySelector('.ctrlc').textContent = 'Ctrl+C';
  el.querySelector('.ctrlc').setAttribute('aria-label', 'Interrupt with Ctrl+C');
  el.querySelector('.shiftTab').textContent = '⇧Tab';
  el.querySelector('.shiftTab').setAttribute('aria-label', 'Send Shift+Tab');
  const headerChime = document.createElement('button');
  headerChime.type = 'button';
  headerChime.className = 'header-chime icon-button';
  headerChime.dataset.icon = 'chime';
  headerChime.setAttribute('aria-pressed', 'true');
  el.querySelector('.esc').after(headerChime);
  setupCodexQuestion(el, slot);
  setupLarsonDesktop(el);
  fillControlIcons(el);
  bindPanelFontControls(el, slot);
  bindPanelChimeControls(el, slot);
  bindPanelHueControls(el, slot);
  el.querySelector('.panel-menu').id = 'panel-menu-' + slot;
  el.querySelector('.tools-toggle').setAttribute('aria-controls', 'panel-menu-' + slot);
  el.querySelector('.prompt-input').setAttribute('aria-label', 'Panel ' + (slot + 1) + ' prompt');
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
    setSelected(slot, { focusProxy: !ev.target.closest('pre,a,button,input,textarea,select,.panel-menu') });
  });
  el.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', ev => { if (!el.contains(ev.relatedTarget)) el.classList.remove('drop-target'); });
  el.addEventListener('drop', (ev) => {
    ev.preventDefault();
    el.classList.remove('drop-target');
    const payload = dragPayload(ev);
    if (Number.isInteger(payload.fromSlot)) movePanelImmediately(payload.fromSlot, slot, payload.session);
    else if (payload.session) post('move', { session: payload.session, toSlot: slot });
  });
  el.querySelector('.head').addEventListener('dragstart', (ev) => {
    const session = slotSessions[slot] || '';
    if (!session || ev.target.closest('button, input, select, .panel-menu')) {
      ev.preventDefault();
      return;
    }
    closePanelMenu();
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
  el.querySelector('.assign-session').addEventListener('change', (ev) => post('assign', { slot, session: ev.target.value }));
  el.querySelector('.move-board').addEventListener('change', (ev) => {
    const session = slotSessions[slot] || '';
    if (!session) return;
    postBoardAssignment(ev.target, 'moveToBoard', { session, destinationBoardId: ev.target.value });
  });
  el.querySelector('.openTerm').addEventListener('click', () => post('openTerminal', { slot }));
  el.querySelector('.memory').addEventListener('click', (event) => openMemoryDialog(slot, event.currentTarget));
  el.querySelector('.memory-badge').addEventListener('click', (event) => openMemoryDialog(slot, event.currentTarget));
  el.querySelector('.rename').addEventListener('click', () => startRenameEditor(slot));
  el.querySelector('.hold').addEventListener('click', () => post('assign', { slot, session: '' }));
  el.querySelector('.bye').addEventListener('click', () => browserConfirmBye(slot));
  el.querySelector('.shiftTab').addEventListener('click', () => post('key', { slot, key: 'shift-tab' }));
  el.querySelector('.answerQuestion').addEventListener('click', () => post('key', { slot, key: 'shift-left' }));
  el.querySelector('.tab').addEventListener('click', () => submitPrompt(slot, 'tab'));
  el.querySelector('.enter').addEventListener('click', () => post('key', { slot, key: 'enter' }));
  for (const key of ['up', 'down', 'left', 'right', 'space']) el.querySelector('.' + key).addEventListener('click', () => post('key', { slot, key }));
  el.querySelector('.esc').addEventListener('click', () => post('key', { slot, key: 'escape' }));
  el.querySelector('.ctrlc').addEventListener('click', () => post('key', { slot, key: 'ctrl-c' }));
  el.querySelector('.copy').addEventListener('click', () => copySlot(slot).catch(() => note('Copy blocked by clipboard permissions.')));
  el.querySelector('.paste').addEventListener('click', () => readClipboardAndPaste(slot));
  bindPanelMenu(el.querySelector('.tools-toggle'), el.querySelector('.panel-menu'));
  el.querySelector('.terminal-composer').addEventListener('submit', (ev) => {
    ev.preventDefault();
    submitPrompt(slot, 'enter');
  });
  bindPromptInput(el.querySelector('.prompt-input'), key => submitPrompt(slot, key));
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
  el.classList.remove('missing', 'changed', 'working', 'covered', 'row-span-2', 'memory-review');
  el.querySelector('.idx').textContent = String(slot + 1).padStart(2, '0');
  el.querySelector('.name').textContent = 'Empty';
  el.querySelector('.name').title = '';
  el.querySelector('.meta').textContent = '';
  makeOptions(el.querySelector('.assign-session'), '');
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
    if (window.terminalTownBrowserHost) document.title = boardInfo.title + ' TerminalTown';
  }
  if (selectedSlot >= slotCount) selectedSlot = Math.max(0, slotCount - 1);
  for (const [slot, el] of Array.from(tiles.entries())) {
    if (slot < slotCount) continue;
    clearPanelChime(slot);
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
function acknowledgeRender(data, accepted) {
  if (!data.renderId) return;
  post('rendered', {
    renderId: data.renderId, accepted, boardId: currentBoardId(), holding: holdingNames.slice(),
    layoutRevision: renderedLayoutRevision,
    slots: Array.from({ length: slotCount }, (_, slot) => tiles.get(slot)?.dataset.session || ''),
  });
}
function render(data, optimistic = false) {
  const incomingBoard = data.board?.id || currentBoardId();
  const sameBoard = incomingBoard === currentBoardId();
  if (!optimistic && sameBoard && (pendingPanelMoves.length || (Number(data.board?.layoutRevision) || 0) < renderedLayoutRevision)) { acknowledgeRender(data, false); return; }
  if (!sameBoard) { pendingPanelMoves.length = 0; board.setAttribute('aria-busy', 'false'); clearTimeout(panelMoveTimer); renderedLayoutRevision = 0; for (const action of deferredPanelActions.splice(0)) action.resolve({ ok: false }); }
  if (!optimistic) { renderedLayoutRevision = Number(data.board?.layoutRevision) || 0; confirmedBoardData = data; }
  const panelMemory = new Map();
  for (const [slot, tile] of tiles) if (sameBoard && slotSessions[slot]) {
    const pre = tile.querySelector('pre');
    panelMemory.set(slotSessions[slot], { draft: tile.querySelector('.prompt-input').value, top: pre.scrollTop, left: pre.scrollLeft, follow: pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 2, oldSlot: slot });
  }
  const oldSlotSessions = slotSessions.slice();
  if (sameBoard) preserveDesktopPlacement(data);
  lastBoardData = data;
  const previousGridShape = gridShape;
  const firstBoardRender = !activeRenderedBoardId;
  const previousSpans = slotSpans;
  const boardId = data.board && data.board.id ? String(data.board.id) : '';
  if (boardId && activeRenderedBoardId && boardId !== activeRenderedBoardId) {
    stopAllChimes();
    last.clear();
    layoutNotice.hidden = true;
    lastSpanConflict = '';
    selectedSlot = 0;
    fontSelection.clear();
    fontScope.value = 'all';
  }
  if (boardId && boardId !== activeRenderedBoardId) {
    skin = readBoardSkin(boardId);
    skinSelect.value = skin;
    document.body.dataset.skin = skin;
    updateTerminalTownFavicon();
    initialDiscoSpectaclePending = skin === 'disco';
    resetArcadeTrack();
  }
  if (boardId) activeRenderedBoardId = boardId;
  applyBoardShape(data.board || {}, (data.sessions || []).length);
  allSessions = data.allSessions || [];
  titles = data.titles || {};
  holdingBoards = Array.isArray(data.holdingBoards) ? data.holdingBoards.slice() : [];
  holdingMembership = data.holdingMembership && typeof data.holdingMembership === 'object' ? data.holdingMembership : {};
  const sessions = Array.from({ length: slotCount }, (_, slot) => (data.sessions || [])[slot] || { slot, name: '' });
  const layoutChanged = previousGridShape !== gridShape || sessions.some((session, slot) => (session.rowSpan || 1) !== (previousSpans[slot] || 1));
  slotRecords = sessions;
  slotSessions = sessions.map((session) => session.name || '');
  slotSpans = sessions.map((session) => session.rowSpan || 1);
  board.classList.toggle('compact', compact);
  for (const session of sessions) {
    const slot = session.slot;
    const el = tiles.get(slot) || createTile(slot);
    if (activePanelTrigger && activePanelTrigger.closest('.tile') === el && last.get(slot)?.name !== session.name) closePanelMenu(true);
    el.dataset.session = session.name || '';
    el.classList.toggle('empty', !session.name);
    el.classList.toggle('missing', Boolean(session.missing || session.state === 'missing'));
    el.classList.toggle('memory-review', Boolean(session.memory && session.memory.reviewState === 'pending' && session.memory.proposedCharter));
    el.classList.toggle('has-memory', Boolean(session.memory && session.memory.approvedCharter));
    el.querySelector('.idx').textContent = String(slot + 1).padStart(2, '0');
    el.querySelector('.name').textContent = session.display || session.name || 'Empty';
    el.querySelector('.name').title = session.target ? ((session.name || '') + ' -> ' + session.target) : (session.name || '');
    const stoppedAgent = Boolean((session.threadId || session.resumeId) && !/^(?:codex|claude)(?:\\s|$)/i.test(String(session.command || '')));
    el.querySelector('.meta').textContent = session.name ? ((stoppedAgent ? (el.classList.contains('has-memory') ? '' : 'Stopped · ') + (session.command || 'shell') : session.dormant ? 'sleeping · next message starts it' : (session.command || 'pane')) + ' c:' + session.clients + (session.contextTokens ? ' ctx:' + Math.round(session.contextTokens / 1000) + 'k' + (session.rotation && session.rotation.state ? '·' + session.rotation.state : '') : '') + (session.target ? ' @ ' + session.target : '')) : '';
    el.querySelector('.memory-badge').textContent = el.classList.contains('memory-review') ? 'Review' : stoppedAgent ? 'Memory · stopped' : 'Memory saved';
    el.querySelector('.memory').hidden = !(session.memory && session.memory.approvedCharter);
    syncLarsonDesktop(el, session, boardId);
    syncCodexQuestion(el, session);
    makeOptions(el.querySelector('.assign-session'), session.name || '');
    makeBoardOptions(el.querySelector('.move-board'), session.name ? activeRenderedBoardId : '');
    const pre = el.querySelector('pre');
    const text = session.name ? session.output : (isMobileView() ? 'Open panel controls to assign a session.' : 'Drag/resize this panel, or assign a session.');
    const fp = fingerprint(text);
    const prev = last.get(slot);
    const changed = prev && prev.name === session.name && prev.fp && fp && prev.fp !== fp;
    const activeWork = Boolean(session.name && session.state !== 'missing' && ((session.state === 'busy') || (!session.state && looksWorking(text))));
    const waiting = Boolean(session.name && session.state === 'waiting');
    const displayMode = session.threadId || session.resumeId || /(?:^|\s)(?:codex|claude)(?:\s|$)/i.test(String(session.command || '')) ? 'agent' : '';
    updateTerminalViewport(pre, text, boardId + ':' + (session.name || 'empty'), false, displayMode, session.cwd || '');
    el.classList.toggle('changed', changed);
    el.classList.toggle('working', activeWork);
    maybeChime(slot, session.name, session.noticeKey || '', session.state || '', prev, session);
    updatePanelChimeControls(el, slot);
    if (changed) setTimeout(() => el.classList.remove('changed'), 1400);
    last.set(slot, { name: session.name, fp, working: activeWork, waiting, noticeKey: session.noticeKey || '' });
  }
  if (sessionMemoryDialog.open) populateMemoryDialog();
  applyPanelFonts();
  renderSeen = true;
  if (recoveryEl) {
    recoveryEl.classList.toggle('visible', Boolean(data.warning));
    delete recoveryEl.dataset.syncWarning;
    recoveryEl.querySelector('button').textContent = 'Recover';
    const span = recoveryEl.querySelector('span');
    if (span) { span.textContent = data.warning || ''; span.title = data.warning || ''; }
  }
  placeTiles();
  for (const [slot, tile] of tiles) {
    if (oldSlotSessions[slot] === slotSessions[slot]) continue;
    const memory = panelMemory.get(slotSessions[slot]);
    const input = tile.querySelector('.prompt-input');
    input.value = memory?.draft || '';
    resizePromptInput(input);
    if (memory) {
      const pre = tile.querySelector('pre');
      pre.scrollTop = memory.follow ? pre.scrollHeight : memory.top;
      pre.scrollLeft = memory.left;
    }
  }
  // A new capture can arrive before layout settles without causing a resize
  // observer callback. Always schedule one post-render geometry measurement.
  scheduleTileGeometryRefresh();
  renderHolding(data.holding || [], data);
  setSelected(selectedSlot, { focusProxy: false });
  rememberCurrentBoard(data.board);
  if (mobileReady) renderMobile(data);
  if (firstBoardRender) restoreBoardDrafts();
  renderAllImageDrafts();
  applySessionFocus();
  note(data.error ? data.error : gridShape + ' updated ' + new Date(data.at || Date.now()).toLocaleTimeString());
  if (layoutChanged) setTimeout(() => requestRefresh({ force: true }), 40);
  if (!optimistic) acknowledgeRender(data, true);
  if (window.terminalTownHealth) requestAnimationFrame(() => window.terminalTownHealth.sample());
  if (initialDiscoSpectaclePending) {
    initialDiscoSpectaclePending = false;
    setTimeout(startDiscoSpectacle, 40);
  }
}
function renderHolding(names, data = {}) {
  // Also defend against older hosts that send their complete session inventory.
  const placed = new Set(slotSessions.filter(Boolean));
  holdingNames = Array.isArray(names) ? [...new Set(names)].filter(name =>
    !String(name || '').startsWith('terminaltown-meta-') && !placed.has(name) && !(holdingMembership[name] || []).some(board => !board.held)) : [];
  renderHoldingList();
}
function setHoldingOpen(open, persist = true) {
  holdingOpen = Boolean(open);
  document.body.classList.toggle('holding-open', holdingOpen);
  if (holdingDrawer) holdingDrawer.setAttribute('aria-hidden', holdingOpen ? 'false' : 'true');
  if (toggleHoldingButton) {
    document.getElementById('toolbarHoldingCount').textContent = holdingNames.length;
    toggleHoldingButton.setAttribute('aria-expanded', String(holdingOpen));
    toggleHoldingButton.setAttribute('aria-label', (holdingOpen ? 'Close' : 'Open') + ' Holding drawer, ' + holdingNames.length + ' sessions');
    toggleHoldingButton.title = holdingOpen ? 'Close Holding drawer' : 'Open Holding drawer';
  }
  if (persist) preferenceStorage.setItem('terminaltown-holding-open', holdingOpen ? '1' : '0');
  if (!isMobileView() && holdingOpen && holdingSearch && document.activeElement !== holdingSearch) {
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
  const title = name === LARSON_DESKTOP_SESSION ? 'Larson Desktop' : titles[name] || name;
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
    search: (String(name || '') + ' ' + (name === LARSON_DESKTOP_SESSION ? 'Larson Remote ' : '') + String(title || '') + ' ' + boardText + ' ' + boardIds.join(' ')).toLowerCase(),
  };
}
const holdingRestoreSlots = new Map();
function resetHoldingBoardFilter() {
  holdingBoardFilterValue = 'all';
  preferenceStorage.setItem('terminaltown-holding-board-filter', 'all');
}
function renderHoldingBoardFilter() {
  const choices = [{ value: 'all', title: 'All boards' }, { value: 'unassigned', title: 'Unassigned' }]
    .concat(holdingBoards.map(board => ({ value: 'board:' + board.id, title: board.title || board.id })));
  if (!choices.some(choice => choice.value === holdingBoardFilterValue)) resetHoldingBoardFilter();
  const signature = JSON.stringify(choices);
  if (holdingBoardFilter.dataset.choices !== signature) {
    holdingBoardFilter.replaceChildren(...choices.map(choice => {
      const option = document.createElement('option');
      option.value = choice.value; option.textContent = choice.title; return option;
    }));
    holdingBoardFilter.dataset.choices = signature;
  }
  holdingBoardFilter.value = holdingBoardFilterValue;
}
function renderHoldingList() {
  holding.innerHTML = '';
  renderHoldingBoardFilter();
  const query = String(holdingQuery || '').trim().toLowerCase();
  const filter = ['all', 'claude', 'codex', 'other'].includes(holdingFilterValue) ? holdingFilterValue : 'all';
  const sort = ['recent', 'title', 'name'].includes(holdingSortValue) ? holdingSortValue : 'recent';
  if (holdingFilter && holdingFilter.value !== filter) holdingFilter.value = filter;
  if (holdingSort && holdingSort.value !== sort) holdingSort.value = sort;

  let records = holdingNames.map(holdingRecord)
    .filter(record => holdingBoardFilterValue === 'all' || (holdingBoardFilterValue === 'unassigned'
      ? !record.boardIds.length : record.boardIds.includes(holdingBoardFilterValue.slice(6))))
    .filter((record) => filter === 'all' || record.kind === filter)
    .filter((record) => !query || record.search.includes(query));
  if (sort === 'title') {
    records = records.slice().sort((a, b) => a.title.localeCompare(b.title) || a.name.localeCompare(b.name));
  } else if (sort === 'name') {
    records = records.slice().sort((a, b) => a.name.localeCompare(b.name) || a.title.localeCompare(b.title));
  }
  if (holdingCount) holdingCount.textContent = String(records.length);
  if (holdingTabCount) holdingTabCount.textContent = String(holdingNames.length);
  if (toggleHoldingButton) { document.getElementById('toolbarHoldingCount').textContent = holdingNames.length; toggleHoldingButton.setAttribute('aria-label', (holdingOpen ? 'Close' : 'Open') + ' Holding drawer, ' + holdingNames.length + ' sessions'); }

  if (!holdingNames.length || !records.length) {
    const empty = document.createElement('div');
    empty.className = 'holding-empty';
    empty.textContent = holdingNames.length ? 'No matching sessions' : 'No parked sessions';
    holding.appendChild(empty);
    return;
  }
  for (const record of records) {
    const name = record.name;
    const item = document.createElement('article');
    item.className = 'holding-item';
    item.draggable = true;
    item.title = 'Drag this session onto a panel to place it';
    item.addEventListener('dragstart', (ev) => {
      if (ev.target.closest('input, select, button')) {
        ev.preventDefault();
        return;
      }
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('application/json', JSON.stringify({ session: name }));
      ev.dataTransfer.setData('text/plain', name);
    });
    const fields = document.createElement('div');
    fields.className = 'holding-item-fields';
    const addField = (labelText, value, className, onChange) => {
      const field = document.createElement('label');
      field.className = 'holding-field ' + className;
      const label = document.createElement('span');
      label.textContent = labelText;
      const input = document.createElement('input');
      input.value = value;
      input.setAttribute('aria-label', labelText);
      input.addEventListener('change', () => {
        const next = String(input.value || '').trim();
        if (!next || next === value) {
          input.value = value;
          return;
        }
        onChange(next);
      });
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') input.blur();
        if (ev.key === 'Escape') {
          input.value = value;
          input.blur();
        }
      });
      field.append(label, input);
      fields.appendChild(field);
    };
    const remote = name === LARSON_DESKTOP_SESSION;
    addField('Display name', record.title, 'holding-field-display', (title) => post('renameHeld', { session: name, title }));
    if (remote) fields.querySelector('input').readOnly = true;
    if (!remote) addField('TMUX name', name, 'holding-field-tmux', (nextName) => post('renameTmuxHeld', { session: name, nextName }));
    const actions = document.createElement('div');
    actions.className = 'holding-item-actions';
    const boardSelect = document.createElement('select');
    boardSelect.title = 'Board assignment';
    boardSelect.setAttribute('aria-label', 'Board assignment');
    makeBoardOptions(boardSelect, record.boardIds.includes(activeRenderedBoardId) ? activeRenderedBoardId : (record.boardIds[0] || ''));
    boardSelect.addEventListener('change', () => postBoardAssignment(boardSelect, 'placeHeld', { session: name, destinationBoardId: boardSelect.value }));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.title = 'End and delete this tmux session';
    remove.addEventListener('click', () => {
      if (!window.terminalTownBrowserHost || confirm('End and delete tmux session ' + name + ' from every board?')) post('deleteHeld', { session: name });
    });
    if (remote) {
      const open = document.createElement('a'); open.href = larsonRemotePageUrl(); open.textContent = 'Open ↗'; open.setAttribute('aria-label', 'Open Larson Remote');
      open.addEventListener('click', event => { if (!window.terminalTownBrowserHost) { event.preventDefault(); post('openExternal', {url:open.href}); } });
      actions.append(boardSelect, open);
    } else actions.append(boardSelect, remove);
    const restore = document.createElement('div');
    restore.className = 'holding-restore-controls';
    const panelSelect = document.createElement('select');
    panelSelect.className = 'holding-panel-select';
    panelSelect.setAttribute('aria-label', 'Panel on current board');
    for (let slot = 0; slot < slotSessions.length; slot += 1) {
      if (tiles.get(slot)?.classList.contains('covered')) continue;
      const option = document.createElement('option');
      option.value = String(slot);
      option.textContent = 'Panel ' + (slot + 1) + (slotSessions[slot] ? ' · ' + (titles[slotSessions[slot]] || slotSessions[slot]) : ' · Empty');
      panelSelect.appendChild(option);
    }
    const emptySlot = Array.from(panelSelect.options).find(option => !slotSessions[Number(option.value)]);
    const restoreKey = activeRenderedBoardId + ':' + name;
    const savedSlot = holdingRestoreSlots.get(restoreKey);
    if (Array.from(panelSelect.options).some(option => option.value === savedSlot)) panelSelect.value = savedSlot;
    else if (emptySlot) panelSelect.value = emptySlot.value;
    panelSelect.addEventListener('change', () => holdingRestoreSlots.set(restoreKey, panelSelect.value));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'holding-restore';
    add.textContent = 'Add to board';
    add.disabled = !panelSelect.options.length;
    add.addEventListener('click', () => {
      const slot = Number(panelSelect.value);
      const displaced = slotSessions[slot];
      if (displaced && !confirm('Move ' + (titles[displaced] || displaced) + ' to Holding and place ' + record.title + ' in panel ' + (slot + 1) + '?')) return;
      post('showHeld', { session: name, slot });
    });
    restore.append(panelSelect, add);
    item.append(fields, actions, restore);
    holding.appendChild(item);
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
  const cwd = prompt('Project directory', JARGAN_ROOT);
  if (!cwd) return;
  const title = prompt('Session name (the work it owns)', '');
  if (!title || !title.trim()) return;
  const session = kebabForBrowser(title);
  const defaultCommand = normalizedKind === 'claude'
    ? 'claude --dangerously-skip-permissions --model opus --effort max --rc --ide'
    : normalizedKind === 'codex'
      ? '${CODEX_FULL_PERMISSION_COMMAND}'
      : 'zsh';
  const command = prompt('Command', defaultCommand);
  if (!command) return;
  const initialPrompt = prompt('Initial prompt (optional)', '');
  if (initialPrompt === null) return;
  const placement = browserPlacementValue(prompt('Place in: first, selected, holding, or slot number', 'first'));
  post('newSession', { slot: selectedSlot, kind: normalizedKind, cwd, session: '', title, command, initialPrompt, placement });
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
function browserRenameBoard() {
  if (!window.terminalTownBrowserHost) {
    post('renameBoard');
    return;
  }
  const current = boardLabel ? String(boardLabel.textContent || '').trim() : '';
  const title = prompt('Board name', current || 'TerminalTown');
  if (title === null || !String(title).trim()) return;
  post('renameBoard', { title });
}
function storedBoardValue(key, fallback) {
  try { return JSON.parse(preferenceStorage.getItem(key)) || fallback; } catch { return fallback; }
}
let boardDirectory = storedBoardValue('terminaltown-board-directory', []);
let recentBoards = storedBoardValue('terminaltown-recent-boards', []);
let pinnedBoards = storedBoardValue('terminaltown-pinned-boards', []);
let pickerReturnFocus = null;
let directoryLoadedAt = 0;
let boardShortcut = preferenceStorage.getItem('terminaltown-board-shortcut') || 'alt';
const boardShortcutSelect = document.getElementById('boardShortcut');
boardShortcutSelect.value = boardShortcut;
function currentBoardId() { return activeRenderedBoardId || window.terminalTownBrowserBoard || 'default'; }
const fontSelection = new Set();
const fontScope = document.getElementById('fontScope');
const fontSizeInput = document.getElementById('fontSize');
function panelFontStorageKey() { return 'terminaltown-panel-fonts-' + currentBoardId(); }
function panelFontSizes() {
  const saved = storedBoardValue(panelFontStorageKey(), {});
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}
function panelFontSize(slot, sizes = panelFontSizes()) {
  const value = Number(sizes[slot]);
  return Number.isInteger(value) && value >= 8 && value <= 40 ? value : 12;
}
function fontTargetSlots() {
  return [...tiles.keys()].filter(slot => slotSessions[slot] && (fontScope.value === 'all' || fontSelection.has(slot)));
}
function syncFontControls(sizes = panelFontSizes()) {
  for (const slot of fontSelection) if (!slotSessions[slot] || !tiles.has(slot)) fontSelection.delete(slot);
  fontScope.querySelector('[value="selected"]').textContent = 'Selected (' + fontSelection.size + ')';
  const targets = fontTargetSlots();
  const values = targets.map(slot => panelFontSize(slot, sizes));
  if (document.activeElement !== fontSizeInput) {
    fontSizeInput.value = values.length && values.every(value => value === values[0]) ? values[0] : '';
    fontSizeInput.placeholder = values.length ? 'Mixed' : 'No panels';
  }
  fontSizeInput.disabled = !values.length;
  document.getElementById('fontDecrease').disabled = !values.length || Math.min(...values) <= 8;
  document.getElementById('fontIncrease').disabled = !values.length || Math.max(...values) >= 40;
}
function applyPanelFonts() {
  const sizes = panelFontSizes();
  syncFontControls(sizes);
  for (const [slot, tile] of tiles) {
    const value = panelFontSize(slot, sizes);
    tile.style.setProperty('--panel-font-size', value + 'px');
    const input = tile.querySelector('.font-size');
    if (document.activeElement !== input) input.value = value;
    tile.querySelector('.font-decrease').disabled = value <= 8;
    tile.querySelector('.font-increase').disabled = value >= 40;
    tile.querySelector('.font-select').checked = fontSelection.has(slot);
    tile.classList.toggle('font-selected', fontSelection.has(slot));
  }
  applyPanelHues();
}
function changePanelFonts(slots, value, relative = false) {
  if (!slots.length || !Number.isInteger(value)) return;
  const sizes = panelFontSizes();
  const values = slots.map(slot => panelFontSize(slot, sizes));
  // Limit the whole step together so relative differences survive at the bounds.
  const delta = relative ? Math.max(8 - Math.min(...values), Math.min(40 - Math.max(...values), value)) : 0;
  if (!relative && (value < 8 || value > 40)) return;
  slots.forEach((slot, index) => { sizes[slot] = relative ? values[index] + delta : value; });
  try { preferenceStorage.setItem(panelFontStorageKey(), JSON.stringify(sizes)); }
  catch { note('Could not save text sizes in this browser.'); return; }
  applyPanelFonts();
  scheduleTileGeometryRefresh();
  requestRefresh();
}
function bindFontSizeInput(input, targets) {
  const commit = () => {
    if (input.value.trim() && input.checkValidity()) changePanelFonts(targets(), Number(input.value));
    else input.reportValidity();
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commit(); }
  });
  input.addEventListener('blur', applyPanelFonts);
}
function bindPanelFontControls(tile, slot) {
  tile.addEventListener('panelslotchange', () => { slot = Number(tile.dataset.slot); });
  const select = tile.querySelector('.font-select');
  select.setAttribute('aria-label', 'Select panel ' + (slot + 1));
  select.title = 'Select panel ' + (slot + 1);
  select.addEventListener('change', () => {
    if (select.checked) fontSelection.add(slot); else fontSelection.delete(slot);
    fontScope.value = fontSelection.size ? 'selected' : 'all';
    hueScope.value = fontSelection.size ? 'selected' : 'all';
    applyPanelFonts();
  });
  tile.querySelector('.font-decrease').addEventListener('click', () => changePanelFonts([slot], -1, true));
  tile.querySelector('.font-increase').addEventListener('click', () => changePanelFonts([slot], 1, true));
  bindFontSizeInput(tile.querySelector('.font-size'), () => [slot]);
}
fontScope.addEventListener('change', () => syncFontControls());
document.getElementById('fontDecrease').addEventListener('click', () => changePanelFonts(fontTargetSlots(), -1, true));
document.getElementById('fontIncrease').addEventListener('click', () => changePanelFonts(fontTargetSlots(), 1, true));
bindFontSizeInput(fontSizeInput, fontTargetSlots);
${fs.readFileSync(path.join(__dirname, 'panelHues.js'), 'utf8')}
${fs.readFileSync(path.join(__dirname, 'boardReset.js'), 'utf8')}

function rememberCurrentBoard(info) {
  if (!info || !info.id) return;
  const found = boardDirectory.find(b => b.id === info.id);
  if (!found || found.title !== info.title) {
    boardDirectory = [{ id: info.id, title: info.title || info.id }, ...boardDirectory.filter(b => b.id !== info.id)];
    preferenceStorage.setItem('terminaltown-board-directory', JSON.stringify(boardDirectory));
  }
  if (recentBoards[0] !== info.id) {
    recentBoards = [info.id, ...recentBoards.filter(id => id !== info.id)].slice(0, 12);
    preferenceStorage.setItem('terminaltown-recent-boards', JSON.stringify(recentBoards));
  }
  renderBoardPins();
}
function renderBoardPins() {
  const root = document.getElementById('boardPins');
  const entries = pinnedBoards.map(id => boardDirectory.find(b => b.id === id)).filter(Boolean).slice(0, 5);
  const signature = JSON.stringify([entries, currentBoardId()]);
  if (root.dataset.signature === signature) return;
  root.dataset.signature = signature; root.replaceChildren();
  for (const entry of entries) {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = entry.title || entry.id; button.title = 'Switch to ' + button.textContent;
    if (entry.id === currentBoardId()) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => openBoardFromPicker(entry)); root.append(button);
  }
}
function closeBoardPicker(restore = true) {
  boardPicker.classList.remove('visible'); boardPicker.setAttribute('aria-hidden', 'true');
  openBoardButton.setAttribute('aria-expanded', 'false');
  if (restore) (pickerReturnFocus && pickerReturnFocus.isConnected ? pickerReturnFocus : openBoardButton).focus({ preventScroll: true });
}
function saveBoardDrafts() {
  const prompts = {};
  for (const [slot, tile] of tiles) if (slotSessions[slot]) prompts[slotSessions[slot]] = tile.querySelector('.prompt-input').value;
  const images = Object.fromEntries([...imageDrafts].filter(([key]) => key.startsWith(currentBoardId() + ':')).map(([key, entries]) => [key, entries.filter(entry => entry.path)]));
  try { sessionStorage.setItem('terminaltown-drafts-' + currentBoardId(), JSON.stringify({ prompts, meta: metaGoal.value, images })); } catch {}
}
function restoreBoardDrafts() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('terminaltown-drafts-' + currentBoardId()) || '{}');
    for (const [slot, tile] of tiles) if (!tile.querySelector('.prompt-input').value && saved.prompts && saved.prompts[slotSessions[slot]]) tile.querySelector('.prompt-input').value = saved.prompts[slotSessions[slot]];
    if (saved.meta && !metaGoal.value) metaGoal.value = saved.meta;
    for (const [key, entries] of Object.entries(saved.images || {})) if (!imageDrafts.has(key) && key.startsWith(currentBoardId() + ':') && Array.isArray(entries)) imageDrafts.set(key, entries);
    renderAllImageDrafts();
    document.querySelectorAll('.prompt-input').forEach(resizePromptInput);
  } catch {}
}
window.addEventListener('pagehide', saveBoardDrafts);
function openBoardFromPicker(entry) {
  if (entry?.page) {
    saveBoardDrafts(); closeBoardPicker(false);
    if (window.terminalTownBrowserHost) window.location.assign(larsonRemotePageUrl());
    else post('openExternal', {url:larsonRemotePageUrl()});
    return;
  }
  const id = String(entry && (entry.id || entry.boardId) || '').trim();
  if (!id) return;
  saveBoardDrafts(); closeBoardPicker(false);
  if (id === currentBoardId()) { openBoardButton.focus(); return; }
  if (window.terminalTownBrowserHost) {
    // Navigation needs no tmux round trip. Destination loads its own board-scoped state.
    window.location.assign('/?board=' + encodeURIComponent(id));
  } else post('openBoard', { boardId: id, boardTitle: entry.title || entry.boardTitle || id });
}
function previousBoard() {
  const id = recentBoards.find(id => id !== currentBoardId() && boardDirectory.some(b => b.id === id));
  if (id) openBoardFromPicker(boardDirectory.find(b => b.id === id));
}
function cycleBoard(direction) {
  // Live summaries include unvisited boards; use saved entries before the first render.
  const directory = (holdingBoards.length ? holdingBoards : boardDirectory).filter(b => b.id);
  const entries = [...new Map(directory.map(b => [b.id, b])).values()].sort((a, b) =>
    a.id === b.id ? 0 : a.id === 'default' ? -1 : b.id === 'default' ? 1 :
      String(a.title || a.id).localeCompare(String(b.title || b.id)) || a.id.localeCompare(b.id));
  if (entries.length < 2) return;
  const index = entries.findIndex(b => b.id === currentBoardId());
  const next = index < 0 ? (direction > 0 ? 0 : entries.length - 1) : (index + direction + entries.length) % entries.length;
  openBoardFromPicker(entries[next]);
}
function renderBoardPicker() {
  const focusedPin = document.activeElement && document.activeElement.dataset.pin;
  const query = boardPickerInput.value.trim().toLocaleLowerCase();
  const score = b => pinnedBoards.includes(b.id) ? -200 + pinnedBoards.indexOf(b.id) : b.id === currentBoardId() ? -100 : recentBoards.includes(b.id) ? recentBoards.indexOf(b.id) : 100;
  const list = boardDirectory.concat([{id:'larson-remote',title:'Larson Remote',page:true}]).filter(b => (b.title + ' ' + b.id).toLocaleLowerCase().includes(query)).sort((a, b) => score(a) - score(b) || a.title.localeCompare(b.title));
  boardPickerList.replaceChildren();
  for (const entry of list) {
    const row = document.createElement('div'); row.className = 'board-picker-row';
    const item = document.createElement('button'); item.type = 'button';
    const active = entry.id === currentBoardId();
    item.className = 'board-picker-item' + (active ? ' active' : '');
    item.title = 'Switch to ' + entry.title; item.dataset.boardId = entry.id;
    if (active) item.setAttribute('aria-current', 'page');
    const title = document.createElement('span'); title.className = 'board-picker-title'; title.textContent = entry.title || entry.id;
    const detail = document.createElement('span'); detail.className = 'board-picker-id';
    detail.textContent = entry.page ? 'Page' : active ? 'Current' : pinnedBoards.includes(entry.id) ? 'Starred' : recentBoards.includes(entry.id) ? 'Recent' : entry.id;
    item.append(title, detail); item.addEventListener('click', () => openBoardFromPicker(entry));
    const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'pin-board'; pin.dataset.pin = entry.id;
    const pinned = pinnedBoards.includes(entry.id); pin.textContent = pinned ? '★' : '☆';
    pin.title = (pinned ? 'Unpin ' : 'Pin ') + entry.title; pin.setAttribute('aria-label', pin.title); pin.setAttribute('aria-pressed', String(pinned));
    pin.addEventListener('click', () => {
      if (!pinned && pinnedBoards.length >= 5) { note('Unpin a board first (five toolbar pins maximum).'); document.getElementById('boardShortcutHint').textContent = 'Unpin a board first — five pins maximum.'; return; }
      pinnedBoards = pinned ? pinnedBoards.filter(id => id !== entry.id) : [...pinnedBoards, entry.id];
      preferenceStorage.setItem('terminaltown-pinned-boards', JSON.stringify(pinnedBoards)); renderBoardPins(); renderBoardPicker();
    });
    row.append(item); if (!entry.page) row.append(pin); boardPickerList.append(row);
  }
  if (!list.length) {
    const empty = document.createElement('p'); empty.textContent = 'No matching boards.'; boardPickerList.append(empty);
    if (query) {
      const openId = document.createElement('button'); openId.type = 'button'; openId.className = 'board-picker-item';
      openId.textContent = 'Open board ID: ' + boardPickerInput.value.trim();
      openId.addEventListener('click', () => openBoardFromPicker({ id: boardPickerInput.value.trim() })); boardPickerList.append(openId);
    }
  }
  document.getElementById('previousBoard').disabled = !recentBoards.some(id => id !== currentBoardId() && boardDirectory.some(b => b.id === id));
  if (focusedPin) Array.from(boardPickerList.querySelectorAll('[data-pin]')).find(el => el.dataset.pin === focusedPin)?.focus();
}
async function showBoardPicker() {
  closePanelMenu(); closeCommandPopover();
  pickerReturnFocus = isMobileView() ? document.getElementById('mobileNavigateButton') : document.activeElement;
  boardPickerInput.value = '';
  if (!boardDirectory.length && holdingBoards.length) boardDirectory = holdingBoards.filter(b => b.id).map(b => ({ id: b.id, title: b.title || b.id }));
  renderBoardPicker(); boardPicker.classList.add('visible'); boardPicker.setAttribute('aria-hidden', 'false');
  if (isMobileView()) installMobileIosInputScaling(boardPicker);
  openBoardButton.setAttribute('aria-expanded', 'true'); boardPickerInput.focus();
  if (!window.terminalTownBrowserHost || Date.now() - directoryLoadedAt < 15000) return;
  try {
    const response = await fetch('/api/boards' + (window.terminalTownBrowserBoardQuery || ''));
    if (!response.ok) throw new Error('Board list unavailable');
    const payload = await response.json();
    boardDirectory = (payload.boards || []).filter(b => b.id).map(b => ({ id: String(b.id), title: String(b.title || b.id) }));
    directoryLoadedAt = Date.now(); preferenceStorage.setItem('terminaltown-board-directory', JSON.stringify(boardDirectory));
    renderBoardPins(); if (boardPicker.classList.contains('visible')) renderBoardPicker();
  } catch { document.getElementById('boardShortcutHint').textContent = 'Offline — showing saved boards.'; }
}
boardPickerInput.addEventListener('input', renderBoardPicker);
document.getElementById('previousBoard').addEventListener('click', previousBoard);
boardShortcutSelect.addEventListener('change', () => {
  boardShortcut = boardShortcutSelect.value; preferenceStorage.setItem('terminaltown-board-shortcut', boardShortcut);
  openBoardButton.title = boardShortcut === 'alt' ? 'Switch board (Alt+Shift+B)' : 'Switch board';
  document.getElementById('boardShortcutHint').textContent = boardShortcut === 'off' ? '' :
    'Ctrl+B / Ctrl+Shift+B: next · Ctrl+V: back' + (boardShortcut === 'alt' ? ' · Alt+Shift+B: switcher · Alt+Shift+P: last visited' : ' · Ctrl+Shift+P: last visited');
});
boardShortcutSelect.dispatchEvent(new Event('change'));
boardPicker.addEventListener('keydown', ev => {
  ev.stopPropagation();
  if (ev.key === 'Escape') { ev.preventDefault(); closeBoardPicker(); return; }
  const items = Array.from(boardPickerList.querySelectorAll('.board-picker-item'));
  if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && (ev.target === boardPickerInput || ev.target.classList.contains('board-picker-item'))) {
    ev.preventDefault(); const i = items.indexOf(ev.target); const next = ev.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    if (items.length) items[next].focus();
  }
  if (ev.key === 'Tab') {
    const focusables = Array.from(boardPicker.querySelectorAll('button,input,select')).filter(el => !el.disabled && el.getClientRects().length);
    if (ev.shiftKey && ev.target === focusables[0]) { ev.preventDefault(); focusables.at(-1).focus(); }
    else if (!ev.shiftKey && ev.target === focusables.at(-1)) { ev.preventDefault(); focusables[0].focus(); }
  }
});
window.addEventListener('keydown', ev => {
  if (boardShortcut === 'off' || ev.metaKey || ev.isComposing) return;
  if (ev.code === 'KeyV' && editableTarget(ev.target)) return;
  if (ev.ctrlKey && !ev.altKey && (ev.code === 'KeyB' || (ev.code === 'KeyV' && !ev.shiftKey))) {
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (!ev.repeat) cycleBoard(ev.code === 'KeyV' ? -1 : 1);
    return;
  }
  const modifier = boardShortcut === 'alt' ? ev.altKey && !ev.ctrlKey : boardShortcut === 'ctrl' ? ev.ctrlKey && !ev.altKey : false;
  if (!modifier || !ev.shiftKey || ev.metaKey || ev.isComposing || ev.repeat || !['KeyB', 'KeyP'].includes(ev.code)) return;
  ev.preventDefault(); ev.stopImmediatePropagation();
  if (ev.code === 'KeyB') { if (boardPicker.classList.contains('visible')) closeBoardPicker(); else showBoardPicker(); }
  else previousBoard();
}, true);

function browserOpenMap() {
  post('openMap');
}
function browserConfirmBye(slot) {
  if (!window.terminalTownBrowserHost || confirm('End tmux session in slot ' + (slot + 1) + '?')) post('bye', { slot });
}
function controlIcon(name) {
  const shapes = {
    paste: '<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="8" y="2" width="8" height="5" rx="1"/><path d="M9 12h6m-6 4h6"/>',
    chime: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/><path class="chime-slash" d="m4 4 16 16"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>'
  };
  return '<svg class="command-icon" viewBox="0 0 24 24" aria-hidden="true">' + (shapes[name] || shapes.more) + '</svg>';
}
function fillControlIcons(root) {
  for (const button of root.querySelectorAll('[data-icon]')) button.insertAdjacentHTML('afterbegin', controlIcon(button.dataset.icon));
}
let activePanelTrigger = null;
function closePanelMenu(restoreFocus = false) {
  if (!activePanelTrigger) return;
  const trigger = activePanelTrigger;
  const popup = document.getElementById(trigger.getAttribute('aria-controls'));
  if (popup.matches(':popover-open')) popup.hidePopover();
  popup.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  activePanelTrigger = null;
  if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
}
function positionPanelMenu() {
  if (!activePanelTrigger) return;
  const popup = document.getElementById(activePanelTrigger.getAttribute('aria-controls'));
  const r = activePanelTrigger.getBoundingClientRect();
  popup.style.left = Math.max(6, Math.min(r.right - popup.offsetWidth, innerWidth - popup.offsetWidth - 6)) + 'px';
  if (!isMobileView()) {
    const tile = activePanelTrigger.closest('.tile');
    const tileRect = tile && tile.getBoundingClientRect();
    if (tileRect) {
      const menuTop = r.bottom + 4;
      popup.style.maxHeight = Math.max(1, tileRect.bottom - menuTop) + 'px';
      popup.style.top = menuTop + 'px';
      return;
    }
  }
  const viewportTop = isMobileView() ? (visualViewport?.offsetTop || 0) : 0;
  const viewportBottom = isMobileView() ? viewportTop + (visualViewport?.height || innerHeight) - document.getElementById('mobileDock').offsetHeight : innerHeight;
  const top = Math.max(viewportTop, toolbar.getBoundingClientRect().bottom) + 6;
  const below = viewportBottom - r.bottom - 10;
  const above = r.top - top - 4;
  // Keep the toolbar mute and the owning header reachable when a long menu scrolls.
  const useBelow = below >= Math.min(320, popup.scrollHeight) || below >= above;
  popup.style.maxHeight = Math.max(80, useBelow ? below : above) + 'px';
  popup.style.top = Math.max(top, useBelow ? r.bottom + 4 : r.top - popup.offsetHeight - 4) + 'px';
}
function bindPanelMenu(trigger, popup) {
  trigger.addEventListener('click', () => {
    const wasOpen = activePanelTrigger === trigger;
    closePanelMenu(); closeCommandPopover();
    if (wasOpen) return;
    activePanelTrigger = trigger;
    const tile = trigger.closest('.tile');
    const heading = popup.querySelector('.panel-menu-title');
    if (heading) heading.textContent = 'Panel ' + (Number(tile.dataset.slot) + 1) + ' · ' + tile.querySelector('.name').textContent;
    popup.hidden = false; popup.showPopover(); positionPanelMenu();
    trigger.setAttribute('aria-expanded', 'true');
    (tile.classList.contains('empty') || tile.classList.contains('larson-desktop') ? popup.querySelector('.assign-session') : popup.querySelector('button')).focus();
  });
  popup.addEventListener('click', ev => {
    const button = ev.target.closest('button');
    if (button && !button.closest('.font-controls,.panel-hue,.hue-settings') && !button.hasAttribute('aria-pressed')) closePanelMenu(document.activeElement === button);
  });
  popup.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); closePanelMenu(true); return; }
    if (['SELECT', 'INPUT'].includes(ev.target.tagName) || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const items = Array.from(popup.querySelectorAll('button,select,input')).filter(el => !el.disabled && el.getClientRects().length);
    const index = items.indexOf(document.activeElement);
    let next;
    if (ev.key === 'ArrowDown') next = (index + 1) % items.length;
    if (ev.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    if (ev.key === 'Home') next = 0;
    if (ev.key === 'End') next = items.length - 1;
    if (next !== undefined) { ev.preventDefault(); items[next].focus(); }
    if (ev.key === 'Tab' && ((ev.shiftKey && index === 0) || (!ev.shiftKey && index === items.length - 1))) {
      ev.preventDefault(); closePanelMenu(true);
    }
  });
}
fillControlIcons(metaTerminal);
bindPanelMenu(document.getElementById('metaTools'), document.getElementById('metaMenu'));
document.addEventListener('pointerdown', ev => {
  if (activePanelTrigger && !ev.target.closest('.panel-menu') && !activePanelTrigger.contains(ev.target)) closePanelMenu();
});
document.addEventListener('focusin', ev => {
  if (activePanelTrigger && ev.target !== activePanelTrigger && !document.getElementById(activePanelTrigger.getAttribute('aria-controls')).contains(ev.target)) closePanelMenu();
});
window.addEventListener('resize', () => closePanelMenu(true));
board.addEventListener('scroll', () => closePanelMenu(true));

// Dialog popovers retain native select/Tab behavior; arrow keys move between commands.
let activeCommandTrigger = null;
function closeCommandPopover(restoreFocus = false) {
  if (!activeCommandTrigger) return;
  const trigger = activeCommandTrigger;
  document.getElementById(trigger.dataset.popover).hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  activeCommandTrigger = null;
  if (restoreFocus) trigger.focus();
}
function positionCommandPopover() {
  if (!activeCommandTrigger) return;
  const popup = document.getElementById(activeCommandTrigger.dataset.popover);
  const rect = activeCommandTrigger.getBoundingClientRect();
  popup.style.left = Math.max(6, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 6)) + 'px';
  popup.style.top = (toolbar.getBoundingClientRect().bottom + 4) + 'px';
}
for (const trigger of toolbar.querySelectorAll('[data-popover]')) {
  trigger.addEventListener('click', () => {
    const wasOpen = activeCommandTrigger === trigger;
    closeCommandPopover();
    if (wasOpen) return;
    activeCommandTrigger = trigger;
    const popup = document.getElementById(trigger.dataset.popover);
    popup.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    positionCommandPopover();
    popup.querySelector('button, select').focus();
  });
  trigger.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (activeCommandTrigger !== trigger) trigger.click();
      const items = document.getElementById(trigger.dataset.popover).querySelectorAll('button, select');
      items[ev.key === 'ArrowUp' ? items.length - 1 : 0].focus();
    }
  });
}
toolbar.addEventListener('keydown', ev => {
  // Never let toolbar interaction reach the board's tmux shortcuts.
  ev.stopPropagation();
  if (ev.key === 'Escape' && activeCommandTrigger) {
    ev.preventDefault(); closeCommandPopover(true); return;
  }
  const popup = ev.target.closest('.command-popover');
  if (!popup || ['SELECT', 'INPUT'].includes(ev.target.tagName) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const items = Array.from(popup.querySelectorAll('button:not([hidden]), select, input')).filter(el => !el.disabled && el.getClientRects().length);
  const index = items.indexOf(document.activeElement);
  let next;
  if (ev.key === 'ArrowDown') next = (index + 1) % items.length;
  if (ev.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
  if (ev.key === 'Home') next = 0;
  if (ev.key === 'End') next = items.length - 1;
  if (next !== undefined) { ev.preventDefault(); items[next].focus(); }
});
toolbar.addEventListener('click', ev => {
  const button = ev.target.closest('.command-popover button');
  if (button && !button.closest('.font-controls,.panel-hue,.hue-settings') && !button.hasAttribute('aria-pressed')) {
    const restore = document.activeElement === button;
    closeCommandPopover(restore);
  }
});
document.addEventListener('pointerdown', ev => {
  if (activeCommandTrigger && !ev.target.closest('.command-popover, [data-popover]')) closeCommandPopover();
});
document.addEventListener('focusin', ev => {
  if (activeCommandTrigger && ev.target !== activeCommandTrigger && !document.getElementById(activeCommandTrigger.dataset.popover).contains(ev.target)) closeCommandPopover();
});
window.addEventListener('resize', positionCommandPopover);
// Browser host maps both reload actions to the same page reload.
reloadWindowButton.hidden = Boolean(window.terminalTownBrowserHost);
compactButton.setAttribute('aria-pressed', String(compact));
toggleMetaButton.setAttribute('aria-controls', 'metaTerminal');
toggleMetaButton.setAttribute('aria-expanded', 'false');
function setToolbarCollapsed(collapsed) {
  if (!toolbar || !toggleToolbarButton) return;
  toolbar.classList.toggle('collapsed', collapsed);
  if (collapsed) closeCommandPopover();
  toggleToolbarButton.title = collapsed ? 'Show page controls' : 'Hide page controls';
  toggleToolbarButton.setAttribute('aria-label', toggleToolbarButton.title);
  toggleToolbarButton.setAttribute('aria-expanded', String(!collapsed));
}
try { setToolbarCollapsed(preferenceStorage.getItem('terminaltown-toolbar-collapsed') === '1'); } catch {}
toggleToolbarButton.addEventListener('click', () => {
  const collapsed = !toolbar.classList.contains('collapsed');
  setToolbarCollapsed(collapsed);
  try { preferenceStorage.setItem('terminaltown-toolbar-collapsed', collapsed ? '1' : '0'); } catch {}
});
newBoardButton.addEventListener('click', () => browserOpenBoard(true));
openBoardButton.addEventListener('click', showBoardPicker);
renameBoardButton.addEventListener('click', browserRenameBoard);
openMapButton.addEventListener('click', browserOpenMap);
document.getElementById('openEnvironments').addEventListener('click', () => {
  post('openEnvironments');
});
if (boardPickerClose) boardPickerClose.addEventListener('click', closeBoardPicker);
if (boardPicker) {
  boardPicker.addEventListener('click', (ev) => {
    if (ev.target === boardPicker) closeBoardPicker();
  });
}
if (boardPickerForm) boardPickerForm.addEventListener('submit', ev => {
  ev.preventDefault();
  const first = boardPickerList.querySelector('.board-picker-item');
  if (first) first.click();
});
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
if (recoveryEl) recoveryEl.querySelector('button').addEventListener('click', () => {
  if (recoveryEl.dataset.syncWarning) requestRefresh({ force: true });
  else post('recoverMissing');
});
reloadUiButton.addEventListener('click', () => post('reloadUi'));
reloadWindowButton.addEventListener('click', () => post('reloadWindow'));
autoButton.addEventListener('click', () => post('resetSlots'));
compactButton.addEventListener('click', () => {
  compact = !compact;
  preferenceStorage.setItem('terminaltown-compact', compact ? '1' : '0');
  board.classList.toggle('compact', compact);
  compactButton.setAttribute('aria-pressed', String(compact));
});
soundButton.addEventListener('click', () => setChimeSound(!(sound && !chimesMuted)));
muteChimesButton.addEventListener('click', () => setChimeSound(!(sound && !chimesMuted)));
playDiscoButton.addEventListener('click', () => {
  skin = 'disco';
  skinSelect.value = skin;
  preferenceStorage.setItem(boardSkinKey(), skin);
  document.body.dataset.skin = skin;
  updateTerminalTownFavicon();
  applyPanelHues();
  resetArcadeTrack();
  syncArcade();
  startDiscoSpectacle();
});
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);
skinSelect.addEventListener('change', () => {
  skin = skinSelect.value || 'system';
  preferenceStorage.setItem(boardSkinKey(), skin);
  document.body.dataset.skin = skin;
  updateTerminalTownFavicon();
  applyPanelHues();
  resetArcadeTrack();
  syncArcade();
  if (skin === 'disco') startDiscoSpectacle();
  else cancelDiscoSpectacle();
});
motionSelect.addEventListener('change', () => {
  motion = motionSelect.value || 'subtle';
  preferenceStorage.setItem('terminaltown-motion', motion);
  document.body.dataset.motion = motion;
  resetArcadeTrack();
  syncArcade();
  if (skin === 'disco') startDiscoSpectacle();
  else cancelDiscoSpectacle();
});
if (reduceMotion && reduceMotion.addEventListener) {
  reduceMotion.addEventListener('change', () => {
    syncArcade();
    if (reduceMotion.matches && spectacleActive()) endDiscoSpectacle();
  });
}
document.addEventListener('copy', (ev) => {
  if (forcedClipboardCopy && ev.clipboardData) {
    ev.clipboardData.setData('text/plain', forcedClipboardCopy.text);
    ev.preventDefault(); forcedClipboardCopy.written = true; return;
  }
  if (ev.defaultPrevented || editableTarget(ev.target)) return;
  if (ev.target.closest && ev.target.closest('.toolbar,.head,.board-picker,.panel-menu,.mobile-ui')) return;
  if (selectedText()) return;
  const text = slotOutput(selectedSlot);
  if (!text || !ev.clipboardData) return;
  ev.clipboardData.setData('text/plain', text);
  ev.preventDefault();
  note('Copied slot ' + (selectedSlot + 1));
});
if (clipboardProxy) {
  const recoverProxyInput = (ev) => {
    if (ev.isComposing || !clipboardProxy.value) return;
    const prompt = tiles.get(selectedSlot)?.querySelector('.prompt-input');
    if (!prompt) return;
    const text = clipboardProxy.value;
    clipboardProxy.value = '';
    prompt.setRangeText(text, prompt.selectionStart, prompt.selectionEnd, 'end');
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    prompt.focus({ preventScroll: true });
  };
  // Recover direct accessibility/IME insertion if an old focus reference still
  // targets the proxy. Never submit dictated text as a terminal command.
  clipboardProxy.addEventListener('input', recoverProxyInput);
  clipboardProxy.addEventListener('compositionend', recoverProxyInput);
}
document.addEventListener('paste', async (ev) => {
  if (ev.defaultPrevented) return;
  if (slotSessions[selectedSlot] === LARSON_DESKTOP_SESSION && !editableTarget(ev.target)) return;
  if (ev.target.closest && ev.target.closest('.toolbar,.head,.board-picker,.panel-menu,.mobile-ui')) return;
  pasteEventSerial += 1;
  const hasImages = Array.from(ev.clipboardData?.items || []).some(item => item.type.startsWith('image/'));
  const tile = ev.target.closest && ev.target.closest('.tile');
  const pasteSlot = tile?.dataset.slot !== undefined ? Number(tile.dataset.slot) : selectedSlot;
  const pasteSession = slotSessions[pasteSlot];
  if (hasImages) {
    ev.preventDefault();
    if (tile?.classList.contains('meta-panel-surface')) { note('Paste images into a panel prompt.'); return; }
  }
  try {
    const images = await clipboardImagesFromItems(ev.clipboardData && ev.clipboardData.items);
    if (images.length) {
      ev.preventDefault();
      if (slotSessions[pasteSlot] !== pasteSession) { note('The panel changed; paste the images again.'); return; }
      await pasteImagesToSlot(pasteSlot, images);
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
  if (document.getElementById('panelHealthDialog').open) return;
  if (sessionMemoryDialog.open) {
    if (ev.key === 'Escape') { ev.preventDefault(); closeMemoryDialog(); }
    return;
  }
  if (slotSessions[selectedSlot] === LARSON_DESKTOP_SESSION) return;
  if (ev.target.closest && ev.target.closest('.head,.panel-menu,.meta-terminal button,.mobile-ui,.session-memory-dialog')) return;
  if (boardPicker && boardPicker.classList.contains('visible')) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeBoardPicker();
    }
    return;
  }
  if (isMobileView()) return;
  const key = String(ev.key || '').toLowerCase();
  const editable = editableTarget(ev.target);
  // Keep native Cmd-C and its clipboard event, including at insecure HTTP origins.
  if (ev.metaKey && !ev.altKey && key === 'c') return;
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
    return;
  }
  if (/^[0-9]$/.test(ev.key)) {
    ev.preventDefault();
    post('key', { slot: selectedSlot, key: ev.key });
  }
});
window.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'moveResult') { finishPanelMove(msg); return; }
  if (msg.type === 'sessionDirectoryResult') { sessionFinderRecords = msg.records || []; renderSessionFinder(); return; }
  if (msg.type === 'sessionFocus') { pendingSessionFocus=msg.session || ''; applySessionFocus(); return; }
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
  if (msg.type === 'resizeResult') showResizeResult(msg.result);
  if (msg.type === 'syncWarning') {
    recoveryEl.classList.add('visible');
    recoveryEl.dataset.syncWarning = 'true';
    recoveryEl.querySelector('span').textContent = 'Panel out of sync. Session placement is unconfirmed.';
    recoveryEl.querySelector('span').title = msg.message;
    recoveryEl.querySelector('button').textContent = 'Refresh';
    note(msg.message);
  }
  if (msg.type === 'note') note(msg.message || '');
  if (msg.type === 'imageDraftResult') finishImageStage(msg);
  if (msg.type === 'clipboardImageDraft') acceptClipboardImageDraft(msg).catch(error => note(error.message));
  if (msg.type === 'promptResult') finishImageSend(msg);
  if (msg.type === 'metaResult') {
    const hasCommand = msg.command !== undefined;
    const agentRunning = msg.agentRunning === true || /^(?:codex|claude)(?:\\s|$)/i.test(String(msg.command || ''));
    const stopped = hasCommand && !agentRunning;
    const dormant = msg.dormant === true;
    updateMetaTranscript(stopped && !msg.output ? 'Saved Meta session is not running.' : msg.output, msg.cwd || '');
    if (Object.prototype.hasOwnProperty.call(msg, 'memory')) {
      metaMemoryRecord = { name: msg.session, display: 'Meta Terminal', memory: msg.memory };
      metaTerminal.querySelector('.meta-panel-surface').classList.toggle('has-memory', Boolean(msg.memory?.approvedCharter));
      if (sessionMemoryDialog.open && memoryDialogSlot === 'meta') populateMemoryDialog();
    }
    const metaMemoryVisible = metaTerminal.querySelector('.meta-panel-surface').classList.contains('has-memory');
    document.getElementById('metaMemory').textContent = dormant ? 'Memory saved' : stopped && metaMemoryVisible ? 'Memory · stopped' : 'Memory saved';
    if (msg.clearInput && msg.ok && pendingMetaDraft !== null) {
      if (metaGoal.value === pendingMetaDraft) { metaGoal.value = ''; resizePromptInput(metaGoal); }
      pendingMetaDraft = null;
    }
    metaLaunchButton.disabled = pendingMetaDraft !== null || (stopped && !dormant);
    for (const control of [metaEscButton, metaPasteButton, metaTabButton, metaEnterButton, metaCtrlCButton]) control.disabled = stopped;
    metaStatus.textContent = pendingMetaDraft !== null ? 'Sending…' : metaSendError || (dormant ? 'Ready' : stopped ? (metaMemoryVisible ? '' : 'Stopped · ') + (msg.command || 'missing') : (msg.command !== undefined
      ? (agentRunning ? 'Connected' : 'Stopped · ' + (msg.command || 'missing'))
      : (msg.session ? 'Connected' : '')));
  }
  if (msg.type === 'copyRequest') copySlot(selectedSlot).catch(() => note('Copy failed'));
  if (msg.type === 'pasteRequest') readClipboardAndPaste(Number.isInteger(Number(msg.slot)) ? Number(msg.slot) : selectedSlot);
});
let resizeRefreshTimer = null;
function handleViewportResize() {
  placeTiles();
  document.querySelectorAll('.prompt-input').forEach(resizePromptInput);
  clearTimeout(resizeRefreshTimer);
  resizeRefreshTimer = setTimeout(() => requestRefresh({ force: true }), 180);
}
window.addEventListener('resize', handleViewportResize);
if (window.ResizeObserver) {
  new ResizeObserver(handleViewportResize).observe(board);
}
let refreshInterval = null;
function armRefreshInterval() {
  clearInterval(refreshInterval);
  refreshInterval = setInterval(requestRefresh, document.hidden ? 30000 : 8000);
}
document.addEventListener('visibilitychange', () => {
  armRefreshInterval();
  if (!document.hidden) requestRefresh({ force: true });
});
${fs.readFileSync(path.join(__dirname, 'mobile.js'), 'utf8')}
${fs.readFileSync(path.join(__dirname, 'sessionFinder.js'), 'utf8')}
${fs.readFileSync(path.join(__dirname, 'panelHealth.js'), 'utf8')}
${fs.readFileSync(path.join(__dirname, 'panelHealthClient.js'), 'utf8')}
let preferencesApplied = false;
function applySyncedPreferences(changed) {
  const first = !preferencesApplied;
  preferencesApplied = true;
  const has = key => first || changed.includes(key);
  if (has('terminaltown-compact')) {
    compact = preferenceStorage.getItem('terminaltown-compact') === '1';
    board.classList.toggle('compact', compact); compactButton.setAttribute('aria-pressed', String(compact));
  }
  if (has('terminaltown-sound')) {
    sound = preferenceStorage.getItem('terminaltown-sound') !== '0';
    if (!sound || chimesMuted) stopAllChimes();
    updateSoundButton();
  }
  if (has(panelChimeKey())) for (const [slot, el] of tiles) { reconcilePanelChime(slot); updatePanelChimeControls(el, slot); }
  if (has(boardSkinKey()) || has('terminaltown-motion')) {
    const nextSkin = readBoardSkin();
    if (skin !== nextSkin) cancelDiscoSpectacle();
    skin = nextSkin; skinSelect.value = skin; document.body.dataset.skin = skin; updateTerminalTownFavicon();
    motion = preferenceStorage.getItem('terminaltown-motion') || 'subtle';
    motionSelect.value = motion; document.body.dataset.motion = motion;
    resetArcadeTrack(); syncArcade();
  }
  if (has('terminaltown-meta-dock')) setMetaDock(preferenceStorage.getItem('terminaltown-meta-dock') || 'side');
  if (has('terminaltown-bottom-bar-shape')) setMobileDockShape(preferenceStorage.getItem('terminaltown-bottom-bar-shape'));
  if (has('terminaltown-toolbar-collapsed')) setToolbarCollapsed(preferenceStorage.getItem('terminaltown-toolbar-collapsed') === '1');
  if (has('terminaltown-holding-open')) setHoldingOpen(preferenceStorage.getItem('terminaltown-holding-open') === '1', false);
  if (has('terminaltown-pinned-boards')) { pinnedBoards = storedBoardValue('terminaltown-pinned-boards', []); renderBoardPins(); }
  if (has('terminaltown-board-shortcut')) {
    boardShortcutSelect.value = preferenceStorage.getItem('terminaltown-board-shortcut') || 'alt';
    boardShortcutSelect.dispatchEvent(new Event('change'));
  }
  if (has(panelFontStorageKey())) { applyPanelFonts(); scheduleTileGeometryRefresh(); }
  if (has(panelHueKey()) || has(boardSkinKey())) applyPanelHues();
  if (has(mobileStorageKey())) { mobileStateBoard = ''; if (mobileReady) renderMobile(mobileLastData); }
  if (boardPicker.classList.contains('visible')) renderBoardPicker();
}
preferenceStorage.start(applySyncedPreferences, text => {
  const status = document.getElementById('preferenceSyncStatus'); status.textContent = text; status.hidden = !text;
});
requestRefresh();
armRefreshInterval();
</script>
</body>
</html>`;
}

const extensionPreferenceStore = require('./preferenceStore').createPreferenceStore();
function handlePreferenceMessage(msg, webview) {
  if (msg.type !== 'preferences') return false;
  try {
    const payload = msg.operations ? extensionPreferenceStore.patch(msg.device, msg.operations, msg.migrate === true) : extensionPreferenceStore.get(msg.device);
    webview.postMessage({ type: 'preferencesResult', requestId: msg.requestId, payload });
  } catch (error) {
    webview.postMessage({ type: 'preferencesResult', requestId: msg.requestId, error: error.message });
  }
  return true;
}

async function handlePanelHealthMessage(msg, webview, board) {
  if (msg.type === 'healthRefresh') {
    try { webview.postMessage({ type: 'healthData', data: await collect({ ...board, observeOnly: true }) }); } catch {}
    return true;
  }
  if (!['healthReport','healthLoad'].includes(msg.type)) return false;
  try {
    const response = await fetch('http://127.0.0.1:17876/api/health', {
      method: msg.type==='healthLoad'?'GET':'POST', headers: { 'content-type': 'application/json' }, body: msg.type==='healthLoad'?undefined:JSON.stringify(msg.report), signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw Error('Health history unavailable');
    webview.postMessage({ type: 'healthResult', loaded: msg.type==='healthLoad', snapshot: await response.json() });
  } catch { webview.postMessage({ type: 'healthResult', loaded: msg.type==='healthLoad', error: 'Health history unavailable' }); }
  return true;
}

function registerAiGridLegacy(context, vscode, log = () => {}, options = {}) {
  const commandPrefix = options.commandPrefix || 'larsonSummoner';
  const webviewType = options.webviewType || 'terminalTown';
  const openCommand = options.openCommand || (
    commandPrefix === 'larsonSummoner' ? 'larsonSummoner.aiGrid' : `${commandPrefix}.open`
  );
  let panel = null;
  let refreshing = false;
  let discoSettingsTimer = null;
  let refreshPausedUntil = 0;
  let refreshQueued = false;
  let refreshResumeTimer = null;
  let queuedRefreshOptions = {};
  let focusedSlot = 0;

  function discoBallAssetName() {
    const runtimeGif = path.join(context.extensionPath, 'assets', 'disco-ball-1280ms.gif');
    return fs.existsSync(runtimeGif) ? 'disco-ball-1280ms.gif' : 'disco-ball.gif';
  }

  function renderPanelHtml() {
    const assetRoot = vscode.Uri.joinPath(context.extensionUri, 'assets');
    const discoBallSrc = panel.webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, discoBallAssetName()));
    const purrSrc = panel.webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, 'purr.aiff'));
    const refractionSrc = panel.webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, 'disco-refractions.png'));
    const refractionFile = path.join(context.extensionPath, 'assets', 'disco-refractions.png');
    log(`rendering TerminalTown ${TERMINALTOWN_BUILD_TAG} from ${context.extensionPath}; disco refractions ${fs.existsSync(refractionFile) ? 'present' : 'missing'}`);
    return html(panel.webview, discoBallSrc, purrSrc, refractionSrc, readDiscoSettings(context, log));
  }

  async function reloadUi() {
    if (!panel) return;
    panel.webview.html = renderPanelHtml();
    await refresh();
  }

  function postDiscoSettings() {
    if (!panel) return;
    panel.webview.postMessage({ type: 'discoSettings', settings: readDiscoSettings(context, log) });
  }

  try {
    const watcher = fs.watch(discoSettingsPath(context), { persistent: false }, () => {
      clearTimeout(discoSettingsTimer);
      discoSettingsTimer = setTimeout(postDiscoSettings, 100);
    });
    context.subscriptions.push({
      dispose() {
        clearTimeout(discoSettingsTimer);
        watcher.close();
      },
    });
  } catch (e) {
    log(`disco settings watcher unavailable: ${e && e.message ? e.message : e}`);
  }

  function isRefreshPaused() {
    return Date.now() < refreshPausedUntil;
  }

  function mergeRefreshOptions(options = {}) {
    const slot = Number(options.focusedSlot);
    if (Number.isInteger(slot)) {
      focusedSlot = slot;
      queuedRefreshOptions.focusedSlot = slot;
    }
  }

  function armRefreshResume() {
    clearTimeout(refreshResumeTimer);
    const delay = Math.max(0, refreshPausedUntil - Date.now()) + 25;
    refreshResumeTimer = setTimeout(() => {
      refreshPausedUntil = 0;
      refreshResumeTimer = null;
      if (!refreshQueued) return;
      const options = queuedRefreshOptions;
      refreshQueued = false;
      queuedRefreshOptions = {};
      refresh({ ...options, force: true }).catch((e) => log(`ai grid refresh resume failed: ${e.message}`));
    }, delay);
  }

  function pauseRefresh(durationMs, options = {}) {
    const duration = clampNumber(durationMs, 5400, 300, 7000);
    refreshPausedUntil = Math.max(refreshPausedUntil, Date.now() + duration);
    refreshQueued = true;
    mergeRefreshOptions(options);
    armRefreshResume();
  }

  async function resumeRefresh(options = {}) {
    clearTimeout(refreshResumeTimer);
    refreshResumeTimer = null;
    refreshPausedUntil = 0;
    mergeRefreshOptions(options);
    if (!refreshQueued && !options.force) return;
    const queued = queuedRefreshOptions;
    refreshQueued = false;
    queuedRefreshOptions = {};
    await refresh({ ...queued, ...options, force: true });
  }

  async function refresh(options = {}) {
    if (!panel) return;
    if (!options.force && isRefreshPaused()) {
      refreshQueued = true;
      mergeRefreshOptions(options);
      return;
    }
    if (refreshing) {
      refreshQueued = true;
      mergeRefreshOptions(options);
      return;
    }
    refreshing = true;
    try {
      const slot = Number(options.focusedSlot);
      if (Number.isInteger(slot)) focusedSlot = slot;
      panel.webview.postMessage({ type: 'data', data: await collect(options) });
    } catch (e) {
      panel.webview.postMessage({ type: 'note', message: e.message });
      log(`ai grid refresh failed: ${e.message}`);
    } finally {
      refreshing = false;
      if (refreshQueued && !isRefreshPaused()) {
        const queued = queuedRefreshOptions;
        refreshQueued = false;
        queuedRefreshOptions = {};
        setTimeout(() => refresh({ ...queued, force: true }).catch((e) => log(`ai grid queued refresh failed: ${e.message}`)), 0);
      }
    }
  }

  async function recoverAndRefresh() {
    const result = await recoverMissingSessions();
    const message = `Recovery: indexed ${result.indexed}, adopted ${result.adopted}, spawned ${result.spawned}, skipped ${result.skipped}${result.errors.length ? `, errors ${result.errors.length}` : ''}`;
    if (panel) panel.webview.postMessage({ type: 'note', message });
    log(`${message}${result.errors.length ? `; ${result.errors.join('; ')}` : ''}`);
    await refresh({ force: true });
    return result;
  }

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.sendPrompt`, async () => {
    try {
      const session = await pickSession(vscode, 'Send Prompt Directly to Tmux Session');
      if (!session) return;
      const prompt = await vscode.window.showInputBox({
        title: `Prompt ${session}`,
        prompt: 'This sends through tmux directly, bypassing VS Code terminal keyboard input.',
        ignoreFocusOut: true,
      });
      if (!prompt || !prompt.trim()) return;
      await sendPrompt(session, prompt);
      vscode.window.showInformationMessage(`Sent prompt to ${session}`);
      await refresh();
    } catch (e) {
      vscode.window.showErrorMessage(`Send prompt failed: ${e.message}`);
      log(`ai grid direct prompt failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.sendEnter`, async () => {
    try {
      const session = await pickSession(vscode, 'Send Enter/Nudge Directly to Tmux Session');
      if (!session) return;
      await sendKey(session, 'enter');
      vscode.window.showInformationMessage(`Sent Enter to ${session}`);
      await refresh();
    } catch (e) {
      vscode.window.showErrorMessage(`Send Enter failed: ${e.message}`);
      log(`ai grid direct enter failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.reloadUi`, async () => {
    try {
      if (!panel) {
        await vscode.commands.executeCommand(openCommand);
        return;
      }
      await reloadUi();
      vscode.window.showInformationMessage('TerminalTown UI reloaded');
    } catch (e) {
      vscode.window.showErrorMessage(`Reload UI failed: ${e.message}`);
      log(`ai grid reload UI failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.recoverMissing`, async () => {
    try {
      const result = await recoverAndRefresh();
      vscode.window.showInformationMessage(`TerminalTown recovery indexed ${result.indexed}, adopted ${result.adopted}, spawned ${result.spawned}, skipped ${result.skipped}`);
      if (result.errors.length) vscode.window.showWarningMessage(`TerminalTown recovery errors: ${result.errors.slice(0, 2).join('; ')}`);
    } catch (e) {
      vscode.window.showErrorMessage(`Recovery failed: ${e.message}`);
      log(`ai grid recovery failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.newSession`, async () => {
    try {
      const session = await newSessionWizard(vscode);
      if (!session) return;
      vscode.window.showInformationMessage(`Started ${session}`);
      await refresh();
    } catch (e) {
      vscode.window.showErrorMessage(`New session failed: ${e.message}`);
      log(`ai grid new session failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.newClaudeSession`, async () => {
    try {
      const session = await newSessionWizard(vscode, null, 'claude');
      if (!session) return;
      vscode.window.showInformationMessage(`Started Claude session ${session}`);
      await refresh();
    } catch (e) {
      vscode.window.showErrorMessage(`New Claude session failed: ${e.message}`);
      log(`ai grid new Claude session failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.newCodexSession`, async () => {
    try {
      const session = await newSessionWizard(vscode, null, 'codex');
      if (!session) return;
      vscode.window.showInformationMessage(`Started Codex session ${session}`);
      await refresh();
    } catch (e) {
      vscode.window.showErrorMessage(`New Codex session failed: ${e.message}`);
      log(`ai grid new Codex session failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.renameSession`, async () => {
    try {
      const session = await pickSession(vscode, 'Rename AI Session Label');
      if (!session) return;
      const current = (titleMap().get(session) || {}).title || session;
      const title = await renameWizard(vscode, session, current);
      if (!title) return;
      vscode.window.showInformationMessage(`Renamed ${session} to ${title}`);
      await refresh();
    } catch (e) {
      vscode.window.showErrorMessage(`Rename failed: ${e.message}`);
      log(`ai grid rename failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.openTerminal`, async () => {
    try {
      const session = await pickSession(vscode, 'Open macOS Terminal on Larson Tmux Session');
      if (!session) return;
      const title = (titleMap().get(session) || {}).title || session;
      const result = await openFullTerminal(vscode, session, title);
      vscode.window.showInformationMessage(`${result === 'queued' ? 'Queued macOS Terminal' : 'Opened terminal'} for ${session}`);
    } catch (e) {
      vscode.window.showErrorMessage(`Open terminal failed: ${e.message}`);
      log(`ai grid open terminal failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(openCommand, async () => {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Beside);
      await refresh();
      return;
    }
    panel = vscode.window.createWebviewPanel(
      webviewType,
      'TerminalTown',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'assets')] }
    );
    panel.webview.html = renderPanelHtml();
    panel.onDidDispose(() => {
      clearTimeout(refreshResumeTimer);
      refreshResumeTimer = null;
      panel = null;
    }, null, context.subscriptions);
    panel.webview.onDidReceiveMessage(async (msg) => {
      if (handlePreferenceMessage(msg, panel.webview)) return;
      if (await handlePanelHealthMessage(msg, panel.webview, {})) return;
      try {
        if (msg.type === 'placeHeld') {
          await assignHeldBoard(String(msg.session || ''), String(msg.destinationBoardId || ''));
          await refresh();
          return;
        }
        if (msg.type === 'sessionDirectory') {
          panel.webview.postMessage({ type: 'sessionDirectoryResult', records: await sessionDirectory() });
          return;
        }
        if (msg.type === 'focusSlot') {
          const slot = Number(msg.slot);
          if (Number.isInteger(slot)) focusedSlot = slot;
          return;
        }
        if (msg.type === 'refresh') {
          await refresh({
            focusedSlot: Number(msg.focusedSlot),
            force: Boolean(msg.force),
            captureLinesBySlot: msg.captureLinesBySlot,
            terminalSizesBySlot: msg.terminalSizesBySlot,
          });
        }
        if (msg.type === 'spectacle') {
          if (msg.phase === 'start') pauseRefresh(Number(msg.durationMs), { focusedSlot: Number(msg.focusedSlot) });
          if (msg.phase === 'end') await resumeRefresh({ focusedSlot: Number(msg.focusedSlot), force: true });
          return;
        }
        if (msg.type === 'reloadUi') {
          await reloadUi();
          return;
        }
        if (msg.type === 'renameBoard') {
          const current = (await collect()).board.title || DEFAULT_BOARD_TITLE;
          const title = await vscode.window.showInputBox({
            title: 'Rename Board',
            prompt: 'Board display name',
            value: current,
            ignoreFocusOut: true,
          });
          if (title === undefined) return;
          if (!String(title).trim()) {
            vscode.window.showErrorMessage('Board name cannot be empty.');
            return;
          }
          const renamed = await renameBoardTitle(title);
          panel.title = renamed.title;
          panel.webview.postMessage({ type: 'note', message: `Renamed board to ${renamed.title}` });
          await refresh({ force: true });
          return;
        }
        if (msg.type === 'recoverMissing') {
          const result = await recoverAndRefresh();
          if (result.errors.length) panel.webview.postMessage({ type: 'note', message: `Recovery errors: ${result.errors.slice(0, 2).join('; ')}` });
          return;
        }
        if (msg.type === 'newSession') {
          const session = await newSessionWizard(vscode, Number(msg.slot), String(msg.kind || ''));
          if (session) {
            panel.webview.postMessage({ type: 'note', message: `Started ${session}` });
            await refresh();
          }
        }
        if (msg.type === 'assign') {
          await assignSlot(Number(msg.slot), String(msg.session || ''));
          await refresh();
        }
        if (msg.type === 'move') {
          if (msg.moveId) { panel.webview.postMessage(await movePanelResult(msg)); return; }
          await moveSlot(
            Number.isInteger(msg.fromSlot) ? msg.fromSlot : null,
            Number(msg.toSlot),
            String(msg.session || '')
          );
          await refresh();
        }
        if (msg.type === 'resize') {
          const result = await resizeSlot(Number(msg.slot), String(msg.direction || ''), Number(msg.columns), Number(msg.span));
          panel.webview.postMessage({ type: 'note', message: result.span === 2 ? `${result.session} is tall` : `${result.session} is normal height` });
          await refresh();
          panel.webview.postMessage({ type: 'resizeResult', result });
        }
        if (msg.type === 'showHeld') {
          const data = await collect();
          let slot = Number(msg.slot);
          if (!Number.isInteger(slot) || slot < 0 || slot >= data.sessions.length) {
            slot = data.sessions.findIndex((s) => !s.name);
          }
          if (slot === -1) {
            panel.webview.postMessage({ type: 'note', message: 'No empty slot; drag onto a slot to swap/replace.' });
          } else {
            await moveSlot(null, slot, String(msg.session || ''));
            await refresh();
          }
        }
        if (msg.type === 'resetCellSizes') {
          await resetCellSizes();
          await refresh();
          panel.webview.postMessage({ type: 'note', message: msg.resetKind === 'all' ? 'Board appearance restored' : 'Board cell sizes restored' });
          return;
        }
        if (msg.type === 'resetSlots') {
          await resetSlots();
          await refresh();
        }
        if (msg.type === 'reloadWindow') {
          await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
        if (msg.type === 'assignFirstEmpty') {
          const data = await collect();
          const slot = data.sessions.findIndex((s) => !s.name);
          if (slot === -1) {
            panel.webview.postMessage({ type: 'note', message: 'No empty slot; use a slot Assign menu.' });
          } else {
            await assignSlot(slot, String(msg.session || ''));
            await refresh();
          }
        }
        if (['memoryUpdateContext', 'memoryUpdateCharter', 'memoryApproveCharter', 'memoryRejectCharter'].includes(msg.type)) {
          const data = await collect();
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          if (!session || (msg.session && String(msg.session) !== session)) throw new Error('The selected panel changed; reopen session memory');
          try { updateSessionMemory(session, msg.type, msg); }
          catch (error) { panel.webview.postMessage({ type: 'note', message: error.message }); }
          await refresh();
        }
        if (msg.type === 'prompt') {
          const data = await collect();
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          const submitKey = String(msg.submitKey || 'enter');
          const result = await sendPanelPrompt(session, msg);
          panel.webview.postMessage(result);
          if (!result.ok) return;
          panel.webview.postMessage({ type: 'note', message: `${submitKey === 'tab' ? 'Queued' : 'Sent'} to ${session}` });
          await refresh();
        }
        if (msg.type === 'answerCodexQuestion') {
          const data = await collect();
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          await answerCodexQuestion(session, { callId: String(msg.callId || ''), answers: msg.answers });
          panel.webview.postMessage({ type: 'note', message: `Answered Codex question in ${session}` });
          await refresh();
        }
        if (msg.type === 'copyText') {
          const text = String(msg.text || '');
          if (!text) return;
          await vscode.env.clipboard.writeText(text);
          panel.webview.postMessage({ type: 'note', message: `Copied slot ${Number(msg.slot) + 1}` });
        }
        if (msg.type === 'pasteClipboardText') {
          const data = await collect();
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          const text = await vscode.env.clipboard.readText();
          if (!text) {
            panel.webview.postMessage({ type: 'note', message: 'Clipboard has no text.' });
          } else {
            await pasteText(session, text);
            panel.webview.postMessage({ type: 'note', message: `Pasted text to ${session}` });
            await refresh();
          }
        }
        if (msg.type === 'pasteText') {
          const data = await collect();
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          await pasteText(session, String(msg.text || ''));
          panel.webview.postMessage({ type: 'note', message: `Pasted text to ${session}` });
          await refresh();
        }
        if (msg.type === 'pasteImages') {
          const data = await collect();
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          const files = await pasteImages(session, msg.images);
          panel.webview.postMessage({ type: 'note', message: `Pasted ${files.length} image path${files.length === 1 ? '' : 's'} to ${session}` });
          await refresh();
        }
        if (msg.type === 'stageImages') {
          const data = await collect();
          const session = data.sessions[Number(msg.slot)]?.name;
          panel.webview.postMessage(await stageImageDraft(session, msg));
        }
        if (msg.type === 'rename') {
          const data = await collect();
          const picked = data.sessions[Number(msg.slot)];
          const session = picked && picked.name;
          if (!session) return;
          const title = typeof msg.title === 'string'
            ? await renameSessionLabel(session, msg.title)
            : await renameWizard(vscode, session, picked.title || session);
          if (title) {
            panel.webview.postMessage({ type: 'note', message: `Renamed ${session} to ${title}` });
            await refresh();
          }
        }
        if (msg.type === 'openTerminal') {
          const data = await collect();
          const picked = data.sessions[Number(msg.slot)];
          const session = picked && picked.name;
          if (!session) return;
          const result = await openFullTerminal(vscode, session, picked.title || picked.display || session);
          panel.webview.postMessage({ type: 'note', message: `${result === 'queued' ? 'Queued macOS Terminal' : 'Opened terminal'} for ${session}` });
        }
        if (msg.type === 'openExternal') {
          const uri = vscode.Uri.parse(String(msg.url || ''));
          if (!['file', 'http', 'https'].includes(uri.scheme)) throw new Error('Only file, http and https links can be opened.');
          await vscode.env.openExternal(uri);
          panel.webview.postMessage({ type: 'note', message: `Opened ${uri.toString()}` });
        }
        if (msg.type === 'bye') {
          const data = await collect();
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          if (!session) return;
          const choice = await vscode.window.showWarningMessage(
            `End tmux session ${session}? This permanently closes that Claude/Codex process.`,
            { modal: true },
            'Bye'
          );
          if (choice !== 'Bye') return;
          await byeSession(session);
          panel.webview.postMessage({ type: 'note', message: `Ended ${session}` });
          await refresh();
        }
        if (msg.type === 'key') {
          const data = await collect();
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          await sendKey(session, msg.key);
          panel.webview.postMessage({ type: 'note', message: `${msg.key === 'ctrl-c' ? 'Ctrl-C' : msg.key === 'enter' ? 'Enter' : 'Esc'} sent to ${session}` });
          await refresh();
        }
      } catch (e) {
        panel.webview.postMessage({ type: 'note', message: e.message });
        log(`ai grid command failed: ${e.message}`);
      }
    }, null, context.subscriptions);
    await refresh();
  }));
}

// postMessage(true) means delivered, not rendered. Confirm the actual panel slots.
function createPanelDelivery(webview, timeoutMs = 12000) {
  let sequence = 0;
  let pending = null;
  let disposed = false;
  function settle(error, renderId) {
    if (!pending || (renderId !== undefined && pending.renderId !== renderId)) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    if (error) current.reject(error);
    else current.resolve(current.data);
  }
  return {
    async send(data) {
      if (disposed) throw new Error('Panel is closed.');
      if (pending) throw new Error('A panel update is already awaiting confirmation.');
      const renderId = ++sequence;
      const confirmed = new Promise((resolve, reject) => {
        pending = { renderId, data, resolve, reject,
          timer: setTimeout(() => settle(new Error('Panel rendering confirmation timed out.'), renderId), timeoutMs) };
      });
      // Register the acknowledgement before posting: the webview may reply immediately.
      Promise.resolve().then(() => webview.postMessage({ type: 'data', data: { ...data, renderId } }))
        .then(posted => { if (posted === false) settle(new Error('Panel update was not delivered.'), renderId); }, error => settle(error, renderId));
      return confirmed;
    },
    acknowledge(message) {
      if (!pending || message.renderId !== pending.renderId) return;
      const data = pending.data;
      const expected = (data.sessions || []).map(session => session.name || '');
      if (message.accepted !== true || message.boardId !== data.board.id ||
          message.layoutRevision !== data.board.layoutRevision ||
          JSON.stringify(message.slots) !== JSON.stringify(expected) ||
          JSON.stringify(message.holding || []) !== JSON.stringify(data.holding || [])) {
        settle(new Error('Panel rendering does not match the saved board.'));
      } else settle();
    },
    dispose() { disposed = true; settle(new Error('Panel closed before rendering was confirmed.')); },
  };
}

function registerAiGrid(context, vscode, log = () => {}, options = {}) {
  const commandPrefix = options.commandPrefix || 'larsonSummoner';
  const webviewType = options.webviewType || 'terminalTown';
  const openCommand = options.openCommand || (
    commandPrefix === 'larsonSummoner' ? 'larsonSummoner.aiGrid' : `${commandPrefix}.open`
  );
  const openBoardCommand = options.openBoardCommand || (
    commandPrefix === 'larsonSummoner' ? 'larsonSummoner.aiGridBoard' : `${commandPrefix}.openBoard`
  );
  const controllers = new Map();
  let activeBoardId = DEFAULT_BOARD_ID;
  let discoSettingsTimer = null;

  function commandBoard(controller) {
    return controller ? controller.board : { boardId: DEFAULT_BOARD_ID, boardTitle: DEFAULT_BOARD_TITLE };
  }

  function controllerFocusedSlot(controller) {
    const slot = Number(controller && controller.focusedSlot);
    return Number.isInteger(slot) && slot >= 0 ? slot : 0;
  }

  function activeController() {
    return controllers.get(activeBoardId) || controllers.values().next().value || null;
  }

  function knownBoards() {
    const boards = new Map();
    const add = (input) => {
      const ctx = boardContext(input);
      boards.set(ctx.id, { id: ctx.id, title: ctx.title });
    };
    add({ boardId: DEFAULT_BOARD_ID, boardTitle: DEFAULT_BOARD_TITLE });
    for (const file of [LAYOUT_FILE, ...(fs.existsSync(BOARDS_DIR) ? fs.readdirSync(BOARDS_DIR).map((name) => path.join(BOARDS_DIR, name)) : [])]) {
      if (!/\.json$/i.test(file)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        const id = parsed.boardId || (file === LAYOUT_FILE ? DEFAULT_BOARD_ID : path.basename(file, '.json'));
        add({ boardId: id, boardTitle: parsed.boardTitle || parsed.title || '' });
      } catch {}
    }
    return [...boards.values()].sort((a, b) => (a.id === DEFAULT_BOARD_ID ? -1 : b.id === DEFAULT_BOARD_ID ? 1 : a.title.localeCompare(b.title)));
  }

  async function promptNewBoard() {
    const title = await vscode.window.showInputBox({
      title: 'TerminalTown Board Name',
      prompt: 'Example: Project A',
      validateInput: (value) => cleanTitle(value) ? null : 'Enter a board name.',
      ignoreFocusOut: true,
    });
    if (!title) return null;
    return { boardId: cleanBoardId(title), boardTitle: cleanBoardTitle(title, cleanBoardId(title)) };
  }

  async function promptBoard() {
    const items = [
      ...knownBoards().map((board) => ({
        label: board.title,
        description: board.id,
        board,
      })),
      { label: 'New Board', description: 'Create/open another TerminalTown instance', create: true },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Open TerminalTown Board',
      placeHolder: 'Choose a board, or create one for a project',
      matchOnDescription: true,
      ignoreFocusOut: true,
    });
    if (!picked) return null;
    if (!picked.create) return { boardId: picked.board.id, boardTitle: picked.board.title };
    return promptNewBoard();
  }

  function discoBallAssetName() {
    const runtimeGif = path.join(context.extensionPath, 'assets', 'disco-ball-1280ms.gif');
    return fs.existsSync(runtimeGif) ? 'disco-ball-1280ms.gif' : 'disco-ball.gif';
  }

  function renderPanelHtml(controller) {
    const assetRoot = vscode.Uri.joinPath(context.extensionUri, 'assets');
    const discoBallSrc = controller.panel.webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, discoBallAssetName()));
    const purrSrc = controller.panel.webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, 'purr.aiff'));
    const refractionSrc = controller.panel.webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, 'disco-refractions.png'));
    const refractionFile = path.join(context.extensionPath, 'assets', 'disco-refractions.png');
    log(`rendering TerminalTown ${TERMINALTOWN_BUILD_TAG} board ${controller.board.boardId} from ${context.extensionPath}; disco refractions ${fs.existsSync(refractionFile) ? 'present' : 'missing'}`);
    return html(controller.panel.webview, discoBallSrc, purrSrc, refractionSrc, readDiscoSettings(context, log));
  }

  function postDiscoSettings() {
    for (const controller of controllers.values()) {
      controller.panel.webview.postMessage({ type: 'discoSettings', settings: readDiscoSettings(context, log) });
    }
  }

  try {
    const watcher = fs.watch(discoSettingsPath(context), { persistent: false }, () => {
      clearTimeout(discoSettingsTimer);
      discoSettingsTimer = setTimeout(postDiscoSettings, 100);
    });
    context.subscriptions.push({
      dispose() {
        clearTimeout(discoSettingsTimer);
        watcher.close();
      },
    });
  } catch (e) {
    log(`disco settings watcher unavailable: ${e && e.message ? e.message : e}`);
  }

  async function refreshController(controller, refreshOptions = {}) {
    if (!controller || !controller.panel || controller.disposed || !controller.ready) return;
    const focusedSlot = Number(refreshOptions.focusedSlot);
    if (Number.isInteger(focusedSlot)) controller.focusedSlot = focusedSlot;
    if (!refreshOptions.force && Date.now() < controller.refreshPausedUntil) {
      controller.refreshQueued = true;
      mergeRefreshOptions(controller, refreshOptions);
      return;
    }
    if (controller.refreshing) {
      // A launch must wait for a NEW capture, not return when an older one is busy.
      if (refreshOptions.force) {
        // Coalesce callers waiting behind the same capture. Otherwise periodic
        // and geometry refreshes can delay a launch through many timeout cycles.
        if (!controller.nextForcedRefresh) {
          controller.nextForcedRefresh = controller.refreshPromise.then(() => {
            controller.nextForcedRefresh = null;
            return refreshController(controller, refreshOptions);
          });
        }
        return controller.nextForcedRefresh;
      }
      controller.refreshQueued = true;
      mergeRefreshOptions(controller, refreshOptions);
      return;
    }
    controller.refreshing = true;
    controller.refreshPromise = (async () => {
      try {
        const data = await collect({
          ...controller.board,
          focusedSlot: Number(refreshOptions.focusedSlot),
          captureLinesBySlot: refreshOptions.captureLinesBySlot,
          terminalSizesBySlot: refreshOptions.terminalSizesBySlot,
        });
        const confirmed = await controller.delivery.send(data);
        controller.syncWarning = false;
        return confirmed;
      } catch (e) {
        if (!controller.disposed) {
          const message = `TerminalTown panel is out of sync: ${e.message} Sessions remain running; retry Refresh.`;
          controller.panel.webview.postMessage({ type: 'syncWarning', message });
          if (!controller.syncWarning) vscode.window.showWarningMessage(message);
          controller.syncWarning = true;
          log(`ai grid refresh failed for ${controller.board.boardId}: ${e.message}`);
        }
        return null;
      } finally {
        controller.refreshing = false;
        if (!controller.disposed && controller.refreshQueued && Date.now() >= controller.refreshPausedUntil) {
          const queued = controller.queuedRefreshOptions;
          controller.refreshQueued = false;
          controller.queuedRefreshOptions = {};
          setTimeout(() => refreshController(controller, queued).catch((e) => log(`ai grid queued refresh failed: ${e.message}`)), 0);
        }
      }
    })();
    return controller.refreshPromise;
  }

  async function confirmLaunchedSession(controller, session) {
    if (!controller.ready) await withinTimeout(controller.readyPromise, 12000, 'Panel startup');
    const data = await refreshController(controller, { force: true });
    if (!data || !(data.sessions.some(item => item.name === session) || (data.holding || []).includes(session))) {
      throw new Error(`${session} started, but its placement in the panel could not be confirmed. Do not launch a duplicate; refresh the board.`);
    }
  }

  function mergeRefreshOptions(controller, refreshOptions = {}) {
    const focusedSlot = Number(refreshOptions.focusedSlot);
    if (Number.isInteger(focusedSlot)) controller.queuedRefreshOptions.focusedSlot = focusedSlot;
  }

  function armRefreshResume(controller) {
    clearTimeout(controller.refreshResumeTimer);
    const delay = Math.max(0, controller.refreshPausedUntil - Date.now()) + 25;
    controller.refreshResumeTimer = setTimeout(() => {
      controller.refreshPausedUntil = 0;
      controller.refreshResumeTimer = null;
      if (!controller.refreshQueued) return;
      const queued = controller.queuedRefreshOptions;
      controller.refreshQueued = false;
      controller.queuedRefreshOptions = {};
      refreshController(controller, { ...queued, force: true }).catch((e) => log(`ai grid refresh resume failed: ${e.message}`));
    }, delay);
  }

  function pauseRefresh(controller, durationMs, refreshOptions = {}) {
    const duration = clampNumber(durationMs, 5400, 300, 7000);
    controller.refreshPausedUntil = Math.max(controller.refreshPausedUntil, Date.now() + duration);
    controller.refreshQueued = true;
    mergeRefreshOptions(controller, refreshOptions);
    armRefreshResume(controller);
  }

  async function resumeRefresh(controller, refreshOptions = {}) {
    clearTimeout(controller.refreshResumeTimer);
    controller.refreshResumeTimer = null;
    controller.refreshPausedUntil = 0;
    mergeRefreshOptions(controller, refreshOptions);
    if (!controller.refreshQueued && !refreshOptions.force) return;
    const queued = controller.queuedRefreshOptions;
    controller.refreshQueued = false;
    controller.queuedRefreshOptions = {};
    await refreshController(controller, { ...queued, ...refreshOptions, force: true });
  }

  async function recoverAndRefresh(controller) {
    const result = await recoverMissingSessions(controller.board);
    const message = `Recovery: indexed ${result.indexed}, adopted ${result.adopted}, spawned ${result.spawned}, skipped ${result.skipped}${result.errors.length ? `, errors ${result.errors.length}` : ''}`;
    controller.panel.webview.postMessage({ type: 'note', message });
    log(`${message}${result.errors.length ? `; ${result.errors.join('; ')}` : ''}`);
    await refreshController(controller, { force: true });
    return result;
  }

  async function openBoardPanel(boardInput = {}) {
    const ctx = boardContext(boardInput);
    const existing = controllers.get(ctx.id);
    if (existing) {
      activeBoardId = ctx.id;
      existing.panel.reveal(vscode.ViewColumn.Beside);
      await refreshController(existing, { force: true });
      return existing;
    }
    const controller = {
      board: { boardId: ctx.id, boardTitle: ctx.title },
      focusedSlot: 0,
      panel: vscode.window.createWebviewPanel(
        webviewType,
        ctx.title,
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'assets')] }
      ),
      refreshing: false,
      refreshPausedUntil: 0,
      refreshQueued: false,
      refreshResumeTimer: null,
      queuedRefreshOptions: {},
      refreshInterval: null,
    };
    controller.readyPromise = new Promise(resolve => { controller.resolveReady = resolve; });
    controller.delivery = createPanelDelivery(controller.panel.webview);
    controllers.set(ctx.id, controller);
    activeBoardId = ctx.id;
    controller.panel.webview.html = renderPanelHtml(controller);
    controller.refreshInterval = setInterval(() => refreshController(controller).catch((e) => log(`ai grid interval refresh failed: ${e.message}`)), 6000);
    controller.panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.visible) activeBoardId = ctx.id;
    }, null, context.subscriptions);
    controller.panel.onDidDispose(() => {
      controller.disposed = true;
      controller.resolveReady();
      controller.delivery.dispose();
      clearTimeout(controller.refreshResumeTimer);
      clearInterval(controller.refreshInterval);
      controllers.delete(ctx.id);
      if (activeBoardId === ctx.id) activeBoardId = DEFAULT_BOARD_ID;
    }, null, context.subscriptions);
    controller.panel.webview.onDidReceiveMessage(async (msg) => {
      if (handlePreferenceMessage(msg, controller.panel.webview)) return;
      if (await handlePanelHealthMessage(msg, controller.panel.webview, controller.board)) return;
      if (msg.type === 'rendered') { controller.delivery.acknowledge(msg); return; }
      try {
        if (msg.type === 'placeHeld') {
          await assignHeldBoard(String(msg.session || ''), String(msg.destinationBoardId || ''));
          await refreshController(controller, {force:true});
          return;
        }
        if (msg.type === 'sessionDirectory') {
          controller.panel.webview.postMessage({ type: 'sessionDirectoryResult', records: await sessionDirectory() });
          return;
        }
        if (msg.type === 'findSession') {
          const destination = await openBoardPanel({boardId:msg.boardId});
          await destination.readyPromise;
          destination.panel.webview.postMessage({type:'sessionFocus', session:msg.session});
          await refreshController(destination, {force:true});
          return;
        }
        if (msg.type === 'focusSlot') {
          const slot = Number(msg.slot);
          if (Number.isInteger(slot)) controller.focusedSlot = slot;
          return;
        }
        if (msg.type === 'refresh') {
          controller.ready = true;
          controller.resolveReady();
          await refreshController(controller, {
            focusedSlot: Number(msg.focusedSlot),
            force: Boolean(msg.force),
            captureLinesBySlot: msg.captureLinesBySlot,
            terminalSizesBySlot: msg.terminalSizesBySlot,
          });
          return;
        }
        if (msg.type === 'spectacle') {
          if (msg.phase === 'start') pauseRefresh(controller, Number(msg.durationMs), { focusedSlot: Number(msg.focusedSlot) });
          if (msg.phase === 'end') await resumeRefresh(controller, { focusedSlot: Number(msg.focusedSlot), force: true });
          return;
        }
        if (msg.type === 'openBoard') {
          await vscode.commands.executeCommand(openBoardCommand, msg.boardId ? { boardId: msg.boardId, boardTitle: msg.boardTitle } : null);
          return;
        }
        if (msg.type === 'newBoard') {
          await vscode.commands.executeCommand(openBoardCommand, { create: true });
          return;
        }
        if (msg.type === 'renameBoard') {
          const title = await vscode.window.showInputBox({
            title: 'Rename Board',
            prompt: 'Board display name',
            value: controller.board.boardTitle,
            ignoreFocusOut: true,
          });
          if (title === undefined) return;
          if (!String(title).trim()) {
            vscode.window.showErrorMessage('Board name cannot be empty.');
            return;
          }
          const renamed = await renameBoardTitle(title, controller.board);
          controller.board.boardTitle = renamed.title;
          controller.panel.title = renamed.title;
          controller.panel.webview.postMessage({ type: 'note', message: `Renamed board to ${renamed.title}` });
          await refreshController(controller, { force: true });
          return;
        }
        if (msg.type === 'openEnvironments') {
          vscode.window.showInformationMessage('Environment dashboards are configured by the host application.');
          return;
        }
        if (msg.type === 'openMap') {
          await vscode.commands.executeCommand(`${commandPrefix}.openJarganMap`);
          return;
        }
        if (msg.type === 'setGrid') {
          const grid = await setGridShape(Number(msg.columns), Number(msg.rows), controller.board);
          controller.panel.webview.postMessage({ type: 'note', message: `Grid set to ${gridLabel(grid)}` });
          await refreshController(controller, { force: true });
          return;
        }
        if (msg.type === 'reloadUi') {
          controller.panel.webview.html = renderPanelHtml(controller);
          await refreshController(controller, { force: true });
          return;
        }
        if (msg.type === 'recoverMissing') {
          const result = await recoverAndRefresh(controller);
          if (result.errors.length) controller.panel.webview.postMessage({ type: 'note', message: `Recovery errors: ${result.errors.slice(0, 2).join('; ')}` });
          return;
        }
        if (msg.type === 'newSession') {
          const session = await newSessionWizard(vscode, Number(msg.slot), String(msg.kind || ''), controller.board);
          if (session) {
            await confirmLaunchedSession(controller, session);
            controller.panel.webview.postMessage({ type: 'note', message: `Started ${session}` });
          }
          return;
        }
        if (msg.type === 'assign') {
          await assignSlot(Number(msg.slot), String(msg.session || ''), controller.board);
          await refreshController(controller, { force: true });
          return;
        }
        if (msg.type === 'move') {
          if (msg.moveId) { controller.panel.webview.postMessage(await movePanelResult(msg, controller.board)); return; }
          await moveSlot(Number.isInteger(msg.fromSlot) ? msg.fromSlot : null, Number(msg.toSlot), String(msg.session || ''), controller.board);
          await refreshController(controller, { force: true });
          return;
        }
        if (msg.type === 'resize') {
          const result = await resizeSlot(Number(msg.slot), String(msg.direction || ''), Number(msg.columns), Number(msg.span), controller.board);
          controller.panel.webview.postMessage({ type: 'note', message: result.span === 2 ? `${result.session} is tall` : `${result.session} is normal height` });
          await refreshController(controller, { force: true });
          controller.panel.webview.postMessage({ type: 'resizeResult', result });
          return;
        }
        if (msg.type === 'showHeld') {
          const data = await collect(controller.board);
          let slot = Number(msg.slot);
          if (!Number.isInteger(slot) || slot < 0 || slot >= data.sessions.length) {
            slot = data.sessions.findIndex((s) => !s.name);
          }
          if (slot === -1) {
            controller.panel.webview.postMessage({ type: 'note', message: 'No empty slot; drag onto a slot to swap/replace.' });
          } else {
            await moveSlot(null, slot, String(msg.session || ''), controller.board);
            await refreshController(controller, { force: true });
          }
          return;
        }
        if (msg.type === 'resetCellSizes') {
          await resetCellSizes(controller.board);
          await refreshController(controller, { force: true });
          controller.panel.webview.postMessage({ type: 'note', message: msg.resetKind === 'all' ? 'Board appearance restored' : 'Board cell sizes restored' });
          return;
        }
        if (msg.type === 'resetSlots') {
          await resetSlots(controller.board);
          await refreshController(controller, { force: true });
          return;
        }
        if (msg.type === 'reloadWindow') {
          await vscode.commands.executeCommand('workbench.action.reloadWindow');
          return;
        }
        if (msg.type === 'assignFirstEmpty') {
          const data = await collect(controller.board);
          const slot = data.sessions.findIndex((s) => !s.name);
          if (slot === -1) {
            controller.panel.webview.postMessage({ type: 'note', message: 'No empty slot; use a slot Assign menu.' });
          } else {
            await assignSlot(slot, String(msg.session || ''), controller.board);
            await refreshController(controller, { force: true });
          }
          return;
        }
        if (['memoryUpdateContext', 'memoryUpdateCharter', 'memoryApproveCharter', 'memoryRejectCharter'].includes(msg.type)) {
          const data = await collect(controller.board);
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          if (!session || (msg.session && String(msg.session) !== session)) throw new Error('The selected panel changed; reopen session memory');
          try { updateSessionMemory(session, msg.type, msg); }
          catch (error) { controller.panel.webview.postMessage({ type: 'note', message: error.message }); }
          await refreshController(controller, { force: true });
          return;
        }
        if (msg.type === 'prompt') {
          const data = await collect(controller.board);
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          const submitKey = String(msg.submitKey || 'enter');
          const result = await sendPanelPrompt(session, msg);
          controller.panel.webview.postMessage(result);
          if (!result.ok) return;
          controller.panel.webview.postMessage({ type: 'note', message: `${submitKey === 'tab' ? 'Queued' : 'Sent'} to ${session}` });
          await refreshController(controller, { force: true });
          return;
        }
        if (msg.type === 'answerCodexQuestion') {
          const data = await collect(controller.board);
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          await answerCodexQuestion(session, { callId: String(msg.callId || ''), answers: msg.answers });
          controller.panel.webview.postMessage({ type: 'note', message: `Answered Codex question in ${session}` });
          await refreshController(controller, { force: true });
          return;
        }
        if (msg.type === 'copyText') {
          const text = String(msg.text || '');
          if (!text) return;
          await vscode.env.clipboard.writeText(text);
          controller.panel.webview.postMessage({ type: 'note', message: `Copied slot ${Number(msg.slot) + 1}` });
          return;
        }
        if (msg.type === 'pasteClipboardText') {
          const data = await collect(controller.board);
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          const text = await vscode.env.clipboard.readText();
          if (!text) {
            controller.panel.webview.postMessage({ type: 'note', message: 'Clipboard has no text.' });
          } else {
            await pasteText(session, text);
            controller.panel.webview.postMessage({ type: 'note', message: `Pasted text to ${session}` });
            await refreshController(controller, { force: true });
          }
          return;
        }
        if (msg.type === 'pasteText') {
          const data = await collect(controller.board);
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          await pasteText(session, String(msg.text || ''));
          controller.panel.webview.postMessage({ type: 'note', message: `Pasted text to ${session}` });
          await refreshController(controller, { force: true });
          return;
        }
        if (msg.type === 'pasteImages') {
          const data = await collect(controller.board);
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          const files = await pasteImages(session, msg.images);
          controller.panel.webview.postMessage({ type: 'note', message: `Pasted ${files.length} image path${files.length === 1 ? '' : 's'} to ${session}` });
          await refreshController(controller, { force: true });
          return;
        }
        if (msg.type === 'stageImages') {
          const data = await collect(controller.board);
          const session = data.sessions[Number(msg.slot)]?.name;
          controller.panel.webview.postMessage(await stageImageDraft(session, msg));
          return;
        }
        if (msg.type === 'rename') {
          const data = await collect(controller.board);
          const picked = data.sessions[Number(msg.slot)];
          const session = picked && picked.name;
          if (!session) return;
          const title = typeof msg.title === 'string'
            ? await renameSessionLabel(session, msg.title)
            : await renameWizard(vscode, session, picked.title || session);
          if (title) {
            controller.panel.webview.postMessage({ type: 'note', message: `Renamed ${session} to ${title}` });
            await refreshController(controller, { force: true });
          }
          return;
        }
        if (msg.type === 'openTerminal') {
          const data = await collect(controller.board);
          const picked = data.sessions[Number(msg.slot)];
          const session = picked && picked.name;
          if (!session) return;
          const result = await openFullTerminal(vscode, session, picked.title || picked.display || session);
          controller.panel.webview.postMessage({ type: 'note', message: `${result === 'queued' ? 'Queued macOS Terminal' : 'Opened terminal'} for ${session}` });
          return;
        }
        if (msg.type === 'openExternal') {
          const uri = vscode.Uri.parse(String(msg.url || ''));
          if (!['file', 'http', 'https'].includes(uri.scheme)) throw new Error('Only file, http and https links can be opened.');
          await vscode.env.openExternal(uri);
          controller.panel.webview.postMessage({ type: 'note', message: `Opened ${uri.toString()}` });
          return;
        }
        if (msg.type === 'bye') {
          const data = await collect(controller.board);
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          if (!session) return;
          const choice = await vscode.window.showWarningMessage(
            `End tmux session ${session}? This permanently closes that Claude/Codex process.`,
            { modal: true },
            'Bye'
          );
          if (choice !== 'Bye') return;
          await byeSession(session, controller.board);
          controller.panel.webview.postMessage({ type: 'note', message: `Ended ${session}` });
          await refreshController(controller, { force: true });
          return;
        }
        if (msg.type === 'key') {
          const data = await collect(controller.board);
          const session = data.sessions[Number(msg.slot)] && data.sessions[Number(msg.slot)].name;
          await sendKey(session, msg.key);
          controller.panel.webview.postMessage({ type: 'note', message: `${msg.key === 'ctrl-c' ? 'Ctrl-C' : msg.key === 'enter' ? 'Enter' : 'Esc'} sent to ${session}` });
          await refreshController(controller, { force: true });
        }
      } catch (e) {
        controller.panel.webview.postMessage({ type: 'note', message: e.message });
        log(`ai grid command failed for ${controller.board.boardId}: ${e.message}`);
      }
    }, null, context.subscriptions);
    await refreshController(controller, { force: true });
    return controller;
  }

  async function refreshOpenControllers(refreshOptions = {}) {
    await Promise.all([...controllers.values()].map((controller) => refreshController(controller, refreshOptions)));
  }

  async function selectedSession(controller) {
    const slot = controllerFocusedSlot(controller);
    const data = await collect(controller.board);
    const session = data.sessions[slot] || null;
    if (!session || !session.name) throw new Error(`No session in slot ${slot + 1}`);
    return { slot, session };
  }

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.copy`, async () => {
    try {
      const controller = activeController() || await openBoardPanel();
      const posted = await controller.panel.webview.postMessage({ type: 'copyRequest' });
      if (posted) return;
      const picked = await selectedSession(controller);
      await vscode.env.clipboard.writeText(String(picked.session.output || ''));
      vscode.window.showInformationMessage(`Copied slot ${picked.slot + 1}`);
    } catch (e) {
      vscode.window.showErrorMessage(`TerminalTown copy failed: ${e.message}`);
      log(`TerminalTown copy failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.paste`, async () => {
    try {
      const controller = activeController() || await openBoardPanel();
      const slot = controllerFocusedSlot(controller);
      const posted = await controller.panel.webview.postMessage({ type: 'pasteRequest', slot });
      if (posted) return;
      const picked = await selectedSession(controller);
      const text = await vscode.env.clipboard.readText();
      if (text) {
        await pasteText(picked.session.name, text);
        controller.panel.webview.postMessage({ type: 'note', message: `Pasted text to ${picked.session.name}` });
        await refreshController(controller, { focusedSlot: picked.slot, force: true });
        return;
      }
      // Without a connected panel there is no draft UI in which to remove an
      // attachment. Never push an image directly into its native composer.
      await controller.panel.webview.postMessage({ type: 'pasteRequest', slot: picked.slot });
    } catch (e) {
      vscode.window.showErrorMessage(`TerminalTown paste failed: ${e.message}`);
      log(`TerminalTown paste failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.sendPrompt`, async () => {
    try {
      const session = await pickSession(vscode, 'Send Prompt Directly to Tmux Session');
      if (!session) return;
      const prompt = await vscode.window.showInputBox({
        title: `Prompt ${session}`,
        prompt: 'This sends through tmux directly, bypassing VS Code terminal keyboard input.',
        ignoreFocusOut: true,
      });
      if (!prompt || !prompt.trim()) return;
      await sendPrompt(session, prompt);
      vscode.window.showInformationMessage(`Sent prompt to ${session}`);
      await refreshOpenControllers();
    } catch (e) {
      vscode.window.showErrorMessage(`Send prompt failed: ${e.message}`);
      log(`ai grid direct prompt failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.sendEnter`, async () => {
    try {
      const session = await pickSession(vscode, 'Send Enter/Nudge Directly to Tmux Session');
      if (!session) return;
      await sendKey(session, 'enter');
      vscode.window.showInformationMessage(`Sent Enter to ${session}`);
      await refreshOpenControllers();
    } catch (e) {
      vscode.window.showErrorMessage(`Send Enter failed: ${e.message}`);
      log(`ai grid direct enter failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.reloadUi`, async () => {
    try {
      const controller = activeController() || await openBoardPanel();
      controller.panel.webview.html = renderPanelHtml(controller);
      await refreshController(controller, { force: true });
      vscode.window.showInformationMessage('TerminalTown UI reloaded');
    } catch (e) {
      vscode.window.showErrorMessage(`Reload UI failed: ${e.message}`);
      log(`ai grid reload UI failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.recoverMissing`, async () => {
    try {
      const controller = activeController() || await openBoardPanel();
      const result = await recoverAndRefresh(controller);
      vscode.window.showInformationMessage(`TerminalTown recovery indexed ${result.indexed}, adopted ${result.adopted}, spawned ${result.spawned}, skipped ${result.skipped}`);
      if (result.errors.length) vscode.window.showWarningMessage(`TerminalTown recovery errors: ${result.errors.slice(0, 2).join('; ')}`);
    } catch (e) {
      vscode.window.showErrorMessage(`Recovery failed: ${e.message}`);
      log(`ai grid recovery failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.newSession`, async () => {
    try {
      const controller = activeController();
      const session = await newSessionWizard(vscode, null, '', commandBoard(controller));
      if (!session) return;
      await confirmLaunchedSession(controller || await openBoardPanel(), session);
      vscode.window.showInformationMessage(`Started ${session}`);
    } catch (e) {
      vscode.window.showErrorMessage(`New session failed: ${e.message}`);
      log(`ai grid new session failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.newClaudeSession`, async () => {
    try {
      const controller = activeController();
      const session = await newSessionWizard(vscode, null, 'claude', commandBoard(controller));
      if (!session) return;
      await confirmLaunchedSession(controller || await openBoardPanel(), session);
      vscode.window.showInformationMessage(`Started Claude session ${session}`);
    } catch (e) {
      vscode.window.showErrorMessage(`New Claude session failed: ${e.message}`);
      log(`ai grid new Claude session failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.newCodexSession`, async () => {
    try {
      const controller = activeController();
      const session = await newSessionWizard(vscode, null, 'codex', commandBoard(controller));
      if (!session) return;
      await confirmLaunchedSession(controller || await openBoardPanel(), session);
      vscode.window.showInformationMessage(`Started Codex session ${session}`);
    } catch (e) {
      vscode.window.showErrorMessage(`New Codex session failed: ${e.message}`);
      log(`ai grid new Codex session failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.renameSession`, async () => {
    try {
      const session = await pickSession(vscode, 'Rename AI Session Label');
      if (!session) return;
      const current = (titleMap().get(session) || {}).title || session;
      const title = await renameWizard(vscode, session, current);
      if (!title) return;
      vscode.window.showInformationMessage(`Renamed ${session} to ${title}`);
      await refreshOpenControllers({ force: true });
    } catch (e) {
      vscode.window.showErrorMessage(`Rename failed: ${e.message}`);
      log(`ai grid rename failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(`${commandPrefix}.openTerminal`, async () => {
    try {
      const session = await pickSession(vscode, 'Open macOS Terminal on Larson Tmux Session');
      if (!session) return;
      const title = (titleMap().get(session) || {}).title || session;
      const result = await openFullTerminal(vscode, session, title);
      vscode.window.showInformationMessage(`${result === 'queued' ? 'Queued macOS Terminal' : 'Opened terminal'} for ${session}`);
    } catch (e) {
      vscode.window.showErrorMessage(`Open terminal failed: ${e.message}`);
      log(`ai grid open terminal failed: ${e.message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(openBoardCommand, async (boardInput = null) => {
    const board = boardInput && typeof boardInput === 'object'
      ? (boardInput.create ? await promptNewBoard() : boardInput)
      : await promptBoard();
    if (!board) return;
    await openBoardPanel(board);
  }));

  context.subscriptions.push(vscode.commands.registerCommand(openCommand, async () => {
    await openBoardPanel({ boardId: DEFAULT_BOARD_ID, boardTitle: DEFAULT_BOARD_TITLE });
  }));
}

module.exports = {
  isRunningAgent,
  sessionDirectory,
  createPanelDelivery,
  registerAiGrid,
  html,
  collect,
  assignSlot,
  moveSlot,
  movePanelResult,
  resizeSlot,
  resetSlots,
  resetCellSizes,
  setGridShape,
  displayPaneOutput,
  compactMetaTranscript: compactCodexTranscript,
  recoverMissingSessions,
  renameSessionLabel,
  renameBoardTitle,
  sendPrompt,
  sendPanelPrompt,
  stageImageDraft,
  sendKey,
  createTerminalKeyDispatcher,
  answerCodexQuestion,
  pasteText,
  pasteImages,
  pasteSystemClipboardImage,
  systemClipboardImageDraft,
  openFullTerminal,
  byeSession,
  holdSession,
  assignHeldBoard,
  renameTmuxSession,
  moveSessionToBoard,
  createAiSession,
  createMetaSession,
  CODEX_FULL_PERMISSION_COMMAND,
  codexUpdatePromptVisible,
  queuePendingPrompt,
  queueMemoryHydration,
  updateSessionMemory,
  readManifest,
  isDormantAgent,
  readyPanelText,
  readDiscoSettings,
};
