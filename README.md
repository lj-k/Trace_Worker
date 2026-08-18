# CPU 访存 Trace 流水线可视化 (Memory Trace Pipeline Viewer) — v1.1.0

读取 `Time;Tag;K:V;…` 格式的 CPU 访存仿真 trace，把 **LSU → L2 → 预取器 → 总线 → LSU 写回**
的整条流水以泳道形式实时呈现。可以打开本地 trace 文件做离线分析，也可以**只读**地跟进
仿真器持续写入的 trace 文件。

> 当前版本 **v1.1.0** · 字段语义已用本 trace 全量统计校准（`TYPE` one-hot、`WRIT` 与 `TYPE` 位 6/7 完全对应、`SRC=01` 为预取路径、`RESP` 位域 `valid/hit/done` 译码已校准）。
> 详细变更见 [CHANGELOG.md](./CHANGELOG.md)。

## 文件清单

| 文件 | 说明 |
| ---- | ---- |
| `trace-viewer.html` | **主交付物**：单文件 HTML，直接双击或部署到任意静态站点 |
| `serve.py` | 只读 HTTP 服务，支持 `Range` 增量拉取 |
| `build.py` | 把 `src/*.js` + `src/style.css` 拼进 `index.html`，并注入版本号 |
| `src/` | 模块化源代码 |
| `DEV.md` | [开发文档](./DEV.md) — 架构、数据模型、构建、扩展指引、测试 |
| `USAGE.md` | [使用说明文档](./USAGE.md) — 安装、操作、视图、字段语义、性能 |
| `FEATURES.md` | [特性文档](./FEATURES.md) — 能力边界与实现要点 |
| `CHANGELOG.md` | [变更记录文档](./CHANGELOG.md) — 完整版本历史 |

## 快速开始

```bash
# 实时跟进（推荐）
cd /path/to/trace/
python3 /path/to/serve.py            # 启动只读 HTTP 服务（默认 8777 端口）
# 浏览器打开 http://localhost:8777/trace-viewer.html
# 点 "📡 打开并实时跟进" 或 "🌐 URL"，或直接：
#   http://localhost:8777/trace-viewer.html?url=trace.txt&live=1

# 离线分析
python3 -m http.server 8777
# 双击 trace-viewer.html，或：
#   http://localhost:8777/trace-viewer.html → 点 "📂 载入文件" / 拖拽 / 🎲 示例数据
```

> 全程**只读**：只调用只读文件句柄与 `GET`/`HEAD` 请求，绝不写回 trace 文件，对仿真器零影响。
> 仿真器把文件截断重写时，前端会自动检测并从头开始。

## 版本与变更机制

- `src/01-core.js` 的 `APP_VERSION` 是版本号**单一事实来源**；
- `build.py` 自动注入到 `<meta name="version">`；
- UI 顶部徽标 + 状态栏 + 关于弹窗（ⓘ）均展示版本与完整更新日志；
- **每次更新请同时修改 `APP_VERSION`、`APP_CHANGELOG` 与 `CHANGELOG.md`**，然后 `python3 build.py`。

## 许可 / 依赖

- 纯前端，无外部依赖、无网络请求；
- 可选：实时跟进的只读服务 `serve.py`（Python 3.11+）。