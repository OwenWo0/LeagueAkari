# LeagueAkari 原生 ARAM 助手 — UI/运行时接入审查（native-cursor）

Scope: `/tmp/aram-akari-native-design.md` vs Akari HEAD。Skills: `league-akari-ui-components`, `league-akari-shard-development`（路由/shard 注册相关）。未改源码。聚焦：路由/侧栏、设置保密、截图预览/文本 UX、自动对局就绪与 UI 验收。

## Blocker

### B1. 「可信 ARAM/Mayhem」无 Akari 可判定谓词 → 自动攻略会误触发或永不触发

- Design: 「只在可信相关 ARAM/Mayhem 对局且资料就绪」按 gameId 去重。
- Evidence: `gameMode` 合集含 `ARAM` 与 `KIWI`（符文大乱斗），见 `src/shared/types/league-client/game-data.ts`（`ARAM` / `KIWI`）；fixture `q_450`=`ARAM`，`q_2400`=`KIWI`。仓内无名为 “Mayhem” 的 gameMode。
- Fix: 写死谓词，例如 `gameMode === 'ARAM' || gameMode === 'KIWI'`（或白名单 queueId），并定义「资料就绪」最小字段（本人 championId、allies 齐全、可选 enemies）。非命中 queue 时 UI 禁用自动攻略并说明原因。

### B2. API Key 保密与现有「设置导入导出」路径冲突风险未写死

- Design: Key → `safeStorage`；SettingFactory 只存非敏感；IPC/state 仅 `hasApiKey`/存储方式。
- Evidence: 仓内**无** `safeStorage`/`encryptString` 先例；`SettingsJsonFileService.writeSettingsToJsonFile` 导出 **全部** `Setting` 行（`src/main/shards/setting-factory/settings-json-file-service.ts`）。
- Fix: 明确 Key **永不**写入 Setting 表；`setApiKey`/`clearApiKey` IPC 不回显；日志禁打 Key/BaseURL+Key；UI 用 `NInput type=password`；文档写明导出 JSON **不含**凭据。落地路径如 `userData/aram-assistant/credentials.bin`。

## High

### H1. 路由/侧栏/i18n 接线清单不完整（实施会漏注册）

- Design: `/aram-assistant` + 侧栏「海克斯助手」+ zh-CN/en YAML。
- Evidence 必备触点：
  - `src/renderer/src-main-window/routes/index.ts`（现仅 player-tabs/ongoing-game/toolkit/automation/test）
  - `Sidebar.vue` `menu`：`key` = **route name**（`player-tabs` 等），文案 key 可不同（`match-history`）
  - `shell.yaml` `navigation.sidebar.menu.*`（en+zh-CN）
  - 主窗 `src/renderer/src-main-window/shards/index.ts` 的 `manager.use(...)`
  - **i18n 非自动发现**：新 YAML 必须 import 进 `src/renderer-shared/i18n/index.ts` 的 `mergeRendererResources`，且根 key 不可撞名
- Fix: 设计补「文件级 checklist」；route `name`/`path`/`key` 统一 `aram-assistant`；Naive UI 控件，禁裸 `button`/`input` 未样式化（ui-components skill）。

### H2. 截图「隐藏全部工具窗」无 API；与 contentProtection / 恢复语义未定

- Design: 抓前隐藏所有工具窗，抓后恢复；主进程 dialog/`desktopCapturer`；内存；预览后再发送。
- Evidence: `WindowManagerMain` 有 5 窗各自 `hide()`/`show()`，**无** bulk hide；`contentProtection` 已存在（streamer mode，`base-akari-window.ts`）。`selectBackgroundFile` 把**路径**回传 renderer——截图不可照搬。
- Fix: 实现 `withHiddenAkariWindows(fn)`：快照 `state.show` → hide → try/finally 恢复；忽略未创建窗。IPC：主进程读文件校验魔数后返回 `Uint8Array` 或 session `captureId`；**禁止**把磁盘路径写入 settings/state。预览用 blob URL；发送时用主进程持有的 capture，勿让 renderer 回传大图除非同一次会话。标明 macOS Retina / 多屏选源策略。

### H3. 输出「禁 v-html」与现有 markdown 工具冲突

- Design: 输出仅安全文本/DOM，禁 v-html / 任意 markdown HTML。
- Evidence: `src/renderer-shared/utils/markdown.ts` 为 `html: true`，通知弹窗普遍 `v-html={markdownIt.render(...)}`。
- Fix: 攻略输出 **不得**复用该 util；用纯文本/`NText`/白名单渲染，或独立 `html:false` + 无 raw HTML 管线。

### H4. 截图-only / 文本-only UX 缺 UI 合同

- Design: 截图-only 不强制手输 3 卡；文本-only 不强制截图；文本须精确匹配本地 id/name。
- Fix: 页面模式枚举 `image | text`（设置可持久化）；`image`：预览 + 发送，无三卡必填；`text`：3× `NSelect`/`NAutoComplete` 绑定卡库，无截图控件；切换清空另一模式草稿。验收用例各一条。

### H5. 「自动读取」与「自动攻略」就绪态、及与对局页自动跳转未对齐

- Design: 自动读取默认开；自动攻略默认关；「资料就绪」触发。
- Evidence: `autoRouteWhenGameStarts`（默认 false）会 `router.replace({ name: 'ongoing-game' })`（`auto-route-watcher.ts`），用户可能被拉离助手页。
- Fix: 区分 state：`matchContext`（只读展示，连接即更新）vs `autoGuideEligible`（谓词+就绪+显式设置+有输入策略）。无三卡时自动攻略是跳过、仅阵容分析、还是等输入——写死一种。侧栏可参考 ongoing-game 的 `inProgress` badge；可选「对局页入口」须给具体组件锚点，否则本版不做。

### H6. UI 运行时验收门槛过虚

- Design: 「可运行原生页面与完整操作链」+ mcp-debug，但无勾选表。
- Fix: 最低验收（dev 主窗 CDP `8944`）：侧栏进入页；断连/非 ARAM·KIWI 空态；离线卡库搜索；文本三选一生成；截图预览→取消不上传→确认才请求；`hasApiKey` 切换无泄露；取消分析；确认/撤销历史。注明真实对局/Windows 截屏未测。

## 非问题（本焦点内）

- 复用 `LeagueClientMain` / 不建第二套壳：与架构一致。
- 主窗单路由 + shared renderer shard：符合现有模式。
- 浮窗非本版门禁：可接受，勿阻塞。

## 建议设计补丁（给协调者）

1. 写入 B1 谓词与就绪定义。
2. 写入 B2 凭据文件/IPC 与导出隔离。
3. 附录：H1 文件 checklist + H2 capture helper + H4 模式合同 + H6 验收表。
