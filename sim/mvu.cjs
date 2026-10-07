/* 伊瑟利亚 · 百楼模拟器 —— MVU 命令应用器（JSONPatch 5 op + zod 全树校验逐条回滚）
 * 语义对齐 MagVarUpdate bundle + mvu_zod：
 *   replace→set / delta→add / insert→对象assign或数组push / remove→delete / move→move
 *   路径容忍 /stat_data 前缀；_/$ 前缀 AI 只读（AI 命令含 _ 路径直接拒绝）
 *   每条命令应用后在 klona 副本上 safeParse 全树，失败→回滚该条并记录错误
 */
const _ = require('C:/Users/Administrator/Desktop/编写模板/node_modules/lodash');
const fs = require('fs');
const path = require('path');

// zod 由变量结构脚本注册时捕获（registerMvuSchema 桩传入）
let registeredSchema = null;
function registerMvuSchema(schema) { registeredSchema = schema; }
function validateStat(statData) {
  if (!registeredSchema) return { ok: true };
  const r = registeredSchema.safeParse(statData);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: r.error };
}

function segsOf(pathStr) {
  let s = String(pathStr || '');
  if (s.charAt(0) === '/') return s.split('/').filter(x => x !== '').map(x => x.replace(/~1/g, '/').replace(/~0/g, '~'));
  return s.split('.').filter(x => x !== '').map(x => x.replace(/~1/g, '/').replace(/~0/g, '~'));
}
function stripRoot(segs) {
  if (segs.length && (segs[0] === 'stat_data' || segs[0] === 'status_current_variables')) return segs.slice(1);
  return segs;
}
function segsToPoint(segs) { return segs.map(s => s.replace(/\./g, '\\.').replace(/^(\d)/, '[$1]').replace(/\$/g, '\\$')); }
function setBySegs(obj, segs, value) { _.set(obj, segs, value); }
function getBySegs(obj, segs) { return segs.length === 0 ? obj : _.get(obj, segs); }
function deleteBySegs(obj, segs) {
  if (segs.length === 0) return;
  const parent = getBySegs(obj, segs.slice(0, -1));
  const last = segs[segs.length - 1];
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else if (parent && typeof parent === 'object') delete parent[last];
}

// 从 AI 消息提取 <JSONPatch> 命令 → 转换为 CommandInfo 形态（对齐真实 MVU：
// COMMAND_PARSED 监听器消费 type/args 结构，JSONPatch 的 op/path/value 在框架内已转换）
function extractCommands(message) {
  const out = [];
  const re = /<JSONPatch>([\s\S]*?)<\/JSONPatch>/g;
  let m;
  while ((m = re.exec(String(message || ''))) !== null) {
    let arr;
    try { arr = JSON.parse(m[1].trim()); } catch (e) { continue; }
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      const op = raw.op;
      const p = raw.path;
      if (!op || p === undefined) continue;
      if (op === 'move') out.push({ type: 'move', args: [p, raw.to || raw.from], full_match: p, reason: 'JSONPatch move' });
      else if (op === 'remove') out.push({ type: 'remove', args: [p], full_match: p, reason: 'JSONPatch remove' });
      else out.push({ type: op, args: [p, raw.value], full_match: p, reason: 'JSONPatch ' + op });
    }
  }
  return out;
}

// 单条命令应用（原地修改 stat）；返回 null=成功，string=错误
function applyOne(stat, cmd, isFromAI) {
  const op = cmd.type || cmd.op;
  const rawPath = (cmd.args ? cmd.args[0] : cmd.path) || '';
  const segs = stripRoot(segsOf(rawPath));
  if (segs.length === 0) return '空路径';
  if (isFromAI && segs[0] && /^[_$]/.test(segs[0])) return '_/$ 前缀 AI 只读';
  switch (op) {
    case 'replace':
    case 'set': {
      const value = cmd.args ? cmd.args[1] : cmd.value;
      setBySegs(stat, segs, value);
      return null;
    }
    case 'delta':
    case 'add': {
      const value = cmd.args ? cmd.args[1] : cmd.value;
      const cur = Number(getBySegs(stat, segs)) || 0;
      const d = Number(value);
      if (!Number.isFinite(d)) return 'delta 值非数字';
      setBySegs(stat, segs, cur + d);
      return null;
    }
    case 'insert': {
      const value = cmd.args && cmd.args.length >= 2 ? cmd.args[cmd.args.length - 1] : cmd.value;
      const parent = getBySegs(stat, segs);
      if (Array.isArray(parent)) parent.push(value);
      else if (parent && typeof parent === 'object') Object.assign(parent, value);
      else {
        // 父级不存在 → 逐级补对象
        let node = stat;
        for (let i = 0; i < segs.length - 1; i++) {
          if (!node[segs[i]] || typeof node[segs[i]] !== 'object') node[segs[i]] = {};
          node = node[segs[i]];
        }
        node[segs[segs.length - 1]] = value;
      }
      return null;
    }
    case 'remove':
    case 'delete': {
      deleteBySegs(stat, segs);
      return null;
    }
    case 'move': {
      const toSegs = stripRoot(segsOf(cmd.args ? cmd.args[1] : ''));
      const v = getBySegs(stat, segs);
      deleteBySegs(stat, segs);
      setBySegs(stat, toSegs, v);
      return null;
    }
    default:
      return '未知操作: ' + op;
  }
}

// 批量应用 + zod 逐条校验
function applyCommands(stat, commands) {
  const applied = [], errors = [], dropped = [];
  for (const cmd of (commands || [])) {
    const op = cmd.type || cmd.op;
    const snapshot = _.cloneDeep(stat);
    const err = applyOne(stat, cmd, true);
    if (err) { Object.assign(stat, snapshot); errors.push({ cmd: op + ' ' + (cmd.args ? cmd.args[0] : cmd.path), reason: err }); dropped.push(cmd); continue; }
    const v = validateStat(stat);
    if (!v.ok) {
      Object.assign(stat, snapshot);
      const msg = (v.error && v.error.issues ? v.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; ') : String(v.error));
      errors.push({ cmd: op + ' ' + (cmd.args ? cmd.args[0] : cmd.path), reason: 'zod: ' + msg.slice(0, 200) });
      dropped.push(cmd);
      continue;
    }
    applied.push(cmd);
  }
  return { applied, errors, dropped };
}

// parseMessage 复刻（Mvu.parseMessage 桩用）
function parseMessageToData(message, stat) {
  const cmds = extractCommands(message);
  applyCommands(stat, cmds);
  return { initialized_lorebooks: {}, stat_data: stat };
}

module.exports = { registerMvuSchema, extractCommands, applyCommands, parseMessageToData, segsOf, applyOne, validateStat };
