# 简历助手（插件版）

本机有一整套自建的简历工具：**Reactive Resume + 便携版 PostgreSQL**，项目在
`<RESUME_HOME>\简历助手`。

这份 skill 与这些工具都由插件 `dsh-resume-assistant` 提供。**优先用工具，不要手搓命令行。**

## 界面在哪

- **左栏「简历」入口 → 整页编辑器**：左边简历列表、中间表单、右边 A4 预览（可缩放、可拖选引用块）。
  底部是给 agent 的输入框，**旁边写着这条会发到哪个会话**（面板会绑定"你打开它时所在的对话"）。
- **「排版与分页」**：两栏（主栏 / 侧栏）里拖动栏目即可换栏换页；栏头的 `＋` 新建一个自定义栏目
  （`sections[<uuid>]`，标题就是栏目名），栏目块上的 `×` 删除、**删前要确认**（会显示里面有几条内容）。
  增删都只改草稿，点「保存」才写库，写前自动备份。新栏目是空的——往里填内容用
  `resume_dispatch`（`paths` 指 `/sections/<uuid>/items/0`）或 `resume_patch`。
- **模板入口**在预览工具条上：15 个内置模板的小样 + 「用参考图做模板」（上传一张截图，
  插件直接派一个子 agent 照图做，做完入库并出现在画廊里）。
- **导出 PDF** 是纯本地按钮（宿主 Electron 打印），**不经过模型、不进对话**。
- **用户在界面上选中了某一块**再来问你时，消息里会带 `选中块：/sections/experience/items/2` 这样的
  结构地址 —— 拿它当 `resume_dispatch` 的 `paths`，不要另猜坐标。

## 分工：你说话，简历助手动手

**简历的编辑/排版/美化默认交给「简历助手」子 agent**（`resume_dispatch`）。它**不继承对话上下文**，
只拿到你填的四样东西：`intent`（要什么）、`resumeId`、`paths`（目标 JSON Pointer）、
`excerpt`（要写成的原话）。它自己 `resume_show` 读全文、只改这些 path、改完复核，
然后用完成通知把"改了哪些 path"回给你，你再汇总给用户。

这样做的理由：简历正文动辄上万字，让主对话读一遍、再复述一遍进子 agent，等于同一个 payload
付两次钱，而且复述会丢字段、改错事实。你只负责**决策**，事实让子 agent 自己取。

什么时候**不**派：

- 用户只是问问题、看简历、比较模板 —— 直接回答；
- 用户明确给了"把 `/metadata/design/colors/primary` 设成 `rgba(37,99,235,1)`"这种**单字段确定值** ——
  直接 `resume_patch` 更快更准；
- `resume_dispatch` 报"没有 subagents 服务" —— 降级成你自己 `resume_patch`，并告诉用户这次是直改的。

**服务随插件自动启动**：插件激活 1.5s 后自己调 `service.start()`（`config.autoStart: false` 可关）。
所以正常重启 DSH 之后服务就在跑，不需要你先动手；`resume_service(status)` 只用来确认。

## 第 0 步：先自检；服务没跑就自己起

```
resume_doctor            # 服务 / 钥匙 / 接口一次报出
resume_service(start)    # 服务没跑时：直接起，别让用户去双击 bat
```

`resume_service` 由**宿主插件进程**拉起服务（`pg_ctl` 启动数据库 → detached node 起应用 → 等
`/api/health` 200），不经过沙箱里的命令调用，所以不会随工具调用结束被杀。action 取值
`start` / `stop` / `status`，`start` 幂等。

> 仍然不要用 shell 去跑 `start-services.mjs`、`postgres.exe` 或 `rr.mjs` 来自启服务 ——
> 那条路依旧会留下黑窗和数据库崩溃循环。要起服务就调 `resume_service`。

**HTTP 401（MCP 鉴权失败）**：`03-脚本\rr-key.txt` 里的钥匙失效。只能让用户在
http://localhost:3000 登录后进 **Account → API Keys** 新建一个，把新 key 整行写回 `rr-key.txt`。
这个 key 是 salted hash 校验的，**无法手工构造、无法从数据库还原**。此时 UI 的简历下拉会是空的
（正常降级），但面板里的编辑器本身照常可用。

## 工具

| 工具 | 作用 |
|---|---|
| `resume_service` | 服务开关与状态（start / stop / status） |
| `resume_doctor` | 自检：钥匙文件、输出目录、服务、MCP 鉴权 |
| `resume_list` | 列出所有简历（名字 / id / slug / 更新时间） |
| `resume_show` | **看简历概要**（默认紧凑；`full: true` 才是完整 JSON） |
| `resume_dispatch` | **把编辑/排版任务派给「简历助手」子 agent**（不继承上下文，完成通知回你） |
| `resume_patch` | 套用 RFC 6902 JSON Patch 改模板/配色/字体/布局/内容 |
| `resume_photo` | 上传本地图片并写进简历头像 |
| `resume_export` | 导出 PDF 到 `04-输出\<人名>\` 并更新 `_索引.md` |
| `resume_new` | 新建简历（可带示例数据、指定模板） |

## 铁律

1. **不要用 shell 自启服务**：要起服务用 `resume_service(start)`（见上）。
2. **改之前先确认对象**：`resume_show` 拿到 id 与当前 template，别凭记忆猜。
3. **中文直接写在工具参数里**：`resume_patch` 的 `operations` 由插件写成 UTF-8 无 BOM 临时文件，
   不需要（也不要）自己在命令行里拼 JSON。
4. **产出统一进 `04-输出\<人名>\`**：`resume_export` 已经自动做这件事并维护 `_索引.md`；
   不要往别处写 PDF，也不要手工改索引。
5. **导出后把绝对路径给用户。**
6. **隐私**：简历数据全在本机。`03-脚本\rr-key.txt` 是钥匙，**绝不外发、绝不写进任何对外内容**；
   汇报时不要回显 key 内容。

## 省 token

`resume_show` 默认只回紧凑概要（模板、主色、字体、纸张、分页、可见栏目、头像状态）。
只有确实要改深层结构时才 `full: true`。**别把整份简历读进主对话**：需要动内容就 `resume_dispatch`，
让子 agent 自己读、自己改，主对话只留你的意图和它回来的变更清单。

## 常用套路

- **整段改写 / 调排版 / 美化**（"把第 3 条经历压成两行"、"这一块字号层级乱"、"整体塞进一页"）：
  `resume_dispatch`，`paths` 给到具体条目，`excerpt` 给用户认的原话。
- **换模板 + 换主色**（单字段确定值）：直接 `resume_patch` 一次两条
  （`/metadata/template`、`/metadata/design/colors/primary`）。
- **塞进一页**：缩小 `/metadata/typography/body/fontSize`（8~9）、
  `/metadata/typography/body/lineHeight`（1.2~1.35）、`/metadata/page/marginX|marginY`（10~16），
  再把用不上的栏目 `/sections/<id>/hidden` 设 `true`。
- **换分页布局**：整对象替换 `/metadata/layout`（`pages` 数组，每页含 `main` / `sidebar` 栏目 id）。
- **头像**：`resume_photo`，直接给本机图片绝对路径。
- **用户在面板里手动改完，让你接着做**：他会用面板里的输入框把诉求发过来（或直接在对话里说）；
  面板消息前面自带一段"委派块"，按它的要求走。
- **做新模板**：面板的「用参考图做模板」会自己派子 agent，**不需要你参与**；用户要是直接在对话里
  让你做，就走 `resume_template(action=brief)` → 派子 agent → `save` → `preview`。

## 面板嵌的是真应用

面板里的 iframe 加载 `http://localhost:3000/builder/<id>`，就是 Reactive Resume 本体（登录、拖拽、
实时预览都在里面）。它能被嵌入是因为插件在 `resume_service(start)` 时把应用构建里根文档的
`X-Frame-Options: DENY` 去掉了（原文件备份为 `apps/server/dist/index.mjs.dsh-orig`，应用重建后
下次 start 会自动再补）。**不要**为了让面板好看去改别的地方。

## 需要更多细节时

- JSON Patch 的 path 对照表、15 个模板名、配色/字体/字号、布局对象 → [references/json-patch-recipes.md](references/json-patch-recipes.md)
- 报错排查（401、服务起不来、数据库 recovery、PDF 500、`OPERATION_PATH_UNRESOLVABLE`、中文乱码）→ [references/troubleshooting.md](references/troubleshooting.md)

## 底层退路（工具不够用时）

`03-脚本\rr-cv.mjs` 还有一些命令没包成工具（`rr-cv.mjs tools` 列出 MCP 全部工具）。服务确认在跑的前提下：

```powershell
cd "<RESUME_HOME>\简历助手\03-脚本"
node rr-cv.mjs tools                     # 看 MCP 暴露了哪些工具
node rr.mjs <toolName> --args-file "$env:TEMP\args.json"
```

⚠️ `rr.mjs` / `rr-upload.mjs` 带自动启动逻辑，只在服务已确认在跑时才用。

## 项目位置速查

```
简历助手\
├── 01-应用\reactive-resume\     应用本体（dist 已构建）
├── 02-数据库\                   便携版 PostgreSQL（pgdata = 数据，备份它）
├── 03-脚本\                     rr-cv.mjs（本 skill 主接口）/ rr.mjs / 启停 bat / rr-key.txt
├── 04-输出\                     所有 PDF 与预览图 + _索引.md
└── 05-文档\                     AI操控指南 / 使用说明 / 管理员说明
```
