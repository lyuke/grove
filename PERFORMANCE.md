# Grove 0.1.3 性能验证

## 改动

- 登录 Shell 环境改为异步加载，不再阻塞首个窗口和文件读取。终端及 Git 操作等待环境就绪，保留 Finder 启动时的命令路径。
- 文件树与文件行分别缓存渲染结果，使用稳定回调。输入、光标移动不会重绘整个目录；切换文件只更新相关选中行。
- 编辑器配置及内容监听回调保持稳定，去掉重复读取全文的同步逻辑。
- 终端渲染模块仅在实际创建终端后加载；编辑器模块在工作区空闲时预加载，打开文件时与磁盘读取并行加载。

## 同机安装包对比

2026-09-16，Apple Silicon / macOS Darwin 25.6.0。比较 0.1.2 与 0.1.3 的 arm64 安装包，均由 Playwright 启动，分别运行 3 次，使用独立临时项目和配置。

样例为同一目录下 1,200 个文本文件，每个 1,001 行；每轮打开 9 个文件，切换 9 次标签，再输入相同文本。下表为中位数，后续打开与标签切换合并三轮样本。

| 指标                 |     0.1.2 |    0.1.3 |
| -------------------- | --------: | -------: |
| 进程启动至文件树可用 | 1779.4 ms | 593.8 ms |
| 首次打开文本文件     |  448.5 ms | 447.7 ms |
| 打开后续文件         |   48.5 ms |  22.5 ms |
| 切换已打开标签       |   30.8 ms |  22.1 ms |
| 连续输入固定文本     | 1311.2 ms | 405.8 ms |

首次冷打开编辑器没有明显改善，仍约 0.45 秒；空闲预加载主要帮助用户停留一会后再打开文件。三轮启动值存在波动，尤其首次运行新安装包，不能把中位数当作每次启动的保证。

测试未清空操作系统文件缓存，也未模拟全新系统、网络磁盘或所有实际项目。输入耗时包含自动化按键发送与渲染等待，并非单个按键的延迟。

## 复现

```sh
GROVE_EXECUTABLE="$PWD/release/0.1.2/mac-arm64/Grove.app/Contents/MacOS/Grove" GROVE_BENCH_OUTPUT=artifacts/performance-baseline.json npm run benchmark
GROVE_EXECUTABLE="$PWD/release/0.1.3/mac-arm64/Grove.app/Contents/MacOS/Grove" GROVE_BENCH_OUTPUT=artifacts/performance-optimized.json npm run benchmark
```

原始数据：[优化前](artifacts/performance-baseline.json)、[优化后](artifacts/performance-optimized.json)。

新增启动回归测试使用临时 zsh 配置阻塞环境加载，确认此时文件树和文件读取已经可用；释放后验证主进程及终端继承正确命令路径。原有编辑、选区、外部冲突、Git、终端、工作区恢复和退出流程继续执行回归测试。

启动时序测试只在原生架构执行。Intel 应用在 Apple Silicon 上首次 Rosetta 初始化可能超过登录 Shell 的 5 秒截止时间；该场景下人为阻塞 Shell 的测试无法建立有效时序，因此跳过这一项，并继续运行其余 8 项功能回归。Intel 原生启动时序仍待实机验证。
