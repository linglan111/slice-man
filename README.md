# Slice Man

面向 Windows 的视频字幕工作台：导入、识别、翻译、校对与导出，在一个桌面应用中完成。

支持本地 Whisper、原语言字幕、可选翻译、上下文字幕检查，以及字幕文件或烧录视频导出。界面为中文。

![Slice Man 字幕工作台](docs/screenshots/workspace.png)

## 下载与安装

在 [Releases](https://github.com/linglan111/slice-man/releases/latest) 下载 Windows x64 安装包 `Slice-Man-Setup-0.1.4.exe`。首次使用本地识别时，在应用内安装 Whisper 引擎和所需模型；使用链接导入前，在“链接导入设置”安装下载工具。

- 已验证环境：Windows 11 x64。Windows 10 尚需独立设备验证。
- 终端用户无需安装 Node.js、Python 或编译器。
- 本地识别支持 CPU；兼容的 NVIDIA GPU 可加速，不可用时回退到 CPU。
- 在线识别、翻译、AI 检查及 AI 样式使用你自行配置的服务和 API Key，应用不提供共享额度。
- 当前安装包未签名。安装包的 SHA-256 见同一 Release 中的 `SHA256SUMS.txt`。

## 主要功能

| 模块 | 功能 |
| --- | --- |
| 视频导入 | 本地视频、通过托管下载工具导入视频链接；独立设置下载格式、编码、分辨率和保存位置。 |
| 语音识别 | 本地 Whisper Base / Small / Large v3 Turbo，或提供分段时间戳的 OpenAI 兼容服务。 |
| 可选翻译 | 导入时选择原语言或翻译字幕；翻译服务支持 Chat Completions、Responses、Anthropic Messages 和 Gemini 协议。 |
| 字幕校对 | 修改原文、译文和时间，添加/删除字幕，按播放位置跟随；支持选中字幕或时间范围的局部重新识别/翻译。 |
| 上下文检查 | AI 按统一标准输出无/低/中/高疑虑等级；过滤、复查、忽略和定向修复，修改上下文后提示重新检查。 |
| 播放预览 | 实时字幕、暂停定位、双语、点击画面字幕编辑及全屏字幕。 |
| 可调整工作区 | 左侧预览、右侧全高校对；生成/样式/导出设置位于预览下方并可收起。拖动分隔线调整宽高，记忆尺寸并支持重置。 |
| 导出 | SRT / ASS / VTT 字幕文件，以及烧录字幕的 MP4 / MKV 视频；支持编码、分辨率、质量及内置/AI 样式。 |

## 快速使用

1. 点击“导入视频”或“链接导入”，选择原语言字幕或启用翻译。
2. 配置识别方式；本地模式先在“本地引擎”安装运行库及模型，云端模式配置语音服务。
3. 如启用翻译，选择翻译服务后生成字幕。仅生成原语言字幕时不需要翻译服务。
4. 在右侧“字幕校对”修改文字和时间；点击时间定位播放，必要时使用局部修复或 AI 检查。
5. 展开预览下方的生成/样式/导出区域，选择字幕样式。
6. 点击顶部“导出字幕文件”或“导出作品”，保存最终结果。

分隔线也可通过键盘方向键、Shift + 方向键和 Home / End 调整；“重置布局”恢复默认尺寸。字幕列表、编辑表单和设置各自滚动，常用校对操作保持可见。

## 数据与检查结果

- 本地识别在电脑上处理音频。云端识别向配置的服务发送音频；翻译、AI 检查和样式生成发送相关字幕文字。
- API Key 由主进程管理，支持本地保护保存或仅在当前会话使用；不要提交个人 Key 或用户数据到仓库。
- AI 检查使用文本和时间，不直接监听原音频，也不会自动替你修改字幕。“无疑虑”不代表语音识别绝对准确。
- 局部处理仅在成功后替换目标字幕；失败或取消保留已有校对结果。重新识别整片会要求确认替换。
- 视频烧录会重新编码；独立字幕导出使用当前校对后的时间轴。较低分辨率视频不会因预设而放大。
- 当前视频发布操作要求目标目录支持硬链接，通常为本地 NTFS；不支持的卷会报告可恢复错误。

更详细的模式、协议、校对及导出说明见 [English workflow guide](docs/usage.en.md)。

## 从源码运行

使用 Windows x64、Node.js 24.17.x 和 npm 11.x：

```powershell
npm ci
npm run setup:resources
npm run dev
```

`setup:resources` 获取并校验固定版本的 FFmpeg、中文字体和测试音频。运行库、模型、缓存、个人数据和安装包不会作为源码提交。

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run setup:whisper-fixtures
npm run setup:download-fixtures
npm run test:e2e
```

GPU 端到端测试需要兼容硬件及 `npm run setup:whisper-fixtures -- --gpu`。实网 AI 和公开视频下载测试单独设有显式启用条件，未启用时会跳过。单元/集成测试使用 Electron 内嵌 Node 以匹配 SQLite 原生 ABI。

```powershell
npm run package
npm run make
npm run test:package
```

`package` 生成 `dist/win-unpacked`，`make` 生成 NSIS 安装包。已有便携版正在运行时，请使用独立输出目录，避免覆盖正在使用的文件。版本、资源来源及原生构建细节见 [开发环境](docs/development-environment.md)，发布步骤见 [发布说明](docs/releasing.md)。

## 验证范围

最新工作区回归：49 个测试文件、446 项单元/集成测试通过；完整 Electron 端到端测试 25 项通过、0 失败，3 项因未启用外部条件而跳过。覆盖真实 CPU/CUDA 识别、字幕校对、播放定位/全屏、实际导出、下载转换、取消/文件保留、最小窗口布局、拖动尺寸及重启持久化。

上述结果不等同于实网服务质量、所有公开视频站点兼容性、干净 Windows 设备安装或 Windows 10 验证。后者见 [人工验收清单](docs/manual-acceptance.md)。

## 开源许可证与第三方组件

Slice Man 项目代码使用 [MIT License](LICENSE)。第三方组件、资源和工具保留各自许可证，MIT 声明不覆盖这些组件。

- FFmpeg / FFprobe：独立 GPLv3 可执行工具；固定构建的许可证、配置、外部库版本及来源保存在 `resources/notices`。
- Noto Sans CJK 字体：SIL Open Font License 1.1。
- whisper.cpp 与 Whisper：保留 MIT 通知；运行库和模型由用户按需安装。
- yt-dlp 与 Deno：按需下载；源码、组合二进制和依赖具有各自许可说明。

完整来源见 [RESOURCE-ORIGINS.md](resources/notices/RESOURCE-ORIGINS.md)。第三方工具的重新分发应遵守其许可证及对应源代码要求。

欢迎通过 [Issues](https://github.com/linglan111/slice-man/issues) 提交可复现问题，或通过 Pull Request 贡献改进。报告中请注明系统、版本、复现步骤，并去除 API Key 和个人视频信息。

## 自动发布

只有 `release` 分支自动生成正式 Release；`main` 和开发分支不会发布。同步升级 `package.json`、`package-lock.json` 的版本后，将审核后的代码合并到 `release`。GitHub Actions 通过检查、端到端回归、Windows 构建和打包验证后，发布对应版本的安装包及 SHA-256 清单；已有版本不会覆盖。详见 [发布流程](docs/releasing.md)。
