# 不背生词本 · Bob 插件

仓库地址：<https://github.com/xianlihuang/bob-plugin-bubei-newword> ｜ [下载最新版](https://github.com/xianlihuang/bob-plugin-bubei-newword/releases)

在 Bob 中查词时，自动把单个英文单词加入「不背单词」网页版（bbdc.cn）的**生词本**。

生词本是账号级数据（与 iPad / iPhone App 实时同步），所以在 Mac 上查的词，
打开 iPad 上的「不背单词」App 就能看到并加入学习——即使不背单词没有 Mac 原生版。

## 安装

1. 从 [Releases](https://github.com/xianlihuang/bob-plugin-bubei-newword/releases) 下载最新的 `.bobplugin` 文件，双击按提示安装（也可双击本地打包的 `不背生词本.bobplugin`）；
2. 打开 Bob → 偏好设置 → 服务 → 文本翻译 → 左下角 `+` → 添加「不背生词本」；
3. 保持勾选启用即可（建议同时开启其他常用翻译服务）。

## 配置 Cookie（必填）

1. 浏览器打开 <https://bbdc.cn/lexis/login>，微信扫码登录；
2. 再打开生词本页面 <https://bbdc.cn/newword>；
3. 按 `F12` 打开开发者工具 → `Network` → 刷新页面；
4. 点任意一个 `bbdc.cn` 的请求 → `Headers` → `Request Headers` → 复制 `Cookie:` 一行的
   **值**（很长，整段复制）；
5. 粘贴到 Bob → 偏好设置 → 服务 → 文本翻译 → 不背生词本 → 「不背单词 Cookie」输入框；
6. 点一下设置里的「验证」按钮，确认显示验证通过。

> Cookie 会过期（一般能用数周）。插件提示「Cookie 已失效」时，重复上述步骤更新即可。

## 选项说明

| 选项 | 说明 |
| --- | --- |
| 不背单词 Cookie | 网页版登录凭证，只保存在 Bob 本地并只发送给 bbdc.cn |
| 自动加入生词本 | 开启后，每次查询到单个英文单词都会收录进生词本 |
| 收录范围 | 默认「仅单个英文单词」：句子、中文等内容会自动跳过不打扰；改为「任意内容」后会对所有查询尝试查词收录（适合短语） |

## 工作原理

使用不背单词官方网页版 / 官方 Chrome 查词扩展所用的同一套接口：

| 用途 | 接口 |
| --- | --- |
| 查词 | `GET https://langeasy.com.cn/loadLexisList.action?strict=1&word=xxx` |
| 登录检查 | `GET https://bbdc.cn/api/check-login` |
| 是否已收录 | `GET https://bbdc.cn/api/check-new-word?word=xxx&infoidx=100` |
| 收录 | `POST https://bbdc.cn/api/user-new-word`（表单字段 `newwordlist`） |

查词结果以词典卡片样式展示（音标 + 词性词义），并在「生词本」附加栏显示收录状态。

## 已知限制

- 用的是**非公开接口**，官方改版后可能失效；仅供个人学习自用，请勿高频批量调用；
- 只能加入「生词本」，无法加入学习页的「收藏夹」（收藏夹是错题收藏，没有对应接口）；
- 添加请求失败时插件会自动换一种表单编码重试一次，仍失败则显示原因。

## 开发

```text
src/           插件源码（info.json / main.js / icon.png）
dev/make_icon.py   重新生成图标：python3 dev/make_icon.py
dev/test.mjs       本地测试（Node 模拟 Bob 环境）：
                     node dev/test.mjs                  # 无 Cookie 分支
                     node dev/test.mjs "token=xxx;..."  # 带真实 Cookie 完整测试
```

发版 / 打包：

```bash
dev/package.sh        # 重新打包，自动输出 sha256 与 appcast.json 条目
```

## 更新记录

- **v1.0.1**（2026-10-16）：修复 Bob 1.21 报「插件未实现 `translate` 方法」的问题。原因：Bob 会把插件脚本包在 `try{...}` 块中执行，而 JavaScript 的兼容提升规则（Annex B）只把普通 `function` 声明挂到全局对象上，`async function` 不会——改成普通函数声明并在文件末尾显式导出入口函数；本地测试也改为模拟 Bob 的包裹方式，不再依赖直接求值。
- **v1.0.0**：首个版本。

## 许可

[MIT License](LICENSE)。插件使用的是不背单词非官方接口，仅供个人学习自用。
