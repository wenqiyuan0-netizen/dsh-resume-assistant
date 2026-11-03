/* 简历助手 · 选中即对话：包在应用文档里的小脚本。
 *
 * 它跑在 `http://localhost:3000` 的文档世界里（经典脚本，不是模块），因此能读到
 * 应用自己的 DOM 与登录态；父窗口是 DSH 页面，只接收事件、渲染高亮、把选区写进
 * 「和 agent 说」的输入框。
 *
 * 契约（双向、两侧必须一致）：
 *   父 → 子：{ type: 'rrv:zoom', zoom }                     整体缩放
 *            { type: 'rrv:select', path, label }            父侧选中某块（只画框）
 *   子 → 父：{ type: 'rrv:ready' }                           文档可交互
 *            { type: 'rrv:select', id, path, label, text, template, breadcrumb }
 *            { type: 'rrv:click', label }                    普通点击（首次登录等）
 *
 * 为什么是**结构化选区**而不是鼠标坐标：
 * 坐标只能让模型"看屏幕"；选区带的是简历语言里的地址
 * （`/basics/name`、`/sections/experience/items/2`），agent 直接就能
 * `resume_patch` 改到那一块，不用猜。
 */
;(function () {
  if (window.__rrvBridge) return
  window.__rrvBridge = true

  var HOST_ORIGIN = '*'
  var INTERACTIVE = /^(BUTTON|A|INPUT|TEXTAREA|LABEL|OPTION|SELECT|SVG|PATH)$/
  var lastKey = ''

  /** 给父窗口发消息。 */
  function toParent(message) {
    try {
      window.parent.postMessage(message, HOST_ORIGIN)
    } catch (error) {
      void error
    }
  }

  /** 归一化文本。 */
  function clean(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /** 元素的可见文本（截断），够 agent 认出是哪一块即可。 */
  function ownText(element) {
    var text = clean(element.innerText || element.textContent)
    return text.length > 200 ? text.slice(0, 200) + '…' : text
  }

  /** 简历模板名（拿不到就 null）。 */
  function templateName() {
    var node = document.querySelector('[data-template]')
    return node ? node.getAttribute('data-template') : null
  }

  /** 从表单项反推字段地址（name/id 通常就是 schema 路径的扁平形式）。 */
  function fieldPath(element) {
    var raw = element.getAttribute('name') || element.getAttribute('id') || ''
    if (!raw) return null
    var path = '/' + raw.replace(/^\.|\]$/g, '').replace(/[.\[]/g, '/').replace(/\]$/g, '')
    return path.replace(/\/+/g, '/')
  }

  /** 找一个元素所属的栏目（section），返回 { id, title }。 */
  function sectionOf(element) {
    var section = element.closest && element.closest('section,[data-section]')
    if (!section) return null
    var heading = section.querySelector('h1,h2,h3,[data-section-title]')
    var id =
      section.getAttribute('data-section') ||
      section.getAttribute('data-section-id') ||
      section.id ||
      (heading ? clean(heading.textContent).toLowerCase().replace(/[^a-z0-9]+/g, '-') : null)
    return { id: id, title: heading ? ownText(heading) : id, element: section }
  }

  /** 元素在兄弟节点里的位置（列表条目用）。 */
  function siblingIndex(element, stopAt) {
    var node = element
    var depth = 0
    while (node && node !== stopAt && node.parentElement && depth < 12) {
      var parent = node.parentElement
      if (parent.children.length > 1) return Array.prototype.indexOf.call(parent.children, node)
      node = parent
      depth += 1
    }
    return -1
  }

  /** 把一个被点中的元素翻译成简历语言里的选区。 */
  function describe(element) {
    if (!element || element.nodeType !== 1) return null
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      return {
        path: fieldPath(element),
        label: element.getAttribute('placeholder') || element.getAttribute('aria-label') || element.getAttribute('name'),
        text: clean(element.value),
      }
    }
    var section = sectionOf(element)
    var index = section ? siblingIndex(element, section.element) : -1
    var path = null
    if (section && section.id) {
      path = '/sections/' + section.id
      if (index >= 0) path += '/items/' + index
    }
    return {
      path: path,
      label: section ? section.title : ownText(element).slice(0, 60),
      text: ownText(element),
    }
  }

  /** 在元素上画一个高亮框（1.6s 后自动消失）。 */
  function highlight(element) {
    var previous = document.getElementById('__rrv-highlight')
    if (previous) previous.remove()
    if (!element || !element.getBoundingClientRect) return
    var rect = element.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return
    var box = document.createElement('div')
    box.id = '__rrv-highlight'
    box.setAttribute('aria-hidden', 'true')
    box.style.cssText = [
      'position:fixed',
      'left:' + rect.left + 'px',
      'top:' + rect.top + 'px',
      'width:' + rect.width + 'px',
      'height:' + rect.height + 'px',
      'border:2px solid #2563eb',
      'border-radius:4px',
      'pointer-events:none',
      'z-index:2147483646',
      'box-shadow:0 0 0 3px rgba(37,99,235,.18)',
    ].join(';')
    document.documentElement.appendChild(box)
    window.setTimeout(function () {
      box.remove()
    }, 1600)
  }

  /** 统一选中处理：画框 + 上报（同一块重复点不重复发）。 */
  function select(element) {
    var info = describe(element)
    if (!info) return
    highlight(element)
    var key = [info.path, info.label, info.text].join('|')
    if (key === lastKey) return
    lastKey = key
    toParent({
      type: 'rrv:select',
      id: window.location.pathname + window.location.search,
      path: info.path,
      label: info.label,
      text: info.text,
      template: templateName(),
    })
  }

  document.addEventListener(
    'pointerup',
    function (event) {
      var element = event.target
      if (!element || !element.closest) return
      // 点按钮/链接是"操作"，不是"选中"，只给父窗口一个提示
      if (INTERACTIVE.test(element.tagName) && element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA') {
        toParent({ type: 'rrv:click', label: ownText(element).slice(0, 40) })
        return
      }
      select(element)
    },
    true,
  )

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || typeof data.type !== 'string') return
    if (data.type === 'rrv:zoom') {
      var zoom = Number(data.zoom)
      if (isFinite(zoom) && zoom > 0.2 && zoom < 3) document.documentElement.style.zoom = String(zoom)
      return
    }
    if (data.type === 'rrv:select' && typeof data.path === 'string') {
      var field = data.path.split('/').filter(Boolean).pop()
      var target = field ? document.querySelector('[name="' + field + '"],#' + field) : null
      if (target) highlight(target)
    }
  })

  /** 第一次拿到尺寸后上报 ready，让父窗口收起 loading。 */
  function ready() {
    toParent({ type: 'rrv:ready', title: document.title, url: window.location.href })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready)
  else ready()
})()
