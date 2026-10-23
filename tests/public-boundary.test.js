const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');

function textFilesUnder(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...textFilesUnder(file));
    else if (!/\.(?:png|gif|jpe?g|svg|ico|woff2?)$/i.test(entry.name)) result.push(file);
  }
  return result;
}

test('public renderer has current bounded UI without private host markers', (t) => {
  const { html } = require('./helpers/ai-grid-vm')(t).api;
  const rendered = html({ cspSource: "'self'" }, '/assets/disco-ball.svg', '', '/assets/refractions.svg', {});
  assert.match(rendered, /Find session/);
  assert.match(rendered, /Panel health/);
  for (const marker of ['/Volumes/T7', '/Users/beau', '/Users/larson', 'larson.tail41f21e.ts.net', 'http://vermeer', 'dangerously-bypass']) {
    assert.doesNotMatch(rendered, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('public tree contains no private product references', () => {
  const forbidden = ['jar', 'gan'].join('');
  const files = [path.join(root, 'README.md'), path.join(root, 'NOTICE.md'), path.join(root, 'package.json')]
    .concat(textFilesUnder(path.join(root, 'src')))
    .concat(textFilesUnder(path.join(root, 'scripts')))
    .concat(textFilesUnder(path.join(root, 'docs')));
  for (const file of files) {
    const body = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(body, new RegExp(forbidden, 'i'), file);
  }
});

test('public adapter exposes safe finder, health, and artifact boundaries', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminaltown-public-boundary-'));
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ['scripts/terminaltown-browser.js'], {
    cwd: root,
    env: { ...process.env, HOME: tmp, TERMINALTOWN_BROWSER_PORT: String(port), TERMINALTOWN_LIVE: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.resume();
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) throw Error(stderr || 'server exited');
    try {
      if ((await fetch(`${base}/api/state`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const directory = await fetch(`${base}/api/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'sessionDirectory' }),
  });
  assert.equal(directory.status, 200);
  assert.equal((await directory.json()).messages[0].type, 'sessionDirectoryResult');

  const report = await fetch(`${base}/api/health`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ observer: 'test-observer', board: 'default', at: Date.now(), incidents: [] }),
  });
  assert.equal(report.status, 200);
  assert.equal((await report.json()).observers[0].id, 'test-observer');

  const artifacts = await fetch(`${base}/api/terminal-files/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ references: [{ path: '/private/example.txt' }] }),
  });
  assert.equal(artifacts.status, 200);
  assert.equal((await artifacts.json()).files[0].available, false);
});
