/**
 * 验证「UI 桥在服务迟到时仍然挂上」。
 *
 * 现场症状（真实报错）：打开「简历」面板，顶部写着
 *   `读列表失败：HTTP 404`，左栏永远是 `还没有简历`；
 *   `GET /resume-diag2` 也是 404，而 `bash`/工具侧的 `resume_doctor` 一切正常。
 *
 * 根因：插件行只 `inject: ['tools','skills']`，所以 `apply()` 常常跑在
 * `connection` / `webServer` 创建之前。`ctx.get('connection')` 那一刻是 undefined，
 * 旧实现直接 return —— 一条路由都没注册，浏览器就吃到 404。
 *
 * 本脚本用桩上下文复刻这个时序：
 *   1. apply() 时两个服务都不存在；
 *   2. 之后 `connection` / `webServer` 才出现（cordis 的可选注入语义）；
 *   3. 断言桥路由与自检路由都挂上了。
 * 另测宿主没有 `ctx.inject` 时的即时取用退路。
 *
 * 用法：node tools/verify-bridge-late.mjs
 */
const plugin = await import('../index.js')

const EXPECTED = [
  'state',
  'service',
  'ask',
  'template-build',
  'local/list',
  'local/get',
  'local/update',
  'local/create',
  'local/render',
  'local/export',
  // 导出重建后新增：导出前算路径/覆盖、导出后选中文件、打开 PDF、给窗口看缩略图
  'local/plan',
  'local/reveal',
  'local/open',
  'local/file',
  'local/templates',
  'local/template-save',
  'local/template-delete',
  'local/template-upload',
  'experiences',
  'experiences/save',
  'experiences/delete',
]

let failures = 0
function check(label, condition, detail) {
  if (condition) console.log(`  ✓ ${label}`)
  else {
    failures += 1
    console.log(`  ✗ ${label}${detail === undefined ? '' : `\n      ${String(detail)}`}`)
  }
}

/**
 * 造一个桩上下文：`inject` 把回调排队，等服务"出现"时再执行。
 * @returns 桩上下文与手动触发服务到达的把手。
 */
function makeCtx() {
  const fetchRoutes = []
  const webRoutes = []
  const queued = []
  const logs = []
  const connection = {
    fetch: {
      register(route) {
        if (fetchRoutes.some((row) => row.path === route.path)) {
          throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`)
        }
        fetchRoutes.push(route)
        return () => {}
      },
    },
  }
  const webServer = {
    register(route) {
      if (webRoutes.some((row) => row.path === route.path)) {
        throw new Error(`webserver: duplicate exact route "${route.path}"`)
      }
      webRoutes.push(route)
      return () => {}
    },
  }
  const services = new Map()
  const ctx = {
    tools: { register: () => () => {} },
    skills: { register: () => {} },
    get(name) {
      return services.get(name)
    },
    inject(deps, callback) {
      queued.push({ deps: [...deps], callback })
      return () => {}
    },
    effect(callback) {
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    logger: {
      info: (m) => logs.push(`info: ${m}`),
      warn: (m) => logs.push(`warn: ${m}`),
    },
  }
  /** 让某个服务"到达"：登记后再跑等待它的可选注入回调。 */
  const arrive = (name, value) => {
    services.set(name, value)
    for (const entry of queued.slice()) {
      if (!entry.deps.includes(name)) continue
      const delivered = Object.fromEntries(entry.deps.map((dep) => [dep, services.get(dep)]))
      queued.splice(queued.indexOf(entry), 1)
      entry.callback({ ...delivered, get: (key) => services.get(key), logger: ctx.logger })
    }
  }
  return { ctx, arrive, fetchRoutes, webRoutes, logs, connection, webServer }
}

console.log('简历助手 · UI 桥迟到注册验证')

// 场景 A：apply 时两个服务都没有（现场的真实时序）
{
  console.log('\n[A] apply 早于 connection / webServer')
  const stub = makeCtx()
  stub.ctx.tools.register = (definition) => {
    void definition
    return () => {}
  }
  plugin.apply(stub.ctx, {})
  check('apply 时未注册任何 /api 路由（复刻现场）', stub.fetchRoutes.length === 0)
  check('apply 时未注册 /resume-diag2（复刻现场）', stub.webRoutes.length === 0)

  stub.arrive('connection', stub.connection)
  const paths = stub.fetchRoutes.map((row) => row.path)
  check(`connection 到达后挂上 ${EXPECTED.length} 条桥路由`, stub.fetchRoutes.length === EXPECTED.length, `实际 ${stub.fetchRoutes.length}: ${paths.join(', ')}`)
  for (const name of EXPECTED) {
    check(`  ${name}`, paths.includes(`/api/resume-bridge/${name}`))
  }
  const state = stub.fetchRoutes.find((row) => row.path === '/api/resume-bridge/state')
  check('state 路由允许 GET', state?.methods?.includes('GET') === true)
  check('state 路由请求体模式为 buffered', state?.requestBody === 'buffered')
  check('state 路由带 fetch 处理器', typeof state?.fetch === 'function')

  stub.arrive('webServer', stub.webServer)
  check('/resume-diag2 在 webServer 到达后挂上', stub.webRoutes.some((row) => row.path === '/resume-diag2'))
  check('重复到达不重复注册（幂等）', stub.fetchRoutes.length === EXPECTED.length)
}

// 场景 B：宿主没有可选注入，但服务在 apply 时已存在
{
  console.log('\n[B] 宿主没有 ctx.inject，服务已就绪')
  const stub = makeCtx()
  const { inject, ...plain } = stub.ctx
  void inject
  const immediate = {
    ...plain,
    get(name) {
      if (name === 'connection') return stub.connection
      if (name === 'webServer') return stub.webServer
      return undefined
    },
  }
  plugin.apply(immediate, {})
  check('立即挂上全部桥路由', stub.fetchRoutes.length === EXPECTED.length, `实际 ${stub.fetchRoutes.length}`)
  check('立即挂上 /resume-diag2', stub.webRoutes.some((row) => row.path === '/resume-diag2'))
}

console.log('')
if (failures === 0) {
  console.log('结论：迟到注册已修复 ✓')
  process.exit(0)
}
console.log(`结论：${failures} 项未通过 ✗`)
process.exit(1)
