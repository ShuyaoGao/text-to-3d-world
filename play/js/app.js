/* app.js -- 页面逻辑：三种模式、选项、播放控制、帮助、悬停提示、练习清单、退出、自检。 */
(function () {
  'use strict';
  var C = window.TTW_CONFIG, P = window.TTW_PLANNER, W = window.TTW_WORLD, CR = window.CREDITS || {};
  var Q = parseQuery();
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function parseQuery() { var o = {}; location.search.replace(/^\?/, '').split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); o[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); }); return o; }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } return null; }

  var st = {
    mode: 'watch', level: C.DEFAULT_LEVEL, seed: C.SEED, overlap: C.OVERLAP_DEFAULT, tries: C.TRIES_DEFAULT,
    speed: 'normal', compass: true, delMode: false, done: {}, ended: false
  };
  var timers = [];
  function later(fn, ms) { var id = setTimeout(function () { timers = timers.filter(function (t) { return t !== id; }); if (!st.ended) fn(); }, ms); timers.push(id); return id; }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  // ---------- 场景、世界、面板 ----------
  var scene = new window.TTW_Scene3D($('view'), { preserve: !!Q.shot, noAnim: !!Q.shot });   // 截图时不播生长动画
  var panel = new window.TTW_Panel();
  var watchWorld = new W.World(THREE, st.seed, { overlap: st.overlap, tries: st.tries });
  var userWorld = new W.World(THREE, st.seed, { overlap: st.overlap, tries: st.tries });
  var lastUser = null;   // 我来造：最近一句的理解结果和报告（切模式回来时恢复面板）
  var history = [];      // 我来造：每句话放下的配方，撤销用

  // ---------- 手机：设备分类、☰ 菜单、全屏面板、横屏提示、防误触（js/mobile.js；桌面布局不受影响） ----------
  var MU = window.MobileUI;
  var mob = MU ? MU.detect({ onChange: function () { setTimeout(function () { panel.drawMap(); panel.renderParts(); }, 80); } }) : { touch: false, touchp: false, touchl: false };
  var sheets = MU ? MU.sheets($('panel-close'), function (cur) { if (cur) setTimeout(function () { panel.drawMap(); panel.renderParts(); }, 60); }) : { open: function () {}, close: function () {}, toggle: function () {}, current: function () { return null; } };
  if (MU) {
    MU.menu($('menu-btn'), $('menu'));
    MU.rotateHint($('rotate-hint'), $('rot-ok'));
    MU.pressFeedback(document.body, '.btn, .chip, .mbtn, .tab, .preset, .mini-btn, #menu button, #panel-close');
    MU.guard(document.body, { onReset: function () { if (scene.ok && scene.releasePointers) scene.releasePointers(); scene.keys = {}; } });
  }
  $('menu-help').addEventListener('click', function () { sheets.close(); openHelp(); });
  $('menu-panel').addEventListener('click', function () { sheets.open('panel'); });
  $('menu-opts').addEventListener('click', function () { sheets.open('opts'); });
  $('menu-view').addEventListener('click', function () { scene.ok && scene.resetView(); });
  $('menu-exit').addEventListener('click', function () { exitApp(); });
  $('mob-panel').addEventListener('click', function () { sheets.toggle('panel'); });
  $('mob-opts').addEventListener('click', function () { sheets.toggle('opts'); });
  function renderMobBar() {
    var h;
    if (st.mode === 'practice') {
      var done = C.TASKS.filter(function (t) { return st.done[t.id]; }).length;
      h = '任务 <b>' + done + ' / ' + C.TASKS.length + '</b>，清单在「任务」里；写一句话再点「生成」';
    } else h = '写一句话或点示例，再点「生成」；<b>单指拖动</b>转视角，<b>双指</b>缩放';
    $('mob-explain').innerHTML = h;
    $('mob-opts').textContent = st.mode === 'practice' ? '任务' : '选项';
  }

  // ---------- 页脚 ----------
  $('foot').innerHTML = esc(CR.SERIES_NAME || '') + ' / ' + esc(CR.SERIES_NAME_EN || '') + ' 系列　|　作者 ' + esc(CR.AUTHOR || '') + (CR.AUTHOR_EMAIL ? '（' + esc(CR.AUTHOR_EMAIL) + '）' : '') +
    ' · ' + esc(CR.UNIVERSITY_EN || '') + ' · ' + esc(CR.UNIVERSITY_KO || '') +
    '　|　代码 MIT · 文档 CC BY 4.0　|　3D 渲染：three.js r128（MIT）　|　本页不联网、不调用大模型';
  $('engine-line').innerHTML = '理解句子的是浏览器里的<b>' + esc(C.NAMES.ENGINE) + '</b>（不是大语言模型）。' + esc(C.NAMES.LLM_NOTE);

  // ---------- 选项 ----------
  function renderOpts() {
    var h = '<div class="opt-row"><span class="lab">规则档位</span>' + C.LEVELS.map(function (l) {
      return '<button class="preset' + (l.id === st.level ? ' on' : '') + '" data-level="' + l.id + '" data-tip="' + esc('第 ' + l.id + ' 档：' + l.desc) + '">' + l.id + ' ' + esc(l.name) + '</button>';
    }).join('') + '</div>';
    var lv = C.LEVELS[st.level - 1];
    h += '<div class="opt-desc">' + esc(lv.desc) + '</div>';
    h += '<div class="opt-row"><span class="lab">防穿模</span><input type="range" id="sl-overlap" min="0.3" max="1.3" step="0.05" value="' + st.overlap + '" data-tip="两个物体的占地圆至少隔开 (半径之和 × 这个系数)。原版是 0.85：允许树丛、花丛轻微交叠。调大 = 更严，更容易被拒绝" data-anim="slide">' +
      '<span class="ms" id="v-overlap">' + st.overlap.toFixed(2) + '</span>' +
      '<span class="lab">最多试</span><input type="range" id="sl-tries" min="1" max="60" step="1" value="' + st.tries + '" data-tip="每个物体最多找几次落点（原版 26 次），试满还找不到就在附近硬放" data-anim="slide"><span class="ms" id="v-tries">' + st.tries + ' 次</span></div>';
    h += '<div class="opt-row"><span class="lab">种子</span><input id="in-seed" class="seed" type="number" value="' + st.seed + '" data-tip="随机落点用固定种子：同一句话、同一种子 → 一模一样的世界。换个数字就换一种摆法">' +
      '<button class="mini-btn" id="btn-reseed" data-tip="换一个种子，用同样的话重新摆一遍">换种子重摆</button>' +
      '<label class="ck" data-tip="在地面边缘显示 北 / 南 / 东 / 西，方便对照方位词"><input type="checkbox" id="ck-compass"' + (st.compass ? ' checked' : '') + '> 方位标</label>';
    if (st.mode === 'watch') {
      h += '<span class="lab">演示速度</span>' + C.SPEEDS.map(function (s) { return '<button class="preset' + (s.id === st.speed ? ' on' : '') + '" data-speed="' + s.id + '">' + esc(s.name) + '</button>'; }).join('');
    }
    h += '</div>';
    $('opts').innerHTML = h;
  }
  $('opts').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.level) setLevel(+b.dataset.level);
    else if (b.dataset.speed) { st.speed = b.dataset.speed; renderOpts(); }
    else if (b.id === 'btn-reseed') { st.seed = (st.seed * 7 + 13) % 997 || 1; renderOpts(); replayCurrent(); }
  });
  $('opts').addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'sl-overlap') { st.overlap = +t.value; $('v-overlap').textContent = st.overlap.toFixed(2); }
    if (t.id === 'sl-tries') { st.tries = +t.value; $('v-tries').textContent = st.tries + ' 次'; }
  });
  $('opts').addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'sl-overlap' || t.id === 'sl-tries') replayCurrent();
    if (t.id === 'in-seed') { st.seed = Math.max(1, Math.floor(+t.value) || 1); replayCurrent(); }
    if (t.id === 'ck-compass') { st.compass = t.checked; scene.ok && scene.setCompass(st.compass); }
  });

  function setLevel(l) {
    st.level = l; renderOpts(); replayCurrent();
    if (st.mode !== 'watch') toast('规则档位：第 ' + l + ' 档「' + C.LEVELS[l - 1].name + '」');
  }

  /** 改了档位 / 种子 / 摆放参数：把当前这一句按新设置重新理解、重新摆 */
  function replayCurrent() {
    if (st.mode === 'watch') { if (watch.ep != null) watch.restartEpisode(true); return; }
    if (lastUser) {
      undoLast(true);
      submit(lastUser.result.text, true);
    }
  }

  // ---------- 生成 ----------
  function runText(world, text) {
    world.opts.overlap = st.overlap; world.opts.tries = st.tries;
    var res = P.plan(text, st.level, world.rng);
    var rep = world.run(res.plan);
    return { result: res, report: rep };
  }
  function spawnAll(recs) { recs.forEach(function (r, i) { scene.spawn(r, true, i * 0.05); }); }

  function submit(text, silent) {
    text = String(text || '').trim();
    if (!text) { toast('先写一句话，比如：湖边三棵树'); return null; }
    var out = runText(userWorld, text);
    spawnAll(out.report.placed);
    history.push(out.report.placed.slice());
    lastUser = out;
    panel.update(out.result, out.report, userWorld);
    saveUser();
    renderPills();
    if (!silent) {
      var n = out.report.placed.length;
      toast(n ? '放了 ' + n + ' 个物体' : '没太懂，换个说法试试');
      checkTasks(out);
      renderExplain();
    }
    return out;
  }

  function undoLast(silent) {
    var recs = history.pop();
    if (!recs) { if (!silent) toast('没有可撤销的了'); return false; }
    recs.forEach(function (r) { userWorld.remove(r); scene.removeRec(r); });
    if (!silent) { lastUser = null; panel.reset('撤销了上一句'); panel.setWorld(userWorld); saveUser(); renderPills(); toast('撤销了上一句'); }
    return true;
  }
  function deleteRec(rec) {
    userWorld.remove(rec); scene.removeRec(rec);
    history.forEach(function (h) { var i = h.indexOf(rec); if (i >= 0) h.splice(i, 1); });
    panel.setWorld(userWorld); saveUser(); renderPills();
    toast('删掉一个' + P.typeName(rec));
    markDone('delete');
  }
  function clearUser(msg) {
    scene.clear(); userWorld.reset(st.seed, { overlap: st.overlap, tries: st.tries }); history = []; lastUser = null;
    panel.reset(msg || '世界已清空'); panel.setWorld(userWorld); saveUser(); renderPills();
  }
  function seedUser(plan) {
    var rep = userWorld.run(JSON.parse(JSON.stringify(plan)).map(function (it, i) { it._id = i; return it; }));
    spawnAll(rep.placed); history.push(rep.placed.slice());
    panel.setWorld(userWorld);
  }
  function saveUser() { store('ttw.userWorld.v1', { seed: st.seed, records: userWorld.serialize() }); }
  function loadUser() {
    var d = store('ttw.userWorld.v1');
    if (d && Array.isArray(d.records) && d.records.length) { userWorld.load(d.records); history.push(userWorld.records.slice()); return true; }
    return false;
  }

  // ---------- 观看：自动演示 ----------
  var watch = {
    ep: null, paused: false, phase: 'idle', typed: 0,
    start: function () { this.paused = false; this.play(0); },
    speed: function () { return C.SPEEDS.filter(function (s) { return s.id === st.speed; })[0] || C.SPEEDS[1]; },
    play: function (i) {
      clearTimers();
      this.ep = ((i % C.DEMO.length) + C.DEMO.length) % C.DEMO.length; this.typed = 0; this.phase = 'typing';
      watchWorld.reset(st.seed + this.ep, { overlap: st.overlap, tries: st.tries });
      scene.clear(); panel.reset(''); panel.setWorld(watchWorld);
      renderControls(); renderExplain(); renderPills();
      this.tick();
    },
    restartEpisode: function (instant) {
      if (instant) {   // 档位 / 种子改了：跳过打字，直接重摆
        clearTimers();
        watchWorld.reset(st.seed + this.ep, { overlap: st.overlap, tries: st.tries });
        scene.clear(); this.typed = C.DEMO[this.ep].text.length; this.build();
      } else this.play(this.ep);
    },
    tick: function () {
      var self = this, text = C.DEMO[this.ep].text;
      if (this.paused) return;
      if (this.typed < text.length) {
        this.typed++; panel.typing(text.slice(0, this.typed)); $('demo-input') && ($('demo-input').value = text.slice(0, this.typed));
        later(function () { self.tick(); }, this.speed().type);
      } else if (this.phase === 'typing') {
        later(function () { self.build(); }, 400);
      }
    },
    build: function () {
      var self = this, ep = C.DEMO[this.ep];
      var out = runText(watchWorld, ep.text);
      this.out = out; this.phase = 'hold';
      panel.update(out.result, out.report, watchWorld);
      spawnAll(out.report.placed);
      renderExplain(); renderPills(); renderControls();
      if (!this.paused) later(function () { self.next(); }, this.speed().hold);
    },
    next: function () { this.play(this.ep + 1); },
    prev: function () { this.play(this.ep - 1); },
    toggle: function () {
      this.paused = !this.paused;
      if (!this.paused) { if (this.phase === 'typing') this.tick(); else this.next(); }
      else clearTimers();
      renderControls();
    }
  };

  // ---------- 控制区 ----------
  function renderControls() {
    var h = '';
    if (st.mode === 'watch') {
      var ep = watch.ep == null ? 0 : watch.ep;
      h = '<input id="demo-input" class="q" readonly value="" aria-label="演示句子">' +
        '<button class="btn" id="btn-pause" data-tip="暂停 / 继续自动演示（空格）">' + (watch.paused ? '▶ 继续' : '❚❚ 暂停') + '</button>' +
        '<button class="btn" id="btn-prev" data-tip="上一句">上一句</button>' +
        '<button class="btn go" id="btn-next" data-tip="跳到下一句（N）">下一句</button>' +
        '<span class="ms">第 ' + (ep + 1) + ' / ' + C.DEMO.length + ' 句</span>';
    } else {
      h = '<div class="qrow"><input id="q" class="q" autocomplete="off" placeholder="试试：北边一座火山，山下一片森林" data-tip="写一句中文描述，回车生成。认得的词：树 / 森林 / 房子 / 村庄 / 塔 / 山 / 火山 / 湖 / 河 / 石头 / 花 / 人 / 球 / 方块……" data-anim="type">' +
        '<button class="btn go" id="btn-go">生成</button></div>' +
        '<div class="chips">' + C.EXAMPLES.map(function (x) { return '<button class="chip" data-ex="' + esc(x) + '" data-tip="点一下填进输入框">' + esc(x) + '</button>'; }).join('') + '</div>' +
        '<div class="tools">' +
        '<button class="btn" id="btn-undo" data-tip="撤掉上一句放下的所有物体">撤销</button>' +
        '<button class="btn' + (st.delMode ? ' warn' : '') + '" id="btn-del" data-tip="打开后，点 3D 画面里的物体就删掉它" data-anim="click">删除：' + (st.delMode ? '开' : '关') + '</button>' +
        '<button class="btn" id="btn-scene" data-tip="清空后随机换一片现成风景（原版的三套）">随机风景</button>' +
        '<button class="btn" id="btn-clear" data-tip="把世界清空">清空</button>' +
        '<button class="btn" id="btn-view" data-tip="把视角恢复到默认">视角复位</button></div>';
    }
    $('controls').innerHTML = h;
    if (st.mode === 'watch' && watch.ep != null) $('demo-input').value = C.DEMO[watch.ep].text.slice(0, watch.typed);
  }
  $('controls').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ex) { $('q').value = b.dataset.ex; $('q').focus(); return; }
    switch (b.id) {
      case 'btn-pause': watch.toggle(); break;
      case 'btn-next': watch.paused = false; watch.next(); break;
      case 'btn-prev': watch.paused = false; watch.prev(); break;
      case 'btn-go': doSubmit(); break;
      case 'btn-undo': undoLast(false); break;
      case 'btn-del': st.delMode = !st.delMode; renderControls(); toast(st.delMode ? '删除模式：点 3D 画面里的物体删掉它' : '退出删除模式'); $('view').style.cursor = st.delMode ? 'crosshair' : ''; break;
      case 'btn-scene': clearUser('随机风景'); seedUser(C.SCENES[Math.floor(userWorld.rng() * C.SCENES.length)]); saveUser(); renderPills(); toast('给你一片随机风景'); break;
      case 'btn-clear': clearUser(); toast('世界已清空'); break;
      case 'btn-view': scene.ok && scene.resetView(); break;
    }
  });
  $('controls').addEventListener('keydown', function (e) { if (e.target.id === 'q' && e.key === 'Enter') { e.preventDefault(); doSubmit(); } });
  function doSubmit() { var q = $('q'); var out = submit(q.value); if (out) { q.value = ''; if (mob.touchp) q.blur(); } if (st.mode === 'practice') renderMobBar(); }

  scene.onClick = function (x, y) {
    var rec = scene.pick(x, y); if (!rec) return;
    if (st.mode !== 'watch' && st.delMode) deleteRec(rec);
    else { panel.renderParts(rec); toast('右栏 ③ 显示这个' + P.typeName(rec) + '的图元'); }
  };
  scene.onUserMove = function () { hideViewHint(); };

  // ---------- 说明区 ----------
  function renderExplain() {
    var h = '';
    if (st.mode === 'watch') {
      var ep = watch.ep == null ? null : C.DEMO[watch.ep];
      h = '<p><b>观看：</b>自动打一句中文描述，右边一步步显示规则引擎怎么理解它，左边的世界照着“生成计划”长出来。</p>';
      if (ep && watch.phase === 'hold') h += '<p class="say">' + esc(ep.say) + '</p>';
      else h += '<p class="muted">正在输入……</p>';
      h += '<p class="muted">试试：把左上的“规则档位”切到 1，同一句会被怎么理解？</p>';
    } else if (st.mode === 'build') {
      h = '<p><b>我来造：</b>写一句中文描述，回车生成。句子里的<b class="c-obj">物体</b>、<b class="c-cnt">数量</b>、<b class="c-dir">方位</b>、<b class="c-col">颜色</b>、<b class="c-ref">相对位置</b>都会被右边标出来。</p>' +
        '<p class="muted">词表里没有的东西（比如“拱桥”“长颈鹿”）规则引擎认不出来。仓库里的完整版可以接大语言模型，让它用基本图元现拼。</p>';
    } else {
      var done = C.TASKS.filter(function (t) { return st.done[t.id]; }).length;
      h = '<div class="ptitle"><b>练习</b>　完成 ' + done + ' / ' + C.TASKS.length + '<button class="mini-btn" id="btn-reset-tasks">重新开始</button></div>' +
        '<div class="progress"><i style="width:' + (100 * done / C.TASKS.length) + '%"></i></div><ul class="tasks">';
      var cur = false;
      C.TASKS.forEach(function (t) {
        var d = !!st.done[t.id], isCur = !d && !cur; if (isCur) cur = true;
        h += '<li class="' + (d ? 'done' : '') + (isCur ? ' cur' : '') + '"><span class="box">' + (d ? '✓' : '') + '</span><div>' + esc(t.text) + '<div class="hint">' + esc(t.hint) + '</div></div></li>';
      });
      h += '</ul>';
    }
    $('explain').innerHTML = h;
  }
  $('explain').addEventListener('click', function (e) {
    if (e.target.id === 'btn-reset-tasks') { st.done = {}; store('ttw.tasks.v1', st.done); renderExplain(); }
  });

  function markDone(id) {
    if (st.done[id]) return;
    st.done[id] = true; store('ttw.tasks.v1', st.done);
    if (st.mode === 'practice') { renderExplain(); renderMobBar(); var t = C.TASKS.filter(function (x) { return x.id === id; })[0]; if (t) toast('✓ 完成：' + t.text); }
  }
  function checkTasks(out) {
    var p = out.result.plan, text = out.result.text;
    if (/森林|树林|forest/i.test(text) && p.some(function (x) { return x.type === 'tree'; })) markDone('forest');
    if (p.some(function (x) { return x.area === 'northeast'; })) markDone('dir');
    if (p.some(function (x) { return x.type === 'house' && x.count >= 3; })) markDone('count');
    if (p.some(function (x) { return !!x.color; })) markDone('color');
    if (p.some(function (x) { return !!x.nearText; })) markDone('rel');
    if (out.result.level === 1 && /[东南西北]|中间|中央/.test(text)) markDone('level1');
    if (out.report.rejected > 0) markDone('reject');
  }

  // ---------- 顶部小标签 ----------
  function renderPills() {
    var w = st.mode === 'watch' ? watchWorld : userWorld;
    var lv = C.LEVELS[st.level - 1];
    $('pills').innerHTML = '<span class="pill">规则档位 <b>' + st.level + ' ' + esc(lv.short) + '</b></span>' +
      '<span class="pill">世界里 <b>' + w.records.length + '</b> 个物体</span>' +
      '<span class="pill">种子 <b>' + (st.mode === 'watch' && watch.ep != null ? st.seed + watch.ep : st.seed) + '</b></span>' +
      (st.mode === 'watch' ? '<span class="pill">' + (watch.paused ? '已暂停' : '自动演示中') + '</span>' : '') +
      (st.delMode && st.mode !== 'watch' ? '<span class="pill warn">删除模式</span>' : '');
  }

  // ---------- 模式切换 ----------
  function setMode(m) {
    if (st.ended) return;
    st.mode = m; clearTimers();
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.classList.toggle('on', t.dataset.mode === m); t.setAttribute('aria-selected', t.dataset.mode === m); });
    ['watch', 'build', 'practice'].forEach(function (x) { document.body.classList.toggle('m-' + x, x === m); });
    sheets.close(); renderMobBar();
    scene.autoOrbit = (m === 'watch');
    if (m === 'watch') { st.delMode = false; $('view').style.cursor = ''; renderOpts(); watch.start(); }
    else {
      renderOpts(); renderControls(); renderExplain();
      scene.setRecords(userWorld.records);
      if (lastUser) panel.update(lastUser.result, lastUser.report, userWorld);
      else { panel.reset(m === 'practice' ? '按左下的任务清单，写一句话试试' : '写一句话，回车生成'); panel.setWorld(userWorld); }
      renderPills();
    }
  }
  document.getElementById('tabs').addEventListener('click', function (e) { var b = e.target.closest('.tab'); if (b) setMode(b.dataset.mode); });

  // ---------- 大屏 / 帮助 / 提示 / 退出 ----------
  $('ck-big').addEventListener('change', function () { setBig(this.checked); });
  function setBig(on) { document.body.classList.toggle('big', on); $('ck-big').checked = on; setTimeout(function () { panel.drawMap(); panel.renderParts(); }, 60); }
  function openHelp() { $('help').hidden = false; }
  function closeHelp() { $('help').hidden = true; store('ttw.helpSeen', 1); }
  $('btn-help').addEventListener('click', openHelp);
  $('help-close').addEventListener('click', closeHelp);
  $('help').addEventListener('click', function (e) { if (e.target.id === 'help') closeHelp(); });

  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2200); }

  var ANIMS = {
    drag: '<div class="demo demo-drag"><i class="d-ball"></i><i class="d-hand"></i></div>',
    type: '<div class="demo demo-type"><span class="d-text">湖边三棵树</span><i class="d-caret"></i></div>',
    click: '<div class="demo demo-click"><i class="d-dot"></i><i class="d-dot"></i><i class="d-dot target"></i><i class="d-cursor"></i></div>',
    slide: '<div class="demo demo-slide"><i class="track"></i><i class="knob"></i></div>'
  };
  var tipEl = $('tip');
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) { tipEl.hidden = true; return; }
    tipEl.innerHTML = esc(el.getAttribute('data-tip')) + (el.dataset.anim && ANIMS[el.dataset.anim] ? ANIMS[el.dataset.anim] : '');
    tipEl.hidden = false;
    var r = el.getBoundingClientRect(), tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    var x = Math.min(window.innerWidth - tw - 8, Math.max(8, r.left + r.width / 2 - tw / 2));
    var y = r.bottom + 8; if (y + th > window.innerHeight - 8) y = Math.max(8, r.top - th - 8);
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  });
  document.addEventListener('mouseout', function (e) { if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('[data-tip]')) tipEl.hidden = true; });

  function showViewHint() { var h = $('view-hint'); h.innerHTML = mob.touchp ? '单指拖动转视角 · 双指张合缩放 · 点物体看图元' : '拖动转视角 · 滚轮缩放 · WASD 走动'; h.hidden = false; later(hideViewHint, 6000); }
  function hideViewHint() { $('view-hint').hidden = true; }

  document.addEventListener('keydown', function (e) {
    var t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !t.readOnly && t.type !== 'checkbox' && t.type !== 'range';
    if (st.ended) return;
    if (e.key === 'Escape' && !$('help').hidden) { closeHelp(); return; }
    if (typing) return;
    var k = e.key.toLowerCase();
    if (k === 'h') { $('help').hidden ? openHelp() : closeHelp(); }
    else if (k === 'b') setBig(!document.body.classList.contains('big'));
    else if (k === '1') setMode('watch');
    else if (k === '2') setMode('build');
    else if (k === '3') setMode('practice');
    else if (k === ' ' && st.mode === 'watch') { e.preventDefault(); watch.toggle(); }
    else if (k === 'n' && st.mode === 'watch') { watch.paused = false; watch.next(); }
  });

  function exitApp() {
    st.ended = true; clearTimers(); clearTimeout(toastT);
    scene.dispose();
    if (MU) MU.destroy();
    document.body.className = '';
    watchWorld = userWorld = null; history = []; lastUser = null;
    try { window.close(); } catch (e) { /* ignore */ }
    var keep = $('selftest');
    document.body.innerHTML = '<div class="ended">已停止运行，所有计算都已结束，<br>可以直接关闭这个标签页。</div>';
    if (keep) document.body.appendChild(keep);
  }
  $('btn-exit').addEventListener('click', exitApp);
  window.addEventListener('resize', function () { panel.drawMap(); panel.renderParts(); });

  // ---------- 启动 ----------
  st.done = store('ttw.tasks.v1') || {};
  if (!loadUser()) seedUser(C.START_PLAN);
  if (scene.ok) scene.setCompass(st.compass);
  var startMode = { watch: 'watch', build: 'build', practice: 'practice', play: 'build' }[Q.shot || Q.mode] || 'watch';
  if (Q.selftest || Q.shot) { userWorld.reset(st.seed, { overlap: st.overlap, tries: st.tries }); history = []; seedUser(C.START_PLAN); st.done = {}; }
  setMode(startMode);
  if (!Q.nohelp && !Q.selftest && !store('ttw.helpSeen')) openHelp();
  else if (!Q.selftest && !Q.shot) showViewHint();

  // 截图用：?shot=build&q=一句话
  if (Q.shot && Q.q) { submit(Q.q, true); }
  if (Q.shot === 'practice') {
    ['西边一片森林', '东北角一座红色的塔', '湖边两棵树'].forEach(function (t) { var o = submit(t, true); checkTasks(o); });
    renderExplain();
  }
  if (Q.big) setBig(true);

  // ---------- 自检（tools/browser_check.py 用 ?selftest=1 调用） ----------
  if (Q.selftest) selftest();
  function selftest() {
    var R = { ok: true, checks: [], errors: [], webgl: scene.ok, size: [window.innerWidth, window.innerHeight] };
    function check(name, cond, info) { R.checks.push([name, !!cond, info === undefined ? '' : info]); if (!cond) R.ok = false; }
    function overflow() {
      var de = document.documentElement, L = $('left'), Rt = $('right');
      return { page: de.scrollWidth - window.innerWidth, left: L.scrollWidth - L.clientWidth, right: Rt.scrollWidth - Rt.clientWidth };
    }
    function noOverflow(tag) { var o = overflow(); check('no horizontal overflow (' + tag + ')', o.page <= 1 && o.left <= 1 && o.right <= 1, JSON.stringify(o)); }
    var steps = [];
    function step(ms, fn) { steps.push([ms, fn]); }
    st.speed = 'fast'; renderOpts();
    step(2500, function () {
      check('webgl', scene.ok, scene.error || '');
      check('watch: first sentence built', watch.phase === 'hold' && watchWorld.records.length > 0, watch.phase + ' ' + watchWorld.records.length);
      check('watch: tokens shown', document.querySelectorAll('#sent .tk').length >= 5, document.querySelectorAll('#sent .tk').length);
      check('watch: plan rows', document.querySelectorAll('#plan-body tr').length === 3, document.querySelectorAll('#plan-body tr').length);
      noOverflow('watch');
      watch.next();
    });
    step(2500, function () {
      check('watch: second sentence', watch.ep === 1 && watch.phase === 'hold', watch.ep + ' ' + watch.phase);
      setLevel(1);
    });
    step(600, function () {
      var rows = document.querySelectorAll('#plan-body tr').length;
      check('watch: level 1 re-plan', watch.out && watch.out.result.level === 1, rows);
      setLevel(4);
      setMode('build');
      $('q').value = '湖边三棵树和一座红房子'; doSubmit();
    });
    step(600, function () {
      var p = lastUser && lastUser.result.plan;
      check('build: plan', p && p.length === 3 && p[1].type === 'tree' && p[1].count === 3 && p[1].nearText === '湖边', JSON.stringify(p && P.cleanPlan(p)));
      check('build: records', userWorld.records.length > 0 && scene.groups.length === userWorld.records.length, userWorld.records.length + '/' + scene.groups.length);
      noOverflow('build');
      var n0 = userWorld.records.length; undoLast(false);
      check('build: undo', userWorld.records.length === n0 - 5, n0 + '->' + userWorld.records.length);
      submit('北边一座火山', false);
      var rec = userWorld.records[0]; deleteRec(rec);
      check('build: delete', userWorld.records.indexOf(rec) < 0 && scene.groups.length === userWorld.records.length);
      document.getElementById('btn-scene').click();
      check('build: random scene', userWorld.records.length > 5, userWorld.records.length);
      document.getElementById('btn-clear').click();
      check('build: clear', userWorld.records.length === 0 && scene.groups.length === 0);
      setMode('practice');
      ['西边一片森林', '东北角三座房子', '一座红色的塔', '湖边两棵树'].forEach(function (t) { $('q').value = t; doSubmit(); });
      setLevel(1); $('q').value = '北边一座塔'; doSubmit(); setLevel(4);
    });
    step(600, function () {
      var done = C.TASKS.filter(function (t) { return st.done[t.id]; }).length;
      check('practice: tasks checked', done >= 6, done + ' ' + JSON.stringify(st.done));
      check('practice: list rendered', document.querySelectorAll('.tasks li').length === C.TASKS.length);
      noOverflow('practice');
      setBig(true);
    });
    step(400, function () {
      check('big mode', document.body.classList.contains('big'));
      noOverflow('big');
      setBig(false);
      openHelp(); check('help opens', !$('help').hidden); closeHelp(); check('help closes', $('help').hidden);
      check('scene frames rendered', !scene.ok || scene.frames > 0, scene.frames);
      setMode('watch');
    });
    step(800, function () {
      R.errors = window.__errors.slice();
      if (R.errors.length) R.ok = false;
      exitApp();
      check('exit: loop stopped', !scene.running);
      check('exit: end page', !!document.querySelector('.ended'));
      R.errors = window.__errors.slice();
      if (R.errors.length) R.ok = false;
      var pre = document.getElementById('selftest'); pre.textContent = JSON.stringify(R); pre.hidden = false;
    });
    var i = 0;
    (function run() { if (i >= steps.length) return; var s = steps[i++]; setTimeout(function () { try { s[1](); } catch (e) { R.ok = false; R.errors.push('selftest: ' + (e && e.stack || e)); var pre = document.getElementById('selftest'); pre.textContent = JSON.stringify(R); } run(); }, s[0]); })();
  }

  // 给验收脚本（tools/browser_check.py、tools/mobile_check_ttw.py）看的入口；页面本身不用
  window.TTW_APP = { st: st, submit: submit, setMode: setMode, setLevel: setLevel, scene: scene, panel: panel, sheets: sheets,
    objects: function () { return scene.groups.length; }, watchPhase: function () { return watch.phase; }, mobile: mob, ready: true };
})();
