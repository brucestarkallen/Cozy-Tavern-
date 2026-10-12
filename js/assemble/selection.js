/* Request planning only. Source objects are selected before rendering; no store writes. */
import { shownText, shownIndex } from '../engine/pagepatch.js';
import { fingerprint36 } from '../engine/fingerprint.js';
const messagePrints = new Map();
export function messageVersion(m) {
  const text = String(m.typed || '') + '\n' + shownText(m) + ':' + shownIndex(m);
  if (messagePrints.has(text)) return messagePrints.get(text);
  const print = fingerprint36(text);
  if (messagePrints.size > 4000) messagePrints.clear();
  messagePrints.set(text,print); return print;
}
export function sourceBindings(pages) { return pages.map(m => ({ id:m.id, version:messageVersion(m) })); }
export function boundRecord(n, visible) {
  if (!Array.isArray(n.sourcePages)) return true; // Legacy spans remain conservative, never paid recertification.
  const pages = visible.slice(Math.max(0,n.span[0]),n.span[1]+1);
  return pages.length === n.sourcePages.length && pages.every((m,i) => m.id === n.sourcePages[i].id && messageVersion(m) === n.sourcePages[i].version);
}
export const recordId = n => String(n.id || 'legacy:' + fingerprint36(JSON.stringify([n.span, n.text, n.detail || '', n.at || 0])));
export const recordPrint = n => fingerprint36(JSON.stringify([n.span, n.text, n.detail || '', n.correction === true, n.sourcePages || n.source || n.sources || null]));
export function uniqueRecords(nodes) {
  const seen = new Set();
  return (nodes || []).filter(n => {
    if (!n || n.empty || !n.text?.trim() || !Array.isArray(n.span)) return false;
    const id = recordId(n); if (seen.has(id)) return false; seen.add(id); return true;
  });
}
export function selectWhole(nodes, cap, render, { newest = false } = {}) {
  const list = uniqueRecords(nodes).sort((a,b) => a.span[0] - b.span[0]);
  const selected = []; const omitted = []; let chars = 0;
  for (const n of newest ? list.slice().reverse() : list) {
    const cost = render(n).length + (selected.length ? 1 : 0);
    if (chars + cost > cap) { omitted.push({ id: recordId(n), span: n.span, reason: cost > cap ? 'whole entry exceeds allocation' : 'allocation used', chars: cost }); continue; }
    selected.push(n); chars += cost;
  }
  selected.sort((a,b) => a.span[0] - b.span[0]);
  return { nodes: selected, text: selected.map(render).join('\n'), chars, omitted, rested: omitted.length };
}
export function requestSelection({ story, history, pages, nodes, selected, essentials, plans = [], characters = [], excerpts = [] }) {
  const originals = (history || []).filter(m => m && !m.hidden);
  const sent = new Set(pages.map(m => m.id));
  const byId = new Map(pages.map(m => [m.id,m]));
  const held = new Set(selected.map(recordId));
  const represented = n => held.has(recordId(n));
  const summarized = n => Boolean(essentials && (essentials.sources ? essentials.sources.some(x => x.id === n.id && x.span?.[0] === n.span[0] && x.span?.[1] === n.span[1]) : n.span[1] <= essentials.upTo));
  const messages = (history || []).filter(Boolean).map(m => ({ id: m.id, version: messageVersion(m), selected: sent.has(m.id), transformed:byId.get(m.id)?.transformed === true, reason: sent.has(m.id) ? 'original page window' : m.hidden ? 'hidden nudge, handled separately' : 'outside final original window' }));
  const coverage = [];
  const foldedDelta = new Map(); const briefDelta = new Map();
  const addSpan = (map,n) => { const a=Math.max(0,n.span[0]), b=Math.min(originals.length,n.span[1]+1); if(b<=a)return; map.set(a,(map.get(a)||0)+1);map.set(b,(map.get(b)||0)-1); };
  for(const n of nodes) if(!n.correction) { if(represented(n)) addSpan(foldedDelta,n); if(summarized(n)) addSpan(briefDelta,n); }
  let folded=0, brief=0;
  originals.forEach((m,i) => {
    folded += foldedDelta.get(i) || 0; brief += briefDelta.get(i) || 0;
    const excerpt = excerpts.some(e => e.sourceId === m.id);
    const kind = sent.has(m.id) ? 'original' : folded ? 'folded' : brief ? 'essentials' : excerpt ? 'excerpt only' : 'unrepresented';
    const prev = coverage.at(-1);
    if (prev && prev.kind === kind && prev.to + 1 === i) { prev.to = i; prev.lastId = m.id; }
    else coverage.push({ from: i, to: i, firstId: m.id, lastId: m.id, kind });
  });
  return { v: 1, storyId: story?.id || '', revision: fingerprint36(JSON.stringify(messages.map(m => [m.id,m.version]))), messages,
    records: nodes.map(n => ({ id: recordId(n), print: recordPrint(n), span: n.span, sourceBinding: n.sourcePages ? 'identity and visible version' : 'legacy span', detail: Boolean(n.detail?.trim()), selected: held.has(recordId(n)), reason: held.has(recordId(n)) ? n.correction ? 'writer correction' : 'bridge or scene relevance' : summarized(n) ? 'compressed source representation, details not certified' : 'outside allocation, source pending', chars: n.text.length + (n.detail?.length || 0) })),
    essentials: essentials ? { print: essentials.print, sourcePrint: essentials.sourcePrint || '', complete: essentials.complete === true ? 'structurally complete' : 'legacy range checked, semantic retention unverified', upTo: essentials.upTo } : null,
    plans, characters, excerpts, coverage, gaps: coverage.filter(c => c.kind === 'unrepresented') };
}

/* A bounded local path through the already loaded, visible source pages. */
export function historicalPassages({ history = [], nodes = [], pages = [], move = '', cap = 6000 }) {
  const words = s => new Set(String(s || '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []);
  const wanted = words(move);
  const visible = history.filter(m => m && !m.hidden);
  const wireById = new Map(pages.map(p => [p.id,p]));
  const candidates = [];
  const seen = new Set();
  for (const n of nodes) {
    if (n.correction) continue;
    const cues = new Set([...wanted,...words(n.detail || '')]);
    for (let i = Math.max(0,n.span[0]); i <= Math.min(n.span[1],visible.length - 1); i++) {
      const source = visible[i]; const page = wireById.get(source.id);
      if (!page || typeof page.content !== 'string') continue;
      const paras = page.content.split(/\n\s*\n/);
      paras.forEach((p,k) => {
        const score = [...words(p)].filter(w => cues.has(w)).length;
        if (score < 2 || p.length > Math.min(2800,cap) || seen.has(source.id + ':' + k)) return;
        seen.add(source.id + ':' + k);
        const neighbour = paras[k+1];
        const text = neighbour && p.length + neighbour.length + 2 <= 2800 ? p + '\n\n' + neighbour : p;
        candidates.push({sourceId:source.id, ordinal:i, paragraph:k, text, score, role:page.role, transformed:page.transformed === true});
      });
    }
  }
  candidates.sort((a,b) => b.score - a.score || b.ordinal - a.ordinal);
  const chosen = []; let used = 0;
  for (const c of candidates) {
    if (chosen.length >= 2 || chosen.some(p => p.sourceId === c.sourceId) || used + c.text.length + 180 > cap) continue;
    chosen.push(c); used += c.text.length + 180;
  }
  return chosen.sort((a,b) => a.ordinal - b.ordinal);
}
