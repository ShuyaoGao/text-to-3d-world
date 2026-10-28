/* shapes.js -- 物体 = 基本图元的组合（需要 three.js r128 的全局 THREE）。
 *
 * 预设物体（树、房子……）和项目原版 index.html 里的 BUILD 一样，只是把“怎么拼”写成了数据（PRESETS），
 * 这样右栏的理解面板可以把每个物体的图元一项项列出来、画出侧视图。
 * 自拼物体（custom，例如火山）沿用原版 buildCustom 的规则：size / pos 的含义、默认值、
 * 最多 14 个零件、最后整体“落地 + 水平居中”。tests/js/shapes.test.js 用原版代码逐个对照。
 */
(function (root) {
  'use strict';
  var P = root.TTW_PLANNER || (typeof require !== 'undefined' ? require('./planner.js') : null);
  var col = P.col;

  // g: 图元；a: three.js 构造参数；c: 颜色；cc: true = 颜色可被句子里的颜色词替换；p: 中心位置；r: 旋转
  var PRESETS = {
    tree: [
      { g: 'cylinder', a: [0.16, 0.22, 1.2, 7], c: '#8a5a3b', p: [0, 0.6, 0], n: '树干' },
      { g: 'cone', a: [1.05, 1.8, 8], c: '#4f9d54', cc: true, p: [0, 2.0, 0], n: '下层树冠' },
      { g: 'cone', a: [0.8, 1.4, 8], c: '#5aab5a', cc: true, p: [0, 2.9, 0], n: '上层树冠' }],
    house: [
      { g: 'box', a: [2, 1.6, 2], c: '#e8ddc8', cc: true, p: [0, 0.8, 0], n: '墙体' },
      { g: 'cone', a: [1.7, 1.3, 4], c: '#b4543b', p: [0, 2.25, 0], r: [0, Math.PI / 4, 0], n: '屋顶（四棱锥）' },
      { g: 'box', a: [0.55, 0.95, 0.1], c: '#6b4a32', p: [0, 0.48, 1.0], n: '门' }],
    tower: [
      { g: 'cylinder', a: [0.85, 1.0, 4.2, 10], c: '#cfc7b6', cc: true, p: [0, 2.1, 0], n: '塔身' },
      { g: 'cone', a: [1.25, 1.6, 10], c: '#7a8fb0', p: [0, 5.0, 0], n: '塔顶' }],
    mountain: [
      { g: 'cone', a: [5, 6.5, 6], c: '#9b9382', cc: true, p: [0, 3.25, 0], n: '山体' },
      { g: 'cone', a: [2.0, 2.0, 6], c: '#f3f3ee', p: [0, 5.4, 0], n: '雪顶' }],
    water: [
      { g: 'circle', a: [4.2, 28], c: '#4aa3d6', cc: true, p: [0, 0.06, 0], r: [-Math.PI / 2, 0, 0], m: 'water', noShadow: true, n: '水面（圆片）' }],
    rock: [
      { g: 'ico', a: [0.95, 0], c: '#9aa0a6', cc: true, p: [0, 0.75, 0], r: [0.4, 0.8, 0.2], n: '石块（二十面体）' }],
    flower: [
      { g: 'cylinder', a: [0.05, 0.05, 1, 5], c: '#4f9d54', p: [0, 0.5, 0], n: '花茎' },
      { g: 'sphere', a: [0.32, 10, 8], c: '#e985a6', cc: true, p: [0, 1.05, 0], n: '花瓣' },
      { g: 'sphere', a: [0.14, 8, 6], c: '#f2c037', p: [0, 1.05, 0], n: '花心' }],
    person: [
      { g: 'cylinder', a: [0.3, 0.38, 1.1, 8], c: '#5a82c4', cc: true, p: [0, 0.55, 0], n: '身体' },
      { g: 'sphere', a: [0.34, 12, 10], c: '#e8b98f', p: [0, 1.32, 0], n: '头' }],
    box: [{ g: 'box', a: [1.3, 1.3, 1.3], c: '#d99a4e', cc: true, p: [0, 0.65, 0], n: '立方体' }],
    sphere: [{ g: 'sphere', a: [0.85, 18, 14], c: '#7c6fd0', cc: true, p: [0, 0.85, 0], n: '球' }],
    cylinder: [{ g: 'cylinder', a: [0.6, 0.6, 1.5, 14], c: '#46b59c', cc: true, p: [0, 0.75, 0], n: '圆柱' }],
    cone: [{ g: 'cone', a: [0.85, 1.7, 16], c: '#e2574c', cc: true, p: [0, 0.85, 0], n: '圆锥' }]
  };

  var SHAPE_NAMES = { box: '立方体', cone: '圆锥', cylinder: '圆柱', sphere: '球', torus: '圆环', circle: '圆片', ico: '二十面体' };

  /** 预设物体 -> 零件表（已代入颜色） */
  function presetParts(type, color) {
    var src = PRESETS[type];
    if (!src) return null;
    return src.map(function (q) {
      var o = JSON.parse(JSON.stringify(q));
      o.c = q.cc ? col(color, q.c) : q.c;
      return o;
    });
  }

  /** 自拼物体（原版 buildCustom 的输入格式）-> 零件表；落地 + 居中在 buildGroup 里做 */
  function customParts(parts) {
    return (parts || []).slice(0, 14).map(function (p) {
      var c = col(p.color, '#b9b6ac');
      var shape = (p.shape || 'box').toLowerCase();
      var s = (Array.isArray(p.size) ? p.size : []).map(function (n) { return Math.max(0.05, Math.min(14, +n || 1)); });
      var pos = Array.isArray(p.pos) ? p.pos : [0, 0, 0];
      var yBase = +pos[1] || 0, h = 1, q;
      if (shape === 'cone') { var r = s[0] || 1; h = s[1] || 2; q = { g: 'cone', a: [r, h, p.seg || 10] }; }
      else if (shape === 'cylinder') { var r2 = s[0] || 0.6; h = s[1] || 1.4; q = { g: 'cylinder', a: [r2, r2, h, p.seg || 14] }; }
      else if (shape === 'sphere') { var r3 = s[0] || 0.8; h = r3 * 2; q = { g: 'sphere', a: [r3, 16, 12] }; }
      else if (shape === 'torus') { var r4 = s[0] || 1, tube = s[1] || Math.max(0.12, r4 * 0.3); h = tube * 2; q = { g: 'torus', a: [r4, tube, 10, 22] }; }
      else { var w = s[0] || 1, hh = s[1] || 1, d = s[2] || s[0] || 1; h = hh; q = { g: 'box', a: [w, hh, d] }; }
      q.c = c; q.p = [+pos[0] || 0, yBase + h / 2, +pos[2] || 0]; q.custom = true;
      q.n = SHAPE_NAMES[q.g];
      return q;
    });
  }

  function geometry(T, q) {
    var a = q.a;
    switch (q.g) {
      case 'cylinder': return new T.CylinderGeometry(a[0], a[1], a[2], a[3]);
      case 'cone': return new T.ConeGeometry(a[0], a[1], a[2]);
      case 'box': return new T.BoxGeometry(a[0], a[1], a[2]);
      case 'sphere': return new T.SphereGeometry(a[0], a[1], a[2]);
      case 'circle': return new T.CircleGeometry(a[0], a[1]);
      case 'ico': return new T.IcosahedronGeometry(a[0], a[1]);
      case 'torus': return new T.TorusGeometry(a[0], a[1], a[2], a[3]);
    }
    throw new Error('unknown shape ' + q.g);
  }

  function material(T, q) {
    if (q.m === 'water') return new T.MeshStandardMaterial({ color: q.c, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.88 });
    return new T.MeshStandardMaterial({ color: q.c, roughness: 0.85, flatShading: true });
  }

  /** 零件表 -> THREE.Group（custom 会整体落地 + 水平居中，和原版一样） */
  function buildGroup(T, parts, isCustom) {
    var g = new T.Group();
    parts.forEach(function (q) {
      var m = new T.Mesh(geometry(T, q), material(T, q));
      m.position.set(q.p[0], q.p[1], q.p[2]);
      if (q.r) m.rotation.set(q.r[0], q.r[1], q.r[2]);
      if (!q.noShadow) m.castShadow = true;
      m.userData.part = q;
      g.add(m);
    });
    if (isCustom && g.children.length) {
      var box = new T.Box3().setFromObject(g);
      var dx = (box.min.x + box.max.x) / 2, dy = box.min.y, dz = (box.min.z + box.max.z) / 2;
      if (isFinite(dx) && isFinite(dy) && isFinite(dz)) {
        g.children.forEach(function (m) {
          m.position.x -= dx; m.position.y -= dy; m.position.z -= dz;
          var q = m.userData.part; q.p = [m.position.x, m.position.y, m.position.z];
        });
      }
    }
    return g;
  }

  /** 计划里的一项 -> {parts, group} */
  function build(T, rec) {
    var isCustom = rec.type === 'custom' || rec.kind === 'custom';
    var parts = isCustom ? customParts(rec.parts) : presetParts(rec.type, rec.color);
    if (!parts) return null;
    var g = buildGroup(T, parts, isCustom);
    return { parts: parts, group: g };
  }

  /** 占地半径：x / z 方向最大跨度的一半（原版 place() 的算法） */
  function footprintRadius(T, group) {
    var box = new T.Box3().setFromObject(group);
    return Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  }

  /** 给面板用：零件的人话描述 */
  function describe(q) {
    var a = q.a, f = function (v) { return (Math.round(v * 100) / 100).toString(); };
    switch (q.g) {
      case 'cylinder': return a[0] === a[1] ? '半径 ' + f(a[0]) + '，高 ' + f(a[2]) : '上半径 ' + f(a[0]) + ' / 下半径 ' + f(a[1]) + '，高 ' + f(a[2]);
      case 'cone': return '底半径 ' + f(a[0]) + '，高 ' + f(a[1]) + (a[2] <= 6 ? '（' + a[2] + ' 棱）' : '');
      case 'box': return f(a[0]) + ' × ' + f(a[1]) + ' × ' + f(a[2]);
      case 'sphere': return '半径 ' + f(a[0]);
      case 'circle': return '半径 ' + f(a[0]) + '，平铺在地面';
      case 'ico': return '半径 ' + f(a[0]);
      case 'torus': return '环半径 ' + f(a[0]) + '，粗 ' + f(a[1]);
    }
    return '';
  }

  var api = { PRESETS: PRESETS, SHAPE_NAMES: SHAPE_NAMES, presetParts: presetParts, customParts: customParts,
    buildGroup: buildGroup, build: build, footprintRadius: footprintRadius, describe: describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TTW_SHAPES = api;
})(typeof window !== 'undefined' ? window : globalThis);
