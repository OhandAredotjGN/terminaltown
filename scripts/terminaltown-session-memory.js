#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { updateSessionMemoryFile } = require('../src/sessionMemory');

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      manifest: { type: 'string' },
      session: { type: 'string' },
      revision: { type: 'string' },
      stdin: { type: 'boolean' },
      'charter-file': { type: 'string' },
      'reason-file': { type: 'string' },
    },
  });
  const type = positionals[0];
  if (positionals.length !== 1 || !['replace-context', 'propose-charter', 'complete-job'].includes(type)) {
    throw new Error('Use replace-context --stdin, propose-charter --charter-file <file> --reason-file <file>, or complete-job');
  }
  if (!values.session || !values.session.trim()) throw new Error('--session is required');
  const expectedRevision = values.revision === undefined ? undefined : Number(values.revision);
  if (values.revision !== undefined && (!/^\d+$/.test(values.revision) || !Number.isSafeInteger(expectedRevision))) {
    throw new Error('--revision must be a nonnegative integer');
  }
  if (values.stdin && type !== 'replace-context') throw new Error('--stdin requires replace-context');
  if ((values['charter-file'] !== undefined || values['reason-file'] !== undefined) && type !== 'propose-charter') {
    throw new Error('Charter and reason files require propose-charter');
  }
  let operation = { type };
  if (type === 'replace-context') {
    if (!values.stdin) throw new Error('replace-context requires --stdin');
    operation.contextSummary = fs.readFileSync(0, 'utf8');
  }
  if (type === 'propose-charter') {
    if (!values['charter-file'] || !values['reason-file']) throw new Error('propose-charter requires --charter-file and --reason-file');
    operation.proposedCharter = fs.readFileSync(values['charter-file'], 'utf8');
    operation.reason = fs.readFileSync(values['reason-file'], 'utf8');
  }
  const dataDir = process.env.TERMINALTOWN_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'terminaltown-public');
  const manifestFile = values.manifest || process.env.TERMINALTOWN_MANIFEST || path.join(dataDir, 'sessions-manifest.json');
  const memory = updateSessionMemoryFile({ manifestFile, session: values.session, expectedRevision, operation });
  process.stdout.write(`Session memory saved (revision ${memory.revision}).\n`);
} catch (error) {
  process.stderr.write(`terminaltown-session-memory: ${error.message}\n`);
  process.exitCode = 1;
}
