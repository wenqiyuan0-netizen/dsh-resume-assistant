/**
 * 交互自检：用一套极小的 React 桩把面板真的"渲染 + 点一下"跑一遍。
 *
 * 为什么要它：面板里的按钮（自由排版、圆角快捷、翻页…）都是纯前端交互，
 * 语法检查与本地套件都覆盖不到 —— 只能靠浏览器里的手点。这个脚本把它变成
 * 可重复的断言：找按钮 → 调 onClick → 重新渲染 → 看界面是否真的变了。
 *
 *   node tools/verify-interaction.mjs
 */
import { readFileSync } from 'node:fs'

// ---------------------------------------------------------------- 极小 React 桩
let hooks = []
let hookIndex = 0
let effects = []
let dirty = false

function useState(initial) {
  const index = hookIndex++
  if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
  return [
    hooks[index],
    (value) => {
      hooks[index] = typeof value === 'function' ? value(hooks[index]) : value
      dirty = true
    },
  ]
}
function useCallback(fn) {
  hookIndex += 1
  return fn
}
function useMemo(fn) {
  hookIndex += 1
  return fn()
}
const sameDeps = (left, right) =>
  Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))

function useEffect(fn, deps) {
  const index = hookIndex++
  const previous = hooks[index]
  const changed = deps === undefined || previous === undefined || !sameDeps(previous, deps)
  hooks[index] = deps ?? null
  if (changed) effects.push({ index, fn })
}
function useRef(initial) {
  const index = hookIndex++
  if (!(index in hooks)) hooks[index] = { current: initial }
  return hooks[index]
}
function createElement(type, props, ...children) {
  const flat = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
  return { type, props: { ...(props ?? {}), children: flat } }
}
class StubComponent {
  constructor(props) {
    this.props = props
  }
}
StubComponent.prototype.isReactComponent = {}
const React = { createElement, useState, useCallback, useMemo, useEffect, useRef, Component: StubComponent }

// ---------------------------------------------------------------- 环境桩
const responses = {
  'local/list': { resumes: [{ id: 'r1', name: '测试简历', slug: 't', updated_at: '', template: 'onyx', locale: 'zh-CN' }] },
  'local/get': {
    id: 'r1',
    name: '测试简历',
    data: {
      basics: { name: '测试', headline: '工程师' },
      summary: { content: '摘要' },
      sections: { experience: { items: [{ position: '前端', company: 'ACME' }] }, skills: { items: [{ name: 'TS' }] } },
      metadata: { template: 'onyx', layout: { pages: [{ main: ['experience'], sidebar: ['skills'] }] }, page: {}, theme: {}, typography: {} },
    },
  },
  state: { status: { running: false }, resumes: [], sessions: [], outputs: [], config: {} },
}

/** 记录所有桥调用（断言"保存时到底发了什么"）。 */
const calls = []

globalThis.fetch = async (url, init) => {
  const text = String(url)
  if (init?.body !== undefined) {
    try {
      calls.push({ url: text, body: JSON.parse(String(init.body)) })
    } catch {
      calls.push({ url: text, body: String(init.body) })
    }
  }
  const key = Object.keys(responses).find((name) => text.includes(`/${name}`) || text.includes(name))
  if (text.includes('local/render')) return { ok: true, text: async () => '<html></html>', json: async () => ({}) }
  const body = key ? responses[key] : {}
  return { ok: true, json: async () => body, text: async () => JSON.stringify(body) }
}
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  setTimeout: (fn) => setTimeout(fn, 0),
  open: () => null,
}
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true })
globalThis.document = { querySelector: () => null, addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {} }) }
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
}
globalThis.FileReader = class {}

// ---------------------------------------------------------------- 加载模块
let captured = null
globalThis.window.__ModuleLoader__ = { load: (definition) => (captured = definition) }
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
new Function('window', 'React', 'setTimeout', 'fetch', 'document', 'navigator', 'ResizeObserver', 'FileReader', source)(
  globalThis.window,
  React,
  setTimeout,
  globalThis.fetch,
  globalThis.document,
  globalThis.navigator,
  globalThis.ResizeObserver,
  globalThis.FileReader,
)

const module = captured.factory((name) => (name === 'react' ? React : {}))
const slots = []
module.apply({
  get: () => undefined,
  slots: {
    inject: (_name, callback) => callback(),
    register: (options, component) => {
      slots.push({ options, component })
      return () => {}
    },
  },
})

// ---------------------------------------------------------------- 渲染 + 找按钮
function renderTree(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(renderTree)
  if (typeof node.type === 'function') {
    if (node.type.prototype?.isReactComponent) {
      const instance = new node.type(node.props)
      instance.state = instance.state ?? {}
      return renderTree(instance.render())
    }
    return renderTree(node.type(node.props))
  }
  return { ...node, props: { ...node.props, children: renderTree(node.props.children) } }
}

/** 渲染到稳定：每轮跑掉依赖变化的 effect，并让 await 的 setState 落地。 */
async function mount() {
  const entry = slots.find((slot) => slot.options.name === 'main')
  let tree = null
  for (let pass = 0; pass < 40; pass += 1) {
    hookIndex = 0
    effects = []
    dirty = false
    tree = renderTree(entry.component())
    for (const effect of effects) effect.fn()
    // 让 fetch/timer 的微任务与宏任务跑完，再看有没有新的 setState
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (!dirty && effects.length === 0) return tree
  }
  return tree
}

function flatten(node, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const item of node) flatten(item, out)
    return out
  }
  if (typeof node !== 'object') return out
  out.push(node)
  flatten(node.props?.children, out)
  return out
}

function textOf(node) {
  // 空节点必须提前返回：`textOf(undefined)` 会一路递归到自己（以前没触发过）
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node?.props?.children)
}

function findButton(tree, label) {
  return flatten(tree).find((node) => node.type === 'button' && textOf(node.props?.children).includes(label))
}

// ---------------------------------------------------------------- 断言
let failures = 0
const check = (label, ok, detail) => {
  if (ok) console.log(`  ✓ ${label}`)
  else {
    failures += 1
    console.log(`  ✗ ${label}${detail === undefined ? '' : `\n      ${detail}`}`)
  }
}

console.log('== 初始渲染 ==')
let tree = await mount()
const labels = flatten(tree)
  .filter((node) => node.type === 'button')
  .map((node) => textOf(node.props.children).trim())
  .filter(Boolean)
console.log(`  按钮：${labels.join(' / ')}`)
check('自由排版入口已撤', labels.every((label) => !label.includes('自由排版')), labels.join(','))
const ranges = flatten(tree).filter((node) => node.type === 'input' && node.props?.type === 'range')
check('样式滑杆已就位（≥5 个）', ranges.length >= 5, String(ranges.length))
check('没有残留的快捷文本按钮', !labels.includes('圆角'))

console.log('\n== 滑杆直接改文档 ==')
const lineHeight = flatten(tree).find(
  (node) => node.type === 'input' && node.props?.type === 'range' && Number(node.props?.min) === 1,
)
check('找到行高滑杆', lineHeight !== undefined)
if (lineHeight !== undefined) {
  lineHeight.props.onChange({ target: { value: '1.25' } })
  tree = await mount()
  const again = flatten(tree).find(
    (node) => node.type === 'input' && node.props?.type === 'range' && Number(node.props?.min) === 1,
  )
  check('行高滑杆写回 1.25', Number(again?.props?.value) === 1.25, String(again?.props?.value))
}

console.log('\n== 模板入口 ==')
const fileInputs = flatten(tree).filter((node) => node.type === 'input' && node.props?.type === 'file')
check('存在参考图上传入口（file input）', fileInputs.length >= 1, String(fileInputs.length))

// ---------------------------------------------------------------- 栏目增删
console.log('\n== 栏目增删 ==')

/** 找某个栏目块（按显示名）。 */
const chipOf = (currentTree, name) =>
  flatten(currentTree).find(
    (node) => node.props?.className === 'rrv-lay-chip' && textOf(node.props.children).includes(name),
  )

const addButton = flatten(tree).find((node) => node.type === 'button' && node.props?.className === 'rrv-lay-add')
check('栏头有「＋」加栏目', addButton !== undefined)

if (addButton !== undefined) {
  addButton.props.onClick()
  tree = await mount()
  const nameInput = flatten(tree).find(
    (node) => node.type === 'input' && node.props?.placeholder?.includes('新栏目名'),
  )
  check('点「＋」出现栏目名输入框', nameInput !== undefined)

  if (nameInput !== undefined) {
    nameInput.props.onChange({ target: { value: '演讲' } })
    tree = await mount()
    const confirmAdd = flatten(tree).find((node) => node.type === 'button' && textOf(node.props.children).trim() === '加栏目')
    check('出现「加栏目」按钮', confirmAdd !== undefined)
    if (confirmAdd !== undefined) {
      confirmAdd.props.onClick()
      tree = await mount()
      check('新栏目出现在排版里', chipOf(tree, '演讲') !== undefined, '找不到「演讲」块')
    }
  }
}

const speechChip = chipOf(tree, '演讲')
if (speechChip !== undefined) {
  const removeButton = flatten(speechChip).find((node) => node.type === 'button' && textOf(node.props.children).trim() === '×')
  check('栏目块上有「×」删除', removeButton !== undefined)
  if (removeButton !== undefined) {
    removeButton.props.onClick({ stopPropagation() {} })
    tree = await mount()
    const confirmBar = flatten(tree).find((node) => node.props?.className === 'rrv-lay-confirm')
    check('删除前要确认（出现确认条）', confirmBar !== undefined && textOf(confirmBar.props.children).includes('确认删除栏目'))

    const confirmDelete = flatten(confirmBar ?? {}).find(
      (node) => node.type === 'button' && textOf(node.props.children).trim() === '删除',
    )
    check('确认条里有「删除」按钮', confirmDelete !== undefined)
    if (confirmDelete !== undefined) {
      confirmDelete.props.onClick()
      tree = await mount()
      check('确认后栏目消失', chipOf(tree, '演讲') === undefined)
    }
  }
}

// 保存时发出去的 partial：不能留悬空引用，也要把 sections 带上
const saveButton = flatten(tree).find((node) => node.type === 'button' && textOf(node.props.children).trim() === '保存')
if (saveButton !== undefined) {
  saveButton.props.onClick()
  await mount()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const update = [...calls].reverse().find((call) => call.url.includes('local/update'))
  const partial = update?.body?.partial ?? {}
  const sections = partial.sections ?? {}
  const layoutRefs = (partial.metadata?.layout?.pages ?? []).flatMap((page) => [...(page.main ?? []), ...(page.sidebar ?? [])])
  const dangling = layoutRefs.filter((kind) => !(kind in sections))
  check('保存携带 sections', Object.keys(sections).length > 0, JSON.stringify(Object.keys(sections)))
  check('保存的排版里没有悬空引用', dangling.length === 0, dangling.join(','))
}

console.log(`\n${failures === 0 ? '交互自检通过 ✓' : `${failures} 项失败 ✗`}`)
process.exitCode = failures === 0 ? 0 : 1
