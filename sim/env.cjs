/* 伊瑟利亚 · 百楼模拟器 —— 酒馆/酒馆助手 无头环境桩
 * 提供：事件总线、Mvu 桩（chat级+message级双层变量）、酒馆助手接口桩、
 *       真实脚本加载器、状态栏守卫函数提取、 toastr/console 收集。
 */
const fs = require('fs');
const path = require('path');
const _ = require('C:/Users/Administrator/Desktop/编写模板/node_modules/lodash');
const zodPkg = require('C:/Users/Administrator/Desktop/编写模板/node_modules/zod');

const ISERIA_ROOT = path.join(__dirname, '..');
const YISELIYA = path.join(ISERIA_ROOT, '..', 'yiseliya');
const NODE_MODS = 'C:/Users/Administrator/Desktop/编写模板/node_modules';

// ---------- 事件总线 ----------
const bus = {};
function eventOn(ev, fn) { (bus[ev] = bus[ev] || []).push(fn); return { off: () => {} }; }
function eventOnce(ev, fn) { return eventOn(ev, fn); }
async function eventEmit(ev) {
  const args = Array.prototype.slice.call(arguments, 1);
  for (const fn of (bus[ev] || []).slice()) {
    try { await fn.apply(null, args); } catch (e) { envLog('error', '[总线] ' + ev + ' 处理器异常: ' + e.message); }
  }
}
function hasListener(ev) { return (bus[ev] || []).length > 0; }

// ---------- 收集器（指标用） ----------
const collected = { toastr: [], zodErrors: [], scriptWarnings: [], consoleErrors: [] };
function envLog(level, msg) {
  const line = String(msg || '');
  if (level === 'warn') collected.scriptWarnings.push(line);
  if (level === 'error') collected.consoleErrors.push(line);
}

// ---------- 变量层（chat 级实时 + message 级楼层快照） ----------
const variables = { chat: null, message: {} };   // message[floor] = klona(stat_data)

// ---------- 酒馆事件常量 ----------
const tavern_events = {
  CHAT_COMPLETION_PROMPT_READY: 'CHAT_COMPLETION_PROMPT_READY',
  CHAT_CHANGED: 'CHAT_CHANGED',
  MESSAGE_SENT: 'MESSAGE_SENT',
  MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
  MESSAGE_UPDATED: 'MESSAGE_UPDATED',
  GENERATION_STARTED: 'GENERATION_STARTED',
  GENERATION_ENDED: 'GENERATION_ENDED',
  GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS'
};
const MvuEvents = {
  VARIABLE_INITIALIZED: 'mag_variable_initialized',
  VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
  COMMAND_PARSED: 'mag_command_parsed',
  VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended',
  BEFORE_MESSAGE_UPDATE: 'mag_before_message_update'
};

// ---------- 聊天数据（模拟楼层） ----------
const chatLog = [];   // {floor, role:'user'|'assistant', message}
function getChatMessages(floor) {
  if (floor === 'latest' || floor === -1) return chatLog.length ? [chatLog[chatLog.length - 1]] : [];
  return [chatLog[floor]].filter(Boolean);
}
function getLastMessageId() { return chatLog.length - 1; }

// ---------- 世界书（真实 3.6 JSON） ----------
let worldbook = null;
function loadWorldbook() {
  if (worldbook) return worldbook;
  const raw = JSON.parse(fs.readFileSync(path.join(YISELIYA, 'dist/伊瑟利亚/核心/伊瑟利亚.json'), 'utf8'));
  worldbook = Object.keys(raw.entries).map(k => raw.entries[k]);
  return worldbook;
}
async function getWorldbook(name) {
  const wb = loadWorldbook();
  if (!name || name === '伊瑟利亚3.4' || name === '伊瑟利亚大陆3.6' || name === '伊瑟利亚') {
    // 映射为 TavernHelper getWorldbook 的 WorldbookEntry 形态（name/enabled/content 等）
    return wb.map(e => ({
      uid: e.uid,
      name: e.comment || '',
      enabled: !e.disable,
      content: e.content,
      constant: !!e.constant,
      position: e.position,
      order: e.order,
      depth: e.depth,
      keys: e.key || []
    }));
  }
  throw new Error('世界书不存在: ' + name);
}
function getWorldbookNames() { return ['伊瑟利亚3.4']; }

// ---------- 全局变量接口 ----------
function getAllVariables() { return { stat_data: _.cloneDeep(variables.chat) }; }
function getVariables(opts) {
  if (opts && opts.type === 'message') {
    const f = opts.message_id === 'latest' ? getLastMessageId() : opts.message_id;
    return { stat_data: _.cloneDeep(variables.message[f] || variables.chat) };
  }
  return { stat_data: _.cloneDeep(variables.chat) };
}
function replaceVariables(vars, opts) {
  if (opts && opts.type === 'message') {
    const f = opts.message_id === 'latest' ? getLastMessageId() : opts.message_id;
    variables.message[f] = _.cloneDeep(vars.stat_data);
  } else {
    variables.chat = _.cloneDeep(vars.stat_data);
  }
  return true;
}
function insertOrAssignVariables(payload, opts) {
  // 聊天级合并（读档存档槽等用法）
  Object.assign(variables.chat, _.cloneDeep(payload));
  return Promise.resolve(true);
}
function updateVariablesWith(fn, opts) {
  const vars = opts && opts.type === 'message'
    ? { stat_data: _.cloneDeep(variables.message[getLastMessageId()] || variables.chat) }
    : { stat_data: _.cloneDeep(variables.chat) };
  const out = fn(vars);
  return Promise.resolve(replaceVariables(out || vars, opts || {}));
}

// ---------- Mvu 桩（applier 由 mvu.cjs 注入） ----------
let applierRef = null;   // { applyCommands(statData, commands, message) -> {commands, applied} }
let registeredSchema = null;   // 变量结构脚本经 registerMvuSchema 注册的 zod schema
function registerMvuSchema(schema) { registeredSchema = schema; }
function getRegisteredSchema() { return registeredSchema; }
const Mvu = {
  events: MvuEvents,
  getMvuData(opts) {
    if (opts && opts.type === 'message') {
      const f = opts.message_id === 'latest' ? getLastMessageId() : opts.message_id;
      return { initialized_lorebooks: {}, stat_data: _.cloneDeep(variables.message[f] || variables.chat) };
    }
    return { initialized_lorebooks: {}, stat_data: _.cloneDeep(variables.chat) };
  },
  replaceMvuData(data, opts) {
    replaceVariables(data, opts);
    return Promise.resolve(true);
  },
  setMvuVariable(data, p, v) { _.set(data.stat_data, p, v); return Promise.resolve(data); },
  getMvuVariable(data, p) { return Promise.resolve(_.get(data.stat_data, p)); },
  parseMessage(message, oldData) {
    return Promise.resolve(applierRef.parseMessageToData(message, _.cloneDeep(oldData.stat_data)));
  },
  isDuringExtraAnalysis() { return false; },
  // 供 run.cjs 驱动一轮真实更新管线
  __driveUpdate(newStat, beforeStat, aiMessage) {
    return driveUpdate(newStat, beforeStat, aiMessage);
  }
};

// 一轮真实更新管线：STARTED → COMMAND_PARSED(真实守卫) → 逐条应用+zod → ENDED
async function driveUpdate(newStat, beforeStat, aiMessage) {
  await eventEmit(MvuEvents.VARIABLE_UPDATE_STARTED, { stat_data: newStat });
  const commands = applierRef ? applierRef.extractCommands(aiMessage) : [];
  // COMMAND_PARSED：真实守卫（变量, 命令, 消息）——状态栏过滤器 + 升级脚本点数闸
  await eventEmit(MvuEvents.COMMAND_PARSED, { stat_data: newStat }, commands, aiMessage || '');
  const result = applierRef.applyCommands(newStat, commands);
  collected.zodErrors.push(...result.errors);
  await eventEmit(MvuEvents.VARIABLE_UPDATE_ENDED, { stat_data: newStat }, { stat_data: _.cloneDeep(beforeStat) });
  return result;
}

// ---------- toastr / console 桥 ----------
const toastr = {
  success(m, t) { collected.toastr.push('[成功] ' + (t ? t + '：' : '') + m); },
  info(m, t) { collected.toastr.push('[信息] ' + (t ? t + '：' : '') + m); },
  warning(m, t) { collected.toastr.push('[警告] ' + (t ? t + '：' : '') + m); collected.scriptWarnings.push((t ? t + '：' : '') + m); },
  error(m, t) { collected.toastr.push('[错误] ' + (t ? t + '：' : '') + m); collected.scriptWarnings.push((t ? t + '：' : '') + m); }
};

// ---------- 注入捕获 ----------
const injections = [];   // 下一楼可被 AI 看到的注入（position !== 'none'）
let transientInjections = [];  // 本轮 PROMPT_READY 注入（意图器 push 的直接进 chat，无需在此处理）
function injectPrompts(list, opts) {
  for (const p of (list || [])) {
    injections.push({ id: p.id, position: p.position, depth: p.depth, role: p.role, content: p.content, should_scan: p.should_scan });
  }
  return Promise.resolve();
}

// ---------- 其他酒馆助手接口桩 ----------
const localStorageMap = {};
const localStorage = {
  getItem: k => (k in localStorageMap ? localStorageMap[k] : null),
  setItem: (k, v) => { localStorageMap[k] = String(v); },
  removeItem: k => { delete localStorageMap[k]; }
};
const scriptButtons = [];
function getScriptButtons() { return scriptButtons; }
function replaceScriptButtons(list) { scriptButtons.length = 0; (list || []).forEach(b => scriptButtons.push(b)); }
function getButtonEvent(name) { return '按钮事件:' + name; }
function initializeGlobal() {}
function waitGlobalInitialized() { return Promise.resolve(); }
function errorCatched(fn) { return function () { try { const r = fn.apply(this, arguments); if (r && r.catch) r.catch(e => envLog('error', '[errorCatched] ' + e.message)); return r; } catch (e) { envLog('error', '[errorCatched] ' + e.message); } }; }
function generateRaw() { return Promise.resolve('（模拟器无附属生成）'); }
function getIframeName() { return 'sim'; }
function getScriptId() { return 'sim'; }
function triggerSlash() { return Promise.resolve(''); }
function createChatMessages(msgs) { for (const m of (msgs || [])) chatLog.push({ role: 'system', message: m.message }); return Promise.resolve(); }
const $ = function (fn) { if (typeof fn === 'function') setTimeout(fn, 0); return $; };
$.fn = {};

// ---------- 真实脚本加载 ----------
function loadScript(relPath) {
  const file = path.join(ISERIA_ROOT, relPath);
  const code = fs.readFileSync(file, 'utf8');
  // 剥掉顶层 ESM import（具名/默认/裸导入，凡指向 URL 的都去掉）
  const cleaned = code.replace(/^\s*import\s+(?:[\s\S]*?from\s*)?['"]https?:\/\/[^'"]+['"];?\s*$/gm, '');
  // 顶层 await 包装为 async IIFE（酒馆脚本是模块环境；统一包装对无 await 的脚本也无害）
  const wrapped = '(async () => {\n' + cleaned + '\n})();';
  eval(wrapped);
  return true;
}
function loadStatusbarGuards() {
  const html = fs.readFileSync(path.join(ISERIA_ROOT, '状态栏.html'), 'utf8');
  function extractFn(name) {
    const idx = html.indexOf('function ' + name + '(');
    if (idx === -1) throw new Error('状态栏未找到函数: ' + name);
    let i = html.indexOf('{', idx), depth = 0, j = i;
    for (; j < html.length; j++) {
      if (html[j] === '{') depth++;
      else if (html[j] === '}') { depth--; if (depth === 0) break; }
    }
    return html.slice(idx, j + 1);
  }
  const names = ['pathToSegments', 'famBirthFromAge', 'filterProtagonistReadonlyCommands', 'filterTrackRecordCommands',
    'filterFamilyIndustryCommands', 'normalizeNpcNameCommands', 'filterImmutableNpcFields',
    'filterExperienceConfirmCommands', 'filterLockedCompanionCommands'];
  const code = names.map(extractFn).join('\n');
  eval(code);
  // 注册到 COMMAND_PARSED（与状态栏注册顺序一致）
  eventOn(MvuEvents.COMMAND_PARSED, filterLockedCompanionCommands);
  eventOn(MvuEvents.COMMAND_PARSED, filterTrackRecordCommands);
  eventOn(MvuEvents.COMMAND_PARSED, filterFamilyIndustryCommands);
  eventOn(MvuEvents.COMMAND_PARSED, normalizeNpcNameCommands);
  eventOn(MvuEvents.COMMAND_PARSED, filterImmutableNpcFields);
  eventOn(MvuEvents.COMMAND_PARSED, filterProtagonistReadonlyCommands);
  eventOn(MvuEvents.COMMAND_PARSED, filterExperienceConfirmCommands);
  return names.length;
}

// ---------- 初始化 ----------
function initEnv(initialStatData) {
  global.eventOn = eventOn;
  global.eventOnce = eventOnce;
  global.eventEmit = eventEmit;
  global.eventOnButton = eventOn;
  global.tavern_events = tavern_events;
  global.Mvu = Mvu;
  global._ = _;
  global.toastr = toastr;
  global.localStorage = localStorage;
  global.getChatMessages = getChatMessages;
  global.getLastMessageId = getLastMessageId;
  global.getWorldbook = getWorldbook;
  global.getWorldbookNames = getWorldbookNames;
  global.getAllVariables = getAllVariables;
  global.getVariables = getVariables;
  global.replaceVariables = replaceVariables;
  global.insertOrAssignVariables = insertOrAssignVariables;
  global.updateVariablesWith = updateVariablesWith;
  global.injectPrompts = injectPrompts;
  global.getScriptButtons = getScriptButtons;
  global.replaceScriptButtons = replaceScriptButtons;
  global.getButtonEvent = getButtonEvent;
  global.initializeGlobal = initializeGlobal;
  global.waitGlobalInitialized = waitGlobalInitialized;
  global.errorCatched = errorCatched;
  global.generateRaw = generateRaw;
  global.getIframeName = getIframeName;
  global.getScriptId = getScriptId;
  global.triggerSlash = triggerSlash;
  global.createChatMessages = createChatMessages;
  global.$ = $;
  global.registerMvuSchema = registerMvuSchema;
  global.z = zodPkg.z || zodPkg;   // 酒馆注入全局：zod（变量结构脚本依赖）
  global.window = global;
  // console 桥（收集警告）
  const origWarn = console.warn.bind(console), origError = console.error.bind(console), origInfo = console.info.bind(console), origLog = console.log.bind(console);
  console.warn = function () { const s = Array.prototype.map.call(arguments, x => (typeof x === 'string' ? x : (x && x.message) || JSON.stringify(x))).join(' '); envLog('warn', s); origWarn(s); };
  console.error = function () { const s = Array.prototype.map.call(arguments, x => (typeof x === 'string' ? x : (x && x.message) || JSON.stringify(x))).join(' '); envLog('error', s); origError(s); };
  console.info = function () { const s = Array.prototype.map.call(arguments, x => (typeof x === 'string' ? x : '')).join(' '); origInfo(s); };
  console.log = function () { origLog.apply(null, arguments); };

  variables.chat = _.cloneDeep(initialStatData);
  variables.message[0] = _.cloneDeep(initialStatData);

  // 加载真实脚本（顺序=卡内加载顺序）
  loadScript('scripts/变量结构脚本.js');
  loadScript('scripts/变量注入脚本.js');
  loadScript('scripts/紧张度.js');
  loadScript('scripts/自动升级脚本.js');
  loadScript('scripts/产业结算脚本.js');
  loadScript('scripts/意图预判注入器.js');
  const guardCount = loadStatusbarGuards();
  console.log('[env] 真实脚本已加载（6个）+ 状态栏守卫 ' + guardCount + ' 个');
}

module.exports = {
  bus, eventOn, eventEmit, hasListener, collected, variables, tavern_events, MvuEvents,
  getChatMessages, getLastMessageId, chatLog, loadWorldbook, getWorldbook,
  getAllVariables, getVariables, replaceVariables, updateVariablesWith, Mvu,
  toastr, injections, initEnv, loadScript, loadStatusbarGuards, envLog,
  getRegisteredSchema, setApplier: fn => { applierRef = fn; }, driveUpdate, _
};
