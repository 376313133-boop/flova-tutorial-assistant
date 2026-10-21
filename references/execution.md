# 执行与计划格式

所有命令从 Skill 目录调用，或使用脚本的绝对路径。工程目录由当前项目决定，工具路径通过环境/参数指定，不写进 Skill 模板。

```sh
python3 scripts/tutorial.py doctor
python3 scripts/tutorial.py init --project /path/tutorial-project --style brand-precision
python3 scripts/tutorial.py inventory --project /path/tutorial-project /path/user-materials
python3 scripts/tutorial.py sfx --kind confirm --out /path/tutorial-project/audio/confirm.wav
python3 scripts/tutorial.py validate --plan /path/tutorial-project/plan.json
python3 scripts/tutorial.py render --plan /path/tutorial-project/plan.json --preview
python3 scripts/tutorial.py render --plan /path/tutorial-project/plan.json
python3 scripts/tutorial.py qa --src /path/tutorial-project/exports/final.mp4 --out /path/tutorial-project/review
```

doctor 只检查软件，不安装或登录。找不到程序时可设置 `FFMPEG_BIN` 与 `FFPROBE_BIN`，或把其目录加入 PATH。包内脚本为 Python 标准库；不需要个人虚拟环境。

## 计划

`plan.json` 是实际剪辑决定，不是要求用户手工填写的表单。Agent 依据材料编写。路径相对 plan 文件解析，也可使用用户授权的绝对素材路径。

```json
{
  "schema_version": "1",
  "style": "brand-precision",
  "canvas": {"width": 1920, "height": 1080, "fps": 30, "background": "#050506"},
  "font_family": "PingFang SC",
  "clips": [
    {"id": "open", "kind": "title", "duration": 2, "text": "先看结果，再跟着做。"},
    {"id": "operation", "kind": "screen", "src": "media/recording.mp4", "in": 3, "duration": 7, "fit": "contain", "keep_audio": false,
     "camera": [{"t": 0, "zoom": 1, "x": 0.5, "y": 0.5}, {"t": 2, "zoom": 1.8, "x": 0.64, "y": 0.42}, {"t": 5, "zoom": 1.8, "x": 0.64, "y": 0.42}, {"t": 7, "zoom": 1, "x": 0.5, "y": 0.5}]},
    {"id": "result", "kind": "case", "src": "media/result.mp4", "in": 0, "duration": 4, "fit": "cover"}
  ],
  "audio": [
    {"role": "narration", "src": "media/voice.wav", "at": 0, "in": 0, "duration": 13, "gain_db": 0},
    {"role": "sfx", "src": "audio/confirm.wav", "at": 8.5, "duration": 0.4, "gain_db": -4}
  ],
  "titles": [{"at": 2, "duration": 3, "text": "选中当前版本", "anchor": "top-left", "font_size": 52}],
  "overlays": []
}
```

以上文件名是格式示例，实际执行前必须换成清点到的文件和核对过的时间。

- `clips` 按顺序拼接；`duration` 是输出秒数，必须对应整数个输出帧（帧数 / fps），`in` 是源素材起点，`speed` 默认 1，支持 0.25–4。不能超过源素材有效范围，不默认循环补足。
- `kind: title` 生成底色标题段；其他 kind 用于编辑语义，执行器按源媒体处理。图片可作为静态镜头。
- `fit: contain|cover` 分别完整保留源画幅/填满裁切；`contain` 不会补回源文件已缺失的内容。直接使用实录时默认保留完整 UI，除非已设计聚焦；先按 [边界规则](framing-and-bounds.md) 选材和取景，不留下半个 Logo、图标或字。仅在符合短段价值点/核心交互演示条件时制作辅助 UI，不能用 `cover` 强裁或全片重建回避选材问题。
- `keep_audio` 默认 false。保留源声音时可用 `source_gain_db` 调整。
- `camera` 中 `x/y` 是适配到输出画布后的归一化中心，`zoom` 1–3。关键帧以输出片段时间计算、平滑插值；输入参数须按真实控件位置决定。
- `audio` 的 at/in/duration 分别是时间线位置/源起点/使用时长。支持 gain_db、fade_in、fade_out。music 只在明确加入计划时启用，默认音量较低，并在 narration 范围内进一步降低。
- `titles` 的 anchor 为 center/top-left/bottom-left/bottom，坐标和字号以正式画布像素表示；预览自动等比缩放。可指定 x/y/color。使用本机可用字体；字体目录通过 `font_dir` 指定。中文缺字时应提供有权使用的中文字体。
- `overlays` 引用透明动画、图片或出镜视频，包含 src/at/in/duration/x/y/width/height。坐标是正式画布像素。未指定尺寸时使用整个画布。

执行器只实现剪辑决定，不自动从文案推断控制坐标。字幕可由 Agent 将已核对的句子/时间写为 titles；需要密集字幕时保持统一字号与安全区域。

## 分析与成本

`silence --src voice.wav --out silence.json` 标出静音候选；它不是语音转录，也不能决定语义切点。避免对无变化录屏重复转录或逐帧分析。使用低清代理、关键时刻截图与内容锚点；只把当前段落、选中的风格卡和相关素材交给模型。

片段缓存在工程 `.cache/segments`，由源路径/大小/mtime 与剪辑参数决定。修改某个片段只重做相关缓存；合成与音频会重新生成。异常修改源文件且保留原 mtime 时，应清除相关缓存。

## 工程交付

```sh
python3 scripts/tutorial.py bundle-project --plan /path/tutorial-project/plan.json --out /path/tutorial-delivery
```

该命令复制计划引用的媒体，并改为相对路径。另把已完成的包装 HTML 源、brief 和修改说明复制到交付目录。字体目录只在已确认分发权限时收集。禁止把创作者的媒体放回 Skill 发布包。

## 空间包装

新项目默认品牌简约·精密，以中性黑底和局部虚化彩光动效包装实机。二维 camera 字段用于录屏的平滑局部聚焦；需要横移、弧线、层间视差或素材透视时，按 camera-space.md 编排独立 HTML 空间镜头，再通过 render_motion.mjs 导出并接入剪辑计划。不能把二维缩放称为已完成三维相机调度。

根据 recording-to-ui.md 依次考虑录屏包装、截图讲解，最后才是具体价值点或核心交互的短段搭建演示。现有计划记录源文件/时间段、采用方式、演示作用及回到实机/结果的交接；这些是创作记录，不是执行器的新字段。辅助原生组件与状态由 Agent 编写，现有 HTML 导出器负责渲染。使用虚化录屏背景时保留视频时间映射；移动工程时同时收集组件源码和引用资产。

旧工程可继续读取原 style 字段，但新的视觉决定按用户最新要求与当前默认方向执行，不从旧预设库恢复场景。

`init` 默认把 `canvas.background` 设为中性黑 `#050506`；用户明确指定其他颜色时采用其选择，已有工程不会被重新初始化覆盖。这个字段只生成底色，不生成彩光。按 [黑底与局部虚化彩光](style-quality.md#黑底与局部虚化彩光) 在独立 HTML 背景层编排缓慢漂移、扩散或呼吸，再导出接入计划；不能把纯色底当作已完成的背景动效。

视频与音频分别使用各自的流时长校验。文件总时长不能代表视频画面长度；素材范围不足时修订切点或补充证据，不用尾帧冻结填满。顺序片段按已批准的逐帧时长衔接，声音事件仍可使用毫秒时序。

默认强三维包装使用独立空间相机、素材位姿与截图高亮轨道；普通二维 camera 字段只能承担局部聚焦，不能单独满足这一默认要求。正式导出前在现有审片记录中先完成源素材与整个运动轨迹的边界检查，再完成 quality.md 的反 PPT 动效自检。`validate` 和 `qa` 检查技术信息，不会自动判定语义缺边、运镜、卡片动作、截图讲解或背景彩光已达标。

## 可选音频生成与页面录制

缺少旁白或需要 BGM 时按 [Flova 音频](flova-audio.md) 先检查最新 CLI/账号模型，再创建独立音频项目。`scripts/flova_audio.py prepare` 只在本地分段与准备请求；`run` 交给正式 CLI 执行和等待，不能把 prepared 状态当作已生成。

需要采集实机时按 [页面录屏](browser-recording.md) 安装可选扩展。暂停/恢复会产生独立 WebM 片段与录制清单；仍用 `inventory` 核对实际媒体流后加入剪辑计划。扩展不是浏览器自动化工具，页面操作继续使用 Agent 已有浏览器工具。
