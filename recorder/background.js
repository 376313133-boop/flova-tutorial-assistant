let creating;
const validURL=url=>{try{const u=new URL(url);return u.protocol==='https:'&&/(^|\.)flova\.(tv|ai)$/.test(u.hostname);}catch{return false;}};
function projectKey(url){const u=new URL(url);return (u.searchParams.get('id')||u.pathname.split('/').filter(Boolean).join('-')||'flova').replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,80);}
async function offscreen() {
  const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
  if(contexts.length)return;
  if(!creating)creating=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['USER_MEDIA','BLOBS'],justification:'Independent, local recordings of user-selected Flova tabs'}).finally(()=>{creating=null;});
  await creating;
}
async function request(message) {
  await offscreen();const result=await chrome.runtime.sendMessage({...message,target:'offscreen'});
  if(!result?.ok)throw Error(result?.error||'录制进程没有响应');return result.data;
}
async function badge(meta) {
  const text=meta.state==='recording'?'REC':meta.state==='paused'?'Ⅱ':'';
  await chrome.action.setBadgeText({tabId:meta.tabId,text}).catch(()=>{});
  await chrome.action.setBadgeBackgroundColor({tabId:meta.tabId,color:meta.state==='recording'?'#ce4b4b':'#59646b'}).catch(()=>{});
}
async function active() {const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id)throw Error('请先选择项目标签页');return tab;}
async function currentSession(tabId) {return (await request({action:'list'})).find(s=>s.tabId===tabId&&!['stopped','interrupted'].includes(s.state));}
async function inject(tabId) {await chrome.scripting.executeScript({target:{tabId},files:['content.js']});}
export async function handle(m,sender) {
  if(m.target==='badge'){await badge(m.meta);return true;}
  if(m.target==='content') {
    if(!sender.tab||!validURL(sender.url))throw Error('无效录制页面');
    const s=await currentSession(sender.tab.id);if(!s)return null;
    if(!['activity','pause','resume','hold','mark'].includes(m.action))throw Error('页面不能启动、停止或导出录制');
    const reason=m.action==='activity'?'input':m.action==='pause'&&m.value==='viewport-changed'?'viewport-changed':'agent';
    return request({action:m.action,id:s.id,reason,value:m.value});
  }
  if(m.target!=='controls')return;
  if(m.action==='start') {
    const tab=await active();if(!validURL(tab.url))throw Error('请在需要录制的 Flova 页面点击扩展');
    if(await currentSession(tab.id))throw Error('当前标签页已在录制列表中');
    const [{result:viewport}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})});
    const scale=Math.min(viewport.dpr||1,2,3840/Math.max(viewport.width,viewport.height));
    const capture={cssWidth:viewport.width,cssHeight:viewport.height,width:Math.round(viewport.width*scale),height:Math.round(viewport.height*scale)};
    const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});
    const result=await request({action:'start',streamId,tabId:tab.id,project:projectKey(tab.url),capture,audio:!!m.audio,idleMs:Math.max(4000,Math.min(120000,Number(m.idleMs)||10000))});
    try{await inject(tab.id);}catch(error){await request({action:'stop',id:result.id,reason:'injection-failed'});throw error;}
    return result;
  }
  if(m.action==='resume') {
    const s=(await request({action:'list'})).find(s=>s.id===m.id);if(!s)throw Error('会话不存在');
    if(s.pauseReasons?.includes('viewport-changed'))throw Error('页面尺寸已改变，请停止并重新开始录制以保持正确画幅');
    const tab=await chrome.tabs.get(s.tabId);
    if(!validURL(tab.url)||projectKey(tab.url)!==s.project)throw Error('页面已切换项目，请停止该会话并重新启动');
    await inject(tab.id);
    for(const reason of ['navigation','agent','user'])await request({action:'resume',id:m.id,reason});
    return true;
  }
  if(m.action==='export') {
    const result=await request(m);
    const downloads=[];
    for(const file of result.files)downloads.push(await chrome.downloads.download({url:file.url,filename:`${result.folder}/${file.filename}`,conflictAction:'uniquify',saveAs:false}));
    // Object URLs remain alive while downloads are active. Failed exports keep their IndexedDB source.
    const finish=async()=>{
      const rows=await Promise.all(downloads.map(id=>chrome.downloads.search({id})));
      if(rows.flat().every(d=>d.state!=='in_progress')){chrome.downloads.onChanged.removeListener(finish);await request({action:'release',id:m.id});}
    };
    chrome.downloads.onChanged.addListener(finish);await finish();return {files:result.files.length,folder:result.folder};
  }
  if(['list','pause','stop','delete'].includes(m.action))return request({...m,reason:'user'});
  throw Error('未知操作');
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(!['controls','content','badge'].includes(m.target))return;
  handle(m,sender).then(data=>reply({ok:true,data})).catch(error=>reply({ok:false,error:error.message}));return true;
});
chrome.tabs.onUpdated.addListener((tabId,change)=>{
  if(change.status!=='loading')return;
  void currentSession(tabId).then(s=>s&&request({action:'pause',id:s.id,reason:'navigation'})).catch(()=>{});
});
chrome.tabs.onRemoved.addListener(tabId=>{void currentSession(tabId).then(s=>s&&request({action:'stop',id:s.id,reason:'tab-closed'})).catch(()=>{});});
