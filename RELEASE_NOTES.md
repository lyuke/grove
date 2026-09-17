# Grove 0.1.5 · 更小安装包、设置与历史提交

- **安装包瘦身**：Apple Silicon 90.98 MiB、Intel 95.34 MiB，相比已发布 0.1.4 分别减少约 31.5% 和 31.2%。相比上一轮本地预览包进一步减少约 9.5%。前端依赖不再重复携带，只保留目标架构 PTY、中英文 Electron 资源；删除测试、开发头文件及 source map，采用高压缩 bzip2 DMG。
- **独立设置**：项目栏「设置」、Grove 菜单或 `⌘ ,` 打开；集中设置终端快捷键、侧栏显示、终端停靠、字号与配色，自动保存。
- **开源配色**：Grove 深浅色、Nord、Catppuccin Mocha，覆盖界面、编辑器和终端，附带开源许可。
- **历史提交**：Git 面板新增历史列表，每页 50 条，显示当前分支、当前项目目录的提交；查看完整提交信息与文件变更统计。
- **按需加载**：设置与历史组件按需加载，编辑器仅注册支持的语言，空项目工作区不预热编辑器。此次小样本未证明启动时间显著改善，体积下降不等于同等幅度的启动提速。

## 安装

下载对应架构 DMG，将 Grove 拖入 Applications。升级前保存文件，并在终端任务结束后退出旧版。已有项目、主题与布局配置继续保留。

- Apple Silicon：`Grove-0.1.5-arm64.dmg`
- Intel：`Grove-0.1.5-x64.dmg`
- 校验和：`SHA256SUMS.txt`

macOS 12+。本版本未使用 Apple Developer ID 签名或公证。Intel 包在 Apple Silicon 上通过 Rosetta 验证，不代替 Intel 实机测试。

## 验证

15 项系统测试通过；Apple Silicon 最终包 12 项完整回归通过；Intel（Rosetta）11 项通过、1 项原生启动时序测试跳过。双架构镜像完整性、挂载内容和裁剪资源检查均通过。详情见 [验证记录](https://github.com/lyuke/grove/blob/v0.1.5/VERIFY.md)。
