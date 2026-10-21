# Flova 旁白与教程配乐

这是本 Skill 的可选音频制作路线，直接调用公开 `flova` CLI，不加载其他 Skill。基础本地剪辑仍可独立运行。没有生成需求或已有合适配音时，不强行创建云端项目。

## 入口、能力与项目

先执行 `flova version`、`flova auth status`、`flova profile api show`，再运行 `python3 scripts/flova_audio.py doctor`。默认面向最新发布 CLI 和账号当前版本；新安装推荐 `flova profile api use auto`，跟随账号运行环境，不硬编码 V2 地址。修改已有创作者的默认配置前要有其授权；明确要求旧协议的项目保留原路由。CLI 更新使用 `flova update --check` / `flova update`，不另造安装来源。

在 V3 下查当前账号模型：

```sh
flova model list --media-type audio
flova model describe audio_seed_audio_1_0 --media-type audio
flova model list --media-type music
```

`audio_seed_audio_1_0` 是 2026-10-21 实查到的 Seed-Audio 1.0 key，不保证未来不变。先从目录找到模型，再核对当前可用性、模式、参考输入和限制；默认请求 **Seed Audio 1.0 / MultiModalToAudio**。不要把显示名称编造成模型参数，也不要捏造 `flova audio generate` 等命令。模型、模式不可用时说明具体限制，不能静默换模型或把普通 TTS 冒充多模态生成。

为每个教程新建一个**独立的音频素材项目**，与被演示产品项目隔离；旁白修订和可选 BGM 复用这个音频项目，不反复新建。已有音频项目时继续使用。创建 V3 对话并保留返回的实际 ID：

```sh
flova project create --name "教程名称 · 旁白与声音" --description "仅制作外部教程剪辑所需音频"
flova conversation create "$PROJECT_ID" --title "教程旁白"
```

项目、对话、run/recovery ID 和最终资源 ID 记录在当次本地教程工程中，不写回 Skill。用实际返回的 project_url 交付入口，不拼造项目链接。音频项目只生成旁白/配乐；不生成画面、剪辑时间线或导出成片。

## 自然口播与博主参考

把文案整理成可读的口播：保留事实与产品名，减少书面长句，按实际操作划分语义段落；不要自动增加产品承诺。需要实质改写时先让创作者看可复核的文案。自然感来自停连、重音与合适语速，不能机械加感叹词、假笑或营销口号。

有博主音频时主动分析其口语节奏、语速、停顿、音高变化、尾音、清晰度和背景噪声，区分“参考说话方式”与用户明确要求的声音参考。不要仅凭文件名断言音色，也不要擅自把任意他人声音作为克隆目标。选干净、单人、无音乐/音效、无截断词的片段；分析结论必须来自实际试听/工具证据，没有听觉工具就保留待确认。

2026-10-21 当前目录支持至多 3 段参考音频，单段 2–30 秒；本工具保守要求 **2 秒到不足 30 秒**。当前静态制作指引要求 prompt 与引用标签合计不超过 2048 字符、输出不超过 120 秒；这些上限仍须结合执行时能力响应与实际生成结果核对，不承诺一段一定达到指定时长。长教程按语义分段，复用相同参考以维持声音一致。

**有参考音频/图片或原生 Seed voice ID 时，传给音频模型的 prompt 只含精确朗读正文。** 口播风格分析和任务说明留在 Agent 编排层，不能混进该模型输入；参考音频不与图片或 voice ID 混用。无参考时，prompt 同时说明口播表现与精确正文。旁白不要混入音乐、SFX 或背景环境，方便后期独立混音。

先在本地准备，不上传、不消耗生成额度：

```sh
python3 scripts/flova_audio.py prepare --kind narration --script /path/口播.txt --out /path/tutorial/audio/narration-round-01
```

有声音参考时，由 Agent 在试听后写一个当次工程的 JSON 数组：

```json
[{"src":"博主音频.wav","in":12.4,"duration":12,"use":"voice-reference","analysis":"此段单人、无配乐，停连自然；按实际试听填写"}]
```

然后加 `--references /path/reference-selection.json`。`src` 相对该 JSON 解析。工具准确截取片段并验证音频流；不自动识别好片段、不做人声分离。`--max-chars` 只是分段辅助手段，实际时长和断句仍由 Agent 核对。

对需要传入的正文/参考先 `flova upload /path/file --project-id "$PROJECT_ID"`，保存上传 envelope 为当次本地工程文件，不能把解析出的签名 URL 打印到聊天或放进仓库。需要留存原始 envelope 时保留在工程本地；公开日志只记资源 ID 和文件名。

```sh
python3 scripts/flova_audio.py run --project-id "$PROJECT_ID" --conversation-id "$CONVERSATION_ID" --request /path/narration-round-01/round-001/request.txt --file-from /path/upload-reference.json
```

`run` 仅把准备好的请求与附件交给正式 `flova run`，stdout/stderr 原样保持附着；没有另一个轮询器。它会真实生成并消耗账户额度，只在当前制作授权内执行。无参考时省略 `--file-from`。正文有多段时逐段核对，先确认短样再扩展；用户已明确授权整批制作时可在核对后继续，不重复询问。

## 等待、恢复与验收

保留正式 CLI 的终态 JSON：成功必须核对 terminal、完成状态与有效音频 artifact，不能把项目已创建、上传完成或预览当成已交付。CLI 自己处理等待，不用 `--no-wait`、后台轮询或并行重复 run。遇到 pending action 按实际返回选项交给用户决定，不能代批。

中断后先用 `flova run current "$PROJECT_ID"` 查同一次运行，再按该版本 CLI 的 `run result` / `run resume` 帮助恢复；保留原 conversation/stream_chat_id，不因本地超时重发。下载只选择本轮成功的 audio/music 资源；必要时用 `flova resource info "$PROJECT_ID" "$RESOURCE_ID"` 查正式资源，保存为本地非空文件后用 FFprobe 核对音频流与实际时长。

逐段试听产品名、漏字、重复、句尾、语速、情绪和参考一致性，再用真实配音时序安排画面。只返修有问题的段落，保留满意版本。分段间调整自然停顿，不用大幅变速把配音硬塞进原画面；原始录屏和画面节奏随口播合理调整。下载后把旁白写为计划中的 `role: narration`。

## 教程背景音乐

音乐仍是可选项。创作者要求配乐时，可主动走生成路线，无需一定让他先提供文件；明确“不要音乐”时完全跳过。可以和旁白共用独立音频项目，分开对话或轮次，只交付干声旁白与纯音乐两条素材。

```sh
python3 scripts/flova_audio.py prepare --kind music --script /path/配乐需求.txt --out /path/tutorial/audio/music-round-01
```

根据教程内容、目标时长和解说密度选择节奏与配器：轻量、无人声、无歌词、稳定铺底、不过分抓耳，不模仿指定艺人。2026-10-21 当前账号可用 Suno 与 Mureka；实际执行从最新 music 目录选可用模型，不能把 Seed Audio 旁白路径当作 BGM 专用模型。生成短样试听，检查突兀鼓点、抢词、循环接缝与片尾收束。只在需要时制作延展或循环，不默认重复有明显旋律起伏的段落。

配乐放 `role: music`，旁白始终优先，按讲话段落降低音乐，点击/完成音效保留独立轨道。生成成功不等于最终混音验收通过，也不额外承诺平台或版权条款以外的使用权。
