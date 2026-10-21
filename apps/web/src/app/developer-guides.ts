export const guides = [
  { slug: 'index', title: '开发者中心', summary: '公开能力、文档与源码下载' },
  { slug: 'quickstart', title: '快速开始', summary: '本地环境、workspace、构建' },
  { slug: 'game-sdk', title: '游戏 SDK', summary: '规则、View、RNG、资源契约' },
  { slug: 'client-sdk', title: '客户端 SDK', summary: 'ApiClient、动作提交与错误' },
  { slug: 'api', title: 'HTTP API', summary: '认证、房间、对局、模型与资源' },
  { slug: 'realtime', title: 'WebSocket 与恢复', summary: '订阅、版本、重连与回执' },
  { slug: 'add-game', title: '添加游戏', summary: '扩展注册、测试、未来接口' },
  { slug: 'game-packages', title: '在线游戏 ZIP', summary: '打包、隔离规则与即时安装' },
  { slug: 'ai', title: 'AI 开发指南', summary: '编码代理与游戏内 AI' },
  { slug: 'online-update', title: '在线更新与恢复', summary: '接通网页更新、配置托管与排查失败' },
] as const;
