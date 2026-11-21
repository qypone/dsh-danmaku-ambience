# 发布到社区

本包现在**已具备发布条件**（审计 0 阻塞项）。本文档列出你要做的事，以及为什么。

---

## 0. 你需要准备的两样东西

| 需要 | 用途 |
|---|---|
| **npm 账号** | 发布 `dsh-danmaku-ambience` |
| **GitHub 账号 + 仓库** | 索引条目要链到源码仓库，评审会读代码 |

这两样我**不会**代你操作凭据。

---

## 1. 包已配置好

发布元数据已经填好（作者、仓库地址、版权行均已使用 `qypone`），无需再改。
如需修改用户名，重跑 `node tools\set-github-user.cjs`（改脚本里的 `USER` 常量）。

---
## 1. 建 GitHub 仓库并推源码

**这是收录的硬性前提**，CI 会检查。

```powershell
cd E:\dshProject\plugindemo\danmaku

git init -b main
git add -A
git commit -m "feat: dsh-danmaku-ambience 1.0.0"

# 在 GitHub 上建一个空仓库 dsh-danmaku-ambience，然后：
git remote add origin https://github.com/qypone/dsh-danmaku-ambience.git
git push -u origin main
```

**然后必须做**：在仓库页面 → Settings → Topics，添加 topic **`dsh-plugin`**。
少了这项 CI 直接失败。

**注意**：仓库**创建满 1 天**才能提交收录 PR（CI 自动检查 `created_at`）。

---

## 2. 发布到 npm

```powershell
cd E:\dshProject\plugindemo\danmaku

npm login
npm publish
```

`package.json` 里 `name` 就是发布名——npm 只认这个字段，**`publishConfig.name` 是无效的**（npm 不支持改名发布）：

```jsonc
"name": "dsh-danmaku-ambience"
```

本地安装和公开发布用同一个名字，所以 `dsh plugin add dsh-danmaku-ambience` 对两者都成立。

发布后验证：

```powershell
npm view dsh-danmaku-ambience
```

---

## 3. 提交收录 PR

「发现」页读的是 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 仓库，
**不是一个 README**，而是 `data/plugins/` 下一个插件一个 YAML 文件。

### 3.1 Fork 并新增唯一一个文件

```powershell
git clone https://github.com/qypone/awesome-dsh-plugin
cd awesome-dsh-plugin
```

新建文件 `data/plugins/<qypone>__dsh-danmaku-ambience.yml`：

```yaml
url: https://github.com/qypone/dsh-danmaku-ambience
name: qypone/dsh-danmaku-ambience
category: fun
description:
  en: Streams short lines across the DSH window in four moods, each with its own pace, copy, colour and motion, with adjustable pacing, font size and opacity.
  zh: 在 DSH 窗口上飘出弹幕，四种氛围各有自己的节奏、文案、配色和动效，可调节奏、字号和不透明度。
icon: https://raw.githubusercontent.com/qypone/dsh-danmaku-ambience/main/assets/icon-180.png
```

**字段说明**：

| 字段 | 要点 |
|---|---|
| `category` | 我选了 `fun`（娱乐）。备选 `ui`（UI 增强）。选不准不会被打回，维护者会改 |
| `description.en` | 单行、以句号结尾、无营销词、**每句都能在代码里找到对应**——这条最重要 |
| `description.zh` | 可选，缺翻译不是打回理由 |
| `icon` | 必须是 **GitHub 托管的 png/jpg/webp**，SVG 会被拒。已生成 `assets/icon-180.png` |

> ⚠️ 描述里如果有 `: `（冒号+空格），**必须给整行加单引号**，否则 YAML 解析失败。

### 3.2 提交

```powershell
git checkout -b add-dsh-danmaku-ambience
git add data/plugins/qypone__dsh-danmaku-ambience.yml
git commit -m "Add qypone/dsh-danmaku-ambience"
git push origin add-dsh-danmaku-ambience
```

然后开 PR。**一个 PR 最多 3 条**，你这个只加 1 条，没问题。

---

## 4. CI 会检查什么

按顺序：

1. **条目数量** —— 每 PR ≤ 3 条
2. **`dsh.bundle`** —— 从仓库 `package.json` 读，只有 `dsh.client` 会失败
3. **仓库年龄** —— ≥ 1 天
4. **`awesome-lint` 与站点构建** —— 双语一致性、格式

CI 过了**不等于**会合并。维护者还会人工读代码，看：

- 描述是否与代码一致（**夸大是最大退回原因**）
- 分类是否贴切
- 是否有可疑代码（混淆、凭据外传、异常安装行为）

---

## 5. 发布前自检清单

- [x] `package.json` 声明 `dsh.bundle`，patch 文件存在且含 `insert`
- [x] 真实可用代码（978 行 client + 3 行 host，非占位）
- [x] `description` 单行、句号结尾、无营销词
- [x] `repository` 字段（已指向 `qypone/dsh-danmaku-ambience`）
- [x] `license: MIT` + LICENSE 文件
- [x] 180px PNG 图标（`assets/icon-180.png`）
- [x] `screenshots.json`（指向 `docs/preview.png`）
- [x] 无 `@deepseek-ai/*` 出现在 `dependencies`
- [x] 填好用户名占位符（`qypone`）
- [ ] GitHub 仓库建好，加 `dsh-plugin` topic
- [ ] 仓库创建满 1 天
- [ ] `npm publish` 成功

前 8 项我已用 `tools/audit-publish.cjs` 验证通过，可随时复跑：

```powershell
node tools\audit-publish.cjs
```

---

## 6. 已生成的发布资源

| 文件 | 说明 |
|---|---|
| `assets/icon-180.png` | 市场图标，180×180，与 `icon.svg` 同一设计 |
| `docs/preview.png` | 深浅两种主题的四模式预览，`screenshots.json` 引用它 |
| `docs/preview.svg` | 同内容的矢量版 |
| `README.md` | 仓库首页，含安装方式与已知限制 |
| `LICENSE` | MIT |
| `docs/DETAIL.md` | 插件详情的详情页正文 |

预览图由 `tools/gen-preview-png.py` 从 `client.js` 的**真实模式参数**生成，
改了配色或字号后重跑即可同步，不会出现"图与代码不符"。

---

## 7. 已知限制（写进了 README，评审也会看）

- 文案是固定池子，不是生成的；插件不读你的对话内容
- 禅模式竖排是逐字堆叠，不是 `writing-mode`
- 禅模式列出现在随机横向位置，不和胶囊避让

这些如实写在 README 的 Limitations 一节，符合"描述必须属实"的要求。

---

## 8. 如果被退回

常见原因与处置（来自官方手册）：

| 症状 | 处置 |
|---|---|
| CI: `dsh.bundle` 缺失 | 检查 `package.json` 的 `dsh.bundle.patch` |
| CI: 仓库年龄 | 满 1 天后重新提交，不留记录 |
| YAML 解析失败 | 描述含 `: ` 未加引号 |
| 描述与代码不符 | 改成代码支持的说法 |
| 图标不显示 | 换成 GitHub 托管的 png |
| 重复 | 证明维护更好或确实做了新东西 |

反馈会以 PR 评论给出，推修复到同一分支即可，不用重开 PR。
