import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave
import sys

SCRIPTS=Path(__file__).resolve().parents[1]/'scripts'
sys.path.insert(0,str(SCRIPTS))
import flova_audio as audio
from recording_import import import_recording


class AudioWorkflowTests(unittest.TestCase):
    def test_split_preserves_spoken_content_and_boundaries(self):
        text=('先选择素材。再生成多个版本，比较以后选中满意的结果！\n'+'Keep the selected version. ')*30
        chunks=audio.split_text(text,120)
        self.assertTrue(all(0<len(s)<=120 for s in chunks))
        self.assertEqual(''.join(''.join(chunks).split()),''.join(text.split()))
        with self.assertRaises(ValueError):audio.split_text('  ')

    def test_prepare_reference_prompt_is_spoken_text_only(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);src=root/'voice.wav'
            with wave.open(str(src),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000);f.writeframes(b'\0\0'*16000*4)
            (root/'references.json').write_text(json.dumps([{'src':'voice.wav','in':.5,'duration':2.5,'analysis':'synthetic test, not an actual voice review'}]))
            script=root/'spoken.txt';script.write_text('先打开 Flova，再选中当前版本。',encoding='utf-8')
            result=audio.prepare(argparse.Namespace(kind='narration',script=str(script),out=str(root/'out'),references=str(root/'references.json'),max_chars=240))
            self.assertEqual(result['status'],'prepared-not-generated')
            self.assertEqual((root/'out/round-001/model-prompt.txt').read_text().strip(),script.read_text())
            self.assertTrue((root/'out/reference-01.wav').stat().st_size>0)
            with self.assertRaises(ValueError):audio.prepare(argparse.Namespace(kind='narration',script=str(script),out=str(root/'out'),references=None,max_chars=240))

    def test_reference_limits_are_checked_before_generation(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);manifest=root/'bad.json';manifest.write_text(json.dumps([{'src':'unused.wav','duration':30}]))
            with self.assertRaises(ValueError):audio.references(manifest,root)

    def test_unreferenced_narration_and_music_are_separate(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);script=root/'text.txt';script.write_text('介绍版本生成与选择。',encoding='utf-8')
            for kind in ('music','narration'):
                audio.prepare(argparse.Namespace(kind=kind,script=str(script),out=str(root/kind),references=None,max_chars=240))
            narration=(root/'narration/round-001/model-prompt.txt').read_text()
            self.assertIn('自然生动',narration);self.assertIn(script.read_text(),narration)
            music=(root/'music/round-001/request.txt').read_text()
            self.assertIn('只生成背景音乐',music);self.assertIn('无人声',music)

    def test_run_preserves_arguments_and_delegates_once(self):
        with tempfile.TemporaryDirectory() as folder:
            request=Path(folder)/'request.txt';text='自然口播\n保留 $ 符号与 `内容`';request.write_text(text)
            args=argparse.Namespace(request=str(request),project_id='project-x',conversation_id='conversation-x',profile=None,file_from=['upload reference.json'])
            with patch.object(audio.subprocess,'run') as run:
                run.return_value.returncode=0;self.assertEqual(audio.run_round(args),0)
                command=run.call_args.args[0]
                self.assertEqual(command[command.index('--content')+1],text)
                self.assertIn('--conversation-id',command);self.assertNotIn('shell',run.call_args.kwargs)
                self.assertEqual(run.call_count,1)

    def test_doctor_does_not_publish_account_or_credentials(self):
        def fake(*args,**kwargs):
            if args[0]=='auth':return {'token_stored':True,'profile':'test','token':'private-secret'}
            if args[0]=='profile':return {'api_mode':'auto','api_version':'v3','credentials':'private-secret'}
            return {'models':[{'model_key':'audio_seed_audio_1_0','model_name':'Seed-Audio 1.0','available':True,'capabilities':[{'capability':'MultiModalToAudio'}]}]}
        with patch.object(audio,'cli',side_effect=fake):
            result=audio.doctor(argparse.Namespace(profile=None));self.assertNotIn('private-secret',json.dumps(result))

    def test_import_rejects_path_escape_and_running_session(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);manifest=root/'recording.json'
            for state,name in [('recording','segment-001.webm'),('stopped','../escape.webm')]:
                manifest.write_text(json.dumps({'format':'flova-tab-recording-v1','state':state,'takes':[{'filename':name}]}))
                with self.assertRaises(ValueError):import_recording(manifest,root/'out')


if __name__=='__main__':unittest.main()
