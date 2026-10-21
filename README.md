# Flova教程剪辑包装小助手

为 Flova 教程创作者准备的独立 Agent Skill。把录屏、解说脚本、配音、案例图片/视频和出镜素材，整理成重点清楚、节奏顺畅、有设计感的教程视频。

[下载最新版 Skill](https://github.com/376313133-boop/flova-tutorial-assistant/releases/latest/download/flova-tutorial-assistant.zip) · 当前版本 **0.6.0**

## 能做什么

- **Flova 内容指导**：内置产品功能、使用路线、亮点与价值知识，帮助选题、梳理解说和设计真实案例，讲清“有什么用、怎么做、得到什么”。
- **教程剪辑**：清点素材，围绕核心价值点安排结构，对齐脚本与配音，完成粗剪、精剪、字幕和画中画。
- **录屏包装**：聚焦真实操作，通过局部放大、动态高亮和交互引导，让观众看清关键步骤。
- **空间动效**：设计三维摄影机调度、素材透视、层间视差和独立卡片动作，减少翻页式的 PPT 感。
- **声音处理**：混合旁白与音效，可生成基础交互音效；音乐默认关闭，也可按需使用创作者提供的音乐。
- **Flova 音频生成**：独立创建教程旁白项目，默认 Seed Audio 1.0 多模态口播；可分析博主声音并选取参考片段，也可按需生成教程背景音乐。
- **精准页面录屏**：附可选 Chrome 扩展，只录点选的 Flova 标签页；多个项目独立管理，支持主动暂停、空闲暂停和可恢复分段保存。
- **检查与交付**：检查素材边界、裁切和动效定位，先出预览再导出，保留剪辑计划与可继续修改的工程材料。

默认采用品牌简约视觉：中性黑底、局部柔和彩光，配合清楚的文字层级与空间运镜。也可推荐纸感拼贴、手绘白板、卡通、等距流程四种方向。风格是设计原则，不是固定场景模板；配色和具体动作按内容调整。

## 安装与使用

以 Codex 为例，将仓库克隆到 Skills 目录：

```sh
git clone https://github.com/376313133-boop/flova-tutorial-assistant.git ~/.codex/skills/flova-tutorial-assistant
```

在 Agent 中调用：

```text
使用 $flova-tutorial-assistant，只使用这个 Skill。
素材在我提供的文件夹里，请结合录屏、脚本和配音制作 Flova 教程。
先梳理核心价值与剪辑节奏，保留真实操作，加入重点高亮和空间动效。
只配音效，不配音乐；先输出预览供我修改。
```

基础剪辑需要 **Python 3.9+、FFmpeg、FFprobe**；HTML 空间动效导出另需 **Node.js、Playwright 和 Chromium**。不依赖其他 Skill，不捆绑第三方软件、私人素材或账号。详见 [安装说明](INSTALL.md) 与 [执行文档](references/execution.md)。

可选音频生成需要登录最新发布的 Flova CLI，使用独立音频项目与账号可用模型，生成会消耗相应额度。新安装推荐 API 跟随账号当前版本（`flova profile api use auto`）。见 [旁白与配乐](references/flova-audio.md)。Chrome 录屏扩展从本包 `recorder/` 加载，未在商店上架；每个待录标签页首次启动须由用户点击。见 [录屏安装与使用](references/browser-recording.md)。

已通过 Git 克隆安装的用户，可在该 Skill 目录执行 `git pull --ff-only` 更新；若有自己的修改，先保存后合并。用 ZIP 安装的用户从上方固定“最新版”入口下载，替换旧 Skill 文件夹；先备份个人改动，项目素材留在项目目录。不要把多套不同版本装成多个同名 Skill。

Skill 提供制作指导和本地工具，需要具备文件与命令执行能力的 Agent 配合使用。最终剪辑、动效和声音仍需观看实际预览验收，技术检查不代表审美质量已通过。

## 许可

代码与本仓库原创文档采用 [MIT License](LICENSE)。Flova 品牌、产品 UI 和创作者提供的素材不在此授权范围内，使用时应具备相应授权。详见 [资源说明](RESOURCE-NOTICE.md)。
