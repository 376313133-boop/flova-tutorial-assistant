#!/usr/bin/env python3
"""Prepare audio-only Flova rounds; delegate generation/waiting to the released CLI."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from tutorial import binary, probe, write


def split_text(text, limit=240):
    text=text.strip()
    if not text: raise ValueError('Narration script is empty')
    chunks=[]
    while text:
        end=min(limit,len(text))
        if len(text)>limit:
            boundaries=[m.end() for m in re.finditer(r'[。！？!?；;\n]|[.!?]\s|\s',text[:limit]) if m.end()>=limit//3]
            if boundaries:end=boundaries[-1]
        part=text[:end].strip()
        if part:chunks.append(part)
        text=text[end:].lstrip()
    return chunks


def cli(*args, profile=None):
    command=['flova']+(['--profile',profile] if profile else [])+list(args)
    result=subprocess.run(command,capture_output=True,text=True,timeout=45)
    try:data=json.loads(result.stdout)
    except ValueError:raise ValueError('CLI did not return JSON; check its command help and current API mode')
    if result.returncode or data.get('code')!=0:raise ValueError(f'Flova read failed: {data.get("code",result.returncode)}. Inspect the CLI locally; do not publish credentials or signed URLs.')
    return data.get('data',{})


def doctor(args):
    auth=cli('auth','status',profile=args.profile)
    runtime=cli('profile','api','show',profile=args.profile)
    result={'token_stored':bool(auth.get('token_stored')),'profile':auth.get('profile'),
            'api_mode':runtime.get('api_mode'),'api_version':runtime.get('api_version'),'models':[]}
    if runtime.get('api_version')!='v3':
        result['note']='Model directory requires V3. Follow the user-authorized latest/auto setup; never silently repin an existing project.'
        return result
    for media in ('audio','music'):
        directory=cli('model','list','--media-type',media,profile=args.profile)
        result['models'] += [{'key':m.get('model_key'),'name':m.get('model_name'),'available':m.get('available'),
                              'capabilities':[c.get('capability') for c in m.get('capabilities',[])]}
                             for m in directory.get('models',[])]
    return result


def references(path, out):
    if not path:return []
    manifest=Path(path).resolve();items=json.loads(manifest.read_text(encoding='utf-8'))
    if not isinstance(items,list) or not 1<=len(items)<=3:raise ValueError('Select 1–3 clean voice reference excerpts')
    results=[]
    for i,item in enumerate(items,1):
        src=Path(item['src']).expanduser()
        if not src.is_absolute():src=manifest.parent/src
        src=src.resolve();start=float(item.get('in',0));duration=float(item['duration'])
        if not 2<=duration<30 or start<0:raise ValueError('Each reference excerpt must be 2 to less than 30 seconds')
        info=probe(src)
        if not info['has_audio'] or start+duration>info['audio_end']+.01:raise ValueError('Reference excerpt exceeds the actual audio stream')
        dest=out/f'reference-{i:02}.wav'
        command=[binary('ffmpeg'),'-hide_banner','-loglevel','error','-nostdin','-i',str(src),'-ss',str(start),'-t',str(duration),'-vn','-ac','1','-ar','48000','-c:a','pcm_s16le',str(dest)]
        result=subprocess.run(command,capture_output=True,text=True)
        if result.returncode:raise ValueError('Could not extract reference audio; inspect the source and FFmpeg locally')
        actual=probe(dest)
        if not actual['has_audio'] or not 2<=actual['audio_duration']<30:raise ValueError('Extracted reference duration failed validation')
        results.append({'src':dest.name,'source':str(src),'in':start,'duration':actual['audio_duration'],
                        'analysis':item.get('analysis',''), 'use':item.get('use','voice-reference')})
    return results


def prepare(args):
    out=Path(args.out).resolve()
    if out.exists():raise ValueError('Use a new audio round directory; preserve existing results for reuse or recovery')
    source=Path(args.script).resolve();text=source.read_text(encoding='utf-8').strip()
    if not text:raise ValueError('Input script/brief is empty')
    if args.kind=='music' and args.references:raise ValueError('This music workflow accepts a text brief, not voice-cloning references')
    out.mkdir(parents=True)
    refs=references(args.references,out)
    chunks=split_text(text,args.max_chars) if args.kind=='narration' else [text]
    rounds=[]
    for i,part in enumerate(chunks,1):
        folder=out/f'round-{i:03}';folder.mkdir()
        if args.kind=='narration':
            # Reference-conditioned model input must be spoken text only.
            prompt=part if refs else f'自然生动的中文自媒体教程口播，像向朋友演示实际操作，语速适中，有自然停连和轻重音，清楚读出产品名，不播音腔、不夸张叫卖。只朗读以下正文，不念说明，不加音乐、音效或环境声：\n{part}'
            request=f'这是独立的教程旁白生成项目，本轮只交付第 {i}/{len(chunks)} 段旁白音频，用于外部本地剪辑。优先使用 Seed Audio 1.0（当前目录核验对应 key 和 MultiModalToAudio 能力），不要改用其他模型或生成模式而不说明。不要创建视频、画面、剪辑时间线或成片。'
            if refs:request+=' 已上传的音频是创作者指定的声音参考；根据已分析的干净片段使用参考音频生成，不混用图片或其他供应商 voice ID。传给音频模型的 prompt 必须只含下面的朗读正文，不能混入这段任务说明或表演/音乐指令。'
            else:request+=' 无参考音频；传给模型的输入同时描述自然口播表现与精确正文。'
            request+='\n\n音频模型输入：\n'+prompt
        else:
            prompt=f'为教程解说制作适合铺底的原创纯音乐。无人声、无歌词、无念白，不模仿指定艺人；节奏稳定、旋律克制、留出人声频段，避免突然的重鼓和大起伏。按下面内容决定配器与节奏，不能把文案唱出来。\n{text}'
            request='这是教程音频素材项目，本轮只生成背景音乐，供外部剪辑混音；不生成旁白、视频、时间线或成片。先查询当前可用音乐模型，优先当前目录默认且可用的音乐模型。\n'+prompt
        (folder/'spoken.txt').write_text(part+'\n',encoding='utf-8')
        (folder/'model-prompt.txt').write_text(prompt+'\n',encoding='utf-8')
        (folder/'request.txt').write_text(request+'\n',encoding='utf-8')
        rounds.append({'index':i,'request':str((folder/'request.txt').relative_to(out)),
                       'model_prompt':str((folder/'model-prompt.txt').relative_to(out)),
                       'spoken':str((folder/'spoken.txt').relative_to(out))})
    job={'schema':'flova-tutorial-audio-v1','kind':args.kind,'source_script':str(source),'references':refs,
         'preferred_model':'Seed Audio 1.0' if args.kind=='narration' else 'current available music default',
         'preferred_mode':'MultiModalToAudio' if args.kind=='narration' else 'MusicGenerator',
         'project_policy':'one dedicated audio project per tutorial; reuse it for revisions; keep actual project/conversation/run IDs in the local project record',
         'rounds':rounds,'status':'prepared-not-generated'}
    write(out/'audio-job.json',job)
    return {'job':str(out/'audio-job.json'),'rounds':len(rounds),'references':len(refs),'status':'prepared-not-generated'}


def run_round(args):
    request=Path(args.request).read_text(encoding='utf-8').strip()
    if not request:raise ValueError('Creative request is empty')
    command=['flova']+(['--profile',args.profile] if args.profile else [])+['run',args.project_id,'--content',request]
    if args.conversation_id:command+=['--conversation-id',args.conversation_id]
    for path in args.file_from:command+=['--file-from',str(Path(path).resolve())]
    # Keep stdout/stderr attached. Flova owns waiting, progress, pending actions and recovery.
    return subprocess.run(command).returncode


def main():
    parser=argparse.ArgumentParser(description=__doc__);commands=parser.add_subparsers(dest='cmd',required=True)
    d=commands.add_parser('doctor');d.add_argument('--profile')
    p=commands.add_parser('prepare');p.add_argument('--kind',choices=['narration','music'],required=True)
    p.add_argument('--script',required=True);p.add_argument('--out',required=True);p.add_argument('--references')
    p.add_argument('--max-chars',type=int,default=240)
    r=commands.add_parser('run');r.add_argument('--request',required=True);r.add_argument('--project-id',required=True)
    r.add_argument('--conversation-id');r.add_argument('--profile');r.add_argument('--file-from',action='append',default=[])
    args=parser.parse_args()
    if args.cmd=='run':return run_round(args)
    if args.cmd=='prepare' and not 40<=args.max_chars<=1000:raise ValueError('Use 40–1000 characters per narration chunk; tune by spoken duration and live model limits')
    result=doctor(args) if args.cmd=='doctor' else prepare(args)
    print(json.dumps(result,ensure_ascii=False,indent=2));return 0


if __name__=='__main__':
    try:sys.exit(main())
    except (ValueError,KeyError,OSError,subprocess.SubprocessError) as error:
        print(str(error),file=sys.stderr);sys.exit(2)
