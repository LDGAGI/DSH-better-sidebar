# 终端等待 banner（wait banner + 跳过）设计

> 2026-09-09 · 目标 v0.18.2

## 背景

`terminal_wait_for`（v0.18.1，PR #595 起 needle 支持 regex）会阻塞 agent 的工具调用直到
needle 出现 / 超时 / 终端退出。等待期间用户在侧边栏看不到任何"agent 正在等什么"的信号，
也无法干预——只能等 agent 自己超时（默认 10s，长等待可设到分钟级）。

需求：

1. agent 开始 `wait for needle` 时，在对应终端的顶部显示 banner：
   **「Agent 正在等待 {needle}」**，右侧「跳过等待」按钮；
2. 点击跳过后，`terminal_wait_for` 立即返回，agent 明确知道是用户跳过（而非超时）；
3. 终端 tab 未激活时也能感知等待 → tab 标题加 ⏳ 徽章。

## 方案对比

| 方案 | 思路 | 取舍 |
|---|---|---|
| **A. 搭现有推送车（采纳）** | 等待状态并入 `AgentTerminalSnapshot`，经现有 `/sidebar/ws/agent-terminals` 推送；跳过走新 `/sidebar/api` 方法 | 改动集中；零新 WS 生命周期；推送时机由 registry `notify()` 天然覆盖 |
| B. 独立 waits 推送 WS | 新开 `/sidebar/ws/agent-waits` | 重连/订阅/teardown 全套翻倍，YAGNI |
| C. 客户端轮询 | 定时拉 terminal 列表 | 延迟与开销差，违背现有推送架构 |

已确认的两个决策：

- **skip 语义 = 新增第四种返回 `kind:'skipped'`**（不复用 timeout、不走 abort——abort
  语义属于工具调用取消，用户语义只是"不等了"）；
- **banner 主体在终端卡片顶部 + tab 标题 ⏳ 徽章**（复用 v0.12+ 的 `TabDescriptor.badge`
  通道，git tab 有先例）。

## 设计

### 1. Host：`AgentPtyRegistry`（src/agent-pty.ts）

- `AgentTerminalHandle` 增活动等待记录数组 `waits: Array<{ needle, since, skipped }>`；
  并发 `wait_for` 同 uuid 时各登记一条。
- `waitFor()`：快速路径（已 exited / needle 已在 transcript）不登记、不推 banner；
  进入轮询前登记记录并 `notify()`（banner 出现），`finally` 移除记录并 `notify()`（banner
  消失——found/timeout/exited/skipped/工具 abort 五条出路统一走 finally）。
- 轮询每圈优先检查本记录的 `skipped` → 返回 `{ kind:'skipped', needle }`；50ms 轮询
  天然承载跳过延迟，无需事件唤醒。
- 新方法 `skipWait(uuid): number`：标记该 uuid 全部活动记录并返回条数；uuid 未知 →
  `not-found` 404（与 `expect` 一致）。
- `AgentTerminalSnapshot` 增 `waiting?: { needle: string; since: number }`（取最新登记
  的一条；并发等待显示最新 needle，跳过跳过全部）。
- `AgentTerminalWaitResult` 增 `skipped` 变体。

### 2. 工具层：`terminal_wait_for`（src/tools.ts）

- output schema `oneOf` 增 `{ kind: 'skipped', needle }` 分支；
- render：`Skipped by user while waiting for "<needle>" — the wait ended early; call terminal_read to inspect the transcript if needed.`；
- 工具描述补一句：用户可从侧栏 banner 跳过等待（返回 `skipped`）。

### 3. API：`buildApi`（src/index.ts）

- 新方法 `'agent-pty.skip-wait'`（命名对齐现有 `'agent-pty.close'`）：
  `requireString uuid` → `registry.skipWait(uuid)`；degraded 模式（registry 为 null）
  幂等返回 `{ ok: true, skipped: 0 }`。

### 4. 推送零改动

`attachAgentList` 发的就是 `registry.list(sessionId)`，snapshot 新增的 `waiting` 字段
自动随车；等待开始/结束由 `notify()` 触发推送。兼容性：

- 旧客户端 + 新 host：多余字段被忽略；
- 新客户端 + 旧 host：永远收不到 `waiting` → 无 banner，安全降级。

### 5. 客户端状态（src/client/state.ts）

- `SidebarState` 增 `agentWaits: Record<uuid, { needle: string; since: number }>`（默认
  `{}`；等待结束即删除键）；
- `reconcileAgentTerminals` 从同一推送同步该映射——需解除"无 tab 增删即早退"的短路
  （仅 waiting 变化也要产出新状态）；
- **不持久化**：`sanitizeState` 逐字段重建、不恢复该字段 → 刷新后自然清空；WS attach
  即发首条推送，立刻纠正。

### 6. Banner（src/client/TerminalView.tsx）

- 仅 `agent:` tab 渲染；位置在终端区顶部（现有 fatal/deps banner 之上）；
- 内容：`t('terminalWaitBanner', { needle })`（zh「Agent 正在等待 {needle}」）+ 右侧
  `t('terminalSkipWait')`（zh「跳过等待」）按钮 → `api.agentSkipWait(uuid)`；
- needle 超 ~80 字符截断显示，`title` 悬浮显全文；
- banner 消失完全由推送驱动（skipped/exited/abort 均经 `notify`），点击不做乐观更新。

### 7. Tab ⏳ 徽章（src/client/builtins/tabs.tsx）

- terminal 描述符增 `badge: (_ctx, scope, state) => ...`：`agent:` tab 且
  `state.agentWaits[uuid]` 存在时返回 `'⏳'`，否则 null——复用 v0.12+ 徽章通道
  （git changes tab 先例），不碰 `TabBar`。

### 8. i18n / 样式

- 词典键：`terminalWaitBanner`、`terminalSkipWait`；zh/en 同步，**ja 翻译必须同步
  `src/client/locales-ja.ts`**（仓库规则）；
- `.terminalWaitBanner` 全部消费 `--dsw-alias-*` / `--ds-*` 令牌，无硬编码颜色
  （皮肤契约，`tests/theme.spec.ts` 守护）。

### 9. 测试

- `tests/agent-pty.spec.ts`：跳过返回 `skipped`；活动等待期间 snapshot 含 `waiting`、
  结束后消失；`skipWait` 未知 uuid → 404、无活动等待 → 0；等待开始/结束触发 `notify`；
- `tests/tools.spec.ts`：FakeRegistry 增 skipped 形状；schema/render 断言；
- `tests/agent-terminal-reconcile.spec.ts`：`agentWaits` 设置/清除、仅 waiting 变化也
  触发状态更新；
- badge / banner 组件测试视现有 jsdom 基建可行性补齐。

## 边缘情况

- **并发多个 `wait_for` 同一 uuid**：banner/⏳ 显示最新登记的 needle；跳过一次跳过全部；
- **工具调用取消（abort）**：`finally` 移除记录 → banner 消失并推送；
- **终端退出 / 用户关 tab（close frame 杀 pty）**：轮询下一圈返回 `exited`，记录移除；
- **UI-tab 终端**：无等待概念，`agentWaits` 永不含有其条目。

## 不做的事

- 不新增独立 waits WebSocket（方案 B 否决）；
- 不改 `ctx.betterSidebar` 服务面（`external-plugin-guide.md` 无需同步）；
- 不做乐观 UI（banner 消失以服务端推送为准）。
