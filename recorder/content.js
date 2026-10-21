(() => {
  if(globalThis.__flovaTutorialCapture)return;
  globalThis.__flovaTutorialCapture=true;
  let last=0;
  const send=(action,value)=>chrome.runtime.sendMessage({target:'content',action,value}).catch(()=>{});
  for(const name of ['pointerdown','keydown','wheel','scroll','input'])document.addEventListener(name,event=>{
    if(!event.isTrusted||performance.now()-last<600)return;last=performance.now();void send('activity');
  },{capture:true,passive:true});
  // This bridge can only control an already user-authorized recording of this same tab.
  // It never exposes a start/export command, file access, input text, or another tab.
  window.addEventListener('message',event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.type!=='FLOVA_TUTORIAL_CAPTURE')return;
    const {action,seconds}=event.data;
    if(['pause','resume','mark'].includes(action))void send(action);
    if(action==='hold')void send('hold',Math.max(0,Math.min(120,Number(seconds)||0)));
  });
  // Playback is meaningful result footage; loading spinners and DOM mutation are not activity.
  setInterval(()=>{
    if([...document.querySelectorAll('video,audio')].some(m=>!m.paused&&!m.ended&&m.readyState>=2))void send('hold',4);
  },2000);
  window.addEventListener('pagehide',()=>{void send('pause');},{once:true});
  window.addEventListener('resize',()=>{void send('pause','viewport-changed');});
})();
