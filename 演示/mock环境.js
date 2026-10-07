/* ============================================================
 * 伊瑟利亚 · 家族/产业系统 演示环境（仅用于浏览器本地演示）
 * 模拟酒馆助手 iframe 环境：Mvu / 事件总线 / toastr / 变量接口
 * 真实的「产业结算脚本」会在本环境中加载，结算按钮真实可用
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 演示角标 ----------
  document.addEventListener('DOMContentLoaded', function () {
    var badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:99998;background:rgba(142,68,173,.92);color:#fff;padding:6px 12px;border-radius:20px;font:12px "Microsoft YaHei";box-shadow:0 2px 8px rgba(0,0,0,.3);pointer-events:none;';
    badge.textContent = '🎭 演示环境 · 模拟数据（培养计划 / 补结算按钮真实可用）';
    document.body.appendChild(badge);
  });

  // ---------- 事件总线 ----------
  var __bus = {};
  window.eventOn = function (ev, fn) { (__bus[ev] = __bus[ev] || []).push(fn); return { off: function () {} }; };
  window.eventOnce = window.eventOn;
  window.eventEmit = async function (ev) {
    var args = Array.prototype.slice.call(arguments, 1);
    var list = (__bus[ev] || []).slice();
    for (var i = 0; i < list.length; i++) {
      try { await list[i].apply(null, args); } catch (e) { console.error('[演示事件总线]', ev, e); }
    }
  };

  // ---------- 简易头像（内联 SVG，离线可用） ----------
  function svgAvatar(ch, color) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="10" fill="' + color + '"/><text x="32" y="43" font-size="30" text-anchor="middle" fill="#fff" font-family="Microsoft YaHei">' + ch + '</text></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  // ---------- 模拟变量数据（stat_data） ----------
  var STAT = {
    世界: {
      日期: '圣光历1499年6月18日', 时间: '午后', 天气: '晴',
      当前位置: '阿尔比恩王国·石桥镇', 当前地点: '石桥镇',
      四传奇觉醒: {},
      世界见闻: {
        世界概况: '变革纪第九年，王选内战平息不久，西境商路恢复通行，石桥镇集市重现热闹景象。',
        动态新闻: {
          '西境商路重开': { 内容: '红狮商会重开西境商路，沿途集镇贸易回暖。', 日期: '圣光历1499年6月10日', 重要性: '普通', 来源: '商会公告', 是否过期: '否', 相关地点: '石桥镇', 相关势力: '红狮商会' },
          '北境魔物游荡': { 内容: '北境平原出现零星魔物，冒险者公会发布低阶清剿委托。', 日期: '圣光历1499年5月28日', 重要性: '低', 来源: '冒险者公会', 是否过期: '否', 相关地点: '北境平原', 相关势力: '冒险者公会' }
        }
      },
      追踪记录: {
        '20260614-1032-01': { 时间: '圣光历1499年6月1日', 类型: '产业收益', 金额: 30000, 物品: '', 数量: 0, 余额: 1223450, 说明: '石桥镇面包坊（每月×1）收益结算入账' },
        '20260614-1032-02': { 时间: '圣光历1499年6月1日', 类型: '金盾支出', 金额: -2000, 物品: '', 数量: 0, 余额: 1193450, 说明: '艾莉丝的培养生活费（魔法×1月）' },
        '20260612-0900-01': { 时间: '圣光历1499年5月30日', 类型: '经验获取', 金额: 180, 物品: '', 数量: 0, 余额: -1, 说明: '清理北境魔物·经验结算（基础EXP×资质效率125%）' },
        '20260610-1500-01': { 时间: '圣光历1499年5月30日', 类型: '金盾入账', 金额: 50000, 物品: '', 数量: 0, 余额: 1193450, 说明: '公会悬赏报酬（50金盾）' },
        '20260608-1100-01': { 时间: '圣光历1499年5月28日', 类型: '购买物品', 金额: -1500, 物品: '治疗药水', 数量: 5, 余额: 1143450, 说明: '药房采购（莉娜帮忙挑的）' }
      }
    },
    主角: {
      基础信息: {
        姓名: '凯尔·石桥', 种族: '人类', 种族修正: '', 信仰: '无信仰', 信仰简述: '', 性别: '男', 年龄: 24,
        资质: { 等级: '优秀', 描述: '血脉中潜藏锻造世家的坚韧', 经验获取效率: 125 },
        魔力回路: { 品阶: '稀有', 描述: '回路宽阔而稳定，天生亲和火元素' },
        战斗方式: '正面突破'
      },
      等阶: '超凡', 防御值: 18,
      基础属性: { 力量: 16, 敏捷: 13, 体质: 15, 智力: 12, 感知: 12, 魅力: 11, 未分配点数: 2 },
      基础状态: {
        HP: { 当前: 86, 最大: 86 }, MP: { 当前: 24, 最大: 24 }, SP: { 当前: 40, 最大: 40 }, 自身状态: {},
        经验值: { 当前: 140, 升级所需: 560 },
        职业信息: { '战士': { 等级: 6, 技能点: 2, grantedLv: -1, grantedSp: -1, 风格: '武技' } },
        冒险者等级: 'D', 总等级: 6, 待分配职业等级: 1
      },
      资产与能力: {
        货币: 1223450,
        物品栏: {
          '精炼铁剑': { 物品大类: '武器', 品阶: '精良', 装备位: '双手', 面板效果: {}, 附加词条: [], 特别机制: '', 数量: 1, 其它说明: '家传锻造工艺', _锁定: false },
          '治疗药水': { 物品大类: '消耗品', 品阶: '普通', 装备位: '无', 面板效果: {}, 附加词条: [], 特别机制: '', 数量: 5, 其它说明: '', _锁定: false }
        },
        装备栏: { 头部: {}, 颈部: {}, 躯干: {}, 腿部: {}, 双手: {} },
        角色技能: { '重斩': { 描述: '蓄力一击，可击破盾防', 等级: 3 } },
        魔法栏: {}, 神术栏: {}, 加护: {}, 权能: {}, 奥义: {}
      },
      任务: { '北境魔物清剿': { 等级: '普通', 类型: '讨伐', 来源: '冒险者公会', 内容: '清理北境平原游荡魔物', 预估报酬: '50金盾', 状态: '进行中' } }
    },
    英灵: { 名称: '', 残响之力: 0, 状态: '沉睡', 羁绊值: 0, 被动效果: {}, 执念: { 内容: '', 进度: 0, 是否完成: false, 完成奖励: '' }, 英灵技: { 名称: '', 冷却: 0, 已释放: 0 }, 英灵殿: {} },
    主要NPC: {
      '巴罗·红狮': { 好感度: 55, 心里话: '这年轻人的商铺眼光不错。', 出生年月日: '圣光历1450年2月11日', 身份: '红狮商会会长', 当前位置: '石桥镇', 关键事件: '股权合作', 关系描述: '商会合作伙伴，欣赏主角的经营头脑。', 关系时间线: [{ 时间: '圣光历1498年3月', 事件: '主角购入红狮商会三成股权' }], 关系分类: '盟友' },
      '玛尔塔镇长': { 好感度: 40, 心里话: '', 出生年月日: '圣光历1462年11月3日', 身份: '石桥镇镇长', 当前位置: '石桥镇', 关键事件: '', 关系描述: '镇务往来。', 关系时间线: [], 关系分类: '熟识' }
    },
    家族: {
      谱系说明: '石桥镇铁匠世家——祖父曾是王国锻造大师；如今以铁匠铺、商铺与商会股权立足镇上。',
      成员: {
        '老汤姆': {
          称谓: '祖父', 世代: '祖辈', 性别: '男', 种族: '人类', 出生年月日: '圣光历1425年3月9日', 存亡: '已故', 所在地: '', 身份: '王国锻造大师（追授）', 好感度: 80,
          资质: { 等级: '优秀', 描述: '', 经验获取效率: 125 }, 魔力回路: { 品阶: '普通', 描述: '' }, 等阶: '普通',
          基础属性: { 力量: 14, 敏捷: 10, 体质: 12, 智力: 12, 感知: 11, 魅力: 10, 未分配点数: 0 },
          培养计划: { 方向: '', 每期投入: 0, 成长进度: 0, 上次结算: '', 说明: '' }, 培养记录: [],
          描述: '留下「锤不离手」的家训与一间老铺，是家族的骄傲。'
        },
        '老杰克': {
          称谓: '父亲', 世代: '父母辈', 性别: '男', 种族: '人类', 出生年月日: '圣光历1455年7月20日', 存亡: '在世', 所在地: '石桥镇', 身份: '退役老兵/铁匠铺老板', 好感度: 65,
          资质: { 等级: '平庸', 描述: '', 经验获取效率: 100 }, 魔力回路: { 品阶: '无回路', 描述: '' }, 等阶: '普通',
          基础属性: { 力量: 13, 敏捷: 9, 体质: 12, 智力: 10, 感知: 11, 魅力: 10, 未分配点数: 0 },
          培养计划: { 方向: '', 每期投入: 0, 成长进度: 0, 上次结算: '', 说明: '' }, 培养记录: [],
          描述: '沉默寡言，左腿有旧伤；把家业交给了主角。'
        },
        '玛莎': {
          称谓: '母亲', 世代: '父母辈', 性别: '女', 种族: '人类', 出生年月日: '圣光历1458年3月14日', 存亡: '在世', 所在地: '石桥镇', 身份: '家庭主妇', 好感度: 72,
          资质: { 等级: '平庸', 描述: '', 经验获取效率: 100 }, 魔力回路: { 品阶: '无回路', 描述: '' }, 等阶: '普通',
          基础属性: { 力量: 9, 敏捷: 10, 体质: 10, 智力: 11, 感知: 12, 魅力: 13, 未分配点数: 0 },
          培养计划: { 方向: '', 每期投入: 0, 成长进度: 0, 上次结算: '', 说明: '' }, 培养记录: [],
          描述: '总担心主角在外面吃不饱，每周塞一篮腌肉。'
        },
        '莉娜': {
          称谓: '妹', 世代: '同辈', 性别: '女', 种族: '人类', 出生年月日: '圣光历1482年2月2日', 存亡: '在世', 所在地: '石桥镇', 身份: '药房学徒', 好感度: 80,
          资质: { 等级: '普通', 描述: '', 经验获取效率: 110 }, 魔力回路: { 品阶: '低劣', 描述: '' }, 等阶: '普通',
          基础属性: { 力量: 8, 敏捷: 11, 体质: 9, 智力: 13, 感知: 12, 魅力: 12, 未分配点数: 0 },
          培养计划: { 方向: '', 每期投入: 0, 成长进度: 0, 上次结算: '', 说明: '' }, 培养记录: [],
          描述: '在镇上药房当学徒，梦想开一间自己的药店。'
        },
        '罗莎': {
          称谓: '配偶', 世代: '同辈', 性别: '女', 种族: '人类', 出生年月日: '圣光历1477年9月30日', 存亡: '在世', 所在地: '石桥镇', 身份: '面包师', 好感度: 88,
          资质: { 等级: '优秀', 描述: '', 经验获取效率: 125 }, 魔力回路: { 品阶: '普通', 描述: '' }, 等阶: '普通',
          基础属性: { 力量: 9, 敏捷: 12, 体质: 10, 智力: 12, 感知: 11, 魅力: 14, 未分配点数: 0 },
          培养计划: { 方向: '', 每期投入: 0, 成长进度: 0, 上次结算: '', 说明: '' }, 培养记录: [],
          描述: '与主角成婚时带来了她的手艺与嫁妆——面包坊的方子。'
        },
        '艾莉丝': {
          称谓: '女儿', 世代: '子辈', 性别: '女', 种族: '人类', 出生年月日: '圣光历1497年4月8日', 存亡: '在世', 所在地: '石桥镇', 身份: '幼女', 好感度: 78,
          资质: { 等级: '优秀', 描述: '承袭父母双方的优良血脉', 经验获取效率: 125 },
          魔力回路: { 品阶: '普通', 描述: '回路雏形稳定，元素亲和偏火' },
          等阶: '普通',
          基础属性: { 力量: 6, 敏捷: 7, 体质: 7, 智力: 11, 感知: 9, 魅力: 10, 未分配点数: 0 },
          技能: { '冥想': { 描述: '凝聚法力的入门功法', 等级: 2 }, '咏唱基础': { 描述: '标准咒文的发音与节奏', 等级: 1 } },
          培养计划: { 方向: '魔法', 期望职业: '咒印师', 每期投入: 2000, 成长进度: 2, 上次结算: '圣光历1499年6月', 说明: '启蒙教育，重在智力与感知' },
          培养记录: [
            { 时间: '圣光历1499年6月1日', 内容: '魔法培养×1月（生活费2000铜盾）', 效果: '平稳成长（天赋约8%/月）' },
            { 时间: '圣光历1499年5月1日', 内容: '魔法培养×1月（生活费2000铜盾）', 效果: '智力+1' },
            { 时间: '圣光历1499年4月1日', 内容: '魔法培养×1月（生活费2000铜盾）', 效果: '习得「咏唱基础」' },
            { 时间: '圣光历1499年3月1日', 内容: '魔法培养×1月（生活费2000铜盾）', 效果: '智力+1' }
          ],
          描述: '出生时啼哭响亮，对炉火的光芒特别着迷。'
        },
        '小杰': {
          称谓: '儿子', 世代: '子辈', 性别: '男', 种族: '人类', 出生年月日: '圣光历1498年9月2日', 存亡: '在世', 所在地: '石桥镇', 身份: '婴孩', 好感度: 70,
          资质: { 等级: '卓越', 描述: '罕见的血统返祖', 经验获取效率: 145 },
          魔力回路: { 品阶: '低劣', 描述: '回路细弱，尚待观察' },
          等阶: '普通',
          基础属性: { 力量: 7, 敏捷: 7, 体质: 8, 智力: 8, 感知: 8, 魅力: 8, 未分配点数: 0 },
          培养计划: { 方向: '', 每期投入: 0, 成长进度: 0, 上次结算: '', 说明: '' }, 培养记录: [],
          描述: '还在襁褓中，哭声却意外洪亮。'
        }
      }
    },
    产业: {
      '石桥镇面包坊': { 类型: '商铺', 位置: '石桥镇集市街', 描述: '罗莎亲手打理，带两名学徒', 结算周期: '每月', 每期收益: 30000, 上次结算: '圣光历1499年6月', 状态: '运营中', 购入价: 200000, 其他说明: '' },
      '红狮商会股权（三成）': { 类型: '股权', 位置: '石桥镇商会', 描述: '红狮商会三成股份，按月分红', 结算周期: '每月', 每期收益: 300000, 上次结算: '圣光历1499年5月', 状态: '运营中', 购入价: 8000000, 其他说明: '会长巴罗承诺优先分红' },
      '北境麦田（四十亩）': { 类型: '田地', 位置: '北境平原', 描述: '佃农代耕，收成随年景波动', 结算周期: '每季度', 每期收益: 45000, 上次结算: '圣光历1499年5月', 状态: '运营中', 购入价: 600000, 其他说明: '' },
      '石桥渡口船运': { 类型: '船运', 位置: '石桥渡口', 描述: '内河货运船队，正逢枯水期歇业整修', 结算周期: '每月', 每期收益: 22000, 上次结算: '圣光历1499年4月', 状态: '停业', 购入价: 500000, 其他说明: '预计秋季复业' }
    },
    召唤物: {}, 契约兽: {},
    迷宫状态: { 当前迷宫: '', 当前层: 0, 已发现: {} },
    $avatarMap: {
      '凯尔·石桥': svgAvatar('凯', '#8e44ad'),
      '老汤姆': svgAvatar('汤', '#7f8c8d'),
      '老杰克': svgAvatar('杰', '#a0522d'),
      '玛莎': svgAvatar('玛', '#c94f7c'),
      '莉娜': svgAvatar('莉', '#16a085'),
      '罗莎': svgAvatar('罗', '#e67e22'),
      '艾莉丝': svgAvatar('艾', '#d4a017'),
      '小杰': svgAvatar('小', '#2980b9'),
      '巴罗·红狮': svgAvatar('巴', '#c0392b'),
      '玛尔塔镇长': svgAvatar('玛', '#5d6d7e')
    },
    $flags: { lastLocation: '石桥镇', 自创职业已提示: {}, 自创职业永不检测: {}, 紧张度: { 当前值: 38, 等级: '暗流期', 上次触发事件: '' }, 紧张度已结算新闻: {}, 紧张度基线: 35, 紧张度大事记: [], 年龄成长: 0, 追踪记录全量: false, NPC事项全量: false, 死亡: false },
    $customSkillTrees: {}, $legendaryGear: ''
  };
  window.__STAT = STAT;

  // ---------- Mvu 桩（getMvuData 返回共享对象，改动即时生效） ----------
  function fireUpdateEnded() {
    setTimeout(function () {
      var list = (__bus['VARIABLE_UPDATE_ENDED'] || []).slice();
      for (var i = 0; i < list.length; i++) {
        try { list[i]({ stat_data: STAT }, { stat_data: STAT }); } catch (e) { console.error('[演示·VARIABLE_UPDATE_ENDED]', e); }
      }
    }, 60);
  }
  window.Mvu = {
    events: {
      VARIABLE_UPDATE_ENDED: 'VARIABLE_UPDATE_ENDED',
      VARIABLE_UPDATE_STARTED: 'VARIABLE_UPDATE_STARTED',
      COMMAND_PARSED: 'COMMAND_PARSED',
      GENERATION_ENDED: 'GENERATION_ENDED',
      MESSAGE_SENT: 'MESSAGE_SENT',
      MESSAGE_RECEIVED: 'MESSAGE_RECEIVED'
    },
    getMvuData: function () { return { initialized_lorebooks: {}, stat_data: STAT }; },
    replaceMvuData: function (data, opts) {
      console.info('[演示·Mvu.replaceMvuData]', (opts && opts.type) || 'message');
      fireUpdateEnded();
      return Promise.resolve(true);
    },
    setMvuVariable: function () { return Promise.resolve(); }
  };

  // ---------- 变量接口桩 ----------
  window.getAllVariables = function () { return { stat_data: STAT }; };
  window.getVariables = function () { return { stat_data: STAT }; };
  window.replaceVariables = function (vars) { console.info('[演示·replaceVariables]', vars && Object.keys(vars)); return true; };
  window.updateVariablesWith = function (fn) {
    try { fn({ stat_data: STAT }); } catch (e) { console.error('[演示·updateVariablesWith]', e); }
    fireUpdateEnded();
    return Promise.resolve({ stat_data: STAT });
  };
  window.insertOrAssignVariables = function () { return Promise.resolve(); };

  // ---------- 环境接口桩 ----------
  window.waitGlobalInitialized = async function () {};
  window.errorCatched = function (fn) {
    return function () {
      try {
        var r = fn.apply(this, arguments);
        if (r && typeof r.catch === 'function') r.catch(function (e) { console.error('[演示·异步错误]', e); });
        return r;
      } catch (e) { console.error('[演示·errorCatched]', e); }
    };
  };

  // ---------- toastr 桩（右上角提示条） ----------
  (function () {
    var colors = { success: '#27ae60', info: '#2980b9', warning: '#e67e22', error: '#c0392b' };
    var box = null;
    function ensureBox() {
      if (box) return box;
      box = document.createElement('div');
      box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;max-width:360px;';
      (document.body || document.documentElement).appendChild(box);
      return box;
    }
    function show(type, msg, title) {
      var d = document.createElement('div');
      d.style.cssText = 'background:' + (colors[type] || '#333') + ';color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;font-family:"Microsoft YaHei";box-shadow:0 4px 12px rgba(0,0,0,.25);opacity:0;transition:opacity .25s;word-break:break-all;line-height:1.6;';
      d.innerHTML = '<b>' + (title || '') + '</b>' + String(msg).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      ensureBox().appendChild(d);
      requestAnimationFrame(function () { d.style.opacity = '1'; });
      setTimeout(function () { d.style.opacity = '0'; setTimeout(function () { d.remove(); }, 300); }, type === 'error' ? 6000 : 3800);
    }
    window.toastr = {
      success: function (m, t) { show('success', m, t); },
      info: function (m, t) { show('info', m, t); },
      warning: function (m, t) { show('warning', m, t); },
      error: function (m, t) { show('error', m, t); }
    };
  })();

  // ---------- 聊天消息桩 ----------
  window.createChatMessages = function (msgs) {
    (msgs || []).forEach(function (m) { toastr.info(String(m.message || '').slice(0, 160), '[演示] 已模拟发送系统消息'); });
    return Promise.resolve();
  };
  window.sendSystemMessage = function () { toastr.info('[演示] 已模拟发送系统消息'); return Promise.resolve(); };
  window.injectPrompts = function (p) { console.info('[演示·injectPrompts]', p); return Promise.resolve(); };
  window.triggerSlash = function () { return Promise.resolve(''); };

  console.info('%c[演示环境] 模拟酒馆助手环境注入完成：真实状态栏 + 真实产业结算脚本', 'color:#8e44ad;font-weight:bold');
})();
