# Luna 实施任务（会审完成后才投递）

## 目标与所有权

在当前仓库完成可启动、可打包的 Electron 桌面应用。协调者负责设计裁决和最终审查；唯一实施者为 gpt-6-luna / max，不允许递归委派或自行启动其它 worker。允许新增 electron/、scripts/、tests/、data/、postman/、package.json/package-lock.json、构建配置与更新 README/.gitignore；不修改 docs/reviews/ 的独立审阅记录。旧 Python 文件保留为 legacy，不把 Python 作为新应用依赖。不可提交凭据，不能读取用户密钥文件或将真实 Key 打到日志；没有真实模型 Key 就只声明本地仿真通过。

## 设计输入

阅读 docs/electron-design.md 全文及 docs/reviews/ 五方意见，以协调者的会审裁决为准；参考现有 main.py、lcu_client.py、lang.py 中生效的 Prompt，但不要照搬已发现的状态/超时/爬虫缺陷。当前 repo 无 package.json，无受控卡库；本机 Node v26/npm v11。

## 必须交付

1. `npm start` 启动真实 Electron UI，中文默认且支持英文。深色桌面工具界面，手动英雄/队伍攻略、截图/导入与预览后显式分析、手动三张卡片输入、仅确认写入历史/撤销/新局重置、置顶、Ctrl+F12；主窗口可切换紧凑浮窗或独立结果窗。界面各操作有忙碌/失败/取消状态。
2. Gemini REST + OpenAI-compatible 独立 adapters，设置协议/Base URL/model/key/超时/语言/显示器/lockfile；携带小图的连接测试。凭据绑定协议+完整规范化 Base URL（包含路径），不跨地址隐式复用；查询只返回 hasApiKey。safeStorage 可用时加密，不可用时仅会话保存且明确展示。未填模型时提示配置，不把示例模型的可用性当作已验证。
3. Electron main/preload/renderer 权限隔离、CSP、来源校验、IPC 参数验证、安全文本 DOM、不可信输出不可执行、主进程网络、拒绝外部导航和新窗口。截图以内存为主，隐藏窗口后捕捉并恢复，权限拒绝有手动输入替代。
4. 单一 session store 与只读 LCU：本地 lockfile 和 Windows PowerShell 进程参数发现；局部 HTTPS self-signed agent 限定固定 loopback；phase + champ-select/loading/live roster，3 秒轮询不重叠、连接失败重发现、瞬断不清空历史、明确新局重置、手动英雄修正。无客户端时仍可手动操作。
5. 实抓 HexARAM 完整公开 JSON `https://hexaram.lol/data/mayhem/augment-catalog.json`（/tmp/aram-catalog.json 有已下载样本）转换成随包 `data/augments.json`；本次来源标记 26.20，共 216 条。中文英文、效果、tier、kind/scope/textStatus、slug/id/sourceUrl 都要保留。36 条 dynamic/4 条 special 要显示来源局限，不能把记录存在冒充可选；没有英雄胜率统计时必须显式说明是模型建议。不要生成虚假 synergy 数据。浏览/搜索/稀有度过滤离线可用；手动更新，schema/重复/缺字段/低于100/骤减80%/补丁倒退全部拒绝覆盖。原始 hash+时间+源版本+数量可审计；userData overlay 损坏回退 bundled，更新临时文件原子替换，启动不抓取。共享脚本 `npm run update:cards`，网络超时与有限重试。
6. 本机打包验证（至少 macOS dir/.app；Windows 构建配置及尽可能生成可验证构建，无法实机验证说明），README 中给出开发、配置自定义兼容地址、更新与打包命令；不需要发布、签名、公证或替用户填真实 Key。

## 测试与验证

应用 TDD 技能：重要行为先写失败测试，再实现。node:test 核心测试目标 80%+，真实 HTTP fixture 覆盖双协议图像格式/路径、正常与401/429/5xx、超时/取消、重定向、空响应；settings 凭据作用域和加密失败；cards 完整性/原子失败/回退；session 瞬断/修正/新局、确认/撤销；LCU 发现/轮询停止。不要只 mock fetch。

按 Postman api-simulation 技能保留一个可复用的本地 mock + .sim.yaml，并实际运行 provider 客户端请求，查看 request 日志；当前 Postman 1.74.0 未登录，可跳过 owning-team 云 mock 搜索，明确本地 mock 依据两个供应商公开契约。不得登录/发布云资源，不需要绑定 workspace。读技能后按支持的命令使用；若 entitlement 阻断，按 bootstrap 说明报告限制，不绕过。

Playwright Electron smoke 要启动真实窗口并覆盖设置/卡库/历史/无隐式上传等关键流程；截图与真实游戏/模型不可测部分明确列出。执行 npm test、npm run test:coverage、npm run test:e2e（或清楚命名的等价脚本）、npm run pack。测试日志与产物路径写入 docs/implementation-results.md，含本次卡片抓取来源和计数。

## 汇报

完成后报告变更文件、实际执行命令和结果、未验证项/阻塞项；不要只说测试通过而缺证据。禁止提交/推送或修改其它仓库。完成后等待协调者审查与 OpenCode2 统一 review，后续具体修复仍由 Luna 执行。
