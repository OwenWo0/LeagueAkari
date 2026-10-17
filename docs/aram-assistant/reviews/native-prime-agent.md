# ARAM Native Integration Review — Match Lifecycle / Packaging / Runtime

Scope: native match context/event lifecycle and packaging/resources/type/runtime compatibility only.  
Source: `/tmp/aram-akari-native-design.md` vs LeagueAkari dev HEAD + `.agents/skills/league-akari-shard-development`.

---

## 1. `gameId` Nullability & Reset Boundaries

**Finding:** The design says "新 gameId 或明确新 ChampSelect 重置" but `gameflow.session.gameData.gameId` is only present in `ChampSelect` / `InProgress` / `GameStart`. In `Lobby` and `Matchmaking` it is absent.
**Evidence:** `GameflowSession.gameData: GameData` has `gameId: number`, but `lc-state/index.ts` emits `gameflow.setPhase('Lobby')` before `gameData` is populated.
**Fix:** Derive `AramMatchContext` from `champSelect.session?.gameId` **and** `gameflow.session?.gameData?.gameId`, treating `null` as "no active match". Reset on non-null `gameId` change or when `champSelect.session` transitions from `null → non-null` with `benchEnabled === true`.

## 2. LCU Disconnect Wipes Match Data

**Finding:** The design says "断连事件只改变连接状态，保留当前确认历史" but `LeagueClientData` clears all substates on disconnect via `_onLcuNotConnected` callbacks.
**Evidence:** `lc-state/index.ts` calls `gameflow.setSession(null)`, `champSelect.setSession(null)`, `summoner.setMe(null)` on disconnect.
**Fix:** The match-context controller must snapshot needed fields (`gameId`, `myTeam`, `theirTeam`, `playerChampionSelections`) into the shard's own MobX state **before** the LCU clear reaction fires. Reference `OngoingGameChampSelectHandoffController` snapshot pattern exactly.

## 3. Queue/Mode Validation Is Undefined

**Finding:** "可信相关ARAM/Mayhem对局" lacks exact queue IDs or `gameMode` strings.
**Evidence:** `gameflow.session.gameData.queue.id` is a number (450 for ARAM). `gameflow.session.map.gameMode` is also available. `ChampionDataMain` supports `preferences.mode: 'aram_mayhem'`.
**Fix:** Whitelist `queue.id === 450` (ARAM) and known Mayhem queue IDs. Reject `gameflow.session.gameData.isCustomGame === true` unless explicitly supported. Do not analyze Summoner's Rift by accident.

## 4. Session-Generation Cancellation Is Unspecified

**Finding:** "晚到请求以session generation过滤" has no implementation mechanism.
**Fix:** Use an incrementing `_sessionGen: number` in `AramMatchContext`. Pass it into every `model-executor` call. If the gen changed before resolution, discard the result. Couple with a real `AbortController` for the HTTP request itself.

## 5. `desktopCapturer` Does Not Exist in Project

**Finding:** The design says "截图由主进程对话框/desktopCapturer取得" but `desktopCapturer` is not imported anywhere.
**Evidence:** `grep -ri desktopCapturer src/` returns nothing.
**Fix:** Use `dialog.showOpenDialog` for file import (already used by `saved-player`, `setting-factory`). For clipboard images, note that `AppCommonMain` only exposes `clipboard.readText()`, not image buffers. If true screenshots are required, use `navigator.mediaDevices.getDisplayMedia` in renderer with explicit permission handling rather than assuming `desktopCapturer` availability.

## 6. `WindowManagerMain` Has No Hide-All Contract

**Finding:** The design depends on `WindowManagerMain` for "先隐藏所有当前工具窗口，抓取后恢复原可见性".
**Evidence:** `WindowManagerMain` exposes `mainWindow`, `auxWindow`, `opggWindow`, `ongoingGameWindow`, `cdTimerWindow`, but no `hideAll()` / `showAll()` method. Each `BaseAkariWindow` has `hide()` and `showOrRestore()`.
**Fix:** Iterate the known window properties, snapshot `.state.show` before hiding, then restore only those that were visible. Or add a thin `snapshotWindowVisibility()` / `restoreWindowVisibility()` method to `WindowManagerMain` to avoid brittle property enumeration.

## 7. Bundled Data Path Resolution Missing

**Finding:** "迁入Akari受控resources/data" lacks runtime path resolution.
**Evidence:** `electron-builder.yml` has `asarUnpack: - resources/**`. `app-common` exposes `resourcesPath: process.resourcesPath`.
**Fix:** Resolve via `path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../../resources'), 'data', 'augments.json')`. Do not use repo-relative paths in production.

## 8. Renderer Shard IPC Wrappers Omitted

**Finding:** The design lists renderer files `{index,store,state-sync,context}.ts` but omits IPC call wrappers.
**Evidence:** Every renderer-facing shard (e.g., `ongoing-game`) has thin IPC wrappers in `index.ts` like `setConcurrency()`, `setEnabled()`.
**Fix:** Add methods in renderer `index.ts` for `triggerAnalysis()`, `cancelAnalysis()`, `updateModelSettings()`, `confirmAugment()`, each delegating to `AkariIpcRenderer.call(ARAM_ASSISTANT_MAIN_NAMESPACE, ...)`. Alternatively create `ipc-handlers.ts` if the surface grows.

## 9. `ChampionDataMain.loadDetails` — Call Site Discipline

**Finding:** The design references `ChampionDataMain.loadDetails` for aram_mayhem augment data.
**Evidence:** Signature is `loadDetails(query, championId)` where `query.mode: 'aram_mayhem'`. This is valid.
**Fix:** Do not invoke this inside an unthrottled MobX `reaction` during champ select, or every `championId` hover will spawn a request. Use a debounced loader or cache per session.

## 10. Auto-Analysis Dedup Must Be `gameId`-Keyed, Not Connection-Keyed

**Finding:** "断连/重连不重复扣费" needs explicit dedup.
**Fix:** Track `_analyzedGameIds: Set<number>` in the main shard state. Only trigger when `gameId` enters a qualifying phase and is not in the set. Clear the set on `EndOfGame` or `gameId` change, **not** on disconnect.
