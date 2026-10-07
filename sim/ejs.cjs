/* 伊瑟利亚 · 百楼模拟器 —— 迷你 EJS + 酒馆宏
 * 支持 <% code %>、<%= expr %>（模板纯 JS 语法）；宏：{{roll:NdM}}、{{user}}、{{char}}
 * getvar(path, {defaults}) 读 stat_data 下路径；print(s) 追加输出。
 */
const _ = require('C:/Users/Administrator/Desktop/编写模板/node_modules/lodash');

function rollOnce(sides) { return 1 + Math.floor(Math.random() * sides); }
function expandMacros(text) {
  return String(text || '')
    .replace(/\{\{roll:\s*(\d+)d(\d+)\s*\}\}/g, (m, n, s) => {
      let total = 0; const cnt = parseInt(n, 10) || 1, sides = parseInt(s, 10) || 6;
      for (let i = 0; i < cnt; i++) total += rollOnce(sides);
      return String(total);
    })
    .replace(/\{\{user\}\}/g, '青空黎')
    .replace(/\{\{char\}\}/g, '伊瑟利亚大陆3.6');
}

// 编译模板（缓存）：print(...) 与 __out 并存，print 也 push 进 __out
const cache = new Map();
function compile2(tpl) {
  if (cache.has(tpl)) return cache.get(tpl);
  let code = "const __out = [];\nconst print = (s) => __out.push(String(s));\n";
  const re = /<%(=?)([\s\S]*?)%>/g;
  let last = 0, m;
  while ((m = re.exec(tpl)) !== null) {
    if (m.index > last) code += "__out.push(" + JSON.stringify(tpl.slice(last, m.index)) + ");\n";
    if (m[1] === '=') code += "__out.push(String((" + m[2] + ")));\n";
    else code += m[2] + "\n";
    last = m.index + m[0].length;
  }
  if (last < tpl.length) code += "__out.push(" + JSON.stringify(tpl.slice(last)) + ");\n";
  code += "return __out.join('');";
  const fn = new Function('getvar', '_', code);
  cache.set(tpl, fn);
  return fn;
}
function segGet(root, p) {
  const segs = String(p || '').split('.').filter(Boolean);
  let node = root;
  for (const s of segs) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[s];
  }
  return node;
}
function renderEntry(tpl, statData) {
  const root = { stat_data: statData };
  const getvar = (p, opts) => {
    const v = segGet(root, p);
    return v !== undefined ? v : (opts && opts.defaults !== undefined ? opts.defaults : undefined);
  };
  try {
    return expandMacros(compile2(tpl)(getvar, _));
  } catch (e) {
    return '【EJS渲染失败: ' + e.message.slice(0, 120) + '】';
  }
}

module.exports = { renderEntry, expandMacros };
