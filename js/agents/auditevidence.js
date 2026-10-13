import { fingerprint36 } from '../engine/fingerprint.js';
import { quotedSource, literalSpan } from '../engine/evidence.js';

// Source receipts normalize whitespace. Recover the literal original span so
// a valid multiline quote still gets a durable pointer rather than vanishing.
function originalSpan(text,quote) {
  if (!quotedSource(text,quote)) return null;
  const escaped=quote.trim().split(/\s+/).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+');
  const match=new RegExp(escaped).exec(text);
  if (match) return {start:match.index,text:match[0]};
  // M752 (followup 4): the same words echoed with other marks point at the original's own span
  const span=literalSpan(text,quote);
  return span?{start:span.start,text:text.slice(span.start,span.end)}:null;
}

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
    if (!d || !p.evidenceId || !p.text) return;
    const span=originalSpan(d.text,p.text);
    if (!span) return;
    let start=span.start;
    let literal=span.text;
    // A current registered source supersedes an old pointer only if the
    // reference names that exact source span, or an explicit inventory atom.
    if (p.evidenceId.startsWith('source:')) {
      while (start>=0 && p.evidenceId!=='source:'+fingerprint36(d.id+':'+start+':'+p.text)) start=d.text.indexOf(p.text,start+1);
      if (start<0) return;
      literal=p.text;
    }
    entries[p.evidenceId]={source:d.id,mark:d.mark,start,length:literal.length};
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
