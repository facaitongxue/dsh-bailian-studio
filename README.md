# 百炼创作台（dsh-bailian-studio）

DSH 插件：在 Web 界面**右侧栏**里生成图片 / 视频，生成动作交给本机的
**bailian CLI（`bl`）** 执行——插件自己不发任何 DashScope REST 请求。

> 生成会按百炼实际用量计费。插件只负责把你的提示词与素材转成一条 `bl` 命令，
> 模型、额度、鉴权都由 `bl` 自己的 Profile（`~/.bailian/config.json`）决定。



使用前：

需要你安装好bailian cli，并且配置好你的api key。

具体方式请参考https://docs.bailian.console.aliyun.com/zh/model-studio/cli/installation

如果实在不知道，就对dsh发送指令：请阅读：https://bailian.aliyun.com/cli/install.md 并按照说明为我安装阿里云百炼 CLI

想要出图牛皮，来学一下这个官方文档：https://docs.bailian.console.aliyun.com/zh/model-studio/wan3-video-generation-prompt-guide





## 功能

- **图片**：文生图，1–6 张，尺寸 / 比例、水印开关；带参考图时自动改走
  `bl image edit`（多图可合并 / 改图）。
- **视频**：文生视频；单张参考图走图生视频（`video generate --image`），
  多图或带参考视频时走参考生视频（`video ref`），支持时长 / 分辨率 / 比例 / 水印。
  时长可选 3 / 5 / 8 / 10 秒，或「自动（按口播）」：传 `--duration -1`，
  由模型根据提示词里的口播长度自己决定（CLI dry-run 已确认会原样下发
  `"duration": -1`）。
- **参考素材**：面板里可直接上传参考图片（最多 3 张）和参考视频（最多 2 个），
  每张素材带 `图1`、`视频1` 这样的编号；在提示词里输入 `@` 会弹出素材列表，
  选中即插入编号，用 `@图1` 指定参考对象。发送前会自动映射成 CLI 的
  `image1` / `video1` 标记。
  在提示词框里 **Ctrl+V 粘贴图片** 会直接进参考素材（剪贴板里有图片时优先按图片处理）。
  **Token Plan 不支持本地素材上传**（CLI 会报 `Local-file temporary upload ...
  "Token Plan" is not supported`）：参考视频请点「+ 视频链接」填公网 HTTPS 地址
  （链接会原样交给 `bl`，不上传本地文件）；参考图片走「+ 图片」本地上传，
  Token Plan 下需要普通 API Key 的 Profile。
- **异步生成**：点生成只提交任务、立即返回，设置页不阻塞，可继续改参数、连续提交。
  - 视频：`bl video ... --async --output json` 拿 `task_id` 就返回；
  - 图片：没有任务查询命令，后台起一次同步生成，同样立即返回 jobId；
  - 宿主内置**单独的 worker**，每 **15 秒**查一次任务状态（`bl video task get`），成功后
    `bl video download` 落盘；
  - 超时由 worker 按 deadline 判断，不依赖 CLI 的阻塞等待；
  - 每条记录独立更新，失败时状态列标红、悬停看原因，详情弹窗里有完整错误。
- **记录**：每条记录固定一行：时间 / 类型 / 状态 / 提示词（窄列、省略）/ 操作。
  操作列点 `⋯` 弹出四个动作：**播放**（视频调本机播放器；图片用面板内大图预览，
  不再依赖新标签弹窗）、**复制视频 / 复制图片**（放入剪贴板；浏览器不支持视频文件
  剪贴板时自动改为复制文件路径）、**打开文件夹**（资源管理器定位任务目录，窗口
  可能在任务栏）、**删除**（确认后删除记录与生成文件）。
- **详情**：点行内其他位置弹出详情：完整提示词（带**复制**按钮）、耗时、错误
  信息、**文件绝对路径**、任务目录，可复制路径 / 查看 / 本机播放。
- **本机播放器**：点击视频预览卡，调用系统默认播放器打开本地文件；详情弹窗里
  也有「本机播放」。卡片里的「在面板内播放」仍可内嵌播放。
- **提示词输入框**：默认约两行高，内容变多时自动长高，到上限后内部滚动。
- **两个入口**：右侧栏 guide 卡片，或会话标题栏右侧的 ✦ 按钮。

## 工作原理

```
浏览器面板 ── fetch /api/bailian-studio/* ──▶ 宿主插件（server.js）
                                              │
                                              ├─ 探活：bl --version / bl auth status
                                              ├─ 素材：/upload 落盘到 outputs/uploads/
                                              ├─ 生成：bl image generate|edit
                                              │        bl video generate|ref
                                              └─ 打开：explorer.exe <文件>（本机默认播放器）
                                                        │
                                                        ▼
                                              落盘 ~/.dsh/bailian-studio/outputs/<任务>/
                                                        │
                                              /file 路由回放给 <img>/<video>
```

命令映射：

| 面板操作          | `bl` 命令                                            |
| ------------- | -------------------------------------------------- |
| 图片，无参考图       | `bl image generate --prompt … --out-dir …`         |
| 图片，有参考图       | `bl image edit --image 图1 --image 图2 … --prompt …` |
| 视频，无参考        | `bl video generate --prompt … --download …`        |
| 视频，单张参考图      | `bl video generate --image 图1 --prompt …`          |
| 视频，多图 / 有参考视频 | `bl video ref --image … --ref-video … --prompt …`  |

提示词里的 `图N` / `视频N` 在发送前替换为 `imageN` / `videoN`。

## 工具

宿主同时注册了 `bailian_studio` 工具，Agent 可以直接调用：

| action   | 作用                       |
| -------- | ------------------------ |
| `status` | 检查 `bl` 版本与登录态（只读，不产生费用） |
| `image`  | 文生图 / 参考图编辑，返回本地文件路径     |
| `video`  | 文生视频 / 图生视频 / 参考生视频      |

面板与工具走同一个 `generateMedia()`，不存在两套命令。

## 配置

`cordis.patch.yml` 的行 config（都可在 DSH 配置里改）：

| 字段                | 默认     | 说明                                  |
| ----------------- | ------ | ----------------------------------- |
| `blEntry`         | `''`   | 留空自动探测；特殊安装位置可填 `bl.exe` 或 `bailian.mjs` 的绝对路径  |
| `outputDir`       | `''`   | 留空用 `~/.dsh/bailian-studio/outputs` |
| `imageTimeoutSec` | `300`  | 图片生成超时（秒）                           |
| `videoTimeoutSec` | `1200` | 视频生成超时（秒）                           |

探测顺序（兼容 npm 与官方二进制安装）：

1. `blEntry`（`.exe` 直接执行，`.mjs` 用 Node 执行）
2. 读 `~/.bailian/install-method`；为 `binary` 时优先二进制
3. 二进制常见位置：`%LOCALAPPDATA%\bailian-cli\bin\bl.exe`、
   `%LOCALAPPDATA%\Programs\bailian-cli\bin\bl.exe`、`%APPDATA%\bailian-cli\bin\bl.exe`、
   `~/.bailian/bin/bl.exe`、`%ProgramFiles%\bailian-cli\bin\bl.exe`（macOS/Linux 对应
   `~/.local/bin/bl`、`/usr/local/bin/bl`、`/opt/homebrew/bin/bl`）
4. npm 全局：`%APPDATA%\npm\node_modules\bailian-cli\dist\bailian.mjs`、
   `~/.npm-global/...`、`/usr/local/lib/node_modules/...`
5. 最后才从进程 `PATH` 找 `bl`（`cmd /c bl`）

> 如果 DSH 比 `bl` 先启动，Windows 不会给已运行的进程刷新 PATH；插件会直接按绝对路径
> 找二进制，因此通常不需要重启。若仍未找到，重启一次 DSH，或在配置里填 `blEntry`。
> `cmd` 兜底的错误输出会按 GBK 解码，不再是乱码。

## 接口

| 方法   | 路径                             | 说明                                |
| ---- | ------------------------------ | --------------------------------- |
| GET  | `/api/bailian-studio/health`   | 探活 + 版本 + 登录态 + 输出目录              |
| GET  | `/api/bailian-studio/recent`   | 输出目录里最近的图片/视频（不含上传素材）             |
| POST | `/api/bailian-studio/upload`   | 上传参考图片/视频，返回本地路径（需要 fence header） |
| POST | `/api/bailian-studio/generate` | 提交任务，立即返回 jobId / taskId（需要 fence header） |
| GET  | `/api/bailian-studio/job?id=…` | 查询任务状态、文件、失败原因 |
| POST | `/api/bailian-studio/open`     | 用本机默认程序打开图片/视频（需要 fence header）   |
| POST | `/api/bailian-studio/reveal`   | 在文件管理器中打开/定位输出目录内的文件（需要 fence header） |
| POST | `/api/bailian-studio/delete`   | 删除记录对应的任务目录或文件（需要 fence header） |
| GET  | `/api/bailian-studio/file?p=…` | 回放输出目录内的文件（支持 Range）              |

## 安全

- `/api/bailian-studio/*` 只允许本机 Host / Origin；写操作额外要求
  `x-dsh-bailian-studio: 1` 请求头（跨站页面带不上）。
- `/file`、`/open` 只接受输出目录之内、扩展名在白名单里的文件；
  `/open` 只会调用系统默认程序，不接受任意命令。
- `/reveal` 与 `/delete` 同样只接受输出目录内的路径；`/delete` 只删除记录对应的
  任务目录/文件，不会动 `uploads/` 或输出目录之外的内容。
- `/upload` 只接受图片/视频扩展名，单个素材上限 30MB（传输体 48MB），
  存到 `outputDir/uploads/`，不会覆盖已有文件。
- 插件不读取、不保存、不回显 API Key；`bl auth status` 里出现的 key 片段
  会被替换成 `sk-***`。
- 生成的云端临时链接（带签名）在日志里会被替换成「已省略」，只保留本地路径。

## 已知边界

- 任务队列存在宿主内存里：重启 DSH 会丢失进行中的任务状态（云端任务可能仍在跑），
  面板会把这类记录标成「状态丢失」，输出目录里的文件不受影响。
- 关掉面板或刷新页面不影响后台任务；客户端每 5 秒问一次本地 `/job`，云端轮询由
  worker 15 秒一次。
- 参考素材上限：图片 3 张、视频 2 个，单个 ≤ 30MB。
- 只有参考视频、完全没有参考图时，`bl video ref` 可能因缺少 `--image` 报错，
  按 CLI 的提示补一张参考图即可。
- 视频耗时通常 1–5 分钟，面板里只显示已用时长，不显示进度百分比。
- 记录只存在浏览器 localStorage（最近 60 条）；输出文件在
  `~/.dsh/bailian-studio/outputs`，删掉后记录里的预览会失效。
- 「本机播放器」依赖系统文件关联；Windows 用 `explorer.exe` 启动关联程序，
  没有默认播放器时会退回浏览器播放。

## 目录

```
index.js           宿主入口：注册工具 + 面板数据面
cli.js             bl 探测 / 子进程执行 / 命令映射 / 输出扫描（无 REST 调用）
server.js          /api/bailian-studio/* 路由（探活、上传、生成、打开、回放文件）
tool.js            bailian_studio 工具
client.js          右侧栏面板（经典脚本，window.__ModuleLoader__ 格式）
cordis.patch.yml   bundle patch
locale/*.json      插件管理器里的标题与描述
icon.svg           插件图标
```
