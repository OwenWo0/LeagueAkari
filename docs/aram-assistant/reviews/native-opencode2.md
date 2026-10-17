# 原生 ARAM 助手补充会审 — OpenCode2 忙注版 (native-opencode2)

范围:仅审 `/tmp/aram-akari-native-design.md` 中与 LeagueAkari 原生集成的差异部分,聚焦
provider/credentials/IPC 信任边界、快照打包、ChampionDataMain 源归因、无重复连接四条线。
方法:只读检查仓库 HEAD 56cdfde 的具体集成锚点;未运行、未改动任何源码;旧 Python/旧报告不再覆盖。

## 实施前必须解决 (B)

### B1 强化 ID 空间未对齐:hexaram 卡库 ↔ ChampionDataMain/LCU

- 证据:文本模式三卡已强制 "精确匹配本地 id/name"(设计 33 行),但卡库注入与 `ChampionAugment`
  统计联接无对应约束。`src/shared/data-adapter/champion-data/types.ts:193` 的 augmentId 属于
  OP.GG/QQ101/LCU 编号空间;LCU 权威字典在 `src/main/shards/league-client/lc-state/game-data.ts:27`
  (`augments: Record<number, Augment>`)。设计只声明 hexaram `sourcePatch26.20/216 条`(37 行),
  未要求该编号空间经 LCU 字典核验。
- 风险:若两编号空间不完全一致,"只把 ChampionDataMain 实际返回的性能/人气作为可追溯数据注入"(41 行)
  会静默错配或大量静默丢失,且 UI 无从展示;这直接违反自己"有来源/缺失状态"的归因要求。
- 修正:loader 落盘前交叉核验:卡库 id 必须能被 `data.gameData.augments` 解析(或标记为
  `unresolved` 且默认不参与模型/确认 lookup);注入 ChampionDataMain 数据时按 augmentId 精确 join
  并在缺失时体现 null;将该不符为 Vitest 表驱动用例。

## 高 (H)

### H2 IPC 无发送方门禁,5 窗口均可调用凭据/消耗型端点

- 证据:`src/main/shards/ipc/invocation-router.ts:73-87` 对任意 sender 解析任意
  `namespace:fnName`,无窗口校验;`sendEvent:31-35` 向所有已注册 renderer 广播;全部窗口
  `sandbox:false`(`window-manager/base-akari-window.ts:320`)。设计只说 "IPC/state 只有
  hasApiKey/存储方式"(21 行),未要求 setApiKey/setBaseUrl/触发分析等变更型端点限主窗口 sender,
  也未给"忙碌后重试"限定唯一发起方。
- 修正:统一在 `aram-assistant-main` 的 ipc-handlers 内对变更型调用校验
  `event.sender.id` 为 `WindowManagerMain.mainWindow` 的 webContents(现成先例
  `champion-data/ipc-handlers.ts:29-52` 按 rendererId 键控请求/取消);消耗型调用绑定会话 generation,
  自动线仅由主进程 reaction 触发,禁止 renderer 旁路触发。

### H3 凭据存储机制未落地:safeStorage 全仓 0 先例 + 设置导出泄漏面

- 证据:`grep -r safeStorage src/main` 0 匹配——"Key 单独 safeStorage 加密到 userData"(21 行)
  是全新机制,设计未指定文件位置/原子写/`isEncryptionAvailable()` 判定顺序;另一侧
  `setting-factory/ipc-handlers.ts:48/62` 支持把全部设置导出到任意用户路径,若实现把密文
  blob 挂进 SettingFactory 即被导出泄漏。
- 修正:独立凭据文件服务,模式参照 `saved-player/tagged-players-file-service.ts`(独立 JSON +
  userData 路径);顺序:isEncryptionAvailable→加密落盘,失败仅内存并提示;密钥文件绝不经
  SettingFactory 注册/导出;scope=协议+规范化 Base URL 映射仅主进程持有,propSync 只带 hasApiKey。

## 中 (M)

### M1 打包方式未点名,存在 dev 下惯性读 resourcesPath 的翻车点

- 证据:仓库打包先例是编译期 `@resources/...?asset&asarUnpack`(`src/main/native/magic.ts:1`、
  `client-installation/installation-detector.ts:1`),`electron-builder.yml:42-43` 已对
  `resources/**` asarUnpack;而 `process.resourcesPath` 在 dev 指向 Electron 发行包资源,
  直接路径拼接在 dev 必挂。设计只说 "迁入受控 resources/data,打包可加载"(37 行)。
- 修正:点名 electron-vite JSON 资产导入(`@resources/data/augment-catalog.json?asset`)
  作为 bundled 基线;userData overlay 由 loader 读写,回退顺序写入验收项。

### M2 ChampionDataMain 无去重/缓存,自行实现缺边界

- 证据:`champion-data/request-controller.ts` 只做取消映射;`service-controller.ts:48-96` 每次
  _load 直打 source loader(axios 超时 8s+1 重试,`champion-data/index.ts:128-137`)。设计要求
  "避免每次反应重复请求,可缓存与取消"(41 行),若新 context 的 MobX reaction 依赖
  队友集合,成员变化会级联触发重复请求,与第三方源限速互噬。
- 修正:aram-assistant 建有界缓存,key=source+mode+championId+region/patch,TTL 到
  metadata.updatedAt,并按 generation 失效;取消沿用 requestId 模式;"同请求合并"而非逐请求直发。

### M3 renderer shard 落位与传统活跃模式冲突待定

- 证据:design 把 renderer shard 放 `src/renderer-shared/shards/aram-assistant/`(23 行),
  但同为主窗口专属的实时 LCU 消费实现放在窗口本地
  (`src/renderer/src-main-window/shards/{league-client-peek,self-hosted-lcu-data}/`),
  与 AGENTS.md "窗口专属 shard 放窗口 shards 目录" 一致。
- 修正:要么改放 `src/renderer/src-main-window/shards/`,要么在设计里说明为何需要 window-shared
  (目前并不跨窗口)。避免双落位漂移。

## 低 (L)

- L1 queueId/gameMode→ChampionDataMode 未列表化:`capabilities.ts:43,81` 只认 `aram_mayhem`
  串面,Mayhem 队列号映射表应入库以拒绝未知 queue,落到 "无对局" 展示而不是猜测。
- L2 `data.gameData/summoner/gameflow/champSelect` 均为同步态,而加载/对局补 championId 需
  的 playerChampionSelections 不在其中,须经 LeagueClientRenderer/LeagueClientMain.api 取
  (league-client-peek 先例),并处理 `LeagueClientLcuUninitializedError`
  与 `state.ts:4` 'connecting/disconnected';设计 13 行应写明这点,否则会误读为查询缺失。
- L3 既有信用边界事实:LCU tokens 已由 `league-client/lc-state/index.ts:311-315/:370-375`
  propSync 到 renderer(现存设计,不在本次修)。新 context/prompt 组装需明文列入禁止字段,
  防止混入玩家 prompt,同时不要扩大鉴权面。

## 已验证 declarations(与本仓对上,免重查)

- ChampionDataMain.loadDetails 为公开薄方法(`champion-data/index.ts:121-126`),aram_mayhem
  能力双源均在(`capabilities.ts:43-45 opgg、:81-90 qq101`),OP.GG 提供 champion-augments、
  QQ101 额外含 augment-overview/synergy-overview/synergies——归因字段
  `metadata.source/dataDate/updatedAt` 与 attempts 均可满足 41 行要求,回退路径『disabled/
  mode-unsupported/request-failed』齐全(`service-controller.ts:98-104`)。
- 不另起第二连接成立:LCU 单一连接仅在 LeagueClientMain(src 内无 lcu-connector/PowerShell/
  lockfile/二次 WS);按需 LCU HTTP peek 走 LeagueClientRenderer,已有先例,无需新通道。
- 截图流程可行:WindowManagerMain 公有五窗口 uri(`window-manager/index.ts:36-40`)可直接
  hide/恢复可见性,未触及公共契约;设置/日志/IPC/propSync 框架均以 champion-data 为模板。
- 模型安全细则(双协议约束、401/403 不重试、图像魔数、响应限额、v-html 禁用)与
  UI 技能/现有 renderer 约束一致,可作验收硬门。

## 结论

设计方向与仓库模式契合度高,四条聚焦线均有可落地锚点;放行前需处理 B1(ID 空间核验)、
H2(sender 门禁)、H3(凭据文件机制),三者均在 ipc-handlers/loader 层即可解决,
不触及公共 shard 契约。
