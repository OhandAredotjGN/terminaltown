// Browser storage is an offline cache. The server owns managed display preferences.
function createPreferenceStorage(transport) {
  const schema = TerminalTownPreferenceSchema;
  const cache = window.localStorage;
  const idKey = 'terminaltown-preference-device';
  let device = cache.getItem(idKey);
  if (!device || !/^[a-zA-Z0-9_-]{8,100}$/.test(device)) {
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    device = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    cache.setItem(idKey, device);
  }
  const queueKey = 'terminaltown-preference-outbox-' + device;
  let pending = [];
  try { pending = JSON.parse(cache.getItem(queueKey) || '[]').filter(schema.valid); } catch {}
  const migration = [];
  for (let i = 0; i < cache.length; i++) {
    const key = cache.key(i);
    migration.push(...schema.operations(key, cache.getItem(key)));
  }
  for (const [oldKey, key] of Object.entries({ 'larson-ai-board-compact': 'terminaltown-compact', 'larson-ai-board-sound': 'terminaltown-sound', 'larson-ai-board-skin': 'terminaltown-skin', 'larson-ai-board-motion': 'terminaltown-motion' })) {
    if (cache.getItem(key) === null && cache.getItem(oldKey) !== null) migration.push(...schema.operations(key, cache.getItem(oldKey)));
  }
  let started = false, migrated = false, busy = false, applying = false, timer, onChange = () => {}, onStatus = () => {};
  const observed = new Map();
  const identity = op => op.key + ':' + (op.field ?? '');
  function saveQueue() { cache.setItem(queueKey, JSON.stringify(pending)); }
  function schedule() { clearTimeout(timer); timer = setTimeout(sync, 150); }
  function overlay(values, operations) {
    for (const op of operations) {
      if (schema.objectKey(op.key)) {
        const fields = JSON.parse(values[op.key] || '{}'); fields[op.field] = op.value;
        values[op.key] = JSON.stringify(fields);
      } else values[op.key] = op.value;
    }
  }
  function accept(payload) {
    if (!payload || !payload.values || !Number.isInteger(payload.revision)) throw new Error('Invalid preference response');
    const values = { ...payload.values };
    overlay(values, pending);
    const changed = [];
    applying = true;
    try {
      for (const [key, value] of Object.entries(values)) {
        if (!schema.scope(key) || typeof value !== 'string') continue;
        if (observed.get(key) !== value) changed.push(key);
        observed.set(key, value);
        if (cache.getItem(key) !== value) cache.setItem(key, value);
      }
      // Also reconcile UI variables initially set from the old browser cache.
      onChange(changed);
    } finally { applying = false; }
  }
  async function sync() {
    if (!started) return;
    if (busy) { schedule(); return; }
    busy = true;
    try {
      if (!migrated) {
        const payload = await transport({ device, operations: migration, migrate: true });
        migrated = true; accept(payload);
      }
      const batch = pending.slice();
      const payload = await transport({ device, ...(batch.length ? { operations: batch } : {}) });
      if (!payload || !payload.values || !Number.isInteger(payload.revision)) throw new Error('Invalid preference response');
      if (batch.length) {
        pending = pending.filter(op => !batch.includes(op));
        saveQueue();
      }
      accept(payload);
      onStatus(pending.length ? 'Saving preferences…' : '');
      if (pending.length) schedule();
    } catch {
      onStatus('Preferences offline — changes saved on this device and will sync when connected.');
    } finally { busy = false; }
  }
  window.addEventListener('storage', event => {
    if (event.key === queueKey) {
      try { pending = JSON.parse(cache.getItem(queueKey) || '[]').filter(schema.valid); } catch {}
      if (started) schedule();
    } else if (schema.scope(event.key) && started) schedule();
  });
  return {
    getItem: key => cache.getItem(key),
    setItem(key, value) {
      value = String(value);
      const previous = cache.getItem(key);
      cache.setItem(key, value);
      if (!started || applying || !schema.scope(key)) return;
      const ops = schema.operations(key, value, previous);
      for (const op of ops) {
        pending = pending.filter(old => identity(old) !== identity(op));
        pending.push(op);
      }
      if (ops.length) { saveQueue(); onStatus('Saving preferences…'); schedule(); }
    },
    start(change, status) { onChange = change; onStatus = status; started = true; sync(); },
    sync,
    async flush() {
      // A normal sync may find another request in flight. Moves need its writes drained.
      await sync();
      while (busy) await new Promise(resolve => setTimeout(resolve, 25));
      if (pending.length) await sync();
      return migrated && !busy && pending.length === 0;
    },
  };
}
