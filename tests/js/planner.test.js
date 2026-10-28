// 规则引擎测试：第 1 档 = 原版关键词引擎；第 2–4 档的分句 / 数量 / 方位 / 相对位置。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { P, C, W, loadOriginal } = require('./_load.js');

const CORPUS = [
  '北边一座火山，山下一片森林，东边有个湖', '中间一座高塔，周围五间红房子，南边几个人在散步',
  '西南有一片花海，花丛旁边三块石头，东北一座雪山', '河上有一座拱桥，岸边两棵大树', '湖边三棵树和一座红房子',
  '一座金色的塔和许多气球', 'A red house near the lake with trees', '城堡旁边有蓝色的池塘', '树林里有箱子和球',
  '雪山脚下的小屋', 'mountain and river', '紫色的花', '三个方块', '一群人围着一座塔',
];

test('第 1 档与原版 index.html 的关键词引擎逐项相同', () => {
  const O = loadOriginal(() => 0.5);
  for (const t of CORPUS) {
    const mine = JSON.parse(JSON.stringify(P.rawPlan(P.plan(t, 1, () => 0.5).plan)));
    const orig = JSON.parse(JSON.stringify(O.localPlan(t)));
    assert.deepEqual(mine, orig, t);
  }
});

test('第 1 档：没有认得的词时，和原版一样随机放 4 个基本形状', () => {
  for (const r of [0, 0.3, 0.6, 0.99]) {
    const O = loadOriginal(() => r);
    const t = '一只猫在睡觉';
    assert.deepEqual(JSON.parse(JSON.stringify(P.rawPlan(P.plan(t, 1, () => r).plan))), JSON.parse(JSON.stringify(O.localPlan(t))));
  }
});

test('颜色函数与原版相同', () => {
  const O = loadOriginal();
  for (const c of ['红', '红色的塔', 'blue', 'Gold', '#123456', '没有颜色', '', null, '青山']) assert.equal(P.col(c, 'D'), O.col(c, 'D'), String(c));
  assert.deepEqual(P.NAMED, JSON.parse(JSON.stringify(O.NAMED)));
});

function brief(text, level) {
  return P.cleanPlan(P.plan(text, level, () => 0.5).plan).map((x) => [x.type, x.count, x.area || '-', x.near || '']);
}

test('第 4 档：演示句子的理解结果', () => {
  assert.deepEqual(brief('北边一座火山，山下一片森林，东边有个湖', 4),
    [['custom', 1, 'north', ''], ['tree', 10, 'north', '山下'], ['water', 1, 'east', '']]);
  assert.deepEqual(brief('中间一座高塔，周围五间红房子，南边几个人在散步', 4),
    [['tower', 1, 'center', ''], ['house', 5, 'center', '上一句的塔'], ['person', 4, 'south', '']]);
  assert.deepEqual(brief('西南有一片花海，花丛旁边三块石头，东北一座雪山', 4),
    [['flower', 12, 'southwest', ''], ['rock', 3, 'southwest', '花丛旁边'], ['mountain', 1, 'northeast', '']]);
  assert.deepEqual(brief('湖边三棵树和一座红房子', 4), [['water', 1, '-', ''], ['tree', 3, '-', '湖边'], ['house', 1, '-', '']]);
  const r = P.plan('河上有一座拱桥，岸边两棵大树', 4, () => 0.5);
  assert.deepEqual(r.tokens.filter((t) => t.role === 'unknown').map((t) => r.text.slice(t.s, t.e)), ['拱桥']);
});

test('档位逐级增加能力：第 2 档有数量没方位，第 3 档有方位，第 4 档才懂“山下”', () => {
  const t = '北边一座火山，山下一片森林，东边有个湖';
  const l2 = brief(t, 2), l3 = brief(t, 3), l4 = brief(t, 4);
  assert.ok(l2.every((x) => x[2] === '-'));
  assert.equal(l2.length, 4);   // 多出一座“山”
  assert.deepEqual(l3.map((x) => x[2]), ['north', '-', '-', 'east']);
  assert.equal(l4.length, 3);
});

test('数量：中文数字、量词、“一片 / 几个 / 许多”', () => {
  assert.equal(P.cnNumber('三'), 3); assert.equal(P.cnNumber('两'), 2); assert.equal(P.cnNumber('十'), 10);
  assert.equal(P.cnNumber('十五'), 15); assert.equal(P.cnNumber('二十'), 20); assert.equal(P.cnNumber('二十三'), 23);
  assert.equal(P.cnNumber('12'), 12); assert.equal(P.cnNumber('几'), 4); assert.equal(P.cnNumber('许多'), -1);
  assert.deepEqual(brief('三棵树', 2), [['tree', 3, '-', '']]);
  assert.deepEqual(brief('二十个人', 2), [['person', 15, '-', '']]);    // 最多 15（与原版 place() 的上限一致）
  assert.deepEqual(brief('一片花', 2), [['flower', 12, '-', '']]);
  assert.deepEqual(brief('许多气球', 2), [['sphere', 5, '-', '']]);
  assert.deepEqual(brief('一棵树', 2), [['tree', 1, '-', '']]);
  assert.deepEqual(brief('树', 2), [['tree', 3, '-', '']]);              // 没写数量 -> 默认（与原版相同）
});

test('方位、颜色、大小', () => {
  const r = P.plan('东北角有一座高高的红色塔', 4, () => 0.5).plan[0];
  assert.equal(r.area, 'northeast'); assert.equal(r.color, '#e2574c'); assert.equal(r.scale, 1.6);
  assert.equal(P.plan('西边一座小房子', 4, () => 0.5).plan[0].scale, 0.65);
  assert.equal(P.plan('左边一棵树', 4, () => 0.5).plan[0].area, 'west');
  assert.equal(P.plan('5 trees in the north and a red house', 4, () => 0.5).plan[1].color, '#e2574c');
});

test('最长匹配：“火山”不是“山”，“树林”不是“树”', () => {
  assert.deepEqual(brief('一座火山', 2).map((x) => x[0]), ['custom']);
  assert.deepEqual(brief('一片树林', 2), [['tree', 10, '-', '']]);
  assert.deepEqual(brief('一座雪山', 2).map((x) => x[0]), ['mountain']);
});

test('演示句子与练习任务配置完整', () => {
  assert.ok(C.DEMO.length >= 3);
  const ids = C.TASKS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(C.LEVELS.map((l) => l.id), [1, 2, 3, 4]);
  for (const d of C.DEMO) assert.ok(P.plan(d.text, 4, () => 0.5).plan.length >= 2, d.text);
});

test('同一句话、同一种子 -> 同一个世界；换种子 -> 换摆法', () => {
  const run = (seed) => { const w = new W.World(THREE, seed); w.run(P.plan(C.DEMO[0].text, 4, w.rng).plan); return w.serialize(); };
  assert.deepEqual(run(11), run(11));
  assert.notDeepEqual(run(11), run(12));
});
