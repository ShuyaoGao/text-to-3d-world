// 测试公共：在 Node 里加载 play/ 下的 three.js 和页面脚本（和浏览器用的是同一份文件）。
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const PLAY = path.join(ROOT, 'play');
globalThis.window = globalThis;
globalThis.THREE = require(path.join(PLAY, 'vendor', 'three.min.js'));
require(path.join(PLAY, 'js', 'config.js'));
globalThis.TTW_PLANNER = require(path.join(PLAY, 'js', 'planner.js'));
globalThis.TTW_SHAPES = require(path.join(PLAY, 'js', 'shapes.js'));
const W = require(path.join(PLAY, 'js', 'world.js'));

/** 从项目原版 index.html 里取出指定代码段（原样），在沙箱里运行，用来和移植后的代码逐项对照。 */
function originalSource() {
  const p = path.join(ROOT, 'index.html');
  if (!fs.existsSync(p)) return null;     // 公开仓库里原版是 app/index_full.html
  const s = fs.readFileSync(p, 'utf8');
  if (s.indexOf('// ================= world') < 0) return null;   // 公开仓库根目录的 index.html 只是跳转页，不是原版
  return s;
}
function originalPage() {
  const a = originalSource() || fs.readFileSync(path.join(ROOT, 'app', 'index_full.html'), 'utf8');
  return a;
}
function slice(src, from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i + 1);
  if (i < 0 || j < 0) throw new Error('marker not found: ' + from + ' / ' + to);
  return src.slice(i, j);
}
/** 原版的 NAMED / col / mat / shadowAll / BUILD / buildCustom / VOLCANO / KW / localPlan */
function loadOriginal(randomFn) {
  const src = originalPage();
  const code = [
    slice(src, '// ================= colors / material', '// ================= world'),
    slice(src, '// ===== 本地关键词兜底', '// ================= UI'),
    'this.__o = { NAMED, col, BUILD, buildCustom, VOLCANO, KW, localPlan, hasKeyword };',
  ].join('\n');
  const ctx = { THREE: globalThis.THREE, Math: Object.create(Math), JSON, console };
  if (randomFn) ctx.Math.random = randomFn;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.__o;
}

module.exports = { ROOT, PLAY, THREE: globalThis.THREE, P: globalThis.TTW_PLANNER, S: globalThis.TTW_SHAPES, W, C: globalThis.TTW_CONFIG, loadOriginal };
