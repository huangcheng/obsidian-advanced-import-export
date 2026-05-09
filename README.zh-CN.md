# Cross-App Notes Bridge

[English](README.md) · [简体中文](README.zh-CN.md)

一款 [Obsidian](https://obsidian.md) 插件，把笔记导出为可移植的纯 Markdown，并把你的库与其他笔记应用打通 —— Bear（通过 `x-callback-url`）、WPS 云笔记、有道云笔记、Flomo（分别通过其 CLI / MCP 客户端）。

移动端友好：stdio 形式的 MCP 传输和 Bear 协议在运行时被守卫，iOS / Android 上会优雅降级，不会崩溃或报错。

![文件管理器右键子菜单：Copy as pure Markdown、Bear、WPS 云笔记、有道云笔记、Flomo](docs/screenshots/context-menu.png)

## 为什么是一个插件，而不是四个？

这些集成共用同一条流水线 —— 选择 → Markdown 变换 → Provider 派发 —— 而真正在意 Markdown 可移植性的人，往往同时用其中好几款应用。打包在一起避免了变换层重复实现，也让右键菜单只有一个统一入口。每个 Provider 可以在设置里独立启用/禁用、独立"信任"，没启用的就不会出现在菜单里。

插件刻意只为这几款应用提供**一等公民客户端**；目前没有"添加任意 MCP 服务器"那种通用 UI —— 因为没有任何一种集成形态能套到所有 MCP 服务器上。新的 Provider 会以一等公民的方式逐步加进来。

## 功能

### 导出为纯 Markdown

把 Obsidian 特有语法转成在哪里都能用的纯 Markdown：

- **Copy as pure Markdown** —— 把当前笔记变换后复制到剪贴板。
- **导出到文件夹** —— 把变换后的笔记写到可配置的导出目录。

#### 变换选项

| 选项 | 说明 | 默认 |
|--------|-------------|---------|
| 解析 `[[wikilinks]]` | 把双链转成标准 Markdown 链接 | 开 |
| 嵌入处理 | 如何处理 `![[embeds]]` | 替换为链接 |
| 拍平 callout | 把 `> [!note]` callout 转成普通块引用 | 开 |
| 去掉 frontmatter | 输出中删除 YAML frontmatter | 关 |
| 改写附件路径 | 图片/附件路径如何处理 | 相对于库 |

### Bear（macOS / iOS）

- **发送当前笔记到 Bear** —— 通过 `bear://x-callback-url/create` 派发；frontmatter 里的标签会保留。
- **从 Bear 导入** —— 输入笔记 UUID 或 Bear 链接，插件会唤起 Bear，并把 Bear 回传的内容写入你的库。

### WPS 云笔记（桌面端）

通过 WPS Note CLI 或其 MCP 服务端把笔记发送到 WPS 云笔记。在设置里配置传输方式、命令路径和请求头即可。

### 有道云笔记（桌面端）

通过官方 `youdaonote` CLI 把笔记发送到有道云笔记。插件能自动探测 CLI、把 API Key 推送给 CLI，并支持在设置里跑连接测试。

### Flomo

通过 Flomo 官方的 streamable-HTTP MCP 服务（`https://flomoapp.com/mcp`）把 memo 推送到 Flomo。需要 Flomo Pro 账号和一个个人 API Token，每个 Provider 在设置里独立配置。**只支持发送，不支持反向导入** —— Flomo 的 MCP 目前是只写接口，把 memo 拉回库里这条路还没开。

### 右键菜单

在文件管理器里右键任意文件（或先多选再右键），就能在 **Cross-App Notes Bridge** 子菜单里找到所有可用动作。

## 设置

入口：**Settings → Community plugins → Cross-App Notes Bridge**。

- **导出文件夹** —— 导出笔记的目录（默认：`Exports`）
- **导入文件夹** —— 导入笔记的目录（默认：`Imports`）
- **并发数** —— 并行导出 worker 数量（默认：4）
- **变换选项** —— 配置 Markdown 输出格式
- **Providers** —— 独立启用、信任、配置 Bear / WPS / 有道 / Flomo

## 命令

| 命令 | 说明 |
|---------|-------------|
| `Copy as pure Markdown` | 变换当前笔记并复制到剪贴板 |
| `Export current note as pure Markdown` | 把当前笔记导出到文件夹 |
| `Send active note to Bear` | 把当前笔记派发到 Bear |
| `Import from Bear` | 通过 UUID 或链接从 Bear 导入笔记 |
| `Send active note to WPS Cloud Note` | 把当前笔记派发到已配置的 WPS Provider |
| `Send active note to Youdao Note` | 把当前笔记派发到已配置的有道 Provider |
| `Send active note to Flomo` | 把当前笔记作为 memo 派发到已配置的 Flomo Provider |

## 安装

### 通过 BRAT 安装（推荐，便于跟随 Beta 更新）

插件目前还没进官方社区市场。最方便的安装与持续更新方式是用 [BRAT（Beta Reviewers Auto-update Tool）](https://github.com/TfTHacker/obsidian42-brat)：

1. 在 **Settings → Community plugins → Browse** 安装 **BRAT** 并启用。
2. 打开 **Settings → BRAT → Add Beta plugin**，粘贴 `huangcheng/obsidian-advanced-import-export`。
3. BRAT 会把最新 Release 下载到你的库里，并自动跟随后续版本更新。

关于自动更新和锁定到特定版本，见 [BRAT 插件文档](https://tfthacker.com/brat-plugins)。

### 从 GitHub Release 安装

1. 从 [最新 Release](https://github.com/huangcheng/obsidian-advanced-import-export/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`。
2. 把它们放进 `<你的库>/.obsidian/plugins/advanced-import-export/`。
3. 在 **Settings → Community plugins** 里启用插件。

### 从源码构建

```bash
git clone https://github.com/huangcheng/obsidian-advanced-import-export.git
cd obsidian-advanced-import-export
npm install
npm run build
```

把构建产物（`main.js`、`manifest.json`、`styles.css`）拷到你库里的插件目录即可。

## 开发

```bash
npm install        # 安装依赖
npm run dev        # watch 模式，改动自动重新构建
npm run build      # 生产构建
npm run lint       # 跑 ESLint
```

## 隐私

- **零遥测。** 插件不会调用任何统计、追踪或"回家上报"接口。
- **凭据全部留在本地。** API Key 和 Provider 配置存在库内的插件数据文件（`.obsidian/plugins/advanced-import-export/data.json`），除非你主动触发了到所配置 Provider 的调用（如 WPS 服务端、有道 CLI 子进程、Bear 的 URL Scheme），否则不会离开你的机器。
- **网络调用范围严格随 Provider 配置而定。** 禁用或取消信任某个 Provider，会停掉它所有的网络调用。
- **出站地址：** Bear → `bear://` URL Scheme（本地 IPC，不走网络）；WPS → 你配置的服务端 URL 或 CLI 二进制；有道 → 本地的 `youdaonote` CLI（CLI 用你提供的 API Key 替你调用有道 API）；Flomo → `https://flomoapp.com/mcp`，带 `Authorization: Bearer <你的 Token>`。

## 许可证

[MIT](LICENSE)
