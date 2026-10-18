# 原生助手五方会审裁决

2026-10-17，新主会话接手并核对五份 native 报告和目标源码。五方会审完成，以下裁决优先于原设计和参考仓报告，允许 Luna 实施。仅修改 LeagueAkari，不提交、不推送。

## 采纳及修正

- Cursor：采纳命名路由/侧栏/主窗口 shard/i18n 显式导入清单、凭据与 Setting 表隔离、图像与文本独立流程、纯文本输出、截图可见性恢复及运行时验收要求。自动攻略是阵容攻略，不等待三张候选卡；默认关闭。自动读取默认启用，不收费。
- AGY：采纳 KIWI/2400→aram_mayhem、ARAM/450→aram 映射、选人到加载不重置、gameId0 不换代、本人识别和英雄补齐、缓存/取消、统计口径。拒绝其 B1 自动跨源重试建议：源码明确各源是不同数据集，只允许用户明确选源，缺失不阻塞离线/模型功能。
- Prime Agent：采纳独立上下文快照、generation+真实 abort、去重、截图窗口快照。修正截图结论：Electron desktopCapturer 可以新增使用，不因仓库暂无 import 而禁止。修正资源方案：使用 @resources/...json?asset&asarUnpack，不猜 dev/packaged 路径。正 gameId 首次补齐及断连重连不算新局；不在 EndOfGame 清除去重导致同局重复收费。
- OpenCode2：采纳主窗口 webContents + mainFrame 门禁、独立原子加密文件、ID 空间分离、缓存、资源导入。未映射数字 ID 不得注入统计，但仍可使用离线卡片并确认历史，不能让离线功能依赖在线 LCU 字典。其 L2 经源码核实有误：gameflow.session.gameData.playerChampionSelections 已存在，无需再发 HTTP。
- Pi：采纳 fireImmediately 初始化、NetworkMain 代理、主进程手动英雄覆盖、取消/退出处理、截图私有内存、多显示器选择与权限错误。既有 ongoing-game helper 与其状态/原生解混淆深度耦合，不强制本次广泛抽取；助手只需有限 ARAM/Mayhem 上下文，禁止复制连接与解混淆栈，使用对应身份边界测试。拒绝把离线目录强行改为数字 ID 或依赖在线资源才能显示；保留双语来源原文、分类和来源版本，无远程图标，统计只接受唯一核验名称映射。

## 冻结实现合同

1. 新 main aram-assistant-main，薄 entry + context/state/ipc-handlers + 真实职责 controller/loader/executor。renderer 放主窗口 shards/aram-assistant（仅主窗口消费），注册 route name/path/menu key aram-assistant；zh-CN/en。单一 LeagueClientMain 数据源。
2. 对局数据是白名单字段，不复制 auth、昵称、puuid 等到模型。正新 gameId 或明确新选人会话重置一次，瞬断/同局载入保留历史与覆盖。历史本版只在主进程当前会话内存保留，最多20条；重启不恢复并在帮助文案说明。手动英雄保留至新局或恢复跟随。
3. 自动攻略默认OFF，相关模式、正 gameId、本人可解析英雄及已知队友就绪才触发一次阵容攻略；不要求隐藏敌方可见。正在手动请求时自动触发延迟重试，失败不无限自动扣费。非相关模式禁止自动；手动离线英雄攻略允许。
4. Gemini-native/OpenAI-compatible base URL/model/key 可配置。HTTPS或字面loopback HTTP，协议+完整规范化URL隔离凭据；拒绝userinfo/query/hash/完整端点/畸形转义/redirect。safeStorage独立原子文件，失败内存，无密钥/密文进入设置、同步、日志。主窗主frame IPC验证所有参数并限长。普通设置仍通过SettingFactory保存，不能用其通用setter绕过URL校验。
5. 真实30秒总预算5–120可配，最多额外一次暂态HTTP或网络重试；401/403/取消/非法/超大响应不重试。通过NetworkMain客户端且fetch adapter必须显式redirect:error（maxRedirects对fetch不足）。流式限额与abort在正文读取期间仍生效。错误短码，不回显上游正文。Gemini排除thought、处理block/finish；OpenAI处理refusal/finish/空/null/primitive。
6. 图像-only无需卡名，文本-only恰好3个不重复本地候选无需截图。截图/导入为主进程内存，PNG/JPEG魔数及真正解码，输入8MB、输出JPEG长边1280/4MB。**默认路径**：海克斯大乱斗 `InProgress` 且 `automaticAugmentCapture`（默认开）时，开场约 8s 后自动截取主显示器并直接分析选卡，不经手动预览确认。显示器预览/选文件仅作备用。多屏选择；只隐藏已创建且可见窗口，finally恢复。截图不propSync；取消和退出都处理。后续等级选卡自动检测本版不做。
7. 冻结离线216条源快照，保留kind/scope/textStatus等，不把216全称为可选池。支持显式更新和共享loader CLI；无启动抓取。overlay原子写、流式上限、schema/唯一/完整/100最小/补丁单调/同补丁20%下降闸门；更新后所有分析和lookup读取新目录。
8. ChampionDataMain使用明确source+mode，仅Mayhem强化统计；必要时向loadDetails增加向后兼容options.signal。缓存/合并source:mode:champion，generation取消。数字ID通过LCU增益名称与目录唯一映射，歧义/未知不注入；OP.GG performance/popularity不叫winrate，QQ101大盘不叫英雄胜率。缺数据非失败。

## 验收

Luna唯一实现者，不递归委派。目标仓 node .yarn/releases/yarn-4.18.0.cjs 调用 prettier（仅变更文件）、typecheck:node、typecheck:web、真实行为Vitest、完整test、build。覆盖对局handoff/瞬断/新局/自动去重/取消迟到、双协议真实本地HTTP/错误/超时/限制、凭据scope和加密失败、目录更新回退、图像与文本及确认撤销；无源码字符串测试。复用参考Postman合同及本地simulation并实际发送请求核验日志。

主会话独立复核diff和检查结果，并用隔离userData完成原生窗口smoke：侧栏页面、离线卡库、模型设置、三选一、预览取消不上传、确认/撤销、取消分析。按mcp-debug技能先尝试配置MCP再fallback CDP。真实游戏、真实付费key、Windows未经验证必须明示。最后必须由OpenCode2 exact opencode/glm-5.3-flash-free统一review全部diff，Luna修复后再次验证。
