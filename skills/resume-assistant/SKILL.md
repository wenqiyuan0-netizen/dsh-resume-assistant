# 简历助手（插件版）

本机有一整套自建的简历工具：**Reactive Resume + 便携版 PostgreSQL**，项目在
`<RESUME_HOME>\简历助手`。

这份 skill 与这些工具都由插件 `dsh-resume-assistant` 提供。**优先用工具，不要手搓命令行。**

## 界面在哪

- **「简历」标签页**（对话视图切换处，和 Chat / Trajectory 并列）：整块 Reactive Resume 编辑器，
  可缩放（−/100%/+）、可直接手动改；右边有输入框，把诉求发给 agent。
- **输入框下面那一排**：日常对话视图里只显示简历本身（缩小预览）+ 服务状态 + 开关 + 对 agent 说话。
  点缩略图会在浏览器新窗口打开该简历的编辑页。
- **用户在界面上选中了某一块**再来问你时，消息里会带 `选中块：/sections/experience/items/2` 这样的
  结构地址 —— 直接用它做 `resume_patch` 的 path，不要另猜坐标。
- 工具栏的「美化这一块」会把选区 + 排版规则（字号层级 / 行高段距 / 对齐 / 项目符号 / 单主色）发给你：
  按这些规则改，改完回报改了哪几条 path。

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
只有确实要改深层结构时才 `full: true` —— 改样式基本只需要 `resume_patch`。

## 常用套路

- **换模板 + 换主色**：`resume_patch` 一次两条
  （`/metadata/template`、`/metadata/design/colors/primary`）。
- **塞进一页**：缩小 `/metadata/typography/body/fontSize`（8~9）、
  `/metadata/typography/body/lineHeight`（1.2~1.35）、`/metadata/page/marginX|marginY`（10~16），
  再把用不上的栏目 `/sections/<id>/hidden` 设 `true`。
- **换分页布局**：整对象替换 `/metadata/layout`（`pages` 数组，每页含 `main` / `sidebar` 栏目 id）。
- **头像**：`resume_photo`，直接给本机图片绝对路径。
- **用户在面板里手动改完，让你接着做**：他会用面板里的输入框把诉求发过来（或直接在对话里说）。

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
