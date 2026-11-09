/**
 * 唯一渲染器：manifest + 简历数据 → 独立 A4 HTML。
 *
 * 三个输入决定结果，没有别的地方藏着排版：
 *   1. `tokens.js`     字号/间距/颜色的刻度
 *   2. `manifests.js`  每个模板的区域归属 + 装饰选择
 *   3. 简历数据        内容本身
 *
 * 区域模型（与原版语义 manifest 同构）：
 *   header    页眉（在 main 或 sidebar 里）
 *   featured  主栏顶部的强调块（gengar 的摘要在这种位置）
 *   main      主栏栏目序列
 *   sidebar   侧栏栏目序列（可铺主色底）
 *
 * @module dsh-resume-assistant/lib/render/compose
 */
import { manifestOf, SIDE_KINDS, MAIN_KINDS } from './manifests.js'
import { resolveTokens } from './tokens.js'

/**
 * 栏目名：**按简历自己的 locale 出标题**。
 *
 * 面板 UI 的语言跟 Harness 走（`TEXT`），简历正文的语言跟 `metadata.page.locale` 走 ——
 * 这两件事必须分开，否则一份 de-DE 的简历会被盖上「工作经历」的中文标题，
 * 看起来像"面板和内容语言不一致"。
 */
const LABELS = {
  zh: {
    summary: '个人简介',
    profiles: '联系方式',
    experience: '工作经历',
    education: '教育经历',
    projects: '项目',
    skills: '技能',
    languages: '语言',
    interests: '兴趣',
    awards: '荣誉',
    certifications: '证书',
    publications: '发表',
    volunteer: '志愿经历',
    references: '推荐',
    name: '姓名',
    headline: '头衔',
    photo: '照片',
    item: '条目',
    present: '至今',
  },
  en: {
    summary: 'Summary',
    profiles: 'Contact',
    experience: 'Experience',
    education: 'Education',
    projects: 'Projects',
    skills: 'Skills',
    languages: 'Languages',
    interests: 'Interests',
    awards: 'Awards',
    certifications: 'Certifications',
    publications: 'Publications',
    volunteer: 'Volunteering',
    references: 'References',
    name: 'Name',
    headline: 'Headline',
    photo: 'Photo',
    item: 'Item',
    present: 'Present',
  },
  de: {
    summary: 'Profil',
    profiles: 'Kontakt',
    experience: 'Berufserfahrung',
    education: 'Ausbildung',
    projects: 'Projekte',
    skills: 'Kenntnisse',
    languages: 'Sprachen',
    interests: 'Interessen',
    awards: 'Auszeichnungen',
    certifications: 'Zertifikate',
    publications: 'Publikationen',
    volunteer: 'Ehrenamt',
    references: 'Referenzen',
    name: 'Name',
    headline: 'Titel',
    photo: 'Foto',
    item: 'Eintrag',
    present: 'heute',
  },
}

/** 旧导出：默认中文（外部只读用）。 */
export const SECTION_LABEL = LABELS.zh

/**
 * 按 locale 取一套标签。
 *
 * 只认前两位（`de-DE` / `de-AT` → `de`）；认不出来时退回中文，
 * 与 `<html lang>` 的默认值保持一致。
 * @param locale - BCP-47 语言标记，可空。
 * @returns 一套标签。
 */
export function labelsFor(locale) {
  const key = String(locale ?? '')
    .slice(0, 2)
    .toLowerCase()
  return LABELS[key] ?? LABELS.zh
}

/** 技能等级 → 百分比（只有认识的值才画条，其余给中性宽度）。 */
const LEVEL = { 专家: 95, 高级: 85, 熟练: 75, 中级: 60, 入门: 40, expert: 95, advanced: 85, proficient: 75, intermediate: 60, beginner: 40 }

/** HTML 转义。 */
function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/** 去标签、压空白。 */
function plain(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/** `{start,end}` / 字符串 → `2024.03 – 至今`。 */
function period(value, present = LABELS.zh.present) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const left = formatMonth(value.start ?? value.from ?? '')
    const right = formatMonth(value.end ?? value.to ?? '') || present
    if (left === '' && right === '') return ''
    return left === '' ? right : `${left} – ${right}`
  }
  return String(value)
}

/** `2024-03` → `2024.03`。 */
function formatMonth(value) {
  const text = String(value ?? '').trim()
  if (text === '') return ''
  const match = /^(\d{4})-(\d{1,2})/.exec(text)
  return match === null ? text : `${match[1]}.${match[2].padStart(2, '0')}`
}

/**
 * 照片取景位置 → `{ x, y }`（0–100 的百分比，CSS `object-position` 语义）。
 *
 * 文档里的形状是 `picture.position = { x, y }`。缺省、非法、越界一律收敛到 50/50，
 * 也就是"居中裁"——和加这个字段之前的表现完全一样，老简历不会因为这次升级而挪位置。
 * @param picture - `resume.data.picture`。
 * @returns 归一化后的 `{ x, y }`。
 */
export function photoPositionOf(picture) {
  const clamp = (value) => {
    if (value === null || value === undefined || value === '') return 50
    const number = Number(value)
    if (!Number.isFinite(number)) return 50
    return Math.max(0, Math.min(100, Math.round(number)))
  }
  return { x: clamp(picture?.position?.x), y: clamp(picture?.position?.y) }
}

/** 取第一个非空字段。 */
function pick(source, keys) {
  for (const key of keys) {
    const value = source?.[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number') return String(value)
    if (value !== null && typeof value === 'object') {
      const nested = value.name ?? value.title ?? value.content ?? value.url
      if (typeof nested === 'string' && nested.trim() !== '') return nested.trim()
    }
  }
  return ''
}

/** 一条条目 → 结构。 */
function describeItem(item, labels = LABELS.zh) {
  const title = pick(item, ['position', 'name', 'title', 'school', 'organization', 'language', 'network', 'awarder', 'issuer', 'publisher', 'username'])
  // 注意：不要把 skills/languages 的 level 放进来。它在数据里是 0–5 的数字，
  // 技能条目的 level 恒为 0，会被 pick() 转成字符串 "0" 渲染成一行多余的字幕
  // （技能/语言的外语等级只在 design.level 里按点/条显示，不该当文字出现）。
  const subtitle = pick(item, ['company', 'degree', 'area', 'issuer', 'publisher', 'fluency', 'location', 'grade', 'awarder'])
  return {
    title,
    subtitle: title !== '' && subtitle !== '' && subtitle !== title ? subtitle : '',
    when: period(item?.period ?? item?.date ?? item?.startDate ?? '', labels.present),
    description: plain(item?.description ?? item?.content ?? item?.summary ?? ''),
    keywords: Array.isArray(item?.keywords) ? item.keywords.filter((word) => typeof word === 'string') : [],
  }
}

/**
 * 渲染一个条目。
 * @param kind - 栏目种类。
 * @param item - 数据。
 * @param index - 在栏目内的序号（写进 data-path 供"引用"用）。
 * @param manifest - 模板 manifest。
 * @returns HTML 片段。
 */
function renderItem(kind, item, index, manifest, labels = LABELS.zh) {
  const info = describeItem(item, labels)
  if (info.title === '' && info.description === '') return ''
  const path = `/sections/${kind}/items/${index}`
  const label = `${labels[kind] ?? kind} · ${info.title || info.subtitle || labels.item}`
  const inline = manifest.item?.layout === 'inline'
  const head = inline
    ? `<div class="it-h"><span class="it-t">${esc(info.title || info.subtitle)}</span>${info.when === '' ? '' : `<span class="it-d">${esc(info.when)}</span>`}</div>`
    : [
        `<div class="it-h"><span class="it-t">${esc(info.title)}</span>`,
        info.when === '' ? '' : `<span class="it-d">${esc(info.when)}</span>`,
        '</div>',
        info.subtitle === '' ? '' : `<div class="it-s">${esc(info.subtitle)}</div>`,
      ].join('')
  const keywords = info.keywords.length === 0 ? '' : `<div class="it-k">${info.keywords.map((word) => `<span>${esc(word)}</span>`).join('')}</div>`
  const body = info.description === '' ? '' : `<div class="it-b">${esc(info.description).replaceAll('\n', '<br>')}</div>`
  return `<li class="it" data-path="${esc(path)}" data-label="${esc(label)}">${head}${keywords}${body}</li>`
}

/**
 * 渲染一个栏目。
 * @param kind - 栏目种类。
 * @param section - `{ items, hidden }`。
 * @param mode - `'main' | 'side'`。
 * @param manifest - 模板 manifest。
 * @returns HTML 片段（空串表示这个栏目没有内容）。
 */
export function renderSection(kind, section, mode, manifest, labels = LABELS.zh) {
  const items = Array.isArray(section?.items) ? section.items : []
  if (section?.hidden === true || items.length === 0) return ''
  const label = labels[kind] ?? kind
  const head = `<h3>${esc(label)}</h3>`
  const open = (extra = '') => `<section class="sec${extra}" data-path="/sections/${esc(kind)}" data-label="${esc(label)}">${head}`
  const close = '</section>'

  if (kind === 'summary') {
    const text = plain(items[0]?.content ?? items[0]?.description ?? '')
    return text === '' ? '' : `${open(' summary')}<div class="sum">${esc(text).replaceAll('\n', '<br>')}</div>${close}`
  }

  if (mode === 'side') {
    if (kind === 'profiles') {
      const rows = items
        .map((item) => {
          const name = pick(item, ['network', 'name'])
          const value = pick(item, ['username', 'url', 'website'])
          return value === '' ? '' : `<li><b>${esc(name)}</b><span>${esc(value)}</span></li>`
        })
        .filter(Boolean)
        .join('')
      return rows === '' ? '' : `${open()}<ul class="chips-list">${rows}</ul>${close}`
    }
    if (kind === 'skills' || kind === 'interests') {
      const shape = manifest.skills?.shape ?? 'kv'
      const rows = items
        .map((item) => {
          const name = pick(item, ['name', 'title', 'language'])
          if (name === '') return ''
          if (shape === 'bars') {
            const level = pick(item, ['level', 'fluency'])
            const numeric = Number(level)
            const mapped = LEVEL[level] ?? (Number.isFinite(numeric) && numeric > 0 ? numeric : undefined)
            const width = mapped === undefined ? 70 : Math.max(15, Math.min(100, mapped))
            return `<li class="bar-row"><span class="bar-name">${esc(name)}</span><span class="bar-track"><span class="bar-fill${mapped === undefined ? ' unknown' : ''}" style="width:${width}%"></span></span></li>`
          }
          const level = pick(item, ['level', 'fluency'])
          const words = Array.isArray(item?.keywords) ? item.keywords.filter((word) => typeof word === 'string') : []
          const extra = words.length === 0 ? '' : `<em>${words.slice(0, 5).map(esc).join(' · ')}</em>`
          return `<li><b>${esc(name)}</b>${level === '' ? '' : `<i>${esc(level)}</i>`}${extra}</li>`
        })
        .filter(Boolean)
        .join('')
      const cls = shape === 'bars' ? 'bars' : 'kv'
      return rows === '' ? '' : `${open()}<ul class="${cls}">${rows}</ul>${close}`
    }
    const chips = items.map((item) => pick(item, ['name', 'language', 'title', 'network', 'username'])).filter(Boolean)
    return chips.length === 0 ? '' : `${open()}<div class="tags">${chips.map((text) => `<span>${esc(text)}</span>`).join('')}</div>${close}`
  }

  const body = items.map((item, index) => renderItem(kind, item, index, manifest, labels)).filter(Boolean).join('')
  return body === '' ? '' : `${open()}<ul class="items">${body}</ul>${close}`
}

/** 由 tokens + manifest 生成 CSS。 */
function buildCss(tokens, manifest, accent) {
  const { size, line, space, color, decoration, font } = tokens
  const title = {
    caps: 'h3 { text-transform: uppercase; letter-spacing: .12em; font-size: .82em; opacity: .78 }',
    underline: 'h3 { border-bottom: .4mm solid currentColor; padding-bottom: .8mm; opacity: .95 }',
    bar: 'h3 { border-left: 1mm solid var(--accent); padding-left: 2mm }',
    chip: 'h3 { display: inline-block; padding: .6mm 2mm; border-radius: 2mm; background: color-mix(in srgb, var(--accent) 16%, transparent) }',
    plain: 'h3 { font-weight: 700 }',
  }[manifest.title ?? 'underline']

  const marker = {
    timeline: [
      '.items { position: relative; padding-left: 4mm }',
      '.items::before { content: ""; position: absolute; left: 1mm; top: 1.5mm; bottom: 1.5mm; width: .5mm; background: color-mix(in srgb, var(--accent) 38%, transparent) }',
      '.it { position: relative }',
      '.it::before { content: ""; position: absolute; left: -3.6mm; top: 1.2mm; width: 2mm; height: 2mm; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 1mm var(--bg) }',
    ].join('\n'),
    dot: '.it::before { content: ""; display: inline-block; width: 1.4mm; height: 1.4mm; border-radius: 50%; background: var(--accent); margin-right: 1.6mm; vertical-align: .2mm }',
    none: '',
  }[manifest.item?.marker ?? 'none']

  return `
    :root { --accent: ${accent}; --ink: ${color.ink}; --bg: ${color.bg};
      --body-size: ${size.body}pt; --name-size: ${size.name}pt; --head-size: ${size.heading}pt; --line: ${line.body}; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #e9edf3; }
    .sheet {
      width: 210mm; min-height: 297mm; margin: 0 auto; background: var(--bg); color: var(--ink);
      font-family: "${font.body}", ${font.fallback};
      font-size: var(--body-size); line-height: var(--line);
      padding: ${space.pageY}mm ${space.pageX}mm; display: flex; gap: ${space.gap}mm;
      flex-direction: ${manifest.sidebar?.order === 'right' ? 'row-reverse' : 'row'};
    }
    .sheet + .sheet { margin-top: 10mm; }
    .sheet.free { display: block; }
    .canvas { position: relative; height: 258mm; }
    .blk { position: absolute; overflow: hidden; }
    .blk .sec { margin-bottom: 0; }
    .main { flex: 1; min-width: 0; }
    .side { width: ${manifest.sidebar?.width ?? 32}%; flex: none; }
    .side.fill { background: color-mix(in srgb, var(--accent) 12%, var(--bg)); border-radius: ${decoration.radius}mm;
      padding: 4mm 3mm; }
    .hd { margin-bottom: 3mm; }
    .hd-row { display: flex; align-items: flex-start; gap: 5mm; }
    .hd.center { text-align: center; }
    .hd.center .hd-row { flex-direction: column; align-items: center; }
    .hd-id { flex: 1; min-width: 0; }
    .hd h1 { font-family: "${font.heading}", ${font.fallback}; font-size: var(--name-size);
      line-height: ${line.heading}; margin: 0 0 1mm; letter-spacing: -.01em; }
    .hl { font-size: ${size.headline}pt; color: var(--accent); font-weight: 600; margin-bottom: 1.5mm; }
    .ct { display: flex; flex-wrap: wrap; gap: 2mm 4mm; font-size: .9em; opacity: .8; }
    .hd.center .ct { justify-content: center; }
    .hd.band { background: var(--accent); color: #fff; border-radius: ${decoration.radius}mm;
      margin: 0 calc(-1 * ${space.pageX / 3}mm) 4mm; padding: 5mm ${space.pageX / 3}mm; }
    .hd.band h1, .hd.band .hl, .hd.band .ct { color: #fff; }
    .ph { display: block; flex: none; object-fit: cover; background: #fff; }
    .side-photo { display: flex; justify-content: center; margin-bottom: 3mm; }
    .sec { margin: 0 0 ${space.section}mm; }
    .sec h3 { font-family: "${font.heading}", ${font.fallback}; font-size: var(--head-size); margin: 0 0 1.4mm; color: var(--ink); }
    ${title}
    .summary .sum { opacity: .92; }
    .featured .sum { border-left: 1mm solid var(--accent); padding-left: 3mm; font-size: 1.02em; }
    .items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${space.item}mm; }
    ${marker}
    .it-h { display: flex; align-items: baseline; justify-content: space-between; gap: 3mm; }
    .it-t { font-weight: 650; }
    .it-d { font-size: .88em; opacity: .7; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .it-s { font-size: .95em; opacity: .85; }
    .it-b { margin-top: .8mm; }
    .it-k { display: flex; flex-wrap: wrap; gap: 1mm; margin-top: 1mm; }
    .it-k span { font-size: .8em; padding: .3mm 1.6mm; border-radius: ${decoration.chipRadius}mm;
      background: color-mix(in srgb, var(--accent) 12%, transparent); }
    .tags { display: flex; flex-wrap: wrap; gap: 1mm; }
    .tags span { font-size: .85em; padding: .4mm 1.8mm; border-radius: ${decoration.chipRadius}mm;
      background: color-mix(in srgb, var(--accent) 14%, transparent); }
    .kv, .chips-list, .bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1.3mm; }
    .kv li { display: flex; flex-direction: column; gap: .3mm; }
    .kv li b { font-weight: 600; }
    .kv li i { font-style: normal; font-size: .85em; opacity: .65; }
    .kv li em { font-style: normal; font-size: .85em; opacity: .8; }
    .chips-list li { display: flex; flex-direction: column; }
    .chips-list li b { font-weight: 600; font-size: .9em; opacity: .75; }
    .chips-list li span { word-break: break-all; }
    .bar-row { display: flex; align-items: center; gap: 2mm; }
    .bar-name { flex: none; width: 42%; font-size: .92em; }
    .bar-track { flex: 1; height: 1.6mm; border-radius: 1mm; background: color-mix(in srgb, var(--ink) 12%, transparent); overflow: hidden; }
    .bar-fill { display: block; height: 100%; border-radius: 1mm; background: var(--accent); }
    .bar-fill.unknown { opacity: .42; }
    @page { size: A4; margin: 0; }
    @media print {
      html, body { background: #fff; }
      .sheet { margin: 0; box-shadow: none; page-break-after: always; }
      .sheet:last-child { page-break-after: auto; }
    }
  `
}

/**
 * 渲染整份简历。
 * @param doc - `resume.data`（草稿也可以）。
 * @param options - `{ locale }`。
 * @returns 独立 HTML。
 */
export function renderResumeHtml(doc, options = {}) {
  const data = doc !== null && typeof doc === 'object' ? doc : {}
  const basics = data.basics ?? {}
  const meta = data.metadata ?? {}
  const manifest = manifestOf(meta.template, options.manifests)
  const tokens = resolveTokens(manifest.tokens)
  const sections = data.sections ?? {}
  const labels = labelsFor(options.locale ?? meta.page?.locale)
  const accent = typeof meta.theme?.primary === 'string' && meta.theme.primary !== '' ? meta.theme.primary : tokens.color.accent
  const headingFont = meta.typography?.heading?.fontFamily
  const bodyFont = meta.typography?.body?.fontFamily
  const merged = resolveTokens({
    ...(manifest.tokens ?? {}),
    font: {
      ...(tokens.font ?? {}),
      ...(bodyFont ? { body: bodyFont } : {}),
      ...(headingFont ? { heading: headingFont } : {}),
    },
    size: {
      ...(tokens.size ?? {}),
      ...(Number.isFinite(Number(meta.typography?.body?.fontSize)) ? { body: Number(meta.typography.body.fontSize) } : {}),
      ...(Number.isFinite(Number(meta.typography?.heading?.fontSize)) ? { heading: Number(meta.typography.heading.fontSize) } : {}),
    },
    line: {
      ...(tokens.line ?? {}),
      ...(Number.isFinite(Number(meta.typography?.body?.lineHeight)) ? { body: Number(meta.typography.body.lineHeight) } : {}),
    },
    space: {
      ...(tokens.space ?? {}),
      ...(Number.isFinite(Number(meta.page?.marginY)) ? { pageY: Number(meta.page.marginY) } : {}),
      ...(Number.isFinite(Number(meta.page?.marginX)) ? { pageX: Number(meta.page.marginX) } : {}),
    },
  })

  // 分页：`metadata.layout.pages` 是排版模型；缺省时按 manifest 的区域规则生成一页
  const sideKinds = SIDE_KINDS.filter((kind) => kind in sections)
  const mainKinds = MAIN_KINDS.filter((kind) => kind in sections)
  const rawPages =
    Array.isArray(meta.layout?.pages) && meta.layout.pages.length > 0
      ? meta.layout.pages
      : [{ main: [...mainKinds, ...Object.keys(sections).filter((kind) => !SIDE_KINDS.includes(kind) && !MAIN_KINDS.includes(kind))], sidebar: sideKinds }]
  const known = new Set(Object.keys(sections))
  const pages = rawPages.map((page) => ({
    main: (page.main ?? []).filter((kind) => known.has(kind)),
    sidebar: (page.sidebar ?? []).filter((kind) => known.has(kind)),
  }))
  const placed = new Set(pages.flatMap((page) => [...page.main, ...page.sidebar]))
  const orphans = [...known].filter((kind) => !placed.has(kind))
  if (orphans.length > 0) pages[pages.length - 1].main.push(...orphans)

  const contact = [pick(basics, ['email']), pick(basics, ['phone']), pick(basics, ['location']), pick(basics, ['website'])].filter(Boolean)

  // 照片
  const picture = data.picture ?? {}
  const photoUrl = typeof picture.url === 'string' ? picture.url : ''
  const photoSize = Math.max(40, Math.min(140, Number(picture.size ?? 84)))
  const photoRadius = Math.max(0, Math.min(50, Number(picture.borderRadius ?? 0)))
  // 取景位置：`picture.position = { x, y }`（0–100 的百分比），直接映射成 CSS
  // `object-position`。照片是 `object-fit: cover` 裁进去的，没有这个就是居中裁
  // （= 50/50，与旧行为一致）；改它就能把脸挪到框里。
  const photoPosition = photoPositionOf(picture)
  const photoHtml =
    photoUrl === '' || picture.hidden === true
      ? ''
      : `<img class="ph" src="${esc(photoUrl)}" alt="" style="width:${photoSize}px;height:${photoSize}px;` +
        `object-position:${photoPosition.x}% ${photoPosition.y}%;` +
        `border-radius:${photoRadius >= 50 ? '50%' : `${photoRadius}%`};` +
        `filter:${picture.effects?.grayscale === true ? 'grayscale(1)' : 'none'}">`

  const customFields = Array.isArray(basics.customFields)
    ? basics.customFields
        .map((field) => {
          const label = pick(field, ['name', 'label', 'title'])
          const value = pick(field, ['value', 'content'])
          return label === '' && value === '' ? '' : `<li><b>${esc(label)}</b><span>${esc(value)}</span></li>`
        })
        .filter(Boolean)
        .join('')
    : ''

  /** 页眉（按 manifest 决定是否铺色带、照片位置、对齐）。 */
  const header = () => {
    const photoAt = manifest.header?.photo ?? 'right'
    const classes = ['hd', manifest.header?.band === true ? 'band' : '', manifest.header?.align === 'center' ? 'center' : '']
      .filter(Boolean)
      .join(' ')
    const photoBlock = photoAt === 'side-top' ? '' : photoHtml
    return `<header class="${classes}">
      <div class="hd-row">
        <div class="hd-id">
          <h1 data-path="/basics/name" data-label="姓名">${esc(pick(basics, ['name']))}</h1>
          <div class="hl" data-path="/basics/headline" data-label="头衔">${esc(pick(basics, ['headline']))}</div>
          <div class="ct">${contact.map((text) => `<span>${esc(text)}</span>`).join('')}</div>
        </div>
        ${photoAt === 'left' ? `${photoBlock}<span style="order:-1"></span>` : photoBlock}
      </div>
    </header>`
  }

  const headerInSide = manifest.header?.placement === 'sidebar'
  const featured = manifest.summary === 'featured'

  /**
   * 自由排版：`metadata.layout.free = { <栏目>: {x, y, w} }`（单位 mm）。
   *
   * 一旦存在这个字段，版面就从"栏式流"切成"画布"：每个栏目是一个绝对定位块，
   * 编辑器里像拖文本框一样拖它，写回的就是这三个数字。没有它就走原来的流式排版。
   */
  const free = meta.layout?.free
  const freeKinds = free !== null && typeof free === 'object' ? Object.keys(free).filter((kind) => kind in sections) : []

  if (freeKinds.length > 0) {
    const blocks = freeKinds
      .map((kind) => {
        const box = free[kind] ?? {}
        const x = Number(box.x ?? 0)
        const y = Number(box.y ?? 0)
        const w = Math.max(40, Math.min(200, Number(box.w ?? 170)))
        const items = (sections[kind]?.items ?? []).length
        // 高度：数据里有就用，没有就按内容估算（标题 8mm + 每条 6.5mm）
        const estimated = 8 + (kind === 'summary' ? 26 : Math.max(1, items) * 6.5)
        const h = Math.max(10, Math.min(280, Number(box.h ?? estimated)))
        const html = renderSection(kind, sections[kind], 'main', manifest, labels)
        if (html === '') return ''
        return `<div class="blk" data-kind="${esc(kind)}" style="left:${x}mm;top:${y}mm;width:${w}mm;height:${h}mm">${html}</div>`
      })
      .filter(Boolean)
      .join('')
    const canvas = `<div class="canvas">${blocks}</div>`
    const sheet = `<div class="sheet skin-${esc(manifest.id)} free"><main class="main">${header()}${canvas}</main></div>`
    return `<!doctype html><html lang="${esc(options.locale ?? meta.page?.locale ?? 'zh-CN')}"><head>
<meta charset="utf-8"><title>${esc(pick(basics, ['name']) || 'Resume')}</title>
<style>${buildCss(merged, manifest, accent)}</style></head>
<body>${sheet}</body></html>`
  }

  const sheets = pages
    .map((page, index) => {
      const sidebarParts = []
      if (index === 0 && headerInSide) sidebarParts.push(header())
      if (index === 0 && photoHtml !== '' && (manifest.header?.photo ?? '') === 'side-top') {
        sidebarParts.push(`<div class="side-photo" data-path="/picture/url" data-label="照片">${photoHtml}</div>`)
      }
      if (index === 0 && customFields !== '') {
        sidebarParts.push(`<section class="sec"><h3>${esc(labels.profiles)}</h3><ul class="chips-list">${customFields}</ul></section>`)
      }
      for (const kind of page.sidebar) sidebarParts.push(renderSection(kind, sections[kind], 'side', manifest, labels))

      const mainParts = []
      if (index === 0 && !headerInSide) mainParts.push(header())
      if (featured) {
        const summaryHtml = renderSection('summary', sections.summary, 'main', manifest, labels)
        if (summaryHtml !== '') mainParts.push(summaryHtml.replace('class="sec summary"', 'class="sec summary featured"'))
      }
      for (const kind of page.main) {
        if (kind === 'summary' && featured) continue
        mainParts.push(renderSection(kind, sections[kind], 'main', manifest, labels))
      }

      const aside = sidebarParts.filter(Boolean).join('')
      const sideHtml = aside === '' ? '' : `<aside class="side${manifest.sidebar?.fill ? ' fill' : ''}"><div class="side-inner">${aside}</div></aside>`
      const content = `${manifest.sidebar?.order === 'right' ? `<main class="main">${mainParts.join('')}</main>${sideHtml}` : `${sideHtml}<main class="main">${mainParts.join('')}</main>`}`
      return `<div class="sheet skin-${esc(manifest.id)}">${content}</div>`
    })
    .join('\n')

  return `<!doctype html><html lang="${esc(options.locale ?? meta.page?.locale ?? 'zh-CN')}"><head>
<meta charset="utf-8"><title>${esc(pick(basics, ['name']) || 'Resume')}</title>
<style>${buildCss(merged, manifest, accent)}</style></head>
<body>${sheets}</body></html>`
}

/** 文件名安全串。 */
export function safeFileName(name, fallback = 'resume') {
  const text = String(name ?? '').trim()
  return text === '' ? fallback : text.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 60)
}
