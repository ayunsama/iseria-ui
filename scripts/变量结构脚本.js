// @ts-nocheck —— 酒馆运行时脚本：依赖酒馆注入的全局 z/_/$ 与远程 CDN import，本地 TS 不检查
/**
 * 职业变量结构（D&D 职业制体系）—— 纯 Schema 定义
 *
 * 职责单一：只定义并注册变量结构，不含任何升级/计算逻辑。
 *   - 升级逻辑见「职业升级脚本.js」
 *   - 初始值种子见「变量初始化_职业体系.yaml」
 *
 * 关键：使用框架封装的 registerMvuSchema(Schema)，它会正确挂在 stat_data 下。
 *   ✗ 不要用裸的 registerVariableSchema(Schema, { type: 'message' })
 *     —— 那会注册到 message 根级、层级不对，把 stat_data 塌成 true。
 *
 * 数据模型：stat_data.{世界, 主角, 英灵, 主要NPC, 同伴}
 */
import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';
// --- 工具函数（对齐 mvuzod.js 的宽容输入风格，旧档类型不匹配时回退默认值而非丢数据） ---
const str = (val = '') => z.string().prefault(val);
const clampNum = (defaultVal, min, max) => z.coerce.number().prefault(defaultVal).transform(v => _.clamp(v, min, max));
const isPlainObject = v => !!v && 'object' === typeof v && !Array.isArray(v);
const safeStr = (val = '') => z.preprocess(v => 'string' === typeof v ? v : val, z.string());
const safeNum = (val = 0) => z.preprocess(v => {
  if ('number' === typeof v) return Number.isFinite(v) ? v : val;
  if ('string' === typeof v) {
    const t = v.trim();
    if (!t) return val;
    const n = Number(t);
    return Number.isFinite(n) ? n : val;
  }
  return val;
}, z.number());
// --- 宽松「名称→描述」容器（词条/特殊机制/情境效果复用）---
// 兼容三种写法，统一归一化为 {名称: 描述} 的 record<string,string>：
//   - record: { "水系术式检定": "+2" }
//   - 数组:   ["水系术式检定+2", "水系魔法伤害额外+1d6"] → 自动命名 条目1/条目2
//   - 字符串: "潮汐稳定：..." → 自动命名为 效果
const 宽松效果条 = z.preprocess(
  (val) => {
    if (val === undefined || val === null) return val;
    if ('string' === typeof val) return val.trim() ? { 效果: val.trim() } : {};
    if (Array.isArray(val)) {
      const out = {};
      val.forEach((item, idx) => {
        if ('string' === typeof item && item.trim()) out[`条目${idx + 1}`] = item.trim();
        else if (isPlainObject(item)) Object.assign(out, item);
      });
      return out;
    }
    if (isPlainObject(val)) return _.mapValues(val, v => 'string' === typeof v ? v : String(v));
    return val;
  },
  z.record(z.string(), z.string())
).prefault({});
// --- 六维属性 ---
const 六维 = { 力量: 10, 敏捷: 10, 体质: 10, 智力: 10, 感知: 10, 魅力: 10 };
// --- 资质条（主角/同伴共用；兼容旧档字符串 → 归一化为对象） ---
// 字段：等级（默认平庸；低劣/普通/优秀/卓越/天才，由高到低影响 经验获取效率）、
//       描述（副词段，说明该资质的成长倾向）、经验获取效率（百分比，100=基准）
const 资质条 = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return v;
    if ('string' === typeof v) return { 等级: v, 描述: '', 经验获取效率: 100 };
    if (isPlainObject(v)) return v;
    return v;
  },
  z.object({
    等级: str('平庸').transform(v => ['低劣', '平庸', '普通', '优秀', '卓越', '天才'].includes(v) ? v : '平庸'),
    描述: str(''),
    经验获取效率: safeNum(100)
  }).prefault({})
).prefault({});
// --- 追踪记录条目（世界.追踪记录 容器；AI 按「变量更新规则」用 insert 写入，状态栏只读显示流水账） ---
// 类型=「经验获取」：金额=经验增量（正整数，非金盾）；物品/数量 填 0/''；余额 恒填 -1（与货币无关）
const 追踪记录条 = z.object({
  时间: str(''),
  类型: str('其他').transform(v => ['金盾入账', '金盾支出', '购买物品', '出售物品', '更换物品', '物品获得', '物品失去', '经验获取', '货币变动', '其他'].includes(v) ? v : '其他'),
  金额: safeNum(0),    // 货币金额（入账+，支出-）；类型=经验获取 时=经验增量（非金盾）
  物品: str(''),
  数量: safeNum(0),    // 物品数量（获得+，失去-）
  余额: safeNum(-1),   // 货币变动后的当前值（-1=未知/与货币无关，如经验获取条），状态栏货币一键修正用（自动跳过 -1 与经验获取条）
  说明: str('')
}).prefault({});
const 资源条 = () => z.object({
  当前: safeNum(0),
  最大: safeNum(0)
}).prefault({}).transform(r => ({
  最大: Math.max(0, r.最大),
  当前: _.clamp(r.当前, 0, Math.max(0, r.最大))
}));
// --- 职业信息条：{ 等级, 技能点, grantedLv, grantedSp, 风格 } ---
// grantedLv/grantedSp 是升级脚本的保底追踪字段（默认 -1=未追踪，脚本会自动补齐）。
// 必须在 schema 显式声明：嵌套 z.object 默认 strip，若不声明，AI 每次变量更新校验时会把这些字段剥掉，
// 导致升级保底追踪失效、每轮重复补发的老 bug 复发。
// 风格：自创职业的成长风格（武技/魔法/神术/混合），由状态栏弹窗让玩家选择后写入（升级脚本据此成长）。
const 职业条 = z.object({
  等级: clampNum(1, 0, 999),
  技能点: safeNum(0).transform(v => Math.max(0, Math.floor(v))),
  grantedLv: safeNum(-1),
  grantedSp: safeNum(-1),
  风格: str('')
}).prefault({});
// --- 通用「名称→{描述,等级}」技能类容器 ---
const 描述等级条 = z.object({
  描述: str(''),
  等级: safeNum(0)
}).prefault({});
const 魔法神术条 = z.object({
  描述: str(''),
  消耗MP: safeNum(0),
  等级: safeNum(0)
}).prefault({});
// --- 物品栏单条（主角/同伴共用）——
// 裸定义（未 prefault，可被 .extend 使用；装备栏槽位在此基础扩展）
// ★ 面板效果数值加成（状态栏装备/卸下自动生效）：值为纯数字（"2"、"+3"、"1.5"）时按键映射加成——
//   防御值→角色.防御值；HP上限/MP上限/SP上限→基础状态.X.最大；力量/敏捷/体质/智力/感知/魅力→基础属性.X
const 物品条定义 = z.object({
  物品大类: str('一般物品').transform(v => ['武器', '防具', '饰品', '消耗品', '材料', '一般物品'].includes(v) ? v : '一般物品'),
  品阶: str('普通').transform(v => ['普通', '精良', '稀有', '史诗', '传说', '神话', '唯一'].includes(v) ? v : '普通'),
  装备位: str('无').transform(v => ['无', '头部', '颈部', '躯干', '腿部', '双手'].includes(v) ? v : '无'),
  面板效果: z.record(z.string(), z.string()).prefault({}),
  附加词条: 宽松效果条,
  特别机制: str(''),   // 装备独有机制/特殊效果（纯文本记录；战斗轮"力量清单"强制引用，如「每击杀+1怒气」「豁免一次致盲」）
  数量: clampNum(1, 0, 99999),
  其它说明: str(''),
  // 锁定标记（状态栏 UI 写入；AI 命令以 _ 开头会被 zod 拒绝更新。显式声明防嵌套 strip 剥掉导致锁定丢失）
  _锁定: z.boolean().prefault(false)
});
// 带默认值的物品条（物品栏使用）
const 物品条 = 物品条定义.prefault({});
// 装备栏槽位条 = 物品条 + 物品名；空对象 {} 表示未装备（strictObject 保证空槽不被填充默认值）
const 装备物品条 = 物品条定义.extend({ 物品名: str('') });
const 装备槽位条 = z.union([
  z.strictObject({}).prefault({}),
  装备物品条.prefault({})
]).prefault({});
// --- 角色公共块（基础属性 / 基础状态），主角与同伴复用 ---
// ★ 只读说明：本块被 主角/同伴/契约兽 共用，不能在 schema 层做"仅主角只读"。
//   「总等级」「经验值.升级所需」的只读由状态栏在命令层硬拦截实现（COMMAND_PARSED 过滤，
//   仅匹配 主角.基础状态.* 前缀；同伴/契约兽不拦截，AI 按规则自觉遵守）——见「核心/状态栏」。
const 基础属性块 = z.object({
  ..._.mapValues(六维, () => z.coerce.number().prefault(10)),
  未分配点数: safeNum(0)
}).prefault({});
const 基础状态块 = z.object({
  HP: 资源条(),
  MP: 资源条(),
  SP: 资源条(),
  自身状态: z.record(z.string().describe('状态名'), z.object({ 描述: str('') }).prefault({})).prefault({}),
  经验值: z.object({
    当前: safeNum(0),
    升级所需: clampNum(100, 1, 1e12)   // 脚本托管：升级脚本按总等级公式强制计算，AI 禁改（主角另有命令层硬拦截）
  }).prefault({}),
  // 职业信息: { 职业名: { 等级, 技能点 } } —— 升级脚本据此 diff
  职业信息: z.record(z.string().describe('职业名'), 职业条).prefault({}),
  冒险者等级: str('F'),
  总等级: clampNum(1, 0, 9999),        // 脚本托管：升级脚本按职业等级总和强制校准，AI 禁改（主角另有命令层硬拦截）
  待分配职业等级: safeNum(0)
}).prefault({});
// --- 主 Schema：对应 stat_data.* ---
const Schema = z.object({
  世界: z.object({
    日期: str('圣光历1497年1月1日'),
    时间: str('清晨'),
    天气: str('晴'),
    当前位置: str(''),
    当前地点: str(''),
    // 四传奇觉醒（AI 可见可写：由剧情决定 true/false；true=已获得命格。
    // EJS 切换规则：紧张度 >85 或 四传奇觉醒.角色名 = true → 输出「获得命格后」，否则「获得命格前」）
    四传奇觉醒: z.record(z.string().describe('传奇名'), z.boolean()).prefault({}),
    // 世界见闻：世界整体概况 + 各地动态新闻
    世界见闻: z.object({
      世界概况: str(''),
      动态新闻: z.record(z.string().describe('新闻标题'), z.object({
        内容: str(''),
        日期: str(''),
        重要性: str('普通').transform(v => ['极高', '高', '普通', '低'].includes(v) ? v : '普通'),
        来源: str(''),
        是否过期: str('否'),
        相关地点: str(''),
        相关势力: str('')
      }).prefault({})).prefault({})
    }).prefault({}),
    // 追踪记录（AI 可见可写，按「变量更新规则·追踪记录」insert 流水账；状态栏只读显示）
    追踪记录: z.record(z.string().describe('记录ID（如 20260827-1432-01）'), 追踪记录条).prefault({})
  }).prefault({}),
  主角: z.object({
    基础信息: z.object({
      姓名: str(''),  // 主角名（角色关系图中心节点显示）
      种族: str(''),
      种族修正: str(''),
      信仰: str('无信仰'),
      信仰简述: str(''),
      性别: str(''),
      年龄: safeNum(0),
      资质: 资质条,  // 资质系统：等级（默认平庸；低劣/普通/优秀/卓越/天才，由高到低影响经验获取效率）+描述(副词段)+效率%
      魔力回路: z.object({
        品阶: str('无回路').transform(v => ['无回路', '低劣', '普通', '优良', '稀有', '完美'].includes(v) ? v : '无回路'),
        描述: str('')
      }).prefault({}),
      // 战斗方式（玩家在状态栏设定；AI 战斗时按此倾向行动。AI 不得改写，仅玩家可改）
      战斗方式: str('')
    }).prefault({}),
    等阶: str('普通'),   // 新增：主角等阶
    防御值: safeNum(10),  // 主角防御值（装备面板效果可自动加成到此变量）
    基础属性: 基础属性块,
    基础状态: 基础状态块,
    资产与能力: z.object({
      货币: safeNum(0),
      物品栏: z.record(z.string().describe('物品名'), 物品条).prefault({}),
      // 装备栏：固定5个部位槽位（头部/颈部/躯干/腿部/双手），空对象 {} 表示未装备
      // 每个槽位 = 物品条 + 物品名（物品名用于卸下时退回物品栏）
      装备栏: z.object({
        头部: 装备槽位条,
        颈部: 装备槽位条,
        躯干: 装备槽位条,
        腿部: 装备槽位条,
        双手: 装备槽位条
      }).prefault({}),
      角色技能: z.record(z.string().describe('技能名'), 描述等级条).prefault({}),
      魔法栏: z.record(z.string().describe('魔法名'), 魔法神术条).prefault({}),
      神术栏: z.record(z.string().describe('神术名'), 魔法神术条).prefault({}),
      加护: z.record(z.string().describe('加护名'), 描述等级条).prefault({}),
      权能: z.record(z.string().describe('权能名'), z.object({ 描述: str('') }).prefault({})).prefault({}),
      奥义: z.record(z.string().describe('奥义名'), z.object({ 描述: str(''), 消耗SP: safeNum(0), 消耗MP: safeNum(0) }).prefault({})).prefault({})
    }).prefault({}),
    任务: z.record(z.string().describe('任务名'), z.object({
      等级: str('普通'), 类型: str('讨伐'), 来源: str(''),
      内容: str(''), 预估报酬: str(''), 状态: str('进行中')
    }).prefault({})).prefault({})
  }).prefault({}),
  英灵: z.object({
    名称: str(''),
    残响之力: clampNum(0, 0, 100),
    状态: str('苏醒'),
    // ── 英灵共鸣系统 v2（AI 可见可写，规则见「变量更新规则·英灵」）──
    // 羁绊值：与当前契主英灵的羁绊（互动/共斗/完成其执念累积，0~100）
    羁绊值: clampNum(0, 0, 100),
    // 被动效果：随羁绊解锁的常驻加成 { 被动名: 效果描述 }（规则见「英灵被动与执念表」）
    被动效果: z.record(z.string().describe('被动名'), str('')).prefault({}),
    // 执念：当前契主英灵未竟的执念与进度（AI 按剧情推进，完成时写 是否完成+完成奖励）
    执念: z.object({
      内容: str(''),
      进度: clampNum(0, 0, 100),
      是否完成: z.boolean().prefault(false),
      完成奖励: str('')
    }).prefault({}),
    // 英灵技：当前契主英灵的大招记录（释放条件=残响之力100 且 状态=苏醒 且 冷却=0）
    英灵技: z.object({
      名称: str(''),
      冷却: safeNum(0),       // 剩余冷却（场次/天数，按规则递减；0=可用）
      已释放: safeNum(0)      // 累计释放次数（用于莉莉丝式"每多一次沉睡翻倍"的负担结算）
    }).prefault({}),
    // 英灵殿：所有已结识英灵的档案（面板/状态栏读取；AI 只读维护残响/羁绊/状态）
    英灵殿: z.record(z.string().describe('英灵名'), z.object({
      残响: clampNum(0, 0, 100),
      羁绊: clampNum(0, 0, 100),
      状态: str('苏醒'),
      执念完成: z.boolean().prefault(false)
    }).prefault({})).prefault({})
  }).prefault({}),
  主要NPC: z.record(z.string().describe('NPC名'), z.object({
    好感度: clampNum(50, -100, 100),   // -100=血海深仇 → 0=陌生 → 100=生死之交/挚爱
    心里话: str(''),
    出生年月日: str(''),   // 一经确定不再更改（如"圣光历1467年3月1日"）；年龄由状态栏/状态输出按当前日期自动计算
    年龄: clampNum(0, 0, 999),   // 兼容旧数据（脚本派生：有出生年月日时忽略此字段，按日期自动计算）
    身份: str(''),
    当前位置: str(''),    // 所在地（地区/城镇/场所），随剧情移动由 AI 用 replace 更新
    关键事件: str(''),
    关系描述: str(''),
    关系时间线: z.array(z.object({
      时间: str(''),
      事件: str('')
    }).prefault({})).prefault([]),
    关系分类: str('初识').transform(v => ['家人', '盟友', '熟识', '陌生人', '初识', '萍水相逢', '仇敌'].includes(v) ? (v === '萍水相逢' ? '初识' : v) : '初识'),  // 关系图分组标签：家人/盟友/熟识/陌生人/初识/仇敌（萍水相逢=旧名，归一为初识）
  }).prefault({})).prefault({}),
  // 同伴为动态成员，结构与主角对齐（含基础属性/基础状态/职业信息）
  同伴: z.record(z.string().describe('同伴名'), z.object({
    好感度: clampNum(50, 0, 100),
    心里话: str(''),
    // 战斗方式（玩家在状态栏设定；AI 战斗时按此倾向行动：如 正面攻击/伤害性法术为主/辅助施法/游击牵制…；AI 不得改写，仅玩家可改）
    战斗方式: str(''),
    出生年月日: str(''),   // 一经确定不再更改（如"圣光历1467年3月1日"）；年龄由状态栏/状态输出按当前日期自动计算
    年龄: safeNum(0),      // 兼容旧数据（脚本派生：有出生年月日时忽略此字段，按日期自动计算）
    外貌: str(''),
    性格: str(''),
    背景故事: str(''),
    所属势力: str(''),
    种族: str(''),
    身份: str(''),
    当前位置: str(''),    // 所在地（地区/城镇/场所），随剧情移动由 AI 用 replace 更新
    等阶: str('普通'),
    基础属性: 基础属性块,
    基础状态: 基础状态块,
    防御值: safeNum(10),
    技能: z.record(z.string().describe('技能名'), z.object({ 描述: str(''), 等级: safeNum(0) }).prefault({})).prefault({}),
    物品栏: z.record(z.string().describe('物品名'), 物品条).prefault({}),
     // 权能/奥义：同伴为顶层扁平字段（非嵌套 资产与能力），与 主角.资产与能力 内写法对齐但层级不同
     // 权能 = 传说级自悟之力 { 权能名: { 描述 } }；奥义 = 史诗级自悟大招 { 奥义名: { 描述, 消耗SP, 消耗MP } }
     权能: z.record(z.string().describe('权能名'), z.object({ 描述: str('') }).prefault({})).prefault({}),
     奥义: z.record(z.string().describe('奥义名'), z.object({ 描述: str(''), 消耗SP: safeNum(0), 消耗MP: safeNum(0) }).prefault({})).prefault({}),
     // 属性锁定（状态栏 UI 写入，禁止 AI 修改 基础属性/待分配职业等级/职业信息；显式声明防嵌套 strip）
     
     // 装备栏：与主角一致的 5 槽（头部/颈部/躯干/腿部/双手），必须显式声明，同伴块装备栏已声明：防止嵌套 z.object strip 剥掉导致装备写入即消失/跨楼层丢失
     装备栏: z.object({
       头部: 装备槽位条,
       颈部: 装备槽位条,
       躯干: 装备槽位条,
       腿部: 装备槽位条,
       双手: 装备槽位条
     }).prefault({}),
     资质: 资质条,  // 资质系统：等级（默认平庸；低劣/普通/优秀/卓越/天才，由高到低影响经验获取效率）+描述+效率%
          _属性锁定: z.boolean().prefault(false)
  }).prefault({})).prefault({}),
  // 召唤物为动态成员（独立路径 stat_data.召唤物.{名字}）：由召唤法术/规则文档写入。
  // 字段动态多变，用 z.any() 宽容保留全部字段，避免嵌套 strip 剥掉（与文件顶部注释一致）。
  召唤物: z.record(z.string().describe('召唤物名'), z.any()).prefault({}),
  // 契约兽为动态成员（独立路径 stat_data.契约兽.{名字}）：由「NPC以及敌人相关规则」古卷面板一键写入。
  // 兽类独立成长：基础属性/基础状态 复用 主角/同伴 公共块（含 职业信息/经验值/总等级，升级脚本据此 diff 成长），
  // 另显式声明 种族/职业/契约主/体型/元素属性/羁绊/吐息/攻击/能力 等兽类专属字段，防嵌套 z.object strip 剥掉。
  契约兽: z.record(z.string().describe('契约兽名'), z.object({
    种族: str(''),
    职业: str(''),
    契约主: str(''),
    当前位置: str(''),    // 所在地（随主人移动，AI 用 replace 更新）
    等阶: str('普通'),
    等级: clampNum(1, 0, 9999),
    体型: str('中型'),
    元素属性: str('无'),
    羁绊: clampNum(0, 0, 100),
    防御值: safeNum(10),
    移动速度: safeNum(0),
    先攻修正: safeNum(0),
    外貌: str(''),
    性格: str(''),
    所属势力: str(''),
    背景故事: str(''),
    状态: str(''),
    基础属性: 基础属性块,
    基础状态: 基础状态块,
    攻击: z.array(z.object({
      名称: str(''),
      类型: str(''),
      命中: safeNum(0),
      伤害: str(''),
      特效: str('')
    }).prefault({})).prefault([]),
    能力: z.array(z.object({
      名称: str(''),
      描述: str('')
    }).prefault({})).prefault([]),
    吐息: z.union([
      z.object({ 名称: str(''), 元素: str(''), 伤害骰: str(''), 范围: str(''), 冷却: str('') }).prefault({}),
      z.null()
    ]).prefault(null),
    弱点: str(''),
    抗性: str(''),
    免疫: str('')
  }).prefault({})).prefault({}),
  // ── 迷宫状态（AI 可见可写；迷宫数据由「迷宫条目」EJS 按 当前迷宫+当前层 自动渲染注入，
  //    AI 仅见当前层内容，未进入层对其不可见——防超游核心）──
  // 当前迷宫: 空串''=未进入/已离开；值=钢核地脉/沉钟回廊/圣辉陵窟/无光倒影井
  // 当前层: 0=未进入；>0=当前所在层（迷宫条目 EJS 按此渲染对应层数据给 AI 看）
  // 已发现: { 迷宫名: [{ 层, 项 }] }——每层探索到的关键点，AI 写入防重复描述
  迷宫状态: z.object({
    当前迷宫: str(''),
    当前层: clampNum(0, 0, 20),
    已发现: z.record(z.string().describe('迷宫名'), z.array(z.object({
      层: safeNum(0),
      项: str('')
    }).prefault({})).prefault([])).prefault({})
  }).prefault({}),
  // 头像映射表（$前缀：AI不可见，但前端和脚本可读写）
  $avatarMap: z.record(z.string(), z.string()).prefault({}),
  // 状态标记（$前缀：AI 不可见，前端与脚本可读写）
  $flags: z.object({
    lastLocation: z.string().prefault(''),
    // ── 自创职业提示状态（$前缀：AI 不可见不可写，状态栏写入） ──
    // 必须在 schema 显式声明，否则嵌套 z.object 的 strip 会在 AI 变量更新时剥掉这两个记录，
    // 导致重复弹窗/永不检测失效（老 bug 复发）。
    // - 自创职业已提示：玩家点「暂不生成」后记录，避免重复弹窗
    // - 自创职业永不检测：玩家点「永不检测」后记录，彻底不再检测/提示该职业
    自创职业已提示: z.record(z.string(), z.boolean()).prefault({}),
    自创职业永不检测: z.record(z.string(), z.boolean()).prefault({}),
    // ── 紧张度（$前缀：AI 完全不可见不可写，由「紧张度托管脚本」自动结算） ──
    // AI 禁止更新任何以 _ 或 $ 开头的字段；紧张度只读：AI 上下文看不到它，也不会输出它的更新命令。
    紧张度: z.object({
      当前值: clampNum(35, 0, 100),
      等级: str('暗流期'),
      上次触发事件: str('')
    }).prefault({}),
    // 紧张度托管脚本追踪字段（$前缀：AI 不可见，脚本读写）：
    // - 紧张度已结算新闻：Record<新闻标题, number | {v,s}>，记录该新闻已用于紧张度结算（防重复叠加）
    //   兼容两种值：旧档纯数字（视为 {v:数, s:'大陆'}）与脚本当前写入的 {v:影响值, s:影响范围}
    // - 紧张度基线：脚本托管前的紧张度快照，用于脚本增量结算起点
    // 宽容输入：若整体误写成数组/数字等非对象，自动归一化为对象，避免 zod 中断变量更新
    紧张度已结算新闻: z.preprocess(
      (val) => {
        if (val === undefined || val === null) return val;
        if (Array.isArray(val)) {
          const out = {};
          val.forEach((item) => {
            if (Array.isArray(item) && item.length >= 2) out[String(item[0])] = Number(item[1]) || 0;
            else if (item !== undefined && item !== null) out[String(item)] = 0;
          });
          return out;
        }
        if (typeof val === 'object') return val; // 保留 { 标题: number | {v,s} } 原样
        return {};
      },
      z.record(z.string(), z.union([
        z.number(),
        z.object({ v: z.number(), s: z.string() }).passthrough()
      ]))
    ).prefault({}),
    紧张度基线: clampNum(35, 0, 100),
    // 世界大事记（紧张度脚本写入：有影响的新闻自动追加 [{日期,标题,影响}]，最近 60 条）
    紧张度大事记: z.array(z.object({
      日期: str(''),
      标题: str(''),
      影响: safeNum(0)
    }).prefault({})).prefault([]),
    // 年龄成长累计已发放购点（1-18 岁共 20；$前缀：AI 不可见，状态栏托管；只认发放记录，不干扰升级所得属性点）
    年龄成长: safeNum(0),
    // 追踪记录全量开关（$前缀：AI 不可见；状态栏切换。true=状态变量输出全量流水，false=仅最近 5 条省 token）
    追踪记录全量: z.boolean().prefault(false),
    // NPC事项全量开关（$前缀：AI 不可见；状态栏切换。true=主要NPC时间线全量输出，false=每名NPC仅最近 5 条事项省 token）
    NPC事项全量: z.boolean().prefault(false),
    // 死亡旗标（$前缀：AI 上下文不可见但可按条目指令写入；仅限主角——主角确认死亡时置位，是死亡/回溯结算条目的唯一展开闸门，流程落定后复位。同伴/NPC/敌人死亡禁止置位。唯一允许 AI 写入的 $ 字段，见[死亡与回溯规则]）
    死亡: z.boolean().prefault(false)
  }).prefault({}),
  // 变体技能树（$前缀：首页创建器保存，状态栏识别并供学习）
  $customSkillTrees: z.record(z.string().describe('职业名'), z.record(z.string().describe('变体名'), z.object({
    skills: z.array(z.object({
      n: str(''),
      type: str('技能'),
      c: safeNum(1),
      lvl: safeNum(1),
      d: str(''),
      mp: safeNum(0)
    }).prefault({})).prefault([]),
    // 融合技能树元数据（必须在 schema 显式声明，否则会被嵌套 z.object 的 strip 剥掉）：
    // level=继承等级, fusedFrom=源职业[A,B], grantedLv/grantedSp=保底追踪
    level: safeNum(0),
    fusedFrom: z.array(z.string()).prefault([]),
    grantedLv: safeNum(-1),
    grantedSp: safeNum(-1),
    // 自创职业成长风格（武技/魔法/神术/混合）：状态栏弹窗选择后写入，升级脚本据此成长
    风格: str('')
  }).prefault({})).prefault({})).prefault({}),
  // 创建页传奇装备文本（$前缀：开局创建器 saveLegendaryGear 写入。现已在 submitCC 结构化写入 物品栏(品阶:传说)，
  // 此键仅作兼容保留；必须显式声明，否则嵌套 strip 会在 AI 变量更新时剥掉）
  $legendaryGear: z.string().prefault('')
});
// 注册 Schema（框架会正确挂到 stat_data 下）
$(() => {
  registerMvuSchema(Schema);

  // ---- 根容器补全与下线功能数据清理迁移 ----
  // initvar 只在新聊天生效；旧聊天的 stat_data 可能缺某些根容器（如 主要NPC），
  // 缺失时 MVU 对其下路径 insert/assign 会报「父级不可扩展」。此处补齐缺失容器，
  // 并清理已下线功能（领地建设）的残留数据。
  // ★ MVU 的实时 stat_data 存在聊天级变量中（AI 变量更新的实际作用对象），
  //   楼层级只是快照——两层都必须处理，且聊天级走 Mvu 正规读写（同步其内部缓存）。
  // 仅在加载与切换聊天时执行，避开变量更新事件的写入竞争。
  const ROOT_CONTAINERS = ['主要NPC', '同伴', '契约兽', '召唤物', '敌人', '$flags', '$avatarMap'];
  const REMOVED_ROOT_KEYS = ['领地'];
  const REMOVED_FLAG_KEYS = ['领地建设'];
  function cleanStatData(stat) {
    if (!isPlainObject(stat)) return false;
    let changed = false;
    for (const key of ROOT_CONTAINERS) {
      if (stat[key] === undefined) { stat[key] = {}; changed = true; }
    }
    for (const key of REMOVED_ROOT_KEYS) {
      if (stat[key] !== undefined) { delete stat[key]; changed = true; }
    }
    if (isPlainObject(stat.$flags)) {
      for (const key of REMOVED_FLAG_KEYS) {
        if (stat.$flags[key] !== undefined) { delete stat.$flags[key]; changed = true; }
      }
    }
    return changed;
  }
  function migrateStatData() {
    try {
      // 1) 聊天级：MVU 实时状态（AI 变量更新的实际对象）
      if (typeof Mvu !== 'undefined' && typeof Mvu.getMvuData === 'function') {
        const mvuData = Mvu.getMvuData({ type: 'chat' });
        if (cleanStatData(mvuData?.stat_data)) {
          Mvu.replaceMvuData(mvuData, { type: 'chat' });
          console.info('[变量结构] 聊天级 stat_data 根容器补全/下线数据清理完成');
        }
      } else {
        const chatVars = getVariables({ type: 'chat' });
        if (cleanStatData(chatVars?.stat_data)) {
          replaceVariables(chatVars, { type: 'chat' });
          console.info('[变量结构] 聊天级 stat_data 清理完成（无 Mvu 接口，走变量表）');
        }
      }
      // 2) 楼层级：最新楼层快照
      const vars = getVariables({ type: 'message', message_id: 'latest' });
      if (cleanStatData(vars?.stat_data)) {
        replaceVariables(vars, { type: 'message', message_id: 'latest' });
        console.info('[变量结构] 楼层级 stat_data 清理完成');
      }
    } catch (e) {
      console.warn('[变量结构] 根容器迁移失败:', e);
    }
  }
  migrateStatData();
  // 切换聊天时延迟执行：等 MVU 完成聊天变量装载，避免被其内部缓存回写覆盖
  eventOn(tavern_events.CHAT_CHANGED, () => setTimeout(migrateStatData, 1500));
});
