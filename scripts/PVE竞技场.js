// @ts-nocheck
// ============================================================
// 伊瑟利亚 · PVE 竞技场（场外模拟战斗插件）
// 悬浮球 ⚔ 开关竞技场：玩家挑战（构筑战力分析+选敌开打）/ 斗蛐蛐（任意选手互斗观战）。
// 战斗 = LLM 单次调用·内嵌推演思维链（<构筑推演>生成数据卡与战力对比 → <战斗推演>逐回合掷骰推演 → <战报>正式战报），
// 规则内嵌战斗轮协议（位阶表/命中/伤害/部位/机制怪），纯场外模拟不读写 stat_data。
//选手来源：内置精选名录（拂晓余烬/魔兽/魔王）+ 世界书条目搜索 + 自由描述。
// ============================================================
(async function () {
    'use strict';
    if (document.readyState !== 'complete') {
        await new Promise(r => window.addEventListener('load', r, { once: true }));
    }
    const pdoc = (window.parent && window.parent.document) || document;
    if (pdoc.getElementById('arx-fab')) return; // 防重复注入

    /* ================== 内置选手库 ================== */
    // source: wb=按关键词在世界书条目名里匹配取原文；desc=描述文本（LLM 现场生成数据卡）
    const ROSTER = [
        { g: '拂晓余烬（冒险者小队）', items: [
            { n: '露易丝·维拉（队长·魔剑士）', tier: '精英', lv: 8, src: { type: 'wb', kw: '露易丝·维拉' } },
            { n: '杜根·布莱索（盾卫）', tier: '精英', lv: 11, src: { type: 'wb', kw: '杜根·布莱索' } },
            { n: '莱恩·希尔斯卡（射手）', tier: '精英', lv: 11, src: { type: 'wb', kw: '莱恩·希尔斯卡' } },
            { n: '塞拉娜·沃克（法师）', tier: '精英', lv: 11, src: { type: 'wb', kw: '塞拉娜·沃克' } },
            { n: '莉莉安·哈洛（牧师）', tier: '精英', lv: 10, src: { type: 'wb', kw: '莉莉安·哈洛' } },
        ]},
        { g: '魔兽 · 常见级（一阶）', items: [
            { n: '毒牙蛇', tier: '一阶·常见', lv: 2, src: { type: 'desc', d: '沼泽密林中的毒蛇型魔兽，体长两米，鳞片呈枯叶色极难察觉。攻击方式为绞缠与注入神经毒素的咬击，毒素会使目标每轮损失生命并行动迟缓；蜕皮期防御下降。' } },
            { n: '角兔', tier: '一阶·常见', lv: 1, src: { type: 'desc', d: '额生短角的大型兔形魔兽，性情胆怯，冲撞速度快，角在发情期坚硬如匕首。几乎没有威胁，新手猎人的入门猎物。' } },
            { n: '铁毛狼', tier: '一阶·常见', lv: 3, src: { type: 'desc', d: '毛发如钢丝的群居狼型魔兽，单体不弱于猎犬，但成群时战术默契极高，会包抄、佯攻、锁喉。皮毛可制粗甲。' } },
        ]},
        { g: '魔兽 · 危险级（二阶~三阶）', items: [
            { n: '火鬃狮', tier: '二阶·危险', lv: 6, src: { type: 'desc', d: '鬃毛可燃的巨型狮型魔兽，愤怒时鬃毛燃起火焰，扑击带燃烧效果；吼叫产生冲击波。独居领地意识极强。' } },
            { n: '影豹', tier: '二阶·危险', lv: 7, src: { type: 'desc', d: '皮毛融入阴影的豹型魔兽，潜伏时几乎不可察觉，擅长从背后偷袭锁喉；光线昏暗环境下攻防大增，怕强光。' } },
            { n: '双头巨狼', tier: '三阶·凶险', lv: 10, src: { type: 'desc', d: '双头变异巨狼，两头可分别撕咬不同目标，视野无死角无法偷袭；吼声双重视震荡慑。皮糙肉厚，近战极难缠。' } },
            { n: '血镰螳螂', tier: '三阶·凶险', lv: 9, src: { type: 'desc', d: '新大陆沼泽的巨型螳螂魔兽，前肢如血色镰刀可斩断树干，擅长伏击与连环斩击；甲壳轻而坚韧，弱点是腹部节间膜。' } },
        ]},
        { g: '魔兽 · 死亡级（四阶）', items: [
            { n: '暴风翼蛇', tier: '三阶·凶险', lv: 12, src: { type: 'desc', d: '生有膜翼的飞行蛇型魔兽，盘旋于风暴边缘，能掀起切割风刃与下坠绞杀；飞行机动极强，远程难以锁定。' } },
            { n: '冰原巨象', tier: '四阶·死亡', lv: 14, src: { type: 'desc', d: '北境冰原的巨象型魔兽，冰壳如城墙，冲撞足以摧塌箭塔；长牙横扫、践踏震地，喷吐寒潮冻结地面。转身缓慢，惧火。' } },
            { n: '深海蛟', tier: '四阶·死亡', lv: 15, src: { type: 'desc', d: '蛇形水生魔兽的完全体， sagen海中如龙，卷起漩涡拖人入水；水下近乎无敌，离水后战力锐减。鳞下脂肪是炼金珍材。' } },
        ]},
        { g: '魔兽 · 灾兽级（五阶）与传说个体', items: [
            { n: '震地羽蛇', tier: '五阶·灾兽', lv: 20, src: { type: 'desc', d: '乌尔坎图腾级羽蛇，羽翼金属光泽，振翅起雷霆、尾羽落地成震爆；被新大陆部族奉为雷神使者，智力高，会战术性拆解队伍。' } },
            { n: '蚀甲', tier: '五阶·灾兽', lv: 21, src: { type: 'desc', d: '无形体灾兽，寄生并"蚀化"生物护甲与装备——被缠上者装备逐分钟朽坏、防御崩溃；本体近乎不可见，唯攻击瞬间显形酸雾轮廓。' } },
            { n: '霜血九头蛇（尼弗海姆核心守卫）', tier: '史诗顶峰', lv: 16, src: { type: 'desc', d: '拥有远古真龙稀薄血脉的畸变多头爬行巨兽，九枚蛇头各自吐息绝对零度的极寒龙息；物理防御极高，刀剑难入。核心机制：超强急速再生——除非一轮内同时斩落全部九头，否则下一轮全部恢复；每断一头脑袋喷涌霜血腐蚀地面。守护渊冰深井最底层。' } },
        ]},
        { g: '魔王 · 终焉纪元（IF线）', items: [
            { n: '魔王奥姆尼斯 · 第一阶段「万象篡夺」', tier: '神话', lv: 22, src: { type: 'wb', kw: '魔王奥姆尼斯' }, note: '取第一阶段数据：神话Lv22 HP500 防御24 命格权能·魔潮指令' },
            { n: '魔王奥姆尼斯 · 第二阶段「完美渊神」', tier: '神话', lv: 25, src: { type: 'wb', kw: '魔王奥姆尼斯' }, note: '取第二阶段数据：神明降临态 HP800 防御28 免疫暴击/异常、信仰回流每轮回血' },
            { n: '魔王奥姆尼斯 · 第三阶段「种族残渣」', tier: '神话', lv: 25, src: { type: 'wb', kw: '魔王奥姆尼斯' }, note: '取第三阶段数据：HP1500 防御15（体型易命中）触须横扫+吞噬回血+三源命核' },
        ]},
    ];

    /* ================== 样式 ================== */
    const CSS = `
#arx-fab{
  position:fixed; left:50%; top:62%; margin:-23px 0 0 -23px; z-index:99989; width:46px; height:46px;
  display:flex; align-items:center; justify-content:center; cursor:grab; font-size:22px; touch-action:none;
  background:linear-gradient(180deg,#2a2016,#3a2b1c); color:#f0d48a;
  border:2px solid #b8956a; border-radius:50%;
  box-shadow:0 3px 10px rgba(0,0,0,.5), inset 0 0 10px rgba(212,180,120,.25);
  transition:transform .15s; font-family:"Noto Serif SC","Songti SC",serif;
}
#arx-fab:hover{transform:scale(1.1);}
#arx-fab.dragging, #arx-fab.dragging:hover{ transform:none; transition:none; cursor:grabbing; }
#arx-overlay{
  --arx-parch:#f4ebd8; --arx-ink:#3a2c1a; --arx-ink2:#6b5638; --arx-gold:#b8892a; --arx-gold-lt:#d8b766;
  --arx-line:#8a6f45; --arx-red:#a0402a; --arx-blue:#3f5d7d;
  position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
  width:min(1080px,96vw); height:min(880px,92vh);
  z-index:99990; display:none; flex-direction:column; padding:10px 12px; gap:8px;
  border-radius:10px; box-shadow:0 24px 80px rgba(20,12,4,.55), 0 0 0 1px rgba(58,44,26,.4);
  font-family:"Noto Serif SC","Songti SC","STKaiti","KaiTi",serif; color:var(--arx-ink);
  background:radial-gradient(circle at 20% 10%, #efe4cb 0%, #e4d6b4 60%, #d8c79e 100%);
  overflow:hidden; user-select:none;
}
#arx-overlay.dragging{ transform:none; }
#arx-overlay, #arx-overlay *{box-sizing:border-box;}
#arx-overlay *{margin:0; padding:0;}
#arx-topbar{
  display:flex; align-items:center; gap:12px; padding:8px 14px; cursor:grab; touch-action:none;
  background:linear-gradient(180deg,#f7f0de,#ecdfc0); border:2px solid var(--arx-line); border-radius:4px;
  box-shadow:0 2px 0 #cbb487, inset 0 0 18px rgba(138,111,69,.12); position:relative; flex:0 0 auto;
}
#arx-topbar:active{cursor:grabbing;}
#arx-title{font-size:19px; font-weight:700; letter-spacing:3px; color:var(--arx-ink); white-space:nowrap;}
#arx-title small{font-size:11px; letter-spacing:2px; color:var(--arx-ink2); margin-left:8px;}
.arx-tabs{display:flex; gap:6px; margin-left:auto;}
.arx-tab{cursor:pointer; font-family:inherit; font-size:13px; letter-spacing:2px; padding:6px 14px; white-space:nowrap;
  color:var(--arx-ink2); background:#f7f0de; border:1.5px solid var(--arx-line); border-radius:3px;}
.arx-tab.cur{color:#fff; background:linear-gradient(180deg,#7a5a2e,#5e4420); border-color:#3a2c1a; font-weight:700;}
#arx-closebtn{
  cursor:pointer; font-family:inherit; font-size:13px; padding:6px 14px;
  color:#fff; background:linear-gradient(180deg,#a0402a,#7a2e1e);
  border:1px solid #3a2c1a; border-radius:3px; box-shadow:0 2px 0 #3a2c1a; letter-spacing:2px;
}
#arx-main{flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:8px; overflow:hidden;}
#arx-setup{flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:8px; overflow-y:auto; padding:2px;}
.arx-cols{display:flex; gap:10px; flex:1 1 auto; min-height:0;}
.arx-side{flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:6px;
  background:rgba(247,240,222,.6); border:1.5px solid var(--arx-line); border-radius:6px; padding:8px;}
.arx-side h3{font-size:14px; letter-spacing:2px; color:var(--arx-ink); border-bottom:1px solid rgba(138,111,69,.4); padding-bottom:5px; margin-bottom:2px;}
.arx-side h3 .arx-flag-red{color:var(--arx-red);}
.arx-side h3 .arx-flag-blue{color:var(--arx-blue);}
.arx-picked{flex:0 0 auto; max-height:26%; overflow-y:auto; display:flex; flex-direction:column; gap:4px;}
.arx-pick{display:flex; align-items:center; gap:6px; font-size:12px; background:#fbf4e2; border:1px solid var(--arx-line); border-radius:3px; padding:4px 8px;}
.arx-pick b{flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.arx-pick .arx-tier{font-size:10px; color:#fff; background:var(--arx-gold); border-radius:8px; padding:1px 7px; flex:0 0 auto;}
.arx-pick .arx-x{cursor:pointer; color:var(--arx-red); font-weight:700; flex:0 0 auto; padding:0 4px;}
.arx-pool{flex:1 1 auto; min-height:80px; overflow-y:auto; border:1px dashed var(--arx-line); border-radius:4px; background:rgba(251,244,226,.5); padding:6px;}
.arx-group{font-size:11px; letter-spacing:1px; color:var(--arx-ink2); margin:6px 0 3px; border-bottom:1px dashed rgba(138,111,69,.35);}
/* 选手胶囊：!important 锁定换行与宽度约束——酒馆主题的全局 span 样式会覆盖普通声明，
   导致 inline-block 背景框不随内容换行 → 文字横穿胶囊底色 */
#arx-overlay .arx-cand{display:inline-block !important; cursor:pointer; font-size:11.5px !important; line-height:1.65 !important;
  margin:2px 3px; padding:3px 10px; text-align:left; vertical-align:top;
  max-width:100% !important; white-space:normal !important; word-break:break-word !important; overflow-wrap:anywhere !important;
  background:#f7f0de; border:1px solid var(--arx-line); border-radius:10px; transition:.12s;}
.arx-cand:hover{border-color:var(--arx-gold); background:#fff7e4;}
.arx-cand.sel{background:linear-gradient(180deg,#7a5a2e,#5e4420); color:#fff; border-color:#3a2c1a;}
#arx-searchRow{display:flex; gap:6px; flex:0 0 auto;}
#arx-searchRow input{flex:1 1 auto; min-width:0; font-family:inherit; font-size:12px; padding:5px 8px;
  border:1px solid var(--arx-line); border-radius:3px; background:#fbf4e2; color:var(--arx-ink);}
.arx-btn{
  cursor:pointer; font-family:inherit; font-size:13px; letter-spacing:2px; padding:7px 16px;
  color:#fff; background:linear-gradient(180deg,#7a5a2e,#5e4420);
  border:1px solid #3a2c1a; border-radius:3px; box-shadow:0 2px 0 #3a2c1a; flex:0 0 auto;
}
.arx-btn:hover{filter:brightness(1.12);}
.arx-btn:disabled{opacity:.5; cursor:not-allowed;}
.arx-btn.arx-danger{background:linear-gradient(180deg,#a0402a,#7a2e1e);}
#arx-startRow{display:flex; gap:8px; align-items:center; flex:0 0 auto; padding:4px 2px;}
#arx-vsHint{font-size:12px; color:var(--arx-ink2); flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
#arx-meCard{font-size:12px; line-height:1.7; color:var(--arx-ink); background:#fbf4e2; border:1px solid var(--arx-line); border-radius:4px; padding:9px 10px; max-height:34%; overflow-y:auto;}
#arx-meCard b{color:var(--arx-gold);}
.arx-me-top{display:flex; align-items:center; gap:8px; flex-wrap:wrap; border-bottom:1px dashed rgba(138,111,69,.45); padding-bottom:6px; margin-bottom:7px;}
.arx-me-name{font-size:16px; font-weight:700; color:var(--arx-ink); letter-spacing:2px;}
.arx-me-sub{font-size:11px; color:var(--arx-ink2);}
.arx-me-rank{font-size:11px; color:#fff; background:linear-gradient(180deg,#7a5a2e,#5e4420); padding:2px 9px; border-radius:9px; letter-spacing:1px; margin-left:auto;}
.arx-me-bars{display:flex; gap:6px; flex-wrap:wrap; margin-bottom:7px;}
.arx-bar{position:relative; flex:1 1 96px; min-width:96px; height:18px; background:rgba(58,44,26,.15); border:1px solid var(--arx-line); border-radius:9px; overflow:hidden;}
.arx-bar i{position:absolute; top:0; bottom:0; left:0; border-radius:9px 0 0 9px;}
.arx-bar.hp i{background:linear-gradient(180deg,#c05a3a,#8a3520);}
.arx-bar.mp i{background:linear-gradient(180deg,#4a7db3,#2d5580);}
.arx-bar.sp i{background:linear-gradient(180deg,#5a9a4a,#38702c);}
.arx-bar em{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:10px; font-style:normal;
  color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.65); font-family:Consolas,monospace; letter-spacing:1px;}
.arx-me-stats{display:flex; gap:4px; flex-wrap:wrap; margin-bottom:7px;}
.arx-me-stats span{font-size:11px; font-family:Consolas,monospace; background:rgba(247,240,222,.95); border:1px solid var(--arx-line); border-radius:3px; padding:2px 7px; color:var(--arx-ink);}
.arx-me-stats span.arx-def{color:var(--arx-gold); font-weight:700;}
.arx-me-tags{display:flex; gap:4px; flex-wrap:wrap; margin-bottom:6px;}
.arx-tag{font-size:11px; background:rgba(247,240,222,.95); border:1px solid var(--arx-line); border-radius:9px; padding:2px 9px; color:var(--arx-ink2);}
.arx-tag b{color:var(--arx-ink); font-weight:600;}
.arx-me-style{font-size:11.5px; color:var(--arx-ink2); border-top:1px dashed rgba(138,111,69,.35); padding-top:5px;}
.arx-me-style b{color:var(--arx-ink);}
#arx-result{flex:1 1 auto; min-height:0; display:none; flex-direction:column; gap:8px; overflow-y:auto; padding:2px;}
.arx-co{background:rgba(30,24,15,.93); color:#e8d5a8; border:1.5px solid var(--arx-gold); border-radius:6px; overflow:hidden; flex:0 0 auto;}
.arx-co-h{cursor:pointer; padding:8px 14px; font-size:13px; letter-spacing:2px; color:#f0d48a;
  background:linear-gradient(180deg,rgba(122,90,46,.5),rgba(58,44,26,.4)); display:flex; align-items:center; gap:8px;}
.arx-co-h .arx-arrow{transition:transform .2s; font-size:11px;}
.arx-co.closed .arx-arrow{transform:rotate(-90deg);}
.arx-co-b{display:none; padding:10px 14px; font-size:12.5px; line-height:1.85; white-space:pre-wrap; max-height:340px; overflow-y:auto;}
.arx-co.open .arx-co-b{display:block;}
#arx-report.arx-co-b{ max-height:none; }
#arx-report{background:linear-gradient(165deg,#2a2016 0%,#3a2b1c 30%,#312417 60%,#241a10 100%); color:#e8d5a8;
  border:2px solid #b8956a; border-radius:6px; padding:14px 16px; font-size:13px; line-height:1.9; flex:0 0 auto;}
#arx-report .arx-head{ text-align:center; color:#f0d48a; font-size:15px; letter-spacing:3px; margin:6px 0 10px;
  border-bottom:1px solid rgba(212,180,120,.35); padding-bottom:8px;}
#arx-report .arx-round{ color:#f0d48a; font-size:14px; letter-spacing:2px; margin:14px 0 6px;
  border-left:3px solid var(--arx-gold); padding-left:10px;}
#arx-report .arx-para{ margin:6px 0; text-indent:2em; }
#arx-report .arx-row{ display:block; font-size:11.5px; line-height:1.8; margin:2px 0; padding:2px 8px;
  background:rgba(0,0,0,.25); border-left:2px solid #9a7a45; color:#d8c49a; border-radius:0 3px 3px 0; font-family:Consolas,monospace;}
#arx-report .arx-row.arx-hp{ border-left-color:#d46a4a; color:#ffb9a0; }
#arx-report .arx-row.arx-dice{ border-left-color:#7da7c9; color:#bcd6ea; }
#arx-report .arx-verdict{ text-align:center; font-size:15px; letter-spacing:3px; color:#ffe9a8; margin:16px 0 6px;
  border:1px solid var(--arx-gold); border-radius:4px; padding:8px; background:rgba(184,137,42,.12);}
#arx-report .arx-tail{ text-align:center; font-size:12px; color:#c9b184; margin-top:6px; }
#arx-busy{ position:absolute; inset:0; z-index:50; display:none; align-items:center; justify-content:center; flex-direction:column; gap:14px;
  background:rgba(30,22,12,.72); backdrop-filter:blur(2px); border-radius:10px;}
#arx-busy.show{display:flex;}
#arx-busy .arx-spin{ font-size:40px; animation:arxSpin 1.6s linear infinite; }
@keyframes arxSpin{ to{ transform:rotate(360deg);} }
#arx-busy .arx-busy-t{ color:#f0d48a; font-size:15px; letter-spacing:3px;}
#arx-busy .arx-busy-s{ color:#c9b184; font-size:12px;}
#arx-tip{position:fixed; z-index:99999; pointer-events:none; opacity:0; transition:opacity .12s; max-width:230px;
  background:linear-gradient(180deg,#fbf4e2,#efe2c2); border:1.5px solid var(--arx-gold); border-radius:4px; padding:7px 10px;
  box-shadow:0 4px 12px rgba(58,44,26,.28); font-size:12px; line-height:1.5; color:var(--arx-ink);
  font-family:"Noto Serif SC",serif;}
#arx-tip.show{opacity:1;}
.arx-mini{ font-size:11px; color:var(--arx-ink2); }
#arx-historyRow{display:flex; gap:6px; align-items:center; flex:0 0 auto;}
#arx-histSel{flex:0 0 auto; max-width:46%; font-family:inherit; font-size:12px; padding:5px 6px; border:1px solid var(--arx-line); border-radius:3px; background:#fbf4e2; color:var(--arx-ink);}
/* ★ 手机端适配（必须位于所有基础规则之后：media 内规则与基础规则同特异性，后声明者胜） */
@media (max-width:786px){
  #arx-overlay{
    left:0 !important; top:0 !important; right:0; bottom:0;
    transform:none !important; width:100vw; height:100vh; height:100dvh;
    border-radius:0; padding:5px;
  }
  #arx-overlay.dragging{ transform:none !important; }
  #arx-fab{ width:40px; height:40px; font-size:19px; margin:-20px 0 0 -20px; }
  #arx-topbar{ flex-wrap:wrap; gap:5px 8px; padding:5px 8px; }
  #arx-title{ font-size:14px; letter-spacing:1px; }
  #arx-title small{ display:none; }
  .arx-tabs{ gap:4px; }
  .arx-tab{ font-size:11px; padding:4px 8px; letter-spacing:1px; }
  #arx-closebtn{ font-size:11px; padding:4px 8px; }
  .arx-cols{ flex-direction:column; overflow-y:auto; }
  .arx-side{ flex:0 0 auto; }
  .arx-pool{ min-height:60px; max-height:170px; }
  .arx-picked{ max-height:120px; }
  #arx-meCard{ max-height:150px; }
  .arx-cand{ font-size:10.5px !important; padding:2px 8px; }
  .arx-btn{ font-size:12px; padding:6px 12px; }
  #arx-report{ font-size:12px; padding:10px; }
  #arx-report .arx-row{ font-size:10px; }
  .arx-co-b{ max-height:240px; font-size:11.5px; }
}
`;

    /* ================== 结构 ================== */
    const HTML = `
<div id="arx-app" style="display:flex; flex-direction:column; height:100%; gap:8px; min-height:0;">
  <div id="arx-topbar">
    <span id="arx-grip" title="按住拖动窗口">⠿</span>
    <div id="arx-title">PVE 竞技场 <small>AETHERIA ARENA</small></div>
    <div class="arx-tabs">
      <button class="arx-tab cur" id="arx-tabDuel">🥊 斗蛐蛐</button>
      <button class="arx-tab" id="arx-tabMe">🛡 玩家挑战</button>
    </div>
    <button id="arx-closebtn">✕ 关闭</button>
  </div>
  <div id="arx-main">
    <div id="arx-setup">
      <div class="arx-cols">
        <div class="arx-side" id="arx-sideA">
          <h3><span class="arx-flag-red">■</span> <span id="arx-sideATitle">红方（我方）</span></h3>
          <div class="arx-picked" id="arx-pickedA"></div>
          <div class="arx-pool" id="arx-poolA"></div>
        </div>
        <div class="arx-side" id="arx-sideB">
          <h3><span class="arx-flag-blue">■</span> <span id="arx-sideBTitle">蓝方（敌方）</span></h3>
          <div class="arx-picked" id="arx-pickedB"></div>
          <div class="arx-pool" id="arx-poolB"></div>
        </div>
      </div>
      <div id="arx-searchRow">
        <input id="arx-search" placeholder="搜世界书条目；或写下敌人描述后点 ➕ 加入指定一方（自定义敌人）">
        <button class="arx-btn" id="arx-searchBtn" title="在两边的候补池里显示搜索结果">🔍 搜索</button>
        <button class="arx-btn" id="arx-customA" title="把输入框的文字作为自定义选手加入红方">➕ 红方</button>
        <button class="arx-btn" id="arx-customB" title="把输入框的文字作为自定义选手加入蓝方/敌方">➕ 蓝方</button>
      </div>
      <div id="arx-meCard" style="display:none;"></div>
      <div id="arx-startRow">
        <span id="arx-vsHint">选择双方选手后开战</span>
        <button class="arx-btn" id="arx-analyzeBtn" style="display:none;">⚡ 战力分析</button>
        <button class="arx-btn arx-danger" id="arx-startBtn">⚔ 开战</button>
      </div>
      <div id="arx-historyRow">
        <select id="arx-histSel"><option value="">📜 战斗记录…</option></select>
        <button class="arx-btn" id="arx-backBtn" style="display:none;">← 返回准备区</button>
      </div>
    </div>
    <div id="arx-result"></div>
  </div>
  <div id="arx-busy">
    <div class="arx-spin">⚔️</div>
    <div class="arx-busy-t" id="arxBusyT">推演中…</div>
    <div class="arx-busy-s" id="arxBusyS">正在生成数据卡与逐回合推演，长战斗约需 1~3 分钟</div>
  </div>
</div>
<div id="arx-tip"></div>
`;

    /* ================== 注入 ================== */
    const styleEl = pdoc.createElement('style');
    styleEl.id = 'arx-style';
    styleEl.textContent = CSS;
    pdoc.head.appendChild(styleEl);

    const fab = pdoc.createElement('div');
    fab.id = 'arx-fab';
    fab.textContent = '⚔️';
    fab.title = 'PVE 竞技场（可拖动）';
    pdoc.body.appendChild(fab);
    try {
        const saved = JSON.parse(localStorage.getItem('iseria_arena_fab_pos') || 'null');
        if (saved && typeof saved.left === 'number') {
            const fl = Math.min(pdoc.documentElement.clientWidth - 46, Math.max(0, saved.left));
            const ft = Math.min(pdoc.documentElement.clientHeight - 46, Math.max(0, saved.top));
            fab.style.left = fl + 'px'; fab.style.top = ft + 'px';
            fab.style.right = 'auto'; fab.style.bottom = 'auto';
        } else if (pdoc.documentElement.clientWidth <= 786) {
            const vw = pdoc.documentElement.clientWidth, vh = pdoc.documentElement.clientHeight;
            fab.style.left = (vw - 62) + 'px'; fab.style.top = (vh - 230) + 'px';
            fab.style.right = 'auto'; fab.style.bottom = 'auto';
        }
    } catch (e) {}

    const ov = pdoc.createElement('div');
    ov.id = 'arx-overlay';
    ov.innerHTML = HTML;
    ov.style.display = 'none';
    pdoc.body.appendChild(ov);

    const $ = (s) => ov.querySelector(s);
    const tip = $('#arx-tip');
    const win = (window.parent && window.parent.window) || window;

    /* ================== 状态 ================== */
    let mode = 'duel'; // duel=斗蛐蛐 | me=玩家挑战
    let meInfo = null;          // { text: 构筑卡文本, name, tier }
    const picked = { A: [], B: [] }; // [{n, tier, src, note?, desc?}]
    let wbCache = null;         // 世界书条目缓存 [{name, content}]
    let lastReportKey = '';

    const pickedBox = { A: $('#arx-pickedA'), B: $('#arx-pickedB') };
    const poolBox = { A: $('#arx-poolA'), B: $('#arx-poolB') };

    function toast(msg, err) {
        try { (err ? toastr.error : toastr.info)(msg, 'PVE 竞技场'); } catch (e) { console.info('[竞技场]', msg); }
    }

    /* ================== 世界书 / 构筑 读取 ================== */
    async function loadWorldbook() {
        if (wbCache) return wbCache;
        const names = (typeof getCharWorldbookNames === 'function' && (() => { try { return getCharWorldbookNames('current'); } catch (e) { return null; } })()) || null;
        const bookName = (names && (names.primary || '')) || '伊瑟利亚3.4';
        let entries = [];
        try { entries = await getWorldbook(bookName); } catch (e) {}
        if (!Array.isArray(entries) || !entries.length) {
            try {
                const all = (typeof getWorldbookNames === 'function') ? (getWorldbookNames() || []) : [];
                for (const n of all) {
                    try { const es = await getWorldbook(n); if (Array.isArray(es) && es.length) { entries = es; break; } } catch (e) {}
                }
            } catch (e) {}
        }
        wbCache = (entries || []).map(e => ({ name: String(e?.name ?? e?.comment ?? ''), content: String(e?.content ?? '') })).filter(x => x.name);
        return wbCache;
    }

    function statData() {
        try { const d = window.Mvu && window.Mvu.getMvuData && window.Mvu.getMvuData({ type: 'chat' }); if (d && d.stat_data) return d.stat_data; } catch (e) {}
        try { const d = getVariables({ type: 'chat' }); if (d && d.stat_data) return d.stat_data; } catch (e) {}
        return null;
    }

    /** 主角构筑 → 精简战斗卡文本（提示词用） */
    function buildMeCard(H) {
        const L = [];
        const put = (s) => L.push(s);
        const bi = H.基础信息 ?? {};
        put(`姓名: ${bi.姓名 || '无名者'}（玩家）`);
        put(`种族: ${bi.种族 || '?'} / 性别: ${bi.性别 || '?'} / 年龄: ${bi.年龄 || '?'}`);
        if (bi.战斗方式) put(`战斗方式: ${bi.战斗方式}`);
        if (bi.信仰 && bi.信仰 !== '无信仰') put(`信仰: ${bi.信仰}`);
        put(`等阶: ${H.等阶 ?? '普通'} / 总等级: ${H?.基础状态?.总等级 ?? '?'}`);
        put(`防御值: ${H.防御值 ?? 10}`);
        const at = H.基础属性 ?? {};
        put(`属性: 力量${at.力量 ?? 10} | 敏捷${at.敏捷 ?? 10} | 体质${at.体质 ?? 10} | 智力${at.智力 ?? 10} | 感知${at.感知 ?? 10} | 魅力${at.魅力 ?? 10}`);
        const st2 = H.基础状态 ?? {};
        const fmt = (x) => x ? `${x.当前 ?? x.最大 ?? 0}/${x.最大 ?? 0}` : '0/0';
        put(`HP: ${fmt(st2.HP)} / MP: ${fmt(st2.MP)} / SP: ${fmt(st2.SP)}`);
        const jobs = st2.职业信息 ?? {};
        const jl = Object.entries(jobs).map(([n, j]) => `${n} Lv${j?.等级 ?? '?'}`).join('、');
        if (jl) put(`职业: ${jl}`);
        const eq = H.资产与能力?.装备栏 ?? {};
        const eql = Object.entries(eq).filter(([, v]) => v && (v.物品名 || v.品阶))
            .map(([slot, v]) => `${slot}:${v.物品名 || '?'}(${v.品阶 || '?'}${v.面板效果 ? ',面板:' + JSON.stringify(v.面板效果) : ''}${v.特别机制 ? ',' + v.特别机制 : ''})`);
        if (eql.length) put(`装备: ${eql.join('；')}`);
        const listSec = (title, obj, fmtItem) => {
            const items = Object.entries(obj ?? {});
            if (items.length) put(`${title}: ` + items.map(([n, v]) => fmtItem(n, v)).join('；'));
        };
        listSec('角色技能', H.资产与能力?.角色技能, (n, v) => `${n}(Lv${v?.等级 ?? '?'})`);
        listSec('魔法', H.资产与能力?.魔法栏, (n, v) => `${n}(MP${v?.消耗MP ?? '?'}):${(v?.描述 || '').slice(0, 60)}`);
        listSec('神术', H.资产与能力?.神术栏, (n, v) => `${n}(MP${v?.消耗MP ?? '?'}):${(v?.描述 || '').slice(0, 60)}`);
        listSec('加护', H.资产与能力?.加护, (n, v) => `${n}:${(v?.描述 || '').slice(0, 50)}`);
        listSec('权能', H.资产与能力?.权能, (n, v) => `${n}:${(v?.描述 || '').slice(0, 60)}`);
        listSec('奥义', H.资产与能力?.奥义, (n, v) => `${n}(SP${v?.消耗SP ?? '-'}/MP${v?.消耗MP ?? '-'}):${(v?.描述 || '').slice(0, 60)}`);
        return L.join('\n');
    }

    /** 主角构筑 → 结构化渲染（玩家栏显示用） */
    function renderMeCard(H) {
        const bi = H.基础信息 ?? {};
        const at = H.基础属性 ?? {};
        const st2 = H.基础状态 ?? {};
        const esc2 = esc;
        const sub = [bi.种族, bi.性别, (bi.年龄 ? bi.年龄 + '岁' : '')].filter(Boolean).join(' · ');
        const rank = `${H.等阶 ?? '普通'} · 总等级 ${st2.总等级 ?? '?'}`;
        const bar = (label, cur, max, cls) => {
            const c = Number(cur ?? 0), m = Number(max ?? 0);
            const pct = m > 0 ? Math.max(0, Math.min(100, c / m * 100)) : 0;
            return `<div class="arx-bar ${cls}"><i style="width:${pct}%"></i><em>${label} ${c}/${m}</em></div>`;
        };
        const stats = [
            ['力', at.力量], ['敏', at.敏捷], ['体', at.体质], ['智', at.智力], ['感', at.感知], ['魅', at.魅力],
        ].map(([n, v]) => `<span>${n} ${v ?? 10}</span>`).join('') + `<span class="arx-def">防御 ${H.防御值 ?? 10}</span>`;
        const tags = [];
        const jobs = st2.职业信息 ?? {};
        for (const [n, j] of Object.entries(jobs)) tags.push(`<span class="arx-tag">❖ <b>${n}</b> Lv${j?.等级 ?? '?'}</span>`);
        for (const [, v] of Object.entries(H.资产与能力?.装备栏 ?? {})) {
            if (v && (v.物品名 || v.品阶)) tags.push(`<span class="arx-tag" title="${esc2(v.特别机制 || '')}">⚔ <b>${esc2(v.物品名 || '?')}</b>${v.品阶 ? '·' + esc2(v.品阶) : ''}</span>`);
        }
        for (const [n, v] of Object.entries(H.资产与能力?.角色技能 ?? {})) tags.push(`<span class="arx-tag">✦ <b>${esc2(n)}</b> Lv${v?.等级 ?? '?'}</span>`);
        for (const [n, v] of Object.entries(H.资产与能力?.魔法栏 ?? {})) tags.push(`<span class="arx-tag">✨ <b>${esc2(n)}</b> MP${v?.消耗MP ?? '?'}</span>`);
        for (const [n, v] of Object.entries(H.资产与能力?.神术栏 ?? {})) tags.push(`<span class="arx-tag">☾ <b>${esc2(n)}</b> MP${v?.消耗MP ?? '?'}</span>`);
        for (const [n, v] of Object.entries(H.资产与能力?.加护 ?? {})) tags.push(`<span class="arx-tag">⚜ <b>${esc2(n)}</b></span>`);
        for (const [n, v] of Object.entries(H.资产与能力?.权能 ?? {})) tags.push(`<span class="arx-tag">◈ <b>${esc2(n)}</b></span>`);
        for (const [n, v] of Object.entries(H.资产与能力?.奥义 ?? {})) tags.push(`<span class="arx-tag">★ <b>${esc2(n)}</b> SP${v?.消耗SP ?? '-'}</span>`);
        const styleLine = bi.战斗方式 ? `<div class="arx-me-style">战斗方式：<b>${esc2(bi.战斗方式)}</b></div>` : '';
        return `<div class="arx-me-top"><span class="arx-me-name">${esc2(bi.姓名 || '无名者')}</span>` +
            `<span class="arx-me-sub">${esc2(sub)}</span><span class="arx-me-rank">${esc2(rank)}</span></div>` +
            `<div class="arx-me-bars">${bar('HP', st2.HP?.当前, st2.HP?.最大, 'hp')}${bar('MP', st2.MP?.当前, st2.MP?.最大, 'mp')}${bar('SP', st2.SP?.当前, st2.SP?.最大, 'sp')}</div>` +
            `<div class="arx-me-stats">${stats}</div>` +
            (tags.length ? `<div class="arx-me-tags">${tags.join('')}</div>` : '') +
            styleLine;
    }

    function refreshMeCard() {
        const card = $('#arx-meCard');
        if (mode !== 'me') { card.style.display = 'none'; return; }
        const st = statData();
        if (!st || !st.主角) {
            card.style.display = '';
            card.innerHTML = '<span class="arx-mini">⚠ 未能读取 stat_data.主角（请先签订开局契约或进入有存档的聊天）。仍可手动添加其他选手。</span>';
            meInfo = null;
            return;
        }
        const H = st.主角;
        meInfo = { text: buildMeCard(H), name: (H?.基础信息?.姓名 || '玩家'), tier: H?.等阶 || '普通' };
        card.style.display = '';
        card.innerHTML = renderMeCard(H);
    }

    /* ================== 选手区渲染 ================== */
    function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function renderPicked(side) {
        const box = pickedBox[side];
        box.innerHTML = '';
        picked[side].forEach((p, i) => {
            const d = pdoc.createElement('div');
            d.className = 'arx-pick';
            d.innerHTML = `<b title="${esc(p.n)}">${esc(p.n)}</b><span class="arx-tier">${esc(p.tier)}</span><span class="arx-x" data-i="${i}">✕</span>`;
            d.querySelector('.arx-x').addEventListener('click', () => { picked[side].splice(i, 1); renderPicked(side); updateHint(); });
            box.appendChild(d);
        });
    }

    function candHtml(item, selSide) {
        const sel = selSide && picked[selSide].some(p => p.n === item.n) ? ' sel' : '';
        return `<span class="arx-cand${sel}" data-n="${esc(item.n)}" title="${esc(item.tier + (item.note ? ' · ' + item.note : ''))}">${esc(item.n)}</span>`;
    }

    function renderPool(side, extra) {
        const box = poolBox[side];
        const html = [];
        for (const g of ROSTER) {
            html.push(`<div class="arx-group">${esc(g.g)}</div>`);
            html.push(g.items.map(it => candHtml(it, side)).join(''));
        }
        if (extra && extra.length) {
            html.push(`<div class="arx-group">世界书搜索结果</div>`);
            html.push(extra.map(it => candHtml(it, side)).join(''));
        }
        box.innerHTML = html.join('');
        box.querySelectorAll('.arx-cand').forEach(el => {
            el.addEventListener('click', () => {
                const n = el.dataset.n;
                const item = findAllRoster().find(x => x.n === n);
                if (!item) return;
                const target = mode === 'me' ? 'B' : side;
                if (picked[target].some(p => p.n === n)) { toast('该选手已在场上'); return; }
                picked[target].push({ ...item });
                renderPicked(target); updateHint();
            });
        });
    }

    function findAllRoster() {
        const all = [];
        for (const g of ROSTER) all.push(...g.items);
        if (window.__arxSearchResults) all.push(...window.__arxSearchResults);
        return all;
    }

    function updateHint() {
        const a = picked.A.map(p => p.n).join('、') || (mode === 'me' ? (meInfo ? meInfo.name : '（未读到玩家构筑）') : '（空）');
        const b = picked.B.map(p => p.n).join('、') || '（空）';
        $('#arx-vsHint').textContent = `${a}  ⚔  ${b}`;
        $('#arx-startBtn').disabled = !(picked.B.length);
        $('#arx-startBtn').textContent = mode === 'me' ? '⚔ 应战' : '⚔ 开战';
    }

    function renderSideTitles() {
        if (mode === 'me') {
            $('#arx-sideATitle').textContent = '我方（玩家构筑）';
            $('#arx-sideBTitle').textContent = '敌方（选择对手）';
            pickedBox.A.parentElement.style.opacity = '.55';
        } else {
            $('#arx-sideATitle').textContent = '红方';
            $('#arx-sideBTitle').textContent = '蓝方';
            pickedBox.A.parentElement.style.opacity = '1';
        }
    }

    /* ================== 搜索 / 自定义 ================== */
    async function doSearch() {
        const q = $('#arx-search').value.trim();
        if (!q) { toast('输入关键词再搜索'); return; }
        const entries = await loadWorldbook();
        if (!entries.length) { toast('未能读取世界书', true); return; }
        const hits = entries.filter(e => e.name.includes(q) || (e.content && e.content.slice(0, 400).includes(q))).slice(0, 24);
        if (!hits.length) { toast('无命中条目'); return; }
        window.__arxSearchResults = hits.map(e => ({
            n: (e.name.length > 26 ? e.name.slice(0, 26) + '…' : e.name),
            tier: '世界书',
            src: { type: 'wbraw', kw: e.name },
            fullName: e.name,
        }));
        renderPool('A', window.__arxSearchResults);
        renderPool('B', window.__arxSearchResults);
        toast(`命中 ${hits.length} 条，点击候补即加入对应方`);
    }

    function addCustom(side) {
        const d = $('#arx-search').value.trim();
        if (!d) { toast('先在输入框写下敌人/选手描述，再点 ➕ 加入'); return; }
        if (mode === 'me' && side === 'A') side = 'B'; // 玩家挑战：我方固定玩家，自定义一律进敌方
        const item = { n: d.length > 18 ? d.slice(0, 18) + '…' : d, tier: '自定义', src: { type: 'desc', d } };
        picked[side].push(item);
        renderPicked(side); updateHint();
        $('#arx-search').value = '';
        toast(`已加入${side === 'A' ? '红方' : '蓝方'}：${item.n}`);
    }

    /* ================== 选手数据卡收集 ================== */
    async function fighterCards(list, sideLabel) {
        const cards = [];
        for (const p of list) {
            if (p.src?.type === 'wb' || p.src?.type === 'wbraw') {
                const entries = await loadWorldbook();
                const hit = entries.find(e => e.name === (p.fullName || '') || e.name.includes(p.src.kw))
                    || entries.find(e => e.content && e.content.slice(0, 600).includes(p.src.kw));
                let raw = hit ? hit.content : '';
                if (!raw) { cards.push(`【${sideLabel}】${p.n}（世界书条目未找到，按其名与常识生成数据卡）`); continue; }
                cards.push(`【${sideLabel}】${p.n} — 世界书条目原文（如含 EJS 模板片段 <% %>, 变量定义就在原文内，按"壮年基准期"的完整战斗数据解读）：\n${raw.slice(0, 3800)}${p.note ? '\n（使用指引：' + p.note + '）' : ''}`);
            } else {
                cards.push(`【${sideLabel}】${p.n}（等阶参考: ${p.tier}）— 描述：${p.src?.d || p.desc || '（无，按名称常识生成）'}`);
            }
        }
        return cards;
    }

    /* ================== LLM 调用 ================== */
    async function llm(userText, opts = {}) {
        const a = { user_input: userText, ordered_prompts: ['user_input'], should_silence: true };
        if (opts.maxTokens) a.max_tokens = opts.maxTokens;
        let r;
        try {
            r = await generateRaw(a);
        } catch (e) {
            throw new Error('LLM 调用失败: ' + ((e && e.message) || e));
        }
        const text = (typeof r === 'string') ? r : (r?.text ?? r?.content ?? String(r ?? ''));
        if (!text || !text.trim()) throw new Error('LLM 返回为空（若开启了独立API/自定义接口请检查其可用性）');
        return text;
    }

    /* ================== 战力分析 ================== */
    async function doAnalyze() {
        if (!meInfo) { toast('未读到玩家构筑，无法分析', true); return; }
        setBusy(true, '战力分析中…', '正在评估构筑定位与强度');
        try {
            const t = await llm(
                '【伊瑟利亚竞技场·战力分析】你是伊瑟利亚大陆的战力评估师。基于以下玩家构筑数据，输出战力评估：\n' +
                '①定位与强度一句话总评（含等阶定位）②三项优势 ③两项短板/风险 ④推荐挑战档位（可稳赢的敌人等阶 / 旗鼓相当 / 不应对抗）⑤最多三条提升建议。\n' +
                '要求：分点、每点一行、合计 350 字以内；数值判断遵守位阶表（普通Lv1-4+0/×1.0、超凡+1/×1.2、精英+2/×1.5、史诗+3/×1.8、传说+4/×2.2、神话+5/×2.8）。禁止输出任何标签或变量块。\n\n' +
                '【玩家构筑】\n' + meInfo.text
            );
            renderReport([{
                title: '⚡ 战力分析 · ' + meInfo.name,
                body: t.trim(),
                open: true,
            }]);
            $('#arx-backBtn').style.display = '';
            switchResultView(true);
        } catch (e) {
            toast((e && e.message) || '分析失败', true);
        } finally { setBusy(false); }
    }

    /* ================== 开战 ================== */
    function buildBattlePrompt(sideAList, sideBList, cardsA, cardsB) {
        const isMe = mode === 'me';
        const nameA = isMe ? (meInfo ? meInfo.name + '（玩家）' : '玩家') : sideAList.map(p => p.n).join('、');
        const nameB = sideBList.map(p => p.n).join('、');
        return `【伊瑟利亚竞技场·场外模拟战斗】
你是伊瑟利亚大陆的战斗推演引擎。这是一场与玩家存档完全无关的竞技场模拟战，由你推演双方全部行动。请严格按以下规则与输出协议执行。

═══ 竞技场铁律 ═══
- 纯场外模拟：禁止输出 <UpdateVariable>、<思维链>、<content>、时空栏等任何卡内格式标签，只允许使用下方规定的三个输出标签。
- 所有掷骰必须写出算式（如 d20(14)+敏捷修正(+2)+位阶加成(+2)=18 vs 防御16 — 命中），禁止凭空宣布命中/失手/伤害。
- 双方均为数据卡驱动的单位，由你按其能力与性格合理推演行动；战斗结果必须由推演自然产生，不得预设偏向。

═══ 战斗轮规则（必须遵守）═══
1. 先攻：每名参战者投 d20+敏捷修正+位阶加成，从高到低行动；每轮每人一回合（移动+1动作+1附赠）。
2. 位阶表（检定加成/伤害倍率）：普通 +0/×1.0、超凡 +1/×1.2、精英 +2/×1.5、史诗 +3/×1.8、传说 +4/×2.2、神话 +5/×2.8。等级换算：普通Lv1-4/超凡5-8/精英9-12/史诗13-16/传说17-20/神话21-25。
3. 属性修正：属性值10-11→+0，每±2 →±1（如18-19→+4）。
4. 命中：d20+属性修正+位阶加成+其他修正 ≥ 目标防御值。自然20=暴击（伤害骰×2），自然1=自动失手。
5. 伤害 = (武器伤害骰+属性修正) × 部位倍率（躯干×1.0/头部×1.5但命中DC+4/四肢×0.8）× 位阶倍率；之后结算目标 弱点×2 / 抗性÷2 / 免疫=0。
6. 资源：武技/奥义耗SP、魔法/神术耗MP、普通攻击免费；HP归0=濒死倒地退出战斗；被拖入必死局（如濒死单位再受致命伤）即死亡。全体一侧无法战斗时战斗立即结束。
7. 机制怪：数据卡带 [机制|名：规程/触发/破解] 的单位，每轮必须核对机制状态（未触发/进行中/已破解/已触发）并在推演中写明；触发条件达成必须严格生效；被破解后永久失效。
8. 上限 12 轮：超限时按双方剩余 HP 总比例与场面态势判定胜负。
9. 多名角色同侧时按先攻序交错行动，注意队友配合（保护/集火/治疗）与站位常识。

═══ 输出协议（严格三段、顺序固定、缺一不可）═══
<构筑推演>
（内嵌思维链一：数据卡整理与战力对比。若选手没有完整数据卡，按其描述与等阶，参照位阶表与同类单位数值现场生成完整数据卡：[名称][等阶][等级][HP|当前|最大][防御值][属性六维][攻击|名|类型|命中修正|伤害骰|特效][能力][机制?][弱点/抗性/免疫?][奥义（史诗级以上必备）][权能（传说级以上必备）]，逐项写明推导理由。随后给出双方战力对比与胜负手分析，以及先攻预估。）
</构筑推演>
<战斗推演>
（内嵌思维链二：逐回合推演。先攻掷骰算式→按行动序逐人推演：行动选择逻辑（基于数据卡能力与当前态势）→每次攻击/施法的掷骰算式与命中判定→伤害计算全过程→HP扣减台账（名：旧值→新值）→机制状态核对。允许对重复普攻简写，但所有数值变化必须完整可追溯。）
</战斗推演>
<战报>
⚔️竞技场 ${isMe ? '挑战' : '对决'} 我方:[${nameA}] vs 敌方:[${nameB}]
（正式战报：以"【第N轮】"分节；每节 2-5 句生动的战斗叙事 + 结算行。结算行格式（每行一条，| 包裹）：
| 先攻: 名A(值) -> 名B(值) -> ... |
| 掷骰: d20(x)+修正(m)=y vs 防御 z — 命中/失手 |
| 伤害: (骰+修正)×部位×位阶=N（结算弱点/抗性后） |
| 状态变更: 名 HP 旧 -> 新 |
【战果】胜负判定 + 双方存活/倒下名单
【战后简评】1-2 句点评（MVP/转折点/险情））
</战报>

═══ 本场对阵 ═══
我方（红方）：${nameA}
敌方（蓝方）：${nameB}
${isMe ? '（我方玩家的行动同样由你推演，遵守其"战斗方式"倾向与技能配置；玩家构筑来自真实存档，但本场为模拟，放心全力推演。）' : ''}

═══ 选手数据 ═══
${cardsA.join('\n\n')}

${cardsB.join('\n\n')}

现在开始推演，严格按输出协议输出三段。`;
    }

    async function startBattle() {
        if (mode === 'me' && !meInfo) { toast('未读到玩家构筑，无法应战', true); return; }
        if (!picked.B.length) { toast('请先选择敌方选手', true); return; }
        if (mode !== 'me' && !picked.A.length) { toast('红方还没有选手', true); return; }
        const sideAList = mode === 'me' ? [] : picked.A.slice();
        setBusy(true, '推演中…', '生成数据卡 → 战力对比 → 逐回合推演，长战斗约 1~3 分钟');
        try {
            const cardsA = mode === 'me'
                ? [`【我方】${meInfo.name}（玩家构筑，等阶 ${meInfo.tier}）：\n${meInfo.text}`]
                : await fighterCards(sideAList, '我方/红方');
            const cardsB = await fighterCards(picked.B, mode === 'me' ? '敌方' : '蓝方');
            const prompt = buildBattlePrompt(sideAList, picked.B, cardsA, cardsB);
            const out = await llm(prompt);
            const seg = (tag) => { const m = out.match(new RegExp('<' + tag + '>[\\s\\S]*?</' + tag + '>', 'i')); return m ? m[0] : ''; };
            const buildTxt = seg('构筑推演');
            const simTxt = seg('战斗推演');
            const reportTxt = (out.match(/<战报>([\s\S]*?)<\/战报>/i) || ['', ''])[1].trim() || out.trim();
            const blocks = [];
            if (buildTxt) blocks.push({ title: '🧬 构筑推演（数据卡生成与战力对比）', body: buildTxt.replace(/<\/?构筑推演>/g, '').trim(), open: false });
            if (simTxt) blocks.push({ title: '🧠 战斗推演（逐回合掷骰推演）', body: simTxt.replace(/<\/?战斗推演>/g, '').trim(), open: false });
            blocks.push({ title: '📜 战报', raw: reportTxt, open: true });
            const key = 'iseria_arena_hist_' + Date.now();
            try {
                localStorage.setItem(key, JSON.stringify({ t: Date.now(), a: $('#arx-vsHint').textContent, build: buildTxt, sim: simTxt, report: reportTxt }));
                pruneHistory();
            } catch (e) {}
            renderReport(blocks, reportTxt);
            refreshHistory();
            $('#arx-backBtn').style.display = '';
            switchResultView(true);
        } catch (e) {
            toast((e && e.message) || '推演失败', true);
        } finally { setBusy(false); }
    }

    function pruneHistory() {
        try {
            const keys = Object.keys(localStorage).filter(k => k.startsWith('iseria_arena_hist_')).sort();
            while (keys.length > 5) localStorage.removeItem(keys.shift());
        } catch (e) {}
    }

    function refreshHistory() {
        const sel = $('#arx-histSel');
        const items = [];
        try {
            for (const k of Object.keys(localStorage)) {
                if (!k.startsWith('iseria_arena_hist_')) continue;
                try { items.push({ k, v: JSON.parse(localStorage.getItem(k)) }); } catch (e) {}
            }
        } catch (e) {}
        items.sort((x, y) => y.v.t - x.v.t);
        sel.innerHTML = '<option value="">📜 战斗记录…</option>' + items.map(it => {
            const d = new Date(it.v.t);
            const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
            return `<option value="${it.k}">${hh} ${esc((it.v.a || '').slice(0, 30))}</option>`;
        }).join('');
    }

    function loadHistory(key) {
        try {
            const v = JSON.parse(localStorage.getItem(key) || 'null');
            if (!v) return;
            const blocks = [];
            if (v.build) blocks.push({ title: '🧬 构筑推演', body: v.build.replace(/<\/?构筑推演>/g, '').trim(), open: false });
            if (v.sim) blocks.push({ title: '🧠 战斗推演', body: v.sim.replace(/<\/?战斗推演>/g, '').trim(), open: false });
            blocks.push({ title: '📜 战报', raw: v.report, open: true });
            renderReport(blocks, v.report);
            $('#arx-backBtn').style.display = '';
            switchResultView(true);
        } catch (e) {}
    }

    /* ================== 战报渲染 ================== */
    function renderReportRow(line) {
        const cls = /状态变更/.test(line) ? ' arx-hp' : (/掷骰|伤害/.test(line) ? ' arx-dice' : '');
        return `<span class="arx-row${cls}">${esc(line.trim())}</span>`;
    }

    function renderReportBody(report) {
        const lines = report.split('\n');
        const out = [];
        for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;
            if (/^⚔/.test(line)) { out.push(`<div class="arx-head">${esc(line)}</div>`); continue; }
            if (/^【第.+轮】?$/.test(line) || /^【第.+轮】/.test(line)) { out.push(`<div class="arx-round">${esc(line)}</div>`); continue; }
            if (/^【战果】/.test(line)) { out.push(`<div class="arx-verdict">${esc(line.replace(/^【战果】/, ''))}</div>`); continue; }
            if (/^【战后简评】/.test(line)) { out.push(`<div class="arx-tail">${esc(line)}</div>`); continue; }
            if (/^\|.*\|\s*$/.test(line)) { out.push(renderReportRow(line)); continue; }
            if (/^【.+】$/.test(line)) { out.push(`<div class="arx-round">${esc(line)}</div>`); continue; }
            out.push(`<div class="arx-para">${esc(line)}</div>`);
        }
        return out.join('');
    }

    function renderReport(blocks) {
        const box = $('#arx-result');
        box.innerHTML = '';
        for (const b of blocks) {
            const co = pdoc.createElement('div');
            co.className = 'arx-co' + (b.open ? ' open' : ' closed');
            co.innerHTML = `<div class="arx-co-h"><span class="arx-arrow">▼</span> ${esc(b.title)}</div><div class="arx-co-b"></div>`;
            const body = co.querySelector('.arx-co-b');
            if (b.raw != null) { body.id = 'arx-report'; body.innerHTML = renderReportBody(b.raw); }
            else body.textContent = b.body || '';
            co.querySelector('.arx-co-h').addEventListener('click', () => co.classList.toggle('closed'));
            box.appendChild(co);
        }
        box.scrollTop = 0;
    }

    function switchResultView(showResultView) {
        $('#arx-setup').style.display = showResultView ? 'none' : '';
        $('#arx-result').style.display = showResultView ? 'flex' : 'none';
        $('#arx-backBtn').style.display = showResultView ? '' : 'none';
    }

    /* ================== 模式切换 ================== */
    function setMode(m) {
        mode = m;
        $('#arx-tabDuel').classList.toggle('cur', m === 'duel');
        $('#arx-tabMe').classList.toggle('cur', m === 'me');
        $('#arx-analyzeBtn').style.display = m === 'me' ? '' : 'none';
        // 自定义按钮：斗蛐蛐=红/蓝各一个；玩家挑战=我方固定玩家，只有敌方
        $('#arx-customA').style.display = m === 'me' ? 'none' : '';
        $('#arx-customB').textContent = m === 'me' ? '➕ 敌方' : '➕ 蓝方';
        $('#arx-customB').title = m === 'me' ? '把输入框的文字作为自定义敌人加入敌方' : '把输入框的文字作为自定义选手加入蓝方';
        renderSideTitles();
        refreshMeCard();
        if (m === 'me') {
            // 玩家挑战：A 侧固定为玩家，隐藏 A 候补池的加人（候补点击全部进 B）
            picked.A = [];
        }
        renderPicked('A'); renderPicked('B'); renderPool('A'); renderPool('B'); updateHint();
        switchResultView(false);
    }

    /* ================== 忙碌遮罩 ================== */
    function setBusy(on, t, s) {
        $('#arx-busy').classList.toggle('show', !!on);
        if (t) $('#arxBusyT').textContent = t;
        if (s) $('#arxBusyS').textContent = s;
    }

    /* ================== 悬浮窗开关 / 拖动 ================== */
    function toggle(force) {
        const show = force !== undefined ? force : ov.style.display === 'none';
        if (show) {
            ov.classList.remove('dragging');
            ov.style.left = ''; ov.style.top = ''; ov.style.transform = '';
            ov.style.display = 'flex';
        } else {
            ov.style.display = 'none';
        }
    }

    // fab 拖动：Pointer Events 统一鼠标/触摸 + setPointerCapture——
    // 此前用 pdoc mousemove/mouseup，鼠标移入楼层内容 iframe 时 mouseup 被吞 → _fabDrag 卡 true → fab 永久跟随鼠标；
    // capture 后所有 pointer 事件定向派发到 fab，指针进入 iframe/离开窗口也不会丢 up
    let _fabDrag = false, _fabMoved = false, _fabX = 0, _fabY = 0, _fabOX = 0, _fabOY = 0, _fabMovedAt = 0;
    fab.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        _fabDrag = true; _fabMoved = false;
        const r = fab.getBoundingClientRect();
        _fabOX = e.clientX - r.left; _fabOY = e.clientY - r.top;
        _fabX = e.clientX; _fabY = e.clientY;
        try { fab.setPointerCapture(e.pointerId); } catch (err) {}
    });
    fab.addEventListener('pointermove', e => {
        if (!_fabDrag) return;
        if (!_fabMoved && Math.abs(e.clientX - _fabX) + Math.abs(e.clientY - _fabY) < 5) return;
        _fabMoved = true;
        fab.classList.add('dragging');
        fab.style.left = (e.clientX - _fabOX) + 'px';
        fab.style.top = (e.clientY - _fabOY) + 'px';
        fab.style.right = 'auto'; fab.style.bottom = 'auto';
        _fabX = e.clientX; _fabY = e.clientY;
    });
    function fabDragEnd() {
        if (!_fabDrag) return;
        fab.classList.remove('dragging');
        if (_fabMoved) {
            _fabMovedAt = Date.now();
            try {
                const r = fab.getBoundingClientRect();
                const fl = Math.min(pdoc.documentElement.clientWidth - 46, Math.max(0, r.left));
                const ft = Math.min(pdoc.documentElement.clientHeight - 46, Math.max(0, r.top));
                fab.style.left = fl + 'px'; fab.style.top = ft + 'px';
                localStorage.setItem('iseria_arena_fab_pos', JSON.stringify({ left: Math.round(fl), top: Math.round(ft) }));
            } catch (e) {}
        }
        _fabDrag = false;
    }
    fab.addEventListener('pointerup', fabDragEnd);
    fab.addEventListener('pointercancel', fabDragEnd);
    // 双保险：capture 事件冒泡兜底（target=fab 也冒泡到 pdoc）
    pdoc.addEventListener('pointerup', fabDragEnd);
    fab.addEventListener('click', () => {
        if (Date.now() - _fabMovedAt < 400) return;
        toggle();
    });

    // 窗口顶栏拖动：Pointer Events + setPointerCapture（同 fab，防 iframe 吞 up 导致窗口永久跟随鼠标）
    const topbar = $('#arx-topbar');
    let _winArmed = false, _winMoving = false, _wmx = 0, _wmy = 0, _winMovedAt = 0, _winPid = null;
    topbar.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.target.closest('#arx-closebtn, button, input, select')) return;
        if (pdoc.documentElement.clientWidth <= 786) return; // 手机端全屏锁定，无拖动
        _winArmed = true; _winMoving = false;
        _wmx = e.clientX; _wmy = e.clientY;
        _winPid = e.pointerId;
        try { topbar.setPointerCapture(e.pointerId); } catch (err) {}
    });
    topbar.addEventListener('pointermove', e => {
        if (!_winArmed || e.pointerId !== _winPid) return;
        const dx = e.clientX - _wmx, dy = e.clientY - _wmy;
        if (!_winMoving) {
            if (Math.abs(dx) + Math.abs(dy) < 6) return;
            _winMoving = true;
            const r0 = ov.getBoundingClientRect();
            ov.style.left = r0.left + 'px'; ov.style.top = r0.top + 'px';
            ov.style.transform = 'none';
            ov.classList.add('dragging');
        }
        const r = ov.getBoundingClientRect();
        const vw = pdoc.documentElement.clientWidth, vh = pdoc.documentElement.clientHeight;
        ov.style.left = Math.min(vw - 180, Math.max(180 - r.width, r.left + dx)) + 'px';
        ov.style.top = Math.min(vh - 50, Math.max(0, r.top + dy)) + 'px';
        _wmx = e.clientX; _wmy = e.clientY;
        e.preventDefault();
    });
    function winDragEnd(e) {
        if (!_winArmed) return;
        if (e && e.pointerId != null && e.pointerId !== _winPid) return;
        if (_winArmed && _winMoving) _winMovedAt = Date.now();
        _winArmed = false; _winMoving = false; _winPid = null;
        try { if (e && e.pointerId != null) topbar.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    topbar.addEventListener('pointerup', winDragEnd);
    topbar.addEventListener('pointercancel', winDragEnd);
    pdoc.addEventListener('pointerup', winDragEnd);

    /* ================== 接线 & 初始化 ================== */
    $('#arx-closebtn').addEventListener('click', () => toggle(false));
    pdoc.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.style.display !== 'none') toggle(false); });
    $('#arx-tabDuel').addEventListener('click', () => setMode('duel'));
    $('#arx-tabMe').addEventListener('click', () => setMode('me'));
    $('#arx-searchBtn').addEventListener('click', () => { doSearch(); });
    $('#arx-customA').addEventListener('click', () => addCustom('A'));
    $('#arx-customB').addEventListener('click', () => addCustom('B'));
    $('#arx-search').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    $('#arx-analyzeBtn').addEventListener('click', doAnalyze);
    $('#arx-startBtn').addEventListener('click', startBattle);
    $('#arx-backBtn').addEventListener('click', () => switchResultView(false));
    $('#arx-histSel').addEventListener('change', e => { if (e.target.value) loadHistory(e.target.value); });

    renderPool('A'); renderPool('B'); renderSideTitles(); refreshMeCard(); refreshHistory(); updateHint();
    // 恢复上次配置
    try {
        const last = JSON.parse(localStorage.getItem('iseria_arena_last') || 'null');
        if (last && last.mode) { setMode(last.mode); }
    } catch (e) {}
    try {
        setInterval(() => {
            try { localStorage.setItem('iseria_arena_last', JSON.stringify({ mode, a: picked.A.map(p => p.n), b: picked.B.map(p => p.n) })); } catch (e) {}
        }, 5000);
    } catch (e) {}
    console.info('[伊瑟利亚外链脚本] PVE竞技场 加载完成');
})();
