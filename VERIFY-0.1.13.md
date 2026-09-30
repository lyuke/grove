# Grove 0.1.13 验证记录

验证日期：2026-09-30。

- `npm run package`：类型检查、前端及 Electron 构建通过，生成 arm64 / x64 DMG 与 tar.xz。
- `npm test`：30 项单元测试通过，包含真实 SSH 任务执行、工作目录与参数转义、失败退出码、历史恢复及配色校验。
- 发布前源码 Electron：任务与配色专项 1 项、工作区回归 9 项通过；最终颜色调整后的任务专项复测通过。
- 最终 arm64 安装包：任务与配色、SSH 远端工作区、终端工作流共 3 项通过。
- 最终 x64 安装包：相同 3 项通过，在 Apple Silicon 上使用 Rosetta 执行。
- 任务界面测试覆盖 JSON 配色导入、非法颜色拒绝、环境色条、Agent 配置、目标选择、任务执行与输出、提醒调用、隐藏与恢复任务列、历史落盘。声音和通知使用测试替身验证调用，未验证实际扬声器音量或 macOS 通知授权展示。
- `node scripts/verify-package.mjs`：双架构原生 PTY、资源、许可、语言裁剪、Finder 文件关联与压缩包内容检查通过。
- 两个 DMG 均通过 `hdiutil verify`；四个安装文件均通过 `SHA256SUMS.txt` 校验。
- `Info.plist` 中两个应用版本均为 0.1.13，可执行文件分别为 arm64 / x86_64。
- 改动文件格式检查及 `git diff --check` 通过。界面截图见 `artifacts/tasks-sidebar.png`。

## 安装包体积

| 架构  | DMG       | tar.xz    |
| ----- | --------- | --------- |
| arm64 | 92.21 MiB | 67.23 MiB |
| x64   | 96.44 MiB | 75.09 MiB |

未做 Intel 实机验证；此次没有运行全部端到端测试集合。CLI 任务使用隔离测试程序和本机 SSH 服务验证，未调用真实付费 Agent 服务。沿用未签名、未公证的分发方式。
