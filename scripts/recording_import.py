#!/usr/bin/env python3
"""Normalize standalone browser takes to seekable MP4 with real stream durations."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from tutorial import binary, probe, write


def import_recording(manifest, destination):
    manifest=Path(manifest).resolve();root=manifest.parent
    data=json.loads(manifest.read_text(encoding='utf-8'))
    if data.get('format')!='flova-tab-recording-v1':raise ValueError('Unsupported browser recording manifest')
    if data.get('state') not in ('stopped','interrupted'):raise ValueError('Stop the recording before importing')
    takes=data.get('takes',[])
    if not takes:raise ValueError('Recording contains no takes')
    sources=[];seen=set()
    for take in takes:
        name=take.get('filename','');rel=Path(name)
        if not name or rel.is_absolute() or len(rel.parts)!=1 or name in seen or rel.suffix.lower()!='.webm':raise ValueError('Unsafe or duplicate recording filename')
        src=(root/rel).resolve();seen.add(name)
        if src.parent!=root or not src.is_file() or not src.stat().st_size:raise ValueError('Missing, empty or out-of-directory recording segment')
        sources.append((take,src))
    out=Path(destination).resolve()
    if out.exists():raise ValueError('Import destination must be new; preserve previous imported versions')
    out.mkdir(parents=True)
    result={'project':data.get('project'),'source_manifest':str(manifest),'status':'importing','clips':[]}
    write(out/'import.json',result)
    for index,(take,src) in enumerate(sources,1):
        dest=out/f'segment-{index:03}.mp4';temporary=out/f'.segment-{index:03}.partial.mp4'
        # MediaRecorder WebM frequently lacks a usable duration/seek header. Re-encode
        # each take independently; never concatenate complete WebM byte streams.
        cmd=[binary('ffmpeg'),'-hide_banner','-loglevel','error','-nostdin','-fflags','+genpts','-i',str(src),
             '-map','0:v:0','-map','0:a:0?','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2,setpts=PTS-STARTPTS',
             '-af','asetpts=PTS-STARTPTS','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',
             '-c:a','aac','-movflags','+faststart',str(temporary)]
        completed=subprocess.run(cmd,capture_output=True,text=True)
        if completed.returncode:raise ValueError(f'Could not normalize {src.name}; retain the original and inspect for an interrupted/incomplete final chunk')
        info=probe(temporary)
        if not info['video_codec'] or info['video_duration']<=0:raise ValueError(f'No valid video duration after normalizing {src.name}')
        temporary.replace(dest)
        result['clips'].append({'src':dest.name,'source':src.name,'duration':info['video_duration'],'width':info['width'],'height':info['height'],'has_audio':info['has_audio'],
                                'source_take_complete':bool(take.get('complete'))})
        write(out/'import.json',result)
    result['status']='normalized-needs-content-review';write(out/'import.json',result)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--manifest',required=True);parser.add_argument('--out',required=True)
    args=parser.parse_args();print(json.dumps(import_recording(args.manifest,args.out),ensure_ascii=False,indent=2))


if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,OSError,subprocess.SubprocessError) as error:print(str(error),file=sys.stderr);sys.exit(2)
