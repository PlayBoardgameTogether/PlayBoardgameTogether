# 平台主仓库与独立游戏仓库

本批为现有 ZIP 游戏提供独立项目导出及发布工作流。平台网站、账号、房间、对局事务、管理后台、SDK 和 ZIP 运行时继续由本仓库维护。`games/*` 的内置扩展仍随平台构建，不能直接挪走。

## 仓库清单

目标账户沿用本项目远程的 `Rst307`。下表为计划目标，不表示仓库已经创建或发布成功；实际结果记录在本轮进度与交付说明中。

| 游戏           | 目标仓库                            | 发布标签示例                        |
| -------------- | ----------------------------------- | ----------------------------------- |
| UNO 及扩展玩法 | `Rst307/playboard-game-uno`         | `uno-v1.2.0`、`uno-no-mercy-v1.0.0` |
| 五子棋         | `Rst307/playboard-game-gomoku`      | `gomoku-v1.0.3`                     |
| 拉密           | `Rst307/playboard-game-rummikub`    | `rummikub-v1.0.3`                   |
| 卡坦岛         | `Rst307/playboard-game-catan`       | `catan-v1.0.1`                      |
| 波多黎各       | `Rst307/playboard-game-puerto-rico` | `puerto-rico-v1.0.0`                |

同一游戏的相关扩展留在一个仓库，分别使用自己的游戏 ID、版本和 Release 标签。无需 Git submodule，也不让生产启动依赖临时拉取多个游戏源码仓库。

## 从已提交的版本导出

先获取和审查远程 main，选择完整提交 SHA：

```powershell
git fetch origin main
node scripts/export-game-repositories.mjs --ref origin/main --output .data/game-exports
```

默认导出全部五个项目，也可在命令末尾指定 `uno gomoku` 等键。默认来源为 HEAD；`--ref` 可以是已审查分支或提交。输出目录必须尚不存在，不能覆盖原目录。工具始终读取 Git 提交对象，不读取工作区中的未提交游戏改动，也不复制根目录 `.env`、会话、数据库或构建产物。完整 SHA、原始文件摘要及唯一的类型导入适配记录在每个项目的 `SOURCE.json` 中；这不是完整 Git 历史迁移。

每个项目包含自己的源码、素材、原规则单元测试、打包脚本、独立 package.json 和 GitHub Actions。固定版本的 SDK、ZIP 解析器、图像校验和 QuickJS 适配器仅作为兼容性测试快照，不包含网站或数据库服务，也不从平台工作区加载依赖。初始导出不承诺 npm SDK 已发布。

## 首次建仓与验证

每个导出项目已包含单独验证的 `pnpm-lock.yaml`，不使用平台根目录锁文件。本地与 CI 都运行：

```powershell
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test
pnpm build
pnpm verify
```

Linux CI 使用 `playwright install --with-deps chromium`。首次安装只安装工具依赖；不执行游戏 ZIP 内的 npm 或 shell 脚本。

若使用已登录且具备建仓权限的 GitHub CLI，验证和审查完成后可在各独立项目目录初始化新的游戏仓库，再执行：

```powershell
git init -b main
git add README.md package.json pnpm-lock.yaml .gitignore .github scripts tests game-packages packages apps SOURCE.json release.config.json vitest.config.mjs
git commit -m "chore: initialize independent game repository"
gh repo create Rst307/playboard-game-gomoku --public --source . --remote origin --push
```

示例针对五子棋，其他项目替换仓库名；只在新导出目录执行，不对现有平台仓库初始化。创建为公开仓库前核对素材分发权限与待提交文件。若仓库已创建，则添加已确认的远程并正常推送，不重复创建或强制覆盖。当前连接如没有建仓/发布能力，应先由有权限的用户创建并授权访问；不能把本地导出计为 GitHub 分仓完成。

## 发布与平台安装

普通推送、PR 和手动工作流只测试、构建并提供短期 Actions artifact；推送与包内版本一致的 `<archive>-v<version>` 标签，才会创建正式 Release。UNO 同次构建两份 ZIP，标签发布时只选择对应玩法。工作流先跑原游戏规则测试，再将最终带图片的 ZIP 送入平台解析器与真实 QuickJS，覆盖最小/最大人数、序列化恢复、本人视图和合法初始动作。它不是全部规则、隐私或完整浏览器联机验收的替代品。

正式附件为游戏 ZIP、`SHA256SUMS`、`release.json`。标签不匹配、文件名与 manifest 版本不匹配、漏包/重复包或包校验失败均阻止发布。工作流不使用 `--clobber`，不覆盖已有 Release；重新打包的浏览器/字体环境仍可能影响 PNG 和 ZIP 字节，校验和用于核对该次发布，不承诺跨环境字节一致。

下载 Release 中命名的安装 ZIP，核对摘要后由平台管理员检查和审核安装。GitHub 自带的 `Source code.zip` 不是安装包。Release 不会自动上架游戏，不会更新数据库里已安装的包；旧对局继续锁定原游戏版本。没有新增跨仓凭据、自动生产安装或绕过管理员的接口。

## 迁移顺序与当前边界

1. 生成并验证五个独立项目，创建目标仓库、提交锁文件及工作流。
2. 验证 GitHub 上的 CI 和首个 Release，确认平台仍可审核安装该产物。
3. 确认分仓成为唯一维护来源后，再迁走主仓库内对应源码/打包脚本；平台集成与 E2E 改用经审查、锁定版本和摘要的测试夹具。

在第二步完成前，主仓库保留 `game-packages/*` 和原测试入口作为迁移副本，避免破坏现有准备脚本。不得在两处长期独立修改同一版本。主仓库当前仍包含这些源码，不宣称已经完成物理移除。

本批仅开发/发布工具与内部文档，不改变平台产品行为，因此不递增平台版本，也不要求生产应用重启。未来分仓中的规则、桌面、美术变化应按游戏自身版本发布；平台仅在自身运行代码变化时升平台版本。
