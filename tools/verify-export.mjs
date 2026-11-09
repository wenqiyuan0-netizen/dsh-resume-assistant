/**
 * 导出自检（不经过 DSH 宿主、不碰真实产出）：
 *   node tools/verify-export.mjs
 *
 * 用一份演示文档跑完整的导出链路：渲染 → 打印 → 截图 → 索引 → 覆盖策略 →
 * 打开文件夹（只验证"命令发出去了"，不验证窗口弹没弹）。
 *
 * 为什么要有这个脚本：导出坏过一次，而且坏得很安静 —— 面板只弹一句"没有
 * Electron 打印器"，PDF 从来没生成过，截图自然也没有。这层自检把每一环都变成
 * 可判定的断言，换机器、换打印器之后跑一遍就知道还活着没有。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { planExport, runExport } from '../lib/export-job.js'
import { countPdfPages, findChromium } from '../lib/print.js'
import { revealPath } from '../lib/reveal.js'

/** 一份足够长、带照片的演示文档（照片用 1×1 的 PNG data URL，够证明"照片进了纸面"）。 */
function demo() {
  const pixel =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAKklEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAOBrAB+AAAG8fF0zAAAAAElFTkSuQmCC'
  return {
    basics: {
      name: 'Export Probe',
      headline: 'Verkäufer / Servicekraft',
      email: 'probe@example.com',
      phone: '+49 30 1234567',
      location: 'Berlin',
    },
    picture: { url: pixel, size: 90, hidden: false, position: { x: 50, y: 50 } },
    summary: { content: '<p>Eine Zeile Zusammenfassung, die auf Papier gehört.</p>' },
    sections: {
      experience: {
        items: [
          { position: 'Servicekraft', company: 'Café Probe', period: { start: '2022-04', end: '' }, description: 'Bestellannahme und Kasse.' },
          { position: 'Aushilfe', company: 'Laden Probe', period: { start: '2019-08', end: '2022-03' }, description: 'Regalservice.' },
        ],
      },
      education: { items: [{ school: 'TU Berlin', degree: 'M.Sc.', area: 'Energietechnik', period: { start: '2026-10', end: '' } }] },
      skills: { items: [{ name: 'Kasse', level: 'gut' }, { name: 'Beratung', level: 'gut' }] },
      languages: { items: [{ language: 'Deutsch', fluency: 'C1' }, { language: 'Englisch', fluency: 'B2' }] },
    },
    metadata: {
      template: 'onyx',
      layout: { sidebarWidth: 32, pages: [] },
      page: { format: 'a4', marginX: 16, marginY: 11, locale: 'de-DE' },
      theme: { background: '#ffffff', text: 'rgba(17,24,39,1)', primary: 'rgba(37,99,235,1)' },
      typography: { body: { fontFamily: 'IBM Plex Sans', fontSize: 10.5, lineHeight: 1.16 }, heading: { fontFamily: 'IBM Plex Sans', fontSize: 12.5 } },
    },
  }
}

const outDir = mkdtempSync(join(tmpdir(), 'resume-export-verify-'))
const config = {
  outputDir: outDir,
  appUrl: 'http://localhost:3000',
  appDir: '',
}
const store = {
  async list() {
    return { resumes: [{ id: 'probe', name: 'Export Probe', slug: 'export-probe' }] }
  },
  async get() {
    return { id: 'probe', name: 'Export Probe', data: demo() }
  },
}

const doc = demo()
const checks = []
const check = (name, fn) => {
  try {
    fn()
    checks.push(`  ✓ ${name}`)
  } catch (error) {
    checks.push(`  ✗ ${name}：${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
}

// 1. 路径规划：默认目录取简历名，扩展名只有一个。
const plan = planExport(config, { name: 'Export Probe' })
check('plan 路径落在 04-输出 下', () => {
  assert.equal(plan.folder, 'Export Probe')
  assert.equal(plan.file, 'Export Probe-CV.pdf')
  assert.ok(plan.path.startsWith(outDir))
  assert.equal(plan.exists, false)
})
check('plan 不会给出 .pdf.pdf', () => {
  const twice = planExport(config, { name: 'X', filename: 'Y-CV.pdf' })
  assert.equal(twice.file, 'Y-CV.pdf')
})

// 2. 真导一次。
const chromium = findChromium()
if (chromium === null) {
  console.log('⚠ 这台机器上没找到 chromium/chrome/edge —— 打印链路无法在这里自检。')
  console.log(checks.join('\n'))
  process.exit(0)
}

const first = await runExport({ config, store, id: 'probe', name: 'Export Probe', folder: 'Probe', filename: 'Probe-CV', screenshots: true })
assert.equal(first.ok, true, `导出失败：${first.reason}`)
check('PDF 真的写出来了', () => {
  assert.ok(existsSync(first.path), first.path)
  assert.ok(statSync(first.path).size > 10_000, `太小了：${statSync(first.path).size}`)
})
check('页数与纸张数对得上', () => {
  assert.ok(first.pages >= 1, `pages=${first.pages}`)
  assert.equal(first.overflow, false, '演示文档不该串页')
  assert.equal(countPdfPages(readFileSync(first.path)), first.pages)
})
check('照片进了纸面（PDF 里有 image 对象）', () => {
  const text = readFileSync(first.path).toString('latin1')
  assert.ok((text.match(/\/Subtype\s*\/Image/g) ?? []).length >= 1, 'PDF 里没有位图 —— 照片没内联')
})
check('逐页截图存在且非空', () => {
  assert.ok(first.screenshots.length >= 1, '一张截图都没有')
  for (const shot of first.screenshots) {
    assert.ok(existsSync(shot), shot)
    assert.ok(statSync(shot).size > 10_000, `截图太小：${shot}`)
  }
})
check('索引写了这条', () => {
  const index = readFileSync(join(outDir, '_索引.md'), 'utf8')
  assert.ok(index.includes('Probe-CV.pdf'), index.slice(0, 200))
})

// 3. 再导一次：默认覆盖同一个文件，并且把"盖掉了什么"交代清楚。
const second = await runExport({ config, store, id: 'probe', name: 'Export Probe', folder: 'Probe', filename: 'Probe-CV' })
check('第二次是覆盖，不是又长一个文件', () => {
  assert.equal(second.ok, true)
  assert.equal(second.path, first.path)
  assert.equal(second.overwrote, true)
  assert.ok(second.previous !== null && second.previous.bytes > 0)
})

// 4. overwrite=version：留旧的那份。
const third = await runExport({ config, store, id: 'probe', name: 'Export Probe', folder: 'Probe', filename: 'Probe-CV', overwrite: 'version' })
check('overwrite=version 落成 (2)', () => {
  assert.equal(third.ok, true)
  assert.notEqual(third.path, first.path)
  assert.match(third.path, /\(2\)\.pdf$/)
})

// 5. 打开文件夹：不只看"有没有抛错"，还要看宿主自己怎么说走了哪条路。
const revealed = await revealPath(third.path)
check('reveal 会真的去开资源管理器，并说明走了哪条路', () => {
  assert.equal(typeof revealed, 'object')
  assert.equal(revealed.ok, true, `没打开：${revealed.detail}`)
  assert.ok(['powershell', 'explorer.exe', 'electron', 'open', 'xdg-open'].includes(revealed.method), `未知方法：${revealed.method}`)
  assert.ok(String(revealed.detail ?? '').length > 0, 'detail 是空的 —— 失败了也没法解释')
})

console.log('导出自检：')
console.log(checks.join('\n'))
console.log(`\n产出目录：${outDir}`)
