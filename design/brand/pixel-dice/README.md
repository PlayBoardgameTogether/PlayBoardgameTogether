# PlayBoard · 像素跃动骰子

2026-10-25 制作的独立品牌资产提案，用于项目头像或 Logo。奶油白骰面、琥珀色阶梯棱边、深棕方形点数，搭配像素速度线与火花，延续平台暖色像素风。

| 文件 | 用途 |
| --- | --- |
| [playboard-pixel-dice.bbmodel](playboard-pixel-dice.bbmodel) | Blockbench 通用模型，内嵌调色板和完整动画，无外部纹理依赖 |
| [playboard-dice-animated.gif](playboard-dice-animated.gif) | 512×512 深绿底动态头像，48 帧、20 FPS、2.4 秒无限循环 |
| [playboard-dice-avatar.png](playboard-dice-avatar.png) | 1024×1024 深绿底静态头像 |
| [playboard-dice-avatar-64.png](playboard-dice-avatar-64.png) | 64×64 小尺寸头像 |
| [playboard-dice-transparent.png](playboard-dice-transparent.png) | 1024×1024 透明底静态 Logo，适合叠放在其他背景上 |

## 编辑与动画

使用 Blockbench 5.2.2 创建。打开 `.bbmodel` 后进入「动画模式」，选择 `PlayBoard · Pixel Roll` 并播放。

- `DICE · animated`：阶梯骰壳、六面点数及旋转/浮动动画；骰子绕竖轴转一圈，同时侧倾并上下浮动。
- `Face 1` 至 `Face 6`：独立可编辑的点数；相对面为 1/6、2/5、3/4。
- `PIXEL SPARKS · animated`：速度线与火花，使用独立的位置和缩放动画。
- 共 30 个模型元素；骰壳采用单个网格，点数和火花采用方块。内嵌 8 色调色板。

导出图直接渲染本模型，以 128×128 原始像素画面进行最近邻放大，保持像素边缘；静态图使用动画起始姿态。后续编辑模型不会自动重生成已经导出的 PNG/GIF。

## 本轮验证与范围

已检查四个旋转相位和 64px 头像；校验 48 帧均有可见模型且保留至少 3 个原始像素边距、GIF 总时长 2400ms、无限循环、PNG 透明通道、模型内嵌调色板，以及位置/缩放首尾一致、旋转首尾相差整周。

本目录是设计资产，尚未接入网站、替换仓库头像或部署到服务器。没有产品运行代码、依赖、公开契约或数据库变化；平台版本保持 `0.17.1`，无需运行应用业务测试或构建。
