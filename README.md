# CPU 访存 Trace 流水线分析器（Trace_Worker）

一个**纯前端**的 CPU 访存 Trace 分析工具，把半结构化的访存 trace（时间 / 事件类型 / PC / 缓存行首地址等键值记录）解析为可视化的时序泳道、访存分析、流水线事务链路与统计报表。**数据完全在本机浏览器中解析，不上传任何服务器。**

版本：`v0.07.0`　作者：`konglingjun`

---

## 功能特性

- **多视图分析**
  - 时序泳道（Timeline）：按事件类型分行的甘特图式时间线，支持缩放 / 平移 / 缩略图导航。
  - 访存分析（Access）：按缓存行地址聚合的访存行为视图。
  - 流水线事务（Pipeline）：Load / Store / 预取事务链路与阶段关联，基于 PROFILE 驱动。
  - 事件表（Table）：原始事件逐行明细。
  - 统计分析（Stats）：事件类型、周期跨度等聚合统计。
  - 语义字典（Dict）：事件类型 → 角色（addr/id/pc/from/ready）绑定与字段取值标注，内置 openC910 默认方案，可导入 / 导出 / 恢复。
- **灵活加载方式**
  - 选择单个 Trace 文件
  - 选择整个文件夹（自动挑首个 trace 文件）
  - 拖拽文件到加载页
  - 粘贴 Trace 文本（沙箱 / 预览环境下文件对话框被拦截时的可靠回退）
  - **示例 Trace 按钮**：一键列出 `example/` 目录下的 `.txt` 示例并选择打开
- **过滤与快速定位**：按事件类型、PC、缓存行地址、IID、全文关键字过滤；支持高级表达式。
- **导出**：当前视图导出为 CSV / PNG / SVG。
- **主题**：深色 / 浅色 / 米色切换。

## 支持的 Trace 格式

每行一条记录，分号 `;` 分隔的键值对，**至少包含「时间戳」与「事件类型」两段**，时间戳须为数字：

```
<TIME> ; <TAG> ; KEY:VALUE ; KEY:VALUE ; ...
```

示例：

```
105850000;BIU_PAD_AR;USER:2;SIZE:4;ADDL:0000000000;PC:0000;
302350000;LSU_LD_PIPE3;PC:19d8;PREG:02;ADDL:00000034c0;IID:0a;
106550000;L2C_CMP;ADDL:0000000000;TYPE:1000;RESP:00001;STAL:0;
```

- 以 `#` 或 `/` 开头的行视为注释跳过。
- 内置 openC910 / Triverse 预取器语义；其余事件类型自动泛化处理。
- 分隔符不同（非分号）时，请先转换成分号分隔再加载。

## 快速开始

### 本地运行

由于示例加载依赖 `fetch`（读取 `example/` 目录），需通过 HTTP 服务打开，不能直接用 `file://` 双击：

```bash
cd Trace_Worker
python3 -m http.server 8000
# 浏览器访问 http://127.0.0.1:8000/
```

打开后：
1. 在加载页点击 **📁 示例 Trace**（或工具栏同名按钮），选择 `example/tracesource/trace.txt` 即可体验；
2. 也可拖拽 / 选择自己的 trace 文件，或粘贴文本加载。

### 部署到 GitHub Pages

1. 将本仓库推送到 GitHub。
2. 在仓库 **Settings → Pages** 中，选择 `main` 分支根目录作为源。
3. 访问 `https://<user>.github.io/<repo>/`。

示例文件路径已基于当前页面 URL 动态解析（`new URL('example/', location.href)`），因此无论仓库名是什么、部署在根域还是子路径，示例文件都能正确加载，无需硬编码仓库名。

### 新增 / 管理示例 Trace

示例清单位于 `example/samples.json`，其中的 `files` 为相对 `example/` 目录的路径：

```json
{
  "files": [
    "tracesource/trace.txt"
  ]
}
```

把新的 `.txt` 放入 `example/` 下任意子目录，并在 `files` 中登记相对路径即可在示例选择器中显示。若 `samples.json` 缺失，工具会回退探测 `example/tracesource/trace.txt`。

## 目录结构

```
Trace_Worker/
├── index.html            # 主程序（单文件，含 HTML/CSS/JS）
├── tf.mjs                # 解析 / 事务计算等脚本模块
├── test_frontend.mjs     # 前端测试
├── example/
│   ├── samples.json      # 示例清单
│   └── tracesource/
│       └── trace.txt     # 示例 trace
├── 更新记录.md
├── 开发报告.md
└── 前端测试报告.md
```

## 技术说明

- 纯静态前端，无构建步骤、无第三方运行时依赖。
- 语义解析采用 **PROFILE 驱动**框架：事务组装由 `PROFILE.roles`（addr/id/pc/from/ready 抽象）、`PROFILE.events`（match → role 映射）、`PROFILE.txns`（stages/key/link 定义）计算，内置 openC910 默认 profile，并支持 localStorage 持久化与 JSON 导入导出。
- 解析与渲染针对十万行级 trace 做了性能优化。

## 注意事项

- 在部分在线预览 / 沙箱环境中，原生文件选择对话框可能被拦截；此时请使用「粘贴 Trace 文本」或「示例 Trace」按钮。
- 加载前请确保浏览器允许本地文件读取（经 HTTP 服务打开可避免 `file://` 的 CORS 限制）。
