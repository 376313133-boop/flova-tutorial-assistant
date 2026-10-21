// Actual tabCapture/IndexedDB/MediaRecorder integration on two isolated synthetic tabs.
// No user Chrome profile, login state or real Flova project is opened.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULES?path.join(process.env.PLAYWRIGHT_MODULES,'playwright'):'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'flova-recorder-test-'));
const extension=path.join(temp,'extension');await fs.cp(path.join(root,'recorder'),extension,{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));
delete manifest.action.default_popup;
manifest.background.service_worker='test-worker.js';
await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
await fs.writeFile(path.join(extension,'test-worker.js'),`import {handle} from './background.js';globalThis.testHandle=handle;globalThis.testStarts=[];chrome.action.onClicked.addListener(async()=>{try{globalThis.testStarts.push(await handle({target:'controls',action:'start',idleMs:4000,audio:false},{}));}catch(error){globalThis.testStarts.push({error:error.message});}});`);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const context=await chromium.launchPersistentContext(path.join(temp,'profile'),{
  executablePath:process.env.CHROMIUM_BIN,
  ignoreDefaultArgs:['--disable-extensions'],
  headless:false,acceptDownloads:true,viewport:{width:800,height:600},
  args:['--enable-unsafe-extension-debugging']
});
let report;
try {
  await context.route('https://flova.tv/**',route=>{
    const key=new URL(route.request().url()).searchParams.get('id');
    return route.fulfill({contentType:'text/html',body:`<!doctype html><html><style>body{margin:0;background:${key==='A'?'#b82332':'#153fa5'};color:white;font:36px sans-serif}canvas{position:absolute;left:100px;top:150px}</style><h1>PROJECT ${key} — SYNTHETIC TEST</h1><button>Test operation</button><canvas width=400 height=200></canvas><script>let t=0;const c=document.querySelector('canvas').getContext('2d');setInterval(()=>{c.clearRect(0,0,400,200);c.fillStyle='white';c.fillRect((t++*5)%360,40,40,80)},33)</script></html>`});
  });
  const browser=context.browser(),cdp=await browser.newBrowserCDPSession();
  let loaded=(await cdp.send('Extensions.getExtensions')).extensions.find(e=>e.path===extension);
  if(!loaded)loaded=await cdp.send('Extensions.loadUnpacked',{path:extension});
  const bootstrap=await context.newPage();await bootstrap.goto(`chrome-extension://${loaded.id}/popup.html`);
  let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  const call=(action,extra={})=>worker.evaluate(({action,extra})=>globalThis.testHandle({target:'controls',action,...extra},{}),{action,extra});
  async function start(key){
    const page=await context.newPage();await page.goto(`https://flova.tv/zh-CN/project/?id=${key}`);await page.bringToFront();
    const {targetInfos}=await cdp.send('Target.getTargets',{filter:[{type:'tab'},{exclude:true}]});
    const targetInfo=targetInfos.find(t=>t.url===page.url());assert.ok(targetInfo,'No tab target for capture test');
    const before=await worker.evaluate(()=>globalThis.testStarts.length);
    await cdp.send('Extensions.triggerAction',{id,targetId:targetInfo.targetId});
    for(let tries=0;tries<100&&await worker.evaluate(()=>globalThis.testStarts.length)<=before;tries++)await delay(100);
    const result=await worker.evaluate(()=>globalThis.testStarts.at(-1));assert.ok(!result.error,result.error);
    return {page,meta:result};
  }
  const a=await start('A');await delay(650);const b=await start('B');await delay(700);
  let list=await call('list');assert.equal(list.filter(s=>s.state==='recording').length,2);
  await call('pause',{id:a.meta.id});
  await a.page.evaluate(()=>window.postMessage({type:'FLOVA_TUTORIAL_CAPTURE',action:'resume'},location.origin));await delay(350);
  list=await call('list');assert.equal(list.find(s=>s.id===a.meta.id).state,'paused');assert.equal(list.find(s=>s.id===b.meta.id).state,'recording');
  await call('resume',{id:a.meta.id});await delay(650);
  await b.page.evaluate(()=>window.postMessage({type:'FLOVA_TUTORIAL_CAPTURE',action:'hold',seconds:10},location.origin));
  await delay(4500);list=await call('list');
  assert.equal(list.find(s=>s.id===a.meta.id).state,'paused');assert.ok(list.find(s=>s.id===a.meta.id).pauseReasons.includes('idle'));
  assert.equal(list.find(s=>s.id===b.meta.id).state,'recording');
  await call('resume',{id:a.meta.id});await delay(600);
  await call('stop',{id:a.meta.id});await call('stop',{id:b.meta.id});
  list=await call('list');assert.ok(list.every(s=>s.state==='stopped'));
  const exported=await call('export',{id:a.meta.id});assert.equal(exported.files,list.find(s=>s.id===a.meta.id).takes.length+1);
  for(let i=0;i<100;i++){
    const downloads=await worker.evaluate(()=>chrome.downloads.search({limit:20}));
    if(downloads.length>=exported.files&&downloads.every(d=>d.state==='complete'))break;
    await delay(100);
  }
  const downloads=await worker.evaluate(()=>chrome.downloads.search({limit:20}));
  assert.equal(downloads.length,exported.files);assert.ok(downloads.every(d=>d.state==='complete'));
  // Read the actual recorded blobs from the same extension origin, then normalize them.
  const reader=await context.newPage();
  await reader.goto(`chrome-extension://${id}/popup.html`);
  const saved=[];
  for(const meta of list){
    const folder=path.join(temp,meta.project);await fs.mkdir(folder);
    const files=await reader.evaluate(async(meta)=>{
      const {RecordingStore}=await import('./store.js');const store=new RecordingStore();const result=[];
      for(const take of meta.takes){const blobs=await store.chunks(meta.id,take.index);const data=new Uint8Array(await new Blob(blobs).arrayBuffer());let binary='';for(const byte of data)binary+=String.fromCharCode(byte);result.push({name:take.filename,base64:btoa(binary)});}
      return result;
    },meta);
    for(const file of files)await fs.writeFile(path.join(folder,file.name),Buffer.from(file.base64,'base64'));
    await fs.writeFile(path.join(folder,'recording.json'),JSON.stringify({...meta,format:'flova-tab-recording-v1'}));
    const normalized=spawnSync(process.env.PYTHON_BIN||'python3',[path.join(root,'scripts/recording_import.py'),'--manifest',path.join(folder,'recording.json'),'--out',path.join(folder,'normalized')],{encoding:'utf8'});
    assert.equal(normalized.status,0,normalized.stderr);const result=JSON.parse(normalized.stdout);
    assert.equal(result.clips.length,meta.takes.length);assert.ok(result.clips.every(c=>c.duration>0));
    assert.ok(result.clips.every(c=>c.width===800&&c.height===600),'Capture aspect ratio does not match the actual page viewport');
    const pixel=spawnSync(process.env.FFMPEG_BIN||'ffmpeg',['-v','error','-i',path.join(folder,'normalized/segment-001.mp4'),'-vf','crop=2:2:20:500,scale=1:1,format=rgb24','-frames:v','1','-f','rawvideo','-']);
    assert.equal(pixel.status,0);const [red,,blue]=pixel.stdout;
    assert.ok(meta.project==='A'?red>blue*2:blue>red*2,'Captured content came from the wrong project or includes padding');
    saved.push({project:meta.project,takes:meta.takes.length,recordedMs:meta.recordedMs,normalizedSeconds:result.clips.reduce((sum,c)=>sum+c.duration,0)});
  }
  const durations=saved.find(s=>s.project==='A');assert.ok(durations.takes>=3);assert.ok(durations.normalizedSeconds<7,'Paused wait leaked into encoded take duration');
  // A closed offscreen document must not hide already-written, interrupted data.
  const c=await start('C');await delay(1400);await worker.evaluate(()=>chrome.offscreen.closeDocument());
  const recovered=await call('list');const interrupted=recovered.find(s=>s.id===c.meta.id);
  assert.equal(interrupted.state,'interrupted');assert.equal(interrupted.takes.length,1);
  const recoveryExport=await call('export',{id:c.meta.id});assert.equal(recoveryExport.files,2);
  report={concurrent_real_tab_capture:true,manual_pause_isolation:true,user_pause_precedence:true,idle_pause:true,hold_preserves_other_project:true,standalone_webm_and_mp4:true,actual_download_export:true,interrupted_chunk_recovery:true,viewport_and_source_pixel_checks:true,saved,temp};
  await fs.writeFile(path.join(temp,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await context.close();}
