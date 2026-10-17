# 五方会审裁决与实施冻结

2026-10-17，协调者已审阅 pi、prime-agent、cursor、opencode2、agy 五份报告及对应源代码。设计方向通过，按本文补充后冻结实施。报告中的旧 Python 缺陷不再逐一修补，而作为 Electron 迁移的回归约束。

## 会审交付与运行证据

| 审阅方      | 产物                  | 状态                                                                                                                                                                 |
| ----------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi          | pi-design.md          | 完成，Orca succeeded                                                                                                                                                 |
| Cursor      | cursor-design.md      | 完成，Orca succeeded                                                                                                                                                 |
| AGY         | agy-design.md         | 完成，Orca succeeded                                                                                                                                                 |
| Prime Agent | prime-agent-design.md | 完成；Orca 就绪检测两次超时，改为同一已就绪终端直接只读投递，报告与终端总结已核实                                                                                    |
| OpenCode2   | opencode2-design.md   | 完成；原默认服务证书过期，用户后续明确指定免费 GLM，最终实际命令为 `opencode2 run --standalone --auto --model opencode/glm-5.3-flash-free`，终端显示同模型并产出报告 |

Luna 实施启动命令为 `codex --approve-for-me --model gpt-6-luna -c model_reasoning_effort="max"`。已通过 `/status` 核验 GPT-6-Luna / reasoning max / Workspace (Approve for me)。启动工具没有独立 Fast 开关，已告知用户此限制。

## 采纳与裁决

1. **卡片源阻断**：采用已独立实抓核验的 HexARAM 公开目录 JSON，第一项实施即生成受控快照和 schema 验证测试，完成后才继续 UI/打包。216 条包括特殊机制/技能记录，必须保留分类与不确定性。不得用关键词猜测过滤、不得把 shared 全部删除、不得导入 Arena 全库。
2. **英雄联动资料缺失**：采纳 Pi 的数据分离意见；当前来源没有胜率/联动统计，不伪造数据。首版明确“无联动统计，攻略为模型建议”，保留卡片定义约束。旧 Python 标注 legacy，不宣传它是已验证的回退发行版。
3. **映射与溯源**：id=slug；name={zh,en}；description/effect={zh,en}；rarity/kind/scope/textStatus/tags/currentPatchChange 原样保存。快照来源=JSON URL，目录页另记，逐卡 sourceUrl 可为 null，不构造未经验证的外部链接；UI 提供目录来源。原始响应 SHA-256、fetchedAt、sourcePatch=riotPatch 和记录数随快照保存。第一版不加载远程图标。
4. **更新闸门修正**：同补丁骤减超过20%拒绝覆盖；更高补丁可有较大轮换，但仍须≥100、唯一 id、完整字段及合法 schema，并显示版本/数量差异；低于当前有效快照（含 bundled 基线）拒绝。未知/不可解析补丁不得覆盖。JSON Content-Type、状态、大小、时间皆校验，HTML challenge 不当空库处理。临时文件同目录写入并 flush 后 rename，失败保留原文件、清理临时文件。userData overlay 损坏/旧于 bundled 时回退 bundled。
5. **Provider 具体契约**：options 中接收 temperature/maxOutputTokens，业务分别使用0.3/0.4/0.2，总输出上限默认4096 tokens，UI文本≤20000字。Gemini 拼接首个 candidate 的 text parts，排除 thought；promptFeedback blocked / 非 STOP 完结明确错误（MAX_TOKENS 标记截断或错误，不静默当完整）；OpenAI 提取首个 choice 的 message.content（字符串或文本段），refusal/空/畸形/length 按类型处理。至少提供 EMPTY_RESPONSE、BLOCKED_RESPONSE、INVALID_RESPONSE、TIMEOUT、CANCELLED、AUTH_ERROR 等错误码；不向 UI 泄露上游 body。
6. **请求规则**：30秒总预算（5–120秒可配），连接测试10秒，取消不重试；401/403及其它非暂态4xx不重试；429/暂态5xx与网络错误至多多试一次且共享预算，501不重试；重定向拒绝。生成中的旧请求在取消/新局/重新分析后不能覆盖新状态，使用 request id/session generation 防迟到回写。Base URL 是协议根，不收完整端点、userinfo/query/hash；去尾斜杠；HTTP 只允许字面 loopback 127.0.0.1/[::1]。凭据绑定协议+完整规范化 Base URL，不跨地址/路径重用。
7. **图像与 IPC**：PNG/JPEG 输入，魔数和大小校验，原始≤8MB，解码后缩至长边≤1280并转JPEG，发送≤4MB；连接测试复用同一 provider路径。截图/导入仅由主进程产生受控内存对象，renderer不能指定任意文件路径。英雄≤100字符、阵容≤4000、候选必须恰为3个非空卡名/稳定id、历史≤20条；网络响应有大小限制。逐通道验证参数与 senderFrame，禁止泛化IPC invoke。
8. **安全具体落点**：仅 textContent/安全DOM，CSP connect-src none/img-src self data，sandbox/contextIsolation/no-nodeIntegration，不允许导航/新窗口/任意外部URL。所有数据段用 JSON/分隔符包裹并声明是数据，LCU只给模型英雄和队伍（不需要玩家昵称），不发送令牌。日志仅错误码/耗时/状态/重试等元数据，无Key/token/image/prompt/response正文。safeStorage 不可用或加密失败时不落明文，UI显示会话保存。
9. **LCU 及会话**：lockfile+PowerShell进程参数（兼容无wmic）；请求固定loopback、端口来源校验、局部TLS代理，令牌仅模块内存。任何连接失败清连接缓存，轮询按完成后延迟3秒而非叠加定时器，停止取消在飞请求。已分析 matchId 去重，未知阶段不重置，明确新 matchId/重新进入ChampSelect/用户新局重置才清历史。忙碌不永久丢失自动分析，可下轮重试。启动在游戏中可用Live Client恢复阵容；未解析英雄数字不得覆盖手动英雄或作为英雄名进入prompt，优先本地/LCU英雄元数据，失败明确降级，禁止启动请求外网英雄表。
10. **打包与平台**：所有写路径 userData，bundled asar只读；单实例与退出清理。macOS本机 pack和实际启动作为已验证证据；Windows提供portable/NSIS配置（尽可能构建），未经Windows实机验证不宣称支持游戏联调/热键/WeGame实测。签名、公证不在本次范围。

## 门禁与后续所有权

实施任务见 ../implementation-brief.md。Luna 唯一编辑实现并执行测试；协调者不与其同时修改实现文件。按卡片快照→核心服务→窗口/流程→集成验收推进。实际测试覆盖核心80%+，真实HTTP场景与Electron窗口smoke、打包可运行；无法验证项写明。

实施完成后由 OpenCode2 的 `opencode/glm-5.3-flash-free` 对完整变更统一 review，随后仍由 Luna 修复具体问题。协调者独立阅读 diff 和测试证据，不以任何 worker 总结替代验收。未通过审查不宣称完成。
