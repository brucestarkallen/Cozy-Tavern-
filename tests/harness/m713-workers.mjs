import './idb-shim.mjs';
import assert from 'node:assert/strict';
import { db } from '../../js/store.js';
import { emptyState, saveState, loadState } from '../../js/engine/state.js';
import { applyMutations } from '../../js/engine/apply.js';
import { extractTurn } from '../../js/agents/extractor.js';
import { scribeTurn } from '../../js/agents/scribe.js';
import { foundWorld } from '../../js/agents/founder.js';
import { worldTurn } from '../../js/agents/world.js';
import { auditSources } from '../../js/agents/auditsources.js';
import { serveFetch } from '../../js/agents/housekeeper.js';

// One causal milestone: actual worker requests and journaled writes, WITHOUT
// calling the auditor. Quotes may be in writer input or folded original pages.
const connection = {type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000};
const biography = 'Neri is a wandering cartographer who grew up beside the northern sea.';
const oldQuote = 'Queen Elin is the sovereign of the northern realm, stern and patient, with violet hair.';
const introduction = 'The third princess is the younger royal sister, with copper hair and green eyes.';
const pose = 'You settle onto both knees next to the sealed gate.';
const userText = introduction + '\n' + pose;
const prose = 'Rook watches from the yard. You remain beside the gate.';
const core = 'Sovereign of the northern realm; stern and patient.';
const {id} = await db.stories.create({title:'Worker source coverage',brief:biography});
await db.messages.append(id,{role:'user',text:oldQuote,ts:1});
await db.messages.append(id,{role:'user',text:userText,ts:2});
await db.messages.append(id,{role:'assistant',text:prose,ts:3});
const pages = await db.messages.list(id), docs = auditSources({brief:biography,messages:pages});
const old = docs.find(d => d.text === oldQuote);
const present = [{name:'Neri',position:'at the starting line'}, {name:'Rook',position:'in the yard'}];
const characters = {Neri:{core:'',state:'',threads:[]},Elin:{core:'Watches a bout.',arc:'Respects discipline.',threads:[]},Rook:{core:'A sword instructor.',state:'',threads:[]}};
const offscreen = {};
for(let i=0;i<100;i++) { const name='Citizen '+i; characters[name]={core:'Resident '+i,arc:'Keeps a private worry '+i,threads:[]}; offscreen[name]={location:'district '+i,activity:'working',stance:'busy',sinceMinutes:0,checkedMinutes:10}; }
let base = {...emptyState(),sheet:{actors:{},playerName:'Neri'},place:{name:'the yard'},clock:{minutes:10},present,characters,offscreen,
  relationships:{Elin:{p:60,r:50,s:0,history:[{cause:'Earned trust in the rescue.'}]}},
  auditSources:{[old.id]:{mark:old.mark,appearanceReviewed:true,profileReviewed:1,people:[{name:'Elin',shown:oldQuote,
    identityFacts:[{text:core,shown:oldQuote}],facts:[{key:'hair',value:'violet',shown:oldQuote}]}]}}};
base = applyMutations(base,[{type:'canon.lock',name:'Elin',key:'eyes',value:'grey',byHand:true}]).state;
await saveState(id,base);
const initial = await loadState(id), standings = structuredClone(initial.relationships);
const originalFetch = globalThis.fetch;
let calls=0;
globalThis.fetch=async(_,options)=>{
  calls++;
  const body=JSON.parse(options.body), text=body.messages.map(m=>String(m.content)).join('\n');
  let reply;
  if(text.includes('You read a writer\'s brief for the standings')) reply=[];
  else if(text.includes('You found the ledger for a story')) reply={mutations:[
    {type:'people.set',name:'Neri',field:'core',text:'Wandering cartographer; grew up beside the northern sea.',shown:biography},
    {type:'rel.set',name:'Elin',p:5,r:5,cause:'the brief describes a bond with Neri'}]};
  else if(text.includes('For each here entry use {name, earlier, ending:')) {
    reply={mutations:[{type:'mode.snapshot',flags:[]}],people:[{name:'the third princess',core:'The younger royal sister.',shown:introduction}],
      here:[{name:'Neri',ending:{position:'kneeling beside the locked gate',shown:pose}},{name:'Rook'}],
      looks:[{name:'the third princess',key:'hair',value:'copper',shown:introduction},{name:'the third princess',key:'eyes',value:'green',shown:introduction}]};
  } else if(text.includes('EVERYONE WRITTEN ELSEWHERE')) {
    assert(text.includes('Citizen 99') && text.includes('district 99'),'World reads the 100th actual seat.');
    assert(text.includes('Keeps a private worry 99'),'World receives the established arc.');
    reply={mutations:[{type:'offscreen.set',name:'the third princess',location:'royal apartments',activity:'resting',stance:'waiting',cause:'Her established royal home.'},
      {type:'offscreen.set',name:'Elin',location:'royal chambers',activity:'reading reports',stance:'busy',cause:'The sovereign continues her established duties.'}],brief:null};
  } else {
    assert(text.includes(oldQuote) && text.includes(core),'People receives original profile facts from the existing source scratchbook.');
    assert(text.includes('Citizen 99'),'People can see more than the storyteller card limit.');
    reply={deltas:[{name:'Elin',field:'core',text:core,shown:oldQuote}],facts:[
      {name:'Elin',key:'hair',value:'violet',shown:oldQuote},{name:'Elin',key:'eyes',value:'green',shown:oldQuote}]};
  }
  const content=JSON.stringify(reply);
  return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));
};
try {
  await foundWorld({connection,storyId:id,brief:biography});
  const founded = await loadState(id);
  assert(founded.characters.Neri.core.includes('cartographer'));
  assert.equal(founded.characters.Neri.coreOrigin.kind,'writer');
  const extracted=await extractTurn({connection,state:founded,storyId:id,userText,assistantText:prose,moodOwed:false});
  await saveState(id,applyMutations(founded,extracted.mutations).state);
  await worldTurn({connection,storyId:id,userText,assistantText:prose,brief:biography});
  await scribeTurn({connection,storyId:id,userText,assistantText:prose,brief:biography,pages:[],record:'Earlier pages are folded.'});
  const final=await loadState(id);
  assert.equal(calls,5,'Existing founding + digits calls and one call each for Scene, World, People; no auditor or new verification call.');
  assert.equal(final.present.find(p=>p.name==='Neri').position,'kneeling beside the locked gate');
  assert.equal(final.characters.Elin.core,core);
  assert.equal(final.canon.Elin.facts.find(f=>f.key==='hair').value,'violet');
  assert.equal(final.canon.Elin.facts.find(f=>f.key==='eyes').value,'grey');
  assert.equal(final.canon['the third princess'].facts.length,2,'New identity and looks land together.');
  assert.deepEqual(final.relationships,standings);
  assert(final.journal.some(j=>j.m?.source==='scribe' && j.m?.shown===oldQuote));
  assert.deepEqual(await db.messages.list(id),pages);
  const ambiguity={characters:{'Alen North':{core:'Northern sailor.'},'Alen South':{core:'Southern doctor.'}}};
  assert(serveFetch(['person: Alen'],[],{state:ambiguity}).includes('No page'),'Lookup never guesses between two shared first names.');
  assert(serveFetch(['person: Alen South'],[],{state:ambiguity}).includes('Southern doctor'));
  let crowded={...final,characters:{...final.characters,Rook:{...final.characters.Rook,threads:Array.from({length:45},(_,i)=>'Unanswered promise '+i)}},
    threads:Array.from({length:45},(_,i)=>({title:'Unfinished obligation '+i,heat:'cold'})),
    knowledge:{Rook:Array.from({length:65},(_,i)=>({fact:'Private source fact '+i,atTurn:i}))}};
  crowded=applyMutations(crowded,[{type:'people.note',name:'Rook',field:'thread',text:'Bring the compass back'},
    {type:'thread.set',title:'Return the map to the archive'},{type:'knowledge.add',name:'Rook',fact:'The hidden archive is under the harbour.'}]).state;
  await saveState(id,crowded);
  const reloaded=await loadState(id);
  assert.equal(reloaded.characters.Rook.threads.length,46);
  assert.equal(reloaded.threads.length,46);
  assert.equal(reloaded.knowledge.Rook.length,66);
  console.log('PASS: pre-auditor workers retain writer biography, folded profile evidence, new role identities/appearance, writer ending pose, 100 seats and arcs; manual facts, earned scores, prose and unresolved/learned records survive. Five existing mocked calls, no auditor.');
} finally {globalThis.fetch=originalFetch;}
