# ARAM 海克斯助手 · E2E 设计

状态：设计完成，交由本机 `dsh-tui` 落地与跑通。  
仓库：`OwenWo0/LeagueAkari` · 分支建议：`dev`  
目标：在不调用真实付费模型、不依赖真实对局的前提下，验收「截屏/手动分析 → 推荐选卡 + 出装打法」主路径。

---

## 1. 目标与非目标

### 目标

1. **Mock 可重复**：本地 OpenAI 兼容 mock（默认 `:4900`）返回带稳定锚点的短文案。
2. **提示词契约**：请求体按「英雄+统计 / 阵容 / 截图或三卡+卡库召回 / 输出契约」组织；默认**不传** `max_tokens`。
3. **输出契约**：选卡场景只验 **推荐 / 出装 / 打法**（或 mock 等价短结构）；阵容场景验 **定位 / 出装 / 打法**。
4. **原生窗口 smoke**：隔离 `userData` + CDP `8944`（优先 Playwright MCP）走通侧栏助手页的关键交互。
5. **回归可脚本化**：至少一条可一键跑的「启动 mock → 触发分析 → 断言锚点」路径（Node/Vitest 或 shell + evaluate）。

### 非目标（显式不测）

- 真实付费视觉模型质量、真实识图准确率
- 真实 LCU / 海克斯对局自动开场截屏在真机上的像素级验收（可用 fixture 图 + mock）
- Windows 打包与 Win 原生截屏权限（另见 `docs/windows-local-packaging.md`）
- 腾讯服 / WeGame

---

## 2. 架构

```text
┌─────────────────┐     IPC analyze      ┌──────────────────┐
│ Renderer UI     │ ───────────────────► │ AramAssistant    │
│ 推荐与分析面板   │ ◄─────────────────── │ Controller       │
└─────────────────┘   latestResult       └────────┬─────────┘
                                                  │ prompt + 0..1 image
                                                  │ (no max_tokens)
                                                  ▼
                                         ┌──────────────────┐
                                         │ Vision provider  │
                                         │ OpenAI-compat    │
                                         └────────┬─────────┘
                                                  │
                          ┌───────────────────────┴───────────────────────┐
                          ▼                                               ▼
               本地 mock :4900                                   真实模型（人工）
               scenario-responses.js                            非 e2e 默认路径
```

已有资产：

| 资产      | 路径                                                              |
| --------- | ----------------------------------------------------------------- |
| Mock 服务 | `postman/mocks/aram-assistant/providers/default.js`               |
| 场景正文  | `postman/mocks/aram-assistant/providers/scenario-responses.js`    |
| 场景说明  | `postman/mocks/aram-assistant/e2e-scenarios/*.json` + `README.md` |
| 调试技能  | `.claude/skills/league-akari-mcp-debug/SKILL.md`（CDP `8944`）    |

---

## 3. 场景矩阵

| ID  | 名称      | 触发                                                               | Mock 锚点                                          | 主要断言                                                       |
| --- | --------- | ------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------- |
| E1  | 开场阵容  | `lineup-guide` / 手动「生成阵容攻略」                              | `[e2e:opening-match]`                              | `kind=lineup-guide`；含定位/出装/打法意图；请求无 `max_tokens` |
| E2  | 截图选卡  | `augment-advice` + `screenshotToken`（手动预览后分析，或自动截屏） | `[e2e:augment-pick]`                               | `kind=augment-advice`；含推荐卡名；含出装/打法；单图           |
| E3  | 本地三卡  | `augment-advice` + 恰好 3 个 `cardIds`                             | `[e2e:augment-pick]`（或新增 `[e2e:local-three]`） | 无 image part；prompt 含三卡名                                 |
| E4  | 视觉探针  | 设置页「测试视觉模型」                                             | `PROBE_OK` / scenario `probe`                      | 不写入本局 history；两次样例图                                 |
| E5  | 预览丢弃  | 选图预览后取消                                                     | —                                                  | **零** provider 请求                                           |
| E6  | 确认/撤销 | 卡库确认一张 → 再分析                                              | —                                                  | prompt 含「Already confirmed」；undo 后消失                    |
| E7  | 取消分析  | 分析中点取消                                                       | —                                                  | `CANCELLED` 或 UI 恢复可点                                     |
| E8  | UI 布局   | 打开助手页                                                         | —                                                  | 右侧为推荐面板；提供方在二级弹层，不占右栏                     |

可选增强（有时间再做）：

| ID  | 说明                                                                                     |
| --- | ---------------------------------------------------------------------------------------- |
| E9  | OP.GG mock：`loadDetails` 注入后 prompt 含 `OP.GG ChampionData` 与映射卡名               |
| E10 | `OUTPUT_TRUNCATED` 仅在上游显式 `finish_reason=length` 时出现（默认请求不设 max_tokens） |

---

## 4. Mock 与提示词探测（必改点）

当前 `scenario-responses.js` 的 `detectScenario` 仍匹配旧文案（如 `Identify only the augment names`、`Give a concise ARAM lineup`）。  
主进程提示词已改为结构化章节与「1) 推荐 / 2) 出装 / 3) 打法」。

**落地要求：**

1. 更新 `detectScenario`，识别新关键字，例如：
   - `## Output contract` + `1) 推荐` → `augment-pick`
   - `1) 定位` 或 `Task: short lineup plan` → `opening-match`
   - 保留 `PROBE_OK` / `connectivity probe` → `probe`
   - 仍可用请求头 `x-akari-e2e-scenario` 强制场景
2. 刷新 `AUGMENT_PICK_ZH` / `OPENING_MATCH_ZH`（及 EN）为短契约输出，例如：

```text
[e2e:augment-pick]
1) 推荐
秘术冲拳 — 开场技能周转稳定

2) 出装
核心：…；可选：…

3) 打法
- …
```

```text
[e2e:opening-match]
1) 定位
…

2) 出装
…

3) 打法
- …
```

3. 更新 `e2e-scenarios/*.json` 的 `expectedOutput` / notes，与上列一致。
4. `e2e-scenarios/README.md` 同步探测关键字与验收句。

---

## 5. 验收分层

### L0 · 静态 / 单测（快）

```bash
yarn vitest run src/main/shards/aram-assistant/
```

覆盖：单图请求、无默认 `max_tokens`、prompt 含推荐/出装/打法、确认历史、统计映射、自动截屏调度。

### L1 · Mock HTTP 契约

```bash
PORT=4900 node postman/mocks/aram-assistant/providers/default.js
# 另开终端：用 curl 或小脚本 POST 一条仿造 chat/completions，断言锚点与章节标题
```

建议新增 `postman/mocks/aram-assistant/e2e-scenarios/smoke-request.mjs`（或等价）：对 opening / augment / probe 各打一枪。

### L2 · 隔离 userData 原生 smoke（MCP/CDP）

1. 启动 mock `:4900`
2. 隔离 userData 启动 app（dev + remote-debug `8944`）
3. 配置 OpenAI 兼容：`http://127.0.0.1:4900/openai/v1`，任意 key/model
4. 按 `.claude/skills/league-akari-mcp-debug/SKILL.md` 连接 MCP；失败再 fallback CDP
5. Checklist：

- [ ] 侧栏进入 **ARAM 海克斯大乱斗助手**
- [ ] 右栏标题为推荐/分析；「视觉模型设置」为弹层
- [ ] E5 预览丢弃无请求
- [ ] E3 本地三卡 → 输出含 `[e2e:augment-pick]` 与推荐/出装/打法
- [ ] E1 阵容攻略 → `[e2e:opening-match]`
- [ ] E6 确认/撤销反映在后续 prompt（可用 main evaluate / 日志 / 二次请求体）
- [ ] 凭据框不回显明文

无法测项写进 `docs/aram-assistant/e2e-results.md`。

### L3 · 可选自动截屏

仅当本机有显示器权限与 fixture 时：开 `automaticAugmentCapture`，用固定图或等自动路径；否则标记 **跳过**，用 E2 手动预览代替。

---

## 6. 本机 `dsh-tui` 实施清单

按顺序做，做完在 `docs/aram-assistant/e2e-results.md` 记录命令、通过/跳过与证据路径。

1. **对齐 mock 探测与场景正文**（§4）
2. **补/改单测**：prompt 契约、`max_tokens` 缺省、截图/三卡探测不被旧字符串绑死
3. **加 L1 smoke 脚本**并写进 `e2e-scenarios/README.md`
4. **跑 L0 + L1**，修到绿
5. **尽量跑 L2**（隔离 userData + MCP/CDP）；阻塞则写明原因与最小复现
6. **不要**改无关功能、不要推远程、不要开 PR，除非用户另嘱
7. 完成后用 5～10 行中文总结：绿了什么、跳过什么、mock Base URL 怎么配

---

## 7. 成功标准（Definition of Done）

- [ ] Mock 对**当前**提示词能正确路由 opening / augment / probe
- [ ] Mock 输出符合「推荐/出装/打法」或「定位/出装/打法」短结构，并带 `[e2e:…]` 锚点
- [ ] `yarn vitest run src/main/shards/aram-assistant/` 通过
- [ ] L1 smoke 脚本一键可跑且退出码 0
- [ ] L2 至少完成侧栏 + 三卡或阵容之一的端到端；或书面说明阻塞
- [ ] `docs/aram-assistant/e2e-results.md` 已落盘

---

## 8. 配置速查

```text
Base URL:  http://127.0.0.1:4900/openai/v1
Model:     e2e-augment-pick   # 任意非空；路由优先看 prompt / 请求头
API Key:   e2e-local
Header:    x-akari-e2e-scenario: augment-pick | opening-match | probe
```

启动 mock：

```bash
PORT=4900 node postman/mocks/aram-assistant/providers/default.js
```
