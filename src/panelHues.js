// Board-scoped hue assignments use the same shared preference transport as text sizes.
const hueScope = document.getElementById('hueScope');
const hueRange = document.getElementById('hueRange');
const hueValue = document.getElementById('hueValue');
const huePreset = document.getElementById('huePreset');
const huePattern = document.getElementById('huePattern');
const huePresets = {
  soothing: [165, 185, 205, 225], vivid: [5, 55, 145, 285], subtle: [195, 205, 215, 225], glassy: [180, 195, 210, 230],
  coast: [185, 210, 245, 165], dusk: [260, 290, 325, 20], orchard: [85, 145, 35, 355] };
let huePalette = huePresets.coast.slice(), hueEditorBoard = '', huePaletteDirty = false;
function panelHueKey() { return 'terminaltown-panel-hues-' + currentBoardId(); }
function savedPanelHueState() { const value = storedBoardValue(panelHueKey(), {}); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function panelHueState() {
  const state = savedPanelHueState();
  for (const move of pendingPanelMoves) {
    state[move.fromSlot] = move.expectedTarget ? move.hues.to : null;
    state[move.toSlot] = move.hues.from;
  }
  return state;
}
function validPanelHue(value) { return Number.isInteger(value) && value >= 0 && value <= 359; }
function swapPanelHueHistory(fromSlot, toSlot) {
  const key = panelHueKey();
  const swap = state => {
    const from = state[fromSlot] ?? null;
    state[fromSlot] = state[toSlot] ?? null;
    state[toSlot] = from;
    return state;
  };
  // Undo/redo belongs to the colored panel, too, rather than its former slot.
  const history = hueHistory();
  for (const entry of [...history.undo, ...history.redo]) {
    if (entry.key !== key) continue;
    entry.before = JSON.stringify(swap(JSON.parse(entry.before)));
    entry.after = JSON.stringify(swap(JSON.parse(entry.after)));
  }
}
function hueRGB(hue, light = 0.5, saturation = 0.7) {
  const a = saturation * Math.min(light, 1 - light);
  return [0, 8, 4].map(n => { const k = (n + hue / 30) % 12; return Math.round(255 * (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); });
}
function hueHex(hue) { return '#' + hueRGB(hue).map(v => v.toString(16).padStart(2, '0')).join(''); }
function hexHue(hex) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
  if (!delta) return 0;
  const h = max === rgb[0] ? (rgb[1] - rgb[2]) / delta + (rgb[1] < rgb[2] ? 6 : 0) : max === rgb[1] ? (rgb[2] - rgb[0]) / delta + 2 : (rgb[0] - rgb[1]) / delta + 4;
  return Math.round(h * 60) % 360;
}
function hueLuminance(rgb) { return rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((v, x, i) => v + x * [.2126, .7152, .0722][i], 0); }
function hueAccent(hue, tile) {
  const rgb = getComputedStyle(tile).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [255, 255, 255];
  const light = hueLuminance(rgb) > .35;
  let result;
  for (let i = 0; i <= 8; i++) {
    result = hueRGB(hue, light ? .34 - i * .025 : .66 + i * .025);
    const tint = rgb.map((v, j) => .94 * v + .06 * result[j]);
    const a = hueLuminance(result), b = hueLuminance(tint);
    if ((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5) break;
  }
  return 'rgb(' + result.join(',') + ')';
}
function hueColumns() { return Math.max(1, Number(gridShape.split('x')[0]) || 3); }
function hueTargets() {
  const scope = hueScope.value, columns = hueColumns();
  return [...tiles.keys()].filter(slot => scope === 'all' || scope === 'selected' && fontSelection.has(slot) || scope === 'column:' + slot % columns || scope === 'row:' + Math.floor(slot / columns));
}
function syncHueScope() {
  const signature = hueColumns() + ':' + slotCount;
  if (hueScope.dataset.grid !== signature) {
    const current = hueScope.value;
    hueScope.replaceChildren();
    const choices = [['all', 'Whole board'], ['selected', 'Selected (' + fontSelection.size + ')']];
    for (let col = 0; col < hueColumns(); col++) choices.push(['column:' + col, 'Column ' + (col + 1)]);
    for (let row = 0; row < Math.ceil(slotCount / hueColumns()); row++) choices.push(['row:' + row, 'Row ' + (row + 1)]);
    for (const [value, text] of choices) hueScope.add(new Option(text, value));
    hueScope.value = choices.some(([value]) => value === current) ? current : 'all';
    hueScope.dataset.grid = signature;
  }
  hueScope.querySelector('[value="selected"]').textContent = 'Selected (' + fontSelection.size + ')';
  syncBulkControls();
  const targets = hueTargets(), state = panelHueState();
  const values = targets.map(slot => state[slot]);
  const common = values.length && values.every(value => value === values[0]) && validPanelHue(values[0]) ? values[0] : null;
  if (document.activeElement !== hueValue) { hueValue.value = common ?? ''; hueValue.placeholder = '—'; hueValue.title = common !== null ? 'Hue in degrees' : values.some(validPanelHue) ? 'Mixed hues' : 'Skin color'; }
  if (document.activeElement !== hueRange && common !== null) hueRange.value = common;
  const disabled = !targets.length || pendingPanelMoves.length > 0;
  for (const id of ['hueRange', 'hueValue', 'resetHues', 'huePreset', 'huePattern']) document.getElementById(id).disabled = disabled;
}
function renderHuePalette() {
  const root = document.getElementById('huePaletteStops');
  root.replaceChildren();
  huePalette.forEach((hue, index) => {
    const input = document.createElement('input'); input.type = 'color'; input.value = hueHex(hue);
    input.setAttribute('aria-label', 'Palette color ' + (index + 1));
    input.addEventListener('input', () => { huePalette[index] = hexHue(input.value); swatch.style.background = hueHex(huePalette[index]); huePreset.value = 'custom'; huePaletteDirty = true; applyHuePalette(); });
    const swatch = document.createElement('button'); swatch.type = 'button'; swatch.className = 'hue-swatch';
    swatch.style.background = hueHex(hue); swatch.title = 'Use palette color ' + (index + 1);
    swatch.setAttribute('aria-label', swatch.title);
    swatch.addEventListener('click', () => savePanelHues(hueTargets(), [huePalette[index]]));
    const cell = document.createElement('div'); cell.className = 'hue-color-cell';
    const edit = document.createElement('label'); edit.className = 'hue-color-edit'; edit.title = 'Edit palette color ' + (index + 1);
    edit.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15Z"/></svg>';
    edit.append(input); cell.append(swatch, edit); root.append(cell);
  });
  document.getElementById('addHueStop').disabled = huePalette.length >= 8;
  document.getElementById('removeHueStop').disabled = huePalette.length <= 1;
}
function applyPanelHues() {
  const state = panelHueState();
  if (hueEditorBoard !== currentBoardId()) { hueEditorBoard = currentBoardId(); huePaletteDirty = false; hueScope.value = 'all'; document.getElementById('hueStatus').textContent = ''; }
  if (!huePaletteDirty) {
    const palette = Array.isArray(state.palette) && state.palette.length ? state.palette : huePresets.coast;
    if (JSON.stringify(palette) !== JSON.stringify(huePalette) || !document.getElementById('huePaletteStops').children.length) { huePalette = palette.slice(); renderHuePalette(); }
    huePreset.value = Object.keys(huePresets).find(name => JSON.stringify(huePresets[name]) === JSON.stringify(huePalette)) || 'custom';
    huePattern.value = state.pattern || 'columns';
  }
  for (const [slot, tile] of tiles) {
    const hue = state[slot];
    if (validPanelHue(hue)) { tile.dataset.panelHue = hue; tile.style.setProperty('--panel-hue-color', hueAccent(hue, tile)); }
    else { delete tile.dataset.panelHue; tile.style.removeProperty('--panel-hue-color'); }
    const input = tile.querySelector('.panel-hue-value'), range = tile.querySelector('.panel-hue-range');
    if (input && document.activeElement !== input) input.value = validPanelHue(hue) ? hue : '';
    if (range && document.activeElement !== range) range.value = validPanelHue(hue) ? hue : 210;
  }
  syncHueScope();
  document.querySelectorAll('[data-board-reset]').forEach(button => { button.disabled = pendingPanelMoves.length > 0; });
  document.querySelectorAll('.panel-hue input, .panel-hue select, .panel-hue button, #bulkHueRange, #bulkHuePreset, #bulkHueSwatches button, #huePaletteStops button, #huePaletteStops input').forEach(control => { control.disabled = pendingPanelMoves.length > 0 || (control.dataset.hueHistory ? !hueHistory()[control.dataset.hueHistory].length : false); });
}
function savePanelHues(slots, values, palette = false) {
  if (pendingPanelMoves.length) { applyPanelHues(); return; }
  if (!slots.length) return;
  const beforeState = panelHueState();
  if (palette) { beforeState.palette ||= huePresets.coast.slice(); beforeState.pattern ||= 'columns'; }
  const before = JSON.stringify(beforeState);
  const state = panelHueState();
  slots.forEach((slot, index) => { state[slot] = values[index % values.length]; });
  if (palette) { state.palette = huePalette.slice(); state.pattern = huePattern.value; huePaletteDirty = false; }
  recordHueEdit(panelHueKey(), before, JSON.stringify(state));
  preferenceStorage.setItem(panelHueKey(), JSON.stringify(state));
  applyPanelHues();
  document.getElementById('hueStatus').textContent = values[0] === null ? 'Skin colors restored · ' + slots.length + ' panels' : (palette ? 'Palette applied' : 'Hue applied') + ' · ' + slots.length + (slots.length === 1 ? ' panel' : ' panels');
}
function bindPanelHueControls(tile, slot) {
  tile.addEventListener('panelslotchange', () => { slot = Number(tile.dataset.slot); });
  const block = document.createElement('div'); block.className = 'panel-hue';
  block.innerHTML = '<h2>Panel hue</h2><div class="hue-editor"><input type="range" class="panel-hue-range" min="0" max="359" value="210" aria-label="Panel hue"><input type="number" class="panel-hue-value" min="0" max="359" placeholder="Skin" aria-label="Panel hue in degrees"></div><button type="button" class="hue-reset">Use skin color</button>';
  tile.querySelector('.panel-font').after(block);
  const paletteLabel = document.createElement('label'); paletteLabel.textContent = 'Palette';
  const preset = document.createElement('select'); preset.setAttribute('aria-label', 'Panel color palette'); preset.innerHTML = huePreset.innerHTML; preset.querySelector('[value="custom"]').remove();
  preset.value = huePreset.value in huePresets ? huePreset.value : 'coast';
  const swatches = document.createElement('div'); swatches.className = 'bulk-swatches';
  const render = () => { swatches.replaceChildren(); huePresets[preset.value].forEach((hue, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'hue-swatch'; button.style.background = hueHex(hue); button.title = 'Use palette color ' + (index + 1); button.setAttribute('aria-label', button.title); button.addEventListener('click', () => savePanelHues([slot], [hue])); swatches.append(button);
  }); };
  preset.addEventListener('change', () => { render(); savePanelHues([slot], [huePresets[preset.value][0]]); });
  paletteLabel.append(preset); block.querySelector('h2').after(paletteLabel, swatches); render();
  const history = document.createElement('div'); history.className = 'hue-history'; hueHistoryButtons(history); const heading = document.createElement('div'); heading.className = 'panel-hue-heading'; block.prepend(heading); heading.append(block.querySelector('h2'), history);

  const input = block.querySelector('.panel-hue-value'), range = block.querySelector('.panel-hue-range');
  range.addEventListener('input', () => { input.value = range.value; savePanelHues([slot], [Number(range.value)]); });
  const commit = () => { if (input.value !== '' && input.checkValidity()) savePanelHues([slot], [Number(input.value)]); else if (input.value === '') savePanelHues([slot], [null]); else input.reportValidity(); };
  input.addEventListener('input', () => { if (input.value !== '' && input.checkValidity()) commit(); });
  input.addEventListener('change', commit);
  input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); commit(); } });
  block.querySelector('.hue-reset').addEventListener('click', () => savePanelHues([slot], [null]));
}
hueScope.addEventListener('change', syncHueScope);
hueRange.addEventListener('input', () => { hueValue.value = hueRange.value; savePanelHues(hueTargets(), [Number(hueRange.value)]); });
hueValue.addEventListener('input', () => { if (hueValue.value !== '' && hueValue.checkValidity()) { hueRange.value = hueValue.value; savePanelHues(hueTargets(), [Number(hueValue.value)]); } });
document.getElementById('resetHues').addEventListener('click', () => savePanelHues(hueTargets(), [null]));
huePreset.addEventListener('change', () => { if (huePresets[huePreset.value]) { huePalette = huePresets[huePreset.value].slice(); renderHuePalette(); } huePaletteDirty = true; applyHuePalette(); });
huePattern.addEventListener('change', () => { huePaletteDirty = true; applyHuePalette(); });
document.getElementById('addHueStop').addEventListener('click', () => { if (huePalette.length < 8) { huePalette.push((huePalette.at(-1) + 45) % 360); huePreset.value = 'custom'; huePaletteDirty = true; renderHuePalette(); applyHuePalette(); } });
document.getElementById('removeHueStop').addEventListener('click', () => { if (huePalette.length > 1) { huePalette.pop(); huePreset.value = 'custom'; huePaletteDirty = true; renderHuePalette(); applyHuePalette(); } });
function applyHuePalette() {
  const slots = hueTargets();
  const values = slots.map((slot, index) => huePalette[(huePattern.value === 'columns' ? slot % hueColumns() : huePattern.value === 'rows' ? Math.floor(slot / hueColumns()) : index) % huePalette.length]);
  savePanelHues(slots, values, true);
}

// History is local to this editing session and partitioned by board. Store only changed fields.
const hueHistories = new Map();
let hueGesture = null;
function hueHistory() {
  const key = currentBoardId();
  if (!hueHistories.has(key)) hueHistories.set(key, { undo: [], redo: [] });
  return hueHistories.get(key);
}
function recordHueEdit(key, before, after) {
  if (before === after) return;
  const history = hueHistory();
  const previous = history.undo.at(-1);
  if (hueGesture && previous && previous.gesture === hueGesture && previous.key === key) previous.after = after;
  else { history.undo.push({ key, before, after, gesture: hueGesture }); if (history.undo.length > 60) history.undo.shift(); }
  history.redo.length = 0;
}
function travelHueHistory(redo) {
  if (pendingPanelMoves.length) return;
  const history = hueHistory(), from = redo ? history.redo : history.undo, to = redo ? history.undo : history.redo;
  const entry = from.pop(); if (!entry) return;
  const before = JSON.parse(entry.before), after = JSON.parse(entry.after);
  const current = JSON.parse(preferenceStorage.getItem(entry.key) || '{}');
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) current[key] = (redo ? after[key] : before[key]) ?? (entry.key.startsWith('terminaltown-panel-fonts-') ? 12 : null);
  }
  preferenceStorage.setItem(entry.key, JSON.stringify(current)); to.push(entry);
  document.getElementById('hueStatus').textContent = redo ? 'Change redone' : 'Change undone';
  huePaletteDirty = false; applyPanelFonts();
}
function hueHistoryButtons(root) {
  for (const [redo, label, path] of [[false, 'Undo panel change', 'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12'], [true, 'Redo panel change', 'm15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12']]) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.hueHistory = redo ? 'redo' : 'undo';
    button.title = label; button.setAttribute('aria-label', label);
    button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>';
    button.addEventListener('click', () => travelHueHistory(redo)); root.append(button);
  }
}
for (const event of ['pointerdown', 'keydown']) document.addEventListener(event, ev => {
  if (ev.target.matches('.hue-editor input[type="range"]') && !hueGesture) hueGesture = {};
});
for (const event of ['pointerup', 'pointercancel', 'keyup']) document.addEventListener(event, () => { hueGesture = null; });
document.addEventListener('focusout', ev => { if (ev.target.matches('.hue-editor input[type="range"]')) hueGesture = null; });
huePreset.replaceChildren();
for (const name of Object.keys(huePresets)) huePreset.add(new Option(name[0].toUpperCase() + name.slice(1), name));
huePreset.add(new Option('Custom', 'custom'));
hueHistoryButtons(document.querySelector('.hue-history'));
const bulkPanelControls = document.createElement('section'); bulkPanelControls.id = 'bulkPanelControls';
bulkPanelControls.className = 'hue-settings bulk-panel-controls'; bulkPanelControls.hidden = true;
bulkPanelControls.setAttribute('aria-label', 'Bulk panel controls');
bulkPanelControls.innerHTML = '<div class="bulk-heading"><strong>Selected panels <span id="bulkPanelCount"></span></strong><span class="bulk-header-actions"><span class="bulk-history"></span><button type="button" id="bulkClear" aria-label="Clear panel selection" title="Clear selection">×</button></span></div><div class="bulk-body"><label>Palette<select id="bulkHuePreset"></select></label><div id="bulkHueSwatches" class="bulk-swatches"></div><div class="hue-editor"><input id="bulkHueRange" type="range" min="0" max="359" value="210" aria-label="Selected panels hue"></div><div class="bulk-footer"><label>Text size <input id="bulkFontSize" type="number" min="8" max="40" aria-label="Selected panels text size" placeholder="Mixed"></label></div></div>';
document.body.append(bulkPanelControls);
const bulkPreset = document.getElementById('bulkHuePreset'); bulkPreset.innerHTML = huePreset.innerHTML;
bulkPreset.addEventListener('change', () => { hueScope.value = 'selected'; huePreset.value = bulkPreset.value; huePreset.dispatchEvent(new Event('change')); });
document.getElementById('bulkHueRange').addEventListener('input', ev => savePanelHues([...fontSelection], [Number(ev.target.value)]));
document.getElementById('bulkClear').addEventListener('click', () => { fontSelection.clear(); applyPanelFonts(); });
const bulkFont = document.getElementById('bulkFontSize');
bulkFont.addEventListener('change', () => {
  if (!bulkFont.value || !bulkFont.checkValidity()) return;
  const key = panelFontStorageKey(), before = JSON.stringify(panelFontSizes());
  changePanelFonts([...fontSelection], Number(bulkFont.value));
  recordHueEdit(key, before, JSON.stringify(panelFontSizes())); syncBulkControls();
});
hueHistoryButtons(document.querySelector('.bulk-history'));
function syncBulkControls() {
  bulkPanelControls.hidden = fontSelection.size < 2;
  document.getElementById('bulkPanelCount').textContent = '(' + fontSelection.size + ')';
  bulkPreset.value = huePreset.value;
  const sizes = [...fontSelection].map(slot => panelFontSize(slot));
  if (document.activeElement !== bulkFont) bulkFont.value = sizes.length && sizes.every(n => n === sizes[0]) ? sizes[0] : '';
  const root = document.getElementById('bulkHueSwatches');
  if (root.dataset.palette !== JSON.stringify(huePalette)) {
    root.dataset.palette = JSON.stringify(huePalette); root.replaceChildren();
    huePalette.forEach((hue, index) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'hue-swatch'; button.style.background = hueHex(hue); button.title = 'Use palette color ' + (index + 1); button.setAttribute('aria-label', button.title); button.addEventListener('click', () => savePanelHues([...fontSelection], [hue])); root.append(button); });
  }
  const history = hueHistory();
  document.querySelectorAll('[data-hue-history]').forEach(button => { button.disabled = pendingPanelMoves.length > 0 || !history[button.dataset.hueHistory].length; });
}
