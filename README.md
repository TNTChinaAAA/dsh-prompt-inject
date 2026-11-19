# dsh-prompt-inject

**DSH（DeepSeek Harness）提示词注入插件** —— 在轮次中间按需注入用户设定的提示词，全程不改 system prompt。
独立浮层集中管理，提示词落盘可复用；既能手动一次性注入，也能按条件（轮次开始 / 思考之后 / 指定工具调用后）逐步自动注入。

> 本仓库是 [`@jojoman2024/dsh-prompt-inject`](https://www.npmjs.com/package/@jojoman2024/dsh-prompt-inject) 的本地维护分支，
> 在其基础上补齐了源码工程，并加入了「保存即注入」的发送按钮、可拖动的管理浮层、更高的输入框。
> 想发布成自己的包，把 `package.json` 里的 `name` / `repository` 换成你的 scope 即可。

## ✨ 功能

- **绝不改 system prompt**：注入走 `agent/pre-step` 追加插件 user 消息，对会话日志零侵入、可审计，不破坏 prompt 缓存。
- **发送 = 保存 + 立即注入**：输入框右侧两个按钮 ——「发送」把内容落盘成一条新提示词并**立刻排队注入当前会话**（等价于「保存 → 点该条目的注入」）；「保存」只入列表不发。
- **手动一次性注入**：点条目上的【注入】即排队，该会话下一次模型 step 前生效（仅一次，10 分钟 TTL，重复点击覆盖式排队）。
- **条件注入（逐步注入）**：轮次开始时 / 思考之后 / 工具调用后命中 → 入队 → 本轮内消费、轮末丢弃。
- **窗口判据，不浪费 token**：关闭「强制注入」时，唯一判据是「这条提示词是否还在模型当前窗口里」，滑出窗口才补注一次。
- **会话作用域，重启全关**：逐步/强制注入配置是纯内存态、按会话隔离；正文与置顶持久化到 `$DSH_HOME/dsh-prompt-inject/prompts.json`。
- **可拖动的浮层**：标题栏按住即可拖动，打开时默认居中，双击标题栏复位居中；拖动期间自动禁用 iframe 指针事件，不会「拖到一半粘住」。
- **多开实时跟随**：前端切换会话时通过 `BroadcastChannel` 广播，浮层里的管理页实时跟随当前会话。
- **官方观感**：入口按钮逐字节复刻官方 `IconContextInjectionOutline16`；管理页使用 `--dsw-alias-*` token，明暗主题跟随 DSH 外观设置。

## 🚀 安装

### 方式一：本地 link 开发安装

```bash
git clone <repo-url>
cd dsh-prompt-inject
npm install
npm run build        # 产出 lib/

dsh plugin add --profile web link:X:/path/to/dsh-prompt-inject
```

或手动在 profile 的 `package.json` 里声明：

```jsonc
{
  "dependencies": {
    "dsh-prompt-inject": "link:X:/path/to/dsh-prompt-inject"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-prompt-inject"
      ]
    }
  }
}
```

本地方式改动 `src/` 后需重新 `npm run build` 并重启 DSH。

### 方式二：从 npm 装（发布后）

```bash
dsh plugin add --profile web dsh-prompt-inject
```

CLI 会按包内 `cordis.patch.yml` 自动把插件注册进 `dsh.profile.bundles`。

### 方式三：`pnpm add` 手动兜底

```bash
cd <DSH_HOME>/profiles/web
pnpm add dsh-prompt-inject
```

再把 `"dsh-prompt-inject"` 加进 profile `package.json` 的 `dsh.profile.bundles`，重启生效。

## 🖱 使用

1. 打开任意会话，点击会话头部工具条的 **「注入提示词」**，弹出管理浮层（自动绑定当前会话，可拖动）。
2. 顶部输入框：写好内容后
   - 点 **发送**：保存成新条目 + 立即排队注入当前会话（下次模型调用生效）；
   - 点 **保存**：只加入列表，不发送。
3. 条目卡片支持：**置顶 / 注入 / 编辑 / 删除**。
4. **注入**：一次性注入，仅当提示词不在当前窗口时才补注。
5. **条件注入**：勾选后展开条件面板 ——

   | 条件 | 触发时机 |
   | --- | --- |
   | 轮次开始时 | 用户消息后的第一个模型 step |
   | 思考之后 | 模型推理结束（reasoning block 结束或首个文本输出） |
   | 工具调用后 | 勾选的指定工具（glob / grep / pwsh / web_search / web_fetch）执行完成之后 |

6. **强制注入**：开 = 条件命中即注入；关 = 仅当提示词已滑出窗口才注入（日常建议关闭）。

> ⚠️ 条件注入与强制注入配置都是会话作用域内存态：重启 DSH 或新开会话后默认全关。
> ⚠️ 条件注入模式可能有一到两步的延迟；需要精确到下一次 step 时请直接点【注入】或【发送】。

## 🔧 注入机制

```
条件命中 / 手动注入 / 发送
      │  入队（10min TTL，覆盖式）
      ▼
agent/pre-step（下一次模型 step 前）
      │  合并 手动队列 + 逐步队列
      │  窗口判断：提示词原文是否已在本次请求 messages 中
      ▼
不在窗口（或强制注入）→ 追加一条插件 user 消息 → 只注入一次
轮次结束 → 丢弃本轮未消费的逐步队列
```

关键约束：

- `llm/stream` 监听器只读 chunk 元数据并**原样透传**，绝不 yield 新建/改写对象（避免 agent-loop 落盘序列化失败）；
- 注入消息带 `source: { kind: 'plugin:dsh-prompt-inject', form: 'instructions' }`，来源可审计；
- 提示词正文全局共享，逐步注入配置按会话隔离；删除提示词时同步清理所有会话的逐步配置。

## 🌐 HTTP 接口

管理页与 host 通过下列路由通信（同源，前缀 `/plugins/dsh-prompt-inject`）：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/prompts?sessionId=` | 列出提示词（附带该会话的逐步配置） |
| POST | `/prompts` | 新建一条提示词（只入列表） |
| PUT | `/prompts/{id}` | 更新正文 / 置顶 / 逐步配置 |
| DELETE | `/prompts/{id}` | 删除并清理该 id 的所有会话配置 |
| POST | `/inject` | 把已存在的提示词排队到下一次模型调用 |
| POST | `/quick-inject` | **保存并立即排队注入**（发送按钮用；落盘 + 入队一次完成） |
| GET | `/page` | 管理页 HTML |
| GET | `/theme` | 读取 DSH 外观偏好（light / dark / system） |

## 🗂 数据位置

| 数据 | 位置 | 持久性 |
| --- | --- | --- |
| 提示词正文 / 置顶 | `$DSH_HOME/dsh-prompt-inject/prompts.json` | 落盘持久化 |
| 逐步 / 强制注入配置 | 运行期内存（按会话隔离） | 重启即清空 |
| 注入队列 | 运行期内存 | 10 分钟 TTL / 消费即清 |

`DSH_HOME` 缺省为 `~/.dsh`。

## 🛠 开发

```bash
npm install
npm run typecheck   # host + client 两份 tsconfig
npm run build       # esbuild → lib/
npm run check       # typecheck + build
```

源码结构：

```
src/
├── client/
│   └── index.tsx      # 会话头部按钮 + 可拖动 iframe 浮层（slots 注入、BroadcastChannel 跟随会话）
└── host/
    ├── index.ts       # HTTP 路由 + llm/stream、tools/post-execute、agent/pre-step 注入管线
    ├── store.ts       # prompts.json 落盘 + 会话作用域逐步配置
    └── page.ts        # 自包含管理页（原生 JS 单文件，host 实时返回）
scripts/
└── build.mjs          # esbuild 构建两侧，client 套 window.__ModuleLoader__.load 壳
```

构建约定：

- host 产物是普通 ESM，Node 侧直接加载；
- client 产物必须是 **factory-form CJS** 且 `id` 等于包名 —— `dsh-client-modules` 按包名取模块，id 写错会导致「脚本加载了但没注册」。

## 🧩 兼容性

- DSH web / desktop profile 插件（host + client 双端）。
- peer 依赖 `@deepseek-ai/*` `^0.1.0-rc.6 || ^0.1.1-rc.2 || ^0.1.2-alpha.x`；React 18。
- Node `^22.19.0 || >=24.0.0`。

## License

[MIT](./LICENSE)
