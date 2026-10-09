/**
 * 意图预判注入器（按需注入 · 解决「第一轮规则缺席」）
 *
 * 问题：[战斗回合协议][生产结算协议][国战回合协议][死亡与回溯规则] 等大条目靠
 *   「历史文本关键词」或「AI 写入的变量」触发——玩家第一次说「开打」的那一轮，
 *   关键词还没进历史、变量还没被 AI 写出，规则整体缺席，AI 凭记忆瞎打一轮。
 *
 * 方案：CHAT_COMPLETION_PROMPT_READY（世界书之后、请求发出前的最终时刻）扫描
 *   本轮用户消息 + 战斗快照状态，命中意图就把对应世界书条目内容 **当轮** push 进
 *   请求（该事件内 push 的消息直接进入本轮，酒馆助手官方事件管线支持异步等待）。
 *
 * 去重：以条目内容首行指纹扫描 payload——世界书关键词扫描已经注入过的（或常驻的）
 *   不重复注入；条目在世界书中被禁用也照样能由本脚本提供（getWorldbook 可读禁用条目）。
 * 骰值：战斗/检定/生产/国战/死亡任一命中时注入脚本预生成的【回合骰值表】，
 *   配合规则「禁止自编骰值」，根除 AI 自编骰值的作弊源。
 *
 * 防自触发：__ISURIA_NON_RP__（工具性 generateRaw）+ 类数据库审核员首包 + 无用户消息。
 */
(async function () {
  'use strict';

  const TAG = '[意图注入]';

  // 世界书名候选（卡内 extensions.world；逐个尝试直到命中）
  const WORLD_NAMES = ['伊瑟利亚3.7', '伊瑟利亚大陆3.7', '伊瑟利亚3.4', '伊瑟利亚大陆3.6', '伊瑟利亚'];

  // 意图 → 规则条目（entry=主条目；extra=伴随条目）
  const INTENT_RULES = {
    '战斗': {
      entry: '[战斗回合协议]',
      extra: '[NPC角色/敌人输出规则]',
      re: /(开打|打一架|干他|动手|攻击|进攻|突袭|偷袭|迎战|应战|战斗|交战|接战|遇袭|埋伏|拔剑|出刀|开枪|冲锋|斩击|劈砍|刺出|射击|放箭|杀了他|干掉他|围攻|战斗轮|切入战斗|进入战斗|反击|格挡|闪避|施放|咏唱|法术轰)/
    },
    '生产': {
      entry: '[生产结算协议]',
      re: /(生产|锻造|打造|制作|炼金|附魔|制药|调配|冶炼|加工|缝制|烹饪|酿造)/
    },
    '国战': {
      entry: '[国战回合协议]',
      re: /(会战|攻城|围城|突围|遭遇战|议和|国战|决战|开战|宣战|进军|总攻)/
    },
    '死亡': {
      entry: '[死亡与回溯规则]',
      re: /(死亡|濒死|死亡豁免|灵魂撕磨|回溯|丧命|阵亡|毙命|一命呜呼)/
    }
  };
  // 检定意图不注入：[判定规则] 为常驻条目，骰值由用户预设的 [骰子池] 宏提供

  let bookCache = null;
  async function loadBook() {
    if (bookCache) return bookCache;
    if (typeof getWorldbook !== 'function') return null;
    for (const nm of WORLD_NAMES) {
      try {
        const wb = await getWorldbook(nm);
        if (wb && wb.length) { bookCache = wb; return wb; }
      } catch (e) { /* 尝试下一个名字 */ }
    }
    console.warn(TAG + ' 未能加载世界书（候选：' + WORLD_NAMES.join('/') + '）');
    return null;
  }
  function findEntry(wb, name) {
    const e = wb.find(function (x) { return x.name === name; });
    return e && e.content ? String(e.content) : null;
  }
  // 条目首行指纹：世界书已注入同内容时跳过（支持世界书侧 enabled/disabled 任意状态）
  function fingerprint(content) {
    const lines = String(content || '').split('\n');
    for (const l of lines) { const t = l.trim(); if (t.length >= 6) return t.slice(0, 24); }
    return String(content || '').trim().slice(0, 24);
  }
  // 骰值生成已移除：用户预设的 [骰子池]（{{roll}} 宏）承担，避免重复
  function lastUserContent(chat) {
    for (var i = chat.length - 1; i >= 0; i--) {
      if (chat[i] && chat[i].role === 'user') return String(chat[i].content || '');
    }
    return '';
  }
  function chatHas(chat, needle) {
    for (var i = 0; i < chat.length; i++) {
      if (chat[i] && String(chat[i].content || '').indexOf(needle) !== -1) return true;
    }
    return false;
  }

  const init = async () => {
    await waitGlobalInitialized('Mvu');
    eventOn(tavern_events.CHAT_COMPLETION_PROMPT_READY, async function (payload) {
      try {
        // 防自触发 1：工具性生成（技能树/总结/类数据库分析等非剧情调用）
        if (typeof window !== 'undefined' && window.__ISURIA_NON_RP__) return;
        const chat = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.chat) ? payload.chat : null);
        if (!chat || !chat.length) return;
        // 防自触发 2：类数据库审核员的隔离分析调用（首 system 含特征词）
        const firstSys = String((chat[0] && chat[0].content) || '');
        if (firstSys.indexOf('行为一致性审核员') !== -1) return;
        const userText = lastUserContent(chat);
        if (!userText) return;

        // 战斗进行中视同战斗意图（战斗快照由战斗轮脚本维护）
        let battleActive = false;
        try {
          const all = (typeof getAllVariables === 'function') ? getAllVariables() : {};
          battleActive = !!(all && all.stat_data && all.stat_data.$flags && all.stat_data.$flags.战斗快照 && all.stat_data.$flags.战斗快照.active);
        } catch (e) {}

        const hits = [];
        for (const intent of Object.keys(INTENT_RULES)) {
          const cfg = INTENT_RULES[intent];
          if (intent === '战斗' && battleActive) { hits.push(intent); continue; }
          if (cfg.re.test(userText)) hits.push(intent);
        }
        // 检定意图不注入规则（[判定规则] 为常驻），仅战斗/生产/国战/死亡协议需要当轮补位
        if (!hits.length) return;

        const wb = await loadBook();
        if (!wb) return;
        const parts = [];
        for (const intent of hits) {
          const cfg = INTENT_RULES[intent];
          const main = cfg.entry ? findEntry(wb, cfg.entry) : null;
          if (!main) continue;
          const fp = fingerprint(main);
          if (chatHas(chat, fp)) continue;   // 世界书侧已注入（常驻/关键词命中），不重复
          let block = '【回合协议·' + intent + '·当轮生效】\n' + main;
          if (intent === '战斗' && cfg.extra) {
            const extra = findEntry(wb, cfg.extra);
            if (extra && !chatHas(chat, fingerprint(extra))) {
              block += '\n\n【回合协议·NPC与敌人输出·当轮生效】\n' + extra;
            }
          }
          parts.push(block);
        }
        // 骰值：由用户预设中的 [骰子池]（{{roll}} 宏）每轮随机注入，本脚本不再重复生成。
        if (!parts.length) return;
        chat.push({ role: 'system', content: parts.join('\n\n') });
        console.info(TAG + ' 本轮注入：' + hits.join('/'));
      } catch (e) {
        console.warn(TAG + ' 处理失败:', e);
      }
    });
    // 聊天切换后刷新世界书缓存（防改书后拿到旧内容）
    eventOn(tavern_events.CHAT_CHANGED, function () { bookCache = null; });
    console.log(TAG + ' 已加载（战斗/生产/国战/死亡意图当轮注入；骰值由预设骰子池承担）');
  };

  $(init);
})();
