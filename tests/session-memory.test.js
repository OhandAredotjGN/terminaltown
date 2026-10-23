const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { updateSessionMemoryFile } = require('../src/sessionMemory');

const cli = path.resolve(__dirname, '../scripts/terminaltown-session-memory.js');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminaltown-memory-test-'));
  const manifestFile = path.join(dir, 'sessions-manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify({
    sessions: {
      writer: { title: 'Writer', aliases: ['old-writer'], memory: { revision: 3, approvedCharter: 'Write documentation', contextSummary: 'Original context' } },
      other: { memory: { revision: 7, approvedCharter: 'Other role' } },
    },
  }));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, manifestFile, lockFile: `${manifestFile}.memory.lock` };
}
function update(manifestFile, options = {}) {
  return updateSessionMemoryFile({ manifestFile, session: 'writer', operation: { type: 'replace-context', contextSummary: 'Saved context' }, ...options });
}
function manifest(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function runCli(args, { input = '', env = {} } = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', input,
    env: { ...process.env, TERMINALTOWN_MANIFEST: '', TERMINALTOWN_DATA_DIR: '', ...env },
  });
}
function age(file) {
  const old = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(file, old, old);
}
function exitedPid() {
  const result = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  return result.pid;
}

test('dead writer lock is recovered before an atomic memory update', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.lockFile, JSON.stringify({ pid: exitedPid() }));
  assert.equal(update(f.manifestFile).revision, 4);
  assert.equal(manifest(f.manifestFile).sessions.writer.memory.contextSummary, 'Saved context');
  assert.equal(fs.existsSync(f.lockFile), false);
  assert.equal(fs.statSync(f.manifestFile).mode & 0o777, 0o600);
});

test('a live owner lock is never reclaimed even when old', (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(f.manifestFile, 'utf8');
  const owner = JSON.stringify({ pid: process.pid });
  fs.writeFileSync(f.lockFile, owner);
  age(f.lockFile);
  assert.throws(() => update(f.manifestFile), /lock|EEXIST/i);
  assert.equal(fs.readFileSync(f.manifestFile, 'utf8'), before);
  assert.equal(fs.readFileSync(f.lockFile, 'utf8'), owner);
});

for (const contents of ['', '{broken']) {
  test(`aged ${contents ? 'malformed' : 'empty'} legacy lock is recovered`, (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.lockFile, contents);
    age(f.lockFile);
    assert.equal(update(f.manifestFile).revision, 4);
    assert.equal(fs.existsSync(f.lockFile), false);
  });
}

test('recent incomplete lock is preserved and memory remains untouched', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.lockFile, '');
  const before = fs.readFileSync(f.manifestFile, 'utf8');
  assert.throws(() => update(f.manifestFile), /lock|EEXIST/i);
  assert.equal(fs.existsSync(f.lockFile), true);
  assert.equal(fs.readFileSync(f.manifestFile, 'utf8'), before);
});

test('revision rejection releases the owned lock without changing the manifest', (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(f.manifestFile, 'utf8');
  assert.throws(() => update(f.manifestFile, { expectedRevision: 2 }), /superseded/);
  assert.equal(fs.readFileSync(f.manifestFile, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(f.dir), ['sessions-manifest.json']);
});

test('CLI saves stdin context to the explicit manifest and session', (t) => {
  const f = fixture(t);
  const result = runCli(['--manifest', f.manifestFile, '--session', 'old-writer', 'replace-context', '--stdin', '--revision', '3'], { input: '  Durable next steps\n' });
  assert.equal(result.status, 0, result.stderr);
  const state = manifest(f.manifestFile);
  assert.equal(state.sessions.writer.memory.contextSummary, 'Durable next steps');
  assert.equal(state.sessions.writer.memory.revision, 4);
  assert.equal(state.sessions.other.memory.revision, 7);
});

test('CLI proposes a charter and completes a job without approving the proposal', (t) => {
  const f = fixture(t);
  const charterFile = path.join(f.dir, 'charter.txt');
  const reasonFile = path.join(f.dir, 'reason.txt');
  fs.writeFileSync(charterFile, 'Write and review documentation');
  fs.writeFileSync(reasonFile, 'The role now includes review');
  const proposal = runCli(['propose-charter', '--charter-file', charterFile, '--reason-file', reasonFile, '--session', 'writer'], { env: { TERMINALTOWN_MANIFEST: f.manifestFile } });
  assert.equal(proposal.status, 0, proposal.stderr);
  const completed = runCli(['complete-job', '--session', 'writer'], { env: { TERMINALTOWN_DATA_DIR: f.dir } });
  assert.equal(completed.status, 0, completed.stderr);
  const memory = manifest(f.manifestFile).sessions.writer.memory;
  assert.equal(memory.approvedCharter, 'Write documentation');
  assert.equal(memory.proposedCharter, 'Write and review documentation');
  assert.equal(memory.proposalReason, 'The role now includes review');
  assert.equal(memory.reviewState, 'pending');
  assert.equal(memory.revision, 5);
});

test('CLI defaults to isolated public data under HOME', (t) => {
  const f = fixture(t);
  const dataDir = path.join(f.dir, '.local', 'share', 'terminaltown-public');
  fs.mkdirSync(dataDir, { recursive: true });
  const target = path.join(dataDir, 'sessions-manifest.json');
  fs.copyFileSync(f.manifestFile, target);
  const result = runCli(['--session', 'writer', 'complete-job'], { env: { HOME: f.dir } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(manifest(target).sessions.writer.memory.revision, 4);
  assert.equal(manifest(f.manifestFile).sessions.writer.memory.revision, 3);
});

test('CLI invalid input cannot change memory or approve a charter', (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(f.manifestFile, 'utf8');
  const cases = [
    ['replace-context'],
    ['replace-context', '--stdin', '--revision', '2'],
    ['replace-context', '--stdin', '--revision', 'invalid'],
    ['replace-context', '--stdin', '--unknown'],
    ['propose-charter', '--charter-file', path.join(f.dir, 'missing'), '--reason-file', path.join(f.dir, 'missing')],
    ['approve-charter'],
    ['replace-approved-charter'],
  ];
  for (const args of cases) {
    const result = runCli(['--manifest', f.manifestFile, '--session', 'writer', ...args], { input: 'Changed' });
    assert.notEqual(result.status, 0, args.join(' '));
    assert.equal(fs.readFileSync(f.manifestFile, 'utf8'), before);
    assert.equal(fs.existsSync(f.lockFile), false);
  }
  const oversized = runCli(['--manifest', f.manifestFile, '--session', 'writer', 'replace-context', '--stdin'], { input: 'x'.repeat(6001) });
  assert.notEqual(oversized.status, 0);
  assert.equal(fs.readFileSync(f.manifestFile, 'utf8'), before);
});


test('a crashed owner is recoverable and a running owner keeps its lock', async (t) => {
  const f = fixture(t);
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs');
    const { updateSessionMemoryFile } = require(process.argv[1]);
    updateSessionMemoryFile({ manifestFile: process.argv[2], session: 'writer', operation: {
      type: 'replace-context', contextSummary: { toString() {
        fs.writeFileSync(1, 'LOCKED');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
        return 'Child context';
      } },
    } });
  `, path.resolve(__dirname, '../src/sessionMemory.js'), f.manifestFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Writer exited before acquiring lock')));
  });
  age(f.lockFile);
  assert.throws(() => update(f.manifestFile), /lock|EEXIST/i);
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGKILL');
  await stopped;
  assert.equal(update(f.manifestFile).revision, 4);
  assert.equal(fs.existsSync(f.lockFile), false);
});

test('a displaced writer cannot overwrite memory or remove a replacement lock', (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(f.manifestFile, 'utf8');
  const marker = `owner-${process.pid}-replacement`;
  assert.throws(() => update(f.manifestFile, { operation: {
    type: 'replace-context', contextSummary: { toString() {
      fs.renameSync(f.lockFile, `${f.lockFile}.displaced`);
      fs.mkdirSync(f.lockFile);
      fs.writeFileSync(path.join(f.lockFile, marker), '');
      return 'Must not write';
    } },
  } }), /lock/i);
  assert.equal(fs.existsSync(path.join(f.lockFile, marker)), true);
  assert.equal(fs.readFileSync(f.manifestFile, 'utf8'), before);
});

test('concurrent crash recovery retains every successful writer update', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.lockFile, JSON.stringify({ pid: exitedPid() }));
  const children = Array.from({ length: 12 }, () => spawn(process.execPath, [cli, '--manifest', f.manifestFile, '--session', 'writer', 'complete-job'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  }));
  t.after(() => children.forEach(child => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }));
  const results = children.map(child => new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', reject);
    child.once('exit', code => resolve({ code, stderr }));
  }));
  const completed = await Promise.all(results);
  const succeeded = completed.filter(result => result.code === 0).length;
  assert.ok(succeeded > 0, JSON.stringify(completed));
  for (const result of completed) if (result.code !== 0) assert.match(result.stderr, /locked by another writer/);
  assert.equal(manifest(f.manifestFile).sessions.writer.memory.revision, 3 + succeeded);
  assert.deepEqual(fs.readdirSync(f.dir).sort(), ['sessions-manifest.json']);
});
