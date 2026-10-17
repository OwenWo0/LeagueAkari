# LeagueAkari 原生 ARAM 助手终审报告（final-agy）

- **评审员**：AGY / Antigravity（统一只读实现终审）
- **评审目标**：基于 HEAD `56cdfde0` 的全部工作区变更（包括新增与未跟踪文件）
- **裁决基准**：`docs/aram-assistant/design-decision.md`（最高优先级契约）、`AGENTS.md`、`native-design.md`、`implementation-report.md`、`verification.md`、本地 Shard/UI/SGP Skills。
- **环境约束**：完全只读，未修改源码与测试，不提交、不推送，不进行递归委派。

---

## 一、 执行摘要 (Executive Summary)

本次终审对 LeagueAkari 原生 ARAM 助手（`aram-assistant-main` / `aram-assistant-renderer`）的全量实现及相关集成改动进行了端到端架构审查与代码核验。

1. **已实施成果**：完成主进程 Shard、受主窗口 mainFrame 严格防护的 21 项 IPC 端点、基于 `safeStorage` 的独立加密凭据存储（凭据完全隔离于设置、状态同步与日志）、带流式读取上限（2MB）和硬性重定向禁止（`redirect: 'error'`）的双协议视觉模型客户端（Gemini / OpenAI-compatible）、216 条离线 HexARAM 增益卡库与原子 Overlay 更新器、主进程截图/导图预览与多屏安全隐藏、ChampionData Mayhem 唯一名称口径映射、以及基于 Vue 3 + Naive UI 的主窗口侧边栏与中英双语页面。
2. **基准验证结论**：`typecheck:node` 与 `typecheck:web` 均零错误通过；Vitest 针对 ARAM 助手与网络 Session Fetch 的 7 个测试套件（27 项测试）全部通过；`git diff --check` 无空白或格式异常。
3. **关键发现**：5 项历史待复核问题中，**ENOENT 静默回退（第 5 项）已彻底修复并有严格单测验证**；但仍有 **4 项实现缺陷仍然存在**，其中最严重的为**选人期与对局期 gameId 不一致导致的自动攻略重复触发及双重计费（High）**，以及**选人重置后 `_autoAttemptedSignature` 未清空导致的同 gameId 永久失效（Medium）**、**`updateCatalog` 缺乏生命周期 Abort 与并发互斥（Medium）**、**`cancelAnalysis` 无活动请求时的 UI 报错与析构副作用（Low）**。

---

## 二、 历史审查项复核证据 (Verification of Prior Findings)

根据终审简报要求，对前期 5 项独立发现进行逐项证据比对与机理判定：

| 序号  | 审查项                                                                    |       当前状态       |  严重级别  | 关键代码位置                                                                                                                                              |
| :---- | :------------------------------------------------------------------------ | :------------------: | :--------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | `_resetMatch` 未清空 `_autoAttemptedSignature`                            | **仍存在 (Unfixed)** | **Medium** | `src/main/shards/aram-assistant/assistant-controller.ts:815-830`                                                                                          |
| **2** | 选人期 gameId 与对局期不同导致自动攻略二次扣费                            | **仍存在 (Unfixed)** |  **High**  | `src/main/shards/aram-assistant/assistant-controller.ts:413-428`<br>`src/main/shards/aram-assistant/match-context.ts:34,94-119`                           |
| **3** | `updateCatalog` 缺乏与 `dispose` 的 abort 及并发互斥                      | **仍存在 (Unfixed)** | **Medium** | `src/main/shards/aram-assistant/assistant-controller.ts:282-296,138-144`                                                                                  |
| **4** | `dispose` 未清理 `_statsInFlight` 及 `cancelAnalysis(false)` 伴生 UX 报错 | **仍存在 (Unfixed)** |  **Low**   | `src/main/shards/aram-assistant/assistant-controller.ts:305-317,138-144`<br>`src/renderer/src-main-window/views/aram-assistant/AramAssistant.vue:296-298` |
| **5** | 首次启动 Overlay 缺失 (ENOENT) 应静默处理                                 |  **已修复 (Fixed)**  |  **N/A**   | `src/main/shards/aram-assistant/catalog-loader.ts:276-285,543-550`<br>`src/main/shards/aram-assistant/catalog-loader.test.ts:49-74`                       |

### 详细复核证据与失效机理：

#### (1) `_resetMatch` 未清空 `_autoAttemptedSignature` (Medium)

- **代码事实**：
  在 `assistant-controller.ts:815-830`：
  ```ts
  private _resetMatch() {
    this._generation += 1
    this._active?.controller.abort()
    this._active = null
    this._manualChampionOverride = null
    this._deferredAutomaticSignature = null
    this.screenshot.clear()
    runInAction(() => {
      this._context.state.history = []
      this._context.state.latestResult = null
      this._context.state.active = false
      this._context.state.lastErrorCode = null
      this._context.state.manualChampionOverrideId = null
      this._context.state.matchGeneration += 1
    })
  }
  ```
- **机理分析**：
  `this._autoAttemptedSignature` 在 `_resetMatch` 中**未被重置为 null**。当玩家因选人有人秒退、房间重建或进入新自定义局而触发 `shouldResetMatch` 时，上下文和历史被清空；但如果新局分配到相同 `gameId`（如练习模式、部分自定义房或 LCU 会话重用），`_considerAutomaticGuide` 检查 `signature === this._autoAttemptedSignature` 时为 true，导致新对局**永久不再触发自动攻略**。
- **最小修复建议**：
  在 `_resetMatch()` 中补充 `this._autoAttemptedSignature = null;`。

#### (2) 选人期 gameId 与对局期不同导致自动攻略二次扣费 (High)

- **代码事实**：
  `src/main/shards/aram-assistant/match-context.ts:34`：
  ```ts
  const gameId = positiveId(gameData?.gameId) ?? positiveId(champSelect?.gameId)
  ```
  在 `assistant-controller.test.ts:253-268` 中，测试用例甚至显式断言了这种二次调用：
  ```ts
  action(() => {
    league.data.gameflow.phase = 'ChampSelect'
    league.data.champSelect.session = champSelectSession('session-a', 8042)
  })()
  // ... fetch called 1 time
  action(() => {
    league.data.gameflow.phase = 'InProgress'
    league.data.champSelect.session = null
    league.data.gameflow.session.gameData.gameId = 8043
  })()
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)) // 触发了第 2 次扣费请求
  ```
- **机理分析**：
  在 LCU 某些环境或模式中，选人阶段 `champSelect.gameId` 可能为临时 Session/Lobby ID（正整数 A），此时若队友已就绪，自动攻略在选人期触发并计费，设置 `_autoAttemptedSignature = 'A'`。当游戏切入载入或进行中（`InProgress`）时，`gameData.gameId` 变为真实比赛 ID（正整数 B）。
  在 `_onMatchContext` 中，`previous.gameId (A) !== next.gameId (B)`，导致 `shouldResetMatch` 判定为**新对局**并执行重置，随后以签名 `'B'` 再次触发自动攻略！
  这导致同一场游戏被调用两次大模型，不仅重复消耗 API 额度，而且在重置时还会将选人期已生成的攻略和已确认卡牌清空，严重违反 `design-decision.md` 第 3 条「不重复扣费」要求。
- **最小修复建议**：
  对局生命周期中建立从 ChampSelect 到 InProgress 的 handoff 关联，或对同一连续会话在进入 InProgress 发生 gameId 漂移时迁移 signature 而不是执行重置与二次调用。

#### (3) `updateCatalog` 缺乏与 `dispose` 的 abort 及并发互斥 (Medium)

- **代码事实**：
  `assistant-controller.ts:282-296`：
  ```ts
  async updateCatalog() {
    const current = this._requireCatalog()
    const next = await fetchCatalog({
      fetchImpl: (input, init) => this._context.network.fetch(input, init)
    })
    assertUpdateAllowed(current, next)
    await writeCatalogAtomically(this._overlayPath, next, current)
    runInAction(() => {
      this._context.state.catalog = next
      this._context.state.catalogSource = 'user'
      this._context.state.catalogFallbackCode = null
    })
    this._statsCache.clear()
    return catalogMetadata(next, 'user')
  }
  ```
  `assistant-controller.ts:138-144`：
  ```ts
  dispose() {
    this._reaction?.()
    this._reaction = null
    this.cancelAnalysis(false)
    this.screenshot.clear()
    this._statsCache.clear()
  }
  ```
- **机理分析**：
  1. `fetchCatalog` 虽然实现了 `signal` 支持（`catalog-loader.ts:325`），但 `updateCatalog` 调用时**并未传递任何 AbortSignal**。在 Shard 析构（`dispose`）时，无法中止正在进行的网络下载。
  2. 下载完成后，后续逻辑将继续无条件执行 `writeCatalogAtomically` 写入磁盘，并对已析构实例执行 `runInAction` 修改 MobX 状态及清理缓存。
  3. `updateCatalog` 无并发门禁。若前端连击或并发调用 IPC，将同时产生多个并发网络请求并在同一目标路径并发临时文件写入与重命名。
- **最小修复建议**：
  为 `AramAssistantController` 增加 `_catalogUpdateAbortController`，在 `dispose()` 中予以中止；同时增加 `_catalogUpdatePromise` 互斥保护，并发调用直接复用或等待未决更新。

#### (4) `dispose` 未清理 `_statsInFlight` 及 `cancelAnalysis(false)` 伴生 UX 报错 (Low)

- **代码事实**：
  `assistant-controller.ts:305-317`：
  ```ts
  cancelAnalysis(runDeferredGuide = true) {
    this._generation += 1
    this._active?.controller.abort()
    this._active = null
    if (!runDeferredGuide) this._deferredAutomaticSignature = null
    this.screenshot.clear()
    runInAction(() => {
      this._context.state.active = false
      this._context.state.latestResult = null
      this._context.state.lastErrorCode = 'CANCELLED'
    })
    if (runDeferredGuide) this._runDeferredGuideIfReady()
  }
  ```
  在 `AramAssistant.vue:296-298`：
  ```vue
  <NAlert v-if="state.lastErrorCode" type="error" :title="t('aramAssistant.error.title')">
    {{ errorMessage(state.lastErrorCode) }}
  </NAlert>
  ```
- **机理分析**：
  1. `cancelAnalysis` 无视当前是否有正在运行的请求（`this._active === null`），只要被调用，就必定执行 `lastErrorCode = 'CANCELLED'` 并将 `latestResult` 置为 null。
  2. 当 Shard 析构时，`dispose()` 内部调用 `cancelAnalysis(false)`，会导致在页面关闭或应用退出前瞬间派发 `lastErrorCode = 'CANCELLED'`，并在 UI 上渲染红色的“请求已取消”错误警告框，同时强行抹去用户已经查看完的历史回复。
  3. `_statsInFlight` Map 在 `dispose()` 中未被清理，若有在途的 `loadDetails` 请求，其 Promise 在完成后仍可能执行回调。
- **最小修复建议**：
  在 `cancelAnalysis` 开头加入守卫：若 `!this._active`，直接退出，不清除 `latestResult` 也不修改 `lastErrorCode`；析构时调用的取消不应向前端派发用户可见错误码；在 `dispose()` 中清空 `_statsInFlight`。

#### (5) 首次启动 Overlay 缺失 (ENOENT) 静默回退 (已验证修复)

- **代码事实**：
  `catalog-loader.ts:276-285`：
  ```ts
  try {
    const overlay = await readCatalogFile(options.overlayPath)
    assertUpdateAllowed(bundled, overlay)
    return { catalog: overlay, source: 'user' }
  } catch (error) {
    if (isMissingFile(error)) return { catalog: bundled, source: 'bundled' }
    if (!(error instanceof CatalogError)) throw error
    return {
      catalog: bundled,
      source: 'bundled',
      fallbackCode: error.code
    }
  }
  ```
  `isMissingFile` 准确匹配 `error.code === 'ENOENT'`。首次启动时，因不存在 `catalog-overlay.json`，直接返回 `{ catalog: bundled, source: 'bundled' }`，无 `fallbackCode`。
  `assistant-controller.ts:124` 写入 `state.catalogFallbackCode = null`，不会触发 logger.warn，UI 亦不会显示“保存的卡库无法读取”告警。当存在损坏文件（如 `{`）时，才返回 `INVALID_JSON` 并触发提示。
- **验证证据**：
  `catalog-loader.test.ts:49-74` 测试用例明确断言了首次缺失时为 `{ catalog: bundled, source: 'bundled' }`，损坏时带 `fallbackCode: 'INVALID_JSON'`。该项已完全修复并符合预期。

---

## 三、 新增代码质量与架构合规项 (Detailed Severity-Ranked Findings)

除上述历史项外，对全工作区新增代码的规范性与潜在隐患进行全面筛查，按严重级别排序如下：

### 1. High 级别

- **H1. [对局与计费] 选人转对局 gameId 漂移导致双重计费与状态清空**（详见前文复核项 2）
  - **位置**：`src/main/shards/aram-assistant/match-context.ts:34`、`assistant-controller.ts:413-428`
  - **影响**：同场对局在选人期与对局期分别计费一次，违反 `design-decision.md` 约束。

### 2. Medium 级别

- **M1. [生命周期] 选人重置未清除已尝试签名导致同 ID 无法再次自动攻略**（详见前文复核项 1）
  - **位置**：`src/main/shards/aram-assistant/assistant-controller.ts:815-830`
  - **影响**：秒退或重置后的相同 gameId 无法触发自动阵容建议。
- **M2. [并发与安全] 卡库更新缺乏 AbortController 绑定与并发排队控制**（详见前文复核项 3）
  - **位置**：`src/main/shards/aram-assistant/assistant-controller.ts:282-296`
  - **影响**：Shard 析构后持续占用网络与磁盘 IO，存在写冲突风险。

### 3. Low 级别

- **L1. [交互体验] `cancelAnalysis` 在空闲状态下清空结果并报取消错误**（详见前文复核项 4）
  - **位置**：`src/main/shards/aram-assistant/assistant-controller.ts:305-317`
  - **影响**：非活动状态下调取消会抹掉现有回复并闪现红色告警框。
- **L2. [单测规范] 测试中存在非 action 块直接修改 MobX observable 警告**
  - **位置**：`src/main/shards/aram-assistant/assistant-controller.test.ts:274`
  - **证据**：测试执行时 stderr 输出 `[MobX] Since strict-mode is enabled, changing (observed) observable values without using an action is not allowed. Tried to modify: AramAssistantSettings@30.automaticGuide`。
  - **修复**：将 `settings.automaticGuide = false` 移入 `action(() => { ... })()` 中。
- **L3. [i18n 规范] 英文翻译词条缺少复数后缀（违反 UI 规范）**
  - **位置**：`src/shared/i18n/en/renderer/aram-assistant.yaml:52,58`
  - **证据**：`count: '{{count}} records'` 与 `updated: Catalog updated to patch {{patch}} with {{count}} records.` 未定义 `count_one` / `count_other`。在单数记录时会出现语法缺陷。
  - **修复**：按 `league-akari-ui-components` skill 要求补全 i18next 复数分支。
- **L4. [Tailwind 规范] SFC 中使用了非推荐的 Tailwind 任意属性语法**
  - **位置**：`src/renderer/src-main-window/views/aram-assistant/AramAssistant.vue:323,331`
  - **证据**：使用 `text-[var(--la-color-link)]` 而非 Tailwind v4 推荐的 `text-(--la-color-link)`。
  - **修复**：更新为 v4 推荐语法 `text-(--la-color-link)`。

---

## 四、 积极合规项核实 (Verified Conformance Areas)

在其余核心架构与安全规范方面，当前实现展现了高水平的严密性与工程规范：

1. **凭据安全与隔离**：
   - `AramCredentialStore` 严格将 API Key 加密存储在 `userData/aram-assistant/credentials/` 下，文件命名为 SHA-256 哈希；
   - 彻底与 `SettingFactoryMain` 隔离，确保凭据绝不会随用户配置导出或泄露到公共备份；
   - `safeStorage` 不可用或解密失败时准确降级为内存会话，并清除磁盘残余；
   - MobX state 同步和 IPC 只透传 `configured: boolean` 与 `storageMode`，无任何密钥明文流向渲染进程或日志。
2. **IPC 边界防护**：
   - `AramAssistantIpcHandlers` 的所有 21 个端点无一例外地调用了 `this._assertMainFrame(event)`，严格比对 `event.sender === mainWindow.webContents` 及 `event.senderFrame === mainWindow.webContents.mainFrame`，有效阻止其他 4 个辅助窗口或非法 frame 越权调用。
3. **网络与协议安全**：
   - `normalizeBaseUrl` 彻底封堵了 userinfo（`@`）、query（`?`）、hash（`#`）、非法百分号转义及完整请求端点（`/chat/completions` 等）；
   - HTTP 协议严格限定为字面本地回环 `127.0.0.1` 或 `[::1]`，杜绝非回环明文泄露风险；
   - `NetworkMain.fetch` 底层与所有上游请求强制显式指定 `redirect: 'error'`，完全杜绝 30x 重定向安全隐患。
4. **防御性流式读取与响应限制**：
   - `readResponse` 与 `fetchCatalog` 均在数据块读取循环中逐 chunk 检查 `signal.aborted`，并硬性设置 2MB 最大上限（`PROVIDER_MAX_RESPONSE_BYTES`），超出立即 `reader.cancel()` 并抛出 `RESPONSE_TOO_LARGE`，防止内存耗尽。
5. **离线卡库完整性**：
   - 216 条 HexARAM 快照数据完整，包含 `standard`、`ability`、`quest`、`special` 等分类，哈希校验严格匹配 `aac125ef...`；
   - 包含版本单调递增及同版本条目骤降超过 20% 的拒绝机制；采用临时文件 + 同步 + 原子重命名（带重试）保存。
6. **对局上下文复用**：
   - 唯一依赖 `LeagueClientMain`，零重复轮询、零重复 WebSocket；本人识别通过 `localPlayerCellId`、`puuid`（防御 `EMPTY_PUUID`）及 `summonerId` 严格匹配，绝不猜测队伍第一人。
7. **数据口径与输出安全**：
   - ChampionData 严格按唯一名称映射，歧义名称不注入；清晰区分 OP.GG 专属性能/热度分与 QQ101 大盘统计，严禁误称胜率；
   - Vue 模版采用标准文本节点渲染，未引入 `v-html`，杜绝 XSS 风险。

---

## 五、 残留未验证领域 (Residual Unverified Areas)

按照审查准则，明确区分“代码逻辑审查与本地模拟证据”与“未实地验证的运行环境”：

1. **真实 League Client 联机对局验证**：未在真实运行的英雄联盟客户端（特别是国服与外服实机）中验证长时间排队、重连、游戏内崩溃及实时对局状态流转。
2. **真实商业大模型付费 API 验证**：测试均基于本地模拟桩（Postman/Mock 200/401/429/500/Timeout），未连接 Google 或 OpenAI 的官方付费生产端点进行真实鉴权与额度扣除测试。
3. **Windows 实机环境**：本审查在 macOS 环境下执行。Windows 特有的 DPAPI 加密、文件锁定（对原子重命名的影响）、以及 `desktopCapturer` 在 Windows 缩放比例下的实际截图表现未在物理机上实测。
4. **全屏独占与 DirectX 游戏窗口截屏**：桌面截屏隐藏窗口在测试模拟下通过，但游戏运行在全屏独占模式时的截屏兼容性有待实机游戏检验。

---

## 六、 结论与建议 (Verdict & Recommendations)

**综合评审结论**：**原则通过，但需完成 4 项缺陷修复后方可发布**。

实现整体契约对齐度极高，代码结构严谨，测试覆盖充分。建议 Luna 针对本报告指出的 **H1、M1、M2、L1** 进行针对性微调修复，重新执行 Vitest 与类型检查后完成最终交付。
