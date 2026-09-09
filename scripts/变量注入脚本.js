await waitGlobalInitialized('Mvu');

console.log('[变量通知] 全局变量变更监听已启动，将在变量更新时注入提示词。');

eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (newVars, oldVars) => {
  const changes = [];
  const newData = newVars?.stat_data;
  const oldData = oldVars?.stat_data;
  if (!newData || !oldData) return;

  // ========== 地点变化监听（新增） ==========
  const newLocation = _.get(newData, '世界.当前地点', '');
  const oldLocation = _.get(oldData, '世界.当前地点', '');

  if (newLocation && newLocation !== oldLocation) {
    // 将新地点写入持久存储
    _.set(newData, '$flags.lastLocation', newLocation);
    console.log(`[地点监听] 地点已更新为: ${newLocation}`);
    // 如果想在变量通知中也提示，可加入 changes
    // changes.push(`当前位置：${oldLocation || '无'} → ${newLocation}`);
  }
  // =========================================

  // ---------- 辅助函数 ----------
  function diffNumber(path, label, format = v => v) {
    const oldVal = _.get(oldData, path, 0);
    const newVal = _.get(newData, path, 0);
    if (newVal !== oldVal) {
      changes.push(`${label}：${format(oldVal)} → ${format(newVal)}`);
    }
  }

  function diffContainerKeys(path, label) {
    const oldObj = _.get(oldData, path, {});
    const newObj = _.get(newData, path, {});
    const oldKeys = Object.keys(oldObj);
    const newKeys = Object.keys(newObj);
    const added = newKeys.filter(k => !oldKeys.includes(k));
    const removed = oldKeys.filter(k => !newKeys.includes(k));
    if (added.length > 0) changes.push(`新增${label}：${added.join('、')}`);
    if (removed.length > 0) changes.push(`移除${label}：${removed.join('、')}`);
    if (added.length === 0 && removed.length === 0 && !_.isEqual(oldObj, newObj)) {
      changes.push(`${label}内容已更新`);
    }
  }

  // ---------- 世界 ----------
  diffNumber('世界.紧张度.当前值', '世界紧张度');
  const oldTensionLv = _.get(oldData, '世界.紧张度.等级', '');
  const newTensionLv = _.get(newData, '世界.紧张度.等级', '');
  if (oldTensionLv !== newTensionLv) {
    changes.push(`世界紧张度等级：${oldTensionLv} → ${newTensionLv}`);
  }

  // ---------- 主角 ----------
  const p = '主角';
  diffNumber(`${p}.资产与能力.货币`, '货币', v => `${v}铜盾`);
  diffNumber(`${p}.基础状态.HP.当前`, 'HP');
  diffNumber(`${p}.基础状态.MP.当前`, 'MP');
  diffNumber(`${p}.基础状态.SP.当前`, 'SP');
  diffNumber(`${p}.基础状态.经验值.当前`, '经验值');
  diffNumber(`${p}.基础状态.总等级`, '总等级');
  diffNumber(`${p}.基础状态.待分配职业等级`, '待分配职业等级');
  diffNumber(`${p}.基础属性.未分配点数`, '未分配属性点');

  diffContainerKeys(`${p}.基础状态.自身状态`, '自身状态');
  diffContainerKeys(`${p}.基础状态.职业信息`, '职业');
  diffContainerKeys(`${p}.资产与能力.物品栏`, '物品');
  diffContainerKeys(`${p}.资产与能力.角色技能`, '角色技能');
  diffContainerKeys(`${p}.资产与能力.魔法栏`, '魔法');
  diffContainerKeys(`${p}.资产与能力.神术栏`, '神术');
  diffContainerKeys(`${p}.资产与能力.加护`, '加护');
  diffContainerKeys(`${p}.资产与能力.权能`, '权能');
  diffContainerKeys(`${p}.任务`, '任务');

  // ---------- 同伴 ----------
  const oldComps = _.get(oldData, '同伴', {});
  const newComps = _.get(newData, '同伴', {});
  const compAdded = Object.keys(newComps).filter(n => !(n in oldComps));
  const compRemoved = Object.keys(oldComps).filter(n => !(n in newComps));
  if (compAdded.length > 0) changes.push(`同伴加入：${compAdded.join('、')}`);
  if (compRemoved.length > 0) changes.push(`同伴离队：${compRemoved.join('、')}`);
  const commonComps = Object.keys(newComps).filter(n => n in oldComps);
  for (const name of commonComps) {
    diffNumber(`同伴.${name}.好感度`, `同伴「${name}」好感度`);
    diffNumber(`同伴.${name}.基础状态.HP.当前`, `同伴「${name}」HP`);
    diffNumber(`同伴.${name}.基础状态.MP.当前`, `同伴「${name}」MP`);
    diffNumber(`同伴.${name}.基础状态.SP.当前`, `同伴「${name}」SP`);
    diffNumber(`同伴.${name}.基础状态.经验值.当前`, `同伴「${name}」经验值`);
  }

  // ---------- 主要NPC ----------
  const oldNpcs = _.get(oldData, '主要NPC', {});
  const newNpcs = _.get(newData, '主要NPC', {});
  const npcAdded = Object.keys(newNpcs).filter(n => !(n in oldNpcs));
  const npcRemoved = Object.keys(oldNpcs).filter(n => !(n in newNpcs));
  if (npcAdded.length > 0) changes.push(`认识新NPC：${npcAdded.join('、')}`);
  if (npcRemoved.length > 0) changes.push(`NPC移除：${npcRemoved.join('、')}`);
  for (const name of Object.keys(newNpcs)) {
    if (name in oldNpcs) {
      const oldFav = _.get(oldData, `主要NPC.${name}.好感度`, 0);
      const newFav = _.get(newData, `主要NPC.${name}.好感度`, 0);
      if (oldFav !== newFav) changes.push(`NPC「${name}」好感度：${oldFav} → ${newFav}`);
    }
  }

  // ---------- 英灵 ----------
  diffNumber('英灵.残响之力', '英灵残响之力');
  const oldSpiritStatus = _.get(oldData, '英灵.状态', '');
  const newSpiritStatus = _.get(newData, '英灵.状态', '');
  if (oldSpiritStatus !== newSpiritStatus) {
    changes.push(`英灵状态：${oldSpiritStatus} → ${newSpiritStatus}`);
  }

  // 日志
  if (changes.length > 0) {
    console.log(`[变量通知] 本次变量变动摘要：\n${changes.map(c => `  - ${c}`).join('\n')}`);
  } else {
    console.log('[变量通知] 变量更新但无变更');
  }

  if (changes.length === 0) return;

  injectPrompts([{
    id: 'var-change-notify',
    content: `【系统提示】变量发生如下变动：\n${changes.map(c => `- ${c}`).join('\n')}`,
    position: 'none',
    depth: 0,
    role: 'system',
    should_scan: false
  }]);
});