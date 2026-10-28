# -*- coding: utf-8 -*-
"""Phone-portrait and desktop acceptance for play/index.html (series rule "section 8", v2).

    python -m tools.mobile_check_ttw                   # all sizes, screenshots to a temp dir, results/mobile_check.json
    python -m tools.mobile_check_ttw --shots docs/img  # also copy the 390x844 shot to docs/img/mobile_390x844.png
    python -m tools.mobile_check_ttw --out DIR         # keep every screenshot + the raw report in DIR

Drives the locally installed Edge through Playwright (channel "msedge") and emulates the devices through the
DevTools protocol (viewport, DPR, mobile, touch) -- not through --window-size. WebGL runs on the software
renderer (SwiftShader). Sizes: 390x844, 414x896, 360x780 (DPR 3), 768x1024 (DPR 2) with touch, a landscape
phone 844x390 (rotate hint), plus desktop 1920x1080 and 1366x768. The driver (tools/mobile_check.py:
machine-wide Edge lock, free-memory guard, overflow and JS-error checks, screenshots) is part of this repository.

Scenario (phone sizes): body gets class touchp; the first-visit help overlay shows the touch illustration (SVG, no
keyboard hint) and its start button is inside the viewport; the header is one row (title, mode tabs, menu); in
"watch" the understanding panel sits right under the 3D view (compact); "build" fits one screen (no page scroll,
3D view + input area + buttons all inside the viewport); a tap on an example chip fills the input and a tap on
"generate" increases the number of objects in the 3D scene; a one-finger touch drag on the view changes the
camera angle and a two-finger pinch changes the distance (CDP touch events); the panel opens full screen from
"看解析" and closes with "返回"; the options sheet opens, a rule-level preset works, "返回" closes it; the menu opens,
reaches the help and toggles closed; practice mode shows the 8-item task list; touch targets >= 44 px, the text box
>= 16 px, labels >= 14 px; no horizontal overflow at any point; no JS errors. Desktop sizes: no touch classes,
right panel inline, the same generate run-through with clicks and a mouse drag, footer inside the viewport.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "play" / "index.html"
RESULT = ROOT / "results" / "mobile_check.json"
READY = "window.TTW_APP && window.TTW_APP.ready"
SWIFTSHADER = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
LANDSCAPE = {"name": "l844x390", "kind": "mobile", "w": 844, "h": 390, "dpr": 3}
COUNTS: dict[str, int] = {}   # size name -> number of checks performed


# ----------------------------------------------------------------------------- helpers (run inside the page)
def _targets(page, sel, min_h):
    """Visible elements matching sel whose height is below min_h, as 'sel#i h=..'."""
    return page.evaluate("""([sel, minH]) => {
      const out = [];
      document.querySelectorAll(sel).forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (r.height < minH - 0.5) out.push(sel + '#' + i + ' h=' + r.height.toFixed(1));
      });
      return out; }""", [sel, min_h])


def _font_min(page, sel):
    return page.evaluate("""(sel) => {
      let m = 1e9;
      document.querySelectorAll(sel).forEach(el => {
        const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return;
        m = Math.min(m, parseFloat(getComputedStyle(el).fontSize)); });
      return m; }""", sel)


def _overflow(page, w, tag=""):
    out = page.evaluate("""(w) => {
      const d = document.documentElement, out = [];
      if (d.scrollWidth > w + 1) out.push('document scrollWidth ' + d.scrollWidth + ' > ' + w);
      ['#top', '#main', '.view-card', '#view', '#controls', '#mob-bar', '#opts', '#explain', '#right', '.panel', '#foot', '#help .modal-box'].forEach(s => {
        const el = document.querySelector(s); if (!el) return;
        const cs = getComputedStyle(el); if (cs.display === 'none' || cs.display === 'contents') return;
        if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && cs.overflowX !== 'hidden')
          out.push(s + ' scrollWidth ' + el.scrollWidth + ' > ' + el.clientWidth);
        const r = el.getBoundingClientRect(); if (r.right > w + 1) out.push(s + ' right ' + r.right.toFixed(0) + ' > ' + w); });
      return out; }""", w)
    return [f"{tag}{o}" for o in out]


def _rect(page, sel):
    return page.evaluate("""(sel) => { const el = document.querySelector(sel); if (!el) return null;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return {x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, right: r.right, display: cs.display, position: cs.position, ox: cs.overflowX}; }""", sel)


def _display(page, sel):
    return page.evaluate("(s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).display : 'missing'; }", sel)


def _help_open(page):
    return page.evaluate("!document.getElementById('help').hidden")


def _mode(page):
    return page.evaluate("window.TTW_APP.st.mode")


def _objects(page):
    return page.evaluate("window.TTW_APP.objects()")


def _cam(page):
    return page.evaluate("({theta: window.TTW_APP.scene.theta, phi: window.TTW_APP.scene.phi, radius: window.TTW_APP.scene.radius, ok: window.TTW_APP.scene.ok})")


def _touch_drag(page, x0, y0, x1, y1, steps=10):
    """One finger: touchStart, several touchMove, touchEnd (DevTools Input.dispatchTouchEvent)."""
    cdp = page.context.new_cdp_session(page)
    try:
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0, "id": 0}]})
        for i in range(1, steps + 1):
            t = i / steps
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + (x1 - x0) * t, "y": y0 + (y1 - y0) * t, "id": 0}]})
            page.wait_for_timeout(16)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    finally:
        cdp.detach()


def _touch_pinch(page, cx, cy, d0, d1, steps=10):
    """Two fingers on one horizontal line moving from distance d0 to d1, then both lifted at once."""
    cdp = page.context.new_cdp_session(page)

    def pts(d):
        return [{"x": cx - d / 2, "y": cy, "id": 0}, {"x": cx + d / 2, "y": cy, "id": 1}]
    try:
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pts(d0)})
        for i in range(1, steps + 1):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": pts(d0 + (d1 - d0) * i / steps)})
            page.wait_for_timeout(16)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    finally:
        cdp.detach()


def _generate(page, tap, fails, ok, tag):
    """Tap an example chip, then the generate button: the input is filled, the scene gets more objects."""
    n0 = _objects(page)
    tap("#controls .chip")
    page.wait_for_timeout(150)
    q = page.evaluate("document.getElementById('q').value")
    ok(bool(q), f"{tag}: tap on an example chip did not fill the text box")
    tap("#btn-go")
    page.wait_for_timeout(500)
    n1 = _objects(page)
    ok(n1 > n0, f"{tag}: tap on generate did not add objects to the scene ({n0} -> {n1})")
    ok(page.evaluate("document.getElementById('q').value") == "", f"{tag}: text box not cleared after generate")
    ok(page.evaluate("document.querySelectorAll('#plan-body tr').length") > 0, f"{tag}: plan table empty after generate")
    return n0, n1


# ----------------------------------------------------------------------------- scenario
def scenario(page, size):
    """Runs the checks for one size; a step that throws is recorded and the failures collected so far are kept."""
    fails: list[str] = []
    n = [0]

    def ok(cond, msg):
        n[0] += 1
        if not cond:
            fails.append(msg)
        return bool(cond)
    try:
        _scenario(page, size, fails, ok)
    except Exception as e:
        fails.append("step raised: %s" % str(e).splitlines()[0][:200])
    COUNTS[size["name"]] = n[0]
    return fails


def _scenario(page, size, fails, ok):
    mobile = size["kind"] == "mobile"
    w, h = size["w"], size["h"]
    page.wait_for_function(READY, timeout=120000)
    page.wait_for_timeout(300)
    tap = (lambda sel: page.tap(sel)) if mobile else (lambda sel: page.click(sel))
    ok(page.evaluate("window.TTW_APP.scene.ok"), "WebGL scene did not start (scene.ok false)")

    if not mobile:
        ok(not page.evaluate("document.body.classList.contains('touchp') || document.body.classList.contains('touchl')"),
           "desktop size got body.touchp / touchl (phone layout on a desktop size)")
        if _help_open(page):
            ok(_display(page, "#help .kbd-only") != "none", "desktop help: keyboard hints hidden")
            ok(_display(page, "#help .touch-only") == "none", "desktop help: touch illustration shown on desktop")
            page.click("#help-close")
            page.wait_for_timeout(150)
        for sel in ("#menu-btn", "#mob-bar", "#rotate-hint", "#panel-close"):
            ok(_display(page, sel) == "none", f"{sel} visible on desktop")
        ok(_display(page, ".switch") != "none" and _display(page, "#btn-exit") != "none", "desktop: big-screen switch / exit button hidden")
        ok((_rect(page, "#right") or {"w": 0})["w"] >= 300, "right panel not visible inline on desktop")
        ok(_mode(page) == "watch", "first mode is not watch")
        page.click("#tabs .tab[data-mode=build]")
        page.wait_for_timeout(200)
        ok(_mode(page) == "build" and page.evaluate("document.body.classList.contains('m-build')"), "click on tab did not switch mode")
        _generate(page, page.click, fails, ok, "desktop")
        # mouse drag on the 3D view rotates the camera
        v = _rect(page, "#view")
        c0 = _cam(page)
        page.mouse.move(v["x"] + v["w"] * 0.5, v["y"] + v["h"] * 0.5)
        page.mouse.down()
        for i in range(1, 9):
            page.mouse.move(v["x"] + v["w"] * 0.5 + 20 * i, v["y"] + v["h"] * 0.5 + 6 * i)
            page.wait_for_timeout(16)
        page.mouse.up()
        page.wait_for_timeout(100)
        c1 = _cam(page)
        ok(abs(c1["theta"] - c0["theta"]) > 0.05, f"desktop: mouse drag did not rotate the camera ({c0['theta']:.3f} -> {c1['theta']:.3f})")
        ok(page.evaluate("window.TTW_APP.scene.pointerCount()") == 0, "desktop: pointers not released after drag")
        page.click("#btn-json")
        page.wait_for_timeout(100)
        ok(not page.evaluate("document.getElementById('plan-json').hidden"), "desktop: JSON view did not open")
        page.click("#btn-json")
        fails.extend(_overflow(page, w, "desktop "))
        ok(page.evaluate("document.getElementById('foot').getBoundingClientRect().bottom") <= h + 1, "desktop: footer below the viewport (page should fit one screen)")
        ok(page.evaluate("document.getElementById('foot').textContent.indexOf('@') > 0"), "desktop: footer has no contact e-mail")
        return

    # ---- landscape phone: single-column layout plus the "portrait is better" hint
    if w > h:
        if not ok(page.evaluate("document.body.classList.contains('touchl') && document.body.classList.contains('touchp')"), "landscape phone: body has no touchl + touchp"):
            return
        ok(_display(page, "#rotate-hint") != "none", "landscape phone: rotate hint not shown")
        page.tap("#rot-ok")
        page.wait_for_timeout(150)
        ok(_display(page, "#rotate-hint") == "none" and page.evaluate("document.body.classList.contains('rot-ok')"),
           "landscape phone: 'continue in landscape' did not hide the hint")
        if _help_open(page):
            page.tap("#help-close")
            page.wait_for_timeout(150)
        fails.extend(_overflow(page, w, "landscape "))
        return

    # ---- phone / tablet portrait
    if not ok(page.evaluate("document.body.classList.contains('touchp')"), "body has no class touchp"):
        return
    ok(not page.evaluate("document.body.classList.contains('touchl')"), "portrait phone got body.touchl")
    ok(_display(page, "#rotate-hint") == "none", "rotate hint shown in portrait")
    # first-visit help overlay: touch illustration, no keyboard hint, start button inside the viewport
    if ok(_help_open(page), "help overlay not shown on first visit"):
        st = page.evaluate("""() => ({
          touch: getComputedStyle(document.querySelector('#help .touch-only')).display !== 'none',
          svg: !!document.querySelector('#help .touch-only svg') && document.querySelector('#help .touch-only svg').getBoundingClientRect().height > 40,
          kbd: Array.from(document.querySelectorAll('#help .kbd-only')).every(e => getComputedStyle(e).display === 'none'),
          scroll: getComputedStyle(document.querySelector('#help .help-body')).overflowY === 'auto' })""")
        ok(st["touch"] and st["svg"], "help: touch illustration hidden")
        ok(st["kbd"], "help: keyboard hint visible on touch device")
        ok(st["scroll"], "help: body not scrollable")
        bb = page.locator("#help-close").bounding_box()
        ok(bb and bb["y"] + bb["height"] <= h + 0.5 and bb["height"] >= 44, "help: start button not fixed inside viewport / too small: %r" % (bb,))
        fails.extend(_overflow(page, w, "help "))
        page.tap("#help-close")
        page.wait_for_timeout(150)
        ok(not _help_open(page), "help: tap on start did not close it")
    # header: one row (brand, mode tabs, menu button share the same band), nothing wider than the screen
    hd = page.evaluate("""() => { const q = s => document.querySelector(s).getBoundingClientRect();
      const b = q('.brand'), t = q('#tabs'), m = q('#menu-btn'), top = q('#top');
      return {b, t, m, top: {h: top.height, bottom: top.bottom, right: top.right}}; }""")
    for k in ("b", "t", "m"):
        r = hd[k]
        ok(r["height"] > 0 and r["bottom"] <= hd["top"]["bottom"] + 0.5 and r["right"] <= w + 0.5, "header element %s not in the single header row: %r" % (k, r))
    ok(hd["top"]["h"] <= 64, "header taller than one row: %.0f px" % hd["top"]["h"])
    for sel in (".switch", "#btn-help", "#btn-exit"):
        ok(_display(page, sel) == "none", f"header: {sel} should be folded into the menu")
    # watch mode: the understanding panel sits right under the 3D view (compact), then options
    ok(_mode(page) == "watch", "first mode is not watch")
    vc, ct, rc = _rect(page, ".view-card"), _rect(page, "#controls"), _rect(page, "#right")
    ok(rc and rc["w"] >= w * 0.8 and rc["position"] == "static" and rc["display"] != "none", "watch: panel not inline under the 3D view: %r" % (rc,))
    ok(vc["top"] < ct["top"] and ct["bottom"] - 1 <= rc["top"], "watch: order should be view -> controls -> panel (%r / %r / %r)" % (vc["bottom"], ct["top"], rc["top"]))
    ok(vc["w"] >= w * 0.9 and vc["h"] >= 200, "watch: 3D view not full width / too small: %r" % (vc,))
    ok(_display(page, "#mob-bar") == "none", "watch: button bar should be hidden (panel is inline)")
    ok(page.evaluate("document.documentElement.scrollHeight > innerHeight"), "watch: page should scroll (panel + options below the view)")
    page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
    page.wait_for_timeout(100)
    fails.extend(_overflow(page, w, "watch "))
    page.evaluate("window.scrollTo(0, 0)")
    # build mode: one screen, nothing scrolls, 3D view + input area + buttons inside the viewport
    page.tap("#tabs .tab[data-mode=build]")
    page.wait_for_timeout(250)
    ok(_mode(page) == "build" and page.evaluate("document.body.classList.contains('m-build')"), "tap on tab did not switch to build")
    lay = page.evaluate("""() => { const q = s => document.querySelector(s).getBoundingClientRect();
      const d = document.documentElement;
      return {sh: d.scrollHeight, bh: document.body.scrollHeight, ih: innerWidth && innerHeight, top: q('#top').bottom,
              card: q('.view-card'), view: q('#view'), ctrl: q('#controls'), bar: q('#mob-bar'), q: q('#q'), go: q('#btn-go'),
              right: getComputedStyle(document.getElementById('right')).display, opts: getComputedStyle(document.getElementById('opts')).display}; }""")
    ok(lay["sh"] <= lay["ih"] + 1 and lay["bh"] <= lay["ih"] + 1, "build: page scrolls (scrollHeight %d / %d > %d)" % (lay["sh"], lay["bh"], lay["ih"]))
    ok(lay["card"]["top"] >= lay["top"] - 1 and lay["card"]["top"] <= lay["top"] + 16, "build: 3D view card not right under the header: %r" % (lay["card"],))
    ok(lay["view"]["width"] >= w * 0.9 and lay["view"]["height"] >= 160, "build: 3D view not full width / too small: %r" % (lay["view"],))
    ok(lay["ctrl"]["bottom"] <= h + 0.5 and lay["bar"]["bottom"] <= h + 0.5 and lay["q"]["bottom"] <= h and lay["go"]["bottom"] <= h, "build: input area / buttons not inside the viewport: %r" % (lay,))
    ok(lay["right"] == "none" and lay["opts"] == "none", "build: panel / options should be collapsed by default on phones")
    # touch targets and label sizes (everything currently visible)
    for sel, mh in (("#tabs .tab", 40), ("#menu-btn", 40), ("#q", 44), ("#btn-go", 44), ("#controls .chip", 40), ("#controls .tools .btn", 44), ("#mob-bar .mbtn", 44)):
        bad = _targets(page, sel, mh)
        ok(not bad, "touch target < %d px: %s" % (mh, ", ".join(bad[:4])))
    ok(_font_min(page, "#q") >= 16, "text box font-size < 16 px (iOS would zoom in)")
    fm = _font_min(page, "#tabs .tab, #controls .btn, #controls .chip, #mob-bar .mbtn")
    ok(fm >= 14, "label font-size %.1f px < 14 px" % fm)
    chips = page.evaluate("""() => { const el = document.querySelector('#controls .chips'); const cs = getComputedStyle(el);
      return {ox: cs.overflowX, wrap: cs.flexWrap, right: el.getBoundingClientRect().right, sw: el.scrollWidth, cw: el.clientWidth}; }""")
    ok(chips["ox"] == "auto" and chips["wrap"] == "nowrap" and chips["right"] <= w + 1, "build: example chips are not a horizontal scroller: %r" % (chips,))
    # core operation: example chip -> generate -> more objects
    _generate(page, tap, fails, ok, "phone")
    fails.extend(_overflow(page, w, "build "))
    # one-finger drag rotates, two-finger pinch zooms (CDP touch events); all fingers released afterwards
    v = _rect(page, "#view")
    c0 = _cam(page)
    _touch_drag(page, v["x"] + v["w"] * 0.3, v["y"] + v["h"] * 0.5, v["x"] + v["w"] * 0.7, v["y"] + v["h"] * 0.6)
    page.wait_for_timeout(150)
    c1 = _cam(page)
    ok(abs(c1["theta"] - c0["theta"]) > 0.05, "phone: one-finger drag did not rotate the camera (%.3f -> %.3f)" % (c0["theta"], c1["theta"]))
    ok(page.evaluate("window.TTW_APP.scene.pointerCount()") == 0, "phone: pointers not released after drag")
    _touch_pinch(page, v["x"] + v["w"] * 0.5, v["y"] + v["h"] * 0.5, 80, 200)
    page.wait_for_timeout(150)
    c2 = _cam(page)
    ok(c2["radius"] < c1["radius"] - 1, "phone: two-finger spread did not zoom in (radius %.1f -> %.1f)" % (c1["radius"], c2["radius"]))
    ok(page.evaluate("window.TTW_APP.scene.pointerCount()") == 0, "phone: pointers not released after pinch")
    ok(page.evaluate("document.documentElement.scrollHeight <= innerHeight + 1 && scrollY === 0"), "build: page scrolled during touch gestures")
    # panel sheet: open full screen from the bar, tap a plan row, close with "返回"
    page.tap("#mob-panel")
    page.wait_for_timeout(300)
    rb = page.evaluate("""() => { const r = document.getElementById('right').getBoundingClientRect();
      const c = document.getElementById('panel-close').getBoundingClientRect(); const pos = getComputedStyle(document.getElementById('right')).position;
      return {sheet: document.body.classList.contains('sheet-panel'), pos, w: r.width, h: r.height, cy: c.bottom, ch: c.height,
              rows: document.querySelectorAll('#plan-body tr').length, tokens: document.querySelectorAll('#sent .tk').length,
              map: document.getElementById('map').getBoundingClientRect().width}; }""")
    ok(rb["sheet"] and rb["pos"] == "fixed" and rb["w"] >= w - 1 and rb["h"] >= h - 1, "panel sheet did not open full screen: %r" % (rb,))
    ok(rb["cy"] <= h + 0.5 and rb["ch"] >= 44, "panel sheet: back button not inside the viewport / too small: %r" % (rb,))
    ok(rb["rows"] > 0 and rb["tokens"] > 0 and rb["map"] > 100, "panel sheet: content not rendered: %r" % (rb,))
    page.tap("#plan-body tr[data-i='0']")
    page.wait_for_timeout(150)
    ok(page.evaluate("document.getElementById('parts-list').children.length > 0"), "panel sheet: tap on a plan row did not show its primitives")
    fails.extend(_overflow(page, w, "sheet-panel "))
    page.tap("#panel-close")
    page.wait_for_timeout(200)
    ok(not page.evaluate("document.body.classList.contains('sheet-panel')") and _display(page, "#right") == "none", "panel sheet did not close")
    # options sheet: open, change the rule level, close
    page.tap("#mob-opts")
    page.wait_for_timeout(250)
    ok(page.evaluate("document.body.classList.contains('sheet-opts') && getComputedStyle(document.getElementById('side')).position === 'fixed'"), "options sheet did not open")
    bad = _targets(page, "#opts .preset, #opts .mini-btn, #opts input[type=range], #opts .seed", 40)
    ok(not bad, "options: controls < 40 px: %s" % ", ".join(bad[:4]))
    ok(_font_min(page, "#opts .lab, #opts .preset, #opts .opt-desc") >= 13.5, "options: labels too small")
    page.tap("#opts .preset[data-level='1']")
    page.wait_for_timeout(200)
    ok(page.evaluate("window.TTW_APP.st.level") == 1, "options: tap on rule level 1 did not apply")
    page.tap("#opts .preset[data-level='4']")
    page.wait_for_timeout(200)
    fails.extend(_overflow(page, w, "sheet-opts "))
    page.tap("#panel-close")
    page.wait_for_timeout(200)
    ok(not page.evaluate("document.body.classList.contains('sheet-opts')") and _display(page, "#opts") == "none", "options sheet did not close")
    # menu -> help -> close; menu toggles
    page.tap("#menu-btn")
    page.wait_for_timeout(150)
    ok(not page.evaluate("document.getElementById('menu').hidden"), "menu did not open")
    bad = _targets(page, "#menu button", 44)
    ok(not bad, "menu items < 44 px: %s" % ", ".join(bad[:3]))
    page.tap("#menu-help")
    page.wait_for_timeout(150)
    ok(_help_open(page) and page.evaluate("document.getElementById('menu').hidden"), "menu -> help did not open help / close menu")
    page.tap("#help-close")
    page.wait_for_timeout(150)
    page.tap("#menu-btn")
    page.wait_for_timeout(120)
    page.tap("#menu-btn")
    page.wait_for_timeout(120)
    ok(page.evaluate("document.getElementById('menu').hidden"), "menu did not toggle closed")
    # practice mode: one screen, task list readable in the sheet
    page.tap("#tabs .tab[data-mode=practice]")
    page.wait_for_timeout(250)
    ok(_mode(page) == "practice" and page.evaluate("document.documentElement.scrollHeight <= innerHeight + 1"), "practice: not one screen")
    page.tap("#mob-opts")
    page.wait_for_timeout(250)
    tk = page.evaluate("""() => { const li = document.querySelectorAll('#explain .tasks li'); if (!li.length) return null;
      const r = li[0].getBoundingClientRect(); return {n: li.length, w: r.width, fs: parseFloat(getComputedStyle(li[0]).fontSize), total: window.TTW_CONFIG.TASKS.length}; }""")
    ok(tk and tk["n"] == tk["total"] and tk["fs"] >= 14 and tk["w"] >= w * 0.7, "practice: task list not a readable single column: %r" % (tk,))
    page.tap("#panel-close")
    page.wait_for_timeout(150)
    # leave the page in a presentable state for the screenshot (build mode, generated world)
    page.tap("#tabs .tab[data-mode=build]")
    page.wait_for_timeout(250)
    page.evaluate("window.scrollTo(0, 0); document.getElementById('toast').className = ''")
    page.wait_for_timeout(400)
    fails.extend(_overflow(page, w, "final "))


def write_result(rep):
    out = {
        "_note": "Generated by tools/mobile_check_ttw.py: Playwright drives the locally installed Edge (channel msedge, headless, SwiftShader WebGL) "
                 "and emulates each device through the DevTools protocol (viewport, DPR, mobile, touch). 'checks' is the number of scenario "
                 "assertions performed at that size (plus the driver's overflow / JS-error checks); 'fails' lists the failed ones.",
        "date": _dt.date.today().isoformat(),
        "browser": rep.get("browser"),
        "ok": rep["ok"],
        "sizes": [{"name": s["name"], "w": s["w"], "h": s["h"], "dpr": s["dpr"], "kind": s["kind"], "touch": s["kind"] == "mobile",
                   "orientation": "landscape" if s["w"] > s["h"] else "portrait", "ok": not s["fails"],
                   "checks": COUNTS.get(s["name"], 0), "fails": s["fails"]} for s in rep["sizes"]],
    }
    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return RESULT


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", help="copy the phone screenshot (390x844) into this directory as mobile_390x844.png")
    ap.add_argument("--out", help="directory for all screenshots + the raw report (default: a temp dir)")
    ap.add_argument("--no-result", action="store_true", help="do not rewrite results/mobile_check.json")
    args = ap.parse_args(argv)
    sys.path.insert(0, str(ROOT))
    from tools.mobile_check import run, SIZES  # noqa: E402

    out = Path(args.out) if args.out else Path(tempfile.mkdtemp(prefix="ttw_mobile_"))
    sizes = SIZES[:4] + [LANDSCAPE] + SIZES[4:]
    rep = run(INDEX.as_uri(), out, scenario=scenario, sizes=sizes, settle_ms=800, launch_args=SWIFTSHADER)
    for s in rep["sizes"]:
        print("%-11s %4dx%-4d dpr%d %2d checks %s" % (s["name"], s["w"], s["h"], s["dpr"], COUNTS.get(s["name"], 0),
                                                       "PASS" if not s["fails"] else "FAIL: " + " | ".join(s["fails"])), flush=True)
    print("screenshots:", out)
    if not args.no_result:
        print("wrote", write_result(rep).relative_to(ROOT).as_posix())
    if args.shots:
        d = Path(args.shots)
        if not d.is_absolute():
            d = ROOT / d
        d.mkdir(parents=True, exist_ok=True)
        src = out / "m390x844.png"
        if src.exists():
            shutil.copy2(src, d / "mobile_390x844.png")
            print("wrote", (d / "mobile_390x844.png").as_posix())
    print(json.dumps({"ok": rep["ok"], "sizes": [(s["name"], not s["fails"]) for s in rep["sizes"]]}))
    return 0 if rep["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
