const sessionFinder = document.getElementById('sessionFinder');
const sessionFinderInput = document.getElementById('sessionFinderInput');
let sessionFinderRecords = [];
let sessionFinderReturnFocus = null;
let pendingSessionFocus = window.terminalTownBrowserHost ? new URL(location.href).searchParams.get('session') || '' : '';
function normalizeSessionSearch(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function renderSessionFinder() {
  const words = normalizeSessionSearch(sessionFinderInput.value).split(' ').filter(Boolean);
  const matches = sessionFinderRecords.filter(record => {
    const text = normalizeSessionSearch([record.title, record.name, ...(record.aliases || []), record.charter, record.cwd, ...(record.locations || []).map(loc => loc.boardTitle+' '+loc.boardId+' '+(loc.surface==='holding'?'Holding':loc.surface==='meta'?'Meta Terminal':'panel '+loc.panel)), record.locations.length ? '' : 'Holding'].join(' '));
    return words.every(word => text.includes(word));
  }).sort((a,b) => { const query=normalizeSessionSearch(sessionFinderInput.value); const score=record => normalizeSessionSearch(record.title)===query ? 5 : [record.name,...record.aliases].some(name=>normalizeSessionSearch(name)===query) ? 4 : normalizeSessionSearch(record.title).includes(query) ? 3 : record.locations.length ? 1 : 0; return score(b)-score(a) || a.title.localeCompare(b.title); });
  const results = document.getElementById('sessionFinderResults');
  results.replaceChildren();
  document.getElementById('sessionFinderStatus').textContent = matches.length ? matches.length+' sessions' : 'No matching sessions';
  for (const record of matches) {
    for (const loc of record.locations.length ? record.locations : [null]) {
      const button = document.createElement('button'); button.type='button'; button.className='session-result';
      const title = document.createElement('strong'); title.textContent=record.title;
      const locationLabel = document.createElement('span'); locationLabel.className='session-location'; locationLabel.textContent=loc ? loc.boardTitle+(loc.surface==='meta' ? ' · Meta Terminal' : loc.surface==='holding' ? ' · Holding' : ' · Panel '+loc.panel) : 'Holding';
      button.append(title,locationLabel);
      if (record.charter) { const role=document.createElement('span'); role.className='session-role'; role.textContent=record.charter; button.append(role); }
      button.addEventListener('click', () => {
        sessionFinderReturnFocus=null; sessionFinder.close();
        const destination = loc?.boardId || currentBoardId();
        if (destination === currentBoardId()) { pendingSessionFocus=record.name; applySessionFocus(); return; }
        if (window.terminalTownBrowserHost) { const url=new URL(location.href); url.searchParams.set('board',destination); url.searchParams.set('session',record.name); location.assign(url.href); }
        else post('findSession', {boardId:destination, session:record.name});
      });
      results.append(button);
    }
  }
}
function showSessionFinder() {
  sessionFinderReturnFocus=document.activeElement;
  closeMobileSheet(false);
  sessionFinderInput.value=''; sessionFinderRecords=[];
  document.getElementById('sessionFinderResults').replaceChildren();
  document.getElementById('sessionFinderStatus').textContent='Loading sessions…';
  sessionFinder.showModal(); sessionFinderInput.focus(); post('sessionDirectory');
}
function applySessionFocus() {
  if (!pendingSessionFocus) return;
  if (pendingSessionFocus==='terminaltown-meta-'+currentBoardId()) { pendingSessionFocus=''; setMetaOpen(true); metaGoal.focus({preventScroll:true}); return; }
  const slot=slotSessions.indexOf(pendingSessionFocus);
  if (slot >= 0) {
    if (isMobileView()) openMobilePanel(slot);
    else { setSelected(slot,{focusProxy:false}); tiles.get(slot)?.scrollIntoView({block:'nearest'}); tiles.get(slot)?.querySelector('.tools-toggle')?.focus({preventScroll:true}); }
  } else if (holdingNames.includes(pendingSessionFocus)) {
    holdingQuery=pendingSessionFocus; holdingFilterValue='all'; resetHoldingBoardFilter(); holdingSearch.value=holdingQuery; renderHoldingList(); setHoldingOpen(true,false);
  } else return;
  pendingSessionFocus='';
  if (window.terminalTownBrowserHost) { const url=new URL(location.href); url.searchParams.delete('session'); history.replaceState(null,'',url.href); }
}
for (const id of ['findSession','mobileFindSession']) document.getElementById(id).addEventListener('click',showSessionFinder);
sessionFinderInput.addEventListener('input',renderSessionFinder);
sessionFinderInput.addEventListener('keydown',event => { if(event.key==='Enter') { event.preventDefault(); document.querySelector('#sessionFinderResults button')?.click(); } });
sessionFinder.addEventListener('keydown',event=>event.stopPropagation());
document.getElementById('sessionFinderClose').addEventListener('click',()=>sessionFinder.close());
sessionFinder.addEventListener('close',()=>sessionFinderReturnFocus?.focus({preventScroll:true}));
