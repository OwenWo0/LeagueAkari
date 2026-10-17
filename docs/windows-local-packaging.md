# Windows 本地打包指南（Fork）

面向在 **Windows x64** 本机从 fork 拉代码并打可分发包。不要在 macOS 上跨架构打 Win 包：本仓库依赖 `better-sqlite3` 与 `league-akari-native-win32`，必须在 Windows 上编译原生模块。

目标仓库示例：`https://github.com/OwenWo0/LeagueAkari`  
建议分支：`dev`（含原生 ARAM 助手）

产物格式：`electron-builder` 配置为 **7z**（见 `electron-builder.yml` 的 `win.target`）。

---

## 1. 环境要求

| 项       | 要求                                                             |
| -------- | ---------------------------------------------------------------- |
| 系统     | Windows 10/11 **x64**（自更新与原生包均按 win32-x64）            |
| Node.js  | 与仓库开发一致的近期 LTS（建议 20+；本机需能跑 Yarn 4）          |
| 包管理   | **Yarn 4**（仓库 `packageManager: yarn@4.18.0`，用 Corepack）    |
| 构建工具 | **Visual Studio Build Tools**（含 “使用 C++ 的桌面开发” / MSVC） |
| Python   | node-gyp 需要（通常 3.x；装 VS Build Tools 时勾选也可）          |
| Git      | 能 clone / pull                                                  |

可选：管理员权限对「打包」不是必须；运行时部分原生快捷键/叠加层功能才可能需要管理员。

---

## 2. 拉取代码

```bat
git clone git@github.com:OwenWo0/LeagueAkari.git
cd LeagueAkari
git checkout dev
git pull
```

HTTPS：

```bat
git clone https://github.com/OwenWo0/LeagueAkari.git
cd LeagueAkari
git checkout dev
git pull
```

---

## 3. 安装依赖

在仓库根目录：

```bat
corepack enable
yarn install
```

若 `league-akari-native-win32` 因 `os`/`cpu` 限制未装上，确认当前就是 **win32 + x64** 后再重装。不要在 ARM Windows 或 WSL 里当「本机 Win 包」目标用。

---

## 4. 推荐打包命令（含原生）

一键：先编 Windows 原生 addon，再 typecheck + Vite 构建 + electron-builder：

```bat
yarn build:win:native
```

等价于：

```bat
yarn build:native:win
yarn build:win
```

其中：

- `build:native:win` → `node native/win32-x64/scripts/build.js`（node-gyp + tsc）
- `build:win` → `yarn build`（typecheck + electron-vite）再 `electron-builder --win`

产物一般在：

```text
dist\
```

常见文件名类似：`LeagueAkari-<version>-win.7z` 或 electron-builder 按配置生成的 7z（以 `dist` 目录实际文件为准）。版本号来自根目录 `package.json` 的 `version`（当前为 `1.5.2-beta`）。

---

## 5. 仅应用壳、已有原生产物时

若本机已经成功跑过 `yarn build:native:win`，且 `native/win32-x64/addons\*.node` 与 `dist` 仍在：

```bat
yarn build:win
```

首次或改过 `native/win32-x64` 源码后，请用第 4 节带 native 的命令。

---

## 6. 常见问题

### node-gyp / MSVC 报错

- 安装 **Visual Studio 2022 Build Tools**，工作负载勾选 **使用 C++ 的桌面开发**。
- 新开一个「x64 Native Tools」或普通终端，确认 `cl` / 工具链可用后再 `yarn build:native:win`。
- 删掉失败残留后重试：

```bat
rmdir /s /q native\win32-x64\build
rmdir /s /q native\win32-x64\addons
yarn build:native:win
```

### better-sqlite3 重建失败

同样依赖本机 MSVC。可尝试：

```bat
yarn rebuild better-sqlite3
```

再执行 `yarn build:win:native`。

### typecheck 失败

先单独看：

```bat
yarn typecheck
```

修到通过后再打包；`yarn build` / `yarn build:win` 会跑 typecheck。

### 想跳过签名

Windows 配置未要求 Authenticode。本机未配置证书时，electron-builder 会打未签名包，本地解压运行即可。

### 不要做的事

- 不要在 macOS 上 `yarn build:win` 指望得到可运行的 Win 包。
- 不要推送到 upstream `LeagueAkari/LeagueAkari`（除非你另行明确要求）。
- 不要把 fork 包当成官方 GitHub Releases 自更新源；应用内更新仍走官方通道。

---

## 7. 本地验证建议

1. 解压 `dist` 里的 7z，运行 `LeagueAkari.exe`。
2. 确认启动无因 `.node` 缺失而闪退。
3. 侧栏进入 **ARAM 海克斯大乱斗助手**，离线卡库可搜、设置页密钥框不回显明文。
4. 真人对局、付费模型 key、屏幕采集权限按你本机环境另测。

---

## 8. 命令速查

```bat
corepack enable
yarn install
yarn build:win:native
dir dist
```
