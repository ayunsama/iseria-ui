/* 管线自测：不接 LLM，验证 环境桩+真实脚本+应用器+记账+守卫 的端到端行为
 * 用法: node sim/pipeline-test.cjs
 */
const fs = require('fs');
const path = require('path');
const yaml = require('C:/Users/Administrator/Desktop/编写模板/node_modules/yaml');
const _ = require('C:/Users/Administrator/Desktop/编写模板/node_modules/lodash');
const env = require('./env.cjs');
const mvu = require('./mvu.cjs');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}

const initial = yaml.parse(fs.readFileSync(path.join(__dirname, '../../yiseliya/dist/伊瑟利亚/初始变量'), 'utf8'));
env.initEnv(initial);
mvu.registerMvuSchema(env.getRegisteredSchema());
env.setApplier({
  extractCommands: m => mvu.extractCommands(m),
  applyCommands: (s, c) => mvu.applyCommands(s, c),
  parseMessageToData: (m, s) => mvu.parseMessageToData(m, s)
});

(async () => {
  await new Promise(r => setTimeout(r, 400));   // 等 $(init) 注册
  await env.eventEmit('CHAT_CHANGED', 0);
  const stat = env.variables.chat;
  // 开局设定
  stat.主角.基础信息.姓名 = '凯尔';
  stat.主角.基础信息.资质 = { 等级: '优秀', 描述: '', 经验获取效率: 125 };
  stat.主角.资产与能力.货币 = 10000;

  // ═══ 测试1：AI 回复（基础获取 + 未解释货币 + 物品获得） ═══
  const reply1 = '凯尔挥剑斩杀了野狼。\n<UpdateVariable><Analysis>击败野狼获得经验与战利品</Analysis>'
    + '<JSONPatch>['
    + '{"op":"replace","path":"/主角/基础状态/经验值/基础获取","value":150},'
    + '{"op":"delta","path":"/主角/资产与能力/货币","value":500},'
    + '{"op":"insert","path":"/主角/资产与能力/物品栏/狼皮","value":{"物品大类":"材料","品阶":"普通","数量":2}}'
    + ']</JSONPatch></UpdateVariable>';
  const before1 = env.getAllVariables().stat_data;
  const r1 = await env.Mvu.__driveUpdate(stat, before1, reply1);
  const P = stat.主角;
  check('T1a 经验结算 150×125%=187', P.基础状态.经验值.当前 === 187, P.基础状态.经验值.当前);
  check('T1b 基础获取已清零', P.基础状态.经验值.基础获取 === 0);
  const track = stat.世界.追踪记录;
  const recs = Object.values(track);
  const expRec = recs.find(r => r.类型 === '经验获取');
  const moneyRec = recs.find(r => r.类型 === '货币变动' && r.金额 === 500);
  const itemRec = recs.find(r => r.类型 === '物品获得' && r.物品 === '狼皮');
  check('T1c 经验流水(金额187,含效率说明)', expRec && expRec.金额 === 187 && expRec.说明.includes('125%'), expRec);
  check('T1d 未解释货币+500自动记账', !!moneyRec, recs.map(r => r.类型 + r.金额));
  check('T1e 物品获得狼皮×2自动记账', !!itemRec && itemRec.数量 === 2, itemRec);
  check('T1f zod校验通过(applied=3)', r1.applied.length === 3 && r1.errors.length === 0, r1.errors);

  // ═══ 测试2：AI 试图写流水（应被状态栏守卫丢弃）+ 非法数值（应被 zod 拒绝） ═══
  const reply2 = '我记录一下账目。\n<UpdateVariable><Analysis>记流水</Analysis>'
    + '<JSONPatch>['
    + '{"op":"insert","path":"/世界/追踪记录/20260101-0000-01","value":{"时间":"第1天","类型":"金盾入账","金额":100,"物品":"","数量":0,"余额":10500,"说明":"AI伪造"}},'
    + '{"op":"replace","path":"/主角/基础状态/经验值/升级所需","value":"这不是数字"}'
    + ']</JSONPatch></UpdateVariable>';
  const before2 = env.getAllVariables().stat_data;
  const r2 = await env.Mvu.__driveUpdate(stat, before2, reply2);
  check('T2a AI两条命令全被守卫拦截(applied=0)', r2.applied.length === 0, { applied: r2.applied.length, dropped: r2.dropped.length, errors: r2.errors });
  check('T2b 流水无AI伪造条目', !Object.values(stat.世界.追踪记录).some(r => r.说明 === 'AI伪造'));
  check('T2c 升级所需未被改写(守卫拦截)', stat.主角.基础状态.经验值.升级所需 === 200, stat.主角.基础状态.经验值.升级所需);

  // ═══ 测试3：产业收益结算（跨3个月）+ 记账不重复 ═══
  stat.产业 = { '面包坊': { 类型: '商铺', 位置: '石桥镇', 描述: '', 结算周期: '每月', 每期收益: 30000, 上次结算: '', 状态: '运营中', 购入价: 0, 其他说明: '' } };
  stat.世界.日期 = '圣光历1499年4月1日';
  const before3 = env.getAllVariables().stat_data;
  await env.Mvu.__driveUpdate(stat, before3, '');
  // 首见设锚不入账
  check('T3a 首见设锚', stat.产业['面包坊'].上次结算 === '圣光历1499年4月');
  stat.世界.日期 = '圣光历1499年7月1日';
  const money7a = stat.主角.资产与能力.货币;
  const before3b = env.getAllVariables().stat_data;
  await env.Mvu.__driveUpdate(stat, before3b, '');
  const money7b = stat.主角.资产与能力.货币;
  check('T3b 产业收益+90000', money7b === money7a + 90000, { a: money7a, b: money7b });
  const industryRecs = Object.values(stat.世界.追踪记录).filter(r => r.类型 === '产业收益');
  check('T3c 产业收益流水1条', industryRecs.length === 1, industryRecs.length);
  // 幂等
  const before3c = env.getAllVariables().stat_data;
  await env.Mvu.__driveUpdate(stat, before3c, '');
  check('T3d 幂等：不再入账', stat.主角.资产与能力.货币 === money7b);

  // ═══ 测试4：意图注入器（战斗关键词 → 注入战斗协议+骰值表） ═══
  const payload = { chat: [
    { role: 'system', content: '系统设定' },
    { role: 'user', content: '我看到一头巨熊，拔剑开打！' }
  ] };
  await env.eventEmit('CHAT_COMPLETION_PROMPT_READY', payload);
  const injected = payload.chat[payload.chat.length - 1].content;
  check('T4a 注入战斗协议', injected.includes('回合协议·战斗') && injected.includes('战斗结算规则'), injected.slice(0, 80));
  check('T4b 不再自产骰值表(条款来自世界书,骰值由预设骰子池供数)', injected.includes('回合骰值表·最高优先级') || !injected.includes('【回合骰值表】'));
  check('T4c 注入NPC输出规则', injected.includes('NPC与敌人输出') && injected.includes('[NPC角色/敌人输出规则]'));
  // 去重：再次相同 payload（含已注入标记）→ 不重复追加
  const lenBefore = payload.chat.length;
  await env.eventEmit('CHAT_COMPLETION_PROMPT_READY', payload);
  check('T4d 指纹去重不重复注入', payload.chat.length === lenBefore, { before: lenBefore, after: payload.chat.length });

  // ═══ 测试5：家族出生+培养结算联动（首见设锚 → 次月扣款成长） ═══
  stat.家族 = { 谱系说明: '', 成员: { '艾莉丝': {
    称谓: '女儿', 世代: '子辈', 性别: '女', 种族: '人类', 出生年月日: '圣光历1497年4月8日', 存亡: '在世',
    所在地: '', 身份: '幼女', 好感度: 70, 资质: { 等级: '优秀', 描述: '', 经验获取效率: 125 },
    魔力回路: { 品阶: '普通', 描述: '' }, 等阶: '普通',
    基础属性: { 力量: 6, 敏捷: 7, 体质: 7, 智力: 11, 感知: 9, 魅力: 10, 未分配点数: 0 },
    技能: {}, 培养计划: { 方向: '魔法', 期望职业: '咒印师', 每期投入: 2000, 成长进度: 0, 上次结算: '', 说明: '' },
    培养记录: [], 描述: ''
  } } };
  stat.世界.日期 = '圣光历1499年8月1日';
  const before5 = env.getAllVariables().stat_data;
  await env.Mvu.__driveUpdate(stat, before5, '');
  const alice = stat.家族.成员['艾莉丝'];
  check('T5a-1 首见设锚', alice.培养计划.上次结算 === '圣光历1499年8月');
  stat.世界.日期 = '圣光历1499年9月1日';
  const before5b = env.getAllVariables().stat_data;
  await env.Mvu.__driveUpdate(stat, before5b, '');
  const feeRecs = Object.values(stat.世界.追踪记录).filter(r => r.说明 && r.说明.includes('培养'));
  check('T5a 培养扣款流水(-2000)', feeRecs.length === 1 && feeRecs[0].金额 === -2000, feeRecs);
  check('T5b 培养锚点推进至9月', alice.培养计划.上次结算 === '圣光历1499年9月');
  check('T5c 培养记录1条', alice.培养记录.length === 1, alice.培养记录);

  // ═══ 测试6：状态变量输出 EJS 渲染（真实模板） ═══
  const ejsLib = require('./ejs.cjs');
  const book = env.loadWorldbook();
  const varEntry = book.find(e => e.comment === '变量列表');
  const rendered = ejsLib.renderEntry(varEntry.content, stat);
  check('T6a 变量列表渲染成功', rendered.length > 200 && !rendered.includes('【EJS渲染失败'), rendered.slice(0, 60));
  check('T6b 渲染含家族/产业段', rendered.includes('家族（至亲谱系') && rendered.includes('产业（主角名下资产'));

  console.log('\n===== 管线自测: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' 项失败' : '  ✅ 全部通过') + ' =====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('自测异常:', e); process.exit(1); });
