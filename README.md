# YT2Blog

极简的微型 SaaS 前端框架：粘贴一个 YouTube 视频链接 → 点击 **Generate** → 得到一篇结构清晰的英文博客草稿（标题、slug、meta description、正文小标题与段落）。

- 技术栈：Next.js 14（App Router）+ TypeScript + Tailwind CSS
- 真实链路：服务端抓取 YouTube 英文字幕（`youtube-transcript`），清洗后由 DeepSeek 生成文章；需要 `DEEPSEEK_API_KEY`（未配置时返回可读错误）
- 主要 UI 与生成逻辑集中在单文件 [app/page.tsx](app/page.tsx)

## 安装与运行（PowerShell）

环境要求：Node.js **18.17+**（推荐 20 LTS 或更高）。本仓库已自带可用的项目内 Node（见下方「使用项目内 Node」一节）；如果系统已装 node，也可直接使用。

```powershell
cd d:\yt2blog
npm install
npm run dev
# 打开 http://localhost:3000
```

生产构建：

```powershell
cd d:\yt2blog
npm install
npm run build
npm start
# 打开 http://localhost:3000
```

## 使用项目内 Node（自包含环境）

`d:\yt2blog\.tools\node` 是 **Node v20.20.2（LTS Iron，Windows x64）便携版**，从 nodejs.org 官方下载，自带 npm **10.8.2**。它不修改系统 PATH、不写入 Program Files，整套工具链都在项目目录内。

在新开的 PowerShell 里，把项目内 Node 临时加入**当前会话**的 PATH，然后照常使用 npm：

```powershell
cd d:\yt2blog
$env:PATH = 'd:\yt2blog\.tools\node;' + $env:PATH
node -v    # v20.20.2
npm -v     # 10.8.2

npm install
npm run build
npm run dev
# 浏览器打开 http://localhost:3000
```

说明：

- `.tools\` 已在 `.gitignore` 中忽略，不会进入版本库。
- `.npmrc` 把 npm 缓存指向 `d:\yt2blog\.tools\npm-cache`，依赖装在项目内 `node_modules`，不写用户目录。
- `.tools\node-v20.20.2-win-x64.zip` 是便携版的原始压缩包，仅作为离线重装/恢复环境的退路；环境正常时可删除，不影响运行。
- 以上 PATH 修改只对当前终端会话有效，关闭窗口即失效。

## 目录结构

```
d:\yt2blog
├─ app\
│  ├─ api\generate\route.ts  # 服务端生成路由（DeepSeek Chat Completions）
│  ├─ globals.css        # Tailwind 指令、暗色主题、skeleton 动画
│  ├─ layout.tsx         # 根布局与 SEO metadata
│  └─ page.tsx           # 全部页面 UI + 链接校验 + fetch('/api/generate')
├─ .env.local            # 本地密钥（已 gitignore，勿提交）
├─ .env.example          # 配置模板
├─ .gitignore
├─ .npmrc                # npm 缓存/审计等配置，缓存指向项目内
├─ .tools\               # 项目内 Node 便携版与 npm 缓存（已 gitignore）
├─ next-env.d.ts
├─ next.config.mjs
├─ package.json
├─ postcss.config.mjs
├─ tailwind.config.ts
├─ tsconfig.json
└─ README.md
```

## 功能说明

- **链接校验**：支持 `youtube.com/watch?v=…`、`youtu.be/…`、`youtube.com/shorts/…`（同时兼容 `m.youtube.com`、`/embed/`、`/live/`、`/v/`）。非法或缺失视频 ID 时在输入框下方显示内联错误。
- **生成流程**：前端 POST 到 `/api/generate`；服务端提取 videoId → 用 `lib/invidious.ts` 通过开源镜像 API（Invidious 优先，Piped 兜底）抓取英文字幕 → 清洗与超长截断 → 把字幕注入 user message 调 DeepSeek → 剥离 ```json 围栏并解析为 `title / slug / metaDescription / intro / sections[{heading, body}] / conclusion`。密钥只存在于服务端环境变量。
- **交互状态**：生成中按钮禁用并显示 loading 文案 + 骨架屏；成功后文章区域淡入展开；失败时显示错误卡片与 Try again。
- **文章操作**：Copy article（复制整篇含 slug 与 meta 的纯文本）、Copy（复制 meta description）、Regenerate（重新请求一次模型生成）。
- **视觉**：近黑极简风（`#08080A` 画布、细边框、单一强调色 `#D7FF3E`），移动端输入框与按钮自然堆叠。

## 真实 API 配置（DeepSeek）

生成链路已在服务端实现，配置只需两步：

1. 在 `.env.local` 写入密钥（**只放服务端环境变量，不要提交**，`.gitignore` 已忽略 `.env*.local`）：

```
DEEPSEEK_API_KEY=sk-你的密钥
# 可选：覆盖模型名，默认 deepseek-flash
DEEPSEEK_MODEL=deepseek-flash
# 可选：镜像不可用时替换默认实例（逗号分隔）
# INVIDIOUS_INSTANCES=https://inv.nadeko.net,https://yewtu.be
# PIPED_INSTANCES=https://api.piped.private.coffee,https://pipedapi.kavin.rocks
```

2. 重启 dev（`.env` 改动需要重启才生效）：

```powershell
$env:PATH = 'd:\yt2blog\.tools\node;' + $env:PATH
npm run dev
```

说明：

- 路由：[app/api/generate/route.ts](app/api/generate/route.ts)，`runtime = "nodejs"`、`maxDuration = 60`。字幕抓取用 `lib/invidious.ts` 调开源镜像 API，LLM 请求 `https://api.deepseek.com/chat/completions`（服务端超时 180s）。
- 响应为 SSE（`text/event-stream`），事件：`meta`（title/slug/meta 就绪）→ `delta`（正文增量）→ `done`（结构化文章）；中途失败发 `error`（message + code）。
- 无缓存：每次请求都真实抓字幕、真实调用 DeepSeek；仅保留内存级 in-flight 去重（同视频并发只跑一次）。
- 抓取错误分级：无英文字幕 / 字幕关闭 → 422（提示换一个有字幕的视频）；YouTube 限流 → 429；视频不可用 → 404；网络或超时 → 504；被 consent/bot 检查拦截 → 502。
- 出口网络：不再直连 YouTube（数据中心 IP 会被 Cloudflare/人机验证拦截），也不使用代理池。字幕改由开源镜像 API 提供：先请求 `https://<invidious>/api/v1/captions/<videoId>` 拿字幕列表，再下载具体字幕轨（WebVTT）；Invidious 全挂时自动切到 Piped `/streams/<videoId>`（TTML 字幕）。多个实例按顺序尝试，单个实例超时 8-12s，整体预算 40s。
- token 预算：`deepseek-flash` 的 reasoning 与正文共用 `max_tokens`，真实字幕下 reasoning 可能吃掉 4,000-7,000 tokens，因此首轮 8,000、重试 10,000；正文少于 600 词或空返回会自动重试一次。
- 错误分级：缺少/占位密钥 → 500；上游 401/402/404/429 → 透传状态码与可读 message；网络失败 → 502；超时 → 504；模型输出缺少标题/小节 → 502 并提示重试。
- 模型名：**API id 用 `deepseek-flash`（显示名 DeepSeek-V4.1-Flash）**，备用 `deepseek-v4-pro`；`deepseek-v4.1-flash` 只是显示名写法，不是合法 API id，会返回 400。代码默认值已设为 `deepseek-flash`，`.env.local` 中也已显式配置。
- 密钥不会出现在浏览器代码中，前端只与本站 `/api/generate` 通信。

## Deploy fast (Vercel)

```powershell
cd d:\yt2blog
git init
git add .
git commit -m "YT2Blog: streaming YouTube-to-blog generator"
# 在 GitHub 建空仓库后：
git remote add origin https://github.com/<your-name>/yt2blog.git
git push -u origin main
```

1. 打开 <https://vercel.com/new> → Import 该仓库（Framework 自动识别 Next.js，构建命令默认 `npm run build`，无需改）。
2. Project → Settings → Environment Variables 配：`DEEPSEEK_API_KEY`（必填，`sk-` 开头）、`DEEPSEEK_MODEL=deepseek-flash`。镜像实例一般可直连；若默认实例失效，用 `INVIDIOUS_INSTANCES` / `PIPED_INSTANCES` 换一组。
3. Deploy，然后打开域名用真实链接生成一次，看返回状态码：200 表示字幕抓取与生成正常；429/502 说明 YouTube 对数据中心 IP 做了限制。
4. 时间上限：Hobby 默认 10s，开启 Fluid compute 后为 60s（本项目 `maxDuration = 60`）；生成约 60-70s 的视频可能超时。需要在 Vercel 控制台 Team/Account → Upgrade to Pro（约 \$20/月/seat，以官网为准），Pro 上限 300s。

## 验证状态

已在项目内 Node v20.20.2（npm 10.8.2）上实际验证：

- `npm install`：成功，依赖全部落在 `d:\yt2blog\node_modules`
- `npm run build`：通过（Next.js 14.2.35，`✓ Compiled successfully`，静态页 4/4，约 20s）
- `npm run dev` 冒烟测试：`GET /` 返回 **HTTP 200**，响应体包含 `YT2Blog`、`Turn any YouTube video`、`Generate` 与 `Paste a YouTube link`。
- **镜像抓字幕验证（2026-10-30）**：
  - `yewtu.be` 返回人机验证页、`inv.nadeko.net` 502、`nerdvpn` 超时，因此 Invidious 全失败路径会打印 `[mirror] exhausted provider=invidious` 并自动切 Piped（`[mirror] invidious-failed-falling-back-to-piped`）。
  - `https://api.piped.private.coffee/streams/dQw4w9WgXcQ` → HTTP 200，6 条字幕（英文手动轨 + 英文自动轨），字幕 URL 返回真实 TTML；解析出 60 段、2,066 字符。
  - 本机用真实抓取的 Piped JSON + TTML 做整链 mock 测试：Invidious 4 个实例全部失败 → Piped 成功，`lang=en segments=60 chars=2066`，首尾文本正确。
  - 本机直连外网被网络策略拦截（需本地 VPN），故未跑真实 HTTP 端到端；部署到 Render 后以真实链接验证。
- 缓存已移除：每次请求真实抓取字幕并真实调用 DeepSeek；仅保留内存级 in-flight 去重。
- `.env.local` 配置：`DEEPSEEK_API_KEY=sk-****`（仅服务端读取，勿提交）；`DEEPSEEK_MODEL=deepseek-flash`；不再配置 `YOUTUBE_PROXY`。
