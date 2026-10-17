# Native Akari ARAM assistant — architecture / DI lifecycle / IPC-state review (`native-pi`)

Reviewed: `/tmp/aram-akari-native-design.md` (amendment), specifically "避免重复基础设施", "原生模块与界面", "可复用核心", "卡库与Akari数据生态". Target HEAD `56cdfde0` (clean). Skill read: `.agents/skills/league-akari-shard-development/SKILL.md`. Method: direct source inspection of the concrete public APIs the design names; no old Python or prior reviews re-read.

## Blockers / High

### H1. "自动读取" misses the initial context when LCU is already connected — lifecycle race

`LeagueClientMain.onInit` runs `_watchConnection()`, which `await`s `_tryResumeConnection()` (`src/main/shards/league-client/index.ts:139,324`), and LCU state loading starts from a connection reaction (`src/main/shards/league-client/lc-state/index.ts:1370-1384`). `aram-assistant-main` is initialized after `LeagueClientMain`, so `data.champSelect.session` / `data.gameflow.session` may already be populated. `MobxUtilsMain.reaction` defaults to `fireImmediately: false` (`src/main/shards/mobx-utils/index.ts:195-210`), so a naive derivation reaction never sees that state until the next mutation.
Impact: the headline requirement ("客户端启动后自动读对局") fails for the first champ select / in-game when Akari starts with the client already running.
Fix: derive `AramMatchContext` once synchronously in `onInit` (or register with `{ fireImmediately: true }`), mirroring `champ-select-handoff-controller.ts:61,93`. Add a test that initializes the shard with an already-populated `data.champSelect.session`.

### H2. Match/identity derivation is duplicated instead of reusing existing pure helpers

`ongoing-game` already derives everything the design's `AramMatchContext` wants: `getLiveQueryStage` (`computed-state.ts:429-491`, uses `gameflow.session.gameData.queue.id/type/gameMode/gameId`), `getLiveChampionSelections` (`:58-126`, merges champ-select + in-game + LCU/`playerChampionSelections`), `getLiveTeams` (`:221+`), and `collectVisibleChampSelectMembers` / `getVisibleChampSelectPuuid` (`champ-select-members.ts:15-53`, TEAM-100/200 plus `nameVisibilityType`/`obfuscatedPuuid` handling). The design proposes its own puuid/summonerId matcher and never mentions these.
Impact: divergence on EMPTY_PUUID filtering, `GameStart` phase, CHERRY `TEAM-ALL`, obfuscated puuids, and two sources of truth for the same LCU state.
Fix: extract the pure helpers into a neutral module (e.g. `src/main/utils/league-client/*`) consumed by both shards — do not import another shard's internals. Derive `gameId` from `gameflow.session.gameData.gameId`; note `champSelect.session.gameId` is not reliably positive (`champ-select-handoff.ts:26` returns null when falsy).

### H3. Augment name/icon resolution already exists; the catalog must not be a second source of truth

`AkariResourceProvider.augments.name/display` already resolves ids through LCU `gameData.augments` then `ExtraAssetsMain.gtimg.kiwiAugments` (refreshed every 3h, `extra-assets/context.ts:10`), with locale-aware tooltips (`src/renderer-shared/providers/akari-resource/akari.ts:258-296`). The design bundles a 216-entry catalog with its own naming and does not define precedence.
Fix: key the catalog by the same `augmentId` and store only what LCU/GTIMG lack (scope standard/ability/quest/special, textStatus, categories, patch); resolve display name/icon/rarity via `AkariResourceProvider`; document precedence and unknown-id behavior (do not ship a parallel icon table).

### H4. Provider requests would bypass `NetworkMain` (proxy) — missing dependency

Every existing outbound main-shard HTTP client goes through `NetworkMain.createAxiosClient()` (`champion-data/index.ts:128-129`, `extra-assets/index.ts:49-54`), which applies Akari's proxy/session settings. The design's dependency list omits `NetworkMain`, so a raw axios client would ignore the user's proxy for Gemini/OpenAI-compatible endpoints.
Fix: add `NetworkMain` to the shard deps and build the provider client from `network.createAxiosClient(...)`; keep AbortController/timeout/retry/limit logic in `model-executor`.

## Medium

### M1. Screenshot capture: display choice, macOS permission, restore semantics

`desktopCapturer.getSources` yields one source per display; neither the amendment nor the repo picks a display or checks permissions. Akari supports darwin (`app-common/state.ts:9`, shared global `platform`). Window visibility is `state.show`, and `show()/hide()` are the public APIs (`base-akari-window.ts:157-160,733-782`).
Fix: capture the display containing the League window (`screen.getDisplayMatching` is already used in `window-manager/window-position-service.ts:131`) or let the user choose; on darwin check `systemPreferences.getMediaAccessStatus('screen')` and return a typed error; restore only windows whose `state.show` was true before hiding.

### M2. Screenshot/preview must stay out of propSync state

`propSync` ships every registered prop through `toJS` on change and on subscribe (`mobx-utils/index.ts:70-118,160`). A base64 screenshot in synced state would be copied to every subscribed renderer on each change.
Fix: keep captured images in a non-propSync holder; return the preview through a dedicated `onCall` (size-capped, one-shot) or the existing `akari://` protocol; only send the image once, on explicit request.

### M3. Manual champion override must live in main state and feed the paid prompt

"手动英雄修正当局保持" is ambiguous about ownership. If the override is renderer-local, `analysis-controller` would build the augment prompt from the raw LCU champion while the UI shows the corrected one (and the paid request is then for the wrong champion).
Fix: keep the override in `aram-assistant-main` observable state, synced to renderers; `analysis-controller` reads the overridden champion; "恢复自动跟随" clears it; reset only on new gameId/champ-select generation.

### M4. Disposal / cancellation ownership is unspecified

`IAkariShardInitDispose.onDispose` is the teardown hook (`src/shared/akari-shard/interface.ts:4-18`); MobxUtilsMain disposes reactions, but in-flight HTTP, the pending auto-analysis queue, and temporarily hidden windows are not covered by the design.
Fix: `onDispose()` aborts the active AbortController, clears pending/retry state, and restores window visibility; expose explicit cancel over IPC and test cancel-during-request.

### M5. Small integration details that otherwise break the page

- Sidebar `handleMenuChange` calls `router.replace({ name: val })` (`src/renderer/src-main-window/components/sidebar/Sidebar.vue:170-210`): add a **named** route in `routes/index.ts` whose `name` equals the menu `key`; `/aram-assistant` path alone is not enough.
- New YAML must be registered in `src/renderer-shared/i18n/index.ts` `mergeRendererResources` (plus `main.yaml` if main logs are localized).
- Follow the settings convention: `settingFactory.register(namespace, schema, settings)` then `await settingService.applyToState()` in `onInit` before `propSync` (`champion-data/index.ts:95-108`).
- `resources/` has no `data/` yet; bundled JSON needs the `@resources/...?asset&asarUnpack` import pattern (alias in `electron.vite.config.ts:68`, `asarUnpack: resources/**` in `electron-builder.yml`). `vitest.config.ts` has no `@resources` alias, so catalog tests must mock it or read from disk.
- Specify where confirmed-card history persists (SettingFactory key + schema + cap) and whether it survives restart vs. only the current gameId.

## Verified OK

- `LeagueClientMain.data.{gameflow,champSelect,summoner,gameData}` exist as observables and are `propSync`ed; `champSelect.session` is nulled on `Delete` events and on disconnect (`lc-state/index.ts:981-988`), matching the design's reset/teardown assumptions.
- `MobxUtilsMain.propSync/reaction`, `SettingFactoryMain.register/applyToState`, `AkariIpcMain.onCall/sendEvent`, renderer `call/onEventVue` match the design's intended IPC/state boundaries; shard id `aram-assistant-main` follows the `-main` convention and register-after-dependency in bootstrap is safe (manager topologically initializes deps first).
- `ChampionDataMain.loadDetails({ mode: 'aram_mayhem' }, championId)` is public and both sources declare `champion-augments` capability (`capabilities.ts:36-76`); the `ChampionDataLoadResult` union has an explicit `unavailable` status to surface.
- `WindowManagerMain` exposes `opggWindow/ongoingGameWindow/cdTimerWindow/auxWindow` with public `show()/hide()/state.show`; feature shards (`tray`, `main-window-ui`) already depend on it — no DI ordering/circular issue.
- Security boundaries in the amendment (single LCU connection, no renderer fetch/file-path IPC, key scoped to protocol+normalized base URL with safeStorage fallback, no auth/state copied into prompts) are consistent with AGENTS and the shard skill.
