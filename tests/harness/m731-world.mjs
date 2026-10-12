import './idb-shim.mjs';
import assert from 'node:assert/strict';
import {db} from '../../js/store.js';
import {emptyState,saveState,loadState} from '../../js/engine/state.js';
import {worldTurn} from '../../js/agents/world.js';
import {auditSources,missingSourcePeople} from '../../js/agents/auditsources.js';
import {normalizeVoices} from '../../js/engine/world.js';
const connection={type:'openai',baseUrl:'https://fixture.example/v1',apiKey:'fixture',model:'fixture',preset:'custom',contextSize:200000};
const story=await db.stories.create({title:'World identity provenance'});
const page=await db.messages.append(story.id,{role:'assistant',text:'The courtyard is empty.'});
await saveState(story.id,{...emptyState(),sheet:{playerName:'Keir',actors:{}}});
const voices=[{speaker:'Tarn',channel:'the gate',content:'I will take the next watch.',identity:{scope:'tracked',to:'Tarn',create:true,why:'A new continuing guard named Tarn.'}},{speaker:'a scullery girl',channel:'the kitchen',content:'The pot is clean.',identity:{scope:'local',why:'A distinct temporary speaker with no continuing identity established.'}}];
let calls=0,omit=true;const originalFetch=globalThis.fetch;
globalThis.fetch=async(_,options)=>{
 calls++;const request=JSON.stringify(JSON.parse(options.body).messages);
 if(calls===2) assert(request.includes('Supply the speaker identity scope'));
 const brief={pressure:[],ripe:[],twb:null,voices:omit && calls===1?voices.map(({identity,...v})=>v):voices};
 const reply={mutations:[],brief};
 return new Response('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(reply)}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
};
try {
 const result=await worldTurn({connection,storyId:story.id,assistantText:page.text,story,pageAt:0});
 assert.equal(calls,2);const saved=await loadState(story.id);assert(saved.characters.Tarn);assert.equal(saved.characters.Tarn.core,'');assert.equal(saved.characters['a scullery girl'],undefined);assert.deepEqual(saved.present,[]);
 assert.deepEqual(result.brief.voices,normalizeVoices(voices));assert(saved.journal.some(j=>j.m.name==='Tarn' && j.m.shown.includes('I will take')));
 // Same persistence used by the existing UI; re-open from IndexedDB and inventory.
 await db.messages.update(story.id,page.id,{voices:result.brief.voices});
 const pages=await db.messages.list(story.id),docs=auditSources({messages:pages});
 assert.equal(docs.find(d=>d.id.startsWith('voice:')).speakerIdentity.to,'Tarn');
 assert.equal(docs.at(-1).speakerIdentity.scope,'local');assert.equal(pages[0].text,page.text);
 omit=false;voices[0].identity.create=false;
 const again=await worldTurn({connection,storyId:story.id,assistantText:page.text,story,pageAt:0});
 assert.deepEqual(missingSourcePeople(await loadState(story.id),[{name:'Tarn',kind:'person',source:'later-voice',shown:voices[0].content,identityFacts:[],facts:[]}]),[]);
 assert.equal(calls,3);assert.equal(again.applied.filter(a=>a.mutation.type==='people.set').length,0);assert.deepEqual(Object.keys((await loadState(story.id)).characters),['Tarn']);
 console.log('PASS M731 World: existing bounded clarification, minimal continuing identity, literal provenance, distinct local speaker, normalization and message persistence, no duplicate profile or scene arrival.');
} finally {globalThis.fetch=originalFetch;}
