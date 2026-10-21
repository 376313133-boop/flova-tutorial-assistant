# 安装与独立试跑

将 flova-tutorial-assistant 整个目录放进 Agent 支持的 Skills 目录。Codex 常见位置为用户目录下 .codex/skills/。调用 $flova-tutorial-assistant 并提供素材目录、目标、脚本/配音与偏好；可明确说明只使用这个 Skill。

默认品牌简约·精密：中性黑底与局部虚化彩光动效，明显三维运镜、动态高亮和独立卡片动作。优先录屏包装、其次截图、最后短段核心交互演示，导出前检查源素材缺边、运镜全过程裁切和 PPT 感。纸感拼贴、手绘白板、卡通和等距流程仅作为备用建议。包内没有预设场景、样片时间线或风格图库。

基础剪辑需要 Python 3.9+、FFmpeg、FFprobe。空间视频包装另需 Node、Playwright 与 Chromium；这些是软件工具，不是其他 Skill。安装包不带私人素材、账号或第三方软件二进制。

先运行 doctor 检查环境。摄影机和三维素材调度按当前内容设计，使用包内空间舞台与逐帧导出器。音效默认可用，音乐默认关闭。

执行器经过合成素材测试；真实教程仍需核对剪辑判断、旁白/音效时序与最终视觉质量。

可选 Flova 音频生成：安装官方最新发布 CLI，登录账号，新安装推荐 `flova profile api use auto` 跟随账号当前版本，再运行 `python3 scripts/flova_audio.py doctor`。旧协议项目不迁移。详见 [旁白与配乐](references/flova-audio.md)。

可选精准录屏：Chrome 116+ 打开 `chrome://extensions`，加载本包 `recorder/` 目录；每个 Flova 目标标签页首次点击扩展启动。不同项目分别录制、暂停和导出独立片段，默认不录麦克风或页面音频。详见 [页面录屏](references/browser-recording.md)。
