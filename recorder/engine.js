export class RecorderPool {
  constructor(store, onChange = () => {}, clock = () => performance.now()) {
    this.store=store;this.onChange=onChange;this.clock=clock;this.sessions=new Map();
  }
  async start({id=crypto.randomUUID(),tabId,project,capture,stream,idleMs=10000}) {
    if ([...this.sessions.values()].some(s=>s.meta.tabId===tabId && s.meta.state!=='stopped'))
      throw Error('这个标签页已经有一个录制会话');
    const mimeType=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']
      .find(type=>MediaRecorder.isTypeSupported(type));
    if(!mimeType) throw Error('当前浏览器没有可用的 WebM 编码器');
    const s={meta:{id,tabId,project,capture,createdAt:new Date().toISOString(),state:'paused',mimeType,
      idleMs,recordedMs:0,takes:[],events:[]},stream,reasons:new Set(),lastActivity:this.clock(),holdUntil:0,queue:Promise.resolve(),take:null};
    this.sessions.set(id,s);
    stream.getVideoTracks()[0]?.addEventListener('ended',()=>{void this.command(id,'stop','stream-ended').catch(()=>{});},{once:true});
    try { await this.openTake(s); return this.snapshot(s); }
    catch(error){stream.getTracks().forEach(t=>t.stop());this.sessions.delete(id);throw error;}
  }
  snapshot(s) {return {...structuredClone(s.meta),pauseReasons:[...s.reasons]};}
  list() {return [...this.sessions.values()].map(s=>this.snapshot(s));}
  async persist(s) {await this.store.putSession(s.meta);this.onChange(this.snapshot(s));}
  event(s,action,reason) {s.meta.events.push({action,reason:String(reason||'').slice(0,80),wallTime:new Date().toISOString(),recordedMs:s.meta.recordedMs});}
  async openTake(s) {
    if(s.meta.state==='stopped'||s.reasons.size||s.take)return;
    const info={index:s.meta.takes.length+1,filename:`segment-${String(s.meta.takes.length+1).padStart(3,'0')}.webm`,durationMs:0,complete:false,bytes:0};
    const recorder=new MediaRecorder(s.stream,{mimeType:s.meta.mimeType,videoBitsPerSecond:8000000});
    const take={info,recorder,started:this.clock(),writes:Promise.resolve(),index:0,error:null};
    // Save metadata first so an interrupted take remains discoverable after restart.
    s.meta.takes.push(info);s.take=take;s.meta.state='recording';
    recorder.ondataavailable=({data})=>{
      if(!data.size)return;info.bytes+=data.size;
      take.writes=take.writes.then(()=>this.store.putChunk({sessionId:s.meta.id,take:info.index,index:take.index++,blob:data}));
      take.writes.catch(error=>{take.error=error;});
    };
    recorder.onerror=event=>{take.error=event.error||Error('MediaRecorder failed');void this.command(s.meta.id,'stop','encoder-error').catch(()=>{});};
    this.event(s,'record','take-open');await this.persist(s);recorder.start(1000);
  }
  async closeTake(s,reason) {
    const take=s.take;if(!take)return;
    const elapsed=Math.max(0,this.clock()-take.started);
    await new Promise((resolve,reject)=>{
      take.recorder.addEventListener('stop',resolve,{once:true});
      try {take.recorder.stop();}catch(error){reject(error);}
    });
    await take.writes;
    take.info.durationMs=elapsed;take.info.complete=!take.error;
    s.meta.recordedMs+=elapsed;s.take=null;s.meta.state='paused';
    this.event(s,'pause',reason);await this.persist(s);
    if(take.error)throw take.error;
  }
  command(id,action,reason='agent',value) {
    const s=this.sessions.get(id);if(!s)return Promise.reject(Error('没有找到正在录制的会话'));
    const next=s.queue.catch(()=>{}).then(async()=>{
      if(s.meta.state==='stopped')return this.snapshot(s);
      if(action==='pause') {s.reasons.add(reason);await this.closeTake(s,reason);}
      else if(action==='resume') {
        s.reasons.delete(reason);s.reasons.delete('idle');s.lastActivity=this.clock();await this.openTake(s);
      } else if(action==='activity') {
        s.lastActivity=this.clock();s.reasons.delete('idle');await this.openTake(s);
      } else if(action==='hold') {
        s.holdUntil=this.clock()+Math.max(0,Math.min(120,Number(value)||0))*1000;
        s.reasons.delete('idle');await this.openTake(s);
      } else if(action==='mark') {this.event(s,'mark',reason);}
      else if(action==='stop') {
        try {await this.closeTake(s,reason);}finally {
          s.meta.state='stopped';s.stream.getTracks().forEach(t=>t.stop());
          this.event(s,'stop',reason);await this.persist(s);
        }
      } else throw Error('未知录制动作');
      await this.persist(s);return this.snapshot(s);
    });
    s.queue=next;return next;
  }
  async tick() {
    await Promise.all([...this.sessions.values()].filter(s=>s.meta.state==='recording').map(s=>{
      const now=this.clock();
      if(s.meta.recordedMs+(s.take?now-s.take.started:0)>1800000)return this.command(s.meta.id,'stop','recording-limit');
      if(now>s.holdUntil && now-s.lastActivity>s.meta.idleMs)return this.command(s.meta.id,'pause','idle');
    }));
  }
}
