import {RecordingStore} from './store.js';
import {RecorderPool} from './engine.js';
const store=new RecordingStore();
const pool=new RecorderPool(store,meta=>{chrome.runtime.sendMessage({target:'badge',meta}).catch(()=>{});});
let ticking=false;
setInterval(async()=>{if(ticking)return;ticking=true;try{await pool.tick();}catch(error){console.error(error);}finally{ticking=false;}},500);
const outputs=new Map();
async function receive(m) {
  if(m.action==='start') {
    const stream=await navigator.mediaDevices.getUserMedia({
      audio:m.audio?{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:m.streamId}}:false,
      video:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:m.streamId,
        minWidth:m.capture.width,maxWidth:m.capture.width,minHeight:m.capture.height,maxHeight:m.capture.height,maxFrameRate:30}}
    });
    try {
      if(m.audio&&stream.getAudioTracks().length) {
        const context=new AudioContext();context.createMediaStreamSource(stream).connect(context.destination);
        stream.getVideoTracks()[0].addEventListener('ended',()=>{void context.close();},{once:true});
      }
      return await pool.start({tabId:m.tabId,project:m.project,capture:m.capture,stream,idleMs:m.idleMs});
    }catch(error){stream.getTracks().forEach(track=>track.stop());throw error;}
  }
  if(m.action==='list') {
    const live=pool.list(),ids=new Set(live.map(s=>s.id));
    const old=(await store.list()).filter(s=>!ids.has(s.id)).map(s=>({...s,state:s.state==='stopped'?'stopped':'interrupted',pauseReasons:[]}));
    return [...live,...old];
  }
  if(m.action==='export') {
    const meta=(await store.list()).find(s=>s.id===m.id);if(!meta)throw Error('没有找到本地录制');
    if(pool.list().some(s=>s.id===m.id&&s.state!=='stopped'))throw Error('请先停止录制，再导出');
    const files=[];
    for(const take of meta.takes) {
      const blobs=await store.chunks(m.id,take.index);if(!blobs.length)continue;
      const blob=new Blob(blobs,{type:meta.mimeType});
      files.push({filename:take.filename,url:URL.createObjectURL(blob)});
    }
    if(!files.length)throw Error('没有可导出的录制数据');
    const manifest={...meta,format:'flova-tab-recording-v1',state:meta.state==='stopped'?'stopped':'interrupted',
      note:'Each segment is an independent WebM file. Probe actual media duration before editing; paused wall time is excluded.'};
    files.push({filename:'recording.json',url:URL.createObjectURL(new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'}))});
    outputs.set(m.id,files.map(f=>f.url));return {files,folder:`Flova-recordings/${meta.project}-${meta.id.slice(0,8)}`};
  }
  if(m.action==='release') {for(const url of outputs.get(m.id)||[])URL.revokeObjectURL(url);outputs.delete(m.id);return true;}
  if(m.action==='delete') {
    if(pool.list().some(s=>s.id===m.id&&s.state!=='stopped'))throw Error('请先停止录制');
    await store.remove(m.id);pool.sessions.delete(m.id);return true;
  }
  return pool.command(m.id,m.action,m.reason,m.value);
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(message.target!=='offscreen')return;
  receive(message).then(data=>reply({ok:true,data})).catch(error=>reply({ok:false,error:error.message}));return true;
});
