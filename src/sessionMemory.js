const { resolveSessionName } = require('./sessionDirectory');
const fs = require('fs');
const path = require('path');

const MEMORY_VERSION = 1;
const MAX_FIELD = 65536;
// Identity and memory ride along on every request after hydration, so they are
// capped like Letta memory blocks rather than allowed to grow with the panel.
const MAX_CONTEXT_CHARS = 6000;
const MAX_CHARTER_CHARS = 8000;
const ROTATE_CONTEXT_TOKENS = 60000;
const ROTATE_IDLE_MS = 10 * 60 * 1000;
const ROTATE_STEP_TIMEOUT_MS = 30 * 60 * 1000;

function capped(value, max, label) {
  const result = String(value || '').trim();
  if (result.length > max) throw new Error(`${label} exceeds ${max.toLocaleString('en-US')} characters; rewrite it shorter instead of appending`);
  return result;
}

function text(value, { required = false, label = 'value', truncate = true } = {}) {
  const result = String(value || '').trim();
  if (required && !result) throw new Error(`${label} is required`);
  if (!truncate && result.length > MAX_FIELD) throw new Error(`${label} exceeds 65,536 characters`);
  return result.slice(0, MAX_FIELD);
}

function timestamp(value) {
  const result = String(value || '');
  return Number.isNaN(Date.parse(result)) ? '' : result;
}

function normalizeConversation(raw) {
  if (!raw || typeof raw !== 'object') return { kind: '', id: '', at: '' };
  const kind = ['claude', 'codex'].includes(String(raw.kind || '').toLowerCase())
    ? String(raw.kind).toLowerCase() : '';
  return {
    kind,
    id: String(raw.id || '').slice(0, 128),
    at: timestamp(raw.at),
  };
}

function normalizeSessionMemory(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const proposedCharter = text(source.proposedCharter);
  return {
    version: MEMORY_VERSION,
    revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
    approvedCharter: text(source.approvedCharter),
    contextSummary: text(source.contextSummary),
    proposedCharter,
    proposalReason: text(source.proposalReason),
    reviewState: proposedCharter && source.reviewState === 'pending' ? 'pending' : 'none',
    updatedAt: timestamp(source.updatedAt),
    approvedAt: timestamp(source.approvedAt),
    contextUpdatedAt: timestamp(source.contextUpdatedAt),
    proposalUpdatedAt: timestamp(source.proposalUpdatedAt),
    hydratedConversation: normalizeConversation(source.hydratedConversation),
    awaitingInitialConversation: source.awaitingInitialConversation === true,
    expectNewConversation: source.expectNewConversation === true,
  };
}

function seedSessionMemory(charter, now = new Date().toISOString()) {
  const approvedCharter = text(charter, { required: true, label: 'charter', truncate: false });
  return normalizeSessionMemory({
    version: MEMORY_VERSION,
    revision: 1,
    approvedCharter,
    updatedAt: now,
    approvedAt: now,
    awaitingInitialConversation: true,
  });
}

function next(memory, patch, now) {
  const current = normalizeSessionMemory(memory);
  return normalizeSessionMemory({
    ...current,
    ...patch,
    revision: current.revision + 1,
    updatedAt: now || new Date().toISOString(),
  });
}

function applyMemoryOperation(memory, operation, now = new Date().toISOString()) {
  const current = normalizeSessionMemory(memory);
  const op = operation && typeof operation === 'object' ? operation : {};
  if (['approve-charter', 'reject-charter'].includes(op.type) && Number(op.revision) !== current.revision) {
    throw new Error('Charter proposal was superseded by a newer revision');
  }
  if (op.type === 'replace-context') {
    return next(current, {
      contextSummary: capped(op.contextSummary, MAX_CONTEXT_CHARS, 'context'),
      contextUpdatedAt: now,
    }, now);
  }
  if (op.type === 'replace-approved-charter') {
    const approvedCharter = capped(text(op.approvedCharter, { required: true, label: 'charter', truncate: false }), MAX_CHARTER_CHARS, 'charter');
    return next(current, {
      approvedCharter,
      approvedAt: now,
      proposedCharter: '',
      proposalReason: '',
      proposalUpdatedAt: '',
      reviewState: 'none',
    }, now);
  }
  if (op.type === 'propose-charter') {
    const proposedCharter = capped(text(op.proposedCharter, { required: true, label: 'charter', truncate: false }), MAX_CHARTER_CHARS, 'charter');
    return next(current, {
      proposedCharter,
      proposalReason: text(op.reason, { label: 'reason', truncate: false }),
      proposalUpdatedAt: now,
      reviewState: 'pending',
    }, now);
  }
  if (op.type === 'complete-job') {
    return next(current, { reviewState: current.proposedCharter ? 'pending' : 'none' }, now);
  }
  if (op.type === 'approve-charter') {
    if (!current.proposedCharter) throw new Error('No charter proposal is pending');
    return next(current, {
      approvedCharter: current.proposedCharter,
      approvedAt: now,
      proposedCharter: '',
      proposalReason: '',
      proposalUpdatedAt: '',
      reviewState: 'none',
    }, now);
  }
  if (op.type === 'reject-charter') {
    if (!current.proposedCharter) throw new Error('No charter proposal is pending');
    return next(current, {
      proposedCharter: '',
      proposalReason: '',
      proposalUpdatedAt: '',
      reviewState: 'none',
    }, now);
  }
  if (op.type === 'expect-new-conversation') return next(current, { expectNewConversation: true }, now);
  // A fresh launch carries the hydration prompt itself; bind whichever
  // conversation appears next instead of hydrating it a second time.
  if (op.type === 'await-initial-conversation') {
    return next(current, {
      awaitingInitialConversation: true,
      expectNewConversation: false,
      hydratedConversation: { kind: '', id: '', at: '' },
    }, now);
  }
  if (op.type === 'bind-conversation' || op.type === 'mark-hydrated') {
    const conversation = normalizeConversation(op.conversation);
    if (!conversation.kind || !conversation.id) throw new Error('A valid conversation identity is required');
    return next(current, {
      hydratedConversation: { ...conversation, at: conversation.at || now },
      awaitingInitialConversation: false,
      expectNewConversation: false,
    }, now);
  }
  throw new Error(`Unsupported session memory operation: ${op.type || 'missing'}`);
}

function composeHydrationPrompt(memory, options = {}) {
  const current = normalizeSessionMemory(memory);
  if (!current.approvedCharter) throw new Error('Session charter is required for hydration');
  const session = String(options.session || '').trim();
  const command = String(options.memoryCommand || 'terminaltown-session-memory').trim();
  const context = current.contextSummary || 'No evolving context has been recorded yet.';
  const standby = options.mode === 'standby'
    ? '\n\nSTAND BY\nThis is a fresh start after the panel stopped. Do not start or resume work, poll, or check status on your own. Read only what the charter requires, reply READY in one line, and wait for a task from the user or the panel inbox.'
    : '';
  return `SESSION CHARTER\n${current.approvedCharter}\n\nCURRENT CONTEXT\n${context}\n\nMEMORY MAINTENANCE\nThis charter and context are durable TerminalTown session memory. Continue the role after conversation clears without restoring old dialogue. After a material decision, verified state change, durable artifact, blocker, handoff, or completed job, update the concise factual context with ${command} replace-context --stdin. Do not store secrets or transient terminal narration. If long-lived scope or responsibilities change, stage a full charter revision with ${command} propose-charter --charter-file <file> --reason-file <file>; never approve it yourself. At the end of a discrete job, run ${command} complete-job so TerminalTown can request user review without waiting for review or interrupting work.${session ? ` The TerminalTown session is ${session}.` : ''}${standby}`;
}

function composeLandingPrompt(contextTokens, memoryCommand = 'terminaltown-session-memory') {
  const k = (Math.round(Number(contextTokens || 0) / 100) / 10).toFixed(1);
  return `TerminalTown context rotation: this conversation is ${k}k tokens and every request re-sends all of it. Save what a fresh session needs to continue your role: rewrite the context (under ${MAX_CONTEXT_CHARS.toLocaleString('en-US')} characters; current job, decisions, open threads, key paths and IDs; no narration or secrets) with ${memoryCommand} replace-context --stdin. Then reply LANDED and stop. TerminalTown will clear this conversation and reload your charter and context.`;
}

// Pure decision function. TerminalTown code applies the action; no model
// supervises rotation. States: landing -> cleared -> hydrating -> done.
function rotationDecision(input = {}) {
  const memory = normalizeSessionMemory(input.memory);
  const rotation = input.rotation && typeof input.rotation === 'object' ? input.rotation : null;
  const now = Number(input.now) || Date.now();
  const threshold = Number(input.threshold) || ROTATE_CONTEXT_TOKENS;
  const tokens = Number(input.contextTokens) || 0;
  const idle = ['idle', 'waiting'].includes(String(input.state || ''));
  const detached = String(input.clients || '0') === '0';
  const conversationId = String(input.conversationId || '');
  if (!memory.approvedCharter) return { action: 'none', rotation };
  if (rotation && rotation.state === 'stalled') {
    return tokens && tokens < threshold ? { action: 'done', rotation: null } : { action: 'none', rotation };
  }
  if (rotation && rotation.state === 'landing') {
    const saved = Date.parse(memory.contextUpdatedAt || '') > Number(rotation.at || 0);
    if (saved && idle) return { action: 'clear', rotation: { ...rotation, state: 'cleared', at: now } };
    if (now - Number(rotation.at || 0) > ROTATE_STEP_TIMEOUT_MS) return { action: 'stall', rotation: { ...rotation, state: 'stalled', at: now } };
    return { action: 'none', rotation };
  }
  if (rotation && rotation.state === 'cleared') {
    if (conversationId && conversationId !== rotation.fromConversation) {
      return { action: 'hydrate', rotation: { ...rotation, state: 'hydrating', at: now, toConversation: conversationId } };
    }
    if (now - Number(rotation.at || 0) > ROTATE_STEP_TIMEOUT_MS) return { action: 'stall', rotation: { ...rotation, state: 'stalled', at: now } };
    return { action: 'none', rotation };
  }
  if (rotation && rotation.state === 'hydrating') {
    if (memory.hydratedConversation.id && memory.hydratedConversation.id === conversationId) return { action: 'done', rotation: null };
    if (now - Number(rotation.at || 0) > ROTATE_STEP_TIMEOUT_MS) return { action: 'stall', rotation: { ...rotation, state: 'stalled', at: now } };
    return { action: 'none', rotation };
  }
  const idleLongEnough = Number(input.idleSince) > 0 && now - Number(input.idleSince) >= ROTATE_IDLE_MS;
  if (tokens >= threshold && idle && detached && idleLongEnough && conversationId) {
    return { action: 'land', rotation: { state: 'landing', at: now, fromConversation: conversationId, contextTokens: tokens } };
  }
  return { action: 'none', rotation };
}

function parseResetCommand(kind, prompt) {
  const agent = String(kind || '').toLowerCase();
  const line = String(prompt || '').trim().split(/\r?\n/, 1)[0].trim();
  if (agent === 'claude') return /^\/(?:clear|reset|new)(?:\s|$)/i.test(line);
  if (agent === 'codex') return /^\/(?:clear|new)(?:\s|$)/i.test(line);
  return false;
}

function reconcileConversation(memory, observed, options = {}) {
  const current = normalizeSessionMemory(memory);
  const conversation = normalizeConversation(observed);
  if (!current.approvedCharter || !conversation.kind || !conversation.id || options.kind === 'shell') {
    return { action: 'none', memory: current, conversation };
  }
  if (current.hydratedConversation.kind === conversation.kind && current.hydratedConversation.id === conversation.id) {
    return { action: 'none', memory: current, conversation };
  }
  if (current.awaitingInitialConversation && !current.hydratedConversation.id && !current.expectNewConversation) {
    return {
      action: 'bind',
      memory: applyMemoryOperation(current, { type: 'bind-conversation', conversation }, options.now),
      conversation,
    };
  }
  if (!current.expectNewConversation) {
    return { action: 'none', memory: current, conversation };
  }
  return { action: 'hydrate', memory: current, conversation };
}

function updateSessionMemoryFile({ manifestFile, session, expectedRevision, operation, now }) {
  let name = String(session || '').trim();
  if (!name) throw new Error('Session name is required');
  const lockFile = `${manifestFile}.memory.lock`;
  let lock;
  let tempFile = '';
  try {
    lock = fs.openSync(lockFile, 'wx', 0o600);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    name = resolveSessionName(name, manifest);
    const record = manifest.sessions && manifest.sessions[name];
    if (!record) throw new Error(`Session ${name} is not present in the manifest`);
    const current = normalizeSessionMemory(record.memory);
    if (expectedRevision !== undefined && Number(expectedRevision) !== current.revision) {
      throw new Error('Session memory was superseded by a newer revision');
    }
    const updated = applyMemoryOperation(current, operation, now);
    manifest.sessions[name] = { ...record, memory: updated };
    manifest.updatedAt = now || new Date().toISOString();
    tempFile = path.join(path.dirname(manifestFile), `.${path.basename(manifestFile)}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tempFile, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    fs.chmodSync(tempFile, 0o600);
    fs.renameSync(tempFile, manifestFile);
    tempFile = '';
    return updated;
  } finally {
    if (tempFile) { try { fs.unlinkSync(tempFile); } catch {} }
    if (lock !== undefined) {
      try { fs.closeSync(lock); } catch {}
      try { fs.unlinkSync(lockFile); } catch {}
    }
  }
}

module.exports = {
  normalizeSessionMemory,
  seedSessionMemory,
  composeHydrationPrompt,
  composeLandingPrompt,
  rotationDecision,
  MAX_CONTEXT_CHARS,
  MAX_CHARTER_CHARS,
  ROTATE_CONTEXT_TOKENS,
  applyMemoryOperation,
  reconcileConversation,
  parseResetCommand,
  updateSessionMemoryFile,
};
