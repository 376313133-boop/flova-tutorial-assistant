/* Original, dependency-free spatial camera for authored tutorial scenes. */
(function(scope){
  'use strict';
  const add=(a,b)=>a.map((x,i)=>x+b[i]);
  const sub=(a,b)=>a.map((x,i)=>x-b[i]);
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=a=>{const length=Math.hypot(...a);if(length<1e-8)throw Error('Camera position and target must differ');return a.map(x=>x/length);};
  const radians=x=>x*Math.PI/180;
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
  const clone=x=>Array.isArray(x)?x.slice():x;
  const easing={linear:t=>t,smooth:t=>t*t*(3-2*t),smoother:t=>t*t*t*(t*(t*6-15)+10),out:t=>1-Math.pow(1-t,3),in:t=>t*t*t};
  function basis(camera){
    const forward=unit(sub(camera.target,camera.position));
    const up=unit(camera.up||[0,-1,0]),reference=cross(up,forward);
    if(Math.hypot(...reference)<1e-6)throw Error('Camera up is parallel to its view. Choose one consistent up vector for this shot.');
    let right=unit(reference),down=cross(right,forward);
    const roll=radians(camera.roll||0),c=Math.cos(roll),s=Math.sin(roll);
    const old=right;
    right=old.map((x,i)=>x*c-down[i]*s);down=old.map((x,i)=>x*s+down[i]*c);
    return {right,down,forward};
  }
  function rotate(point,angles){
    const [ax,ay,az]=angles.map(radians);let [x,y,z]=point;
    [y,z]=[y*Math.cos(ax)-z*Math.sin(ax),y*Math.sin(ax)+z*Math.cos(ax)];
    [x,z]=[x*Math.cos(ay)+z*Math.sin(ay),-x*Math.sin(ay)+z*Math.cos(ay)];
    [x,y]=[x*Math.cos(az)-y*Math.sin(az),x*Math.sin(az)+y*Math.cos(az)];
    return [x,y,z];
  }
  function mix(a,b,t,angles){
    if(Array.isArray(a))return a.map((v,i)=>mix(v,b[i],t,angles));
    const delta=angles?(((b-a+180)%360)+360)%360-180:b-a;return a+delta*t;
  }
  function sample(keys,t,angles){
    if(t<=keys[0].t)return clone(keys[0].value);
    for(let i=1;i<keys.length;i++)if(t<keys[i].t){
      const a=keys[i-1],b=keys[i],p=(t-a.t)/(b.t-a.t);
      return mix(a.value,b.value,(easing[a.ease||'smoother']||easing.smoother)(p),angles);
    }
    return clone(keys[keys.length-1].value);
  }
  class SpatialStage{
    constructor(root,{width=1920,height=1080,focalLength=1400,camera={}}={}){
      if(!root)throw Error('A root element is required');
      if(![width,height,focalLength].every(v=>Number.isFinite(v)&&v>0))throw Error('Stage size and focal length must be positive');
      this.root=root;this.width=width;this.height=height;this.nodes=new Map();this.tracks=[];
      this.baseCamera={position:[0,0,focalLength],target:[0,0,0],up:[0,-1,0],roll:0,focalLength,...camera};
      if(![this.baseCamera.position,this.baseCamera.target,this.baseCamera.up].every(vector)||!Number.isFinite(this.baseCamera.roll)||!Number.isFinite(this.baseCamera.focalLength)||this.baseCamera.focalLength<=0)throw Error('Invalid camera position, target, up, roll or focal length');
      if(Math.hypot(...this.baseCamera.up)<1e-8)throw Error('Camera up must be non-zero');
      basis(this.baseCamera);
      this.camera={...this.baseCamera};this.time=0;
      root.style.position='relative';root.style.overflow='hidden';
      this.surface=document.createElement('div');this.world=document.createElement('div');this.hud=document.createElement('div');
      this.surface.className='spatial-surface';this.world.className='spatial-world';this.hud.className='spatial-hud';
      Object.assign(this.surface.style,{position:'absolute',width:width+'px',height:height+'px',left:'50%',top:'50%',transformOrigin:'50% 50%'});
      Object.assign(this.world.style,{position:'absolute',inset:'0',perspectiveOrigin:'50% 50%',transformStyle:'preserve-3d'});
      Object.assign(this.hud.style,{position:'absolute',inset:'0',pointerEvents:'none'});
      this.surface.append(this.world,this.hud);root.append(this.surface);
      this.resizeObserver=new ResizeObserver(()=>this.render());this.resizeObserver.observe(root);
      this.render();
    }
    addPlane({id,element,width,height,position=[0,0,0],rotation=[0,0,0],scale=1,opacity=1}){
      if(!id||this.nodes.has(id)||!element)throw Error('Each plane needs a unique id and an element');
      if(![width,height].every(v=>Number.isFinite(v)&&v>0))throw Error('Plane dimensions must be positive');
      if(![position,rotation].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)))throw Error('Plane position/rotation must have three finite values');
      if(Array.isArray(scale)?scale.length!==3||scale.some(v=>!Number.isFinite(v)||v<=0):!Number.isFinite(scale)||scale<=0)throw Error('Plane scale must be positive');
      if(!Number.isFinite(opacity)||opacity<0||opacity>1)throw Error('Plane opacity must be between zero and one');
      const wrap=document.createElement('div');wrap.className='spatial-plane';wrap.dataset.spatialId=id;
      Object.assign(wrap.style,{position:'absolute',left:'50%',top:'50%',width:'0',height:'0',transformOrigin:'0 0',transformStyle:'preserve-3d'});
      Object.assign(element.style,{position:'absolute',left:-width/2+'px',top:-height/2+'px',width:width+'px',height:height+'px',boxSizing:'border-box'});
      wrap.append(element);this.world.append(wrap);
      const base={position:position.slice(),rotation:rotation.slice(),scale,opacity};
      this.nodes.set(id,{id,element,wrap,width,height,base,state:{...base}});this.seek(this.time);return this;
    }
    track(id,property,keys){
      const allowed=id==='camera'?['position','target','roll','focalLength']:['position','rotation','scale','opacity'];
      if(!allowed.includes(property)||(id!=='camera'&&!this.nodes.has(id)))throw Error('Unknown animation target/property');
      if(!Array.isArray(keys)||!keys.length)throw Error('Keyframes are required');
      const arrayShape=Array.isArray(keys[0].value);
      let previous=-Infinity;
      const checked=keys.map(k=>{
        if(!Number.isFinite(k.t)||k.t<0||k.t<=previous)throw Error('Keyframe times must strictly increase');previous=k.t;
        const values=Array.isArray(k.value)?k.value:[k.value];
        if(Array.isArray(k.value)!==arrayShape)throw Error('Keep the value shape consistent across keyframes');
        if(!values.every(Number.isFinite))throw Error('Keyframe values must be finite');
        if(['position','target','rotation'].includes(property)&&values.length!==3)throw Error('Vector tracks need three values');
        if(property==='scale'&&(arrayShape&&values.length!==3||values.some(v=>v<=0)))throw Error('Scale needs one number or a three-value vector');
        if(property==='opacity'&&(arrayShape||values[0]<0||values[0]>1))throw Error('Opacity must be a number between zero and one');
        if(property==='roll'&&arrayShape)throw Error('Camera roll must be a number');
        if(property==='focalLength'&&(arrayShape||values[0]<=0))throw Error('Focal length must be positive');
        if(k.ease&&!easing[k.ease])throw Error('Unknown easing');
        return {...k,value:clone(k.value)};
      });
      this.tracks=this.tracks.filter(t=>t.id!==id||t.property!==property);
      this.tracks.push({id,property,keys:checked});this.seek(this.time);return this;
    }
    seek(t){
      if(!Number.isFinite(t))throw Error('Time must be finite');this.time=Math.max(0,t);
      this.camera={...this.baseCamera};
      for(const node of this.nodes.values())node.state={...node.base};
      for(const tr of this.tracks){const value=sample(tr.keys,this.time,tr.property==='rotation'||tr.property==='roll');
        if(tr.id==='camera')this.camera[tr.property]=value;else this.nodes.get(tr.id).state[tr.property]=value;
      }
      this.render();return this;
    }
    worldPoint(id,{u=.5,v=.5,normal=0}={}){
      const node=this.nodes.get(id);if(!node)throw Error('Unknown plane: '+id);
      const s=node.state.scale,scale=Array.isArray(s)?s:[s,s,s];
      return add(node.state.position,rotate([(u-.5)*node.width*scale[0],(v-.5)*node.height*scale[1],normal*scale[2]],node.state.rotation));
    }
    projectStage(point){
      const b=basis(this.camera),rel=sub(point,this.camera.position),depth=dot(b.forward,rel);
      // Depth eligibility only: visible does not test viewport bounds, masks or occlusion.
      return {x:this.width/2+this.camera.focalLength*dot(b.right,rel)/depth,y:this.height/2+this.camera.focalLength*dot(b.down,rel)/depth,depth,visible:depth>1};
    }
    project(point){
      const p=this.projectStage(point),s=this.viewportScale||1;
      return {...p,x:this.root.clientLeft+(this.root.clientWidth-this.width*s)/2+p.x*s,y:this.root.clientTop+(this.root.clientHeight-this.height*s)/2+p.y*s};
    }
    anchor(id,uv){return this.project(this.worldPoint(id,uv));}
    anchorStage(id,uv){return this.projectStage(this.worldPoint(id,uv));}
    elementAnchor(element,{u=.5,v=.5}={}){
      // AABB interpolation, not a perspective quad. Use zero-size marker elements for exact points.
      const rect=element.getBoundingClientRect(),root=this.root.getBoundingClientRect();
      const style=getComputedStyle(element);
      return {x:rect.left+rect.width*u-root.left,y:rect.top+rect.height*v-root.top,visible:style.visibility!=='hidden'&&style.display!=='none'&&element.getClientRects().length>0};
    }
    elementAnchorStage(element,uv){
      const point=this.elementAnchor(element,uv),s=this.viewportScale||1;
      return {...point,x:(point.x-this.root.clientLeft-(this.root.clientWidth-this.width*s)/2)/s,y:(point.y-this.root.clientTop-(this.root.clientHeight-this.height*s)/2)/s};
    }
    render(){
      if(!this.world)return;
      const s=Math.min(this.root.clientWidth/this.width,this.root.clientHeight/this.height)||1;
      this.viewportScale=s;this.surface.style.transform=`translate(-50%,-50%) scale(${s})`;
      const f=this.camera.focalLength;if(!(f>0))throw Error('Focal length must be positive');
      this.world.style.perspective=f+'px';const b=basis(this.camera);
      for(const node of this.nodes.values()){
        const st=node.state,sv=Array.isArray(st.scale)?st.scale:[st.scale,st.scale,st.scale];
        const columns=[[1,0,0],[0,1,0],[0,0,1]].map((a,i)=>rotate(a.map(x=>x*sv[i]),st.rotation));
        const m=[];
        for(const col of columns)m.push(dot(b.right,col),dot(b.down,col),-dot(b.forward,col),0);
        const rel=sub(st.position,this.camera.position),depth=dot(b.forward,rel);
        m.push(dot(b.right,rel),dot(b.down,rel),f-depth,1);
        node.wrap.style.transform='matrix3d('+m.join(',')+')';
        node.wrap.style.visibility=depth>1&&st.opacity>0?'visible':'hidden';
        // Opacity belongs to this planar material, never to the 3D world/camera parent.
        node.element.style.opacity=String(Math.max(0,Math.min(1,st.opacity)));
      }
    }
    destroy(){this.resizeObserver.disconnect();this.surface.remove();this.nodes.clear();this.tracks=[];}
  }
  scope.FlovaSpatial={SpatialStage,easing};
})(window);
