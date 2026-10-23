const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const root = path.join(__dirname, '..');

async function startBrowser(t, { live = false, override = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'terminaltown-browser-test-'));
  const data = override ? path.join(home, 'public-data') : path.join(home, '.local/share/terminaltown-public');
  fs.mkdirSync(data, { recursive: true });
  const session = 'adapter-fixture';
  const memory = { version: 1, revision: 1, approvedCharter: 'Review fictional files.', contextSummary: '', proposedCharter: 'Review fictional tests.', reviewState: 'pending' };
  if (live) {
    fs.writeFileSync(path.join(data, 'sessions-manifest.json'), JSON.stringify({ version: 1, sessions: { [session]: { name: session, kind: 'codex', command: 'codex', cwd: home, slot: 0, memory } } }));
    fs.writeFileSync(path.join(data, 'layout.json'), JSON.stringify({ boardId: 'default', boardTitle: 'Fixture', grid: { columns: 2, rows: 2, slotCount: 4 }, slots: [session, '', '', ''], spans: {}, layoutRevision: 1 }));
    fs.mkdirSync(path.join(data, 'boards'));
    fs.writeFileSync(path.join(data, 'boards/saved.json'), JSON.stringify({ boardId: 'saved', boardTitle: 'Saved fixture', slots: [] }));
  }
  const fakeTmux = path.join(home, 'tmux');
  fs.writeFileSync(fakeTmux, '#!' + process.execPath + '\n' + `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(home, 'tmux-calls.jsonl'))}, JSON.stringify(args) + '\\n');
if (args.includes('list-sessions')) {
  const calls = fs.readFileSync(${JSON.stringify(path.join(home, 'tmux-calls.jsonl'))}, 'utf8').trim().split('\\n').map(JSON.parse);
  console.log(['adapter-fixture', ...calls.filter(call => call.includes('new-session')).map(call => call[call.indexOf('-s') + 1])].join('\\n'));
}
else if (args.includes('display-message')) console.log(args.some(arg => arg.includes('pane_width')) ? '0|120|40|0|codex' : args.includes('#{pane_current_command}') ? 'codex' : '0');
else if (args.includes('capture-pane')) console.log('Fixture Meta output');
else if (args.includes('list-panes')) console.log(args.some(arg => arg.includes('pane_width')) ? '0|120|40|0|codex' : '0');
`);
  fs.chmodSync(fakeTmux, 0o700);
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const env = { ...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex'), TERMINALTOWN_BROWSER_PORT: String(port), TERMINALTOWN_LIVE: live ? '1' : '0', TERMINALTOWN_RECOVERY_MODE: '1', TERMINALTOWN_ROTATION: '0', SUMMONER_TMUX_BIN: fakeTmux, TMUX_SEND_PROMPT_DELAY: '0' };
  delete env.TERMINALTOWN_MANIFEST;
  if (override) env.TERMINALTOWN_DATA_DIR = data;
  else delete env.TERMINALTOWN_DATA_DIR;
  const child = spawn(process.execPath, ['scripts/terminaltown-browser.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.resume();
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once('exit', resolve)); }
    fs.rmSync(home, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error(stderr || 'Browser exited');
    try { if ((await fetch(base + '/')).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.ok(ready, stderr || 'Browser starts');
  async function message(body) {
    const response = await fetch(base + '/api/message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, ...(await response.json()) };
  }
  return { base, home, data, session, message };
}

function browserShim(document, response) {
  const start = document.indexOf('window.terminalTownBrowserHost = true;');
  const end = document.indexOf('const vscode = acquireVsCodeApi();', start);
  const events = [];
  const context = { URLSearchParams, MessageEvent: class { constructor(type, options) { this.data = options.data; } }, window: { location: { search: '' }, dispatchEvent: event => events.push(event.data) }, fetch: async () => response };
  vm.runInNewContext(document.slice(start, end) + '\nthis.api = acquireVsCodeApi();', context);
  return { api: context.api, events };
}

test('browser messaging returns acknowledgements and preserves drafts on HTTP or protocol failure', async t => {
  const app = await startBrowser(t);
  const document = await (await fetch(app.base + '/')).text();
  for (const payload of [
    { httpOk: true, body: { messages: [{ type: 'note', message: 'Accepted' }] }, ok: true },
    { httpOk: false, body: { error: 'Rejected', messages: [{ type: 'data', data: {} }] }, ok: false },
    { httpOk: true, body: { messages: [{ type: 'imageDraftResult', ok: false, error: 'Invalid image' }] }, ok: false },
    { httpOk: true, body: { messages: [{ type: 'moveResult', ok: false, error: 'Stale move' }] }, ok: false },
    { httpOk: true, body: { error: 'Stale memory', messages: [{ type: 'data', data: {} }] }, ok: false },
    { httpOk: true, body: {}, ok: false },
  ]) {
    const shim = browserShim(document, { ok: payload.httpOk, json: async () => payload.body });
    assert.equal((await shim.api.postMessage({ type: 'memoryUpdateContext' }))?.ok, payload.ok);
    if (!payload.ok) assert.ok(!shim.events.some(event => event.type === 'data'), 'Failures cannot overwrite a pending memory draft');
  }
});

test('demo preferences share display settings and keep device settings in memory', async t => {
  const app = await startBrowser(t);
  const patch = await fetch(app.base + '/api/preferences?device=device_one', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operations: [{ key: 'terminaltown-motion', value: 'still' }, { key: 'terminaltown-compact', value: '1' }] }) });
  assert.equal(patch.status, 200);
  const other = await (await fetch(app.base + '/api/preferences?device=device_two')).json();
  assert.equal(other.values['terminaltown-motion'], 'still');
  assert.equal(other.values['terminaltown-compact'], undefined);
  assert.equal((await fetch(app.base + '/api/preferences?device=device_one', { method: 'PATCH', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal(fs.existsSync(path.join(app.data, 'preferences.json')), false);
  assert.equal(fs.existsSync(path.join(app.home, '.local')), false);
});

for (const override of [true, false]) test(`live preferences and board discovery use the ${override ? 'overridden' : 'default public'} data directory`, async t => {
  const app = await startBrowser(t, { live: true, override });
  const result = await fetch(app.base + '/api/preferences?device=device_one', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operations: [{ key: 'terminaltown-motion', value: 'still' }] }) });
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(app.data, 'preferences.json'))).shared['terminaltown-motion'], 'still');
  assert.equal(fs.existsSync(path.join(app.home, '.local/share/terminaltown')), false);
  const boards = await (await fetch(app.base + '/api/boards')).json();
  assert.ok(boards.boards.some(board => board.id === 'saved' && board.title === 'Saved fixture'));
});

for (const live of [false, true]) test(`${live ? 'live' : 'demo'} moves acknowledge successful swaps and reject stale targets`, async t => {
  const app = await startBrowser(t, { live });
  const name = live ? app.session : 'edit-assistant';
  const target = live ? '' : 'motion-study';
  const moved = await app.message({ type: 'move', moveId: 101, fromSlot: 0, toSlot: 1, session: name, expectedTarget: target, hues: { from: 120, to: 240 } });
  const ack = moved.messages.find(message => message.type === 'moveResult');
  assert.equal(ack?.ok, true);
  assert.equal(ack.moveId, 101);
  assert.equal(ack.layout.slots[1], name);
  assert.deepEqual(ack.hues, { from: target ? 240 : null, to: 120 });
  const stale = await app.message({ type: 'move', moveId: 102, fromSlot: 1, toSlot: 0, session: name, expectedTarget: 'different-session' });
  assert.equal(stale.messages.find(message => message.type === 'moveResult')?.ok, false);
  const state = await (await fetch(app.base + '/api/state')).json();
  assert.equal(state.slots[1], name);
});

for (const live of [false, true]) test(`${live ? 'live' : 'demo'} stages image drafts without sending them and acknowledges prompt delivery`, async t => {
  const app = await startBrowser(t, { live });
  const session = live ? app.session : 'edit-assistant';
  const result = await app.message({ type: 'stageImages', slot: 0, session, stageId: 'image-1', images: [{ type: 'image/png', dataUrl: 'data:image/png;base64,aW1hZ2U=' }] });
  const ack = result.messages.find(message => message.type === 'imageDraftResult');
  assert.equal(ack?.ok, true);
  assert.equal(ack.stageId, 'image-1');
  assert.equal(ack.files.length, 1);
  if (live) {
    assert.equal(fs.readFileSync(ack.files[0], 'utf8'), 'image');
    assert.ok(!fs.readFileSync(path.join(app.home, 'tmux-calls.jsonl'), 'utf8').includes('paste-buffer'));
  } else assert.equal(fs.existsSync(path.join(app.data, 'pastes')), false);
  const rejected = await app.message({ type: 'stageImages', slot: 0, session: 'old-session', stageId: 'image-2', images: [] });
  assert.equal(rejected.messages.find(message => message.type === 'imageDraftResult')?.ok, false);
  const sent = await app.message({ type: 'prompt', slot: 0, session, draftId: 'draft-1', prompt: 'Review ' + ack.files[0] });
  assert.equal(sent.messages.find(message => message.type === 'promptResult')?.ok, true);
  assert.equal(sent.messages.find(message => message.type === 'promptResult')?.draftId, 'draft-1');
});

test('live memory mutations return refreshed data and reject stale edits without replacing drafts', async t => {
  const app = await startBrowser(t, { live: true });
  const approved = await app.message({ type: 'memoryApproveCharter', slot: 0, session: app.session, revision: 1 });
  assert.equal(approved.status, 200);
  assert.equal(approved.messages.find(message => message.type === 'data')?.data.sessions[0].memory.approvedCharter, 'Review fictional tests.');
  const changed = await app.message({ type: 'memoryUpdateContext', slot: 0, session: app.session, revision: 2, value: 'Verified the fixture.' });
  assert.equal(changed.messages.find(message => message.type === 'data')?.data.sessions[0].memory.contextSummary, 'Verified the fixture.');
  const stale = await app.message({ type: 'memoryUpdateCharter', slot: 0, session: app.session, revision: 1, value: 'My unsaved draft.' });
  assert.equal(stale.status, 500);
  assert.match(stale.error, /revision|changed/i);
  assert.ok(!stale.messages.some(message => message.type === 'data'));
  const charter = await app.message({ type: 'memoryUpdateCharter', slot: 0, session: app.session, revision: 3, value: 'Keep reviewing tests.' });
  assert.equal(charter.messages.find(message => message.type === 'data')?.data.sessions[0].memory.approvedCharter, 'Keep reviewing tests.');
  const manifest = JSON.parse(fs.readFileSync(path.join(app.data, 'sessions-manifest.json')));
  manifest.sessions[app.session].memory.proposedCharter = 'Do something else.';
  manifest.sessions[app.session].memory.reviewState = 'pending';
  fs.writeFileSync(path.join(app.data, 'sessions-manifest.json'), JSON.stringify(manifest));
  const rejected = await app.message({ type: 'memoryRejectCharter', slot: 0, session: app.session, revision: 4 });
  assert.equal(rejected.messages.find(message => message.type === 'data')?.data.sessions[0].memory.proposedCharter, '');
});

test('live Codex answers reach validation and report a missing active question as failure', async t => {
  const app = await startBrowser(t, { live: true });
  const result = await app.message({ type: 'answerCodexQuestion', slot: 0, callId: 'stale', answers: {} });
  assert.equal(result.status, 500);
  assert.match(result.error, /question|active/i);
  assert.ok(!result.messages.some(message => message.type === 'data'));
});

test('demo Meta controls create and update a simulated terminal without launching host processes', async t => {
  const app = await startBrowser(t);
  const ensure = await app.message({ type: 'metaEnsure' });
  const meta = ensure.messages.find(message => message.type === 'metaResult');
  assert.equal(meta?.ok, true);
  assert.equal(meta.session, 'terminaltown-meta-default');
  const prompt = await app.message({ type: 'metaPrompt', prompt: 'Organize this fictional board.' });
  const sent = prompt.messages.find(message => message.type === 'metaResult');
  assert.equal(sent?.clearInput, true);
  assert.match(sent.output, /Organize this fictional board/);
  const keyed = await app.message({ type: 'metaKey', key: 'esc' });
  assert.equal(keyed.messages.find(message => message.type === 'metaResult')?.ok, true);
  const pasted = await app.message({ type: 'metaPasteClipboard' });
  assert.equal(pasted.messages.find(message => message.type === 'metaResult')?.ok, true);
  const poll = await app.message({ type: 'metaPoll' });
  assert.equal(poll.messages.find(message => message.type === 'metaResult')?.session, meta.session);
  const state = await (await fetch(app.base + '/api/state')).json();
  assert.ok(!state.slots.includes(meta.session));
  const reset = await app.message({ type: 'resetSlots' });
  assert.ok(!reset.messages.find(message => message.type === 'data').data.slots.includes(meta.session));
  assert.equal(fs.existsSync(path.join(app.home, 'tmux-calls.jsonl')), false);
});

test('demo session memory edits and stale revisions stay in memory', async t => {
  const app = await startBrowser(t);
  await app.message({ type: 'newSession', session: 'memory-demo', initialPrompt: 'Review simulated output.', slot: 0 });
  const state = await (await fetch(app.base + '/api/state')).json();
  assert.equal(state.sessions[0].memory.approvedCharter, '');
  await app.message({ type: 'memoryUpdateCharter', slot: 0, session: 'memory-demo', revision: 0, value: 'Review simulated output.' });
  const saved = await app.message({ type: 'memoryUpdateContext', slot: 0, session: 'memory-demo', revision: 1, value: 'The simulated output is ready.' });
  assert.equal(saved.status, 200);
  assert.equal(saved.messages.find(message => message.type === 'data')?.data.sessions[0].memory.contextSummary, 'The simulated output is ready.');
  const stale = await app.message({ type: 'memoryUpdateContext', slot: 0, session: 'memory-demo', revision: 1, value: 'Stale draft' });
  assert.equal(stale.status, 500);
  assert.ok(!stale.messages.some(message => message.type === 'data'));
  assert.equal(fs.existsSync(path.join(app.data, 'sessions-manifest.json')), false);
});

test('live Meta controls use an isolated dedicated session and acknowledge prompt and memory changes', async t => {
  const app = await startBrowser(t, { live: true });
  const ensure = await app.message({ type: 'metaEnsure' });
  const meta = ensure.messages.find(message => message.type === 'metaResult');
  assert.equal(meta?.ok, true, JSON.stringify(ensure));
  assert.equal(meta.session, 'terminaltown-meta-default');
  assert.equal(meta.command, 'codex');
  const prompt = await app.message({ type: 'metaPrompt', prompt: 'Review the fictional board.' });
  assert.equal(prompt.messages.find(message => message.type === 'metaResult')?.clearInput, true, JSON.stringify(prompt));
  const keyed = await app.message({ type: 'metaKey', key: 'esc' });
  assert.equal(keyed.messages.find(message => message.type === 'metaResult')?.ok, true);
  const memory = await app.message({ type: 'memoryUpdateCharter', slot: 'meta', meta: true, session: meta.session, revision: 0, value: 'Maintain the fictional board.' });
  assert.equal(memory.messages.find(message => message.type === 'metaResult')?.memory.approvedCharter, 'Maintain the fictional board.');
  const poll = await app.message({ type: 'metaPoll' });
  assert.equal(poll.messages.find(message => message.type === 'metaResult')?.session, meta.session);
  const calls = fs.readFileSync(path.join(app.home, 'tmux-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(args => args.includes('new-session')).length, 1);
  assert.ok(calls.some(args => args.includes('send-keys') && args.includes('Escape')));
  const state = await (await fetch(app.base + '/api/state')).json();
  assert.ok(!state.slots.includes(meta.session));
});
