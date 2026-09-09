// In-memory simulation: every operation stays inside this module.
const { html } = require("./aiGrid");
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
      slots: [...sessions.keys(), ...Array(5).fill("")],
      spans: {},
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
      grid: { columns: b.columns, rows: b.rows, slotCount: b.slots.length },
      gridOptions: options,
    },
    slots: b.slots,
    spans: b.spans,
    allSessions: [...sessions.keys()],
    titles: Object.fromEntries([...sessions].map(([n, s]) => [n, s.title])),
    holding: [...sessions.keys()],
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
      ...(sessions.get(name) || { output: "", state: "empty" }),
    })),
    warning:
      "DEMO — fictional sessions. Prompts and controls never reach your terminal.",
  };
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
}
async function moveSlot(from, to, name, o) {
  const b = board(o);
  checkedSlot(b, to);
  if (from !== null && Number.isInteger(from)) {
    checkedSlot(b, from);
    [b.slots[from], b.slots[to]] = [b.slots[to], b.slots[from]];
  } else await assignSlot(to, name, o);
}
async function resizeSlot(slot, direction, columns, span, o) {
  const b = board(o);
  checkedSlot(b, slot);
  const session = b.slots[slot];
  b.spans[session] = span === 2 ? 2 : 1;
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
  return { columns, rows, slotCount: b.slots.length };
}
async function resetSlots(o) {
  const b = board(o);
  b.slots = Array.from(
    { length: b.columns * b.rows },
    (_, i) => [...sessions.keys()][i] || "",
  );
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
async function byeSession(name) {
  sessions.delete(name);
  for (const b of boards.values())
    b.slots = b.slots.map((n) => (n === name ? "" : n));
}
async function createAiSession({ session, title, board: o, placement }) {
  if (!/^[\w.-]{1,64}$/.test(session) || sessions.has(session))
    throw Error("Choose a unique session name");
  sessions.set(session, {
    name: session,
    title: title || session,
    command: "demo",
    state: "idle",
    output: "Simulated session. No process was started.",
  });
  const b = board(o);
  const slot = Number(placement);
  if (Number.isInteger(slot) && slot >= 0 && slot < b.slots.length)
    await assignSlot(slot, session, o);
  return session;
}
module.exports = {
  html,
  collect,
  assignSlot,
  moveSlot,
  resizeSlot,
  setGridShape,
  resetSlots,
  renameSessionLabel,
  sendPrompt,
  pasteText: sendPrompt,
  sendKey: (name, key) => sendPrompt(name, "[" + key + "]"),
  byeSession,
  createAiSession,
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
