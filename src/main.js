/**
 * 不背生词本 —— Bob 文本翻译插件
 *
 * 查词的同时，自动把单个英文单词加入「不背单词」网页版（bbdc.cn）的生词本。
 * 生词本是账号级数据，与 iPad / iPhone App 同步，打开 App 即可看到并加入学习。
 *
 * 使用到的接口与不背单词官方网页版、官方 Chrome 查词扩展完全一致：
 *   - 查词      GET  https://langeasy.com.cn/loadLexisList.action?strict=1&word=xxx
 *   - 登录检查  GET  https://bbdc.cn/api/check-login
 *   - 是否已收录 GET https://bbdc.cn/api/check-new-word?word=xxx&infoidx=100
 *   - 收录      POST https://bbdc.cn/api/user-new-word （表单字段 newwordlist）
 *
 * 注意：这些不是官方公开 API，官方更新后可能失效；插件仅供个人学习自用，
 * Cookie 只保存在 Bob 插件设置中，仅发送给 bbdc.cn。
 */

var LOOKUP_URL = "https://langeasy.com.cn/loadLexisList.action";
var API_HOST = "https://bbdc.cn";
var NEW_WORD_PAGE = "https://bbdc.cn/newword";

/* ============================ Bob 插件接口 ============================ */

function pluginTimeoutInterval() {
  return 30;
}

function supportLanguages() {
  return ["auto", "en", "zh-Hans"];
}

function pluginValidate(completion) {
  var cookie = getCookie();
  if (!cookie) {
    completion({
      result: false,
      error: {
        type: "secretKey",
        message: "未设置不背单词 Cookie：请登录 bbdc.cn，从浏览器开发者工具中复制请求头里的 Cookie 填入插件设置",
        troubleshootingLink: NEW_WORD_PAGE
      }
    });
    return;
  }
  loginState(cookie).then(function (state) {
    if (state.ok) {
      completion({ result: true });
      return;
    }
    completion({
      result: false,
      error: {
        type: state.networkError ? "network" : "secretKey",
        message: state.message || "Cookie 校验失败",
        troubleshootingLink: NEW_WORD_PAGE
      }
    });
  }).catch(function (error) {
    completion({
      result: false,
      error: {
        type: "unknown",
        message: "校验出错：" + errorMessage(error),
        troubleshootingLink: NEW_WORD_PAGE
      }
    });
  });
}

// 注意：translate 必须是普通函数声明，不能写成 async function。
// Bob 会把插件代码包在 try{...}catch(e){...} 中执行；按语言规范，
// try 块内的 async function 声明不会被提升到全局对象（Annex B 兼容语义只覆盖普通 function），
// 会导致 Bob 报「插件未实现 translate 方法」。异步逻辑交给 handleTranslate 即可。
function translate(query, completion) {
  handleTranslate(query, completion).catch(function (error) {
    reply(query, completion, {
      error: { type: "unknown", message: "不背生词本插件内部错误：" + errorMessage(error) }
    });
  });
}

/* ============================== 主流程 ============================== */

async function handleTranslate(query, completion) {
  var rawText = String((query && (query.originalText || query.text)) || "").trim();
  var scope = optionValue("scope", "word"); // "word" | "any"
  var autoAdd = optionValue("autoAdd", "on") === "on";

  var word = extractWord(rawText);

  // 默认只处理「单个英文单词」，其余内容（句子、中文等）直接跳过、不打扰
  if (scope !== "any" && !word) {
    reply(query, completion, {
      error: { type: "notFound", message: "不背生词本：仅收录单个英文单词，已跳过当前内容" }
    });
    return;
  }
  if (!word && rawText.length > 80) {
    reply(query, completion, {
      error: { type: "notFound", message: "不背生词本：内容过长，未执行查词" }
    });
    return;
  }

  var lookupText = word || rawText;
  if (!lookupText) {
    reply(query, completion, { error: { type: "notFound", message: "不背生词本：查询内容为空" } });
    return;
  }

  // 1. 查词
  var lookup = await lookupWord(lookupText);
  if (lookup.status === "network") {
    reply(query, completion, { error: { type: "network", message: "不背生词本：" + lookup.message } });
    return;
  }
  if (lookup.status !== "ok") {
    reply(query, completion, { error: { type: "notFound", message: "不背单词未收录「" + lookupText + "」" } });
    return;
  }
  var entry = lookup.entry;
  var wordValue = entry.word || lookupText.toLowerCase();

  // 2. 收录到生词本
  var statusLine;
  if (!autoAdd) {
    statusLine = "仅查询释义，未加入生词本（自动加入已关闭）";
  } else {
    var cookie = getCookie();
    if (!cookie) {
      reply(query, completion, {
        error: {
          type: "secretKey",
          message: "未设置不背单词 Cookie：请登录 bbdc.cn，从浏览器开发者工具中复制请求头里的 Cookie 填入插件设置",
          troubleshootingLink: NEW_WORD_PAGE
        }
      });
      return;
    }

    var state = await loginState(cookie);
    if (!state.ok) {
      reply(query, completion, {
        error: {
          type: state.networkError ? "network" : "secretKey",
          message: state.message,
          troubleshootingLink: NEW_WORD_PAGE
        }
      });
      return;
    }

    var check = await checkNewWord(wordValue, cookie);
    if (!check.ok) {
      logError("check-new-word failed", check.message);
      statusLine = "⚠️ 未能确认生词本状态：" + check.message;
    } else if (check.exists) {
      statusLine = "已在生词本中，未重复添加";
    } else {
      var addResult = await addNewWord(wordValue, entry.interpret || "", cookie);
      if (addResult.ok) {
        statusLine = "✅ 已加入不背单词生词本";
      } else {
        logError("user-new-word failed", addResult.message);
        statusLine = "⚠️ 加入生词本失败：" + addResult.message;
      }
    }
  }

  reply(query, completion, { result: buildResult(query, entry, statusLine) });
}

/* ============================== 网络请求 ============================== */

// 统一包装 $http.request（带 handler 的 Promise 版本）
function request(options) {
  return new Promise(function (resolve) {
    options.handler = function (resp) { resolve(resp || {}); };
    try {
      $http.request(options);
    } catch (error) {
      resolve({ error: { message: errorMessage(error) } });
    }
  });
}

function describeHttpError(resp) {
  if (resp && resp.error) return errorMessage(resp.error);
  if (resp && resp.response) {
    var status = resp.response.statusCode;
    if (status && (status < 200 || status >= 300)) return "HTTP " + status;
  }
  return "";
}

// 兼容不背单词接口的错误结构：{ result_code: 20000, error_body: { user_message: "请登录" } }
function apiMessage(data) {
  if (data && typeof data === "object") {
    if (data.error_body) {
      var userMessage = data.error_body.user_message || data.error_body.info;
      if (userMessage) return String(userMessage);
    }
    var message = data.result_msg || data.message || data.msg;
    if (message) return String(message);
    if (data.result_code !== undefined) return "接口返回 result_code=" + data.result_code;
  }
  return "";
}

/* ============================== 各接口封装 ============================== */

async function lookupWord(word) {
  var attempts = [word];
  var lower = word.toLowerCase();
  if (lower !== word) attempts.push(lower);

  for (var i = 0; i < attempts.length; i++) {
    var resp = await request({
      method: "GET",
      url: LOOKUP_URL + "?strict=1&word=" + encodeURIComponent(attempts[i]),
      timeout: 15
    });
    var httpError = describeHttpError(resp);
    if (httpError) return { status: "network", message: "查词接口请求失败：" + httpError };
    var data = resp.data;
    if (data && typeof data === "object" && data.wordlist && data.wordlist.length > 0 && data.wordlist[0].word) {
      return { status: "ok", entry: data.wordlist[0] };
    }
    if (!data || typeof data !== "object") {
      return { status: "network", message: "查词接口响应异常" };
    }
  }
  return { status: "notFound" };
}

async function loginState(cookie) {
  var resp = await request({
    method: "GET",
    url: API_HOST + "/api/check-login",
    header: { Cookie: cookie },
    timeout: 15
  });
  var httpError = describeHttpError(resp);
  if (httpError) {
    return { ok: false, networkError: true, message: "无法连接不背单词：" + httpError };
  }
  var data = resp.data;
  if (data && typeof data === "object" && data.result_code === 200) {
    var name = data.data_body && data.data_body.name ? String(data.data_body.name) : "";
    return { ok: true, name: name };
  }
  var reason = apiMessage(data);
  return {
    ok: false,
    message: "不背单词 Cookie 已失效或未登录网页版" +
      (reason ? "（" + reason + "）" : "") +
      "，请重新登录 bbdc.cn 并更新插件设置中的 Cookie"
  };
}

async function checkNewWord(word, cookie) {
  var resp = await request({
    method: "GET",
    url: API_HOST + "/api/check-new-word?word=" + encodeURIComponent(word) + "&infoidx=100",
    header: { Cookie: cookie },
    timeout: 15
  });
  var httpError = describeHttpError(resp);
  if (httpError) return { ok: false, message: "请求失败（" + httpError + "）" };
  var data = resp.data;
  if (data && typeof data === "object" && data.result_code === 200) {
    var list = (data.data_body && data.data_body.list) || [];
    return { ok: true, exists: list.length > 0 };
  }
  return { ok: false, message: apiMessage(data) || "响应异常" };
}

function newWordPayload(word, info) {
  return JSON.stringify({
    word: word,
    course: "*",
    wordidx: "*",
    infoidx: "100",
    selection: "*",
    info: info || "",
    opcode: "1"
  });
}

function parseAddResponse(resp) {
  var httpError = describeHttpError(resp);
  if (httpError) return { ok: false, networkError: true, message: httpError };
  var data = resp.data;
  if (data && typeof data === "object" && data.result_code === 200) return { ok: true };
  return { ok: false, message: apiMessage(data) || "接口返回异常，未能确认结果" };
}

// 与官方扩展一致：multipart/form-data 表单
async function addNewWordMultipart(word, info, cookie) {
  var boundary = "----BobPluginBubeiNewWord";
  var body = "--" + boundary + "\r\n" +
    "Content-Disposition: form-data; name=\"newwordlist\"" + "\r\n\r\n" +
    newWordPayload(word, info) + "\r\n" +
    "--" + boundary + "--\r\n";
  var resp = await request({
    method: "POST",
    url: API_HOST + "/api/user-new-word",
    header: {
      Cookie: cookie,
      "Content-Type": "multipart/form-data; boundary=" + boundary
    },
    body: $data.fromUTF8(body),
    timeout: 15
  });
  return parseAddResponse(resp);
}

// 兜底：application/x-www-form-urlencoded
async function addNewWordForm(word, info, cookie) {
  var resp = await request({
    method: "POST",
    url: API_HOST + "/api/user-new-word",
    header: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"
    },
    body: { newwordlist: newWordPayload(word, info) },
    timeout: 15
  });
  return parseAddResponse(resp);
}

async function addNewWord(word, info, cookie) {
  var first = await addNewWordMultipart(word, info, cookie);
  if (first.ok) return first;
  var second = await addNewWordForm(word, info, cookie);
  if (second.ok) return second;
  // 优先上报更有意义的错误
  if (!first.message && second.message) return second;
  return first;
}

/* ============================== 结果组装 ============================== */

function reply(query, completion, payload) {
  if (query && typeof query.onCompletion === "function") {
    query.onCompletion(payload);
  } else if (typeof completion === "function") {
    completion(payload);
  }
}

function buildResult(query, entry, statusLine) {
  var to = (query && query.detectTo) || "zh-Hans";
  var word = String(entry.word || "");
  var uk = String(entry.uk_pron || "").trim();
  var us = String(entry.us_pron || "").trim();
  var interpret = String(entry.interpret || "").trim();

  var phonetics = [];
  if (uk) phonetics.push({ type: "uk", value: uk });
  if (us) phonetics.push({ type: "us", value: us });

  var parsed = splitInterpretWithParts(interpret);

  var dict = { word: word };
  if (phonetics.length) dict.phonetics = phonetics;
  if (parsed.parts.length) dict.parts = parsed.parts;

  var additions = [];
  if (parsed.extra.length) additions.push({ name: "其他释义", value: parsed.extra.join("\n") });
  if (statusLine) additions.push({ name: "生词本", value: statusLine });
  if (additions.length) dict.additions = additions;

  // 兼容旧版 Bob 的译文段落
  var lines = [];
  var head = word;
  if (uk) head += "   英 /" + uk + "/";
  if (us) head += "   美 /" + us + "/";
  lines.push(head);
  var interpretLines = interpret ? interpret.split(/\r?\n/) : [];
  for (var i = 0; i < interpretLines.length; i++) {
    var line = interpretLines[i].trim();
    if (line) lines.push(line);
  }

  return {
    from: "en",
    to: to,
    toDict: dict,
    toParagraphs: lines
  };
}

// 把 "vt. 放弃；抛弃；沉湎于\nn. 放任，放纵" 这类释义拆成词性 + 词义
function splitInterpretWithParts(interpret) {
  var lines = interpret ? interpret.split(/\r?\n/) : [];
  var parts = [];
  var extra = [];
  var current = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var match = line.match(/^([a-zA-Z]+\.)\s*(.+)$/);
    if (match) {
      current = { part: match[1], means: [match[2]] };
      parts.push(current);
    } else if (current) {
      current.means.push(line);
    } else {
      extra.push(line);
    }
  }
  return { parts: parts, extra: extra };
}

/* ============================== 工具函数 ============================== */

function optionValue(identifier, fallback) {
  try {
    var value = $option[identifier];
    if (value === undefined || value === null || value === "") return fallback;
    return String(value);
  } catch (error) {
    return fallback;
  }
}

function getCookie() {
  var raw = "";
  try {
    raw = String($option["cookie"] || "");
  } catch (error) {
    raw = "";
  }
  var cookie = raw.replace(/\s+/g, " ").trim();
  cookie = cookie.replace(/^cookie\s*:\s*/i, "");
  cookie = cookie.replace(/^["']+/, "").replace(/["']+$/, "").trim();
  return cookie;
}

// 从选中的文本中提取单个英文单词（容忍首尾标点、空格）
function extractWord(text) {
  var trimmed = String(text || "").trim();
  var word = trimmed.replace(/^[^A-Za-z]+/, "").replace(/[^A-Za-z]+$/, "");
  if (!word) return "";
  if (!/^[A-Za-z][A-Za-z'’-]*$/.test(word)) return "";
  if (word.length > 64) return "";
  return word;
}

function errorMessage(error) {
  if (!error) return "未知错误";
  if (typeof error === "string") return error;
  return String(error.message || error);
}

function logError(message, detail) {
  try {
    $log.error(String(message) + (detail !== undefined ? " | " + detail : ""));
  } catch (error) {
    // 忽略日志错误
  }
}

/* ============================== 入口导出 ============================== */

// 显式把 Bob 入口函数挂到全局对象上，兼容不同 Bob 版本的加载方式：
// Bob 是在 try 代码块中求值插件脚本的，语言层面的兼容提升（Annex B）
// 只对普通 function 声明生效，async function 或将来的严格模式都可能不生效，
// 显式赋值在任何加载方式下都安全。
(function exportBobEntryPoints() {
  if (typeof globalThis === "undefined") return;
  globalThis.translate = translate;
  globalThis.supportLanguages = supportLanguages;
  globalThis.pluginTimeoutInterval = pluginTimeoutInterval;
  globalThis.pluginValidate = pluginValidate;
})();
