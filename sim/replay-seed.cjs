/* 一次性：重放 1-10 楼（行为表+seed回复），重建 state.json/chatlog.json
 * 用法: node sim/replay-seed.cjs
 */
const fs = require('fs');
const path = require('path');
const yaml = require('C:/Users/Administrator/Desktop/编写模板/node_modules/yaml');
const env = require('./env.cjs');
const mvu = require('./mvu.cjs');
const behavior = require('./behavior.cjs');

const SIM = __dirname;
const initial = yaml.parse(fs.readFileSync(path.join(SIM, '../../yiseliya/dist/伊瑟利亚/初始变量'), 'utf8'));
env.initEnv(initial);
mvu.registerMvuSchema(env.getRegisteredSchema());
env.setApplier({
  extractCommands: m => mvu.extractCommands(m),
  applyCommands: (s, c) => mvu.applyCommands(s, c)
});

// 1-10 楼代答回复（<UpdateVariable> 块）
const REPLIES = {
  1: '清晨的冷雾贴着地面流淌。你在一条车辙纵横的官道旁睁开眼，头顶是罕见的晴空——远处一座石桥横跨河谷，桥那头炊烟袅袅，木牌上依稀可辨「石桥镇」三个字。你摸了摸身上：衣物完好，却想不起自己为何在此。桥头的老柳树下，一个赶早集的菜农正打量你，见你醒来，远远喊道："喂！那边的，活着就搭个伴，顺便告诉我你是不是也从北边逃难来的？"\n\n<UpdateVariable><Analysis>主角于石桥镇郊外官道旁醒来，更新位置信息</Analysis><JSONPatch>[{"op":"replace","path":"/世界/当前地点","value":"石桥镇郊外"},{"op":"replace","path":"/世界/当前位置","value":"石桥镇郊外·官道旁"}]</JSONPatch></UpdateVariable>',
  2: '菜农姓周，赶着骡车，你搭他的车进了石桥镇。镇子不大，青石板路两侧是铁匠铺、杂货铺和一间冒着麦香的面包房，集市街上人声渐沸。周老汉指了指街角那栋挂着木牌的建筑："要去打听消息，就去那儿——冒险者公会。"你谢过他，站在公会门口，门里传出骰子落桌和粗豪的谈笑声。\n\n<UpdateVariable><Analysis>主角随周老汉进入石桥镇，更新位置</Analysis><JSONPatch>[{"op":"replace","path":"/世界/当前地点","value":"石桥镇"},{"op":"replace","path":"/世界/当前位置","value":"石桥镇·冒险者公会门口"}]</JSONPatch></UpdateVariable>',
  3: '集市的热闹里裹着不安。你沿街慢慢走，听见几拨旅人都在议论同一件事：北境平原入秋以来魔物游荡得厉害，几支采药队被打散了，公会的清剿委托挂了半个月没人敢接。"听说是一群野狼，领头的不知是何物，"一个满脸风霜的猎人压低声音，"寻常狼可不敢那么靠近官道。"你把这话记在心里，顺手在杂货铺前看了看行囊——你身无分文，看来得先想办法挣一口饭钱。\n\n<UpdateVariable><Analysis>情报收集，无数值变动</Analysis><JSONPatch>[]</JSONPatch></UpdateVariable>',
  4: '公会里人声鼎沸。委托板上，一张泛黄的告示赫然在列：【清剿委托·北境平原魔物】清剿游荡魔物，报酬50金盾。接待你的是公会接待员玛尔塔——四十来岁，眼神精明："新人？连职业登记都没有的散人也敢接清剿委托？"她把登记表推到你面前。\n\n<UpdateVariable><Analysis>收录重要NPC玛尔塔</Analysis><JSONPatch>[{"op":"insert","path":"/主要NPC/玛尔塔","value":{"好感度":10,"心里话":"又一个不要命的新人。","出生年月日":"圣光历1462年11月3日","身份":"冒险者公会接待员","当前位置":"石桥镇·冒险者公会","关键事件":"初次登记","关系描述":"公会的接待员，说话刻薄但办事利索。","关系时间线":[{"时间":"圣光历1497年1月1日","事件":"主角初到公会，登记接取北境清剿委托。"}],"关系分类":"初识"}}]</JSONPatch></UpdateVariable>',
  5: '你按了手印，玛尔塔撕下一联委托回执拍在柜台上，顺手指向墙上的职业登记栏："北境的狼群不讲情面，找个营生护身吧。"走出公会，你在委托板上多看了一眼：悬赏一位走失的采药人，最后现身的地点写着：北境平原·猎户小径。\n\n<UpdateVariable><Analysis>接取清剿委托</Analysis><JSONPatch>[{"op":"insert","path":"/主角/任务/清剿北境魔物","value":{"等级":"普通","类型":"讨伐","来源":"冒险者公会","内容":"清剿北境平原游荡的魔物","预估报酬":"50金盾","状态":"进行中"}}]</JSONPatch></UpdateVariable>',
  6: '身无分文是眼下最实际的问题。你在药房门口徘徊片刻，掌柜的看出了你的窘迫："想赊账？"他摇摇头，"东头的粮行要人手卸货，一上午三十铜盾，干完活再来抓药。"你接过单子。铜盾的分量在掌心微凉，这是你在这个世界挣到的第一笔钱。\n\n<UpdateVariable><Analysis>卸货挣得30铜盾</Analysis><JSONPatch>[{"op":"delta","path":"/主角/资产与能力/货币","value":30}]</JSONPatch></UpdateVariable>',
  7: '翌日清晨，你背起简单的行囊踏上北去的土路。石桥镇在身后渐渐缩成一点炊烟，田野尽头，北境平原的荒草已在秋色里泛黄。风里有股若有若无的腥气——越往北走，路边的痕迹越不对劲：被撕碎的布料、半枚踩进泥里的银盾、还有一串大得反常的爪印。你握紧了从铁匠铺借来的旧铁剑，黄昏时分，找到了一处可以背靠岩壁扎营的高地。\n\n<UpdateVariable><Analysis>抵达北境边缘</Analysis><JSONPatch>[{"op":"replace","path":"/世界/当前地点","value":"北境平原"},{"op":"replace","path":"/世界/当前位置","value":"北境平原·荒原边缘高地"}]</JSONPatch></UpdateVariable>',
  8: '后半夜，狼嚎起了。火堆骤暗，六对绿眼睛从荒草里围拢过来——五头灰狼，领头那头体型大出两圈，双眼泛着暗红。狼群包抄而上！你拔剑迎着头狼先发制人，剑锋劈中它的肩胛。负痛的头狼暴怒反扑，你侧身闪过，顺势一剑刺穿了一头灰狼咽喉。\n\n<UpdateVariable><Analysis>击杀灰狼×1（经验模板35）；敌人面板建立</Analysis><JSONPatch>[{"op":"insert","path":"/敌人/野狼头目","value":{"等级":4,"等阶":"普通","生命骰":"3d10+3","HP当前":17,"HP最大":30,"防御":13,"攻击":[{"名称":"噬咬","类型":"近战","命中":5,"伤害":"2d6+2"}],"特殊":"暗红双眼：夜晚命中+2","经验值":80,"已击败":false}},{"op":"insert","path":"/敌人/灰狼","value":{"等级":2,"等阶":"普通","生命骰":"1d10+1","HP当前":0,"HP最大":9,"防御":11,"攻击":[{"名称":"撕咬","类型":"近战","命中":3,"伤害":"1d6+1"}],"经验值":35,"已击败":true}},{"op":"replace","path":"/主角/基础状态/经验值/基础获取","value":35}]</JSONPatch></UpdateVariable>',
  9: '狼群的试探越来越急。你背抵岩壁，趁着头狼绕后的空当猛然转身，一记蓄力斩劈翻了第二头灰狼。头狼终于按捺不住，从正面高高跃起直取你的咽喉！你矮身避过，肩头还是被利爪撕开一道血口。\n\n<UpdateVariable><Analysis>击杀灰狼×1（经验35）；HP-3</Analysis><JSONPatch>[{"op":"delta","path":"/主角/基础状态/HP/当前","value":-3},{"op":"replace","path":"/主角/基础状态/经验值/基础获取","value":35}]</JSONPatch></UpdateVariable>',
  10: '头狼第三次扑来时，你迎着利爪欺身而进，将整柄铁剑送进它的心口。头狼轰然倒地，残余的灰狼哀鸣而逃。你动手剥下头狼毛皮——这够换一笔像样的报酬。天边泛起鱼肚白。\n\n<UpdateVariable><Analysis>头狼被击杀（经验80）；获得头狼毛皮；日期推进</Analysis><JSONPatch>[{"op":"replace","path":"/敌人/野狼头目/HP当前","value":0},{"op":"replace","path":"/敌人/野狼头目/已击败","value":true},{"op":"replace","path":"/主角/基础状态/经验值/基础获取","value":80},{"op":"insert","path":"/主角/资产与能力/物品栏/头狼毛皮","value":{"物品大类":"材料","品阶":"普通","数量":1}},{"op":"replace","path":"/世界/日期","value":"圣光历1497年1月2日"},{"op":"replace","path":"/世界/时间","value":"清晨"}]</JSONPatch></UpdateVariable>'
};

(async () => {
  await new Promise(r => setTimeout(r, 400));
  await env.eventEmit('CHAT_CHANGED', 0);
  for (let floor = 1; floor <= 10; floor++) {
    const action = behavior[floor - 1];
    const reply = REPLIES[floor];
    env.chatLog.push({ role: 'user', message: action.text });
    env.chatLog.push({ role: 'assistant', message: reply });
    const beforeStat = env.getAllVariables().stat_data;
    await env.Mvu.__driveUpdate(env.variables.chat, beforeStat, reply);
    env.variables.message[floor] = JSON.parse(JSON.stringify(env.variables.chat));
    console.log('重放楼' + floor + ' stat=' + Buffer.byteLength(JSON.stringify(env.variables.chat)) + 'B');
  }
  fs.writeFileSync(path.join(SIM, 'state.json'), JSON.stringify(env.variables.chat));
  fs.writeFileSync(path.join(SIM, 'chatlog.json'), JSON.stringify(env.chatLog));
  console.log('state.json / chatlog.json 已重建。货币=' + env.variables.chat.主角.资产与能力.货币 + ' 经验=' + env.variables.chat.主角.基础状态.经验值.当前 + ' 流水=' + Object.keys(env.variables.chat.世界.追踪记录).length);
})();
