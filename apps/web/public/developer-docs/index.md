# 开发者中心

面向人类开发者与 AI 编码代理的桌游平台开发文档。文档无需登录；业务 API 仍按各接口要求验证会话和权限。

## 从哪里开始

- [快速开始](/developers/quickstart)：在本地运行平台、配置工作区依赖。
- [游戏 SDK](/developers/game-sdk)：实现权威规则、私密视图、事件和存档。
- [客户端 SDK](/developers/client-sdk)：登录、创建房间、提交动作与处理失败。
- [HTTP API](/developers/api)：实际端点、请求字段、认证和错误。
- [实时协议](/developers/realtime)：WebSocket 订阅、版本合并与断线恢复。
- [添加游戏](/developers/add-game)：目前的可信扩展流程及后续接口边界。
- [在线游戏 ZIP](/developers/game-packages)：独立规则和桌面打包、管理员即时安装。
- [AI 开发指南](/developers/ai)：编码代理和游戏内 AI 的不同契约。
- [在线更新与恢复](/developers/online-update)：接通后台更新、跟踪状态与处理失败。

## 当前公开能力

| 内容 | 状态 |
| --- | --- |
| 网站开发文档、Markdown、AI 文档索引 | 无需登录访问 |
| game-sdk / client-sdk / protocol | 当前工作区版本均为 0.1.0；提供源码下载 |
| HTTP 与 WebSocket API | 已实现，业务权限继续由服务端校验 |
| 可信游戏扩展 | 通过源码注册、构建和安装 |
| 游戏接入申请与管理员资料审阅 | 已实现，仅元数据，不下载或执行代码 |
| 管理员在线 ZIP 安装 | 已实现固定三文件 v1 包、隔离规则与桌面，上传后真人可玩；普通源码 ZIP 不支持 |
| npm 发布 | 本文不声明 npm 包已发布；当前使用 workspace 依赖 |

SDK 源码包包含公开契约及客户端代码，不包含 API 服务端、游戏秘密 State、凭据或本地资源。源码公开展示不替代软件许可证；使用与分发以项目实际许可为准。

## 给 AI 的入口

- [llms.txt](/llms.txt)：稳定文档索引。
- [llms-full.txt](/llms-full.txt)：完整开发指南纯文本。
- [SDK 源码包](/developer-sdk/sdk-sources.json)：带文件 SHA-256 的 JSON 源码快照。
- [文档目录](/developer-docs/index.md)：无需 JavaScript 的 Markdown。

源码入口：[GitHub 仓库](https://github.com/Rst307/PlayBoardgameTogether)。发布页面与源码包对应当前网站构建；仓库分支可能继续演进。
