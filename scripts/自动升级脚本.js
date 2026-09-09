/**
 * 职业升级脚本（D&D 职业制变量体系）
 *
 * 数据模型：stat_data.主角 / stat_data.同伴[名字]
 *   角色.基础属性.{力量,敏捷,体质,智力,感知,魅力}
 *   角色.基础状态.{HP,MP,SP,经验值,职业信息:{职业名:{等级,技能点}},总等级,...}
 *   角色.等阶：由总等级决定（普通/超凡/精英/史诗/传说/神话）
 *
 * 设计范式（对齐「辅助计算脚本.js」的正确写法）：
 *   1. 挂载 Mvu.events.VARIABLE_UPDATE_ENDED，框架直接给 (当前, 变更前) 全量快照
 *   2. 只原地修改 stat_data，不自行 getVariables / replaceVariables / updateVariablesWith
 *   3. 防重入锁，避免脚本改动再次触发本事件导致死循环
 *   4. 不使用 registerVariableSchema —— 错误层级的 schema 会把 stat_data 塌成 true
 *   5. 结构初始化交给「变量初始化_职业体系.yaml」，脚本只做增量守卫
 *
 * 升级触发：AI 提升 角色.基础状态.职业信息[职业].等级 → 脚本按 diff 补 HP/MP/SP/技能点
 * 技能点规则：只减不增（等级未变却增加技能点 → 回滚到变更前的值）
 *
 * 经验系统全自动：
 *   - 升级所需经验 = 三次加速多项式 200 + 60(n-1) + 18(n-1)^2 + 6(n-1)^3（前期平缓后期陡升），由脚本强制计算，不依赖外部设置
 *   - 每次变量更新后自动检查，若当前经验 ≥ 所需，则扣除所需并升级（总等级+1、待分配职业等级+1、属性点+1/2）
 *   - 溢出经验保留，可连续升级
 *
 * 等阶自动计算：
 *   - 根据总等级自动设置角色的等阶字段
 *
 * 【防双重升级机制】
 *   - 检测到职业等级提升时，脚本会先将 HP/MP/SP 及技能点恢复为升级前的旧值，
 *     然后重新逐级应用成长，避免 AI 在命令中已修改过的资源值与脚本成长叠加。
 *
 * 【转职 / 兼职机制】
 *   - 转职 = 移除旧职业 + 新增新职业（如 无职业 → 战士）。
 *     新职业严格继承被移除职业的等级（总等级在转职前后保持不变：写低自动补足、写高强制扣回），
 *     资源按延续等级满骰重建，旧职业技能点作废，新职业技能点由脚本按延续等级发放。
 *   - 兼职 = 保留旧职业并新增职业。恢复旧资源后叠加新职业的随机成长，绝不清零已有资源。
 *   - 兜底保护：任何因移除职业导致的总等级下降都会被自动补回。
 */
(function () {
  'use strict';

  let isProcessing = false;
  // 融合职业元数据缓存：stat_data.$customSkillTrees，供融合职业成长推导使用
  let _customTrees = {};

  function safeParseInt(v, def = 0) {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? def : n;
  }

  // D&D 属性调整值：floor((属性-10)/2)
  function getAbilityModifier(v) {
    return Math.floor((safeParseInt(v, 10) - 10) / 2);
  }

  // 掷骰：支持 "d10" / "2d6" / "d8+1"
  // 若 useMax=true 则返回骰面最大值（用于新角色初始化，避免随机）
  function rollDice(dice, useMax = false) {
    if (!dice) return 0;
    const m = String(dice).match(/^(\d*)d(\d+)(?:\+(\d+))?$/);
    if (!m) return 0;
    const count = safeParseInt(m[1] || 1, 1);
    const sides = safeParseInt(m[2], 0);
    const bonus = safeParseInt(m[3] || 0, 0);
    if (useMax) return count * sides + bonus;  // 满骰
    let total = bonus;
    for (let i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
    return total;
  }

  // 计算升级所需经验：三次加速多项式（前期平缓、后期陡升）
  // 公式：200 + 60(n-1) + 18(n-1)^2 + 6(n-1)^3 （n = 总等级；Lv1→2 = 200）
  function calcRequiredExp(level) {
    level = Math.max(1, safeParseInt(level, 1));
    const n = level - 1;
    return Math.floor(200 + 60 * n + 18 * n * n + 6 * n * n * n);
  }

  // 关键等级：获得额外属性点(+2)的总等级（4/8/12/16/20；HP 不再额外×2）
  function isKeyLevel(totalLevel) {
    const lv = safeParseInt(totalLevel, 0);
    return lv === 4 || lv === 8 || lv === 12 || lv === 16 || lv === 20;
  }

  // ========== 等阶计算 ==========
  const RANK_LEVELS = [
    { min: 1, max: 4, rank: '普通' },
    { min: 5, max: 8, rank: '超凡' },
    { min: 9, max: 12, rank: '精英' },
    { min: 13, max: 16, rank: '史诗' },
    { min: 17, max: 20, rank: '传说' },
    { min: 21, max: 25, rank: '神话' }
  ];

  function getRankByLevel(level) {
    const lv = safeParseInt(level, 1);
    for (const r of RANK_LEVELS) {
      if (lv >= r.min && lv <= r.max) return r.rank;
    }
    return '普通';
  }

  // ========== 等阶 HP 成长倍率 ==========
  // HP 成长 = (职业HP骰 + 体质修正) × 等阶倍率（等阶按该级角色总等级判定）
  // 普通×1 / 超凡×1.2 / 精英×1.4 / 史诗×1.6 / 传说×1.8 / 神话×2.0
  const RANK_HP_MULT = {
    '普通': 1, '超凡': 1.2, '精英': 1.4, '史诗': 1.6, '传说': 1.8, '神话': 2.0
  };
  function getRankHpMult(level) {
    return RANK_HP_MULT[getRankByLevel(level)] || 1;
  }
  // =====================================

  // preserveExisting=true（契约兽）：保留 AI/古卷写入的叙事等阶（如「精英」），仅在等阶为空时按等级补。
  // 与状态栏 displayTier 的「展示时按等级推导、不改存储字段」一致；主角/同伴仍强制按等级校准。
  function updateActorRank(actor, preserveExisting = false) {
    if (!actor || typeof actor !== 'object') return;
    const level = _.get(actor, '基础状态.总等级', 1);
    const newRank = getRankByLevel(level);
    if (preserveExisting && typeof actor.等阶 === 'string' && actor.等阶.trim()) return;
    actor.等阶 = newRank;
  }
  // =====================================

  // 各职业每级成长：HP/MP/SP 骰面 + 每级技能点(sp)
  const 职业每级成长 = {
    '战士': { HP: 'd10', SP: 'd6', sp: 4 }, '骑士': { HP: 'd10', SP: 'd6', sp: 3 },
    '猎人': { HP: 'd8', SP: 'd4', sp: 4 }, '斥候': { HP: 'd8', SP: 'd4', sp: 5 },
    '狂战士': { HP: 'd12', SP: 'd8', sp: 3 }, '战士[乌尔坎]': { HP: 'd10', SP: 'd8', sp: 3 },
    '猎手': { HP: 'd8', SP: 'd4', sp: 4 }, '猎手[乌尔坎]': { HP: 'd8', SP: 'd4', sp: 4 },
    '狂战士[乌尔坎]': { HP: 'd12', SP: 'd10', sp: 3 }, '元素法师': { HP: 'd6', MP: 'd6', sp: 5 },
    '符文师': { HP: 'd6', MP: 'd6', sp: 5 }, '塑能师': { HP: 'd6', MP: 'd8', sp: 5 },
    '死灵法师': { HP: 'd6', MP: 'd6', sp: 4 }, '召唤师': { HP: 'd6', MP: 'd6', sp: 5 },
    '魔导技师': { HP: 'd6', MP: 'd6', sp: 5 }, '德鲁伊': { HP: 'd8', MP: 'd6', sp: 3 },
    '精灵术士': { HP: 'd6', MP: 'd6', sp: 5 }, '药剂师': { HP: 'd6', sp: 5 }, '圣光法师': { HP: 'd6', MP: 'd6', sp: 4 },
    '神官': { HP: 'd8', MP: 'd6', sp: 4, mpKey: 'wis' }, '圣殿骑士': { HP: 'd8', MP: 'd4', sp: 3, mpKey: 'wis' },
    '祭司': { HP: 'd8', MP: 'd6', sp: 4, mpKey: 'wis' }, '魔剑士': { HP: 'd8', SP: 'd6', MP: 'd4', sp: 4 },
    '连撞卫士': { HP: 'd12', SP: 'd8', sp: 3 }, '绒毛骑士': { HP: 'd10', SP: 'd8', sp: 3 },
    '寻草射手': { HP: 'd8', MP: 'd6', sp: 4 }, '咩语神官': { HP: 'd8', MP: 'd8', sp: 4 },
    '邪术师': { HP: 'd6', MP: 'd8', sp: 3 },
    '魔兽使': { HP: 'd8', SP: 'd6', MP: 'd4', sp: 4, mpKey: 'wis' },
    '无职业': { HP: 'd6' },
    // ===== 大炎龙朝职业 =====
    '炎术士': { HP: 'd6', MP: 'd8', sp: 5 },
    '炎脉武士': { HP: 'd10', SP: 'd6', sp: 4 },
    '铁冠卫': { HP: 'd12', SP: 'd8', sp: 3 },
    '炎祖祭司': { HP: 'd8', MP: 'd6', sp: 4 },
    // ===== 终焉纪元IF线职业 =====
    '不死人': { HP: 'd10', SP: 'd5', sp: 3 },
    // ===== 契约兽（兽类独立成长，无技能点 sp:0） =====
    '巨龙': { HP: 'd12', MP: 'd8', SP: 'd10', sp: 0 },
    '古树': { HP: 'd12', MP: 'd10', sp: 0 },
    '魔兽': { HP: 'd8', MP: 'd6', SP: 'd6', sp: 0 },
    '契约兽': { HP: 'd8', MP: 'd6', SP: 'd6', sp: 0 }
  };

  // ---- 融合职业成长推导 ----
  // 融合职业组合无限（如「战士×骑士」「元素法师×猎人」），无法在表中穷举。
  // 融合职业保存时已在 $customSkillTrees[职业名]['职业融合'].fusedFrom 记录源职业 [jobA, jobB]，
  // 这里按「源职业成长取优」自动推导：HP/MP/SP 骰面取各资源中最大的，技能点取两源之和（融合技能树更丰富）。
  // fusedFrom 缺失或源职业也未知时返回保守兜底成长，绝不让升级中断。
  const _DICE_ORDER = { d4: 1, d6: 2, d8: 3, d10: 4, d12: 5 };
  function resolveFusedGrowth(jobName) {
    const fused = _customTrees?.[jobName]?.['职业融合'];
    if (!fused || !Array.isArray(fused.fusedFrom) || !fused.fusedFrom.length) {
      // 兜底：找不到源职业信息时的保守成长
      return { HP: 'd8', SP: 'd6', sp: 4 };
    }
    const growth = { sp: 0 };
    fused.fusedFrom.forEach(jn => {
      const g = lookupJobGrowth(jn);
      if (!g) return;
      ['HP', 'MP', 'SP'].forEach(k => {
        if (!g[k]) return;
        if (!growth[k] || (_DICE_ORDER[g[k]] || 0) > (_DICE_ORDER[growth[k]] || 0)) {
          growth[k] = g[k];
        }
      });
      growth.sp += safeParseInt(g.sp, 0);
    });
    // 源职业全部未知（如嵌套融合/手造自定义职业）时落到保守兜底
    if (!growth.HP && !growth.MP && !growth.SP && growth.sp <= 0) {
      return { HP: 'd8', SP: 'd6', sp: 4 };
    }
    // 至少保证 1 点/级（避免融合职业完全无技能点可用）
    growth.sp = Math.max(1, growth.sp);
    return growth;
  }

  // ---- 自创职业成长推导（按玩家选择的成长风格：武技/魔法/神术/混合） ----
  // 风格保存在 stat_data.$customSkillTrees[职业名]['定制技能树'].风格（$前缀，AI 不可见不可写），
  // 由状态栏弹窗让玩家选择后写入；未选择时默认「混合」成长。
  const 风格成长表 = {
    '武技': { HP: 'd10', SP: 'd8', sp: 4, 风格: '武技' },
    '魔法': { HP: 'd6', MP: 'd8', sp: 5, 风格: '魔法' },
    '神术': { HP: 'd8', MP: 'd6', sp: 4, 风格: '神术' },
    '混合': { HP: 'd8', SP: 'd6', MP: 'd4', sp: 4, 风格: '混合' }
  };
  function resolveCustomJobGrowth(jobName, fe) {
    const tree = _customTrees?.[jobName]?.['定制技能树'];
    const style = (tree && tree.风格) || (fe && fe.风格) || '';
    return 风格成长表[style] || 风格成长表['混合'];
  }

  // ---- 结构守卫：只补缺，不覆盖已有值（原地修改） ----
  function ensureActorShape(actor) {
    if (!actor || typeof actor !== 'object') return null;
    if (!actor.基础属性 || typeof actor.基础属性 !== 'object') actor.基础属性 = {};
    if (!actor.基础状态 || typeof actor.基础状态 !== 'object') actor.基础状态 = {};
    const base = actor.基础状态;
    ['HP', 'MP', 'SP'].forEach(k => {
      if (base[k] && typeof base[k] === 'object') {
        if (typeof base[k].最大 !== 'number') base[k].最大 = safeParseInt(base[k].最大, 0);
        if (typeof base[k].当前 !== 'number') base[k].当前 = safeParseInt(base[k].当前, base[k].最大);
        if (base[k].当前 > base[k].最大) base[k].当前 = base[k].最大;
      }
    });
    if (!base.职业信息 || typeof base.职业信息 !== 'object') base.职业信息 = {};
    if (typeof base.总等级 !== 'number') base.总等级 = safeParseInt(base.总等级, 1);
    if (typeof base.待分配职业等级 !== 'number') base.待分配职业等级 = 0;
    // 确保经验值结构存在，并自动计算合理的升级所需经验
    if (!base.经验值 || typeof base.经验值 !== 'object') base.经验值 = {};
    if (typeof base.经验值.当前 !== 'number') base.经验值.当前 = 0;
    if (typeof base.经验值.升级所需 !== 'number' || base.经验值.升级所需 <= 0) {
      base.经验值.升级所需 = calcRequiredExp(base.总等级);
    }

    // 确保等阶字段存在
    if (typeof actor.等阶 !== 'string') actor.等阶 = getRankByLevel(base.总等级);
    return actor;
  }

  // ---- 职业名归一化：剥离元素流派后缀（「元素法师（水、火、冰）」或「元素法师·水·火」→「元素法师」） ----
  // 使带流派后缀的职业名也能命中 职业每级成长 表（元素法师流派由职业名 括号/点号 标注，成长数值相同）
  function normalizeJobName(jobName) {
    let s = String(jobName || '').trim();
    // 括号格式（兼容旧档）
    let m = s.match(/^(.*?)（([^）]*)）$/);
    if (m) return m[1].trim();
    // 点号格式（现行规范：元素法师·水）：仅元素法师家族剥离，避免误拆其他带·职业名
    const families = ['元素法师', '符文师', '塑能师', '死灵法师', '召唤师', '魔导技师', '精灵术士', '药剂师', '圣光法师', '邪术师'];
    const parts = s.split('·');
    if (parts.length >= 2 && families.indexOf(parts[0].trim()) !== -1) return parts[0].trim();
    return s;
  }
  // ---- 成长表查表：兼容全角/半角/方括号变体（如 首页写入「战士(乌尔坎)」vs 表键「战士[乌尔坎]」） ----
  function lookupJobGrowth(jobName) {
    const base = normalizeJobName(jobName);
    let g = 职业每级成长[base];
    if (g) return g;
    // 神官变体（神官[神名]/神官(神名)，限强神到常神）：共享神官成长
    const priest = base.match(/^神官[(\[{](.+?)[)\]}]$/) || String(jobName || '').match(/^神官[(\[{](.+?)[)\]}]$/);
    if (priest) return 职业每级成长['神官'];
    const flat = String(jobName || '').replace(/[()（）\[\]【】]/g, '');
    for (const k in 职业每级成长) {
      if (k.replace(/[()（）\[\]【】]/g, '') === flat) return 职业每级成长[k];
    }
    return null;
  }

  // ---- 契约兽职业宽松匹配 ----
  // AI 可能在 [职业] 写入种族名/近似名（如「冰霜巨龙」「风狼」「远古灵木」），
  // 按关键字归类到对应兽类成长（巨龙/古树/魔兽）；都不命中时由调用方回落到通用「契约兽」成长。
  const 兽类职业关键字表 = [
    { 职业: '巨龙', 关键字: ['龙', '蛇', '蜥蜴'] },
    { 职业: '古树', 关键字: ['树', '木', '森', '藤', '枝'] },
    { 职业: '魔兽', 关键字: ['兽', '狼', '狐', '熊', '虎', '狮', '豹', '鹰', '雕', '犬', '马', '鹿', '猿', '猴', '猫', '牛', '羊', '猪'] }
  ];
  function matchBeastJob(jobName) {
    const n = String(jobName || '').trim();
    if (!n) return null;
    for (const row of 兽类职业关键字表) {
      for (const k of row.关键字) {
        if (n.indexOf(k) !== -1) return row.职业;
      }
    }
    return null;
  }
  // 在职业信息对象中按基础名查找条目（兼容「元素法师」与「元素法师（水）」混用/中途改名）
  function findJobEntry(jobs, jobName) {
    if (!jobs || typeof jobs !== 'object') return null;
    if (jobs[jobName] && typeof jobs[jobName] === 'object') return jobs[jobName];
    const base = normalizeJobName(jobName);
    if (!base) return null;
    for (const k in jobs) {
      if (normalizeJobName(k) === base && jobs[k] && typeof jobs[k] === 'object') return jobs[k];
    }
    return null;
  }
  function findJobLevel(jobs, jobName) {
    const e = findJobEntry(jobs, jobName);
    return e ? safeParseInt(e.等级, 0) : 0;
  }

  // ---- 应用单级职业成长（HP/MP/SP/技能点），原地修改 actor ----
  // useMax=true 时使用满骰（新角色初始化），false 则随机掷骰（正常升级）
  // totalLevel：角色当前总等级，用于判断是否关键等级（4/8/12/16/20，仅属性点+2）
  // beast：契约兽标记（无技能点；未定义具体职业时用通用契约兽成长）
  function applyJobLevel(actor, jobName, useMax = false, totalLevel = 0, beast = false) {
    let g = lookupJobGrowth(jobName);
    // 表外且非契约兽 → 自创职业（融合职业/纯自创职业），成长由保底逻辑统一发放
    const isCustomJob = !g && !beast;
    if (!g) {
      if (beast) {
        // 契约兽：先按关键字宽松匹配（冰霜巨龙→巨龙、风狼→魔兽、远古灵木→古树）
        const beastJob = matchBeastJob(jobName);
        if (beastJob && 职业每级成长[beastJob]) {
          g = 职业每级成长[beastJob];
          console.log(`[职业升级][${jobName}] 契约兽按关键字匹配为「${beastJob}」成长：HP=${g.HP} MP=${g.MP} SP=${g.SP}（无技能点）`);
        } else {
          // 契约兽：完全未知职业用通用契约兽成长兜底，无技能点
          g = 职业每级成长['契约兽'] || { HP: 'd8', MP: 'd6', SP: 'd6', sp: 0 };
          console.log(`[职业升级][${jobName}] 契约兽按通用成长兜底：HP=${g.HP} MP=${g.MP} SP=${g.SP}（无技能点）`);
        }
      } else if (_customTrees?.[jobName]?.['职业融合']) {
        // 融合职业：按 fusedFrom 源职业自动推导成长
        g = resolveFusedGrowth(jobName);
        if (!g) { console.warn('[职业升级] 未知职业:', jobName); return; }
        console.log(`[职业升级][${jobName}] 融合职业按源职业推导成长：HP=${g.HP || '—'} MP=${g.MP || '—'} SP=${g.SP || '—'} 技能点/级=${g.sp}`);
      } else {
        // 自创职业：按玩家选择的成长风格（武技/魔法/神术/混合）推导成长
        g = resolveCustomJobGrowth(jobName);
        if (!g) { console.warn('[职业升级] 未知职业:', jobName); return; }
        console.log(`[职业升级][${jobName}] 自创职业按「${g.风格}」风格成长：HP=${g.HP || '—'} MP=${g.MP || '—'} SP=${g.SP || '—'} 技能点/级=${g.sp}`);
      }
    }
    // 融合职业 / 自创职业：HP/MP/SP/技能点统一由 processActor 末尾保底按等级对齐发放，本函数不再逐级叠加，避免重复
    if (isCustomJob) {
      return;
    }
    const attr = actor.基础属性 || {};
    const base = actor.基础状态;

    if (base.HP && g.HP) {
      // HP 成长：职业HP骰 + 体质修正，再按该级总等级对应的等阶倍率加成（普通×1 → 神话×2.0）
      const hpMult = getRankHpMult(totalLevel || 0);
      const add = Math.max(1, Math.round((rollDice(g.HP, useMax) + getAbilityModifier(attr.体质)) * hpMult));
      base.HP.最大 += add;
      base.HP.当前 = base.HP.最大;
      console.log('[职业升级][' + jobName + '] HP +' + add + '（等阶倍率 ×' + hpMult + '）');
    }
    if (base.SP && g.SP) {
      const add = Math.max(0, rollDice(g.SP, useMax) + getAbilityModifier(attr.体质));
      base.SP.最大 += add;
      base.SP.当前 = base.SP.最大;
      console.log(`[职业升级][${jobName}] SP +${add}`);
    }
    if (base.MP && g.MP) {
      // MP 修正类型：神术/御兽职业（mpKey:'wis'）按感知修正成长，其余按智力修正（与首页创建器 data-mp 一致）
      const mpMod = g.mpKey === 'wis' ? getAbilityModifier(attr.感知) : getAbilityModifier(attr.智力);
      const add = Math.max(0, rollDice(g.MP, useMax) + mpMod);
      base.MP.最大 += add;
      base.MP.当前 = base.MP.最大;
      console.log(`[职业升级][${jobName}] MP +${add}`);
    }
    const job = base.职业信息[jobName];
    if (job && typeof job === 'object') {
      // 融合职业技能点由 processActor 末尾的保底逻辑统一发放（grantedSp 追踪），避免重复发放
      if (!(_customTrees?.[jobName]?.['职业融合'])) {
        job.技能点 = safeParseInt(job.技能点, 0) + safeParseInt(g.sp, 0);
        console.log(`[职业升级][${jobName}] 技能点 +${g.sp}，当前 ${job.技能点}`);
      }
    }
  }

  // 经验自动升级：经验达标时扣除所需、提升总等级/待分配等级/属性点，并自动更新下一级所需经验
  function autoLevelUpFromExp(actor, label, opts = {}) {
    ensureActorShape(actor);
    const expObj = actor.基础状态.经验值;
    if (!expObj || typeof expObj !== 'object') return;

    // 强制按当前总等级校准升级所需经验（脚本全权接管）
    expObj.升级所需 = calcRequiredExp(actor.基础状态.总等级);
    let required = expObj.升级所需;
    if (required <= 0) return;   // 安全防护

    let current = safeParseInt(expObj.当前, 0);
    let leveled = false;

    while (current >= required) {
      current -= required;
      leveled = true;

      // 提升等级相关数值
      actor.基础状态.总等级 = safeParseInt(actor.基础状态.总等级, 0) + 1;
      actor.基础状态.待分配职业等级 = safeParseInt(actor.基础状态.待分配职业等级, 0) + 1;
      const newTotal = actor.基础状态.总等级;

      // 属性点：关键等级（4/8/12/16/20）给 2 点，其余给 1 点
      const bonusPoints = isKeyLevel(newTotal) ? 2 : 1;
      if (!actor.基础属性) actor.基础属性 = {};
      actor.基础属性.未分配点数 = safeParseInt(actor.基础属性.未分配点数, 0) + bonusPoints;

      // 立即更新下一级所需经验
      expObj.升级所需 = calcRequiredExp(newTotal);
      required = expObj.升级所需;

      console.log(`[自动升级]${label} 总等级提升至 ${newTotal}，获得属性点 +${bonusPoints}，待分配职业等级 +1，下一级需经验 ${required}`);
    }

    if (leveled) {
      expObj.当前 = current;
      // 更新等阶（契约兽 preserveRank：保留叙事等阶）
      updateActorRank(actor, !!opts.preserveRank);
      console.log(`[自动升级]${label} 经验扣除后剩余 ${current}，等阶：${actor.等阶}`);
    }
  }

  // ---- 单个角色：按 diff 应用成长 + 技能点只减不增 ----
  // ---- 【已加入防双重升级复位逻辑】 ----
  function processActor(curr, prev, label, opts = {}) {
    const beast = !!opts.beast;
    if (!ensureActorShape(curr)) return;
    const currJobs = curr.基础状态.职业信息;
    const prevJobs = prev?.基础状态?.职业信息 || {};

    // 关键等级判定基准：本次更新前/后的总等级（仅用于属性点+2 奖励）
    let baseTotal = safeParseInt(prev?.基础状态?.总等级, 0);
    if (baseTotal <= 0) {
      baseTotal = 0;
      for (const jn in prevJobs) baseTotal += safeParseInt(prevJobs[jn]?.等级, 0);
      baseTotal += safeParseInt(prev?.基础状态?.待分配职业等级, 0);
    }
    let finalTotal = 0;
    for (const jn in currJobs) finalTotal += safeParseInt(currJobs[jn]?.等级, 0);
    finalTotal += safeParseInt(curr.基础状态.待分配职业等级, 0);
    if (finalTotal <= 0) finalTotal = baseTotal;
    let appliedLevels = 0;

    // 判断 prev 中是否真的有职业等级数据（不是空结构）
    // 首页创建器写入时 prev 可能是 {} 或仅有空结构 {职业信息:{}}，
    // 此时 !prev 为 false 会误进升级逻辑，所以需要额外检查是否有实质等级
    const hasRealPrevLevels = Object.values(prevJobs).some(job =>
      job && typeof job === 'object' && safeParseInt(job.等级, 0) > 0
    );
    if (!prev || !hasRealPrevLevels) {
      console.log(`[职业升级]${label} 无前值快照或前值无等级数据（首次初始化），跳过等级差成长`);
      // 但仍需根据已有职业等级修正总等级和等阶
      let total = 0;
      for (const job in currJobs) total += safeParseInt(currJobs[job]?.等级, 0);
      total += safeParseInt(curr.基础状态.待分配职业等级, 0);
      if (total > 0) curr.基础状态.总等级 = total;
      updateActorRank(curr, beast);
      return;
    }

    for (const job in currJobs) {
      if (!currJobs[job] || typeof currJobs[job] !== 'object') continue;
      const currLv = safeParseInt(currJobs[job].等级, 0);
      // 按基础名匹配 prev，兼容「元素法师」与「元素法师（水）」：中途给职业加流派后缀不会误判为新职业
      const prevLv = findJobLevel(prevJobs, job);
      const prevEntry = findJobEntry(prevJobs, job);

      if (currLv > prevLv) {
        // 【核心修复】先将资源恢复到升级前瞬间的旧值，抹掉 AI 可能已写入的任何修改
        const prevBase = prev?.基础状态 || {};
        if (prevEntry) {
          // 已有职业升级：恢复该职业对应的资源到旧值
          if (curr.基础状态.HP && prevBase.HP) {
            curr.基础状态.HP.最大 = safeParseInt(prevBase.HP.最大, 0);
            curr.基础状态.HP.当前 = safeParseInt(prevBase.HP.当前, 0);
          }
          if (curr.基础状态.MP && prevBase.MP) {
            curr.基础状态.MP.最大 = safeParseInt(prevBase.MP.最大, 0);
            curr.基础状态.MP.当前 = safeParseInt(prevBase.MP.当前, 0);
          }
          if (curr.基础状态.SP && prevBase.SP) {
            curr.基础状态.SP.最大 = safeParseInt(prevBase.SP.最大, 0);
            curr.基础状态.SP.当前 = safeParseInt(prevBase.SP.当前, 0);
          }
          currJobs[job].技能点 = safeParseInt(prevEntry.技能点, 0);
        } else {
          // 全新职业首次获得（如兼职新增职业）：不重置已有资源，
          // 恢复到变更前快照（其中已含既有职业的全部资源），再叠加新职业成长
          if (curr.基础状态.HP && prevBase.HP) {
            curr.基础状态.HP.最大 = safeParseInt(prevBase.HP.最大, 0);
            curr.基础状态.HP.当前 = safeParseInt(prevBase.HP.当前, 0);
          }
          if (curr.基础状态.MP && prevBase.MP) {
            curr.基础状态.MP.最大 = safeParseInt(prevBase.MP.最大, 0);
            curr.基础状态.MP.当前 = safeParseInt(prevBase.MP.当前, 0);
          }
          if (curr.基础状态.SP && prevBase.SP) {
            curr.基础状态.SP.最大 = safeParseInt(prevBase.SP.最大, 0);
            curr.基础状态.SP.当前 = safeParseInt(prevBase.SP.当前, 0);
          }
          currJobs[job].技能点 = 0;
        }

        // 从旧值基础上逐级应用成长（不会重复叠加）
        // 新建角色（prevLv===0）用满骰确保稳定初始化，正常升级用随机骰
        const useMax = prevLv === 0;
        const diff = currLv - prevLv;
        console.log(`[职业升级]${label}[${job}] 升级 ${prevLv}→${currLv} (+${diff})${useMax ? ' [满骰初始化]' : ''}`);
        for (let i = 0; i < diff; i++) {
          appliedLevels++;
          // 真升级（总等级提升）：本级对应 baseTotal + appliedLevels；纯分配（总等级不变）：始终按当前总等级判定
          const totalAtLevel = finalTotal > baseTotal ? (baseTotal + appliedLevels) : baseTotal;
          applyJobLevel(curr, job, useMax, totalAtLevel, beast);
        }
      } else if (currLv === prevLv && prevEntry) {
        // 等级未变：技能点只减不增
        const currSp = safeParseInt(currJobs[job].技能点, 0);
        const prevSp = safeParseInt(prevEntry.技能点, 0);
        if (currSp > prevSp) {
          console.warn(`[职业升级]${label}[${job}] 技能点非法增加 ${prevSp}→${currSp}，已回滚`);
          currJobs[job].技能点 = prevSp;
        }
      }
    }

    // 重新计算总等级
    let total = 0;
    for (const job in currJobs) total += safeParseInt(currJobs[job]?.等级, 0);
    total += safeParseInt(curr.基础状态.待分配职业等级, 0);
    if (total > 0) curr.基础状态.总等级 = total;

    // 普通职业技能点对齐：修复「职业等级初始/一次性写入未触发逐级升级」导致的技能点缺失。
    // 用职业条目 grantedSp 追踪；旧数据无追踪时：已有技能点视为已发放不追溯，
    // 技能点为 0 但有等级则视为从未发放，一次性补足 等级×每级sp（仅一次，之后不再补）。
    for (const job in currJobs) {
      const fe = currJobs[job];
      if (!fe || typeof fe !== 'object') continue;
      if (_customTrees?.[job]?.['职业融合']) continue; // 融合职业走下方融合保底
      const lv = safeParseInt(fe.等级, 0);
      if (lv <= 0) continue;
      const g = lookupJobGrowth(job);
      const perLv = safeParseInt(g && g.sp, 0);
      if (perLv <= 0) continue;
      const shouldHave = lv * perLv;
      let grantedSp = safeParseInt(fe.grantedSp, -1);
      if (grantedSp < 0) {
        grantedSp = safeParseInt(fe.技能点, 0) > 0 ? shouldHave : 0;
      }
      if (grantedSp < shouldHave) {
        const gap = shouldHave - grantedSp;
        fe.技能点 = safeParseInt(fe.技能点, 0) + gap;
        fe.grantedSp = shouldHave;
        console.log(`[职业升级][${job}] 普通职业技能点对齐补发 +${gap}（等级 ${lv}，应有 ${shouldHave}）`);
      }
    }

    // 融合/自创职业成长保底：以 $customSkillTrees 的 grantedLv / grantedSp 追踪已发放量，
    // 统一补齐缺失的 HP/MP/SP（按等级满骰对齐）与技能点，
    // 修复融合职业/自创职业创建或一次性写入等级时「首次获得」分支未触发导致成长与技能点长期缺失。
    // 自创职业按玩家选择的成长风格（武技/魔法/神术/混合）成长；融合职业按 fusedFrom 源职业推导。
    for (const job in currJobs) {
      const fe = currJobs[job];
      if (!fe || typeof fe !== 'object') continue;
      const fusedMeta = _customTrees?.[job]?.['职业融合'];
      // 自创职业 = 表外 + 非契约兽 + 非融合（按风格成长，含一次性写入保底）
      const isCustomJob = !fusedMeta && !lookupJobGrowth(job) && !beast;
      if (!fusedMeta && !isCustomJob) continue;
      const lv = safeParseInt(fe.等级, 0);
      if (lv <= 0) continue;
      const fg = fusedMeta ? resolveFusedGrowth(job) : resolveCustomJobGrowth(job, fe);

      // 【旧档自愈】历史融合职业的追踪字段只存在 $customSkillTrees 深层（事件写回不可靠），
      // 曾导致每轮重复补发。这里检测到职业信息条目上无 grantedLv/grantedSp 时自动补齐，
      // 使保底立即对齐并停止补发；此前已多发的 HP/MP/SP/技能点需玩家按需手动校准。
      if (safeParseInt(fe.grantedLv, -1) < 0 && safeParseInt(fe.grantedSp, -1) < 0) {
        fe.grantedLv = lv;
        fe.grantedSp = lv * safeParseInt(fg.sp, 0);
        console.warn(`[职业升级][${job}] 检测到旧版${fusedMeta ? '融合职业' : '自创职业'}，已自动补齐追踪字段（grantedLv=${fe.grantedLv}, grantedSp=${fe.grantedSp}）以停止每轮补发；若数值已因重复补发过多，请用全局修改器手动校准`);
      }

      // 追踪字段：优先读 职业信息[职业].grantedLv/grantedSp（与 HP/SP/技能点同层，事件写回可靠），
      // 兼容旧数据 $customSkillTrees['职业融合'] 中的字段，避免每轮变量更新都因追踪丢失而重复补发
      let grantedLv = safeParseInt(fe.grantedLv, -1);
      if (grantedLv < 0 && fusedMeta) grantedLv = safeParseInt(fusedMeta.grantedLv, 0);

      // 1) HP/MP/SP 成长对齐：grantedLv 记录已按等级发放的成长，缺失时满骰补发差额等级
      if (grantedLv < lv) {
        const base = curr.基础状态;
        const attr = curr.基础属性 || {};
        const dif = lv - grantedLv;
        if (base.HP && fg.HP) {
          const hpMult = getRankHpMult(lv);
          const add = Math.max(1, Math.round((rollDice(fg.HP, true) + getAbilityModifier(attr.体质)) * hpMult)) * dif;
          base.HP.最大 += add; base.HP.当前 = base.HP.最大;
        }
        if (base.SP && fg.SP) {
          const add = Math.max(0, rollDice(fg.SP, true) + getAbilityModifier(attr.体质)) * dif;
          base.SP.最大 += add; base.SP.当前 = base.SP.最大;
        }
        if (base.MP && fg.MP) {
          const mpMod = fg.mpKey === 'wis' ? getAbilityModifier(attr.感知) : getAbilityModifier(attr.智力);
          const add = Math.max(0, rollDice(fg.MP, true) + mpMod) * dif;
          base.MP.最大 += add; base.MP.当前 = base.MP.最大;
        }
        grantedLv = lv;
        fe.grantedLv = lv;
        if (fusedMeta) fusedMeta.grantedLv = lv;
        console.log(`[职业升级][${job}] ${fusedMeta ? '融合职业' : '自创职业'} HP/MP/SP 补发至 Lv.${lv}（+${dif} 级满骰，HP=${fg.HP||'—'} MP=${fg.MP||'—'} SP=${fg.SP||'—'}）`);
      }

      // 2) 技能点对齐：grantedSp 记录已发放技能点，不足时补足
      const perLv = safeParseInt(fg && fg.sp, 0);
      if (perLv > 0) {
        const shouldHave = lv * perLv;
        let grantedSp = safeParseInt(fe.grantedSp, -1);
        if (grantedSp < 0 && fusedMeta) grantedSp = safeParseInt(fusedMeta.grantedSp, 0);
        if (grantedSp < shouldHave) {
          const gap = shouldHave - grantedSp;
          fe.技能点 = safeParseInt(fe.技能点, 0) + gap;
          grantedSp = shouldHave;
          fe.grantedSp = shouldHave;
          if (fusedMeta) fusedMeta.grantedSp = shouldHave;
          console.log(`[职业升级][${job}] ${fusedMeta ? '融合职业' : '自创职业'}技能点补发 +${gap}（等级 ${lv}，应有 ${shouldHave}，已发 ${grantedSp}）`);
        }
      }
    }

    // 更新等阶（契约兽保留叙事等阶，其余按等级校准）
    updateActorRank(curr, beast);
  }

  // ---- 经验值获取硬闸：单次变量更新的经验增量不得超过一整级所需（防重大剧情节点动辄发放数千点；战斗等正当大额收益至多折为一级，不误伤） ----
  function clampExpGain(actor, actorBefore, label) {
    const exp = actor?.基础状态?.经验值;
    if (!exp || typeof exp.当前 !== 'number') return;
    const beforeCur = actorBefore?.基础状态?.经验值?.当前;
    if (typeof beforeCur !== 'number' || exp.当前 <= beforeCur) return; // 无基线或非增益不拦
    const lv = Math.max(1, safeParseInt(actorBefore?.基础状态?.总等级 ?? actor?.基础状态?.总等级, 1));
    const cap = calcRequiredExp(lv);
    if (exp.当前 - beforeCur <= cap) return;
    console.warn(`[职业升级] 经验硬闸：${label} 单次经验增量 ${exp.当前 - beforeCur} 超过一整级所需 ${cap}，已截断（如需多级请分多次获取）`);
    exp.当前 = beforeCur + cap;
  }

  // ---- 主处理：挂在 VARIABLE_UPDATE_ENDED 上，原地改 stat_data ----
  function handleJobUpgrade(rawVariables, rawVariablesBefore) {
    if (isProcessing) { console.log('[职业升级] 防重入拦截'); return; }
    isProcessing = true;
    try {
      const statData = rawVariables?.stat_data;
      const statDataBefore = rawVariablesBefore?.stat_data;
      if (!statData) return;
      _customTrees = statData?.$customSkillTrees || {};

      // 主角
      if (statData.主角) {
        clampExpGain(statData.主角, statDataBefore?.主角, '主角');
        processActor(statData.主角, statDataBefore?.主角, '[主角]');
        autoLevelUpFromExp(statData.主角, '[主角]');
      }

      // 同伴（动态成员）
      if (statData.同伴 && typeof statData.同伴 === 'object') {
        for (const name in statData.同伴) {
          clampExpGain(statData.同伴[name], statDataBefore?.同伴?.[name], `同伴:${name}`);
          processActor(statData.同伴[name], statDataBefore?.同伴?.[name], `[同伴:${name}]`);
          autoLevelUpFromExp(statData.同伴[name], `[同伴:${name}]`);
        }
      }

      // 契约兽（独立路径 stat_data.契约兽.{名字}；兽类用种族-职业成长、无技能点）
      if (statData.契约兽 && typeof statData.契约兽 === 'object') {
        for (const name in statData.契约兽) {
          clampExpGain(statData.契约兽[name], statDataBefore?.契约兽?.[name], `契约兽:${name}`);
          processActor(statData.契约兽[name], statDataBefore?.契约兽?.[name], `[契约兽:${name}]`, { beast: true });
          autoLevelUpFromExp(statData.契约兽[name], `[契约兽:${name}]`, { preserveRank: true });
        }
      }
    } catch (e) {
      console.error('[职业升级] 出错:', e);
      if (typeof toastr !== 'undefined') toastr.error('职业升级脚本出错: ' + e.message);
    } finally {
      isProcessing = false;
    }
  }

  // ==========================================
  // 手动升级（按钮触发，事件流之外）
  // ==========================================
  function resolveActor(statData, target) {
    if (target === '主角') return statData.主角 || (statData.主角 = {});
    if (!statData.同伴 || typeof statData.同伴 !== 'object') statData.同伴 = {};
    return statData.同伴[target] || (statData.同伴[target] = {});
  }

  function manualLevelUp(target, jobName, delta = 1) {
    delta = safeParseInt(delta, 1);
    if (!target || !jobName || delta === 0) return;
    updateVariablesWith(variables => {
      const statData = variables?.stat_data;
      if (!statData) { console.warn('[手动升级] stat_data 不存在'); return variables; }
      _customTrees = statData?.$customSkillTrees || {};

      const actor = resolveActor(statData, target);
      ensureActorShape(actor);

      const before = _.cloneDeep(actor);

      const jobs = actor.基础状态.职业信息;
      if (!jobs[jobName] || typeof jobs[jobName] !== 'object') jobs[jobName] = { 等级: 0, 技能点: 0 };
      const newLv = Math.max(0, safeParseInt(jobs[jobName].等级, 0) + delta);
      jobs[jobName].等级 = newLv;

      processActor(actor, before, `[手动:${target}]`);

      console.log(`[手动升级] ${target} 的 ${jobName} 等级 → ${newLv}，等阶：${actor.等阶}`);
      return variables;
    }, { type: 'message', message_id: -1 });

    if (typeof toastr !== 'undefined') {
      toastr.success(`${target} 的「${jobName}」${delta > 0 ? '+' : ''}${delta} 级已应用`);
    }
  }

  try { window.手动升级 = manualLevelUp; } catch (e) { /* ignore */ }

  // ==========================================
  // 对外接口（供状态栏/全局修改器等前端界面调用）
  // 状态栏通过 window.升级脚本.应用分配 / .执行融合 访问（initializeGlobal 共享为全局变量）
  // ==========================================

  // ---- 对单个角色按「已写入的职业等级/属性」补齐三维(HP/MP/SP)与技能点 ----
  // 状态栏「升级分配」/「全局修改器」已用 replaceMvuData 写入了 职业等级 与 六维属性，
  // 该路径不触发 VARIABLE_UPDATE_ENDED，故需显式调用本方法。
  // 参数：{ target, jobs: {职业名: +N}, attr: {六维: Δ} }
  // 实现：与 processActor 的融合保底同思路——用 grantedLv/grantedSp 追踪已发放，
  //       对缺失等级按满骰对齐 HP/MP/SP，技能点按等级×每级sp 对齐补齐；属性增量用于成长基数。
  // 注意：手动调用路径不在 VARIABLE_UPDATE_ENDED 事件内，必须用 updateVariablesWith 包裹修改并写回，
  //       否则对 getMvuData 结果的原地修改不会保存到酒馆变量（与 manualLevelUp 一致）。
  function 补齐三维(target, jobs, attr) {
    const jobDeltas = jobs || {};
    const attrDeltas = attr || {};
    updateVariablesWith(variables => {
      const statData = variables?.stat_data;
      if (!statData) { console.warn('[升级脚本] 补齐三维：stat_data 不可用'); return variables; }
      _customTrees = statData?.$customSkillTrees || {};
      const actor = resolveActor(statData, target);
      ensureActorShape(actor);
      const base = actor.基础状态;
      const jobsInfo = base.职业信息 || (base.职业信息 = {});

      // 属性增量已由状态栏「升级分配」在 replaceMvuData 时写入六维属性（17+3=20 只加一次），
      // 此处仅补齐三维(HP/MP/SP)与技能点，不再重复叠加属性增量（否则 17+3 会被加两次变成 23）

      // 逐个职业补齐三维/技能点（jobs 为本次正增量，但我们按「当前等级 - 已发放等级」对齐，避免重复）
      for (const job in jobDeltas) {
        const d = safeParseInt(jobDeltas[job], 0);
        if (d <= 0) continue;
        let fe = jobsInfo[job];
        if (!fe || typeof fe !== 'object') { jobsInfo[job] = fe = { 等级: 0, 技能点: 0 }; }
        const lv = safeParseInt(fe.等级, 0);
        if (lv <= 0) continue;

        const fusedMeta = _customTrees?.[job]?.['职业融合'];
        let grantedLv = safeParseInt(fe.grantedLv, -1);
        let grantedSp = safeParseInt(fe.grantedSp, -1);

        if (fusedMeta) {
          // 融合职业：追踪字段兼容旧数据
          if (grantedLv < 0) grantedLv = safeParseInt(fusedMeta.grantedLv, 0);
          if (grantedSp < 0) grantedSp = safeParseInt(fusedMeta.grantedSp, 0);
        }
        // 自创职业 = 表外 + 非融合 + 非兽类近似名（按玩家选择的成长风格成长）
        const isBeastLike = !!matchBeastJob(job) || ['巨龙', '古树', '魔兽', '契约兽'].indexOf(normalizeJobName(job)) !== -1;
        const isCustomJob = !fusedMeta && !lookupJobGrowth(job) && !isBeastLike;

        // 1) HP/MP/SP 补齐（满骰、按缺失等级对齐，确保确定性与守恒）
        if (grantedLv < 0) grantedLv = 0;
        if (grantedLv < lv) {
          const dif = lv - grantedLv;
          let fg = null;
          if (fusedMeta) fg = resolveFusedGrowth(job);
          else if (isCustomJob) fg = resolveCustomJobGrowth(job, fe);
          else fg = lookupJobGrowth(job) || {};
          const attrA = actor.基础属性 || {};
          if (base.HP && fg.HP) {
            const hpMult = getRankHpMult(lv);
            const add = Math.max(1, Math.round((rollDice(fg.HP, true) + getAbilityModifier(attrA.体质)) * hpMult)) * dif;
            base.HP.最大 += add; base.HP.当前 = base.HP.最大;
          }
          if (base.SP && fg.SP) {
            const add = Math.max(0, rollDice(fg.SP, true) + getAbilityModifier(attrA.体质)) * dif;
            base.SP.最大 += add; base.SP.当前 = base.SP.最大;
          }
          if (base.MP && fg.MP) {
            const add = Math.max(0, rollDice(fg.MP, true) + getAbilityModifier(attrA.智力)) * dif;
            base.MP.最大 += add; base.MP.当前 = base.MP.最大;
          }
          grantedLv = lv;
          fe.grantedLv = lv;
          if (fusedMeta) fusedMeta.grantedLv = lv;
          console.log(`[升级脚本·补齐三维]${target}[${job}] HP/MP/SP 满骰对齐 Lv.${lv}（+${dif} 级，${fusedMeta ? '融合' : (isCustomJob ? '自创' : '官方')}职业）`);
        }

        // 2) 技能点补齐（普通职业按 等级×每级sp；融合/自创职业按各自推导）
        if (grantedSp < 0) grantedSp = 0;
        let perLv = 0;
        if (fusedMeta) perLv = safeParseInt(resolveFusedGrowth(job).sp, 0);
        else if (isCustomJob) perLv = safeParseInt(resolveCustomJobGrowth(job, fe).sp, 0);
        else perLv = safeParseInt((lookupJobGrowth(job) || {}).sp, 0);
        if (perLv > 0) {
          const shouldHave = lv * perLv;
          if (grantedSp < shouldHave) {
            const gap = shouldHave - grantedSp;
            fe.技能点 = safeParseInt(fe.技能点, 0) + gap;
            grantedSp = shouldHave;
            fe.grantedSp = shouldHave;
            if (fusedMeta) fusedMeta.grantedSp = shouldHave;
            console.log(`[升级脚本·补齐三维]${target}[${job}] 技能点 +${gap}（Lv.${lv} × ${perLv} = ${shouldHave}）`);
          }
        }
      }

      // 总等级/等阶校正
      let total = 0;
      for (const j in jobsInfo) total += safeParseInt(jobsInfo[j]?.等级, 0);
      total += safeParseInt(base.待分配职业等级, 0);
      if (total > 0) base.总等级 = total;
      updateActorRank(actor);

      console.log(`[升级脚本·补齐三维] ${target} 完成，总等级 ${base.总等级}，等阶 ${actor.等阶}`);
      return variables;
    }, { type: 'message', message_id: -1 });
  }

  // ---- 职业融合：移除源职业、加入融合职业、三维守恒 ----
  // 状态栏已在 $customSkillTrees 写好融合技能树与 fusedFrom，这里完成职业信息合并 + 三维补齐
  // 参数：{ target, jobA, jobB, fusedName, combinedLevel }
  function 执行融合({ target, jobA, jobB, fusedName, combinedLevel }) {
    updateVariablesWith(variables => {
      const statData = variables?.stat_data;
      if (!statData) { console.warn('[升级脚本] 执行融合：stat_data 不可用'); return variables; }
      _customTrees = statData?.$customSkillTrees || {};
      const actor = resolveActor(statData, target);
      ensureActorShape(actor);
      const jobsInfo = actor.基础状态.职业信息 || (actor.基础状态.职业信息 = {});

      // 记录源职业技能点（融合技能点=两源之和，脚本规则）
      const spSum = (safeParseInt(jobsInfo[jobA]?.技能点, 0) || 0) + (safeParseInt(jobsInfo[jobB]?.技能点, 0) || 0);

      // 移除源职业
      delete jobsInfo[jobA];
      delete jobsInfo[jobB];

      // 加入融合职业（继承等级；技能点=两源之和，随后由三维守恒逻辑按 grantedSp 对齐补发）
      const lv = Math.max(1, safeParseInt(combinedLevel, 1));
      jobsInfo[fusedName] = { 等级: lv, 技能点: spSum, grantedLv: 0, grantedSp: 0 };

      // 三维守恒：按融合成长满骰补齐 HP/MP/SP（源职业已有三维不清零，采用"补差对齐"不重复计骰）
      // 参考 processActor 融合保底：grantedLv 从 0 补到 lv
      const fusedMeta = _customTrees?.[fusedName]?.['职业融合'];
      const fg = resolveFusedGrowth(fusedName);
      const attrA = actor.基础属性 || {};
      const base = actor.基础状态;
      if (base.HP && fg.HP) { const hpMult = getRankHpMult(lv); base.HP.最大 += Math.max(1, Math.round((rollDice(fg.HP, true) + getAbilityModifier(attrA.体质)) * hpMult)) * lv; base.HP.当前 = base.HP.最大; }
      if (base.SP && fg.SP) { base.SP.最大 += Math.max(0, rollDice(fg.SP, true) + getAbilityModifier(attrA.体质)) * lv; base.SP.当前 = base.SP.最大; }
      if (base.MP && fg.MP) { base.MP.最大 += Math.max(0, rollDice(fg.MP, true) + getAbilityModifier(attrA.智力)) * lv; base.MP.当前 = base.MP.最大; }
      const perLv = safeParseInt(fg.sp, 0);
      const shouldHaveSp = lv * perLv;
      if (shouldHaveSp > 0 && jobsInfo[fusedName].技能点 < shouldHaveSp) {
        jobsInfo[fusedName].技能点 = shouldHaveSp;
      }
      jobsInfo[fusedName].grantedLv = lv;
      jobsInfo[fusedName].grantedSp = shouldHaveSp;
      if (fusedMeta) { fusedMeta.grantedLv = lv; fusedMeta.grantedSp = shouldHaveSp; }

      // 总等级/等阶校正
      let total = 0;
      for (const j in jobsInfo) total += safeParseInt(jobsInfo[j]?.等级, 0);
      total += safeParseInt(base.待分配职业等级, 0);
      if (total > 0) base.总等级 = total;
      updateActorRank(actor);

      console.log(`[升级脚本·执行融合] ${target} 融合完成：${jobA}+${jobB} → ${fusedName} Lv.${lv}，总等级 ${base.总等级}`);
      return variables;
    }, { type: 'message', message_id: -1 });
  }

  // 注册对外接口对象；供状态栏 window.升级脚本.应用分配/.执行融合/.查职业成长 访问
  const 升级脚本接口 = {
    应用分配: (opts) => 补齐三维(opts?.target, opts?.jobs || {}, opts?.attr || {}),
    执行融合: (opts) => 执行融合(opts || {}),
    查职业成长: (jobName) => { const g = lookupJobGrowth(jobName); return g ? { HP: g.HP, MP: g.MP, SP: g.SP, sp: g.sp, mpKey: g.mpKey } : null; }
  };
  try { window.升级脚本 = 升级脚本接口; } catch (e) { /* ignore */ }
  try { if (typeof initializeGlobal === 'function') initializeGlobal('升级脚本', 升级脚本接口); } catch (e) { /* ignore */ }

  function onManualLevelUpButton() {
    const raw = (typeof prompt === 'function')
      ? prompt('手动升级（格式：目标 职业 级数）\n目标填「主角」或同伴名；级数可省略，默认 +1', '主角 战士 1')
      : null;
    if (!raw) return;
    const parts = raw.trim().split(/\s+/);
    const target = parts[0];
    const jobName = parts[1];
    const delta = parts.length > 2 ? safeParseInt(parts[2], 1) : 1;
    if (!target || !jobName) {
      if (typeof toastr !== 'undefined') toastr.error('[手动升级] 格式错误，应为「目标 职业 级数」');
      return;
    }
    manualLevelUp(target, jobName, delta);
  }

  const 按钮名 = '手动升级';
  function registerManualButton() {
    if (typeof getScriptButtons !== 'function') return;
    const btns = getScriptButtons();
    if (!btns.some(b => b.name === 按钮名)) {
      btns.push({ name: 按钮名, visible: true });
      replaceScriptButtons(btns);
    }
    eventOn(getButtonEvent(按钮名), onManualLevelUpButton);
  }

  // ---- 事件注册 ----
  const init = async () => {
    await waitGlobalInitialized('Mvu');
    eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, handleJobUpgrade);
    // 供状态栏「升级分配」直接改等级后手动触发成长补发（该路径不经过 VARIABLE_UPDATE_ENDED）。
    // 状态栏与脚本是不同 iframe，不能直接调 window，改用酒馆助手事件总线通信。
    eventOn('职业升级_手动处理', (rawVariables, rawVariablesBefore) => {
      handleJobUpgrade(rawVariables, rawVariablesBefore);
    });
    registerManualButton();
    console.log('[职业升级脚本] 已加载（自动等阶计算 · 经验全自动 三次加速递增 · 防双重升级复位 · 转职/兼职支持）');
    if (typeof toastr !== 'undefined') toastr.success('[职业升级脚本] 已加载');
  };

  $(init);
})();