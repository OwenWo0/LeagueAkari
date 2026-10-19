# ARAM Assistant · 本地极速 OCR 与游戏内覆盖层部署指南

> **协作角色**：`Antigravity`、`dsh-tui`、`codex (gpt-6-luna-reasoning-max / fast)`  
> **目标环境**：Windows 10/11 x64 · NVIDIA GeForce RTX 4070 Ti Super (16GB VRAM, Ada Lovelace)  
> **核心目标**：将 ARAM Mayhem 助手从“云端盲猜延时”升级为“本地毫秒级 OCR + 全局快捷键 + 游戏内原位流光金框”的极致体验。

---

## 1. 架构总览与时序

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          游戏运行中 (对局内)                              │
│                                                                        │
│   [玩家人眼发现 3 张卡牌弹出]                                            │
│            │                                                           │
│            ▼ (按下快捷键 Ctrl + G 或 ~)                                   │
│   [KeyboardShortcutsMain] 全局键盘钩子 (校验游戏处于前台)                  │
│            │                                                           │
│            ▼                                                           │
│   [AramScreenshotController] 静默抓取当前游戏显示器截屏                   │
│            │                                                           │
│            ▼                                                           │
│   [Local Fast OCR] (4070 Ti Super DirectML 加速，耗时 ~18ms)           │
│   输出：3 张卡牌标题 + 物理屏幕像素坐标 [x, y, w, h]                        │
│            │                                                           │
│            ▼                                                           │
│   [AugmentCatalog + OP.GG Data Engine]                                 │
│   - 卡库精准/模糊匹配 (Adapt -> 物理转魔法)                             │
│   - OP.GG 海克斯综合评分与胜率排序 (找到 Top Pick)                      │
│   - OP.GG 嚎哭深渊核心出装聚合 (出门装 + 三件套 + 胜率)                 │
│            │                                                           │
│            ▼ (IPC 通知 Overlay 渲染)                                    │
│   [AramCardOverlayWindow] (全屏透明 + 鼠标穿透 click-through)             │
│   - 在推荐卡牌真实坐标上高亮【金色发光流光框】                           │
│   - 浮动展示【⭐ 最优推荐 · S级 · 评分 55.5】                           │
│   - 屏幕安全区浮现【OP.GG 核心出装胶囊条】                              │
│   - 8 秒后或点击后平滑淡出                                             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 三种本地部署方案对比分析讨论 (dsh-tui & Codex 对比矩阵)

针对拥有 **RTX 4070 Ti Super (16GB 显存)** 的 Windows 主机，团队深度对比了三种落地路径：

| 评估维度                   | 方案 A：轻量 ONNX 专用 OCR (推荐)         | 方案 B：本地 Vision LLM (Ollama) | 方案 C：Windows 原生 WinRT OCR    |
| :------------------------- | :---------------------------------------- | :------------------------------- | :-------------------------------- |
| **底层引擎**               | **RapidOCR / PP-OCRv4 ONNX**              | **Qwen2.5-VL-7B-Instruct**       | **Windows.Media.Ocr.dll**         |
| **硬件加速**               | **DirectML (DirectX 12) / TensorRT**      | **CUDA / vLLM / Ollama**         | **Windows OS SIMD / CPU**         |
| **推理延迟**               | **15ms ~ 25ms** (真正毫秒级)              | **350ms ~ 700ms**                | **30ms ~ 50ms**                   |
| **文字像素坐标**           | ✅ **天然输出精确四边形坐标 `[x,y,w,h]`** | ❌ 很难精准输出像素 Bounding Box | ✅ 输出单词/行像素 Bounding Box   |
| **显存占用**               | **< 300MB** (几乎不影响 3A 游戏运行)      | **~5.5GB ~ 8GB** (占用较大显存)  | **0MB 显存**                      |
| **安装部署复杂度**         | 内置 10MB ONNX 模型，开箱即用，0 配置     | 需用户本地预装 Ollama 并拉取模型 | 免安装，但依赖 Windows 语言包     |
| **网络要求**               | 100% 离线、0 流量                         | 100% 离线                        | 100% 离线                         |
| **英雄联盟艺术字体识别率** | **高** (针对中英文游戏排版容错极佳)       | **极高** (多模态理解力最强)      | 中等 (某些艺术字或描边字偶尔误读) |

### 讨论结论：

1. **方案 A 是电竞级体验的最优解**：
   - 游戏内选卡倒计时往往只有十几秒，玩家对延迟极度敏感。15ms 的推理速度配合自带的物理坐标，是实现“游戏画面原位套金框”的最佳技术底座。
2. **方案 B 作为无缝过渡方案完全可用**：
   - 如果用户当前已经在 4070 Ti Super 上启动了 Ollama（`ollama run qwen2.5-vl:7b`），League Akari 现在的架构**已经原生支持**：直接在提供方设置里填写 `http://127.0.0.1:11434/v1` 即可运行。

---

## 3. 部署步骤（Windows 10/11 x64 + 4070 Ti Super）

### 3.1 方案 A：轻量本地 ONNX 引擎集成（代码库已原生内置，开箱即用）

1. **依赖包与运行环境**：
   - 已直接引入 `onnxruntime-node` 与 `ppu-paddle-ocr`，支持 N-API ABI 稳定调用。
   - 在 Windows 环境下优先开启 `directml` 硬件加速，并在不可用时自动无缝降级到 CPU 推理。
2. **静态权重资产已内置**：
   位于 `resources/aram-assistant/ocr/`：
   - 检测模型：`det.onnx` (~4.6MB)
   - 识别模型：`rec.onnx` (~10MB)
   - 字典文件：`dict.txt` (~26KB)
     在应用构建打包时自动通过 `asarUnpack` 打包至资源目录，完全离线单机运行，不受海外网络或 HuggingFace 访问限制。
3. **识别与匹配流**：
   - 当截屏触发时，`LocalOcrExecutor` 毫秒级提取文本与像素边界框 `[x, y, w, h]`；
   - 自动匹配本地海克斯卡库并结合 OP.GG 嚎哭深渊胜率出装，无需任何云端 API Key 或本地大模型服务。

### 3.2 方案 B：Ollama 本地大模型方式（零修改代码即可体验）

1. **安装 Ollama 并下载视觉模型**：
   ```bash
   # 在 Windows 命令行运行
   ollama pull qwen2.5-vl:7b
   ```
2. **启动服务**：Ollama 默认监听在 `http://127.0.0.1:11434`。
3. **League Akari 配置**：
   - 打开 League Akari -> ARAM 海克斯助手 -> 点击右上方「视觉模型设置」；
   - 提供方协议选择：`OpenAI 兼容协议`；
   - API Base URL：`http://127.0.0.1:11434/v1`；
   - 模型名称：`qwen2.5-vl:7b`；
   - API 密钥：任意填写（Ollama 本地不需要校验密钥）；
   - 点击保存并运行「测试视觉模型」。

---

## 4. 全局快捷键与透明画框 Overlay 实现规范

### 4.1 全局快捷键绑定 (`KeyboardShortcutsMain`)

- 注册目标 ID：`aram-assistant/hotkey-capture`
- 默认键位：`Control+KeyG`（用户可在主界面自定义）
- 触发防误触保护：
  ```ts
  if (!is.dev && !(await GameClientMain.isGameClientForeground())) {
    return // 仅当英雄联盟游戏客户端窗口在前台激活时响应
  }
  ```

### 4.2 游戏内原位高亮覆层 (`AramCardOverlayWindow`)

- **窗口属性配置**：
  ```ts
  {
    title: 'Akari Aram Card Overlay',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      backgroundThrottling: false
    }
  }
  ```
- **点击穿透机制**：
  ```ts
  window.setIgnoreMouseEvents(true, { forward: true })
  ```
  保证玩家鼠标可毫无阻碍地点击游戏内的卡牌、买装备或移动走位。

---

## 5. 端到端验证（E2E Verification Checklist）

### L0 · 核心单测套件

```bash
node .yarn/releases/yarn-4.18.0.cjs test run src/main/shards/aram-assistant/
```

- **验证项**：OCR 提取规范解析、模糊相似度容错、OP.GG 卡牌评分与出装关联、降级处理。

### L1 · 本地 Mock 服务契约验收

```bash
node postman/mocks/aram-assistant/e2e-scenarios/smoke-request.mjs
```

- **验证项**：4/4 测试场景全部通过（Opening / Augment Pick / Probe / Forced Header）。

### L2 · 静态类型检查与代码风格

```bash
node .yarn/releases/yarn-4.18.0.cjs run typecheck:node
node .yarn/releases/yarn-4.18.0.cjs run typecheck:web
node .yarn/releases/yarn-4.18.0.cjs prettier --check src/main/shards/aram-assistant/ src/renderer/src-main-window/views/aram-assistant/
```

### L3 · Windows 本机打包验收

```bash
node .yarn/releases/yarn-4.18.0.cjs run build:win
```

- 检查 `dist/` 产物中的原生 DLL 及静态模型资产解包完整性。
