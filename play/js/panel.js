/* panel.js -- 右栏“理解面板”：这句话被怎么理解 -> 生成计划 -> 图元拆解 -> 俯视占地图。 */
(function (root) {
  'use strict';
  var P = root.TTW_PLANNER, S = root.TTW_SHAPES, W = root.TTW_WORLD, C = root.TTW_CONFIG;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $(id) { return document.getElementById(id); }

  function Panel() {
    this.result = null; this.report = null; this.world = null; this.sel = 0; this.showJson = false;
    var self = this;
    $('plan-body').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-i]'); if (!tr) return;
      self.sel = +tr.getAttribute('data-i'); self.renderPlan(); self.renderParts();
      if (self.onSelect) self.onSelect(self.sel);
    });
    $('btn-json').addEventListener('click', function () { self.showJson = !self.showJson; self.renderPlan(); });
    this.mapCanvas = $('map');
    this.partsCanvas = $('parts-view');
  }

  Panel.prototype.reset = function (msg) {
    this.result = null; this.report = null; this.sel = 0; this.typed = null;
    $('sent').innerHTML = '<span class="muted">' + esc(msg || '等待一句话……') + '</span>';
    $('notes').innerHTML = '';
    $('plan-body').innerHTML = '';
    $('plan-json').hidden = true;
    $('parts-title').textContent = '';
    $('parts-list').innerHTML = '';
    $('map-stats').textContent = '';
    this.drawParts(null); this.drawMap();
  };

  /** 观看模式打字时：只显示已经打出来的字 */
  Panel.prototype.typing = function (text) {
    this.typed = text;
    $('sent').innerHTML = esc(text) + '<span class="caret"></span>';
  };

  Panel.prototype.update = function (result, report, world) {
    this.result = result; this.report = report; this.world = world; this.sel = 0; this.typed = null;
    this.renderSentence(); this.renderPlan(); this.renderParts(); this.drawMap();
  };

  Panel.prototype.setWorld = function (world) { this.world = world; this.drawMap(); };

  Panel.prototype.renderSentence = function () {
    var r = this.result, t = r.text, html = '', pos = 0;
    // 分句边界
    var bounds = {};
    (r.clauses || []).forEach(function (c, i) { if (i > 0) bounds[c.s] = true; });
    r.tokens.forEach(function (k) {
      if (k.s > pos) html += plain(t.slice(pos, k.s), pos);
      html += '<span class="tk tk-' + k.role + '" data-tip="' + esc((C.ROLE_NAMES[k.role] || k.role) + '：' + k.value) + '">' + esc(t.slice(k.s, k.e)) +
        '<i>' + esc(label(k)) + '</i></span>';
      pos = k.e;
    });
    if (pos < t.length) html += plain(t.slice(pos), pos);
    function label(k) {   // 字下面的小标签要短；完整说明在悬停提示里
      if (k.role === 'ref') return '参照';
      if (k.role === 'count') return k.value.replace(/^.*→\s*/, '');
      if (k.role === 'size') return k.value.replace(/^.*×/, '×');
      if (k.role === 'unknown') return '?';
      return k.value;
    }
    function plain(s, off) {
      var out = '';
      for (var i = 0; i < s.length; i++) out += (bounds[off + i] && r.level > 1 ? '<b class="cut" title="分句">|</b>' : '') + esc(s[i]);
      return '<span class="plain">' + out + '</span>';
    }
    $('sent').innerHTML = html || '<span class="muted">（空）</span>';
    var lv = C.LEVELS.filter(function (l) { return l.id === r.level; })[0];
    var notes = (r.notes || []).slice();
    $('notes').innerHTML = '<div class="lvnote">第 ' + r.level + ' 档「' + esc(lv ? lv.name : '') + '」' + (r.level > 1 ? '：切成 ' + r.clauses.length + ' 个小句' : '') + '</div>' +
      notes.map(function (n) { return '<div class="note-line">' + esc(n) + '</div>'; }).join('');
  };

  Panel.prototype.renderPlan = function () {
    var r = this.result; if (!r) return;
    var self = this, rows = '';
    var placedBy = {};
    if (this.report) this.report.placed.forEach(function (p) { placedBy[p.planId] = (placedBy[p.planId] || 0) + 1; });
    r.plan.forEach(function (it, i) {
      var color = it.color ? '<span class="sw" style="background:' + esc(it.color) + '"></span>' : '<span class="muted">默认</span>';
      var area = it.area ? C.AREA_LABELS[it.area] : '<span class="muted">随机</span>';
      if (it.nearText) area += '<div class="sub">挨着“' + esc(it.nearText) + '”</div>';
      rows += '<tr data-i="' + i + '"' + (i === self.sel ? ' class="on"' : '') + '><td>' + (i + 1) + '</td><td><b>' + esc(P.typeName(it)) + '</b>' +
        (it.type === 'custom' ? '<div class="sub">自拼 ' + it.parts.length + ' 个图元</div>' : '') + '</td><td>' + it.count + '</td><td>' + area + '</td><td>' + color +
        '</td><td>' + (it.scale ? '×' + it.scale : '<span class="muted">1</span>') + '</td><td class="why">' + esc((it.why || []).join('；')) + '</td></tr>';
    });
    $('plan-body').innerHTML = rows;
    var pj = $('plan-json');
    pj.hidden = !this.showJson;
    $('btn-json').textContent = this.showJson ? '收起 JSON' : '看 JSON';
    if (this.showJson) pj.textContent = JSON.stringify({ objects: P.cleanPlan(r.plan) }, null, 1);
  };

  Panel.prototype.renderParts = function (recOverride) {
    var it = recOverride || (this.result && this.result.plan[this.sel]);
    if (!it) { this.drawParts(null); return; }
    var parts = it.type === 'custom' || it.kind === 'custom' ? S.customParts(it.parts) : S.presetParts(it.type, it.color);
    if (!parts) return;
    if (it.type === 'custom' || it.kind === 'custom') {   // 落地 + 居中后的坐标（和 3D 里一致）
      S.buildGroup(root.THREE, parts, true);
    }
    var name = P.typeName(it);
    $('parts-title').innerHTML = '<b>' + esc(name) + '</b> 由 <span class="cnt">' + parts.length + '</span> 个基本图元拼成' +
      (it.type === 'custom' ? '（自拼物体：落地 + 水平居中）' : '（预设物体）');
    $('parts-list').innerHTML = parts.map(function (q) {
      return '<li><span class="sw" style="background:' + esc(q.c) + '"></span><b>' + esc(q.n || S.SHAPE_NAMES[q.g]) + '</b> <span class="muted">' +
        esc(S.SHAPE_NAMES[q.g]) + '</span> ' + esc(S.describe(q)) + ' <span class="muted">中心高 ' + (Math.round(q.p[1] * 100) / 100) + '</span></li>';
    }).join('');
    this.drawParts(parts);
  };

  /** 侧视图：x 横、y 竖，按真实尺寸缩放 */
  Panel.prototype.drawParts = function (parts) {
    var cv = this.partsCanvas, dpr = Math.min(root.devicePixelRatio || 1, 2);
    var w = cv.clientWidth || 160, h = cv.clientHeight || 120;
    cv.width = w * dpr; cv.height = h * dpr;
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#0c1117'; g.fillRect(0, 0, w, h);
    if (!parts || !parts.length) return;
    var minX = 1e9, maxX = -1e9, maxY = 0;
    parts.forEach(function (q) { var e = ext(q); minX = Math.min(minX, q.p[0] - e[0]); maxX = Math.max(maxX, q.p[0] + e[0]); maxY = Math.max(maxY, q.p[1] + e[1]); });
    var span = Math.max(maxX - minX, maxY, 1), sc = Math.min((w - 20) / Math.max(maxX - minX, 0.5), (h - 22) / Math.max(maxY, 0.5));
    var cx = w / 2 - (minX + maxX) / 2 * sc, gy = h - 12;
    g.strokeStyle = '#3a4a3a'; g.beginPath(); g.moveTo(6, gy); g.lineTo(w - 6, gy); g.stroke();
    parts.forEach(function (q) {
      var X = function (x) { return cx + x * sc; }, Y = function (y) { return gy - y * sc; };
      var a = q.a, px = q.p[0], py = q.p[1];
      g.fillStyle = q.c; g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1;
      g.beginPath();
      if (q.g === 'box') { g.rect(X(px - a[0] / 2), Y(py + a[1] / 2), a[0] * sc, a[1] * sc); }
      else if (q.g === 'cylinder') { g.moveTo(X(px - a[0]), Y(py + a[2] / 2)); g.lineTo(X(px + a[0]), Y(py + a[2] / 2)); g.lineTo(X(px + a[1]), Y(py - a[2] / 2)); g.lineTo(X(px - a[1]), Y(py - a[2] / 2)); g.closePath(); }
      else if (q.g === 'cone') { var rr = coneHalf(q); g.moveTo(X(px), Y(py + a[1] / 2)); g.lineTo(X(px + rr), Y(py - a[1] / 2)); g.lineTo(X(px - rr), Y(py - a[1] / 2)); g.closePath(); }
      else if (q.g === 'sphere' || q.g === 'ico') { g.arc(X(px), Y(py), a[0] * sc, 0, Math.PI * 2); }
      else if (q.g === 'circle') { g.rect(X(px - a[0]), Y(py) - 2, a[0] * 2 * sc, 4); }
      else if (q.g === 'torus') { g.lineWidth = Math.max(2, a[1] * 2 * sc); g.strokeStyle = q.c; g.arc(X(px), Y(py), a[0] * sc, 0, Math.PI * 2); g.stroke(); return; }
      g.fill(); g.stroke();
    });
    void span;
    function coneHalf(q) { return q.r && Math.abs(q.r[1]) > 0.1 && q.a[2] === 4 ? q.a[0] * Math.SQRT1_2 : q.a[0]; }
    function ext(q) {
      var a = q.a;
      switch (q.g) {
        case 'box': return [a[0] / 2, a[1] / 2];
        case 'cylinder': return [Math.max(a[0], a[1]), a[2] / 2];
        case 'cone': return [a[0], a[1] / 2];
        case 'sphere': case 'ico': return [a[0], a[0]];
        case 'circle': return [a[0], 0.1];
        case 'torus': return [a[0] + a[1], a[0] + a[1]];
      }
      return [1, 1];
    }
  };

  /** 俯视占地图：区域中心、已占地块、这一次的尝试落点 */
  Panel.prototype.drawMap = function () {
    var cv = this.mapCanvas, dpr = Math.min(root.devicePixelRatio || 1, 2);
    var w = cv.clientWidth || 300, h = cv.clientHeight || 300, side = Math.min(w, h);
    cv.width = w * dpr; cv.height = h * dpr;
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var ox = (w - side) / 2, sc = (side - 16) / 100;
    var X = function (x) { return ox + side / 2 + x * sc; }, Z = function (z) { return h / 2 + z * sc; };
    g.fillStyle = '#1b2a1b'; g.fillRect(X(-50), Z(-50), 100 * sc, 100 * sc);
    g.strokeStyle = '#2f4a2f'; g.strokeRect(X(-W.LIMIT), Z(-W.LIMIT), 2 * W.LIMIT * sc, 2 * W.LIMIT * sc);
    // 区域中心
    g.font = '11px "Microsoft YaHei","PingFang SC",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    Object.keys(W.AREAS).forEach(function (k) {
      var c = W.AREAS[k];
      g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(X(c[0]), Z(c[1]), 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#7f9a7f'; g.fillText(C.AREA_LABELS[k], X(c[0]), Z(c[1]));
    });
    var world = this.world, rep = this.report, last = {};
    if (rep) rep.placed.forEach(function (p) { last[p.x + ',' + p.z] = true; });
    if (world) world.records.forEach(function (r) {
      var isLast = last[r.x + ',' + r.z];
      g.beginPath(); g.arc(X(r.x), Z(r.z), Math.max(1.5, r.r * sc), 0, Math.PI * 2);
      g.fillStyle = isLast ? 'rgba(255,213,79,.28)' : 'rgba(200,210,220,.14)'; g.fill();
      g.strokeStyle = isLast ? '#ffd54f' : 'rgba(200,210,220,.4)'; g.lineWidth = 1; g.stroke();
    });
    if (rep) {
      var centers = {};
      rep.placed.forEach(function (p) {
        centers[p.center[0] + ',' + p.center[1]] = p.center;
        p.attempts.forEach(function (a) {
          if (a.ok) { g.fillStyle = a.forced ? '#ff9f43' : '#2dbd6e'; g.beginPath(); g.arc(X(a.x), Z(a.z), 2.4, 0, Math.PI * 2); g.fill(); }
          else { g.strokeStyle = '#ff6b6b'; g.lineWidth = 1.3; var x = X(a.x), z = Z(a.z); g.beginPath(); g.moveTo(x - 3, z - 3); g.lineTo(x + 3, z + 3); g.moveTo(x + 3, z - 3); g.lineTo(x - 3, z + 3); g.stroke(); }
        });
      });
      g.setLineDash([3, 3]); g.strokeStyle = 'rgba(79,195,247,.8)';
      Object.keys(centers).forEach(function (k) { var c = centers[k]; g.beginPath(); g.arc(X(c[0]), Z(c[1]), 3, 0, Math.PI * 2); g.stroke(); });
      g.setLineDash([]);
      $('map-stats').innerHTML = '这一句放了 <b>' + rep.placed.length + '</b> 个物体，一共试了 <b>' + rep.tries + '</b> 个落点：' +
        '<span class="ok">● 成功 ' + (rep.tries - rep.rejected) + '</span>　<span class="bad">× 被拒绝 ' + rep.rejected + '</span>' +
        (rep.fallback ? '　<span class="warn">● 试满次数后硬放 ' + rep.fallback + '</span>' : '') +
        '<br>世界里一共 <b>' + (world ? world.records.length : 0) + '</b> 个物体。';
    } else if (world) {
      $('map-stats').innerHTML = '世界里一共 <b>' + world.records.length + '</b> 个物体。';
    }
  };

  root.TTW_Panel = Panel;
})(window);
