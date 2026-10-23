// In-memory simulation: every operation stays inside this module.
const { html } = require("./aiGrid");
const { normalizeSessionMemory, applyMemoryOperation } = require('./sessionMemory');
const boards = new Map();
const initial = [
  {
    name: "edit-assistant",
    title: "Edit assistant",
    command: "claude",
    state: "busy",
    output:
      "$ claude\n\nReviewing the fictional launch spot…\n✓ Found 12 candidate selects\n✓ Grouped by scene and camera\n→ Preparing a first assembly\n\nAll sessions on this board are simulated.",
  },
  {
    name: "motion-study",
    title: "Motion study",
    command: "codex",
    state: "waiting",
    output:
      "$ codex\n\nThe animation preview is ready.\n\n1. Slow, deliberate movement\n2. Energetic, spring-based movement\n\nWhich direction should I explore?",
  },
  {
    name: "render-checks",
    title: "Render checks",
    command: "shell",
    state: "idle",
    output:
      "$ npm test\n\n✓ Timeline duration\n✓ Safe title margins\n✓ Audio peak limits\n\n3 checks passed. Ready for review.",
  },
  {
    name: "sound-notes",
    title: "Sound notes",
    command: "claude",
    state: "busy",
    output:
      "$ claude\n\nOrganizing notes from a fictional review.\n✓ Music direction\n✓ Voice-over timing\n→ Summarizing mix notes",
  },
];
const sessions = new Map(initial.map((s) => [s.name, { ...s }]));
const options = [
  { label: "2x2", columns: 2, rows: 2 },
  { label: "3x3", columns: 3, rows: 3 },
  { label: "3x4", columns: 3, rows: 4 },
];
function board(o = {}) {
  const id = o.boardId || "default";
  if (!boards.has(id))
    boards.set(id, {
      id,
      title: o.boardTitle || "TerminalTown · Demo",
      columns: 3,
      rows: 3,
      slots: [...sessions.keys()].filter(name => !name.startsWith('terminaltown-meta-')).concat(Array(5).fill('')).slice(0, 9),
      spans: {},
      layoutRevision: 1,
    });
  return boards.get(id);
}
async function collect(o = {}) {
  const b = board(o);
  return {
    at: Date.now(),
    board: {
      id: b.id,
      title: b.title,
      layoutRevision: b.layoutRevision,
      grid: { columns: b.columns, rows: b.rows, slotCount: b.slots.length },
      gridOptions: options,
    },
    slots: b.slots,
    spans: b.spans,
    allSessions: [...sessions.keys()],
    titles: Object.fromEntries([...sessions].map(([n, s]) => [n, s.title])),
    holding: [...sessions.keys()].filter(name => !name.startsWith('terminaltown-meta-')),
    holdingBoards: [...boards.values()].map((b) => ({
      id: b.id,
      title: b.title,
    })),
    holdingMembership: {},
    sessions: b.slots.map((name, slot) => ({
      slot,
      name,
      rowSpan: b.spans[name] || 1,
      cwd: "demo-project",
      clients: 0,
      memory: normalizeSessionMemory(sessions.get(name)?.memory),
      ...(sessions.get(name) || { output: "", state: "empty" }),
    })),
    warning:
      "DEMO — fictional sessions. Prompts and controls never reach your terminal.",
  };
}
async function sessionDirectory(query = '') {
  const boardEntries = [...boards.values()];
  const normalized = String(query || '').trim().toLowerCase();
  return [...sessions].map(([name, session]) => {
    const locations = boardEntries.flatMap((b) => (b.slots || []).flatMap((item, slot) =>
      item === name ? [{ boardId: b.id, boardTitle: b.title, panel: slot + 1 }] : []));
    return {
      name,
      title: session.title || name,
      aliases: [],
      charter: '',
      cwd: 'demo-project',
      kind: session.command || 'demo',
      live: false,
      locations,
    };
  }).filter((record) => !normalized || [record.name, record.title, record.cwd].join(' ').toLowerCase().includes(normalized));
}
function checkedSlot(b, s) {
  if (!Number.isInteger(s) || s < 0 || s >= b.slots.length)
    throw Error("Invalid slot");
}
async function assignSlot(slot, name, o) {
  const b = board(o);
  checkedSlot(b, slot);
  if (name && !sessions.has(name)) throw Error("Unknown session");
  b.slots = b.slots.map((n) => (n === name ? "" : n));
  b.slots[slot] = name;
  b.layoutRevision += 1;
}
async function moveSlot(from, to, name, o, expectedTarget) {
  const b = board(o);
  checkedSlot(b, to);
  if (from !== null && Number.isInteger(from)) {
    checkedSlot(b, from);
    if (!b.slots[from] || (name && b.slots[from] !== name)) throw Error('The source panel changed. Try the move again.');
    if (expectedTarget !== undefined && b.slots[to] !== expectedTarget) throw Error('The destination panel changed. Try the move again.');
    [b.slots[from], b.slots[to]] = [b.slots[to], b.slots[from]];
    delete b.spans[b.slots[from]];
    delete b.spans[b.slots[to]];
    b.layoutRevision += 1;
  } else await assignSlot(to, name, o);
}
async function movePanelResult(message, o) {
  const b = board(o);
  const layout = () => ({ boardId: b.id, boardTitle: b.title, grid: { columns: b.columns, rows: b.rows, slotCount: b.slots.length }, slots: [...b.slots], spans: { ...b.spans }, layoutRevision: b.layoutRevision });
  try {
    if (message.hues && ![message.hues.from, message.hues.to].every(hue => hue === null || Number.isInteger(hue) && hue >= 0 && hue <= 359)) throw Error('Invalid panel hues');
    await moveSlot(Number.isInteger(message.fromSlot) ? message.fromSlot : null, Number(message.toSlot), String(message.session || ''), o, message.expectedTarget);
    const hues = message.hues && Number.isInteger(message.fromSlot) && message.fromSlot !== Number(message.toSlot)
      ? { from: b.slots[message.fromSlot] ? message.hues.to : null, to: message.hues.from } : null;
    return { type: 'moveResult', moveId: message.moveId, ok: true, layout: layout(), ...(hues ? { hues } : {}) };
  } catch (error) {
    return { type: 'moveResult', moveId: message.moveId, ok: false, error: error.message, layout: layout() };
  }
}
async function resizeSlot(slot, direction, columns, span, o) {
  const b = board(o);
  checkedSlot(b, slot);
  const session = b.slots[slot];
  b.spans[session] = span === 2 ? 2 : 1;
  b.layoutRevision += 1;
  return { session, span: b.spans[session] };
}
async function setGridShape(columns, rows, o) {
  if (
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < 1 ||
    rows < 1 ||
    columns > 4 ||
    rows > 4
  )
    throw Error("Invalid grid");
  const b = board(o);
  b.columns = columns;
  b.rows = rows;
  b.slots = Array.from({ length: columns * rows }, (_, i) => b.slots[i] || "");
  b.layoutRevision += 1;
  return { columns, rows, slotCount: b.slots.length };
}
async function resetSlots(o) {
  const b = board(o);
  const names = [...sessions.keys()].filter(name => !name.startsWith('terminaltown-meta-'));
  b.slots = Array.from(
    { length: b.columns * b.rows },
    (_, i) => names[i] || "",
  );
  b.layoutRevision += 1;
}
async function renameSessionLabel(name, title) {
  const s = sessions.get(name);
  if (!s) throw Error("Unknown session");
  s.title = String(title).slice(0, 80);
  return s.title;
}
async function sendPrompt(name, text) {
  const s = sessions.get(name);
  if (!s) throw Error("Unknown session");
  s.output +=
    "\n\nYou: " +
    String(text).slice(0, 2000) +
    "\nDemo: received. No command was executed.";
  s.state = "waiting";
}
async function sendPanelPrompt(session, message) {
  try {
    if (message.session && message.session !== session) throw Error('The panel changed; your draft was kept.');
    await sendPrompt(session, message.prompt);
    return { type: 'promptResult', draftId: message.draftId, session, ok: true };
  } catch (error) {
    return { type: 'promptResult', draftId: message.draftId, session: message.session, ok: false, error: error.message };
  }
}
async function stageImageDraft(session, message) {
  try {
    if (!sessions.has(session) || message.session !== session) throw Error('The panel changed; paste into its current prompt.');
    if (!Array.isArray(message.images) || !message.images.length || message.images.length > 8) throw Error('Paste up to 8 images at a time.');
    const files = message.images.map((image, index) => {
      if (!/^image\/(png|jpeg|gif|webp)$/.test(String(image?.type || '')) || !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(String(image?.dataUrl || ''))) throw Error('Invalid image paste payload');
      return 'demo-image://' + encodeURIComponent(message.stageId || 'image') + '/' + (index + 1);
    });
    return { type: 'imageDraftResult', stageId: message.stageId, session, ok: true, files };
  } catch (error) {
    return { type: 'imageDraftResult', stageId: message.stageId, session: message.session, ok: false, error: error.message };
  }
}
function updateSessionMemory(session, messageType, payload = {}) {
  const record = sessions.get(session);
  if (!record) throw Error('Unknown session');
  const memory = normalizeSessionMemory(record.memory);
  if (!Number.isInteger(payload.revision) || payload.revision !== memory.revision) throw Error('Session memory changed; reload the current revision.');
  const operations = {
    memoryUpdateContext: { type: 'replace-context', contextSummary: payload.value },
    memoryUpdateCharter: { type: 'replace-approved-charter', approvedCharter: payload.value },
    memoryApproveCharter: { type: 'approve-charter', revision: payload.revision },
    memoryRejectCharter: { type: 'reject-charter', revision: payload.revision },
  };
  record.memory = applyMemoryOperation(memory, operations[messageType]);
  return record.memory;
}
function metaName(o = {}) { return 'terminaltown-meta-' + String(o.boardId || 'default').slice(0, 36); }
async function collectMetaTerminal(o) {
  const name = metaName(o);
  const record = sessions.get(name);
  return record ? { ...record, memory: normalizeSessionMemory(record.memory), agentRunning: true, dormant: false, cwd: 'demo-project' }
    : { name, command: 'missing', output: '', agentRunning: false, dormant: false, memory: normalizeSessionMemory() };
}
async function ensureMetaTerminal(o) {
  const name = metaName(o);
  if (!sessions.has(name)) sessions.set(name, { name, title: 'Meta Terminal', command: 'codex', state: 'waiting', output: 'Demo Meta Terminal. No host process was started.' });
  return collectMetaTerminal(o);
}
async function byeSession(name) {
  sessions.delete(name);
  for (const b of boards.values())
    b.slots = b.slots.map((n) => (n === name ? "" : n));
}
async function createAiSession({ session, title, board: o, placement, initialPrompt }) {
  if (!/^[\w.-]{1,64}$/.test(session) || sessions.has(session))
    throw Error("Choose a unique session name");
  sessions.set(session, {
    name: session,
    title: title || session,
    command: "demo",
    state: "idle",
    output: "Simulated session. No process was started.",
    memory: normalizeSessionMemory(),
  });
  const b = board(o);
  const slot = Number(placement);
  if (Number.isInteger(slot) && slot >= 0 && slot < b.slots.length)
    await assignSlot(slot, session, o);
  if (String(initialPrompt || '').trim()) await sendPrompt(session, initialPrompt);
  return session;
}
module.exports = {
  html,
  collect,
  assignSlot,
  moveSlot,
  movePanelResult,
  resizeSlot,
  setGridShape,
  resetSlots,
  renameSessionLabel,
  sendPrompt,
  sendPanelPrompt,
  stageImageDraft,
  ensureMetaTerminal,
  collectMetaTerminal,
  isRunningAgent: (record, command) => /^(codex|claude)$/.test(command),
  updateSessionMemory,
  answerCodexQuestion: async () => { throw Error('No active Codex question in this simulated session.'); },
  pasteText: sendPrompt,
  sendKey: (name, key) => sendPrompt(name, "[" + key + "]"),
  byeSession,
  createAiSession,
  sessionDirectory,
  recoverMissingSessions: async () => ({
    indexed: sessions.size,
    adopted: 0,
    spawned: 0,
    skipped: 0,
  }),
  readDiscoSettings: () => ({}),
  pasteImages: async () => [],
  pasteSystemClipboardImage: async () => [],
  openFullTerminal: async () => {
    throw Error("No live terminals in demo mode");
  },
};
