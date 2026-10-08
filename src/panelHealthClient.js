// Runs independently of refresh completion: a stuck request cannot stop detection.
const panelHealth = (() => {
  const button = document.getElementById('panelHealthButton');
  const dialog = document.getElementById('panelHealthDialog');
  const summary = document.getElementById('panelHealthSummary');
  const list = document.getElementById('panelHealthIncidents');
  const coverage = document.getElementById('panelHealthCoverage');
  let observer;
  try {
    observer = window.terminalTownHealthObserver || sessionStorage.getItem('terminaltown-health-observer');
    if (!observer) observer = 'tab-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
    sessionStorage.setItem('terminaltown-health-observer', observer);
  } catch { observer = 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
  const storageKey = 'terminaltown-health:' + observer;
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(storageKey)); } catch {}
  let monitor = TerminalTownPanelHealth.createMonitor({ saved });
  let lastReport = 0, reporting = false, telemetryError = false, localStorageError = false, serverState = null;
  let initialized = false, loading = false, lastLoad = 0, loadTimeout = null;
  const checked = new Map();
  let observedPanels = 0, repairInFlight = false;
  const buildId = window.terminalTownHealthBuild || window.terminalTownHealthUiBuild || 'unknown';
  const kind = window.terminalTownHealthObserver ? 'sentinel' : window.terminalTownBrowserHost ? 'tab' : 'extension';
  const desktopParent = button.parentNode, desktopNext = button.nextSibling;
  const mobileControl = document.getElementById('mobileControlsButton');
  const mobileStatus = document.createElement('span');
  mobileStatus.className = 'health-mobile-status'; button.append(mobileStatus);
  function placeHealthControl() {
    if (isMobileView()) document.getElementById('mobileHealthHost').append(button);
    else desktopParent.insertBefore(button, desktopNext);
  }
  placeHealthControl();
  window.addEventListener('resize', placeHealthControl);
  button.addEventListener('click', () => { if (isMobileView()) closeMobileSheet(false); draw(); dialog.showModal(); });
  document.getElementById('panelHealthClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => (isMobileView() ? mobileControl : button).focus({ preventScroll: true }));
  dialog.addEventListener('keydown', event => event.stopPropagation());
  document.getElementById('panelHealthDetails').hidden = !window.terminalTownBrowserHost;

  function report() {
    const board = currentBoardId(), now = Date.now();
    const sessions = (lastBoardData?.sessions || []).filter(s => s.name && s.type !== 'larson-desktop');
    const keys = new Set(sessions.map(s => board + ':' + s.name));
    return { observer, kind, board, buildId, historyReady: initialized, at: now, capturedAt: Number(lastBoardData?.at) || 0,
      visible: !document.hidden, totalPanels: sessions.length,
      checkedPanels: [...checked].filter(([key, at]) => keys.has(key) && now - at < 30000).length,
      viewport: { width: innerWidth, height: innerHeight }, observedPanels,
      detectors: monitor.snapshot().panels.filter(([key]) => key.startsWith(board + ':')).map(([key, p]) => [key, {
        hadContent: p.hadContent, lastBlank: p.lastBlank, lastCapture: p.lastCapture, blankSince: p.blankSince, transitions: p.transitions,
      }]),
      incidents: monitor.incidents().filter(i => i.key.startsWith(board + ':')).slice(-200) };
  }
  function draw() {
    const active = monitor.incidents().filter(i => i.key.startsWith(currentBoardId() + ':') && i.status !== 'recovered');
    const remote = (serverState?.incidents || []).filter(i => i.board === currentBoardId() && i.observer !== observer && i.status !== 'recovered');
    // Keep per-observer evidence in the ledger, but present each panel fault once.
    const groups = new Map(), severity = { detected: 0, verifying: 1, repairing: 2, 'needs-attention': 3 };
    for (const incident of [...active, ...remote]) {
      const key = incident.key + ':' + incident.code, group = groups.get(key);
      if (!group) groups.set(key, { incident, observers: new Set([incident.observer || observer]), firstSeen: incident.firstSeen });
      else {
        group.observers.add(incident.observer || observer);
        group.firstSeen = Math.min(group.firstSeen, incident.firstSeen);
        if (severity[incident.status] > severity[group.incident.status]
          || (severity[incident.status] === severity[group.incident.status] && incident.attempts.length > group.incident.attempts.length)) group.incident = incident;
      }
    }
    const all = [...groups.values()].map(group => ({ ...group.incident, firstSeen: group.firstSeen, observerCount: group.observers.size }));
    const staleBuild = serverState && (kind === 'extension' ? serverState.uiBuild : serverState.buildId) !== buildId;
    const stale = !lastBoardData?.at || Date.now() - lastBoardData.at > 30000;
    const boardCoverage = serverState?.boards?.find(b => b.board === currentBoardId());
    const sourceDrift = Boolean(serverState?.monitor?.sourceDrift);
    const observerUnavailable = serverState?.monitor && serverState.monitor.state !== 'running';
    const historyFailure = localStorageError || serverState?.storage?.state === 'failed';
    const state = telemetryError || historyFailure || sourceDrift || all.some(i => i.status === 'needs-attention') ? 'needs-attention'
      : all.length ? 'degraded' : stale || staleBuild || !initialized || !boardCoverage?.covered || observerUnavailable ? 'unknown' : 'healthy';
    button.dataset.state = state;
    mobileControl.dataset.health = state;
    mobileControl.setAttribute('aria-label', 'Controls, panel health ' + state.replace(/-/g, ' '));
    mobileStatus.textContent = state === 'needs-attention' ? 'Needs attention' : state[0].toUpperCase() + state.slice(1);
    button.title = 'Panel health: ' + state.replace(/-/g, ' ') + (all.length ? ' · ' + all.length + ' incidents' : '');
    button.setAttribute('aria-label', button.title);
    summary.textContent = telemetryError ? 'Health history unavailable. Automatic recovery is paused.'
      : historyFailure ? 'Recovery history could not be saved.' : sourceDrift ? 'Source and running build differ.'
      : staleBuild ? 'This interface build is out of date.' : observerUnavailable ? 'Background browser observation is unavailable.'
      : state === 'healthy' ? 'Observed panels are healthy' : state === 'unknown' ? 'Waiting for fresh, complete observations'
      : all.length + ' incident' + (all.length === 1 ? '' : 's') + ' · ' + state.replace(/-/g, ' ');
    coverage.textContent = observedPanels + ' visible terminal panels · ' + (stale ? 'output stale' : 'checked ' + new Date().toLocaleTimeString());
    for (const [, tile] of tiles) {
      const issues = active.filter(i => i.session === tile.dataset.session);
      if (issues.length) tile.dataset.health = issues.some(i => i.status === 'needs-attention') ? 'needs-attention' : 'degraded';
      else delete tile.dataset.health;
    }
    if (!dialog.open && !all.length) return;
    list.replaceChildren();
    for (const i of all.slice(0, 30)) {
      const li = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('div'), meta = document.createElement('div');
      title.textContent = 'Panel ' + (Number(i.slot) + 1) + ' · ' + i.label;
      detail.textContent = i.status === 'needs-attention' ? 'Needs attention · ' + i.attempts.length + '/2 recovery attempts'
        : i.status === 'verifying' ? 'Verifying stable output' : i.status === 'repairing' ? 'Refreshing and rebuilding display'
        : initialized ? 'Detected · recovery waits while you read' : 'Detected · waiting for recovery history';
      meta.className = 'health-meta';
      meta.textContent = new Date(i.firstSeen).toLocaleTimeString() + ' · ' + (i.observerCount > 1 ? i.observerCount + ' observers' : i.kind === 'sentinel' ? 'Background browser' : i.observer && i.observer !== observer ? 'Another tab' : 'This tab')
        + (i.evidence?.blankGapLines >= 12 ? ' · ' + i.evidence.blankGapLines + ' blank lines' : '');
      li.append(title, detail, meta); list.append(li);
    }
  }
  function hydrate(data) {
    if (!data?.buildId || !Array.isArray(data.incidents) || !Array.isArray(data.observers)) throw Error('Invalid health history');
    serverState = data;
    const panels = new Map(monitor.snapshot().panels);
    const stored = data.observers.find(o => o.id === observer);
    for (const [key, saved] of stored?.detectors || []) {
      const local = panels.get(key);
      panels.set(key, { ...saved, incidents: local?.incidents || [] });
    }
    for (const i of data.incidents) if (i.observer === observer) {
      let p = panels.get(i.key);
      if (!p) { p = { hadContent: false, blankSince: 0, transitions: [], lastBlank: false, lastCapture: 0, incidents: [] }; panels.set(i.key, p); }
      // A preliminary local detection must not outrank an exhausted durable incident.
      const duplicate = p.incidents.find(x => x.code===i.code && x.status!=='recovered' && i.status!=='recovered');
      const merged = duplicate && duplicate.attempts.length > i.attempts.length ? duplicate : i;
      p.incidents = p.incidents.filter(x => x.id !== merged.id && !(merged.status !== 'recovered' && x.code === merged.code && x.status !== 'recovered'));
      p.incidents.push(merged);
    }
    monitor = TerminalTownPanelHealth.createMonitor({ saved: { panels: [...panels] } });
    initialized = true; loading = false; telemetryError = false; clearTimeout(loadTimeout);
  }
  async function loadHistory() {
    if (loading || initialized) return;
    loading = true; lastLoad = Date.now();
    loadTimeout = setTimeout(() => { loading = false; telemetryError = true; draw(); }, 4500);
    try {
      if (window.terminalTownBrowserHost) {
        const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw Error('Health unavailable');
        hydrate(await response.json());
      } else await post('healthLoad');
    } catch { loading = false; telemetryError = true; clearTimeout(loadTimeout); }
  }
  function applyHealthCapture(data) {
    if (!lastBoardData || data?.board?.id !== currentBoardId() || Number(data.at) <= Number(lastBoardData.at)) return;
    if ((Number(data.board.layoutRevision)||0) !== renderedLayoutRevision) return;
    const previous = new Map((lastBoardData.sessions||[]).map(s=>[s.slot,s.name]));
    if (!Array.isArray(data.sessions) || data.sessions.length !== previous.size || data.sessions.some(s=>previous.get(s.slot)!==s.name)) return;
    lastBoardData = { ...lastBoardData, at:data.at, recovery:data.recovery, warning:data.warning, sessions:data.sessions };
    for (const s of data.sessions) {
      if (!s.name || s.type==='larson-desktop') continue;
      const pre=tiles.get(s.slot)?.querySelector('.terminal-output');
      if (pre) updateTerminalViewport(pre,s.output,currentBoardId()+':'+s.name,false,pre._terminaltownDisplayMode||'',s.cwd||'');
    }
    // Do not call render(): it also schedules normal geometry synchronization and board operations.
    sample();
  }
  async function refreshReadOnly() {
    if (repairInFlight) return;
    repairInFlight = true;
    try {
      if (window.terminalTownBrowserHost) {
        const response = await fetch('/api/state?observe=1&board=' + encodeURIComponent(currentBoardId()), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw Error('Read-only collection failed');
        const data = await response.json();
        if (data.board?.id === currentBoardId()) window.dispatchEvent(new MessageEvent('message', { data: { type: 'healthData', data } }));
      } else await post('healthRefresh');
    } catch { /* Independent observations verify recovery, including unsuccessful refreshes. */ }
    finally { repairInFlight = false; }
  }
  async function publish(packet) {
    if (reporting || !initialized) return;
    reporting = true; lastReport = Date.now();
    try {
      if (window.terminalTownBrowserHost) {
        const response = await fetch('/api/health', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packet), signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw Error('Health reporting failed');
        serverState = await response.json(); telemetryError = false;
      } else {
        const result = await post('healthReport', { report: packet });
        if (result?.ok === false) throw Error('Health reporting failed');
        // postMessage delivery alone is not a durable acknowledgment; healthResult handles it.
      }
    } catch { telemetryError = true; }
    finally { reporting = false; draw(); }
  }
  function sample() {
    if (!initialized && Date.now() - lastLoad >= 5000) loadHistory();
    if (!lastBoardData) { draw(); return; }
    observedPanels = 0;
    let changed = false, needsRefresh = false;
    const now = Date.now();
    for (const s of lastBoardData.sessions || []) {
      if (!s.name || s.type === 'larson-desktop') continue;
      const tile = tiles.get(s.slot);
      let pre = tile?.querySelector('.terminal-output');
      const rendererMissing = !tile?.isConnected || !pre;
      if (!pre) pre = tile?.querySelector('pre');
      const ownerRect = tile?.getBoundingClientRect();
      const rect = pre?.getBoundingClientRect() || ownerRect;
      const style = pre ? getComputedStyle(pre) : null;
      const visible = Boolean(!document.hidden && rect?.width > 0 && rect?.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth && style?.visibility !== 'hidden');
      if (visible && !rendererMissing) { observedPanels++; checked.set(currentBoardId() + ':' + s.name, now); }
      const selected = pre ? hasTerminalSelection(pre) : false;
      const reading = Boolean(pre?._terminaltownHealthReading);
      const result = monitor.observe({ ...TerminalTownPanelHealth.textMetrics(s.output), now, key: currentBoardId() + ':' + s.name,
        slot: s.slot, session: s.name, capturedAt: Number(lastBoardData.at) || 0, visible, selected, reading, rendererMissing,
        recoveryAllowed: initialized && !telemetryError && !localStorageError && serverState?.storage?.state !== 'failed',
        renderedChars: style?.opacity === '0' ? 0 : String(pre?.textContent || '').trim().length,
        agent: Boolean(s.threadId || s.resumeId || /codex|claude/i.test(s.command || '')), missing: Boolean(s.missing || s.state === 'missing'),
        captureFailed: Boolean(lastBoardData.recovery || s.captureFailed || String(s.output || '').startsWith('(could not capture ')),
        viewportHeight: pre?.clientHeight || 0, lineHeight: parseFloat(style?.lineHeight) || 16 });
      if (result.action) {
        changed = true; needsRefresh = true;
        if (tile?.isConnected) {
          if (!pre) { pre = document.createElement('pre'); tile.insertBefore(pre, tile.querySelector('.codex-question') || tile.querySelector('form')); }
          pre.classList.add('terminal-output');
          const left = pre.scrollLeft;
          pre._terminaltownRawOutput = undefined;
          updateTerminalViewport(pre, s.output, currentBoardId() + ':' + s.name, true, pre._terminaltownDisplayMode || '', s.cwd || '');
          pre.scrollLeft = left;
        }
      }
    }
    if (needsRefresh) refreshReadOnly();
    try { sessionStorage.setItem(storageKey, JSON.stringify(monitor.snapshot())); localStorageError = false; } catch { localStorageError = true; }
    draw();
    if (changed || now - lastReport >= 5000) publish(report());
  }
  window.addEventListener('message', event => {
    if (event.data?.type === 'healthData') { applyHealthCapture(event.data.data); return; }
    if (event.data?.type !== 'healthResult') return;
    if (event.data.error) { telemetryError = true; if (event.data.loaded) { loading = false; clearTimeout(loadTimeout); } }
    else if (event.data.loaded) { try { hydrate(event.data.snapshot); } catch { telemetryError = true; loading = false; } }
    else { serverState = event.data.snapshot || null; telemetryError = false; }
    draw();
  });
  loadHistory();
  setInterval(sample, 1000);
  return { sample, report };
})();
window.terminalTownHealth = panelHealth;
