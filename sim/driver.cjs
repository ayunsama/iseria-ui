/* 伊瑟利亚 · 百楼模拟器 —— LLM 驱动（OpenAI 兼容端点）
 * 读取 sim/config.local.json（不入库）。只用该端点跑「楼层回复」，不作任何 agent/代码用途。
 * 对齐真实酒馆双 API 结构：正文调用为主；变量更新随正文同源（本地公益站无第二端点时同源即可，
 * 指标里把「正文输出中的 <UpdateVariable> 块」折算为额外变量API负载单独记录）。
 */
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.local.json');
let cfg = null;
function loadConfig() {
  if (cfg) return cfg;
  if (!fs.existsSync(CONFIG_FILE)) throw new Error('缺少 sim/config.local.json（端点/key/model）');
  cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  return cfg;
}

async function chat(messages, opts) {
  const c = loadConfig();
  const body = {
    model: c.model,
    messages,
    temperature: opts && opts.temperature !== undefined ? opts.temperature : (c.temperature !== undefined ? c.temperature : 0.9)
  };
  if (c.maxTokens) body.max_tokens = c.maxTokens;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(c.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + c.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error('HTTP ' + r.status + ': ' + t.slice(0, 200));
      }
      const j = await r.json();
      const choice = j.choices && j.choices[0];
      const content = choice && choice.message && choice.message.content || '';
      if (!content.trim()) throw new Error('空回复（finish=' + (choice && choice.finish_reason) + '）');
      return {
        content,
        usage: j.usage || {},
        finish: choice.finish_reason
      };
    } catch (e) {
      console.warn('[driver] 第' + attempt + '次请求失败: ' + e.message);
      if (attempt < 3) await new Promise(r2 => setTimeout(r2, 4000 * attempt));
    }
  }
  throw new Error('重试耗尽: ' + (lastErr && lastErr.message));
}

module.exports = { chat, loadConfig };
