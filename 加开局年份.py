# -*- coding: utf-8 -*-
# 开局面板：自定义起始年份（默认1497，范围1400-1497）
# UI输入 + 提交覆写世界.日期 + 硬编码叙事年份动态化（JS串拼接/HTML挂span）
import io, sys, re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
p = '开局.html'
s = io.open(p, encoding='utf-8').read()
n0 = len(s)

# ── ① UI：开场白标题下加年份输入 ──
old_ui = '<div class="jrpg-opening-title">📖 选择开场白 · 命运的起点</div>'
new_ui = old_ui + '''
                    <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin:6px 0 10px;font-size:12px;color:#6b5433;">
                        <span>🕰️ 开局年份：</span>
                        <input type="number" id="iz-start-year" min="1400" max="1497" step="1" value="1497"
                               style="width:90px;padding:3px 6px;border:1px solid #8b6b4a;border-radius:6px;background:#fdf6e3;color:#3a2c15;font-weight:bold;"
                               onchange="izSaveStartYear(this.value)">
                        <span style="opacity:.8;">年（越早魔王降临越远，默认1497）</span>
                    </div>'''
assert old_ui in s, 'UI 锚点'
s = s.replace(old_ui, new_ui, 1)

# ── ② 助手函数（挂 applyOpeningPreset 定义前）──
helper = (
    "// ── 自定义开局年份（默认1497；写入 世界.日期 供 AI/纪元触发器遵守）──\n"
    "function izStartYear() {\n"
    "  try {\n"
    "    var v = parseInt(localStorage.getItem('iseria_start_year'), 10);\n"
    "    if (v >= 1400 && v <= 1497) return v;\n"
    "  } catch (e) {}\n"
    "  return 1497;\n"
    "}\n"
    "function izSaveStartYear(v) {\n"
    "  var n = parseInt(v, 10);\n"
    "  if (!(n >= 1400 && n <= 1497)) { n = 1497; var el = document.getElementById('iz-start-year'); if (el) el.value = 1497; }\n"
    "  try { localStorage.setItem('iseria_start_year', String(n)); } catch (e) {}\n"
    "  var sp = document.getElementById('iz-yr-longju');\n"
    "  if (sp) sp.textContent = izYearStr();\n"
    "  if (window.toastr) window.toastr.success('开局年份已设为 圣光历' + n + ' 年', '🕰️');\n"
    "}\n"
    "function izYearStr() { return '圣光历' + izStartYear() + '年'; }\n"
    "(function () { var sp = document.getElementById('iz-yr-longju'); if (sp) sp.textContent = izYearStr(); })();\n"
)
m = re.search(r'function\s+applyOpeningPreset\s*\(', s)
assert m, '函数定义未找到'
s = s[:m.start()] + helper + '\n' + s[m.start():]

# ── ③ 提交主写入点：世界.日期 覆写 ──
old_w = """mvuData.stat_data = stat;
                      Mvu.replaceMvuData(mvuData, { type: 'message', message_id: 'latest' });
                      console.log('✅ 已自动将角色数据写入 MVU 变量');"""
new_w = """                      mvuData.stat_data = stat;
                      try { if (mvuData.stat_data.世界) mvuData.stat_data.世界.日期 = izYearStr() + '1月1日'; } catch (e) {}
                      Mvu.replaceMvuData(mvuData, { type: 'message', message_id: 'latest' });
                      console.log('✅ 已自动将角色数据写入 MVU 变量（开局日期 ' + (mvuData.stat_data.世界 ? mvuData.stat_data.世界.日期 : '?') + '）');"""
assert old_w in s, '提交写入锚点'
s = s.replace(old_w, new_w, 1)

# ── ④ JS 字符串两处：拼接动态年份 ──
t1 = '卡兰蒂亚·梅萨利亚港 / 圣光历1497年。'
assert t1 in s, '裂隙门钥锚点'
s = s.replace(t1, "卡兰蒂亚·梅萨利亚港 / 圣光历' + izYearStr() + '年。", 1)

t2 = '然而圣光历1497年，龙脉异变骤起'
assert t2 in s, '龙裔叙事锚点'
s = s.replace(t2, "然而圣光历' + izYearStr() + '年，龙脉异变骤起", 1)

# ── ⑤ HTML 静态文本一处：挂 span（初始化与 onchange 时刷新）──
t3 = '<b>当前局势：</b>圣光历1497年，龙脉异变'
assert t3 in s, '当前局势锚点'
s = s.replace(t3, '<b>当前局势：</b><span id="iz-yr-longju">圣光历1497年</span>，龙脉异变', 1)

io.open(p, 'wb').write(s.encode('utf-8'))
print('开局年份功能完成：', n0, '→', len(s), '（动态叙事 2 处 + span 1 处 + UI + 提交覆写）')
