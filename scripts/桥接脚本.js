/**
 * Agent 桥接脚本（事后数值审计）
 *
 * 职责单一：监听 MVU 变量更新 → 把「变更差异 + 相关状态快照 + 最新楼层文本」发给本地 Agent 服务器
 *   → Agent（规则裁判）按伊瑟利亚数值规则复核 → 违规数值由本脚本原地修正写回变量。
 *
 * 设计底线（降级原则）：
 *   - 服务器不在线 / 超时 / 返回异常 → 静默放行（console.warn 记录），绝不阻断正常游玩；
 *   - 非战斗相关变量变更不审计（零流量）；
 *   - 本脚本自己写回的修正不会再次触发审计（writing 标志 + 冷却时间双重防自环）。
 *
 * 协议（与本地 127.0.0.1:8777 队列服务器约定）：
 *   POST /api/ask    { id, prompt }   提交审计请求（prompt 为可读审计文本）
 *   GET  /api/poll/:id                长轮询取回复，未回复时返回 { wait:true }
 *   Agent 回复（JSON 文本）：
 *     { "verdict": "pass|corrected|uncertain",
 *       "corrections": [ { "path": "主要NPC.某人.血量", "value": 7, "from": 17, "reason": "…" } ],
 *       "notes": "…" }
 *     path 相对 stat_data 根；value 为修正后的最终值。
 *
 * 手动操作（在脚本 iframe 控制台）：
 *   await window.__agentBridge.auditNow()      立即审计一次当前最新楼层的变量
 *   window.__agentBridge.setEnabled(false)     暂停桥接（localStorage 持久化）
 */

$(async () => {
  // Mvu 全局由酒馆助手延迟注入——不等待会在启动时 ReferenceError 中断整个回调
  try { await waitGlobalInitialized('Mvu'); } catch (e) { console.warn('[Agent桥接] Mvu 等待失败:', e); }
  const SERVER = 'http://127.0.0.1:8777';
  const SCRIPT_ID = 'agent-bridge';
  const AUDIT_TIMEOUT_MS = 90000;   // 等待 Agent 回复的完整上限
  const COOLDOWN_MS = 15000;        // 两次审计之间的最小间隔（防自环/防风暴）
  const MAX_DIFF_ENTRIES = 60;
  const MAX_FLOOR_CHARS = 1500;
  const ENABLE_KEY = 'iseria_agent_bridge_enabled';

  // 命中这些路径的变更才触发审计（正则字符串，按需增删）
  const AUDIT_PATH_RE = /(主要NPC|英灵|战斗|血量|生命|HP|MP|SP|状态|士气|死亡|倒下)/;
  // 快照里携带的子树（控制体积，缺省不带世界/动态新闻等大块数据）
  const SNAPSHOT_KEYS = ['主角', '主要NPC', '英灵', '同伴', '$flags'];

  let writing = false;        // 本脚本正在写回修正
  let lastAuditAt = 0;
  const enabled = localStorage.getItem(ENABLE_KEY) !== 'off';

  const log = (...a) => console.info('[Agent桥接]', ...a);
  const warn = (...a) => console.warn('[Agent桥接]', ...a);

  // ---------- 工具 ----------

  function uniqId() {
    try { return crypto.randomUUID(); } catch (e) { return String(Date.now() + Math.random()); }
  }

  /** 递归比较两个对象，返回 [{path, before, after}]（数组与深层级作为叶子值整体比较） */
  function diffStat(before, after, path, depth, out) {
    if (out.length >= 200 || depth > 5) return out;
    const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
    if (isObj(before) && isObj(after)) {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const k of keys) {
        if (k.startsWith('$')) continue; // $flags 由快照单独携带，不参与路径 diff
        diffStat(before[k], after[k], path ? path + '.' + k : k, depth + 1, out);
      }
    } else if (JSON.stringify(before) !== JSON.stringify(after)) {
      out.push({
        path: path || '(根)',
        before: truncate(before, 80),
        after: truncate(after, 80),
      });
    }
    return out;
  }

  function truncate(v, n) {
    let s;
    try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { s = String(v); }
    if (s === undefined) s = String(v);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function pick(obj, keys) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const k of keys) {
      if (obj[k] !== undefined) {
        try { out[k] = JSON.parse(JSON.stringify(obj[k])); } catch (e) { out[k] = obj[k]; }
      }
    }
    return out;
  }

  // ---------- 与 Agent 服务器通信 ----------

  async function askAgent(prompt) {
    const id = uniqId();
    const askRes = await fetch(SERVER + '/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, prompt }),
    });
    if (!askRes.ok) throw new Error('ask HTTP ' + askRes.status);
    const deadline = Date.now() + AUDIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const res = await fetch(SERVER + '/api/poll/' + encodeURIComponent(id));
      const json = await res.json();
      if (json && typeof json.text === 'string') return json.text;
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('等待 Agent 回复超时');
  }

  function parseAgentReply(text) {
    let raw = String(text == null ? '' : text).trim();
    // 剥代码围栏，取第一个 { … } 平衡块
    const fm = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fm) raw = fm[1];
    const start = raw.indexOf('{');
    if (start === -1) throw new Error('回复中没有 JSON');
    let depth = 0, end = -1, inStr = false, esc = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) throw new Error('回复 JSON 未闭合');
    return JSON.parse(raw.slice(start, end + 1));
  }

  // ---------- 审计主流程 ----------

  function buildPrompt(diffs, snapshot, floorText) {
    const lines = [];
    lines.push('【Agent 战斗数值审计请求】');
    lines.push('请以伊瑟利亚规则裁判身份复核以下由主 LLM 写入的变量变更。');
    lines.push('规则要点：伤害/恢复一律 NdX 骰式（可加固定值）；禁止百分比增减益；属性/命中/防御修正每项 +1~+4（上限 +5）；暴击用范围表述（20→19-20）；数值与角色总等级档位匹配；HP/资源不得为负；死亡/倒下必须有对应状态标记。');
    lines.push('');
    if (floorText) {
      lines.push('【触发本次更新的最新楼层文本（截断）】');
      lines.push(floorText.slice(0, MAX_FLOOR_CHARS));
      lines.push('');
    }
    lines.push('【变量变更】（path: 旧值 → 新值）');
    diffs.slice(0, MAX_DIFF_ENTRIES).forEach(d => {
      lines.push('- ' + d.path + ': ' + JSON.stringify(d.before) + ' → ' + JSON.stringify(d.after));
    });
    if (diffs.length > MAX_DIFF_ENTRIES) lines.push('- …（其余 ' + (diffs.length - MAX_DIFF_ENTRIES) + ' 条省略）');
    lines.push('');
    lines.push('【相关状态快照】');
    let snapStr = '';
    try { snapStr = JSON.stringify(snapshot, null, 1); } catch (e) { snapStr = String(snapshot); }
    lines.push(snapStr.length > 60000 ? snapStr.slice(0, 60000) + '…（截断）' : snapStr);
    lines.push('');
    lines.push('请严格只回复 JSON（不要围栏不要解释）：');
    lines.push('{"verdict":"pass|corrected|uncertain","corrections":[{"path":"相对stat_data的路径","value":修正后的最终值,"from":原值,"reason":"简短理由"}],"notes":"一句话总评或空"}');
    lines.push('无问题则 corrections 为空数组。拿不准的用 uncertain 并在 notes 说明，不要乱改。');
    return lines.join('\n');
  }

  async function audit(data, before) {
    const cur = data && data.stat_data ? data.stat_data : data;
    const prev = before && before.stat_data ? before.stat_data : before;
    const diffs = diffStat(prev, cur, '', 0, []);
    if (!diffs.length) return;
    if (!diffs.some(d => AUDIT_PATH_RE.test(d.path))) return; // 非战斗相关：零流量放行

    let floorText = '';
    try {
      const msgs = await getChatMessages(-1);
      if (msgs && msgs.length) floorText = msgs[msgs.length - 1].message || '';
    } catch (e) { warn('读取楼层文本失败', e); }

    const snapshot = pick(cur, SNAPSHOT_KEYS);
    const prompt = buildPrompt(diffs, snapshot, floorText);
    log('提交审计：变更 ' + diffs.length + ' 处，等待规则裁判回复…');

    const replyText = await askAgent(prompt);
    const reply = parseAgentReply(replyText);
    const verdict = reply && reply.verdict ? reply.verdict : 'uncertain';
    const corrections = Array.isArray(reply.corrections) ? reply.corrections : [];

    if (verdict === 'pass' || !corrections.length) {
      log('审计完成：' + verdict + (reply.notes ? '｜' + reply.notes : ''));
      return;
    }

    // 写回修正（重新拉取最新数据，避免覆盖并发更新）
    const fresh = Mvu.getMvuData({ type: 'message', message_id: 'latest' });
    if (!fresh || !fresh.stat_data) { warn('写回失败：拿不到最新 mvu 数据'); return; }
    let applied = 0;
    corrections.forEach(c => {
      if (!c || typeof c.path !== 'string' || !c.path) return;
      try {
        _.set(fresh.stat_data, c.path, c.value);
        applied++;
        log('修正 ' + c.path + ': ' + JSON.stringify(c.from) + ' → ' + JSON.stringify(c.value) + (c.reason ? '（' + c.reason + '）' : ''));
      } catch (e) { warn('修正失败 ' + c.path, e); }
    });
    if (!applied) return;
    writing = true;
    try {
      await Mvu.replaceMvuData(fresh, { type: 'message', message_id: 'latest' });
      toastr.warning('⚖️ 规则裁判修正了 ' + applied + ' 处数值', 'Agent 桥接');
    } finally {
      setTimeout(() => { writing = false; }, 2000);
    }
  }

  // ---------- 事件挂载 ----------

  eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, async (data, before) => {
    if (!enabled) return;
    if (writing) return;
    const now = Date.now();
    if (now - lastAuditAt < COOLDOWN_MS) return;
    lastAuditAt = now;
    try {
      await audit(data, before);
    } catch (e) {
      warn('审计降级放行：', e && e.message ? e.message : e);
    }
  });


  // ---------- 生成前数值裁定（战斗回合：ZCode 先算数，AI 照数写正文） ----------

  let pregenBusy = false;
  const pregenEnabled = localStorage.getItem('iseria_agent_bridge_pregen') !== 'off';
  const COMBAT_RE = /(攻击|斩|刺|砍|劈|射|施法|咏唱|防御|格挡|招架|躲避|闪避|检定|掷骰|战斗|突袭|偷袭|逃跑|撤退|陷阱|挥拳|踢|冲|技能|奥义|神术|卷轴|喝下|服用|翻滚|瞄准|蓄力)/;

  function lastUserContent(chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i] && chat[i].role === 'user') return String((chat[i] && chat[i].content) || '');
    }
    return '';
  }

  async function pregenHandler(payload) {
    try {
      if (pregenBusy) return;
      if (localStorage.getItem('iseria_agent_bridge_pregen') === 'off') return;
      if (typeof enabled !== 'undefined' && !enabled) return;
      const chat = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.chat) ? payload.chat : null);
      if (!chat || chat.length < 4) return;
      // 跳过自家/类数据库的隔离分析调用（防自触发循环）
      const firstSys = String((chat[0] && chat[0].content) || '');
      if (firstSys.indexOf('行为一致性审核员') !== -1) return;
      const userText = lastUserContent(chat);
      if (!userText || !COMBAT_RE.test(userText)) return;   // 非战斗意图：零流量放行
      pregenBusy = true;
      try {
        let snap = '';
        try {
          const v = Mvu.getMvuData({ type: 'message', message_id: 'latest' });
          const sd = v && v.stat_data ? v.stat_data : v;
          snap = JSON.stringify({ 主角: sd.主角, 同伴: sd.同伴, 主要NPC: sd.主要NPC, 敌人: sd.敌人, $flags: sd.$flags }).slice(0, 20000);
        } catch (e) {}
        const prompt = [
          '【战斗数值裁定请求（生成前预计算）】',
          '玩家宣言：' + userText.slice(0, 300),
          '',
          '【状态快照】',
          snap,
          '',
          '请作为伊瑟利亚规则裁判，为本回合预计算数值。严格只回复 JSON（无围栏无解释）：',
          '{"checks":[{"name":"检定名","die":20,"roll":14,"mod":2,"total":16,"dc":12,"result":"成功"}],',
          ' "damages":[{"name":"伤害名","formula":"2d6+2","rolls":[4,2],"bonus":2,"total":9}],',
          ' "notes":"裁定说明或空"}',
          '骰子请用随机数模拟（真诚掷骰）。若无战斗数值需要预计算，返回 {"checks":[],"damages":[],"notes":"无数值"}。'
        ].join('\n');
        console.info('[Agent桥接] 战斗回合 → 请求 ZCode 预计算数值…');
        const text = await askAgentVia(prompt, '/api/preask', '/api/prepoll', 75000);
        const block = '【数值裁定·规则裁判预计算——检定结算与战斗数值必须严格采用以下结果，禁止自行改数或重掷】\n' + text;
        payload.chat.push({ role: 'system', content: block });
        console.info('[Agent桥接] 数值裁定已注入（' + text.length + ' 字）');
        if (window.toastr) toastr.success('⚖️ 数值裁定已注入本回合', 'Agent 桥接');
      } finally {
        pregenBusy = false;
      }
    } catch (e) {
      pregenBusy = false;
      console.warn('[Agent桥接] 生成前裁定降级放行（AI 自行计算）:', e && e.message ? e.message : e);
    }
  }

  async function askAgentVia(prompt, askPath, pollPath, timeoutMs) {
    const id = uniqId();
    const askRes = await fetch(SERVER + askPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: id, prompt: prompt }),
    });
    if (!askRes.ok) throw new Error('ask HTTP ' + askRes.status);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await fetch(SERVER + pollPath + '/' + encodeURIComponent(id));
      const json = await res.json();
      if (json && typeof json.text === 'string') return json.text;
      await new Promise(function (r) { setTimeout(r, 1500); });
    }
    throw new Error('等待 ZCode 裁定超时');
  }

  try { eventOn(tavern_events.CHAT_COMPLETION_PROMPT_READY, pregenHandler); } catch (e) { console.warn('[Agent桥接] 生成前裁定挂载失败', e); }

  // ---------- 手动接口 ----------

  window.__agentBridge = {
    get enabled() { return enabled; },
    setEnabled(v) {
      localStorage.setItem(ENABLE_KEY, v ? 'on' : 'off');
      toastr.info('Agent 桥接已' + (v ? '启用' : '停用'), '重新加载脚本后生效');
    },
    async auditNow() {
      const data = Mvu.getMvuData({ type: 'message', message_id: 'latest' });
      return audit(data, {});
    },
    get pregen() { return localStorage.getItem('iseria_agent_bridge_pregen') !== 'off'; },
    setPreGen(v) {
      localStorage.setItem('iseria_agent_bridge_pregen', v ? 'on' : 'off');
      toastr.info('生成前数值裁定已' + (v ? '启用' : '停用'), 'Agent 桥接');
    },
    async ping() {
      const r = await fetch(SERVER + '/api/pending');
      return await r.json();
    },
  };

  // ---------- 启动 ----------

  fetch(SERVER + '/api/pending', { method: 'GET' })
    .then(() => toastr.success('Agent 桥接已连接（事后数值审计）', 'Agent 桥接'))
    .catch(() => warn('本地 Agent 服务器未在线，桥接以降级模式待命（不影响游玩）'));
  log('已加载。手动审计：await window.__agentBridge.auditNow()');
});
