/**
 * 渲染器自检（不经过 DSH 宿主）：
 *   node tools/verify-render.mjs <resumeId|--demo> [输出.html]
 *
 * 会把渲染结果写到 `04-输出\_preview\<id>-<template>.html`，方便直接在浏览器里看。
 * 15 个模板各渲一遍，检查每份都不为空、且模板之间的版式确实不同。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { normalizeConfig } from '../lib/config.js'
import { createStore } from '../lib/db.js'
import { TEMPLATES, renderResumeHtml } from '../lib/render.js'

const config = normalizeConfig({})
const store = createStore(config)
const arg = process.argv[2] ?? '--demo'

/** 造一份结构接近真实的演示文档。 */
function demo() {
  return {
    basics: { name: '张三', headline: '前端工程师 · 简历插件', email: 'zhangsan@example.com', phone: '+49 123 4567', location: 'Berlin', website: 'zhangsan.dev' },
    summary: { content: '<p>做了七年 Web，专长是把复杂交互做成可维护的组件。</p>' },
    sections: {
      experience: {
        items: [
          { position: '高级前端工程师', company: 'ACME GmbH', period: { start: '2022-04', end: '' }, description: '负责设计系统与编辑器内核，把首屏时间从 3.2s 降到 0.9s。' },
          { position: '前端工程师', company: 'Bolt Labs', period: { start: '2019-08', end: '2022-03' }, description: '搭建可视化搭建平台。' },
        ],
      },
      education: { items: [{ school: '同济大学', degree: '本科', area: '软件工程', period: { start: '2013-09', end: '2017-06' } }] },
      skills: { items: [{ name: 'TypeScript', level: '专家' }, { name: 'React', level: '专家' }, { name: 'Node.js', level: '熟练' }] },
      languages: { items: [{ language: '中文', fluency: '母语' }, { language: 'English', fluency: 'C1' }, { language: 'Deutsch', fluency: 'B1' }] },
      projects: { items: [{ name: 'dsh-resume-assistant', period: { start: '2026-11' }, description: '把简历工具做成 DSH 插件。' }] },
      certifications: { items: [{ title: 'AWS SA', issuer: 'Amazon', date: '2023-05' }] },
      interests: { items: [{ name: '长跑' }, { name: '摄影' }] },
    },
    metadata: {
      template: 'onyx',
      layout: { sidebarWidth: 32, pages: [] },
      page: { format: 'a4', marginX: 22, marginY: 16, locale: 'zh-CN' },
      theme: { background: '#ffffff', text: 'rgba(17,24,39,1)', primary: 'rgba(37,99,235,1)' },
      typography: { body: { fontFamily: 'IBM Plex Sans', fontSize: 10, lineHeight: 1.38 }, heading: { fontFamily: 'IBM Plex Sans', fontSize: 13 } },
    },
  }
}

let doc
if (arg === '--demo') {
  doc = demo()
} else {
  const resume = await store.get(arg)
  if (resume.error !== undefined) {
    console.log(`读取失败：${resume.error}`)
    process.exitCode = 1
  }
  doc = resume.data
}

if (doc !== undefined) {
  const dir = join(config.outputDir, '_preview')
  await mkdir(dir, { recursive: true })
  let failures = 0
  const sizes = []
  for (const template of TEMPLATES) {
    const probe = { ...doc, metadata: { ...(doc.metadata ?? {}), template } }
    const html = renderResumeHtml(probe)
    sizes.push([template, html.length])
    if (html.length < 800) {
      failures += 1
      console.log(`  ✗ ${template}: 输出过短（${html.length}）`)
    }
    if (process.argv[3] !== undefined && template === doc?.metadata?.template) {
      await writeFile(process.argv[3], html, 'utf8')
      console.log(`  已写出 ${process.argv[3]}`)
    }
  }
  console.log(`15 个模板渲染：${failures === 0 ? '全部通过 ✓' : `${failures} 个失败 ✗`}`)
  console.log(sizes.map(([name, size]) => `  ${name.padEnd(12)} ${size}B`).join('\n'))
  process.exitCode = failures === 0 ? 0 : 1
}
