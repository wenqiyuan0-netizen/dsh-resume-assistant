/**
 * dsh-resume-assistant —— 浏览器端。
 *
 * 两个座位：
 *   1. `conversation.view`（id: resume）—— 「简历」标签页。里面是真正的
 *      Reactive Resume 编辑器：可缩放、可直接手动改，改完还能把诉求发给 agent。
 *   2. `conversation.composer.dock` —— 对话输入框下面那一排：只显示简历本身
 *      （缩小预览）+ 状态 + 开关服务 + 直接对 agent 说话。
 *
 * 数据全部走宿主桥 `resume-bridge/*`（`ctx.connection.fetch` 注册的同源路由），
 * 浏览器里不碰密钥、不直连 3000 端口的 MCP。
 */
window.__ModuleLoader__.load({
  id: 'dsh-resume-assistant',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    // 宿主桥的挂载点：`connection.fetch` 的精确路由在共享通道 `/api` 下。
    // 用**绝对路径**而不是相对路径：页面若挂在子路径（/s/xxx）下，相对形式会解析
    // 成 /s/api/... 而 404 —— 这就是"点了没反应"的第二个坑。
    const BRIDGE = '/api/resume-bridge'
    const DEFAULT_APP_URL = 'http://localhost:3000'

    /** 中英文案；跟随页面语言，缺省中文。 */
    const TEXT = {
      'zh-CN': {
        view: '简历',
        running: '服务运行中',
        stopped: '服务未启动',
        starting: '正在启动…',
        start: '启动服务',
        open: '打开',
        openWindow: '浏览器打开',
        zoomOut: '缩小',
        zoomIn: '放大',
        resetZoom: '复位',
        pickResume: '选择简历',
        empty: '还没有简历',
        askTitle: '和 agent 说',
        askPlaceholder: '例如：把模板换成 gengar，主色改成深蓝，压到一页',
        send: '发送',
        sending: '发送中…',
        sent: '已发给 agent',
        copied: '发送失败，已复制到剪贴板',
        stripTitle: '简历',
        editor: '放大编辑',
        noService: '服务没在跑：点「启动服务」，或在对话里让我调 resume_service(start)。',
        session: '会话',
        bridgeDown: '桥不可达',
        backToChat: '对话',
        exportPdf: '导出 PDF',
        exporting: '正在导出…',
        exportedTo: '已导出并复制路径',
        printFallback: '已打开打印窗口：目标选「另存为 PDF」',
        openLarger: '放大',
        quoteHint: '在预览里双击或右键任意一块，即可把它作为引用加入对话',
        quoteAsk: '这几块要改成什么样？Ctrl/⌘+Enter 发送',
        removeQuote: '移除引用',
        dragHint: '拖动调整宽度/高度',
        sameSession: '发到当前会话（回复在「对话」里）',
        targetSession: '会话',
        templateGallery: '模板',
        templateGalleryHint: '点一个模板立刻套用；样张用的是你当前的简历内容',
        close: '关闭',
        templateReady: '新模板已生成',
        templateBuilding: '正在制作中…',
        templateUploading: '上传参考图…',
        templateUploadFailed: '上传失败',
        newTemplate: '＋ 用参考图做模板',
        photo: '照片',
        layout: '排版与分页',
        pageLabel: '第',
        mainCol: '主栏',
        sideCol: '侧栏',
        dragSectionHint: '拖动栏目到另一栏/另一页即可重排；＋加页，－删页（栏目会并回上一页）',
        freeOn: '自由排版（画布拖动）',
        freeOff: '退出自由排版',
        freeHint: '拖动块改位置（吸附 2mm），右侧滑杆改宽度；这是真实写回 layout.free 的坐标',
        freeActive: '拖动蓝色块即可摆位置',
        freeRelayout: '重排',
        dropHere: '把栏目拖到这里',
        uploadPhoto: '选择图片',
        removePhoto: '移除',
        showPhoto: '显示',
        hidePhoto: '隐藏',
        photoSize: '尺寸',
        photoShape: '形状',
        circle: '圆形',
        square: '方形',
        print: '打印 / 存为 PDF',
        zoomHint: '这是导出用的同一份 A4 排版，Ctrl+P 或点「打印」可直接存 PDF',
        resumeList: '简历',
        basics: '基本信息',
        nameLabel: '姓名',
        headline: '头衔',
        phone: '电话',
        location: '城市',
        website: '网站',
        summary: '个人简介',
        style: '样式',
        template: '模板',
        language: '语言',
        primary: '主色',
        fontSize: '正文字号',
        lineHeightLabel: '行高',
        marginX: '左右页边距',
        marginY: '上下页边距',
        sidebarWidth: '侧栏宽度 %',
        preview: '预览',
        previewPending: '正在渲染预览…',
        previewFailed: '预览渲染失败',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        exportChat: '导出到对话',
        loading: '加载中…',
        pickOne: '从左侧选一份简历',
        selected: '已选中',
        askSelectedHint: '说说这一块要改成什么样（回车发送）',
        beautify: '美化这一块',
        beautifyHint: '把选中块的排版交给 agent 重排（字号层级/行高/对齐/项目符号）',
      },
      en: {
        view: 'Resume',
        running: 'Service running',
        stopped: 'Service stopped',
        starting: 'Starting…',
        start: 'Start service',
        open: 'Open',
        openWindow: 'Open in browser',
        zoomOut: 'Zoom out',
        zoomIn: 'Zoom in',
        resetZoom: 'Reset',
        pickResume: 'Resume',
        empty: 'No resumes yet',
        askTitle: 'Tell the agent',
        askPlaceholder: 'e.g. switch to the gengar template, dark blue accent, fit one page',
        send: 'Send',
        sending: 'Sending…',
        sent: 'Sent to agent',
        copied: 'Send failed; copied to clipboard',
        stripTitle: 'Resume',
        editor: 'Edit larger',
        noService: 'Service is down: press "Start service", or ask me to call resume_service(start).',
        session: 'Session',
        bridgeDown: 'Bridge unreachable',
        backToChat: 'Chat',
        exportPdf: 'Export PDF',
        exporting: 'Exporting…',
        exportedTo: 'Exported; path copied',
        printFallback: 'Print dialog opened — choose "Save as PDF"',
        openLarger: 'Open larger',
        quoteHint: 'Double-click or right-click any block in the preview to quote it into the chat',
        quoteAsk: 'What should these blocks become? Ctrl/Cmd+Enter to send',
        removeQuote: 'Remove quote',
        dragHint: 'Drag to resize',
        sameSession: 'Sent to this session — replies appear in Chat',
        targetSession: 'Session',
        templateGallery: 'Templates',
        templateGalleryHint: 'Click a template to apply it; thumbnails use your current resume',
        close: 'Close',
        templateReady: 'Template created',
        templateBuilding: 'Building…',
        templateUploading: 'Uploading reference…',
        templateUploadFailed: 'Upload failed',
        newTemplate: 'New template from image',
        photo: 'Photo',
        layout: 'Layout & pages',
        pageLabel: 'Page',
        mainCol: 'Main',
        sideCol: 'Sidebar',
        dragSectionHint: 'Drag a section to another column or page; + adds a page, − merges it back',
        freeOn: 'Free layout (drag canvas)',
        freeOff: 'Leave free layout',
        freeHint: 'Drag a block to move it (2mm snap); sliders set width',
        freeActive: 'Drag the blue blocks',
        freeRelayout: 'Re-layout',
        dropHere: 'Drop a section here',
        uploadPhoto: 'Choose image',
        removePhoto: 'Remove',
        showPhoto: 'Show',
        hidePhoto: 'Hide',
        photoSize: 'Size',
        photoShape: 'Shape',
        circle: 'Circle',
        square: 'Square',
        print: 'Print / Save as PDF',
        zoomHint: 'Same A4 layout used for export — print it straight to PDF',
        resumeList: 'Resumes',
        basics: 'Basics',
        nameLabel: 'Name',
        headline: 'Headline',
        phone: 'Phone',
        location: 'Location',
        website: 'Website',
        summary: 'Summary',
        style: 'Style',
        template: 'Template',
        language: 'Language',
        primary: 'Accent',
        fontSize: 'Body size',
        lineHeightLabel: 'Line height',
        marginX: 'Page margin X',
        marginY: 'Page margin Y',
        sidebarWidth: 'Sidebar %',
        preview: 'Preview',
        previewPending: 'Rendering preview…',
        previewFailed: 'Preview render failed',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        exportChat: 'Export to chat',
        loading: 'Loading…',
        pickOne: 'Pick a resume on the left',
        selected: 'Selected',
        askSelectedHint: 'What should this block become? (Enter to send)',
        beautify: 'Beautify block',
        beautifyHint: 'Hand the selected block to the agent for a typography pass',
      },
    }

    /** 视图内使用的文案（组件是纯函数，语言在 apply 时定好）。 */
    let ACTIVE = TEXT['zh-CN']
    const text = () => ACTIVE

    /** 当前语言：能读到 locale 服务就跟随，否则中文。 */
    function pickLang(ctx) {
      try {
        const locale = ctx?.get?.('locale')
        const id = locale?.getLocale?.()?.id
        if (typeof id === 'string' && id.toLowerCase().startsWith('en')) return 'en'
      } catch {
        /* 保持中文 */
      }
      return 'zh-CN'
    }

    // ---------------------------------------------------------------- 桥

    /** 读一次完整状态。 */
    async function readState() {
      const response = await fetch(`${BRIDGE}/state`, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`state ${response.status}`)
      return await response.json()
    }

    /** 调服务开关。 */
    async function callService(action) {
      const response = await fetch(`${BRIDGE}/service`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      return await response.json().catch(() => ({}))
    }

    /** 把一段话投给某个会话的 agent。 */
    async function askAgent(sessionId, body) {
      const response = await fetch(`${BRIDGE}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, text: body }),
      })
      return await response.json().catch(() => ({ ok: false, reason: `HTTP ${response.status}` }))
    }

    /**
     * 轮询桥状态。
     * @param intervalMs - 轮询间隔；0 表示只读一次。
     */
    function useBridge(intervalMs = 3000) {
      const [state, setState] = useState({ loading: true, data: null, error: null })

      const refresh = useCallback(async () => {
        try {
          const data = await readState()
          setState({ loading: false, data, error: null })
        } catch (error) {
          setState((previous) => ({
            loading: false,
            data: previous.data,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }, [])

      useEffect(() => {
        let cancelled = false
        const tick = () => {
          if (!cancelled) void refresh()
        }
        tick()
        if (intervalMs <= 0) {
          return () => {
            cancelled = true
          }
        }
        const timer = setInterval(tick, intervalMs)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [intervalMs, refresh])

      return { ...state, refresh }
    }

    /**
     * 订阅应用页面传来的「选中了哪一块」。
     *
     * 应用文档里注入的 dsh-resume-bridge.js 在用户点击时 postMessage 一条
     * `{type:'rrv:select', path, label, text, template}`；这里只做两件事：
     * 记住选区、把可用于对话的一句话拼好。选区选择器（`data-rrv-sel`）让两处 iframe
     * 各自只认自己那份消息。
     * @param selector - 该 iframe 的 CSS 选择器。
     */
    function useResumeSelection(selector) {
      const [selection, setSelection] = useState(null)

      useEffect(() => {
        const onMessage = (event) => {
          const data = event.data
          if (data === null || typeof data !== 'object' || data.type !== 'rrv:select') return
          const frame = document.querySelector(selector)
          if (frame === null || event.source !== frame.contentWindow) return
          if (typeof data.path !== 'string' && typeof data.label !== 'string') return
          setSelection({
            path: typeof data.path === 'string' ? data.path : '',
            label: typeof data.label === 'string' ? data.label : '',
            text: typeof data.text === 'string' ? data.text : '',
            template: typeof data.template === 'string' ? data.template : '',
            resumeId: typeof data.id === 'string' ? data.id : '',
            at: Date.now(),
          })
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [selector])

      return [selection, setSelection]
    }

    /**
     * 把「选中块 + 诉求」拼成发给 agent 的一段话。
     *
     * 这是"AI 直接知道是哪一块"的落地方式：把结构地址写进消息里，
     * agent 拿去就能直接 `resume_patch` 到那条 path，不用猜。
     * @param selection - 选区。
     * @param ask - 用户的诉求。
     * @returns 文本。
     */
    function composeAsk(selection, ask) {
      const body = ask.trim()
      if (selection === null) return body
      const lines = [`简历：${selection.resumeId || '(当前打开的)'}`]
      if (selection.template !== '') lines.push(`模板：${selection.template}`)
      if (selection.path !== '') lines.push(`选中块：${selection.path}`)
      if (selection.label !== '') lines.push(`块标题：${selection.label}`)
      if (selection.text !== '') lines.push(`块内容：${selection.text}`)
      lines.push('', body === '' ? '说说这一块要改成什么样。' : body)
      return lines.join('\n')
    }

    // ---------------------------------------------------------------- 样式

    const CSS = [
      '.rrv-root { display: flex; flex-direction: column; min-height: 0; height: 100%; width: 100%;',
      '  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); }',
      '.rrv-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px;',
      '  border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }',
      '.rrv-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }',
      '.rrv-dot.on { background: var(--dsw-alias-state-success-primary); }',
      '.rrv-dot.off { background: var(--dsw-alias-state-error-primary); }',
      '.rrv-dot.busy { background: var(--dsw-alias-state-warn-primary); }',
      '.rrv-status { font-size: 12px; color: var(--dsw-alias-label-secondary); }',
      '.rrv-btn { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px;',
      '  font-size: 12px; line-height: 1; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1);',
      '  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); cursor: pointer; white-space: nowrap; }',
      '.rrv-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }',
      '.rrv-btn:disabled { opacity: .55; cursor: default; }',
      '.rrv-btn.primary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: #fff; }',
      '.rrv-select { height: 26px; padding: 0 8px; font-size: 12px; border-radius: 8px;',
      '  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2);',
      '  color: var(--dsw-alias-label-primary); max-width: 220px; }',
      '.rrv-chip { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 999px;',
      '  font-size: 11px; font-family: var(--ds-font-family-code); white-space: nowrap; max-width: 220px;',
      '  overflow: hidden; text-overflow: ellipsis;',
      '  color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);',
      '  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 28%, transparent); }',
      '.rrv-stage { position: relative; flex: 1; min-height: 0; overflow: auto; background: var(--dsw-alias-bg-base); }',
      '.rrv-frame-wrap { transform-origin: top left; }',
      '.rrv-frame { border: 0; background: #fff; display: block; }',
      '.rrv-empty { margin: auto; padding: 24px; max-width: 460px; text-align: center; font-size: 13px;',
      '  color: var(--dsw-alias-label-secondary); display: flex; flex-direction: column; gap: 10px; align-items: center; }',
      '.rrv-notice { font-size: 12px; color: var(--dsw-alias-label-secondary); }',
      '.rrv-ask { display: flex; align-items: center; gap: 6px; margin-left: auto; }',
      '.rrv-input { height: 26px; padding: 0 10px; min-width: 140px; font-size: 12px; border-radius: 999px;',
      '  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base);',
      '  color: var(--dsw-alias-label-primary); }',
      '.rrv-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); }',
      // 输入框下面那一排：安静的一行卡片（缩略图 + 名字 + 动作），不抢对话的注意力
      '.rrv-dock { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 12px;',
      '  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);',
      '  color: var(--dsw-alias-label-primary); }',
      '.rrv-dock-glyph { width: 34px; height: 34px; flex: none; border-radius: 9px; display: flex;',
      '  align-items: center; justify-content: center; background: var(--dsw-alias-bg-layer-2);',
      '  color: var(--dsw-alias-label-secondary); }',
      '.rrv-thumb { position: relative; width: 84px; height: 60px; flex: none; padding: 0; cursor: pointer;',
      '  border-radius: 9px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); background: #fff; }',
      '.rrv-thumb .rrv-frame { width: 280px; height: 200px; transform: scale(.3); transform-origin: top left; pointer-events: none; }',
      '.rrv-thumb-hint { position: absolute; left: 0; right: 0; bottom: 0; font-size: 10px; line-height: 16px;',
      '  text-align: center; color: #fff; background: rgba(15, 23, 42, .55); opacity: 0; transition: opacity .15s; }',
      '.rrv-thumb:hover .rrv-thumb-hint { opacity: 1; }',
      '.rrv-dock-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }',
      '.rrv-dock-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600;',
      '  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.rrv-dock-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden;',
      '  text-overflow: ellipsis; white-space: nowrap; }',
      '.rrv-dock-actions { display: flex; align-items: center; gap: 6px; flex: none; }',
      // 整页编辑器（左栏入口 → 主面板）
      '.rrv-ed { display: flex; flex-direction: column; height: 100%; min-height: 0; width: 100%;',
      '  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font-size: 13px; }',
      '.rrv-ed-bar { display: flex; align-items: center; gap: 10px; padding: 10px 16px;',
      '  border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }',
      '.rrv-ed-brand { font-size: 14px; font-weight: 600; letter-spacing: .02em; }',
      '.rrv-ed-note { font-size: 11px; color: var(--dsw-alias-label-secondary); max-width: 40vw;',
      '  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.rrv-ed-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 232px minmax(0, 1fr) 300px; gap: 0; }',
      '.rrv-ed-list { border-right: 1px solid var(--dsw-alias-border-l1); padding: 8px; overflow: auto;',
      '  display: flex; flex-direction: column; gap: 2px; }',
      '.rrv-ed-list-head { display: flex; align-items: center; justify-content: space-between;',
      '  font-size: 11px; color: var(--dsw-alias-label-secondary); padding: 2px 4px 8px; }',
      '.rrv-ed-item { display: flex; flex-direction: column; gap: 2px; text-align: left; width: 100%;',
      '  padding: 8px 10px; border-radius: 8px; border: 1px solid transparent; background: transparent;',
      '  color: inherit; cursor: pointer; font: inherit; }',
      '.rrv-ed-item:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.rrv-ed-item.active { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); }',
      '.rrv-ed-item-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.rrv-ed-item-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); }',
      '.rrv-ed-form { padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 18px; }',
      '.rrv-ed-group { display: flex; flex-direction: column; gap: 8px; }',
      '.rrv-ed-title { font-size: 11px; letter-spacing: .08em; text-transform: uppercase;',
      '  color: var(--dsw-alias-label-secondary); }',
      '.rrv-field { display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: center; gap: 10px; }',
      '.rrv-field-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }',
      '.rrv-field-input { height: 30px; padding: 0 10px; font: inherit; font-size: 12px; min-width: 0;',
      '  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);',
      '  color: var(--dsw-alias-label-primary); }',
      '.rrv-field-input:focus { outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);',
      '  outline-offset: -1px; }',
      '.rrv-field-area { height: auto; padding: 8px 10px; resize: vertical; line-height: 1.5; }',
      '.rrv-ed-preview { border-left: 1px solid var(--dsw-alias-border-l1); padding: 12px; overflow: auto;',
      '  display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-layer-1); }',
      '.rrv-ed-preview-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }',
      '.rrv-ed-sheet { overflow: hidden; border-radius: 8px; margin: 0 auto;',
      '  border: 1px solid var(--dsw-alias-border-l1); background: #fff; box-shadow: 0 8px 28px rgba(15,23,42,.12); }',
      '.rrv-ed-frame { width: 794px; height: 1123px; border: 0; transform-origin: top left; background: #fff; }',
      '.rrv-ed-divider { width: 6px; cursor: col-resize; background: transparent; position: relative; }',
      '.rrv-ed-divider::after { content: ""; position: absolute; inset: 0 2px; border-radius: 2px; }',
      '.rrv-ed-divider:hover::after { background: var(--dsw-alias-border-l2); }',
      '.rrv-gal-mask { position: fixed; inset: 0; z-index: 60; background: rgba(15,23,42,.42);',
      '  display: flex; align-items: center; justify-content: center; padding: 32px; }',
      '.rrv-gal { width: min(1120px, 92vw); max-height: 86vh; display: flex; flex-direction: column;',
      '  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);',
      '  border-radius: 14px; border: 1px solid var(--dsw-alias-border-l1); overflow: hidden;',
      '  box-shadow: 0 24px 64px rgba(15,23,42,.28); }',
      '.rrv-gal-bar { display: flex; align-items: center; gap: 10px; padding: 12px 16px;',
      '  border-bottom: 1px solid var(--dsw-alias-border-l1); }',
      '.rrv-gal-grid { overflow: auto; padding: 16px; display: grid; gap: 14px;',
      '  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }',
      '.rrv-gal-item { display: flex; flex-direction: column; gap: 6px; padding: 8px; cursor: pointer;',
      '  border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);',
      '  color: inherit; font: inherit; }',
      '.rrv-gal-item:hover { border-color: var(--dsw-alias-border-l2); }',
      '.rrv-gal-item.active { border-color: var(--dsw-alias-brand-primary);',
      '  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent); }',
      '.rrv-gal-thumb { position: relative; width: 100%; aspect-ratio: 794 / 1123; overflow: hidden;',
      '  border-radius: 6px; background: #fff; border: 1px solid var(--dsw-alias-border-l1); }',
      '.rrv-gal-frame { width: 794px; height: 1123px; border: 0; transform: scale(.17); transform-origin: top left;',
      '  pointer-events: none; }',
      '.rrv-gal-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;',
      '  font-size: 11px; color: var(--dsw-alias-label-secondary); }',
      '.rrv-gal-name { font-size: 12px; text-align: center; }',
      '.rrv-gal-note { padding: 8px 16px; font-size: 12px; color: var(--dsw-alias-state-warn-primary);',
      '  border-bottom: 1px solid var(--dsw-alias-border-l1); }',
      '.rrv-zoom { width: min(1040px, 94vw); height: 92vh; display: flex; flex-direction: column;',
      '  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); border-radius: 14px;',
      '  border: 1px solid var(--dsw-alias-border-l1); overflow: hidden; box-shadow: 0 24px 64px rgba(15,23,42,.3); }',
      '.rrv-zoom-body { flex: 1; overflow: auto; padding: 18px; background: #e9edf3; }',
      '.rrv-zoom-frame { display: block; width: 794px; height: 1123px; margin: 0 auto; border: 0; background: #fff;',
      '  box-shadow: 0 10px 30px rgba(15,23,42,.18); }',
      '.rrv-ed-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }',
      '.rrv-ed-quotes { display: flex; flex-wrap: wrap; gap: 4px; }',
      '.rrv-quote { display: inline-flex; align-items: center; gap: 6px; padding: 2px 6px 2px 8px;',
      '  border-radius: 999px; font-size: 11px; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);',
      '  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent); }',
      '.rrv-quote i { font-style: normal; font-family: var(--ds-font-family-code); font-size: 10px; opacity: .7; }',
      '.rrv-quote-x { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 13px; line-height: 1; opacity: .6; }',
      '.rrv-lay-pages { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }',
      '.rrv-lay-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }',
      '.rrv-lay-col { border: 1px dashed var(--dsw-alias-border-l1); border-radius: 10px; padding: 6px;',
      '  min-height: 84px; display: flex; flex-direction: column; gap: 4px; background: var(--dsw-alias-bg-layer-1); }',
      '.rrv-lay-col.side { background: var(--dsw-alias-bg-layer-2); }',
      '.rrv-lay-col-head { font-size: 11px; color: var(--dsw-alias-label-secondary); padding: 2px 4px; }',
      '.rrv-lay-freebar { display: flex; align-items: center; gap: 8px; }',
      '.rrv-free-wrap { display: grid; grid-template-columns: auto minmax(120px, 1fr); gap: 10px; align-items: start; }',
      '.rrv-free-canvas { position: relative; background: #fff; border: 1px solid var(--dsw-alias-border-l1);',
      '  border-radius: 6px; box-shadow: 0 6px 18px rgba(15,23,42,.12); overflow: hidden; }',
      '.rrv-free-blk { position: absolute; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);',
      '  border: 1px solid var(--dsw-alias-brand-primary); border-radius: 4px; cursor: grab;',
      '  padding: 2px 4px; font-size: 10px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }',
      '.rrv-free-blk:active { cursor: grabbing; }',
      '.rrv-free-blk.dragging { opacity: .85; box-shadow: 0 8px 18px rgba(15,23,42,.25); }',
      '.rrv-free-side { display: flex; flex-direction: column; gap: 6px; }',
      '.rrv-free-w { display: grid; grid-template-columns: 64px 1fr; gap: 6px; align-items: center; font-size: 11px; }',
      '.rrv-lay-chip { display: flex; align-items: center; gap: 6px; padding: 4px 8px; cursor: grab;',
      '  border-radius: 7px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1);',
      '  font-size: 12px; }',
      '.rrv-lay-chip:active { cursor: grabbing; }',
      '.rrv-lay-grip { color: var(--dsw-alias-label-secondary); font-size: 10px; letter-spacing: -1px; }',
      '.rrv-lay-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.rrv-ed-photo { display: flex; align-items: center; gap: 10px; }',
      '.rrv-ed-avatar { width: 56px; height: 56px; border-radius: 10px; object-fit: cover;',
      '  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }',
      '.rrv-ed-avatar.empty { display: flex; align-items: center; justify-content: center;',
      '  color: var(--dsw-alias-label-secondary); }',
      '.rrv-ed-photo-ctl { display: flex; gap: 6px; flex-wrap: wrap; }',
      '.rrv-quick { display: flex; flex-wrap: wrap; gap: 4px; }',
      '.rrv-range { display: flex; align-items: center; gap: 8px; }',
      '.rrv-range-input { flex: 1; accent-color: var(--dsw-alias-brand-primary); }',
      '.rrv-range-value { font-size: 11px; color: var(--dsw-alias-label-secondary); min-width: 28px; text-align: right; font-variant-numeric: tabular-nums; }',
      '.rrv-quote.text { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent);',
      '  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 34%, transparent); }',
      '.rrv-ed-ask-grip { height: 6px; margin: 2px 0 4px; cursor: row-resize; border-radius: 3px; }',
      '.rrv-ed-ask-grip:hover { background: var(--dsw-alias-border-l2); }',
      '.rrv-ed-composer { display: flex; flex-direction: column; gap: 6px; min-height: 88px; resize: none; }',
      '.rrv-ed-ask-box { flex: 1; min-height: 0; resize: none; font-size: 12px; }',
      '.rrv-ed-ask-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }',
      '.rrv-ed-ask { display: flex; gap: 6px; align-items: center; }',
      '.rrv-ed-preview-box { flex: 1; border-radius: 10px; border: 1px dashed var(--dsw-alias-border-l2);',
      '  display: flex; align-items: center; justify-content: center; text-align: center; padding: 16px;',
      '  font-size: 11px; color: var(--dsw-alias-label-secondary); }',
      '.rrv-ed-empty { padding: 16px; font-size: 12px; color: var(--dsw-alias-label-secondary); }',
    ].join('\n')

    /** 把包内样式作为 React 元素渲染，卸载即消失。 */
    function Styles() {
      return h('style', { 'data-rrv': 'styles' }, CSS)
    }

    /**
     * 错误边界：面板里任何渲染异常都变成屏幕上的文字。
     * 没有它，一个 undefined 就会让整个面板白屏 —— 用户只能看到"打不开"。
     */
    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error, info) {
        console.error('resume panel crashed', error, info)
      }

      render() {
        if (this.state.error === null) return this.props.children
        const message = this.state.error?.stack ?? String(this.state.error)
        return h(
          'div',
          { style: { padding: 16, fontFamily: 'var(--ds-font-family-code)', fontSize: 12, whiteSpace: 'pre-wrap' } },
          h('strong', null, '面板渲染出错'),
          h('pre', { style: { marginTop: 8, overflow: 'auto', maxHeight: '60vh' } }, message),
          h(
            'button',
            {
              className: 'rrv-btn',
              type: 'button',
              onClick: () => {
                void navigator.clipboard.writeText(message)
              },
            },
            '复制错误',
          ),
        )
      }
    }

    /** 简洁的文档图标（不引第三方图标库，跟随文字颜色）。 */
    function DocGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 18,
          height: 18,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }),
        h('path', { d: 'M14 3v5h5' }),
        h('path', { d: 'M9 13h6' }),
        h('path', { d: 'M9 17h4' }),
      )
    }

    // ---------------------------------------------------------------- 小组件

    /** 状态圆点 + 文案。 */
    function StatusPill({ status, busy }) {
      const t = text()
      const running = status?.running === true
      const state = busy ? 'busy' : running ? 'on' : 'off'
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        h('span', { className: `rrv-dot ${state}` }),
        h('span', { className: 'rrv-status' }, busy ? t.starting : running ? t.running : t.stopped),
      )
    }

    /** 简历下拉。 */
    function ResumePicker({ resumes, value, onChange }) {
      const t = text()
      if (resumes.length === 0) return h('span', { className: 'rrv-sub' }, t.empty)
      return h(
        'select',
        { className: 'rrv-select', value, onChange: (event) => onChange(event.target.value), title: t.pickResume },
        resumes.map((resume) => h('option', { key: resume.id, value: resume.id }, resume.name)),
      )
    }

    // ---------------------------------------------------------------- 视图

    /** 「简历」标签页：整块编辑器 + 缩放 + 对 agent 说话。 */
    function ResumeView() {
      const t = text()
      const bridge = useBridge(4000)
      const [selection, setSelection] = useResumeSelection('#rrv-view-frame')
      const [zoom, setZoom] = useState(1)
      const [resumeId, setResumeId] = useState('')
      const [sessionId, setSessionId] = useState('')
      const [draft, setDraft] = useState('')
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState(false)

      const data = bridge.data
      const status = data?.status
      const resumes = data?.resumes ?? []
      const sessions = data?.sessions ?? []
      const appUrl = data?.config?.appUrl ?? DEFAULT_APP_URL
      const running = status?.running === true

      useEffect(() => {
        if (resumeId === '' && resumes.length > 0) setResumeId(resumes[0].id)
      }, [resumes, resumeId])

      useEffect(() => {
        if (sessionId === '' && sessions.length > 0) setSessionId(sessions[0].id)
      }, [sessions, sessionId])

      const start = useCallback(async () => {
        setBusy(true)
        setNote(t.starting)
        try {
          const result = await callService('start')
          setNote(result.ok ? '' : `启动失败：${result.state ?? ''} ${result.detail ?? ''}`.trim())
        } finally {
          setBusy(false)
          void bridge.refresh()
        }
      }, [bridge, t.starting])

      const send = useCallback(
        async (ask) => {
          const body = typeof ask === 'string' ? ask : draft
          const composed = composeAsk(selection, body)
          if (composed.trim() === '') return
          setBusy(true)
          try {
            const result = await askAgent(sessionId, composed)
            if (result.ok) {
              setDraft('')
              setNote(`${t.sent}（${result.transport}）`)
            } else {
              try {
                await navigator.clipboard.writeText(composed)
                setNote(`${t.copied}：${result.reason}`)
              } catch {
                setNote(String(result.reason))
              }
            }
          } finally {
            setBusy(false)
          }
        },
        [draft, selection, sessionId, t.copied, t.sent],
      )

      /** 一键"美化这一块"：把选区 + 排版诉求交给 agent。 */
      const beautify = useCallback(() => {
        void send(
          [
            '把这一块的排版美化一下：',
            '- 统一字号层级（标题/正文/时间各自固定），对齐到同一条基线；',
            '- 收紧行高与段间距，去掉多余空行，保证不溢出到下一页；',
            '- 项目符号统一，动词开头、每条不超过一行；',
            '- 颜色只保留一个主色强调，其余用中性灰。',
            '改完告诉我改了哪几条 path。',
          ].join('\n'),
        )
      }, [send])

      const src = resumeId === '' ? appUrl : `${appUrl}/builder/${resumeId}`

      const toolbar = h(
        'div',
        { className: 'rrv-bar' },
        h(StatusPill, { status, busy }),
        h(ResumePicker, { resumes, value: resumeId, onChange: setResumeId }),
        h(
          'button',
          {
            className: 'rrv-btn',
            title: t.zoomOut,
            onClick: () => setZoom((value) => Math.max(0.4, Math.round((value - 0.1) * 10) / 10)),
          },
          '−',
        ),
        h('button', { className: 'rrv-btn', title: t.resetZoom, onClick: () => setZoom(1) }, `${Math.round(zoom * 100)}%`),
        h(
          'button',
          {
            className: 'rrv-btn',
            title: t.zoomIn,
            onClick: () => setZoom((value) => Math.min(2, Math.round((value + 0.1) * 10) / 10)),
          },
          '+',
        ),
        h(
          'a',
          { className: 'rrv-btn', title: t.openWindow, href: src, target: '_blank', rel: 'noopener' },
          t.openWindow,
        ),
        sessions.length > 1
          ? h(
              'select',
              {
                className: 'rrv-select',
                value: sessionId,
                title: t.session,
                onChange: (event) => setSessionId(event.target.value),
              },
              sessions.map((session) =>
                h('option', { key: session.id, value: session.id }, session.title || session.id.slice(0, 8)),
              ),
            )
          : null,
        h(
          'div',
          { className: 'rrv-ask' },
          selection !== null
            ? h(
                'span',
                { className: 'rrv-chip', title: `${selection.path || selection.label}` },
                `${t.selected} ${selection.path || selection.label}`,
              )
            : null,
          h('input', {
            className: 'rrv-input',
            value: draft,
            placeholder: selection !== null ? t.askSelectedHint : t.askPlaceholder,
            title: t.askTitle,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            },
          }),
          h(
            'button',
            { className: 'rrv-btn', onClick: () => beautify(), disabled: busy, title: t.beautifyHint },
            t.beautify,
          ),
          h(
            'button',
            { className: 'rrv-btn primary', onClick: () => void send(), disabled: busy || draft.trim() === '' },
            busy ? t.sending : t.send,
          ),
        ),
      )

      const body = running
        ? h(
            'div',
            { className: 'rrv-stage' },
            h(
              'div',
              {
                className: 'rrv-frame-wrap',
                style: { transform: `scale(${zoom})`, width: `${100 / zoom}%`, height: `${100 / zoom}%` },
              },
              h('iframe', {
                id: 'rrv-view-frame',
                className: 'rrv-frame',
                src,
                title: 'Reactive Resume',
                style: { width: '100%', height: '100%' },
                allow: 'clipboard-read; clipboard-write; fullscreen',
              }),
            ),
          )
        : h(
            'div',
            { className: 'rrv-empty' },
            h('span', { className: 'rrv-dot off' }),
            h('div', null, t.noService),
            h('button', { className: 'rrv-btn primary', onClick: () => void start(), disabled: busy }, busy ? t.starting : t.start),
            note === '' ? null : h('div', { className: 'rrv-notice' }, note),
          )

      return h(
        'div',
        { className: 'rrv-root' },
        h(Styles),
        toolbar,
        running && note !== ''
          ? h('div', { className: 'rrv-notice', style: { padding: '6px 12px' } }, note)
          : null,
        body,
      )
    }

    /** 输入框下面那一排：正常对话视图里只出现简历本身（缩小预览）+ 状态 + 动作。 */
    function ResumeDock() {
      const t = text()
      const bridge = useBridge(6000)
      const [resumeId, setResumeId] = useState('')
      const [busy, setBusy] = useState(false)
      const [draft, setDraft] = useState('')
      const [note, setNote] = useState('')

      const data = bridge.data
      const status = data?.status
      const resumes = data?.resumes ?? []
      const sessions = data?.sessions ?? []
      const appUrl = data?.config?.appUrl ?? DEFAULT_APP_URL
      const running = status?.running === true

      useEffect(() => {
        if (resumeId === '' && resumes.length > 0) setResumeId(resumes[0].id)
      }, [resumes, resumeId])

      const start = useCallback(async () => {
        setBusy(true)
        try {
          const result = await callService('start')
          setNote(result.ok ? '' : `启动失败：${result.detail ?? result.state ?? '接口无响应（桥没挂上？）'}`)
        } catch (error) {
          setNote(`启动失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy(false)
          void bridge.refresh()
        }
      }, [bridge])

      const send = useCallback(async () => {
        const body = draft.trim()
        if (body === '') return
        setBusy(true)
        try {
          const result = await askAgent(sessions[0]?.id ?? '', body)
          if (result.ok) {
            setDraft('')
            setNote(t.sent)
          } else {
            setNote(`发送失败：${result.reason}`)
          }
        } finally {
          setBusy(false)
        }
      }, [draft, sessions, t.sent])

      const src = resumeId === '' ? appUrl : `${appUrl}/builder/${resumeId}`
      const current = resumes.find((resume) => resume.id === resumeId)

      return h(
        'div',
        { className: 'rrv-dock', title: t.stripTitle },
        h(Styles),
        running && resumeId !== ''
          ? h(
              'a',
              { className: 'rrv-thumb', href: src, target: '_blank', rel: 'noopener', title: t.editor },
              h('iframe', { className: 'rrv-frame', src, title: 'resume preview', scrolling: 'no' }),
              h('span', { className: 'rrv-thumb-hint' }, t.editor),
            )
          : h('span', { className: 'rrv-dock-glyph' }, h(DocGlyph)),
        h(
          'div',
          { className: 'rrv-dock-text' },
          h(
            'div',
            { className: 'rrv-dock-title' },
            h('span', { className: `rrv-dot ${busy ? 'busy' : running ? 'on' : 'off'}` }),
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, current?.name ?? t.stripTitle),
          ),
          h(
            'div',
            { className: 'rrv-dock-sub' },
            note !== ''
              ? note
              : bridge.error
                ? `${t.bridgeDown}：${bridge.error}`
                : running
                  ? `${t.running}${current?.updatedAt ? ` · ${current.updatedAt.slice(0, 10)}` : ''}`
                  : t.noService,
          ),
        ),
        h(
          'div',
          { className: 'rrv-dock-actions' },
          running && resumes.length > 1 ? h(ResumePicker, { resumes, value: resumeId, onChange: setResumeId }) : null,
          running
            ? h('a', { className: 'rrv-btn', href: src, target: '_blank', rel: 'noopener' }, t.open)
            : h(
                'button',
                { className: 'rrv-btn primary', onClick: () => void start(), disabled: busy, type: 'button' },
                busy ? t.starting : t.start,
              ),
          running
            ? h('input', {
                className: 'rrv-input',
                value: draft,
                placeholder: t.askPlaceholder,
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                },
              })
            : null,
          running
            ? h('button', { className: 'rrv-btn', onClick: () => void send(), disabled: draft.trim() === '', type: 'button' }, t.send)
            : null,
        ),
      )
    }

    // ---------------------------------------------------------------- 本地数据面（直连 Postgres）
    // 面板不依赖应用前端，也不依赖它的 MCP：`resume.data` 就是整份文档。

    /** 15 个模板（与 Reactive Resume 同名）。 */
    const TEMPLATES = [
      'azurill', 'bronzor', 'chikorita', 'ditgar', 'ditto', 'gengar', 'glalie', 'kakuna', 'lapras',
      'leafish', 'meowth', 'onyx', 'pikachu', 'rhyhorn', 'scizor',
    ]

    /** 简历的 12 个栏目种类（顺序即默认排版顺序）。 */
    const SECTION_KINDS = [
      'summary', 'profiles', 'experience', 'education', 'projects', 'skills',
      'languages', 'interests', 'awards', 'certifications', 'publications', 'volunteer', 'references',
    ]

    /** 默认放侧栏的栏目（与宿主 render/manifests 的约定一致）。 */
    const SIDE_KINDS = ['skills', 'languages', 'interests', 'certifications', 'profiles', 'awards']

    /** 栏目中文名（拖拽面板里显示）。 */
    const SECTION_LABEL = {
      summary: '个人简介', profiles: '联系方式', experience: '工作经历', education: '教育经历',
      projects: '项目', skills: '技能', languages: '语言', interests: '兴趣', awards: '荣誉',
      certifications: '证书', publications: '发表', volunteer: '志愿经历', references: '推荐',
    }

    /**
     * 快捷样式：这些是最常被要求"小改一下"的属性。
     * 点一下就把**准确的字段路径**填进输入框，agent 不用猜是哪个键。
     */
    const QUICK_STYLES = [
      ['圆角', '把照片圆角改成 12%（/picture/borderRadius）'],
      ['字号', '正文字号加到 10.5（/metadata/typography/body/fontSize）'],
      ['行高', '行高收紧到 1.32（/metadata/typography/body/lineHeight）'],
      ['主色', '主色换成深一点的蓝（/metadata/theme/primary）'],
      ['页边距', '页边距收到 18 / 20mm（/metadata/page/marginX、marginY）'],
      ['栏宽', '侧栏宽度调到 34%（/metadata/layout/sidebarWidth）'],
    ]

    /** 常用排版语言。 */
    const LOCALES = [
      ['zh-CN', '中文（简体）'],
      ['zh-TW', '中文（繁體）'],
      ['en-US', 'English'],
      ['de-DE', 'Deutsch'],
      ['fr-FR', 'Français'],
      ['es-ES', 'Español'],
      ['ja-JP', '日本語'],
      ['pt-BR', 'Português'],
    ]

    /** GET 一个本地数据端点。 */
    async function localGet(path) {
      const response = await fetch(`${BRIDGE}/${path}`, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    }

    /** POST 一个本地数据端点。 */
    async function localPost(path, body) {
      const response = await fetch(`${BRIDGE}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    }

    /** POST 一个返回 HTML 的端点（渲染）。 */
    async function localHtml(path, body) {
      const response = await fetch(`${BRIDGE}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.text()
    }

    /** 左侧栏的入口图标。
     *
     * 外壳的 `panelRow` 本身就是按钮（负责 selectPanel + 显示 label），
     * 这里只提供 glyph，不再嵌套一个 button（嵌套 button 是非法 HTML）。
     */
    function ResumePanelIcon() {
      return h('span', { style: { display: 'inline-flex', alignItems: 'center' } }, h(DocGlyph))
    }

    /** 应用上下文（apply 时记下，供图标点击用）。 */
    let ctxRef = null

    /**
     * 「简历」整页编辑器（主面板）。
     *
     * 形态：左列表 / 中间表单 / 右侧预览位（自研渲染在 M3 落地）。
     * 数据全走 `api/resume-bridge/local/*`，不需要登录、不需要 API key。
     */
    function ResumeEditor() {
      const t = text()
      const [rows, setRows] = useState([])
      const [selected, setSelected] = useState('')
      const [doc, setDoc] = useState(null)
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')
      const [previewHtml, setPreviewHtml] = useState('')
      const [previewError, setPreviewError] = useState('')
      const [quotes, setQuotes] = useState([])
      const [textQuote, setTextQuote] = useState(null)
      const [dragBox, setDragBox] = useState(null)
      const [quoteText, setQuoteText] = useState('')
      const frameRef = React.useRef(null)
      // 栏宽（可拖）+ 预览自适应比例 + 模板画廊
      const [listW, setListW] = useState(228)
      const [formW, setFormW] = useState(400)
      const [scale, setScale] = useState(0.5)
      const [showTemplates, setShowTemplates] = useState(false)
      const [thumbs, setThumbs] = useState({})
      const [customTemplates, setCustomTemplates] = useState([])
      const [building, setBuilding] = useState(null)
      const [buildNote, setBuildNote] = useState('')
      const [askH, setAskH] = useState(132)
      const [expanded, setExpanded] = useState(false)
      const [pageIndex, setPageIndex] = useState(0)
      const bigFrameRef = React.useRef(null)
      const sheetBoxRef = React.useRef(null)
      const dragRef = React.useRef(null)
      // 只读一次会话列表：用来告诉用户"这条请求会投到哪个会话"
      const bridge = useBridge(0)
      const targetSession = (bridge.data?.sessions ?? [])[0]?.title ?? ''

      /** 纵向拖拽：调引用输入区的高度。 */
      const startAskDrag = useCallback((event) => {
        event.preventDefault()
        const startY = event.clientY
        let startH = askH
        setAskH((height) => {
          startH = height
          return height
        })
        const move = (moveEvent) => {
          const next = Math.max(88, Math.min(420, startH + (startY - moveEvent.clientY)))
          setAskH(next)
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }, [askH])

      const loadList = useCallback(async () => {
        setBusy(true)
        try {
          const listed = await localGet('local/list')
          if (listed.error) setNote(`读列表失败：${listed.error}`)
          else {
            setRows(listed.resumes ?? [])
            setNote('')
            if (selected === '' && (listed.resumes ?? []).length > 0) setSelected(listed.resumes[0].id)
          }
        } catch (error) {
          setNote(`读列表失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy(false)
        }
      }, [selected])

      useEffect(() => {
        void loadList()
        // 只在挂载时读一次列表
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      useEffect(() => {
        if (selected === '') return
        let cancelled = false
        setBusy(true)
        localGet(`local/get?id=${encodeURIComponent(selected)}`)
          .then((resume) => {
            if (cancelled) return
            if (resume.error) setNote(`读取失败：${resume.error}`)
            else {
              setDoc(resume.data)
              setNote('')
            }
          })
          .catch((error) => {
            if (!cancelled) setNote(`读取失败：${error instanceof Error ? error.message : String(error)}`)
          })
          .finally(() => {
            if (!cancelled) setBusy(false)
          })
        return () => {
          cancelled = true
        }
      }, [selected])

      /** 改名（顶层 name 列，不在 data 里）。 */
      const setField = useCallback((path, value) => {
        setDoc((previous) => {
          if (previous === null) return previous
          const next = { ...previous }
          const keys = path.split('.')
          let cursor = next
          for (let index = 0; index < keys.length - 1; index += 1) {
            const key = keys[index]
            cursor[key] = { ...(cursor[key] ?? {}) }
            cursor = cursor[key]
          }
          // 原来存的是对象（如 website: {url,label}）时，把输入框里的字符串写回它
          // 该有的那个键，而不是把整个对象替换成字符串。
          const key = keys[keys.length - 1]
          const before = cursor[key]
          if (before !== null && typeof before === 'object' && !Array.isArray(before)) {
            const slot = 'url' in before ? 'url' : 'name' in before ? 'name' : 'value' in before ? 'value' : 'url'
            cursor[key] = { ...before, [slot]: value }
          } else {
            cursor[key] = value
          }
          return next
        })
      }, [])

      const basics = doc?.basics ?? {}
      const meta = doc?.metadata ?? {}
      const page = meta.page ?? {}
      const theme = meta.theme ?? {}
      const typography = meta.typography ?? {}

      /** 保存：只发白名单字段（basics / summary / metadata）。 */
      const save = useCallback(async () => {
        if (doc === null || selected === '') return
        setBusy(true)
        setNote(t.saving)
        try {
          const result = await localPost('local/update', {
            id: selected,
            partial: { basics: doc.basics, summary: doc.summary, metadata: doc.metadata, picture: doc.picture },
          })
          if (result.error) setNote(`保存失败：${result.error}`)
          else {
            setNote(result.backup ? `${t.saved}（备份 ${result.backup.split('\\').pop()}）` : t.saved)
            void loadList()
          }
        } catch (error) {
          setNote(`保存失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy(false)
        }
      }, [doc, selected, t.saving, t.saved, loadList])

      /** 一键导出到对话：交给 agent 用 resume_export 落地 PDF 并回路径。 */
      const exportToChat = useCallback(async () => {
        if (selected === '') return
        const current = rows.find((row) => row.id === selected)
        const message = [
          `把简历「${current?.name ?? selected}」（id: ${selected}）导出成 PDF：`,
          `- 目标目录 04-输出\\${current?.name ?? '未命名'}\\`,
          '- 用 resume_export，导出后把绝对路径回给我，并在对话里挂上文件卡片',
        ].join('\n')
        setBusy(true)
        try {
          const result = await askAgent('', message)
          setNote(result.ok ? t.sent : `发送失败：${result.reason}`)
        } catch (error) {
          setNote(`发送失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy(false)
        }
      }, [rows, selected, t.sent])

      const field = (label, path, value, placeholder) =>
        h(
          'label',
          { className: 'rrv-field' },
          h('span', { className: 'rrv-field-label' }, label),
          h('input', {
            className: 'rrv-field-input',
            value: scalar(value),
            placeholder: placeholder ?? '',
            onChange: (event) => setField(path, event.target.value),
          }),
        )

      /** 滑杆字段：值直接写回文档路径，拖动即时生效。 */
      const rangeField = (label, path, value, min, max, step) =>
        h(
          'label',
          { className: 'rrv-field' },
          h('span', { className: 'rrv-field-label' }, label),
          h('span', { className: 'rrv-range' },
            h('input', {
              type: 'range',
              className: 'rrv-range-input',
              min: String(min),
              max: String(max),
              step: String(step),
              value: Number.isFinite(value) ? value : min,
              onChange: (event) => setField(path, Number(event.target.value)),
            }),
            h('span', { className: 'rrv-range-value' }, String(Number.isFinite(value) ? value : min)),
          ),
        )
      // ---------------------------------------------------------------- 排版（分页 + 拖拽）
      // 声明顺序很重要：layoutPages / activePage / setLayout 必须排在所有 useCallback
      // 之前 —— useCallback 的依赖数组是**立即求值**的，写在后面就是 TDZ
      // （ReferenceError: Cannot access 'layoutPages' before initialization）。

      /** 当前排版模型；缺省就用一页、主栏放全部可见栏目。 */
      const layoutPages =
        Array.isArray(doc?.metadata?.layout?.pages) && doc.metadata.layout.pages.length > 0
          ? doc.metadata.layout.pages
          : [{ main: SECTION_KINDS.slice(), sidebar: [] }]
      const activePage = Math.min(pageIndex, layoutPages.length - 1)

      /** 写回排版（数组整体替换）。 */
      const setLayout = useCallback(
        (pages) => {
          setField('metadata.layout.pages', pages)
        },
        [setField],
      )

      /** 从拖拽事件里读出被拖的栏目。 */
      const readDragPayload = (event) => {
        try {
          const parsed = JSON.parse(event.dataTransfer.getData('text/plain') || 'null')
          if (parsed === null || typeof parsed.kind !== 'string') return null
          return { page: Number(parsed.page ?? 0), col: String(parsed.col ?? 'main'), kind: parsed.kind, index: parsed.index }
        } catch {
          return null
        }
      }

      /** 加一页：把当前页的一半栏目带过去，省得再拖一遍。 */
      const addPage = useCallback(() => {
        const pages = layoutPages.map((page) => ({ main: [...(page.main ?? [])], sidebar: [...(page.sidebar ?? [])] }))
        const last = pages[pages.length - 1]
        const moved = last.main.splice(Math.ceil(last.main.length / 2))
        pages.push({ main: moved, sidebar: [] })
        setLayout(pages)
        setPageIndex(pages.length - 1)
      }, [layoutPages, setLayout])

      /** 删掉当前页：栏目并回上一页，不丢内容。 */
      const removePage = useCallback(() => {
        if (layoutPages.length <= 1) return
        const pages = layoutPages.map((page) => ({ main: [...(page.main ?? [])], sidebar: [...(page.sidebar ?? [])] }))
        const removed = pages.splice(activePage, 1)[0]
        const target = pages[Math.max(0, activePage - 1)]
        target.main.push(...removed.main)
        target.sidebar.push(...removed.sidebar)
        setLayout(pages)
        setPageIndex(Math.max(0, activePage - 1))
      }, [activePage, layoutPages, setLayout])


      /** 把一个栏目移到目标页/目标栏（可指定插入位置）。 */
      const moveSection = useCallback(
        (from, to) => {
          const pages = layoutPages.map((page) => ({ main: [...(page.main ?? [])], sidebar: [...(page.sidebar ?? [])] }))
          const source = pages[from.page]?.[from.col]
          if (source === undefined) return
          const index = source.indexOf(from.kind)
          if (index >= 0) source.splice(index, 1)
          // 同一栏目可能同时存在于另一栏，先清掉
          for (const page of pages) {
            page.main = page.main.filter((kind) => kind !== from.kind)
            page.sidebar = page.sidebar.filter((kind) => kind !== from.kind)
          }
          const target = pages[to.page]?.[to.col]
          if (target === undefined) return
          const at = typeof to.index === 'number' ? Math.max(0, Math.min(target.length, to.index)) : target.length
          target.splice(at, 0, from.kind)
          setLayout(pages)
        },
        [layoutPages, setField, setLayout],
      )

      // ---------------------------------------------------------------- 自由排版（画布拖动）
      const PX_PER_MM = 1.15
      const freeBoxes = (doc?.metadata?.layout?.free ?? null)
      const freeMode = freeBoxes !== null && typeof freeBoxes === 'object' && Object.keys(freeBoxes).length > 0

      /**
       * 自动排版：按条目数估算每个块的高度，主栏一列、侧栏一列，块之间留 4mm。
       *
       * 之前的"每块固定 42mm 向下堆"是这次重叠的根因：条目多的块（经历、项目）
       * 实际高度远超 42mm，于是压到下一块身上。
       */
      const autoLayout = useCallback(() => {
        const items = (kind) => (doc?.sections?.[kind]?.items ?? []).length
        // 高度估算（mm）：标题 8 + 每条 6.5（摘要按 26 起）；写进 h 后渲染器会裁切，杜绝互相压字
        const heightOf = (kind) => Math.round(8 + (kind === 'summary' ? 26 : Math.max(1, items(kind)) * 6.5))
        const sideKinds = SIDE_KINDS.filter((kind) => items(kind) > 0)
        const mainKinds = SECTION_KINDS.filter((kind) => items(kind) > 0 && !SIDE_KINDS.includes(kind))
        const boxes = {}
        let y = 0
        for (const kind of mainKinds) {
          const h = heightOf(kind)
          boxes[kind] = { x: 0, y, w: sideKinds.length > 0 ? 116 : 170, h }
          y += h + 4
        }
        y = 0
        for (const kind of sideKinds) {
          const h = heightOf(kind)
          boxes[kind] = { x: sideKinds.length > 0 ? 120 : 0, y, w: 86, h }
          y += h + 4
        }
        setField('metadata.layout.free', boxes)
      }, [doc, setField])

      /** 开关自由排版。 */
      const toggleFree = useCallback(() => {
        if (freeMode) {
          setField('metadata.layout.free', null)
          return
        }
        autoLayout()
      }, [autoLayout, freeMode, setField])

      /**
       * 拖动一个块：拖动期间只改本地视觉状态（`dragBox`），**松手才写回**。
       *
       * 之前每个 pointermove 都 setField → 每次触发整份文档重算 + 预览重渲染，
       * 拖两下就卡死。现在移动是纯本地渲染，落点吸附 2mm，抬手提交一次。
       */
      const startBlockDrag = useCallback(
        (kind) => (event) => {
          event.preventDefault()
          const box = freeBoxes?.[kind] ?? { x: 0, y: 0, w: 170 }
          const startX = event.clientX
          const startY = event.clientY
          const origin = { x: Number(box.x ?? 0), y: Number(box.y ?? 0) }
          const snap = (value) => Math.max(0, Math.min(280, Math.round(value / 2) * 2))
          let latest = { x: origin.x, y: origin.y }
          setDragBox({ kind, x: origin.x, y: origin.y })
          const move = (moveEvent) => {
            latest = {
              x: snap(origin.x + (moveEvent.clientX - startX) / PX_PER_MM),
              y: snap(origin.y + (moveEvent.clientY - startY) / PX_PER_MM),
            }
            setDragBox({ kind, ...latest })
          }
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            setDragBox(null)
            setField('metadata.layout.free', { ...(freeBoxes ?? {}), [kind]: { ...box, x: latest.x, y: latest.y } })
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        },
        [freeBoxes, setField],
      )

      /** 改变某块宽度（mm）。 */
      const resizeBlock = useCallback(
        (kind, width) => {
          const box = freeBoxes?.[kind] ?? { x: 0, y: 0 }
          setField('metadata.layout.free', {
            ...(freeBoxes ?? {}),
            [kind]: { ...box, w: Math.max(40, Math.min(200, Number(width) || 170)) },
          })
        },
        [freeBoxes, setField],
      )

      /** 自由排版的迷你画布（按 1.15 px/mm 缩放，拖它是改 mm 坐标）。 */
      const freeCanvas = () =>
        h(
          'div',
          { className: 'rrv-free-wrap' },
          h('div', { className: 'rrv-free-canvas', style: { width: `${210 * PX_PER_MM}px`, height: `${297 * PX_PER_MM}px` } },
            Object.entries(freeBoxes ?? {}).map(([kind, rawBox]) => {
              const box = dragBox !== null && dragBox.kind === kind ? { ...rawBox, x: dragBox.x, y: dragBox.y } : rawBox
              return h(
                'div',
                {
                  key: kind,
                  className: `rrv-free-blk${dragBox !== null && dragBox.kind === kind ? ' dragging' : ''}`,
                  style: {
                    left: `${Number(box?.x ?? 0) * PX_PER_MM}px`,
                    top: `${Number(box?.y ?? 0) * PX_PER_MM}px`,
                    width: `${Number(box?.w ?? 170) * PX_PER_MM}px`,
                    height: `${Number(box?.h ?? 40) * PX_PER_MM}px`,
                  },
                  onPointerDown: startBlockDrag(kind),
                  title: `${SECTION_LABEL[kind] ?? kind} — ${Number(box?.x ?? 0)},${Number(box?.y ?? 0)}mm`,
                },
                h('span', { className: 'rrv-free-name' }, SECTION_LABEL[kind] ?? kind),
              )
            }),
          ),
          h(
            'div',
            { className: 'rrv-free-side' },
            h('div', { className: 'rrv-ed-hint' }, t.freeHint),
            Object.keys(freeBoxes ?? {}).filter((kind) => SECTION_KINDS.includes(kind)).map((kind) =>
              h(
                'label',
                { key: `w-${kind}`, className: 'rrv-free-w' },
                h('span', null, SECTION_LABEL[kind] ?? kind),
                h('input', {
                  type: 'range',
                  min: '40',
                  max: '200',
                  value: Number(freeBoxes?.[kind]?.w ?? 170),
                  onChange: (event) => resizeBlock(kind, event.target.value),
                }),
              ),
            ),
          ),
        )
      /** 一栏：可拖入 + 内部可拖排序。 */      const layoutColumn = (column, label) =>
        h(
          'div',
          {
            className: `rrv-lay-col${column === 'sidebar' ? ' side' : ''}`,
            onDragOver: (event) => event.preventDefault(),
            onDrop: (event) => {
              event.preventDefault()
              const payload = readDragPayload(event)
              if (payload === null) return
              moveSection(payload, { page: activePage, col: column })
            },
          },
          h('div', { className: 'rrv-lay-col-head' }, label),
          (layoutPages[activePage]?.[column] ?? []).map((kind, index) =>
            h(
              'div',
              {
                key: `${column}-${kind}`,
                className: 'rrv-lay-chip',
                draggable: true,
                onDragStart: (event) => {
                  event.dataTransfer.setData(
                    'text/plain',
                    JSON.stringify({ page: activePage, col: column, kind, index }),
                  )
                  event.dataTransfer.effectAllowed = 'move'
                },
                onDragOver: (event) => event.preventDefault(),
                onDrop: (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  const payload = readDragPayload(event)
                  if (payload === null) return
                  moveSection(payload, { page: activePage, col: column, index })
                },
              },
              h('span', { className: 'rrv-lay-grip' }, '⋮⋮'),
              h('span', { className: 'rrv-lay-name' }, SECTION_LABEL[kind] ?? kind),
            ),
          ),
          (layoutPages[activePage]?.[column] ?? []).length === 0
            ? h('div', { className: 'rrv-ed-hint' }, t.dropHere)
            : null,
        )

      const list = h(
        'aside',
        { className: 'rrv-ed-list' },
        h(
          'div',
          { className: 'rrv-ed-list-head' },
          h('span', null, t.resumeList),
          h('button', { className: 'rrv-btn', type: 'button', onClick: () => void loadList(), disabled: busy }, '⟳'),
        ),
        rows.length === 0
          ? h('div', { className: 'rrv-ed-empty' }, busy ? t.loading : t.empty)
          : rows.map((row) =>
              h(
                'button',
                {
                  key: row.id,
                  type: 'button',
                  className: `rrv-ed-item${row.id === selected ? ' active' : ''}`,
                  onClick: () => setSelected(row.id),
                },
                h('span', { className: 'rrv-ed-item-name' }, row.name),
                h('span', { className: 'rrv-ed-item-sub' }, `${row.template || '-'} · ${row.locale || '-'}`),
              ),
            ),
      )

      const form =
        doc === null
          ? h('div', { className: 'rrv-ed-empty' }, busy ? t.loading : t.pickOne)
          : h(
              'div',
              { className: 'rrv-ed-form' },
              h('div', { className: 'rrv-ed-group' }, h('div', { className: 'rrv-ed-title' }, t.basics),
                field(t.nameLabel, 'basics.name', basics.name),
                field(t.headline, 'basics.headline', basics.headline),
                field('Email', 'basics.email', basics.email),
                field(t.phone, 'basics.phone', basics.phone),
                field(t.location, 'basics.location', basics.location),
                field(t.website, 'basics.website', basics.website),
              ),
              h('div', { className: 'rrv-ed-group' },
                h('div', { className: 'rrv-ed-title' }, t.photo),
                h('div', { className: 'rrv-ed-photo' },
                  doc.picture?.url
                    ? h('img', { className: 'rrv-ed-avatar', src: doc.picture.url, alt: '' })
                    : h('span', { className: 'rrv-ed-avatar empty' }, h(DocGlyph)),
                  h('div', { className: 'rrv-ed-photo-ctl' },
                    h('label', { className: 'rrv-btn' },
                      t.uploadPhoto,
                      h('input', {
                        type: 'file',
                        accept: 'image/png,image/jpeg,image/webp',
                        style: { display: 'none' },
                        onChange: (event) => {
                          const file = event.target.files?.[0]
                          if (!file) return
                          const reader = new FileReader()
                          reader.onload = () => {
                            setField('picture.url', String(reader.result ?? ''))
                            setField('picture.hidden', false)
                          }
                          reader.readAsDataURL(file)
                        },
                      }),
                    ),
                    h('button', {
                      className: 'rrv-btn',
                      type: 'button',
                      onClick: () => setField('picture.hidden', doc.picture?.hidden !== true),
                    }, doc.picture?.hidden === true ? t.showPhoto : t.hidePhoto),
                    h('button', {
                      className: 'rrv-btn',
                      type: 'button',
                      onClick: () => setField('picture.url', ''),
                    }, t.removePhoto),
                  ),
                ),
                h('label', { className: 'rrv-field' },
                  h('span', { className: 'rrv-field-label' }, t.photoSize),
                  h('input', {
                    className: 'rrv-field-input',
                    type: 'range',
                    min: '40',
                    max: '140',
                    value: Number(doc.picture?.size ?? 84),
                    onChange: (event) => setField('picture.size', Number(event.target.value)),
                  }),
                ),
                h('label', { className: 'rrv-field' },
                  h('span', { className: 'rrv-field-label' }, t.photoShape),
                  h('button', {
                    className: 'rrv-btn',
                    type: 'button',
                    onClick: () => setField('picture.borderRadius', doc.picture?.borderRadius === 50 ? 0 : 50),
                  }, doc.picture?.borderRadius === 50 ? t.circle : t.square),
                ),
              ),
              h('div', { className: 'rrv-ed-group' }, h('div', { className: 'rrv-ed-title' }, t.summary),
                h('textarea', {
                  className: 'rrv-field-input rrv-field-area',
                  value: doc.summary?.content ?? '',
                  rows: 5,
                  onChange: (event) => setField('summary.content', event.target.value),
                }),
              ),
              h('div', { className: 'rrv-ed-group' },
                h('div', { className: 'rrv-ed-title' }, t.layout),
                h(
                  'div',
                  { className: 'rrv-lay-pages' },
                  layoutPages.map((page, index) =>
                    h(
                      'button',
                      {
                        key: `page-${index}`,
                        type: 'button',
                        className: `rrv-btn${index === activePage ? ' primary' : ''}`,
                        onClick: () => setActivePage(index),
                      },
                      `${t.pageLabel} ${index + 1}`,
                    ),
                  ),
                  h('button', { className: 'rrv-btn', type: 'button', onClick: () => addPage() }, '＋'),
                  layoutPages.length > 1
                    ? h('button', { className: 'rrv-btn', type: 'button', onClick: () => removePage() }, '－')
                    : null,
                ),
                h(
                  'div',
                  { className: 'rrv-lay-cols' },
                  layoutColumn('main', t.mainCol),
                  layoutColumn('sidebar', t.sideCol),
                ),
                h('div', { className: 'rrv-ed-hint' }, t.dragSectionHint),
              ),
              h('div', { className: 'rrv-ed-group' }, h('div', { className: 'rrv-ed-title' }, t.style),
                h('label', { className: 'rrv-field' },
                  h('span', { className: 'rrv-field-label' }, t.template),
                  h('select', {
                    className: 'rrv-field-input',
                    value: meta.template ?? '',
                    onChange: (event) => setField('metadata.template', event.target.value),
                  }, TEMPLATES.map((name) => h('option', { key: name, value: name }, name))),
                ),
                h('label', { className: 'rrv-field' },
                  h('span', { className: 'rrv-field-label' }, t.language),
                  h('select', {
                    className: 'rrv-field-input',
                    value: page.locale ?? 'zh-CN',
                    onChange: (event) => setField('metadata.page.locale', event.target.value),
                  }, LOCALES.map(([value, label]) => h('option', { key: value, value }, label))),
                ),
                h('label', { className: 'rrv-field' },
                  h('span', { className: 'rrv-field-label' }, t.primary),
                  h('input', {
                    className: 'rrv-field-input',
                    type: 'color',
                    value: toHex(theme.primary),
                    onChange: (event) => setField('metadata.theme.primary', hexToRgba(event.target.value)),
                  }),
                ),
                h('label', { className: 'rrv-field' },
                  h('span', { className: 'rrv-field-label' }, t.fontSize),
                  h('input', {
                    className: 'rrv-field-input',
                    type: 'number',
                    step: '0.5',
                    min: '6',
                    max: '14',
                    value: typography.body?.fontSize ?? 10,
                    onChange: (event) => setField('metadata.typography.body.fontSize', Number(event.target.value)),
                  }),
                ),
                // 这几个"自由度"用滑杆直连文档字段：拖一下预览就变，不需要发给 agent
                rangeField(t.lineHeightLabel, 'metadata.typography.body.lineHeight', Number(typography.body?.lineHeight ?? 1.4), 1, 2, 0.02),
                rangeField('照片圆角', 'picture.borderRadius', Number(doc.picture?.borderRadius ?? 0), 0, 50, 1),
                rangeField(t.marginX, 'metadata.page.marginX', Number(page.marginX ?? 22), 8, 34, 1),
                rangeField(t.marginY, 'metadata.page.marginY', Number(page.marginY ?? 18), 8, 30, 1),
                rangeField(t.sidebarWidth, 'metadata.layout.sidebarWidth', Number(meta.layout?.sidebarWidth ?? 32), 18, 48, 1),
              ),
            )

      /**
       * 预览：把当前草稿（含未保存改动）渲染成 HTML。
       * 走宿主 `local/render`，与导出共用同一份排版，避免"预览好看、导出翻车"。
       */
      useEffect(() => {
        if (doc === null) {
          setPreviewHtml('')
          return
        }
        let cancelled = false
        const timer = setTimeout(() => {
          localHtml('local/render', { doc, locale: doc?.metadata?.page?.locale })
            .then((html) => {
              if (!cancelled && typeof html === 'string') {
                setPreviewHtml(html)
                setPreviewError('')
              }
            })
            .catch((error) => {
              if (!cancelled) setPreviewError(error instanceof Error ? error.message : String(error))
            })
        }, 250)
        return () => {
          cancelled = true
          clearTimeout(timer)
        }
      }, [doc])

      /**
       * 给预览 iframe 里的块挂上"引用"手势。
       *
       * srcDoc iframe 与父页面同源，所以这里能直接读它的 DOM —— 这也是为什么
       * 选中信息用 `data-path`（渲染器写进去的 JSON Pointer）而不是坐标。
       * 双击 / 右键 = 把这一块加入对话引用。
       */
      const attachQuoteHandlers = useCallback((frame) => {
        const inner = frame?.contentDocument
        if (!inner) return
        const add = (element) => {
          const path = element?.dataset?.path
          if (!path) return
          const label = element.dataset.label || path
          setQuotes((list) => (list.some((item) => item.path === path) ? list : [...list, { path, label }]))
        }
        inner.querySelectorAll('[data-path]').forEach((element) => {
          element.style.cursor = 'context-menu'
          element.addEventListener('dblclick', () => add(element))
          element.addEventListener('contextmenu', (event) => {
            event.preventDefault()
            add(element)
          })
        })

        // 文字级选区：拖选或双击一个词，把「这个词 + 它属于哪个块」一起引用。
        // 块级引用只能表达"改这一整块"，改一个词、改一个数字就要用到这一层。
        const readSelection = () => {
          const selection = inner.getSelection()
          if (!selection || selection.isCollapsed) return
          const text = String(selection.toString() || '').replace(/\s+/g, ' ').trim()
          if (text === '' || text.length > 160) return
          const anchor = selection.anchorNode
          const element = anchor?.nodeType === 1 ? anchor : anchor?.parentElement
          const host = element?.closest?.('[data-path]')
          setTextQuote({
            text,
            path: host?.dataset?.path ?? '',
            label: host?.dataset?.label ?? '',
          })
        }
        inner.addEventListener('mouseup', () => setTimeout(readSelection, 0))
        inner.addEventListener('dblclick', () => setTimeout(readSelection, 0))
      }, [])

      /** 把引用 + 诉求发给 agent，然后切回对话去看结果。 */
      const sendQuoted = useCallback(async () => {
        if (quotes.length === 0 && textQuote === null && quoteText.trim() === '') return
        const current = rows.find((row) => row.id === selected)
        const message = [
          `简历：${current?.name ?? selected}（id: ${selected}）`,
          '引用块：',
          ...quotes.map((quote) => `- ${quote.label} → ${quote.path}`),
          ...(textQuote === null
            ? []
            : ['引用文本：', `- 「${textQuote.text}」→ ${textQuote.path || '（块内文本）'}${textQuote.label ? `（${textQuote.label}）` : ''}`]),
          '',
          quoteText.trim() === '' ? '把这几块改好一点（排版与措辞）。' : quoteText.trim(),
        ].join('\n')
        setBusy(true)
        try {
          const result = await askAgent('', message)
          if (result.ok === true) {
            setQuotes([])
            setTextQuote(null)
            setQuoteText('')
            setNote(t.sent)
            try {
              ctxRef?.get?.('layout')?.selectPanel?.('conversation')
            } catch {
              /* 切不过去也不影响消息已发出 */
            }
          } else {
            setNote(`发送失败：${result.reason}`)
          }
        } finally {
          setBusy(false)
        }
      }, [quotes, textQuote, quoteText, rows, selected, t.sent])

      /** 导出 PDF：宿主打印成文件；没有 Electron 时退回浏览器打印（排版一致）。 */
      const exportPdf = useCallback(async () => {
        if (selected === '') return
        setBusy(true)
        setNote(t.exporting)
        try {
          const result = await localPost('local/export', { id: selected })
          if (result.ok === true) {
            setNote(`${t.exportedTo}：${result.path}`)
            try {
              await navigator.clipboard.writeText(result.path)
            } catch {
              /* 复制失败不影响导出 */
            }
          } else if (result.needsPrint === true && typeof result.html === 'string') {
            const win = window.open('', '_blank', 'noopener')
            if (win !== null) {
              win.document.write(result.html)
              win.document.close()
              win.setTimeout(() => win.print(), 400)
            }
            setNote(t.printFallback)
          } else {
            setNote(`导出失败：${result.error ?? result.reason ?? '未知原因'}`)
          }
        } catch (error) {
          setNote(`导出失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy(false)
        }
      }, [selected, t.exporting, t.exportedTo, t.printFallback])

      /**
       * 预览自适应：A4 宽度 794px，按容器宽度等比缩放，永远不裁边。
       * 用 ResizeObserver 而不是 window.resize —— 拖栏宽时也要跟着变。
       */
      useEffect(() => {
        const box = sheetBoxRef.current
        if (box === null || typeof ResizeObserver !== 'function') return undefined
        const observer = new ResizeObserver((entries) => {
          const width = entries[0]?.contentRect?.width ?? 0
          if (width > 0) setScale(Math.max(0.15, Math.min(1.6, width / 794)))
        })
        observer.observe(box)
        return () => observer.disconnect()
      }, [previewHtml])

      /** 拖栏宽：指针按下后按水平位移改宽度，松开解绑。 */
      const startDrag = useCallback((which) => (event) => {
        event.preventDefault()
        dragRef.current = { which, x: event.clientX }
        const move = (moveEvent) => {
          const current = dragRef.current
          if (current === null) return
          const delta = moveEvent.clientX - current.x
          dragRef.current = { which: current.which, x: moveEvent.clientX }
          if (current.which === 'list') setListW((width) => Math.max(160, Math.min(360, width + delta)))
          if (current.which === 'form') setFormW((width) => Math.max(280, Math.min(560, width - delta)))
        }
        const up = () => {
          dragRef.current = null
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }, [])

      /** 打开画廊时读一次自定义模板；制作中每 3 秒看有没有新模板落盘。 */
      useEffect(() => {
        if (!showTemplates) return undefined
        let cancelled = false
        const tick = async () => {
          try {
            const listed = await localGet('local/templates')
            if (cancelled) return
            const custom = listed.templates ?? []
            setCustomTemplates(custom)
            if (building !== null) {
              const known = new Set(building.known)
              const fresh = custom.find((row) => !known.has(row.id))
              if (fresh !== undefined) {
                setBuilding(null)
                setBuildNote(`${t.templateReady}：${fresh.id}`)
              }
            }
          } catch {
            /* 读不到就跳过这一轮 */
          }
        }
        void tick()
        const timer = setInterval(tick, 3000)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [showTemplates, building, t.templateReady])

      /**
       * 上传参考图 → 让 agent 按图做一个新模板。
       *
       * 这条路径刻意只放在「模板」入口里：它表达的是"注册一个新模板"，
       * 和日常改简历的对话分开，语义更干净。
       */
      const createTemplateFromImage = useCallback(
        async (file) => {
          if (!file) return
          setBuildNote(t.templateUploading)
          const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result ?? ''))
            reader.readAsDataURL(file)
          })
          try {
            const uploaded = await localPost('local/template-upload', { name: file.name.replace(/\.[^.]+$/, ''), dataUrl })
            if (uploaded.ok !== true) {
              setBuildNote(`${t.templateUploadFailed}：${uploaded.error ?? ''}`)
              return
            }
            const known = (await localGet('local/templates')).templates?.map((row) => row.id) ?? []
            setBuilding({ known, startedAt: Date.now() })
            setBuildNote(`${t.templateBuilding}：${String(uploaded.path).split('\\').pop()}`)
            await askAgent(
              '',
              [
                '新任务：按参考图做一个新模板（这是"注册模板"，不是改简历）。',
                `参考图：${uploaded.path}`,
                '',
                '步骤：',
                '1. 用 resume_template(action=brief) 拿到任务书；',
                '2. 派子 agent（与当前会话隔离）只做一件事：照参考图产出 manifest JSON；',
                '3. resume_template(action=save) 落盘；',
                '4. resume_template(action=preview) 出样张，回报 id 与逐项对照结果。',
                '',
                `完成后请在画布里能看到新模板（id 会出现在模板入口的列表里）。`,
              ].join('\n'),
            )
          } catch (error) {
            setBuildNote(`${t.templateUploadFailed}：${error instanceof Error ? error.message : String(error)}`)
          }
        },
        [t.templateBuilding, t.templateUploading],
      )

      /** 打开模板画廊：给 15 个模板各渲一张小样（用当前文档，未保存改动也算）。 */      useEffect(() => {
        if (!showTemplates || doc === null) return undefined
        let cancelled = false
        Promise.all(
          TEMPLATES.map(async (template) => {
            try {
              const html = await localHtml('local/render', {
                doc: { ...doc, metadata: { ...(doc.metadata ?? {}), template } },
                locale: doc?.metadata?.page?.locale,
              })
              return [template, html]
            } catch {
              return [template, '']
            }
          }),
        ).then((pairs) => {
          if (!cancelled) setThumbs(Object.fromEntries(pairs))
        })
        return () => {
          cancelled = true
        }
      }, [showTemplates, doc])

      const preview = h(
        'aside',
        { className: 'rrv-ed-preview' },
        h(
          'div',
          { className: 'rrv-ed-preview-head' },
          h('div', { className: 'rrv-ed-title' }, t.preview),
          h(
            'button',
            {
              className: 'rrv-btn',
              type: 'button',
              onClick: () => setExpanded(true),
              disabled: previewHtml === '',
            },
            t.openLarger,
          ),
        ),
        previewHtml === ''
          ? h(
              'div',
              { className: 'rrv-ed-preview-box' },
              previewError !== ''
                ? `${t.previewFailed}：${previewError}`
                : busy
                  ? t.loading
                  : t.previewPending,
            )
          : h(
              'div',
              {
                className: 'rrv-ed-sheet',
                ref: sheetBoxRef,
                style: { width: `${794 * scale}px`, height: `${1123 * scale}px` },
              },
              h('iframe', {
                ref: frameRef,
                title: 'preview',
                srcDoc: previewHtml,
                className: 'rrv-ed-frame',
                style: { transform: `scale(${scale})` },
                onLoad: () => attachQuoteHandlers(frameRef.current),
              }),
            ),
        textQuote === null
          ? null
          : h(
              'span',
              { className: 'rrv-quote text' },
              h('b', null, `「${textQuote.text}」`),
              h('i', null, textQuote.path || '块内文本'),
              h(
                'button',
                { type: 'button', className: 'rrv-quote-x', title: t.removeQuote, onClick: () => setTextQuote(null) },
                '×',
              ),
            ),
        quotes.length === 0 && textQuote === null
          ? h('div', { className: 'rrv-ed-hint' }, t.quoteHint)
          : h(
              'div',
              { className: 'rrv-ed-quotes' },
              quotes.map((quote) =>
                h(
                  'span',
                  { key: quote.path, className: 'rrv-quote' },
                  h('b', null, quote.label),
                  h('i', null, quote.path),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'rrv-quote-x',
                      title: t.removeQuote,
                      onClick: () => setQuotes((list) => list.filter((item) => item.path !== quote.path)),
                    },
                    '×',
                  ),
                ),
              ),
            ),
        h('div', {
          className: 'rrv-ed-ask-grip',
          title: t.dragHint,
          onPointerDown: startAskDrag,
        }),
        h(
          'div',
          { className: 'rrv-ed-composer', style: { height: askH } },
          h('textarea', {
            className: 'rrv-field-input rrv-field-area rrv-ed-ask-box',
            value: quoteText,
            placeholder: t.quoteAsk,
            onChange: (event) => setQuoteText(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void sendQuoted()
              }
            },
          }),
          h(
            'div',
            { className: 'rrv-ed-ask-row' },
            h('span', { className: 'rrv-ed-hint' }, targetSession === '' ? t.sameSession : `${t.targetSession}：${targetSession}`),
            h(
              'button',
              {
                className: 'rrv-btn primary',
                type: 'button',
                onClick: () => void sendQuoted(),
                disabled: busy || (quotes.length === 0 && textQuote === null && quoteText.trim() === ''),
              },
              t.send,
            ),
          ),
        ),
      )

      /**
       * 模板画廊：15 个模板各一张真实小样（用当前文档渲染），点一下就套用。
       * 这是"选择和调整模板"的入口 —— 光靠下拉列表看不出区别，所以必须能看。
       */
      const renderGallery = () =>
        h(
          'div',
          { className: 'rrv-gal-mask', onClick: () => setShowTemplates(false) },
          h(
            'div',
            { className: 'rrv-gal', onClick: (event) => event.stopPropagation() },
            h(
              'div',
              { className: 'rrv-gal-bar' },
              h('strong', null, t.templateGallery),
              h('span', { className: 'rrv-ed-note' }, t.templateGalleryHint),
              h('span', { style: { flex: 1 } }),
              // 唯一入口：用参考图注册一个新模板（上传 → agent 制作 → 自动出现）
              h(
                'label',
                { className: 'rrv-btn primary', title: t.newTemplate },
                t.newTemplate,
                h('input', {
                  type: 'file',
                  accept: 'image/png,image/jpeg,image/webp',
                  style: { display: 'none' },
                  onChange: (event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    void createTemplateFromImage(file)
                  },
                }),
              ),
              h('button', { className: 'rrv-btn', type: 'button', onClick: () => setShowTemplates(false) }, t.close),
            ),
            buildNote === ''
              ? null
              : h('div', { className: 'rrv-gal-note' }, building === null ? buildNote : `⏳ ${buildNote}`),
            h(
              'div',
              { className: 'rrv-gal-grid' },
              [...TEMPLATES, ...customTemplates.map((row) => row.id).filter((id) => !TEMPLATES.includes(id))].map((template) => {
                const active = (doc?.metadata?.template ?? '') === template
                return h(
                  'button',
                  {
                    key: template,
                    type: 'button',
                    className: `rrv-gal-item${active ? ' active' : ''}`,
                    onClick: () => {
                      setField('metadata.template', template)
                      setShowTemplates(false)
                    },
                  },
                  h(
                    'div',
                    { className: 'rrv-gal-thumb' },
                    thumbs[template]
                      ? h('iframe', { srcDoc: thumbs[template], title: template, className: 'rrv-gal-frame', scrolling: 'no' })
                      : h('span', { className: 'rrv-gal-loading' }, t.loading),
                  ),
                  h('span', { className: 'rrv-gal-name' }, template),
                )
              }),
            ),
          ),
        )

      /** 打印放大视图里的那份 A4（同源 srcDoc，可以直接调它的 print）。 */
      const printPreview = useCallback(() => {
        const frame = bigFrameRef.current
        if (frame === null) return
        try {
          frame.contentWindow?.focus?.()
          frame.contentWindow?.print?.()
        } catch {
          /* 打印被拦就什么都不做，不假装成功 */
        }
      }, [])

      /** 可拖的栏宽手柄。 */
      const divider = (which) =>
        h('div', {
          className: 'rrv-ed-divider',
          role: 'separator',
          'aria-orientation': 'vertical',
          onPointerDown: startDrag(which),
          title: t.dragHint,
        })

      return h(
        'div',
        { className: 'rrv-ed' },
        h(Styles),
        h(
          'header',
          { className: 'rrv-ed-bar' },
          h('strong', { className: 'rrv-ed-brand' }, t.view),
          h(
            'button',
            {
              className: 'rrv-btn',
              type: 'button',
              title: t.backToChat,
              onClick: () => {
                try {
                  ctxRef?.get?.('layout')?.selectPanel?.('conversation')
                } catch {
                  /* 面板切换失败不影响编辑 */
                }
              },
            },
            t.backToChat,
          ),
          h('button', { className: 'rrv-btn', type: 'button', onClick: () => setShowTemplates(true), disabled: doc === null }, t.templateGallery),
          note === '' ? null : h('span', { className: 'rrv-ed-note' }, note),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'rrv-btn', type: 'button', onClick: () => void exportPdf(), disabled: busy || doc === null }, t.exportPdf),
          h('button', { className: 'rrv-btn primary', type: 'button', onClick: () => void save(), disabled: busy || doc === null }, busy ? t.saving : t.save),
        ),
        h(
          'div',
          {
            className: 'rrv-ed-body',
            style: { gridTemplateColumns: `${listW}px 6px minmax(320px, 1fr) 6px ${formW}px` },
          },
          list,
          divider('list'),
          preview,
          divider('form'),
          form,
        ),
        showTemplates ? renderGallery() : null,
        expanded
          ? h(
              'div',
              { className: 'rrv-gal-mask', onClick: () => setExpanded(false) },
              h(
                'div',
                { className: 'rrv-zoom', onClick: (event) => event.stopPropagation() },
                h(
                  'div',
                  { className: 'rrv-gal-bar' },
                  h('strong', null, t.preview),
                  h('span', { className: 'rrv-ed-note' }, t.zoomHint),
                  h('span', { style: { flex: 1 } }),
                  h('button', { className: 'rrv-btn', type: 'button', onClick: () => printPreview() }, t.print),
                  h('button', { className: 'rrv-btn', type: 'button', onClick: () => setExpanded(false) }, t.close),
                ),
                h(
                  'div',
                  { className: 'rrv-zoom-body' },
                  h('iframe', { ref: bigFrameRef, title: 'preview-large', srcDoc: previewHtml, className: 'rrv-zoom-frame' }),
                ),
              ),
            )
          : null,
      )
    }

    /** `rgba(37,99,235,1)` → `#2563eb`（给 input[type=color] 用）。 */
    function toHex(value) {
      const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(String(value ?? ''))
      if (match === null) return '#2563eb'
      return `#${Number(match[1]).toString(16).padStart(2, '0')}${Number(match[2]).toString(16).padStart(2, '0')}${Number(match[3]).toString(16).padStart(2, '0')}`
    }

    /**
     * 把字段值收敛成输入框能显示的字符串。
     * 简历里 `website`、`customFields` 这类可能是对象（`{url,label}`），
     * 直接塞给 input 会变成 `[object Object]` —— 截图里那个坑就是它。
     */
    function scalar(value) {
      if (value === null || value === undefined) return ''
      if (typeof value === 'string') return value
      if (typeof value === 'number' || typeof value === 'boolean') return String(value)
      if (Array.isArray(value)) return value.map((item) => scalar(item)).filter(Boolean).join(', ')
      if (typeof value === 'object') {
        const picked = value.url ?? value.href ?? value.value ?? value.name ?? value.label ?? value.content
        return picked === undefined ? '' : scalar(picked)
      }
      return String(value)
    }
    /** `#2563eb` → `rgba(37,99,235,1)`（应用存的是 rgba 字符串）。 */
    function hexToRgba(hex) {
      const value = String(hex ?? '#2563eb').replace('#', '')
      const red = parseInt(value.slice(0, 2), 16)
      const green = parseInt(value.slice(2, 4), 16)
      const blue = parseInt(value.slice(4, 6), 16)
      return `rgba(${red},${green},${blue},1)`
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctxRef = ctx
        ACTIVE = TEXT[pickLang(ctx)] ?? TEXT['zh-CN']
        // 左栏入口：点图标切到「简历」主面板（原生面板，和设置/插件同级）
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'resume', order: 20, label: () => ACTIVE.view }, ResumePanelIcon),
        )
        // 主面板本体：整页编辑器
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'resume' }, () => h(PanelBoundary, null, h(ResumeEditor))),
        )
      },
    }
  },
})
