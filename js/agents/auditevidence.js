import { fingerprint36 } from '../engine/fingerprint.js';

// References are durable pointers into originals, not another story judgment.
// Keep exact spans so a later reading can reuse a reference it saw earlier.
export function auditEvidenceBook(documents,passages,previous={},journal=[]) {
  const originals=new Map(documents.map(d=>[d.id,d]));
  const entries={};
  for (const [id,p] of Object.entries(previous?.entries || {})) {
    const d=originals.get(p.source);
    if (d && d.mark===p.mark && Number.isInteger(p.start) && p.start>=0 && p.length>0 && p.start+p.length<=d.text.length)
      entries[id]=p;
  }
  const add=p=>{
    const d=originals.get(p.source);
    let start=d?.text.indexOf(p.text);
    if (!p.evidenceId || !p.text || start<0 || start===undefined) return;
    // A current registered source supersedes an old pointer only if the
    // reference names that exact source span, or an explicit inventory atom.
    if (p.evidenceId.startsWith('source:')) {
      while (start>=0 && p.evidenceId!=='source:'+fingerprint36(d.id+':'+start+':'+p.text)) start=d.text.indexOf(p.text,start+1);
      if (start<0) return;
    }
    entries[p.evidenceId]={source:d.id,mark:d.mark,start,length:p.text.length};
  };
  // Upgrade pre-book references only from actual saved literal evidence and
  // the exact original hash. An old opaque id alone proves nothing.
  for (const j of journal || []) {
    const m=j.m || {},text=m.shown || m.evidence;
    if (!m.evidenceId?.startsWith('source:') || !text || entries[m.evidenceId]) continue;
    for (const d of documents) if (d.text.includes(text)) add({evidenceId:m.evidenceId,source:d.id,text});
  }
  for (const p of passages) add(p);
  return {version:1,entries};
}

export function auditEvidencePassages(documents,book) {
  const originals=new Map(documents.map(d=>[d.id,d]));
  return Object.entries(book?.entries || {}).flatMap(([evidenceId,p])=>{
    const d=originals.get(p.source);
    return d?.mark===p.mark?[{evidenceId,source:d.id,label:d.label,text:d.text.slice(p.start,p.start+p.length)}]:[];
  });
}
