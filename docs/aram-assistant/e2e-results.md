# ARAM 海克斯助手 · E2E 执行结果

日期：2026-10-18（Asia/Singapore）  
仓库：`/Users/owenwu/codebase/personal/LeagueAkari`，分支 `dev`  
设计依据：`docs/aram-assistant/e2e-design.md`  
范围：本地 mock（`127.0.0.1:4900`）驱动，不调用真实付费模型、不依赖真实对局、不测 Windows。

## 环境

| 项                            | 值                                                               |
| ----------------------------- | ---------------------------------------------------------------- |
| OS                            | macOS（darwin）                                                  |
| Node                          | v26.11.1                                                         |
| Electron（运行中的 dev 实例） | 43.2.0                                                           |
| 包管理器                      | 本机无全局 `yarn`，使用仓库内置 `.yarn/releases/yarn-4.18.0.cjs` |
| Mock                          | `postman/mocks/aram-assistant/providers/default.js`，`:4900`     |
| CDP                           | `http://127.0.0.1:8944`（已有 dev 实例，`localhost:5173`）       |

应用侧 provider 配置（运行中实例已存在）：

```text
Base URL: http://127.0.0.1:4900/openai/v1
Model:    e2e-demo-model
API Key:  已配置（OS 安全存储，e2e 不需要真实 Key）
```

## L0 · 单测

```bash
node .yarn/releases/yarn-4.18.0.cjs vitest run src/main/shards/aram-assistant/
```

结果：**通过**，`6 passed (6)`，`37 passed (37)`。

```text
✓ ipc-handlers.test.ts (1 test)
✓ credential-store.test.ts (2 tests)
✓ catalog-loader.test.ts (5 tests)
✓ screenshot-controller.test.ts (3 tests)
✓ provider.test.ts (9 tests)
✓ assistant-controller.test.ts (17 tests)
```

覆盖点（新增/相关）：

- 当前提示词契约：`## Output contract`、`1) 推荐 / 2) 出装 / 3) 打法`、`1) 定位`；
- 单图请求恰好一个 `image_url` part，默认不带 `max_tokens`；
- 真实 controller prompt → `detectScenario` 路由：opening / augment / probe；
- 阵容提示词里的 `Pick input: no screenshot …` 不会被误判为 augment；
- mock 输出含 `1) 推荐/定位` 短结构，不再依赖 `Identify only the augment names` 等旧字符串。

## L1 · Mock HTTP 契约 smoke

```bash
node postman/mocks/aram-assistant/e2e-scenarios/smoke-request.mjs
# 等价：node .yarn/releases/yarn-4.18.0.cjs test:e2e:aram
```

结果：**通过，退出码 0**。

```text
[smoke] started mock at http://127.0.0.1:4900
  PASS opening -> opening-match (201 chars)
  PASS augment -> augment-pick (182 chars)
  PASS probe -> probe (18 chars)
  PASS forced-header -> augment-pick (182 chars)

[smoke] 4/4 scenarios passed
```

断言内容：

- HTTP 200、`object=chat.completion`、回显 `model`、`finish_reason=stop`、非空 `content`；
- 响应头 `x-akari-e2e-scenario` 与预期场景一致；
- opening：`[e2e:opening-match]` + `1) 定位 / 2) 出装 / 3) 打法`；
- augment（带 1×1 PNG image part）：`[e2e:augment-pick]` + `1) 推荐 / 2) 出装 / 3) 打法` + `秘术冲拳`；
- probe：`PROBE_OK`；
- `x-akari-e2e-scenario` 请求头优先于 prompt 探测。

## L2 · 原生窗口 smoke（CDP）

### 状态：部分通过（未隔离 userData）

使用的运行中 dev 实例是**默认 userData**，不是隔离目录。原因：

- 应用只在 dev 下追加 `remote-debugging-port=8944`，入口 `src/main/main.ts` 在任何
  `app.setPath('userData')` 之前就调用 `app.requestSingleInstanceLock()`；
- 再起第二个 dev 实例会被单实例锁拦截；要实现隔离 userData，需要改启动入口或先关闭用户当前
  dev 实例。为避免影响用户会话与改动无关功能，本次未重启实例；
- 因此本节验证的是「真实 renderer → IPC → main controller → mock」链路，**不是**干净 userData
  首次启动。

操作方式：按 `.claude/skills/league-akari-mcp-debug/SKILL.md` 的 fallback，用 CDP
`http://127.0.0.1:8944` + `Runtime.evaluate` 驱动主窗口（未使用真实 Key）。

| 检查项                          | 结果           | 证据                                                                                                                                     |
| ------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 侧栏进入 ARAM 海克斯大乱斗助手  | 通过           | `#/aram-assistant`，页面文本含助手标题与「推荐与分析」                                                                                   |
| 右栏为推荐/分析，视觉设置是弹层 | 通过           | 点击「视觉模型设置」后出现 `role=dialog`，右栏仍在页面内                                                                                 |
| 凭据框不回显明文                | 通过           | 密钥 `input[type=password]`，`valueLength=0`；状态「已配置凭据 / 操作系统安全存储加密」                                                  |
| E3 本地三卡                     | 通过           | `analyze({kind:'augment-advice', mode:'aram', cardIds:['adapt','all-for-you','apex-inventor']})` → `[e2e:augment-pick]` + 推荐/出装/打法 |
| E1 阵容攻略                     | 通过           | `analyze({kind:'lineup-guide', mode:'aram_mayhem'})` → `[e2e:opening-match]` + 定位/出装/打法（LCU 未连接，`championName=null`）         |
| E4 视觉探针                     | 通过           | `probeVisionProvider()` → 两张样例均 `PROBE_OK landscape`；history 仍为 0，未覆盖 latestResult                                           |
| E6 确认/撤销                    | 通过（状态层） | `confirmAugment('adapt')` → history 1 条；`undoConfirmedAugment()` → 0 条；prompt 含确认历史由 L0 单测覆盖                               |
| E5 预览丢弃零请求               | **跳过**       | macOS 屏幕录制权限未授予，`listDisplays()` 抛 `SCREEN_PERMISSION_REQUIRED`；无法进入预览步骤                                             |
| E2 截图选卡                     | **跳过**       | 依赖 E5 的截屏权限；本地三卡 E3 已覆盖同 provider 路径                                                                                   |
| E7 取消分析                     | **跳过**       | 未在 UI 上做人工点击；controller 取消路径由 L0 覆盖                                                                                      |
| E8 布局                         | 通过（只读）   | 弹层打开时右栏保留；未做像素级验收                                                                                                       |

截图证据：`docs/aram-assistant/evidence/aram-assistant-page.png`（打开助手页后的窗口截图）。

### 未测 / 跳过

- 真实付费视觉模型质量、真实识图准确率：无真实 Key，按要求不测。
- 真实 LCU / 真实海克斯对局自动开场截屏（L3）：macOS 屏幕录制权限未授予，跳过。
- Windows 打包与 Win 原生截屏权限：不在本机范围。
- 干净 userData 首次启动：见上，单实例锁 + 启动入口限制。

## 契约文件对齐

| 文件                                                           | 变更                                                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `postman/mocks/aram-assistant/providers/scenario-responses.js` | 按 `## Output contract` + `1) 推荐` / `1) 定位` 探测；正文改为推荐/出装/打法、定位/出装/打法短结构                     |
| `postman/mocks/aram-assistant/providers/default.js`            | OpenAI 响应回显请求 `model`，便于 L1 断言                                                                              |
| `postman/mocks/aram-assistant/e2e-scenarios/*.json`            | 增加 `promptDetection`，同步 `expectedLatestResult.outputIncludes` 与 `mockOutputZh`                                   |
| `postman/aram-assistant-providers.openapi.yaml`                | 版本 1.1.0：补充 `/health`、`x-akari-e2e-scenario` / `x-akari-e2e-locale`、响应 `model` / 场景头，示例改为带锚点短结构 |
| `postman/mocks/aram-assistant/e2e-scenarios/README.md`         | 探测关键字、输出结构、L1 命令与验收要点                                                                                |
| `postman/mocks/aram-assistant/e2e-scenarios/smoke-request.mjs` | 新增 L1 一键脚本（自动启停 mock）                                                                                      |

## 结论

- L0 单测：**绿**（37/37）。
- L1 mock HTTP 契约：**绿**（4/4，退出码 0）。
- L2：核心链路（侧栏、弹层、凭据掩码、E1/E3/E4/E6）在运行中 dev 窗口通过；完整「隔离 userData
  首次启动」与截屏相关 E2/E5/L3 因权限与单实例锁跳过。
- Mock Base URL：`http://127.0.0.1:4900/openai/v1`，Model 任意非空（如 `e2e-demo-model`），
  Key 任意；需要强制场景时加请求头 `x-akari-e2e-scenario: opening-match | augment-pick | probe`。
