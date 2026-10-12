/* Focused actual IndexedDB and DOM checks. No provider requests. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const root=resolve(new URL('..',import.meta.url).pathname);
const server=createServer(async(req,res)=>{
  try {
    const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname).replace(/\/$/,'/index.html'));
    if(!path.startsWith(root+'/')) throw Error('outside root');
    res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch {res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({serviceWorkers:'block'});
  await page.route('https://**/*',r=>r.abort());
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.waitForFunction(()=>!!window.__cozy?.chat);
  const until = async (predicate,arg) => {
    const deadline=Date.now()+15000;
    while (!await page.evaluate(predicate,arg)) {
      if(Date.now()>deadline) throw Error('Timed out waiting for a persisted UI result.');
      await new Promise(r=>setTimeout(r,30));
    }
  };
  const result=await page.evaluate(async()=>await(await import('/tests/harness/m730-browser.mjs')).run());
  console.log(result);
  if (await page.locator('#welcome-overlay').isVisible()) await page.locator('#btn-welcome-enough').click();
  const sid=await page.evaluate(async()=>{
    const {db}=await import('/js/store.js'),hk=await import('/js/agents/housekeeper.js');
    const story=await db.stories.create({title:'Dismissal controls'});
    await db.settings.set('engineOn',false);
    const cards=['one','two'].map(id=>({id,label:id,kind:'unreadable',status:'refused',words:'Unresolved original problem',op:{}}));
    cards.push({id:'applied',label:'Applied change',kind:'brief',status:'applied',words:'Applied earlier',op:{}});
    await hk.saveSession(story.id,{id:1,name:'Session 1',turns:[{role:'housekeeper',text:'Original refusal',proposals:cards}],batches:[]});
    window.__cozy.setActiveStoryId(story.id);await window.__cozy.housekeeper.open();return story.id;
  });
  await page.locator('#hk-cards [data-proposal-id="one"] button', {hasText:'Dismiss'}).click();
  await page.waitForFunction(()=>!document.querySelector('#hk-cards [data-proposal-id="one"]'));
  if(!await page.locator('#hk-dismiss-all').isVisible()) throw Error('Dismiss all hidden for refused-only panel');
  await page.locator('#hk-dismiss-all').click();
  await page.waitForFunction(()=>document.querySelector('#hk-cards').hidden);
  await page.evaluate(async sid=>{
    const hk=await import('/js/agents/housekeeper.js');
    let s=await hk.loadSession(sid);
    if(hk.findProposal(s,'one').status!=='dismissed'||hk.findProposal(s,'two').status!=='dismissed'||hk.findProposal(s,'applied').status!=='applied') throw Error('Dismissal persistence');
    await hk.newSession(sid,'Other');await hk.switchSession(sid,1);
    window.__cozy.housekeeper.close();await window.__cozy.housekeeper.open();
  },sid);
  if(!await page.locator('#hk-cards').isHidden()) throw Error('Dismissals reappeared after switching session');
  await page.reload();await page.waitForFunction(()=>!!window.__cozy?.housekeeper);
  await page.evaluate(()=>window.__cozy.housekeeper.open());
  if(!await page.locator('#hk-cards').isHidden()) throw Error('Dismissals reappeared after reload');
  console.log('PASS: individual dismissal, refused-only Dismiss all, applied preservation, session switching and real reload');
  // Drive the actual UI application setting through a locally mocked provider.
  let calls=0;
  await page.route('https://m730.invalid/**',async route=>{
    if(route.request().method()==='OPTIONS') {await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST, OPTIONS'}});return;}
    if(route.request().method()==='GET') {await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[{id:'fixture'}]})});return;}
    calls++;
    const text='Fixed everywhere. <corrections>[{"type":"name.spelling","from":"Aakeno","to":"Akeno","scope":"story","reason":"writer request"}]</corrections>';
    await route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n'});
  });
  const autoId=await page.evaluate(async()=>{
    const {db}=await import('/js/store.js');const {emptyState,saveState}=await import('/js/engine/state.js');
    const c=await db.connections.add({name:'Fixture',type:'openai',baseUrl:'https://m730.invalid/v1',apiKey:'fixture-only',model:'fixture'});
    await db.settings.set('activeConnectionId',c.id);await db.settings.set('workerConnectionId',c.id);await db.settings.set('hkAutoApply',true);
    const st=await db.stories.create({title:'Automatic spelling'});await db.stories.update(st.id,{brief:'Aakeno is here.'});
    await saveState(st.id,{...emptyState(),characters:{Aakeno:{core:'Aakeno studies.'}}});
    window.__cozy.housekeeper.close();window.__cozy.setActiveStoryId(st.id);await window.__cozy.housekeeper.open();return st.id;
  });
  await page.locator('#hk-input').fill('Change Aakeno to Akeno everywhere.');
  await page.locator('#hk-send').click();
  await until(async id=>{
    const hk=await import('/js/agents/housekeeper.js');const s=await hk.loadSession(id);return s.turns.at(-1)?.proposals?.[0]?.verification==='verified';
  },autoId);
  await page.waitForFunction(()=>!document.querySelector('#hk-send').disabled);
  if(calls!==1) throw Error('Automatic correction used '+calls+' calls; ' + JSON.stringify(await page.evaluate(async id=>({active:window.__cozy.getActiveStoryId(),id,session:await(await import('/js/agents/housekeeper.js')).loadSession(id)}),autoId)));
  if(!(await page.locator('#hk-thread').innerText()).includes('Checked the saved result')) throw Error('Verified outcome missing');
  console.log('PASS: automatic UI application, verified persisted result, one provider call');
  await page.reload();await page.waitForFunction(()=>!!window.__cozy?.housekeeper);
  await page.evaluate(async id=>{
    const {loadState}=await import('/js/engine/state.js');const hk=await import('/js/agents/housekeeper.js');
    const s=await loadState(id),session=await hk.loadSession(id);
    if(!s.characters.Akeno || s.characters.Aakeno || session.turns.at(-1).proposals[0].verification!=='verified') throw Error('Correction lost after reload');
    window.__cozy.setActiveStoryId(id);await window.__cozy.housekeeper.open();
  },autoId);
  // A repeated request is satisfied locally, with no clarification call.
  await page.locator('#hk-input').fill('Change Aakeno to Akeno everywhere.');await page.locator('#hk-send').click();
  await until(async id=>(await(await import('/js/agents/housekeeper.js')).loadSession(id)).turns.at(-1)?.proposals?.[0]?.status==='satisfied',autoId);
  await page.waitForFunction(()=>!document.querySelector('#hk-send').disabled);
  if(calls!==2) throw Error('Already satisfied correction requested another model call');
  const manualId=await page.evaluate(async()=>{
    const {db}=await import('/js/store.js');const {emptyState,saveState}=await import('/js/engine/state.js');
    await db.settings.set('hkAutoApply',false);const st=await db.stories.create({title:'Manual spelling'});
    await saveState(st.id,{...emptyState(),characters:{Aakeno:{core:'Aakeno studies.'}}});
    window.__cozy.housekeeper.close();window.__cozy.setActiveStoryId(st.id);await window.__cozy.housekeeper.open();return st.id;
  });
  await page.locator('#hk-input').fill('Change Aakeno to Akeno everywhere.');await page.locator('#hk-send').click();
  await until(async id=>(await(await import('/js/agents/housekeeper.js')).loadSession(id)).turns.at(-1)?.proposals?.[0]?.status==='pending',manualId);
  await page.waitForFunction(()=>!document.querySelector('#hk-send').disabled);
  await page.evaluate(async id=>{const s=await(await import('/js/engine/state.js')).loadState(id);if(!s.characters.Aakeno||s.characters.Akeno) throw Error('Manual mode applied without approval');},manualId);
  if(!(await page.locator('#hk-thread').innerText()).includes('pending application')) throw Error('Manual pending outcome missing');
  await page.locator('#hk-cards').getByRole('button',{name:'Apply',exact:true}).click();
  await until(async id=>(await(await import('/js/agents/housekeeper.js')).loadSession(id)).turns.at(-1)?.proposals?.[0]?.verification==='verified',manualId);
  if(calls!==3) throw Error('Manual application used extra calls');
  console.log('PASS: correction reload, already satisfied UI request, manual approval and one call per request');
} finally {await browser?.close();server.close();}
