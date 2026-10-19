# 摄影机与素材空间

默认采用强空间感三维调度，相机位置、观看目标与素材自身运动分开；以真实素材的位置、关系和用途决定明显的前后推进、横移、弧线或拉远路线。近远层必须有可辨认的相对变化，不以二维页面切换、统一缩放或静态倾斜替代。工具只提供坐标和关键帧，不提供场景预设。

先按 [录屏、截图与交互演示](recording-to-ui.md) 选择录屏包装、截图，或最后才采用的短段交互演示。空间相机不能修复模糊字形与混乱构图，也不能成为整片搭建 UI 的理由。真实画面在后、明确的交互信息在前时，可通过距离、适度背景虚化与视差建立主次；演示完成后恢复实机过程。窗口、参考与结果可各设轨道，不仅是整屏倾斜缩放。

## 独立空间舞台

将 `assets/spatial-stage.js` 复制到当前项目，通过普通 script 引入。它提供 CSS 3D 透视相机和可放置真实录屏、视频、图像、UI 的平面。没有第三方 JS 依赖。

```js
const stage = new FlovaSpatial.SpatialStage(document.getElementById('stage'), {
  width: 1920, height: 1080, focalLength: 1400,
  camera: {position: [0, 0, 1400], target: [0, 0, 0], up: [0, -1, 0]}
});
stage.addPlane({id: 'footage', element: materialElement, width: 1200, height: 675,
  position: [0, 0, 0], rotation: [0, 0, 0]});
// Use actual shot decisions for positions and timings; this is API syntax only.
stage.track('camera', 'position', cameraPositionKeys);
stage.track('camera', 'target', cameraTargetKeys);
stage.track('footage', 'position', materialPositionKeys);
stage.track('footage', 'rotation', materialRotationKeys);
window.seek = t => {
  stage.seek(t);
  const target = stage.elementAnchorStage(materialTargetPoint);
  pointer.style.left = target.x + 'px';
  pointer.style.top = target.y + 'px';
};
```

工程必须自行定义 materialElement、materialTargetPoint、关键帧与指针。这里的 materialTargetPoint 是放在目标位置的零宽高、无边框/内边距的 DOM 定位点；不能把有面积的倾斜控件外接矩形当作真实投影。关键帧格式：`{t: 秒, value: 数值或三维数组, ease: 'smoother'}`。ease 作用于该帧到下一帧；支持 linear/smooth/smoother/in/out。重复值的间隔形成停留；rotation/roll 使用短角度插值。

## 坐标与镜头

世界原点在画布中心，X 向右、Y 向下、Z 向观众。单位为设计画布像素；转角为度。camera.position 是相机位置，target 是观看目标，roll 是倾角，focalLength 是透视焦距。up 是镜头贯穿使用的上方向，默认 [0,-1,0]。高俯视镜头应明确选择一致的 up（例如 [0,0,-1]），不能让它平行于观看方向；工具不会在镜头中途自动换轴。

- 相机前后移动是接近/后退，会改变不同深度的相对尺度；调整 focalLength 主要改变视角，不与前后移动混为一谈。
- 横移与 target 接力形成跟随；弧线观察同时编排相机位置与目标。不要让相机穿过素材平面或把必读文字停在侧面。
- 素材位置、旋转、尺度和透明度独立设轨道。3D 父层保持 preserve-3d，禁止给 world/camera 父级加 opacity、filter、会压平层级的 contain 或 overflow。
- outer viewport 负责裁切，world 负责透视，HUD 在正向屏幕层。单个平面可有轻微材质效果，不要用它伪造全局景深。

`worldPoint` 以整个素材面板的边框盒求归一化坐标的世界位置；`anchorStage` 返回设计画布坐标，`anchor` 返回外部 viewport 相对坐标。它们不是内嵌视频内容框的坐标；面板的边框、内边距与裁切需要换算。

`elementAnchorStage`/`elementAnchor` 使用 `getBoundingClientRect()` 的轴对齐外接矩形插值，**不会返回有面积控件的真实透视中心或四角**；即使传入 `{u:0,v:0}`，得到的也只是外接框左上角。它们适用于明确的零宽高定位点；在目标中心/四角各放一个无边框、无内边距的定位点，再分别读取。

已知素材平面的几何坐标时，优先调用 `anchorStage(id,{u,v})` 放入 stage.hud，或 `anchor(id,{u,v})` 放入外部标注层。先将源像素坐标经过等比适配/裁切、边框与内边距换算到面板边框盒坐标，再以 `u=x/面板宽`、`v=y/面板高` 分别投影四角。不要用外接矩形或中心点加固定宽高替代目标四边形。窗口变化后重算；不要用猜测坐标抵消误差。

这些 API 的 `visible` 也不是验收结论：`anchor*`/`project*` 仅判定深度大于 1，`elementAnchor*` 仅检查当前元素的基本显示状态与布局框。它们不保证对象位于画幅内、未被祖先遮罩裁切或未被其他层遮挡。须按 [边界检查](framing-and-bounds.md) 单独核对投影范围、源内容、遮罩与实际输出。

## 运动材料

img、录屏和案例视频都可放到面板内。视频必须使用 [导出契约](animation.md) 的时间映射，逐帧同步后再截图。平面透视、遮挡和视差可以构成可信的素材空间，但没有自动深度分割、真实体积或物理灯光；需要这些时应在当前项目另行实现并验证，不能靠声明替代。

默认让层间距离与视差明显可见，再按信息分配运动力度；不要每个镜头都沿同一轴推进。编排时明确相机的空间起点、中段与落点，区分 dolly 前后位移与 focalLength 变化，不能把二者都写成整屏 scale。关键操作阶段回到清楚的朝向，真实结果观察允许停稳；转场保留对象身份、方向或形态的接力。截图高亮与卡片动作见 [具体编排](screenshot-motion.md)。

舞台的边框已纳入外部坐标与 HUD 坐标换算。不要给 root 或外部父级另加 CSS 整体变换来充当摄影机；相机调度使用独立轨道。

每段按 [边界检查](framing-and-bounds.md) 声明整窗/特写范围，检查四角与必读内容在整条轨迹上的投影和遮挡。中心在画面内不代表边缘安全，外框在画面内也不代表源素材没有缺字。遇到越界先调整机位、观看目标、平面尺寸和位置，并复查中间极值；保持空间运动，不用父层裁切偷偷丢掉内容。

黑底彩光作为独立后景层使用，运动与相机/卡片分别设置。背景模糊不能作用到 world/camera 父级而压平三维结构，见 [背景规则](style-quality.md#黑底与局部虚化彩光)。
