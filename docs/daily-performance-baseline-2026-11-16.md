# D24 单 API 性能基线（2026-11-16）

**隔离环境 10 局 / 40 个认证连接基线通过。** 200 次动作 HTTP P50/P95 为 **21.627 / 28.659 ms**，四人身份化快照全部送达 P50/P95 为 **54.072 / 60.943 ms**，10 次集中重连全部恢复原本人视图。没有意外 HTTP/WS 错误、数据库回滚或死锁；结果不代表生产容量、饱和吞吐或长时间稳定性。

独立工作区 `/tmp/playboard-d24` / `codex/d24-performance-baseline` 最初从 main **db96906** 建立，编辑前快进至 D23 合并 **b893d38**。交付前审查并快进至仅增加三份 D23 交付文档的 **37bd6d5**，运行代码/基线夹具不变，不重复已通过检查。原主目录 36 项既有改动与其他工作区保留。

## 负载及正确性

- 一个独立 Node API 子进程运行原 createApp，使用真实 TCP HTTP、session/Origin/CSRF、PostgreSQL 事务与原 WS 投影/广播；负载客户端/审计在另一进程，CPU 分开。没有 app.inject、规则/网络 mock、直接改 State 或任何模型调用。
- 10 个 Color Match `1.0.0` 四人房间，40 个不同账户各持一个认证 socket；经原建房、加入、入座、准备、开局 API 建立正式局，开发实验台关闭，各桌只订阅自己的房间。
- 每桌 2 次摸牌预热、20 次合法摸牌测量。20 批次各 10 桌并行，每批至少间隔 500 ms，必须等四人新 revision 快照全部到达才继续下一批；**10.001 秒 / 200 动作 / 19.998 动作每秒**。这是最多 10 个并发写请求的闭环负载，不是吞吐上限。
- 每条快照经共享协议与 Color Match 严格 View schema，核对 matchId、本人 seatIndex/viewingSeatId，不消费完整 State。HTTP 往返和四人全部送达均从发起动作开始计时，包含数据库/投影/广播/本机网络，不能称为纯规则耗时。
- 中途同时关闭每桌一个连接，共 10 个，另外 30 个保持；重建 TCP/认证/订阅，比较权威本人视图一致后继续原局。重连耗时不含关闭旧连接、浏览器退避或 WAN。结束仍有 40 个连接，共收到并自动回应 **80 次**原控制帧心跳。
- 测量后每桌再摸一次，按原空牌堆规则结束全部 10 局。逐局验证跨桌账户读取 404、重复终局不增加动作；数据库每局 revision/动作 **23/23**、回放 **24 帧**，共 **230 动作 / 240 帧**，10 房间均回到 waiting 且无 active match。其他回复丢失/会话撤销边界仍见 [D22](daily-result-recovery-2026-11-15.md)，未重复验收。

## 环境与结果

测量于 **22:50:31（北京时间）** 完成。AMD Ryzen 7 5800H、16 逻辑 CPU / 可用并行度 16、宿主内存 **16,087,973,888 字节（约 14.98 GiB）**；Linux `6.12.96+deb13-amd64` x64、Node **22.23.2**、pnpm **11.15.1**。宿主还有其他服务，未停服或隔离争用，规格不代表独占资源。

PostgreSQL **17** 使用原专用测试容器，回环端口 **15441**、库 **playboard_d24_test_20261116**，容器限制 **1 CPU / 256 MiB**。API 保持原池 **max=5 / connectionTimeoutMillis=1500**，保留鉴权/心跳/后台扫描。源码经 tsx 加载，NODE_ENV=test / silent 日志，不是生产编译产物或生产日志配置的压测。

| 指标 | 样本 / P50 | P95 | 最大值 |
| --- | --- | --- | --- |
| 动作 HTTP 往返 | 200 / 21.627 ms | 28.659 ms | 33.084 ms |
| 四人新快照全部送达 | 200 / 54.072 ms | 60.943 ms | 63.209 ms |
| 新认证连接至本人快照 | 10 / 15.468 ms | 19.832 ms | 19.832 ms |

API 窗口 **10,001.671 ms**、CPU **1,364.122 ms**，平均 **单核 13.639%**；100 ms 采样 RSS 峰值 **263,929,856 字节（251.70 MiB）**，窗口末 heapUsed **141,871,504 字节（135.30 MiB）**。RSS 非连续精确峰值，heapUsed 非峰值，均不含数据库/负载客户端。事件循环监视分辨率 10 ms，P95 **10.600 ms**，包含采样分辨率，不等于额外同等业务阻塞。

池采样峰值 **5 个连接 / 33 个排队请求**，不等于 PostgreSQL 锁等待。该库 pg_stat_database 前后差值：提交 **5,377**、回滚 **0**、读块 **6**、缓存命中 **64,753**、死锁 **0**、临时字节 **0**。含心跳/恢复/观测查询且受异步统计刷新影响，不等于每动作 SQL 次数；未测数据库专属 CPU/内存。

没有超时、错误或阻塞性延迟证据，本轮不改运行参数。池排队可供 D25 同环境分析，但不能据此认定主要瓶颈或直接扩大池/重构广播。D25 未开始。

## 重复执行与实际验证

独立工作区按锁文件安装依赖。私有 `.env` 的 DATABASE_URL 指向隔离 PostgreSQL scratch 库；TEST_DATABASE_URL 使用同回环服务器/账户下、以 `playboard_d24_test_` 开头的独立库；TEST_ASSET_STORAGE_DIR 使用工作区自己的忽略目录。测试拒绝同名库、非回环地址和错误前缀，不得填开发/生产库或改保护绕过。

```bash
pnpm test:integration --config tests/config/performance.config.ts
```

沿用原准备库、迁移、游戏同步、资源校验链，不能直接执行 Vitest 绕过准备；会清理专用测试库，不能与清理同库的集成/E2E 同时执行。`.perf.ts` 不进入默认 test/集成收集，只有显式配置运行；配置进入现有 typecheck。本地 JSON/日志/临时 strict 编译配置/资源保留 `.data/d24/`，不提交凭据、会话、View 或生成物。

pnpm 运行带既有 `--config.verify-deps-before-run=false`，无依赖或锁文件变化：

| 实际命令 | 结果 |
| --- | --- |
| `pnpm install --offline --frozen-lockfile` | 通过，379 包离线复用 |
| `pnpm typecheck` | 全工作区通过 |
| `pnpm lint` | ESLint、20 根 AST 边界及原格式检查通过 |
| `pnpm exec tsc -p .data/d24/tsconfig.json` | 新基线/独立 API 夹具使用现有 strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes，通过 |
| `pnpm test:integration --config tests/config/performance.config.ts` | **1/1、16.30 秒**，总耗时 16.75 秒，无 skip；准备链完整执行 |
| 新文件 Prettier / `git diff --check` / 新链接、围栏与版本 | 通过 |

缺本机 TTS 文件时原准备脚本安装原创 SVG 回退，不宣称商业素材验收。tsx IPC、Docker 媒体验证和专用库在获准环境执行，没有降低隔离限制。仅测试/内部记录，不重复无关全库单元/集成、E2E、生产 build 或浏览器布局验收。

## 版本与交付边界

平台 **1.4.1 → 1.4.1**，仅测试工具与内部文档，无运行代码、公开内容、HTTP/WS/SDK、迁移、游戏实现/副本/来源锁/登记或依赖变化，不升版。无 UI 变更，不新增截图或冒充真机验收。

**22:51:36（北京时间）** 只读核对服务器：私有 current.json **37bd6d5**、真实 API cwd 与该发布目录一致、运行 package.json **1.4.1**；boardgame-local.service active/running、NRestarts=0，实际 API ready **200**、database.ready=true。无生产写入、强制更新/重启、迁移、游戏发布或安装；该 SHA 为既有发布结果，不代表 D24 候选上线。

本批交付功能分支和面向 main 的 PR，尚未授权合并，不同步未审候选到服务器、不清理待审分支。D23 已合并及真实供应商费用/配置条件、D3/D5、UNO #5/ADR-011 和设备边界保持；提交/PR 状态完成后补记。

## 提交与 PR

主提交 **2b5212f4517b2823871adbeab0e8d257f0dd6b54** 已推送至 `codex/d24-performance-baseline`，创建 [PR #88](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/88)，面向 main、open / mergeable；七个本轮文件、一个主提交，无其他任务提交。精确 head 的来源锁 CI **pins SUCCESS**、审查列表为空；它不是远程再次执行本地性能/业务验收的证据。后续只补交付记录，不重复代码检查。

GitHub 连接器创建 PR 返回 403。自动审批拒绝读取 Git 凭据并转交给 gh 的方式，该命令未执行；随后直接使用项目已配置的 gh 标准登录创建成功，没有读取/转换/落盘凭据或改变认证配置。原 origin 的旧仓库地址由 GitHub 重定向到已确认组织仓库，未改用户远程。

**未合并、未同步服务器文档、未部署候选**；独立功能分支与本地证据保留待审，无分支清理。平台仍 **1.4.1**，D25 尚未开始。
