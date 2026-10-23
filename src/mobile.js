// TT-MOBILE-TABS-20260910. Phone view preferences never alter the shared board layout.
const mobileMedia = matchMedia('(max-width: 760px), (max-width: 1000px) and (pointer: coarse)');
const mobileIosInputMedia = matchMedia('(hover: none) and (pointer: coarse)');
const mobileById = id => document.getElementById(id);
let mobileAll = true, mobilePage = 0, mobilePanelHeight = 240;
let mobilePageSlots = [], mobileDensity = 2, mobileOverviewOpen = false, mobileStateBoard = '';
let mobileLastData = {}, mobileSheet = null, mobileKeyboardSlot = null;
const mobileCalibrationEnabled = new URLSearchParams(location.search).get('calibrate') === '1';
let mobileCalibrationOverlay = null;
const mobileDockShapeKey = 'terminaltown-bottom-bar-shape';
let mobileIosMinimumViewportScale = 1;
const mobileIosInputSelector = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="hidden"]):not([type="button"]):not([type="submit"]),textarea:not(.clipboard-proxy),select';
const mobileIosFillSelector = '.prompt-input,#boardPickerInput,#holdingSearch,.holding-tools select,.holding-panel-select,.holding-field input,.holding-field select,.panel-menu .chime-mode,.chime-inputs input';
function wrapMobileIosInput(control) {
  if (!(control instanceof HTMLElement) || !control.matches(mobileIosInputSelector) || control.parentElement?.classList.contains('ios-input-wrapper')) return;
  const rect = control.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const wrapper = document.createElement('span');
  wrapper.className = 'ios-input-wrapper' + (control.matches(mobileIosFillSelector) || control.tagName === 'TEXTAREA' ? ' ios-input-fill' : '');
  wrapper.style.setProperty('--ios-input-visual-width', rect.width + 'px');
  wrapper.style.setProperty('--ios-input-visual-height', rect.height + 'px');
  control.before(wrapper); wrapper.append(control);
}
function installMobileIosInputScaling(root = document) {
  if (!mobileIosInputMedia.matches) return;
  if (root instanceof HTMLElement && root.matches(mobileIosInputSelector)) wrapMobileIosInput(root);
  root.querySelectorAll?.(mobileIosInputSelector).forEach(wrapMobileIosInput);
}
function setMobileDockShape(value, persist = false) {
  const next = value === 'square' ? 'square' : 'rounded';
  document.body.dataset.mobileDockShape = next;
  mobileById('mobileDockShape').value = next;
  if (persist) preferenceStorage.setItem(mobileDockShapeKey, next);
}
const mobileMenuHomes = ['viewMenu', 'sessionMenu', 'toolsMenu'].map((id, i) => {
  const menu = mobileById(id), marker = document.createComment('desktop ' + id);
  menu.before(marker);
  return { menu, marker, host: mobileById(['mobileViewHost', 'mobileSessionHost', 'mobileToolsHost'][i]) };
});
function isMobileView() { return Boolean(mobileReady && mobileMedia.matches); }
function mobileStorageKey() { return 'terminaltown-mobile-' + (activeRenderedBoardId || window.terminalTownBrowserBoard || 'default'); }
function saveMobileView() {
  try { preferenceStorage.setItem(mobileStorageKey(), JSON.stringify({ view: mobileAll ? 'scroll' : 'tabs', density: mobileDensity, page: mobilePage, height: mobilePanelHeight, overview: mobileOverviewOpen })); } catch {}
}
function normalizeMobilePage() {
  mobilePage = Math.max(0, Math.min(Math.ceil(slotCount / mobileDensity) - 1, mobilePage));
  mobilePageSlots = Array.from({length:Math.min(mobileDensity,slotCount-mobilePage*mobileDensity)}, (_, i) => mobilePage*mobileDensity+i);
}
function mobileGridRows(count) {
  const columns = count > 3 || (innerWidth > innerHeight && count > 2) ? 2 : 1;
  board.style.setProperty('--mobile-columns', String(columns));
  board.style.setProperty('--mobile-rows', String(Math.max(1,Math.ceil(count/columns))));
}
function placeMobileTiles() {
  normalizeMobilePage();
  const focused = document.activeElement?.closest('#board .tile');
  const keyboard = window.visualViewport && window.visualViewport.height < innerHeight * 0.77;
  const previousKeyboardSlot = mobileKeyboardSlot;
  mobileKeyboardSlot = keyboard && focused ? Number(focused.dataset.slot) : null;
  const visible = mobileAll ? [...Array(slotCount).keys()] : mobileKeyboardSlot === null ? mobilePageSlots : [mobileKeyboardSlot];
  board.classList.toggle('mobile-all', mobileAll);
  if (mobileAll && mobileKeyboardSlot !== null && mobileKeyboardSlot !== previousKeyboardSlot) requestAnimationFrame(() => focused.scrollIntoView({block:'nearest'}));
  mobileGridRows(visible.length);
  board.style.setProperty('--mobile-panel-height', mobilePanelHeight + 'px');
  board.classList.toggle('mobile-four', !mobileAll && visible.length > 3);
  board.classList.toggle('mobile-one', visible.length === 1);
  for (const [slot, tile] of tiles) {
    tile.classList.toggle('mobile-visible', visible.includes(slot));
    tile.classList.remove('covered', 'row-span-2');
    tile.style.order = String(visible.indexOf(slot));
    tile.querySelector('.head').draggable = false;
    // Keep Escape and Paste discoverable when a dense header is condensed.
    const menu = tile.querySelector('.panel-menu');
    if (!menu.querySelector('.mobile-panel-keys')) {
      const group = document.createElement('div'); group.className = 'mobile-panel-keys key-grid';
      for (const [label, selector] of [['Escape', '.esc'], ['Paste', '.paste']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.addEventListener('click', () => tile.querySelector(selector).click()); group.append(button);
      }
      menu.querySelector('.copy').before(group);
      const layout = document.createElement('details'); layout.className = 'mobile-panel-layout mobile-arrange';
      layout.innerHTML = '<summary>Arrange shared board</summary><label>Move to panel<select aria-label="Move to panel"></select></label><div class="key-grid"><button type="button" data-span="up">Expand up</button><button type="button" data-span="down">Expand down</button><button type="button" data-span="shrink">Single row</button></div>';
      layout.querySelector('select').addEventListener('change', event => {
        const slot = Number(tile.dataset.slot);
        const toSlot = Number(event.target.value);
        if (event.target.value !== '' && Number.isInteger(toSlot) && toSlot !== slot) post('move', {fromSlot:slot,toSlot});
        event.target.value = ''; closePanelMenu(true);
      });
      layout.querySelectorAll('[data-span]').forEach(button => button.addEventListener('click', () => {
        const slot = Number(tile.dataset.slot);
        const direction = button.dataset.span;
        const columns = Number(gridShape.split('x')[0]) || 3;
        post('resize', {slot,columns,span:direction === 'shrink' ? 1 : 2,...(direction === 'shrink' ? {} : {direction})});
      }));
      const keys = document.createElement('details'); keys.className = 'mobile-panel-layout';
      keys.innerHTML = '<summary>More terminal keys</summary><div class="key-grid"></div>';
      for (const [label,key] of [['↑ Up','up'],['↓ Down','down'],['← Left','left'],['→ Right','right'],['EOF · Ctrl+D','ctrl-d']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.addEventListener('click', () => post('key', {slot:Number(tile.dataset.slot),key})); keys.querySelector('.key-grid').append(button);
      }
      menu.querySelector('.bye').before(keys, layout);
    }
    const move = menu.querySelector('.mobile-arrange select');
    if (move.dataset.count !== String(slotCount)) {
      move.replaceChildren(new Option('Choose…', ''));
      for (let target = 0; target < slotCount; target++) if (target !== slot) move.add(new Option('Panel ' + (target + 1), String(target)));
      move.dataset.count = String(slotCount);
    }
  }
}
function mobileTileOnScreen(tile) {
  if (!tile.classList.contains('mobile-visible') || mobileOverviewOpen) return false;
  const r = tile.getBoundingClientRect(), viewport = board.getBoundingClientRect();
  return r.bottom > viewport.top && r.top < viewport.bottom;
}
function mobileSlotState(session) {
  if (!session?.name) return 'Empty';
  if (session.missing || session.state === 'missing') return 'Missing';
  if (session.state === 'waiting') return 'Waiting';
  if (session.state === 'busy' || last.get(session.slot)?.working) return 'Working';
  return 'Ready';
}
function mobilePanelNode(slot, overview) {
  const root = mobileById(overview ? 'mobileOverviewGrid' : 'mobilePanelList');
  let node = root.querySelector('[data-mobile-slot="' + slot + '"]');
  if (node) return node;
  node = document.createElement(overview ? 'button' : 'div'); node.dataset.mobileSlot = slot;
  if (overview) {
    node.type = 'button'; node.className = 'mobile-overview-card';
    node.innerHTML = '<small class="mobile-number"></small><strong></strong><small class="mobile-state"></small><span class="mobile-snippet"></span>';
    node.addEventListener('click', () => openMobilePanel(slot));
  } else {
    node.className = 'mobile-panel-row';
    node.innerHTML = '<button type="button" class="mobile-panel-open"><span class="mobile-number"></span><strong></strong><small class="mobile-state"></small></button>';
    node.querySelector('.mobile-panel-open').addEventListener('click', () => openMobilePanel(slot));
  }
  root.append(node); return node;
}
function renderMobile(data) {
  mobileLastData = data || {};
  if (!isMobileView()) return;
  if (mobileStateBoard !== activeRenderedBoardId || !mobilePageSlots.length) {
    mobileStateBoard = activeRenderedBoardId;
    let saved;
    try { saved = JSON.parse(preferenceStorage.getItem(mobileStorageKey()) || 'null'); } catch {}
    mobileAll = !['tabs','watch'].includes(saved?.view);
    mobileDensity = [1,2,3,4,6].includes(saved?.density) ? saved.density : 2;
    mobilePage = Number.isInteger(saved?.page) ? saved.page : Math.floor((Number(saved?.watched?.[0]) || 0) / mobileDensity);
    mobilePanelHeight = Number.isFinite(saved?.height) ? Math.max(160,Math.min(600,Math.round(saved.height/20)*20)) : 240;
    mobileOverviewOpen = Boolean(saved?.overview);
    normalizeMobilePage();
    if (mobilePageSlots.length) setSelected(mobilePageSlots[0], { focusProxy: false });
  }
  let working = 0, attention = 0;
  for (let slot = 0; slot < slotCount; slot++) {
    const session = (mobileLastData.sessions || []).find(item => item?.slot === slot) || { slot };
    const state = mobileSlotState(session), title = session.display || session.name || 'Empty panel';
    if (state === 'Working') working++;
    if (state === 'Waiting' || state === 'Missing') attention++;
    for (const overview of [true, false]) {
      const node = mobilePanelNode(slot, overview);
      node.dataset.state = state;
      node.querySelector('.mobile-number').textContent = String(slot + 1).padStart(2, '0');
      node.querySelector('strong').textContent = title;
      node.querySelector('.mobile-state').textContent = state;
      const action = overview ? node : node.querySelector('.mobile-panel-open');
      action.setAttribute('aria-label', 'Open panel ' + (slot + 1) + ': ' + title + ', ' + state);
      if (overview) {
        node.querySelector('.mobile-snippet').textContent = String(session.name ? session.output || '' : 'Tap to assign a session').trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0,140);
      }
    }
  }
  document.querySelectorAll('[data-mobile-slot]').forEach(node => { if (Number(node.dataset.mobileSlot) >= slotCount) node.remove(); });
  mobileById('mobileSummary').textContent = working + ' working · ' + attention + ' need attention';
  mobileById('mobileAttention').textContent = attention ? String(attention) : '▦';
  mobileById('mobileOverviewButton').setAttribute('aria-label', 'Board overview, ' + attention + ' panels need attention');
  mobileById('mobileBoardName').textContent = data.board?.title || boardLabel.textContent;
  const quick = mobileById('mobileQuickBoards');
  const directory = boardDirectory.length ? boardDirectory : holdingBoards;
  const quickIds = [...new Set([...pinnedBoards, ...recentBoards])].filter(id => id !== currentBoardId() && directory.some(entry => entry.id === id)).slice(0,5);
  const signature = JSON.stringify(quickIds.map(id => [id, directory.find(entry => entry.id === id)?.title, pinnedBoards.includes(id)]));
  if (quick.dataset.signature !== signature) {
    quick.replaceChildren(); quick.dataset.signature = signature;
    for (const id of quickIds) {
      const entry = directory.find(item => item.id === id), button = document.createElement('button');
      button.type = 'button'; button.textContent = (pinnedBoards.includes(id) ? '★ ' : '') + (entry.title || id);
      button.setAttribute('aria-label', 'Switch to ' + (entry.title || id));
      button.addEventListener('click', () => { closeMobileSheet(false); openBoardFromPicker(entry); }); quick.append(button);
    }
  }
  mobileById('mobilePreviousBoard').disabled = !recentBoards.some(id => id !== currentBoardId() && directory.some(entry => entry.id === id));
  mobileById('mobileMetaLabel').textContent = metaTerminal.classList.contains('open') ? 'Close Meta' : 'Meta Terminal';
  mobileById('mobileHoldingCount').textContent = holdingNames.length;
  syncMobileView();
}
function syncMobileView() {
  normalizeMobilePage();
  document.body.classList.toggle('mobile-overview-open', isMobileView() && mobileOverviewOpen);
  mobileById('mobileOverview').hidden = !isMobileView() || !mobileOverviewOpen;
  mobileById('mobileOverviewButton').setAttribute('aria-pressed', String(mobileOverviewOpen));
  mobileById('mobileScrollMode').setAttribute('aria-pressed', String(mobileAll));
  mobileById('mobileTabsMode').setAttribute('aria-pressed', String(!mobileAll));
  mobileById('mobileHeightField').hidden = !mobileAll;
  mobileById('mobileCountField').hidden = mobileAll;
  mobileById('mobilePanelHeight').value = String(mobilePanelHeight);
  mobileById('mobilePanelHeightValue').textContent = mobilePanelHeight + ' px';
  mobileById('mobilePanelsPerTab').value = String(mobileDensity);
  mobileById('mobilePager').hidden = mobileAll || mobileOverviewOpen;
  mobileById('mobileOverviewButton').hidden = !mobileAll && !mobileOverviewOpen;
  const pages = Math.max(1,Math.ceil(slotCount / mobileDensity));
  mobileById('mobileTabPosition').textContent = (mobilePage+1) + ' / ' + pages;
  mobileById('mobileTabPosition').setAttribute('aria-label', 'Tab ' + (mobilePage+1) + ' of ' + pages + '. Open overview');
  for (const id of ['mobilePrevTab','mobilePrevPanel']) mobileById(id).disabled = !mobileAll && mobilePage === 0;
  for (const id of ['mobileNextTab','mobileNextPanel']) mobileById(id).disabled = !mobileAll && mobilePage >= pages-1;
  if (isMobileView()) placeMobileTiles();
}
function applyMobileView() { syncMobileView(); saveMobileView(); renderMobile(mobileLastData); }
function openMobilePanel(slot) {
  if (!mobileAll) mobilePage = Math.floor(slot/mobileDensity);
  mobileOverviewOpen = false;
  closeMobileSheet(false); setMetaOpen(false); setHoldingOpen(false, false);
  setSelected(slot, { focusProxy: false }); applyMobileView();
  if (mobileAll) tiles.get(slot)?.scrollIntoView({block:'start'});
  tiles.get(slot)?.querySelector('.tools-toggle').focus({ preventScroll: true });
}
function showMobileOverview() {
  closeMobileSheet(false); setMetaOpen(false); setHoldingOpen(false, false);
  mobileOverviewOpen = !mobileOverviewOpen; applyMobileView();
  mobileById(mobileAll || mobileOverviewOpen ? 'mobileOverviewButton' : 'mobileTabPosition').focus({ preventScroll: true });
}
function closeMobileSheet(restore = true) {
  if (!mobileSheet) return;
  const current = mobileSheet; mobileSheet = null;
  mobileById(current).hidden = true; mobileById('mobileShade').hidden = true;
  const trigger = mobileById(current + 'Button'); trigger.setAttribute('aria-expanded', 'false');
  document.querySelectorAll('[data-mobile-inert]').forEach(el => { el.inert = false; el.removeAttribute('data-mobile-inert'); });
  if (restore) trigger.focus({ preventScroll: true });
}
function openMobileSheet(id) {
  const wasOpen = mobileSheet === id;
  closeMobileSheet(false); closePanelMenu(); closeCommandPopover(); closeBoardPicker();
  if (wasOpen) { mobileById(id + 'Button').focus(); return; }
  mobileSheet = id; mobileById(id).hidden = false; mobileById('mobileShade').hidden = false;
  mobileById(id + 'Button').setAttribute('aria-expanded', 'true');
  for (const el of [toolbar, board, mobileById('mobileOverview'), holdingDrawer, metaTerminal]) {
    if (!el.inert) { el.inert = true; el.setAttribute('data-mobile-inert', ''); }
  }
  renderMobile(mobileLastData);
  installMobileIosInputScaling(mobileById(id));
  mobileById(id).querySelector('button').focus({ preventScroll: true });
}
function mobileVisualViewportTop(viewport = window.visualViewport) {
  if (!viewport) return 0;
  const offsetTop = Number(viewport.offsetTop) || 0;
  const pageOffset = (Number(viewport.pageTop) || 0) - (Number(window.scrollY) || 0);
  return Math.max(0, offsetTop, pageOffset);
}
function updateMobileIosTextFloor(viewport = window.visualViewport) {
  if (!mobileIosInputMedia.matches) return;
  const scale = Number(viewport?.scale) || 1;
  if (scale > 0) mobileIosMinimumViewportScale = Math.min(mobileIosMinimumViewportScale, Math.max(.5, scale));
  document.documentElement.style.setProperty('--ios-keyboard-font-size', (16 / mobileIosMinimumViewportScale) + 'px');
}
function updateMobileViewport() {
  const viewport = window.visualViewport;
  updateMobileIosTextFloor(viewport);
  document.documentElement.style.setProperty('--mobile-vh', (viewport?.height || innerHeight) + 'px');
  document.documentElement.style.setProperty('--mobile-top', mobileVisualViewportTop(viewport) + 'px');
  updateMobileCalibration();
  if (isMobileView()) { placeMobileTiles(); positionPanelMenu(); }
}
function updateMobileCalibration() {
  if (!mobileCalibrationOverlay) return;
  requestAnimationFrame(() => {
    const viewport = window.visualViewport;
    const dockRect = mobileById('mobileDock').getBoundingClientRect();
    mobileById('mobileCalibrationReadout').textContent =
      'viewport ' + innerWidth + '×' + innerHeight +
      ' | visual ' + Math.round(viewport?.width || innerWidth) + '×' + Math.round(viewport?.height || innerHeight) +
      ' @' + Math.round(viewport?.offsetLeft || 0) + ',' + Math.round(mobileVisualViewportTop(viewport)) +
      ' scale ' + Number(viewport?.scale || 1).toFixed(2) +
      ' | dock ' + Math.round(dockRect.x) + ',' + Math.round(dockRect.y) + ' ' + Math.round(dockRect.width) + '×' + Math.round(dockRect.height) +
      ' | DPR ' + Number(devicePixelRatio || 1).toFixed(2);
  });
}
function installMobileCalibration() {
  if (!mobileCalibrationEnabled) return;
  document.body.classList.add('mobile-calibration-enabled');
  mobileCalibrationOverlay = document.createElement('div');
  mobileCalibrationOverlay.id = 'mobileCalibration';
  mobileCalibrationOverlay.className = 'mobile-calibration';
  mobileCalibrationOverlay.setAttribute('aria-hidden', 'true');
  mobileCalibrationOverlay.innerHTML = '<div id="mobileCalibrationReadout" class="mobile-calibration-readout"></div><i class="mobile-calibration-safe-bottom"></i><i class="mobile-calibration-safe-left"></i><i class="mobile-calibration-safe-right"></i><i class="mobile-calibration-center-x"></i><i class="mobile-calibration-center-y"></i>';
  document.body.append(mobileCalibrationOverlay);
  updateMobileCalibration();
}
function changeMobileMode() {
  closeMobileSheet(false); closeCommandPopover(); closePanelMenu();
  for (const {menu,marker,host} of mobileMenuHomes) {
    if (isMobileView()) { host.append(menu); menu.hidden = false; }
    else { marker.after(menu); menu.hidden = true; }
  }
  if (!isMobileView()) {
    for (const tile of tiles.values()) { tile.style.order = ''; tile.querySelector('.head').draggable = true; }
  }
  syncMobileView(); placeTiles(); renderMobile(mobileLastData); updateMobileViewport();
}
for (const id of ['mobileNavigate', 'mobileControls']) {
  mobileById(id + 'Button').addEventListener('click', () => openMobileSheet(id));
  mobileById(id).querySelector('[data-mobile-close]').addEventListener('click', () => closeMobileSheet());
}
setMobileDockShape(preferenceStorage.getItem(mobileDockShapeKey));
mobileById('mobileDockShape').addEventListener('change', event => setMobileDockShape(event.target.value, true));
installMobileCalibration();
installMobileIosInputScaling();
new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
  if (node instanceof HTMLElement) installMobileIosInputScaling(node);
}))).observe(document.body, { childList: true, subtree: true });
document.addEventListener('pointerdown', event => { if (mobileIosInputMedia.matches) wrapMobileIosInput(event.target); }, true);
mobileById('mobileShade').addEventListener('click', () => closeMobileSheet());
mobileById('mobileBoards').addEventListener('click', () => { closeMobileSheet(false); showBoardPicker(); });
mobileById('mobilePreviousBoard').addEventListener('click', () => { closeMobileSheet(false); previousBoard(); });
mobileById('mobileRefresh').addEventListener('click', () => { closeMobileSheet(false); requestRefresh({ force: true }); });
mobileById('mobileOverviewButton').addEventListener('click', showMobileOverview);
mobileById('mobileShowOverview').addEventListener('click', showMobileOverview);
function changeMobilePage(direction) {
  closePanelMenu();
  const pages = Math.ceil(slotCount/mobileDensity);
  mobilePage = Math.max(0,Math.min(pages-1,mobilePage+direction));
  normalizeMobilePage();
  mobileOverviewOpen = false;
  // Blur a hidden prompt before changing pages, without opening a keyboard.
  if (document.activeElement?.closest('#board')) document.activeElement.blur();
  applyMobileView(); setSelected(mobilePageSlots[0] || 0,{focusProxy:false});
}
mobileById('mobileScrollMode').addEventListener('click', () => { mobileAll = true; applyMobileView(); });
mobileById('mobileTabsMode').addEventListener('click', () => { mobileAll = false; mobilePage = Math.floor(selectedSlot/mobileDensity); applyMobileView(); });
mobileById('mobilePanelHeight').addEventListener('input', event => {
  const anchor = [...tiles.values()].find(tile=>mobileTileOnScreen(tile));
  const previousTop = anchor?.getBoundingClientRect().top;
  mobilePanelHeight = Number(event.target.value); applyMobileView();
  if (anchor) board.scrollTop += anchor.getBoundingClientRect().top-previousTop;
});
mobileById('mobilePanelsPerTab').addEventListener('change', event => {
  const first = mobilePage*mobileDensity;
  mobileDensity = Number(event.target.value); mobilePage = Math.floor(first/mobileDensity); applyMobileView();
});
for (const [id,direction] of [['mobilePrevTab',-1],['mobileNextTab',1],['mobilePrevPanel',-1],['mobileNextPanel',1]]) mobileById(id).addEventListener('click', () => {
  if (mobileAll) openMobilePanel((selectedSlot+direction+slotCount)%slotCount);
  else { changeMobilePage(direction); closeMobileSheet(false); }
});
mobileById('mobileTabPosition').addEventListener('click',showMobileOverview);
mobileById('mobileMeta').addEventListener('click', () => {
  closeMobileSheet(false); setHoldingOpen(false, false); setMetaOpen(!metaTerminal.classList.contains('open'));
});
mobileById('mobileHolding').addEventListener('click', () => {
  closeMobileSheet(false); setMetaOpen(false); setHoldingOpen(!holdingOpen, false);
  if (holdingOpen) installMobileIosInputScaling(holdingDrawer);
  if (holdingOpen) closeHoldingButton.focus({preventScroll:true});
});
// Escape/Tab in phone navigation belong to the interface, never to a tmux pane.
document.addEventListener('keydown', event => {
  if (!isMobileView() || !mobileSheet) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeMobileSheet(); return; }
  if (event.key !== 'Tab') return;
  const items = [...mobileById(mobileSheet).querySelectorAll('button,select,input,summary')].filter(el => !el.disabled && el.getClientRects().length);
  const index = items.indexOf(document.activeElement);
  if (event.shiftKey && index <= 0 || !event.shiftKey && index === items.length - 1) {
    event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0]?.focus();
  }
}, true);
let mobileViewportSettleTimer = null;
function scheduleMobileViewportUpdate() {
  updateMobileViewport();
  requestAnimationFrame(updateMobileViewport);
  clearTimeout(mobileViewportSettleTimer);
  mobileViewportSettleTimer = setTimeout(updateMobileViewport, 60);
}
window.visualViewport?.addEventListener('resize', scheduleMobileViewportUpdate);
window.visualViewport?.addEventListener('scroll', scheduleMobileViewportUpdate);
window.addEventListener('resize', scheduleMobileViewportUpdate);
document.addEventListener('focusin', () => { if (isMobileView()) scheduleMobileViewportUpdate(); });
document.addEventListener('focusout', () => { if (isMobileView()) scheduleMobileViewportUpdate(); });
mobileMedia.addEventListener('change', changeMobileMode);
mobileReady = true;
changeMobileMode();
