import {db,dropCaches} from '../../js/store.js';
import {emptyState,loadState,saveState,withStoryWrites} from '../../js/engine/state.js';
import {applyMutations,undoEntry} from '../../js/engine/apply.js';
import {sourcePersonKey,missingSourceIdentityFacts} from '../../js/agents/auditsources.js';
import * as hk from '../../js/agents/housekeeper.js';
const assert = (v,m) => {if(!v) throw new Error(m);};
const eq = (a,b,m) => assert(JSON.stringify(a)===JSON.stringify(b),m + ': ' + JSON.stringify(a));
export async function run() {
  const story=await db.stories.create({title:'Spelling fixture'}), id=story.id;
  await db.stories.update(id,{brief:'Aakeno knows Akane.',castNotes:"Aakeno’s history stays.\nUntouched paragraph."});
  let state=emptyState();
  state.characters={Aakeno:{core:'Aakeno is a scholar.',state:'With Akane.',arc:'Aakeno seeks home.',threads:['Find Aakeno’s book.'],aliases:['Aakeno','Priestess'],coreOrigin:{kind:'writer',text:'Aakeno is a scholar.'}},Akane:{core:'Untouched.'}};
  state.present=[{name:'Aakeno',position:'Aakeno’s seat',attire:'Blue'}];
  state.canon={Aakeno:{facts:[{key:'Aakeno hair',value:'Aakeno has black hair.',atMinutes:1}]}};
  state.bodies={Aakeno:{injuries:[{what:'Aakeno’s wrist',sev:1}],strain:[]}};
  state.relationships={Aakeno:{p:60,r:50,s:0,d:0,history:[{cause:'Aakeno helped.',axis:'p',delta:2,atMinutes:1}]}};
  state.knowledge={Aakeno:[{fact:'Aakeno knows the gate.',sourceRefs:['original-Aakeno']}]};
  state.offscreen={Akane:{location:'Aakeno’s library',activity:'Wait',agenda:'Read'}};
  state.things={book:{owner:'Aakeno',where:'Aakeno’s desk',note:'Keep'}};
  state.worldBrief={pressure:['Aakeno waits.'],ripe:[],twb:{who:'Aakeno',where:'Library',changed:'Aakeno reads.'},voices:[{speaker:'Aakeno',channel:'Library',content:'Aakeno’s book.'}]};
  state.duel={active:true,player:{name:'Akane',poise:12},opp:{name:'Aakeno',poise:9}};
  state.auditSources={original:{people:[{name:'Aakeno',quote:'Aakeno arrived.'}],mark:'original'}};
  await saveState(id,state); state=await loadState(id);
  await db.messages.append(id,{id:'m730page',role:'assistant',text:"Aakeno’s book. Akane waits.\nUntouched.",hidden:true,swipes:[{text:'AAKENO waits.',receipt:{quote:'Aakeno'}},{text:"Aakeno’s book. Akane waits.\nUntouched."}],swipeIdx:1,receipt:{original:'Aakeno'},voices:[{speaker:'Aakeno',channel:'Library',content:'Aakeno’s book.'}]});
  await db.messages.append(id,{id:'m730writer',role:'user',text:'I greet aakeno.',extra:'Keep'});
  await db.settings.set('memory:'+id,{nodes:[{id:'n',span:[0,0],text:'Aakeno arrived.',detail:'Aakeno’s book.',original:'Aakeno',verified:{quote:'Aakeno'}}]});
  await db.settings.set('lore:'+id,[{id:'l',name:'Aakeno',keys:['Aakeno'],secondaryKeys:['Aakeno’s book'],content:'Aakeno reads. Akane waits.',source:'Aakeno'}]);
  await db.settings.set('standingPlans:'+id,{plans:[{title:'Aakeno’s book',by:'Aakeno',goal:'Find it',parts:[{who:'Aakeno',does:'Read',when:'Now'}],words:['Aakeno promised.']}]});
  const before=await db.editStoryAtomically(id,s=>structuredClone(s));
  let calls=0;
  const request=()=>hk.housekeeperTurn({storyId:id,writerText:'Change Aakeno to Akeno everywhere.',call:async()=>{calls++;return {text:'Proposed correction. <corrections>[{"type":"name.spelling","from":"Aakeno","to":"Akeno","scope":"story","reason":"writer requested spelling correction"}]</corrections>'};}});
  let answer=await request(); assert(answer.ok,answer.error);eq(calls,1,'one model call');
  const result=await hk.applyAllPending(answer.session,id); assert(result.complete && result.applied===1,result.words);
  dropCaches(); let saved=await loadState(id), session=await hk.loadSession(id);
  assert(saved.characters.Akeno && !saved.characters.Aakeno,'identity corrected');
  eq(saved.characters.Akane,state.characters.Akane,'unrelated character');
  eq(saved.characters.Akeno.core,'Akeno is a scholar.','biography');eq(saved.characters.Akeno.aliases,['Priestess'],'typo alias removed');
  eq(saved.relationships.Akeno.p,60,'earned standing');eq(saved.relationships.Akeno.history,state.relationships.Aakeno.history,'historical evidence');eq(saved.auditSources,state.auditSources,'source provenance');
  eq(sourcePersonKey({...saved,journal:[]},'Aakeno'),'Akeno','source mapping survives journal rollover');
  eq(missingSourceIdentityFacts(saved,{name:'Aakeno',identityFacts:[{text:'Aakeno is a scholar.',shown:'Aakeno is a scholar.'}]}),[],'original identity fact still satisfied');
  eq((await db.settings.get('standingPlans:'+id)).plans[0].by,'Akeno','standing plans');
  eq(saved.present[0].name,'Akeno','presence');eq(saved.worldBrief.voices[0].speaker,'Akeno','world voice');eq(saved.duel.opp.name,'Akeno','live duel identity');eq(saved.duel.opp.poise,9,'combat score');eq(saved.bodies.Akeno.injuries[0].what,'Akeno’s wrist','injury');eq(saved.knowledge.Akeno[0].fact,'Akeno knows the gate.','knowledge');
  let pages=await db.messages.list(id);eq(pages[0].text,"Akeno’s book. Akane waits.\nUntouched.",'hidden narration');eq(pages[0].swipes[0].text,'Akeno waits.','alternate version');eq(pages[0].receipt,{original:'Aakeno'},'page receipt');eq(pages[0].voices[0].speaker,'Akeno','saved message voice');eq(pages[1].text,'I greet Akeno.','writer');
  eq((await db.stories.get(id)).brief,'Akeno knows Akane.','brief');eq((await db.settings.get('memory:'+id)).nodes[0].detail,'Akeno’s book.','memory');eq((await db.settings.get('lore:'+id))[0].name,'Akeno','lore');
  eq(session.turns.at(-1).proposals[0].verification,'verified','durable verification');
  const frozen=await db.editStoryAtomically(id,s=>JSON.stringify({...s,settings:{...s.settings,hk:null}}));
  answer=await request();const repeated=await hk.applyAllPending(answer.session,id);eq(repeated.satisfied,1,'idempotent');eq(await db.editStoryAtomically(id,s=>JSON.stringify({...s,settings:{...s.settings,hk:null}})),frozen,'repeat changes no content');
  assert(undoEntry(saved,saved.log.findIndex(e=>e.undo?.coordinated))?.refused,'ledger-only undo cannot split correction');
  const replay=withStoryWrites(state,saved,applyMutations);assert(replay.characters.Akeno && !replay.characters.Aakeno,'replay follows correction');
  const renamed=applyMutations(saved,[{type:'people.rename',from:'Akeno',to:'Akira',byHand:true}]).state;eq(renamed.spellingCorrections.Aakeno,'Akira','genuine rename keeps correction mapping current');assert(renamed.characters.Akira.aliases.includes('Akeno'),'genuine rename still keeps former name alias');
  const future=applyMutations(saved,[{type:'people.set',name:'Aakeno',field:'state',text:'Aakeno waits.'}]).state;assert(!future.characters.Aakeno && future.characters.Akeno.state==='Akeno waits.','later reader cannot recreate typo');
  await db.stories.update(id,{title:'An unrelated later title'});
  const memoryLater=await db.settings.get('memory:'+id);memoryLater.nodes.push({id:'later',span:[1,1],text:'Unrelated later record.'});await db.settings.set('memory:'+id,memoryLater);
  const undone=await hk.undoLatest(answer.session,id);assert(undone.ok,undone.words);
  saved=await loadState(id);assert(saved.characters.Aakeno && !saved.characters.Akeno,'undo identity');eq((await db.stories.get(id)).title,'An unrelated later title','undo preserves unrelated edit');eq((await db.messages.list(id))[0],before.messages[0],'undo versions');eq((await db.settings.get('memory:'+id)).nodes.at(-1).id,'later','undo preserves later record');
  const afterUndoReplay=withStoryWrites(state,saved,applyMutations);assert(afterUndoReplay.characters.Aakeno && !afterUndoReplay.characters.Akeno,'undo replay');
  // Atomic refusal, including two distinct existing identities.
  saved.characters.Akeno={core:'A different person'};await saveState(id,saved);
  answer=await request();const conflictBefore=await db.editStoryAtomically(id,s=>JSON.stringify(spliceHK(s)));
  const conflict=await hk.applyAllPending(answer.session,id);eq(conflict.rejected,1,'identity conflict refused');eq(await db.editStoryAtomically(id,s=>JSON.stringify(spliceHK(s))),conflictBefore,'conflict writes no content');
  // A deliberately aborted transaction must not write its queued story update.
  const title=(await db.stories.get(id)).title;
  try {await db.editStoryAtomically(id,s=>{s.story.title='BAD';throw Error('abort fixture');});} catch {}
  eq((await db.stories.get(id)).title,title,'real IDB abort');
  if (typeof IDBObjectStore !== 'undefined') {
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){if(this.name==='settings') throw new DOMException('fixture quota','QuotaExceededError');return put.apply(this,args);};
    try {await db.editStoryAtomically(id,s=>{s.story.title='BAD';s.settings.memory={nodes:[]};});} catch {} finally {IDBObjectStore.prototype.put=put;}
    eq((await db.stories.get(id)).title,title,'failure after queued write rolls back transaction');
  }
  // Mixed batch, saved counts and no false complete status.
  const mixed={id:'mixed',label:'Mixed',kind:'ledit',status:'pending',review:[],op:{mutations:[{type:'mode.set',flag:'combat',value:true},{type:'not.real'}]}};
  session=await hk.loadSession(id);session.turns.push({role:'housekeeper',text:'Done.',proposals:[mixed]});await hk.saveSession(id,session);
  let r=await hk.applyAllPending(session,id);eq(r.partial,1,'partial count');eq(mixed.status,'partial','partial card');assert(!r.complete && r.applied===0 && r.attempted===1,'attempt != success');assert(hk.proposalOutcome(session.turns.at(-1)).includes('PARTIALLY'),'truthful displayed result');
  const show={id:'show',label:'Show',kind:'edit',status:'pending',review:[],op:{messageId:'m730writer',hide:false}};session.turns.push({role:'housekeeper',text:'Show.',proposals:[show]});await hk.saveSession(id,session);r=await hk.applyAllPending(session,id);eq(show.status,'satisfied','already visible');eq(r.satisfied,1,'satisfied count');
  // AI withdrawal takes exact IDs and preserves applied work.
  const a={id:'refusal-a',label:'same label',status:'refused',words:'Still broken',kind:'unreadable',op:{}},b={...a,id:'refusal-b'},done={...a,id:'done',status:'applied'};
  session.turns.push({role:'housekeeper',text:'Warnings',proposals:[a,b,done]});await hk.saveSession(id,session);
  eq(hk.applySupersede(session,['incorrect label']).count,0,'wrong label is harmless');
  const dismissal=await hk.housekeeperTurn({storyId:id,writerText:'Dismiss the obsolete card.',call:async()=>({text:'<dismiss>[{"ids":["refusal-a"],"reason":"obsolete"}]</dismiss>'})});assert(dismissal.ok,dismissal.error);
  session=await hk.loadSession(id);eq(hk.findProposal(session,a.id).status,'dismissed','AI exact ID');eq(hk.findProposal(session,b.id).status,'refused','other card retained');eq(hk.findProposal(session,done.id).status,'applied','applied retained');eq(hk.findProposal(session,a.id).settlement.previousWords,'Still broken','reason retained');
  await db.settings.set('hkAutoApply',false);let manual=await request();assert(manual.ok,manual.error);eq(manual.proposals[0].status,'pending','manual waits');assert(hk.proposalOutcome(manual.session.turns.at(-1)).includes('pending'),'manual truthful');
  await db.settings.set('hkAutoApply',true);
  return {id,checks:'correction, preservation, versions, persistence, repeat, replay, reader, undo, conflict, atomic abort, partial, satisfied, AI IDs, manual mode'};
}
function spliceHK(s){return {...s,settings:{...s.settings,hk:null}};}
