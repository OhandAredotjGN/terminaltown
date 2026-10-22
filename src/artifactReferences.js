/* Shared by the terminal renderer and the server. No filesystem access here. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TerminalTownArtifactReferences = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function parseReference(raw, basePath = '', options = {}) {
    let value = String(raw || '').trim().replace(/^<|>$/g, '').replace(/[ \t]*\r?\n\s+/g, '');
    if (!value || /[\x00-\x1f\x7f\\]/.test(value)) return null;
    if (/^file:\/\//i.test(value)) {
      try { const url = new URL(value); if (url.hostname && url.hostname !== 'localhost') return null; value = url.pathname + url.hash; } catch { return null; }
    } else if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) return null;
    let fragment = '', line = 0, endLine = 0;
    const hash = options.literalPath ? -1 : value.indexOf('#');
    if (hash >= 0) { fragment = value.slice(hash + 1); value = value.slice(0, hash); }
    if (options.decode !== false) { try { value = decodeURIComponent(value); fragment = decodeURIComponent(fragment); } catch { return null; } }
    const suffix = value.match(/:(\d+)(?::\d+)?$/);
    if (suffix) { line = Number(suffix[1]); endLine = line; value = value.slice(0, suffix.index); fragment = 'L' + line; }
    const location = fragment.match(/^L(\d+)(?:-L?(\d+))?$/);
    if (location) { line = Number(location[1]); endLine = Number(location[2] || line); }
    if (line > 1000000 || endLine > 1000000 || (line && endLine < line)) return null;
    const relative = !value.startsWith('/') && !value.startsWith('~/');
    if (value.startsWith('~/')) {
      const home = options.home || (typeof process === 'object' && process.platform && typeof require === 'function'
        ? require('node:os').homedir() : '');
      if (!home) return null;
      value = home + value.slice(1);
    }
    else if (!value.startsWith('/')) {
      if (!basePath.startsWith('/') || !value) return null;
      value = basePath.replace(/\/+$/, '') + '/' + value;
    }
    // Refuse traversal rather than silently normalizing it into a different file.
    if (/[\x00-\x1f\x7f\\]/.test(value) || (!relative && value.split('/').includes('..'))) return null;
    const parts=[];
    for(const part of value.split('/')) {
      if(!part || part==='.')continue;
      if(part==='..') {if(!parts.length)return null;parts.pop();} else parts.push(part);
    }
    value = '/' + parts.join('/');
    return {path:value, fragment, line, endLine};
  }
  function hrefFor(reference) {
    const query = new URLSearchParams({path:reference.path});
    if (reference.line) { query.set('line', reference.line); if (reference.endLine > reference.line) query.set('endLine', reference.endLine); }
    if (['raw','download','source'].includes(reference.mode)) query.set(reference.mode,'1');
    const fragment = reference.line ? 'L' + reference.line : reference.fragment;
    return '/api/terminal-file?' + query.toString() + (fragment ? '#' + encodeURIComponent(fragment) : '');
  }
  function referenceFromFileUrl(raw) {
    try {
      const url = new URL(raw);
      if (!['http:','https:'].includes(url.protocol) || url.pathname !== '/api/terminal-file') return null;
      const ref = parseReference(url.searchParams.get('path'),'',{decode:false,literalPath:true});
      if (!ref) return null;
      ref.fragment = decodeURIComponent(url.hash.slice(1)) || ref.fragment;
      const range = ref.fragment.match(/^L(\d+)(?:-L?(\d+))?$/);
      ref.line = Number(url.searchParams.get('line') || (range && range[1]) || ref.line);
      ref.endLine = Number(url.searchParams.get('endLine') || (range && range[2]) || ref.line);
      for (const mode of ['download','raw','source']) if (url.searchParams.get(mode) === '1') {ref.mode=mode;break;}
      return ref;
    } catch {return null;}
  }
  function findReferences(value, basePath = '') {
    const found = [];
    function add(raw, index) { const reference = parseReference(raw, basePath); if (reference) found.push({raw,index,end:index+raw.length,reference,href:hrefFor(reference),kind:'file'}); }
    // Explicit Markdown destinations, including spaces inside angle brackets.
    const destinations = /\]\(\s*(<[^>\n]+>|(?:\\.|[^\s()])+(?:\([^()]*\)[^\s()]*)*)\s*(?:"[^"\n]*")?\)/g;
    let m;
    while ((m = destinations.exec(value))) { const raw=m[1]; const offset=m[0].indexOf(raw); add(raw,m.index+offset); }
    const quoted = /[`"']((?:\/(?:Users|Volumes|private|tmp)\/|~\/|(?:docs|assets|src|scripts|data)\/)[^`"'\n]+\.[\w]+(?::\d+(?::\d+)?)?(?:#[^\s`"']+)?)/g;
    while ((m=quoted.exec(value))) add(m[1],m.index+1);
    const bare = /(^|[\s([{"'`•])((?:file:\/\/\/|\/(?:Users|Volumes|private|tmp)\/|~\/|(?:docs|assets|src|scripts|data)\/)[\w.%~\/+@-]+(?:[ \t]*\r?\n\s{2,}[\w.%~\/+@-]+)*\.[A-Za-z0-9]{1,16}(?::\d+(?::\d+)?)?(?:#[\w.-]+)?)(?=[\s),.;:!?\]}`"']|$)/gm;
    while ((m = bare.exec(value))) add(m[2],m.index+m[1].length);
    found.sort((a,b)=>a.index-b.index || b.end-a.end);
    let end=-1;return found.filter(r=>{if(r.index<end)return false;end=r.end;return true;});
  }
  return {parseReference,hrefFor,findReferences,referenceFromFileUrl};
});
