# 精准页面录屏与多项目协作

优先复用用户已有清晰录屏。需要新录实机时，包内 `recorder/` 提供**可选、未上架** Chrome Manifest V3 扩展；它是此 Skill 的采集工具，不依赖其他 Skill，也不要求把全部桌面录下来再裁切。只调用 tabCapture，不调用 desktopCapture、屏幕选择或麦克风接口。画面范围是所选标签页的**可见内容区**，不含浏览器地址栏、其他窗口或桌面，不是整张滚动长页。采集按页面实际宽高保持画幅，像素倍率最多 2、长边最多 3840；不会用显示器比例硬套出黑边。

## 安装与开始

Chrome 116+：打开 `chrome://extensions`，开启开发者模式，选择“加载已解压的扩展程序”，选本包 `recorder` 目录。固定扩展，打开要录的 Flova 项目页，点击扩展后点“录制当前 Flova 标签页”。默认关闭页面声音，不采麦克风；有案例声音需求再开“保留页面声音”。扩展不读取 Flova token、登录密码或正文输入。

Chrome 要求用户针对待捕获标签页触发扩展。不能承诺安装 Skill 后 Agent 就能绕过点击授权、后台批量开启任意标签页。每个目标页首次启动需单独点选；之后会话保持在扩展后台。不开录其他标签页，不切换系统屏幕采集。

多个项目分别在各自标签页启动后，同时保留独立 MediaStream、录制状态、空闲计时与文件。单个标签页拒绝重复启动。暂停 A 不影响 B；每个项目独立导出。并发数量、后台页绘制帧率和编码质量取决于机器与 Chrome，不能声称无限并发或保证所有后台页持续满帧。先以 2 个项目试录并审看；后台页有节流、冻结或内容未重绘时改用分窗/顺序录制，不生成假过程补帧。

## 主动暂停，避免录无效等待

Agent 在录制前列出要拍的操作、反馈与结果。开始后先保留约一秒稳定建立画面，再操作；结果出现后留出可读时间，再暂停或结束。等待模型生成、长上传、准备文案、登录/账号切换、找资料等阶段提前暂停；这些不是持续录制后快放的默认路线。

可通过扩展弹窗对每个会话暂停/恢复/停止。在已经授权录制的同一页，浏览器自动化工具也可执行下面的控制消息：

```js
window.postMessage({type: 'FLOVA_TUTORIAL_CAPTURE', action: 'pause'}, location.origin);
// 确认重要操作/反馈即将开始后恢复：
window.postMessage({type: 'FLOVA_TUTORIAL_CAPTURE', action: 'resume'}, location.origin);
// 静态结果需要较长阅读时明确保留，最多 120 秒，可按真实需求续期：
window.postMessage({type: 'FLOVA_TUTORIAL_CAPTURE', action: 'hold', seconds: 12}, location.origin);
```

暂停/恢复后读取弹窗或录制状态，确认动作已生效，再执行关键操作；页面消息本身不是完成确认。页面桥接只能暂停/恢复已被授权的同页会话，不能启动、导出、读文件或控制别的标签页。用户手动暂停具有优先级，页面 activity/Agent 恢复不能解除它。

默认 10 秒没有点击、输入或滚动即关闭当前片段，并进入空闲暂停；可选 20/60 秒。真实用户交互恢复空闲暂停，鼠标小幅移动不算活动。播放中的页面音视频暂时延长保留，普通动画或 loading 转圈不算有效输入。这个机制只是空闲兜底，不是自动理解所有产品状态；Agent 的显式暂停更准确，不要依赖 DOM 一直变化来判断“有价值”。

页面加载/导航会暂停，避免跨项目串录。加载完成后核对仍是同一项目，再从弹窗恢复并重新注入同页控制；项目 ID 变了必须停止旧会话并新开。页面尺寸改变也会暂停，需停止并新开会话以匹配新画幅；不能沿用旧尺寸继续录出黑边或裁切。关闭项目标签页会停止并保留已写入本地的数据。

## 保存、恢复与剪辑

**暂停结束一段独立 WebM，恢复开新一段。** 不把多个完整 WebM 的字节直接拼接成假成片，也不依赖 MediaRecorder.pause 的时间戳实现来隐藏长等待。每个片段逐秒写入扩展本地 IndexedDB，停止后点“导出片段”，输出到浏览器下载目录 `Flova-recordings/项目ID-会话ID/`：

- `segment-001.webm` 等独立录屏片段。
- `recording.json`：项目/标签页标识、片段顺序、状态、暂停原因与时间记录。

实际录制超过 30 分钟会结束当前会话以控制体积，可另开会话。浏览器/扩展重启后可从弹窗导出已保存的中断会话；最后不足一个写入周期的内容可能丢失，中断片段可能需要修复。导出完成前不清理本地数据；清理按钮会删除该会话的扩展存储，不能当作“停止”。磁盘配额/编码失败要显式报错，不能宣称已保全原片。

浏览器 WebM 可能没有可靠的时长/寻址头。导出后先用包内工具逐段整理为可寻址 MP4，再清点：

```sh
python3 scripts/recording_import.py --manifest /path/Flova-recordings/project/recording.json --out /path/tutorial/recordings/normalized
python3 scripts/tutorial.py inventory --project /path/tutorial /path/tutorial/recordings/normalized
```

导入工具仅访问清单同目录的独立片段，输出到新目录，保留原始 WebM；遇到中断坏片会报错并保留已成功整理的结果。按片段的真实媒体时长、尺寸和音轨剪辑，不把 metadata 的墙钟估值当帧准确时间。检查暂停前后 UI 连续性、首尾帧、后台卡顿和四边完整性。不直接 concat 不同编码/画幅的字节。

## 依据与验证边界

Chrome 官方文档确认了用户触发、标签页捕获、Chrome 116+ service worker 到 offscreen 的通路；多项目状态与分段保存由本工具实现。它不证明某台机器的并发帧率：

- [Chrome tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- [页面音视频录制](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)
- [Offscreen 文档](https://developer.chrome.com/docs/extensions/reference/api/offscreen)

扩展无需服务器、远程脚本、账号或网络上传；首次加载、权限与真实后台捕获仍要在使用者自己的 Chrome 验证。合成媒体的并发/暂停测试不能冒充用户登录态 Flova 项目的实录验收。
