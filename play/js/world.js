/* world.js -- 把生成计划摆进世界：数量 / 大小 / 方位 -> 具体坐标（需要 three.js 量占地半径）。
 *
 * 摆放算法照搬原版 index.html 的 place() / findSpot()：
 *   方位 -> 区域中心；散布半径 = 3 + 数量 × 0.9；每个物体先量占地半径，再“拒绝采样”找一个
 *   不和已有物体重叠的落点（两圆心距离 > (r1 + r2) × 松紧系数，原版系数 0.85、最多试 26 次）。
 * 和原版的区别：随机数用固定种子（同一句话、同一种子 -> 同一个世界），并把每次尝试记下来给俯视图画。
 * 另外第 4 档的“山下 / 湖边”会把物体放到被参照物体用过的中心附近。
 */
(function (root) {
  'use strict';
  var S = root.TTW_SHAPES || (typeof require !== 'undefined' ? require('./shapes.js') : null);

  var AREAS = { center: [0, 0], north: [0, -26], south: [0, 26], east: [26, 0], west: [-26, 0],
    northeast: [20, -20], northwest: [-20, -20], southeast: [20, 20], southwest: [-20, 20] };
  var LIMIT = 46;

  /** mulberry32：小而确定的伪随机数（种子相同 -> 序列相同） */
  function makeRng(seed) {
    var a = (seed >>> 0) || 1;
    var f = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return f;
  }

  function clampXZ(v) { return Math.max(-LIMIT, Math.min(LIMIT, v)); }

  function World(T, seed, opts) {
    this.T = T;
    this.reset(seed, opts);
  }
  World.prototype.reset = function (seed, opts) {
    this.seed = seed;
    this.rng = makeRng(seed);
    this.records = [];       // 已放置物体的“配方”
    this.footprints = [];    // {x, z, r}
    this.centers = {};       // 计划项 id -> 用过的区域中心（相对位置用）
    this.opts = Object.assign({ overlap: 0.85, tries: 26 }, opts || {});
    this.lastReport = null;
  };

  /** 拒绝采样（原版 findSpot），返回 {x, z, attempts:[{x,z,ok}], fallback} */
  World.prototype.findSpot = function (cx, cz, spread, r) {
    var rng = this.rng, att = [], fp = this.footprints, k_ = this.opts.overlap;
    for (var k = 0; k < this.opts.tries; k++) {
      var a = rng() * Math.PI * 2, d = rng() * (spread + k * 0.7);
      var x = clampXZ(cx + Math.cos(a) * d), z = clampXZ(cz + Math.sin(a) * d);
      var ok = fp.every(function (f) { return Math.hypot(f.x - x, f.z - z) > (f.r + r) * k_; });
      att.push({ x: x, z: z, ok: ok });
      if (ok) return { x: x, z: z, attempts: att, fallback: false };
    }
    var a2 = rng() * Math.PI * 2, d2 = rng() * spread;
    var fx = clampXZ(cx + Math.cos(a2) * d2), fz = clampXZ(cz + Math.sin(a2) * d2);
    att.push({ x: fx, z: fz, ok: true, forced: true });
    return { x: fx, z: fz, attempts: att, fallback: true };
  };

  /** 摆一项计划（原版 place）。返回这一项生成的配方列表 + 尝试记录 */
  World.prototype.place = function (item) {
    var T = this.T, type = item.type, out = [];
    if (type === 'custom' && (!item.parts || !item.parts.length)) return out;
    if (type !== 'custom' && !S.PRESETS[type]) return out;
    var count = Math.max(1, Math.min(15, (item.count | 0) || 1));
    var scale = Math.max(0.4, Math.min(3, +item.scale || 1));
    var center;
    if (item.near != null && this.centers[item.near]) center = this.centers[item.near];
    else center = AREAS[item.area] || [(this.rng() - 0.5) * 50, (this.rng() - 0.5) * 50];
    if (item._id != null) this.centers[item._id] = center;
    var spread = 3 + count * 0.9;
    for (var i = 0; i < count; i++) {
      var s = scale * (0.85 + this.rng() * 0.3);
      var probe = S.build(T, { type: type, kind: type === 'custom' ? 'custom' : 'preset', color: item.color, parts: item.parts });
      var r = S.footprintRadius(T, probe.group) * s || 1;
      var spot = this.findSpot(center[0], center[1], spread, r);
      var rec = { kind: type === 'custom' ? 'custom' : 'preset', type: type, key: item.key || null, color: item.color || null,
        parts: type === 'custom' ? item.parts : null, x: spot.x, z: spot.z, s: s, r: r, rot: this.rng() * Math.PI * 2,
        planId: item._id, attempts: spot.attempts, fallback: spot.fallback, center: center };
      this.records.push(rec);
      this.footprints.push({ x: rec.x, z: rec.z, r: rec.r });
      out.push(rec);
    }
    return out;
  };

  /** 摆整份计划；返回报告（给理解面板） */
  World.prototype.run = function (plan) {
    var placed = [], self = this;
    (plan || []).forEach(function (it) { if (it && it.type) placed = placed.concat(self.place(it)); });
    var tries = 0, rejected = 0, fallback = 0;
    placed.forEach(function (r) { tries += r.attempts.length; rejected += r.attempts.filter(function (a) { return !a.ok; }).length; if (r.fallback) fallback++; });
    this.lastReport = { placed: placed, tries: tries, rejected: rejected, fallback: fallback };
    return this.lastReport;
  };

  World.prototype.remove = function (rec) {
    var i = this.records.indexOf(rec);
    if (i >= 0) this.records.splice(i, 1);
    var fi = this.footprints.findIndex(function (f) { return f.x === rec.x && f.z === rec.z && f.r === rec.r; });
    if (fi >= 0) this.footprints.splice(fi, 1);
  };

  /** 存档用：只留配方 */
  World.prototype.serialize = function () {
    return this.records.map(function (r) { return { kind: r.kind, type: r.type, key: r.key, color: r.color, parts: r.parts, x: r.x, z: r.z, s: r.s, r: r.r, rot: r.rot }; });
  };
  World.prototype.load = function (arr) {
    var self = this;
    (arr || []).forEach(function (r) {
      if (!r || typeof r.x !== 'number') return;
      var rec = Object.assign({ attempts: [], fallback: false }, r);
      self.records.push(rec); self.footprints.push({ x: rec.x, z: rec.z, r: rec.r });
    });
  };

  var api = { World: World, AREAS: AREAS, makeRng: makeRng, LIMIT: LIMIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TTW_WORLD = api;
})(typeof window !== 'undefined' ? window : globalThis);
