# 阿瓦里上传包

阿瓦里（Awari / Oware）双人播种棋，游戏 ID `online.awari`，版本 `1.0.0`。采用 Abapa 玩法：两排各六坑、每坑四子、逆时针播种、跨圈跳过原坑、末子触发二/三子连吃、吃光对方则取消整串吃子，以及空侧必须喂子。先收获至少 25 子获胜；24:24 平局。

为线上残局提供确定性结束：同一棋盘、得分及行动方第三次出现，或连续 200 手无人吃子时，双方收取各自一侧余子并比较得分。这两项是本包的线上裁定约定，不宣称所有赛事统一采用。无计时、悔棋、额外回合或向得分仓播种。

在项目根目录打包：

```powershell
node scripts/package-awari.mjs
```

生成 `dist/game-packages/awari-1.0.0.zip`，根目录仅 `game.json`、`server.js`、`client.html`。`server.txt` 是规则源码，打包时改名；无 imports、宿主脚本或外部网络依赖。原创 SVG 图标/封面通过本机 Playwright Chromium 转成包内 PNG，每图受平台大小限制；固定 ZIP 时间戳，生成物不提交 Git。

从「更多 → 管理员后台 → 游戏管理 → 上传游戏 ZIP」选择生成文件，检查并审核上架后，大厅才会出现阿瓦里。Git 推送和服务器源码同步不会自动安装数据库内的在线包。同版本不可覆盖，规则或桌面更新必须提升游戏包版本；旧局锁定原版本。

## 对局与桌面

创建双人房间，邀请另一位真人加入准备，或给空座位添加基础脚本 AI 后开局。所有动作沿用平台身份、权限、revision、requestId、事务、恢复和回放链路；规则只在有界 QuickJS 内执行，桌面在 sandbox iframe 中接收本人 View 与投影事件，不导入服务器状态或规则源码。

本人六坑始终在下排，座位 1 对应 A–F，座位 2 对应 G–L。选择亮边非空坑后，棋盘标出每坑将播入的数量、末子落点和可吃坑，文字说明预计收获；点击「确认播种」才提交。忙碌与局面变化清除旧草稿；明确拒绝后可以重新选择。数字是准确数量，种子装饰最多显示八粒，不代表完整子数。支持键盘原生按钮操作、规则弹窗焦点返回与减少动态效果。桌面按内容报告高度，手机允许页面自然滚动。

规则 View 提供完整合法候选；基础脚本优先吃子与减少对方立即反吃，不承诺专业棋力。可以复用平台已配置的模型 AI，但真实外部模型供应商不作为本包验收范围。三次重复历史与无吃子计数随存档持久化，重启不重置；公开 View 不暴露内部历史数组。游戏无隐藏棋子。

本包没有平台音效、图包切换、互动教程或独立成长系统。在线 ZIP 当前不接入平台胜者/成绩摘要，最终得分由本游戏桌面展示，原参与者可查看本人回放。

## 维护与验证

```powershell
pnpm test tests/unit/awari-package.test.ts
node scripts/package-awari.mjs
pnpm exec playwright test --config playwright.awari-ui.config.ts --output .data/awari/ui
pnpm typecheck
pnpm lint
pnpm build
```

规则测试直接使用生产同款有界 QuickJS；专项浏览器回归使用真实 `PackageBoard`、平台样式、sandbox/CSP 与消息桥，但不代替真实 HTTP、数据库与房间验收。真实集成文件为 `tests/integration/awari-package.test.ts`，真人/脚本 AI 联机文件为 `tests/e2e/awari-package.spec.ts`，必须通过项目原准备脚本使用独立测试库串行执行。

`test:integration` 自带目录过滤器，追加单文件会变成并集。局部验收使用临时 Vitest 配置把 `include` 限定为对应文件，再传给原脚本 `--config`；不要因此更改生产代码或关闭测试隔离。实际本轮命令、结果与环境限制见 [开发进度](../../docs/progress.md)。

规则参考：[Aualé 的 Oware 玩法](https://auale.joansala.com/en/how-to-play-oware/)，[PlayAwale 的规则说明](https://playawale.com/en/rules.php)。采用自主实现和原创几何图像，不分发第三方美术或程序。
