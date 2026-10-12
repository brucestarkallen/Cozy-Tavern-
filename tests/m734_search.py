#!/usr/bin/env python3
"""M734: explicit multiple-folder search and nondestructive giant archive."""
import ast,functools,threading,os
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=Path('/tmp/cozy-m734');OUT.mkdir(exist_ok=True)
SEED=next(n.value.value for n in ast.parse((ROOT/'tests/paint_coats.py').read_text()).body if isinstance(n,ast.Assign) and getattr(n.targets[0],'id','')=='SEED')
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)));threading.Thread(target=s.serve_forever,daemon=True).start()
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),args=['--no-sandbox']);c=b.new_context(service_workers='block',viewport={'width':1100,'height':850});p=c.new_page();p.route('https://**/*',lambda r:r.abort());p.goto(f'http://127.0.0.1:{s.server_port}/');p.wait_for_function('!!window.__cozy?.chat')
  if p.locator('#welcome-overlay').is_visible():p.locator('#btn-welcome-enough').click()
  ids=p.evaluate(r'''async()=>{
   const {db}=await import('/js/store.js');
   const g=await db.giants.create({name:'Library'}),g2=await db.giants.create({name:'Chronicles'});
   const a=await db.projects.create({name:'Castle'}),d=await db.projects.create({name:'Garden'}),e=await db.projects.create({name:'Harbor'});
   await db.projects.update(a.id,{giantId:g.id});await db.projects.update(e.id,{giantId:g2.id,archived:true});
   const stories=[];
   for(const [i,folder] of [a,d,e,null].entries()){
    const st=await db.stories.create({title:['Old castle','New garden','Archived harbor','Loose tale'][i]});
    await db.stories.update(st.id,{projectId:folder?.id||null});
    const m1=await db.messages.append(st.id,{role:'assistant',text:'First lantern beside the doorway.'});
    const m2=await db.messages.append(st.id,{role:'assistant',text:'Newest lantern beside the window.'});
    await db.stories.update(st.id,{updatedAt:100+i});stories.push({id:st.id,hit:m2.id});
   }
   await db.settings.set('shelfCollapsed',{[a.id]:true,[e.id]:true,['giant:'+g.id]:true});
   await window.__cozy.chat.refreshStories(true);
   return {g:g.id,g2:g2.id,a:a.id,d:d.id,e:e.id,stories};
  }''')
  p.locator('#story-search').fill('lantern');p.locator('#story-search').press('Enter')
  p.wait_for_function("document.querySelectorAll('.search-tale').length===4")
  assert p.locator('.search-tale-title').all_text_contents()==['Loose tale','Archived harbor','New garden','Old castle']
  assert 'Newest' in p.locator('.search-hit-row').first.inner_text()
  p.locator('#search-scope').select_option('selected')
  p.wait_for_function("document.querySelector('#search-results').textContent.includes('Choose one')")
  for value in ['giant:'+ids['g'],'project:'+ids['d']]:p.locator(f'#search-folder-options input[value="{value}"]').check()
  p.wait_for_function("document.querySelectorAll('.search-tale').length===2")
  assert p.locator('.search-tale-title').all_text_contents()==['New garden','Old castle']
  p.locator(f'#search-folder-options input[value="giant:{ids["g2"]}"]').check()
  p.wait_for_function("document.querySelectorAll('.search-tale').length===3")
  p.locator('.search-hit-row').first.click()
  p.wait_for_function('(id)=>window.__cozy.getActiveStoryId()===id',arg=ids['stories'][2]['id'])
  p.wait_for_function('(id)=>!!document.querySelector(`[data-id="${id}"]`)',arg=ids['stories'][2]['hit'])
  p.locator('#story-search').fill('');p.locator('#story-search').press('Escape')
  before=p.evaluate("async()=>{const {db}=await import('/js/store.js');return {projects:await db.projects.list(),messages:await Promise.all((await db.stories.list()).map(s=>db.messages.list(s.id)))} }")
  p.get_by_role('button',name='Archive large project "Library"',exact=True).click()
  p.wait_for_function("document.querySelector('#story-list').textContent.includes('Archived large projects')")
  assert not p.get_by_role('button',name='Restore large project "Library"',exact=True).is_visible()
  p.reload();p.wait_for_function('!!window.__cozy?.chat');p.wait_for_function("document.querySelector('#story-list').textContent.includes('Archived large projects')")
  p.locator('#story-list summary').filter(has_text='Archived large projects').click()
  p.get_by_role('button',name='Restore large project "Library"',exact=True).click()
  p.wait_for_function("!document.querySelector('#story-list').textContent.includes('Archived large projects')")
  after=p.evaluate("async()=>{const {db}=await import('/js/store.js');return {projects:await db.projects.list(),messages:await Promise.all((await db.stories.list()).map(s=>db.messages.list(s.id)))} }")
  assert before==after
  p.set_viewport_size({'width':390,'height':844})
  p.evaluate("document.querySelector('#story-panel').classList.add('open')")
  assert p.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  print('PASS all folded/archived stories, newest ordering, combined multiple giant/project scopes, hit opens saved page, archive persists/reloads/restores with exact child folders and prose retained.')
  b.close()
finally:s.shutdown()
