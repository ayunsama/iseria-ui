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
 * 培养成长（与「变量更新规则·家族」一致）：
 *   - 每月按投入档位积累成长点：≥100铜盾=1点/月，≥500=2点/月，≥2000=4点/月，不足100=0点
 *   - 每满 12 点 → 方向属性池轮转 +1（武技:力量/敏捷/体质 魔法:智力/感知 学识:智力/感知/魅力
 *     商业:魅力/感知/智力 骑术:敏捷/体质/力量 信仰:感知/魅力/体质 综合:六维）
 *   - 轮转游标 = 培养记录条数（每结算一月追加一条记录）
 *   - 余额不足全额投入 → 本期成长停滞（记录资金不足，不扣款）
 *
 * 手动补结算：状态栏「🏪 产业」页签按钮 → eventEmit('产业结算_手动处理') →
 *   updateVariablesWith(message -1) 走同一结算函数（楼层级快照）。
 */
(function () {
  'use strict';

  const TAG = '[产业结算]';
  const GROWTH_THRESHOLD = 12;   // 每满 12 成长点 = 属性 +1
  const RECORD_KEEP = 20;        // 每名成员培养记录最多保留条数

  const 培养方向属性池 = {
    '武技': ['力量', '敏捷', '体质'],
    '魔法': ['智力', '感知'],
    '学识': ['智力', '感知', '魅力'],
    '商业': ['魅力', '感知', '智力'],
    '骑术': ['敏捷', '体质', '力量'],
    '信仰': ['感知', '魅力', '体质'],
    '综合': ['力量', '敏捷', '体质', '智力', '感知', '魅力']
  };

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
  function tierPointsPerMonth(invest) {
    if (invest >= 2000) return 4;
    if (invest >= 500) return 2;
    if (invest >= 100) return 1;
    return 0;
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

        const invest = num(plan.每期投入);
        if (invest <= 0) continue;   // 挂名无投入：不扣款不成长

        const cost = invest * months;
        const moneyNow = num(statData.主角 && statData.主角.资产与能力 ? statData.主角.资产与能力.货币 : 0) + moneyDelta;
        if (moneyNow < cost) {
          appendCultivationRecord(m, dateStr, plan.方向 + '培养停滞×' + months + '月', '资金不足（需' + cost + '铜盾），本期无成长');
          console.warn(TAG + ' 培养费用不足：' + name + ' 需 ' + cost + ' 铜盾，当前可用 ' + moneyNow);
          continue;
        }
        moneyDelta -= cost;

        const tier = tierPointsPerMonth(invest);
        const gains = [];
        if (tier > 0) {
          const pool = 培养方向属性池[plan.方向] || 培养方向属性池['综合'];
          let progress = num(plan.成长进度) + tier * months;
          const granted = Math.floor(progress / GROWTH_THRESHOLD);
          if (granted > 0) {
            progress -= granted * GROWTH_THRESHOLD;
            if (!isPlainObject(m.基础属性)) m.基础属性 = {};
            const cursor = Array.isArray(m.培养记录) ? m.培养记录.length : 0;
            for (let i = 0; i < granted; i++) {
              const attr = pool[(cursor + i) % pool.length];
              m.基础属性[attr] = num(m.基础属性[attr]) + 1;
              gains.push(attr + '+1');
            }
          }
          plan.成长进度 = progress;
        }
        appendCultivationRecord(m, dateStr, plan.方向 + '培养×' + months + '月（投入' + cost + '铜盾）',
          gains.length > 0 ? gains.join(' ') : '积累成长点中（' + num(plan.成长进度) + '/' + GROWTH_THRESHOLD + '）');
        pendingRecords.push({
          类型: '金盾支出',
          金额: -cost,
          说明: name + '的培养费用（' + plan.方向 + '×' + months + '月）'
        });
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
