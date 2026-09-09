// @ts-nocheck
// ============================================================
// 伊瑟利亚交互地图 · 悬浮窗插件
// 点击右下角 🗺 按钮开关世界地图：世界大地图 ⇄ 各势力微缩地图钻取、
// 据点悬停详情、AVG 风格信息卡、12 类地点筛选、滚轮缩放与拖拽平移。
// 改造自《伊瑟利亚交互地图_可移植版》；12 张地图以 WebP dataURI 内嵌，离线可用。
// ============================================================
(async function () {
    'use strict';
    if (document.readyState !== 'complete') {
        await new Promise(r => window.addEventListener('load', r, { once: true }));
    }
    // 注入到酒馆主文档（脚本运行在隐藏 iframe 中）
    const pdoc = (window.parent && window.parent.document) || document;
    const win = (window.parent && window.parent.window) || window;
    if (pdoc.getElementById('isx-fab')) return; // 防重复注入

    // ===== 地图图片：从公开 CDN 加载原图（高清）=====
    const CDN_MAPS = 'https://cdn.jsdelivr.net/gh/ayunsama/iseria-ui@main/maps';
    const IMG = {};
    for (const k of ['base','aether','albion','dornheim','empire','kallantia','morgana','nereitin','niflheim','silvantir','ulkan','urgat']) {
        IMG[k] = CDN_MAPS + '/' + k + '.jpg';
    }

    // ===== 样式（全部收拢在 #isx-overlay 作用域内，避免污染酒馆页面）=====
    const CSS = `
#isx-overlay{
  --isx-parch:#f4ebd8; --isx-parch2:#ece0c4; --isx-ink:#3a2c1a; --isx-ink2:#6b5638;
  --isx-gold:#b8892a; --isx-gold-lt:#d8b766; --isx-line:#8a6f45; --isx-shadow:rgba(58,44,26,.28);
  position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
  width:min(1180px,96vw); height:min(860px,92vh);
  z-index:99990; display:none; flex-direction:column; padding:10px 12px; gap:8px;
  border-radius:10px; box-shadow:0 24px 80px rgba(20,12,4,.55), 0 0 0 1px rgba(58,44,26,.4);
  font-family:"Noto Serif SC","Songti SC","STKaiti","KaiTi","Cinzel",serif; color:var(--isx-ink);
  background:radial-gradient(circle at 20% 10%, #efe4cb 0%, #e4d6b4 60%, #d8c79e 100%);
  overflow:hidden; user-select:none;
}
#isx-overlay.dragging{ transform:none; }
@media (max-width:786px){
  #isx-overlay{
    left:0 !important; top:0 !important; right:0; bottom:0;
    transform:none !important; width:100vw; height:100vh; height:100dvh;
    border-radius:0; padding:6px;
  }
  #isx-overlay.dragging{ transform:none !important; }
}
#isx-overlay, #isx-overlay *{box-sizing:border-box;}
#isx-overlay *{margin:0; padding:0;}
#isx-app{display:flex; flex-direction:column; height:100%; padding:10px 12px; gap:8px;}
#isx-topbar{
  display:flex; align-items:center; gap:14px; padding:8px 16px; cursor:grab;
  background:linear-gradient(180deg,#f7f0de,#ecdfc0);
  border:2px solid var(--isx-line); border-radius:4px;
  box-shadow:0 2px 0 #cbb487, inset 0 0 18px rgba(138,111,69,.12);
  position:relative; flex:0 0 auto;
}
#isx-topbar:active{cursor:grabbing;}
#isx-grip{cursor:grab; color:var(--isx-ink2); font-size:15px; padding:0 2px; letter-spacing:2px;}
#isx-topbar::before,#isx-topbar::after{content:"❖"; color:var(--isx-gold); font-size:12px;}
#isx-title{font-size:20px; font-weight:700; letter-spacing:3px; color:var(--isx-ink);}
#isx-title small{font-size:12px; letter-spacing:2px; color:var(--isx-ink2); margin-left:8px;}
#isx-breadcrumb{font-size:13px; color:var(--isx-ink2); display:flex; align-items:center; gap:6px;}
#isx-breadcrumb .crumb{cursor:pointer; padding:2px 8px; border-radius:3px;}
#isx-breadcrumb .crumb:hover{background:rgba(184,137,42,.18);}
#isx-breadcrumb .crumb.cur{color:var(--isx-ink); font-weight:700; cursor:default; background:none;}
#isx-backBtn{
  display:none; margin-left:auto; cursor:pointer; font-family:inherit; font-size:13px;
  padding:6px 14px; color:var(--isx-parch);
  background:linear-gradient(180deg,#7a5a2e,#5e4420);
  border:1px solid #3a2c1a; border-radius:3px; box-shadow:0 2px 0 #3a2c1a; letter-spacing:2px;
}
#isx-backBtn:hover{filter:brightness(1.12);}
#isx-legend{display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-left:auto;}
#isx-legend .lg{
  display:flex; align-items:center; gap:4px; font-size:11px; cursor:pointer;
  padding:3px 7px; border:1px solid var(--isx-line); border-radius:12px; background:#f7f0de; color:var(--isx-ink2);
  transition:.15s;
}
#isx-legend .lg.off{opacity:.32; text-decoration:line-through;}
#isx-legend .lg svg{width:15px; height:15px;}
#isx-legend .lg.all{font-weight:700; color:var(--isx-ink);}
#isx-closebtn{
  cursor:pointer; font-family:inherit; font-size:13px; padding:6px 14px;
  color:#fff; background:linear-gradient(180deg,#a0402a,#7a2e1e);
  border:1px solid #3a2c1a; border-radius:3px; box-shadow:0 2px 0 #3a2c1a; letter-spacing:2px;
}
#isx-closebtn:hover{filter:brightness(1.15);}
#isx-stageWrap{flex:1 1 auto; position:relative; min-height:0; display:flex; align-items:center; justify-content:center;
  border:3px double var(--isx-line); border-radius:5px; overflow:hidden; touch-action:none;
  box-shadow:inset 0 0 40px rgba(107,86,56,.35), 0 4px 14px var(--isx-shadow);
  background:#e9dcbb;}
#isx-overlay .layer{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; opacity:0; pointer-events:none; transition:opacity .45s ease;}
#isx-overlay .layer.show{opacity:1; pointer-events:auto;}
#isx-overlay .mapframe{position:relative; flex:0 0 auto; transform-origin:center center; will-change:transform;}
#isx-overlay .mapframe img.map{width:100%; height:100%; object-fit:fill; display:block; background:#e3d4af;}
#isx-overlay .hot{position:absolute; cursor:pointer;}
#isx-overlay .hot .fill{position:absolute; inset:0; opacity:0; transition:opacity .2s;}
#isx-overlay .hot:hover .fill{opacity:1;}
#isx-overlay .hot .nametag{
  position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  white-space:nowrap; text-align:center; pointer-events:none;
  background:linear-gradient(180deg,rgba(247,240,222,.93),rgba(236,223,192,.93));
  border:1.5px solid var(--isx-line); border-radius:3px; padding:4px 12px;
  box-shadow:0 2px 6px var(--isx-shadow);
}
#isx-overlay .hot .nametag b{display:block; font-size:15px; letter-spacing:2px;}
#isx-overlay .hot .nametag span{display:block; font-size:10px; color:var(--isx-ink2); letter-spacing:1px; margin-top:1px;}
#isx-overlay .hot:hover .nametag{background:linear-gradient(180deg,#fff7e4,#f0e2bd); border-color:var(--isx-gold);
  box-shadow:0 3px 10px rgba(184,137,42,.4);}
#isx-overlay .hot .nametag b .star{color:var(--isx-gold); margin-right:4px;}
#isx-overlay .pt{position:absolute; transform:translate(-50%,-50%); cursor:pointer; z-index:2;}
#isx-overlay .pt .mk{width:30px; height:30px; display:block; filter:drop-shadow(0 2px 2px rgba(0,0,0,.35)); transition:transform .15s;}
#isx-overlay .pt:hover .mk{transform:scale(1.35);}
#isx-overlay .pt .lbl{
  position:absolute; left:50%; top:27px; transform:translateX(-50%); white-space:nowrap;
  font-size:11.5px; font-weight:700; letter-spacing:1px; color:var(--isx-ink);
  background:rgba(247,240,222,.86); border:1px solid rgba(138,111,69,.6); border-radius:3px;
  padding:0 5px; line-height:16px; pointer-events:none;
}
#isx-overlay .pt:hover .lbl{background:#fff7e4; border-color:var(--isx-gold);}
#isx-overlay .pt.hide{display:none;}
#isx-overlay .pt.capital .mk{width:36px; height:36px;}
#isx-overlay .pt.capital .lbl{font-size:13px; top:33px;}
#isx-overlay .pt.pulse .mk{animation:isxPulse 2.4s ease-in-out infinite;}
@keyframes isxPulse{0%,100%{filter:drop-shadow(0 0 0 rgba(212,160,23,0));}
  50%{filter:drop-shadow(0 0 7px rgba(212,160,23,.95));}}
#isx-overlay .pt.pulse.purple .mk{animation:isxPulseP 2.4s ease-in-out infinite;}
@keyframes isxPulseP{0%,100%{filter:drop-shadow(0 0 0 rgba(138,74,154,0));}
  50%{filter:drop-shadow(0 0 7px rgba(138,74,154,.95));}}
#isx-tip{
  position:fixed; z-index:99999; pointer-events:none; opacity:0; transition:opacity .12s;
  max-width:230px; background:linear-gradient(180deg,#fbf4e2,#efe2c2);
  border:1.5px solid var(--isx-gold); border-radius:4px; padding:7px 10px;
  box-shadow:0 4px 12px var(--isx-shadow); font-size:12px; line-height:1.5; color:var(--isx-ink);
  font-family:"Noto Serif SC","Songti SC","STKaiti","KaiTi",serif;
}
#isx-tip.show{opacity:1;}
#isx-tip b{font-size:13px; letter-spacing:1px;}
#isx-tip .tag{display:inline-block; font-size:10px; color:#fff; border-radius:8px; padding:0 7px; margin-left:6px; vertical-align:1px;}
#isx-tip p{color:var(--isx-ink2); margin-top:3px;}
#isx-dlg{
  position:absolute; left:3%; right:3%; bottom:18px; z-index:40;
  display:flex; gap:14px; align-items:stretch;
  background:linear-gradient(180deg,rgba(28,22,14,.93),rgba(46,35,20,.95));
  border:2px solid var(--isx-gold-lt); border-radius:8px; padding:16px 20px;
  box-shadow:0 -4px 26px rgba(0,0,0,.5), inset 0 0 30px rgba(184,137,42,.12);
  color:#efe6cf; transform:translateY(130%); opacity:0; transition:transform .32s ease, opacity .32s;
}
#isx-dlg.show{transform:translateY(0); opacity:1;}
#isx-dlg .portrait{
  flex:0 0 92px; width:92px; border-radius:6px; align-self:center;
  background:radial-gradient(circle,#3a2c1a,#241a0e); border:1.5px solid var(--isx-gold);
  display:flex; align-items:center; justify-content:center; padding:8px;
}
#isx-dlg .portrait svg{width:100%; height:100%;}
#isx-dlg .body{flex:1; min-width:0;}
#isx-dlg .head{display:flex; align-items:baseline; gap:10px; border-bottom:1px solid rgba(216,183,102,.4); padding-bottom:6px; margin-bottom:8px;}
#isx-dlg .head b{font-size:19px; letter-spacing:2px; color:var(--isx-gold-lt);}
#isx-dlg .head .t{font-size:11px; color:#fff; border-radius:9px; padding:1px 9px;}
#isx-dlg .head .belong{font-size:11px; color:#b9a87e; margin-left:auto;}
#isx-dlg .text{font-size:14px; line-height:1.85; letter-spacing:.5px; color:#ece2ca; max-height:150px; overflow:auto;}
#isx-dlg .close{position:absolute; right:10px; top:8px; cursor:pointer; color:#b9a87e; font-size:16px;
  width:24px; height:24px; line-height:22px; text-align:center; border:1px solid #6b5638; border-radius:50%;}
#isx-dlg .close:hover{color:#fff; border-color:var(--isx-gold-lt);}
#isx-regionInfo{
  position:absolute; left:12px; top:12px; z-index:20; max-width:300px;
  background:linear-gradient(180deg,rgba(247,240,222,.94),rgba(236,223,192,.94));
  border:1.5px solid var(--isx-line); border-radius:5px; padding:9px 13px; box-shadow:0 3px 10px var(--isx-shadow);
  display:none;
}
#isx-regionInfo.show{display:block;}
#isx-regionInfo b{font-size:16px; letter-spacing:2px;}
#isx-regionInfo .meta{font-size:11px; color:var(--isx-ink2); margin:3px 0 5px; letter-spacing:1px;}
#isx-regionInfo p{font-size:11.5px; line-height:1.6; color:var(--isx-ink2);}
#isx-compass{position:absolute; right:14px; top:12px; z-index:20; width:64px; height:64px; opacity:.85; pointer-events:none;}
#isx-hint{position:absolute; left:50%; bottom:6px; transform:translateX(-50%); font-size:11px; color:var(--isx-ink2);
  background:rgba(247,240,222,.7); padding:1px 10px; border-radius:10px; z-index:15; letter-spacing:1px;}
#isx-fab{
  position:fixed; right:18px; bottom:calc(18px + env(safe-area-inset-bottom, 0px)); z-index:99991; width:46px; height:46px;
  display:flex; align-items:center; justify-content:center; cursor:grab; font-size:22px;
  background:linear-gradient(180deg,#f7f0de,#d8c79e); color:#5e4420;
  border:2px solid var(--isx-gold); border-radius:50%;
  box-shadow:0 3px 10px rgba(0,0,0,.4), inset 0 0 10px rgba(184,137,42,.35);
  transition:transform .15s;
}
@media (max-width:786px){
  #isx-fab{ right:12px; bottom:calc(88px + env(safe-area-inset-bottom, 0px)); width:40px; height:40px; font-size:19px; }
}
#isx-fab:hover{transform:scale(1.1);}
#isx-fab.dragging, #isx-fab.dragging:hover{ transform:none; transition:none; cursor:grabbing; }
#isx-zoomctl{
  position:absolute; right:14px; bottom:14px; z-index:30; display:flex; flex-direction:column; gap:4px;
}
#isx-zoomctl button{
  width:30px; height:30px; cursor:pointer; font-family:inherit; font-size:16px; color:var(--isx-ink);
  background:linear-gradient(180deg,#f7f0de,#e4d6b4); border:1.5px solid var(--isx-line); border-radius:4px;
}
#isx-zoomctl button:hover{border-color:var(--isx-gold);}
`;

    // ===== 浮层结构（id 均带 isx- 前缀）=====
    const HTML = `
<div id="isx-app">
  <div id="isx-topbar">
    <span id="isx-grip" title="按住拖动窗口">⠿</span>
    <div id="isx-title">伊瑟利亚寰宇图 <small>AETHERIA ATLAS</small></div>
    <div id="isx-breadcrumb"><span class="cur" id="isx-bcWorld">世界大地图</span></div>
    <div id="isx-legend"></div>
    <button id="isx-backBtn">← 返回大地图</button>
    <button id="isx-closebtn">✕ 关闭</button>
  </div>
  <div id="isx-stageWrap">
    <div class="layer show" id="isx-worldLayer">
      <div class="mapframe" data-ar="2048/1152">
        <img class="map" id="isx-baseImg" alt="伊瑟利亚世界大地图">
        <svg id="isx-hotSvg" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;"></svg>
        <div id="isx-hotBoxes" style="position:absolute;inset:0;"></div>
        <div id="isx-hint">点击势力区域钻入 · 滚轮缩放 · 拖拽平移</div>
      </div>
    </div>
    <div class="layer" id="isx-regionLayer">
      <div class="mapframe" data-ar="1536/1152">
        <img class="map" id="isx-regionImg" alt="">
        <div id="isx-regionInfo"><b id="isx-riName"></b><div class="meta" id="isx-riMeta"></div><p id="isx-riDesc"></p></div>
        <svg id="isx-compass" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="29" fill="rgba(247,240,222,.8)" stroke="#8a6f45" stroke-width="1.5"/>
          <polygon points="32,8 36,32 32,28 28,32" fill="#a0402a"/>
          <polygon points="32,56 28,32 32,36 36,32" fill="#5e4420"/>
          <text x="32" y="7" text-anchor="middle" font-size="8" fill="#3a2c1a" font-weight="bold">N</text>
        </svg>
        <div id="isx-ptBox" style="position:absolute;inset:0;"></div>
        <div id="isx-hint">悬停查看据点 · 点击展开详情 · 顶部可按类型筛选</div>
      </div>
    </div>
    <div id="isx-dlg">
      <div class="portrait" id="isx-dlgIcon"></div>
      <div class="body">
        <div class="head"><b id="isx-dlgName"></b><span class="t" id="isx-dlgType"></span><span class="belong" id="isx-dlgBelong"></span></div>
        <div class="text" id="isx-dlgText"></div>
      </div>
      <div class="close" id="isx-dlgClose">✕</div>
    </div>
    <div id="isx-zoomctl">
      <button id="isx-zin" title="放大">＋</button>
      <button id="isx-zout" title="缩小">－</button>
      <button id="isx-zreset" title="复位">⌂</button>
    </div>
  </div>
</div>
<div id="isx-tip"></div>
`;

    // ===== 注入 =====
    const styleEl = pdoc.createElement('style');
    styleEl.id = 'isx-style';
    styleEl.textContent = CSS;
    pdoc.head.appendChild(styleEl);

    const fab = pdoc.createElement('div');
    fab.id = 'isx-fab';
    fab.textContent = '🗺';
    fab.title = '伊瑟利亚寰宇图（可拖动）';
    pdoc.body.appendChild(fab);
    // 恢复上次拖放的位置
    try {
        const savedFab = JSON.parse(localStorage.getItem('iseria_map_fab_pos') || 'null');
        if (savedFab && typeof savedFab.left === 'number') {
            const fl = Math.min(pdoc.documentElement.clientWidth - 46, Math.max(0, savedFab.left));
            const ft = Math.min(pdoc.documentElement.clientHeight - 46, Math.max(0, savedFab.top));
            fab.style.left = fl + 'px';
            fab.style.top = ft + 'px';
            fab.style.right = 'auto';
            fab.style.bottom = 'auto';
        }
    } catch (e) {}

    const ov = pdoc.createElement('div');
    ov.id = 'isx-overlay';
    ov.innerHTML = HTML;
    ov.style.display = 'none';
    pdoc.body.appendChild(ov);

    // ===== 原地图逻辑（构建时自动改写：选择器加 isx- 前缀、图片键化、去 hash 路由）=====
    
/* ============================================================
 * 图标系统：类型 -> 内联SVG（圆形羊皮纸底 + 类型色符号）
 * ============================================================ */
const TYPE = {
  cap:   {name:'首都', color:'#c79a2e'},
  city:  {name:'城市', color:'#7d8a99'},
  town:  {name:'城镇', color:'#9a7a4a'},
  fort:  {name:'要塞关隘', color:'#6f7b6a'},
  port:  {name:'港口', color:'#3f7d96'},
  ruin:  {name:'遗迹/前哨', color:'#9a6a3a'},
  dung:  {name:'迷宫', color:'#8a4a9a'},
  secr:  {name:'秘境', color:'#d4a017'},
  camp:  {name:'营地/部落', color:'#5a8a52'},
  temple:{name:'神殿圣地', color:'#c08a3a'},
  mine:  {name:'矿脉', color:'#3f9a96'},
  spec:  {name:'特殊地点', color:'#b06a8a'},
};
// 符号 path（viewBox 0 0 24 24，画在圆底之上）
const GLYPH = {
  cap:'<path d="M4 10V6h2v2h3V6h2v2h2V6h2v2h3V6h2v4z" fill="#fff"/><rect x="4" y="10" width="16" height="8" fill="#fff"/><rect x="10.5" y="13" width="3" height="5" fill="#3a2c1a"/><polygon points="12,2 13,5 12,4.3 11,5" fill="#ffe9a8"/>',
  city:'<rect x="5" y="11" width="14" height="7" fill="#fff"/><path d="M5 11V8h2v1.5h2V8h2v1.5h2V8h2v1.5h2V11z" fill="#fff"/><rect x="10.8" y="13.5" width="2.4" height="4.5" fill="#3a2c1a"/>',
  town:'<polygon points="12,5 19,12 5,12" fill="#fff"/><rect x="6.5" y="12" width="11" height="6" fill="#fff"/><rect x="10.5" y="14" width="3" height="4" fill="#3a2c1a"/>',
  fort:'<path d="M4 18V9h2.2V7h2v2h2.2V7h2v2h2.2V7h2v2H20v9z" fill="#fff"/><rect x="4" y="18" width="16" height="1.6" fill="#3a2c1a"/>',
  port:'<circle cx="12" cy="6" r="2" fill="#fff"/><line x1="12" y1="8" x2="12" y2="18" stroke="#fff" stroke-width="1.8"/><path d="M12 9c-3 0-4.5 2-4.5 4 0 2.5 2 4.5 4.5 4.5s4.5-2 4.5-4.5c0-2-1.5-4-4.5-4z" fill="none" stroke="#fff" stroke-width="1.6"/><line x1="7.5" y1="13" x2="16.5" y2="13" stroke="#fff" stroke-width="1.6"/>',
  ruin:'<rect x="6" y="7" width="3.4" height="11" fill="#fff"/><rect x="11" y="10" width="3" height="8" fill="#fff"/><rect x="15" y="13" width="2.6" height="5" fill="#fff"/><line x1="5" y1="18" x2="19" y2="18" stroke="#fff" stroke-width="1.6"/>',
  dung:'<path d="M12 5a7 7 0 1 0 7 7h-2.4a4.6 4.6 0 1 1-4.6-4.6z" fill="#fff"/><circle cx="12" cy="12" r="1.7" fill="#3a2c1a"/>',
  secr:'<polygon points="12,3 14,10 21,12 14,14 12,21 10,14 3,12 10,10" fill="#fff"/>',
  camp:'<polygon points="12,5 20,18 4,18" fill="#fff"/><polygon points="12,5 12,18 4,18" fill="rgba(58,44,26,.25)"/><line x1="12" y1="5" x2="12" y2="18" stroke="#3a2c1a" stroke-width="1"/>',
  temple:'<polygon points="12,4 15,9 9,9" fill="#fff"/><rect x="9.5" y="9" width="5" height="3" fill="#fff"/><rect x="7" y="12" width="10" height="2.4" fill="#fff"/><rect x="6" y="14.4" width="12" height="2.2" fill="#fff"/><rect x="5" y="16.6" width="14" height="2" fill="#fff"/>',
  mine:'<polygon points="12,4 18,10 12,20 6,10" fill="#fff"/><polygon points="12,4 12,20 6,10" fill="rgba(58,44,26,.22)"/><line x1="12" y1="4" x2="12" y2="20" stroke="#3a2c1a" stroke-width=".8"/>',
  spec:'<polygon points="12,4 19,12 12,20 5,12" fill="#fff"/><polygon points="12,4 12,20 5,12" fill="rgba(58,44,26,.22)"/>',
};
function iconSVG(type, size){
  const c = TYPE[type].color;
  return `<svg viewBox="0 0 24 24" width="${size||30}" height="${size||30}" class="mk">
    <circle cx="12" cy="12" r="11" fill="${c}" stroke="#2e2313" stroke-width="1.4"/>
    <circle cx="12" cy="12" r="11" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".7" transform="translate(0,-.4)"/>
    ${GLYPH[type]||GLYPH.spec}
  </svg>`;
}

/* ============================================================
 * L0 世界势力（色块多边形 + 名牌）
 * poly 为百分比坐标；label 名牌位置；color 势力色
 * ============================================================ */
const WORLD = [
 {id:'niflheim', name:'尼弗海姆', sub:'龙裔王国 · 极北冻土', cap:'霜牙城', color:'#5a8aa8',
  poly:[[24,12],[92,12],[93,22],[25,22]], label:[58,17],
  desc:'极北永冻之地，龙裔以龙息炉对抗永冬。'},
 {id:'dornheim', name:'多尔海姆', sub:'矮人地下王国 · 北部雪山', cap:'铁心城', color:'#a06020',
  poly:[[24,20],[90,20],[91,34],[25,34]], label:[57,27],
  desc:'横贯北部的雪山之下，矮人以大锻炉点亮的地下王国。'},
 {id:'urgat', name:'乌尔加特汗国', sub:'兽人六族 · 西北草原', cap:'大汗牙帐', color:'#9a7a3a',
  poly:[[17,33],[43,33],[44,53],[18,53]], label:[30,43],
  desc:'枯黄草原与戈壁上，六族兽人逐水草而居的游牧汗国。'},
 {id:'aether', name:'艾瑟尔邦联', sub:'翼民 · 高空浮岛', cap:'瑟拉艾洛', color:'#4a8aa0',
  poly:[[39,32],[72,32],[73,49],[40,49]], label:[53,40],
  desc:'高原上空的云海浮岛群，翼民以风为路的自由邦联。'},
 {id:'silvantir', name:'希尔凡蒂尔', sub:'精灵王廷 · 东北密林', cap:'艾尔希安', color:'#3a7a4a',
  poly:[[53,43],[81,43],[82,57],[54,57]], label:[67,50],
  desc:'结界封闭的原始密林，星辉之树下的精灵千年王廷。'},
 {id:'empire', name:'奥尔德南帝国', sub:'人类帝国 · 西部平原', cap:'艾森格拉德', color:'#8a4b3a',
  poly:[[23,47],[53,47],[54,73],[24,73]], label:[38,60],
  desc:'魔导工业与魔动列车纵横的中央集权帝国。'},
 {id:'albion', name:'阿尔比恩王国', sub:'人类封建王国 · 东部丘陵', cap:'坎特伯里', color:'#b8892a',
  poly:[[52,47],[79,47],[80,69],[53,69]], label:[65,58],
  desc:'四境贵族割据、圣光神教会势盛的古老王国。'},
 {id:'kallantia', name:'卡兰蒂亚城邦', sub:'自由城邦 · 南部沿海', cap:'梅萨利亚', color:'#2a6a7a',
  poly:[[27,63],[69,63],[70,87],[28,87]], label:[48,75],
  desc:'良港星罗的商业联盟，冒险者公会与时钟塔的大本营。'},
 {id:'nereitin', name:'涅瑞廷', sub:'海妖王国 · 东南深海', cap:'莫尔纳斯', color:'#2a4a8a',
  poly:[[69,54],[83,54],[84,76],[68,76]], label:[76,65],
  desc:'从潮汐岛直坠万米深渊的海妖分层王国。'},
 {id:'morgana', name:'莫尔加纳', sub:'魔潮废土 · 破碎小陆', cap:'铁锚营', color:'#7a3a5a',
  poly:[[75,63],[95,63],[95,92],[75,92]], label:[85,78],
  desc:'四层魔潮环带包裹的禁忌大陆，魔王巢穴所在。'},
 {id:'ulkan', name:'乌尔坎', sub:'新大陆 · 极西之西', cap:'希索拉坎', color:'#a05a3a',
  poly:[[3.5,26],[14.5,26],[14.5,84],[3.5,84]], label:[9,55],
  desc:'隔万里大洋的新大陆，殖民海岸、原始部落与蜥蜴种帝国并存。'},
];

/* ============================================================
 * L1 各势力据点数据
 * {n:名称, x,y:百分比, t:类型, d:简介}
 * ============================================================ */
const REGIONS = {
empire:{name:'奥尔德南帝国', meta:'人类 · 帝制 · 首都 艾森格拉德', img:'empire',
 desc:'西部平原上的魔导工业帝国，魔动列车自帝都向四方辐射，与阿尔比恩长期对峙。',
 pts:[
  {n:'艾森格拉德',x:50,y:47,t:'cap',d:'帝国帝都，坐落中央平原。铁冠宫与中央魔动列车总站所在，是皇权与魔导工业的双重中枢；其地下旧战场藏有秘境「帝国铁血」。'},
  {n:'瓦尔海姆',x:13,y:45,t:'city',d:'西北雾都与工业心脏，魔导研究院所在地，烟囱与蒸汽终年不散。'},
  {n:'钢核地脉',x:13,y:55,t:'dung',d:'迷宫（七层）。沉于瓦尔海姆地下的魔导工业遗迹，失控的自动机械仍在运转。'},
  {n:'黑松镇',x:26,y:22,t:'town',d:'北部咽喉小镇，翻越北部雪山、通往多尔海姆铁门镇的必经之路。'},
  {n:'铃兰镇',x:30,y:32,t:'town',d:'帝都至瓦尔海姆铁路中段的煤水补给小站。'},
  {n:'布伦纳',x:20,y:75,t:'town',d:'西部平原的粮仓，连片麦田环绕的富庶集镇。'},
  {n:'格伦茨堡',x:76,y:27,t:'fort',d:'东部边境的巨型棱堡，东线铁轨终点，与阿尔比恩对峙的最前线。'},
  {n:'枯井村',x:63,y:37,t:'ruin',d:'格伦茨堡以西边境荒地的小村，村外有先民遗迹废坑。'},
  {n:'克洛恩港',x:82,y:78,t:'port',d:'南部沿海唯一的大型军港，帝国舰队锚地。'},
  {n:'帝国铁血',x:50,y:54,t:'secr',d:'秘境。艾森格拉德铁冠宫地下的旧战场，帝国立国之战的英灵不散之地。'},
 ]},
albion:{name:'阿尔比恩王国', meta:'人类 · 封建制 · 首都 坎特伯里', img:'albion',
 desc:'东部丘陵上的古老王国，分东西南北四境，王室与圣光神教会在王都内共治。',
 pts:[
  {n:'坎特伯里',x:49,y:45,t:'cap',d:'王都，建于坎特河中游北岸高地，城墙内包围着教皇领·圣都，是王室与圣光神教会共治之地。'},
  {n:'圣辉陵窟',x:49,y:53,t:'dung',d:'迷宫（七层）。王都地下的历代王室与圣徒陵寝，圣光之力封存至今。'},
  {n:'艾文顿',x:58,y:58,t:'town',d:'坎特河上游的粮仓集镇，供应王都所需。'},
  {n:'韦克斯福德',x:73,y:63,t:'port',d:'东海岸的王室直辖港口。'},
  {n:'白崖修道院群',x:80,y:39,t:'temple',d:'东海岸白色悬崖上的神学院群，培养圣光神职者。'},
  {n:'圣女的终祷',x:87,y:47,t:'secr',d:'秘境。藏于白崖修道院地下圣堂，初代圣女殉道与终祷之地。'},
  {n:'铁关堡',x:8,y:53,t:'fort',d:'西境最西山隘上的长城要塞，直面奥尔德南帝国兵锋。'},
  {n:'格洛斯特',x:22,y:48,t:'city',d:'西境首府，格洛斯特公爵割据的丘陵谷地城。'},
  {n:'灰石镇',x:27,y:34,t:'town',d:'西境西北的铁矿镇。'},
  {n:'切尔滕纳姆',x:33,y:58,t:'town',d:'格洛斯特以东的货物集散地。'},
  {n:'林登',x:84,y:82,t:'port',d:'南境海峡沿岸最大商港，与卡兰蒂亚隔海贸易。'},
  {n:'索尔兹伯里',x:45,y:71,t:'city',d:'南境内陆枢纽，女公爵伊丽莎白·索尔兹伯里的居所。'},
  {n:'布莱顿',x:78,y:72,t:'port',d:'南海岸中段的造船城镇。'},
  {n:'哈沃德',x:61,y:11,t:'town',d:'贫瘠北境中部荒原上唯一的城。'},
  {n:'灰沼镇',x:45,y:19,t:'town',d:'北境泥炭沼泽边缘的小镇。'},
  {n:'黑石堡',x:72,y:17,t:'fort',d:'北境北端碎石山中的古堡，现被盗匪占据。'},
 ]},
kallantia:{name:'卡兰蒂亚合众城邦', meta:'城邦联盟 · 商业 · 事实首都 梅萨利亚', img:'kallantia',
 desc:'南部曲折海岸上的自由城邦联盟，冒险者公会总部所在，旧大陆最富庶的黄金海岸。',
 pts:[
  {n:'梅萨利亚',x:52,y:48,t:'cap',d:'最大自由港与事实首都，冒险者公会总部所在；上城繁华、下城龙蛇混杂。'},
  {n:'该死的命运',x:40,y:56,t:'secr',d:'秘境。梅萨利亚下城区下水道深处的命运裂隙，投币问命者或可窥见命数。'},
  {n:'诺瓦港',x:16,y:33,t:'port',d:'最西端港口，驶往乌尔坎新大陆的殖民船队由此出发。'},
  {n:'费里亚',x:12,y:42,t:'city',d:'西端造船城，干船坞与船台绵延海岸。'},
  {n:'翡翠港',x:24,y:40,t:'port',d:'梅萨利亚与费里亚之间的翡翠转运港。'},
  {n:'阿尔卡纳',x:52,y:70,t:'city',d:'梅萨利亚以东的独立时钟塔城，以巨型钟塔为徽，魔法学术组织「时钟塔」总部。'},
  {n:'奥里安',x:85,y:63,t:'city',d:'东南端金融港市，银行与大商会林立。'},
  {n:'月牙镇',x:80,y:73,t:'town',d:'奥里安以东月牙湾畔的度假小镇。'},
  {n:'拉庞',x:64,y:24,t:'city',d:'靠近王国南境的内陆「迷宫之都」，向导与掘墓人云集。'},
  {n:'沉钟回廊',x:70,y:30,t:'dung',d:'迷宫（七层）。拉庞地下回荡着无声钟鸣的环形回廊。'},
  {n:'科莫',x:70,y:19,t:'town',d:'内陆丘陵上的葡萄酒城。'},
  {n:'南海岬灯塔',x:94,y:32,t:'spec',d:'最南端海岬上的古老灯塔，为进出黄金海岸的船只引航。'},
 ]},
dornheim:{name:'多尔海姆', meta:'矮人 · 城邦王国 · 首都 铁心城', img:'dornheim',
 desc:'横贯北部雪山的内部，矮人凿出层层叠叠的地下王国，以永燃大锻炉闻名于世。',
 pts:[
  {n:'铁心城',x:50,y:56,t:'cap',d:'地下200–600米巨大溶洞中的同心圆都城，环绕大锻炉层层展开，是矮人王国的心脏。'},
  {n:'大锻炉',x:50,y:46,t:'spec',d:'城中央六十米高永燃不熄的传奇熔炉，矮人的信仰与工业核心。'},
  {n:'铁门镇',x:16,y:29,t:'town',d:'山脉南麓地表唯一的大型外贸镇，商旅云集。'},
  {n:'铁门关',x:9,y:38,t:'fort',d:'南关，三道铁闸封山，通向奥尔德南帝国。'},
  {n:'碎石镇',x:81,y:30,t:'town',d:'东麓地表的锻造小镇。'},
  {n:'石心关',x:91,y:37,t:'fort',d:'东关，通向阿尔比恩王国。'},
  {n:'霜脊关',x:6,y:30,t:'fort',d:'北关，翻越雪脊通往尼弗海姆。'},
  {n:'酿造谷',x:27,y:68,t:'town',d:'西侧支洞群，矮人麦酒与黑啤的名产地。'},
  {n:'秘银深脉',x:50,y:88,t:'mine',d:'城下1500米深处散发蓝银光辉的珍稀秘银矿脉，王国命脉所系。'},
 ]},
urgat:{name:'乌尔加特汗国', meta:'兽人六族 · 游牧汗国 · 首都 大汗牙帐', img:'urgat',
 desc:'西北广袤草原与戈壁上，狼牛熊鹰蛇猪六族共奉大汗的游牧汗国。',
 pts:[
  {n:'乌尔加特牙帐',x:50,y:27,t:'cap',d:'移动首都。中部草原最高丘陵上，以三十六根巨兽骨柱撑起的大汗王帐，周围环绕数圈部族帐篷。'},
  {n:'血碑林',x:32,y:19,t:'temple',d:'牙帐正北的祭祖圣地，数百块黑色战碑记载历代先祖武功。'},
  {n:'独眼丘',x:19,y:46,t:'temple',d:'牙帐以西半日路程的独立浑圆圣丘，丘顶独眼巨岩下是库图拉神殿。'},
  {n:'鹰巢镇',x:89,y:35,t:'town',d:'东部崖壁上凿出的立体崖居，鹰族领地。'},
  {n:'风牙镇',x:94,y:53,t:'town',d:'南部草原边缘唯一允许外族长居的外贸镇。'},
  {n:'铁角城',x:48,y:78,t:'city',d:'南部丘陵牛族领地，汗国唯一的石墙城寨。'},
  {n:'狼牙关',x:68,y:87,t:'fort',d:'东南前线山口关隘，正对奥尔德南帝国。'},
 ]},
silvantir:{name:'希尔凡蒂尔', meta:'精灵 · 王廷 · 首都 艾尔希安', img:'silvantir',
 desc:'东北原始密林，以十二结界塔「静壁界结」封闭于世，星辉之树下是精灵的千年王廷。',
 pts:[
  {n:'艾尔希安',x:50,y:42,t:'cap',d:'星辉王廷。中央星辉之树树干上的垂直树城，悬桥回廊层叠，精灵女王与王廷所在。'},
  {n:'界碑之环',x:50,y:11,t:'spec',d:'十二座结界塔等距环成的「静壁界结」，将整片密林与外界隔绝。'},
  {n:'祈祷林',x:25,y:40,t:'temple',d:'王树东侧的环形古木祭坛，精灵祈祷与加冕之处。'},
  {n:'星辉书库',x:74,y:39,t:'temple',d:'王树西侧的树顶大书库，收藏精灵万年典籍。'},
  {n:'渊蚀根冠',x:50,y:59,t:'dung',d:'迷宫（十二层）。星辉之树基部向下生长的根冠迷宫，被蚀之力侵蚀。'},
  {n:'银叶湖畔',x:22,y:54,t:'town',d:'中环北部最大聚落，临一面宽阔静水湖。'},
  {n:'银叶古殿',x:19,y:47,t:'dung',d:'迷宫。银叶湖北侧林中的古精灵神殿。'},
  {n:'织梦台地',x:30,y:62,t:'town',d:'中环西部高原上的精灵工匠台地。'},
  {n:'歌溪聚落',x:44,y:71,t:'town',d:'中部歌溪岸边的小型聚落。'},
  {n:'药师谷',x:37,y:67,t:'town',d:'中环东南低谷中的药草园。'},
  {n:'深根聚落',x:75,y:60,t:'town',d:'南部巨木根系之间的半地下聚落。'},
  {n:'星坠平原',x:68,y:69,t:'town',d:'东部林间的开阔草地，传说有星陨于此。'},
  {n:'灰腐林',x:26,y:77,t:'spec',d:'结界边缘的环形毒瘴隔离林带，灰紫腐叶不可轻入。'},
  {n:'翠笼谷',x:13,y:80,t:'town',d:'外环东南封闭盆地中的人类契民聚落。'},
  {n:'晨露台地',x:16,y:87,t:'town',d:'外环边界唯一对外接待的露台营地与通商口。'},
 ]},
aether:{name:'艾瑟尔邦联', meta:'翼民 · 浮岛邦联 · 首都 瑟拉艾洛', img:'aether',
 desc:'高原上空的云海浮岛群，翼民诸岛结为自由邦联，以风元素与索道相连。',
 pts:[
  {n:'瑟拉艾洛',x:50,y:43,t:'cap',d:'主岛与事实首都，最大的椭圆形浮岛，天空议事厅、风核殿与承天之座所在。'},
  {n:'天空议事厅',x:50,y:32,t:'temple',d:'主岛顶部无顶的圆形阶梯议场，诸岛代表议事之地。'},
  {n:'风核殿',x:50,y:50,t:'spec',d:'主岛内部封存风元素核心的封闭圆殿，浮岛升力之源。'},
  {n:'星风岛',x:21,y:17,t:'city',d:'第二大浮岛，星象学术与观星台所在。'},
  {n:'采晶岛',x:18,y:73,t:'mine',d:'外围浮岛，开采纯净的风元素结晶（另有数座小晶岛环绕）。'},
  {n:'晨哀台',x:83,y:62,t:'ruin',d:'大崩落纪念地，一块漂浮的浮岛残片，祭奠坠亡的同胞与故土。'},
  {n:'风港台地',x:84,y:87,t:'town',d:'主岛正下方地面高原上的最大对外中转站，亦有公开的奴隶市场。'},
  {n:'风骸迷窟',x:31,y:57,t:'dung',d:'迷宫。主岛边缘被风蚀空的洞窟，回荡着古老风骸的嘶鸣。'},
 ]},
nereitin:{name:'涅瑞廷', meta:'海妖 · 深海王国 · 首都 涅柔斯之眼', img:'nereitin',
 desc:'东南海域之下，海妖从潮汐岛一路建到万米深渊，按深度分层而治。',
 pts:[
  {n:'莫尔纳斯',x:50,y:11,t:'cap',d:'潮汐岛。距东南海岸半日船程的近海岛，王国唯一露出海面的领土，街道一半淹没、即是运河。'},
  {n:'浅潮镇',x:50,y:41,t:'town',d:'岛屿下方约80米处的海底哨镇。'},
  {n:'珊瑚市',x:50,y:31,t:'city',d:'300–500米深的巨型珊瑚礁城市，王国最大的海底贸易区。'},
  {n:'铁潮堡',x:50,y:55,t:'fort',d:'2000米深海底峡谷入口的要塞，潮涌兵团驻扎于此。'},
  {n:'深渊议厅',x:50,y:72,t:'temple',d:'7000米深海沟中的诸海妖氏族议事之地。'},
  {n:'涅柔斯之眼',x:50,y:83,t:'spec',d:'12000米最深处的女王王宫，通体散发幽蓝生物荧光。'},
 ]},
niflheim:{name:'尼弗海姆', meta:'龙裔 · 王国 · 首都 霜牙城', img:'niflheim',
 desc:'极北永冻之地，龙裔以永燃龙息炉对抗永冬，深北冰原是不可侵犯的祖灵圣地。',
 pts:[
  {n:'霜牙城',x:50,y:53,t:'cap',d:'首都。冰川峡谷环抱的天然盆地中，低矮厚重、不设城墙的石城，龙息炉与七霜座所在。'},
  {n:'龙息炉',x:50,y:47,t:'spec',d:'城中央永燃不熄的巨型火炉，为全城供暖，是龙裔文明的心脏。'},
  {n:'寒铁镇',x:21,y:89,t:'town',d:'南缘寒铁矿脉旁的矿镇，唯一对多尔海姆开放的外贸点。'},
  {n:'猎火镇',x:75,y:88,t:'town',d:'南缘猎道南端的猎团集结镇。'},
  {n:'极光村',x:27,y:66,t:'town',d:'霜牙城北、极光笼罩下的牧牛小村。'},
  {n:'冰桥村',x:49,y:31,t:'town',d:'两座冰川之间天然冰桥旁的小村。'},
  {n:'祖灵冰原',x:28,y:24,t:'temple',d:'深北圣地，数百具龙裔先祖与龙骨冻结站立于此，外族踏入即视同宣战。'},
  {n:'科里维坦孤峰',x:50,y:9,t:'spec',d:'已知世界最北端的孤立冰峰，神龙候选隐居之地。'},
  {n:'渊冰深井',x:59,y:61,t:'dung',d:'迷宫。冰川之下的永冻深井，冰封着远古之物。'},
 ]},
morgana:{name:'莫尔加纳', meta:'魔潮废土 · 无主之地 · 前哨 铁锚营', img:'morgana',
 desc:'东南隔海峡相望的破碎小陆，由海向核心分为四层魔潮环带，越深入越凶险，核心是无人还生的魔王巢穴。',
 pts:[
  {n:'魔王巢穴',x:50,y:48,t:'spec',d:'核心禁地。远古战争的爆心，黑色尖塔与魔潮之源，从未有人活着回来。'},
  {n:'远古战争的终结',x:50,y:57,t:'secr',d:'神话级秘境（第五秘境）。黯渊最深处的古战场终焉，神话时代在此落幕。'},
  {n:'铁锚营',x:15,y:61,t:'camp',d:'潮息带西海岸最大的冒险者前哨，以沉船残骸搭建。'},
  {n:'海风补给点',x:20,y:48,t:'camp',d:'潮息带，铁锚营以东两小时路程的补给点。'},
  {n:'城邦观测哨',x:31,y:15,t:'camp',d:'潮息带北岸高地上的卡兰蒂亚观测哨。'},
  {n:'帝国第七站',x:72,y:20,t:'camp',d:'潮息带东缘的奥尔德南殖民前哨。'},
  {n:'裂隙之门',x:43,y:25,t:'ruin',d:'蚀骨域中部的先民遗迹巨门，通往更深处的节点。'},
  {n:'裂痕之战',x:29,y:47,t:'secr',d:'秘境。蚀骨域边缘的时空裂痕，封存着一场战争的残响。'},
  {n:'雾穴',x:57,y:64,t:'dung',d:'迷宫。蚀骨域与黯渊交界处终年迷雾的洞窟。'},
  {n:'朽龙巢',x:44,y:66,t:'ruin',d:'黯渊深处，灾兽「朽龙」盘踞的白骨之巢。'},
  {n:'雾嚎地',x:67,y:56,t:'ruin',d:'黯渊灾兽「雾嚎」出没的扭曲地带。'},
  {n:'蚀甲墟',x:31,y:35,t:'ruin',d:'蚀骨域内灾兽「蚀甲」游荡的废墟群。'},
 ]},
ulkan:{name:'乌尔坎新大陆', meta:'殖民地/原始人/蜥蜴种帝国 · 极西', img:'ulkan',
 desc:'隔万里大洋的竖长新大陆：东海岸是旧大陆殖民地，中部密林住着原始部落，西部高原是蜥蜴种的古老帝国。',
 pts:[
  {n:'希索拉坎',x:22,y:18,t:'cap',d:'翼蛇圣城。西内陆高原盆地中，三百六十五阶大蛇母金字塔呈放射布局，蜥蜴种帝国的首都。'},
  {n:'赤岩城·烈日王座',x:12,y:12,t:'city',d:'裂谷以西、赤色岩柱群上层层垒起的立体城，烈日王的王座所在。'},
  {n:'库库尔坎',x:18,y:37,t:'city',d:'羽冠城，圣城以南河谷中的第二城邦。'},
  {n:'克洛索坎',x:14,y:51,t:'fort',d:'黑曜锋城，蜥蜴种帝国东境的黑曜石军事重镇。'},
  {n:'伊特兹坎',x:34,y:14,t:'mine',d:'羽矿城，北部丘陵上的矿城。'},
  {n:'希索拉之巢',x:36,y:53,t:'temple',d:'密林深处盘绕巨蛇形态的石造物，全族最高圣地，由圣地守护者联盟据守。'},
  {n:'泥心城',x:51,y:45,t:'city',d:'内陆河流交汇处最大的原始人城，奥姆巴拉神殿所在。'},
  {n:'恩达卡之牙',x:51,y:18,t:'camp',d:'泥心城北密林边缘的猎手村。'},
  {n:'奥姆巴拉之握',x:35,y:77,t:'camp',d:'泥心城南冲积平原上的农耕村。'},
  {n:'血铸',x:20,y:62,t:'camp',d:'泥心城以西裂谷边缘的石器村。'},
  {n:'新梅萨利亚',x:80,y:54,t:'port',d:'东海岸的卡兰蒂亚殖民港，木栅栏正逐步换成石墙。'},
  {n:'帝国堡',x:91,y:43,t:'fort',d:'东南海岸的奥尔德南石质要塞。'},
  {n:'蓝光谷',x:71,y:23,t:'mine',d:'东部丘陵上夜间发蓝光的裸露魔法矿脉。'},
  {n:'潮汐村',x:90,y:56,t:'town',d:'新梅萨利亚以南海岸，蜥蜴种最早与外来者贸易的渔村。'},
  {n:'烈矛族营',x:68,y:51,t:'camp',d:'蓝光谷附近丛林中对外来者持敌对态度的原始部落。'},
  {n:'沉木城',x:71,y:72,t:'city',d:'南部大沼泽半淹巨树根上搭建的树沼水城。'},
  {n:'无光倒影井',x:53,y:72,t:'dung',d:'迷宫（六层）。红土高原裂谷深处的血祭深渊，黑暗中倒映着不存在之物。'},
 ]},
};

/* ============================================================
 * 渲染与交互
 * ============================================================ */
const $=s=>ov.querySelector(s);
const stageWrap=$('#isx-stageWrap'), worldLayer=$('#isx-worldLayer'), regionLayer=$('#isx-regionLayer');
const hotSvg=$('#isx-hotSvg'), hotBoxes=$('#isx-hotBoxes'), ptBox=$('#isx-ptBox'), tip=$('#isx-tip');
let activeTypes=new Set(Object.keys(TYPE));

/* ---- L0 渲染 ---- */
function renderWorld(){
  hotSvg.innerHTML=''; hotBoxes.innerHTML='';
  WORLD.forEach(r=>{
    const pts=r.poly.map(p=>p.join(',')).join(' ');
    const poly=pdoc.createElementNS('http://www.w3.org/2000/svg','polygon');
    poly.setAttribute('points',pts);
    poly.setAttribute('fill',r.color); poly.setAttribute('stroke',r.color);
    poly.setAttribute('stroke-width','.35'); poly.setAttribute('stroke-dasharray','1,.6');
    poly.setAttribute('class','hotpoly'); poly.style.opacity='.16';
    poly.style.transition='opacity .2s';
    hotSvg.appendChild(poly);
    // 透明点击盒（覆盖 poly 包围盒）+ 名牌
    const xs=r.poly.map(p=>p[0]), ys=r.poly.map(p=>p[1]);
    const left=Math.min(...xs), top=Math.min(...ys), w=Math.max(...xs)-left, h=Math.max(...ys)-top;
    const box=pdoc.createElement('div');
    box.className='hot'; box.style.left=left+'%'; box.style.top=top+'%'; box.style.width=w+'%'; box.style.height=h+'%';
    box.innerHTML=`<div class="fill" style="background:${r.color};opacity:.10;border:1.5px dashed ${r.color};border-radius:6px;"></div>
      <div class="nametag"><b><span class="star">✦</span>${r.name}</b><span>${r.sub} · 首府 ${r.cap}</span></div>`;
    box.addEventListener('mouseenter',()=>{poly.style.opacity='.4';});
    box.addEventListener('mouseleave',()=>{poly.style.opacity='.16';});
    box.addEventListener('click',()=>enterRegion(r.id));
    hotBoxes.appendChild(box);
  });
}

/* ---- L1 渲染 ---- */
let curRegion=null;
function enterRegion(id){
  const r=REGIONS[id]; if(!r) return; curRegion=id;
  $('#isx-regionImg').src=IMG[r.img];
  $('#isx-riName').textContent=r.name; $('#isx-riMeta').textContent=r.meta; $('#isx-riDesc').textContent=r.desc;
  $('#isx-regionInfo').classList.add('show');
  ptBox.innerHTML='';
  r.pts.forEach(p=>{
    const el=pdoc.createElement('div');
    const isCap=p.t==='cap';
    el.className='pt'+(isCap?' capital':'')+((p.t==='secr')?' pulse':(p.t==='dung'?' pulse purple':''));
    el.style.left=p.x+'%'; el.style.top=p.y+'%'; el.dataset.t=p.t;
    el.innerHTML=iconSVG(p.t,isCap?36:30)+`<div class="lbl">${p.n}</div>`;
    el.addEventListener('mousemove',e=>showTip(e,p,r.name));
    el.addEventListener('mouseleave',hideTip);
    el.addEventListener('click',()=>openDlg(p,r));
    ptBox.appendChild(el);
  });
  applyFilter();
  worldLayer.classList.remove('show'); regionLayer.classList.add('show');
  $('#isx-bcWorld').classList.remove('cur');
  $('#isx-backBtn').style.display='block';
  closeDlg();
}
function backToWorld(){
  regionLayer.classList.remove('show'); worldLayer.classList.add('show');
  $('#isx-bcWorld').classList.add('cur'); $('#isx-backBtn').style.display='none';
  $('#isx-regionInfo').classList.remove('show'); closeDlg(); hideTip();
}
$('#isx-backBtn').addEventListener('click',backToWorld);
$('#isx-bcWorld').addEventListener('click',()=>{ if (winClickBlocked()) return; backToWorld(); });

/* ---- tooltip ---- */
function showTip(e,p,belong){
  tip.innerHTML=`<b>${p.n}</b><span class="tag" style="background:${TYPE[p.t].color}">${TYPE[p.t].name}</span><p>${p.d}</p>`;
  tip.classList.add('show');
  let x=e.clientX+14, y=e.clientY+14;
  const rect=tip.getBoundingClientRect();
  if(x+rect.width>win.innerWidth-10) x=e.clientX-rect.width-14;
  if(y+rect.height>win.innerHeight-10) y=e.clientY-rect.height-14;
  tip.style.left=x+'px'; tip.style.top=y+'px';
}
function hideTip(){tip.classList.remove('show');}

/* ---- AVG 对话框 ---- */
function openDlg(p,r){
  $('#isx-dlgIcon').innerHTML=iconSVG(p.t,72).replace('class="mk"','');
  $('#isx-dlgName').textContent=p.n;
  const tt=$('#isx-dlgType'); tt.textContent=TYPE[p.t].name; tt.style.background=TYPE[p.t].color;
  $('#isx-dlgBelong').textContent=r.name;
  $('#isx-dlgText').textContent=p.d;
  $('#isx-dlg').classList.add('show');
}
function closeDlg(){$('#isx-dlg').classList.remove('show');}
$('#isx-dlgClose').addEventListener('click',closeDlg);
stageWrap.addEventListener('click',e=>{ if(e.target===stageWrap||e.target.id==='isx-regionImg'||e.target.id==='isx-regionLayer'||e.target.id==='isx-worldLayer') closeDlg(); });

/* ---- 类型筛选图例 ---- */
function renderLegend(){
  const lg=$('#isx-legend'); lg.innerHTML='';
  const all=pdoc.createElement('div'); all.className='lg all'; all.textContent='全部';
  all.addEventListener('click',()=>{ if (winClickBlocked()) return; activeTypes=new Set(Object.keys(TYPE)); syncLegend(); applyFilter();});
  lg.appendChild(all);
  Object.entries(TYPE).forEach(([k,v])=>{
    const d=pdoc.createElement('div'); d.className='lg'; d.dataset.k=k;
    d.innerHTML=`${iconSVG(k,15).replace('class="mk"','')}${v.name}`;
    d.addEventListener('click',()=>{
      if (winClickBlocked()) return;
      if(activeTypes.has(k)) activeTypes.delete(k); else activeTypes.add(k);
      syncLegend(); applyFilter();
    });
    lg.appendChild(d);
  });
}
function syncLegend(){ov.querySelectorAll('#isx-legend .lg').forEach(d=>{
  if(!d.dataset.k) return; d.classList.toggle('off',!activeTypes.has(d.dataset.k));});}
function applyFilter(){
  ptBox.querySelectorAll('.pt').forEach(el=>el.classList.toggle('hide',!activeTypes.has(el.dataset.t)));
}

/* ---- mapframe 严格按图片比例 contain，保证百分比坐标与底图对齐 ---- */
function fitFrame(){
  ov.querySelectorAll('.mapframe').forEach(f=>{
    const [rw,rh]=f.dataset.ar.split('/').map(Number), ar=rw/rh;
    const par=f.parentElement, W=par.clientWidth, H=par.clientHeight;
    let w=W, h=W/ar; if(h>H){h=H; w=H*ar;}
    f.style.width=w+'px'; f.style.height=h+'px';
  });
}

/* ---- init ---- */
renderWorld(); renderLegend(); fitFrame();
pdoc.addEventListener('keydown',e=>{ if(e.key==='Escape'){closeDlg();} });


    // ===== 悬浮窗接线：开关 / 缩放 / 平移（stageWrap/$ 由上方原地图逻辑定义）=====
    // 底图源（原HTML内联src已在模板化时移除，改由内嵌dataURI提供）
    $('#isx-baseImg').src = IMG.base;
    function toggleMap(force) {
        const show = force !== undefined ? force : ov.style.display === 'none';
        if (show) {
            // 每次打开强制屏幕居中：清除历史拖拽残留的 left/top/dragging，保证手机端可见
            ov.classList.remove('dragging');
            ov.style.left = ''; ov.style.top = ''; ov.style.transform = '';
            ov.style.display = 'flex';
            requestAnimationFrame(() => fitFrame());
        } else {
            ov.style.display = 'none';
        }
    }
    // ===== 小地图按钮拖动：按住拖走，原地单击仍是开关地图；位置记忆 =====
    // 拖动路径可能经过楼层内容 iframe（iframe 会吞掉 mousemove），故拖动期间垫一层全屏透明遮罩接管事件
    let _fabDrag = false, _fabMoved = false, _fabX = 0, _fabY = 0, _fabOX = 0, _fabOY = 0, _fabMovedAt = 0;
    let _fabShim = null;
    function fabShimOn() {
        if (_fabShim) return;
        _fabShim = pdoc.createElement('div');
        _fabShim.id = 'isx-fab-shim';
        _fabShim.style.cssText = 'position:fixed;inset:0;z-index:99990;cursor:grabbing;background:transparent;';
        pdoc.body.appendChild(_fabShim);
    }
    function fabShimOff() {
        if (_fabShim && _fabShim.parentNode) _fabShim.parentNode.removeChild(_fabShim);
        _fabShim = null;
    }
    fab.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        _fabDrag = true; _fabMoved = false;
        const r = fab.getBoundingClientRect();
        _fabOX = e.clientX - r.left; _fabOY = e.clientY - r.top;
        _fabX = e.clientX; _fabY = e.clientY;
        e.preventDefault();
    });
    pdoc.addEventListener('mousemove', e => {
        if (!_fabDrag) return;
        if (!_fabMoved && Math.abs(e.clientX - _fabX) + Math.abs(e.clientY - _fabY) < 5) return;
        if (!_fabMoved) { _fabMoved = true; fabShimOn(); }
        fab.classList.add('dragging');
        fab.style.left = (e.clientX - _fabOX) + 'px';
        fab.style.top = (e.clientY - _fabOY) + 'px';
        fab.style.right = 'auto'; fab.style.bottom = 'auto';
        _fabX = e.clientX; _fabY = e.clientY;
    });
    function fabDragEnd() {
        if (!_fabDrag) return;
        fabShimOff();
        fab.classList.remove('dragging');
        if (_fabMoved) {
            _fabMovedAt = Date.now();
            try {
                const r = fab.getBoundingClientRect();
                const fl = Math.min(pdoc.documentElement.clientWidth - 46, Math.max(0, r.left));
                const ft = Math.min(pdoc.documentElement.clientHeight - 46, Math.max(0, r.top));
                fab.style.left = fl + 'px';
                fab.style.top = ft + 'px';
                localStorage.setItem('iseria_map_fab_pos', JSON.stringify({ left: Math.round(fl), top: Math.round(ft) }));
            } catch (e) {}
        }
        _fabDrag = false;
    }
    pdoc.addEventListener('mouseup', fabDragEnd);
    fab.addEventListener('click', () => {
        if (Date.now() - _fabMovedAt < 400) return; // 拖动结束不触发开关
        toggleMap();
    });
    $('#isx-closebtn').addEventListener('click', () => toggleMap(false));
    pdoc.addEventListener('keydown', e => {
        if (e.key === 'Escape' && ov.style.display !== 'none' && !$('#isx-dlg').classList.contains('show')) toggleMap(false);
    });

        // ===== 简化手势（mousedown/touchstart 双通道，无 Pointer Events）=====
        // ===== 简化手势（mousedown/touchstart 双通道，无 Pointer Events）=====
    let _z = 1, _x = 0, _y = 0;
    let _dragging = false, _lx = 0, _ly = 0;
    function applyT() {
        ov.querySelectorAll('.mapframe').forEach(f => {
            f.style.transform = 'translate(' + _x + 'px,' + _y + 'px) scale(' + _z + ')';
        });
    }
    function resetView() { _z = 1; _x = 0; _y = 0; applyT(); }
    function setZoom(z) { _z = Math.min(8, Math.max(0.5, z)); clampPan(); applyT(); }
    function clampPan() {
        const r = stageWrap.getBoundingClientRect();
        const mx = Math.max(20, r.width * _z / 2), my = Math.max(20, r.height * _z / 2);
        _x = Math.min(mx, Math.max(-mx, _x));
        _y = Math.min(my, Math.max(-my, _y));
    }
    function startDrag(x, y) { _dragging = true; _lx = x; _ly = y; }
    function moveDrag(x, y) {
        if (!_dragging) return;
        _x += x - _lx; _y += y - _ly;
        _lx = x; _ly = y;
        clampPan(); applyT();
    }

    // 鼠标拖拽
    stageWrap.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        startDrag(e.clientX, e.clientY);
    });
    pdoc.addEventListener('mousemove', e => { if (_dragging) moveDrag(e.clientX, e.clientY); });
    pdoc.addEventListener('mouseup', () => { _dragging = false; });

    // ===== 悬浮窗整体拖动：按住顶栏任意处拖动窗口（含筛选标签上方；拖动后 400ms 内抑制其点击）=====
    const topbar = ov.querySelector('#isx-topbar');
    let _winArmed = false, _winMoving = false, _wmx = 0, _wmy = 0, _winMovedAt = 0;
    function winClickBlocked() { return Date.now() - _winMovedAt < 400; }
    topbar.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        if (e.target.closest('#isx-closebtn, #isx-backBtn, button, select, input')) return;
        _winArmed = true; _winMoving = false;
        _wmx = e.clientX; _wmy = e.clientY;
    });
    pdoc.addEventListener('mousemove', e => {
        if (!_winArmed) return;
        const dx = e.clientX - _wmx, dy = e.clientY - _wmy;
        if (!_winMoving) {
            if (Math.abs(dx) + Math.abs(dy) < 6) return; // 未超过阈值视为点击
            _winMoving = true;
            const r0 = ov.getBoundingClientRect();
            ov.style.left = r0.left + 'px';
            ov.style.top = r0.top + 'px';
            ov.style.transform = 'none';
            ov.classList.add('dragging');
        }
        const r = ov.getBoundingClientRect();
        const vw = pdoc.documentElement.clientWidth, vh = pdoc.documentElement.clientHeight;
        const nx = Math.min(vw - 180, Math.max(180 - r.width, r.left + dx));
        const ny = Math.min(vh - 50, Math.max(0, r.top + dy));
        ov.style.left = nx + 'px';
        ov.style.top = ny + 'px';
        _wmx = e.clientX; _wmy = e.clientY;
        e.preventDefault();
    });
    pdoc.addEventListener('mouseup', () => {
        if (_winArmed && _winMoving) _winMovedAt = Date.now();
        _winArmed = false; _winMoving = false;
    });

    // 触摸拖拽
    stageWrap.addEventListener('touchstart', e => {
        if (e.touches.length === 1) { const t = e.touches[0]; startDrag(t.clientX, t.clientY); }
    }, { passive: true });
    pdoc.addEventListener('touchmove', e => {
        if (!_dragging || e.touches.length !== 1) return;
        e.preventDefault();
        moveDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    pdoc.addEventListener('touchend', () => { _dragging = false; });

    // 滚轮缩放
    stageWrap.addEventListener('wheel', e => {
        e.preventDefault();
        setZoom(_z * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    }, { passive: false });

    // 缩放按钮
    $('#isx-zin').addEventListener('click', () => setZoom(_z * 1.3));
    $('#isx-zout').addEventListener('click', () => setZoom(_z / 1.3));
    $('#isx-zreset').addEventListener('click', resetView);
    $('#isx-backBtn').addEventListener('click', resetView);
    $('#isx-bcWorld').addEventListener('click', resetView);

    new ResizeObserver(() => fitFrame()).observe(stageWrap);
    if (window.toastr) toastr.info('🗺 伊瑟利亚交互地图已加载：点击右下角按钮打开');
})().catch(e => { console.error('[交互地图] 加载失败:', e); try { ((window.parent && window.parent.window) || window).toastr && toastr.error('🗺 交互地图加载失败: ' + (e && e.message || e)); } catch (_) {} });
