/**
 * 排版刻度：唯一真相源。
 *
 * 15 个模板共用这一套数字；模板自己的差异写在 manifest 里（`tokens` 字段做局部覆盖）。
 * 「不寡淡」靠 manifest 的 `decor`（页眉色带/时间线/技能条/侧栏填充），不靠复制 CSS。
 *
 * 单位约定：字号 pt、间距 mm、行高倍数无单位。
 *
 * @module dsh-resume-assistant/lib/render/tokens
 */

/** 基础刻度。 */
export const TOKENS = Object.freeze({
  font: {
    body: 'IBM Plex Sans',
    heading: 'IBM Plex Sans',
    fallback: '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
  },
  size: {
    body: 10,
    name: 21,
    headline: 11.5,
    heading: 12.5,
  },
  line: {
    body: 1.4,
    heading: 1.2,
  },
  space: {
    pageY: 18,
    pageX: 22,
    section: 3.2,
    item: 2.2,
    gap: 7,
  },
  color: {
    ink: 'rgba(17, 24, 39, 1)',
    muted: '0.72',
    bg: '#ffffff',
    accent: 'rgba(37, 99, 235, 1)',
  },
  decoration: {
    radius: 3,
    ruleWidth: 0.4,
    chipRadius: 2,
  },
})

/**
 * 取一组 token 的合并结果（模板覆盖基础刻度）。
 * @param overrides - 模板自己的 token 片段。
 * @returns 合并后的 tokens（深合并一层）。
 */
export function resolveTokens(overrides) {
  if (overrides === null || typeof overrides !== 'object') return TOKENS
  const merged = { ...TOKENS }
  for (const [group, value] of Object.entries(overrides)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      merged[group] = { ...(TOKENS[group] ?? {}), ...value }
    } else {
      merged[group] = value
    }
  }
  return merged
}
