/**
 * dsh-resume-assistant —— 浏览器端。
 *
 * 两个座位：
 *   1. `sidebar.panellist` —— 左栏「简历」图标（常驻）。它同时是"进入面板时是哪个对话"
 *      的哨兵：面板没开时一直跟着 `uiSession.current` 走。
 *   2. `main`（key: resume）—— 整页编辑器：简历列表 / 表单 / A4 预览 / 引用提问 /
 *      模板画廊 / 导出 PDF。
 *
 * 面板只跟**进入时那个对话窗口**说话（见 `useSessionTarget`）：宿主不认识"当前会话"，
 * 以前空目标会回退到 `agents.list()[0]`，多任务时消息会随机掉进别的对话。
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
        // 「经历库」页签（与简历编辑并列的第二个 tab）
        expTab: '经历库',
        expNew: '＋ 新增经历',
        expCountUnit: '条',
        expEmpty: '还没有经历。点右上角「＋ 新增经历」，把兼职、爱好、证书、小项目都记进来。',
        expTitle: '标题',
        expTitlePh: '一句话写清是什么（必填）',
        expPeriod: '时间',
        expCategory: '分类',
        expTags: '标签',
        expTagsPh: '逗号分隔，如：收银, 夜班',
        expDescription: '描述',
        expDescPh: '多行随便写：做了什么、学到什么、结果如何（换行会保留）',
        // STAR 小故事（面试前背细节用）
        expStar: 'STAR',
        expStarS: 'S – Situation',
        expStarSPh: '当时的处境 / 项目背景',
        expStarT: 'T – Task',
        expStarTPh: '你负责什么',
        expStarA: 'A – Action',
        expStarAPh: '你具体做了什么',
        expStarR: 'R – Result',
        expStarRPh: '结果，带数字',
        expStarHint: '面试前背细节用；只有填了的段落才会显示',
        expStory: '口语稿',
        expStoryHide: '收起口语稿',
        expCopy: '复制',
        expCopied: '已复制',
        expCopyFailed: '复制失败，请手动选择',
        expEdit: '编辑',
        expEditTitle: '编辑这条经历',
        expDelete: '删除',
        expConfirmDelete: '确认删除',
        expLoadFailed: '读经历库失败',
        expSaveFailed: '保存失败',
        expDeleteFailed: '删除失败',
        expCreated: '已新增',
        expUpdated: '已更新',
        expDeleted: '已删除',
        expTitleRequired: '标题不能为空',
        expDataFile: '数据文件',
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
        addSection: '加栏目',
        sectionName: '新栏目名（如「演讲」「开源」）',
        removeSection: '删除栏目',
        confirmDeleteSection: '确认删除栏目',
        confirmDeleteHint: '连同它下面的内容一起删掉，并从所有页面移除；保存时会先备份旧文档。',
        cancel: '取消',
        deleteSection: '删除',
        newSectionFallback: '新栏目',
        sectionAdded: '已加栏目（点保存生效）',
        sectionRemoved: '已删栏目（点保存生效）',
        uploadPhoto: '选择图片',
        removePhoto: '移除',
        showPhoto: '显示',
        hidePhoto: '隐藏',
        photoSize: '尺寸',
        photoShape: '形状',
        photoPosition: '位置',
        photoDragHint: '在左边的方框里拖动照片，调整头像的取景位置（拖动会立即写进草稿，保存后生效）',
        photoPositionHint: '拖动照片取景；也可以用九宫格直接跳到常见位置',
        photoCenter: '居中',
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
        expTab: 'Experience library',
        expNew: '+ New entry',
        expCountUnit: 'entries',
        expEmpty: 'Nothing here yet. Use "+ New entry" to record part-time jobs, hobbies, certificates or small projects.',
        expTitle: 'Title',
        expTitlePh: 'One line: what is it? (required)',
        expPeriod: 'Period',
        expCategory: 'Category',
        expTags: 'Tags',
        expTagsPh: 'comma separated, e.g. cashier, night shift',
        expDescription: 'Description',
        expDescPh: 'Free text: what you did, what you learned, how it turned out (line breaks are kept)',
        expStar: 'STAR',
        expStarS: 'S – Situation',
        expStarSPh: 'Where you were: project background',
        expStarT: 'T – Task',
        expStarTPh: 'What you were responsible for',
        expStarA: 'A – Action',
        expStarAPh: 'What you actually did',
        expStarR: 'R – Result',
        expStarRPh: 'Result, with numbers',
        expStarHint: 'For rehearsing details before an interview; only filled lines are shown',
        expStory: 'Speaking script',
        expStoryHide: 'Hide script',
        expCopy: 'Copy',
        expCopied: 'Copied',
        expCopyFailed: 'Copy failed — select the text manually',
        expEdit: 'Edit',
        expEditTitle: 'Edit this entry',
        expDelete: 'Delete',
        expConfirmDelete: 'Confirm delete',
        expLoadFailed: 'Could not read the experience library',
        expSaveFailed: 'Save failed',
        expDeleteFailed: 'Delete failed',
        expCreated: 'Added',
        expUpdated: 'Updated',
        expDeleted: 'Deleted',
        expTitleRequired: 'Title is required',
        expDataFile: 'Data file',
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
        addSection: 'Add section',
        sectionName: 'New section name (e.g. "Talks")',
        removeSection: 'Delete section',
        confirmDeleteSection: 'Delete section',
        confirmDeleteHint: 'Removes the section, its items and every layout reference; saving backs up the old document first.',
        cancel: 'Cancel',
        deleteSection: 'Delete',
        newSectionFallback: 'New section',
        sectionAdded: 'Section added (save to apply)',
        sectionRemoved: 'Section removed (save to apply)',
        uploadPhoto: 'Choose image',
        removePhoto: 'Remove',
        showPhoto: 'Show',
        hidePhoto: 'Hide',
        photoSize: 'Size',
        photoShape: 'Shape',
        photoPosition: 'Position',
        photoDragHint: 'Drag the photo inside the frame to reframe the headshot (writes to the draft right away; save to apply)',
        photoPositionHint: 'Drag to reframe, or jump to a common position with the grid',
        photoCenter: 'Center',
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

    /** 一次请求的幂等键（同一个 id 重试不会写两条消息）。 */
    function requestId() {
      try {
        return crypto.randomUUID()
      } catch {
        return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`
      }
    }

    /**
     * 把一段话投给**指定的**会话 agent。
     *
     * `sessionId` 必填：宿主端已经不再接受空值（空值以前会回退到
     * `agents.list()[0]`，所以消息会随机掉进别的对话）。
     * @param sessionId - 目标会话 id。
     * @param body - 消息正文。
     * @param meta - `{ panel }`，只用于在会话日志里标记来源。
     */
    async function askAgent(sessionId, body, meta = {}) {
      const response = await fetch(`${BRIDGE}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, text: body, clientRequestId: requestId(), panel: meta.panel ?? 'editor' }),
      })
      return await response.json().catch(() => ({ ok: false, code: `http-${response.status}`, reason: `HTTP ${response.status}` }))
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

    // ---------------------------------------------------------------- 会话绑定
    //
    // 一条铁律：**发到"进入简历面板时"那个对话窗口**，绝不猜。
    //
    // `uiSession.current` 是「主视图当前 retain 的会话」（`dsh-client-ui-session`
    // 的 `publishMain()`：取 `retainedBy.mainView > 0` 的那条）。简历面板一旦占住
    // `main`，会话视图就卸载、retain 归零 —— `current` 会漂到别的会话或变空。
    // 所以只能在"进入那一刻"抓快照：左栏图标常驻，它渲染时就盯着 `current`，
    // 面板没开的时候一直更新 `boundSessionId`；面板一开就停更（`panelOpen`）。

    /** 进入面板时的会话 id（"我从哪个对话来的"）。 */
    let boundSessionId = ''

    /** 面板是否已经占住主视图（占住之后就不再跟着 `current` 漂）。 */
    let panelOpen = false

    /** 取 `uiSession.current` 的当前值，拿不到就是 `''`。 */
    function currentSessionId() {
      try {
        const ui = ctxRef?.uiSession ?? ctxRef?.get?.('uiSession')
        const value = ui?.current?.getSnapshot?.()
        const id = value?.key ?? value?.props?.sessionId
        return typeof id === 'string' ? id : ''
      } catch {
        return ''
      }
    }

    /** 面板没开时，跟着当前对话窗口走。 */
    function trackEntrySession() {
      if (panelOpen) return
      const id = currentSessionId()
      if (id !== '') boundSessionId = id
    }

    /**
     * 面板的绑定目标。
     *
     * 优先级：进入时快照 → 上次记忆 → 真实为空（此时不猜，让 UI 显示"选择会话"）。
     * @returns `[sessionId, setSessionId]`。
     */
    function useSessionTarget() {
      const [sessionId, setSessionId] = useState(() => {
        trackEntrySession()
        return boundSessionId
      })

      useEffect(() => {
        if (sessionId !== '') {
          boundSessionId = sessionId
          return undefined
        }
        // 面板被恢复时可能还没有绑定：等对话窗口出现再认领一次。
        let dispose = () => {}
        try {
          const source = (ctxRef?.uiSession ?? ctxRef?.get?.('uiSession'))?.current
          if (source !== undefined && typeof source.subscribe === 'function') {
            const adopt = () => {
              const id = source.getSnapshot?.()?.key ?? source.getSnapshot?.()?.props?.sessionId
              if (typeof id === 'string' && id !== '') {
                boundSessionId = id
                setSessionId(id)
              }
            }
            adopt()
            dispose = source.subscribe(adopt) ?? (() => {})
          }
        } catch {
          dispose = () => {}
        }
        return () => {
          try {
            dispose()
          } catch {
            /* 已释放 */
          }
        }
      }, [sessionId])

      return [sessionId, setSessionId]
    }

    /**
     * 投给 lead 的那段"委派块"。
     *
     * 为什么写在这里而不是系统提示词里：这条策略只在**面板发话**时需要，
     * 而系统提示词是全会话生效的。放在消息里，用户也能在对话里看见"它为什么去派活"。
     */
    const DELEGATION_BLOCK = [
      '[简历面板] 这个会话负责和用户对话。关于简历的**编辑/排版/美化**，遵守：',
      '1. 不要自己排版、不要为了排版直接 resume_patch；也不要自己拼 subagent 参数。',
      '2. 先 resume_show 看清楚事实，再调 resume_dispatch 派活：intent（要什么）+ resumeId + paths（目标 JSON Pointer）+ excerpt（要写成的原话）。',
      '3. 派完就告诉用户「已交给简历助手」，等它的完成通知，再把"改了哪些 path、每处改了什么"汇总回来。',
      '4. 用户只是问问题、不改东西时，直接回答，不要派活。',
    ].join('\n')

    /** 给面板消息加上委派块。 */
    function withDelegationBlock(body) {
      return `${DELEGATION_BLOCK}\n\n----\n${body}`
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
      '.rrv-lay-col-head { display: flex; align-items: center; gap: 6px; }',
      '.rrv-lay-add { margin-left: auto; border: 0; background: none; cursor: pointer; font-size: 12px; line-height: 1; padding: 0 2px; color: var(--dsw-alias-label-secondary); }',
      '.rrv-lay-add:hover { color: var(--dsw-alias-label-primary); }',
      '.rrv-lay-chip .rrv-lay-name { flex: 1; }',
      '.rrv-lay-x { border: 0; background: none; cursor: pointer; font-size: 13px; line-height: 1; padding: 0 2px; color: var(--dsw-alias-label-secondary); }',
      '.rrv-lay-x:hover { color: #ef4444; }',
      '.rrv-lay-new { display: flex; align-items: center; gap: 6px; margin-top: 6px; }',
      '.rrv-lay-new input { flex: 1; }',
      '.rrv-lay-confirm { display: flex; align-items: center; gap: 8px; margin-top: 6px; padding: 6px 8px; border-radius: 6px; background: rgba(239,68,68,.08); font-size: 11px; }',
      '.rrv-lay-grip { color: var(--dsw-alias-label-secondary); font-size: 10px; letter-spacing: -1px; }',
      '.rrv-lay-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.rrv-ed-photo { display: flex; align-items: center; gap: 10px; }',
      '.rrv-ed-photo-box { width: 72px; height: 72px; flex: none; border-radius: 10px; overflow: hidden;',
      '  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2);',
      '  cursor: grab; touch-action: none; }',
      '.rrv-ed-photo-box.dragging { cursor: grabbing; box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent); }',
      '.rrv-ed-photo-box .rrv-ed-avatar { width: 100%; height: 100%; display: block; border: 0; border-radius: 0; }',
      '.rrv-ed-avatar { width: 56px; height: 56px; border-radius: 10px; object-fit: cover;',
      '  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }',
      '.rrv-ed-avatar.empty { display: flex; align-items: center; justify-content: center;',
      '  color: var(--dsw-alias-label-secondary); }',
      '.rrv-ed-photo-ctl { display: flex; gap: 6px; flex-wrap: wrap; }',
      '.rrv-ed-pos { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
      '.rrv-ed-pos-grid { display: inline-grid; grid-template-columns: repeat(3, 18px); gap: 3px; }',
      '.rrv-ed-pos-cell { width: 18px; height: 18px; padding: 0; border-radius: 4px; cursor: pointer;',
      '  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-overlay); }',
      '.rrv-ed-pos-cell:hover { border-color: var(--dsw-alias-label-secondary); }',
      '.rrv-ed-pos-cell.active { border-color: var(--dsw-alias-brand-primary);',
      '  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 32%, transparent); }',
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
      // 「经历库」页签
      '.rrv-tabs { display: inline-flex; gap: 2px; padding: 2px; border-radius: 9px;',
      '  background: var(--dsw-alias-bg-layer-2); }',
      '.rrv-tab { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit;',
      '  font-size: 12px; padding: 4px 10px; border-radius: 7px; cursor: pointer; }',
      '.rrv-tab:hover { color: var(--dsw-alias-label-primary); }',
      '.rrv-tab.active { background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);',
      '  box-shadow: 0 1px 3px rgba(15,23,42,.12); font-weight: 600; }',
      '.rrv-exp { flex: 1; min-height: 0; overflow: auto; padding: 16px; display: flex;',
      '  flex-direction: column; gap: 10px; }',
      '.rrv-exp-head { display: flex; align-items: center; gap: 10px; }',
      '.rrv-exp-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;',
      '  background: var(--dsw-alias-bg-layer-1); overflow: hidden; }',
      '.rrv-exp-card.open { border-color: var(--dsw-alias-border-l2); }',
      '.rrv-exp-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px;',
      '  color: inherit; font: inherit; text-align: left; cursor: pointer; }',
      '.rrv-exp-row:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.rrv-exp-row:focus-visible { outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);',
      '  outline-offset: -2px; }',
      '.rrv-exp-caret { width: 10px; flex: none; font-size: 10px; color: var(--dsw-alias-label-secondary); }',
      '.rrv-exp-title { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis;',
      '  white-space: nowrap; }',
      '.rrv-exp-period { flex: none; font-size: 11px; color: var(--dsw-alias-label-secondary);',
      '  font-variant-numeric: tabular-nums; }',
      '.rrv-exp-cat { flex: none; font-size: 10px; padding: 1px 7px; border-radius: 999px;',
      '  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);',
      '  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent); }',
      '.rrv-exp-body { padding: 0 12px 12px 32px; display: flex; flex-direction: column; gap: 8px; }',
      '.rrv-exp-desc { font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }',
      '.rrv-exp-tags { display: flex; flex-wrap: wrap; gap: 4px; }',
      '.rrv-exp-tag { font-size: 10px; padding: 1px 7px; border-radius: 999px;',
      '  color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2);',
      '  border: 1px solid var(--dsw-alias-border-l1); }',
      '.rrv-exp-acts { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }',
      // STAR 块（展开的卡片里，描述下面）
      '.rrv-exp-star { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px;',
      '  border-radius: 10px; background: var(--dsw-alias-bg-layer-2);',
      '  border: 1px solid var(--dsw-alias-border-l1); }',
      '.rrv-exp-star-item { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px;',
      '  align-items: start; }',
      '.rrv-exp-star-k { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary);',
      '  font-variant-numeric: tabular-nums; }',
      '.rrv-exp-star-v { font-size: 12px; line-height: 1.6; white-space: pre-wrap;',
      '  word-break: break-word; }',
      // 口语稿
      '.rrv-exp-story { border-radius: 10px; background: var(--dsw-alias-bg-layer-2);',
      '  border: 1px solid var(--dsw-alias-border-l2); padding: 8px 10px;',
      '  display: flex; flex-direction: column; gap: 6px; }',
      '.rrv-exp-story-head { display: flex; align-items: center; gap: 8px; }',
      '.rrv-exp-story-body { font-size: 12px; line-height: 1.8; white-space: pre-wrap;',
      '  word-break: break-word; user-select: text; }',
      '.rrv-exp-form { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 12px;',
      '  background: var(--dsw-alias-bg-layer-1); display: flex; flex-direction: column; gap: 8px; }',
      '.rrv-exp-grid { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 8px 10px;',
      '  align-items: center; }',
      '.rrv-exp-empty { padding: 28px 16px; text-align: center; font-size: 12px;',
      '  color: var(--dsw-alias-label-secondary); border: 1px dashed var(--dsw-alias-border-l2);',
      '  border-radius: 12px; }',
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

    // ---------------------------------------------------------------- 本地数据面（直连 Postgres）
    // 面板不依赖应用前端，也不依赖它的 MCP：`resume.data` 就是整份文档。

    /** 15 个模板（与 Reactive Resume 同名）。 */
    const TEMPLATES = [
      'azurill', 'bronzor', 'chikorita', 'ditgar', 'ditto', 'gengar', 'glalie', 'kakuna', 'lapras',
      'leafish', 'meowth', 'onyx', 'pikachu', 'rhyhorn', 'scizor',
    ]

    // ---------------------------------------------------------------- 照片取景位置
    //
    // 头像用 `object-fit: cover` 裁进方框，所以"换一张竖图，脑袋被切掉"是常事。
    // 位置存在 `picture.position = { x, y }`（0–100 的百分比，就是 CSS `object-position`
    // 的那两个数）：拖动照片改它、九宫格改它、宿主渲染（compose.js）读它。
    // 没有这个字段时按 50/50 处理 = 居中裁，与旧版完全一致。

    /** 把 `picture.position` 收成合法的 `{ x, y }`。 */
    function photoPositionOf(picture) {
      const clamp = (value) => {
        if (value === null || value === undefined || value === '') return 50
        const number = Number(value)
        if (!Number.isFinite(number)) return 50
        return Math.max(0, Math.min(100, Math.round(number)))
      }
      return { x: clamp(picture?.position?.x), y: clamp(picture?.position?.y) }
    }

    /** 九宫格的九个常用取景位（左上 → 右下）。 */
    const PHOTO_PRESETS = [
      [0, 0], [50, 0], [100, 0],
      [0, 50], [50, 50], [100, 50],
      [0, 100], [50, 100], [100, 100],
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

    /**
     * POST 一个桥端点，**总是**把 JSON 读回来（4xx 也读）。
     *
     * 409 里带着 `code`（`session-not-live` / `image-missing`），那是要显示给用户的原因；
     * `localPost` 会在非 2xx 时直接抛 `HTTP 409`，把原因吞掉。
     */
    async function postBridge(path, body) {
      const response = await fetch(`${BRIDGE}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      return await response.json().catch(() => ({ ok: false, code: `http-${response.status}`, reason: `HTTP ${response.status}` }))
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
     *
     * 它同时是"进入面板时是哪个对话"的哨兵：图标常驻在左栏，面板没开的
     * 时候一直跟着 `uiSession.current` 走；点开面板的那一刻 `boundSessionId`
     * 就是当时那个对话窗口。
     */
    function ResumePanelIcon() {
      useEffect(() => {
        trackEntrySession()
        let dispose = () => {}
        try {
          const source = (ctxRef?.uiSession ?? ctxRef?.get?.('uiSession'))?.current
          if (source !== undefined && typeof source.subscribe === 'function') {
            dispose = source.subscribe(() => trackEntrySession()) ?? (() => {})
          }
        } catch {
          dispose = () => {}
        }
        return () => {
          try {
            dispose()
          } catch {
            /* 已释放 */
          }
        }
      }, [])
      return h('span', { style: { display: 'inline-flex', alignItems: 'center' } }, h(DocGlyph))
    }

    /** 应用上下文（apply 时记下，供图标点击用）。 */
    let ctxRef = null

    /** 经历库分类建议（自由文本照样能存；这里只喂 `<datalist>`）。 */
    const EXP_CATEGORIES = ['兼职', '项目', '爱好', '证书', '其他']

    /** STAR 四段的键，顺序 = 口语稿顺序。宿主只认这四个（多传的会被丢掉）。 */
    const EXP_STAR_KEYS = ['situation', 'task', 'action', 'result']

    /**
     * 把一条 item 的 `star` 收敛成**恰好四个字符串**。
     *
     * 老条目（上一轮存的）根本没有 `star`，宿主读盘时会补，但客户端也兜一层：
     * 直接读一个 undefined 再 `.trim()` 是这类改造最典型的白屏原因。
     * @param item - 任意 item。
     * @returns `{ situation, task, action, result }`。
     */
    function starOf(item) {
      const raw = item?.star
      const out = {}
      for (const key of EXP_STAR_KEYS) {
        const value = raw !== null && typeof raw === 'object' ? raw[key] : ''
        out[key] = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
      }
      return out
    }

    /** STAR 里是否有任何一段非空（全空就不渲染那一块）。 */
    function hasStar(star) {
      return EXP_STAR_KEYS.some((key) => String(star?.[key] ?? '').trim() !== '')
    }

    /**
     * 把 STAR 四段拼成可以直接讲出来的一段话。
     *
     * - 顺序固定 S → T → A → R；
     * - 每段先「去多余空行」（逐行 trim、丢空行、再用 `\n` 接回去），空段跳过；
     * - 段与段之间用「。」断开，但上一段已经以句末标点结尾时不再补第二个「。」；
     * - 整段结尾没有句末标点就补一个「。」。
     * @param star - `{ situation, task, action, result }`。
     * @returns 口语稿字符串（四段全空则是 `''`）。
     */
    function composeStory(star) {
      const parts = []
      for (const key of EXP_STAR_KEYS) {
        const text = String(star?.[key] ?? '')
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '')
          .join('\n')
          .trim()
        if (text !== '') parts.push(text)
      }
      if (parts.length === 0) return ''
      let out = ''
      for (const part of parts) {
        if (out !== '' && !/[。！？!?…：:；;，,、]$/.test(out)) out += '。'
        out += part
      }
      if (!/[。！？!?…]$/.test(out)) out += '。'
      return out
    }

    /**
     * 「经历库」页签 —— 整页编辑器里的第二个 tab。
     *
     * 形态：卡片列表。折叠时只有 **标题 + 时间 + 分类** 三项，点一下展开完整描述
     * （`white-space: pre-wrap`，换行原样保留）；再点一下收起。
     *
     * 数据全走 `resume-bridge/experiences*`（GET 列表 / POST 保存 / POST 删除），
     * 宿主把它原子写到 `06-经历库\experiences.json`，浏览器里不留状态 ——
     * 刷新页面、重启 DSH 都还在。
     *
     * 为什么不用 `window.confirm`：webview 里 confirm 常常被拦或和宿主的快捷键
     * 打架，而且它会阻塞渲染。删除改成"点一下变成确认按钮"的两步式。
     */
    function ExperienceLibrary() {
      const t = text()
      const [items, setItems] = useState([])
      const [note, setNote] = useState('')
      const [filePath, setFilePath] = useState('')
      const [openId, setOpenId] = useState('')
      /** 正在编辑的草稿；null = 表单没打开。`id === ''` 表示新增。 */
      const [draft, setDraft] = useState(null)
      const [busy, setBusy] = useState(false)
      const [pendingDelete, setPendingDelete] = useState('')
      /** 哪张卡片的「口语稿」展开着（点第二次收起）。 */
      const [storyId, setStoryId] = useState('')
      /** 复制按钮的一次性反馈：'' | 已复制 | 复制失败。 */
      const [copyNote, setCopyNote] = useState('')

      const load = useCallback(async () => {
        try {
          const data = await localGet('experiences')
          setItems(Array.isArray(data?.items) ? data.items : [])
          setFilePath(typeof data?.path === 'string' ? data.path : '')
          if (typeof data?.error === 'string' && data.error !== '') setNote(`${t.expLoadFailed}：${data.error}`)
        } catch (error) {
          setNote(`${t.expLoadFailed}：${error instanceof Error ? error.message : String(error)}`)
        }
      }, [t.expLoadFailed])

      useEffect(() => {
        void load()
      }, [load])

      const startNew = useCallback(() => {
        setDraft({ id: '', title: '', period: '', category: EXP_CATEGORIES[0], description: '', tags: '', star: { situation: '', task: '', action: '', result: '' } })
        setOpenId('')
        setPendingDelete('')
        setStoryId('')
        setCopyNote('')
        setNote('')
      }, [])

      const startEdit = useCallback((item) => {
        setDraft({
          id: item.id,
          title: item.title ?? '',
          period: item.period ?? '',
          category: item.category ?? '',
          description: item.description ?? '',
          tags: Array.isArray(item.tags) ? item.tags.join(', ') : String(item.tags ?? ''),
          // 老条目没有 star → starOf 给四个空串，表单照常可编辑
          star: starOf(item),
        })
        setOpenId(item.id)
        setPendingDelete('')
        setStoryId('')
        setCopyNote('')
        setNote('')
      }, [])

      const saveDraft = useCallback(async () => {
        if (draft === null) return
        if (String(draft.title ?? '').trim() === '') {
          setNote(t.expTitleRequired)
          return
        }
        setBusy(true)
        try {
          const result = await postBridge('experiences/save', {
            // 没有 id 就不带这个键：宿主据此判断"新建"，不会把空串当 id 去找
            ...(draft.id === '' ? {} : { id: draft.id }),
            title: draft.title,
            period: draft.period,
            category: draft.category,
            description: draft.description,
            tags: draft.tags,
            // 四段都空也照发：宿主把它落成四个空串，等价于"没有 STAR"
            star: starOf(draft),
          })
          if (result?.ok !== true) {
            setNote(`${t.expSaveFailed}：${result?.error ?? `HTTP ${result?.code ?? '?'}`}`)
          } else {
            setNote(`${result.action === 'updated' ? t.expUpdated : t.expCreated}：${result.item?.title ?? ''}`)
            setDraft(null)
            await load()
          }
        } catch (error) {
          setNote(`${t.expSaveFailed}：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy(false)
        }
      }, [draft, load, t])

      const remove = useCallback(
        async (id) => {
          setBusy(true)
          try {
            const result = await postBridge('experiences/delete', { id })
            if (result?.ok !== true) setNote(`${t.expDeleteFailed}：${result?.error ?? `HTTP ${result?.code ?? '?'}`}`)
            else {
              setNote(t.expDeleted)
              setPendingDelete('')
              setOpenId((current) => (current === id ? '' : current))
              setDraft((current) => (current !== null && current.id === id ? null : current))
              await load()
            }
          } catch (error) {
            setNote(`${t.expDeleteFailed}：${error instanceof Error ? error.message : String(error)}`)
          } finally {
            setBusy(false)
          }
        },
        [load, t],
      )

      /** 表单里的一个单行输入框。 */
      const input = (key, placeholder, extra) =>
        h('input', {
          className: 'rrv-field-input',
          value: draft?.[key] ?? '',
          placeholder,
          onChange: (event) => {
            const value = event.target.value
            setDraft((previous) => ({ ...(previous ?? {}), [key]: value }))
          },
          ...(extra ?? {}),
        })

      /** 表单里 STAR 的一段：小标题 + 灰字提示 + 3 行 textarea。 */
      const starArea = (key, label, hint) =>
        h(
          'div',
          { className: 'rrv-exp-star-item', style: { gridTemplateColumns: 'minmax(0, 1fr)' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' } },
            h('span', { className: 'rrv-exp-star-k' }, label),
            h('span', { className: 'rrv-ed-hint', style: { maxWidth: 'none' } }, hint),
          ),
          h('textarea', {
            className: 'rrv-field-input rrv-field-area',
            rows: 3,
            style: { minHeight: 64, resize: 'vertical', fontFamily: 'inherit' },
            placeholder: hint,
            value: draft?.star?.[key] ?? '',
            onChange: (event) => {
              const value = event.target.value
              setDraft((previous) => {
                const base = previous ?? {}
                const star = { ...starOf(base), [key]: value }
                return { ...base, star }
              })
            },
          }),
        )

      const renderForm = () =>
        draft === null
          ? null
          : h(
              'div',
              { className: 'rrv-exp-form' },
              h('div', { className: 'rrv-ed-title' }, draft.id === '' ? t.expNew : t.expEditTitle),
              h(
                'div',
                { className: 'rrv-exp-grid' },
                h('span', { className: 'rrv-field-label' }, t.expTitle),
                input('title', t.expTitlePh, { autoFocus: true }),
                h('span', { className: 'rrv-field-label' }, t.expPeriod),
                input('period', '2022 – 2023'),
                h('span', { className: 'rrv-field-label' }, t.expCategory),
                input('category', EXP_CATEGORIES.join(' / '), { list: 'rrv-exp-cats' }),
                h('span', { className: 'rrv-field-label' }, t.expTags),
                input('tags', t.expTagsPh),
              ),
              h('textarea', {
                className: 'rrv-field-input rrv-field-area',
                rows: 6,
                style: { minHeight: 120, resize: 'vertical', fontFamily: 'inherit' },
                placeholder: t.expDescPh,
                value: draft.description ?? '',
                onChange: (event) => {
                  const value = event.target.value
                  setDraft((previous) => ({ ...(previous ?? {}), description: value }))
                },
              }),
              // STAR 小故事：四段都可留空，填了才会出现在卡片和口语稿里
              h(
                'div',
                { className: 'rrv-exp-star' },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' } },
                  h('span', { className: 'rrv-exp-star-k', style: { fontWeight: 700 } }, t.expStar),
                  h('span', { className: 'rrv-ed-hint', style: { maxWidth: 'none' } }, t.expStarHint),
                ),
                starArea('situation', t.expStarS, t.expStarSPh),
                starArea('task', t.expStarT, t.expStarTPh),
                starArea('action', t.expStarA, t.expStarAPh),
                starArea('result', t.expStarR, t.expStarRPh),
              ),
              h(
                'div',
                { className: 'rrv-exp-acts' },
                h('span', { className: 'rrv-ed-hint', style: { maxWidth: 'none' } }, filePath === '' ? '' : `${t.expDataFile}：${filePath}`),
                h('span', { style: { flex: 1 } }),
                h(
                  'button',
                  {
                    className: 'rrv-btn',
                    type: 'button',
                    onClick: () => {
                      setDraft(null)
                      setNote('')
                    },
                  },
                  t.cancel,
                ),
                h('button', { className: 'rrv-btn primary', type: 'button', onClick: () => void saveDraft(), disabled: busy }, busy ? t.saving : t.save),
              ),
              // 自由文本 + 建议值：datalist 不限制输入，随便写「志愿活动」也行
              h('datalist', { id: 'rrv-exp-cats' }, EXP_CATEGORIES.map((name) => h('option', { key: name, value: name }))),
            )

      /**
       * 复制口语稿。
       *
       * 优先 `navigator.clipboard.writeText`；没有 API 或抛错（非 https / 老 webview
       * / 权限被拒）就退到 `document.execCommand('copy')`；两条路都不行才显示
       * 「复制失败，请手动选择」—— 正文本身可选中，用户还能自己 Ctrl+C。
       */
      const copyStory = useCallback(
        async (content) => {
          try {
            if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
              await navigator.clipboard.writeText(content)
              setCopyNote(t.expCopied)
              return
            }
          } catch {
            /* 落到降级路径 */
          }
          try {
            const area = document.createElement('textarea')
            area.value = content
            area.setAttribute('readonly', '')
            area.style.position = 'fixed'
            area.style.top = '-1000px'
            area.style.opacity = '0'
            document.body.appendChild(area)
            area.select()
            const done = typeof document.execCommand === 'function' ? document.execCommand('copy') : false
            document.body.removeChild(area)
            setCopyNote(done ? t.expCopied : t.expCopyFailed)
          } catch {
            setCopyNote(t.expCopyFailed)
          }
        },
        [t.expCopied, t.expCopyFailed],
      )

      const renderCard = (item) => {
        const open = openId === item.id
        const tags = Array.isArray(item.tags) ? item.tags : []
        const star = starOf(item)
        const showStar = hasStar(star)
        const story = composeStory(star)
        const storyOpen = open && storyId === item.id && story !== ''
        return h(
          'div',
          { key: item.id, className: `rrv-exp-card${open ? ' open' : ''}` },
          h(
            'div',
            {
              className: 'rrv-exp-row',
              role: 'button',
              tabIndex: 0,
              onClick: () => {
                setOpenId(open ? '' : item.id)
                // 卡片收起时口语稿跟着收起，下次展开是干净状态
                setStoryId('')
                setCopyNote('')
              },
              onKeyDown: (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                setOpenId(open ? '' : item.id)
                setStoryId('')
                setCopyNote('')
              },
            },
            h('span', { className: 'rrv-exp-caret' }, open ? '▾' : '▸'),
            h('span', { className: 'rrv-exp-title' }, item.title ?? ''),
            h('span', { style: { flex: 1 } }),
            item.period ? h('span', { className: 'rrv-exp-period' }, item.period) : null,
            h('span', { className: 'rrv-exp-cat' }, item.category || '其他'),
          ),
          // 正在编辑的那张卡片不再重复展开内容（表单在上面）
          open && !(draft !== null && draft.id === item.id)
            ? h(
                'div',
                { className: 'rrv-exp-body' },
                h('div', { className: 'rrv-exp-desc' }, (item.description ?? '') === '' ? '（没有描述）' : item.description),
                // STAR：只显示填了的段落；四段全空整块不出现（老条目就是这样）
                showStar
                  ? h(
                      'div',
                      { className: 'rrv-exp-star' },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' } },
                        h('span', { className: 'rrv-exp-star-k', style: { fontWeight: 700 } }, t.expStar),
                        h('span', { className: 'rrv-ed-hint', style: { maxWidth: 'none' } }, t.expStarHint),
                      ),
                      EXP_STAR_KEYS.map((key) => {
                        const label = { situation: t.expStarS, task: t.expStarT, action: t.expStarA, result: t.expStarR }[key]
                        const value = String(star[key] ?? '').trim()
                        if (value === '') return null
                        return h(
                          'div',
                          { key, className: 'rrv-exp-star-item' },
                          h('span', { className: 'rrv-exp-star-k' }, label),
                          h('div', { className: 'rrv-exp-star-v' }, value),
                        )
                      }),
                    )
                  : null,
                tags.length === 0 ? null : h('div', { className: 'rrv-exp-tags' }, tags.map((tag) => h('span', { key: tag, className: 'rrv-exp-tag' }, `#${tag}`))),
                h(
                  'div',
                  { className: 'rrv-exp-acts' },
                  h('button', { className: 'rrv-btn', type: 'button', onClick: () => startEdit(item) }, t.expEdit),
                  // 口语稿：跟编辑/删除一排；四段全空就没有可讲的话，按钮不出现
                  story === ''
                    ? null
                    : h(
                        'button',
                        {
                          className: 'rrv-btn',
                          type: 'button',
                          title: t.expStory,
                          onClick: () => {
                            setCopyNote('')
                            setStoryId(storyOpen ? '' : item.id)
                          },
                        },
                        storyOpen ? t.expStoryHide : t.expStory,
                      ),
                  pendingDelete === item.id
                    ? h('button', { className: 'rrv-btn', type: 'button', disabled: busy, onClick: () => void remove(item.id) }, t.expConfirmDelete)
                    : h('button', { className: 'rrv-btn', type: 'button', disabled: busy, onClick: () => setPendingDelete(item.id) }, t.expDelete),
                  pendingDelete === item.id
                    ? h('button', { className: 'rrv-btn', type: 'button', onClick: () => setPendingDelete('') }, t.cancel)
                    : null,
                  h('span', { style: { flex: 1 } }),
                  h('span', { className: 'rrv-ed-hint', title: item.id }, `${t.expUpdated} ${String(item.updatedAt ?? '').slice(0, 16).replace('T', ' ')}`),
                ),
                // 口语稿：浅色区块 + 右上角「复制」；再点一次按钮收起
                storyOpen
                  ? h(
                      'div',
                      { className: 'rrv-exp-story' },
                      h(
                        'div',
                        { className: 'rrv-exp-story-head' },
                        h('strong', { style: { fontSize: 12 } }, t.expStory),
                        h('span', { style: { flex: 1 } }),
                        copyNote === '' ? null : h('span', { className: 'rrv-ed-hint', style: { maxWidth: 'none' } }, copyNote),
                        h('button', { className: 'rrv-btn', type: 'button', onClick: () => void copyStory(story) }, t.expCopy),
                      ),
                      h('div', { className: 'rrv-exp-story-body' }, story),
                    )
                  : null,
              )
            : null,
        )
      }

      return h(
        'div',
        { className: 'rrv-exp' },
        h(
          'div',
          { className: 'rrv-exp-head' },
          h('strong', null, t.expTab),
          h('span', { className: 'rrv-ed-note' }, `${items.length} ${t.expCountUnit}`),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'rrv-btn primary', type: 'button', onClick: startNew, disabled: busy }, t.expNew),
        ),
        note === '' ? null : h('div', { className: 'rrv-ed-note', style: { maxWidth: 'none', whiteSpace: 'normal' } }, note),
        renderForm(),
        items.length === 0 && draft === null ? h('div', { className: 'rrv-exp-empty' }, t.expEmpty) : null,
        items.map(renderCard),
        filePath === '' ? null : h('div', { className: 'rrv-ed-hint', style: { marginTop: 'auto', maxWidth: 'none' } }, `${t.expDataFile}：${filePath}`),
      )
    }

    /**
     * 「简历」整页编辑器（主面板）。
     *
     * 形态：左列表 / 中间表单 / 右侧预览位（自研渲染在 M3 落地）。
     * 数据全走 `api/resume-bridge/local/*`，不需要登录、不需要 API key。
     */
    function ResumeEditor() {
      const t = text()
      /** 页签名：'resume' = 简历编辑（原来的整套），'experiences' = 经历库。 */
      const [tab, setTab] = useState('resume')
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
      const [newSection, setNewSection] = useState(null)
      const [pendingDelete, setPendingDelete] = useState(null)
      const [buildNote, setBuildNote] = useState('')
      const [askH, setAskH] = useState(132)
      const [expanded, setExpanded] = useState(false)
      const [pageIndex, setPageIndex] = useState(0)
      const bigFrameRef = React.useRef(null)
      const sheetBoxRef = React.useRef(null)
      const dragRef = React.useRef(null)
      // 导出 PDF 弹窗：选目录 / 文件名；导出后拿截图核照片位置与整体排版。
      const [showExport, setShowExport] = useState(false)
      const [exportFolder, setExportFolder] = useState('')
      const [exportFile, setExportFile] = useState('')
      // 目标路径与覆盖提示一律来自宿主的 `local/plan`（前端不拼路径字符串）
      const [exportPlan, setExportPlan] = useState(null)
      const [exportStale, setExportStale] = useState(false)
      const [exportFolders, setExportFolders] = useState([])
      // 三个勾选框：窗口开着时记住就行，不值得持久化（每次导出都是当场的意思表示）
      const [exportOverwrite, setExportOverwrite] = useState(true)
      const [exportReveal, setExportReveal] = useState(true)
      const [exportShots, setExportShots] = useState(true)
      const [exporting, setExporting] = useState(false)
      const [exportResult, setExportResult] = useState(null)
      const [exportError, setExportError] = useState('')
      // 导出前的第一页缩略图（和导出同一份渲染），以及点开的大图：'html' = 渲染预览，其它 = 截图路径
      const [exportHtml, setExportHtml] = useState('')
      const [exportZoom, setExportZoom] = useState('')
      // 结果卡上「打开文件夹 / 打开 PDF / 复制」的即时反馈：宿主成功与失败都是 200，
      // 不看 `ok` 就永远"点了没反应"—— 那正是这轮报修的原因。
      const [exportFlash, setExportFlash] = useState(null)
      const [copiedPath, setCopiedPath] = useState(false)
      // 会话列表：只读一次，用来渲染绑定目标的名字 / 兜底选择器
      const bridge = useBridge(0)
      const [target, setTarget] = useSessionTarget()
      // 面板占住主视图期间，不让 `uiSession.current` 把绑定带跑
      useEffect(() => {
        panelOpen = true
        return () => {
          panelOpen = false
        }
      }, [])
      const sessions = bridge.data?.sessions ?? []
      const roots = sessions.filter((session) => session.root !== false)
      const targetInfo = sessions.find((session) => session.id === target)
      const targetLabel = targetInfo?.title || (target === '' ? '' : `${target.slice(0, 12)}…`)

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
      /** 当前取景位置（面板里所有展示头像的地方都用它）。 */
      const photoPosition = photoPositionOf(doc?.picture)
      /** 有没有照片：没有就没有"位置"可调，整行藏起来。 */
      const hasPhoto = typeof doc?.picture?.url === 'string' && doc.picture.url !== ''

      /** 保存：只发白名单字段（basics / summary / metadata）。 */
      const save = useCallback(async () => {
        if (doc === null || selected === '') return
        setBusy(true)
        setNote(t.saving)
        try {
          const result = await localPost('local/update', {
            id: selected,
            partial: { basics: doc.basics, summary: doc.summary, metadata: doc.metadata, picture: doc.picture, sections: doc.sections },
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

      /**
       * 拖动照片 = 直接把手指的位移换算成取景位置。
       *
       * 手感按"拖照片"而不是"拖窗口"：往右拖 → 图往右走 → 看到的是左边 ⇒ x 变小。
       * 位移用方框宽高的比例算（框多大都灵），并把结果夹在 0–100，拖出框也不会跑飞。
       * 位置是绝对值（起点快照 + 总位移），所以来回拖不会累积漂移。
       */
      const startPhotoDrag = useCallback((event) => {
        if (typeof event.button === 'number' && event.button !== 0) return
        const frame = event.currentTarget
        const box = frame?.getBoundingClientRect?.()
        if (!box || box.width === 0 || box.height === 0) return
        event.preventDefault()
        const origin = photoPositionOf(doc?.picture)
        const startX = Number(event.clientX) || 0
        const startY = Number(event.clientY) || 0
        try {
          frame.setPointerCapture?.(event.pointerId)
        } catch {
          /* 拖拽捕获不可用时窗口监听照样工作 */
        }
        const move = (moveEvent) => {
          const dx = ((Number(moveEvent.clientX) - startX) / box.width) * 100
          const dy = ((Number(moveEvent.clientY) - startY) / box.height) * 100
          setField('picture.position.x', Math.round(Math.max(0, Math.min(100, origin.x - dx))))
          setField('picture.position.y', Math.round(Math.max(0, Math.min(100, origin.y - dy))))
        }
        const end = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', end)
          window.removeEventListener('pointercancel', end)
          frame.classList?.remove('dragging')
        }
        frame.classList?.add('dragging')
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', end)
        window.addEventListener('pointercancel', end)
      }, [doc, setField])

      /**
       * 把取景位置补进预览 iframe 里的照片。
       *
       * 宿主渲染（compose.js）本来就会写 `object-position`；这一份是兜底：
       * 插件宿主还没重启、跑着老渲染器时，预览也能立刻跟着拖拽变，不用等到重启。
       */
      const applyPhotoPosition = useCallback((frame, current) => {
        const inner = frame?.contentDocument
        if (!inner) return
        const position = photoPositionOf(current?.picture)
        inner.querySelectorAll('img.ph').forEach((image) => {
          image.style.objectPosition = `${position.x}% ${position.y}%`
        })
      }, [])

      // 注意：以前这里有个"导出到对话"（让 agent 调 resume_export）。已删除：
      // `local/export` 直接打印 PDF，不经过模型，也不往对话里塞一句"导出成 PDF"。
      // 那条消息正是把会话写坏的那一条（无 id 的 user/message）。

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

      /**
       * 当前排版模型；缺省就用一页、主栏放**真实存在**的栏目。
       *
       * 这里必须按 `doc.sections` 过滤：排版页里可能留着指向"已不存在的栏目"的引用
       * （比如 RR 里删掉的自定义栏目，或过去某次 patch 留下的残留），
       * 不过滤就会在面板里显示成一串 UUID「乱码块」，而渲染器那边本来就忽略它们。
       * 过滤后只要用户点一次保存，脏引用就被写回了。
       */
      const sectionKinds = Object.keys(doc?.sections ?? {})
      const rawPages =
        Array.isArray(doc?.metadata?.layout?.pages) && doc.metadata.layout.pages.length > 0
          ? doc.metadata.layout.pages
          : [{ main: sectionKinds.slice(), sidebar: [] }]
      const layoutPages = rawPages.map((page) => ({
        ...page,
        main: (page.main ?? []).filter((kind) => sectionKinds.includes(kind)),
        sidebar: (page.sidebar ?? []).filter((kind) => sectionKinds.includes(kind)),
      }))
      // 有栏目没被任何一页收留（新增的、或刚从脏引用里恢复的）：补到最后一页主栏，
      // 与渲染器的 orphan 处理保持一致。
      {
        const placed = new Set(layoutPages.flatMap((page) => [...page.main, ...page.sidebar]))
        const orphans = sectionKinds.filter((kind) => !placed.has(kind))
        if (orphans.length > 0) layoutPages[layoutPages.length - 1].main.push(...orphans)
      }
      const activePage = Math.min(pageIndex, layoutPages.length - 1)

      /** 栏目显示名：优先用简历自己的 `section.title`（正文语言），再退回面板词典。 */
      const sectionLabel = (kind) => doc?.sections?.[kind]?.title || SECTION_LABEL[kind] || kind

      /** 待删除栏目里有多少条内容（确认文案用）。 */
      const pendingDeleteCount =
        pendingDelete === null ? 0 : (doc?.sections?.[pendingDelete.kind]?.items ?? []).length

      /**
       * 新加一个栏目。
       *
       * 自定义栏目在 Reactive Resume 里就是 `sections[<uuid>] = { title, items, ... }`，
       * 这里照同一个形状造一个空栏目，并直接放进当前页的指定栏 —— 不然它会以
       * "没被排版" 的孤儿身份挂在最后一页。
       */
      const addSection = useCallback(
        (name, column) => {
          const title = String(name ?? '').trim() || t.newSectionFallback
          const kind = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `sec-${Date.now()}`
          setDoc((previous) => {
            if (previous === null) return previous
            const sections = { ...(previous.sections ?? {}) }
            sections[kind] = {
              icon: '',
              items: [],
              title,
              hidden: false,
              columns: 1,
              keepTogether: false,
              startOnNewPage: false,
            }
            const metaNext = previous.metadata ?? {}
            const layoutNext = metaNext.layout ?? {}
            const pages =
              Array.isArray(layoutNext.pages) && layoutNext.pages.length > 0
                ? layoutNext.pages.map((page, index) =>
                    index === activePage ? { ...page, [column]: [...(page[column] ?? []), kind] } : page,
                  )
                : [{ main: column === 'main' ? [kind] : [], sidebar: column === 'sidebar' ? [kind] : [] }]
            return { ...previous, sections, metadata: { ...metaNext, layout: { ...layoutNext, pages } } }
          })
          setNote(t.sectionAdded)
        },
        [activePage, t.sectionAdded, t.newSectionFallback],
      )

      /**
       * 删栏目：内容一起删，**并把所有排版页里的引用一起清掉**。
       *
       * 这一步是必须的：只删 sections 而不清 layout，就会留下上一轮那种
       * "悬空 UUID 块"（渲染器忽略、面板显示成一串 id）。
       */
      const removeSection = useCallback(
        (kind) => {
          setDoc((previous) => {
            if (previous === null) return previous
            const sections = { ...(previous.sections ?? {}) }
            delete sections[kind]
            const metaNext = previous.metadata ?? {}
            const layoutNext = metaNext.layout ?? {}
            const pages = Array.isArray(layoutNext.pages)
              ? layoutNext.pages.map((page) => ({
                  ...page,
                  main: (page.main ?? []).filter((item) => item !== kind),
                  sidebar: (page.sidebar ?? []).filter((item) => item !== kind),
                }))
              : layoutNext.pages
            return { ...previous, sections, metadata: { ...metaNext, layout: { ...layoutNext, pages } } }
          })
          setNote(t.sectionRemoved)
        },
        [t.sectionRemoved],
      )

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
                  title: `${sectionLabel(kind)} — ${Number(box?.x ?? 0)},${Number(box?.y ?? 0)}mm`,
                },
                h('span', { className: 'rrv-free-name' }, sectionLabel(kind)),
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
                h('span', null, sectionLabel(kind)),
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
          h(
            'div',
            { className: 'rrv-lay-col-head' },
            label,
            h(
              'button',
              {
                className: 'rrv-lay-add',
                type: 'button',
                title: `${t.addSection}（${column === 'sidebar' ? t.sideCol : t.mainCol}）`,
                onClick: () => setNewSection({ column, name: '' }),
              },
              '＋',
            ),
          ),
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
              h('span', { className: 'rrv-lay-name' }, sectionLabel(kind)),
              h(
                'button',
                {
                  className: 'rrv-lay-x',
                  type: 'button',
                  title: `${t.removeSection}：${sectionLabel(kind)}`,
                  draggable: false,
                  onMouseDown: (event) => event.stopPropagation(),
                  onClick: (event) => {
                    event.stopPropagation()
                    setPendingDelete({ kind })
                  },
                },
                '×',
              ),
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
                    ? h('div', {
                        className: 'rrv-ed-photo-box',
                        title: t.photoDragHint,
                        onPointerDown: startPhotoDrag,
                      },
                        h('img', {
                          className: 'rrv-ed-avatar',
                          src: doc.picture.url,
                          alt: '',
                          draggable: false,
                          style: { objectPosition: `${photoPosition.x}% ${photoPosition.y}%` },
                        }),
                      )
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
                hasPhoto
                  ? h('label', { className: 'rrv-field' },
                      h('span', { className: 'rrv-field-label' }, t.photoPosition),
                      h('span', { className: 'rrv-ed-pos' },
                        h('span', { className: 'rrv-ed-pos-grid' },
                          PHOTO_PRESETS.map(([x, y]) =>
                            h('button', {
                              key: `pos-${x}-${y}`,
                              type: 'button',
                              title: `${x}% / ${y}%`,
                              'aria-label': `${x}% / ${y}%`,
                              className: `rrv-ed-pos-cell${photoPosition.x === x && photoPosition.y === y ? ' active' : ''}`,
                              onClick: () => {
                                setField('picture.position.x', x)
                                setField('picture.position.y', y)
                              },
                            }),
                          ),
                        ),
                        h('button', {
                          className: 'rrv-btn',
                          type: 'button',
                          onClick: () => {
                            setField('picture.position.x', 50)
                            setField('picture.position.y', 50)
                          },
                        }, t.photoCenter),
                        h('span', { className: 'rrv-ed-hint' }, `${photoPosition.x}% · ${photoPosition.y}%`),
                      ),
                    )
                  : null,
                hasPhoto ? h('div', { className: 'rrv-ed-hint' }, t.photoPositionHint) : null,
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
                newSection === null
                  ? null
                  : h(
                      'div',
                      { className: 'rrv-lay-new' },
                      h('input', {
                        className: 'rrv-field-input',
                        placeholder: t.sectionName,
                        value: newSection.name,
                        autoFocus: true,
                        onChange: (event) => setNewSection({ ...newSection, name: event.target.value }),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            addSection(newSection.name, newSection.column)
                            setNewSection(null)
                          }
                          if (event.key === 'Escape') setNewSection(null)
                        },
                      }),
                      h('span', { className: 'rrv-ed-hint' }, newSection.column === 'sidebar' ? t.sideCol : t.mainCol),
                      h(
                        'button',
                        {
                          className: 'rrv-btn primary',
                          type: 'button',
                          onClick: () => {
                            addSection(newSection.name, newSection.column)
                            setNewSection(null)
                          },
                        },
                        t.addSection,
                      ),
                      h('button', { className: 'rrv-btn', type: 'button', onClick: () => setNewSection(null) }, t.cancel),
                    ),
                pendingDelete === null
                  ? null
                  : h(
                      'div',
                      { className: 'rrv-lay-confirm' },
                      h(
                        'span',
                        null,
                        `${t.confirmDeleteSection}「${sectionLabel(pendingDelete.kind)}」？${
                          pendingDeleteCount > 0 ? `含 ${pendingDeleteCount} 条内容，` : ''
                        }${t.confirmDeleteHint}`,
                      ),
                      h('span', { style: { flex: 1 } }),
                      h('button', { className: 'rrv-btn', type: 'button', onClick: () => setPendingDelete(null) }, t.cancel),
                      h(
                        'button',
                        {
                          className: 'rrv-btn primary',
                          type: 'button',
                          onClick: () => {
                            removeSection(pendingDelete.kind)
                            setPendingDelete(null)
                          },
                        },
                        t.deleteSection,
                      ),
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

      /** 把引用 + 诉求发给**绑定的那个会话**，然后切回对话去看结果。 */
      const sendQuoted = useCallback(async () => {
        if (quotes.length === 0 && textQuote === null && quoteText.trim() === '') return
        if (target === '') {
          setNote('还没绑定会话：先在某个对话里打开这个面板，或用下面的会话选择器指定一个。')
          return
        }
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
          const result = await askAgent(target, withDelegationBlock(message), { panel: 'editor' })
          if (result.ok === true) {
            setQuotes([])
            setTextQuote(null)
            setQuoteText('')
            setNote(result.duplicate === true ? '这条已经发过了' : t.sent)
            try {
              ctxRef?.get?.('layout')?.selectPanel?.('conversation')
            } catch {
              /* 切不过去也不影响消息已发出 */
            }
          } else {
            setNote(`发送失败：${result.reason}`)
          }
        } catch (error) {
          setNote(`发送失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy(false)
        }
      }, [quotes, textQuote, quoteText, rows, selected, target, t.sent])

      /**
       * 导出 PDF：渲染 → 打印 → 落进 04-输出 + 逐页截图。
       *
       * 导出成功**不关窗**：窗口原地换成结果卡，"文件在哪、印得对不对"就在眼前。
       * `doc` 是面板里的实时草稿 —— 改了没保存的内容也必须印进这张纸里。
       */
      const exportPdf = useCallback(async () => {
        if (selected === '' || doc === null) return
        setExporting(true)
        setExportError('')
        setExportResult(null)
        setNote(t.exporting)
        try {
          // 用 `postBridge` 而不是 `localPost`：失败时宿主是 400 + `reason`，
          // `localPost` 只会抛 `HTTP 400`，把要显示给用户的原因吞掉。
          const result = await postBridge('local/export', {
            id: selected,
            doc,
            folder: exportFolder.trim(),
            filename: exportFile.trim(),
            overwrite: exportOverwrite ? 'overwrite' : 'version',
            screenshots: exportShots,
            reveal: exportReveal,
          })
          if (result.ok === true) {
            setExportResult(result)
            setNote(`${t.exportedTo}：${result.path}`)
            try {
              await navigator.clipboard.writeText(result.path)
            } catch {
              /* 复制失败不影响导出 */
            }
            return
          }
          // 整台机器既没有 Chromium 也没有 Electron：把 HTML 交给浏览器打印兜底，
          // 排版是同一份，所以照片和分页仍然对得上。
          if (result.needsPrint === true && typeof result.html === 'string') {
            const win = window.open('', '_blank', 'noopener')
            if (win !== null) {
              win.document.write(result.html)
              win.document.close()
              win.setTimeout(() => win.print(), 400)
            }
            setExportError(`宿主没有可用的打印器（${result.reason ?? t.printFallback}）`)
            return
          }
          setExportError(result.error ?? result.reason ?? '未知原因')
        } catch (error) {
          setExportError(error instanceof Error ? error.message : String(error))
        } finally {
          setExporting(false)
        }
      }, [
        selected,
        doc,
        exportFolder,
        exportFile,
        exportOverwrite,
        exportShots,
        exportReveal,
        t.exporting,
        t.exportedTo,
        t.printFallback,
      ])

      /**
       * 复制路径：异步剪贴板 → `execCommand` 兜底 → 按钮上写结果。
       *
       * 旧实现把异常吞掉了，且没有反馈：剪贴板被拒时按钮"点了没反应"，
       * 用户自然判定它坏了。现在三条路走完必须给出一个可见答案。
       */
      const copyPath = useCallback(async (value) => {
        const text = String(value ?? '')
        let copied = false
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text)
            copied = true
          }
        } catch {
          copied = false
        }
        if (!copied) {
          try {
            const area = document.createElement('textarea')
            area.value = text
            area.setAttribute('readonly', '')
            area.style.position = 'fixed'
            area.style.top = '-1000px'
            area.style.opacity = '0'
            document.body.appendChild(area)
            area.select()
            area.setSelectionRange?.(0, text.length)
            copied = document.execCommand?.('copy') === true
            area.remove()
          } catch {
            copied = false
          }
        }
        setCopiedPath(copied)
        setExportFlash(
          copied
            ? { kind: 'ok', text: '路径已复制到剪贴板' }
            : { kind: 'error', text: '复制失败：浏览器不允许写剪贴板，请手动选中路径复制' },
        )
        setTimeout(() => setCopiedPath(false), 1800)
        return copied
      }, [])

      /**
       * 结果卡上的「打开文件夹 / 打开 PDF」。
       *
       * 宿主返回 `{ ok, method, detail }`：成功要说，失败更要说 —— 静默是这轮
       * 报修的根因（宿主上一版其实什么都没打开，却回了 ok）。
       */
      const fileAction = useCallback(async (kind, path) => {
        const target = String(path ?? '')
        if (target === '') return false
        const label = kind === 'reveal' ? '打开文件夹' : '打开 PDF'
        setExportFlash({ kind: 'busy', text: label + '…' })
        try {
          const payload = await postBridge('local/' + kind, { path: target })
          if (payload && payload.ok === true) {
            setExportFlash({ kind: 'ok', text: label + ' 完成' + (payload.detail ? '：' + String(payload.detail) : '（宿主未确认；没看到窗口就重启 DSH）') })
            return true
          }
          const reason = String((payload && (payload.detail || payload.reason)) || '宿主没有给出原因')
          setExportFlash({ kind: 'error', text: label + ' 失败：' + reason })
          return false
        } catch (error) {
          setExportFlash({ kind: 'error', text: label + '失败：' + (error instanceof Error ? error.message : String(error)) })
          return false
        }
      }, [])

      /**
       * 目标路径 / 覆盖谁的提示，永远问宿主（`local/plan`）。
       *
       * 300 ms 防抖：一边打字一边问会把桥打满，而且路径还没定下来时问了也不算数。
       * `exportResult` 也在依赖里 —— 导完一次后同名文件就有了，状态条必须重新问一遍。
       */
      useEffect(() => {
        if (!showExport || selected === '' || doc === null) return undefined
        let cancelled = false
        const timer = setTimeout(() => {
          postBridge('local/plan', {
            id: selected,
            doc,
            folder: exportFolder.trim(),
            filename: exportFile.trim(),
          })
            .then((plan) => {
              if (cancelled) return
              // 旧宿主没有这条路由（404 / 非 JSON）：路径拿不到，但导出本身照旧能点
              const usable = typeof plan?.path === 'string' && plan.path !== ''
              setExportPlan(usable ? plan : null)
              setExportStale(!usable)
            })
            .catch(() => {
              if (cancelled) return
              setExportPlan(null)
              setExportStale(true)
            })
        }, 300)
        return () => {
          cancelled = true
          clearTimeout(timer)
        }
      }, [showExport, exportFolder, exportFile, selected, doc, exportResult])

      /** 已有目录只喂下拉（`state.outputs[].folder`），不参与拼路径。 */
      useEffect(() => {
        if (!showExport) return undefined
        let cancelled = false
        localGet('state')
          .then((state) => {
            if (cancelled) return
            const names = (Array.isArray(state?.outputs) ? state.outputs : [])
              .map((row) => String(row?.folder ?? '').trim())
              .filter((name) => name !== '')
            setExportFolders([...new Set(names)])
          })
          .catch(() => {
            /* 读不到就不给下拉，输入框照样能用 */
          })
        return () => {
          cancelled = true
        }
      }, [showExport])

      /**
       * 导出前的第一页缩略图：走 `local/render`（和预览、导出同一份排版，照片已内联）。
       * 这才是"照片印得对吗"能在按下按钮之前就被看到的原因。
       */
      useEffect(() => {
        if (!showExport || doc === null) return undefined
        let cancelled = false
        const timer = setTimeout(() => {
          localHtml('local/render', { doc, locale: doc?.metadata?.page?.locale })
            .then((html) => {
              if (!cancelled && typeof html === 'string') setExportHtml(html)
            })
            .catch(() => {
              if (!cancelled) setExportHtml('')
            })
        }, 250)
        return () => {
          cancelled = true
          clearTimeout(timer)
        }
      }, [showExport, doc])

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
       * 上传参考图 → 派一个**不带对话上下文**的子 agent 照图做模板。
       *
       * 走 `/template-build` 直连宿主：不经过 lead、不进对话上下文。
       * 任务书由插件代码拼（`worker-brief.js`），子 agent 自己 read_image 看图、
       * 产出 manifest、`resume_template(save)` 入库、preview 自检。
       * 面板这边只轮询模板库等新 id 出现。
       */
      const createTemplateFromImage = useCallback(
        async (file) => {
          if (!file) return
          if (target === '') {
            setBuildNote('还没绑定会话：先在某个对话里打开这个面板，再上传参考图。')
            return
          }
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
            const dispatched = await postBridge('template-build', {
              sessionId: target,
              imagePath: uploaded.path,
              name: file.name.replace(/\.[^.]+$/, ''),
            })
            if (dispatched.ok !== true) {
              setBuilding(null)
              setBuildNote(`${t.templateUploadFailed}：${dispatched.reason ?? ''}`)
              return
            }
            setBuildNote(`${t.templateBuilding}（子 agent ${String(dispatched.childId).slice(0, 12)}…）`)
          } catch (error) {
            setBuilding(null)
            setBuildNote(`${t.templateUploadFailed}：${error instanceof Error ? error.message : String(error)}`)
          }
        },
        [t.templateBuilding, t.templateUploading, target],
      )

      /**
       * 模板画廊：内置 15 个 + 自定义模板各渲一张小样（用当前文档，未保存改动也算）。
       *
       * 自定义模板也必须在这张表里渲 —— 以前只渲内置那 15 个，所以自定义卡片永远显示
       * "加载中…"（`thumbs[id]` 根本没被填过）。
       */
      useEffect(() => {
        if (!showTemplates || doc === null) return undefined
        let cancelled = false
        const galleryIds = [
          ...TEMPLATES,
          ...customTemplates.map((row) => row.id).filter((id) => !TEMPLATES.includes(id)),
        ]
        Promise.all(
          galleryIds.map(async (template) => {
            try {
              const html = await localHtml('local/render', {
                doc: { ...doc, metadata: { ...(doc.metadata ?? {}), template } },
                locale: doc?.metadata?.page?.locale,
              })
              return [template, html]
            } catch {
              // 记一个"失败"标记而不是空串：空串和"还没渲完"长得一样，卡片会永远转圈。
              return [template, 'render-failed']
            }
          }),
        ).then((pairs) => {
          if (!cancelled) setThumbs(Object.fromEntries(pairs))
        })
        return () => {
          cancelled = true
        }
      }, [showTemplates, doc, customTemplates])

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
                onLoad: () => {
                  attachQuoteHandlers(frameRef.current)
                  applyPhotoPosition(frameRef.current, doc)
                },
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
            h(
              'span',
              { className: 'rrv-ed-hint', title: target },
              target === '' ? '未绑定会话：先在某个对话里打开这个面板' : `${t.targetSession}：${targetLabel}`,
            ),
            roots.length > 1
              ? h(
                  'select',
                  {
                    className: 'rrv-select',
                    value: target,
                    title: t.targetSession,
                    onChange: (event) => setTarget(event.target.value),
                  },
                  roots.map((session) =>
                    h('option', { key: session.id, value: session.id }, session.title || session.id.slice(0, 8)),
                  ),
                )
              : null,
            h(
              'button',
              {
                className: 'rrv-btn primary',
                type: 'button',
                onClick: () => void sendQuoted(),
                disabled: busy || target === '' || (quotes.length === 0 && textQuote === null && quoteText.trim() === ''),
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
                    thumbs[template] === 'render-failed'
                      ? h('span', { className: 'rrv-gal-loading' }, t.previewFailed)
                      : thumbs[template]
                        ? h('iframe', { srcDoc: thumbs[template], title: template, className: 'rrv-gal-frame', scrolling: 'no' })
                        : h('span', { className: 'rrv-gal-loading' }, t.loading),
                  ),
                  // 自定义模板显示它自己的名字（manifest.label），不是那串 31 位 id
                  h(
                    'span',
                    { className: 'rrv-gal-name', title: template },
                    customTemplates.find((row) => row.id === template)?.label || template,
                  ),
                )
              }),
            ),
          ),
        )

      /**
       * 导出结果卡：导出成功后就地换掉表单，"文件在哪、印得对不对"一眼可见。
       * 路径原样显示（不改写成相对路径）：人是要拿去粘贴到别处的。
       */
      const renderExportResult = () => {
        const result = exportResult
        const shots = (Array.isArray(result?.screenshots) ? result.screenshots : []).filter((row) => typeof row === 'string' && row !== '')
        const previous = result?.previous ?? null
        return h(
          'div',
          { style: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' } },
          h(
            'div',
            { style: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-state-success-primary)' } },
            `✓ 已导出 · ${Number(result?.pages ?? 0)} 页 · ${Math.max(0, Math.round(Number(result?.bytes ?? 0) / 1024))} KB · ${(Number(result?.ms ?? 0) / 1000).toFixed(1)} s`,
          ),
          // 串页了就别当成功庆祝：这条红字是"缩内容或调小字号"的唯一提示
          result?.overflow === true
            ? h(
                'div',
                { style: { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-state-error-primary, #dc2626)' } },
                `内容溢出到第 ${Number(result?.pages ?? result?.sheets ?? 0)} 页（串页了）：缩内容或调小字号`,
              )
            : null,
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
            h(
              'code',
              {
                title: String(result?.path ?? ''),
                style: {
                  flex: 1,
                  minWidth: 0,
                  fontSize: 11,
                  fontFamily: 'var(--ds-font-family-code)',
                  wordBreak: 'break-all',
                  color: 'var(--dsw-alias-label-secondary)',
                },
              },
              String(result?.path ?? ''),
            ),
            h('button', {
              className: 'rrv-btn' + (copiedPath ? ' primary' : ''),
              type: 'button',
              title: '复制路径',
              onClick: () => void copyPath(result?.path),
            }, copiedPath ? '已复制' : '复制'),
          ),
          result?.overwrote === true && previous !== null
            ? h('div', { className: 'rrv-ed-hint' }, `已覆盖旧文件（${Number(previous.bytes ?? 0)} B · ${shortTime(previous.mtime) || String(previous.mtime ?? '')}）`)
            : null,
          shots.length === 0
            ? null
            : h(
                'div',
                { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
                shots.map((shot, index) =>
                  h('img', {
                    key: shot,
                    src: `${BRIDGE}/local/file?path=${encodeURIComponent(shot)}`,
                    alt: `第 ${index + 1} 页`,
                    title: '点开看大图',
                    onClick: () => setExportZoom(shot),
                    style: {
                      width: 150,
                      borderRadius: 6,
                      background: '#fff',
                      border: '1px solid var(--dsw-alias-border-l1)',
                      cursor: 'zoom-in',
                    },
                  }),
                ),
              ),
          exportError === ''
            ? null
            : h(
                'div',
                { style: { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-state-error-primary, #dc2626)', whiteSpace: 'normal' } },
                `导出失败：${exportError}`,
              ),
          h(
            'div',
            { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h(
              'button',
              {
                className: 'rrv-btn',
                type: 'button',
                disabled: String(result?.path ?? '') === '',
                // 文件在哪这一步不该让人自己找：在资源管理器里选中它
                onClick: () => void fileAction('reveal', result?.path),
              },
              '打开文件夹',
            ),
            h(
              'button',
              {
                className: 'rrv-btn',
                type: 'button',
                disabled: String(result?.path ?? '') === '',
                onClick: () => void fileAction('open', result?.path),
              },
              '打开 PDF',
            ),
            h(
              'button',
              {
                className: 'rrv-btn primary',
                type: 'button',
                disabled: exporting,
                // 回到表单态再导一次：参数都还在，人只需要改想改的那一项
                onClick: () => {
                  setExportResult(null)
                  setExportError('')
                  void exportPdf()
                },
              },
              exporting ? '导出中…' : '再导一次',
            ),
            h('span', { style: { flex: 1 } }),
            h('button', { className: 'rrv-btn', type: 'button', onClick: () => setShowExport(false) }, t.close),
          ),
          // 点了之后到底发生了什么：成功是信息，失败更是（宿主回 200 也可能是失败）。
          exportFlash === null
            ? null
            : h(
                'div',
                {
                  style: {
                    fontSize: 11,
                    lineHeight: 1.6,
                    color:
                      exportFlash.kind === 'error'
                        ? 'var(--dsw-alias-state-error-primary, #dc2626)'
                        : 'var(--dsw-alias-label-secondary)',
                  },
                },
                String(exportFlash.text ?? ''),
              ),
        )
      }

      /**
       * 导出窗口。
       *
       * 它是窗口而不是两个输入框：文件落哪、会不会盖掉旧的、照片印得对吗 ——
       * 这三个问题必须在按下按钮**之前**就有答案，而不是导完再用一句报错回答。
       */
      const renderExportWindow = () => {
        const resumeName = rows.find((row) => row.id === selected)?.name ?? String(doc?.basics?.name ?? '')
        const template = String(doc?.metadata?.template ?? '')
        // 照片 `data:` 与 http 都算有；`hidden` 才是"故意不印"（渲染器认这两个位置）
        const pictureUrl = String(doc?.picture?.url ?? '')
        const hasPhoto = pictureUrl !== '' && doc?.picture?.hidden !== true && doc?.picture?.effects?.hidden !== true
        const canExport = doc !== null && selected !== ''
        const planPath = String(exportPlan?.path ?? '')
        const exists = exportPlan?.exists === true
        const row = (label, control) =>
          h(
            'div',
            { style: { display: 'grid', gridTemplateColumns: '52px minmax(0,1fr)', alignItems: 'center', gap: 10 } },
            h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, label),
            control,
          )
        const tick = (label, checked, onChange) =>
          h(
            'label',
            { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' } },
            h('input', { type: 'checkbox', checked, onChange: (event) => onChange(event.target.checked) }),
            label,
          )
        return [
          h(
            'div',
            { key: 'export-window', className: 'rrv-gal-mask', onClick: () => setShowExport(false) },
            h(
              'div',
              { className: 'rrv-gal', style: { width: 520, maxWidth: '94vw', maxHeight: '88vh' }, onClick: (event) => event.stopPropagation() },
              h(
                'div',
                { className: 'rrv-gal-bar' },
                h('strong', null, `${t.exportPdf} · ${resumeName === '' ? '（未命名）' : resumeName}`),
                h('span', { style: { flex: 1 } }),
                h('button', { className: 'rrv-btn', type: 'button', onClick: () => setShowExport(false) }, t.close),
              ),
              // 旧宿主没有 local/plan：路径与覆盖提示给不出来，但导出本身照旧能点
              exportStale ? h('div', { className: 'rrv-gal-note' }, '导出宿主是旧版本，重启 DSH 后生效') : null,
              exportResult !== null
                ? renderExportResult()
                : h(
                    'div',
                    { style: { padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' } },
                    row(
                      '简历',
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' } },
                        h(
                          'select',
                          {
                            className: 'rrv-select',
                            value: selected,
                            onChange: (event) => setSelected(event.target.value),
                            title: '换一份简历（导出的是这一份的当前草稿）',
                          },
                          rows.length === 0
                            ? h('option', { value: '' }, '（没有简历）')
                            : rows.map((item) => h('option', { key: item.id, value: item.id }, item.name || item.slug || item.id)),
                        ),
                        h('span', { className: 'rrv-sub' }, `模板 ${template === '' ? '—' : template}`),
                        h(
                          'span',
                          {
                            className: 'rrv-sub',
                            style: { color: hasPhoto ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)' },
                          },
                          hasPhoto ? '照片 ✓' : '无照片 ⚠',
                        ),
                      ),
                    ),
                    row(
                      '目录',
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
                        h('input', {
                          className: 'rrv-input',
                          style: { flex: 1, minWidth: 0 },
                          value: exportFolder,
                          placeholder: '默认用简历名',
                          onChange: (event) => setExportFolder(event.target.value),
                        }),
                        h(
                          'select',
                          {
                            className: 'rrv-select',
                            value: exportFolders.includes(exportFolder) ? exportFolder : '',
                            title: '已有目录',
                            onChange: (event) => {
                              if (event.target.value !== '') setExportFolder(event.target.value)
                            },
                          },
                          h('option', { value: '' }, '已有…'),
                          exportFolders.map((name) => h('option', { key: name, value: name }, name)),
                        ),
                      ),
                    ),
                    row(
                      '文件名',
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
                        h('input', {
                          className: 'rrv-input',
                          style: { flex: 1, minWidth: 0 },
                          value: exportFile,
                          placeholder: '默认 <目录>-CV',
                          onChange: (event) => setExportFile(event.target.value),
                        }),
                        h('span', { className: 'rrv-sub' }, '.pdf'),
                      ),
                    ),
                    // 目标路径来自宿主：前端拼字符串迟早和宿主的清洗规则对不上
                    h(
                      'div',
                      { style: { display: 'grid', gridTemplateColumns: '52px minmax(0,1fr)', alignItems: 'start', gap: 10 } },
                      h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, '目标'),
                      h(
                        'code',
                        {
                          title: planPath,
                          style: {
                            fontSize: 11,
                            lineHeight: 1.5,
                            fontFamily: 'var(--ds-font-family-code)',
                            wordBreak: 'break-all',
                            color: 'var(--dsw-alias-label-secondary)',
                          },
                        },
                        planPath === '' ? (exportStale ? '（宿主旧版本，无法预演路径）' : '算路中…') : planPath,
                      ),
                    ),
                    h(
                      'div',
                      {
                        style: {
                          fontSize: 12,
                          color: exists ? 'var(--dsw-alias-state-error-primary, #dc2626)' : 'var(--dsw-alias-state-success-primary)',
                        },
                      },
                      exists
                        ? `● 将覆盖已有文件（${(Number(exportPlan?.bytes ?? 0) / 1024).toFixed(1)} KB · ${shortTime(exportPlan?.mtime) || '时间未知'}）`
                        : '● 新文件',
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' } },
                      tick('覆盖同名文件', exportOverwrite, setExportOverwrite),
                      tick('导出后打开文件夹', exportReveal, setExportReveal),
                      tick('逐页截图核排版', exportShots, setExportShots),
                    ),
                    // 导出前的第一页：和预览、导出是同一份渲染（照片已内联），
                    // 所以它上面照片的样子就是纸面上的样子。
                    h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' } },
                      h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, '预览（第一页）'),
                      h(
                        'div',
                        {
                          title: '点开看大图',
                          onClick: () => {
                            if (exportHtml !== '') setExportZoom('html')
                          },
                          style: {
                            width: 334,
                            height: 472,
                            overflow: 'hidden',
                            borderRadius: 8,
                            border: '1px solid var(--dsw-alias-border-l1)',
                            background: '#fff',
                            cursor: exportHtml === '' ? 'default' : 'zoom-in',
                          },
                        },
                        exportHtml === ''
                          ? h(
                              'div',
                              {
                                style: {
                                  width: '100%',
                                  height: '100%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 11,
                                  color: 'var(--dsw-alias-label-secondary)',
                                },
                              },
                              previewError !== '' ? t.previewFailed : t.loading,
                            )
                          : h('iframe', {
                              title: 'export-preview',
                              srcDoc: exportHtml,
                              sandbox: '',
                              scrolling: 'no',
                              style: { width: 794, height: 1123, border: 0, transform: 'scale(.42)', transformOrigin: 'top left' },
                            }),
                      ),
                    ),
                    exportError === ''
                      ? null
                      : h(
                          'div',
                          { style: { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-state-error-primary, #dc2626)', whiteSpace: 'normal' } },
                          `导出失败：${exportError}`,
                        ),
                  ),
              exportResult !== null
                ? null
                : h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        gap: 8,
                        justifyContent: 'flex-end',
                        padding: '12px 16px',
                        borderTop: '1px solid var(--dsw-alias-border-l1)',
                      },
                    },
                    h('button', { className: 'rrv-btn', type: 'button', onClick: () => setShowExport(false) }, '取消'),
                    h(
                      'button',
                      { className: 'rrv-btn primary', type: 'button', disabled: exporting || !canExport, onClick: () => void exportPdf() },
                      exporting ? '导出中…' : t.exportPdf,
                    ),
                  ),
            ),
          ),
          exportZoom === ''
            ? null
            : h(
                'div',
                { key: 'export-zoom', className: 'rrv-gal-mask', onClick: () => setExportZoom('') },
                h(
                  'div',
                  { className: 'rrv-zoom', onClick: (event) => event.stopPropagation() },
                  h(
                    'div',
                    { className: 'rrv-gal-bar' },
                    h('strong', null, exportZoom === 'html' ? '预览（第一页）' : '导出截图'),
                    h('span', { style: { flex: 1 } }),
                    h('button', { className: 'rrv-btn', type: 'button', onClick: () => setExportZoom('') }, t.close),
                  ),
                  h(
                    'div',
                    { className: 'rrv-zoom-body' },
                    exportZoom === 'html'
                      ? h('iframe', { title: 'export-preview-large', srcDoc: exportHtml, sandbox: '', className: 'rrv-zoom-frame' })
                      : h('img', {
                          src: `${BRIDGE}/local/file?path=${encodeURIComponent(exportZoom)}`,
                          alt: '导出截图',
                          style: { display: 'block', maxWidth: '100%', margin: '0 auto', background: '#fff' },
                        }),
                  ),
                ),
              ),
        ]
      }

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
          // 页签：简历编辑 / 经历库。只在头部加一个分支，两边的状态彼此独立。
          h(
            'div',
            { className: 'rrv-tabs', role: 'tablist' },
            h(
              'button',
              {
                className: `rrv-tab${tab === 'resume' ? ' active' : ''}`,
                type: 'button',
                role: 'tab',
                'aria-selected': tab === 'resume',
                onClick: () => setTab('resume'),
              },
              t.view,
            ),
            h(
              'button',
              {
                className: `rrv-tab${tab === 'experiences' ? ' active' : ''}`,
                type: 'button',
                role: 'tab',
                'aria-selected': tab === 'experiences',
                onClick: () => {
                  setTab('experiences')
                  // 切走时把简历那边的浮层收掉，免得压在新的页签上
                  setShowTemplates(false)
                  setExpanded(false)
                },
              },
              t.expTab,
            ),
          ),
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
          // 以下都是简历页签专属的动作；在「经历库」页签上收起来（省得点了没反应）
          tab !== 'resume' ? null : h('button', { className: 'rrv-btn', type: 'button', onClick: () => setShowTemplates(true), disabled: doc === null }, t.templateGallery),
          tab !== 'resume' || note === '' ? null : h('span', { className: 'rrv-ed-note' }, note),
          h('span', { style: { flex: 1 } }),
          tab !== 'resume' ? null : h('button', {
            className: 'rrv-btn primary',
            type: 'button',
            title: '导出成 PDF，落进 04-输出，并逐页截图核排版',
            onClick: () => {
              const name = rows.find((row) => row.id === selected)?.name ?? ''
              setExportFolder(name)
              setExportFile(name ? `${name}-CV.pdf` : '')
              // 每次打开都是一次新导出：上一次的结果卡与路径提示不该冒充这一次
              setExportResult(null)
              setExportError('')
              setExportPlan(null)
              setExportStale(false)
              setExportHtml('')
              setExportZoom('')
              setShowExport(true)
            },
            disabled: busy || doc === null,
          }, t.exportPdf),
          tab !== 'resume' ? null : h('button', { className: 'rrv-btn primary', type: 'button', onClick: () => void save(), disabled: busy || doc === null }, busy ? t.saving : t.save),
        ),
        // 唯一的切换点：简历页签渲染原来的三栏；经历库渲染卡片列表。
        tab === 'experiences'
          ? h(ExperienceLibrary)
          : h(
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
        tab === 'resume' && showTemplates ? renderGallery() : null,
        // 导出窗口：算路 → 确认 → 结果卡，全在窗口里完成（原来那两个裸输入框已经不够用了）
        tab === 'resume' && showExport ? renderExportWindow() : null,
        tab === 'resume' && expanded
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
                  h('iframe', {
                    ref: bigFrameRef,
                    title: 'preview-large',
                    srcDoc: previewHtml,
                    className: 'rrv-zoom-frame',
                    onLoad: () => applyPhotoPosition(bigFrameRef.current, doc),
                  }),
                ),
              ),
            )
          : null,
      )
    }

    /**
     * `2026-11-09T19:13:35.000Z` → `11-09 20:13`（本地时间）。
     *
     * 覆盖提示里只关心"这是不是我刚覆盖的那一份"，日期年份和秒都是噪音；
     * 解析不了就返回空串，让调用方退回原样显示，别印一个 Invalid Date。
     */
    function shortTime(value) {
      if (value === null || value === undefined || value === '') return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (number) => String(number).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
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
      // `uiSession` 用来拿"进入面板时所在的那个对话"（见 useSessionTarget）。
      inject: ['slots', 'uiSession'],
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
