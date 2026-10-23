const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const loadGrid = require('./helpers/ai-grid-vm');

const sid = '11111111-1111-1111-1111-111111111111';
function render(grid) { return grid.api.html({ cspSource: "'self'" }, '', '', '', {}); }
function browserFunction(doc, name, next) { return doc.slice(doc.indexOf('function ' + name + '('), doc.indexOf(next, doc.indexOf('function ' + name + '('))); }
function collectionFixture(t, env = {}) {
  const grid = loadGrid(t, env);
  grid.run(`
    readLiveTargets = async () => new Map();
    readProcessIndex = async () => ({ byPid: new Map(), children: new Map() });
    readCodexPathMap = async () => new Map(); readCodexLockIndex = async () => new Map();
    snapshot = async (name, slot) => ({ name, slot, title: 'Worker', command: 'claude',
      resumeId: '${sid}', state: 'idle', clients: '0', contextTokens: 90000 });
    schedulePendingPromptDelivery = () => {}; schedulePendingPromptSweep = () => {};
    readClaudeSessionRecords = () => []; readBoardSummaries = () => [];
    restoreManifestSlots = state => ({ state, changed: false });
    writeManifest({ sessions: { worker: { kind: 'claude', title: 'Worker', command: 'claude',
      resumeId: '${sid}', lastSeenAt: '2020-01-01T00:00:00Z',
      memory: { approvedCharter: 'Maintain the service', revision: 1 }, target: { session: 'worker' } } } });
    writeLayout(['worker']);
    panelIdleSince.set('worker', Date.now() - 700000);
  `);
  return grid;
}

test('layout and hydration files use the isolated default store or explicit override', t => {
  for (const custom of [false, true]) {
    const grid = loadGrid(t);
    const destination = custom ? path.join(grid.home, 'custom store') : path.join(grid.home, '.local/share/terminaltown-public');
    const configured = custom ? loadGrid(t, { TERMINALTOWN_DATA_DIR: destination }) : grid;
    configured.run("writeLayout(['worker']); launchWithPromptFile('worker', 'claude', 'Hello');");
    assert.ok(fs.existsSync(path.join(destination, 'layout.json')));
    assert.equal(fs.readFileSync(path.join(destination, 'hydration/worker.txt'), 'utf8'), 'Hello');
    assert.equal(fs.existsSync(path.join(configured.home, '.local/share/terminaltown')), false);
  }
});

test('New Session executes with an injected project root and permission-preserving Claude default', t => {
  const project = "/tmp/project's </script> & notes";
  const grid = loadGrid(t, { TERMINALTOWN_PROJECT_ROOT: project });
  const doc = render(grid);
  const calls = [], sent = [];
  const context = vm.createContext({ window: { terminalTownBrowserHost: true }, selectedSlot: 0, slotCount: 9,
    prompt: (label, value) => { calls.push([label, value]); return label === 'Session name (the work it owns)' ? 'Fix player' : value; },
    post: (type, value) => sent.push({ type, ...value }),
  });
  // Execute the emitted configuration and actual browser action, without the unrelated DOM.
  for (const name of ['PROJECT_ROOT', 'CLAUDE_DEFAULT_COMMAND', 'CODEX_FULL_PERMISSION_COMMAND']) {
    const line = doc.match(new RegExp('^const ' + name + ' = .*;$', 'm'));
    if (line) vm.runInContext(line[0], context);
  }
  vm.runInContext(browserFunction(doc, 'kebabForBrowser', 'async function browserOpenBoard'), context);
  vm.runInContext("browserNewSession('claude')", context);
  assert.equal(calls.find(([name]) => name === 'Project directory')[1], project);
  assert.equal(sent[0].command, 'claude');
  assert.equal(sent[0].session, 'fix-player');
  for (const script of doc.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});

test('Claude recovery and fresh launches do not inject permission bypass', t => {
  const grid = loadGrid(t);
  const resume = grid.run(`agentResumeCommand({ kind: 'claude', resumeId: '${sid}' })`);
  const fresh = grid.run("launchWithPromptFile('worker', 'claude', 'Do the task')");
  assert.doesNotMatch(resume + fresh, /--dangerously-skip-permissions/);
});

test('an initial task is queued without becoming an approved charter', async t => {
  const grid = loadGrid(t);
  grid.run(`tmux = async () => ''; exactSessionExists = async () => false;
    listAllSessions = async () => []; schedulePendingPromptDelivery = () => {};`);
  await grid.api.createAiSession({ session: 'worker', cwd: grid.home, command: 'claude', initialPrompt: 'Fix one typo', placement: '0' });
  const record = grid.api.readManifest().sessions.worker;
  assert.equal(record.pendingPrompt, 'Fix one typo');
  assert.equal(record.memory.approvedCharter, '');
});

test('ordinary collection leaves automatic restarts disabled until explicitly opted in', async t => {
  for (const value of [undefined, '0', '1']) {
    const grid = collectionFixture(t, value === undefined ? {} : { TERMINALTOWN_AUTO_RECOVER: value });
    grid.run('globalThis.restarts = 0; reviveExitedAiSessions = async () => { restarts += 1; };');
    await grid.run('collectLive()');
    assert.equal(grid.run('restarts'), value === '1' ? 1 : 0);
  }
});

test('ordinary collection does not rotate context without an explicit opt-in', async t => {
  const grid = collectionFixture(t);
  grid.run('reviveExitedAiSessions = async () => {}; updateManifestFromSnapshots = () => false;');
  await grid.run('collectLive()');
  assert.equal(grid.api.readManifest().sessions.worker.rotation, null);
  assert.equal(grid.api.readManifest().sessions.worker.pendingPrompt, '');
});

test('snapshot refresh preserves the rotation state and queued landing prompt', async t => {
  const grid = collectionFixture(t, { TERMINALTOWN_ROTATION: '1' });
  grid.run('reviveExitedAiSessions = async () => {};');
  await grid.run('collectLive()');
  const record = grid.api.readManifest().sessions.worker;
  assert.equal(record.rotation?.state, 'landing');
  assert.match(record.pendingPrompt, /TerminalTown context rotation/);
  assert.equal(record.pendingPromptKind, 'rotation');
});

test('desktop assignment is offered exactly once only when its URL is configured', t => {
  const grid = loadGrid(t), doc = render(grid);
  for (const url of ['', 'https://desktop.example/']) {
    const select = { dataset: {}, items: [], appendChild(option) { this.items.push(option); } };
    const context = vm.createContext({ window: { terminalTownDesktopUrl: url }, document: { createElement: () => ({}) },
      LARSON_DESKTOP_SESSION: 'remote:larson-desktop', allSessions: ['worker', 'remote:larson-desktop'], titles: {}, select });
    vm.runInContext(browserFunction(doc, 'makeOptions', 'function makeBoardOptions'), context);
    vm.runInContext("makeOptions(select, '')", context);
    assert.equal(select.items.filter(item => item.value === 'remote:larson-desktop').length, url ? 1 : 0);
  }
});

test('adoption keeps independent windows and panes in one tmux session distinct', t => {
  const grid = loadGrid(t);
  grid.run(`
    globalThis.manifest = { sessions: {} };
    globalThis.records = [1, 2, 3].map(i => ({ sessionId: String(i).repeat(8) + '-1111-1111-1111-111111111111',
      title: i === 1 ? 'api-worker' : 'worker-' + i, cwd: '/project/' + i,
      target: { socket: '', session: 'fleet', window: i === 3 ? '2' : String(i), paneId: '%' + i } }));
    globalThis.live = new Map([['default', { sessions: new Set(['fleet']), windows: new Set(['fleet:1', 'fleet:2']),
      panes: new Set(['%1', '%2', '%3']), paneTargets: records.map(r => ({ target: r.target, cwd: r.cwd, windowName: r.title })) }]]);
    adoptLiveClaudeRecords(manifest, [], new Map(), records, live);
  `);
  const records = Object.values(grid.run('manifest.sessions'));
  assert.equal(records.length, 3);
  assert.deepEqual(records.map(r => r.cwd).sort(), ['/project/1', '/project/2', '/project/3']);
  assert.deepEqual(records.map(r => r.target.paneId).sort(), ['%1', '%2', '%3']);
  assert.deepEqual(records.map(r => r.target.window).sort(), ['1', '2', '2']);
  grid.run('adoptLiveClaudeRecords(manifest, [], new Map(), records, live)');
  assert.equal(Object.keys(grid.run('manifest.sessions')).length, 3);
});

test('Meta opens one dedicated agent without taking a grid slot, and polling never restarts it', async t => {
  const grid = loadGrid(t);
  grid.run(`
    globalThis.commands = []; globalThis.running = new Set();
    tmux = async args => { commands.push(args); if (args[0] === 'new-session') running.add(args[args.indexOf('-s') + 1]); return ''; };
    exactSessionExists = async name => running.has(name);
    readLiveTargets = async () => new Map([['default', { sessions: running, windows: new Set(), panes: new Set(), paneTargets: [] }]]);
    readProcessIndex = async () => ({ byPid: new Map(), children: new Map() });
    readCodexPathMap = async () => new Map(); readCodexLockIndex = async () => new Map();
    readClaudeSessionRecords = () => [];
    snapshot = async name => ({ name, command: running.has(name) ? 'codex' : 'missing', state: 'idle', memory: readManifest().sessions[name]?.memory, missing: !running.has(name) });
    writeLayout(['worker']);
  `);
  const before = grid.run("fs.readFileSync(LAYOUT_FILE, 'utf8')");
  await Promise.all([grid.api.ensureMetaTerminal({ boardId: 'review' }), grid.api.ensureMetaTerminal({ boardId: 'review' })]);
  const snapshot = await grid.api.collectMetaTerminal({ boardId: 'review' });
  assert.equal(snapshot.name, 'terminaltown-meta-review');
  assert.equal(grid.run("commands.filter(args => args[0] === 'new-session').length"), 1);
  assert.equal(grid.run("commands.find(args => args[0] === 'send-keys')[3]"), 'codex');
  assert.equal(grid.run("fs.readFileSync(LAYOUT_FILE, 'utf8')"), before);
  grid.run('running.clear()');
  await grid.api.collectMetaTerminal({ boardId: 'review' });
  await grid.api.ensureMetaTerminal({ boardId: 'review' });
  assert.equal(grid.run("commands.filter(args => args[0] === 'new-session').length"), 1);
  assert.equal(grid.api.readManifest().sessions['terminaltown-meta-review'].slot, null);
  grid.run('fs.unlinkSync(LAYOUT_FILE)');
  assert.equal(grid.run("readLayoutState(['worker', 'terminaltown-meta-review']).slots.includes('terminaltown-meta-review')"), false);
});

test('failed or missing browser Codex acknowledgements re-enable answer controls', async () => {
  for (const response of [{ ok: false }, undefined, new Error('offline')]) {
    let submit;
    const status = {}, controls = [{ disabled: false }];
    const form = { elements: controls, attrs: {}, reportValidity: () => true,
      setAttribute(key, value) { this.attrs[key] = value; }, getAttribute(key) { return this.attrs[key]; },
      addEventListener(type, callback) { submit = callback; }, querySelector: () => status };
    const surface = { _interaction: { callId: 'question', questions: [] }, querySelector: () => form };
    const tile = { dataset: { slot: '0' }, querySelector: () => surface };
    const context = vm.createContext({ tile, window: { terminalTownBrowserHost: true }, burstRefresh() {},
      post: async () => { if (response instanceof Error) throw response; return response; } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/codexQuestionsClient.js'), 'utf8'), context);
    vm.runInContext('setupCodexQuestion(tile, 0)', context);
    await submit({ preventDefault() {}, currentTarget: form });
    assert.equal(form.attrs['aria-busy'], 'false');
    assert.equal(controls[0].disabled, false);
  }
});

test('a refresh during a pending memory save preserves the draft on rejection', async t => {
  const grid = loadGrid(t), doc = render(grid);
  let resolve;
  const request = new Promise(done => { resolve = done; });
  const record = { name: 'worker', memory: { revision: 1, approvedCharter: 'Role', contextSummary: 'Saved context' } };
  const dialog = { dataset: { revision: '1', dirty: '1' } };
  const context = vm.createContext({ record, memoryRecord: () => record, sessionMemoryDialog: dialog,
    memoryApprovedCharter: { value: 'Role' }, memoryContext: { value: 'Unsaved edit' }, memoryDialogSlot: 0,
    memoryProposalReview: {}, document: { getElementById: () => ({}) }, memoryTimestamp: () => '',
    window: { terminalTownBrowserHost: true }, post: () => request });
  vm.runInContext(browserFunction(doc, 'populateMemoryDialog', 'function openMemoryDialog'), context);
  vm.runInContext(browserFunction(doc, 'submitMemoryMutation', 'for (const field of [memoryApprovedCharter'), context);
  vm.runInContext("submitMemoryMutation('memoryUpdateContext', memoryContext.value); populateMemoryDialog();", context);
  assert.equal(context.memoryContext.value, 'Unsaved edit');
  resolve({ ok: false });
  await request; await Promise.resolve();
  assert.equal(dialog.dataset.pending, '');
  assert.equal(context.memoryContext.value, 'Unsaved edit');
});

test('saving one memory field preserves unsaved edits to the other field', async t => {
  const grid = loadGrid(t), doc = render(grid);
  for (const type of ['memoryUpdateContext', 'memoryUpdateCharter', 'memoryApproveCharter', 'memoryRejectCharter']) {
    let resolve;
    const request = new Promise(done => { resolve = done; });
    const old = { name: 'worker', memory: { revision: 1, approvedCharter: 'Saved role', contextSummary: 'Saved context' } };
    const dialog = { dataset: { revision: '1', dirty: '1' } };
    const context = vm.createContext({ record: old, sessionMemoryDialog: dialog,
      memoryApprovedCharter: { value: 'Edited role' }, memoryContext: { value: 'Edited context' }, memoryDialogSlot: 0,
      memoryProposalReview: {}, document: { getElementById: () => ({}) }, memoryTimestamp: () => '',
      window: { terminalTownBrowserHost: true }, post: () => request });
    vm.runInContext('function memoryRecord() { return record; }', context);
    vm.runInContext(browserFunction(doc, 'populateMemoryDialog', 'function openMemoryDialog'), context);
    vm.runInContext(browserFunction(doc, 'submitMemoryMutation', 'for (const field of [memoryApprovedCharter'), context);
    context.type = type;
    vm.runInContext('submitMemoryMutation(type)', context);
    context.record = { name: 'worker', memory: { revision: 2,
      approvedCharter: type === 'memoryUpdateCharter' ? 'Edited role' : type === 'memoryApproveCharter' ? 'Proposed role' : 'Saved role',
      contextSummary: type === 'memoryUpdateContext' ? 'Edited context' : 'Saved context' } };
    vm.runInContext('populateMemoryDialog()', context);
    resolve({ ok: true });
    await request; await Promise.resolve();
    assert.equal(context.memoryApprovedCharter.value, 'Edited role', type);
    assert.equal(context.memoryContext.value, 'Edited context', type);
    assert.equal(dialog.dataset.revision, '2');
    assert.equal(dialog.dataset.dirty, '1');
  }
});

test('session memory can be opened to explicitly save a first charter', t => {
  const grid = loadGrid(t), doc = render(grid);
  const dialog = { dataset: {}, showModal() { this.open = true; } };
  const context = vm.createContext({ sessionMemoryDialog: dialog, slotRecords: [{ name: 'worker', memory: {} }],
    memoryDialogSlot: null, memoryReturnFocus: null, populateMemoryDialog() {}, setTimeout() {}, trigger: { closest: () => ({ querySelector: () => ({}) }) } });
  vm.runInContext(browserFunction(doc, 'openMemoryDialog', 'function closeMemoryDialog'), context);
  vm.runInContext('openMemoryDialog(0, trigger)', context);
  assert.equal(dialog.open, true);
});

test('the memory command embedded in hydration targets the correct manifest and session', t => {
  const grid = loadGrid(t);
  grid.run("writeManifest({ sessions: { worker: { kind: 'claude', memory: { approvedCharter: 'Maintain tests' } } } });");
  const command = grid.run("sessionMemoryCommand('worker')");
  execFileSync('/bin/sh', ['-c', command + ' replace-context --stdin'], { input: 'Verified the generated command.', encoding: 'utf8' });
  assert.equal(grid.api.readManifest().sessions.worker.memory.contextSummary, 'Verified the generated command.');
});

test('an adopted pane reads its own metadata and Codex answers use its own process', async t => {
  const grid = loadGrid(t);
  grid.run(`
    globalThis.sent = []; globalThis.questionPid = 0;
    globalThis.paneTarget = { socket: '', session: 'fleet', window: '1', paneId: '%2' };
    globalThis.saved = { kind: 'claude', resumeId: '${sid}', target: paneTarget };
    tmuxSocket = async (socket, args) => {
      if (args[0] === 'list-panes') return args.includes('#{pane_pid}') ? '11\\n22' : '11|120|40|0|zsh\\n22|120|40|0|claude';
      if (args[0] === 'display-message') return args.includes('#{pane_pid}') ? '22' : '22|120|40|0|claude';
      if (args[0] === 'capture-pane') return 'Claude pane output';
      if (args[0] === 'send-keys') sent.push(args);
      return '';
    };
    globalThis.live = new Map([['default', { sessions: new Set(['fleet']), windows: new Set(['fleet:1']),
      panes: new Set(['%1', '%2']), paneTargets: [{ target: paneTarget, command: 'claude', panePid: 22 }] }]]);
    resolveSessionActionTarget = async () => ({ target: paneTarget, record: saved, live: true });
    readProcessIndex = async () => ({ byPid: new Map(), children: new Map() });
    readCodexPathMap = async () => new Map(); readCodexLockIndex = async () => new Map();
  `);
  const snapshot = await grid.run("snapshot('worker', 0, new Map(), {}, { observeOnly: true, manifest: { sessions: { worker: saved } }, liveTargets: live })");
  assert.equal(snapshot.command, 'claude');
  assert.equal(snapshot.dormant, false);
  assert.match(snapshot.output, /Claude pane output/);
  grid.run(`
    codexThreadForPane = pid => { questionPid = pid; return '${sid}'; };
    readCodexInteraction = () => ({ type: 'codex-question', callId: 'call', questions: [{ id: 'choice', options: [{ label: 'Go' }], allowOther: false }] });
    setTimeout = callback => { callback(); return 0; };
  `);
  await grid.api.answerCodexQuestion('worker', { callId: 'call', answers: [{ questionId: 'choice', optionIndex: 0 }] });
  assert.equal(grid.run('questionPid'), 22);
  assert.equal(grid.run("sent[0].join(' ')"), 'send-keys -t %2 1');
});
