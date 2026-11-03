/**
 * 数据层自检（不经过 DSH 宿主，直接用 psql）：
 *   node tools/verify-db.mjs            列出简历（id/名字/模板/语言）
 *   node tools/verify-db.mjs <id>       读一份简历的文档摘要
 *   node tools/verify-db.mjs --new 测试  新建并打印 id（会写库！先备份）
 *
 * 只读是默认行为；任何写操作都需要显式参数。
 */
import { normalizeConfig } from '../lib/config.js'
import { createStore } from '../lib/db.js'

const config = normalizeConfig({})
const store = createStore(config)
const action = process.argv[2] ?? ''

if (action === '--new') {
  const name = process.argv[3] ?? '测试简历'
  const created = await store.create(name, AbortSignal.timeout(20_000))
  console.log(JSON.stringify(created, null, 2))
} else if (action !== '') {
  const resume = await store.get(action, AbortSignal.timeout(20_000))
  if (resume.error !== undefined) {
    console.log(`读取失败：${resume.error}`)
    process.exitCode = 1
  } else {
    const data = resume.data
    console.log(
      JSON.stringify(
        {
          id: resume.id,
          name: resume.name,
          slug: resume.slug,
          template: data?.metadata?.template,
          locale: data?.metadata?.page?.locale,
          paper: data?.metadata?.page?.format,
          primary: data?.metadata?.theme?.primary,
          fontBody: data?.metadata?.typography?.body?.fontFamily,
          basicsKeys: Object.keys(data?.basics ?? {}),
          sections: Object.fromEntries(
            Object.entries(data?.sections ?? {}).map(([key, value]) => [key, (value?.items ?? []).length]),
          ),
          topKeys: Object.keys(data ?? {}),
        },
        null,
        2,
      ),
    )
  }
} else {
  const listed = await store.list(AbortSignal.timeout(20_000))
  if (listed.error !== undefined) {
    console.log(`列出失败：${listed.error}`)
    process.exitCode = 1
  } else {
    console.log(`${listed.resumes.length} 份简历`);
    for (const row of listed.resumes) {
      console.log(`  ${row.name}  [${row.template || '-'} / ${row.locale || '-'}]  ${row.updated_at}  id=${row.id}`)
    }
  }
}
