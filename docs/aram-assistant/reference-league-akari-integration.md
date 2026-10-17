# LeagueAkari 融合调查与设计补充

调查目标：用户提供本机 `/Users/owenwu/codebase/personal/LeagueAkari`，希望复用其生态与应用，并在客户端启动后自动读取对局信息。当前仅只读调查该仓库，不修改其工作区。

## 已核实

- LeagueAkari 已是 Electron + Vue3 应用，主进程通过 MobX/Shard 组织服务，renderer 通过其自有 IPC 与状态同步访问服务。MIT 许可（2026 Hanxven）；若移植实质代码，保留来源及版权许可。
- `src/main/shards/league-client-ux/` 检测客户端进程并解析 app-port/remoting-auth-token；Windows 有 native/WMI，POSIX 用 ps 查询 pid/命令行。
- `src/main/shards/league-client/index.ts` 自动发现唯一客户端并连接，初始化 HTTP，建立本地 WSS，发送 `[5,"OnJsonApiEvent"]`。断开后清连接并重新发现。
- `src/main/shards/league-client/lc-state/index.ts` 初始 REST 拉取 gameflow phase/session、champ-select、current-summoner、英雄元数据，再订阅事件更新状态。选人用 localPlayerCellId；对局中用真实身份匹配，不能猜队伍第一人。
- 没有发现给其它独立应用使用的稳定公开 bridge；Electron IPC 只在 Akari 自己的进程内工作。独立应用不能直接调用其 shard/IPC；要么共享抽离的领域模块，要么显式增加本机通信 bridge，要么迁入 Akari 成为原生功能。
- README 明确声明腾讯服不支持；其 SGP 技能也强调跨区和腾讯接口能力依赖具体端点，不能宣称全面兼容。自动读取当前对局仅需本地 LCU/Live Client，没必要引入 SGP token 或远端查询。
- `src/shared/data-adapter/champion-data/capabilities.ts` 已区分 aram_mayhem 和 arena。OP.GG 支持 Mayhem 英雄/强化推荐，QQ101 支持 Mayhem 英雄、强化和联动相关分区；不要把其 performanceScore/popularity 冒充胜率。相关 `opgg.ts`/`qq101.ts` 与测试可复用协议知识，但本次尚未验证实时网络可用性。

## 自动读取的可交付行为

应用先启动等待 → 检测 LeagueClientUx → 获取本地端口/令牌 → 初始读取当前登录身份、phase、session和英雄名 → 监听选人/开始/结束变化 → 更新自己的英雄、友方/敌方阵容、gameId、queueId、gameMode → 加载/开局阶段按gameId去重自动分析。客户端重启重新发现；LCU被关闭但游戏仍运行时尝试2999 Live Client，未知身份不猜测。召唤师昵称、认证token不发给模型。

只读对局状态可以做到；“所有数据都能自动取得”不能承诺。海克斯三选一卡片未在上述现有LCU契约中证实有稳定字段，继续截图识别/手动三选一；不得臆造自动读取三选一卡片接口。客户端未登录时只有连接状态，没有当前对局；选人中敌方资料可能不完整，应展示已知信息而不是补猜。

## 融合路径（等待用户偏好）

1. **独立 ARAM App**：保留当前交付，借鉴/抽离 Akari 的发现与事件模型，新增窄 match-context 适配边界；不依赖 Akari 同时运行。若要共享实际 Akari 运行状态，另设认证本机bridge，需要修改两个应用并明确协议，不假装已存在。
2. **统一到 LeagueAkari**：将 provider/cards/analysis/session 作为独立领域模块迁入；新建 `aram-assistant-main` shard，依赖 LeagueClientMain/设置/日志/IPC，直接消费已同步 gameflow、champSelect、summoner、gameData；renderer新增对应 shard和页面/浮窗，共用当前路由/主题/语言/生命周期。遵守其本地 shard/ui/data-source 技能，不复制另一套LCU连接或引入全局网络代理。

用户偏好明确前，Luna继续当前可复用核心服务与LCU正确性，暂缓重大界面架构变更。最终仍由 OpenCode2 的免费 GLM-5.3-Flash 统一 review。
