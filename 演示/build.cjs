/* 构建演示页：把 模拟环境 + jQuery/lodash + 真实产业结算脚本 注入 状态栏.html */
const fs = require('fs');
const path = require('path');

const root = __dirname + '/..';
const read = (p) => fs.readFileSync(p, 'utf8');

let html = read(path.join(root, '状态栏.html'));
const jquery = read('C:/Users/Administrator/Desktop/编写模板/node_modules/jquery/dist/jquery.min.js');
const lodash = read('C:/Users/Administrator/Desktop/编写模板/node_modules/lodash/lodash.min.js');
const mock = read(path.join(root, '演示/mock环境.js'));
const settle = read(path.join(root, 'scripts/产业结算脚本.js'));

// 内联脚本中若出现 </script> 会截断标签，统一转义为 <\/script>（字符串/正则内等价）
const esc = (js) => js.replace(/<\/script/gi, '<\\/script');

// 1) 页面标题
html = html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n    <title>伊瑟利亚 · 家族/产业系统演示</title>');

// 2) 在模块脚本（整个状态栏逻辑）之前注入：jQuery → lodash → 模拟环境 → 真实结算脚本
const inject = [
  '<script>' + esc(jquery) + '</script>',
  '<script>' + esc(lodash) + '</script>',
  '<script>' + esc(mock) + '</script>',
  '<script>' + esc(settle) + '</script>'
].join('\n');

const marker = '<script type="module">';
const idx = html.indexOf(marker);
if (idx === -1) { console.error('未找到模块脚本标记'); process.exit(1); }
html = html.slice(0, idx) + inject + '\n' + html.slice(idx);

const out = path.join(root, '演示-家族产业.html');
fs.writeFileSync(out, html);
console.log('已生成: ' + out + '（' + Math.round(html.length / 1024) + 'KB）');
