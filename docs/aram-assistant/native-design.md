# LeagueAkari 原生 ARAM 助手集成设计（补充会审稿）

## 最终范围与现状

用户明确：直接在 `/Users/owenwu/codebase/personal/LeagueAkari` 实施，统一应用/界面；`/Users/owenwu/codebase/personal/ARAM-tool` 仅参考。目标保留：视觉模型解耦/自定义模型地址、最新海克斯卡库、客户端启动后自动读对局，截图建议与手动攻略。实施后统一 review 使用 OpenCode2 免费 `opencode/glm-5.3-flash-free`。无需人工审批门禁；实施仍由 Luna/max + --approve-for-me 自动审批，协调者负责设计和验收。

初始五方设计会审已完成，通用 provider/卡库/安全结论见 ARAM-tool/docs/reviews/design-decision.md。这次只会审原生融合差异，不重做旧 Python 全仓评审。LeagueAkari 当前 dev HEAD 56cdfde，调查时工作区干净；MIT。必须读本地 AGENTS.md 与 .agents/skills/league-akari-{shard-development,ui-components,sgp-data-source}/SKILL.md。

## 避免重复基础设施

直接依赖 `LeagueClientMain`：已有进程发现、HTTP/WSS、OnJsonApiEvent、初始状态拉取、重连。新功能不能启动第二套 PowerShell/lockfile/WS/轮询连接，不能把其 auth/state 原样同步到新 renderer/prompt。复用 `data.gameflow`、`data.champSelect`、`data.summoner`、`data.gameData`。通过 MobxUtilsMain.reaction 派生有界 `AramMatchContext`，断连事件只改变连接状态，保留当前确认历史；新 gameId 或明确新ChampSelect重置，晚到请求以session generation过滤。

本人身份：选人用 localPlayerCellId；加载/对局用 current-summoner puuid/summonerId匹配teamOne/teamTwo，结合playerChampionSelections补championId；绝不猜队伍第一人。保留 allies/enemies 分组、queueId/gameMode/mapId、phase/gameId和英雄id/name。无对局/未登录/匿名敌方不完整/未知英雄都明确显示。手动英雄修正当局保持，用户可恢复自动跟随。

自动读取默认启用并随Akari客户端自动连接生效；不会因为打开应用/连接客户端就调用收费模型。自动攻略为显式设置（默认关闭），只在可信相关ARAM/Mayhem对局且资料就绪时按gameId去重，断连/重连不重复扣费，忙碌后重试触发而非永久丢失。未证实三选一卡片可从LCU读取，不虚构接口，继续图像/手动三选一。

## 原生模块与界面

新增 `src/main/shards/aram-assistant/`，id=`aram-assistant-main`，index仅DI/设置/state sync/生命周期与薄方法。按真实职责拆：context/state、ipc-handlers、match-context-controller、analysis-controller、model-executor、catalog-loader（可包含更新）、credential-executor。纯协议/映射支持模块可以自然命名，不制造一行包装文件。

依赖 LeagueClientMain、ChampionDataMain、AkariIpcMain、MobxUtilsMain、SettingFactoryMain、LoggerFactoryMain、WindowManagerMain（截图隐藏/恢复窗口）。设置通过SettingFactory保存非敏感配置，state通过MobxUtils同步可公开字段；Key单独safeStorage加密到userData，无法加密仅内存且提示，scope=协议+完整规范化Base URL，IPC/state只有hasApiKey/存储方式。模型请求走主进程，不创建通用renderer fetch/文件路径IPC。

Renderer新增 `src/renderer-shared/shards/aram-assistant/{index,store,state-sync,context}.ts`（按必要程度），在主窗口shards manager注册。主窗口新增 `/aram-assistant` 路由和侧边栏“海克斯助手”，使用现有Vue3/NaiveUI/主题CSS变量/i18next，全部文案zh-CN/en YAML。页面展示自动读取的对局/本人/分组阵容、手动修正、生成攻略、截图/导入预览、文本三选一、分析取消、确认/撤销历史、离线卡库、模型设置。可以在现有对局页加一个导航入口；不创建第二套Electron壳/主窗口/数据库/路由系统，不改已有公共shard契约。

浮窗优先复用Akari现有窗口能力或在同一页面提供紧凑展示；本版核心门禁为可运行原生页面与完整操作链，不要求为了迁移复制全部独立应用UI。源码/类型/构建入口必须属于Akari，运行时不能依赖ARAM-tool路径或本机源码目录。

## 可复用核心和明确修正

参考 ARAM-tool/electron/core 的 providers/cards/analysis/session 和 tests，迁入需转为本仓TypeScript及Vitest约定，不照搬 SettingsStore/LCU独立壳。参考原型仍有在修边界，实施者必须独立验证：非法/超大响应不可重试、JSON null必须类型错误、Base URL非法百分号需捕获；截图-only不能强制手输3卡，文本-only不能强制截图；海克斯prompt必须含当前英雄/阵容；更新后分析服务与确认卡lookup不能仍持旧卡库。

Provider支持Gemini原生和OpenAI-compatible，协议根可配置（Gemini /v1beta、兼容 /v1），模型名可填，Key可空仅兼容本地服务。HTTPS默认，HTTP只允许字面loopback。拒绝userinfo/query/hash/完整端点和重定向。30s总预算（可5–120），最多额外重试一次仅429/暂态5xx/网络错误，401/403/无效响应/取消不重试。真实AbortController、图像PNG/JPEG魔数校验、输入≤8MB、准备图长边≤1280/≤4MB、响应流式限额；max输出4096tokens，显示≤20k字符，类型化短错误不泄露上游body。

截图由主进程对话框/desktopCapturer取得，只存内存。先隐藏所有当前工具窗口，抓取后恢复原可见性；有预览且只点发送才调用provider。图像模式自主识别截图里的真实三项，提示不确定时重截/手输；文本模式三项必须精确匹配本地id/name。历史只由用户从卡库明确确认id写入，关闭/推荐不自动追加。输出仅安全文本/DOM，不能v-html/任意markdown HTML。

## 卡库与Akari数据生态

已实抓并独立复核 `https://hexaram.lol/data/mayhem/augment-catalog.json`，sourcePatch26.20、216条、SHA256 aac125ef54cf23e47967a5884b9ca710590287f3117587adaa64cdf3d0984987；完整原文 `/tmp/aram-catalog.json`，标准化快照 ARAM-tool/data/augments.json。216包含standard171/ability30/quest11/special4，scope aram136/shared80，textStatus verified180/dynamic36。迁入Akari受控resources/data，打包可加载，启动离线搜索不抓取/不加载远程图标。sourcePatch仅来源声明，不冒充本机验证；分类/局限展示。

共享loader支持手动更新+CLI，写userDataoverlay优先，损坏/旧于bundled回退；版本单调，同补丁骤减>20%拒绝，高补丁允许合理轮换但≥100/唯一/完整；流式大小与超时/HTML挑战/失败都不覆盖。保存原始hash、时间和来源；快照效果不得静默截断。

`ChampionDataMain.loadDetails` 已有 aram_mayhem 的OP.GG/QQ101源与能力/回退。原生助手通过公开服务按championId查询现成推荐数据，不再爬ApexLol，不复制第三方HTTP客户端。只把它实际返回的强化性能/人气作为可追溯数据注入，有日期/来源/缺失状态；性能分不等于胜率，缺数据仍可用离线卡片/模型建议。不能把QQ101英雄组合联动误作英雄×强化统计，不能把Arena资料混入。第三方数据缺失不阻塞本地页面，避免每次反应重复请求，可缓存与取消；图像三选一严格限制实际候选。

## 验收及所有权

Luna是唯一实施者，不递归派worker，不提交/推送。只修改LeagueAkari功能相关路径，参考仓库停止新实现；保留其它无关修改。按照本地skill用设置/日志/IPC框架，避免绕过既有生命周期。

Vitest针对真实行为：provider真实本地HTTP双协议/取消/超时/401/429/畸形/大响应、凭据scope和加密失败、卡库更新回退、context本人身份/队伍/瞬断/新gameId、自动攻略不重复、截图-only/文本-only、确认撤销。核心目标80%但不写源码字符串镜像测试。复用原型Postman本地simulation需实际运行请求并查日志，未登录不发布。

执行 yarn prettier --write <changed files>、yarn typecheck:node、yarn typecheck:web、相关Vitest后完整yarn test、yarn build。使用本地Akari dev/native window运行验证新侧边栏/页面/配置/离线搜索/历史/预览和无隐式上传，再生成本机可验证构建；真实游戏/Windows未测明确写出。读取本地 league-akari-mcp-debug技能后选择支持的调试方式。最终OpenCode2免费GLM对LeagueAkari完整diff统一review，Luna修复，协调者独立复核证据。
