const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const schema = require('./preferenceSchema');
const DEFAULT_FILE = path.join(process.env.TERMINALTOWN_DATA_DIR || path.join(os.homedir(), '.local/share/terminaltown-public'), 'preferences.json');
function createPreferenceStore(file = DEFAULT_FILE) {
  let memory = { version: 1, revision: 0, shared: {}, devices: {} };
  function read() {
    if (file === null) return structuredClone(memory);
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== 1 || !data.shared || !data.devices) throw new Error('Invalid preferences file');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, revision: 0, shared: {}, devices: {} };
      throw error; // Never replace a damaged store with an empty one.
    }
  }
  function deviceId(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error('Invalid preference device ID');
    return id;
  }
  function view(data, id) {
    return { revision: data.revision, values: { ...data.shared, ...(data.devices[id] || {}) } };
  }
  function locked(action) {
    if (file === null) return action();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const lock = file + '.lock';
    const deadline = Date.now() + 2000;
    let fd;
    while (fd === undefined) {
      try { fd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(fd, String(process.pid)); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          const pid = Number(fs.readFileSync(lock, 'utf8'));
          if (pid > 0) {
            try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') { fs.unlinkSync(lock); continue; } }
          }
        } catch (e) { if (e.code === 'ENOENT') continue; }
        if (Date.now() > deadline) throw new Error('Preferences are busy; retry shortly');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    try { return action(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  return {
    get(id) { return view(read(), deviceId(id)); },
    patch(id, operations, migrate = false) {
      deviceId(id);
      if (!Array.isArray(operations) || operations.length > 4096 || !operations.every(schema.valid)) throw new Error('Invalid preference changes');
      return locked(() => {
      const data = read();
      let changed = false;
      for (const op of operations) {
        const target = schema.scope(op.key) === 'shared' ? data.shared : (data.devices[id] ||= {});
        if (schema.objectKey(op.key)) {
          const fields = JSON.parse(target[op.key] || '{}');
          if (migrate && Object.hasOwn(fields, op.field)) continue;
          if (JSON.stringify(fields[op.field]) === JSON.stringify(op.value)) continue;
          fields[op.field] = op.value;
          target[op.key] = JSON.stringify(fields);
        } else {
          if (migrate && Object.hasOwn(target, op.key)) continue;
          if (target[op.key] === op.value) continue;
          target[op.key] = op.value;
        }
        changed = true;
      }
      if (changed) {
        data.revision += 1;
        if (file === null) memory = data;
        else {
          fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
          const temporary = file + '.' + process.pid + '.tmp';
          fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
          fs.renameSync(temporary, file);
        }
      }
      return view(data, id);
      });
    },
  };
}
module.exports = { createPreferenceStore };
