# 变更记录 · Memory Trace Pipeline Viewer (CHANGELOG)

> 所有版本同步记录在 `src/01-core.js` 的 `APP_CHANGELOG` 常量中（驱动 UI 关于弹窗）。
> 规则：**每次更新都在此追加一条**，并同步递增 `APP_VERSION`。

---

## [1.1.2] — 2025-08-07

**file:// 下半自动跟随（免手动反复重开文件）**

- 需求：用户直接双击打开 HTML（`file://`）时，仍需一遍遍手动重开 trace 文件才能看到仿真器的新写入。
- 根因：`file://` 下所有真·实时通道都被封死——FSA 调用挂起、`fetch()` 被 CORS 拦截、`<input type=file>` 的 `File` 对象在文件被追加后变不可读（`NotReadableError`）。
- 修复：新增**半自动跟随**。`Src.loadFileIncremental()` 只喂入自上次偏移后的新增字节（文件变短则整文件重载，兼容仿真重启）；`openLive()` 在 file:// 下首次全量载入后，每 **4 秒**（`FOLLOW_INTERVAL`）自动重新弹出文件选择框，用户回车重选同一文件即增量追加。标签页隐藏或已暂停时跳过弹框。
- 新增跟随横幅：区分「file:// 半自动 / localhost 自动」两种模式，提供「立即检查 / 暂停跟随 / 停止」按钮，并提示运行 `python3 serve.py` 获取完全免手动的实时跟进。
- 「载入文件」「拖拽」现在会主动停止正在进行的跟随会话。

---

## [1.1.1] — 2025-08-05

**修复「打开并实时跟进」无响应**

- 根因：`File System Access API`（`showOpenFilePicker`）在 `file://` 或不安全上下文下被屏蔽、或调用后**永远不 resolve 也不 reject**（无文件框、无报错），导致按钮表现为"点了没反应"。
- 修复：`openLive()` 在 `fsaUsable = showOpenFilePicker 存在 && isSecureContext && 非 file://` 为假时，**直接走原生文件选择框**载入离线快照，并在状态栏提示"用 `serve.py` 起服务后可启用实时跟进"；仅 `https`/`localhost` 走 FSA 真正的增量实时跟进。
- 说明：`file://` 下通过 `<input type=file>` 拿到的 `File` 对象，在底层文件被仿真器**追加写后会被浏览器置为不可读**（`NotReadableError`），因此 file:// 无法实现真·实时跟进，必须走 `serve.py` 的 HTTP Range 模式。

---

## [1.1.0] — 2025-08-05

**校准、文档、版本化、视觉重构**

- **字段语义校准（核心）**
  - 确认 `L2C_CMP.TYPE` 为 **one-hot**（位 `[]/1/4/6/7/11/12`），本 trace 实测恒为单 bit；
  - 确认 `WRIT=1 ⟺ TYPE∈{0040,0080}`（写 / 写回），升级为已校准；
  - 确认 `SRC=01` 的 `PC` 恒为 `0000` → 预取 / L2 内部路径，升级为已校准；
  - 确认 `RESP` 5-bit 中 `bit2=hit`、`bit4=done` 译码（分布吻合：`00001`/`10001`/`10101`），升级为已校准；
  - 修正先前"AR 先于 L2C_CMP 约 7 cycle"的错误推断——同 cacheline 的 AR↔CMP 几乎不共现，二者时间戳基本重合，故删除该错误顺序描述；
  - 总线标签补充 `ARID / AWID / UNIQ` 字段语义；
  - `DEFAULT_SCHEMA` 引入三级可信度标注：无标记=已确认，`(已校准)`=分布支持，`(推测)`=纯推断。

- **版本与变更机制**
  - 新增 `APP_VERSION`（单一事实来源）与 `APP_CHANGELOG`；
  - 顶部徽标、状态栏、文档 `<meta name="version">`、关于弹窗（ⓘ）均展示版本与更新日志；
  - `build.py` 将 `<!--APP_VERSION-->` 替换为真实版本号。

- **文档**
  - 新增四份文档：开发文档 `DEV.md`、使用说明 `USAGE.md`、特性文档 `FEATURES.md`、本变更记录 `CHANGELOG.md`；
  - 既有 `README.md` 精简为入口说明。

- **视觉重构（用户反馈"页面很丑"）**
  - 统一设计变量（配色 / 圆角 / 阴影 / 字体）；
  - 重做顶栏（渐变分隔、Logo 徽标、版本徽标）、侧栏分组、标签页、按钮、卡片、模态框、欢迎页、状态栏；
  - 分析卡片、变更记录卡片、tooltip 等组件级打磨；
  - 引入细微背景渐变与过渡动画，提升整体质感。

---

## [1.0.0] — 2025-08-04

**初始版本**

- 列式 TypedArray 存储 + 增量解析 + 三种数据源（静态 / FileSystemAccess / HTTP Range 实时跟进）；
- 五个视图：流水线泳道、地址-时间散点、事务生命周期、事件表、分析；
- 字段语义可编辑配置（JSON，本地保存）；
- 留零写回的只读服务 `serve.py`（支持 `Range` / `HEAD`）；
- 预取分析（准确率 / 覆盖率 / 及时性）、事务 CSV 导出、事件表 CSV 导出；
- 自动检测时钟周期、可设事件保留上限。
