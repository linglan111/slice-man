# 发布 Slice Man

## 当前发布

最新正式版本以 [Latest Release](https://github.com/linglan111/slice-man/releases/latest) 为准，面向 Windows x64，提供对应版本源码、经过打包验证的 NSIS 安装包及 SHA-256 清单。以下命令以 `0.1.5` 为例，发布时须与实际版本一致。

## 准备

1. 同步 `package.json`、`package-lock.json` 版本；确保 README、MIT 许可证及第三方通知与实际分发内容一致。
2. 执行 `npm ci`、`npm run setup:resources`。
3. 完成 lint、TypeScript、单元/集成测试和适用的原生/Electron 回归。记录外部条件跳过项，不能把跳过视为通过。
4. 执行 `npm run make -- --config.directories.output=dist/github-v0.1.5`，使用独立输出目录，避免覆盖用户正在运行的应用。
5. 执行 `npm run test:package -- --app-dir dist/github-v0.1.5/win-unpacked`，验证生产进程、原生 SQLite、资源和隔离数据目录。
6. 核验安装包版本、签名状态、第三方资源和许可证。将构建得到的 `Slice Man Setup 0.1.5.exe` 复制为发布名 `Slice-Man-Setup-0.1.5.exe`（保留原文件且不覆盖已有发布），再用 `Get-FileHash -Algorithm SHA256` 生成 `SHA256SUMS.txt`。

如 Electron 下载失败但已有官方 ZIP，可以在与已安装 Electron 的 `checksums.json` 校验一致后，使用 `--config.electronDist=<verified-archive-path>`。不得关闭 TLS 校验或覆盖原有便携版。

## GitHub 自动发布

仅 `release` 分支的推送会自动发布。`main`、`dev`、`develop`、`codex/*` 等开发分支、Pull Request 和标签推送不会触发发布；手动运行工作流也必须选择 `release` 分支。

工作流在计划、构建和发布阶段均检查仓库及分支。GitHub 的 `production-release` 环境另设分支规则，仅允许名为 `release` 的分支部署。构建阶段只读，发布阶段才获得写入 Release 的权限。

1. 在开发分支完成修改，将 `package.json` 和 `package-lock.json` 的根版本同步升级（例如 `0.1.5`）。
2. 可选：添加 `docs/releases/v0.1.5.md` 作为该版本的发布说明。
3. 通过审核后将代码合并到 `release`，或推送已审核提交到该分支。
4. Actions 自动执行资源准备、lint、类型检查、单元/集成测试、Electron 端到端回归、Windows NSIS 构建及打包应用启动验证。
5. 全部成功后，为通过测试的提交建立版本标签，上传安装包和 `SHA256SUMS.txt`，完成正式 Release。

同一版本已发布时会跳过，不会覆盖原 Release、附件或标签。失败不会产生新的正式 Release；上传过程中使用草稿。GPU 和付费实网检查保留显式启用条件，GitHub 标准 Windows runner 不代表 GPU 回归或干净设备安装验收。

```powershell
# 仅在代码已审核、确认适合正式发布后执行
git push origin HEAD:release
```

推送 `main` 不会发布；将新版本的已审核代码合并至 `release` 后触发验证与发布。执行记录见 [Actions](https://github.com/linglan111/slice-man/actions)，安装包见 [最新 Release](https://github.com/linglan111/slice-man/releases/latest)。

## 重试与维护

使用正常的 GitHub 登录流程，不把密钥写入 shell、文档或仓库。

```powershell
# 手动触发同一条验证与发布流程，仍只允许 release 分支
gh workflow run release.yml --repo linglan111/slice-man --ref release
```

上传阶段失败时，优先在 Actions 中重新运行失败的任务，复用同一次已验证的构建附件。已建立的标签和草稿附件不允许覆盖；若构建内容改变，请使用新版本。不要绕过工作流并行创建标签或 Release，也不要用强制推送覆盖已有内容。

上传后验证仓库为公开、MIT 许可证可见、README 图片和链接正确，Release 标签对应预期提交且附件名称/大小/摘要正确。若调整发布分支，必须同步更改工作流分支过滤、各阶段检查和 GitHub 发布环境规则。

`private: true` 仅防止误发布到 npm，不影响 GitHub 源码开源。

## 第三方资源

本应用通过独立进程使用 FFmpeg / FFprobe；随安装包提供对应 GPLv3 通知、原始构建配置和源代码来源。字体使用 OFL。Whisper、模型、yt-dlp、Deno 运行库按需下载，开发测试缓存不会打入安装包。

分发者应根据 `resources/notices/RESOURCE-ORIGINS.md` 和原始工具许可证核对对应源代码、外部库及运行库的要求；Slice Man 的 MIT 许可证不替代这些第三方许可。真实 CPU/CUDA 测试不代表 CUDA DLL 随本应用分发，也不代表取得代码签名证书。
