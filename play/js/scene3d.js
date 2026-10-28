/* scene3d.js -- 3D 场景：渲染、视角操作、生长动画、昼夜 / 摇曳 / 散步动效、点选。
 * 画面效果沿用原版 index.html（灯光、雾、地面、生长的 easeOutBack、昼夜循环），
 * 改动：画布放进左栏容器（随容器大小变化）、动效随机数用固定种子、键盘 WASD 在输入框里打字时不触发、
 * 地面加了“北 / 南 / 东 / 西”方位标、可以随时停止（退出按钮）。
 */
(function (root) {
  'use strict';
  var S = root.TTW_SHAPES, W = root.TTW_WORLD;

  function Scene3D(container, opts) {
    this.container = container;
    this.opts = opts || {};
    this.T = root.THREE;
    this.ok = false;
    this.groups = [];          // {g, rec}
    this.growing = [];
    this.keys = {};
    this.autoOrbit = false;
    this.running = false;
    this.listeners = [];
    this.fxRng = W.makeRng(20261012);
    this.frames = 0;
    try { this._init(); this.ok = true; }
    catch (e) {
      this.error = String(e && e.message || e);
      container.innerHTML = '<div class="nogl">这个浏览器没能启动 3D 画面（WebGL）。<br>右边的理解面板照常可用；换用最新版 Edge / Chrome / Safari 再试。</div>';
    }
  }

  Scene3D.prototype._on = function (el, ev, fn, o) { el.addEventListener(ev, fn, o); this.listeners.push([el, ev, fn, o]); };

  Scene3D.prototype._init = function () {
    var T = this.T, self = this;
    if (!T) throw new Error('three.js 没有加载');
    var scene = this.scene = new T.Scene();
    scene.background = new T.Color('#bfe3f0');
    scene.fog = new T.Fog('#bfe3f0', 70, 160);
    var w = Math.max(10, this.container.clientWidth), h = Math.max(10, this.container.clientHeight);
    this.camera = new T.PerspectiveCamera(50, w / h, 0.1, 600);
    var renderer = this.renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!this.opts.preserve });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.container.appendChild(renderer.domElement);

    this.hemi = new T.HemisphereLight('#dff1ff', '#8a8b6a', 0.95); scene.add(this.hemi);
    var sun = this.sun = new T.DirectionalLight('#fff4e0', 1.0);
    sun.position.set(34, 52, 22); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -70; sun.shadow.camera.right = 70; sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 200; sun.shadow.bias = -0.0004;
    scene.add(sun);
    var ground = new T.Mesh(new T.PlaneGeometry(400, 400), new T.MeshStandardMaterial({ color: '#a9c47f', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    this._compass();

    this.target = new T.Vector3(0, 1, 0);
    this.radius = 50; this.theta = 0.9; this.phi = 0.95;
    this.updateCam();

    // 视角操作：鼠标、手指、触控笔都走 Pointer Events。单指（或鼠标）拖动 = 转视角；双指张合 = 缩放；
    // 轻点 = 选物体。手机上 #view 有 touch-action: none，所以拖动不会滚动页面；
    // 所有手指离开 / 事件被取消 / 窗口失焦时全部复位（DevTools 模拟多指时“只抬起一根手指”的序列不稳定，这是保险）。
    var dom = renderer.domElement, pointers = new Map(), lastPinch = 0, down = null;
    this.pointerCount = function () { return pointers.size; };
    this.releasePointers = function () { pointers.clear(); lastPinch = 0; down = null; };
    this._on(dom, 'pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); lastPinch = 0;
      down = pointers.size === 1 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
      try { dom.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      self.autoOrbit = false; if (self.onUserMove) self.onUserMove('drag');
    });
    this._on(dom, 'pointerup', function (e) {
      pointers.delete(e.pointerId); lastPinch = 0;
      if (down && down.id === e.pointerId && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && self.onClick) self.onClick(e.clientX, e.clientY);
      down = null;
      if (pointers.size === 0) self.releasePointers();
    });
    this._on(dom, 'pointercancel', function () { self.releasePointers(); });
    this._on(dom, 'pointermove', function (e) {
      var p = pointers.get(e.pointerId); if (!p) return;
      var dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 1) { self.theta -= dx * 0.005; self.phi -= dy * 0.005; self.updateCam(); }
      else if (pointers.size === 2) {
        var a = Array.from(pointers.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (lastPinch) { self.radius *= 1 - (d - lastPinch) * 0.005; self.updateCam(); } lastPinch = d;
      }
    });
    this._on(dom, 'touchmove', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });   // 老浏览器的保险：不让页面跟着手指滚
    this._on(dom, 'touchend', function (e) { if (!e.touches || e.touches.length === 0) self.releasePointers(); });
    this._on(root, 'blur', function () { self.releasePointers(); });
    this._on(document, 'visibilitychange', function () { if (document.hidden) self.releasePointers(); });
    this._on(dom, 'wheel', function (e) { e.preventDefault(); self.radius *= 1 + e.deltaY * 0.0011; self.updateCam(); if (self.onUserMove) self.onUserMove('wheel'); }, { passive: false });
    var typing = function (e) { var t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
    this._on(root, 'keydown', function (e) { if (!typing(e)) { var k = e.key.toLowerCase(); if ('wasd'.indexOf(k) >= 0 || k.indexOf('arrow') === 0) self.keys[k] = true; } });
    this._on(root, 'keyup', function (e) { self.keys[e.key.toLowerCase()] = false; });
    this._on(root, 'blur', function () { self.keys = {}; });
    if (root.ResizeObserver) { this.ro = new ResizeObserver(function () { self.resize(); }); this.ro.observe(this.container); }
    else this._on(root, 'resize', function () { self.resize(); });

    this.SKY_DAY = new T.Color('#bfe3f0'); this.SKY_DUSK = new T.Color('#f4d8b4');
    this.clock = new T.Clock();
    this.ray = new T.Raycaster(); this.ndc = new T.Vector2();
    this.start();
  };

  // 地面上的方位标：让“北边 / 东南”这些词和画面对得上
  Scene3D.prototype._compass = function () {
    var T = this.T, self = this;
    this.compass = new T.Group();
    [['北', 0, -44], ['南', 0, 44], ['东', 44, 0], ['西', -44, 0]].forEach(function (d) {
      var cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
      var cx = cv.getContext('2d');
      cx.fillStyle = 'rgba(255,255,255,0.85)'; cx.beginPath(); cx.arc(64, 64, 54, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = '#3a4a3a'; cx.font = 'bold 72px "Microsoft YaHei","PingFang SC",sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillText(d[0], 64, 68);
      var tex = new T.CanvasTexture(cv);
      var sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthWrite: false }));
      sp.position.set(d[1], 2.2, d[2]); sp.scale.set(4.5, 4.5, 1);
      self.compass.add(sp);
    });
    this.scene.add(this.compass);
  };
  Scene3D.prototype.setCompass = function (on) { if (this.compass) this.compass.visible = !!on; };

  Scene3D.prototype.updateCam = function () {
    this.phi = Math.max(0.18, Math.min(1.45, this.phi));
    this.radius = Math.max(12, Math.min(140, this.radius));
    var t = this.target;
    this.camera.position.set(t.x + this.radius * Math.sin(this.phi) * Math.cos(this.theta),
      t.y + this.radius * Math.cos(this.phi), t.z + this.radius * Math.sin(this.phi) * Math.sin(this.theta));
    this.camera.lookAt(t);
  };

  Scene3D.prototype.resetView = function () { this.target.set(0, 1, 0); this.radius = 50; this.theta = 0.9; this.phi = 0.95; this.updateCam(); };

  Scene3D.prototype.resize = function () {
    if (!this.renderer) return;
    var w = Math.max(10, this.container.clientWidth), h = Math.max(10, this.container.clientHeight);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h);
  };

  function easeOutBack(t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

  /** 把一条配方变成 3D 物体（anim=true 播放生长动画） */
  Scene3D.prototype.spawn = function (rec, anim, delay) {
    if (!this.ok) return null;
    var b = S.build(this.T, rec); if (!b) return null;
    var g = b.group;
    g.userData.rec = rec; g.userData.s = rec.s;
    g.userData.kind = rec.kind === 'custom' ? 'custom' : rec.type;
    g.userData.phase = this.fxRng() * Math.PI * 2;
    g.position.set(rec.x, 0, rec.z); g.rotation.y = rec.rot;
    if (anim && !this.opts.noAnim) { g.scale.setScalar(0.001); this.growing.push({ g: g, t: -(delay || 0) }); }
    else g.scale.setScalar(rec.s);
    if (g.userData.kind === 'person') g.userData.wander = { a: this.fxRng() * Math.PI * 2, t: 0 };
    this.scene.add(g); this.groups.push({ g: g, rec: rec });
    return g;
  };

  Scene3D.prototype.removeRec = function (rec) {
    var i = this.groups.findIndex(function (x) { return x.rec === rec; });
    if (i < 0) return;
    var g = this.groups[i].g; this.scene.remove(g); this._disposeGroup(g);
    this.groups.splice(i, 1);
    var gi = this.growing.findIndex(function (it) { return it.g === g; }); if (gi >= 0) this.growing.splice(gi, 1);
  };

  Scene3D.prototype._disposeGroup = function (g) {
    g.traverse(function (o) { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  };

  Scene3D.prototype.clear = function () {
    var self = this;
    this.groups.forEach(function (x) { self.scene.remove(x.g); self._disposeGroup(x.g); });
    this.groups = []; this.growing = [];
  };

  Scene3D.prototype.setRecords = function (records) {
    this.clear(); this.fxRng = W.makeRng(20261012);
    var self = this; records.forEach(function (r) { self.spawn(r, false); });
  };

  Scene3D.prototype.pick = function (clientX, clientY) {
    if (!this.ok) return null;
    var rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1; this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(this.ndc, this.camera);
    var hits = this.ray.intersectObjects(this.groups.map(function (x) { return x.g; }), true);
    if (!hits.length) return null;
    var g = hits[0].object; while (g && !g.userData.rec) g = g.parent;
    return g ? g.userData.rec : null;
  };

  Scene3D.prototype.isGrowing = function () { return this.growing.length > 0; };

  Scene3D.prototype.start = function () {
    if (this.running || !this.renderer) return;
    this.running = true;
    var self = this;
    var loop = function () { if (!self.running) return; self.raf = root.requestAnimationFrame(loop); self._frame(); };
    this.raf = root.requestAnimationFrame(loop);
  };
  Scene3D.prototype.stop = function () { this.running = false; if (this.raf) root.cancelAnimationFrame(this.raf); };

  Scene3D.prototype._frame = function () {
    var T = this.T, dt = Math.min(this.clock.getDelta(), 0.05), time = this.clock.elapsedTime;
    this.frames++;
    var fwd = new T.Vector3(Math.cos(this.theta), 0, Math.sin(this.theta));
    var right = new T.Vector3(-Math.sin(this.theta), 0, Math.cos(this.theta));
    var sp = 26 * dt, moved = false, k = this.keys;
    if (k.w || k.arrowup) { this.target.addScaledVector(fwd, -sp); moved = true; }
    if (k.s || k.arrowdown) { this.target.addScaledVector(fwd, sp); moved = true; }
    if (k.a || k.arrowleft) { this.target.addScaledVector(right, sp); moved = true; }
    if (k.d || k.arrowright) { this.target.addScaledVector(right, -sp); moved = true; }
    if (moved && this.onUserMove) this.onUserMove('keys');
    if (this.autoOrbit) { this.theta += dt * 0.06; moved = true; }
    if (moved) this.updateCam();
    for (var i = this.growing.length - 1; i >= 0; i--) {
      var it = this.growing[i]; it.t += dt * 2.6;
      if (it.t < 0) continue; var tt = Math.min(it.t, 1);
      it.g.scale.setScalar(Math.max(0.001, easeOutBack(tt) * it.g.userData.s));
      if (it.t >= 1) { it.g.scale.setScalar(it.g.userData.s); this.growing.splice(i, 1); }
    }
    var day = (Math.sin(time * 0.05) + 1) / 2;
    this.sun.intensity = 0.6 + day * 0.55; this.hemi.intensity = 0.68 + day * 0.34;
    this.scene.background.copy(this.SKY_DAY).lerp(this.SKY_DUSK, (1 - day) * 0.55); this.scene.fog.color.copy(this.scene.background);
    for (var j = 0; j < this.groups.length; j++) {
      var o = this.groups[j].g, kd = o.userData.kind, ph = o.userData.phase || 0;
      if (kd === 'tree' || kd === 'flower' || kd === 'custom') o.rotation.z = Math.sin(time * 1.3 + ph) * 0.025;
      else if (kd === 'water') o.position.y = 0.035 + Math.sin(time * 1.1 + ph) * 0.035;   // 原版振幅 ±0.07 会沉到地面以下闪烁，改成只在地面以上起伏
      else if (kd === 'person' && o.userData.wander) {
        var w = o.userData.wander; w.t -= dt;
        if (w.t <= 0) { w.a += (this.fxRng() - 0.5) * 1.6; w.t = 1.2 + this.fxRng() * 2.2; }
        var st = 1.3 * dt;
        o.position.x = Math.max(-46, Math.min(46, o.position.x + Math.cos(w.a) * st));
        o.position.z = Math.max(-46, Math.min(46, o.position.z + Math.sin(w.a) * st));
        o.rotation.y = -w.a + Math.PI / 2; o.position.y = Math.abs(Math.sin(time * 6 + ph)) * 0.06;
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  /** 退出：停循环、解绑事件、释放显存 */
  Scene3D.prototype.dispose = function () {
    this.stop();
    this.listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
    this.listeners = [];
    if (this.ro) this.ro.disconnect();
    this.clear();
    if (this.renderer) {
      this.renderer.dispose();
      try { this.renderer.forceContextLoss(); } catch (e) { /* ignore */ }
      if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    this.scene = null; this.renderer = null;
  };

  root.TTW_Scene3D = Scene3D;
})(window);
