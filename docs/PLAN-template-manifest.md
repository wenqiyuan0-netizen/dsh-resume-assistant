# 模板重写：manifest 化方案

> 结论先行：**上游是"共享渲染器 + 每模板一份语义 manifest"，外加一份手写 Page 组件作为视觉真相**。
> 所以"复用"不但可行，而且正是上游自己在走的迁移方向（`legacy-converter.ts` /
> `legacy-parity.ts` 就是把老的手写页面搬进语义模型）。
> 对我们最优的做法：**渲染器只有一份，15 个模板变成 15 份 JSON manifest**。

## 一、原版代码的实际情况（实测）

```
packages/pdf/src/templates/<name>/
├── XxxPage.tsx      6–11 KB   手写 @react-pdf 页面（视觉真相，逐模板独立）
└── semantic.ts      0.5–2.6 KB  语义 manifest（区域/部件/绑定，可复用、可被索引）

packages/pdf/src/semantic/      共享机械层
├── template-manifest.ts  343 行   manifest 的类型 + 装配
├── tree.ts               918 行   唯一渲染器：按 manifest 建节点树
├── binding-inventory.ts  194 行   语义节点 ↔ 原始字段的绑定清单
├── base-styles.ts        108 行   共享排版刻度
├── shared-parts.ts        36 行   跨模板共用的部件（如 item-header-row）
├── legacy-converter.ts   242 行   手写页面 → 语义树 的转换
└── legacy-parity.ts      290 行   新旧渲染结果的逐节点比对
```

各模板 manifest 的体量：`kakuna/lapras/onyx` 13 行、`gengar` 29 行、`meowth` 70 行。

**所以答案是"混合"**：视觉仍然是每模板手写的（Page.tsx），但**结构、绑定、样式选择器已经 manifest 化**。
manifest 里已经出现 `regions`（header/main/sidebar/featured）、`parts`（绑定到 section/item/item-header）、
`aliases`（把模板私有节点映射到标准节点名）这些概念 —— 这就是"AI 能控制的类型"的雏形。

## 二、我建议的架构（镜像上游，但不搬 react-pdf）

```
lib/render/
├── tokens.js      字体/字号阶梯/间距/颜色/圆角：唯一排版刻度
├── blocks.js      原子块：header / section / item / item-header / contact / photo / chips / bar / timeline
├── manifest.js    15 份模板 manifest（纯数据）+ 校验
├── compose.js     唯一渲染器：manifest + 简历数据 → HTML
└── css.js         由 tokens + manifest 生成 CSS（含 @page/分页）
```

manifest 的形态（可被 AI 直接生成/微调）：

```js
{
  id: 'gengar',
  page: { margin: [18, 22], gap: 4 },
  regions: {                        // 区域 → 栏目归属
    header:  { photo: 'left', band: true },
    main:    ['summary', 'experience', 'projects'],
    sidebar: ['skills', 'languages', 'profiles', 'interests'],
  },
  decorations: {                    // 皮肤：这是"不寡淡"的关键
    sectionTitle: 'caps-underline', // caps | underline | bar | chip
    item: { marker: 'dot-timeline', header: 'stacked' },  // 时间线/单行/双行
    skills: { shape: 'bar', width: '42%' },
    accent: { use: 'sidebar-fill' }, // 主色用在哪：页眉带/侧栏底/标题条
  },
  tokens: {                          // 可继承，缺省用全局
    body: { size: 10, line: 1.38 },
    heading: { size: 13, transform: 'uppercase' },
  },
}
```

**为什么这样比"逐个手写 CSS"更好**

| | 15 份手写 CSS | 15 份 manifest（本方案） |
|---|---|---|
| 新增模板 | 写一套新 CSS | 加一份 ~1KB JSON |
| AI 参与 | 只能改字符串 | 生成/微调结构字段，渲染器保证合法 |
| 一处排版修正 | 15 处 | tokens 一处 |
| 回退/对比 | 难 | manifest 是数据，可 diff、可 A/B |
| 分页/拖拽 | 与排版纠缠 | manifest 里 regions 即栏目归属，和 `layout.pages` 天然对应 |

## 三、落地顺序

1. **P1**：`tokens.js` + `blocks.js` + `compose.js` 抽出（现有 `render.js` 的 `STYLES` 表升级成 manifest）。
   验收：现有 15 个模板 id 仍能渲染，输出与今天等价。
2. **P2**：以 `onyx`、`gengar` 的 `Page.tsx` 为视觉参照，产出两份"对齐版" manifest。
   验收：并排对比原版导出的 PDF，肉眼一致（字号/间距/主色用法/标题装饰）。
3. **P3**：其余 13 个批量产出 manifest，AI 生成 + 逐个人工校对。
4. **P4**：manifest 增加能力字段（照片位置/形状、侧栏填充、双栏比例、栏目小标题的图标）。
   这一步之后"寡淡"问题从根上解决，因为装饰是 manifest 的一等公民。

## 四、不做的事

- **不搬 `@react-pdf/renderer`**：它是 PDF 图元 + Yoga 布局，无法在浏览器 iframe 里跑；
  搬它等于把整个渲染栈搬过来。
- **不做"AI 每次现场生成 HTML"**：排版要可复现、可 diff，manifest 是那个稳定的中间层。
