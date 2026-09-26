/**
 * 产业结算脚本（产业收益自动补算 + 家族儿女培养周期成长）
 *
 * 数据模型：
 *   stat_data.产业.{产业名} = { 类型, 结算周期(每月/每季度), 每期收益(铜盾,可为负), 上次结算('圣光历YYYY年M月'), 状态(运营中/停业/升级中), ... }
 *   stat_data.家族.成员.{姓名} = { 存亡, 培养计划:{ 方向, 每期投入, 成长进度, 上次结算 }, 培养记录:[...], 基础属性, ... }
 *
 * 设计范式（对齐「自动升级脚本.js」）：
 *   1. 挂载 Mvu.events.VARIABLE_UPDATE_ENDED，框架直接给 (当前, 变更前) 全量快照，只原地修改 stat_data
 *   2. 防重入锁，避免脚本改动再次触发本事件导致死循环（结算后 各锚点=当前月 → 下轮期数=0 自然幂等）
 *   3. 时间源：世界.日期 字符串（'圣光历1497年1月1日'，容忍缺省日），与「纪元触发器」同款解析
 *   4. 结算锚点：每产业 各自的 上次结算；每成员培养计划 各自的 上次结算（月度周期）
 *      - 锚点为空 = 首次见到 → 只设锚不结算（购置当期不入账，从次期起算）
 *      - 每月产业：期数 = 月差；每季度产业：期数 = floor(月差/3)（锚定上次结算，跨年正确）
 *   5. 金额单位：铜盾（1金盾=1000铜盾，1银盾=100铜盾）；入账类型=产业收益，培养扣款类型=金盾支出
 *
 * 培养成长（与「变量更新规则·家族」一致）——成长由资质/年龄/方向契合的概率判定决定，金钱只维持培养：
 *   - 每月判定一次，成功率(%) = 资质基础率(低劣30/平庸45/普通55/优秀70/卓越85/天才100)
 *     × 方向契合(魔法有回路×1.1、无回路×0.8；武技/骑术 力量或敏捷≥13 ×1.1)
 *     × 年龄段(<3岁×0.4、3-5岁×0.7、6-12岁×1.0、13-16岁×1.25、≥17岁×1.0)
 *     × 费用系数(有生活费×1.0、家中自行指点×0.8)，再 ×0.25 缩放，clamp 5%~90%
 *   - 判定成功 → 方向属性池轮转 +1，并有 35% 概率习得/提升方向技能（技能≤5级）
 *   - 生活费不足全额 → 本月培养停滞（记录资金不足，不扣款）；多付不会加速成长
 *
 * 手动补结算：状态栏「🏪 产业」页签按钮 → eventEmit('产业结算_手动处理') →
 *   updateVariablesWith(message -1) 走同一结算函数（楼层级快照）。
 */
(function () {
  'use strict';

  const TAG = '[产业结算]';
  const RECORD_KEEP = 20;        // 每名成员培养记录最多保留条数
  const SKILL_MAX_LV = 5;        // 技能等级上限
  const SKILL_LEARN_CHANCE = 0.35; // 属性成长成功时习得/提升技能的概率
  const GROWTH_SCALE = 0.25;     // 成长概率缩放系数

  const 培养方向属性池 = {
    '武技': ['力量', '敏捷', '体质'],
    '魔法': ['智力', '感知'],
    '信仰': ['感知', '魅力'],
    '学识': ['智力'],
    '商业': ['魅力', '智力'],
    '技艺': ['敏捷', '感知'],
    '综合': ['力量', '敏捷', '体质', '智力', '感知', '魅力']
  };

  // 方向技能池（「综合」从全部池中随机习得）
  const 培养技能池 = {
    '武技': [{ n: '基础剑术', d: '挥砍与格挡的基本功' }, { n: '体术', d: '拳脚与摔技' }, { n: '战阵操典', d: '队列与号令的纪律' }],
    '魔法': [{ n: '冥想', d: '凝聚法力的入门功法' }, { n: '元素亲和', d: '感知元素脉动的呼吸法' }, { n: '咏唱基础', d: '标准咒文的发音与节奏' }],
    '信仰': [{ n: '祷言', d: '诵念神明的祈祷文' }, { n: '仪轨', d: '仪式流程与禁忌' }, { n: '圣典诵读', d: '经文的诵读与理解' }],
    '学识': [{ n: '读写', d: '通用语的识字与书写' }, { n: '算术', d: '账目与度量衡' }, { n: '博物杂记', d: '地理与生物见闻' }],
    '商业': [{ n: '记账', d: '进出货与账簿打理' }, { n: '鉴赏', d: '货物成色与估价' }, { n: '讨价还价', d: '市集砍价的技巧' }],
    '技艺': [{ n: '锻造手艺', d: '打铁修械的手上功夫' }, { n: '骑乘', d: '马背平衡与控缰' }, { n: '驯兽', d: '安抚与驱使牲畜' }, { n: '灵巧手艺', d: '烹饪缝纫开锁等杂学' }]
  };
  const 全技能池 = Object.keys(培养技能池).reduce(function (acc, k) { return acc.concat(培养技能池[k]); }, []);
  const 资质成长率 = { '低劣': 30, '平庸': 45, '普通': 55, '优秀': 70, '卓越': 85, '天才': 100 };

  let isProcessing = false;

  // ---------- 工具 ----------
  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }
  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  // '圣光历1497年1月1日' → 连续月索引（容忍缺省月/日）；无法解析返回 null
  function parseDateMonths(str) {
    const m = /圣光历\s*(\d+)\s*年(?:\s*(\d+)\s*月)?/.exec(String(str || ''));
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const mo = m[2] !== undefined ? parseInt(m[2], 10) : 1;
    if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
    return y * 12 + (mo - 1);
  }
  function monthIndexToStr(idx) {
    const y = Math.floor(idx / 12);
    const mo = idx % 12 + 1;
    return '圣光历' + y + '年' + mo + '月';
  }
  // 记录ID：真实时间戳 YYYYMMDD-HHmm-序号（与状态栏 trackPush 同风格）
  function genRecordId(seq) {
    const d = new Date();
    const p2 = n => String(n).padStart(2, '0');
    return '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + '-' + p2(seq);
  }
  function appendCultivationRecord(member, time, content, effect) {
    if (!Array.isArray(member.培养记录)) member.培养记录 = [];
    member.培养记录.push({ 时间: time || '', 内容: content, 效果: effect });
    if (member.培养记录.length > RECORD_KEEP) member.培养记录 = member.培养记录.slice(-RECORD_KEEP);
  }
  // 成员年龄（周岁）：按 出生年月日 vs 世界.日期
  function memberAge(m, nowStr) {
    const b = /圣光历\s*(\d+)\s*年\s*(\d+)?\s*月?\s*(\d+)?/.exec(String(m.出生年月日 || ''));
    const n = /圣光历\s*(\d+)\s*年\s*(\d+)?/.exec(String(nowStr || ''));
    if (!b || !n) return null;
    const by = parseInt(b[1], 10), bmo = parseInt(b[2] || 1, 10);
    const ny = parseInt(n[1], 10), nmo = parseInt(n[2] || 1, 10);
    let age = ny - by;
    if (nmo < bmo) age -= 1;
    return Math.max(0, age);
  }
  // 本月成长概率(%)：资质基础率 × 方向契合 × 年龄段 × 费用系数 × 0.25，clamp 5%~90%
  function growthChance(m, plan, nowStr) {
    const apt = 资质成长率[(m.资质 && m.资质.等级)] || 45;
    let f = 1;
    const dir = plan.方向;
    if (dir === '魔法') f *= (m.魔力回路 && m.魔力回路.品阶 && m.魔力回路.品阶 !== '无回路') ? 1.1 : 0.8;
    else {
      // 其余方向：主属性（方向池首项）≥13 视为契合 ×1.1
      const pool = 培养方向属性池[dir];
      if (pool && pool.length) {
        const a = isPlainObject(m.基础属性) ? m.基础属性 : {};
        if (num(a[pool[0]]) >= 13) f *= 1.1;
      }
    }
    const age = memberAge(m, nowStr);
    if (age !== null) {
      if (age < 3) f *= 0.4;
      else if (age < 6) f *= 0.7;
      else if (age >= 13 && age < 17) f *= 1.25;
    }
    if (num(plan.每期投入) <= 0) f *= 0.8;   // 家中自行指点
    return Math.max(5, Math.min(90, Math.round(apt * f * GROWTH_SCALE)));
  }
  // 方向池轮转 +1 属性（游标=成长进度累计）
  function grantAttribute(m, plan) {
    const pool = 培养方向属性池[plan.方向] || 培养方向属性池['综合'];
    const cursor = num(plan.成长进度);
    const attr = pool[cursor % pool.length];
    if (!isPlainObject(m.基础属性)) m.基础属性 = {};
    m.基础属性[attr] = num(m.基础属性[attr]) + 1;
    plan.成长进度 = cursor + 1;
    return attr + '+1';
  }
  // 习得/提升方向技能（≤5级）；已满级返回 null
  function grantSkill(m, dir) {
    let pool = (dir === '综合' || !培养技能池[dir]) ? 全技能池 : 培养技能池[dir];
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (!isPlainObject(m.技能)) m.技能 = {};
    const cur = m.技能[pick.n];
    if (isPlainObject(cur)) {
      if (num(cur.等级) >= SKILL_MAX_LV) return null;
      cur.等级 = num(cur.等级) + 1;
      return '「' + pick.n + '」Lv.' + cur.等级;
    }
    m.技能[pick.n] = { 描述: pick.d, 等级: 1 };
    return '习得「' + pick.n + '」';
  }

  // ---------- 结算主函数：原地修改 statData，返回是否发生改动 ----------
  function settleStatData(statData) {
    if (!isPlainObject(statData)) return false;
    const world = statData.世界;
    const dateStr = world ? world.日期 : '';
    const cur = parseDateMonths(dateStr);
    if (cur === null) return false;   // 时间无法解析（如异界/特殊剧情），跳过结算

    let changed = false;
    let moneyDelta = 0;
    const pendingRecords = [];   // { 类型, 金额, 说明 }

    // ========== 产业收益补算 ==========
    const industries = statData.产业;
    if (isPlainObject(industries)) {
      for (const name of Object.keys(industries)) {
        const ind = industries[name];
        if (!isPlainObject(ind)) continue;
        const period = ind.结算周期 === '每季度' ? 3 : 1;
        const income = num(ind.每期收益);
        const lastStr = typeof ind.上次结算 === 'string' ? ind.上次结算.trim() : '';

        if (!lastStr) {
          // 首次见到：只设锚（购置当期不入账，从次期起算）
          ind.上次结算 = monthIndexToStr(cur);
          changed = true;
          continue;
        }
        const last = parseDateMonths(lastStr);
        if (last === null) { ind.上次结算 = monthIndexToStr(cur); changed = true; continue; }
        if (cur <= last) continue;   // 未到结算期 / 时间倒退（回溯存档）不补算

        // 停业/升级中的产业不产生收益，但锚点照常推进（避免复业时一次性补算巨额）
        const operating = !ind.状态 || ind.状态 === '运营中';
        const periods = Math.floor((cur - last) / period);
        if (periods < 1) continue;
        ind.上次结算 = monthIndexToStr(last + periods * period);
        changed = true;

        if (operating && income !== 0) {
          const amount = Math.round(income * periods);
          moneyDelta += amount;
          pendingRecords.push({
            类型: '产业收益',
            金额: amount,
            说明: name + '（' + (ind.结算周期 || '每月') + '×' + periods + '）收益结算入账'
          });
        }
      }
    }

    // ========== 家族儿女培养周期成长 ==========
    const family = statData.家族;
    const members = family && isPlainObject(family.成员) ? family.成员 : null;
    if (members) {
      for (const name of Object.keys(members)) {
        const m = members[name];
        if (!isPlainObject(m)) continue;
        if (m.存亡 && m.存亡 !== '在世') continue;   // 已故/失踪/已独立 不培养
        const plan = m.培养计划;
        if (!isPlainObject(plan) || !plan.方向) continue;

        const anchor = typeof plan.上次结算 === 'string' ? plan.上次结算.trim() : '';
        if (!anchor) { plan.上次结算 = monthIndexToStr(cur); changed = true; continue; }
        const last = parseDateMonths(anchor);
        if (last === null) { plan.上次结算 = monthIndexToStr(cur); changed = true; continue; }
        if (cur <= last) continue;
        const months = cur - last;
        plan.上次结算 = monthIndexToStr(cur);
        changed = true;

        const fee = num(plan.每期投入);
        const cost = fee * months;
        const moneyNow = num(statData.主角 && statData.主角.资产与能力 ? statData.主角.资产与能力.货币 : 0) + moneyDelta;
        if (cost > 0 && moneyNow < cost) {
          appendCultivationRecord(m, dateStr, plan.方向 + '培养停滞×' + months + '月', '生活费不足（需' + cost + '铜盾），本月无成长');
          console.warn(TAG + ' 培养生活费不足：' + name + ' 需 ' + cost + ' 铜盾，当前可用 ' + moneyNow);
          continue;
        }
        if (cost > 0) moneyDelta -= cost;

        // 成长判定：逐月掷定（成功率由 资质×年龄×契合 决定，与生活费多少无关）
        const prob = growthChance(m, plan, dateStr);
        const gains = [];
        const skillMsgs = [];
        for (let i = 0; i < months; i++) {
          if (Math.random() * 100 < prob) {
            gains.push(grantAttribute(m, plan));
            if (Math.random() < SKILL_LEARN_CHANCE) {
              const sk = grantSkill(m, plan.方向);
              if (sk) skillMsgs.push(sk);
            }
          }
        }
        const effect = gains.length > 0 ? gains.join(' ') : ('平稳成长（天赋约' + prob + '%/月）');
        appendCultivationRecord(m, dateStr,
          plan.方向 + '培养×' + months + '月' + (cost > 0 ? '（生活费' + cost + '铜盾）' : '（家中自行指点）'),
          effect + (skillMsgs.length > 0 ? '；' + skillMsgs.join('；') : ''));
        if (cost > 0) {
          pendingRecords.push({
            类型: '金盾支出',
            金额: -cost,
            说明: name + '的培养生活费（' + plan.方向 + '×' + months + '月）'
          });
        }
      }
    }

    // ========== 写流水账 + 货币结算 ==========
    if (pendingRecords.length === 0 && moneyDelta === 0) return changed;

    if (!isPlainObject(world.追踪记录)) world.追踪记录 = {};
    let running = num(statData.主角 && statData.主角.资产与能力 ? statData.主角.资产与能力.货币 : 0);
    let seq = 1;
    for (const rec of pendingRecords) {
      running += rec.金额;
      world.追踪记录[genRecordId(seq++)] = {
        时间: dateStr || '',
        类型: rec.类型,
        金额: rec.金额,
        物品: '',
        数量: 0,
        余额: running,
        说明: rec.说明 || ''
      };
    }
    if (moneyDelta !== 0) {
      if (!isPlainObject(statData.主角)) statData.主角 = {};
      if (!isPlainObject(statData.主角.资产与能力)) statData.主角.资产与能力 = {};
      statData.主角.资产与能力.货币 = Math.max(0, running);
    }
    return true;
  }

  // ---------- 事件处理 ----------
  function handleUpdate(rawVariables) {
    if (isProcessing) { return; }
    isProcessing = true;
    try {
      const statData = rawVariables && rawVariables.stat_data;
      if (!statData) return;
      if (settleStatData(statData)) {
        console.log(TAG + ' 本轮结算完成（产业收益/培养成长已写入）');
      }
    } catch (e) {
      console.error(TAG + ' 结算出错:', e);
    } finally {
      isProcessing = false;
    }
  }

  // 手动补结算（状态栏按钮触发；走楼层级快照独立写回）
  function manualSettle() {
    updateVariablesWith(variables => {
      if (variables && variables.stat_data) {
        const changed = settleStatData(variables.stat_data);
        console.log(TAG + ' 手动结算' + (changed ? '完成' : '：无待结算项'));
      }
      return variables;
    }, { type: 'message', message_id: -1 });
    if (typeof toastr !== 'undefined') toastr.success('[产业结算] 结算已执行');
  }

  // ---------- 事件注册 ----------
  const init = async () => {
    await waitGlobalInitialized('Mvu');
    eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, handleUpdate);
    eventOn('产业结算_手动处理', manualSettle);
    console.log(TAG + ' 已加载（产业月/季度自动补算 · 家族培养周期成长）');
  };

  $(init);
})();
