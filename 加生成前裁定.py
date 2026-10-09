# -*- coding: utf-8 -*-
# 桥接脚本 v2：新增"生成前数值裁定"——战斗回合的提示词组装阶段向 ZCode 要数值，
# 裁定结果作为 system 消息注入，AI 正文必须采用（这是用户要的"并行合并成正文"）。
import io, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
p = 'scripts/桥接脚本.js'
s = io.open(p, encoding='utf-8').read()

BLOCK = """
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
        ].join('\\n');
        console.info('[Agent桥接] 战斗回合 → 请求 ZCode 预计算数值…');
        const text = await askAgentVia(prompt, '/api/preask', '/api/prepoll', 75000);
        const block = '【数值裁定·规则裁判预计算——检定结算与战斗数值必须严格采用以下结果，禁止自行改数或重掷】\\n' + text;
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
"""

anchor = "  // ---------- 手动接口 ----------"
assert anchor in s, '手动接口锚点未找到'
s = s.replace(anchor, BLOCK + '\n' + anchor, 1)

# 扩展 __agentBridge：pregen 开关
old = """    async ping() {
      const r = await fetch(SERVER + '/api/pending');
      return await r.json();"""
new = """    get pregen() { return localStorage.getItem('iseria_agent_bridge_pregen') !== 'off'; },
    setPreGen(v) {
      localStorage.setItem('iseria_agent_bridge_pregen', v ? 'on' : 'off');
      toastr.info('生成前数值裁定已' + (v ? '启用' : '停用'), 'Agent 桥接');
    },
    async ping() {
      const r = await fetch(SERVER + '/api/pending');
      return await r.json();"""
assert old in s, 'ping 锚点'
s = s.replace(old, new, 1)

io.open(p, 'wb').write(s.encode('utf-8'))
print('桥接脚本 v2：生成前数值裁定已加入')
