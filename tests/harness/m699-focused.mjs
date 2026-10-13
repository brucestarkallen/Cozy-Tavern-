import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {auditLedger} from '../../js/agents/auditor.js';
import {auditSources,missingSourcePeople} from '../../js/agents/auditsources.js';
import {ledgerAuditVerified} from '../../js/agents/auditprogress.js';
import {scribeTurn} from '../../js/agents/scribe.js';

const {id}=await db.stories.create({title:'M699 actual report contract'});
const oldPage='Mara Vale is the second captain of the harbor, cautious and blunt. Her hair is copper red and her eyes are grey. Tarin is the dockmaster.';
const prose='Neri stopped at the iron gate. Mara Vale stood beside the pier. The attacker raised his blade, but neither of them moved.';
await db.messages.append(id,{role:'user',text:'Who runs the harbor?',ts:1});
await db.messages.append(id,{role:'assistant',text:oldPage,ts:2});
await db.messages.append(id,{role:'user',text:'I wait at the quay.',ts:3});
await db.messages.append(id,{role:'assistant',text:prose,ts:4});
const pages=await db.messages.list(id),documents=auditSources({messages:pages});
const identity=documents.find(d=>d.text===oldPage);
const cache=Object.fromEntries(documents.map(d=>[d.id,{mark:d.mark,people:d===identity?[{name:'Tarin',shown:'Tarin is the dockmaster.'}]:[]}]));
const initial={...emptyState(),sheet:{actors:{},playerName:'Neri'},place:{name:'the quay'},
 present:[{name:'Neri',position:'at the iron gate'},{name:'Mara Vale',position:'beside the pier'}],
 characters:{'Mara Vale':{core:'Either way Mara pockets a story.'},Tarin:{core:''}},
 relationships:{'Mara Vale':{p:60,r:50,s:0,history:[]}},
 threads:Array.from({length:145},(_,n)=>({title:'Crew errand '+n,owner:'Tarin',heat:'cold',next:'Awaiting the tide'})),
 auditSources:cache,audit:{coverage:{read:documents.length,total:documents.length},pending:[],unresolved:[],unfinished:false}};
// M719: a tracked person's missing core is requested only when the original reading
// carries identity facts for it; the quoted fact still never becomes the core by itself.
assert.deepEqual(missingSourcePeople(initial,[{name:'Tarin',shown:'Tarin is the dockmaster.',label:'old page',source:identity.id,
 identityFacts:[{text:'Dockmaster of the harbor',shown:'Tarin is the dockmaster.'}]}])[0].mutations,[],
 'A quotation must never be committed automatically as core.');
await saveState(id,initial);
const before=await loadState(id),oldFetch=globalThis.fetch;
let calls=0,scribe=false;
globalThis.fetch=async(_,opts)=>{
 const body=JSON.parse(opts.body),content=body.messages.map(m=>String(m.content)).join('\n');
 let reply;
 if(scribe) reply={deltas:[],facts:[{name:'Mara Vale',key:'eyes',value:'grey',shown:'Her hair is copper red and her eyes are grey.'},
   {name:'Mara Vale',key:'hair',value:'black',shown:oldPage}]};
 else {
  // M708: ONE combined review: discovery, repairs and the verdict for every required
  // entry together. M709: a whole-review verdict replaces per-entry certificates, and
  // M712: an equivalent scene read is scratchbook work (repair:false), not a rewrite.
  calls++;
  assert(content.includes('PEOPLE SOURCE INDEX'));
  const bank=JSON.parse(content.split('ORIGINAL SOURCE REFERENCES:\n')[1].split('\n')[0]);
  const past=bank.find(p=>p.text.includes('second captain'));
  const present=bank.find(p=>p.text.includes('Neri stopped'));
  assert(past&&present,'Earlier identity/appearance source is supplied proactively.');
  const rows=JSON.parse(content.split('REQUIRED CURRENT LEDGER CHECKS:\n')[1].split('\n')[0]);
  assert(rows.length>160,'The entire large ledger is checked together, not 32 at a time.');
  assert.equal(body.max_tokens,6000,'M709: the answer budget no longer grows with unchanged entries.');
  reply={scene:[{name:'Neri',repair:false,ending:{position:'standing at the iron gate',shown:'Neri stopped at the iron gate.'}}],issues:[
   {what:'Mara needs her established identity, not an event sentence.',evidenceId:past.evidenceId,mutations:[{type:'people.set',name:'Mara Vale',field:'core',text:'Second captain of the harbor; cautious and blunt.'}]},
   {what:'Her established hair is missing.',evidenceId:past.evidenceId,mutations:[{type:'canon.lock',name:'Mara Vale',key:'hair',value:'copper red'}]},
   {what:'Tarin needs his stable identity.',evidenceId:past.evidenceId,mutations:[{type:'people.set',name:'Tarin',field:'core',text:'Dockmaster of the harbor.'}]}],
   review:{status:'complete',why:'Current facts and completeness checked against both pages; valid judgments retained.',open:[]},standings:[]};
 }
 const text=JSON.stringify(reply);
 return new Response(body.stream?'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n':JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]}));
};
const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'m',preset:'custom',contextSize:64000};
try {
 const result=await auditLedger({storyId:id,connection});
 const final=await loadState(id);
 assert.deepEqual(result.pending,[]);assert.equal(calls,1);
 assert(ledgerAuditVerified(final,await db.stories.get(id),pages));
 assert.equal(final.characters['Mara Vale'].core,'Second captain of the harbor; cautious and blunt.');
 assert.equal(final.characters.Tarin.core,'Dockmaster of the harbor.');
 assert.equal(final.canon['Mara Vale'].facts.find(f=>f.key==='hair').value,'copper red');
 assert.equal(final.present[0].position,before.present[0].position,'Equivalent wording must not rewrite the entry.');
 assert.deepEqual(final.relationships,before.relationships);assert.deepEqual(await db.messages.list(id),pages);
 scribe=true;
 await scribeTurn({connection,storyId:id,userText:'I wait.',assistantText:prose});
 const kept=await loadState(id);
 assert.equal(kept.canon['Mara Vale'].facts.find(f=>f.key==='eyes').value,'grey','People can recover an original old-page physical fact without an event delta.');
 assert.equal(kept.canon['Mara Vale'].facts.find(f=>f.key==='hair').value,'copper red','Existing physical facts are preserved.');
 assert.deepEqual(kept.relationships,before.relationships);assert.deepEqual(await db.messages.list(id),pages);
 console.log('PASS one whole-review verdict; all 160+ entries together with a fixed answer budget; no cosmetic pose rewrite; original-source identity and physical recovery; no raw quote cores; People fills missing physical facts; prose and scores preserved. Controlled replies only.');
}finally{globalThis.fetch=oldFetch;}
