/* Cozy Tavern — ui/receiptview.js
 * "What the storyteller saw this turn" — the sheet that opens from the small
 * receipt line under any assistant message. One row per slot, in the order
 * the stack was built, with roughly how many tokens each carried and why it
 * was (or wasn't) there. The footer names the model and the timings.
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

export function openReceipt(receipt) {
  if (!receipt || !Array.isArray(receipt.slots)) return;
  wire();
  const { sheet, scrim, slots, footer } = els();

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
