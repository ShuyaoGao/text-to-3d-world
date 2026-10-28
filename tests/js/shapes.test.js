// 图元与摆放测试：预设物体的几何 = 原版 BUILD；自拼物体 = 原版 buildCustom；摆放不越界、不重叠。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { THREE, P, S, W, C, loadOriginal } = require('./_load.js');

function meshes(g) { const out = []; g.traverse((o) => { if (o.isMesh) out.push(o); }); return out; }
function sig(m) {
  const p = m.geometry.parameters;
  return {
    geo: m.geometry.type, params: JSON.parse(JSON.stringify(p)),
    pos: m.position.toArray().map((v) => +v.toFixed(6)), rot: [m.rotation.x, m.rotation.y, m.rotation.z].map((v) => +v.toFixed(6)),
    color: m.material.color.getHexString(), rough: m.material.roughness, flat: !!m.material.flatShading,
    transparent: !!m.material.transparent, opacity: m.material.opacity, metal: m.material.metalness, shadow: !!m.castShadow,
  };
}
function box(g) { const b = new THREE.Box3().setFromObject(g); return [b.min.toArray(), b.max.toArray()].flat().map((v) => +v.toFixed(6)); }

test('预设物体与原版 BUILD 逐个零件相同（几何、位置、旋转、材质、颜色、阴影）', () => {
  const O = loadOriginal();
  for (const type of Object.keys(O.BUILD)) {
    for (const color of [null, '红', '#123456', 'blue']) {
      const orig = O.BUILD[type](color);
      const mine = S.build(THREE, { type, color }).group;
      assert.deepEqual(meshes(mine).map(sig), meshes(orig).map(sig), type + ' / ' + color);
      assert.deepEqual(box(mine), box(orig), type + ' bbox');
    }
  }
  assert.deepEqual(Object.keys(S.PRESETS).sort(), Object.keys(O.BUILD).sort());
});

test('自拼物体与原版 buildCustom 相同（含默认值、上限、落地居中）', () => {
  const O = loadOriginal();
  const cases = [
    O.VOLCANO.parts,
    [{ shape: 'torus', color: '红', size: [2], pos: [0, 6, 0] }, { shape: 'box', size: [1, 2], pos: [3, 1, -2] }],
    [{ shape: 'sphere', color: 'blue', size: [0], pos: [1, 2, 3] }, { shape: 'cylinder', size: [99, 0.01] }, { shape: 'cone' }, { shape: 'unknown' }],
    Array.from({ length: 20 }, (_, i) => ({ shape: 'box', size: [1, 1, 1], pos: [i, 0, 0] })),
  ];
  for (const parts of cases) {
    const orig = O.buildCustom(JSON.parse(JSON.stringify(parts)));
    const mine = S.build(THREE, { type: 'custom', parts: JSON.parse(JSON.stringify(parts)) }).group;
    assert.deepEqual(meshes(mine).map(sig), meshes(orig).map(sig));
  }
});

test('摆放：坐标不出界，除“试满次数硬放”以外两两不重叠', () => {
  const w = new W.World(THREE, 7);
  for (const d of C.DEMO) w.run(P.plan(d.text, 4, w.rng).plan);
  w.run(P.plan('十五棵树，十五块石头，十五朵花', 4, w.rng).plan);
  assert.ok(w.records.length > 40);
  for (const r of w.records) { assert.ok(Math.abs(r.x) <= 46 && Math.abs(r.z) <= 46); }
  for (let i = 0; i < w.records.length; i++) {
    const a = w.records[i];
    if (a.fallback) continue;
    for (let j = 0; j < i; j++) {
      const b = w.records[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > (a.r + b.r) * 0.85 - 1e-9, `overlap ${i}/${j}`);
    }
  }
});

test('摆放：数量上限 15、大小范围 0.4–3（与原版 place() 相同）', () => {
  const w = new W.World(THREE, 3);
  const rep = w.run([{ type: 'tree', count: 99, scale: 10 }, { type: 'rock', count: 0, scale: 0.01 }, { type: 'nothing', count: 3 }]);
  assert.equal(rep.placed.filter((r) => r.type === 'tree').length, 15);
  assert.equal(rep.placed.filter((r) => r.type === 'rock').length, 1);
  assert.equal(rep.placed.length, 16);
  for (const r of rep.placed) {
    if (r.type === 'tree') assert.ok(r.s >= 3 * 0.85 - 1e-9 && r.s <= 3 * 1.15 + 1e-9);
    if (r.type === 'rock') assert.ok(r.s >= 0.4 * 0.85 - 1e-9 && r.s <= 0.4 * 1.15 + 1e-9);
  }
});

test('相对位置：“山下的森林”和火山用同一个区域中心', () => {
  const w = new W.World(THREE, 11);
  const rep = w.run(P.plan(C.DEMO[0].text, 4, w.rng).plan);
  const v = rep.placed.find((r) => r.type === 'custom'), t = rep.placed.find((r) => r.type === 'tree');
  assert.deepEqual(t.center, v.center);
});

test('存档：serialize -> load 得到同样的配方', () => {
  const w = new W.World(THREE, 5); w.run(P.plan('湖边三棵树和一座红房子', 4, w.rng).plan);
  const w2 = new W.World(THREE, 5); w2.load(w.serialize());
  assert.deepEqual(w2.serialize(), w.serialize());
});
