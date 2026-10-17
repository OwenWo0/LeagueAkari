# LeagueAkari 原生 ARAM 助手 — LCU/ChampionData 接入审查（native-agy）

Scope: 审查 `/tmp/aram-akari-native-design.md` 与 LeagueAkari 集成点。聚焦：`LeagueClientMain` 对局上下文（身份/阵营/模式/跨局生命周期）与 `ChampionDataMain`（aram_mayhem 能力、数据口径、无重复 LCU 基础设施）。遵循 `league-akari-shard-development` 与 `league-akari-sgp-data-source` 规范。未修改项目源码。

## Blocker

### B1. ChampionDataMain.loadDetails 无跨源回退机制（与设计假设矛盾）

- **Design**: 声称 `ChampionDataMain.loadDetails` 已有 aram_mayhem 的 OP.GG/QQ101 源与能力/回退。
- **Evidence**: `src/main/shards/champion-data/service-controller.ts` L57-84 明确规定「跨数据源非重试目标，禁止自动静默跨源替换」。当首选源（默认 `opgg`）遇到网络错误、404 或未启用时，直接返回 `{ status: 'unavailable', effectiveSource: null, fallbackReason: 'request-failed' }`，**绝不回退至 qq101**。
- **Fix**: 在 `aram-assistant` 的 `match-context-controller` 中显式编排降级逻辑：若首选源返回 `unavailable` 且原因非 `mode-unsupported`，允许显式传入 `source: 'qq101'` 重试一次；并在 state/IPC 中透传 `effectiveSource`，避免数据源口径被隐式掩盖。

### B2. LCU 原始 GameMode 与 ChampionDataMode 存在映射与生命周期失配

- **Design**: 直接复用 `gameMode/queueId` 判断 ARAM/Mayhem，并查询 `ChampionDataMain.loadDetails`。
- **Evidence**:
  1. LCU 实际字段（`src/main/shards/auto-gameflow/aram-team-side-controller.ts` L20-22 及 fixture）：ARAM 为 `gameMode === 'ARAM'` (`queueId: 450`)，海克斯乱斗为 `gameMode === 'KIWI'` (`queueId: 2400`)。
  2. `ChampionDataMode`（`src/shared/data-adapter/champion-data/types.ts` L3-5）仅认 `'aram' | 'aram_mayhem'`。若将 LCU 字符串 `'KIWI'` 直传 `loadDetails` 会触发 schema 校验失败或 `mode-unsupported`。
  3. 生命周期失配：选人期有 `champSelect.session.benchEnabled`；进入对局（`InProgress`）后 `champSelect.session` 变为 `null`。若判定谓词依赖 `benchEnabled`，进入载入界面即会误判为“非乱斗对局”。
- **Fix**: 新增模式映射器 `mapLcuToChampionDataMode(gameMode, queueId)`：`KIWI`/`2400` → `'aram_mayhem'`，`ARAM`/`450` → `'aram'`。判定谓词在选人期使用 `benchEnabled && (ARAM || KIWI)`，对局期退化为以 `gameflow.session.gameData.queue.id` 或 `map.gameMode` 判定。

### B3. 选人进游戏 session=null 会触发朴素重置，且存在 gameId=0 抖动

- **Design**: 「断连事件只改变连接状态，保留当前确认历史；新 gameId 或明确新ChampSelect重置，晚到请求以session generation过滤。」
- **Evidence**:
  1. `src/main/shards/league-client/lc-state/index.ts` L981-988：选人结束转入游戏加载（`GameStart`/`InProgress`）时，LCU 会派发 `Delete` 事件将 `champSelect.session` 置为 `null`。若 MobX reaction 以 `!champSelect.session` 触发重置，会导致进游戏时上下文和用户手动修正被清空。
  2. `src/main/shards/ongoing-game/champ-select-handoff.ts` L26：选人初期或部分自定义局中 `champSelect.session.gameId` 可以为 0，随后才变为正式正整数 `gameId`。
- **Fix**:
  1. 上下文重置必须绑定 `gameflow.phase` 离开对局生命周期（流转为 `Lobby` / `None` / `EndOfGame` / `TerminatedInError`），或出现了**不同且为正数**的新 `gameId`。
  2. 选人进游戏（`ChampSelect` → `GameStart`/`InProgress`）属于同局 handoff，保留 `currentChampionId`、用户手动修正与确认卡历史。
  3. 过滤 `gameId <= 0` 的瞬态，自动攻略去重逻辑必须要求 `gameId > 0` 且资料就绪后方可生效。

## High

### H1. QQ101 与 OP.GG 的 Mayhem 强化数据统计口径严重不对称

- **Design**: 「只把它实际返回的强化性能/人气作为可追溯数据注入... 性能分不等于胜率...」
- **Evidence**:
  - OP.GG（`src/shared/data-adapter/champion-data/opgg.ts` L344-379）：提供该英雄专属强化列表，含 `performanceScore` 与 `popularity`，但 `winRate === null`。
  - QQ101（`src/shared/data-adapter/champion-data/qq101.ts` L402-427）：`adaptQq101MayhemDetails` 仅截取英雄的 `lowestRankAugmentIds`（仅 3~5 个），且其强化 `winRate`/`pickRate` 是来自 `getMayhemAugments` 的**全模式大盘统计**，非英雄特定胜率。
- **Fix**: Prompt 构建与 UI 必须标注数据口径（OP.GG = 英雄专属性能分/选率；QQ101 = 大盘平均胜率，仅含部分推荐卡）。摇出的三选一卡片若不在推荐列表中（尤其 QQ101 场景），必须优雅降级为离线卡库信息 + 模型常识，严禁因缺数据报错或阻断流程。

### H2. 对局载入期本人身份与阵容补全需防御 EMPTY_PUUID 及 0 值 ChampionId

- **Design**: 「加载/对局用 current-summoner puuid/summonerId匹配teamOne/teamTwo，结合playerChampionSelections补championId；绝不猜队伍第一人。」
- **Evidence**: 参考 `src/main/shards/ongoing-game/computed-state.ts` L109-126：在 `GameStart` 刚加载时，`teamOne`/`teamTwo` 内 `championId` 常为 0，必须通过 `playerChampionSelections` 映射补齐；且可能包含 `EMPTY_PUUID` (`00000000-0000-0000-0000-000000000000`)；若 `summoner.me` 尚未拉取完成，不能盲目匹配。
- **Fix**:
  1. 前置防御 `if (!summoner.me) return 'pending'`；
  2. 匹配 `puuid === summoner.me.puuid || summonerId === summoner.me.summonerId` 决定蓝红方（`teamOne` = 蓝方 100，`teamTwo` = 红方 200）；
  3. 队伍成员过滤 `puuid === EMPTY_PUUID`，championId 回退取 `playerChampionSelections.find(s => s.puuid === p.puuid)?.championId || p.championId || 0`。

### H3. ChampionDataMain 内部无内存缓存，易引起选人期高频重复请求

- **Design**: 「第三方数据缺失不阻塞本地页面，避免每次反应重复请求，可缓存与取消」
- **Evidence**: `src/main/shards/champion-data/service-controller.ts` L36-46 直通底层 `_sourceLoader`，shard 本身无内存缓存与 in-flight 请求合并。选人阶段骰子（reroll）或队友交换英雄时，MobX reaction 若每次直调 `loadDetails` 会高频冲击上游接口。
- **Fix**: 在 `aram-assistant-main` 内部维护一个短生命周期 LRU 缓存（按 `effectiveSource:mode:championId`），并在发起新英雄请求时通过 `AbortController` 取消前序未决请求。

### H4. 零重复 LCU 基础设施：英雄元数据与资产应复用 data.gameData 与 akari-protocol

- **Design**: 严格复用 `LeagueClientMain` 已有连接与数据，不重复造轮子。
- **Evidence**: Akari 已常驻同步 `LeagueClientData.gameData.champions`（`champion-summary.json`，见 `lc-state/index.ts` L1223-1235），且已注册 `league-client://` 协议供 renderer 加载头像/技能图。
- **Fix**: 助手模块禁止自建英雄名称/图标查找表或从 Data Dragon/第三方拉取静态英雄资源，英雄名直接查 `gameData.champions[championId]?.name`，图标统一引用现有协议 URI。
