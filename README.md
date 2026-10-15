<div align="center">

# QQ–Codex Bridge

**在 QQ 里接着用电脑上的 Codex。**

通过 QQ 私聊继续本地 Codex 会话，查看回复、处理审批、收发文件。

**简体中文** · [English](README.en.md)

[![Tests](https://github.com/Xplore-LAB/qq-codex-bridge/actions/workflows/test.yml/badge.svg)](https://github.com/Xplore-LAB/qq-codex-bridge/actions/workflows/test.yml)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](src)

[快速开始](#快速开始) · [常用命令](#常用命令) · [排障](docs/troubleshooting.md) · [反馈问题](https://github.com/Xplore-LAB/qq-codex-bridge/issues)

</div>

---

电脑上任务还在跑，离开工位后也能用手机继续跟进。QQ–Codex Bridge 将 QQ 私聊接入已有的本地 Codex 会话，让对话、执行状态和文件交付连在一起。它是独立的 TypeScript 命令行工具，使用腾讯 QQ SDK、SQLite 和 Codex App Server 协议，无需安装 OpenClaw。

## 可以做什么

| 场景 | 能力 |
| --- | --- |
| 手机继续工作 | 接入已有会话，也可通过命令新建、恢复、分叉和切换会话 |
| 跟进长任务 | 打字状态提示、可选原生流式回复；桌面忙碌时消息进入队列 |
| 处理文件 | 接收图片、文档、语音和视频；发送生成的文件与图片 |
| 控制执行 | 查看状态、取消任务、追加输入，转发真实审批和交互问题 |
| 重启恢复 | SQLite 持久化任务与发送进度；失败交付可单独重试 |
| 私人使用 | 一个机器人配对一个用户，只接受已配对用户的私聊 |

语音识别和语音合成需要另行配置服务。视频可提取有限数量的帧；附件传输能力不等于模型已理解附件内容。原生流式、文件发送、审批按钮等受 QQ 账号权限影响。

## 快速开始

### 1. 准备环境

- Linux 或 macOS，**Node.js 24**。
- 已登录且运行中的 Codex App Server，以及一个已有的会话 ID。
- 可绑定的 QQ 机器人或扫码接入权限。
- 处理音视频时需要 FFmpeg；可选队列后端还需要 Python 3。

当前主后端连接本地 Unix 控制套接字；仅安装 Codex CLI 不代表该接口已运行。协议类型来自 Codex CLI `0.162.1`，其他版本请用 `probe` 验证。原生 Windows 支持尚未验证。

### 2. 从源码安装

```bash
git clone https://github.com/Xplore-LAB/qq-codex-bridge.git
cd qq-codex-bridge
npm ci
npm link
qq-codex-bridge --help
```

`npm ci` 会编译项目。当前未发布 npm 包，请使用上述源码安装方式；私有仓库需要 GitHub 访问权限。

### 3. 连接现有会话

将 `YOUR_EXISTING_THREAD_ID` 替换为已有 Codex 会话的 ID：

```bash
qq-codex-bridge init --thread YOUR_EXISTING_THREAD_ID
qq-codex-bridge check
qq-codex-bridge probe
```

`init` 创建本地配置，不连接 QQ。`check` 检查本地环境；`probe` 只读验证会话，预期返回 `connected: true` 和 `sameThread: true`。会话 ID 和套接字路径说明见[排障指南](docs/troubleshooting.md)。

### 4. 扫码、配对、启动

```bash
qq-codex-bridge bind
```

打开终端输出路径对应的二维码图片，扫码绑定后，在 QQ 私聊机器人发送终端打印的 `/pair ...`。请保管好配对码，不要贴到公开 Issue。

```bash
qq-codex-bridge auth-check
qq-codex-bridge start
```

在 QQ 发送 `/help` 或普通消息即可使用。初次使用建议保持前台运行，确认收发正常后再配置[后台服务](docs/operations.md)。

## 常用命令

| QQ 私聊命令 | 用途 |
| --- | --- |
| `/help` | 查看完整命令列表 |
| `/status` | 连接、会话和最近任务状态 |
| `/new`、`/resume`、`/fork` | 新建、恢复或分叉会话 |
| `/session [ID]` | 查看或选择已有会话 |
| `/model` | 查看模型；按提示选择模型和推理强度 |
| `/usage` | 查看账号额度窗口 |
| `/history`、`/compact` | 查看近期对话、压缩上下文 |
| `/stop` 或 `/cancel [任务ID]` | 取消移动端任务 |
| `/steer 内容` | 向正在执行的移动端任务追加输入 |
| `/retry [任务ID]` | 重试失败的结果发送，不重复执行任务 |
| `/answer nonce question answer` | 回复 Codex 发出的交互问题 |
| `/skills`、`/mcp`、`/apps` | 查询可用能力 |
| `/rename 名称` | 重命名当前会话 |
| `/voice on`、`/voice off` | 启用或关闭已配置的语音回复 |
| `/remind 5m 喝水` | 创建持久提醒 |
| `/remind list`、`/remind cancel ID` | 查看或取消提醒 |

QQ 消息输入框不提供命令自动补全。登录、密钥输入及部分权限交互仍需在电脑端完成；操作细节见[运行说明](docs/operations.md)。

## 发送文件与图片

让 Codex 生成结果并通过以下显式标签返回文件：

```text
<qqfile>/absolute/path/report.md</qqfile>
<qqimage>/absolute/path/chart.png</qqimage>
<qqvideo>/absolute/path/demo.mp4</qqvideo>
<qqvoice>/absolute/path/reply.mp3</qqvoice>
```

在配置中将工作目录加入 `sendRoots`。只有显式标签会触发上传，普通 Markdown 文件链接不会。默认每条消息最多 8 个附件、单文件 50 MiB，并受平台更低限制约束。

## 配置与数据

| 内容 | 默认位置 |
| --- | --- |
| 配置 | `~/.config/qq-codex-bridge/config.json` |
| 机器人凭据 | `~/.config/qq-codex-bridge/credentials.json` |
| 任务数据库 | `~/.local/state/qq-codex-bridge/bridge.db` |
| 收发媒体 | `~/.local/share/qq-codex-bridge/media/` |

通过 `QQ_BRIDGE_CONFIG_DIR` 隔离配置，初始化时可传入 `--socket`、`--state-dir` 和 `--media-dir`。凭据、数据库和媒体保存在安装目录之外。原生流式回复默认关闭；语音服务需要显式配置。

- [配置参考](docs/configuration.md)：流式回复、发送目录、STT/TTS 和限制。
- [运行维护](docs/operations.md)：后台服务、恢复、提醒和移动端命令。
- [架构说明](docs/architecture.md)：消息处理、任务状态和审批边界。
- [常见问题](docs/troubleshooting.md)：安装、连接、配对和文件发送排障。

## 参与改进

欢迎提交可复现的问题、文档修正和改进建议，见[贡献指南](CONTRIBUTING.md)。如果它对你有帮助，欢迎点一个 **Star**，让更多需要 QQ 远程使用 Codex 的人发现它。

```bash
npm test
npm pack --dry-run
```

自动测试使用模拟 QQ 通道、临时数据库、本地 RPC/语音服务及 FFmpeg，不会连接真实机器人，也不能代替真实账号权限验证。

## 项目状态与许可

当前面向个人自托管场景：一个机器人、一个配对用户、QQ 私聊。本地执行沿用原会话的审批和沙箱策略。主后端依赖版本敏感的 Codex 控制接口，升级后应重新运行 `probe`；跨服务不承诺严格的恰好一次执行或交付。

原创代码目前保留所有权利，尚未授予开源使用许可，见 [LICENSE](LICENSE)。第三方组件及生成协议类型遵循各自条款，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目独立维护，与腾讯、OpenAI 或 OpenClaw 无隶属关系。
