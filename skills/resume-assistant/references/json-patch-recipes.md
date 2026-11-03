# JSON Patch 速查（改简历样式/内容）

简历数据是一个大 JSON，改它用 **JSON Patch (RFC 6902)**，一次可传多条。
通过 `node rr-cv.mjs patch <id|slug> <ops.json>` 套用。

## ops.json 的格式

```json
{
  "operations": [
    { "op": "replace", "path": "/basics/name", "value": "张三" },
    { "op": "replace", "path": "/metadata/template", "value": "gengar" }
  ]
}
```

顶层也可以直接是数组：`[ {...}, {...} ]`。

常用 op：`replace`（改）、`add`（数组插入）、`remove`（删）。

**写文件务必用 UTF-8 无 BOM**，否则中文会乱：

```powershell
[System.IO.File]::WriteAllText("$env:TEMP\ops.json", $json, (New-Object System.Text.UTF8Encoding($false)))
```

## path 对照表

| 改什么 | path | 值示例 |
|---|---|---|
| 模板 | `/metadata/template` | `"gengar"`（见下方模板名） |
| 主色 | `/metadata/design/colors/primary` | `"rgba(124,58,237,1)"` |
| 文字色 | `/metadata/design/colors/text` | `"rgba(0,0,0,1)"` |
| 背景色 | `/metadata/design/colors/background` | `"rgba(255,255,255,1)"` |
| 正文字体 | `/metadata/typography/body/fontFamily` | `"Roboto"`、`"IBM Plex Sans"` |
| 标题字体 | `/metadata/typography/heading/fontFamily` | `"Fira Sans Condensed"` |
| 正文字号 | `/metadata/typography/body/fontSize` | `8.5`（数字，不是字符串） |
| 行高 | `/metadata/typography/body/lineHeight` | `1.35` |
| 页边距 | `/metadata/page/marginX`、`/metadata/page/marginY` | `24`、`18` |
| 纸张 | `/metadata/page/format` | `"a4"` |
| 语言 | `/metadata/page/locale` | `"de-DE"`、`"zh-CN"` |
| 布局 | `/metadata/layout` | **整对象替换**（见下） |
| 姓名 | `/basics/name` | 字符串 |
| 头衔 | `/basics/headline` | 字符串 |
| 邮箱/电话/地址 | `/basics/email`、`/basics/phone`、`/basics/location` | 字符串 |
| 头像 URL | `/picture/url` | 上传后的 URL |
| 头像显隐 | `/picture/hidden` | `false` |
| 个人简介 | `/summary/content` | HTML 字符串，如 `"<p>…</p>"` |
| 某栏目的条目 | `/sections/<栏目>/items` | 数组，整替 |
| 某栏目显隐 | `/sections/<栏目>/hidden` | `true` / `false` |
| 自定义栏目内容 | `/customSections/0/items/0/content` | HTML 字符串 |

栏目 id：`profiles` `experience` `education` `projects` `skills` `languages` `interests`
`awards` `certifications` `publications` `volunteer` `references`。

## 模板名（15 个）

`azurill` `bronzor` `chikorita` `ditgar` `ditto` `gengar` `glalie` `kakuna` `lapras`
`leafish` `meowth` `onyx` `pikachu` `rhyhorn` `scizor`

不同模板用主色的面积不同（如 `gengar` 涂满侧栏，`pikachu` 只在技能条），
**换色看起来没效果往往是正常的模板设计差异**，不是 bug。

## 布局对象

`/metadata/layout` 必须整体替换：

```json
{
  "sidebarWidth": 30,
  "pages": [
    { "fullWidth": true,  "main": ["summary","education","projects","skills"], "sidebar": [] },
    { "fullWidth": false, "main": ["experience"], "sidebar": ["skills"] }
  ]
}
```

`pages` 是数组，每个元素 = 一页；`main` / `sidebar` 里放栏目 id。单页简历就只放一个元素、
`fullWidth: true`、`sidebar: []`。

## 排版常用手法（单页塞得下）

- 缩小字号：`/metadata/typography/body/fontSize` → 8~9
- 收紧行高：`/metadata/typography/body/lineHeight` → 1.2~1.35
- 缩小边距：`/metadata/page/marginX` / `marginY` → 10~16
- 缩小段间距：`/metadata/page/gapX` / `gapY` → 5~8
- 隐藏用不上的栏目：把对应 `/sections/<id>/hidden` 设 `true`
- 清空示例残留：把隐藏栏目的 `/sections/<id>/items` 设为 `[]`

## 已知坑

1. **`picture` 是顶层字段**：`/picture/url`，**不是** `/basics/picture/url`。
   写错会报 `OPERATION_PATH_UNRESOLVABLE`。
2. **改之前先 `show --full` 看真实结构**。字段名以实际返回为准，本表是常用项，不是全集。
3. **`replace` 要求路径已存在**；给不存在的路径用 `add`。
4. **别改 id 类字段**（`/sections/<id>/items/0/id` 等），会破坏引用。
5. HTML 内容里的引号要按 JSON 规则转义；整段中文建议走 `ops.json` 文件，别在命令行里传。
