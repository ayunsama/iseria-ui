/* 家族/产业系统 冒烟测试：产业结算脚本（核心逻辑）+ 状态栏AI写入守卫
 * 用法: node 演示/smoke-家族产业.cjs   （全部通过 exit 0，有失败 exit 1）
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const results = [];
function check(name, cond, extra) {
  if (cond) { pass++; results.push('  ✅ ' + name); }
  else { fail++; results.push('  ❌ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

// ============================================================
// 第一部分：产业结算脚本
// ============================================================
global._ = require('C:/Users/Administrator/Desktop/编写模板/node_modules/lodash');   // 自动记账使用 _.get
global.eventEmit = async () => {};   // 记账的升级联动在单测中跳过
global.eventOn = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
global.waitGlobalInitialized = async () => {};
global.toastr = { success() {}, info() {}, warn() {}, error() {} };
global.updateVariablesWith = (fn) => { fn({ stat_data: CUR.stat_data }); return Promise.resolve({ stat_data: CUR.stat_data }); };
let handlers = {}, initFn = null, CUR = { stat_data: null };
global.$ = (fn) => { initFn = fn; };
global.Mvu = { events: { VARIABLE_UPDATE_ENDED: 'VUE', COMMAND_PARSED: 'CP' }, getMvuData() { return null; }, replaceMvuData() {} };
console.info = () => {}; console.warn = () => {}; console.error = () => {};
eval(fs.readFileSync(path.join(__dirname, '..', 'scripts', '产业结算脚本.js'), 'utf8'));

function mkIndustry(o) { return Object.assign({ 类型: '商铺', 结算周期: '每月', 每期收益: 30000, 上次结算: '', 状态: '运营中', 购入价: 0, 位置: '', 描述: '', 其他说明: '' }, o); }
function mkMember(o) { return Object.assign({ 称谓: '儿子', 出生年月日: '圣光历1489年1月1日', 存亡: '在世', 资质: { 等级: '天才', 描述: '', 经验获取效率: 160 }, 魔力回路: { 品阶: '普通', 描述: '' }, 基础属性: { 力量: 10, 敏捷: 10, 体质: 10, 智力: 10, 感知: 10, 魅力: 10, 未分配点数: 0 }, 技能: {}, 培养计划: { 方向: '', 期望职业: '', 每期投入: 0, 成长进度: 0, 上次结算: '', 说明: '' }, 培养记录: [] }, o); }
function mkStat(o) {
  o = o || {};
  return { stat_data: Object.assign({
    世界: Object.assign({ 日期: '圣光历1499年7月1日', 追踪记录: {} }, o.世界 || {}),
    主角: Object.assign({ 资产与能力: { 货币: 1000000 } }, o.主角 || {}),
    产业: o.产业 !== undefined ? o.产业 : {},
    家族: o.家族 !== undefined ? o.家族 : { 成员: {} }
  }, o.extra || {}) };
}
function run(stat) { CUR = { stat_data: stat }; for (const fn of (handlers["VUE"] || [])) fn({ stat_data: stat }, { stat_data: stat }); }

(async () => {
  await initFn();

  // ========== A. 正常流 ==========
  {
    const s = mkStat({ 产业: { 面包坊: mkIndustry({ 每期收益: 30000, 上次结算: '圣光历1499年4月' }) }, 主角: { 资产与能力: { 货币: 1000 } } });
    run(s.stat_data);
    check('A1a 月度×3月 收益=90000', s.stat_data.主角.资产与能力.货币 === 91000, s.stat_data.主角.资产与能力.货币);
    check('A1b 锚点推进到7月', s.stat_data.产业['面包坊'].上次结算 === '圣光历1499年7月');
    check('A1c 流水1条(产业收益30000)', Object.values(s.stat_data.世界.追踪记录).filter(r => r.类型 === '产业收益').length === 1);
  }
  {
    const s = mkStat({ 产业: { 矿场: mkIndustry({ 结算周期: '每季度', 每期收益: 90000, 上次结算: '圣光历1496年11月' }) }, 主角: { 资产与能力: { 货币: 0 } } });
    run(s.stat_data); // 1496年11月→1499年7月 = 32个月 → floor(32/3)=10期
    check('A2a 季度跨32月=10期=900000', s.stat_data.主角.资产与能力.货币 === 900000, s.stat_data.主角.资产与能力.货币);
    check('A2b 锚点=上次+30月=1499年5月', s.stat_data.产业['矿场'].上次结算 === '圣光历1499年5月');
  }
  {
    const s = mkStat({
      产业: {
        甲: mkIndustry({ 每期收益: 10000, 上次结算: '圣光历1499年6月' }),
        乙: mkIndustry({ 每期收益: 20000, 上次结算: '圣光历1499年6月' })
      },
      主角: { 资产与能力: { 货币: 5000 } }
    });
    run(s.stat_data);
    const recs = Object.values(s.stat_data.世界.追踪记录);
    check('A3a 两产业各入账 → 货币35000', s.stat_data.主角.资产与能力.货币 === 35000, s.stat_data.主角.资产与能力.货币);
    check('A3b 流水2条且余额递进(15000→35000)', recs.length === 2 && recs[0].余额 === 15000 && recs[1].余额 === 35000, recs.map(r => r.余额));
  }
  {
    let grown = 0, skilled = 0;
    for (let i = 0; i < 50; i++) {
      const s = mkStat({ 家族: { 成员: { 娃: mkMember({ 培养计划: { 方向: '武技', 期望职业: '佣兵', 每期投入: 500, 成长进度: 0, 上次结算: '圣光历1498年7月', 说明: '' } }) } } });
      run(s.stat_data);
      grown += s.stat_data.家族.成员['娃'].培养计划.成长进度;
      skilled += Object.keys(s.stat_data.家族.成员['娃'].技能 || {}).length;
      if (i === 0) {
        check('A4a 扣生活费6000', s.stat_data.主角.资产与能力.货币 === 1000000 - 6000, s.stat_data.主角.资产与能力.货币);
        check('A4b 锚点推进', s.stat_data.家族.成员['娃'].培养计划.上次结算 === '圣光历1499年7月');
        check('A4c 培养记录1条', s.stat_data.家族.成员['娃'].培养记录.length === 1);
      }
    }
    check('A4d 50次平均成长≈3.4点/次(>2为合理)', grown / 50 > 2, (grown / 50).toFixed(2));
    check('A4e 技能有习得(50次累计>30)', skilled > 30, skilled);
  }
  {
    const s = mkStat({
      产业: { 铺: mkIndustry({ 每期收益: 50000, 上次结算: '圣光历1499年6月' }) },
      家族: { 成员: { 娃: mkMember({ 培养计划: { 方向: '魔法', 期望职业: '', 每期投入: 3000, 成长进度: 0, 上次结算: '圣光历1499年6月', 说明: '' } }) } },
      主角: { 资产与能力: { 货币: 10000 } }
    });
    run(s.stat_data);
    check('A5 净额=10000+50000-3000=57000', s.stat_data.主角.资产与能力.货币 === 57000, s.stat_data.主角.资产与能力.货币);
  }
  {
    const s = mkStat({ 产业: { 铺: mkIndustry({ 每期收益: 30000, 上次结算: '圣光历1499年6月' }) }, 家族: { 成员: { 娃: mkMember({ 培养计划: { 方向: '魔法', 期望职业: '', 每期投入: 2000, 成长进度: 0, 上次结算: '圣光历1499年6月', 说明: '' } }) } } });
    run(s.stat_data);
    const money1 = s.stat_data.主角.资产与能力.货币, rec1 = Object.keys(s.stat_data.世界.追踪记录).length, recs1 = s.stat_data.家族.成员['娃'].培养记录.length;
    run(s.stat_data);
    check('A6 幂等：货币/流水/记录均不变', s.stat_data.主角.资产与能力.货币 === money1 && Object.keys(s.stat_data.世界.追踪记录).length === rec1 && s.stat_data.家族.成员['娃'].培养记录.length === recs1);
  }
  {
    let grew = 0;
    for (let i = 0; i < 50; i++) {
      const s = mkStat({ 家族: { 成员: { 娃: mkMember({ 培养计划: { 方向: '魔法', 期望职业: '', 每期投入: 0, 成长进度: 0, 上次结算: '圣光历1498年7月', 说明: '' } }) } } });
      run(s.stat_data);
      grew += s.stat_data.家族.成员['娃'].培养计划.成长进度;
      if (i === 0) check('A7a 生活费0不扣款', s.stat_data.主角.资产与能力.货币 === 1000000);
    }
    check('A7b 自学仍有成长(理论9%/月≈1.1点,>0.5)', grew / 50 > 0.5, (grew / 50).toFixed(2));
  }

  // ========== B. 边界异常 ==========
  {
    const s = mkStat({ 产业: { 铺: mkIndustry({ 上次结算: '圣光历1500年1月' }) } });
    run(s.stat_data);
    check('B1 日期倒退：不结算不崩溃，货币不变', s.stat_data.主角.资产与能力.货币 === 1000000 && s.stat_data.产业['铺'].上次结算 === '圣光历1500年1月');
  }
  {
    const s = mkStat({ 世界: { 日期: '异界纪元·不可名状之时', 追踪记录: {} } });
    run(s.stat_data);
    check('B2 日期无法解析：整体跳过', s.stat_data.主角.资产与能力.货币 === 1000000 && Object.keys(s.stat_data.世界.追踪记录).length === 0);
  }
  {
    const s = mkStat({ 产业: { 铺: mkIndustry({ 上次结算: '垃圾文本@@' }) } });
    run(s.stat_data);
    check('B3 锚点损坏重置为当前月', s.stat_data.产业['铺'].上次结算 === '圣光历1499年7月');
  }
  {
    const s = mkStat({ 产业: { 铺: mkIndustry({ 每期收益: 1000, 上次结算: '圣光历1498年4月' }) }, 主角: { 资产与能力: { 货币: 0 } } });
    run(s.stat_data); // 1498年4月→1499年7月 = 15个月
    check('B4 跨年15月=15000', s.stat_data.主角.资产与能力.货币 === 15000, s.stat_data.主角.资产与能力.货币);
  }
  {
    const s = mkStat({ 产业: { 铺: mkIndustry({ 状态: '停业', 上次结算: '圣光历1499年1月' }) } });
    run(s.stat_data);
    check('B5a 停业无收益', s.stat_data.主角.资产与能力.货币 === 1000000);
    check('B5b 停业锚点推进(防复业爆账)', s.stat_data.产业['铺'].上次结算 === '圣光历1499年7月');
  }
  {
    const s = mkStat({ 产业: { 新铺: mkIndustry({ 上次结算: '' }) } });
    run(s.stat_data);
    check('B6 首见设锚不入账', s.stat_data.产业['新铺'].上次结算 === '圣光历1499年7月' && s.stat_data.主角.资产与能力.货币 === 1000000);
  }
  {
    const s = mkStat({ 产业: { 零收: mkIndustry({ 每期收益: 0, 上次结算: '圣光历1499年6月' }), 亏钱: mkIndustry({ 每期收益: -5000, 上次结算: '圣光历1499年6月' }) }, 主角: { 资产与能力: { 货币: 100000 } } });
    run(s.stat_data);
    check('B7a 0收益无流水', Object.values(s.stat_data.世界.追踪记录).filter(r => r.说明.indexOf('零收') !== -1).length === 0);
    check('B7b 负收益扣款95000', s.stat_data.主角.资产与能力.货币 === 95000, s.stat_data.主角.资产与能力.货币);
  }
  {
    const s = mkStat({ 家族: { 成员: { 娃: mkMember({ 培养计划: { 方向: '魔法', 期望职业: '', 每期投入: 999999, 成长进度: 0, 上次结算: '圣光历1499年6月', 说明: '' } }) } }, 主角: { 资产与能力: { 货币: 1000 } } });
    run(s.stat_data);
    const m = s.stat_data.家族.成员['娃'];
    check('B8 停滞：不扣款+记录+锚点推进', s.stat_data.主角.资产与能力.货币 === 1000 && m.培养记录.length === 1 && m.培养计划.上次结算 === '圣光历1499年7月');
  }
  {
    const s = mkStat({ 家族: { 成员: { 娃: mkMember({ 培养计划: { 方向: '魔法', 期望职业: '', 每期投入: 1000, 成长进度: 0, 上次结算: '圣光历1499年6月', 说明: '' } }) } }, 主角: { 资产与能力: { 货币: 1000 } } });
    run(s.stat_data);
    check('B9 扣到0不透支', s.stat_data.主角.资产与能力.货币 === 0, s.stat_data.主角.资产与能力.货币);
  }
  {
    const s1 = { stat_data: { 世界: { 日期: '圣光历1499年7月1日' } } };
    run(s1.stat_data);
    check('B10a 缺产业/家族/主角容器：安全', true);
    const s2 = mkStat({ 产业: { 脏: mkIndustry({ 每期收益: '30000', 上次结算: '圣光历1499年6月' }) }, 主角: { 资产与能力: { 货币: 0 } } });
    run(s2.stat_data);
    check('B10b 字符串金额正常结算', s2.stat_data.主角.资产与能力.货币 === 30000, s2.stat_data.主角.资产与能力.货币);
    const s3 = mkStat({ 家族: { 成员: { 无计划: mkMember({ 培养计划: null }), 空方向: mkMember({ 培养计划: { 方向: '', 每期投入: 100, 上次结算: '圣光历1499年6月' } }), 已故: mkMember({ 存亡: '已故', 培养计划: { 方向: '魔法', 每期投入: 100, 上次结算: '圣光历1499年6月' } }) } } });
    run(s3.stat_data);
    check('B10c 无计划/空方向/已故 全部跳过', Object.values(s3.stat_data.世界.追踪记录).length === 0);
  }
  {
    let allOk = true;
    for (let i = 0; i < 30; i++) {
      try {
        const s = mkStat({ 家族: { 成员: { 娃: mkMember({ 培养计划: { 方向: '综合', 期望职业: '', 每期投入: 0, 成长进度: 999, 上次结算: '圣光历1499年6月', 说明: '' }, 技能: { '冥想': { 描述: 'x', 等级: 5 }, '记账': { 描述: 'x', 等级: 5 } } }) } } });
        run(s.stat_data);
        const m = s.stat_data.家族.成员['娃'];
        if (!Object.values(m.技能).every(sv => sv.等级 <= 5)) allOk = false;
        if (m.培养计划.成长进度 < 999) allOk = false;
      } catch (e) { allOk = false; }
    }
    check('B11 综合方向+技能满级：30轮不越界不崩溃', allOk);
  }
  {
    const s = mkStat({ 产业: { 铺: mkIndustry({ 每期收益: 100, 上次结算: '圣光历1491年3月' }) }, 家族: { 成员: { 娃: mkMember({ 培养计划: { 方向: '武技', 期望职业: '', 每期投入: 100, 成长进度: 0, 上次结算: '圣光历1491年3月', 说明: '' } }) } } });
    run(s.stat_data);
    check('B12 跨100个月正常完成（产业+培养）', s.stat_data.产业['铺'].上次结算 === '圣光历1499年7月' && s.stat_data.家族.成员['娃'].培养计划.上次结算 === '圣光历1499年7月');
  }
  {
    // ★ 曾发现的真bug：同一真实分钟内两轮结算，流水ID碰撞互相覆盖
    const s = mkStat({ 产业: { 铺: mkIndustry({ 每期收益: 1000, 上次结算: '圣光历1499年6月' }) }, 主角: { 资产与能力: { 货币: 0 } } });
    run(s.stat_data); // 7月入账第1条
    s.stat_data.世界.日期 = '圣光历1499年8月1日'; // AI 再推进一个月（同一真实分钟内）
    CUR = { stat_data: s.stat_data };
    for (const fn of (handlers["VUE"] || [])) fn({ stat_data: s.stat_data }, { stat_data: s.stat_data }); // 8月入账第2条
    const ids = Object.keys(s.stat_data.世界.追踪记录);
    check('B13 同分钟两轮结算流水ID不碰撞(2条)', ids.length === 2, ids);
  }

  // ============================================================
  // 第二部分：状态栏 AI 写入守卫（真实 MVU 点号路径）
  // ============================================================
  const htmlSrc = fs.readFileSync(path.join(__dirname, '..', '状态栏.html'), 'utf8');
  function extractFn(src, name) {
    const idx = src.indexOf('function ' + name + '(');
    if (idx === -1) throw new Error('未找到函数: ' + name);
    let i = src.indexOf('{', idx), depth = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) break; }
    }
    return src.slice(idx, j + 1);
  }
  global._ = require('C:/Users/Administrator/Desktop/编写模板/node_modules/lodash');
  let guardStat = { 世界: { 日期: '圣光历1499年7月1日' }, 家族: { 成员: { '老杰克': { 出生年月日: '圣光历1455年7月20日', 存亡: '在世' } } }, 产业: { 面包坊: { 状态: '运营中', 上次结算: '圣光历1499年6月' } } };
  global.Mvu = { getMvuData() { return { stat_data: guardStat }; }, events: {} };
  global.toastr = { warning() {}, info() {}, success() {}, error() {} };
  eval(extractFn(htmlSrc, 'pathToSegments') + '\n' + extractFn(htmlSrc, 'famBirthFromAge') + '\n' + extractFn(htmlSrc, 'filterFamilyIndustryCommands'));

  function guard(cmds) { const arr = cmds.slice(); filterFamilyIndustryCommands({ stat_data: guardStat }, arr); return arr; }

  // 放行类
  check('C1 放行 insert 新产业', guard([{ type: 'insert', args: ['产业.新铺', { 类型: '商铺' }] }]).length === 1);
  check('C2 放行 replace 产业子字段', guard([{ type: 'replace', args: ['产业.面包坊.描述', 'x'] }]).length === 1);
  check('C3 放行 replace 家族成员存亡', guard([{ type: 'replace', args: ['家族.成员.老杰克.存亡', '已故'] }]).length === 1);
  check('C4 放行 replace 家族.谱系说明', guard([{ type: 'replace', args: ['家族.谱系说明', 'x'] }]).length === 1);
  check('C5 放行 replace 培养计划.期望职业(AI唯一可写)', guard([{ type: 'replace', args: ['家族.成员.老杰克.培养计划.期望职业', '铁匠'] }]).length === 1);
  check('C6 放行 insert 家族成员新技能', guard([{ type: 'insert', args: ['家族.成员.老杰克.技能.锻造手艺', { 描述: '', 等级: 1 }] }]).length === 1);
  check('C7 放行 insert 无出生年月日的新成员(自动换算年龄)', (() => {
    const arr = guard([{ type: 'insert', args: ['家族.成员.小张', { 称谓: '儿子', 年龄: 5 }] }]);
    return arr.length === 1 && arr[0].args[1].出生年月日 === '圣光历1494年7月1日' && !arr[0].args[1].年龄;
  })());
  check('C8 放行 stat_data 前缀斜杠路径', guard([{ type: 'insert', args: ['/stat_data/产业/新铺', {}] }]).length === 1);
  // 拦截类
  check('C9 拦截 remove 产业', guard([{ type: 'remove', args: ['产业.面包坊'] }]).length === 0);
  check('C10 拦截 replace 整个产业条目', guard([{ type: 'replace', args: ['产业.面包坊', { 状态: '运营中' }] }]).length === 0);
  check('C11 拦截 replace 产业.上次结算', guard([{ type: 'replace', args: ['产业.面包坊.上次结算', '圣光历1年1月'] }]).length === 0);
  check('C12 拦截 remove 家族成员', guard([{ type: 'remove', args: ['家族.成员.老杰克'] }]).length === 0);
  check('C13 拦截 replace 整个成员', guard([{ type: 'replace', args: ['家族.成员.老杰克', { 存亡: '在世' }] }]).length === 0);
  check('C14 拦截 replace 培养计划.方向', guard([{ type: 'replace', args: ['家族.成员.老杰克.培养计划.方向', '魔法'] }]).length === 0);
  check('C15 拦截 replace/insert 培养记录', guard([
    { type: 'replace', args: ['家族.成员.老杰克.培养记录', []] },
    { type: 'insert', args: ['家族.成员.老杰克.培养记录.x', {}] }
  ]).length === 0);
  check('C16 拦截 修改已有成员出生年月日', guard([{ type: 'replace', args: ['家族.成员.老杰克.出生年月日', '圣光历1年1月1日'] }]).length === 0);
  check('C17 拦截 写已有出生年月日成员的年龄', guard([{ type: 'replace', args: ['家族.成员.老杰克.年龄', 100] }]).length === 0);
  check('C18 拦截 move 操作', guard([{ type: 'move', args: ['产业.面包坊', '世界.x'] }]).length === 0);
  check('C19 拦截首次出生年月日的 remove', guard([{ type: 'remove', args: ['家族.成员.小新生.出生年月日'] }]).length === 0);
  // 特殊
  check('C20 放行 首次补写出生年月日', guard([{ type: 'replace', args: ['家族.成员.小新生.出生年月日', '圣光历1494年1月1日'] }]).length === 1);
  check('C21 无出生年月日成员写年龄→自动换算', (() => {
    guardStat.家族.成员['小新生'] = { 称谓: '儿子' };
    const arr = guard([{ type: 'replace', args: ['家族.成员.小新生.年龄', 3] }]);
    const ok = arr.length === 1 && arr[0].args[0] === '家族.成员.小新生.出生年月日' && arr[0].args[1] === '圣光历1496年7月1日';
    delete guardStat.家族.成员['小新生'];
    return ok;
  })());

  // ---------- 汇总 ----------
  console.log('\n===== 家族/产业系统 冒烟测试结果 =====');
  results.forEach(r => console.log(r));
  console.log(`\n通过 ${pass} / ${pass + fail}` + (fail ? `  ❌ 失败 ${fail} 项` : '  ✅ 全部通过'));
  process.exit(fail ? 1 : 0);
})();
