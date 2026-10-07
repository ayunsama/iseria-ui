/* 构建读档机制点击测试页：
 *  - 演示/读档-楼层文档.html  楼层文档（?floor=N&stub=1 参数化；stub=1 时内嵌运行读档补丁的状态栏 stub）
 *  - 演示/读档机制测试.html   顶层测试页（两个楼层 iframe：老楼层3无stub / 最新楼层12有stub，假 TavernHelper + 日志）
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '状态栏.html'), 'utf8');
const blocks = [];
const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html)) !== null) {
  if (m[1].indexOf('__isuriaSavePatch') !== -1) blocks.push(m[1]);
}
if (blocks.length !== 1) { console.error('补丁块提取异常: ' + blocks.length); process.exit(1); }
const PATCH = blocks[0].replace(/<\/script/gi, '<\\/script');

// ---------- 楼层文档（被 iframe 加载，query: ?floor=N&stub=1） ----------
// savebar 外层容器带 mesid 属性（模拟酒馆 .mes 结构，floorOf 靠它解析楼层号）
const floorDoc = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><style>
body{font-family:"Microsoft YaHei";margin:6px;font-size:13px;}
[data-iz-savebar]{border:1px dashed #8b6b4a;padding:6px;margin:6px 0;}
[data-iz-savebar] button{padding:2px 8px;cursor:pointer;}
</style></head><body>
<div id="tag" style="font-size:11px;color:#888;"></div>
<div id="barbox"></div>
<div id="stubbox"></div>
<script>
(function(){
  var q = {}; location.search.replace(/^\\?/, '').split('&').forEach(function(kv){ var p = kv.split('='); q[p[0]] = p[1] || ''; });
  var floor = parseInt(q.floor, 10) || 0;
  document.getElementById('tag').textContent = '（楼层文档 · mesid=' + floor + (q.stub ? ' · 含状态栏stub' : ' · 无stub=老楼层') + '）';
  var bar = document.createElement('div');
  bar.setAttribute('mesid', String(floor));
  bar.setAttribute('data-iz-savebar', '');
  bar.innerHTML = '⏳ 时空存档：<button data-iz-save="1">存1</button><button data-iz-load="1">读1</button><button data-iz-save="2">存2</button><button data-iz-load="2">读2</button><button data-iz-save="3">存3</button><button data-iz-load="3">读3</button> <span data-iz-info style="color:#888;">存1:空　存2:空　存3:空</span>';
  document.getElementById('barbox').appendChild(bar);
  if (q.stub) {
    var f = document.createElement('iframe');
    f.style.cssText = 'width:95%;height:64px;border:1px solid #ccc;';
    f.srcdoc = '<html><head><meta charset="UTF-8"></head><body style="font-family:Microsoft YaHei;font-size:12px;margin:4px;">状态栏 stub（运行读档补丁）<scr' + 'ipt>' + ${JSON.stringify(PATCH)} + '</scr' + 'ipt></body></html>';
    document.getElementById('stubbox').appendChild(f);
  }
})();
</script>
</body></html>`;

// ---------- 顶层测试页 ----------
const topPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>时空存档·读档机制 点击测试</title>
<style>
body{font-family:"Microsoft YaHei";margin:10px;background:#f5f0e6;color:#333;}
#log{height:150px;overflow:auto;background:#fff;border:1px solid #999;padding:6px;font-size:12px;font-family:Consolas,monospace;}
button{padding:4px 10px;margin:2px;cursor:pointer;}
iframe{width:100%;height:170px;border:2px solid #8b6b4a;background:#fff;box-sizing:border-box;margin-bottom:6px;}
h3{margin:6px 0;}
</style></head><body>
<h3>⏳ 时空存档·读档机制 点击测试（真实鼠标点击验证）</h3>
<div style="font-size:12px;color:#666;line-height:1.7;">
结构：顶层（模拟酒馆主文档，挂假 TavernHelper）→ 楼层3 iframe（老楼层，无状态栏stub）+ 楼层12 iframe（最新楼层，含状态栏stub 运行真实读档补丁）。<br>
实测顺序：① 真实点击 <b>楼层12 的「存1」</b>→ 应出现 toastr 成功日志；② 真实点击 <b>楼层3（老楼层）的「存2」</b>→ 修复前无任何反应（监听器从未装到该文档）。</div>
<div>
<button onclick="document.getElementById('f3').contentWindow.location.reload()">🔄 重载楼层3文档（模拟楼层重渲染）</button>
<button onclick="document.getElementById('log').innerHTML='';IZLOG('日志已清空')">清空日志</button>
</div>
<div id="log"></div>
<div style="font-size:12px;font-weight:bold;color:#8b6b4a;">楼层3（老楼层 · 无stub · 修复前监听器覆盖不到）</div>
<iframe id="f3" src="./读档-楼层文档.html?floor=3"></iframe>
<div style="font-size:12px;font-weight:bold;color:#8b6b4a;">楼层12（最新楼层 · stub运行读档补丁）</div>
<iframe id="f12" src="./读档-楼层文档.html?floor=12&stub=1"></iframe>
<script>
window.IZLOG = function(msg, color){ var d=document.createElement('div'); d.style.color=color||'#333'; d.textContent='['+new Date().toLocaleTimeString()+'] '+msg; var L=document.getElementById('log'); L.appendChild(d); L.scrollTop=L.scrollHeight; };
window.SLOTS = {};
window.TavernHelper = {
  getVariables: function(o){ return Promise.resolve({ isuria_save_slots: window.SLOTS }); },
  insertOrAssignVariables: function(payload, o){ Object.assign(window.SLOTS, payload.isuria_save_slots); IZLOG('TH.insertOrAssignVariables 已写入聊天变量', '#2980b9'); return Promise.resolve(true); },
  getLastMessageId: function(){ return 12; },
  deleteChatMessages: function(ids){ IZLOG('TH.deleteChatMessages: 删除楼层 ' + JSON.stringify(ids), '#c0392b'); return Promise.resolve(); },
  toastr: { success(m,t){IZLOG('[toastr·成功] '+(t?t+'：':'')+m,'#27ae60');}, info(m,t){IZLOG('[toastr·信息] '+(t?t+'：':'')+m,'#2980b9');}, error(m,t){IZLOG('[toastr·错误] '+(t?t+'：':'')+m,'#c0392b');}, warning(m,t){IZLOG('[toastr·警告] '+(t?t+'：':'')+m,'#e67e22');} }
};
IZLOG('测试页就绪：楼层3（无stub）+ 楼层12（含stub）已加载', '#8e44ad');
<\/script>
</body></html>`;

fs.writeFileSync(path.join(__dirname, '读档-楼层文档.html'), floorDoc);
fs.writeFileSync(path.join(__dirname, '读档机制测试.html'), topPage);
console.log('已生成: 读档-楼层文档.html + 读档机制测试.html（补丁 ' + PATCH.length + ' 字符）');
