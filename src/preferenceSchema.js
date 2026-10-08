// Shared by the browser adapter and the server. Only display preferences are accepted.
(function (root) {
  const shared = new Set(['terminaltown-pinned-boards', 'terminaltown-board-shortcut', 'terminaltown-motion', 'terminaltown-sound', 'terminaltown-skin']);
  const device = new Set(['terminaltown-compact', 'terminaltown-toolbar-collapsed', 'terminaltown-meta-dock', 'terminaltown-holding-open', 'terminaltown-bottom-bar-shape']);
  function scope(key) {
    if (typeof key !== 'string' || key.length > 240) return null;
    if (shared.has(key) || /^terminaltown-(skin:|panel-fonts-|panel-hues-|panel-chimes-)[a-zA-Z0-9_-]+$/.test(key)) return 'shared';
    if (device.has(key) || /^terminaltown-mobile-[a-zA-Z0-9_-]+$/.test(key)) return 'device';
    return null;
  }
  function objectKey(key) { return key.startsWith('terminaltown-panel-hues-') || key.startsWith('terminaltown-panel-fonts-') || key.startsWith('terminaltown-panel-chimes-') || key.startsWith('terminaltown-mobile-'); }
  function valid(op) {
    if (!op || !scope(op.key)) return false;
    const { key, value, field } = op;
    if (key.startsWith('terminaltown-panel-chimes-')) {
      return /^\d{1,3}$/.test(String(field)) && value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).every(name => ['mode', 'seconds', 'resume'].includes(name))
        && Object.keys(value).length >= 2 && Object.keys(value).length <= 3
        && ['off', 'once', 'repeat'].includes(value.mode)
        && [0.5, 1, 5, 10, 30, 60].includes(value.seconds)
        && (value.resume === undefined || ['once', 'repeat'].includes(value.resume));
    }
    if (key.startsWith('terminaltown-panel-hues-')) {
      const hue = v => Number.isInteger(v) && v >= 0 && v <= 359;
      if (field === 'palette') return Array.isArray(value) && value.length >= 1 && value.length <= 8 && value.every(hue);
      if (field === 'pattern') return ['columns', 'rows', 'panels'].includes(value);
      return /^\d{1,3}$/.test(String(field)) && (value === null || hue(value));
    }
    if (key.startsWith('terminaltown-panel-fonts-')) return /^\d{1,3}$/.test(String(field)) && (value === null || Number.isInteger(value) && value >= 8 && value <= 40);
    if (key.startsWith('terminaltown-mobile-')) {
      if (field === 'view') return ['scroll', 'tabs', 'watch'].includes(value);
      if (field === 'density') return [1, 2, 3, 4, 6].includes(value);
      if (field === 'page') return Number.isInteger(value) && value >= 0 && value <= 1000;
      if (field === 'height') return Number.isInteger(value) && value >= 160 && value <= 600;
      if (field === 'overview') return typeof value === 'boolean';
      return false;
    }
    if (field !== undefined || typeof value !== 'string') return false;
    if (key === 'terminaltown-pinned-boards') {
      try { const v = JSON.parse(value); return Array.isArray(v) && v.length <= 5 && v.every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(id)); } catch { return false; }
    }
    if (key === 'terminaltown-board-shortcut') return ['alt', 'ctrl', 'off'].includes(value);
    if (key === 'terminaltown-motion') return ['still', 'subtle'].includes(value);
    if (key === 'terminaltown-meta-dock') return ['side', 'bottom'].includes(value);
    if (key === 'terminaltown-bottom-bar-shape') return ['rounded', 'square'].includes(value);
    if (key.startsWith('terminaltown-skin')) return ['system', 'circuit', 'aurora', 'daybook', 'arcade', 'mono', 'sepia', 'disco'].includes(value);
    return ['0', '1'].includes(value);
  }
  function operations(key, value, previous = null) {
    if (!scope(key)) return [];
    if (!objectKey(key)) return value === previous ? [] : [{ key, value }].filter(valid);
    try {
      const next = JSON.parse(value), prev = JSON.parse(previous || '{}');
      if (!next || typeof next !== 'object' || Array.isArray(next)) return [];
      return Object.entries(next).filter(([field, v]) => !prev || JSON.stringify(prev[field]) !== JSON.stringify(v)).map(([field, v]) => ({ key, field, value: v })).filter(valid);
    } catch { return []; }
  }
  const schema = { scope, objectKey, valid, operations };
  if (typeof module !== 'undefined' && module.exports) module.exports = schema;
  else root.TerminalTownPreferenceSchema = schema;
})(globalThis);
