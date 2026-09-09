/**
 * 紧张度托管脚本（世界局势自动结算）
 *
 * ★ 本版已移除「实时推演」与旧《动态剧情》体系（动态剧情·X期条目已删除，世界态势由「纪元触发器」输出），
 *   只保留「世界动态」：新闻 → 紧张度结算 + 新闻注入 + 羊皮纸窗口展示。
 *   当地事件预告职责已移交「剧情规划大师/推进」（避免功能重合）。
 *
 * ★ 现行功能：
 *   1. 贡献分解（窗口）：当前值 = 基线 + 世界级/大陆级/区域级（封顶±15）+ 每条新闻影响徽章（↑+N/↓N/已落幕）
 *   2. 阶段进度标记：注入与窗口显示"本阶段已发生 N 起已结算事件"
 *   3. 玩家行为→世界回响（方案四）：监听最新正文，规则匹配重大行为（讨伐强敌/刺杀要人/背叛/攻破城塞等）
 *      → 自动生成余波新闻写入 动态新闻 → 进结算体系（防重复：楼层指针）
 *   4. 世界大事记（方案五）：有影响的新闻自动记入 $flags.紧张度大事记（最近 60 条），窗口时间线展示
 *   5. 战斗联动（方案五）：注入「战斗环境」行——紧张度等级影响野外遭遇强度描述，AI 叙事体现
 *
 * 数据模型：stat_data.{世界.世界见闻.动态新闻, $flags.紧张度}
 *   紧张度 = { 当前值, 等级, 上次触发事件 }（脚本托管字段，$ 前缀 → AI 不可见不可写）
 *   $flags.紧张度基线：脚本首次运行时的紧张度快照（初始变量通常为 35）
 *   $flags.紧张度已结算新闻：{ [新闻标题]: 影响值 }，记录该新闻已用于结算（防重复叠加）
 *   $flags.紧张度大事记：[{ 日期, 标题, 影响 }]（方案五）
 *
 * 设计范式（对齐「自动升级脚本」的正确写法）：
 *   1. 挂载 Mvu.events.VARIABLE_UPDATE_ENDED，框架直接给 (当前, 变更前) 全量快照
 *   2. 只原地修改 stat_data，不自行 getVariables / replaceVariables / updateVariablesWith
 *   3. 防重入锁，避免脚本改动再次触发本事件导致死循环
 *   4. 不使用 registerVariableSchema —— 错误层级的 schema 会把 stat_data 塌成 true
 *   5. 结构初始化交给「初始变量」，脚本只做增量守卫
 *
 * 【核心：为什么 AI 不能直接改紧张度】
 *   紧张度位于 $flags.紧张度（$ 前缀字段）——AI 上下文完全不可见，因此 AI 无法输出针对它的任何更新命令。
 *   脚本只把「世界见闻.动态新闻」作为唯一输入源，用「期望值=基线+Σ(已结算新闻影响值)」重算并覆盖当前值，
 *   彻底杜绝「遇怪 +、遇危机 +」式的随意抬升。
 *
 * 【新闻 → 紧张度 结算规则】
 *   - 影响基准 = 重要性 × 影响范围（新闻可带「影响范围: 世界/大陆/区域/局部」，未标注默认大陆）：
 *       · 世界级（魔王降世/灭国之战/全大陆战争）：极高 ±18 / 高 ±10
 *       · 大陆级（默认）：极高 ±12 / 高 ±8
 *       · 区域性（王国内战/边境冲突）：极高 ±5 / 高 ±3 —— 区域性事件永远不该把"全球"紧张度顶到决战期
 *       · 局部：0（局部遭遇、遇怪、小队危机、日常战斗一律不算）
 *   - 内容关键词决定方向：大事件关键词（宣战/入侵/魔潮/政变/灾变/降世/传说死亡失踪/集结/冲突…）→ 增加
 *     缓和关键词（停火/和平/谈判/结盟/平息/撤军/胜利/治愈/拯救…）→ 降低
 *   - 关键词方向按命中数比较：缓解命中 > 大事件命中 → 取负；否则取正；都不命中 → 0
 *   - 误判修正（否定/化解词）：
 *       · 失败词（破裂/失败/告吹/中断/终止/未遂…）——缓和被否定 → 该条不按缓和计；大事件未遂 → 不结算
 *       · 加剧词（加剧/升级/恶化/蔓延…）——坏事升级 → 强制按上升计
 *       · 化解词（平息/镇压/击退/阻止/化解/解围…）——大事件被化解 → 按缓和计（如"叛乱被镇压"）
 *   - 区域影响封顶：所有「区域」级已结算影响合计 clamp 在 ±15（区域性冲突再多，全球紧张度也只小幅波动）
 *   - 紧张度回落：新闻被标记「是否过期: 是」或从 动态新闻 删除后，其影响自动从期望值移除（事件结束 → 回落）
 *   - 已结算表上限保护：超过 500 条时优先删除影响为 0 的记录
 *
 * 【DLC·终焉纪元（IF线）反转】
 *   - 检测聊天变量「终焉纪元IF线」（与战斗结算前端一致），为真时紧张度实为"压迫指数"
 *     （100=教廷完全统治 → 0=魔王陨落），结算方向自动反转（击败统领/解放/起义/各族觉醒 → 压迫降低）。
 */
(function () {
  'use strict';

  let isProcessing = false;

  // 紧张度等级对照（与变量更新规则一致）
  function tensionLevelOf(v) {
    v = Math.max(0, Math.min(100, Math.round(Number(v) || 35)));
    if (v <= 20) return '平静期';
    if (v <= 40) return '暗流期';
    if (v <= 60) return '动荡期';
    if (v <= 80) return '危机期';
    return '决战期';
  }

  // ── 大事件关键词（提升紧张度 / 压迫指数） ──
  const RISE_WORDS = [
    '宣战', '入侵', '进攻', '开战', '战争', '战火', '魔潮', '暴动', '政变', '王选', '崩坏',
    '灾变', '降世', '前兆', '觉醒', '传说死亡', '传说失踪', '失踪', '集结', '冲突', '危机',
    '崩溃', '封锁', '围困', '袭击', '爆发', '屠杀', '叛乱', '异动', '扩张', '异常', '逼近',
    '压境', '挑衅', '摩擦', '警戒', '动员', '征兵', '沦陷', '内乱', '分裂', '决裂', '备战',
    '暗杀', '血洗', '清洗', '处决', '暴乱', '起义', '示威', '罢工', '反叛', '叛逃', '决斗',
    '围城', '攻城', '灭国', '瘟疫', '旱灾', '饥荒', '海啸', '地震', '魔力紊乱'
  ];
  // ── 缓和关键词（降低紧张度 / 压迫指数） ──
  const FALL_WORDS = [
    '停火', '和平', '谈判', '和解', '结盟', '停战', '撤军', '胜利', '治愈', '拯救', '平息',
    '平定', '解放', '复国', '恢复', '签订', '协议', '退兵', '缓解', '罢战', '休战', '和谈',
    '归顺', '驱逐', '剿灭', '消灭', '化解', '庆功', '投降', '招安', '通商', '建交', '援助',
    '救济', '重建', '镇压成功', '击退', '挽回', '缓和', '和约', '停战协议', '和平协议',
    '大赦', '休养生息', '罢兵', '偃旗息鼓'
  ];

  // ── 失败/未遂词（好事的否定：缓和失败 → 不按缓和计；大事件未遂 → 不结算） ──
  const FAIL_WORDS = [
    '破裂', '失败', '告吹', '中断', '终止', '取消', '无效', '流产', '违约', '撕毁',
    '作废', '搁浅', '反悔', '泡汤', '夭折', '未遂', '溃散', '受挫', '破产'
  ];
  // ── 恶化/加剧词（坏事升级 → 强制按上升计） ──
  const RAMP_WORDS = [
    '加剧', '升级', '恶化', '扩大', '蔓延', '失控', '愈演愈烈', '白热化', '沸反盈天'
  ];
  // ── 化解/压制词（大事件被化解 → 按缓和计） ──
  const RESOLVE_WORDS = [
    '平息', '平定', '化解', '击退', '驱逐', '镇压', '剿灭', '歼灭', '解救', '解除',
    '阻止', '制止', '避免', '挫败', '粉碎', '瓦解', '覆灭', '投降', '收复', '破获',
    '肃清', '解围', '救出', '压制', '驱散', '破除', '终结', '收编'
  ];

  // ── IF线（压迫指数）专用关键词 ──
  // 压迫指数：100=教廷完全统治 → 0=魔王陨落。
  // 反抗/教廷受挫（击败统领/解放/复国/起义/各族觉醒…）→ 压迫降低（对玩家有利）；
  // 教廷镇压/扩张（镇压成功/处决/血洗/围剿…）→ 压迫升高（教廷统治加强）。
  const IF_FALL_WORDS = [
    '击败', '斩杀', '推翻', '瓦解', '起义', '反抗', '解放', '复国', '觉醒', '罢工', '暴动',
    '反叛', '叛逃', '暗杀', '击溃', '击退', '驱逐', '收复', '突入', '攻破', '倒戈', '兵变',
    '叛变', '废除', '粉碎', '覆灭', '星辉复兴', '剪断锁链', '神谕', '自由', '解放区', '起义军'
  ];
  const IF_RISE_WORDS = [
    '镇压', '处决', '血洗', '清洗', '逮捕', '屠戮', '扩张', '吞并', '奴役', '封锁', '围剿',
    '戒严', '铁腕', '灭族', '屠杀', '掌控', '增援', '出兵', '入侵', '进攻', '强征', '搜捕',
    '拷问', '灭口', '神权独裁', '铁幕', '统治核心', '教廷大军'
  ];

  function countHits(text, words) {
    let n = 0;
    for (const w of words) if (text.indexOf(w) !== -1) n++;
    return n;
  }

  // 影响范围基准：世界/大陆/区域/局部（未标注默认大陆）
  //  —— 王国内战这类区域性事件永远不该把"全球"紧张度顶到决战期
  function scopeBase(importance, scope) {
    if (scope === '局部') return 0;            // 局部：不影响全局
    const hi = importance === '极高';
    const md = importance === '高';
    if (!hi && !md) return 0;                  // 普通/低：局部事件不影响
    if (scope === '世界') return hi ? 18 : 10;  // 世界级（魔王降世/灭国之战）
    if (scope === '区域') return hi ? 5 : 3;   // 区域性（王国内战/边境冲突）
    return hi ? 12 : 8;                        // 大陆级（默认）
  }
  function normalizeScope(s) {
    if (s === '世界' || s === '区域' || s === '局部') return s;
    return '大陆';
  }
  // 已结算记录取值（兼容旧档：数字 → 视为 {v:数, s:'大陆'}）
  function settledValue(rec) {
    return (typeof rec === 'number') ? rec : (rec && typeof rec.v === 'number' ? rec.v : 0);
  }

  // 计算单条新闻的紧张度影响值（正=增加，负=降低，0=不改变）
  function computeNewsImpact(title, content, importance, scope, ifLine) {
    // 影响基准 = 重要性 × 影响范围（极高/高 才影响世界紧张度）
    const base = scopeBase(importance, scope);
    if (base === 0) return 0;

    const text = String(title || '') + ' ' + String(content || '');
    const fail = countHits(text, FAIL_WORDS);    // 好事失败/未遂
    const ramp = countHits(text, RAMP_WORDS);    // 坏事加剧
    const resolve = countHits(text, RESOLVE_WORDS); // 坏事被化解

    // IF线（压迫指数）独立判定：反抗→压迫降，镇压→压迫升
    if (ifLine) {
      const fall = countHits(text, IF_FALL_WORDS);
      const rise = countHits(text, IF_RISE_WORDS);
      if (fall === 0 && rise === 0) return 0;
      // IF线化解词：排除与 IF_RISE 重叠的词（如"镇压"），避免同词既算升又算化解
      const resolveIf = countHits(text, RESOLVE_WORDS.filter(w => IF_RISE_WORDS.indexOf(w) === -1));
      // 反抗失败/加剧（起义被镇压/反抗失败）→ 压迫升
      if (fall > 0 && (fail > 0 || ramp > 0)) return base;
      // 教廷手段被化解（围剿被粉碎/戒严被解除）→ 压迫降
      if (rise > 0 && resolveIf > 0) return -base;
      // 反抗与镇压同现 → 镇压优先（起义被镇压 → 压迫升）
      if (fall > 0 && rise > 0) return rise >= fall ? base : -base;
      return fall >= rise ? -base : base;
    }

    // 普通世界：大事件→紧张升，缓和→紧张降
    const rise = countHits(text, RISE_WORDS);
    let fall = countHits(text, FALL_WORDS);
    // 没有任何关键词命中 → 不结算（避免普通事件被误判抬升）
    if (rise === 0 && fall === 0) return 0;
    // ① 缓和被否定/被升级打断（谈判破裂/停火失败/冲突升级）→ 缓和作废
    if (fall > 0 && (fail > 0 || ramp > 0)) fall = 0;
    // ② 坏事加剧 → 强制上升（战争升级/冲突加剧）
    if (rise > 0 && ramp > 0) return base;
    // ③ 大事件被化解（叛乱被镇压/魔潮被击退/宣战被阻止）→ 按缓和计
    if (rise > 0 && fall === 0 && resolve > 0) return -base;
    // ④ 大事件未遂（入侵失败/政变未遂）→ 方向不明，不结算
    if (rise > 0 && fall === 0 && fail > 0) return 0;
    // ⑤ 坏事件被化解且同为缓和（平息叛乱/魔潮被击退）→ 缓和优先
    if (rise > 0 && fall > 0 && resolve > 0) return -base;
    // ⑥ 事件并行且方向冲突 → 保守取升
    if (rise > 0 && fall > 0) return base;
    if (rise === 0 && fall === 0) return 0;
    return rise >= fall ? base : -base;
  }

  // 清理已结算表：新闻从 动态新闻 删除 → 移除其影响（事件结束，紧张度回落）；
  // 并做上限保护（优先删 0 影响记录）。不再"非零影响永久保留"——否则紧张度只升不降。
  function cleanupSettled(newsMap, settled) {
    // 1) 孤儿清理：新闻已从 动态新闻 删除 → 移除其影响（紧张度回落）
    for (const title in settled) {
      if (!Object.prototype.hasOwnProperty.call(newsMap, title)) delete settled[title];
    }
    // 2) 上限保护：超过 500 条时优先删除影响为 0 的旧记录
    let count = Object.keys(settled).length;
    if (count > 500) {
      for (const title in settled) {
        if (count <= 500) break;
        if (settledValue(settled[title]) === 0) { delete settled[title]; count--; }
      }
    }
  }

  // 判断当前是否处于终焉纪元 IF 线（压迫指数模式）
  function isIfLine() {
    try {
      const chatVars = getVariables({ type: 'chat' });
      return !!(chatVars && chatVars['终焉纪元IF线']);
    } catch (e) {
      return false;
    }
  }

  // ---- 主处理：挂在 VARIABLE_UPDATE_ENDED 上，原地改 stat_data ----
  function handleTension(rawVariables) {
    if (isProcessing) { console.log('[紧张度] 防重入拦截'); return; }
    isProcessing = true;
    try {
      const statData = rawVariables?.stat_data;
      if (!statData) return;
      if (!statData.世界) return;
      const world = statData.世界;

      // 紧张度位于 $flags.紧张度（$前缀：AI 不可见，脚本/前端可读写）
      if (!statData.$flags) statData.$flags = {};
      const flags = statData.$flags;

      // ⚠️ 旧档兼容迁移（一次性）：旧聊天存档的紧张度在 世界.紧张度（AI 可见），
      // 首次变量更新时自动迁入 $flags.紧张度（AI 不可见），并删除旧字段。
      // 之后 AI 上下文不再有紧张度，无从修改。
      const legacy = world.紧张度;
      if (legacy && typeof legacy === 'object' && !flags.紧张度) {
        flags.紧张度 = {
          当前值: (typeof legacy.当前值 === 'number' && !Number.isNaN(legacy.当前值)) ? legacy.当前值 : 35,
          等级: (typeof legacy.等级 === 'string' && legacy.等级) ? legacy.等级 : '暗流期',
          上次触发事件: (typeof legacy.上次触发事件 === 'string') ? legacy.上次触发事件 : ''
        };
        delete world.紧张度;
        console.log(`[紧张度] 已迁移旧档 世界.紧张度 → $flags.紧张度（当前值=${flags.紧张度.当前值}）`);
      }

      const tension = flags.紧张度 || (flags.紧张度 = {});
      if (typeof tension.当前值 !== 'number' || Number.isNaN(tension.当前值)) tension.当前值 = 35;

      // 追踪字段
      if (typeof flags.紧张度基线 !== 'number') flags.紧张度基线 = tension.当前值;
      if (!flags.紧张度已结算新闻 || typeof flags.紧张度已结算新闻 !== 'object') flags.紧张度已结算新闻 = {};

      const newsMap = (world.世界见闻 && world.世界见闻.动态新闻) || {};
      const settled = flags.紧张度已结算新闻;
      const ifLine = isIfLine();

      // 1) 结算尚未结算的新闻；已过期新闻从已结算表移除（事件结束 → 紧张度回落）
      for (const title in newsMap) {
        const news = newsMap[title] || {};
        if (news.是否过期 === '是') {
          if (Object.prototype.hasOwnProperty.call(settled, title)) {
            delete settled[title];
            console.log(`[紧张度] 新闻「${title}」已过期，其影响已移除（紧张度回落）`);
          }
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(settled, title)) continue;
        const scope = normalizeScope(news.影响范围);
        const impact = computeNewsImpact(title, news.内容, news.重要性, scope, ifLine);
        settled[title] = { v: impact, s: scope };
        if (impact !== 0) {
          console.log(`[紧张度] 新闻「${title}」结算影响 ${impact > 0 ? '+' : ''}${impact}（范围：${scope}）${ifLine ? '（IF线反转）' : ''}`);
          // 方案五：世界大事记（只记录有实际影响的新闻）
          if (!flags.紧张度大事记 || !Array.isArray(flags.紧张度大事记)) flags.紧张度大事记 = [];
          flags.紧张度大事记.push({ 日期: news.日期 || '', 标题: title, 影响: impact });
          if (flags.紧张度大事记.length > 60) flags.紧张度大事记 = flags.紧张度大事记.slice(-60);
        }
      }

      // 1.5) 清理已结算表（已删除新闻移除影响 + 上限保护）
      cleanupSettled(newsMap, settled);

      // 2) 期望值 = 基线 + Σ(影响)，按范围分组 + 区域影响封顶，clamp 0~100 并覆盖（防 AI 直接改）
      let worldDelta = 0, contDelta = 0, regDelta = 0;
      for (const title in settled) {
        const rec = settled[title];
        const v = settledValue(rec);
        const s = (rec && typeof rec === 'object' && rec.s) ? rec.s : '大陆';
        if (s === '世界') worldDelta += v;
        else if (s === '区域') regDelta += v;
        else contDelta += v;
      }
      // 区域影响封顶：区域性事件再多，全球紧张度也只波动 ±15（王国内战 ≠ 全球决战）
      regDelta = Math.max(-15, Math.min(15, regDelta));
      let expect = flags.紧张度基线 + worldDelta + contDelta + regDelta;
      expect = Math.max(0, Math.min(100, Math.round(expect)));

      const oldVal = tension.当前值;
      if (oldVal !== expect) {
        tension.当前值 = expect;
        console.log(`[紧张度] ${oldVal} → ${expect}（基线 ${flags.紧张度基线} + 新闻结算）`);
      }
      tension.等级 = tensionLevelOf(tension.当前值);

      // 3) 上次触发事件 = 最近一条有非零影响、未过期的新闻
      let lastEvent = '';
      let lastDate = '';
      for (const title in newsMap) {
        const impact = settledValue(settled[title]);
        if (impact === 0) continue;
        const news = newsMap[title] || {};
        if (news.是否过期 === '是') continue;
        const date = String(news.日期 || '');
        if (date >= lastDate) { lastDate = date; lastEvent = title; }
      }
      if (lastEvent) tension.上次触发事件 = lastEvent;
    } catch (e) {
      console.error('[紧张度] 出错:', e);
      if (typeof toastr !== 'undefined') toastr.error('紧张度托管脚本出错: ' + e.message);
    } finally {
      isProcessing = false;
    }
  }

  // ---- 事件注册 ----
  const init = async () => {
    await waitGlobalInitialized('Mvu');
    eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, handleTension);
    // 正文注入：世界动态 → AI 上下文（开关存 localStorage）
    loadInjectSettings();
    registerWorldInjection();
    // ★ 分工（v2）：不再预取旧《动态剧情》缓存（世界态势由「纪元触发器」输出）
    // 方案四：玩家行为 → 世界回响（每次生成结束后检查最新正文）
    try {
      const echoEvent = (window.tavern_events && (window.tavern_events.GENERATION_ENDED || window.tavern_events.MESSAGE_RECEIVED)) || null;
      if (echoEvent) eventOn(echoEvent, () => setTimeout(checkEchoFromLatestFloor, 2000));
      setTimeout(checkEchoFromLatestFloor, 4000); // 初始检查一次
    } catch (e) { console.warn('[紧张度] 回响监听注册失败:', e); }
    // 脚本按钮：点击打开羊皮纸世界动态窗口
    try {
      const btns = getScriptButtons();
      if (!btns.some(b => b.name === '🗞️ 世界动态')) {
        btns.push({ name: '🗞️ 世界动态', visible: true });
        replaceScriptButtons(btns);
      }
      eventOn(getButtonEvent('🗞️ 世界动态'), openTensionWindow);
    } catch (e) {
      console.warn('[紧张度] 注册世界动态按钮失败:', e);
    }
    console.log('[紧张度托管脚本] 已加载（动态新闻驱动 · 基线重算覆盖 · IF线反转 · 羊皮纸窗口）');
    if (typeof toastr !== 'undefined') toastr.success('[紧张度托管脚本] 已加载');
  };

  // ============================================================
  // 世界动态 → 正文叙事注入（让 AI 在正文中体现当前局势；可开关）
  // ============================================================
  const INJECT_KEY = 'isuria_tension_inject';
  const INJECT_DEPTH_KEY = 'isuria_tension_inject_depth';
  let injectToContext = true;
  let cachedDyn = '';
  // 注入深度：从消息末尾倒数第 N 条之前插入（默认 4，存 localStorage 可调）
  let injectDepth = 4;

  function loadInjectSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(INJECT_KEY) || 'null');
      if (s && typeof s === 'object') {
        injectToContext = s.injectToContext !== false;
      }
    } catch (e) {}
    try {
      const d = Number(localStorage.getItem(INJECT_DEPTH_KEY));
      if (Number.isInteger(d) && d >= 0) injectDepth = d;
    } catch (e) {}
  }
  function saveInjectSettings() {
    try {
      localStorage.setItem(INJECT_KEY, JSON.stringify({ injectToContext }));
      localStorage.setItem(INJECT_DEPTH_KEY, String(injectDepth));
    } catch (e) {}
  }

  // ============================================================
  // 方案四：玩家行为 → 世界回响（从最新正文提取重大行为，自动生成余波新闻进结算体系）
  // ============================================================
  const ECHO_FLOOR_KEY = 'isuria_tension_echo_floor';
  let echoRunning = false;
  // 缓和类行为（好事 → 紧张度下降方向）
  const ECHO_DOWN_RULES = [
    { re: /(?:斩杀|讨伐|击杀|击毙|歼灭|诛杀|杀死)[^。！？\n]{0,30}(?:魔王|灾兽|古龙|传说级|神话级|上古魔物|魔将)/, imp: '极高', scope: '世界', tmpl: '强敌伏诛·{obj}', contentTpl: '冒险者于{place}成功讨伐{obj}，魔潮防线为之一振，各方势力大受鼓舞' },
    { re: /(?:救出|拯救|护送|守护|救下)[^。！？\n]{0,30}(?:国王|女王|圣女|公主|王子|要人|教皇|大祭司|英雄)/, imp: '高', scope: '大陆', tmpl: '要人获救·{obj}', contentTpl: '{obj}在{place}被成功救出，事态转危为安' },
    { re: /(?:击退|驱逐|化解|阻止|粉碎|剿灭)[^。！？\n]{0,30}(?:魔潮|入侵|围城|政变|阴谋|袭击|瘟疫)/, imp: '高', scope: '大陆', tmpl: '危机化解·{obj}', contentTpl: '{obj}在{place}被成功化解，当地重归平静' },
  ];
  // 紧张类行为（坏事 → 紧张度上升方向）
  const ECHO_UP_RULES = [
    { re: /(?:刺杀|弑杀|杀害|毒杀|谋杀)[^。！？\n]{0,30}(?:国王|大公|教皇|女王|领袖|将军|主教|要人)/, imp: '极高', scope: '世界', tmpl: '要人遇刺·{obj}', contentTpl: '{obj}在{place}遇刺身亡，震动朝野，各方势力蠢蠢欲动' },
    { re: /(?:背叛|背约|决裂|反目|叛变|叛逃|倒戈|兵变)/, imp: '高', scope: '大陆', tmpl: '重大背叛·{obj}', contentTpl: '{obj}的背叛在{place}引发剧烈震荡，局势骤然紧张' },
    { re: /(?:摧毁|攻破|攻陷|焚毁|劫掠|屠城|血洗)[^。！？\n]{0,30}(?:要塞|堡垒|城市|王都|据点|基地|村镇|圣地)/, imp: '极高', scope: '世界', tmpl: '城破·{obj}', contentTpl: '{obj}在{place}被攻破，战火蔓延，流民四散' },
    { re: /(?:政变|篡位|夺权|废黜)/, imp: '高', scope: '大陆', tmpl: '政权剧变·{obj}', contentTpl: '{place}发生{obj}，政权更迭引发连锁反应' },
  ];
  function matchEcho(text) {
    for (const r of ECHO_DOWN_RULES) { const m = String(text).match(r.re); if (m) return { rule: r, raw: m[0], dir: -1 }; }
    for (const r of ECHO_UP_RULES) { const m = String(text).match(r.re); if (m) return { rule: r, raw: m[0], dir: 1 }; }
    return null;
  }
  // 写入余波新闻（直接改 stat_data 引用 → replaceMvuData 持久化，自动触发 VARIABLE_UPDATE_ENDED 结算）
  function writeEchoNews(echo) {
    const stat = readStatData();
    if (!stat || !stat.世界) return;
    const world = stat.世界;
    if (!world.世界见闻) world.世界见闻 = {};
    if (!world.世界见闻.动态新闻) world.世界见闻.动态新闻 = {};
    const newsMap = world.世界见闻.动态新闻;
    const place = world.当前地点 || world.当前位置 || '主大陆';
    const date = world.日期 || '';
    const rule = echo.rule;
    const title = rule.tmpl.replace('{obj}', String(echo.raw).slice(0, 18)) + (date ? '（' + date + '）' : '');
    if (newsMap[title]) return;
    newsMap[title] = {
      内容: rule.contentTpl.replace('{place}', place).replace('{obj}', String(echo.raw).slice(0, 26)),
      日期: date,
      重要性: rule.imp,
      影响范围: rule.scope,
      来源: '冒险者公会',
      是否过期: '否',
      相关地点: place,
      相关势力: '',
    };
    let saved = false;
    try {
      const mvu = window.Mvu;
      if (mvu && mvu.getMvuData) {
        const chatD = mvu.getMvuData({ type: 'chat' });
        if (chatD && chatD.stat_data === stat) { mvu.replaceMvuData(chatD, { type: 'chat' }); saved = true; }
        if (!saved) {
          const msgD = mvu.getMvuData({ type: 'message', message_id: 'latest' });
          if (msgD && msgD.stat_data === stat) { mvu.replaceMvuData(msgD, { type: 'message', message_id: 'latest' }); saved = true; }
        }
      }
    } catch (e) {}
    console.log('[紧张度] 玩家行为回响（' + (echo.dir > 0 ? '↑紧张' : '↓缓和') + '）：「' + title + '」');
    if (typeof toastr !== 'undefined' && saved) toastr.info('🌍 世界回响：' + title, '紧张度');
  }
  // 检查最新楼层正文是否有重大行为（指针防重复；每条楼层最多回响一次）
  function checkEchoFromLatestFloor() {
    if (echoRunning) return;
    echoRunning = true;
    try {
      let lastId = -1;
      try { lastId = getLastMessageId(); } catch (e) {}
      if (lastId < 0) return;
      let lastEcho = 0;
      try { lastEcho = Number(localStorage.getItem(ECHO_FLOOR_KEY) || 0) || 0; } catch (e) {}
      if (lastId <= lastEcho) return;
      const msgs = getChatMessages(`${lastId}-${lastId}`, { role: 'all', hide_state: 'unhidden' });
      // 只分析 assistant 正文：跳过 system 通知楼层（技能树生成/职业融合等系统消息不含玩家行为，且会污染回响指针）
      const msg = (msgs || []).find(m => m.role === 'assistant');
      if (!msg || !msg.message) return;
      const echo = matchEcho(String(msg.message));
      if (!echo) return;
      writeEchoNews(echo);
      try { localStorage.setItem(ECHO_FLOOR_KEY, String(lastId)); } catch (e) {}
    } catch (e) {
      console.warn('[紧张度] 回响检测失败:', e);
    } finally {
      echoRunning = false;
    }
  }

  // 战斗联动：紧张度影响野外遭遇强度（注入 + 窗口共用）
  const WAR_MAP = {
    '平静期': '野外遭遇以常规魔兽与野兽为主，行商畅通',
    '暗流期': '野外魔兽活动渐趋频繁，商队开始雇佣护卫',
    '动荡期': '野外遭遇频率上升，流寇与魔兽并存，结伴而行更安全',
    '危机期': '魔物活跃异常，高危区扩散，野外遭遇强度显著上升',
    '决战期': '全境高危，魔物军团出没，野外遭遇可能直接演变为战场冲突',
  };
  // 构建注入到 AI 上下文的「世界动态」块
  // ★ 分工（v2）：【世界态势/待发展走向】已由「纪元触发器」条目输出（时间线+事件详情+各方态势+专题细述），
  //   本脚本不再重复注入旧《动态剧情》内容；只保留独有的"数值与现状层"：
  //   紧张度数值/等级/阶段进度/玩家所在地/进行中任务/近期新闻/战斗环境。
  function buildWorldInjection() {
    const d = extractTensionData(readStatData());
    const newsText = d.news.map(n => n.title + (n.content ? '：' + n.content : '') + (n.place ? '(' + n.place + ')' : '')).join('；');
    const lines = [
      '【世界动态】当前局势与玩家处境，请严格遵循以下内容进行正文叙事，不要复述本段，也不要与其冲突：',
      '- 玩家当前所在地：' + d.curLoc,
      '- 世界紧张度：' + d.tension + '/100（' + d.level + '），上次大事件：' + d.lastEvent,
      '- 阶段进度：本阶段已发生 ' + d.activeCount + ' 起已结算事件' + (d.tension >= 61 ? '（战局高危，野外遭遇强度显著上升）' : ''),
    ];
    if (d.tasks.length) lines.push('- 进行中的任务：' + d.tasks.join('；'));
    if (newsText) lines.push('- 近期重要动态：' + newsText);
    lines.push('- 战斗环境：' + (WAR_MAP[d.level] || ''));
    return lines.join('\n');
  }

  // 注册正文注入（每次 AI 生成前，把世界动态以"带深度"的方式塞进上下文，贴近最近楼层）
  function registerWorldInjection() {
    try {
      eventOn(tavern_events.CHAT_COMPLETION_PROMPT_READY, ({ chat }) => {
        try {
          if (!injectToContext || !chat) return;
          // 非角色扮演生成（技能树/装备定制等工具性 generateRaw/generate）不注入世界动态，
          // 避免【世界动态】叙事指令污染"只输出 JSON"类任务（与首页/状态栏生成技能树冲突的根因）
          if (window.__ISURIA_NON_RP__) return;
          const marker = '【世界动态】';
          if (chat.some(m => String(m?.content || '').includes(marker))) return;
          const parts = [buildWorldInjection()];
          // depth：从消息末尾倒数第 N 条之前插入（0=紧贴当前楼层，越大越深入历史，默认 4）
          // 相比 unshift 永远顶在最前，这样世界动态更贴近"当前场景"，且不会挤掉角色卡主提示词
          const safeDepth = Math.max(0, Math.floor(injectDepth) || 0);
          const idx = Math.max(1, chat.length - 1 - safeDepth);
          chat.splice(idx, 0, { role: 'system', content: parts.join('\n\n') });
        } catch (e) {}
      });
    } catch (e) {
      console.warn('[紧张度] 注册正文注入失败:', e);
    }
  }

  // ============================================================
  // 羊皮纸世界动态窗口（脚本按钮 → 点击打开）
  // ============================================================
  // 注入目标：优先最顶层窗口 window.top（脚本运行在酒馆扩展 iframe 内，
  // window.parent 可能是内部容器 → fixed 遮罩会被聊天窗盖住，故必须用 top）
  const OUTER = (function () {
    try { if (window.top && window.top.document) return window.top; } catch (e) {}
    try { if (window.parent && window.parent.document) return window.parent; } catch (e) {}
    return window;
  })();
  function outerDoc() { return (OUTER && OUTER.document) || document; }
  function outerBody() { return outerDoc().body; }

  const TENSION_VIEW_KEY = 'isuria_tension_view_last';
  const TENSION_STYLE_ID = 'tension-scroll-style';

  // ---- 读取 stat_data（多来源兜底） ----
  function readStatData() {
    try {
      const mvu = window.Mvu;
      if (mvu && mvu.getMvuData) {
        const d = mvu.getMvuData({ type: 'chat' });
        if (d && d.stat_data) return d.stat_data;
        const d2 = mvu.getMvuData({ type: 'message', message_id: 'latest' });
        if (d2 && d2.stat_data) return d2.stat_data;
      }
    } catch (e) {}
    try {
      const d = getVariables({ type: 'chat' });
      if (d && d.stat_data) return d.stat_data;
    } catch (e) {}
    return null;
  }

  // ---- 提取窗口展示数据 ----
  function extractTensionData(statData) {
    const d = { tension: 35, level: '暗流期', lastEvent: '无近期大事件', curLoc: '未知之地', worldBrief: '', tasks: [], news: [], dyn: '', base: 35, worldDelta: 0, contDelta: 0, regDelta: 0, regDeltaRaw: 0, settledItems: [] };
    if (!statData || typeof statData !== 'object') return d;
    const flags = statData.$flags || {};
    const t = flags.紧张度 || {};
    if (typeof t.当前值 === 'number') d.tension = t.当前值;
    if (t.等级) d.level = t.等级;
    if (t.上次触发事件) d.lastEvent = t.上次触发事件;
    // ★ 方案1：贡献分解（基线 + 世界级/大陆级/区域级合计 + 已结算新闻明细）
    d.base = (typeof flags.紧张度基线 === 'number') ? flags.紧张度基线 : 35;
    const settled = flags.紧张度已结算新闻 || {};
    let worldDelta = 0, contDelta = 0, regDelta = 0;
    const items = [];
    for (const nt in settled) {
      const rec = settled[nt];
      const v = (typeof rec === 'number') ? rec : (rec && typeof rec.v === 'number' ? rec.v : 0);
      const s = (rec && typeof rec === 'object' && rec.s) ? rec.s : '大陆';
      if (s === '世界') worldDelta += v;
      else if (s === '区域') regDelta += v;
      else contDelta += v;
      const news = (statData.世界 && statData.世界.世界见闻 && statData.世界.世界见闻.动态新闻 && statData.世界.世界见闻.动态新闻[nt]) || {};
      items.push({ title: nt, v, s, expired: news.是否过期 === '是', date: news.日期 || '' });
    }
    d.worldDelta = worldDelta;
    d.contDelta = contDelta;
    d.regDeltaRaw = regDelta;
    d.regDelta = Math.max(-15, Math.min(15, regDelta)); // 区域封顶（与结算逻辑一致）
    d.settledItems = items;
    d.activeCount = items.filter(x => !x.expired).length; // 本阶段正在发酵的事件数（调整③）
    // 方案五：世界大事记（最近 12 条，倒序展示）
    d.chronicle = Array.isArray(flags.紧张度大事记) ? flags.紧张度大事记.slice(-12).reverse() : [];
    const world = statData.世界 || {};
    d.curLoc = world.当前地点 || world.当前位置 || '未知之地';
    d.worldBrief = (world.世界见闻 && world.世界见闻.世界概况) || '';
    const hero = statData.主角 || {};
    const quests = hero.任务 || {};
    for (const qn in quests) {
      const q = quests[qn];
      if (q && q.状态 === '进行中') d.tasks.push(qn + (q.内容 ? '：' + q.内容 : ''));
    }
    const newsMap = (world.世界见闻 && world.世界见闻.动态新闻) || {};
    // 与《状态变量输出》对齐：仅最新 5 条 + 逾期（是否过期==='是'）屏蔽
    for (const nt in newsMap) {
      const n = newsMap[nt];
      if (n && n.是否过期 !== '是') {
        d.news.push({ title: nt, content: n.内容 || '', place: n.相关地点 || '', date: n.日期 || '', imp: n.重要性 });
      }
    }
    if (d.news.length > 5) d.news = d.news.slice(-5);   // 后插入=最新
    return d;
  }

  // ---- 读取动态剧情世界书内容（兼容三种存储：①动态剧情·X 是世界书名 ②是某世界书里的条目名 ③单条目内含多段） ----
  async function getDynText(level) {
    const want = '动态剧情·' + level;
    // 方式1：直接按世界书名读
    try {
      if (typeof getWorldbook === 'function') {
        const entries = await getWorldbook(want);
        if (Array.isArray(entries) && entries.length) {
          return entries.map(e => (e && e.content) || '').filter(Boolean).join('\n');
        }
      }
    } catch (e) {}
    // 方式2：遍历所有世界书，按条目名查找（getwi 的等效实现）
    try {
      if (typeof getWorldbookNames === 'function') {
        const names = getWorldbookNames() || [];
        for (const wb of names) {
          if (!wb) continue;
          try {
            const entries = await getWorldbook(wb);
            if (!Array.isArray(entries) || !entries.length) continue;
            // 精确条目名
            const exact = entries.filter(e => e && String(e.name || '').trim() === want);
            if (exact.length) return exact.map(e => (e && e.content) || '').join('\n');
            // 容错：条目名含「动态剧情」且含当前等级名
            const fuzzy = entries.filter(e => e && String(e.name || '').includes('动态剧情') && String(e.name).includes(level));
            if (fuzzy.length) return fuzzy.map(e => (e && e.content) || '').join('\n');
            // 方式3：单条目内含多段（条目内容含「动态剧情·X:」分段，如一个大条目装全部等级）
            for (const e of entries) {
              // 【纪元触发器兼容】跳过纪元触发器条目：其内容为 EJS 模板（含"动态剧情·X:"分段字样），
              // 直接截取会注入未渲染的 <% %> 源码并与触发器输出重复；动态剧情由它自行输出。
              if (String(e?.name || '').includes('纪元触发器')) continue;
              const content = String((e && e.content) || '');
              const re = new RegExp('动态剧情\\s*[·:：]?\\s*' + level + '\\s*[:：]');
              const m = content.match(re);
              if (!m) continue;
              const rest = content.slice(m.index + m[0].length);
              const segEnd = rest.search(/\n\s*动态剧情\s*[·:：]/);
              const seg = (segEnd > 0 ? rest.slice(0, segEnd) : rest).trim();
              if (seg) return seg;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return '';
  }

  // ---- 动态剧情·按地点分节注入（调整①：只注入与玩家所在地相关的小节，节省上下文） ----
  // 顶级小节特征：标题含「·」或以「世界总态势」开头（如 新大陆·远洋探索 / 主大陆·帝国动向 / 魔王·奥姆尼斯动向（沉睡阶））
  function splitDynSections(text) {
    const sections = [];
    let cur = null;
    String(text || '').split('\n').forEach(raw => {
      const line = raw.replace(/[ \t]+/g, ' ').replace(/^\s+/, '').replace(/\s+$/, '');
      if (!line) return;
      const isTop = line.includes('·') || line.startsWith('世界总态势');
      if (isTop && /[:：]\s*$/.test(line)) {
        cur = { title: line.replace(/[:：]\s*$/, '').trim(), body: [] };
        sections.push(cur);
      } else if (cur) {
        cur.body.push(line);
      }
    });
    return sections;
  }
  // 地点 → 小节关键词映射
  const PLACE_SECTION_RULES = [
    { keys: ['新大陆', '梅萨利亚', '乌尔坎', '殖民', '蓝光谷'], titles: ['新大陆'] },
    { keys: ['帝国', '艾森格拉德', '奥尔德南'], titles: ['主大陆·帝国'] },
    { keys: ['王国', '坎特伯里', '格洛斯特', '阿尔比恩', '王都'], titles: ['主大陆·王国'] },
    { keys: ['莫尔加纳', '铁锚营', '蚀骨域', '黯渊', '第七站'], titles: ['莫尔加纳', '魔王'] },
    { keys: ['多尔海姆', '铁心城', '铁门镇', '霜脊关', '矮人'], titles: ['亚人诸国'] },
    { keys: ['希尔凡蒂尔', '精灵', '塞兰迪尔', '艾尔希安'], titles: ['亚人诸国'] },
    { keys: ['乌尔加特', '兽人', '风牙镇', '草原'], titles: ['亚人诸国'] },
    { keys: ['艾瑟尔', '翼民', '莉瑟尔', '浮岛'], titles: ['亚人诸国'] },
    { keys: ['涅瑞廷', '海妖', '珊瑚市'], titles: ['亚人诸国'] },
    { keys: ['尼弗海姆', '龙裔', '弗拉克拉', '冰原'], titles: ['亚人诸国'] },
  ];
  // 过滤：返回 { picked: 本地相关小节, others: 他域小节 }
  // 核心小节（魔王/莫尔加纳/世界总态势）始终进 picked；无任何匹配时 picked 为空（调用方走全量兜底）
  function filterDynByPlace(text, place) {
    const sections = splitDynSections(text);
    if (!sections.length) return { picked: text, others: [] };
    const p = String(place || '');
    const matched = new Set();
    for (const rule of PLACE_SECTION_RULES) {
      if (rule.keys.some(k => p.includes(k))) rule.titles.forEach(t => matched.add(t));
    }
    const picked = [];
    const others = [];
    sections.forEach(s => {
      const core = s.title.includes('魔王') || s.title.includes('莫尔加纳') || s.title.startsWith('世界总态势');
      let hit = core;
      if (!hit) {
        for (const m of matched) { if (s.title.includes(m)) { hit = true; break; } }
      }
      (hit ? picked : others).push(s);
    });
    if (!picked.length) return { picked: text, others: [] }; // 无匹配 → 调用方全量
    return { picked, others };
  }
  // 他域小节概要：标题 + 第一条有效内容（压缩到 ~50 字，让 AI 知道"别处在发生什么"）
  function sectionSummary(s) {
    const first = (s.body || []).find(l => l && l.trim()) || '';
    return s.title.replace(/[·:：]\s*$/, '') + '：' + String(first).replace(/^-\s*/, '').replace(/\s+/g, ' ').slice(0, 40);
  }
  // 渲染过滤结果：本地小节全文；非决战期他域给概要行，决战期（≥81）全量（世界整体卷入，信息不可割裂）
  function renderFilteredDyn(filtered, tension) {
    if (typeof filtered === 'string') return filtered;
    if (!filtered.picked.length) return String(filtered.picked);
    const pickedText = filtered.picked.map(s => s.title + ':\n' + s.body.join('\n')).join('\n\n');
    if (tension >= 81 && filtered.others.length) {
      const othersText = filtered.others.map(s => s.title + ':\n' + s.body.join('\n')).join('\n\n');
      return pickedText + '\n\n【他域全况】\n' + othersText;
    }
    if (filtered.others.length) {
      const summary = filtered.others.map(sectionSummary).join('；');
      return pickedText + '\n【他域概要】' + summary;
    }
    return pickedText;
  }

  // ---- 动态剧情·潜在节点提取（调整④：作为"待发展走向"注入） ----
  function extractPotentialNodes(text) {
    const lines = String(text || '').split('\n');
    const chunks = [];
    let capturing = false;
    let buf = [];
    const flush = () => { if (buf.length) { chunks.push(buf.join('')); buf = []; } };
    for (const raw of lines) {
      const line = raw.replace(/[ \t]+/g, ' ').replace(/^\s+/, '').replace(/\s+$/, '');
      if (!line) continue;
      if (/^潜在节点/.test(line)) { capturing = true; buf = []; continue; }
      if (capturing) {
        if (line.includes('·') && /[:：]\s*$/.test(line)) { flush(); capturing = false; }
        else buf.push(line.replace(/^-\s*/, ''));
      }
    }
    flush();
    return chunks.join('；').replace(/\s+/g, ' ').trim().slice(0, 400);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 动态剧情排版：去 HTML 标签、保留换行，按「小节标题 / 列表项 / 正文」结构化显示
  function dynToHtml(text) {
    const lines = String(text || '').replace(/<[^>]+>/g, '').replace(/\r/g, '').split('\n');
    const out = [];
    for (const raw of lines) {
      const line = raw.replace(/[ \t]+/g, ' ').replace(/^\s+/, '').replace(/\s+$/, '');
      if (!line) continue;
      if (/^- /.test(line)) {
        out.push('<div class="tw-dyn-item">' + escapeHtml(line.replace(/^- /, '')) + '</div>');
      } else if (/^[^，。；:：]+[:：]\s*$/.test(line) && line.length <= 40) {
        out.push('<div class="tw-dyn-head">' + escapeHtml(line) + '</div>');
      } else {
        out.push('<div class="tw-dyn-line">' + escapeHtml(line) + '</div>');
      }
    }
    return out.join('');
  }

  // ---- 注入羊皮纸样式（唯一 id；已存在则更新内容，防止脚本热重载后旧 CSS 残留导致新样式不生效） ----
  function ensureTensionStyle() {
    const doc = outerDoc();
    let style = doc.getElementById(TENSION_STYLE_ID);
    if (!style) {
      style = doc.createElement('style');
      style.id = TENSION_STYLE_ID;
      (doc.head || doc.documentElement).appendChild(style);
    }
    style.textContent = `
.tw-mask {
  position: fixed; inset: 0; z-index: 2147483646;
  background: rgba(10, 8, 4, 0.55);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 24px 12px; overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  box-sizing: border-box;
}
.tw-panel {
  position: relative;
  width: min(720px, 100%);
  max-width: 720px;
  margin: 0 auto;
  padding: 16px 18px 18px;
  box-sizing: border-box;
  border: 2px solid #b8956a; border-radius: 3px;
  background:
    repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(226,196,130,0.04) 2px, rgba(226,196,130,0.04) 4px),
    linear-gradient(165deg, #2a2016 0%, #3a2b1c 30%, #312417 60%, #241a10 100%);
  box-shadow: 0 6px 24px rgba(0,0,0,0.45), inset 0 0 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(60,40,20,0.5);
  font-family: 'ZhuqueFangsong', 'Noto Serif SC', 'Georgia', serif;
  color: #e8d5a8;
  /* ★ 移动端修复：滚动收敛到内层 .tw-scroll；外层不滚 → 四角装饰（::before/::after）固定在四角，
     不再随内容滚动"戒断到中间" */
  overflow: visible;
  max-height: none;
}
/* 内层滚动区（内容装这里） */
.tw-panel > .tw-scroll {
  max-height: calc(100vh - 48px);
  max-height: calc(100dvh - 48px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.tw-panel::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background:
    radial-gradient(ellipse 80% 15% at 50% 0%, rgba(0,0,0,0.35), transparent 70%),
    radial-gradient(ellipse 60% 12% at 50% 100%, rgba(0,0,0,0.30), transparent 70%);
}
.tw-panel::after {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 1; opacity: 0.55;
  background:
    linear-gradient(#9a7a45,#9a7a45) top left / 44px 3px no-repeat,
    linear-gradient(#9a7a45,#9a7a45) top left / 3px 44px no-repeat,
    linear-gradient(#9a7a45,#9a7a45) top right / 44px 3px no-repeat,
    linear-gradient(#9a7a45,#9a7a45) top right / 3px 44px no-repeat,
    linear-gradient(#9a7a45,#9a7a45) bottom left / 44px 3px no-repeat,
    linear-gradient(#9a7a45,#9a7a45) bottom left / 3px 44px no-repeat,
    linear-gradient(#9a7a45,#9a7a45) bottom right / 44px 3px no-repeat,
    linear-gradient(#9a7a45,#9a7a45) bottom right / 3px 44px no-repeat;
}
.tw-close {
  position: absolute; top: 6px; right: 6px; z-index: 3;
  color: #d4b478; font-size: 15px; cursor: pointer; opacity: 0.8;
  display: flex; align-items: center; justify-content: center;
  min-width: 32px; min-height: 32px; padding: 2px;
  box-sizing: border-box;
}
.tw-close:hover { opacity: 1; }
.tw-title {
  position: relative; z-index: 2; text-align: center;
  color: #f0d48a; font-size: 16px; letter-spacing: 4px;
  text-shadow: 0 1px 3px rgba(0,0,0,0.6);
  padding-bottom: 10px; margin-bottom: 12px;
  border-bottom: 1px solid rgba(212,180,120,0.25);
}
.tw-body { position: relative; z-index: 2; }
.tw-sec { margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px dashed rgba(212,180,120,0.18); }
.tw-sec:last-child { border-bottom: 0; margin-bottom: 0; }
.tw-sec-title { font-size: 12px; color: #d4b478; letter-spacing: 2px; margin-bottom: 7px; }
.tw-text { font-size: 13px; line-height: 1.9; color: #e8d5a8; white-space: pre-line; letter-spacing: 0.03em; }
.tw-tension-row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.tw-num { font-size: 30px; font-weight: 700; color: #f0d48a; text-shadow: 0 2px 6px rgba(0,0,0,0.5); }
.tw-level { font-size: 14px; color: #c9a86a; }
.tw-delta { font-size: 13px; font-weight: 600; }
.delta-up { color: #e0745a; }
.delta-down { color: #7fb98a; }
.delta-flat { color: #9a9a8a; }
.tw-meta { font-size: 12px; color: #b8a678; margin-top: 6px; }
    .tw-field { font-size: 12px; color: #b8a678; margin-top: 5px; padding: 2px 0; border-bottom: 1px dashed rgba(184,166,120,0.18); }
    .tw-field b { color: #e8d5a8; font-weight: 700; }
    .tw-field .tw-tag { display:inline-block; background: rgba(212,175,55,0.16); border:1px solid rgba(212,175,55,0.45); color:#f0d48a; border-radius:3px; padding:0 5px; font-size:11px; margin-right:4px; }
.tw-news { padding: 6px 0 8px; border-bottom: 1px dotted rgba(212,180,120,0.15); }
.tw-news:last-child { border-bottom: 0; }
.tw-news-head { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.tw-news-imp { font-size: 10px; padding: 1px 6px; border-radius: 3px; border: 1px solid; flex-shrink: 0; }
.imp-极高 { color: #e0745a; border-color: #e0745a; background: rgba(224,116,90,0.12); }
.imp-高 { color: #e0a45a; border-color: #e0a45a; background: rgba(224,164,90,0.10); }
/* 新闻影响徽章（紧张度贡献） */
.imp-plus { color: #e0745a; border-color: #e0745a; background: rgba(224,116,90,0.14); font-weight: 700; }
.imp-minus { color: #7fb98a; border-color: #7fb98a; background: rgba(127,185,138,0.12); font-weight: 700; }
.imp-done { color: #9a9a8a; border-color: #9a9a8a; background: rgba(120,120,110,0.12); }
.tw-news-title { font-size: 13px; color: #f0d48a; font-weight: 600; }
.tw-news-date { margin-left: auto; font-size: 11px; color: #9a8a6a; }
.tw-news-content { font-size: 12px; color: #d8c49a; line-height: 1.7; }
/* 世界大事记时间线 */
.tw-chr { display: flex; align-items: center; gap: 8px; padding: 3px 0; border-bottom: 1px dotted rgba(212,180,120,0.12); font-size: 12px; }
.tw-chr:last-child { border-bottom: 0; }
.tw-chr-imp { font-size: 10px; padding: 1px 6px; border-radius: 3px; border: 1px solid; flex-shrink: 0; font-weight: 700; }
.tw-chr-imp.up { color: #e0745a; border-color: #e0745a; background: rgba(224,116,90,0.12); }
.tw-chr-imp.down { color: #7fb98a; border-color: #7fb98a; background: rgba(127,185,138,0.12); }
.tw-chr-title { flex: 1; min-width: 0; color: #e8d5a8; }
.tw-chr-date { font-size: 10px; color: #9a8a6a; flex-shrink: 0; }
.tw-live {
  font-size: 13px; line-height: 1.9; color: #e8d5a8; white-space: pre-wrap;
  letter-spacing: 0.03em; background: rgba(212,180,120,0.06);
  border-left: 2px solid #d4b478; padding: 8px 10px; margin-bottom: 10px; min-height: 20px;
}
.tw-btn {
  font-family: inherit; font-size: 13px; color: #2a2016;
  background: linear-gradient(180deg, #e8c878, #c9a86a);
  border: 1px solid #9a7a45; border-radius: 4px; padding: 7px 16px;
  cursor: pointer; letter-spacing: 1px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.25);
}
.tw-btn:hover { background: linear-gradient(180deg, #f0d48a, #d4b478); }
.tw-btn:disabled { opacity: 0.55; cursor: wait; }
.tw-btn-mini { padding: 4px 12px; font-size: 12px; }
.tw-area {
  width: 100%; min-height: 90px; resize: vertical;
  padding: 8px; box-sizing: border-box;
  background: rgba(10, 8, 4, 0.35);
  border: 1px solid rgba(212,180,120,0.35); border-radius: 3px;
  color: #e8d5a8; font-family: inherit; font-size: 12px; line-height: 1.6;
  margin-bottom: 8px;
}
.tw-area:focus { outline: none; border-color: #d4b478; }
.tw-check {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: #d8c49a; margin-bottom: 6px; cursor: pointer;
}
.tw-check input { accent-color: #c9a86a; }
.tw-check-mt { margin-top: 8px; }
.tw-dyn {
  font-size: 12px; line-height: 1.8; color: #d8c49a;
  max-height: 170px;   /* 可视区约 300 字，超出部分滚动查看，避免占据视线 */
  overflow-y: auto;
  padding-right: 8px;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #b8956a rgba(0,0,0,0.25);
}
.tw-dyn::-webkit-scrollbar { width: 8px; }
.tw-dyn::-webkit-scrollbar-track { background: rgba(0,0,0,0.18); border-radius: 4px; }
.tw-dyn::-webkit-scrollbar-thumb { background: #b8956a; border-radius: 4px; border: 1px solid rgba(0,0,0,0.3); }
.tw-dyn-hint {
  margin-top: 4px; font-size: 11px; color: #9a8a6a;
  text-align: center; letter-spacing: 1px;
}
.tw-dyn-head {
  font-weight: 700; color: #f0d48a;
  margin-top: 6px; letter-spacing: 0.5px;
}
.tw-dyn-head:first-child { margin-top: 0; }
.tw-dyn-item {
  padding-left: 14px; color: #e8d5a8;
  position: relative; margin-top: 2px;
}
.tw-dyn-item::before {
  content: '·'; position: absolute; left: 0;
  color: #c9a86a;
}
.tw-dyn-line { color: #d8c49a; margin-top: 2px; }
@media (max-width: 520px) {
  .tw-mask { padding: 12px 8px; }
  .tw-panel { padding: 12px 12px 14px; }
  .tw-panel > .tw-scroll { max-height: 88vh; max-height: 88dvh; }
  .tw-title { font-size: 14px; letter-spacing: 2px; }
  .tw-num { font-size: 26px; }
  .tw-sec-title { font-size: 11px; }
  .tw-text, .tw-live { font-size: 12px; }
  .tw-news-title { font-size: 12px; }
  .tw-news-date { font-size: 10px; }
  .tw-meta { font-size: 11px; }
}
`;
  }

  // ---- 构建窗口 HTML ----
  function fmtDelta(v) { return v > 0 ? '+' + v : String(v); }
  // 新闻影响徽章（方案1：每条新闻标注对紧张度的贡献）
  function settledBadge(d, title) {
    const it = (d.settledItems || []).find(x => x.title === title);
    if (!it) return '';
    if (it.expired) return '<span class="tw-news-imp imp-done">🏁 已落幕</span>';
    if (it.v > 0) return '<span class="tw-news-imp imp-plus">↑' + fmtDelta(it.v) + '</span>';
    if (it.v < 0) return '<span class="tw-news-imp imp-minus">↓' + String(it.v) + '</span>';
    return '';
  }
  // 紧张度构成文本（方案1：基线 + 各范围合计，区域封顶时注明）
  function buildCompText(d) {
    const parts = [];
    parts.push('基线 ' + d.base);
    if (d.worldDelta !== 0) parts.push('世界级 ' + fmtDelta(d.worldDelta));
    if (d.contDelta !== 0) parts.push('大陆级 ' + fmtDelta(d.contDelta));
    if (d.regDelta !== 0) parts.push('区域级 ' + fmtDelta(d.regDelta) + (d.regDeltaRaw !== d.regDelta ? '（原 ' + fmtDelta(d.regDeltaRaw) + '，已封顶±15）' : ''));
    return parts.length > 1 ? '构成：' + parts.join(' + ') : '';
  }
  // ★ 烈度块：显示当前世界的烈度形态（对应《纪元触发器》的烈度调制层）
  //   日期/四传奇显形/魔王分身阶段/地缘潜伏地——脚本侧轻量复刻触发器口径，窗口直接可见
  // ★ mini-EJS：渲染《纪元触发器》世界书条目（EJS 源码 → 文本），窗口预览用（不注入上下文）
  function renderMiniEjs(src, statData) {
    try {
      const segs = [], codes = [];
      const re = /<%([\s\S]*?)%>/g;
      let last = 0, m;
      while ((m = re.exec(src))) { segs.push(src.slice(last, m.index)); codes.push(m[1]); last = re.lastIndex; }
      segs.push(src.slice(last));
      let js = '';
      for (let i = 0; i < segs.length; i++) {
        js += 'out.push(' + JSON.stringify(segs[i]) + ');\n';
        if (i < codes.length) {
          const c = codes[i];
          if (c[0] === '=') js += 'out.push(String(' + c.slice(1).trim() + '));\n';
          else js += c;
        }
      }
      const fn = new Function('stat_data', '_', 'const out=[]; try {\n' + js + '\n} catch (e) { out.push("（纪元触发器渲染错误: " + (e && e.message || e) + "）"); } return out.join("");');
      return fn(statData || {}, _);
    } catch (e) {
      return '（纪元触发器渲染失败: ' + (e && e.message || e) + '）';
    }
  }
  // 读取《纪元触发器》世界书条目并渲染（窗口预览，不注入 AI 上下文）
  async function loadEraTriggerText() {
    try {
      if (typeof getWorldbook !== 'function') return '';
      let content = '';
      // 精确条目名优先，其次模糊（条目名含"纪元触发器"）
      try {
        const entries = await getWorldbook('纪元触发器');
        if (Array.isArray(entries) && entries.length) content = entries.map(e => (e && e.content) || '').filter(Boolean).join('\n');
      } catch (e) {}
      if (!content && typeof getWorldbookNames === 'function') {
        const names = getWorldbookNames() || [];
        for (const wb of names) {
          if (!wb) continue;
          try {
            const entries = await getWorldbook(wb);
            if (!Array.isArray(entries)) continue;
            const hit = entries.find(e => e && String(e.name || '').includes('纪元触发器'));
            if (hit) { content = String(hit.content || ''); break; }
          } catch (e) {}
        }
      }
      if (!content) return '';
      return renderMiniEjs(content, readStatData() || {});
    } catch (e) {
      return '';
    }
  }
  // ★ 纪元触发器输出：按「── 栏目 ──」拆分为分节卡片（标题 + 正文），替代裸文本
  function fmtEraSections(text) {
    try {
      const secs = [];
      let cur = null;
      String(text || '').split('\n').forEach(line => {
        const t = String(line).trim();
        if (t === '<世界动态·纪元轨迹>' || t === '</世界动态·纪元轨迹>') return;      // 外层标签不显示
        const m = t.match(/^──\s*([^─\n]+?)\s*──$/);
        if (m) {
          cur = { title: m[1].trim(), body: [] };
          secs.push(cur);
          return;
        }
        if (!cur) { cur = { title: '纪元轨迹', body: [] }; secs.push(cur); }
        if (line.trim()) cur.body.push(line.replace(/^\s{2}/, ''));
      });
      if (!secs.length) return '';
      return secs.map(s =>
        '<div class="tw-sec"><div class="tw-sec-title">✦ ' + escapeHtml(s.title) + '</div>' +
        '<div class="tw-text">' + escapeHtml(s.body.join('\n')) + '</div></div>'
      ).join('');
    } catch (e) {
      return '<div class="tw-meta">纪元触发器分节失败：' + escapeHtml(String(e && e.message || e)) + '</div>';
    }
  }
  function buildIntensityBlock(d) {
    try {
      const stat = readStatData() || {};
      const dateStr = String(_.get(stat, '世界.日期', '') || '');
      const dm = dateStr.match(/圣光历(\d+)年(?:\s*(\d+)月)?/);
      const y = dm ? parseInt(dm[1], 10) : 1497;
      const mo = (dm && dm[2]) ? parseInt(dm[2], 10) : 1;
      const pn = (yy, mm) => yy * 12 + mm;
      const nowP = pn(y, mo);
      const mStage = nowP < pn(1497, 3) ? '潜伏阶'
        : nowP < pn(1497, 10) ? '夺权阶'
        : nowP < pn(1500, 1) ? '执棋阶'
        : '终局阶';
      const lv = d.level === '平静期' || d.level === '暗流期' ? 0
        : d.level === '动荡期' ? 1
        : d.level === '危机期' ? 2
        : 3;
      const lvName = ['低烈度（明面克制，暗自动员）', '中烈度（摩擦升级，内部分裂）', '高烈度（全面对抗，被迫站队）', '极烈度（存亡决战，四处冒烟）'][lv];
      const LEGEND = ['贤者', '勇者', '魔女', '神龙'];
      const awake = _.get(stat, '世界.四传奇觉醒', {}) || {};
      const legendTxt = lv === 0 ? '仅名号流传（真身不明）'
        : lv === 1 ? '疑似传闻（隐居学者/巨龙目击等）'
        : lv === 2 ? '人选浮出（时钟塔导师/龙血仪式期等）'
        : '下落已明（是否汇合成焦点）';
      const awakeTxt = LEGEND.filter(n => awake[n] === true);
      // 魔王分身阶段 + 地缘（潜伏地命中提示）
      const MASK = {
        '潜伏阶': { 地: '城邦', 词: /梅萨利亚|卡兰蒂亚|城邦|新梅萨利亚|红狮商会|商会/ },
        '夺权阶': { 地: '王国', 词: /坎特伯里|阿尔比恩|王都|王国|王室|格洛斯特/ },
        '执棋阶': { 地: '帝国', 词: /艾森格拉德|格伦茨堡|克洛恩|帝国|奥尔德南|魔导|艾森/ },
        '终局阶': { 地: '主大陆城市', 词: /坎特伯里|艾森格拉德|格伦茨堡|帝国|王国|主大陆|城市|王都/ }
      };
      const locAll = String(_.get(stat, '世界.当前位置', '') || '') + ' ' + String(_.get(stat, '世界.当前地点', '') || '');
      const mask = MASK[mStage] || null;
      const maskHit = !!(mask && mask.词.test(locAll));
      const stageTxt = {
        '潜伏阶': '潜伏阶（万路商会情报调度官，蛰伏渗透）',
        '夺权阶': '夺权阶（王国枢密院副相，操控王选）',
        '执棋阶': '执棋阶（帝国军务大臣，拖人类入绞肉机）',
        '终局阶': '终局阶（空间通道开启，里应外合）'
      }[mStage];
      return '' +
        '<div class="tw-field"><b>烈度</b>：' + escapeHtml(d.level) + '（' + escapeHtml(lvName) + '）</div>' +
        '<div class="tw-field"><b>纪元</b>：' + escapeHtml(dateStr || '未知') + '</div>' +
        '<div class="tw-field"><b>魔王分身</b>：' + escapeHtml(stageTxt) + (maskHit ? ' ⚠ 你正处于其潜伏地【' + escapeHtml(mask.地) + '】（遭遇判定见《纪元触发器》）' : '') + '</div>' +
        '<div class="tw-field"><b>四传奇显形</b>：' + escapeHtml(legendTxt) + (awakeTxt.length ? '　已觉醒：' + escapeHtml(awakeTxt.join('、')) : '') + '</div>' +
        '<div class="tw-field"><b>地缘</b>：' + escapeHtml(d.curLoc) + '</div>';
    } catch (e) {
      return '<div class="tw-meta">烈度块构建失败：' + escapeHtml(String(e && e.message || e)) + '</div>';
    }
  }
  function buildWindowHtml(d) {
    const newsHtml = d.news.map(n =>
      '<div class="tw-news"><div class="tw-news-head"><span class="tw-news-imp imp-' + escapeHtml(n.imp) + '">' + escapeHtml(n.imp) + '</span>' + settledBadge(d, n.title) + '<span class="tw-news-title">' + escapeHtml(n.title) + '</span>' + (n.date ? '<span class="tw-news-date">' + escapeHtml(n.date) + '</span>' : '') + '</div><div class="tw-news-content">' + escapeHtml(n.content) + (n.place ? '（' + escapeHtml(n.place) + '）' : '') + '</div></div>'
    ).join('');
    const tasksHtml = d.tasks.length ? '<div class="tw-sec"><div class="tw-sec-title">✦ 进行中的任务</div><div class="tw-text">' + escapeHtml(d.tasks.join('；')) + '</div></div>' : '';
    const briefHtml = d.worldBrief ? '<div class="tw-sec"><div class="tw-sec-title">✦ 世界概况</div><div class="tw-text">' + escapeHtml(d.worldBrief) + '</div></div>' : '';
    const newsSecHtml = d.news.length ? '<div class="tw-sec"><div class="tw-sec-title">✦ 近期重要动态</div>' + newsHtml + '</div>' : '';
    const dynHtml = '<div class="tw-sec"><div class="tw-sec-title">✦ 世界态势（' + escapeHtml(d.level) + '）</div>' +
      buildIntensityBlock(d) +
      '</div>' +
      (d.eraText && String(d.eraText).trim()
        ? fmtEraSections(d.eraText)
        : '<div class="tw-sec"><div class="tw-sec-title">✦ 纪元触发器</div>' +
          '<div class="tw-meta">未读取到世界书条目《纪元触发器》（请确认已启用该 EJS 条目），无法预览其输出。</div></div>');
    // 方案五：世界大事记时间线
    const chronicleHtml = d.chronicle.length ? '<div class="tw-sec"><div class="tw-sec-title">📜 世界大事记（近 ' + d.chronicle.length + ' 条）</div>' +
      d.chronicle.map(c =>
        '<div class="tw-chr"><span class="tw-chr-imp' + (c.影响 > 0 ? ' up' : ' down') + '">' + (c.影响 > 0 ? '↑+' + c.影响 : '↓' + c.影响) + '</span><span class="tw-chr-title">' + escapeHtml(c.标题) + '</span>' + (c.日期 ? '<span class="tw-chr-date">' + escapeHtml(c.日期) + '</span>' : '') + '</div>'
      ).join('') + '</div>' : '';
    const compText = buildCompText(d);
    const injectHtml = '<div class="tw-sec"><div class="tw-sec-title">✦ 注入正文</div>' +
      '<label class="tw-check"><input type="checkbox" id="twInjectCtx"' + (injectToContext ? ' checked' : '') + '> 注入世界动态到正文</label>' +
      '<div class="tw-meta">开启后，世界动态（所在地/紧张度/任务/近期动态/世界态势）会在每次 AI 生成时注入上下文，让正文叙事自然体现当前局势。</div>' +
      '</div>';
    return '' +
      '<div class="tw-close" title="关闭">✕</div>' +
      '<div class="tw-title">◈ 世 界 动 态 ◈</div>' +
      '<div class="tw-body">' +
        '<div class="tw-sec"><div class="tw-sec-title">✦ 紧张度变化</div>' +
          '<div class="tw-tension-row"><span class="tw-num">' + d.tension + '</span><span class="tw-level">' + escapeHtml(d.level) + '</span><span class="tw-delta" id="twDelta">—</span></div>' +
          (compText ? '<div class="tw-field"><b>构成</b>：' + escapeHtml(compText) + '</div>' : '') +
          '<div class="tw-field"><b>当前所在地</b>：' + escapeHtml(d.curLoc) + '</div>' +
          '<div class="tw-field"><b>战斗环境</b>：' + escapeHtml(WAR_MAP[d.level] || '—') + '</div>' +
          '<div class="tw-field"><b>阶段进度</b>：本阶段已发生 ' + d.activeCount + ' 起已结算事件</div>' +
          '<div class="tw-field"><b>上次大事件</b>：' + escapeHtml(d.lastEvent) + '</div>' +
        '</div>' +
        briefHtml + tasksHtml + newsSecHtml + chronicleHtml + dynHtml +
        injectHtml +
      '</div>';
  }

  // ---- 紧张度变化检测（localStorage 对比上次查看） ----
  function detectTensionDelta(panel, cur) {
    const el = panel.querySelector('#twDelta');
    if (!el) return;
    let last = null;
    try { last = JSON.parse(localStorage.getItem(TENSION_VIEW_KEY) || 'null'); } catch (e) {}
    if (!last || typeof last.value !== 'number') {
      el.textContent = '—';
    } else {
      const diff = cur - last.value;
      if (diff > 0) { el.textContent = '↑ +' + diff; el.className = 'tw-delta delta-up'; }
      else if (diff < 0) { el.textContent = '↓ ' + diff; el.className = 'tw-delta delta-down'; }
      else { el.textContent = '→ 0'; el.className = 'tw-delta delta-flat'; }
    }
    try { localStorage.setItem(TENSION_VIEW_KEY, JSON.stringify({ value: cur, at: Date.now() })); } catch (e) {}
  }

  // ---- 打开 / 关闭窗口 ----
  async function openTensionWindow() {
    closeTensionWindow();
    const d = extractTensionData(readStatData());
    // ★ 分工（v2）：世界态势不再从旧《动态剧情》条目读取（由「纪元触发器」输出），窗口/注入只保留数值与现状层
    // ★ 窗口预览：读取《纪元触发器》条目并渲染其实际输出（仅显示，不注入 AI 上下文）
    try { d.eraText = await loadEraTriggerText(); } catch (e) { d.eraText = ''; }
    ensureTensionStyle();
    const doc = outerDoc();
    const $mask = $(doc.createElement('div')).attr('class', 'tw-mask');
    $mask.html('<div class="tw-panel"><div class="tw-scroll">' + buildWindowHtml(d) + '</div></div>');
    $(outerBody()).append($mask);
    const panel = $mask.find('.tw-panel')[0];
    detectTensionDelta(panel, d.tension);
    // 动态剧情超过可视区（约 300 字）时，提示可向下滚动查看完整世界态势
    const dynEl = panel.querySelector('.tw-dyn');
    if (dynEl && dynEl.scrollHeight > dynEl.clientHeight) {
      const hint = doc.createElement('div');
      hint.className = 'tw-dyn-hint';
      hint.textContent = '▾ 已显示部分（约 300 字），向下滚动查看完整世界态势';
      dynEl.parentNode.insertBefore(hint, dynEl.nextSibling);
    }
    $mask.on('click', function (e) { if (e.target === $mask[0]) closeTensionWindow(); });
    $(panel).find('.tw-close').on('click', closeTensionWindow);
    $(panel).find('#twInjectCtx').on('change', function () { injectToContext = this.checked; saveInjectSettings(); });
  }

  function closeTensionWindow() {
    try {
      const mask = outerDoc().querySelector('.tw-mask');
      if (mask) mask.remove();
    } catch (e) {}
  }

  $(init);
})();
