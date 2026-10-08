/* Shared by actual tabs, the independent browser sentinel, and Node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TerminalTownPanelHealth = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const labels = {
    'render-empty': 'Terminal content disappeared',
    'render-missing': 'Terminal display is missing',
    'capture-empty': 'Live capture went blank',
    'capture-flapping': 'Terminal content is blinking',
    'response-gap': 'Blank space is hiding the response',
    'stale-capture': 'Live output is stale',
    'missing-session': 'Assigned session is missing',
    'capture-failed': 'Terminal capture failed',
  };
  function textMetrics(text) {
    const value = String(text || ''), lines = value.split('\n');
    let run = 0, blankGapLines = 0, end = -1;
    lines.forEach((line, index) => {
      run = line.trim() ? 0 : run + 1;
      if (run > blankGapLines) { blankGapLines = run; end = index; }
    });
    return { sourceChars: value.trim().length, blankGapLines, linesAfterGap: lines.length - end - 1, lines: lines.length };
  }
  function createMonitor({ saved } = {}) {
    const panels = new Map(Array.isArray(saved?.panels) ? saved.panels.slice(-256) : []);
    function observe(s) {
      const now = Number(s.now) || Date.now();
      const key = String(s.key);
      let p = panels.get(key);
      if (!p) { p = { hadContent: false, blankSince: 0, transitions: [], lastBlank: false, lastCapture: 0, incidents: [] }; panels.set(key, p); }
      if (panels.size > 256) panels.delete(panels.keys().next().value);
      const fresh = Number(s.capturedAt) > p.lastCapture;
      const blank = !s.sourceChars;
      if (fresh) {
        if (p.hadContent && blank !== p.lastBlank) p.transitions.push(now);
        p.transitions = p.transitions.filter(at => now - at < 60000);
        p.lastBlank = blank;
        p.lastCapture = Number(s.capturedAt);
      }
      if (s.sourceChars) { p.hadContent = true; p.blankSince = 0; }
      else if (p.hadContent && !p.blankSince) p.blankSince = now;
      const codes = [];
      if (!s.empty && !s.desktop) {
        if (s.missing) codes.push('missing-session');
        else {
          if (s.rendererMissing) codes.push('render-missing');
          if (s.captureFailed) codes.push('capture-failed');
          if (now - Number(s.capturedAt || 0) > 30000) codes.push('stale-capture');
          if (p.blankSince && now - p.blankSince >= 1500) codes.push('capture-empty');
          if (p.transitions.length >= 3) codes.push('capture-flapping');
          if (s.visible && !s.reading && !s.selected && s.sourceChars > 0 && !s.renderedChars) codes.push('render-empty');
          const gapHeight = (s.blankGapLines || 0) * (s.lineHeight || 16);
          if (s.visible && s.agent && s.sourceChars && s.blankGapLines >= 12 && gapHeight > Math.max(160, s.viewportHeight || 0) && s.linesAfterGap <= 8) codes.push('response-gap');
        }
      }
      let action = null;
      for (const code of codes) {
        let incident = p.incidents.find(i => i.code === code && i.status !== 'recovered');
        if (!incident) {
          incident = { id: key + ':' + code + ':' + now, key, code, label: labels[code], slot: s.slot, session: s.session || '', firstSeen: now, lastSeen: now, status: 'detected', attempts: [], cleanSince: 0, cleanFrames: 0, lastCleanCapture: 0 };
          p.incidents.push(incident);
        }
        incident.lastSeen = now;
        incident.cleanSince = 0; incident.cleanFrames = 0;
        incident.evidence = {
          sourceChars: s.sourceChars, renderedChars: s.renderedChars, blankGapLines: s.blankGapLines || 0,
          linesAfterGap: s.linesAfterGap || 0, viewportHeight: s.viewportHeight, lineHeight: s.lineHeight,
          capturedAt: s.capturedAt, transitions: p.transitions.length, reading: Boolean(s.reading), visible: Boolean(s.visible),
        };
        const lastAttempt = incident.attempts.at(-1);
        if (lastAttempt && now - lastAttempt.at >= 15000) lastAttempt.outcome = 'failed';
        if (code === 'missing-session' || (incident.attempts.length >= 2 && lastAttempt?.outcome === 'failed')) {
          incident.status = 'needs-attention';
        } else if (s.recoveryAllowed !== false && !s.reading && !s.selected && s.visible && (!lastAttempt || now - lastAttempt.at >= 15000)) {
          incident.attempts.push({ at: now, action: 'refresh-and-repaint', outcome: 'pending' });
          incident.status = 'repairing';
          action = { type: 'refresh-and-repaint', key, slot: s.slot };
        }
      }
      for (const i of p.incidents) {
        if (codes.includes(i.code) || i.status === 'recovered') continue;
        // Hidden/unobserved panes and deliberate history reading cannot certify repair.
        if (!s.visible || s.reading || s.selected || s.empty || s.desktop || s.missing || now - Number(s.capturedAt || 0) > 30000) continue;
        if (!i.cleanSince) i.cleanSince = now;
        if (Number(s.capturedAt) > i.lastCleanCapture) { i.cleanFrames++; i.lastCleanCapture = Number(s.capturedAt); }
        // Escalation stays visible while we gather proof; a good frame is not recovery.
        const exhausted = i.attempts.length >= 2 && i.attempts.at(-1)?.outcome === 'failed';
        i.status = i.status === 'needs-attention' || exhausted ? 'needs-attention' : 'verifying';
        if (i.cleanFrames >= 3 && now - i.cleanSince >= 20000) {
          i.status = 'recovered'; i.resolvedAt = now;
          const lastAttempt = i.attempts.at(-1);
          if (lastAttempt?.outcome === 'pending') lastAttempt.outcome = 'verified';
        }
      }
      p.incidents = p.incidents.filter(i => i.status !== 'recovered' || now - i.resolvedAt < 86400000).slice(-30);
      return { incidents: p.incidents, action };
    }
    return { observe, snapshot: () => ({ panels: [...panels] }), incidents: () => [...panels.values()].flatMap(p => p.incidents) };
  }
  function frontendIdentity(directory) {
    // Called only by Node hosts; the same file list follows the standalone and extension renderers.
    const fs = require('node:fs'), path = require('node:path'), hash = require('node:crypto').createHash('sha256');
    const files = ['aiGrid.js','mobile.js','mobile.css','mobile.html','panelHealth.js','panelHealthClient.js','panelHealth.css','panelHealth.html'];
    for (const file of files) { hash.update(file); hash.update(fs.readFileSync(path.join(directory,file))); }
    return hash.digest('hex').slice(0,20);
  }
  return { createMonitor, textMetrics, labels, frontendIdentity };
});
