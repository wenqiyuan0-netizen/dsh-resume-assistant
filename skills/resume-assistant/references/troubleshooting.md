# 排查手册

先跑 `node rr-cv.mjs doctor` —— 它一次报出服务/钥匙/接口状态并给修复动作。
下面是它没覆盖到的情况。

## HTTP 401 Unauthorized

`rr-key.txt` 里的钥匙无效，或数据库里根本没有这条 key。

**修复（只能走界面）：**

1. 打开 http://localhost:3000 并登录
2. 进 **Account → API Keys**，新建一个
3. 复制新 key，整行写进 `03-脚本\rr-key.txt`（覆盖旧的，前后不要留空格）
4. 重新 `node rr-cv.mjs doctor` 应显示 ✓

> 为什么不能手工修：校验走 Better Auth 的 `verifyApiKey`，存的是
> `fingerprintCredential(key, salt)` 的哈希。**无法从哈希反推，也无法手工构造**。
> 判断方法：`psql -c "select count(*) from apikey;"` 若为 0，说明 key 从未创建或被清空。

## 服务起不来

`doctor` 会自动尝试拉起。若失败：

```powershell
# 看日志
Get-Content "简历助手\02-数据库\pg.log" -Tail 30
Get-Content "简历助手\02-数据库\server.log" -Tail 30
```

- 报 **`database system is in recovery mode`** → postgres 上次被强杀，正在崩溃恢复。
  等 5~30 秒重试即可；`doctor` 会重试连接。
- 报 **`postmaster.pid` 残留** → 确认没有 postgres 进程后删掉该文件再启动。
- 实在不行让用户双击 `03-脚本\启动简历工具.bat`。

### DSH 沙箱会导致 postgres 被连带杀掉（已修）

**症状**：`pg.log` 里反复出现
`terminating any other active server processes` → `all server processes terminated; reinitializing`，
并伴随短暂 `database system is in recovery mode`；桌面上还会多出一个标题为 `postgres.exe`
路径的黑窗。

**根因**：`start-services.mjs` 原来用 `spawn(postgres.exe, { detached: true })` 启动数据库。
在 Windows 上，这会给这个控制台程序**新开一个黑窗**，而且进程留在调用方的进程树附近 ——
在 DSH 沙箱下会随命令结束被一起杀掉，于是数据库不停地崩溃恢复。

**已做的修复（2026-09-30）**：

1. `start-services.mjs` 的 `startPostgres()` 改用 **`pg_ctl -D <pgdata> -l pg.log start`**
   （与 `启动简历工具.bat` 一致）。pg_ctl 会把 postgres 正确脱离进程树，不再开窗。
2. `rr-cv.mjs` **不再自动启动服务**：服务没在跑就停下，提示用户双击 `启动简历工具.bat`。

**日常正确姿势**：服务一律由用户双击 `启动简历工具.bat` 启动、`停止简历工具.bat` 停止。
让 agent 自己拉起服务是反模式 —— 会被沙箱杀掉并弹窗。

如果仍然看到数据库反复重启，检查是不是有脚本绕过 `pg_ctl` 直接 spawn 了 `postgres.exe`。

## PDF 导出报 500 / `ERR_UNSUPPORTED_ESM_URL_SCHEME`

说明应用重新 build 过但没跑修补脚本。在 `01-应用\reactive-resume` 下：

```powershell
node fix-dist.mjs
```

然后重启应用（`停止简历工具.bat` → `启动简历工具.bat`）。

## patch 报 `OPERATION_PATH_UNRESOLVABLE`

path 写错了。先 `node rr-cv.mjs show <id> --full` 看真实结构。

最常见的错：把头像写成 `/basics/picture/url` —— **正确是 `/picture/url`（顶层）**。

## 换模板后颜色没变

正常。不同模板用主色的面积不同（`gengar` 涂侧栏、`pikachu` 只涂技能条）。
需要大面积主色就换 `gengar`/`onyx` 这类；想淡就换 `azurill` 这类。

## 中文乱码

`ops.json` 不是 UTF-8 无 BOM。用：

```powershell
[System.IO.File]::WriteAllText("$env:TEMP\ops.json", $json, (New-Object System.Text.UTF8Encoding($false)))
```

不要在命令行里直接传含中文的 JSON —— PowerShell 的引号和编码会破坏它。

## 想用 rr-cv.mjs 没覆盖的工具

MCP 还有别的工具时，先用 `node rr-cv.mjs tools` 看完整清单，再用底层调用器：

```powershell
node rr.mjs <toolName> '<argsJSON>'
# 或避免引号问题：
node rr.mjs <toolName> --args-file "$env:TEMP\args.json"
```

下载 PDF 的底层写法：`node rr.mjs --pdf "<url>" "<输出文件>"`。

## 备份

停止服务后，复制这两个目录即可（含全部简历内容）：

- `02-数据库\pgdata`
- `01-应用\reactive-resume\data`
