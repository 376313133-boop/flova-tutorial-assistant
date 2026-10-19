#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

const options={};
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i];
  if(!key.startsWith('--'))throw Error('Use named arguments');
  options[key.slice(2)]=['--transparent','--keep-frames','--help'].includes(key)?true:process.argv[++i];
}
if(options.help||!options.html||!options.out){
  console.log('node render_motion.mjs --html scene.html --out scene.mov --duration 4 [--width 1920 --height 1080 --fps 30 --transparent --modules node_modules --browser chromium]');process.exit(options.help?0:2);
}
const width=Number(options.width||1920),height=Number(options.height||1080),fps=Number(options.fps||30),duration=Number(options.duration);
if(![width,height,fps,duration].every(Number.isFinite)||width<64||height<64||width>7680||height>7680||fps<1||fps>60||duration<=0||duration>600)throw Error('Invalid frame size, frame rate or duration');
if(!Number.isInteger(width)||!Number.isInteger(height)||(!options.transparent&&(width%2||height%2)))throw Error('Use integer dimensions; MP4 requires even dimensions.');
if(options.transparent&&!options.out.toLowerCase().endsWith('.mov'))throw Error('Transparent output requires a .mov destination');
const count=Math.round(duration*fps);
if(count<1)throw Error('Duration must cover at least one output frame.');
const require=createRequire(path.resolve(process.cwd(),'package.json'));
let playwright;
try{playwright=options.modules?require(path.resolve(options.modules,'playwright')):require('playwright');}
catch{throw Error('Playwright is unavailable. Install it in the project directory or supply --modules.');}
const output=path.resolve(options.out),html=path.resolve(options.html);
await fs.mkdir(path.dirname(output),{recursive:true});
const frames=await fs.mkdtemp(path.join(path.dirname(output),'.motion-frames-'));
const partialOutput=path.join(frames,'output'+path.extname(output));
let browser;
try{
  const browserPath=options.browser||process.env.CHROMIUM_BIN||playwright.chromium.executablePath();
  browser=await playwright.chromium.launch({headless:true,executablePath:browserPath});
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>/^(file:|data:|about:)/.test(route.request().url())?route.continue():route.abort());
  await page.goto(pathToFileURL(html).href,{waitUntil:'load'});
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode().catch(()=>{throw Error('Image failed to decode: '+img.src)})));});
  if(!(await page.evaluate(()=>typeof window.seek==='function')))throw Error('The HTML must expose window.seek(seconds).');
  const media=await page.evaluate(async({sceneDuration,fps})=>{
    const videos=[...document.querySelectorAll('video')];
    for(const v of videos){
      if(!v.hasAttribute('data-timeline'))throw Error('HTML video needs data-timeline and an explicit scene/source time mapping.');
      v.removeAttribute('autoplay');v.pause();v.muted=true;v.preload='auto';
      if(v.readyState<2)await new Promise((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);v.removeEventListener('loadeddata',loaded);v.removeEventListener('error',failed);};
        const loaded=()=>{cleanup();resolve();};const failed=()=>{cleanup();reject(Error('Video cannot be decoded: '+v.currentSrc));};
        const timer=setTimeout(()=>{cleanup();reject(Error('Video load timed out: '+v.currentSrc));},15000);
        v.addEventListener('loadeddata',loaded,{once:true});v.addEventListener('error',failed,{once:true});
        if(v.networkState===0)v.load();
      });
      if(!Number.isFinite(v.duration)||v.duration<=0)throw Error('Only finite local video files are supported.');
      const start=Number(v.dataset.start||0),sourceIn=Number(v.dataset.sourceIn||0),speed=Number(v.dataset.speed||1),end=v.dataset.end===undefined?sceneDuration:Number(v.dataset.end);
      if(![start,sourceIn,speed,end].every(Number.isFinite)||start<0||sourceIn<0||speed<=0||sourceIn>=v.duration||end<=start||sourceIn+(end-start)*speed>v.duration+1/fps)throw Error('Invalid video time mapping or source too short.');
    }
    return videos.map(v=>({source:v.getAttribute('src'),duration:v.duration,start:Number(v.dataset.start||0),sourceIn:Number(v.dataset.sourceIn||0),speed:Number(v.dataset.speed||1)}));
  },{sceneDuration:duration,fps});
  for(let i=0;i<count;i++){
    await page.evaluate(async({t,fps})=>{
      await window.seek(t);
      if(document.getAnimations().some(a=>a.playState==='running'))throw Error('Running animations detected; pause every animation and drive it through seek.');
      await Promise.all([...document.querySelectorAll('video[data-timeline]')].map(async v=>{
        const start=Number(v.dataset.start||0),sourceIn=Number(v.dataset.sourceIn||0),speed=Number(v.dataset.speed||1);
        const end=v.dataset.end===undefined?Infinity:Number(v.dataset.end);
        const target=Math.max(0,Math.min(v.duration-0.0001,sourceIn+Math.max(0,Math.min(t,end)-start)*speed));
        v.pause();
        if(Math.abs(v.currentTime-target)>0.00001)await new Promise((resolve,reject)=>{
          const cleanup=()=>{clearTimeout(timer);v.removeEventListener('seeked',done);v.removeEventListener('error',failed);};
          const done=()=>{cleanup();resolve();};const failed=()=>{cleanup();reject(Error('Video seek failed'));};
          const timer=setTimeout(()=>{cleanup();reject(Error('Video seek timed out'));},10000);
          v.addEventListener('seeked',done,{once:true});v.addEventListener('error',failed,{once:true});v.currentTime=target;
        });
        if(v.readyState<2||Math.abs(v.currentTime-target)>1/fps)throw Error('Video frame is not ready at the requested time');
      }));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    },{t:i/fps,fps});
    await page.screenshot({path:path.join(frames,`frame-${String(i).padStart(6,'0')}.png`),omitBackground:!!options.transparent});
    if(errors.length)throw Error('HTML error: '+errors[0]);
  }
  await browser.close();browser=null;
  const ffmpeg=process.env.FFMPEG_BIN||'ffmpeg';
  const codec=options.transparent?['-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le','-alpha_bits','16']:['-c:v','libx264','-preset','medium','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart'];
  await new Promise((resolve,reject)=>{
    const child=spawn(ffmpeg,['-hide_banner','-y','-threads','2','-framerate',String(fps),'-i',path.join(frames,'frame-%06d.png'),...codec,partialOutput],{stdio:['ignore','ignore','pipe']});
    let log='';child.stderr.on('data',chunk=>log=(log+chunk).slice(-6000));child.on('error',reject);child.on('close',code=>code?reject(Error(log)):resolve());
  });
  await fs.rename(partialOutput,output);
  await fs.writeFile(output+'.render.json',JSON.stringify({html,output,width,height,fps,duration:count/fps,frames:count,transparent:!!options.transparent,timelineVideos:media},null,2)+'\n');
  if(!options['keep-frames'])await fs.rm(frames,{recursive:true});
  console.log(JSON.stringify({output,frames:count,transparent:!!options.transparent}));
}catch(error){
  if(browser)await browser.close();
  console.error(error.message+'\nInspection frames preserved at '+frames);process.exitCode=2;
}
