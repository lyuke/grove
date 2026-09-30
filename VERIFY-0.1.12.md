# Grove 0.1.12 验证记录

验证日期：2026-09-30。

- `npm run package`：类型检查、前端及 Electron 构建通过，生成 arm64 / x64 DMG 与 tar.xz。
- `npm test`：25 项单元测试通过。
- 源码 Electron：工作区 9 项回归、SSH 远端工作区 1 项、终端工作流 1 项通过。
- 修复工作区测试的添加项目定位歧义，限定列表底部按钮后，完整工作区回归通过。
- `node scripts/verify-package.mjs`：双架构原生 PTY、资源、许可、语言裁剪、Finder 文件关联与压缩包检查通过。
- 最终 arm64 / x64 安装包：各 1 项终端工作流验证通过，包含快捷键、停靠、底部可见性及链接操作。
- 在隔离临时工作区检查项目列表：本地标签在名称前、长名称省略、选中状态显示正常。截图见 `artifacts/project-sidebar.png`。

## 安装包体积

| 架构 | DMG | tar.xz |
| --- | --- | --- |
| arm64 | 92.20 MiB | 67.22 MiB |
| x64 | 96.44 MiB | 75.08 MiB |

附 `SHA256SUMS.txt`。x64 安装包在 Apple Silicon 上通过 Rosetta 验证，未做 Intel 实机验证。沿用未签名、未公证的分发方式。此次没有运行全部端到端测试集合。
