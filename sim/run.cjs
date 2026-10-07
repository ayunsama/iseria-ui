/* 伊瑟利亚 · 百楼模拟器 —— 主循环
 * 用法: node sim/run.cjs [楼数] [起始楼]
 * 每楼：装配上下文（真实世界书+历史）→ 写 sim/outbox/floor-N.prompt.txt
 *       → 轮询等待 sim/inbox/floor-N.reply.txt（由代答者写入）
 *       → 解析 <UpdateVariable><JSONPatch> → 真实管线应用 → 指标记录
 */
const fs = require('fs');
const path = require('path');
const yaml = require('C:/Users/Administrator/Desktop/编写模板/node_modules/yaml');
const _ = require('C:/Users/Administrator/Desktop/编写模板/node_modules/lodash');
const env = require('./env.cjs');
const mvu = require('./mvu.cjs');
const ejs = require('./ejs.cjs');
const behavior = require('./behavior.cjs');
const driver = require('./driver.cjs');

const SIM_DIR = __dirname;
const OUTBOX = path.join(SIM_DIR, 'outbox');
const INBOX = path.join(SIM_DIR, 'inbox');
const METRICS = path.join(SIM_DIR, 'metrics.jsonl');
const TOTAL_FLOORS = parseInt(process.argv[2], 10) || 10;
const START_FLOOR = parseInt(process.argv[3], 10) || 1;
const HISTORY_FLOORS = 8;      // 历史楼数
const VAR_HISTORY_FLOORS = 3;  // 最近N楼携带变量块（对齐卡内正则）
const SCAN_DEPTH = 4;          // 绿灯关键词扫描深度（近似全局设置）

fs.mkdirSync(OUTBOX, { recursive: true });
fs.mkdirSync(INBOX, { recursive: true });

// ---------- 初始变量 ----------
const STATE_FILE = path.join(SIM_DIR, 'state.json');
const CHATLOG_FILE = path.join(SIM_DIR, 'chatlog.json');
function loadInitialStat() {
  // 续跑优先：存在 state.json（上轮结束时的 stat_data 快照）则恢复，保证跨进程状态连续
  if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    console.log('[run] 已恢复上轮状态（state.json, ' + Buffer.byteLength(JSON.stringify(saved)) + 'B, 楼层' + (saved.世界 && saved.世界.日期 || '-') + '）');
    return saved;
  }
  const y = fs.readFileSync(path.join(__dirname, '../../yiseliya/dist/伊瑟利亚/初始变量'), 'utf8');
  const data = yaml.parse(y);
  return data;
}
function loadChatLog() {
  if (fs.existsSync(CHATLOG_FILE)) return JSON.parse(fs.readFileSync(CHATLOG_FILE, 'utf8'));
  return null;
}
function saveProgress() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(env.variables.chat));
  fs.writeFileSync(CHATLOG_FILE, JSON.stringify(env.chatLog));
}
function resetProgress() {
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  if (fs.existsSync(CHATLOG_FILE)) fs.unlinkSync(CHATLOG_FILE);
}

// ---------- 世界书装配 ----------
const wb = env.loadWorldbook();
function entryText(e) {
  if (/<%|%>/.test(e.content)) return ejs.renderEntry(e.content, env.variables.chat);
  return e.content;
}
function assembleWorldbook() {
  const stat = env.variables.chat;
  // 最近 SCAN_DEPTH 楼文本（绿灯扫描语料）
  const recent = env.chatLog.slice(-SCAN_DEPTH).map(m => m.message || '').join('\n');
  const parts = { before: [], after: [], depth: [] };
  for (const e of wb) {
    if (e.disable) continue;
    const isConst = !!e.constant;
    let hit = isConst;
    if (!hit && e.key && e.key.length) {
      hit = e.key.some(k => typeof k === 'string' && k.length > 1 && recent.includes(k));
    }
    if (!hit) continue;
    const prob = e.probability === undefined ? 100 : e.probability;
    if (prob < 100 && Math.random() * 100 > prob) continue;
    const text = entryText(e);
    if (!text || !text.trim()) continue;
    const pos = e.position === 0 ? 'before' : (e.position === 1 ? 'after' : 'depth');
    (parts[pos] || parts.after).push({ order: e.order || 100, uid: e.uid, comment: e.comment, text });
  }
  parts.before.sort((a, b) => a.order - b.order);
  parts.after.sort((a, b) => a.order - b.order);
  parts.depth.sort((a, b) => a.order - b.order);
  return parts;
}

// ---------- 上下文装配 ----------
function buildPrompt(userText) {
  const parts = assembleWorldbook();
  const sections = [];
  let wbChars = 0;
  const seen = new Set();
  function pushBlock(title, list) {
    for (const it of list) {
      if (seen.has(it.uid)) continue;
      seen.add(it.uid);
      sections.push('【' + (it.comment || '条目' + it.uid) + '】\n' + it.text);
      wbChars += (it.comment || '').length + it.text.length;
    }
  }
  pushBlock('before', parts.before);
  pushBlock('after', parts.after);
  pushBlock('depth', parts.depth);

  // 历史（最近 HISTORY_FLOORS 楼；assistant 只在最近 VAR_HISTORY_FLOORS 楼带变量块）
  const history = [];
  const total = env.chatLog.length;
  env.chatLog.forEach((m, i) => {
    const floorsAgo = total - i;   // 1=最新
    let text = m.message || '';
    if (m.role === 'assistant' && floorsAgo > VAR_HISTORY_FLOORS) {
      text = text.replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/g, '').trim();
    }
    history.push({ role: m.role === 'system' ? 'system' : m.role, content: text });
  });
  const hist = history.slice(-HISTORY_FLOORS);
  // 注入（变量注入脚本产出的 position!=none 注入）
  const inj = env.injections.filter(p => p.position !== 'none' && p.content).map(p => ({ role: p.role || 'system', content: p.content }));
  env.injections.length = 0;

  const messages = [];
  messages.push({ role: 'system', content: sections.join('\n\n') });
  for (const m of inj) messages.push(m);
  for (const m of hist) messages.push(m);
  messages.push({ role: 'user', content: userText });
  let histChars = 0;
  for (const m of messages) histChars += (m.content || '').length;
  return { messages, wbChars, histChars };
}

// ---------- 指标 ----------
function statMetrics() {
  const s = env.variables.chat;
  const count = o => (o && typeof o === 'object' ? Object.keys(o).length : 0);
  return {
    statBytes: Buffer.byteLength(JSON.stringify(s)),
    追踪记录: count(s.世界 && s.世界.追踪记录),
    动态新闻: count(s.世界 && s.世界.世界见闻 && s.世界.世界见闻.动态新闻),
    主要NPC: count(s.主要NPC),
    同伴: count(s.同伴),
    家族成员: count(s.家族 && s.家族.成员),
    产业: count(s.产业),
    物品栏: count(s.主角 && s.主角.资产与能力 && s.主角.资产与能力.物品栏),
    任务: count(s.主角 && s.主角.任务),
    培养记录总数: (function () {
      let n = 0; const mem = s.家族 && s.家族.成员 || {};
      for (const k in mem) n += ((mem[k].培养记录 || []).length);
      return n;
    })()
  };
}
function conflictChecks() {
  const s = env.variables.chat;
  const out = [];
  // 货币 vs 流水最后余额
  const track = s.世界 && s.世界.追踪记录 || {};
  let lastBalance = null;
  for (const k of Object.keys(track)) {
    const e = track[k];
    if (e && e.类型 !== '经验获取' && typeof e.余额 === 'number' && e.余额 >= 0) lastBalance = e.余额;
  }
  const money = s.主角 && s.主角.资产与能力 && s.主角.资产与能力.货币;
  if (lastBalance !== null && money !== lastBalance) out.push('货币(' + money + ')≠流水末余额(' + lastBalance + ')');
  // 总等级 vs Σ职业+待分配
  const jobs = s.主角 && s.主角.基础状态 && s.主角.基础状态.职业信息 || {};
  let sum = 0; for (const j in jobs) sum += (jobs[j].等级 || 0);
  sum += (s.主角.基础状态.待分配职业等级 || 0);
  const total = s.主角.基础状态.总等级;
  if (sum !== total) out.push('总等级(' + total + ')≠Σ职业(' + sum + ')');
  // 升级所需 vs 公式
  const n = Math.max(1, total || 1);
  const expectReq = 200 + 60 * (n - 1) + 18 * (n - 1) ** 2 + 6 * (n - 1) ** 3;
  const req = s.主角.基础状态.经验值.升级所需;
  if (req !== expectReq) out.push('升级所需(' + req + ')≠公式(' + expectReq + ')');
  return out;
}

// ---------- 等待代答 ----------
function waitReply(floor, timeoutMs) {
  const f = path.join(INBOX, 'floor-' + floor + '.reply.txt');
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      if (fs.existsSync(f)) {
        const t = fs.readFileSync(f, 'utf8');
        try { fs.unlinkSync(f); } catch (e) {}
        resolve(t);
        return;
      }
      if (Date.now() - start > timeoutMs) { reject(new Error('等待回复超时: floor-' + floor)); return; }
      setTimeout(poll, 2000);
    })();
  });
}

// ---------- 主循环 ----------
(async () => {
  // --reset 参数：清空持久化状态从头开始
  if (process.argv.includes('--reset')) { resetProgress(); console.log('[run] 已清空持久化状态'); }
  const savedLog = loadChatLog();
  if (savedLog) env.chatLog.push(...savedLog);
  const initial = loadInitialStat();
  env.initEnv(initial);
  // 捕获变量结构脚本注册的 zod schema（env 在加载脚本前已挂全局 registerMvuSchema）
  mvu.registerMvuSchema(env.getRegisteredSchema());
  if (env.getRegisteredSchema()) console.log('[run] schema 已捕获（zod 校验启用）');
  else console.log('[run] ⚠ schema 未捕获（zod 校验停用）');
  env.setApplier({
    extractCommands: msg => mvu.extractCommands(msg),
    applyCommands: (stat, cmds) => mvu.applyCommands(stat, cmds),
    parseMessageToData: (msg, stat) => mvu.parseMessageToData(msg, stat)
  });

  // 等脚本 $(init) 异步注册完成
  await new Promise(r => setTimeout(r, 300));
  // 触发 CHAT_CHANGED（紧张度/结构脚本监听）
  await env.eventEmit('CHAT_CHANGED', 0);

  const metrics = [];
  const endFloor = Math.min(START_FLOOR + TOTAL_FLOORS - 1, behavior.length);
  for (let floor = START_FLOOR; floor <= endFloor; floor++) {
    const action = behavior[floor - 1];
    if (!action) { console.log('行为表已用尽'); break; }

    if (action.text.startsWith('（玩家UI操作）')) {
      // UI 操作：直接改变量（走真实管线，让记账/结算同步）
      const before = env.getAllVariables().stat_data;
      const stat = env.variables.chat;
      applyUiAction(stat, action.text);
      await env.Mvu.__driveUpdate(stat, before, '');
      saveProgress();
      const m = statMetrics();
      metrics.push({ floor, kind: 'ui', action: action.text.slice(0, 30), ...m, conflicts: conflictChecks(), warnings: env.collected.scriptWarnings.splice(0) });
      console.log('[UI楼 ' + floor + '] 已应用，stat=' + m.statBytes + 'B');
      continue;
    }

    // 正常楼：装配 → 自动（LLM）或 出箱手动代答
    const { messages, wbChars, histChars } = buildPrompt(action.text);
    let ctxChars = wbChars + histChars;
    const AUTO = process.argv.includes('--auto');
    const promptText = '=== 本楼编号: ' + floor + ' ===\n'
      + '=== 你是「伊瑟利亚大陆」的AI主持者。以下是系统上下文与对话历史，请输出正文叙事，并在文末按 <UpdateVariable><Analysis>…</Analysis><JSONPatch>[…]</JSONPatch></UpdateVariable> 输出变量更新。 ===\n\n'
      + messages.map(m => '[' + m.role + ']\n' + m.content).join('\n\n');
    fs.writeFileSync(path.join(OUTBOX, 'floor-' + floor + '.prompt.txt'), promptText);
    console.log('[楼 ' + floor + '] 提示词就绪 (' + ctxChars + '字 ≈' + Math.round(ctxChars / 2.2) + 'tok)' + (AUTO ? '，LLM自动生成…' : '，等待代答…'));

    let reply, usage = null;
    if (AUTO) {
      // 额外变量更新API对齐：正文调用 = 世界书+历史+用户行为；变量更新指令随正文同源
      // 记录正文输入token（真实游玩中这部分走正文API）与 UpdateVariable 块负载（真实游玩中走额外变量API）
      try {
        const r = await driver.chat(messages, { temperature: 0.9 });
        reply = r.content;
        usage = r.usage;
      } catch (e) {
        console.error('[楼 ' + floor + '] LLM失败: ' + e.message);
        fs.appendFileSync(path.join(SIM_DIR, 'failed-floors.txt'), floor + '\n');
        break;
      }
    } else {
      try { reply = await waitReply(floor, 15 * 60 * 1000); } catch (e) { console.error(e.message); break; }
    }
    const replyChars = reply.length;
    // 变量块单独折算（真实游玩：额外变量更新API的输入=整份上下文，输出=UpdateVariable块）
    const uvMatch = reply.match(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/);
    const uvChars = uvMatch ? uvMatch[0].length : 0;
    env.chatLog.push({ role: 'user', message: action.text });
    env.chatLog.push({ role: 'assistant', message: reply });
    env.variables.message[floor] = null; // 占位，随后被真实快照覆盖

    // 真实更新管线
    const beforeStat = env.getAllVariables().stat_data;
    const stat = env.variables.chat;   // chat 级即实时状态（原地改）
    const result = await env.Mvu.__driveUpdate(stat, beforeStat, reply);
    env.variables.message[floor] = _.cloneDeep(stat);

    const m = statMetrics();
    const conflicts = conflictChecks();
    const rec = {
      floor, kind: AUTO ? 'llm-auto' : 'llm-manual', action: action.text.slice(0, 30),
      wbChars, histChars, ctxChars, replyChars,
      ctxTokens: Math.round(ctxChars / 2.2), replyTokens: Math.round(replyChars / 2.2),
      apiUsage: usage,   // 真实端点用量（正文API）
      varApiLoad: uvChars ? { inputTokens: Math.round(ctxChars / 2.2), outputChars: uvChars } : null,   // 额外变量API折算负载
      patchApplied: result.applied.length, patchDropped: result.dropped.length,
      zodErrors: result.errors,
      ...m, conflicts,
      warnings: env.collected.scriptWarnings.splice(0),
      injPromptChars: (env.injections || []).length
    };
    metrics.push(rec);
    fs.appendFileSync(METRICS, JSON.stringify(rec) + '\n');
    saveProgress();   // 每楼持久化：进程中断/续跑时状态连续
    console.log('[楼 ' + floor + '] 回复' + replyChars + '字 | 补丁 ' + result.applied.length + ' 应/' + result.dropped.length + ' 弃 | stat=' + m.statBytes + 'B | 流水' + m.追踪记录 + ' | 冲突' + conflicts.length + (conflicts.length ? ' ⚠ ' + conflicts.join('; ') : ''));
  }

  // 汇总
  fs.writeFileSync(path.join(SIM_DIR, 'metrics.json'), JSON.stringify(metrics, null, 1));
  console.log('\n===== 运行结束：' + metrics.length + ' 楼，指标已写 metrics.json / metrics.jsonl =====');
})().catch(e => { console.error('模拟器异常:', e); process.exit(1); });

// UI 操作（简化实现：按文本关键词直接改变量，模拟状态栏行为）
function applyUiAction(stat, text) {
  stat.家族 = stat.家族 || { 谱系说明: '', 成员: {} };
  stat.家族.成员 = stat.家族.成员 || {};
  if (text.includes('父母在家族谱系中建档')) {
    if (!stat.家族.成员['老杰克']) stat.家族.成员['老杰克'] = {
      称谓: '父亲', 世代: '父母辈', 性别: '男', 种族: '人类', 出生年月日: '圣光历1455年7月20日',
      存亡: '在世', 所在地: '石桥镇', 身份: '退役老兵/铁匠铺老板', 好感度: 65,
      资质: { 等级: '平庸', 描述: '', 经验获取效率: 100 }, 魔力回路: { 品阶: '无回路', 描述: '' }, 等阶: '普通',
      基础属性: { 力量: 13, 敏捷: 9, 体质: 12, 智力: 10, 感知: 11, 魅力: 10, 未分配点数: 0 },
      技能: {}, 培养计划: { 方向: '', 期望职业: '', 每期投入: 0, 成长进度: 0, 上次结算: '', 说明: '' }, 培养记录: [], 描述: '沉默寡言，左腿有旧伤。'
    };
    if (!stat.家族.成员['玛莎']) stat.家族.成员['玛莎'] = {
      称谓: '母亲', 世代: '父母辈', 性别: '女', 种族: '人类', 出生年月日: '圣光历1458年3月14日',
      存亡: '在世', 所在地: '石桥镇', 身份: '家庭主妇', 好感度: 72,
      资质: { 等级: '平庸', 描述: '', 经验获取效率: 100 }, 魔力回路: { 品阶: '无回路', 描述: '' }, 等阶: '普通',
      基础属性: { 力量: 9, 敏捷: 10, 体质: 10, 智力: 11, 感知: 12, 魅力: 13, 未分配点数: 0 },
      技能: {}, 培养计划: { 方向: '', 期望职业: '', 每期投入: 0, 成长进度: 0, 上次结算: '', 说明: '' }, 培养记录: [], 描述: '总担心主角吃不饱。'
    };
  }
  if (text.includes('培养计划') && stat.家族.成员['艾莉丝']) {
    stat.家族.成员['艾莉丝'].培养计划 = { 方向: '魔法', 期望职业: '咒印师', 每期投入: 2000, 成长进度: 0, 上次结算: '', 说明: '启蒙教育' };
  }
}
