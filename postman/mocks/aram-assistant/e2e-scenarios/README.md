# ARAM assistant e2e scenarios（本地 mock）

两套默认场景，供隔离 userData + 本地 provider mock 做端到端验收，不调用真实付费模型。

| 场景         | 文件                 | 触发                                   | 断言锚点              |
| ------------ | -------------------- | -------------------------------------- | --------------------- |
| 默认初始对局 | `opening-match.json` | `lineup-guide` / 自动阵容攻略          | `[e2e:opening-match]` |
| 开场选卡     | `augment-pick.json`  | `augment-advice`（自动截屏或手动预览） | `[e2e:augment-pick]`  |

## 启动 mock

```bash
PORT=4900 node postman/mocks/aram-assistant/providers/default.js
```

应用侧 OpenAI 兼容配置示例：

- Base URL: `http://127.0.0.1:4900/openai/v1`
- Model: `e2e-opening-match` 或 `e2e-augment-pick`（任意非空即可；路由看 prompt）
- API Key: 任意非空字符串

可选请求头强制场景（优先于 prompt 探测）：

- `x-akari-e2e-scenario: opening-match`
- `x-akari-e2e-scenario: augment-pick`
- `x-akari-e2e-scenario: probe`

## 验收要点

1. **初始对局**：自动阵容攻略或手动「生成阵容攻略」→ `latestResult.kind === 'lineup-guide'`，输出含 `[e2e:opening-match]`。
2. **选卡**：自动开场截屏或备用手动分析 → `latestResult.kind === 'augment-advice'`，输出含三张卡名与 `[e2e:augment-pick]`。
