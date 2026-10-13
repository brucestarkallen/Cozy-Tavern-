import { loadState } from '../engine/state.js';
import { db } from '../store.js';
import { auditSources } from '../agents/auditsources.js';
import { visiblePages } from '../agents/memory.js';
import { ledgerVerificationRows,verificationReceiptMatches,reusableAuditCheckpoint,ledgerRepairInputKey } from '../agents/auditprogress.js';

// The scratchbook open now, closed by opening another (one at a time).
let closeShown=null;

// A read-only view of the auditor's real saved work, not another model call.
export function auditScratchbookButton(getStory) {
  const button=document.createElement('button');
  button.type='button';button.className='text-btn';button.textContent='Auditor scratchbook';
  button.addEventListener('click',async()=>{
    button.disabled=true;
    try {
      const story=await getStory();
      if (!story) return;
      const [state,messages]=await Promise.all([loadState(story.id),db.messages.list(story.id)]);
      const pages=visiblePages(messages);
      const documents=auditSources({brief:story.brief,castNotes:story.castNotes,messages:pages});
      const kept=reusableAuditCheckpoint(state,story,documents),verification=state.audit?.verification;
      const currentInput=verification?.source===ledgerRepairInputKey({},story,pages);
      /* The house's own pop-up, as the housekeeper's viewers open (M77): a veil over the page holding one card; Close, Esc
       * and a tap on the veil close it, and Esc closes it before the ledger behind it. It was a <dialog> opened with
       * showModal(), which a browser without that call does not have (the walk's jsdom, an older Safari): "dialog.showModal
       * is not a function" and the button answered nothing — and where it had it, Esc reached the ledger's own Esc too and
       * shut the drawer behind the scratchbook. */
      closeShown?.();
      const pop=document.createElement('div');
      pop.className='hk-pop';pop.setAttribute('role','dialog');pop.setAttribute('aria-modal','true');pop.setAttribute('aria-label','Auditor scratchbook');
      const card=document.createElement('div');card.className='hk-pop-card';
      const head=document.createElement('div');head.className='hk-pop-head';
      const heading=document.createElement('h2');heading.className='hk-pop-title';heading.textContent='Auditor scratchbook';
      const close=document.createElement('button');close.type='button';close.className='text-btn';close.textContent='Close';
      const body=document.createElement('div');body.className='hk-pop-body';
      const onKey=e=>{if (e.key==='Escape') {e.preventDefault();e.stopPropagation();shut();}};
      const shut=()=>{
        document.removeEventListener('keydown',onKey,true);pop.remove();
        if (closeShown===shut) closeShown=null;
        if (button.isConnected) button.focus();
      };
      close.addEventListener('click',shut);
      pop.addEventListener('click',e=>{if (e.target===pop) shut();});
      const summary=document.createElement('p');
      summary.textContent=(state.audit?.coverage?.read || 0)+' of '+(state.audit?.coverage?.total || 0)+' source passages read. '
        +Object.keys(kept.entries).length+' lasting profile checks retained. '
        +(currentInput?(verification?.read || 0)+' of '+(verification?.total || 0)+' current entry checks complete.':'Current scene awaiting its review.');
      const note=document.createElement('p');note.className='quiet';
      note.textContent='Completed identities and appearance stay checked while their saved facts and original sources hold. New scenes update current positions and activity. Changed facts reopen the affected profile.';
      const timing=document.createElement('p');timing.className='quiet';
      const review=state.audit?.finalReview;
      timing.textContent=review?.calls
        ?'Last review used '+review.calls+' model '+(review.calls===1?'call':'calls')+'. '+(review.sourceCalls || 0)+' source reading calls. '+(review.fetches || 0)+' source lookups. '+(review.formatContinuation?'One response completion was needed.':'Repairs and approval were returned together.')
        :'Entry totals count saved decisions, not one model call per entry.';
      const list=document.createElement('ul');
      const labels={characters:'Identity and appearance',characterState:'Current character state',canon:'Physical facts'};
      for (const row of ledgerVerificationRows(state).filter(r=>['characters','characterState','canon'].includes(r.section) && r.value)) {
        const current=currentInput && verificationReceiptMatches(verification?.entries?.[row.id],row);
        const receipt=kept.entries[row.id] || (current?verification.entries[row.id]:null);
        const partial=kept.profiles[row.id] || (currentInput?verification?.profiles?.[row.id]:null);
        const li=document.createElement('li');
        li.textContent=row.name+'. '+labels[row.section]+'. '+(receipt?'Checked. '+receipt.why:partial?.print===row.print && partial.scope===row.scope
          ?'In progress. '+((partial.appearance || []).length+(partial.identity || []).length)+' fact decisions saved.' :'Awaiting review.');
        list.append(li);
      }
      const pending=document.createElement('h3');pending.textContent='Remaining work';
      const work=document.createElement('ul');
      for (const text of state.audit?.pending || []) { const li=document.createElement('li');li.textContent=text;work.append(li); }
      if (!work.children.length) {const li=document.createElement('li');li.textContent='No open findings in the last completed review.';work.append(li);}
      head.append(heading,close);body.append(summary,note,timing,list,pending,work);card.append(head,body);pop.append(card);
      document.body.append(pop);document.addEventListener('keydown',onKey,true);closeShown=shut;close.focus();
    } finally {button.disabled=false;}
  });
  return button;
}
