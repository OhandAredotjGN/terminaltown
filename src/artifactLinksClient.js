// Shared desktop/mobile/meta renderer gate. Availability never grants publication.
const terminalArtifactLinks = (() => {
  const pending = new Map();
  let scheduled = false;
  function bind(element, reference) {
    if (!element.hasAttribute('href')) element.dataset.artifactState = 'checking';
    element.setAttribute('aria-busy','true');
    element.classList.add('terminal-file');
    if (!element.hasAttribute('href')) element.title = 'Checking browser access';
    element._artifactReference = reference;
    const key = JSON.stringify(reference);
    const item = pending.get(key) || {reference,elements:[]};
    item.elements.push(element);pending.set(key,item);
    if (!scheduled) {scheduled=true;queueMicrotask(flush);}
  }
  async function flush() {
    scheduled=false;
    const batch=[...pending.values()];pending.clear();
    for(let start=0;start<batch.length;start+=64) {
      const items=batch.slice(start,start+64);
      let files=[];
      try {
        const response=await fetch('/api/terminal-files/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({references:items.map(i=>i.reference)}),signal:AbortSignal.timeout(8000)});
        if(response.ok)files=(await response.json()).files||[];
      } catch {}
      items.forEach((item,index)=>item.elements.forEach(element=>{
        if(!element.isConnected)return;
        const file=files[index];element.removeAttribute('aria-busy');
        if(file?.available && /^[a-f0-9]{64}$/.test(file.sha256) && file.href?.startsWith('/api/terminal-file?')) {
          const link=element.tagName==='A'?element:document.createElement('a');link.href=file.href;link.textContent=element.textContent;
          link.removeAttribute('aria-label');link.removeAttribute('tabindex');
          link.className='terminal-file';link.dataset.artifactState='available';link.dataset.artifactSha256=file.sha256;
          link._artifactReference=item.reference;link.target='_blank';link.rel='noopener noreferrer';
          link.title='Open '+file.name+(file.publishedAt?' · published snapshot':'');if(link!==element)element.replaceWith(link);
        } else {
          element.removeAttribute('href');element.dataset.artifactState='unavailable';
          element.title=file?.reason || 'Unavailable: browser access could not be checked';
          element.setAttribute('aria-label',element.textContent+' — '+element.title);
        }
      }));
    }
  }
  // Recheck visible references, including previously missing reports published later.
  // The GET also resolves afresh, so removing a file can never serve stale cached bytes.
  setInterval(()=>{
    if(document.hidden)return;
    document.querySelectorAll('.terminal-file').forEach(element=>{
      if(!element._artifactReference)return;
      const rect=element.getBoundingClientRect();if(rect.bottom<0||rect.top>innerHeight)return;
      bind(element,element._artifactReference);
    });
  },30000);
  return {bind};
})();
