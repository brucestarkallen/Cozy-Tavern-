/* Cozy Tavern — agents/essentials.js (M510-15)
 * THE STORY ESSENTIALS — his design: "the AI sees the Summaryception and creates a more streamlined version that's
 * coherent; the small model always sees it; if something is mentioned it uses the more detailed Summaryception".
 *
 * The keeper's record (Summaryception, M34) is the accurate memory: dense lines, only what is new, layered as it grows —
 * and it grows (eleven thousand tokens and more on a long tale). A small model cannot carry all of it, and carrying its
 * newest part hid the story's beginning. So a reader turns the WHOLE record into the story's essentials: who these people
 * are to each other, what happened in order, and what still stands — promises, debts, secrets, wounds, who knows what —
 * leaving out what no later page depends on. It is rebuilt from the record itself whenever the record changes (never
 * from its own last version, so it cannot drift from the record), and a small model reads it on every page; the record's
 * own lines come back word for word when a move names them (anchor.js recall).
 *
 * Only for a tale whose storyteller is a small model. A complete compact record can serve directly. Larger records
 * use bounded revision; progress and failures are persisted here so the queue does not repeat entire failed jobs. */
import { fingerprint36 } from '../engine/fingerprint.js'; /* M575 */
import { db } from '../store.js';
import { callWorker, workerConnection } from './call.js';
import { measureTransport } from '../providers/measure.js';
import { inputRoom } from '../assemble/budget.js';
import { contextOf } from '../providers/room.js'; /* M565: the record told in parts that fit its model */
import { mcName } from '../engine/duels.js';
import { brokenOff } from '../engine/world.js';
import { writerText, BRIEF_ROOM } from '../engine/whole.js'; /* M566 */
import { boundRecord, messageVersion, sourceBindingIssues } from '../assemble/selection.js';
import { rebindCopiedRecord } from './memory.js';

export const ESSENTIALS_KEY = (storyId) => 'essentials:' + storyId;
export const PENDING_KEY = storyId => 'essentialsPending:' + storyId;
/* M510-16: the same room the record's newest lines had (M510-14, about 4,000 tokens) — now spent on the whole story */
export const ESSENTIALS_TARGET_CHARS = 16000;
export const ESSENTIALS_MAX_CHARS = 17000; /* M747: owner-approved 1000 character completion tolerance. */
export const ESSENTIALS_MAX_TOKENS = 5000;
export const ESSENTIALS_TRIES = 3; /* M666: his — "it automatically tries again, same as all other workers": three asks, as the keeper's lines have */
const ESSENTIALS_REPAIR_POLICY = 8; /* M748: streaming progress, precise coverage and compatible plan recovery. */
const REPAIR_DRAFT_MAX_CHARS = 128000;
const RUN_CALL_LIMIT = 12;
const PART_MIN_CHARS = 800;
const CONTINUE_DELAY = 1500;
const MAX_FAILED_ROUNDS = 4;
const answerOptions = share => ({maxTokens:ESSENTIALS_MAX_TOKENS,maxTokensLimit:Math.min(ESSENTIALS_MAX_TOKENS,Math.max(256,Math.ceil(share/3)))});

const fp = (t) => fingerprint36(t);

/* M741: unfinished sources are durable work, not a permanent failed-input lock.
 * Short recovery first, then a patient ceiling while the story stays open. */
export const essentialsRetryDelay = attempts => [60000, 300000, 900000, 1800000][Math.min(3, Math.max(0, attempts - 1))];
function helperPrintOf(connection, brief, mc) {
  const helper = workerConnection(connection, answerOptions(ESSENTIALS_MAX_CHARS));
  const shell = essentialsAsk({brief,mc});
  const accounting = measureTransport(helper,{system:shell.system,messages:[{role:'user',content:shell.user}]});
  return {helper,accounting,print:fp(JSON.stringify([helper.id,helper.type,helper.model,helper.baseUrl,contextOf(helper),accounting.answerTokens,helper.reasoning,helper.temperature,helper.topP,helper.prefill]))};
}
export function essentialsRecoveryState({kept,pending,nodes,pages,story,state,brief='',mc='',connection,now=Date.now()}={}) {
  const rec=recordOf(nodes),inputPrint=sourcePrint(nodes),setupPrint=fp(brief+'\n'+mc);
  if (!rec.lines.length) return {needed:false,why:'no record yet'};
  const setupOwner=story && state ? setupOwnerOf(story,state) : null;
  const requested=pending?.required && pending.sourcePrint===inputPrint && pending.setupPrint===setupPrint
    && pending.acceptedPrint===fp(JSON.stringify(kept)) && pending.generationId!==kept?.generationId;
  if (essentialsMatch(kept,nodes,Infinity,pages) && kept.upTo===rec.upTo && (!kept.setupPrint || kept.setupPrint===setupPrint)
    && (!setupOwner || !kept.setupOwner || kept.setupOwner===setupOwner) && !requested) return {needed:false,why:'unchanged'};
  if (!connection) return {needed:true,why:'Plot essentials needs a connection.',retryAt:now+60000};
  const {print:helperPrint}=helperPrintOf(connection,brief,mc);
  const same=pending?.sourcePrint===inputPrint && pending.setupPrint===setupPrint && pending.helperPrint===helperPrint
    && (!setupOwner || !pending.setupOwner || pending.setupOwner===setupOwner)
    && (!pending.acceptedPrint || pending.acceptedPrint===fp(JSON.stringify(kept)))
    && (!pending.pagesPrint || !Array.isArray(pages) || pending.pagesPrint===originalPrint(pages,rec.upTo));
  const modern=same && pending.repairPolicy===ESSENTIALS_REPAIR_POLICY;
  const legacyTransport=same && !/bounded recovery round|request limit/i.test(pending.why || pending.diagnostic?.why || '')
    && /unavailable|provider could not|could not be reached|429|outwaited/i.test(pending.why || '');
  return {needed:true,same,inputPrint,setupPrint,helperPrint,blocked:modern && pending.outcome==='blocked',retryAt:modern || legacyTransport ? Number(pending.nextAt)||0 : 0,
    why:same ? pending.why || 'The previous essentials answer was incomplete.' : 'Plot essentials has not finished reading the current record.'};
}

export function essentialsRunNote(out) {
  if (out.wrote || out.why==='unchanged') return {detail:out.wrote ? out.usedRecord ? 'saved the complete compact record as the story’s essentials' : 'streamlined the whole record into the story’s essentials' : 'the saved essentials match the current record'};
  if (!out.pending) return {silent:true};
  const previous=out.previousAvailable ? ' Previous accepted essentials remain available.' : ' No previous accepted essentials are saved yet.';
  const progress=out.progress?.done ? ' Saved '+out.progress.done+(out.progress.total?' of '+out.progress.total:' completed')+' source sections.' : '';
  if (out.outcome==='yielded') return {unfinished:true,detail:'Plot essentials replacement is continuing.'+progress+previous+' It resumes automatically when the workers are idle.'};
  if (out.outcome==='blocked') return {unfinished:true,detail:'Plot essentials replacement needs attention: '+out.why+'.'+progress+previous};
  const wait=Math.max(1,Math.ceil(((out.retryAt || Date.now()+60000)-Date.now())/60000));
  return {unfinished:true,detail:'Plot essentials update pending: '+out.why+'.'+progress+previous+' Automatic recovery will check again in about '+wait+(wait===1?' minute':' minutes')};
}

/* the record's lines in its own order (a correction reads last), and a fingerprint of all of them */
/* one record line as the keeper reads it (M565: shared with the parts) */
export function recordLine(n) {
  return '- ' + (n.correction ? '' : '(pages ' + (n.span[0] + 1) + (n.span[1] !== n.span[0] ? '–' + (n.span[1] + 1) : '') + ') ') + n.text.trim() + (typeof n.detail === 'string' && n.detail.trim() ? ' — ' + n.detail.trim() : '');
}
export function recordOf(nodes) {
  const lines = (Array.isArray(nodes) ? nodes : [])
    .filter((n) => n && !n.empty && typeof n.text === 'string' && n.text.trim() && Array.isArray(n.span))
    .sort((a, b) => {
      if (Boolean(a.correction) !== Boolean(b.correction)) return a.correction ? 1 : -1;
      if (a.correction && b.correction) return (a.at || 0) - (b.at || 0);
      return (a.span[0] - b.span[0]) || ((b.level || 1) - (a.level || 1)) || ((a.at || 0) - (b.at || 0));
    });
  const upTo = lines.reduce((m, n) => (!n.correction && Number.isFinite(n.span[1]) ? Math.max(m, n.span[1]) : m), -1);
  const text = lines.map(recordLine).join('\n');
  return { lines, text, upTo, print: fp(text) };
}

/* M510-21: HIS FORMAT — THE RECORD'S OWN, TOLD SHORTER. He: "make the essentials literally the same format as the original
 * fold, but much more concise — cut what is unimportant (talking to the postman, a crowd saying something), keep the time
 * and the place, because time and place make a story coherent; like human memory: everything still there, much more
 * coherent and efficient; and when something is mentioned, the detailed line comes back." So the essentials are record
 * lines — "[Sept 1, 08:24 · the Wells kitchen] (pages 3–9) Orrin Vale did X → Tamsin Hale did Y; …" — one line standing for a
 * stretch that belongs together, oldest first. (M510-15 wrote four headed sections instead.) */
export function essentialsAsk({ record = '', brief = '', mc = '' } = {}) {
  const system = [
    'You condense the record of a long collaborative story into its essentials: the same record, told again shorter — the way a person remembers a story, with everything that matters still there.',
    'You are given the whole record, oldest first. Each line stands for a stretch of pages: a prefix with its time and place, like "[Sept 1, 08:24 · the Wells kitchen]", then short phrases separated by semicolons.',
    'Write the essentials in THE SAME FORMAT: lines, oldest first, one per line, each opening with its time-and-place prefix and the pages it stands for, then short phrases separated by semicolons — "[Sept 1, 08:24 · the Wells kitchen] (pages 3–9) Orrin Vale did X → Tamsin Hale did Y; …".',
    'One essentials line may stand for several record lines that belong together — one scene, one stretch of days; its prefix is where and when that stretch began, and its pages run from the first to the last.',
    'Cut what nothing later depends on: small talk, errands, passers-by and crowds, weather and atmosphere, repeated reactions.',
    'Keep, always: decisions and what caused them (→), who did what to whom, promises, oaths and threats (their necessary exact words in "double quotes"), debts, secrets and who knows them, wounds, bonds and grudges, first meetings and first times, and every correction — written as the fact now stands.',
    'Keep meaningful rituals, private jokes, telling gestures, identity defining habits and relationship turning points with their reasons. Keep only atmosphere that carries lasting meaning.',
    'Names, never pronouns, spelled as the record spells them. Invent nothing the record does not say.',
    'At most 2,000 words — far fewer while the story is young. Answer with the lines only.',
  ].join('\n');
  const user = [
    mc ? 'The main character (the writer plays him): ' + mc : '',
    brief ? 'What this story is about, in the writer\'s words:\n' + writerText(brief, BRIEF_ROOM, 'brief') : '',
    'The record, oldest first:\n' + record,
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

/* the answer, read as lines: no fences, no preface before the first line, clipped at a line's end; too little to be the
 * essentials — or no line at all — is refused */
export function inspectEssentials(raw, cap = ESSENTIALS_MAX_CHARS, finishReason = '') {
  /* M608: its thinking is not its answer — a thought with a line opening "[" became the first line of the essentials */
  const t = String(raw == null ? '' : raw).replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  if (/^[[{]\s*["{\]]/.test(t)) return { text: '', complete: false, why: 'no usable record lines' };
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines.findIndex((l) => /^(?:[-*•]\s*)?\[/.test(l) || /^(?:[-*•]\s*)?\(pages?\s/i.test(l));
  if (first === -1) return { text: '', complete: false, why: 'no usable record lines' };
  /* M649 (the ledger audit, part six): what follows the list is not part of it — "Let me know if you'd like more detail." was
   * kept as one more line of the essentials and read to the small storyteller as story */
  const chatter = /^(?:[-*•]\s*)?(?:let me know|would you like|i hope (?:this|that)|feel free|if you(?:['’]d| would) like|is there anything|do you want me|that(?:['’]s| is) (?:the|all)|here (?:is|are) the|note:|end of (?:list|summary))\b/i;
  const body = lines.slice(first);
  while (body.length && chatter.test(body[body.length - 1])) body.pop();
  const kept = body.map((l) => (/^[-*•]\s*/.test(l) ? '- ' + l.replace(/^[-*•]\s*/, '') : '- ' + l));
  let text = kept.join('\n');
  if (text.length < 80) return { text: '', complete: false, why: 'no usable record lines' };
  const clipped = text.length > cap;
  const providerTruncated = /length|max_tokens|model_context_window_exceeded/i.test(finishReason);
  const incomplete = body.some(l => !/^(?:[-*•]\s*)?(?:\[[^\]\n]+\]|\(pages?\s[^)]+\))/i.test(l)) || brokenOff(body.at(-1));
  return { text, clipped, providerTruncated, incomplete, complete: !clipped && !providerTruncated && !incomplete, why: clipped ? 'over its allocated room' : providerTruncated ? 'provider truncated' : incomplete ? 'structurally incomplete' : '' };

}

/* Public parser remains a text parser; incomplete candidates never become saved essentials. */
export function readEssentials(raw, cap = ESSENTIALS_MAX_CHARS) {
  const result = inspectEssentials(raw, cap);
  return result.complete ? result.text : '';
}

export function sourcePrint(nodes) {
  return fp(JSON.stringify(recordOf(nodes).lines.map(n => [n.id, n.span, n.text, n.detail || '', n.correction === true, n.sourcePages || n.source || n.sources || null,...(n.sourceSegment?[n.sourceSegment]:[])])));
}
export function essentialsMatch(kept, nodes, through = Infinity, pages) {
  if (!kept?.text || kept.complete === false || !Number.isFinite(kept.upTo) || kept.upTo >= through) return false;
  const all = recordOf(nodes).lines;
  const prefix = all.filter(n => n.correction || n.span[1] <= kept.upTo);
  if (Array.isArray(pages) && (kept.upTo>=pages.length || prefix.some(n=>!n.correction && !boundRecord(n,pages)))) return false;
  if (Array.isArray(pages)) {
    if (kept.sourcePages) {
      if (kept.sourcePages.length!==kept.upTo+1 || !kept.sourcePages.every((p,i)=>p.ordinal===i && pages[i]?.id===p.id && messageVersion(pages[i])===p.version)) return false;
    } else if (prefix.some(n=>!n.correction && !Array.isArray(n.sourcePages))) return false;
  }
  const straddles=all.some(n => !n.correction && n.span[0] <= kept.upTo && n.span[1] > kept.upTo);
  if (!straddles && (kept.sourcePrint ? sourcePrint(prefix) === kept.sourcePrint : recordOf(prefix).print === kept.print)) return true;
  // Repacking unchanged originals is different from correcting a record. Only
  // proven page versions and a real folded layout can reuse the earlier view.
  if (!Array.isArray(pages) || kept.sourcePages?.length!==kept.upTo+1 || kept.correctionsPrint!==sourcePrint(all.filter(n=>n.correction))) return false;
  if (!kept.sourcePages.every((p,i)=>p.ordinal===i && pages[i]?.id===p.id && messageVersion(pages[i])===p.version)) return false;
  const held=new Map((kept.sources || []).map(n=>[n.id,n]));
  return all.filter(n=>!n.correction && n.span[0]<=kept.upTo).every(n=>boundRecord(n,pages) && n.sourcePages?.length
    && (held.has(n.id) ? held.get(n.id).print===sourcePrint([n]) : n.level>1));
}

export async function loadEssentialsView(storyId) {
  const kept = await db.settings.get(ESSENTIALS_KEY(storyId));
  const memory = await db.settings.get('memory:' + storyId);
  const story = await db.stories.get(storyId);
  const state = await db.settings.get('state:' + storyId);
  const pages=(await db.messages.list(storyId)).filter(m=>!m.hidden);
  const snapshot=typeof kept?.text==='string' && kept.text.trim() && kept.complete!==false ? kept : null;
  const setupMatches=(!kept?.setupPrint || !story || !state || kept.setupPrint===fp((story.brief || '')+'\n'+mcName(state)))
    && (!kept?.setupOwner || kept.setupOwner===setupOwnerOf(story,state));
  const eligible=Boolean(snapshot && setupMatches && memory && essentialsMatch(kept,memory.nodes,Infinity,pages));
  const current=eligible && (!memory || kept.upTo===recordOf(memory.nodes).upTo);
  return {snapshot,eligible,current,pending:await db.settings.get(PENDING_KEY(storyId))};
}
export async function loadEssentials(storyId) {
  const view=await loadEssentialsView(storyId);
  return view.eligible ? view.snapshot : null;
}

/* one reading: when the record has changed since the essentials were made, make them again from the whole record */
/* M565 (the audit): THE ESSENTIALS OF A LONG TALE. The keeper was handed the WHOLE record in one request, however long, and
 * its answer was cut at 16,000 characters keeping the OLDEST lines: a record past its model's room was refused every time
 * (the essentials never made again — the story in brief standing still while the tale went on), and a telling past the
 * cap lost its NEWEST stretch, where the story stands now. Now a record past its model's room is told in parts, oldest
 * first, each part given its share of the 16,000 by its size; a telling that runs over its share, or is cut off by the
 * answer's room, is asked again tighter — the oldest stretches shorter, every stretch still there. A record that fits is
 * told in one request, as before. */
export function recordParts(lines, room) {
  const parts = [];
  let cur = []; let size = 0;
  for (const n of lines) {
    const t = recordLine(n);
    if (cur.length && size + t.length + 1 > room) { parts.push(cur); cur = []; size = 0; }
    cur.push(n); size += t.length + 1;
  }
  if (cur.length) parts.push(cur);
  return parts;
}
/* A rejected draft is editing material only. Original sources stay authoritative
 * in every repair request, and the full serialized conversation must fit. */
export function essentialsRepairMessages({connection,system,user,draft,share,attempt=1,target:sectionTarget=share,why=''}) {
  if (!draft) return null;
  const target=Math.floor(Math.min(sectionTarget,share*(attempt>1 ? 0.5 : 0.65)));
  const reduction=Math.max(1,Math.ceil((1-target/draft.length)*100));
  const messages=[{role:'user',content:user},{role:'assistant',content:draft},{role:'user',content:
    'Revise the draft above; do not generate another expanded record. '+(why?'Validation rejected it because: '+why+'. ':'')+'It is '+draft.length+' characters, but this section of the saved essentials can hold at most '+share+' characters. '+
    'Rewrite the COMPLETE draft to about '+target+' characters or fewer'+(draft.length>target?', reducing its length by at least '+reduction+' percent':', correcting the reported problem')+'. '+
    'Combine related entries, remove repeated wording and incidental description, and use concise clauses. Preserve chronological coverage through the final source entry, names, causes, conditions, decisions, corrections, unresolved promises and meaningful relationship changes. '+
    'The original source entries in the first message remain authoritative. The rejected draft is not new evidence and may be cut off or incomplete. Check the originals and include their final stretch even if the draft missed it. Do not invent missing time or place. '+
    'Return only the complete replacement record lines, each beginning with its time and place and page range. Do not explain the revision or copy the old draft before it.'}];
  const helper=workerConnection(connection,answerOptions(share));
  const measured=measureTransport(helper,{system,messages});
  return measured.inputTokens<=inputRoom({budgetTokens:contextOf(helper),answerTokens:measured.answerTokens}) ? messages : null;
}

// Read page receipts only from the opening header, never from narrative text.
// Punctuation and page-label spelling do not change the source ranges they name.
function headerPageRanges(line) {
  const opening=String(line).replace(/^\s*(?:[-*•]\s*)?/, '');
  const header=opening.match(/^\[([^\]\n]+)\]\s*/);
  const after=header ? opening.slice(header[0].length) : opening;
  const parens=after.match(/^\(([^)\n]+)\)/);
  const fields=[...(header ? header[1].split(/[·|;]/) : []),...(parens ? [parens[1]] : [])];
  return fields.flatMap(field=>{
    const receipt=field.match(/(?:^|[\s,(])(?:pages?\b|pp?\.)\s*:?\s*(.+?)\s*\)?$/i);
    if (!receipt) return [];
    const ranges=receipt[1].split(/\s*(?:,|\band\b|&)\s*/i).map(range=>{
      const match=range.match(/^(\d+)(?:\s*(?:to|[-–—])\s*(\d+))?$/i);
      if (!match) return null;
      const first=Number(match[1]),last=Number(match[2] || match[1]);
      return Number.isSafeInteger(first) && Number.isSafeInteger(last) && first>0 && last>=first ? [first-1,last-1] : null;
    });
    return ranges.every(Boolean) ? ranges : [];
  });
}
function sectionCoverage(text,lines) {
  const ranges=String(text).split('\n').flatMap(headerPageRanges).sort((a,b)=>a[0]-b[0]);
  return lines.filter(n=>!n.correction).every(n=>{
    let next=n.span[0];
    for (const [start,end] of ranges) if (start<=next && end>=next) next=end+1;
    return next>n.span[1];
  });
}

async function tellPart({ connection, lines, part, parts, share, brief, mc, signal, renew, callLLM, usage, previous, requiredCoverage=false, fresh=false, target=Math.floor(share*0.65), tries=ESSENTIALS_TRIES, checkpoint=async()=>{} }) {
  const ask = essentialsAsk({ record: lines.map(recordLine).join('\n'), brief, mc });
  const partNote = '\n\nPart ' + (part + 1) + ' of ' + parts + '. Tell only these original source entries, within ' + share + ' characters.'
    + ' The global target is '+ESSENTIALS_TARGET_CHARS+' characters. Aim for '+target+' characters for this complete section, leaving room for the other sections and formatting. '+(fresh ? 'FRESH SOURCE READING. Reconstruct the coherent story memory from these authoritative source entries, combining related events and preserving their causes and consequences. ' : '')
    + (requiredCoverage ? ' This is a chronological source section. Include explicit (pages first to last) ranges covering EVERY supplied source span through the final entry, including the resulting correction facts.' : '');
  const correction = result => '\n\nThe previous candidate was ' + result.why + (result.chars ? ' ('+result.chars+' characters)' : '') + '. '+
    (result.clipped || result.providerTruncated ? 'Aim for at most '+Math.floor(share*0.7)+' characters, using fewer complete lines for related entries. ' : 'Every line must begin with [time, place] (pages first to last). No headings, commentary or separate continuation lines. ')+
    'Return complete record lines, keeping causes, consequences, corrections and necessary emotional details. Cover all supplied source entries; do not leave the newest stretch unfinished.';
  let user = ask.user + partNote + (previous ? correction(previous) : '');
  let last;
  let draft=previous?.draft || '';
  for (let attempt = 0; attempt < tries; attempt++) {
    if (signal?.aborted) throw signal.reason || new Error('reading stopped');
    if (usage.calls>=RUN_CALL_LIMIT) return {text:'',yielded:true};
    renew();
    const messages=essentialsRepairMessages({connection,system:ask.system,user:ask.user+partNote,draft,share,target,why:last?.why || previous?.why,attempt:attempt+(previous?.draft ? 2 : 0)});
    usage.calls++; usage.inputChars += ask.system.length + (messages ? messages.reduce((n,m)=>n+m.content.length,0) : user.length);
    let lastProgress=Date.now();
    const answer = await callLLM(connection, { system: ask.system, user, ...(messages ? {messages} : {}), ...answerOptions(share), signal,
      onProgress:()=>{const now=Date.now();if(now-lastProgress>=1000){lastProgress=now;renew();}} });
    const raw = typeof answer === 'string' ? answer : answer?.text || '';
    usage.outputChars += raw.length;
    const result = inspectEssentials(raw, share, answer?.finishReason || '');
    if (result.complete && requiredCoverage && !sectionCoverage(result.text,lines)) {
      result.complete=false;result.incomplete=true;result.why='chronological source ranges are incomplete';
    }
    if (result.complete) return {text:result.text};
    // Keep the entire rejected draft only as editing material, never completed
    // memory. Even a truncated draft is repaired against ALL original entries.
    const rejected=result.text || raw;
    draft=rejected.length<=REPAIR_DRAFT_MAX_CHARS ? rejected : '';
    last={why:result.why,clipped:result.clipped,providerTruncated:result.providerTruncated,chars:raw.length,finishReason:answer?.finishReason || '',part:part+1,parts,share,print:sourcePrint(lines),...(draft ? {draft} : {})};
    await checkpoint(last);
    user = ask.user + partNote + correction(last);
  }
  return {text:'',diagnostic:last};
}
// Source boundaries are chosen once for the attempt, not recursively shrunk
// together with a local character quota after every rejected response.
function divideSources(lines) {
  if (lines.length===1) {
    const node=lines[0],text=node.text;
    const boundaries=[...text.matchAll(/\n(?=\s*(?:[-*•]\s*)?\[[^\]\n]+\])|\n[ \t]*\n/g)].map(m=>m.index+m[0].length)
      .filter(at=>text.slice(0,at).trim() && text.slice(at).trim());
    if (!boundaries.length) return null;
    const at=boundaries.reduce((best,n)=>Math.abs(n-text.length/2)<Math.abs(best-text.length/2)?n:best);
    const start=node.sourceSegment?.start || 0;
    const segment=(from,to)=>({...node,text:text.slice(from,to),detail:to===text.length?node.detail:'',
      sourceSegment:{sourceId:node.id,span:node.span,start:start+from,end:start+to}});
    return [[segment(0,at)],[segment(at,text.length)]];
  }
  const sizes=lines.map(n=>recordLine(n).length+1),total=sizes.reduce((a,b)=>a+b,0);
  let size=sizes[0],at=1;
  while (at<lines.length-1 && Math.abs(size+sizes[at]-total/2)<Math.abs(size-total/2)) size+=sizes[at++];
  return [lines.slice(0,at),lines.slice(at)];
}
function inputSections(lines,room) {
  const entries=[];
  for (const original of lines) {
    const todo=[[original]];
    while (todo.length) {
      const part=todo.shift();
      if (part.map(recordLine).join('\n').length+1<=room) entries.push(...part);
      else {
        const divided=divideSources(part);
        if (!divided) return null;
        todo.unshift(...divided);
      }
    }
  }
  return recordParts(entries,room);
}
const generationId=()=>globalThis.crypto?.randomUUID?.() || 'ess-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const previousExists=kept=>typeof kept?.text==='string' && Boolean(kept.text.trim()) && kept.complete!==false;
const setupOwnerOf=(story,state)=>fp(JSON.stringify([story?.brief || '',state?.sheet?.playerName || '',state?.sheet?.playerAliases || []]));
function originalPrint(pages,upTo) {
  return fp(JSON.stringify(pages.slice(0,upTo+1).map(p=>[p.id,messageVersion(p)])));
}

// Recover M743's completed leaves locally. Its tiny unfinished quota/recursive
// plan is abandoned; adjacent unfinished originals are repacked into real input
// sections while every compatible completed leaf remains available.
function legacySections(pending,roots) {
  const total=roots.flat().reduce((sum,n)=>sum+recordLine(n).length+1,0),minimum=100;
  const spare=ESSENTIALS_TARGET_CHARS-(roots.length-1)-roots.length*minimum; // Historical M743 split receipts used 16000.
  const leaves=[];
  const walk=(lines,share,depth=0)=>{
    const print=sourcePrint(lines),kept=(pending.parts || []).find(p=>p.print===print && p.complete && inspectEssentials(p.text,ESSENTIALS_MAX_CHARS).complete);
    if (kept) {leaves.push({lines,print,text:kept.text,complete:true});return;}
    if (depth<4 && pending.splits?.some(p=>p.print===print && p.share===share)) {
      const children=divideSources(lines);
      if (children && share>=201) {
        // Match the former allocation only to identify its existing receipts.
        const left=children[0].reduce((s,n)=>s+recordLine(n).length+1,0),sum=lines.reduce((s,n)=>s+recordLine(n).length+1,0);
        const first=lines.length===1 ? 100+Math.floor((share-201)*children[0][0].text.length/lines[0].text.length) : 100+Math.floor((share-201)*left/sum);
        walk(children[0],first,depth+1);walk(children[1],share-1-first,depth+1);return;
      }
    }
    leaves.push({lines,print});
  };
  for (const lines of roots) walk(lines,minimum+Math.floor(spare*lines.reduce((s,n)=>s+recordLine(n).length+1,0)/total));
  return leaves;
}
function acceptedPageReceipts(lines,upTo,pages=[]) {
  const originals=new Map();
  for (const n of lines.filter(n=>!n.correction)) {
    if (!Array.isArray(n.sourcePages) || n.sourcePages.length!==n.span[1]-n.span[0]+1) return pages.length>upTo
      ? pages.slice(0,upTo+1).map((p,ordinal)=>({id:p.id,version:messageVersion(p),ordinal})) : undefined;
    n.sourcePages.forEach((p,i)=>originals.set(n.span[0]+i,{...p,ordinal:n.span[0]+i}));
  }
  return originals.size===upTo+1 ? [...originals.values()].sort((a,b)=>a.ordinal-b.ordinal) : undefined;
}

export async function runEssentials({ connection, storyId, nodes, brief = '', mc = '', signal, renew = () => {}, callLLM = callWorker, force = false, stale = () => false } = {}) {
  if (!connection || !storyId) return {wrote:false,why:'no connection'};
  if (stale() || signal?.aborted) {if (signal?.aborted) throw signal.reason || new Error('reading stopped');return {wrote:false,outcome:'superseded'};}
  const rebound=await rebindCopiedRecord(storyId,nodes,{signal,stale});
  if (rebound) nodes=rebound;
  const rec=recordOf(nodes);
  if (!rec.lines.length) return {wrote:false,why:'no record yet'};
  const original=await db.settings.get(ESSENTIALS_KEY(storyId));
  const ownedMemory=await db.settings.get('memory:'+storyId),ownedStory=await db.stories.get(storyId),ownedState=await db.settings.get('state:'+storyId);
  const ownedPages=(await db.messages.list(storyId)).filter(m=>!m.hidden);
  const ownedSources=ownedPages.slice(0,rec.upTo+1).map((p,ordinal)=>({id:p.id,version:messageVersion(p),ordinal}));
  const setupOwner=setupOwnerOf(ownedStory,ownedState),inputPrint=sourcePrint(nodes),setupPrint=fp(brief+'\n'+mc);
  let pending=await db.settings.get(PENDING_KEY(storyId));
  const recovery=essentialsRecoveryState({kept:original,pending,nodes,pages:ownedPages,story:ownedStory,state:ownedState,brief,mc,connection});
  if (!force && !recovery.needed) {
    if (pending) await db.editStoryAtomically(storyId,s=>{
      if (JSON.stringify(s.settings.essentials)===JSON.stringify(original) && JSON.stringify(s.settings.essentialsPending)===JSON.stringify(pending)) delete s.settings.essentialsPending;
    },{extraSettings:['essentialsPending']});
    return {wrote:false,why:'unchanged'};
  }
  const usage={calls:0,inputChars:0,outputChars:0};
  const {helper,accounting,print:helperPrint}=helperPrintOf(connection,brief,mc);
  const result=async (outcome,why='')=>({wrote:false,pending:outcome!=='superseded',outcome,why,retryAt:pending?.nextAt,
    previousAvailable:previousExists(await db.settings.get(ESSENTIALS_KEY(storyId))),progress:{done:pending?.parts?.length || 0,total:pending?.plan?.length || 0},usage});
  if (!force && recovery.blocked) return result('blocked',recovery.why);
  if (!force && recovery.same && recovery.retryAt>Date.now()) return result(pending?.outcome || 'failed',recovery.why);
  const room=Math.max(0,Math.floor((inputRoom({budgetTokens:contextOf(helper),answerTokens:accounting.answerTokens})-accounting.inputTokens)*3*0.75)-1600);
  const roots=inputSections(rec.lines,room);
  let expectedPending=pending;
  const sameAttempt=!force && recovery.same;
  const modern=sameAttempt && pending.repairPolicy>=4 && pending.repairPolicy<=ESSENTIALS_REPAIR_POLICY && pending.generationId
    && pending.plan?.length && pending.plan.every(p=>p.lines?.length && p.print===sourcePrint(p.lines));
  let candidate=modern ? structuredClone(pending) : {generationId:generationId(),sourcePrint:inputPrint,setupPrint,setupOwner,helperPrint,
    repairPolicy:ESSENTIALS_REPAIR_POLICY,required:true,explicit:force,acceptedPrint:fp(JSON.stringify(original)),pagesPrint:originalPrint(ownedPages,rec.upTo),phase:'whole',
    plan:(roots || []).map(lines=>({lines,print:sourcePrint(lines)})),parts:[],attempts:0,restarts:0};
  if (modern && candidate.repairPolicy!==ESSENTIALS_REPAIR_POLICY) {
    candidate.repairPolicy=ESSENTIALS_REPAIR_POLICY;candidate.validationRounds=0;
    // Keep the failed draft and all compatible completed sections. The new
    // procedure edits that draft immediately, rather than rereading from zero.
    if (candidate.diagnostic?.draft) candidate.phase='sections';
    const diagnostic=candidate.diagnostic,index=Number(diagnostic?.part)-1;
    if (diagnostic && !diagnostic.print && Number.isInteger(index) && index===candidate.cursor
      && diagnostic.parts===candidate.plan.length && candidate.plan[index] && !candidate.plan[index].complete) {
      diagnostic.print=candidate.plan[index].print;
    }
  }
  if (!modern && sameAttempt && roots) {
    const leaves=legacySections(pending,recordParts(rec.lines,room+1000)),done=leaves.filter(p=>p.complete);
    if (done.length) {
      const plan=[];let unfinished=[];
      const flush=()=>{for (const lines of recordParts(unfinished,room)) plan.push({lines,print:sourcePrint(lines)});unfinished=[];};
      for (const leaf of leaves) {if (leaf.complete) {flush();plan.push(leaf);} else unfinished.push(...leaf.lines);}flush();
      candidate.plan=plan;candidate.parts=done.map(p=>({print:p.print,text:p.text,complete:true}));candidate.phase='sections';
    } else if (/request limit|bounded recovery round/i.test(pending.why || pending.diagnostic?.why || '')) candidate.phase='fresh';
  }
  // Old output-driven splits can survive several policy upgrades. When no
  // section is complete and the actual full-source editing conversation fits,
  // continue that draft against all originals in one request. Retain its
  // earlier scope as provenance; it cannot be accepted locally as whole work.
  if (roots?.length===1 && candidate.plan.length>1 && !candidate.plan.some(p=>p.complete)) {
    const held=candidate.diagnostic,ask=essentialsAsk({record:rec.text,brief,mc});
    const fullUser=ask.user+'\nInclude every original source range through the final entry.'+' '.repeat(1600);
    const fits=held?.draft && essentialsRepairMessages({connection,system:ask.system,user:fullUser,draft:held.draft,share:ESSENTIALS_MAX_CHARS});
    if (fits) {
      candidate.plan=[{lines:rec.lines,print:inputPrint}];candidate.phase='whole';
      candidate.diagnostic={...held,print:inputPrint,part:1,parts:1,draftScopePrint:held.draftScopePrint || held.print,
        partialSourceDraft:true,why:(held.why || 'incomplete')+'; this partial draft must also incorporate the remaining original source entries'};
    }
  }
  for (const section of candidate.plan) if (section.complete
    && (!inspectEssentials(section.text,ESSENTIALS_MAX_CHARS).complete || !sectionCoverage(section.text,section.lines))) {
    section.complete=false;delete section.text;
  }
  const owns=(s,requireSources=true,allowTimeout=false)=>{
    const pages=s.messages.filter(m=>!m.hidden).sort((a,b)=>(a.ts || 0)-(b.ts || 0));
    return !stale() && (!signal?.aborted || allowTimeout && signal.reason?.message==='timeout') && setupOwner===setupOwnerOf(s.story,s.settings.state)
      && JSON.stringify(s.settings.essentials)===JSON.stringify(original)
      && (!ownedMemory || s.settings.memory && sourcePrint(s.settings.memory.nodes)===inputPrint)
      && ownedSources.every((p,i)=>pages[i]?.id===p.id && messageVersion(pages[i])===p.version)
      && (!requireSources || rec.lines.every(n=>n.correction || !n.sourcePages || boundRecord(n,pages)))
      && JSON.stringify(s.settings.essentialsPending)===JSON.stringify(expectedPending);
  };
  const persist=async(outcome='running',why='',diagnostic=candidate.diagnostic)=>{
    candidate={...candidate,outcome,why,diagnostic,nextAt:outcome==='yielded'?Date.now()+CONTINUE_DELAY:outcome==='failed'?candidate.nextAt:0,
      parts:candidate.plan.filter(p=>p.complete).map(p=>({print:p.print,text:p.text,complete:true})),cursor:candidate.plan.findIndex(p=>!p.complete)};
    const wrote=await db.editStoryAtomically(storyId,s=>{
      if (!owns(s,outcome!=='blocked',outcome==='failed' || outcome==='blocked')) return false;
      s.settings.essentialsPending=structuredClone(candidate);return true;
    },{extraSettings:['essentialsPending']});
    if (wrote) {pending=structuredClone(candidate);expectedPending=pending;}
    return wrote;
  };
  const fail=async(why,diagnostic,err)=>{
    let outcome;
    if (err) {
      candidate.attempts=(Number(candidate.attempts)||0)+1;
      candidate.nextAt=Date.now()+Math.max(essentialsRetryDelay(candidate.attempts),Number(err?.retryAfterMs)||0);
      outcome=candidate.attempts>=MAX_FAILED_ROUNDS?'blocked':'failed';
    } else {
      candidate.validationRounds=(Number(candidate.validationRounds)||0)+1;
      outcome=candidate.validationRounds>=MAX_FAILED_ROUNDS?'blocked':'yielded';
    }
    if (!await persist(outcome,why,diagnostic)) return result('superseded','The source or saved version changed while reading.');
    return result(outcome,why);
  };
  const compactRecord=inspectEssentials(rec.text,ESSENTIALS_MAX_CHARS);
  const usedRecord=!force && !candidate.explicit && compactRecord.complete && compactRecord.text===rec.text && sectionCoverage(compactRecord.text,rec.lines);
  const invalidSources=ownedStory && (rec.upTo>=ownedPages.length || sourceBindingIssues(rec.lines,ownedPages).length>0);
  if (invalidSources || !usedRecord && (!roots || candidate.plan.filter(p=>p.complete).reduce((n,p)=>n+p.text.length,0)
    +candidate.plan.filter(p=>!p.complete).length*80+Math.max(0,candidate.plan.length-1)>ESSENTIALS_MAX_CHARS)) {
    const why=invalidSources?'The record does not match the current original pages; its source coverage must be repaired first.'
      : !roots?'An indivisible source section exceeds the helper context.'
        : 'The complete source sections exceed the 17000 character acceptance limit.';
    if (!await persist('blocked',why)) return result('superseded');
    return result('blocked',why);
  }
  if (!await persist()) return result('superseded','The source or saved version changed while reading.');
  // Summaryception has already summarized the originals. If that complete
  // current record fits the Essentials allocation, retain all its words rather
  // than paying a model to recreate and possibly expand the same memory.
  if (usedRecord) {
    candidate.plan=[{lines:rec.lines,print:inputPrint,text:compactRecord.text,complete:true}];
    candidate.diagnostic=null;candidate.attempts=0;candidate.validationRounds=0;
    if (!await persist()) return result('superseded');
  }
  for (let i=0;i<candidate.plan.length;i++) {
    const section=candidate.plan[i];
    // Completed answers, including ones later in the plan, are checked before
    // the call allowance. A checkpoint never drops unvisited compatible work.
    if (section.complete && inspectEssentials(section.text,ESSENTIALS_MAX_CHARS).complete && sectionCoverage(section.text,section.lines)) continue;
    section.complete=false;delete section.text;
    if (signal?.aborted) throw signal.reason || new Error('reading stopped');
    const missing=candidate.plan.filter(p=>!p.complete),used=candidate.plan.filter(p=>p.complete).reduce((n,p)=>n+p.text.length,0);
    const free=ESSENTIALS_MAX_CHARS-Math.max(0,candidate.plan.length-1)-used;
    const reserve=Math.max(80,Math.min(PART_MIN_CHARS,Math.floor(free/missing.length*0.75)));
    const share=free-(missing.length-1)*reserve;
    if (share<80) {await persist('blocked','Complete source sections exceed the 17000 character acceptance limit.');return result('blocked',candidate.why);}
    const held=candidate.diagnostic?.print===section.print?candidate.diagnostic:null;
    if (held?.draft && !held.partialSourceDraft) {
      const checked=inspectEssentials(held.draft,share,held.finishReason || '');
      if (checked.complete && !held.providerTruncated && sectionCoverage(checked.text,section.lines)) {
        section.text=checked.text;section.complete=true;candidate.attempts=0;candidate.validationRounds=0;candidate.diagnostic=null;
        if (!await persist()) return result('superseded');
        continue;
      }
    }
    if (usage.calls>=RUN_CALL_LIMIT) {
      if (!await persist('yielded','Waiting for the next idle opportunity.')) return result('superseded');
      return result('yielded');
    }
    const weight=p=>p.lines.reduce((n,line)=>n+recordLine(line).length+1,0);
    const target=Math.min(Math.floor(share*0.8),Math.max(reserve,Math.floor(Math.min(free,ESSENTIALS_TARGET_CHARS)*weight(section)/missing.reduce((n,p)=>n+weight(p),0)*0.65)));
    let told;
    try {
      told=await tellPart({connection,lines:section.lines,part:i,parts:candidate.plan.length,share,target,brief,mc,signal,renew,callLLM,usage,
        fresh:candidate.phase==='fresh',tries:ESSENTIALS_TRIES,requiredCoverage:true,
        previous:candidate.diagnostic?.print===section.print?candidate.diagnostic:null,
        checkpoint:async diagnostic=>{candidate.diagnostic={...diagnostic,print:section.print};if (!await persist()) throw Object.assign(new Error('The source or saved version changed while reading.'),{superseded:true});}});
    } catch (err) {
      if (signal?.aborted && signal.reason?.message==='timeout') return fail('The provider stopped responding before the source section completed.',candidate.diagnostic,signal.reason);
      if (signal?.aborted || err?.name==='AbortError') throw err;
      if (err?.superseded) return result('superseded',err.message);
      return fail('Source section '+(i+1)+' of '+candidate.plan.length+': '+String(err?.message || 'the provider could not be reached').slice(0,300),candidate.diagnostic,err);
    }
    if (told.yielded) {if (!await persist('yielded','Waiting for the next idle opportunity.')) return result('superseded');return result('yielded');}
    if (!told.text) {
      return fail('Source section '+(i+1)+' of '+candidate.plan.length+': '+told.diagnostic.why+' (answer '+told.diagnostic.chars+' characters; available '+share+' of the global '+ESSENTIALS_MAX_CHARS+')',told.diagnostic);
    }
    section.text=told.text;section.complete=true;candidate.attempts=0;candidate.validationRounds=0;candidate.diagnostic=null;
    if (!await persist()) return result('superseded');
  }
  const text=candidate.plan.map(p=>p.text).join('\n');
  if (!inspectEssentials(text,ESSENTIALS_MAX_CHARS).complete) return fail('The complete combined candidate exceeds the 17000 character acceptance limit.');
  // Accepted text and pending removal land together. There is no empty state,
  // and a newer manual/accepted value or another generation wins this guard.
  const saved=await db.editStoryAtomically(storyId,s=>{
    if (!owns(s)) return false;
    s.settings.essentials={text,print:rec.print,sourcePrint:inputPrint,setupPrint,setupOwner,generationId:candidate.generationId,upTo:rec.upTo,complete:true,
      parts:candidate.parts,sources:rec.lines.map(n=>({id:n.id,span:n.span,print:sourcePrint([n])})),
      sourcePages:acceptedPageReceipts(rec.lines,rec.upTo,ownedPages),correctionsPrint:sourcePrint(rec.lines.filter(n=>n.correction)),at:Date.now()};
    delete s.settings.essentialsPending;return true;
  },{extraSettings:['essentialsPending']});
  return saved ? {wrote:true,outcome:'completed',parts:candidate.plan.length,usage,usedRecord} : result('superseded','The source or saved version changed while reading.');
}
