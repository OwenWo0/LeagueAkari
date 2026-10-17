# ARAM 助手原生实现报告

## 实现内容

- 新增主进程 `aram-assistant-main` shard、白名单对局上下文、设置与状态、受主窗口 mainFrame 限制的 IPC，以及主窗口路由、侧栏入口和中英文文案。
- 新增经过类型检查的 TypeScript 离线目录 loader。随包保存 216 条 HexARAM 26.20 快照，保留分类、范围、动态/特殊记录、来源和 SHA-256；支持搜索、建议候选、原子 overlay、显式网络更新和共享 loader 的 Node strip-types CLI。
- 实现 Gemini 原生与 OpenAI-compatible 视觉请求、自定义协议根/模型、按协议和规范化完整 URL 隔离的独立凭据、safeStorage 加密文件及失败时内存保存。URL 校验在写入设置前执行。请求经 NetworkMain fetch adapter，显式拒绝重定向并限制响应大小、超时和重试。
- 实现主进程截图与导图预览、多屏选择、macOS 权限短错误、窗口可见性恢复、取消与预览清理。图像可单独分析；文本模式只接受三个不同本地候选。模型结果不会写入历史；用户明确确认本地卡 ID 才记入本局历史，可撤销，后续请求会附上确认记录。
- 接入现有 LeagueClientMain 自动上下文及 ChampionDataMain Mayhem 统计。自动攻略默认关闭，按正 gameId 尝试一次，手动请求期间延迟，取消手动请求后会运行已延迟的一次尝试。统计只接收来源、模式和唯一映射均可验证的数据，并标注口径。
- 按 AGY 终审修复生命周期边界：ChampSelect 到 GameStart/InProgress 的同局 handoff 迁移已尝试或延迟的自动攻略签名并保留历史；明确新选人重置签名；卡库更新并发复用、随 shard dispose abort，析构后不回写状态；dispose 清理统计请求，空闲取消保留结果，静默析构不发布取消错误。
- 新增 provider Postman 契约和本地 simulation fixture；无 ARAM-tool 运行时依赖。

## 验证

按要求通过仓库 Yarn 4 wrapper 执行：

- `node .yarn/releases/yarn-4.18.0.cjs test src/main/shards/aram-assistant src/main/shards/network/fetch.test.ts`：AGY 修复后 7 个文件、32 项通过。
- `node .yarn/releases/yarn-4.18.0.cjs typecheck:node`：通过。
- `node .yarn/releases/yarn-4.18.0.cjs typecheck:web`：通过。
- `node .yarn/releases/yarn-4.18.0.cjs test`：AGY 修复后 109 个文件通过，623 项通过，1 项跳过。
- `node .yarn/releases/yarn-4.18.0.cjs build`：通过，主进程、preload 和五个 renderer 页面均完成构建。构建输出有 CSS `@reference` 与大 chunk 提示，没有构建错误。
- `node .yarn/releases/yarn-4.18.0.cjs update:aram-catalog --help`：CLI 入口可由 Node strip-types 加载。
- 目录完整性核验：216 条、patch `26.20`，SHA-256 `aac125ef54cf23e47967a5884b9ca710590287f3117587adaa64cdf3d0984987`。
- 首次启动的 overlay `ENOENT` 现在静默回退到 bundled，不返回 `fallbackCode`，因此不会触发 warn 或 UI 损坏提示；已有 overlay 的无效 JSON 仍返回 `INVALID_JSON`。catalog-loader 行为测试分别覆盖两种情况。
- 此修复后复跑 `node .yarn/releases/yarn-4.18.0.cjs test src/main/shards/aram-assistant`：6 个文件、26 项通过；`typecheck:node` 和 `git diff --check` 通过。
- AGY 修复后 `typecheck:node` 与 `git diff --check` 通过；控制器测试覆盖 gameId 漂移保留历史且只请求一次、显式 reset 后允许同 gameId 重试、卡库更新并发只下载/写入一次、dispose abort 更新及分析、空闲取消不改结果或错误。
- Postman 本地 simulation 实际向 Gemini 和 OpenAI-compatible fixture 各发出请求并检查 NDJSON 请求日志；两者均返回 HTTP 200。日志核实 OpenAI 图像使用 `image_url.url` data URI，Gemini key 位于 `x-goog-api-key` 请求头且不在 URL。只使用本地 fixture key。
- 真实控制器测试覆盖图像-only、文本三选一、确认/撤销及后续 prompt、凭据等待期间取消、延迟自动攻略、同 gameId 去重、断连重连、新局重置、ChampionData 唯一名称映射，以及非法模型 URL 在持久化前拒绝。
- Cursor 在 CDP 8944 上完成隔离 userData 原生 smoke：侧栏路由、216 条离线目录及搜索、密码框不泄露、确认/撤销、非法确认拒绝、空输入分析拒绝、本地 OpenAI mock 三选一文本分析，以及 `encrypted-file` 凭据状态均已核验。

## 限制

- 未连接真实 League Client，也未使用真实付费 API key；本地 provider simulation 只证明协议请求与应用处理路径。
- 未做 Windows 构建或实机验证。
- 桌面截图采集未在窗口 smoke 中验证，因为当时没有可采集屏幕/权限；预览 discard 与无 token 路径已测试。
