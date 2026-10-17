# LeagueAkari implementation ownership handoff

User explicitly requested a NEW Codex session in `/Users/owenwu/codebase/personal/LeagueAkari` with YOLO mode. This is a full ownership handoff: previous coordinator stops once prompt accepted. Continue autonomously, no human design-review gates. Do not confuse completed reference prototype with completed native implementation.

## User scope and workflow

- Implement ARAM Mayhem assistant INSIDE LeagueAkari, unified native UI. ARAM-tool is reference only.
- Decouple Gemini: support Gemini-native and OpenAI-compatible vision endpoints with configurable base URL/model/key.
- Refresh latest Mayhem augment cards, bundle offline snapshot and explicit update operation.
- Automatically consume client/game info on launch through Akari's existing LeagueClientMain, no second LCU/process/lockfile/WebSocket stack.
- Five design reviewers requested: pi, prime-agent, cursor, opencode2, agy. Four native reviews are complete, Pi still working. Finish adjudication then implement.
- After implementation, OpenCode2 unified review MUST use free exact model `opencode/glm-5.3-flash-free`; fix actionable findings and validate again.
- Primary investigates/plans/reviews, bounded implementation/tests delegated to GPT-6-Luna reasoning max. Do not recursively delegate from execution worker. Fast mode cannot be selected through known launcher; already disclosed.
- Worker launch explicitly `codex --approve-for-me --model gpt-6-luna -c model_reasoning_effort="max"`, verify `/status`. New primary YOLO is explicitly user requested; execution workers retain automatic approval per standing instructions. No commit/push requested.

## Current source and design artifacts

- Target `/Users/owenwu/codebase/personal/LeagueAkari`, dev HEAD initially `56cdfde00e56148f4641d1a8cf86acb66e903124`, clean before feature. Dependencies installed, NO native feature implemented yet.
- Native design `/tmp/aram-akari-native-design.md`; native reviews `/tmp/aram-akari-reviews/native-{cursor,agy,prime-agent,opencode2}.md`. Pending `native-pi.md`. Copy artifacts into target docs for durable ownership. Write final design decision before implementation.
- Reference `/Users/owenwu/codebase/personal/ARAM-tool`: `docs/core-handoff.md`, `docs/electron-design.md`, `docs/implementation-brief.md`, `docs/league-akari-integration.md`, `docs/reviews/`; reference implementation `electron/core/*.cjs`, tests, `data/augments.json`. Do not further implement standalone app.
- Reference worker claimed 54 tests, coverage94% lines/81% branches, simulation and UI smoke. Prior primary only independently checked initial7 cardtests and source equivalence/hash, NOT full reference validation. Native checks still required.

## Mandatory corrections to design

- New native `aram-assistant-main` shard, native main-window renderer shard/route/sidebar using Naive UI/theme/i18n, no separate application shell. Read target AGENTS.md and `.agents/skills/league-akari-{shard-development,ui-components,sgp-data-source,mcp-debug}/SKILL.md`.
- Main entry `src/main/main.ts`; register main in bootstrap, renderer in `src/renderer/src-main-window/shards/index.ts`; route `src/renderer/src-main-window/routes/index.ts`; Sidebar.vue and shell i18n. Translation resources require explicit imports/merge in `src/renderer-shared/i18n/index.ts`.
- Use actual existing `LeagueClientMain.data.gameflow`, champSelect, summoner, gameData. Mode KIWI / queue2400 is Mayhem, ARAM / queue450 normal ARAM. `benchEnabled` only champ-select aid, not in-game predicate. No auto model calls on connect. Auto-guide explicit defaultOFF, readiness+positivegameId dedup; preserve mode semantics.
- Snapshot own context/history. ChampSelect null/Delete at loading is SAME match, disconnection clears upstream but must not erase confirmed history. gameId0 transient cannot churn generations; positive new gameId/new champselect session resets once. Resolve self via localPlayerCellId then puuid/summonerId, exclude EMPTY_PUUID, patch champion selections when team champId0; never guess first ally as self. Cancellation/generation prevents late results. Manual champoverride stable, explicit return to follow.
- Model key MUST NOT enter SettingFactory setting table because settings export includes all Setting rows. Dedicated safeStorage encrypted atomic credential file under userData/aram-assistant or memory-only if unavailable. Renderer/state/export/logs never include secrets/encrypted bytes; expose hasKey/storage flag only.
- All sensitive/expensive new IPC needs main-window webContents + mainFrame sender gate and validated bounded args. Existing router reaches all5 windows. Follow native IPC envelopes, no double wrappers.
- Main-process Electron desktopCapturer is valid NEW import. Reuse WindowManagerMain's existing window fields, hide only visible alreadycreated windows, restore in finally. No hideAll API. Don't accept arbitrary file paths from renderer. Genuine validPNG testfixture (reference onepixel decode failed).
- Explicit image-only mode (no mandatory manuallytyped3cards), text-only mode (no screenshot requirement). Prompt includes currentchamp/team/context. Plaintext model output: existing shared markdown enables html:true, do NOT use it.
- ChampionDataMain.loadDetails query mode `aram_mayhem` (not KIWI), source opgg|qq101 explicit. NO silent crosssource fallback: distinct dataset contract. Optional cancellation3rdarg backwardscompatible if needed. Cache/dedupe per source:mode:champion and generation cancellation.
- Stats numeric augment IDs differ from HexARAM slug: only explicit verified mapping via gameData names, handle ambiguities; if unmapped omit stats. OP.GG performance/popularity != winrate (winrate null); QQ101 modewide winrates != championconditional. Do not invent hero-augment stats from hero pair synergies. Offline/model recommendation works without stats.
- Bundle resource using established `@resources/...json?asset&asarUnpack` pattern rather than guessed paths. Runtime must not reference old repo.
- Provider timeout must truly abort; bound streamingresponse/image sizes; normalize null/primitive JSON and malformed URLs into domain errors; retry network errors only, not oversized/invalid responses. Refresh analysis catalog after update rather than captured stale instance.

## Verified upstream cards

- Public source https://hexaram.lol/zh/augments/ publishes `/data/mayhem/augment-catalog.json`; robots allows. ApexLol blockedCloudflare, don't bypass.
- Raw `/tmp/aram-catalog.json`, endpoint https://hexaram.lol/data/mayhem/augment-catalog.json . schemaVersion1, riotPatch26.20, 216uniqueentries, 272099bytes, SHA256 `aac125ef54cf23e47967a5884b9ca710590287f3117587adaa64cdf3d0984987`.
- Reference `data/augments.json` normalized complete; primary compared bilingual names/effects, zero mismatches and matching hash. kind standard171/ability30/quest11/special4; scope aram136/shared80; textStatus verified180/dynamic36. Preserve classifications and dynamic text, don't equate all216 to selectable pool. sourcePatch source declaration not installed client version.
- Offline bundle + validated atomic userDataoverlay; no startupcrawl. Reject duplicates/missingfields/unknownschema/<100cards, olderpatch vs effectivebaseline, samepatch>20%drop; newerpatch may rotate. Fail keeps prior file; streaming sizecap; no silent texttruncation.

## Validation

- Bundled Yarn: `node .yarn/releases/yarn-4.18.0.cjs ...` (global yarn absent). immutableinstall completed, no unrelated dependencychanges.
- Baseline independently passed `typecheck:node` and `typecheck:web`. Need targeted realbehavior Vitest, fulltest, both typechecks, build, changedfilesformat, UI/runtime smoke and packaged assetpaths iffeasible.
- Dev remote-debug port8944. Read mcp-debug skill; configuredMCP preferred; fallback CDP only when unavailable. Use isolated userData for smoke; don't mutate real userdb. Actual live LoL client, Windows, realpaidmodelkey not yet verified; don't claim them. Repo README says Tencent-operatedservers unsupported, nopromiseWeGame.

## Orca current resources and ownership

- CLI executable `orca`; use `orca skills get orca-cli --json` before commands. Full handoff: no task-create/dispatch tracking, just terminal send receipt.
- Target repo/worktree `05be3208-2a1e-4f22-870b-ffe0bc4cc2e6::/Users/owenwu/codebase/personal/LeagueAkari`.
- Previous supervisedrun `run_e55b3dc4659c`, coordinator `term_4fec29f1-989b-4c1f-872f-5876fc3244a7` will stop. May access old mailbox explicitly to settle outstanding reviewer; don't wait on deadparent.
- READY idle Luna terminal `term_902ab2fa-16c2-46be-b71b-cbcc0a963627`: launch verified exactLuna/max, `/status` Workspace(Approveforme), cwdtarget. NOT dispatched. Reuse it for bounded implementation; do not launch duplicate writers. Session `01a1495e-00d2-7451-9639-825513e36884`. Approx41%5hquota remaining at18:21SGT, reset20:50.
- Pending Pi terminal `term_deb7ca4a-b1b5-4625-b2c6-7b2c48f116be`, working read-only native review. Task `task_c36bec97e85b`, retrydispatch `ctx_d5c9f089fc6f`; initial readinessfailed dispatch `ctx_95207e533ebf` ownsresources. Trust prompt chosen DoNotTrust(projectextensionsdisabled) sessiononly. Finish report then release according to orchestration receipts; do not kill workingPi. Can inspect terminal/report.
- Cursor and AGY native lifecycle completed, released/acked.
- Prime standalone terminal `term_a222e954-d848-41e6-9de8-e83da22eaa52` and GLM standalone `term_ce1ffca5-1d93-47d9-9185-d48eb81f0930` finished at shell, reportsready. Optional cleanupclose these confirmed idleonly.
- OpenCode2 custom model worker-start unsupported. Use `orca terminal create ... --command 'opencode2 run --standalone --auto --model opencode/glm-5.3-flash-free --title ... "read-onlyreviewprompt"'`. Exact model verifiedworking. Defaultprovider CERT_HAS_EXPIRED, unsuffixedglm unavailable. Don't modify globalconfig. ReusefreeGLM for finalunifiedreview.
- Prior reference Luna closed/settled, no active reference writers.

Continue ownership now: inspect reports, finish Pi/adjudication, delegate complete native implementation to existing Luna, inspect diff and independent checks, freeGLM finalreview, route fixes, verify outcome, final Chinese report. No further human review needed. Keep progress updates concise and frequent.
