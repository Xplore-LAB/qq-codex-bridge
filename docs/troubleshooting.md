# 常见问题 / Troubleshooting

## 先收集环境信息

```bash
node --version
codex --version
qq-codex-bridge --version
qq-codex-bridge check
qq-codex-bridge probe
```

Node.js 应为 24。`check` 是离线检查，`probe` 会只读连接 Codex，不向会话发送任务。提交 Issue 前请移除私人路径、会话标识、账号信息和密钥。

## 从哪里获得会话 ID？

使用你已有 Codex 客户端所显示或导出的会话标识；应为真实的 thread ID，不是会话标题或进程 ID。不同客户端的展示方式不同，当前工具不提供通用的首次会话发现命令。初始化后，可在 QQ 中通过 `/resume` 列出近期会话。

如果无法取得 ID，请在 Issue 中说明使用的 Codex 客户端和版本；不要随意填入一个 ID，因为本工具初始化时需要连接已存在的会话。

## `probe` 失败或套接字不存在

默认路径是 `~/.codex/app-server-control/app-server-control.sock`；设置 `CODEX_HOME` 后会使用该目录。Codex CLI 安装成功或登录成功并不代表控制套接字正在监听。

确认目标 Codex App Server 已运行，且桥接进程能访问同一个用户目录。首次初始化可指定路径：

```bash
qq-codex-bridge init --thread YOUR_EXISTING_THREAD_ID --socket /absolute/path/to/control.sock
```

如果配置已存在，`init` 不会覆盖它，请直接编辑配置的 `socket`。主后端使用 Unix 套接字上的 WebSocket/JSON-RPC，不能把任意 HTTP 或 TCP 接口地址当作此路径。协议类型来自 Codex CLI `0.162.1`；其他版本可能不兼容。

## `npm ci` 或 SQLite 原生依赖安装失败

先检查 `node --version`，使用项目要求的 Node.js 24。`better-sqlite3` 是原生依赖；缺少适配当前系统与架构的预编译包时，需要 Python 和系统 C/C++ 构建工具。根据安装日志判断是网络、工具链还是版本问题，不要跳过安装脚本，否则项目不会正常编译。

## 机器人没有回复

1. `bind` 只绑定账号；需要另外运行 `start`。
2. 新绑定后必须在私聊中发送终端显示的 `/pair ...`。
3. 只有已配对用户的私聊会被接受，群聊不在支持范围内。
4. 运行 `auth-check` 验证 QQ 凭据，再用 `probe` 检查 Codex。
5. 已配对时尝试 `/status`；桌面正在执行任务时，普通消息会排队。

不要同时在 OpenClaw 和本工具中启用同一个机器人。先明确迁移旧通道，再启动新消费者。

## 能发文字但不能发文件

将输出目录加入配置的 `sendRoots`，并使用 README 中的显式媒体标签。仅发送本地 Markdown 链接不会上传。检查文件大小、实际类型与 QQ 文件权限；隐藏文件、密钥文件及白名单外路径会被拦截。

## 没有流式回复或语音

原生流式默认关闭，需设置 `streaming.native: true`，并确认 QQ 账号具备对应权限。语音收发与识别/合成是不同能力，STT/TTS 需单独配置；音视频处理还需要 FFmpeg。见[配置参考](configuration.md)。

## 收到 “Run failed” 邮件，是否说明没上传？

GitHub Actions 失败表示上传后触发的检查未通过，不等于 Git 推送失败。打开邮件中的 workflow 链接，展开失败步骤查看日志。仓库的 Test 工作流会检查安装、测试与打包清单。

## 如何更新？

先停止桥接进程，确认没有需要处理的在途任务，并按[运行维护](operations.md)备份数据。然后在没有未提交修改的源码目录中运行：

```bash
git pull --ff-only
npm ci
npm test
qq-codex-bridge probe
```

验证通过后重新启动原来的服务。配置和数据库在源码目录之外，不要为了更新删除它们。`/retry` 只重试失败的交付，不会重新执行任务；对于状态不确定的任务，先检查原会话和 QQ 收件记录。
