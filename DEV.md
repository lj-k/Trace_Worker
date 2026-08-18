# 开发文档 · Memory Trace Pipeline Viewer (DEV)

> 本文件面向**二次开发者 / 维护者**，说明 `trace-viewer.html` 的内部架构、数据模型、构建与测试流程。
> 使用者请直接看 [USAGE.md](./USAGE.md)；功能清单见 [FEATURES.md](./FEATURES.md)；版本历史见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 1. 工程结构

```
workspace/
├── trace-viewer.html   # ★ 主交付物：单文件 HTML（由 build.py 拼装）
├── serve.py            # 只读 HTTP 服务（支持 GET/HEAD/Range，供实时跟进）
├── build.py            # 把 src/ 下的源拼成单文件 HTML
├── README.md           # 短版说明
├── DEV.md              # 本文件
├── USAGE.md / FEATURES.md / CHANGELOG.md
└── src/
    ├── index.html      # HTML 骨架（含 <!--INLINE_CSS--> / <!--INLINE_JS--> 占位）
    ├── style.css       # 全部样式（设计变量集中在 :root）
    ├── 01-core.js      # 列式存储 / 增量解析 / 数据源 / 字段语义
    ├── 02-views.js     # Canvas 渲染：流水线 / 地址-时间 / 事务 / 概览
    └── 03-ui.js        # 交互、详情面板、表格、事务、分析、引导、版本
```

构建顺序固定：`01-core.js → 02-views.js → 03-ui.js`（`build.py` 按 `0*.js` 字母序 glob 拼接），
三者共享同一全局作用域（`'use strict'` 下的顶层 `const`/`function` 互相可见）。

---

## 2. 数据模型

### 2.1 列式存储 `Col`
`Col` 是「可增长的 TypedArray 包装」，避免对象数组带来的 GC 与内存开销。

```js
class Col {                       // 底层 Float64/Uint8/Int32/Int16Array 自动翻倍扩容
  constructor(Type, cap=4096)
  push(v); get(i); set(i,v);
  shiftFrom(from);                // 环形覆盖：把 [from,n) 搬到 0，丢弃头部
}
```

### 2.2 事件存储 `S`
所有事件平铺成若干 `Col`（按列存储，而非每行一个对象）：

| 列 | 类型 | 含义 |
| --- | --- | --- |
| `time` | Float64 | 事件时间戳（tick） |
| `tag` | Uint8 | 事件类型在 `S.tags[]` 中的下标 |
| `addl` | Float64 | cacheline 首地址（流水主键） |
| `pc` | Int32 | 触发指令 PC（无则 −1） |
| `iid` | Int16 | 指令 ID（短窗口内唯一） |
| `row` | Int32 | 该事件在所属 tag 的逐字段列中的行号 |
| `flag` | Uint8 | 位标志：`F_DEMAND/F_PFREQ/F_BUS/F_PFTRAIN/F_L2` |
| `nextLine/prevLine` | Int32 | 同 cacheline 的前后事件（链表） |
| `nextIID` | Int32 | 同 IID 的下一个 LSU 事件 |

每个 tag 独立持有自己的字段列集合（`T.cols[]`，每个字段一个 `Col`），由 `T.fidx` 做字段名→列下标映射。
字符串统一走 `intern()` 字典压缩（`S.strs[]`），列里只存整数 id。

跨事件链接地图：`S.lastByLine`（addl→最近事件）、`S.lastByIID`（iid→最近事件），O(1) 维护。

### 2.3 标志位
```js
const F_DEMAND=1, F_PFREQ=2, F_BUS=4, F_PFTRAIN=8, F_L2=16;
```
解析时按 tag 名称一次性打标（`DEMAND_TAGS`/`PF_REQ_TAG`/`BUS_TAGS`/`L2C_CMP`）。

---

## 3. 解析器（数据驱动）

`parseChunk(text)` 按行切分，`parseLine(s,a,b)` 解析单行：

1. 跳过空行 / `#` / `//` 注释；
2. 第一个 `;` 之前 = `time`，第二个 `;` 之前 = `tag`（自动 `tagOf()` 注册新类型）；
3. 之后每段 `K:V` 自动成为该 tag 的一个新字段列（首见即建列，旧行回填 0）；
4. 解析 `ADDL/PC/IID` 为数值，按名称打标志位，维护 cross-link；
5. 维护时间戳直方图 `S.deltaHist` 用于 `detectPeriod()`（相邻时间戳差值的 GCD）。

> **关键点**：没有任何字段/类型被硬编码。新仿真器打印出新的 `Tag` 或 `K:V`，前端无需改代码即可识别、上泳道、进表格、进过滤。

---

## 4. 数据源（实时跟进）

`Src` 统一三种来源，对外暴露 `feed(text)`（增量喂入，保留半行 pending）：

| 来源 | 机制 | 实时？ | 要求 |
| --- | --- | --- | --- |
| 静态文件 | `FileReader` 切片读 | 否 | 任意环境 |
| 文件句柄 | FileSystemAccess `getFile()` 周期对比大小 | 是 | https/localhost |
| HTTP | `HEAD` 探大小 + `Range: bytes=N-` 只拉增量 | 是 | 服务器支持 Range |

**截断检测**（仿真器重写文件）：若探测到 `total < offset`，执行 `S.reset()` 并 `Bus.emit('reset')`，UI 自动重建。
**空轮询零噪声**：`probeSize()` 先 `HEAD` 探大小，`offset>=total` 时直接返回、不发 Range 请求，避免 416 刷屏。

---

## 5. 渲染（Canvas）

- **视口 `VP`**：`{t0,t1,y0,y1}`，所有视图共享时间轴逻辑。
- **过滤 `FILT`**：基于 `time` 列二分（`lowerBound/upperBound`）取时间窗口，叠加 tag 开关、PC/地址/IID 过滤。
- **泳道 `LANES`**：`computeLanes()` 按 `GROUP_ORDER`（CORE→L2→PF→BUS）与 `TAG_META.o` 排序生成泳道 Y 坐标。
- **概览 `OV`**：全局密度分箱 + 可拖拽 brush，对应主视图时间窗。
- **流水线 `drawPipe`**：泳道 + 同 cacheline 贝塞尔连线 + 事件标记（预取为菱形）+ 密度聚合（过密时降级为密度条）。
- **命中测试 `hitTest`**：维护屏幕坐标→事件下标映射，支持 tooltip / 选中。
- **DPR 缩放**：`canvas.width = cssW*dpr`，保证高分屏清晰。

> 渲染全部走 `requestDraw()`（rAF 合并），避免重复绘制；`PIPE.lastFrameMs` / `PIPE.visN` 暴露给状态栏做性能显示。

---

## 6. 字段语义系统（可编辑）

`DEFAULT_SCHEMA` 是字段译码的默认值，`SCHEMA`（用户覆盖，存 `localStorage`）可经 `⚙` 编辑：

```jsonc
{ "radix": 16,            // 进制 16/10/2
  "bits":  ["valid","b1","hit","b3","done"],  // one-hot 位名，下标=位号
  "enum":  {"0":"读","1":"写"},               // 值→含义
  "desc":  "说明" }
```

`decodeField(tag,field,val)` 依次尝试 enum → bits → 十六进制数值展示；详情面板与分析页均调用它。
**默认值已用 trace 全量统计做过校准**，校准结论与待确认的 `(推测)` 标注见下方第 8 节与 `FEATURES.md`。

---

## 7. 构建与版本

```bash
python3 build.py     # 读取 src/index.html + style.css + 0*.js → trace-viewer.html
```
- `index.html` 中的 `<!--INLINE_CSS-->` / `<!--INLINE_JS-->` 被替换；
- `<meta name="version" content="<!--APP_VERSION-->">` 被替换成 `APP_VERSION`（`01-core.js` 里的常量，单一事实来源）；
- 单文件产物可直接双击或部署到任意静态站点，**无外部依赖、无网络请求**。

版本号与变更记录集中在 `01-core.js`：
```js
const APP_VERSION = '1.1.0';
const APP_CHANGELOG = [ { v, date, items:[...] }, ... ];
```
UI 顶部徽标、状态栏、关于弹窗（`mAbout`）均消费这两个常量。**每次更新请同步修改此处并重建。**

---

## 8. 校准方法（如何复核字段语义）

字段默认解释的"可信度"分三级，写在 `DEFAULT_SCHEMA` 注释与 enum 文案里：

| 标记 | 含义 |
| --- | --- |
| 无 | 已由统计强相关确认 |
| `(已校准)` | 由分布/相关性支持，但位名/子类仍待 RTL 最终确认 |
| `(推测)` | 纯推断，请按实际 RTL 修正 |

复核流程（见 `DEV` 工作目录下的 `calib.py` 脚本思路）：
1. 全量读 trace，按 tag 统计各字段取值分布；
2. 交叉验证：如 `WRIT` 与 `TYPE` 的联合分布、`SRC` 与 `PC` 的联合分布；
3. 时间序验证：同 cacheline 事件相邻时间差、AR↔CMP 顺序；
4. 把"强相关"升级为已校准/确认，把"无依据"降级为推测。

**已校准结论（v1.1）**：`TYPE` 为 one-hot（位 `[]/1/4/6/7/11/12`）；`WRIT=1 ⟺ TYPE∈{0040,0080}`；
`SRC=01` 的 `PC` 恒为 `0000`（=预取/L2 内部路径）；`RESP` 5-bit 中 `bit2=hit`、`bit4=done` 的分布吻合。

---

## 9. 测试

用 Playwright（headless Chromium）做回归：验证零 JS/网络错误、5 个视图渲染非空白、实时追加被探测、截断重置生效。
脚本示例（在 `trace-viewer.html` 目录）：

```js
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ executablePath: '<chromium>/chrome-linux64/chrome' });
const page = await browser.newPage();
const errors = [];
page.on('console', m => m.type()==='error' && errors.push(m.text()));
page.on('pageerror', e => errors.push(String(e)));
await page.goto('file://.../trace-viewer.html');
await page.evaluate(() => window.S && window.S.n);   // 需先 loadFile / 示例数据
// ...断言 errors.length === 0，各 canvas 像素非全透明
```

---

## 10. 扩展指引

- **新增字段译码**：在 `DEFAULT_SCHEMA["*"]` 或对应 tag 下加字段定义即可，无需改渲染。
- **新增泳道分组**：在 `TAG_META` 给 tag 指定 `g`（CORE/L2/PF/BUS/OTHER），`GROUP_ORDER` 决定纵向顺序。
- **新增视图**：在 `03-ui.js` 注册一个 pane（仿 `drawAddr`/`drawPipe`），在 `drawAll` 里分发，并加一个 tab。
- **新增分析卡片**：在 `renderAnalytics()` 里追加 `.card` HTML（已封装 `.kpi/.hbar/.spark` 样式）。
