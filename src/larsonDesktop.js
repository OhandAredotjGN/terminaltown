// Embedded in the board webview; no terminal input or credentials cross this frame.
const LARSON_DESKTOP_SESSION = 'remote:larson-desktop';
const LARSON_DESKTOP_URL = typeof window !== 'undefined' && window.terminalTownDesktopUrl
  ? String(window.terminalTownDesktopUrl)
  : '';
function larsonRemotePageUrl() {
  const base = typeof window !== 'undefined' && window.terminalTownDesktopPageUrl
    ? String(window.terminalTownDesktopPageUrl)
    : '';
  return base ? base + (base.includes('?') ? '&' : '?') + 'returnBoard=' + encodeURIComponent(currentBoardId()) : '';
}

function preserveDesktopPlacement(data) {
  const destination = (data.sessions || []).findIndex(session => session.name === LARSON_DESKTOP_SESSION);
  if (destination < 0) return;
  const current = [...tiles.entries()].find(([, tile]) => tile.querySelector('.desktop-frame'));
  if (!current || current[0] === destination) return;
  const [source, desktop] = current;
  const displaced = tiles.get(destination) || createTile(destination);
  closePanelMenu();
  // Keep the entire viewer subtree connected. Reparenting an iframe resets its
  // browsing context on browsers without state-preserving DOM move support.
  tiles.set(source, displaced);
  tiles.set(destination, desktop);
  if (renamingSlot === source) renamingSlot = destination;
  else if (renamingSlot === destination) renamingSlot = source;
  for (const [slot, tile] of [[source, displaced], [destination, desktop]]) {
    tile.dataset.slot = String(slot);
    tile.querySelector('.panel-menu').id = 'panel-menu-' + slot;
    tile.querySelector('.tools-toggle').setAttribute('aria-controls', 'panel-menu-' + slot);
    tile.querySelector('.prompt-input').setAttribute('aria-label', 'Panel ' + (slot + 1) + ' prompt');
    const select = tile.querySelector('.font-select');
    select.title = 'Select panel ' + (slot + 1);
    select.setAttribute('aria-label', select.title);
    const move = tile.querySelector('.mobile-arrange select');
    if (move) delete move.dataset.count;
    tile.dispatchEvent(new Event('panelslotchange'));
  }
}

function setupLarsonDesktop(el) {
  if (!LARSON_DESKTOP_URL) return;
  const fullscreen = document.createElement('button');
  fullscreen.type = 'button';
  fullscreen.className = 'desktop-fullscreen';
  fullscreen.textContent = '⛶';
  fullscreen.title = 'Fullscreen desktop';
  fullscreen.setAttribute('aria-label', 'Fullscreen desktop');
  el.querySelector('.head-actions').insertBefore(fullscreen, el.querySelector('.tools-toggle'));
  const menu = document.createElement('div');
  menu.className = 'desktop-controls';
  menu.innerHTML = '<button type="button" class="desktop-reconnect">Reconnect</button><a class="desktop-open" target="_blank" rel="noopener noreferrer">Open desktop ↗</a>';
  menu.querySelector('a').href = larsonRemotePageUrl();
  menu.querySelector('a').addEventListener('click', ev => {
    if (!window.terminalTownBrowserHost) { ev.preventDefault(); post('openExternal', { url: menu.querySelector('a').href }); }
  });
  el.querySelector('.panel-menu').appendChild(menu);
  fullscreen.addEventListener('click', async () => {
    closePanelMenu();
    if (document.fullscreenElement === el) await document.exitFullscreen();
    else if (el.classList.contains('desktop-expanded')) el.classList.remove('desktop-expanded');
    else {
      try { if (!el.requestFullscreen) throw Error('Fullscreen unavailable'); await el.requestFullscreen(); }
      catch { el.classList.add('desktop-expanded'); }
    }
    updateDesktopFullscreenButton(el);
  });
  menu.querySelector('button').addEventListener('click', () => {
    const frame = el.querySelector('.desktop-frame');
    if (frame) frame.src = LARSON_DESKTOP_URL;
    closePanelMenu(true);
  });
}

function updateDesktopFullscreenButton(el) {
  const expanded = document.fullscreenElement === el || el.classList.contains('desktop-expanded');
  const button = el.querySelector('.desktop-fullscreen');
  const label = expanded ? 'Exit fullscreen desktop' : 'Fullscreen desktop';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(expanded));
}

function syncLarsonDesktop(el, session, boardId) {
  const remote = session.name === LARSON_DESKTOP_SESSION;
  if (!LARSON_DESKTOP_URL) {
    el.classList.remove('larson-desktop');
    el.querySelector('.desktop-frame')?.remove();
    return;
  }
  el.classList.toggle('larson-desktop', remote);
  let frame = el.querySelector('.desktop-frame');
  const key = boardId + ':' + session.name;
  if (frame && (!remote || frame.dataset.connection !== key)) { frame.remove(); frame = null; }
  if (!remote) {
    el.classList.remove('desktop-expanded');
    if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
    return;
  }
  el.querySelector('.desktop-open').href = larsonRemotePageUrl();
  el.querySelector('.meta').textContent = '';
  el.querySelector('.name').title = 'Larson Desktop';
  if (!frame) {
    frame = document.createElement('iframe');
    frame.className = 'desktop-frame';
    frame.title = 'Larson remote desktop';
    frame.dataset.connection = key;
    frame.allow = 'fullscreen; clipboard-read; clipboard-write';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'no-referrer';
    frame.src = LARSON_DESKTOP_URL;
    el.appendChild(frame);
  }
  sizeDesktopFrame(el);
}

function sizeDesktopFrame(el) {
  const frame = el.querySelector('.desktop-frame');
  if (!frame || !el.clientWidth) return;
  const width = el.clientWidth;
  const height = Math.max(1, el.clientHeight - el.querySelector('.head').offsetHeight);
  // noVNC's authentication/settings dialogs need a usable viewport even in
  // a small tile. Scale that viewport as well as the remote canvas.
  const scale = Math.min(1, width / 340, height / 400);
  frame.style.width = (width / scale) + 'px';
  frame.style.height = (height / scale) + 'px';
  frame.style.transform = 'scale(' + scale + ')';
}

document.addEventListener('fullscreenchange', () => {
  for (const el of document.querySelectorAll('.tile.larson-desktop')) updateDesktopFullscreenButton(el);
});
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  for (const el of document.querySelectorAll('.desktop-expanded')) {
    el.classList.remove('desktop-expanded');
    updateDesktopFullscreenButton(el);
  }
});
