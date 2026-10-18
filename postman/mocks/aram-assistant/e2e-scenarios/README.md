# ARAM assistant e2e scenarios（本地 mock）

两套默认场景，供隔离 userData + 本地 provider mock 做端到端验收，不调用真实付费模型。
输出正文遵循当前主进程输出契约：选卡为 **推荐 / 出装 / 打法**，阵容为 **定位 / 出装 / 打法**，均带稳定锚点。

| 场景         | 文件                 | 触发                                   | 断言锚点              | 正文结构               |
| ------------ | -------------------- | -------------------------------------- | --------------------- | ---------------------- |
| 默认初始对局 | `opening-match.json` | `lineup-guide` / 自动阵容攻略          | `[e2e:opening-match]` | 定位 / 出装 / 打法     |
| 开场选卡     | `augment-pick.json`  | `augment-advice`（自动截屏或手动预览） | `[e2e:augment-pick]`  | 推荐 / 出装 / 打法     |
| 视觉探针     | 无独立 JSON          | 设置页「测试视觉模型」                 | `PROBE_OK`            | 单行 `PROBE_OK <word>` |

## 启动 mock

```bash
PORT=4900 node postman/mocks/aram-assistant/providers/default.js
```

健康检查：`curl http://127.0.0.1:4900/health`。

应用侧 OpenAI 兼容配置示例：

- Base URL: `http://127.0.0.1:4900/openai/v1`
- Model: `e2e-opening-match` 或 `e2e-augment-pick`（任意非空即可；路由看 prompt）
- API Key: `e2e-local`（任意非空字符串）

## 场景探测

路由优先级：`x-akari-e2e-scenario` 请求头 > prompt 关键字 > 默认 `opening-match`。

| 目标场景        | 强制请求头                            | prompt 关键字（当前主进程提示词）                                                                                                                 |
| --------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `augment-pick`  | `x-akari-e2e-scenario: augment-pick`  | `## Output contract` + `1) 推荐`；`Task: choose one offered card`；`Pick input: one screenshot…` / `Pick input: exactly these three local cards:` |
| `opening-match` | `x-akari-e2e-scenario: opening-match` | `1) 定位`；`Task: short lineup plan for this champion.`；`## Lineup`；`lineup guide` / `阵容攻略`                                                 |
| `probe`         | `x-akari-e2e-scenario: probe`         | `PROBE_OK`；`connectivity probe`                                                                                                                  |

旧探测词（`Identify only the augment names` 等）仅保留兼容，不作为验收依据。

## L1 · HTTP 契约 smoke（一键）

```bash
node postman/mocks/aram-assistant/e2e-scenarios/smoke-request.mjs
# 等价于
yarn test:e2e:aram
```

脚本行为：

1. 若 `http://127.0.0.1:4900/health` 未就绪，自动在 `4900` 启动 mock，结束后关闭；
2. 依次 POST `/openai/v1/chat/completions` 三枪：opening / augment（带图）/ probe；
3. 断言 HTTP 200、`x-akari-e2e-scenario` 响应头、choices 结构、非空 `content`、`[e2e:…]` 锚点与
   `1) 推荐/定位` 等章节标题；
4. 全部通过退出码 0，有失败退出码 1。

可选环境变量：`PORT`（默认 4900）、`ARAM_MOCK_BASE_URL`（指向已运行的 mock，脚本不再自行启动）。

## 验收要点

1. **初始对局**：自动阵容攻略或手动「生成阵容攻略」→ `latestResult.kind === 'lineup-guide'`，输出含
   `[e2e:opening-match]`、`1) 定位`、`2) 出装`、`3) 打法`。
2. **选卡**：自动开场截屏或备用手动分析 → `latestResult.kind === 'augment-advice'`，输出含
   `[e2e:augment-pick]`、`1) 推荐`（推荐卡名）、`2) 出装`、`3) 打法`。
3. **探针**：设置页「测试视觉模型」→ 两张样例图各返回 `PROBE_OK`，不写入本局 history。
4. 请求默认不带 `max_tokens`；截图场景恰好一张 image part。

L2（原生窗口 + 隔离 userData + CDP `8944`）步骤见 `docs/aram-assistant/e2e-design.md` §5，结果记录在
`docs/aram-assistant/e2e-results.md`。
