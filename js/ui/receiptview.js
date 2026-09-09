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

let wired = false;

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
  scrim.addEventListener('click', closeReceipt);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els().sheet.hidden) closeReceipt();
  });
}

export function closeReceipt() {
  const { sheet, scrim } = els();
  sheet.classList.remove('open');
  scrim.hidden = true;
  setTimeout(() => { sheet.hidden = true; }, 200);
}

export function openReceipt(receipt, extraction, findings) {
  if (!receipt || !Array.isArray(receipt.slots)) return;
  wire();
  const { sheet, scrim, slots, after, afterList, afterNote, footer } = els();

  slots.textContent = '';
  for (const slot of receipt.slots) {
    const li = document.createElement('li');
    li.className = 'receipt-slot' + (slot.tokens ? '' : ' empty');

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
  afterList.textContent = '';
  afterNote.textContent = '';
  if (extraction && typeof extraction === 'object') {
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
  if (typeof receipt.ttftMs === 'number') parts.push('First word in ' + fmtSeconds(receipt.ttftMs));
  if (typeof receipt.durationMs === 'number') parts.push(fmtSeconds(receipt.durationMs) + ' all told');
  if (typeof receipt.totalTokens === 'number') parts.push('~' + receipt.totalTokens + ' tokens sent');
  footer.textContent = parts.join(' · ');

  scrim.hidden = false;
  sheet.hidden = false;
  /* let the browser notice we're visible before sliding in */
  requestAnimationFrame(() => sheet.classList.add('open'));
}
