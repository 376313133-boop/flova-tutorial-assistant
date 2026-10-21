#!/usr/bin/env python3
"""Local tutorial editing helpers. Standard library + FFmpeg/FFprobe only."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import shutil
import struct
import subprocess
import sys
import wave

VERSION = '0.6.0'
CACHE_FORMAT = '1'
VIDEO = {'.mp4','.mov','.mkv','.webm','.m4v','.avi'}
AUDIO = {'.wav','.mp3','.m4a','.aac','.flac','.ogg'}
IMAGE = {'.png','.jpg','.jpeg','.webp','.bmp'}

def binary(name):
    value = os.environ.get(name.upper() + '_BIN') or shutil.which(name)
    if value and Path(value).is_file():
        return str(Path(value).resolve())
    raise ValueError(f'Missing {name}. Add it to PATH or set {name.upper()}_BIN.')

def run(args):
    result = subprocess.run([str(x) for x in args], capture_output=True, text=True)
    if result.returncode:
        raise ValueError(f'{Path(str(args[0])).name} failed:\n{result.stderr[-6000:]}')
    return result.stdout, result.stderr

def ff(args):
    return run([binary('ffmpeg'), '-hide_banner', '-y', '-threads', '2', '-filter_complex_threads', '2', *args])

def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))

def write(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def probe(path):
    out, _ = run([binary('ffprobe'), '-v','error','-show_streams','-show_format','-of','json',str(path)])
    data = json.loads(out)
    v = next((x for x in data.get('streams',[]) if x.get('codec_type')=='video'), {})
    a = next((x for x in data.get('streams',[]) if x.get('codec_type')=='audio'), {})
    container=float(data.get('format',{}).get('duration',0) or 0)
    def stream_time(stream):
        try: start=float(stream.get('start_time',0) or 0)
        except (TypeError,ValueError): start=0
        try: duration=float(stream.get('duration'))
        except (TypeError,ValueError):
            tag=stream.get('tags',{}).get('DURATION') or stream.get('tags',{}).get('duration')
            try:
                h,m,s=tag.split(':');duration=int(h)*3600+int(m)*60+float(s)
            except (AttributeError,ValueError): duration=max(0,container-start)
        return duration,start+duration
    vd,ve=stream_time(v) if v else (0,0);ad,ae=stream_time(a) if a else (0,0)
    return {'duration':container,'video_duration':vd,'video_end':ve,'audio_duration':ad,'audio_end':ae,
            'width':v.get('width'), 'height':v.get('height'), 'fps':v.get('avg_frame_rate'),
            'video_codec':v.get('codec_name'), 'audio_codec':a.get('codec_name'),
            'has_audio':bool(a), 'sample_rate':a.get('sample_rate')}

def source(base, text):
    p=Path(text).expanduser()
    return p.resolve() if p.is_absolute() else (base/p).resolve()

def number(value, low=None, high=None):
    n=float(value)
    if not math.isfinite(n) or (low is not None and n<low) or (high is not None and n>high):
        raise ValueError(f'Number outside supported range: {value}')
    return n

def fingerprint(path):
    stat=Path(path).stat()
    # Cache identity is local file path + size + nanosecond mtime, not a claim of content identity.
    return {'path':str(Path(path).resolve()),'bytes':stat.st_size,'mtime_ns':stat.st_mtime_ns}

def validate(plan_path):
    plan_path=Path(plan_path).resolve(); base=plan_path.parent; p=read(plan_path)
    c=p.get('canvas',{})
    for key, default in [('width',1920),('height',1080)]:
        n=number(c.get(key,default),64,7680)
        if n%2 or int(n)!=n: raise ValueError(f'{key} must be an even integer')
    fps=number(c.get('fps',30),1,60)
    background=c.get('background')
    if not isinstance(background,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',background):
        raise ValueError('Set canvas.background to a six-digit color before rendering; the default neutral black is #050506.')
    clips=p.get('clips',[])
    if not clips: raise ValueError('Plan has no clips. Complete the edit plan before rendering.')
    ids=set(); duration=0; probes={}
    def info_for(path):
        key=str(path)
        if key not in probes:probes[key]=probe(path)
        return probes[key]
    for i, clip in enumerate(clips):
        identity=clip.get('id',f'clip-{i+1}')
        if identity in ids: raise ValueError(f'Duplicate clip ID: {identity}')
        ids.add(identity); d=number(clip['duration'],1/fps-1e-6,86400); speed=number(clip.get('speed',1),.25,4)
        frames=round(d*fps)
        if abs(d*fps-frames)>1e-3: raise ValueError(f'{identity}: duration must align to output frames; use {frames}/{fps} seconds ({frames/fps:.6f})')
        duration+=d; start=number(clip.get('in',0),0)
        if clip.get('kind')!='title':
            path=source(base,clip['src'])
            if not path.is_file(): raise ValueError(f'Missing source: {path}')
            info=info_for(path)
            if not info['video_codec']:raise ValueError(f'{identity}: a visual clip needs a video or image stream')
            if path.suffix.lower() not in IMAGE and start+d*speed>info['video_end']+1/fps:
                raise ValueError(f'{identity}: source ends before requested out point')
        if clip.get('fit','contain') not in ('contain','cover'): raise ValueError('fit must be contain or cover')
        previous=-1
        for key in clip.get('camera',[]):
            t=number(key['t'],0,d)
            if t<=previous: raise ValueError('Camera times must strictly increase')
            previous=t; number(key.get('zoom',1),1,3)
            number(key.get('x',.5),0,1); number(key.get('y',.5),0,1)
    for role,items in [('audio',p.get('audio',[])),('overlays',p.get('overlays',[]))]:
        for item in items:
            path=source(base,item['src'])
            if not path.is_file(): raise ValueError(f'Missing {role} source: {path}')
            at=number(item.get('at',0),0,duration); start=number(item.get('in',0),0)
            d=number(item['duration'],.01,duration)
            if at+d>duration+.05: raise ValueError(f'{role} extends beyond timeline')
            info=info_for(path)
            if role=='audio' and not info['has_audio']: raise ValueError(f'Audio track has no audio stream: {path.name}')
            end=info['audio_end'] if role=='audio' else info['video_end']
            if role=='overlays' and not info['video_codec']:raise ValueError(f'Overlay has no visual stream: {path.name}')
            if path.suffix.lower() not in IMAGE and start+d>end+1/fps: raise ValueError(f'{role} source too short: {path.name}')
            number(item.get('gain_db',0),-80,20)
            number(item.get('fade_in',0),0,60);number(item.get('fade_out',0),0,60)
            if role=='overlays':
                for key in ('x','y','width','height'):
                    if key in item: number(item[key],0,7680)
    for title in p.get('titles',[]):
        at=number(title.get('at',0),0,duration); d=number(title['duration'],.01,duration)
        if at+d>duration+.05: raise ValueError('Title extends beyond timeline')
    return p,base,round(duration,6)

def piecewise(keys, field, fps):
    if not keys: return str({'zoom':1,'x':.5,'y':.5}[field])
    keys=[dict(k) for k in keys]
    if keys[0]['t']>0: keys.insert(0,{**keys[0],'t':0})
    expr=str(keys[-1].get(field,{'zoom':1,'x':.5,'y':.5}[field]))
    for a,b in reversed(list(zip(keys,keys[1:]))):
        start=float(a['t']); end=float(b['t']); av=float(a.get(field,{'zoom':1,'x':.5,'y':.5}[field])); bv=float(b.get(field,av))
        q=f'min(max((on/{fps}-{start})/{end-start},0),1)'
        smooth=f'({q})*({q})*(3-2*({q}))'
        expr=f'if(lt(on/{fps},{end}),{av}+({bv-av})*({smooth}),{expr})'
    return expr

def atempo(speed):
    parts=[]
    while speed>2: parts.append('atempo=2'); speed/=2
    while speed<.5: parts.append('atempo=.5'); speed*=2
    parts.append(f'atempo={speed}')
    return ','.join(parts)

def filter_path(path):
    return str(path).replace('\\','/').replace(':','\\:').replace("'", "'\\''").replace('[','\\[').replace(']','\\]')

def ass_time(t):
    cs=round(t*100); return f'{cs//360000}:{cs//6000%60:02}:{cs//100%60:02}.{cs%100:02}'

def ass_text(text):
    return str(text).replace('\\','\\\\').replace('{','\\{').replace('}','\\}').replace('\n','\\N')

def make_ass(path,p,w,h):
    basew=p.get('canvas',{}).get('width',1920); ratio=w/basew
    family=p.get('font_family','PingFang SC' if sys.platform=='darwin' else 'Arial').replace(',',' ')
    lines=['[Script Info]','ScriptType: v4.00+',f'PlayResX: {w}',f'PlayResY: {h}','WrapStyle: 2','ScaledBorderAndShadow: yes','[V4+ Styles]',
           'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
           f'Style: Default,{family},{round(48*ratio)},&H00F5F5F0,&H00FFFFFF,&H99080808,&H00000000,0,0,0,0,100,100,0,0,1,{max(1,2*ratio)},0,2,40,40,40,1',
           '[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    titles=list(p.get('titles',[])); at=0
    for clip in p['clips']:
        if clip.get('kind')=='title' and clip.get('text'): titles.append({'at':at,'duration':clip['duration'],'text':clip['text'],'anchor':'center','font_size':72})
        at+=clip['duration']
    for t in titles:
        anchor=t.get('anchor','bottom'); align={'center':5,'top-left':7,'bottom-left':1,'bottom':2}.get(anchor,2)
        x=t.get('x',w/ratio*.5 if align in (2,5) else 80)*ratio
        y=t.get('y',h/ratio*.5 if align==5 else 80 if align==7 else h/ratio-90)*ratio
        size=number(t.get('font_size',48),12,300)*ratio
        color=t.get('color','#f5f5f0')
        if not re.fullmatch(r'#[0-9a-fA-F]{6}',color): raise ValueError('Invalid title color')
        bgr=color[5:7]+color[3:5]+color[1:3]
        tags=f'{{\\an{align}\\pos({round(x)},{round(y)})\\fs{size:.2f}\\c&H{bgr}&\\fad(120,120)}}'
        lines.append(f'Dialogue: 0,{ass_time(t["at"])},{ass_time(t["at"]+t["duration"])},Default,,0,0,0,,{tags}{ass_text(t["text"])}')
    Path(path).write_text('\n'.join(lines)+'\n',encoding='utf-8')
    return bool(titles)

def render(args):
    p,base,total=validate(args.plan); c=p.get('canvas',{}); ow=int(c.get('width',1920)); oh=int(c.get('height',1080)); fps=float(c.get('fps',30))
    ratio=min(1,640/ow) if args.preview else 1
    w=max(64,round(ow*ratio/2)*2); h=max(64,round(oh*ratio/2)*2)
    bg=c.get('background','#050506').replace('#','0x')
    cache=base/'.cache'/'segments';cache.mkdir(parents=True,exist_ok=True)
    outputs=[]
    for i,clip in enumerate(p['clips']):
        d=float(clip['duration']);speed=float(clip.get('speed',1));kind=clip.get('kind','screen');inp=[];info={}
        path=None
        if kind=='title': inp=['-f','lavfi','-i',f'color=c={bg}:s={w}x{h}:r={fps}']
        else:
            path=source(base,clip['src']); info=probe(path)
            inp=(['-loop','1','-framerate',str(fps)] if path.suffix.lower() in IMAGE else ['-ss',str(clip.get('in',0)),'-t',str(d*speed)])+['-i',str(path)]
        key={'clip':clip,'source':fingerprint(path) if path else None,'w':w,'h':h,'fps':fps,'bg':bg,'cache_format':CACHE_FORMAT}
        identity=hashlib.sha256(json.dumps(key,sort_keys=True).encode()).hexdigest()[:24]
        out=cache/(identity+'.mp4'); outputs.append(out)
        if out.exists(): continue
        fit=f'scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}' if clip.get('fit','contain')=='cover' else f'scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={bg}'
        vf=f'[0:v]setpts=(PTS-STARTPTS)/{speed},fps={fps},{fit},setsar=1'
        if clip.get('camera'):
            z=piecewise(clip['camera'],'zoom',fps);x=piecewise(clip['camera'],'x',fps);y=piecewise(clip['camera'],'y',fps)
            vf+=f",zoompan=z='{z}':x='min(max(iw*({x})-iw/zoom/2,0),iw-iw/zoom)':y='min(max(ih*({y})-ih/zoom/2,0),ih-ih/zoom)':d=1:s={w}x{h}:fps={fps}"
        vf+=',format=yuv420p[v]'
        if clip.get('keep_audio',False) and info.get('has_audio'):
            af=f'[0:a]asetpts=PTS-STARTPTS,{atempo(speed)},volume={10**(float(clip.get("source_gain_db",0))/20)},aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration={d}[a]'
        else:
            inp+=['-f','lavfi','-i','anullsrc=r=48000:cl=stereo'];af=f'[1:a]atrim=duration={d},asetpts=PTS-STARTPTS[a]'
        partial=out.with_suffix('.partial.mp4')
        ff([*inp,'-filter_complex',vf+';'+af,'-map','[v]','-map','[a]','-t',str(d),'-c:v','libx264','-preset','fast','-crf','18','-c:a','aac','-b:a','192k','-movflags','+faststart',partial])
        partial.replace(out)
    concat=base/'.cache'/'concat.txt';concat.write_text('\n'.join("file '"+str(x).replace("'","'\\''")+"'\nduration "+str(p['clips'][i]['duration']) for i,x in enumerate(outputs))+'\n')
    joined=base/'.cache'/'joined.mp4';ff(['-f','concat','-safe','0','-i',concat,'-c','copy',joined])
    inputs=['-i',joined]; chains=[];audio_labels=['[0:a]']; vi='[0:v]'; index=1
    narration=[x for x in p.get('audio',[]) if x.get('role')=='narration']
    for track in p.get('audio',[]):
        inputs+=['-i',source(base,track['src'])];label=f'a{index}';d=float(track['duration']);at=float(track.get('at',0))
        gain=float(track.get('gain_db',-28 if track.get('role')=='music' else 0))
        chain=f'[{index}:a]atrim=start={track.get("in",0)}:duration={d},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume={10**(gain/20)}'
        fadein=min(float(track.get('fade_in',.01)),d/2);fadeout=min(float(track.get('fade_out',.04)),d/2)
        chain+=f',afade=t=in:st=0:d={fadein},afade=t=out:st={d-fadeout}:d={fadeout},adelay={round(at*1000)}:all=1'
        if track.get('role')=='music' and narration:
            gates='+'.join(f'between(t,{x.get("at",0)},{x.get("at",0)+x["duration"]})' for x in narration)
            chain+=f",volume='if(gt({gates},0),0.25,1)':eval=frame"
        chains.append(chain+f'[{label}]');audio_labels.append(f'[{label}]');index+=1
    for ov in p.get('overlays',[]):
        path=source(base,ov['src']);inp=['-loop','1','-framerate',str(fps)] if path.suffix.lower() in IMAGE else []
        inputs+=inp+['-i',path];d=ov['duration'];at=ov.get('at',0);label=f'ov{index}';nextv=f'v{index}'
        width=round(float(ov.get('width',ow))*ratio);height=round(float(ov.get('height',oh))*ratio)
        chains.append(f'[{index}:v]trim=start={ov.get("in",0)}:duration={d},setpts=PTS-STARTPTS+{at}/TB,scale={width}:{height}:force_original_aspect_ratio=decrease,format=rgba[{label}]')
        chains.append(f"{vi}[{label}]overlay=x={float(ov.get('x',0))*ratio}:y={float(ov.get('y',0))*ratio}:eof_action=pass:repeatlast=0:enable='between(t,{at},{at+d})'[{nextv}]")
        vi=f'[{nextv}]';index+=1
    ass=base/'.cache'/'titles.ass'
    if make_ass(ass,p,w,h):
        subtitle=f"subtitles=filename='{filter_path(ass)}'"
        if p.get('font_dir'): subtitle+=f":fontsdir='{filter_path(source(base,p['font_dir']))}'"
        chains.append(f'{vi}{subtitle}[titled]');vi='[titled]'
    chains.append(''.join(audio_labels)+f'amix=inputs={len(audio_labels)}:duration=longest:normalize=0,alimiter=limit=.95:level=disabled[mix]')
    out=Path(args.out).resolve() if args.out else base/'exports'/('preview.mp4' if args.preview else 'final.mp4');out.parent.mkdir(parents=True,exist_ok=True)
    partial=out.with_name(out.stem+'.rendering'+out.suffix)
    video_map='0:v' if vi=='[0:v]' else vi
    ff([*inputs,'-filter_complex',';'.join(chains),'-map',video_map,'-map','[mix]','-t',str(total),'-r',str(fps),'-c:v','libx264','-preset','fast' if args.preview else 'medium','-crf','22' if args.preview else '16','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',partial])
    partial.replace(out)
    write(out.with_suffix('.render.json'),{'version':VERSION,'plan':str(Path(args.plan).resolve()),'output':str(out),'duration':total,'preview':args.preview,'segments':len(outputs),'probe':probe(out)})
    return {'output':str(out),'duration':total,'segments':len(outputs)}

def sfx(args):
    rate=48000; durations={'click':.07,'confirm':.4,'soft-swish':.25,'type':.04};d=durations[args.kind];rng=random.Random(173);samples=[];lp=0
    for n in range(round(rate*d)):
        t=n/rate;attack=min(1,t/.004)
        if args.kind in ('click','type'):
            v=attack*math.exp(-t*(90 if args.kind=='click' else 150))*(.65*math.sin(2*math.pi*1700*t)+.35*rng.uniform(-1,1))
        elif args.kind=='confirm':
            v=attack*math.exp(-t*10)*(math.sin(2*math.pi*1174.66*t)+.35*math.sin(2*math.pi*1760*t))
        else:
            lp=.84*lp+.16*rng.uniform(-1,1);v=lp*math.sin(math.pi*t/d)**1.3
        samples.append(v)
    peak=max(abs(x) for x in samples) or 1;gain=10**(args.db/20)/peak
    path=Path(args.out);path.parent.mkdir(parents=True,exist_ok=True)
    with wave.open(str(path),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate)
        f.writeframes(b''.join(struct.pack('<h',round(max(-1,min(1,x*gain))*32767)) for x in samples))
    return {'out':str(path),'kind':args.kind,'duration':d,'peak_dbfs':args.db,'provenance':'original procedural SFX'}

def main():
    ap=argparse.ArgumentParser(description=__doc__);sub=ap.add_subparsers(dest='cmd',required=True)
    sub.add_parser('doctor')
    a=sub.add_parser('init');a.add_argument('--project',required=True);a.add_argument('--style',default='brand-precision')
    a=sub.add_parser('inventory');a.add_argument('--project',required=True);a.add_argument('sources',nargs='+')
    a=sub.add_parser('validate');a.add_argument('--plan',required=True)
    a=sub.add_parser('render');a.add_argument('--plan',required=True);a.add_argument('--out');a.add_argument('--preview',action='store_true')
    a=sub.add_parser('sfx');a.add_argument('--kind',choices=['click','confirm','soft-swish','type'],required=True);a.add_argument('--out',required=True);a.add_argument('--db',type=float,default=-18)
    a=sub.add_parser('silence');a.add_argument('--src',required=True);a.add_argument('--out',required=True)
    a=sub.add_parser('qa');a.add_argument('--src',required=True);a.add_argument('--out',required=True)
    a=sub.add_parser('bundle-project');a.add_argument('--plan',required=True);a.add_argument('--out',required=True)
    args=ap.parse_args()
    if args.cmd=='doctor':
        result={'version':VERSION,'python':sys.version.split()[0],'tools':{}}
        for name in ['ffmpeg','ffprobe']:
            try: result['tools'][name]=binary(name)
            except ValueError as e: result['tools'][name]={'missing':str(e)}
        result['ready']=all(isinstance(x,str) for x in result['tools'].values());print(json.dumps(result,indent=2));return 0 if result['ready'] else 2
    if args.cmd=='init':
        root=Path(args.project).resolve();root.mkdir(parents=True,exist_ok=True)
        if (root/'plan.json').exists(): raise ValueError('Project already has a plan; reuse it or choose a new directory')
        for name in ['graphics','audio','exports','review']: (root/name).mkdir(exist_ok=True)
        write(root/'plan.json',{'schema_version':'1','style':args.style,'palette_policy':'default neutral black with localized blurred colored glow; author glow animation separately in HTML; respect explicit user colors','canvas':{'width':1920,'height':1080,'fps':30,'background':'#050506'},'clips':[],'audio':[],'titles':[],'overlays':[]})
        result={'project':str(root),'plan':str(root/'plan.json')}
    elif args.cmd=='inventory':
        files=set()
        for item in args.sources:
            path=Path(item).expanduser().resolve()
            if not path.exists(): raise ValueError(f'Missing input: {path}')
            if path.is_dir(): files.update(x for x in path.rglob('*') if x.is_file() and not any(s.startswith('.') for s in x.relative_to(path).parts))
            else: files.add(path)
        entries=[]
        for path in sorted(files):
            ext=path.suffix.lower()
            if ext not in VIDEO|AUDIO|IMAGE: continue
            info=probe(path); role='audio' if ext in AUDIO else 'still' if ext in IMAGE else 'video'
            entries.append({'id':hashlib.sha256(str(path).encode()).hexdigest()[:12],'src':str(path),'kind':role,'role_status':'needs content review',**fingerprint(path),**info})
        out=Path(args.project)/'inventory.json';write(out,{'media':entries});result={'inventory':str(out),'count':len(entries)}
    elif args.cmd=='validate':
        p,base,d=validate(args.plan);result={'valid':True,'duration':d,'clips':len(p['clips'])}
    elif args.cmd=='render': result=render(args)
    elif args.cmd=='sfx': result=sfx(args)
    elif args.cmd=='silence':
        _,log=ff(['-i',args.src,'-vn','-af','silencedetect=noise=-35dB:d=0.25','-f','null','-'])
        result={'source':args.src,'silence_candidates':[{'event':m.group(1),'seconds':float(m.group(2))} for m in re.finditer(r'silence_(start|end): ([0-9.]+)',log)]};write(args.out,result)
    elif args.cmd=='qa':
        root=Path(args.out);root.mkdir(parents=True,exist_ok=True);info=probe(args.src)
        _,vlog=ff(['-i',args.src,'-an','-vf','blackdetect=d=0.12:pix_th=0.10,freezedetect=n=-60dB:d=0.7','-f','null','-'])
        alog=''
        if info['has_audio']: _,alog=ff(['-i',args.src,'-vn','-af','volumedetect','-f','null','-'])
        ff(['-i',args.src,'-vf',f'fps={12/max(.1,info["duration"])},scale=320:-2,tile=4x3','-frames:v','1','-update','1',root/'contact-sheet.jpg'])
        result={'source':str(Path(args.src).resolve()),'probe':info,'visual_candidates':[line for line in vlog.splitlines() if 'black_start:' in line or 'freeze_' in line],
                'audio_report':[line for line in alog.splitlines() if 'mean_volume:' in line or 'max_volume:' in line],
                'contact_sheet':'contact-sheet.jpg','status':'requires visual/audio review; static and dark frames may be intentional'};write(root/'report.json',result)
    else:
        p,base,_=validate(args.plan);dest=Path(args.out).resolve()
        if dest.exists(): raise ValueError('Bundle destination must be new')
        (dest/'assets').mkdir(parents=True);mapping={}
        for group in ['clips','audio','overlays']:
            for item in p.get(group,[]):
                if not item.get('src'): continue
                path=source(base,item['src']);key=str(path)
                if key not in mapping:
                    name=hashlib.sha256(key.encode()).hexdigest()[:12]+path.suffix.lower();shutil.copy2(path,dest/'assets'/name);mapping[key]='assets/'+name
                item['src']=mapping[key]
        if p.get('font_dir'):
            folder=source(base,p['font_dir']);shutil.copytree(folder,dest/'fonts');p['font_dir']='fonts'
        write(dest/'plan.json',p);result={'bundle':str(dest),'media_files':len(mapping)}
    print(json.dumps(result,ensure_ascii=False,indent=2));return 0

if __name__=='__main__':
    try: sys.exit(main())
    except (ValueError,KeyError,OSError,subprocess.SubprocessError) as error:
        print(str(error),file=sys.stderr);sys.exit(2)
