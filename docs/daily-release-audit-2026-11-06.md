# D4：官方游戏发布与安装清点

原排期 2026-11-09；2026-11-06 按用户“继续推进每日任务”提前执行。**D4 已完成清点，未发布或安装新版本。** D3 独立等待收件确认，不阻塞本项。

## 核验范围与结果

从最新 `origin/main@cdb349950d5976e396e5a9af69c4830843d23364` 建立独立工作区 `/tmp/playboard-d4-release-audit`、分支 `codex/d4-game-release-audit`；原工作区及其他任务完整保留。重新获取 main，核对官方目录、六个在线仓库的固定 main SHA、七种玩法的正式 Release 与解引用标签提交，并实际下载 **21 个附件**（七套 ZIP、release.json、SHA256SUMS）。没有用 `target_commitish: main` 充当发布源提交，没有使用 GitHub 自动生成的源码 ZIP。

七套附件的字节数、GitHub 附件 digest、发布清单与 SHA256SUMS 均一致，目录与标签/候选提交中的 `release.config.json` 的仓库、ID 和 archive 全部对齐。平台实际 ZIP 解析器和受限 QuickJS 验证 **7/7**：manifest 身份/版本、最小与最大人数初始化、序列化恢复、各席位 View/事件投影及初始合法候选/脚本兜底。这里只验证包的安装冒烟生命周期，未执行真实房间安装、完整联机对局或生产安装写入。

## 正式版本、生产版本与候选

下表的生产版本同时核对公开 `/api/v1/games` 与数据库只读一致性快照；“已安装”不表示字节与 Release 一致，摘要对照见后表。main 候选取自其规则源码在 QuickJS 内的 manifest，不从提交标题或历史记录猜版本。

| 游戏 / ID | 正式 Release | 生产已启用 | main 候选 | 后续 |
| --- | --- | --- | --- | --- |
| UNO · 休闲版 / `online.uno` | [uno-v1.2.0](https://github.com/PlayBoardgameTogether/playboard-game-uno/releases/tag/uno-v1.2.0) | 1.2.0 | 1.2.1 | 已合并头像候选，尚未正式发布/安装 |
| UNO · 毫不留情 / `online.uno-no-mercy` | [uno-no-mercy-v1.0.0](https://github.com/PlayBoardgameTogether/playboard-game-uno/releases/tag/uno-no-mercy-v1.0.0) | 1.0.0 | 1.0.1 | 已合并头像候选，尚未正式发布/安装 |
| 五子棋 / `online.gomoku` | [gomoku-v1.0.3](https://github.com/PlayBoardgameTogether/playboard-game-gomoku/releases/tag/gomoku-v1.0.3) | 1.0.3 | 1.0.4 | 已合并头像候选，尚未正式发布/安装 |
| 拉密 / `online.rummikub` | [rummikub-v1.0.3](https://github.com/PlayBoardgameTogether/playboard-game-rummikub/releases/tag/rummikub-v1.0.3) | 1.0.3 | 1.0.4 | 已合并头像候选，尚未正式发布/安装 |
| 卡坦岛 / `online.catan` | [catan-v1.0.1](https://github.com/PlayBoardgameTogether/playboard-game-catan/releases/tag/catan-v1.0.1) | 1.0.1 | 1.0.2 | 已合并头像候选，尚未正式发布/安装 |
| 波多黎各 / `online.puerto-rico` | [puerto-rico-v1.1.1](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/releases/tag/puerto-rico-v1.1.1) | 1.1.1 | 1.1.1 | 与正式发布相同，无待发布候选 |
| 阿瓦里 / `online.awari` | [awari-v1.0.0](https://github.com/PlayBoardgameTogether/playboard-game-awari/releases/tag/awari-v1.0.0) | 1.0.0 | 1.0.1 | 已合并头像候选，尚未正式发布/安装 |

**六个玩法仍缺正式发布**：UNO 两种玩法、五子棋、拉密、卡坦岛、阿瓦里。它们的 main 包含头像更新，但旧正式版本不包含这批更新；不能据 main 已合并或订阅成功宣称头像已上线。波多黎各 1.1.1 已发布、已启用且摘要一致。未合并昵称 PR 仍为独立任务，本轮不带入发布；平台 #46/#43 也保持原状。

## 精确发布来源

每行记录实际标签所指提交和同次清点 main；未发布差异通过 GitHub compare 核对，包含许可证/文档与头像批次，波多黎各无新增提交。以下为完整 SHA，避免缩写歧义。

| 游戏 | 正式标签提交 | 已核对 main 提交 | main 领先提交数 |
| --- | --- | --- | --- |
| UNO · 休闲版 | [`cb287a85f7bad8b88cf4e4b298b0af9616617764`](https://github.com/PlayBoardgameTogether/playboard-game-uno/tree/cb287a85f7bad8b88cf4e4b298b0af9616617764) | [`9ed4deba6ca230e26f9a70f4d6b8a1d07366e147`](https://github.com/PlayBoardgameTogether/playboard-game-uno/tree/9ed4deba6ca230e26f9a70f4d6b8a1d07366e147) | 5 |
| UNO · 毫不留情 | [`cb287a85f7bad8b88cf4e4b298b0af9616617764`](https://github.com/PlayBoardgameTogether/playboard-game-uno/tree/cb287a85f7bad8b88cf4e4b298b0af9616617764) | [`9ed4deba6ca230e26f9a70f4d6b8a1d07366e147`](https://github.com/PlayBoardgameTogether/playboard-game-uno/tree/9ed4deba6ca230e26f9a70f4d6b8a1d07366e147) | 5 |
| 五子棋 | [`6fee46b49071475688257ff13c51cbe60ac86af6`](https://github.com/PlayBoardgameTogether/playboard-game-gomoku/tree/6fee46b49071475688257ff13c51cbe60ac86af6) | [`6060d1391b986c3082754764b82f26c2c7750d43`](https://github.com/PlayBoardgameTogether/playboard-game-gomoku/tree/6060d1391b986c3082754764b82f26c2c7750d43) | 7 |
| 拉密 | [`f3d9237c521adc56327059abef11f590c161221d`](https://github.com/PlayBoardgameTogether/playboard-game-rummikub/tree/f3d9237c521adc56327059abef11f590c161221d) | [`021157c8b297417c9ddc856dd4509b3245d22659`](https://github.com/PlayBoardgameTogether/playboard-game-rummikub/tree/021157c8b297417c9ddc856dd4509b3245d22659) | 7 |
| 卡坦岛 | [`76291db61dae0ab2bf89ec0a7229ff92279433f7`](https://github.com/PlayBoardgameTogether/playboard-game-catan/tree/76291db61dae0ab2bf89ec0a7229ff92279433f7) | [`99054358d0e27c4e1b299b8544018ce6643ce1db`](https://github.com/PlayBoardgameTogether/playboard-game-catan/tree/99054358d0e27c4e1b299b8544018ce6643ce1db) | 7 |
| 波多黎各 | [`d206705387a92bc5942b1af5e50df180a77bc5f4`](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/tree/d206705387a92bc5942b1af5e50df180a77bc5f4) | [`d206705387a92bc5942b1af5e50df180a77bc5f4`](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/tree/d206705387a92bc5942b1af5e50df180a77bc5f4) | 0 |
| 阿瓦里 | [`4260abc7c9b5965921d29645bae38865fff04b78`](https://github.com/PlayBoardgameTogether/playboard-game-awari/tree/4260abc7c9b5965921d29645bae38865fff04b78) | [`2e4e126c8995ab8514742e3116c43b3ed7ab5e4e`](https://github.com/PlayBoardgameTogether/playboard-game-awari/tree/2e4e126c8995ab8514742e3116c43b3ed7ab5e4e) | 7 |

## ZIP 摘要与实际安装差异

**七个正式 ZIP 自身校验全部通过；其中三个生产安装包的原始摘要与同版本 Release 不同。** 查询只读取公开游戏源码/展示配置作内存比较，没有读取玩家 State、会话、邮箱或模型凭据；不输出整段源码或图片 data URL。

| 游戏 | ZIP 字节数 | 正式附件 SHA-256 | 生产安装 SHA-256 | 对照结论 |
| --- | --- | --- | --- | --- |
| UNO · 休闲版 | 208,106 | `0925f7090dd5f2ade0642d5636896e4edae86948e05bfdf7feb831ec68fa14d8` | `0925f7090dd5f2ade0642d5636896e4edae86948e05bfdf7feb831ec68fa14d8` | 摘要及全部组件一致 |
| UNO · 毫不留情 | 127,018 | `042c89158c6b83458c88478b097353e3429178613f618d2f1477d0aecfc555ca` | `042c89158c6b83458c88478b097353e3429178613f618d2f1477d0aecfc555ca` | 摘要及全部组件一致 |
| 五子棋 | 146,309 | `f6cff578f4c6134259f5fda6840d611989202613eb491a1a7b51d2a0243471d3` | `6beea4e845e588fc19e75c9388f2f9c1f250f095855a6ac7ef2f9a0c27a3b303` | 规则/桌面 CRLF 与 LF 差异；规范化后相同，规则说明/展示配置相同 |
| 拉密 | 540,809 | `e636a82e4c3ce9a2fee408f26f7c6954983d156f3ebd0eeab8d7c5fb2ceeb246` | `74ed40c9622bf7020910da2aef3334fc5eff0afdc73490017e19a08676c21ce3` | 规则/桌面/说明逐字相同，展示图配置不同 |
| 卡坦岛 | 369,798 | `ad75263c35d7660e0b20cf66cbff4c41d66d3f72f73f97600faf5c11319cef8a` | `064dee6ff712e6d404cd7aba52524d2f41a16a5e2a7f8e8ebacd6e632626e202` | 规则/桌面/说明逐字相同，展示图配置不同 |
| 波多黎各 | 1,557,169 | `c90928c8081658be8cb700ffe93efd6ce93cce4a0a643e7f1d272d59c44e8853` | `c90928c8081658be8cb700ffe93efd6ce93cce4a0a643e7f1d272d59c44e8853` | 摘要及全部组件一致 |
| 阿瓦里 | 112,245 | `0bfe356af33eddb64b545697aa121f7716a7f66fb195311be6e316dbbffe0a96` | `0bfe356af33eddb64b545697aa121f7716a7f66fb195311be6e316dbbffe0a96` | 摘要及全部组件一致 |

拉密和卡坦岛仅能据本轮证据定位到展示图数据，不声称图片视觉或像素等价，也不据摘要差异推断规则被篡改。平台精确版本不可覆盖：不重装同版本、不改 package_hash、不重签旧 Release，不规范化数据库中旧源码。未来经过审查并获准发布的新版本再由订阅安装；旧局继续保留原始字节和锁定摘要。

## 真实订阅与服务器状态

- 真实目标仍为 `/opt/boardgame` / `boardgame-local.service`。本轮私有 current.json、API 子进程 cwd 与运行目录 package.json 一致，为 **cdb349950d5976e396e5a9af69c4830843d23364 / 平台 1.2.1**；systemd active/running、NRestarts=0，Chromium 公网 `/health/ready` 为 200、数据库 ready。该提交是此前内部交付记录，未把启动仓库 HEAD 当作运行版本。后续不为本批内部文档强制重启应用。
- 通过既有服务 EnvironmentFile 加载数据库连接，执行 **REPEATABLE READ READ ONLY** 事务，查询版本、enabled、包摘要和订阅摘要；没有输出环境或连接值、没有清理数据库、没有触发订阅。15 个已安装在线历史版本保持，7 个当前启用版本全部与公开目录一致。
- 订阅自动添加/自动更新均已启用，revision=1，有既存授权；最近完成记录为 **2026-11-06 23:03:46（北京时间）**、status=succeeded，七项均为 current。23:57 的本轮只读核验保存该快照。该结果只表示“已安装相同或更高版本”，**现实现不据此重新比对相同版本的包摘要**，不能当作上述三个 ZIP 已对齐的证据。
- 本轮没有生产管理员会话，没有手动同步、修改订阅开关或安装候选。已有定时任务的完成记录与本轮主动安装严格区分；D5 仍须在隔离环境验证真实安装、新旧局锁定、坏摘要拒绝、授权撤销和失败重试。

## 实际命令、限制与 D5 入口

本轮执行的脚本与证据保留在工作区忽略的 `.data/d4/`：

```bash
python3 .data/d4/audit.py
node --import tsx .data/d4/validate-packages.mjs
node --import tsx .data/d4/candidate-versions.mjs
GH_CONFIG_DIR=/root/.config/playboard-gh-auth node scripts/check-game-repositories.mjs --remote
node --env-file=/opt/boardgame/.env .data/d4/installed.mjs
node --env-file=/opt/boardgame/.env --import tsx .data/d4/compare-installed.mjs
```

- `audit.py`：六仓库/七玩法/21 附件全部通过，核对元数据、完整标签 SHA、目录/发布清单及摘要；只下载到忽略目录，不把文件导入宿主 Node 执行。
- ZIP/QuickJS：7/7。首轮辅助脚本直接比较 manifest 与公开 DTO，因为 DTO 额外包含 `supportsScriptAi` 而失败；按现有公开投影补上由能力派生的字段后全通过，没有修改平台实现或放宽字段比较。
- `check-game-repositories.mjs --remote`：**10 仓库、154 文件通过**。登记已核对，无需改动；来源锁与全部平台游戏集成副本保持不变。
- 生产只读查询及组件比较成功；公开 manifest 与七个正式包一致。未执行本轮无运行改动所不需要的 typecheck/lint/build/业务集成/E2E，也不将包冒烟称作数据库安装或联机通过。
- 初次沙箱 Git fetch 受 Git 元数据只读限制，网络请求受本机代理不可达限制；在获准执行环境使用原命令后成功。环境状态工具不可用、网络策略快照文件缺失，不据此宣称凭据/网络已普遍可用，仅记录上述实际调用成功。
- 交付前 Python urllib 健康探针被公网返回 403；改用本轮已实际访问页面的 Chromium 请求，ready 200 且数据库就绪。没有修改代理或服务安全配置，不将首次探针计为成功；这组交付复核于北京时间 11 月 7 日凌晨完成。

本批仅内部文档与只读核验，**平台保持 1.2.1，不升版**；没有游戏源码开发或 Release，候选不标记为已发布。后续 D5 先复用已下载的正式 ZIP 在独立测试库执行安装/恢复回归，再按明确授权处理六个头像候选的发布；不得顺带合入昵称/包大小 PR。

## Git 交付

主提交 **1785887** 已推送至 `codex/d4-game-release-audit`，面向 main 的 [PR #55](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/55) 已创建，包含本轮六份内部文档；随后仅补充本交付事实。分支工作区干净，原工作区全部已有改动保留。**尚未合并，服务器尚未同步本批文档**，不为未合并文档重启生产服务；没有游戏发布/安装或合并后分支清理。平台实机仍为记录中的 cdb3499 / 1.2.1。
