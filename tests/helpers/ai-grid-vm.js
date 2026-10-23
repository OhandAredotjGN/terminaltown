const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Keep the real storage and lifecycle code; isolate host discovery and timers.
module.exports = function loadGrid(t, environment = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'terminaltown-grid-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const filename = path.resolve(__dirname, '../../src/aiGrid.js');
  const requireFile = createRequire(filename);
  const context = vm.createContext({
    require: name => name === 'os' ? { ...os, homedir: () => home } : requireFile(name),
    module: { exports: {} }, __dirname: path.dirname(filename), __filename: filename,
    process: { env: { HOME: home, ...environment }, cwd: () => home, pid: process.pid, execPath: process.execPath },
    Buffer, console, URL, setTimeout: () => 0, clearTimeout, setInterval: () => 0, clearInterval,
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return { home, context, api: context.module.exports, run: code => vm.runInContext(code, context) };
};
