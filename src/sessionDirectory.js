const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const DESKTOP = 'remote:larson-desktop';
const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const slug = value => normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0,48).replace(/-+$/, '') || 'session';
const genericName = name => /^(?:(?:codex|claude)(?: panel \d+| larson)?|\d+ \d+ \d+|panel \d+)$/.test(normalize(name));
function roleTitle(goal) {
 const text = String(goal || '').trim();
 const dedicated = text.match(/dedicated to\s+([^.!?\n]+)/i);
 const value = (dedicated ? dedicated[1] : text.split(/[.!?\n]/)[0]).replace(/^(?:please\s+)?(?:launch|create|start)\s+(?:a\s+)?(?:new\s+)?(?:session|terminal)\s+(?:to|for)\s+/i, '').trim().slice(0,80);
 return value ? value[0].toUpperCase()+value.slice(1) : '';
}
function sessionNameFor(name, title, goal = '') {
 const label = String(title || '').trim() || roleTitle(goal);
 if ((!name || genericName(name)) && (!label || genericName(label) || normalize(label) === normalize(name))) throw new Error('Use a meaningful session name describing its purpose.');
 if (!name || genericName(name)) return slug(label);
 return String(name);
}
function resolveSessionName(input, manifest = {}, extraNames = [], titles = []) {
 const value = String(input || '').trim();
 if (!value) return '';
 const sessions = manifest.sessions || {};
 const names = [...new Set([...Object.keys(sessions), ...extraNames])];
 // Exact stable IDs win. Human titles and old IDs must resolve uniquely.
 if (names.includes(value)) return value;
 const folded = value.toLowerCase();
 const titleMap = new Map(titles.map(record => [record.tmux, record.title]));
 const matches = names.filter(name => name.toLowerCase() === folded ||
   (sessions[name]?.aliases || []).some(alias => String(alias).toLowerCase() === folded) ||
   String(titleMap.get(name) || sessions[name]?.title || '').toLowerCase() === folded);
 if (matches.length > 1) throw new Error(`Ambiguous session name "${value}": ${matches.join(', ')}. Choose a session from Find.`);
 return matches[0] || value;
}
function buildDirectory({ manifest = {}, boards = [], liveNames = [], titles = [] } = {}) {
 const sessions = manifest.sessions || {};
 const titleMap = new Map(titles.map(record => [record.tmux, record.title]));
 const names = new Set([DESKTOP, ...Object.keys(sessions), ...liveNames]);
 for (const board of boards) for (const name of [...(board.slots || []), ...(board.heldSessions || [])]) if (name && (NAME_RE.test(name) || name === DESKTOP)) names.add(name);
 return [...names].map(name => {
   const record = sessions[name] || (name === DESKTOP ? {title:'Larson Desktop',kind:'desktop',aliases:['Larson Remote']} : {});
   const locations = boards.flatMap(board => (board.slots || []).flatMap((item, slot) => item === name ? [{boardId:board.id || board.boardId, boardTitle:board.title || board.boardTitle || board.id, panel:slot+1}] : []));
   for (const board of boards) if ((board.heldSessions || []).includes(name) && !(board.slots || []).includes(name)) locations.push({boardId:board.id || board.boardId, boardTitle:board.title || board.boardTitle || board.id, panel:null, surface:'holding'});
   const metaBoard = name.startsWith('terminaltown-meta-') && boards.find(board => name === 'terminaltown-meta-'+(board.id || board.boardId));
   if (metaBoard) locations.push({boardId:metaBoard.id || metaBoard.boardId, boardTitle:metaBoard.title || metaBoard.boardTitle || metaBoard.id, panel:null, surface:'meta'});
   return { name, title:record.title && !genericName(record.title) ? record.title : titleMap.get(name) || record.title || name, aliases:record.aliases || [], charter:String(record.memory?.approvedCharter || ''), cwd:record.cwd || '', kind:record.kind || '', live:liveNames.includes(name), locations };
 }).sort((a,b) => a.title.localeCompare(b.title));
}
function searchDirectory(directory, query = '') {
 const words = normalize(query).split(' ').filter(Boolean);
 return directory.filter(record => {
   const haystack = normalize([record.name,record.title,...record.aliases,record.charter,record.cwd,...record.locations.map(loc => `${loc.boardId} ${loc.boardTitle} ${loc.surface === 'holding' ? 'holding' : loc.surface === 'meta' ? 'meta terminal' : 'panel '+loc.panel}`),record.locations.length ? '' : 'holding'].join(' '));
   return words.every(word => haystack.includes(word));
 }).sort((a,b) => {
   const q = normalize(query);
   const score = row => normalize(row.title) === q ? 5 : [row.name, ...row.aliases].some(name => normalize(name) === q) ? 4 : normalize(row.title).includes(q) ? 3 : row.locations.length ? 1 : 0;
   return score(b)-score(a) || a.title.localeCompare(b.title);
 });
}
function readJson(file, fallback) { try {return JSON.parse(fs.readFileSync(file,'utf8'));} catch {return fallback;} }
function readDirectory({ dataDir = process.env.TERMINALTOWN_DATA_DIR || path.join(os.homedir(),'.local/share/terminaltown'), manifestFile = process.env.TERMINALTOWN_MANIFEST || path.join(dataDir,'sessions-manifest.json'), titlesFile = path.join(os.homedir(),'.vscode-summon/titles.json'), liveNames = [] } = {}) {
 const boards = [];
 const add = (file,id,title) => { const board=readJson(file, null); if(board) boards.push({...board,id:board.boardId || id,title:board.boardTitle || board.title || title}); };
 add(path.join(dataDir,'layout.json'),'default','TerminalTown');
 try {for (const file of fs.readdirSync(path.join(dataDir,'boards'))) if(file.endsWith('.json')) add(path.join(dataDir,'boards',file),file.slice(0,-5),file.slice(0,-5));} catch {}
 const rawTitles = readJson(titlesFile,[]);
 return buildDirectory({manifest:readJson(manifestFile,{}),boards,titles:Array.isArray(rawTitles) ? rawTitles : rawTitles.titles || [],liveNames});
}
module.exports = { buildDirectory, searchDirectory, resolveSessionName, sessionNameFor, roleTitle, readDirectory, genericName, slug };
