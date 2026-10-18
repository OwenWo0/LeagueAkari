<div align="center">
  <div>
    <img
    src="https://github.com/LeagueAkari/LeagueAkari/raw/HEAD/pictures/logo.png"
    width="128"
    height="128"
    alt="League Akari logo"
    />
  </div>
  <p><strong>League Akari</strong>（本仓库为个人 fork）</p>
  <p>基于 LCU API 的英雄联盟客户端工具箱，并内置 <strong>ARAM 海克斯大乱斗助手</strong></p>
</div>

# League Akari（Fork）

本仓库基于开源项目 [LeagueAkari/LeagueAkari](https://github.com/LeagueAkari/LeagueAkari) 继续开发，在原有自动化、战绩与对局工具能力之上，增加原生 **ARAM 海克斯大乱斗助手**。

默认开发分支：`dev`。

## 截屏分析（海克斯大乱斗）

进入海克斯大乱斗对局后，助手默认会在开场自动截取屏幕，识别三张增益卡并给出选卡建议；也可手动预览截图后再分析。右侧主视图用于展示**选卡推荐**与**阵容分析**，视觉模型提供方配置收在页内二级设置中。

要点：

- **自动为主**：开场约数秒后自动截屏分析，无需默认走粘贴或手动选图
- **手动备用**：可选择显示器截图或本地图片，预览确认后再发送
- **对局上下文**：结合当前英雄、阵容与本局已确认增益
- **离线卡库**：内置海克斯增益目录，支持搜索与核验状态展示
- **统计增强**：可选 [OP.GG](https://www.op.gg/) / QQ101 的海克斯大乱斗英雄增益统计，写入分析提示词（用于归因表现分与热度，不当作胜率口径）

侧栏进入 **ARAM 海克斯大乱斗助手** 即可使用。视觉模型密钥保存在本机安全存储，不会进入设置同步。

## 致谢

- **原项目**：[LeagueAkari/LeagueAkari](https://github.com/LeagueAkari/LeagueAkari) — 本 fork 的基础架构、LCU 接入与大量既有功能均来自原项目。
- **参考实现**：[MJ33520/ARAM-tool](https://github.com/MJ33520/ARAM-tool) — 海克斯大乱斗助手的产品与实现参考，感谢作者的开源工作。
- **数据来源**：[OP.GG](https://www.op.gg/) — 海克斯大乱斗英雄梯队与增益表现数据（ChampionData / contents API）。

离线增益卡目录另参考公开源 [HexARAM](https://hexaram.lol/zh/augments/) 的目录快照。

## 下载与使用

- 上游官方发行版：[LeagueAkari Releases](https://github.com/LeagueAkari/LeagueAkari/releases)
- 本 fork 含海克斯助手的 Windows 包：请按下方 **Windows 本地打包** 在 win32-x64 本机构建，或使用自行发布的产物

一般无需管理员权限。Windows 上部分原生快捷键 / 叠加层能力可能需要管理员。

多数 Riot 服可用；腾讯服环境请以本机实测为准。

## Windows 本地打包（已在本机跑通）

> 不要在 macOS 上跨架构打 Windows 包。仓库依赖 `better-sqlite3` 与 `league-akari-native-win32`，必须在 **Windows x64** 上编译原生模块。

以下流程已在 Windows 本机验证通过（仓库路径示例 `G:\CODEBASE\github\LeagueAkari`，分支 `dev` @ `93cfed1b`）。

### 环境

| 项       | 要求                                                         |
| -------- | ------------------------------------------------------------ |
| 系统     | Windows 10/11 **x64**                                        |
| Node.js  | 近期 LTS（能跑 Yarn 4）                                      |
| 包管理   | Yarn 4（`packageManager: yarn@4.18.0`，用 Corepack）         |
| 构建工具 | Visual Studio Build Tools（含「使用 C++ 的桌面开发」/ MSVC） |
| Python   | node-gyp 需要（装 VS Build Tools 时可一并勾选）              |
| Git      | 能 `clone` / `pull`                                          |

### 步骤

```bat
git clone https://github.com/OwenWo0/LeagueAkari.git
cd LeagueAkari
git fetch origin
git checkout dev
git pull

corepack enable
yarn install

yarn build:win:native
dir dist
```

`yarn build:win:native` 等价于先编原生 addon，再 typecheck + Vite 构建 + electron-builder：

```bat
yarn build:native:win
yarn build:win
```

### 产物（实测）

成功后 `dist\` 中会出现类似：

| 产物                             | 说明                           |
| -------------------------------- | ------------------------------ |
| `League Akari-1.5.2-beta-win.7z` | 可分发的 7z 包（实测约 87 MB） |
| `win-unpacked\LeagueAkari.exe`   | 免安装解包目录，可直接启动验证 |

版本号来自根目录 `package.json` 的 `version`。

建议解压 / 运行 `win-unpacked\LeagueAkari.exe`，确认无因 `.node` 缺失闪退，再侧栏打开 **ARAM 海克斯大乱斗助手** 做冒烟。

更完整的排错说明见 [`docs/windows-local-packaging.md`](docs/windows-local-packaging.md)。

### 注意

- 本机未配置 Authenticode 时会打未签名包，本地解压运行即可
- 不要把 fork 包当成官方 GitHub Releases 自更新源；应用内更新仍走官方通道
- 首次或改过 `native/win32-x64` 后务必走 `yarn build:win:native`

## 开发

本仓库使用 Node.js 与 Yarn 4。安装依赖前先启用 Corepack：

```sh
corepack enable
yarn install --immutable
yarn dev
```

常用命令：

```sh
yarn typecheck
yarn test
yarn storybook
yarn build
yarn build:win
yarn build:mac
```

## 反馈

问题与建议请开 [GitHub Issues](https://github.com/OwenWo0/LeagueAkari/issues)。上游问题也可关注 [LeagueAkari/LeagueAkari](https://github.com/LeagueAkari/LeagueAkari/issues)。

## 免责声明

本软件基于 Riot League Client Update（LCU）API 开发，不使用侵入式手段，理论上不直接修改游戏数据。但仍可能因游戏更新或反作弊策略带来兼容性与使用风险。

开发者不对使用本软件导致的封号、数据丢失等后果负责。用户应自行评估风险并承担责任。

**本应用未经 Riot Games 官方支持或认可。** 相关权利归 Riot Games 所有。使用可能违反游戏服务条款，请自行判断并公平竞技。
