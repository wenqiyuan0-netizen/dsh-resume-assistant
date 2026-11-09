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
- **导出 PDF** 是纯本地按钮，**不经过模型、不进对话**。窗口里先给三样东西：最终路径、**会不会覆盖已有文件**
  （带旧文件大小与时间）、以及**第一页缩略图**（和导出同一份排版，照片就在里面）。导出后：
  - **逐页**落 `.png`（第 1 页与 PDF 同名，之后 `-p2`、`-p3`…），这是「核头像位置与整体排版」的依据（铁律 6）；
  - 索引 `04-输出\_索引.md` 自动补这一条；
  - 勾了「导出后打开文件夹」就直接在资源管理器里选中它（`local/reveal`，随时可再叫一次）；
  - 内容溢出会明说 `overflow`：那是有内容串到下一页了，别当成功。
  打印用的是**本机 Chrome/Edge 的无头模式**（不是宿主 Electron —— 插件进程里没有 BrowserWindow，
  旧实现就死在这一步，只弹一句"没有 Electron 打印器"）。改了宿主侧 `lib/` 之后要重启 DSH 才生效；
  面板的 `client.js` 改完刷新页面即可。
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
| `resume_export` | 导出 PDF 到 `04-输出\<人名>\`，逐页落 `.png`，更新 `_索引.md`；可选 `reveal: true` 在资源管理器里选中它 |
| `resume_new` | 新建简历（可带示例数据、指定模板） |

## 铁律

1. **不要用 shell 自启服务**：要起服务用 `resume_service(start)`（见上）。
2. **改之前先确认对象**：`resume_show` 拿到 id 与当前 template，别凭记忆猜。
3. **中文直接写在工具参数里**：`resume_patch` 的 `operations` 由插件写成 UTF-8 无 BOM 临时文件，
   不需要（也不要）自己在命令行里拼 JSON。
4. **产出统一进 `04-输出\<人名>\`**：`resume_export` 已经自动做这件事并维护 `_索引.md`；
   不要往别处写 PDF，也不要手工改索引。
5. **导出后把绝对路径给用户。**
6. **导出后核排版（质量门，缺一不可）**：每份**新导出的简历**都要对着渲染截图核对**头像位置**与
   **整体排版**（有没有裁掉、压字、错栏、溢页）。截图在**导出时自动生成**（`resume_export` 或面板
   「导出 PDF」都会）：一页一张 `.png`，第 1 页与 PDF 同名，后续 `-p2.png`、`-p3.png`（本机
   Chrome/Edge 无头渲染，与预览同一套排版，照片已内联）。流程：
   导出 → `read_image` 读那些 `.png` → 逐页核对 → 有毛病就 `resume_dispatch` 或 `resume_patch`
   修完**重新导出**再核 → 全绿才算"导出完成"。**缺截图 / 没核对就判定未完成**，不许直接说"导出好了"。
   导出结果里 `overflow: true` 表示有内容串到下一页（`pages > sheets`），这一条本身就是缺陷，别放过。
7. **隐私**：简历数据全在本机。`03-脚本\rr-key.txt` 是钥匙，**绝不外发、绝不写进任何对外内容**；
   汇报时不要回显 key 内容。

## 两个写入者（最容易出事的地方）

同一份简历有**两个**写入者，且**两边都写整份文档**：

- 你：`resume_patch` → 应用 MCP → 事务里 `select ... for update` 读最新 → 套 patch → 整份写回。
- 用户：面板（iframe 里的 Reactive Resume）→ 每次编辑 500 ms 防抖后 `PUT /resumes/{id}`，**整份 data**。

后果，按重要性排：

1. **我方的 patch 值如果是从旧读数重建的整块内容，就会把用户在那个块里改过的一切抹掉。**
   应用的 patch 基线永远是最新的（不会有"服务端拿旧副本"这种事），所以问题只在**我送给它的 value**。
2. **面板有未保存编辑时，我一 patch，它的 `resume.updated` 推送会走到
   `It()` / `replaceResumeFromServer()`，`Rt()` 直接把 `hasPendingLocalChanges=false; pendingResume=undefined`**
   —— 用户刚敲进去、还没到 500 ms 防抖的内容，**根本没进过数据库就没了**，任何备份都救不回来。
   焦点还在 iframe 的输入框里时会延到 focusout 再合，但用户一点到你这边（或点面板空白处）就立刻合。

所以铁律补三条：

7. **只改叶子路径**：`/sections/<key>/items/<i>/<字段>`、`/basics/<字段>`、
   `/metadata/<字段>`。**不要**用 `replace` 整块替换 `/sections/<key>`、`/sections/<key>/items`
   （整数组）、`/basics`、`/summary` —— 那等于拿我的记忆覆盖用户的手。
8. **动手前在同一轮里重新读一次**（`resume_show full` 或 `rr-cv.mjs show <ref> --full`），
   确认要覆盖的那几个字段现在长什么样；和你要写的不一样就先停下来问。
9. **改完核对**：`rr-cv.mjs patch` 现在会自己留改前备份，并打印"不在本次操作路径内的变动"。
   出现这类差额，要么是应用 schema 规范化掉的，要么是别处同时写入了 —— 都要在回复里说明。

用户说"我刚改完"时，正确顺序是：先让他面板的保存落地（等 2 秒 / 让他点掉输入框），
我再 patch；patch 完让他 **Ctrl+Shift+R 强刷**面板，别让他拿着旧草稿继续编辑。

**历史与还原**（应用 UI 没有这个入口，只能走脚本）：

```
node rr-cv.mjs drift  <id|slug>                     # 用户在快照之后手改了什么（他不用说）
node rr-cv.mjs history <id|slug> [--diff N]         # 列快照；#0 是现在，#1 是最近一次
node rr-cv.mjs restore <id|slug> <序号> [--yes]      # 整份还原
node rr-cv.mjs cherry  <id|slug> <序号> --paths /a,/b [--yes]   # 只把某几处搬回来
```

`resume_version` 表的行是**每次 patch 之后**的状态（`label=AI edit`），应用自己只留 30 份。
还原前脚本会自动把"现在"另存一份，所以还原本身也可还原。
用户自己在面板里的保存**不会**进这张表 —— 所以他手工改动在 `history` 里看不见，
只能靠 `drift`（最近快照 ↔ 现在）暴露出来。

**用户的小改动不用他说**：他调的往往只是间距、字号、一个词、断行，不值得复述。
所以不要问"你改了什么"，直接 `drift` 看一眼；`patch` 也会自动做同一件事 ——
我要写的路径和他的手改撞上时，脚本会**停手并打印双方的值**，此时：

- 只是他调了形式（间距/字号/换行/标点）→ 保住他的，把我的操作路径从 ops 里去掉；
- 确实要覆盖 → `--force`，并在回复里说明"这处我按 X 覆盖了你的 Y"。

**expect 护航**：自己拼 operations 时，每条 `replace` / `remove` 都带上他从没听说过的那个字段
`expect: <刚读到的旧值>`。脚本会把它翻译成 RFC 6902 的 `test` 排在前面；我读完到他改完之间的
任何变动都会让应用整批拒绝（400），而不是静默覆盖。


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
- **头像**：`resume_photo`，直接给本机图片绝对路径。取景位置在 `/picture/position`
  （`{x,y}`，0–100 百分比）：面板里直接拖照片或点九宫格。**别用 `resume_patch` 写这个字段** ——
  应用的 `parseResumeData` 会把它当未知字段丢掉，用户在面板里一保存就消失（已实测）。
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
