/**
 * 15 份模板 manifest —— **纯数据**。
 *
 * 字段语义（也是 AI 可以控制的类型）：
 *   header.placement  'main' | 'sidebar'   页眉画在哪一栏（原版 onyx=main、gengar=sidebar）
 *   header.photo      'none' | 'left' | 'right' | 'side-top'
 *   header.band       bool                  页眉是否铺主色带（整幅）
 *   summary           'main' | 'featured'   featured = 主栏顶部、页眉之下的强调块（gengar 用它）
 *   sidebar.fill      bool                  侧栏是否铺主色底
 *   sidebar.width     百分比
 *   sidebar.order     'left' | 'right'
 *   title             'caps' | 'underline' | 'bar' | 'chip'   栏目小标题的装饰
 *   item.marker       'none' | 'dot' | 'timeline'             条目左侧记号
 *   item.layout       'stacked' | 'inline'                    条目头：两行标题/副标题 或 一行
 *   skills.shape      'kv' | 'bars' | 'chips'
 *   page              页边距与栏间距（mm）
 *   tokens            对基础刻度的局部覆盖
 *
 * 原版对照（packages/pdf/src/templates/*\/Page.tsx）：onyx 是"主栏页眉 + 满色侧栏"，
 * gengar 是"页眉进侧栏 + 主栏顶部 featured 摘要 + 侧栏底色"。其余 13 个按同一套字段
 * 做近似映射，逐个对齐时只需改这个文件。
 *
 * @module dsh-resume-assistant/lib/render/manifests
 */

/** 侧栏栏目候选（模板没写 sidebar 时按它推断）。 */
export const SIDE_KINDS = ['skills', 'languages', 'interests', 'certifications', 'profiles', 'awards']

/** 主栏栏目候选。 */
export const MAIN_KINDS = ['summary', 'experience', 'education', 'projects', 'publications', 'volunteer', 'references']

/** 15 份 manifest。 */
export const MANIFESTS = {
  // —— 两个"对齐版"：结构按原版语义 manifest 走
  onyx: {
    id: 'onyx',
    header: { placement: 'main', photo: 'right', band: false, align: 'left' },
    summary: 'main',
    sidebar: { fill: true, width: 32, order: 'left' },
    title: 'underline',
    item: { marker: 'none', layout: 'stacked' },
    skills: { shape: 'kv' },
    page: { pageY: 16, pageX: 22, section: 3.0, item: 2.0 },
    tokens: { size: { heading: 12 } },
  },
  gengar: {
    id: 'gengar',
    header: { placement: 'sidebar', photo: 'left', band: false, align: 'center' },
    summary: 'featured',
    sidebar: { fill: true, width: 36, order: 'left' },
    title: 'caps',
    item: { marker: 'none', layout: 'stacked' },
    skills: { shape: 'kv' },
    page: { pageY: 14, pageX: 20, section: 3.0, item: 2.0 },
    tokens: { size: { heading: 11.5 }, line: { body: 1.36 } },
  },

  // —— 其余 13 个：沿用已验证的皮肤映射
  azurill: {
    id: 'azurill',
    header: { placement: 'main', photo: 'right', band: true, align: 'left' },
    summary: 'main',
    sidebar: { fill: false, width: 30, order: 'left' },
    title: 'underline',
    item: { marker: 'none', layout: 'stacked' },
    skills: { shape: 'kv' },
    page: { pageY: 18, pageX: 22, section: 3.2, item: 2.2 },
  },
  bronzor: {
    id: 'bronzor',
    header: { placement: 'main', photo: 'right', band: false, align: 'left' },
    summary: 'main',
    sidebar: { fill: false, width: 30, order: 'left' },
    title: 'caps',
    item: { marker: 'timeline', layout: 'stacked' },
    skills: { shape: 'kv' },
    page: { pageY: 18, pageX: 22, section: 3.0, item: 2.0 },
  },
  chikorita: {
    id: 'chikorita',
    header: { placement: 'main', photo: 'right', band: false, align: 'left' },
    summary: 'main',
    sidebar: { fill: false, width: 32, order: 'left' },
    title: 'bar',
    item: { marker: 'none', layout: 'stacked' },
    skills: { shape: 'bars' },
    page: { pageY: 18, pageX: 22, section: 3.2, item: 2.2 },
  },
  ditgar: {
    id: 'ditgar',
    header: { placement: 'main', photo: 'right', band: false, align: 'left' },
    summary: 'main',
    sidebar: { fill: false, width: 32, order: 'left' },
    title: 'underline',
    item: { marker: 'timeline', layout: 'stacked' },
    skills: { shape: 'kv' },
    page: { pageY: 17, pageX: 21, section: 3.0, item: 2.0 },
  },
  ditto: {
    id: 'ditto',
    header: { placement: 'main', photo: 'right', band: false, align: 'left' },
    summary: 'main',
    sidebar: { fill: false, width: 30, order: 'left' },
    title: 'plain',
    item: { marker: 'none', layout: 'inline' },
    skills: { shape: 'kv' },
    page: { pageY: 18, pageX: 22, section: 3.2, item: 2.2 },
  },
  glalie: {
    id: 'glalie',
    header: { placement: 'main', photo: 'right', band: false, align: 'left' },
    summary: 'main',
    sidebar: { fill: false, width: 32, order: 'right' },
    title: 'bar',
    item: { marker: 'none', layout: 'stacked' },
    skills: { shape: 'bars' },
    page: { pageY: 18, pageX: 22, section: 3.2, item: 2.2 },
  },
  kakuna: {
    id: 'kakuna',
    header: { placement: 'main', photo: 'right', band: false, align: 'left' },
    summary: 'main',
    sidebar: { fill: false, width: 30, order: 'left' },
    title: 'caps',
    item: { marker: 'timeline', layout: 'stacked' },
    skills: { shape: 'kv' },
    page: { pageY: 16, pageX: 20, section: 2.8, item: 1.9 },
  },
  lapras: {
    id: 'lapras',
    header: { placement: 'main', photo: 'right', band: false, align: 'left' },
    summary: 'main',
    sidebar: { fill: true, width: 34, order: 'right' },
    title: 'underline',
    item: { marker: 'none', layout: 'stacked' },
    skills: { shape: 'kv' },
    page: { pageY: 17, pageX: 21, section: 3.0, item: 2.0 },
  },
  leafish: {
    id: 'leafish',
    header: { placement: 'main', photo: 'right', band: false, align: 'left' },
    summary: 'main',
    sidebar: { fill: false, width: 30, order: 'left' },
    title: 'bar',
    item: { marker: 'timeline', layout: 'stacked' },
    skills: { shape: 'kv' },
    page: { pageY: 18, pageX: 22, section: 3.2, item: 2.2 },
  },
  meowth: {
    id: 'meowth',
    header: { placement: 'main', photo: 'right', band: true, align: 'left' },
    summary: 'main',
    sidebar: { fill: false, width: 32, order: 'left' },
    title: 'caps',
    item: { marker: 'none', layout: 'stacked' },
    skills: { shape: 'chips' },
    page: { pageY: 17, pageX: 21, section: 3.0, item: 2.0 },
  },
  pikachu: {
    id: 'pikachu',
    header: { placement: 'main', photo: 'right', band: false, align: 'left' },
    summary: 'main',
    sidebar: { fill: false, width: 30, order: 'left' },
    title: 'underline',
    item: { marker: 'none', layout: 'stacked' },
    skills: { shape: 'bars' },
    page: { pageY: 18, pageX: 22, section: 3.2, item: 2.2 },
  },
  rhyhorn: {
    id: 'rhyhorn',
    header: { placement: 'main', photo: 'right', band: true, align: 'left' },
    summary: 'main',
    sidebar: { fill: false, width: 30, order: 'left' },
    title: 'bar',
    item: { marker: 'none', layout: 'stacked' },
    skills: { shape: 'kv' },
    page: { pageY: 18, pageX: 22, section: 3.0, item: 2.0 },
  },
  scizor: {
    id: 'scizor',
    header: { placement: 'main', photo: 'right', band: false, align: 'left' },
    summary: 'main',
    sidebar: { fill: false, width: 32, order: 'right' },
    title: 'caps',
    item: { marker: 'none', layout: 'stacked' },
    skills: { shape: 'bars' },
    page: { pageY: 17, pageX: 21, section: 3.0, item: 2.0 },
  },
}

/** 模板 id 列表（顺序与原版一致）。 */
export const TEMPLATE_IDS = Object.keys(MANIFESTS)

/**
 * 取一份 manifest（未知 id 回落到 onyx）。
 * @param id - 模板名。
 * @returns manifest。
 */
export function manifestOf(id, extra) {
  if (extra !== null && typeof extra === 'object' && extra[id] !== undefined) return extra[id]
  return MANIFESTS[id] ?? MANIFESTS.onyx
}
