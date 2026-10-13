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
 * Only for a tale whose storyteller is a small model. An answer that cannot be used is asked for once more, then the
 * essentials already kept stand. A failure to reach the model throws — the queue's retries are for that. */
import { fingerprint36 } from '../engine/fingerprint.js'; /* M575 */
import { db } from '../store.js';
import { callWorker, workerConnection } from './call.js';
import { measureTransport } from '../providers/measure.js';
import { inputRoom } from '../assemble/budget.js';
import { contextOf } from '../providers/room.js'; /* M565: the record told in parts that fit its model */
import { mcName } from '../engine/duels.js';
import { brokenOff } from '../engine/world.js';
import { writerText, BRIEF_ROOM } from '../engine/whole.js'; /* M566 */

export const ESSENTIALS_KEY = (storyId) => 'essentials:' + storyId;
export const PENDING_KEY = storyId => 'essentialsPending:' + storyId;
/* M510-16: the same room the record's newest lines had (M510-14, about 4,000 tokens) — now spent on the whole story */
export const ESSENTIALS_MAX_CHARS = 16000;   /* about 4,000 tokens — the whole story, streamlined */
export const ESSENTIALS_MAX_TOKENS = 5000;
export const ESSENTIALS_TRIES = 3; /* M666: his — "it automatically tries again, same as all other workers": three asks, as the keeper's lines have */

const fp = (t) => fingerprint36(t);

/* M741: unfinished sources are durable work, not a permanent failed-input lock.
 * Short recovery first, then a patient ceiling while the story stays open. */
export const essentialsRetryDelay = attempts => [60000, 300000, 900000, 1800000][Math.min(3, Math.max(0, attempts - 1))];
function helperPrintOf(connection, brief, mc) {
  const helper = workerConnection(connection, {maxTokens:ESSENTIALS_MAX_TOKENS});
  const shell = essentialsAsk({brief,mc});
  const accounting = measureTransport(helper,{system:shell.system,messages:[{role:'user',content:shell.user}]});
  return {helper,accounting,print:fp(JSON.stringify([helper.id,helper.type,helper.model,helper.baseUrl,contextOf(helper),accounting.answerTokens,helper.reasoning,helper.temperature,helper.topP,helper.prefill]))};
}
export function essentialsRecoveryState({kept,pending,nodes,brief='',mc='',connection,now=Date.now()}={}) {
  const rec=recordOf(nodes),inputPrint=sourcePrint(nodes),setupPrint=fp(brief+'\n'+mc);
  if (!rec.lines.length) return {needed:false,why:'no record yet'};
  if (kept?.text && kept.complete!==false && kept.print===rec.print && (!kept.sourcePrint || kept.sourcePrint===inputPrint) && (!kept.setupPrint || kept.setupPrint===setupPrint)) return {needed:false,why:'unchanged'};
  if (!connection) return {needed:true,why:'Plot essentials needs a connection.',retryAt:now+60000};
  const {print:helperPrint}=helperPrintOf(connection,brief,mc);
  const same=pending?.sourcePrint===inputPrint && pending.setupPrint===setupPrint && pending.helperPrint===helperPrint;
  return {needed:true,same,inputPrint,setupPrint,helperPrint,retryAt:same ? Number(pending.nextAt)||0 : 0,
    why:same ? pending.why || 'The previous essentials answer was incomplete.' : 'Plot essentials has not finished reading the current record.'};
}

export function essentialsRunNote(out) {
  if (out.wrote || out.why==='unchanged') return {detail:out.wrote ? 'streamlined the whole record into the story’s essentials' : 'the saved essentials match the current record'};
  if (!out.pending) return {silent:true};
  const wait=Math.max(1,Math.ceil(((out.retryAt || Date.now()+60000)-Date.now())/60000));
  return {unfinished:true,detail:'Plot essentials update pending: '+out.why+'. Previous saved essentials were left intact. Automatic recovery will check again in about '+wait+(wait===1?' minute.':' minutes.')};
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
  return fp(JSON.stringify(recordOf(nodes).lines.map(n => [n.id, n.span, n.text, n.detail || '', n.correction === true, n.sourcePages || n.source || n.sources || null])));
}
export function essentialsMatch(kept, nodes, through = Infinity) {
  if (!kept?.text || kept.complete === false || !Number.isFinite(kept.upTo) || kept.upTo >= through) return false;
  const all = recordOf(nodes).lines;
  const prefix = all.filter(n => n.correction || n.span[1] <= kept.upTo);
  if (all.some(n => !n.correction && n.span[0] <= kept.upTo && n.span[1] > kept.upTo)) return false;
  return kept.sourcePrint ? sourcePrint(prefix) === kept.sourcePrint : recordOf(prefix).print === kept.print;
}

export async function loadEssentials(storyId) {
  const kept = await db.settings.get(ESSENTIALS_KEY(storyId));
  const memory = await db.settings.get('memory:' + storyId);
  const story = await db.stories.get(storyId);
  const state = await db.settings.get('state:' + storyId);
  if(kept?.setupPrint && story && state && kept.setupPrint !== fp((story.brief || '') + '\n' + mcName(state))) return null;
  if (memory && !essentialsMatch(kept, memory.nodes)) return null;
  return kept && typeof kept === 'object' && typeof kept.text === 'string' && kept.text ? kept : null;
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
async function tellPart({ connection, lines, part, parts, share, brief, mc, signal, renew, callLLM, usage, previous }) {
  const ask = essentialsAsk({ record: lines.map(recordLine).join('\n'), brief, mc });
  const partNote = '\n\nPart ' + (part + 1) + ' of ' + parts + '. Tell only these original source entries, within ' + share + ' characters.';
  const correction = result => '\n\nThe previous candidate was ' + result.why + (result.chars ? ' ('+result.chars+' characters)' : '') + '. '+
    (result.clipped || result.providerTruncated ? 'Aim for at most '+Math.floor(share*0.7)+' characters, using fewer complete lines for related entries. ' : 'Every line must begin with [time, place] (pages first to last). No headings, commentary or separate continuation lines. ')+
    'Return complete record lines, keeping causes, consequences, corrections and necessary emotional details. Cover all supplied source entries; do not leave the newest stretch unfinished.';
  let user = ask.user + partNote + (previous ? correction(previous) : '');
  let correctedLength = false;
  let last;
  for (let attempt = 0; attempt < ESSENTIALS_TRIES; attempt++) {
    if (signal?.aborted) throw signal.reason || new Error('reading stopped');
    renew();
    usage.calls++; usage.inputChars += ask.system.length + user.length;
    const answer = await callLLM(connection, { system: ask.system, user, maxTokens: ESSENTIALS_MAX_TOKENS, signal });
    const raw = typeof answer === 'string' ? answer : answer?.text || '';
    usage.outputChars += raw.length;
    const result = inspectEssentials(raw, share, answer?.finishReason || '');
    if (result.complete) return {text:result.text};
    last={why:result.why,clipped:result.clipped,providerTruncated:result.providerTruncated,chars:result.text.length,finishReason:answer?.finishReason || '',part:part+1,parts,share};
    if (result.clipped || result.providerTruncated) {
      if (correctedLength) break;
      correctedLength = true;
    }
    user = ask.user + partNote + correction(last);
  }
  return {text:'',diagnostic:last};
}
export async function runEssentials({ connection, storyId, nodes, brief = '', mc = '', signal, renew = () => {}, callLLM = callWorker, force = false, stale = () => false } = {}) {
  if (!connection || !storyId) return { wrote: false, why: 'no connection' };
  const rec = recordOf(nodes);
  if (!rec.lines.length) return { wrote: false, why: 'no record yet' };
  const original = await db.settings.get(ESSENTIALS_KEY(storyId));
  const ownedMemory = await db.settings.get('memory:' + storyId);
  const ownedStory = await db.stories.get(storyId);
  const ownedState = await db.settings.get('state:' + storyId);
  const ownerPrint = (story,state) => fp(JSON.stringify([story?.brief || '',state?.sheet?.playerName || '',state?.sheet?.playerAliases || []]));
  const setupOwner = ownerPrint(ownedStory,ownedState);
  const inputPrint = sourcePrint(nodes);
  const setupPrint = fp(brief + '\n' + mc);
  const pending = await db.settings.get(PENDING_KEY(storyId));
  const recovery=essentialsRecoveryState({kept:original,pending,nodes,brief,mc,connection});
  if (!force && !recovery.needed) return {wrote:false,why:'unchanged'};
  const {helper,accounting,print:helperPrint}=helperPrintOf(connection,brief,mc);
  if (!force && recovery.same && recovery.retryAt>Date.now()) return {wrote:false,pending:true,why:recovery.why,retryAt:recovery.retryAt,usage:{calls:0,inputChars:0,outputChars:0}};
  const room = Math.max(0,Math.floor((inputRoom({budgetTokens:contextOf(helper),answerTokens:accounting.answerTokens}) - accounting.inputTokens) * 3 * 0.75) - 600);
  const usage = { calls: 0, inputChars: 0, outputChars: 0 };
  const savedParts = [];
  const failed = async (why,diagnostic) => {
    const latestMemory = await db.settings.get('memory:' + storyId);
    const latestStory=await db.stories.get(storyId),latestState=await db.settings.get('state:'+storyId);
    const latestEssentials=await db.settings.get(ESSENTIALS_KEY(storyId));
    const attempts=(recovery.same ? Number(pending.attempts)||0 : 0)+1;
    const retryAt=Date.now()+essentialsRetryDelay(attempts);
    if(!stale() && !signal?.aborted && setupOwner===ownerPrint(latestStory,latestState) && JSON.stringify(latestEssentials)===JSON.stringify(original) && (!ownedMemory || latestMemory && sourcePrint(latestMemory.nodes) === inputPrint)) await db.settings.set(PENDING_KEY(storyId),{sourcePrint:inputPrint,setupPrint,helperPrint,why,diagnostic,attempts,nextAt:retryAt,parts:savedParts});
    return { wrote:false,why,pending:true,retryAt,usage };
  };
  // An indivisible entry cannot be silently clipped or falsely certified.
  if (rec.lines.some(n => recordLine(n).length + 1 > room)) return failed('an individual source entry exceeds the helper room');
  const parts = recordParts(rec.lines, room);
  const available = ESSENTIALS_MAX_CHARS - Math.max(0, parts.length - 1);
  const minimum = 100;
  if (parts.length * minimum > available) return failed('too many source parts for complete combined essentials');
  const total = rec.lines.reduce((t, n) => t + recordLine(n).length + 1, 0) || 1;
  const spare = available - parts.length * minimum;
  const shares = parts.map(part => minimum + Math.floor(spare * part.reduce((t,n) => t + recordLine(n).length + 1,0) / total));
  const told = [];
  const reuseSafe = !force && original?.setupPrint === setupPrint && !rec.lines.some(n => n.correction);
  for (let i = 0; i < parts.length; i++) {
    const print = sourcePrint(parts[i]);
    const candidates=[...(reuseSafe ? original?.parts || [] : []),...(!force && recovery.same ? pending?.parts || [] : [])];
    const reused = candidates.find(p => p.print === print && p.share === shares[i] && p.complete && inspectEssentials(p.text,shares[i]).complete);
    let result;
    try {
      result=reused ? {text:reused.text} : await tellPart({ connection, lines: parts[i], part: i, parts: parts.length, share: shares[i], brief, mc, signal, renew, callLLM, usage,previous:recovery.same && pending.diagnostic?.part===i+1 ? pending.diagnostic : null });
    } catch (err) {
      // Cancellation belongs to the queue. A provider failure gets the same durable
      // patient recovery as a rejected answer, including any completed source parts.
      if (signal?.aborted || err?.name==='AbortError') throw err;
      return failed('source part '+(i+1)+' of '+parts.length+': '+String(err?.message || 'the provider could not be reached').slice(0,300));
    }
    const text=result.text;
    if (!text) return failed('source part '+(i+1)+' of '+parts.length+': '+result.diagnostic.why+' (answer '+result.diagnostic.chars+' characters; allowed '+shares[i]+')',result.diagnostic);
    told.push(text); savedParts.push({ print, share: shares[i], text, complete: true });
  }
  const text = told.join('\n');
  if (text.length > ESSENTIALS_MAX_CHARS) return failed('combined output exceeds the essentials room');
  const nowMemory = await db.settings.get('memory:' + storyId);
  const nowEssentials = await db.settings.get(ESSENTIALS_KEY(storyId));
  const nowStory = await db.stories.get(storyId);
  const nowState = await db.settings.get('state:' + storyId);
  if (stale() || signal?.aborted || setupOwner !== ownerPrint(nowStory,nowState) || JSON.stringify(nowEssentials) !== JSON.stringify(original) || (ownedMemory && (!nowMemory || sourcePrint(nowMemory.nodes) !== inputPrint))) return failed('source or manual ownership changed while reading');
  await db.settings.set(ESSENTIALS_KEY(storyId), { text, print: rec.print, sourcePrint: inputPrint, setupPrint, upTo: rec.upTo, complete: true, parts: savedParts, sources: rec.lines.map(n => ({ id: n.id, span: n.span, print: sourcePrint([n]) })), at: Date.now() });
  await db.settings.delete(PENDING_KEY(storyId));
  return { wrote: true, parts: parts.length, usage };
}
