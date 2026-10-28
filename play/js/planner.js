/* planner.js -- 文字 -> 生成计划（关键词规则引擎，纯函数，不依赖 DOM / three.js）。
 *
 * 四个规则档位（config.js 里有中文说明）：
 *   1  原版关键词：逐字照搬项目原来 index.html 里的离线关键词引擎（整句匹配物体词，不管方位和数量）
 *   2  + 分句和数量：按逗号 / “和”分句，最长匹配物体词，读出数量、大小、颜色
 *   3  + 方位：再读出 北边 / 东南角 / 中间 等方位词
 *   4  + 相对位置：再读出 “山下 / 湖边 / 周围” 这类相对位置，把物体放到被参照物体附近
 *
 * 输出的计划格式与原版一致：[{type, count, area, color, scale, parts}]，另附每一步的“理解过程”
 * （tokens / notes），给右栏的理解面板用。浏览器里挂在 window.TTW_PLANNER，Node 里 module.exports。
 */
(function (root) {
  'use strict';

  // ---------- 颜色（与原版 index.html 的 NAMED / col() 完全相同） ----------
  var NAMED = {
    red: '#e2574c', blue: '#3b8bd4', green: '#5aab5a', yellow: '#f2c037', white: '#f4f4ee',
    black: '#33342f', pink: '#e985a6', purple: '#8e7cc3', orange: '#ef8b2c', brown: '#8a5a3b',
    gray: '#9aa0a6', grey: '#9aa0a6', teal: '#1d9e75', gold: '#d6a93a', lava: '#ff5a2c',
    '红': '#e2574c', '蓝': '#3b8bd4', '绿': '#5aab5a', '黄': '#f2c037', '白': '#f4f4ee', '黑': '#33342f',
    '粉': '#e985a6', '紫': '#8e7cc3', '橙': '#ef8b2c', '棕': '#8a5a3b', '褐': '#8a5a3b', '灰': '#9aa0a6',
    '青': '#1d9e75', '金': '#d6a93a'
  };
  function col(c, def) {
    if (!c) return def; c = ('' + c).trim();
    if (c[0] === '#') return c; var k = c.toLowerCase();
    if (NAMED[k]) return NAMED[k];
    for (var i = 0; i < c.length; i++) { if (NAMED[c[i]]) return NAMED[c[i]]; }
    return def;
  }

  // 火山：原版用 custom 图元拼出来的（3 个圆锥）
  var VOLCANO_PARTS = [
    { shape: 'cone', color: '#8a5a3b', size: [5, 6], pos: [0, 0, 0] },
    { shape: 'cone', color: '#5a352e', size: [2, 1.4], pos: [0, 5.2, 0] },
    { shape: 'cone', color: '#ff5a2c', size: [1.1, 1.6], pos: [0, 5.8, 0] }];
  function volcano() { return { type: 'custom', key: 'volcano', count: 1, parts: JSON.parse(JSON.stringify(VOLCANO_PARTS)) }; }

  // ---------- 档位 1：原版关键词引擎（顺序、正则、默认数量都照搬原版） ----------
  var KW = [
    [/火山|volcano/i, function () { return volcano(); }],
    [/森林|树林|forest|trees/i, function () { return { type: 'tree', count: 10 }; }],
    [/树|tree/i, function () { return { type: 'tree', count: 3 }; }],
    [/城堡|塔|tower|castle/i, function () { return { type: 'tower', count: 1 }; }],
    [/房|屋|家|house|home|cabin/i, function () { return { type: 'house', count: 1 }; }],
    [/雪山|高山|山脉|山|mountain|hill/i, function () { return { type: 'mountain', count: 1 }; }],
    [/湖|池|河|海|水|lake|pond|water|river|sea/i, function () { return { type: 'water', count: 1 }; }],
    [/石|岩|rock|stone/i, function () { return { type: 'rock', count: 4 }; }],
    [/花|flower/i, function () { return { type: 'flower', count: 8 }; }],
    [/人|person|people/i, function () { return { type: 'person', count: 2 }; }],
    [/球|sphere|ball/i, function () { return { type: 'sphere', count: 2 }; }],
    [/箱|盒|方块|box|cube/i, function () { return { type: 'box', count: 3 }; }]
  ];
  var FALLBACK_TYPES = ['box', 'sphere', 'cylinder', 'cone'];

  function planLevel1(text, rng) {
    var plan = [], tokens = [], notes = [];
    KW.forEach(function (kv) {
      var re = kv[0], m = re.exec(text);
      if (!m) return;
      var o = kv[1]();
      if (o.type !== 'custom') o.color = col(text, null);
      plan.push(o);
      // 面板用：把整句里所有命中位置都标出来
      var g = new RegExp(re.source, 'gi'), mm;
      while ((mm = g.exec(text))) tokens.push({ s: mm.index, e: mm.index + mm[0].length, role: 'object', value: typeName(o) });
    });
    if (!plan.length) {
      var t = FALLBACK_TYPES[Math.floor(rng() * 4)];
      plan.push({ type: t, count: 4 });
      notes.push('整句没有认得的物体词，随机放 4 个“' + TYPE_NAMES[t] + '”占位');
    }
    notes.unshift('原版做法：只看整句里出现了哪些物体词；同一类词只算一次；方位、数量都不管，位置随机');
    return { plan: plan, tokens: dedupeTokens(tokens), clauses: [{ s: 0, e: text.length }], notes: notes };
  }

  // ---------- 档位 2–4：分句规则引擎 ----------
  // 词表：longest-match，越长越优先（“火山”胜过“山”，“树林”胜过“树”）
  // count = 没写数量时的默认个数（与原版一致）；group = “一片 / 一群 / 很多”时的个数
  var LEX = [
    { w: ['火山', 'volcano'], type: 'custom', key: 'volcano', count: 1, group: 2 },
    { w: ['森林', '树林', '林子', 'forest', 'woods', 'trees'], type: 'tree', count: 10, group: 10, forest: true },
    { w: ['松树', '大树', '树', 'tree'], type: 'tree', count: 3, group: 8 },
    { w: ['城堡', '灯塔', '钟楼', '高塔', '塔', 'tower', 'castle'], type: 'tower', count: 1, group: 3 },
    { w: ['村庄', '村子', '小镇'], type: 'house', count: 5, group: 6, village: true },
    { w: ['房子', '房屋', '小屋', '木屋', '房', '屋', '家', 'house', 'home', 'cabin'], type: 'house', count: 1, group: 5 },
    { w: ['雪山', '高山', '山脉', '山峰', '山丘', '山', 'mountain', 'hill'], type: 'mountain', count: 1, group: 3 },
    { w: ['湖泊', '湖', '池塘', '水池', '池', '小河', '河流', '河', '大海', '海', '水', 'lake', 'pond', 'water', 'river', 'sea'], type: 'water', count: 1, group: 3 },
    { w: ['石头', '岩石', '石', '岩', 'rock', 'stone'], type: 'rock', count: 4, group: 8 },
    { w: ['花海', '花丛', '花园', '鲜花', '花', 'flower'], type: 'flower', count: 8, group: 12 },
    { w: ['行人', '村民', '小人', '人们', '人', 'person', 'people'], type: 'person', count: 2, group: 5 },
    { w: ['气球', '球', 'sphere', 'ball'], type: 'sphere', count: 2, group: 5 },
    { w: ['箱子', '盒子', '方块', '箱', '盒', 'box', 'cube'], type: 'box', count: 3, group: 6 },
    { w: ['柱子', '圆柱', 'cylinder'], type: 'cylinder', count: 2, group: 5 },
    { w: ['圆锥', '锥', 'cone'], type: 'cone', count: 2, group: 5 }
  ];
  var LEX_LIST = [];
  LEX.forEach(function (e, i) { e.w.forEach(function (w) { LEX_LIST.push({ w: w.toLowerCase(), i: i }); }); });
  LEX_LIST.sort(function (a, b) { return b.w.length - a.w.length; });

  var SEP_RE = /[，,。.；;、！!？?\n]|以及|还有|并且|然后|和|与|及|跟|\s+and\s+|\s+with\s+/gi;
  var DIRS = [
    [/东北(?:边|面|方|侧|角|部)?|northeast/i, 'northeast'], [/西北(?:边|面|方|侧|角|部)?|northwest/i, 'northwest'],
    [/东南(?:边|面|方|侧|角|部)?|southeast/i, 'southeast'], [/西南(?:边|面|方|侧|角|部)?|southwest/i, 'southwest'],
    [/(?:正)?中(?:间|央|心)|正中|当中|center|middle/i, 'center'],
    [/北(?:边|面|方|侧|部)?|north/i, 'north'], [/南(?:边|面|方|侧|部)?|south/i, 'south'],
    [/东(?:边|面|方|侧|部)?|east/i, 'east'], [/西(?:边|面|方|侧|部)?|west/i, 'west'],
    [/左(?:边|侧|面)/, 'west'], [/右(?:边|侧|面)/, 'east']
  ];
  // 相对位置词：紧跟在“参照物”后面（山下、湖边、花丛旁边……）
  var REL_AFTER = ['脚下', '旁边', '附近', '周围', '对面', '边上', '一旁', '下', '边', '旁', '上', '前', '后', '里', '中', '畔', '岸'];
  // 单独出现、指“上一个提到的东西”的相对位置词
  var REL_ALONE = /^(?:在)?(?:它|它们|那|这)?(?:的)?(?:周围|旁边|附近|四周|边上|对面|一旁|脚下|岸边|岸上|水边|河边|湖边)/;
  var CN_NUM = { '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  var COUNT_RE = /(\d+|[一二两三四五六七八九十]+|好几|若干|一些|许多|很多|好多|无数|几) ?([座棵个只间栋块朵片群条位株簇排艘匹头辆户堆丛]?)/g;
  var BARE_ONE_RE = /有个|有座|有棵|有间|有块|有只|有朵|有条/;
  var GROUP_MW = '片群排丛簇堆';
  var SIZE_BIG = /巨大|高大|高耸|很大|大|高/, SIZE_SMALL = /迷你|小小|矮|小/;

  function cnNumber(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s === '几' || s === '好几' || s === '若干' || s === '一些') return 4;
    if (s === '许多' || s === '很多' || s === '好多' || s === '无数') return -1;   // -1 = 按“一片 / 一群”
    if (s.length === 1) return CN_NUM[s] != null ? CN_NUM[s] : 1;
    if (s[0] === '十') return 10 + (CN_NUM[s[1]] || 0);                          // 十五
    if (s[1] === '十') return (CN_NUM[s[0]] || 1) * 10 + (s[2] ? (CN_NUM[s[2]] || 0) : 0); // 二十、二十三
    return CN_NUM[s[0]] || 1;
  }

  function splitClauses(text) {
    var out = [], last = 0, m;
    SEP_RE.lastIndex = 0;
    while ((m = SEP_RE.exec(text))) {
      if (m.index > last) out.push({ s: last, e: m.index });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ s: last, e: text.length });
    return out.filter(function (c) { return text.slice(c.s, c.e).trim().length > 0; });
  }

  function matchObjects(text, c) {
    var low = text.toLowerCase(), res = [], i = c.s;
    while (i < c.e) {
      var hit = null;
      for (var k = 0; k < LEX_LIST.length; k++) {
        var w = LEX_LIST[k].w;
        if (i + w.length <= c.e && low.substr(i, w.length) === w) {
          // 英文词要整词匹配
          if (/[a-z]/.test(w) && ((i > 0 && /[a-z]/.test(low[i - 1])) || /[a-z]/.test(low[i + w.length] || ''))) continue;
          hit = { s: i, e: i + w.length, lex: LEX[LEX_LIST[k].i], word: text.substr(i, w.length) };
          break;
        }
      }
      if (hit) { res.push(hit); i = hit.e; } else i++;
    }
    return res;
  }

  function relAfter(text, pos, end) {
    for (var k = 0; k < REL_AFTER.length; k++) {
      var w = REL_AFTER[k];
      if (pos + w.length <= end && text.substr(pos, w.length) === w) return w;
    }
    return null;
  }

  function freeText(text, c, used) {   // 去掉已被物体词占用的字（用空格占位，保持下标不变）
    var arr = text.slice(c.s, c.e).split('');
    used.forEach(function (u) { for (var i = u.s; i < u.e; i++) if (i >= c.s && i < c.e) arr[i - c.s] = ' '; });
    return arr.join('');
  }

  function planRules(text, level, rng) {
    var clauses = splitClauses(text), plan = [], tokens = [], notes = [];
    var prevClauseItems = [];   // 上一个分句里放的物体（相对位置“周围”指它）
    clauses.forEach(function (c) {
      var objs = matchObjects(text, c);
      var used = objs.slice();
      var refs = [];
      if (level >= 4 && objs.length >= 2) {   // “山下一片森林”：山 后面紧跟“下”，且同一分句还有别的物体 -> 山 是参照物
        objs = objs.filter(function (o) {
          var r = relAfter(text, o.e, c.e);
          if (r) { refs.push({ o: o, rel: r }); tokens.push({ s: o.s, e: o.e + r.length, role: 'ref', value: '参照：' + o.word + r }); return false; }
          return true;
        });
      }
      var free = freeText(text, c, used);
      // 方位
      var area = null;
      if (level >= 3) {
        for (var d = 0; d < DIRS.length && !area; d++) {
          var dm = DIRS[d][0].exec(free);
          if (dm) { area = DIRS[d][1]; tokens.push({ s: c.s + dm.index, e: c.s + dm.index + dm[0].length, role: 'dir', value: AREA_NAMES[area] }); }
        }
      }
      // 单独的“周围 / 旁边”：指上一个分句的物体
      var nearAlone = null;
      if (level >= 4 && !area && !refs.length) {
        var lead = text.slice(c.s, c.e).replace(/^\s+/, ''), off = text.slice(c.s, c.e).length - lead.length;
        var am = REL_ALONE.exec(lead);
        if (am && prevClauseItems.length) {
          nearAlone = prevClauseItems[0];
          tokens.push({ s: c.s + off, e: c.s + off + am[0].length, role: 'ref', value: '参照：上一句的' + typeName(nearAlone) });
        }
      }
      // 颜色、大小（只在没被物体词占用的字里找）
      var color = null, scale = null;
      for (var j = 0; j < free.length; j++) {
        var ch = free[j];
        if (ch !== ' ' && NAMED[ch]) { color = NAMED[ch]; tokens.push({ s: c.s + j, e: c.s + j + 1, role: 'color', value: ch + '色' }); break; }
      }
      if (!color) {
        var em = /\b(red|blue|green|yellow|white|black|pink|purple|orange|brown|gr[ae]y|teal|gold)\b/i.exec(free);
        if (em) { color = NAMED[em[1].toLowerCase()]; tokens.push({ s: c.s + em.index, e: c.s + em.index + em[0].length, role: 'color', value: em[1] }); }
      }
      var bm = SIZE_BIG.exec(free), sm = SIZE_SMALL.exec(free);
      if (bm) { scale = 1.6; tokens.push({ s: c.s + bm.index, e: c.s + bm.index + bm[0].length, role: 'size', value: '放大 ×1.6' }); }
      else if (sm) { scale = 0.65; tokens.push({ s: c.s + sm.index, e: c.s + sm.index + sm[0].length, role: 'size', value: '缩小 ×0.65' }); }
      // 数量（取物体词前面最近的一个）
      var counts = [], cm;
      COUNT_RE.lastIndex = 0;
      while ((cm = COUNT_RE.exec(free))) {
        if (!cm[0].trim()) { COUNT_RE.lastIndex++; continue; }
        if (!cm[2] && !/^\d+$/.test(cm[1]) && cm[1].length === 1 && cm[1] !== '几') {
          // 单独一个“一 / 三”后面没有量词：可能是“一样”“三角”……只有紧挨物体词时才算
          var nextObj = objs.some(function (o) { return o.s === c.s + cm.index + cm[0].replace(/ +$/, '').length; });
          if (!nextObj) continue;
        }
        counts.push({ s: c.s + cm.index, e: c.s + cm.index + cm[0].replace(/ +$/, '').length, num: cm[1], mw: cm[2] });
      }
      var bare = BARE_ONE_RE.exec(free);
      var made = [];
      // 参照物前面没出现过（“湖边三棵树”里还没有湖）：先把参照物本身放出来
      var refTarget = null;
      if (refs.length) {
        var r0 = refs[0], rt0 = r0.o.lex.type, rk0 = r0.o.lex.key;
        refTarget = findEarlier(plan, function (p) {
          return p.type === rt0 || (rk0 && p.key === rk0) || (rt0 === 'mountain' && p.key === 'volcano');
        });
        if (!refTarget) {
          var lx = r0.o.lex, ri = lx.key === 'volcano' ? volcano() : { type: lx.type, count: 1 };
          if (ri.type !== 'custom') ri.color = null;
          if (area) ri.area = area;
          ri._id = plan.length; ri.why = ['“' + r0.o.word + r0.rel + '”说明这里有' + typeName(ri) + '，前面没出现过，先放 1 个'];
          made.push(ri); refTarget = ri;
        }
      }
      objs.forEach(function (o, oi) {
        var lex = o.lex, it = lex.key === 'volcano' ? volcano() : { type: lex.type, count: lex.count };
        var cnt = null, why = [];
        for (var q = counts.length - 1; q >= 0; q--) {
          var ct = counts[q];
          if (ct.e <= o.s && (oi === 0 || ct.s >= objs[oi - 1].e)) { cnt = ct; break; }
        }
        if (cnt) {
          var n = cnNumber(cnt.num);
          var group = n === -1 || (n === 1 && cnt.mw && GROUP_MW.indexOf(cnt.mw) >= 0);
          it.count = group ? lex.group : Math.max(1, Math.min(15, n));
          tokens.push({ s: cnt.s, e: cnt.e, role: 'count', value: group ? '一片 → ' + it.count + ' 个' : it.count + ' 个' });
          why.push(group ? '“' + text.slice(cnt.s, cnt.e) + '”按一片 / 一群算 ' + it.count + ' 个' : '数量 ' + it.count);
        } else if (bare && oi === 0) {
          it.count = 1; tokens.push({ s: c.s + bare.index, e: c.s + bare.index + bare[0].length, role: 'count', value: '1 个' });
        } else {
          why.push('没写数量，用默认 ' + it.count + ' 个');
        }
        if (it.type !== 'custom') it.color = color;
        if (scale) it.scale = scale;
        if (area) it.area = area;
        if (level >= 4 && !area) {
          var ref = refs.length ? refs[0] : null, target = null;
          if (ref) {
            target = refTarget;
            it.near = target._id;
            it.nearText = ref.o.word + ref.rel;
          } else if (nearAlone) {
            target = nearAlone; it.near = nearAlone._id; it.nearText = '上一句的' + typeName(nearAlone);
          }
          if (target) {
            if (target.area) it.area = target.area;
            why.push('放在“' + it.nearText + '”：跟着' + typeName(target) + '（' + (target.area ? AREA_NAMES[target.area] : '同一处') + '）');
          }
        }
        it._id = plan.length + made.length;
        it.why = why;
        tokens.push({ s: o.s, e: o.e, role: 'object', value: typeName(it) });
        made.push(it);
      });
      // 认不出来的名词：量词后面紧跟、却没有被任何物体词接住的几个字
      counts.forEach(function (ct) {
        var rest = text.slice(ct.e, c.e), mm = /^[一-龥]{1,4}/.exec(rest);
        if (!mm) return;
        var s = ct.e, covered = used.some(function (u) { return u.s === s; });
        if (!covered && !SIZE_BIG.test(mm[0][0]) && !SIZE_SMALL.test(mm[0][0]) && !NAMED[mm[0][0]]) {
          tokens.push({ s: s, e: s + mm[0].length, role: 'unknown', value: '没认出来' });
          notes.push('“' + mm[0] + '”不在词表里，规则引擎认不出来（完整版可以接大模型，用基本形状现拼）');
        }
      });
      if (level === 2 || level === 3) {
        // 2–3 档不懂“山下 / 湖边”，参照物也会被当成一个新物体
        if (objs.length >= 2) objs.forEach(function (o) { var r = relAfter(text, o.e, c.e); if (r) notes.push('“' + o.word + r + '”在这一档被当成又一个' + typeName({ type: o.lex.type, key: o.lex.key }) + '（第 4 档才懂相对位置）'); });
      }
      made.forEach(function (it) { plan.push(it); });
      if (made.length) prevClauseItems = made;
    });
    if (!plan.length) {
      var t = FALLBACK_TYPES[Math.floor(rng() * 4)];
      plan.push({ type: t, count: 4, _id: 0, why: ['整句没有认得的物体词'] });
      notes.push('整句没有认得的物体词，随机放 4 个“' + TYPE_NAMES[t] + '”占位');
    }
    return { plan: plan, tokens: dedupeTokens(tokens), clauses: clauses, notes: notes };
  }

  function findEarlier(plan, pred) { for (var i = plan.length - 1; i >= 0; i--) if (pred(plan[i])) return plan[i]; return null; }

  function dedupeTokens(tokens) {
    tokens.sort(function (a, b) { return a.s - b.s || b.e - a.e; });
    var out = [], end = -1;
    tokens.forEach(function (t) { if (t.s >= end) { out.push(t); end = t.e; } });
    return out;
  }

  var TYPE_NAMES = { tree: '树', house: '房子', tower: '塔', mountain: '山', water: '水面', rock: '石头', flower: '花',
    person: '小人', box: '方块', sphere: '球', cylinder: '圆柱', cone: '圆锥', custom: '自拼物体' };
  var AREA_NAMES = { center: '中间', north: '北边', south: '南边', east: '东边', west: '西边', northeast: '东北',
    northwest: '西北', southeast: '东南', southwest: '西南' };
  function typeName(it) { return it.key === 'volcano' ? '火山' : (TYPE_NAMES[it.type] || it.type); }

  /** 主入口：text -> {level, plan, tokens, clauses, notes} */
  function plan(text, level, rng) {
    text = String(text || '');
    rng = rng || Math.random;
    var r = level === 1 ? planLevel1(text, rng) : planRules(text, level || 4, rng);
    r.level = level || 4; r.text = text;
    return r;
  }

  /** 只去掉内部字段（_id / key / why / near），其余原样保留：第 1 档用它和原版逐项对照 */
  function rawPlan(p) {
    return p.map(function (it) {
      var o = {};
      Object.keys(it).forEach(function (k) { if (k !== '_id' && k !== 'key' && k !== 'why' && k !== 'near' && k !== 'nearText') o[k] = it[k]; });
      return o;
    });
  }

  /** 去掉内部字段，得到和原版一样的“计划 JSON”（面板展示用） */
  function cleanPlan(p) {
    return p.map(function (it) {
      var o = { type: it.type, count: it.count };
      if (it.area) o.area = it.area;
      if (it.color) o.color = it.color;
      if (it.scale) o.scale = it.scale;
      if (it.nearText) o.near = it.nearText;
      if (it.type === 'custom') o.parts = it.parts;
      return o;
    });
  }

  var api = { plan: plan, cleanPlan: cleanPlan, rawPlan: rawPlan, col: col, NAMED: NAMED, KW: KW, LEX: LEX, VOLCANO_PARTS: VOLCANO_PARTS,
    TYPE_NAMES: TYPE_NAMES, AREA_NAMES: AREA_NAMES, typeName: typeName, splitClauses: splitClauses, cnNumber: cnNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TTW_PLANNER = api;
})(typeof window !== 'undefined' ? window : globalThis);
