/* 汇总 N 楼模拟报告：token 曲线/膨胀/冲突/系统健康
 * 用法: node sim/report.cjs
 */
const fs = require('fs');
const path = require('path');

const SIM = __dirname;
const raw = fs.readFileSync(path.join(SIM, 'metrics.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
// 按 floor 去重（续跑可能重叠）
const byFloor = new Map();
for (const r of raw) byFloor.set(r.floor, r);
const rows = [...byFloor.values()].sort((a, b) => a.floor - b.floor);

const lines = [];
lines.push('# 伊瑟利亚 · 模拟长跑报告');
lines.push('');
lines.push('- 楼层范围：' + rows[0].floor + ' ~ ' + rows[rows.length - 1].floor + '（共 ' + rows.length + ' 楼，含 ' + rows.filter(r => r.kind === 'ui').length + ' 个UI操作楼）');
lines.push('- 数据源：sim/metrics.jsonl（逐楼指标）');
lines.push('');
lines.push('## 1. Token 曲线（口径说明）');
lines.push('');
lines.push('真实游玩（酒馆双API结构）：**正文API** 收 世界书+历史+用户行为；**额外变量更新API** 单独收一份上下文并只输出 UpdateVariable 块，不占正文。下表 `正文输入` 对应前者，`变量API折算` 为后者（输入≈同份上下文，输出=UpdateVariable块）。本地无第二端点，变量更新与正文同源，故 `实测合计` = 正文输入+正文输出（含变量块）；`变量API折算` 仅供估算真实游玩的双API开销。');
lines.push('');
lines.push('| 楼 | 正文输入tok | 正文输出tok | 变量块字 | 变量API折算输入tok | stat字节 | 流水 | 新闻 | NPC | 任务 | 补丁应/弃 |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  lines.push('| ' + r.floor + ' | ' + r.ctxTokens + ' | ' + (r.replyTokens || '-') + ' | ' + (r.varApiLoad ? r.varApiLoad.outputChars : 0) + ' | ' + (r.varApiLoad ? r.varApiLoad.inputTokens : '-') + ' | ' + r.statBytes + ' | ' + r.追踪记录 + ' | ' + r.动态新闻 + ' | ' + r.主要NPC + ' | ' + (r.任务 || 0) + ' | ' + r.patchApplied + '/' + r.patchDropped + ' |');
}
// 趋势
const llm = rows.filter(r => r.kind !== 'ui');
if (llm.length >= 2) {
  const first = llm[0], last = llm[llm.length - 1];
  const ctxGrowth = last.ctxTokens - first.ctxTokens;
  const statGrowth = last.statBytes - first.statBytes;
  const avgCtx = Math.round(llm.reduce((s, r) => s + r.ctxTokens, 0) / llm.length);
  lines.push('');
  lines.push('- **上下文趋势**：首楼 ' + first.ctxTokens + 'tok → 末楼 ' + last.ctxTokens + 'tok（净增 ' + ctxGrowth + 'tok），均值 ' + avgCtx + 'tok/楼');
  lines.push('- **stat_data 趋势**：' + first.statBytes + 'B → ' + last.statBytes + 'B（净增 ' + statGrowth + 'B）');
  const totalIn = llm.reduce((s, r) => s + r.ctxTokens, 0);
  const totalOut = llm.reduce((s, r) => s + (r.replyTokens || 0), 0);
  const varApiIn = llm.reduce((s, r) => s + (r.varApiLoad ? r.varApiLoad.inputTokens : 0), 0);
  const varApiOut = llm.reduce((s, r) => s + Math.round((r.varApiLoad ? r.varApiLoad.outputChars : 0) / 2.2), 0);
  lines.push('- **累计**：正文输入 ' + totalIn + 'tok + 正文输出 ' + totalOut + 'tok = ' + (totalIn + totalOut) + 'tok；其中变量块输出约 ' + Math.round(varApiOut) + 'tok');
  lines.push('- **真实游玩双API估算**：正文API≈' + (totalIn + (totalOut - varApiOut)) + 'tok；额外变量API≈' + (varApiIn + varApiOut) + 'tok');
}

lines.push('');
lines.push('## 2. 变量膨胀监测（只进不出问题）');
lines.push('');
lines.push('| 容器 | 起始 | 末尾 | 净增 | 风险评估 |');
lines.push('|---|---|---|---|---|');
const firstRow = rows[0], lastRow = rows[rows.length - 1];
function assess(container, cap) {
  const v = lastRow[container];
  if (!v) return '—';
  if (cap && v >= cap * 0.8) return '⚠️ 接近上限(' + cap + ')';
  if (v > 20) return '⚠️ 持续增长';
  return '正常';
}
[['追踪记录', null], ['动态新闻', null], ['主要NPC', null], ['任务', null], ['物品栏', null], ['家族成员', null], ['产业', null]].forEach(([k]) => {
  lines.push('| ' + k + ' | ' + (firstRow[k] || 0) + ' | ' + (lastRow[k] || 0) + ' | ' + ((lastRow[k] || 0) - (firstRow[k] || 0)) + ' | ' + assess(k) + ' |');
});
lines.push('| 培养记录(全员累计) | ' + (firstRow.培养记录总数 || 0) + ' | ' + (lastRow.培养记录总数 || 0) + ' | ' + ((lastRow.培养记录总数 || 0) - (firstRow.培养记录总数 || 0)) + ' | 有20条/人硬上限（脚本RECORD_KEEP） |');
const statKB = (lastRow.statBytes / 1024).toFixed(1);
lines.push('');
lines.push('- stat_data 总量 ' + (firstRow.statBytes / 1024).toFixed(1) + 'KB → ' + statKB + 'KB。**折算进变量列表（AI可见）约 ' + Math.round(lastRow.statBytes / 2.2) + 'tok/楼**，其中追踪记录/新闻已有近5条+过期过滤，真正全量进上下文的是 主角/同伴/物品。');

lines.push('');
lines.push('## 3. 系统冲突与错误');
lines.push('');
const conflictKinds = {};
let zodTotal = 0, droppedTotal = 0, warnTotal = 0;
for (const r of rows) {
  for (const c of (r.conflicts || [])) {
    const kind = c.split('(')[0];
    conflictKinds[kind] = (conflictKinds[kind] || 0) + 1;
  }
  zodTotal += (r.zodErrors || []).length;
  droppedTotal += r.patchDropped || 0;
  warnTotal += (r.warnings || []).length;
}
lines.push('| 类型 | 出现次数 | 说明 |');
lines.push('|---|---|---|');
for (const [k, n] of Object.entries(conflictKinds)) {
  lines.push('| ' + k + ' | ' + n + '/' + rows.length + ' 楼 | ' + (k.includes('总等级') ? '开局初始变量 总等级=1 而 Σ职业=0（无职业开局）——升级脚本只在有职业时校准，属低危口径问题，建议初始变量 无职业时 总等级=0 或行为表首楼登记职业' : '') + ' |');
}
lines.push('| zod 校验错误 | ' + zodTotal + ' | ' + (zodTotal ? '见逐楼明细' : 'AI 全部输出通过 schema 校验') + ' |');
lines.push('| 补丁被弃 | ' + droppedTotal + ' | ' + (droppedTotal ? '守卫拦截（预期行为）' : '无越权写入') + ' |');
lines.push('| 脚本警告/toastr | ' + warnTotal + ' | 含 toast 提示 |');

lines.push('');
lines.push('## 4. 逐楼警告明细');
lines.push('');
let anyWarn = false;
for (const r of rows) {
  if ((r.warnings || []).length) { anyWarn = true; lines.push('- 楼' + r.floor + '：' + r.warnings.map(w => String(w).slice(0, 100)).join('；')); }
  for (const e of (r.zodErrors || [])) lines.push('- 楼' + r.floor + ' zod❌ ' + e.cmd + ' → ' + String(e.reason).slice(0, 120));
}
if (!anyWarn) lines.push('-（无）');

fs.writeFileSync(path.join(SIM, 'report.md'), lines.join('\n'));
console.log('报告已生成: sim/report.md（' + rows.length + ' 楼）');
