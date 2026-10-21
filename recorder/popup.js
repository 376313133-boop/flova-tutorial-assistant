const status=document.querySelector('#notice'),container=document.querySelector('#sessions');
async function call(action,extra={}){const r=await chrome.runtime.sendMessage({target:'controls',action,...extra});if(!r?.ok)throw Error(r?.error||'扩展没有响应');return r.data;}
async function perform(button,action,extra){button.disabled=true;status.textContent='';try{const r=await call(action,extra);if(action==='export')status.textContent=`已提交 ${r.files} 个文件到下载目录`;await refresh();}catch(error){status.textContent=error.message;}finally{button.disabled=false;}}
document.querySelector('#start').onclick=e=>perform(e.target,'start',{audio:document.querySelector('#audio').checked,idleMs:Number(document.querySelector('#idle').value)});
async function refresh(){
  const sessions=await call('list');container.replaceChildren();
  for(const s of sessions.reverse()){
    const article=document.createElement('article'),header=document.createElement('header'),title=document.createElement('strong'),state=document.createElement('small');
    title.textContent=s.project;state.textContent={recording:'录制中',paused:'已暂停',stopped:'已停止',interrupted:'可恢复片段'}[s.state]||s.state;
    header.append(title,state);article.append(header);
    const note=document.createElement('p');note.textContent=`${s.takes.length} 段 · ${Math.round(s.recordedMs/1000)} 秒已保存`+(s.pauseReasons?.length?` · ${s.pauseReasons.join(' / ')}`:'');article.append(note);
    const actions=document.createElement('div');actions.className='actions';
    const entries=['stopped','interrupted'].includes(s.state)?[['export','导出片段'],['delete','清理本地数据']]:[[s.state==='recording'?'pause':'resume',s.state==='recording'?'暂停':'恢复'],['stop','停止并保存']];
    for(const [action,label] of entries){const button=document.createElement('button');button.textContent=label;button.onclick=()=>perform(button,action,{id:s.id});actions.append(button);}
    article.append(actions);container.append(article);
  }
}
refresh().catch(error=>{status.textContent=error.message;});
setInterval(()=>{if(!document.querySelector('button:disabled'))refresh().catch(()=>{});},2000);
