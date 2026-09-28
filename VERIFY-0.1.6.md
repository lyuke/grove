# Grove 0.1.6 验证记录

日期：2026-09-20。环境：Apple Silicon macOS，Electron 41.10.7。

## 功能与构建

- TypeScript 检查、Vite / Electron 构建通过。
- 16 项单元测试通过，覆盖文件边界、防覆盖、嵌套新建、首次提交补丁、修改和删除补丁等。
- 最终 arm64 安装包 14 项端到端测试通过，覆盖新建菜单、Finder 打开事件、中文 / 空格路径、重复打开、无效路径提示、未激活项目延迟恢复与标签保留、Git 历史实际补丁、编辑 / 保存 / 外部冲突、终端、设置、退出保存及大文件 Diff。
- Intel 包在 Apple Silicon / Rosetta 下通过 4 项冒烟测试：大文件 Diff、Finder 打开、新建、项目延迟恢复、终端工作流。Finder 测试初次因 Monaco 翻译加载超过默认 5 秒超时；将该首屏断言等待上限改为 20 秒后重测通过。未做 Intel 实机验证。
- Finder 验证包括打包后的 Info.plist 文件关联及 Electron `open-file` 事件链路；未通过 Finder 图形菜单人工点击验证。安装到 Applications 后启动一次，使用「打开方式 → Grove」。
- `node scripts/verify-package.mjs` 检查两个架构的归档完整性、主程序、文件关联、原生 PTY 架构、语言资源及无开发文件泄漏，均通过。

## 产物

| 架构          |    tar.xz |       DMG |
| ------------- | --------: | --------: |
| Apple Silicon | 66.07 MiB | 90.85 MiB |
| Intel         | 73.95 MiB | 95.37 MiB |

位于 `release/0.1.6/`，SHA-256 校验和见同目录 `SHA256SUMS.txt`。压缩格式减小下载体积，解压后体积不同比例下降。未发布到 GitHub，未改变原有未签名 / 未公证状态。

## 性能

交替运行旧 / 新 arm64 安装包各三轮。当前项目一个标签，未激活项目 120 个标签（20.16 MB），启动到当前文件编辑器可用的中位数由 1403 ms 降至 845 ms。测试没有清空系统文件缓存，三轮样本波动明显，仅代表此多项目恢复场景。复现命令和原始数据见 [PERFORMANCE.md](PERFORMANCE.md)。
