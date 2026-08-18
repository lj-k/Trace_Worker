# 特性文档 · Memory Trace Pipeline Viewer (FEATURES)

> 面向**评审 / 选型 / 能力核对**。逐条列出本工具的能力边界与实现要点。版本相关条目以 v1.1.0 为准。

---

## 1. 核心能力

### 1.1 流水线可视化
- 把一次访存的完整生命周期（`LSU 发起 → L2C 比较/仲裁 → 预取器训练/请求 → 总线 AR/AW → 写回`）以**分组泳道**呈现；
- 泳道分组：`CORE → L2 → PF(预取) → BUS`，顺序由 `GROUP_ORDER` 驱动，紧贴物理数据流；
- **同 cacheline 事件自动连线**（贝塞尔 + 箭头），直观展示"地址/PC/时间"的跨阶段动态关系；
- 预取事件以 **♦ 菱形** 区别于普通点，便于区分需求访问与预取。

### 1.2 五种视图
1. 流水线（swimlane + link）
2. 地址-时间散点（支持压缩排名 / 线性地址两种 Y 轴，按 tag/PC/需求-预取着色）
3. 事务生命周期（按 cacheline 聚合，gap 拆分）
4. 事件表（虚拟滚动，全字段 + 译码）
5. 分析（预取/总线/热点/步幅/延迟）

### 1.3 实时跟进（只读）
- 三种数据源：**静态文件**、**FileSystemAccess 只读句柄**、**HTTP Range 轮询**；
- **file:// 半自动跟随**：双击打开本页时，FSA/fetch/File 对象均不可用于真·实时，故每 4 秒自动重弹文件选择框，重选同一文件即增量追加新行（见 1.3.1）；
- 增量读取新追加字节，仿真器边写、前端边画；
- **截断检测**：文件被重写时自动从头重建（file:// 下因 File 对象失效亦自动整文件重载）；
- 跟随横幅区分「file:// 半自动 / localhost 自动」两种模式，提供「立即检查 / 暂停 / 停止」；
- 状态栏实时显示"最近新增于 Ns 前"；支持暂停/继续与"跟随最新"。

---

## 2. 数据引擎

| 特性 | 说明 |
| --- | --- |
| 列式存储 | 增长型 TypedArray（`Float64/Uint8/Int32/Int16`），字符串走字典压缩（`intern`） |
| 增量解析 | `parseChunk` 流式喂入，保留半行 `pending`，可边下边解 |
| 数据驱动 | 新 `Tag` / 新 `K:V` 字段**自动识别**，无需改代码即上泳道、进表、进过滤 |
| 跨事件链接 | 同 cacheline 链表（`nextLine/prevLine`）+ 同 IID 链（`nextIID`），O(1) 维护 |
| 时间二分 | `lowerBound/upperBound` 在已排序时间列上取窗口，过滤 O(log n) |
| 周期自检测 | 相邻时间戳差值的 GCD 作为时钟周期，可手动覆盖 |
| 内存上限 | 可设保留上限，自动环形覆盖最早数据（`trimStore`） |

---

## 3. 预取分析（Triverse 相关）

针对 `openC910 + Triverse` 多模式预取器的集成分析：

- **准确率**：被预取的 cacheline 中，后续是否被需求访问命中的比例；
- **覆盖率**：需求 miss 中，有多少已被预取提前带入；
- **及时性**：预取点到对应需求点的提前量（lead cycles，p10/p50/p90 分位）；
- **事务分类**：`pfhit`（有效预取）/ `pfwaste`（无效预取）/ `miss`（含总线访问）/ `other`；
- `L2_TriPF`(训练) → `TriPF_L2`(预取请求，含 `READY` 反压标志) 的链路在流水线视图中天然可见。

> 校准实测（本 trace）：预取命中率约 **89.8%**，提前量中位数 **~405 cycle**（p10=9，p90=3311）。

---

## 4. 字段语义系统

- 可编辑 JSON 译码配置（`⚙`），存浏览器本地；
- 支持 `radix`（进制）、`bits`（one-hot 位名）、`enum`（枚举）、`desc`（说明）四种语义；
- 详情面板与分析页统一调用 `decodeField()` 翻译 `TYPE/RESP/SRC` 等编码；
- **v1.1 已用全量统计校准**关键字段（见 [USAGE.md §6](./USAGE.md) 与 [CHANGELOG.md](./CHANGELOG.md)）。

---

## 5. 交互与分析辅助

- 全局搜索（pc/addr/iid/tag/全字段子串）；
- 侧栏过滤（PC、cacheline、地址范围、IID、仅选中行）；
- 选中任意事件 → 高亮其 cacheline 全链路 + 详情面板展示原始字段与译码；
- 分析页卡片：预取 KPI、总线活动、热点 PC/line、每-PC 步幅分布、各类延迟直方图；
- 事务表 / 事件表均可导出 **CSV**。

---

## 6. 架构与交付

| 特性 | 说明 |
| --- | --- |
| 单文件交付 | `build.py` 把 `src/*.js + style.css` 拼进 `index.html` → 单文件 `trace-viewer.html` |
| 零依赖 | 无外部 CDN、无网络请求，可双击即用 / 静态托管 |
| 版本机制 | `APP_VERSION` 单一事实来源，注入 `<meta>` + 顶部徽标 + 状态栏 + 关于弹窗 |
| 变更记录 | `APP_CHANGELOG` 驱动关于弹窗，并与 `CHANGELOG.md` 同步 |
| 高 DPI | Canvas 按 `devicePixelRatio` 缩放，高分屏清晰 |
| 只读服务 | `serve.py` 仅 `GET/HEAD/OPTIONS` + `Range`，对仿真器零影响 |

---

## 7. 已知限制

- 解析假设 trace **按时间非降序**写入（同 tag 内 `time` 不必唯一，实测有 568 对重复 `(time,tag)`）；
- `RESP/CLCP/STCP/HPCP/MID` 等控制位的部分子类含义仍为 `(推测)`，需对照 RTL 修正；
- 实时跟进的文件句柄模式依赖 File System Access API，仅在 https/localhost 可用（可用 URL 模式替代）；
- 单文件 HTML 内的 `⚙` 配置存于浏览器 `localStorage`，换浏览器/清缓存需重新配置。
