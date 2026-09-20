/* Cozy Tavern — ui/receiptview.js
 * "What the storyteller saw this turn" — the sheet that opens from the small
 * receipt line under any assistant message. One row per slot, in the order
 * the stack was built, with roughly how many tokens each carried and why it
 * was (or wasn't) there. The footer names the model and the timings. M3 adds
 * an "After this turn" section: the mutations the workers applied once the
 * page was done, in the plain words the log speaks.
 *
 * The markup lives in index.html (#receipt-sheet); listeners are bound once,
 * lazily, on first open — the sheet needs no shared context.
 */

import { loadSent, KEEP_PAGES } from '../sent.js'; /* M347: the words each page was sent */

let wired = false;
let openGeneration = 0; /* M347: a sheet reopened on another page never takes the words that were on their way to the last */

function els() {
  return {
    sheet: document.getElementById('receipt-sheet'),
    scrim: document.getElementById('receipt-scrim'),
    slots: document.getElementById('receipt-slots'),
    after: document.getElementById('receipt-after'),
    afterList: document.getElementById('receipt-after-list'),
    afterNote: document.getElementById('receipt-after-note'),
    footer: document.getElementById('receipt-footer'),
    btnClose: document.getElementById('btn-receipt-close'),
    tabNormal: document.getElementById('receipt-tab-normal'),
    tabRaw: document.getElementById('receipt-tab-raw'),
    wordsNote: document.getElementById('receipt-words-note'),
    raw: document.getElementById('receipt-raw'),
  };
}

function fmtSeconds(ms) {
  if (typeof ms !== 'number') return '';
  return (ms / 1000).toFixed(1) + 's';
}

function wire() {
  if (wired) return;
  wired = true;
  const { scrim, btnClose } = els();
  btnClose.addEventListener('click', closeReceipt);
  const { tabNormal, tabRaw } = els();
  if (tabNormal) tabNormal.addEventListener('click', () => showView('normal'));
  if (tabRaw) tabRaw.addEventListener('click', () => showView('raw'));
  scrim.addEventListener('click', closeReceipt);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els().sheet.hidden) closeReceipt();
  });
}

/* B8 (M9): the close timer carries a generation number — close-then-quick-
 * reopen no longer hides the sheet out from under the new reading. */
let closeGeneration = 0;

export function closeReceipt() {
  const { sheet, scrim } = els();
  const generation = ++closeGeneration;
  sheet.classList.remove('open');
  scrim.hidden = true;
  setTimeout(() => {
    if (generation !== closeGeneration) return; // reopened in between
    sheet.hidden = true;
  }, 200);
}

/* ---------- M347: Normal and Raw ---------- */

/* Copy that works on the phone's own address too (the clipboard API needs a secure page; a LAN address is not one). */
export async function copyWords(text, button) {
  let ok = false;
  try { if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') { await navigator.clipboard.writeText(text); ok = true; } } catch (err) { ok = false; }
  if (!ok) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = typeof document.execCommand === 'function' && document.execCommand('copy');
      ta.remove();
    } catch (err) { ok = false; }
  }
  if (button) {
    const was = button.dataset.label || button.textContent;
    button.dataset.label = was;
    button.textContent = ok ? 'Copied' : 'Could not copy';
    setTimeout(() => { button.textContent = button.dataset.label; }, 1500);
  }
  return ok;
}

function copyButton(label, textOf) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'receipt-copy';
  b.textContent = label;
  b.addEventListener('click', (e) => { e.stopPropagation(); copyWords(textOf(), b); });
  return b;
}

function wordsBlock(text) {
  const pre = document.createElement('pre');
  pre.className = 'receipt-text';
  pre.textContent = text;
  return pre;
}

let currentView = 'normal';
let rawPending = null; /* the words waiting to be drawn into Raw, the first time Raw is shown */
function showView(view) {
  const { tabNormal, tabRaw, slots, raw, after } = els();
  currentView = view === 'raw' ? 'raw' : 'normal';
  if (tabNormal) tabNormal.setAttribute('aria-selected', String(currentView === 'normal'));
  if (tabRaw) tabRaw.setAttribute('aria-selected', String(currentView === 'raw'));
  slots.hidden = currentView !== 'normal';
  if (raw) raw.hidden = currentView !== 'raw';
  if (after && currentView === 'raw') after.hidden = true;
  else if (after) after.hidden = !after.dataset.has;
  const drift = els().sheet.querySelector('.receipt-drift');
  if (drift) drift.hidden = currentView === 'raw';
  if (currentView === 'raw' && rawPending) { const sent = rawPending; rawPending = null; renderRaw(sent); }
}

/* one message's words as the model took them: a string, or content parts (text kept, an image named) */
function contentWords(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => {
      if (typeof p === 'string') return p;
      if (p && typeof p.text === 'string') return p.text;
      if (p && (p.type === 'image_url' || p.type === 'image')) return '[an image]';
      return p ? JSON.stringify(p) : '';
    }).join('\n\n');
  }
  return content == null ? '' : JSON.stringify(content);
}

/* The request as the model took it: its settings, then every message in order, each under its role. */
export function rawMessagesOf(body) {
  const out = [];
  const b = body && typeof body === 'object' ? body : {};
  if (typeof b.system === 'string' && b.system) out.push({ role: 'system', text: b.system });
  else if (Array.isArray(b.system)) for (const block of b.system) out.push({ role: 'system', text: contentWords(block && block.text !== undefined ? block.text : block) });
  for (const m of Array.isArray(b.messages) ? b.messages : []) out.push({ role: String((m && m.role) || '?'), text: contentWords(m && m.content) });
  return out;
}
export function rawSettingsOf(body) {
  const b = body && typeof body === 'object' ? body : {};
  const rest = {};
  for (const k of Object.keys(b)) if (k !== 'messages' && k !== 'system') rest[k] = b[k];
  return rest;
}

function renderRaw(sent) {
  const { raw } = els();
  if (!raw) return;
  raw.textContent = '';
  const requests = sent && Array.isArray(sent.requests) ? sent.requests : [];
  if (!requests.length) {
    const p = document.createElement('p');
    p.className = 'quiet';
    p.textContent = 'The request itself was not kept for this page — only its parts (Normal).';
    raw.appendChild(p);
    return;
  }
  requests.forEach((req, i) => {
    const box = document.createElement('div');
    box.className = 'raw-request';
    const head = document.createElement('div');
    head.className = 'raw-head';
    const title = document.createElement('span');
    let where = '';
    try { where = new URL(req.url).host; } catch (err) { where = ''; }
    title.textContent = (requests.length > 1 ? 'Request ' + (i + 1) + ' — ' : '') + 'sent to ' + (where || 'the storyteller') + (req.body && req.body.model ? ' · ' + req.body.model : '');
    head.append(title, copyButton('Copy all', () => JSON.stringify(req.body, null, 2)));
    box.appendChild(head);
    const settings = rawSettingsOf(req.body);
    if (Object.keys(settings).length) {
      const s = document.createElement('div');
      s.className = 'raw-msg';
      const role = document.createElement('div');
      role.className = 'raw-role';
      const label = document.createElement('span');
      label.textContent = 'settings';
      role.append(label, copyButton('Copy', () => JSON.stringify(settings, null, 2)));
      s.append(role, wordsBlock(JSON.stringify(settings, null, 2)));
      box.appendChild(s);
    }
    for (const m of rawMessagesOf(req.body)) {
      const row = document.createElement('div');
      row.className = 'raw-msg';
      const role = document.createElement('div');
      role.className = 'raw-role';
      const label = document.createElement('span');
      label.textContent = m.role;
      role.append(label, copyButton('Copy', () => m.text));
      row.append(role, wordsBlock(m.text));
      box.appendChild(row);
    }
    raw.appendChild(box);
  });
}

/* the words arrive after the sheet opens: each part with words becomes a box to tap, and Raw is filled */
function attachWords(sent, receipt) {
  const { slots, wordsNote } = els();
  const byName = new Map();
  for (const s of (sent && sent.slots) || []) if (s && s.name && !byName.has(s.name)) byName.set(s.name, s.text || '');
  const rows = [...slots.querySelectorAll('li.receipt-slot')];
  rows.forEach((li) => {
    const name = li.dataset.slot || '';
    const text = byName.get(name);
    if (!text) return;
    const head = li.querySelector('.receipt-slot-head');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'receipt-slot-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    while (head.firstChild) toggle.appendChild(head.firstChild);
    head.appendChild(toggle);
    const body = document.createElement('div');
    body.className = 'receipt-slot-body';
    body.hidden = true;
    li.appendChild(body);
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      if (open && !body.firstChild) {
        const tools = document.createElement('div');
        tools.className = 'receipt-tools';
        tools.appendChild(copyButton('Copy', () => text));
        body.append(tools, wordsBlock(text));
      }
      toggle.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
    });
  });
  wordsNote.hidden = true;
  const { raw } = els();
  if (raw) raw.textContent = '';
  rawPending = sent;
  if (currentView === 'raw') showView('raw');
  void receipt;
}

function noWords(message) {
  rawPending = null;
  const { wordsNote, raw } = els();
  wordsNote.textContent = message;
  wordsNote.hidden = false;
  if (raw) {
    raw.textContent = '';
    const p = document.createElement('p');
    p.className = 'quiet';
    p.textContent = message;
    raw.appendChild(p);
  }
}

export function openReceipt(receipt, extraction, findings) {
  if (!receipt || !Array.isArray(receipt.slots)) return;
  wire();
  const { sheet, scrim, slots, after, afterList, afterNote, footer } = els();

  slots.textContent = '';
  for (const slot of receipt.slots) {
    const li = document.createElement('li');
    li.className = 'receipt-slot' + (slot.tokens ? '' : ' empty');
    li.dataset.slot = slot.name;

    const head = document.createElement('div');
    head.className = 'receipt-slot-head';
    const name = document.createElement('span');
    name.className = 'receipt-slot-name';
    name.textContent = slot.name;
    const tokens = document.createElement('span');
    tokens.className = 'receipt-slot-tokens';
    tokens.textContent = slot.tokens ? '~' + slot.tokens + ' tokens' : 'not part of this turn';
    head.append(name, tokens);
    li.appendChild(head);

    const why = [slot.reason, slot.source].filter(Boolean).join(' · ');
    if (why) {
      const p = document.createElement('p');
      p.className = 'receipt-slot-why';
      p.textContent = why;
      li.appendChild(p);
    }
    slots.appendChild(li);
  }

  /* M3 — "After this turn": what the workers made of the page, in plain
   * words. Older pages (and stories keeping their ledger by hand) carry no
   * extraction, and the section simply stays folded away. */
  after.hidden = true;
  delete after.dataset.has;
  afterList.textContent = '';
  afterNote.textContent = '';
  if (extraction && typeof extraction === 'object') {
    after.dataset.has = '1';
    const words = Array.isArray(extraction.appliedWords) ? extraction.appliedWords : [];
    const rejectedCount = typeof extraction.rejectedCount === 'number' ? extraction.rejectedCount : 0;
    after.hidden = false;
    if (words.length) {
      for (const w of words) {
        const li = document.createElement('li');
        li.textContent = w;
        afterList.appendChild(li);
      }
    } else {
      const li = document.createElement('li');
      li.textContent = 'Nothing in the ledger changed.';
      afterList.appendChild(li);
    }
    if (rejectedCount > 0) {
      afterNote.textContent = 'The workers also offered '
        + rejectedCount + (rejectedCount === 1 ? ' change' : ' changes')
        + ' that didn’t hold, so nothing came of ' + (rejectedCount === 1 ? 'it' : 'them') + '.';
    }
  }

  /* M6 — "Drift": the second reader's notes, when it found the page
   * sitting awkwardly beside what's written down. Built on the fly after
   * "After this turn"; nothing renders when there were no findings. */
  let drift = sheet.querySelector('.receipt-drift');
  if (drift) drift.remove();
  const list = Array.isArray(findings)
    ? findings.filter((f) => f && typeof f.words === 'string' && f.words.trim())
    : [];
  if (list.length) {
    drift = document.createElement('div');
    drift.className = 'receipt-after receipt-drift';
    const h = document.createElement('h3');
    h.textContent = 'Drift';
    const ul = document.createElement('ul');
    ul.className = 'receipt-after-list';
    for (const f of list) {
      const li = document.createElement('li');
      li.textContent = f.words.trim();
      ul.appendChild(li);
    }
    const p = document.createElement('p');
    p.className = 'quiet';
    p.textContent = 'Noted by the second reader, against what’s written down. The words above were left as written.';
    drift.append(h, ul, p);
    after.after(drift);
  }

  const parts = [];
  if (receipt.model) parts.push('Told by ' + receipt.model);
  /* M8.5: the two firsts — the thought, then the word. Old receipts carry
   * no tfft and simply keep their one first. */
  const firsts = [];
  if (typeof receipt.tfftMs === 'number') firsts.push('first thought ' + fmtSeconds(receipt.tfftMs));
  if (typeof receipt.ttftMs === 'number') firsts.push('first word ' + fmtSeconds(receipt.ttftMs));
  if (firsts.length) parts.push(firsts.join(' · '));
  if (receipt.effort) parts.push('thinking ' + receipt.effort);
  if (typeof receipt.durationMs === 'number') parts.push(fmtSeconds(receipt.durationMs) + ' all told');
  if (typeof receipt.totalTokens === 'number') parts.push('~' + receipt.totalTokens + ' tokens sent');
  if (receipt.prefill) parts.push(receipt.prefill); /* M329: did the prefill work, on this turn */
  footer.textContent = parts.join(' · ');

  /* M347: Normal first, always (the view he named as the default); the words come from js/sent.js */
  rawPending = null;
  const { raw: rawBox } = els();
  if (rawBox) rawBox.textContent = '';
  showView('normal');
  const generation = ++openGeneration;
  const { wordsNote } = els();
  wordsNote.hidden = true;
  if (receipt.sentId) {
    wordsNote.textContent = 'Fetching what was sent…';
    wordsNote.hidden = false;
    loadSent(receipt.sentId).then((sent) => {
      if (generation !== openGeneration) return;
      if (sent) attachWords(sent, receipt);
      else noWords('This page’s words are not kept — a tale keeps the words of its newest ' + KEEP_PAGES + ' pages.');
    }).catch(() => { if (generation === openGeneration) noWords('This page’s words could not be read.'); });
  } else {
    noWords('This page was written before its words were kept — only the size of each part was noted, so what it said cannot be shown.');
  }

  closeGeneration += 1; // B8: any pending close-timer stands down
  scrim.hidden = false;
  sheet.hidden = false;
  /* let the browser notice we're visible before sliding in */
  requestAnimationFrame(() => sheet.classList.add('open'));
}
