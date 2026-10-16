/**
 * 本地测试：在 Node 中模拟 Bob 的 $http / $option / $data / $log 环境，
 * 直接调用 src/main.js 里的 translate()，验证各分支行为。
 *
 * 用法：node dev/test.mjs [cookie]
 *   node dev/test.mjs                 # 不传 Cookie，测试未配置 / 无效 Cookie 分支
 *   node dev/test.mjs "token=xxx; ..." # 传入真实 Cookie，可完整测试收录流程
 */

import fs from "node:fs";
import vm from "node:vm";

const mainSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const realCookie = process.argv[2] || "";

function makeSandbox(options) {
  const sandbox = {
    console,
    // Bob 加载插件时提供的原生异常接收函数（模拟）
    __native_catch: (error) => console.error("[native_catch]", error),
    $option: options,
    $log: { info: () => {}, error: (...args) => console.error("[log]", ...args) },
    $data: { fromUTF8: (s) => Buffer.from(s, "utf8") },
    $http: {
      request(opts) {
        (async () => {
          try {
            const headers = { ...(opts.header || {}) };
            const method = (opts.method || "GET").toUpperCase();
            let url = opts.url;
            let body;
            if (opts.body !== undefined) {
              if (Buffer.isBuffer(opts.body)) {
                body = opts.body;
              } else if (typeof opts.body === "object") {
                const ct = headers["Content-Type"] || "";
                if (/application\/json/i.test(ct)) {
                  body = JSON.stringify(opts.body);
                } else if (method === "GET") {
                  const qs = new URLSearchParams(opts.body).toString();
                  url += (url.includes("?") ? "&" : "?") + qs;
                } else {
                  body = new URLSearchParams(opts.body).toString();
                }
              } else {
                body = opts.body;
              }
            }
            const resp = await fetch(url, { method, headers, body, redirect: "manual" });
            const text = await resp.text();
            let data;
            try { data = JSON.parse(text); } catch { data = text; }
            opts.handler && opts.handler({ data, response: { statusCode: resp.status } });
          } catch (err) {
            opts.handler && opts.handler({ error: { message: String((err && err.message) || err) } });
          }
        })();
      },
    },
  };
  return sandbox;
}

function runTranslate(sandbox, text) {
  return new Promise((resolve) => {
    sandbox.translate(
      { text, from: "auto", to: "auto", detectFrom: "en", detectTo: "zh-Hans" },
      (payload) => resolve(payload)
    );
  });
}

function summarize(payload) {
  if (payload.error) {
    return `ERROR(${payload.error.type}): ${payload.error.message}`;
  }
  const dict = payload.result.toDict;
  const additions = (dict.additions || []).map((a) => `${a.name}=${a.value}`).join(" | ");
  return `OK word=${dict.word} parts=${(dict.parts || []).length} additions=[${additions}]`;
}

const cases = [
  {
    name: "1. 句子（scope=word）→ 应折叠跳过",
    options: { cookie: "", autoAdd: "on", scope: "word" },
    text: "hello world, this is a test sentence.",
  },
  {
    name: "2. 单词 + 关闭收录 → 应显示词典结果",
    options: { cookie: "", autoAdd: "off", scope: "word" },
    text: "abandon.",
  },
  {
    name: "3. 不存在的词 → 应报未收录",
    options: { cookie: "", autoAdd: "off", scope: "word" },
    text: "zzzzqqxyz",
  },
  {
    name: "4. 单词 + 开启收录 + 未填 Cookie → 应提示设置 Cookie",
    options: { cookie: "", autoAdd: "on", scope: "word" },
    text: "abandon",
  },
  {
    name: "5. 大小写单词（Apple）→ 应查到 apple",
    options: { cookie: "", autoAdd: "off", scope: "word" },
    text: "Apple",
  },
];

if (realCookie) {
  cases.push({
    name: "6. 单词 + 真实 Cookie → 应尝试收录",
    options: { cookie: realCookie, autoAdd: "on", scope: "word" },
    text: "serendipity",
  });
} else {
  cases.push({
    name: "6. 单词 + 无效 Cookie → 应提示 Cookie 失效",
    options: { cookie: "token=fake_abc123", autoAdd: "on", scope: "word" },
    text: "abandon",
  });
}

// 模拟 Bob 的脚本求值方式：整份插件代码包在 try{...}catch(e){__native_catch(e)} 中。
// 这一步很关键：try 块内的 async function 声明不会挂到全局对象上，
// 旧版本曾因此被 Bob 报「插件未实现 translate 方法」。
function bobLikeSource(source) {
  return "try{\n" + source + "\n}catch(e){__native_catch(e)};";
}

const REQUIRED_GLOBALS = ["translate", "supportLanguages", "pluginTimeoutInterval", "pluginValidate"];

for (const c of cases) {
  const sandbox = makeSandbox(c.options);
  vm.createContext(sandbox);
  vm.runInContext(bobLikeSource(mainSource), sandbox, { filename: "main.js" });

  const missing = REQUIRED_GLOBALS.filter((name) => typeof sandbox[name] !== "function");
  if (missing.length) {
    console.error(`入口函数缺失：${missing.join(", ")} → Bob 会报「插件未实现 xxx 方法」`);
    process.exitCode = 1;
  }

  const payload = await runTranslate(sandbox, c.text);
  console.log(`${c.name}\n   → ${summarize(payload)}\n`);
}

if (!process.exitCode) {
  console.log(`入口函数检查：通过（${REQUIRED_GLOBALS.join("/")} 均已挂载到全局对象）`);
}
