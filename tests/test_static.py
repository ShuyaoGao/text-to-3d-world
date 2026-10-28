# -*- coding: utf-8 -*-
"""Static checks on play/: offline-safe, every <script> exists, licenses present, no brand names,
results/result.json consistent with the shipped three.js file, size limits."""

import hashlib
import json
import re
from pathlib import Path

from tools import build

ROOT = Path(__file__).resolve().parent.parent
PLAY = ROOT / "play"


def test_play_is_offline_safe():
    assert build.check_play() == []


def test_every_script_and_stylesheet_exists():
    html = (PLAY / "index.html").read_text(encoding="utf-8")
    refs = re.findall(r'<script src="([^"]+)"', html) + re.findall(r'<link rel="stylesheet" href="([^"]+)"', html)
    assert refs, "no scripts found"
    for r in refs:
        assert not r.startswith(("http:", "https:", "//")), r
        assert (PLAY / r).is_file(), r
    assert 'type="module"' not in html


def test_three_js_license_next_to_the_file():
    lic = (PLAY / "vendor" / "three.js-LICENSE.txt").read_text(encoding="utf-8")
    assert "The MIT License" in lic and "three.js authors" in lic
    head = (PLAY / "vendor" / "three.min.js").read_bytes()[:200].decode("utf-8")
    assert "SPDX-License-Identifier: MIT" in head


def test_result_json_matches_shipped_files():
    r = json.loads((ROOT / "results" / "result.json").read_text(encoding="utf-8"))
    data = (PLAY / "vendor" / "three.min.js").read_bytes()
    assert r["three_js"]["sha256"] == hashlib.sha256(data).hexdigest()
    assert r["three_js"]["bytes"] == len(data)
    assert r["three_js"]["version"] == "r128"
    assert len(r["demos"]) >= 3
    for d in r["demos"]:
        assert set(d["levels"]) == {"1", "2", "3", "4"}


def test_no_product_or_service_names_in_play():
    """The offline page names no model / service products (neutral names live in play/js/config.js)."""
    bad = re.compile(r"ollama|qwen|deepseek|openai|chatgpt|gpt-|claude|gemini", re.I)
    for p in PLAY.rglob("*"):
        if p.is_file() and p.suffix in {".html", ".js", ".css"} and "vendor" not in p.parts:
            m = bad.search(p.read_text(encoding="utf-8"))
            assert not m, f"{p.relative_to(ROOT)}: {m.group(0)}"


def test_credits_js():
    s = (PLAY / "js" / "credits.js").read_text(encoding="utf-8")
    data = json.loads(s[s.index("{"): s.rindex("}") + 1])
    assert data["AUTHOR"] == "Shuyao Gao"
    assert data["REPO_NAME"] == "text-to-3d-world"
    assert "{{" not in s


def test_page_size_limits():
    total = sum(p.stat().st_size for p in PLAY.rglob("*") if p.is_file())
    assert total < 15 * 1024 * 1024
    z = ROOT / "release"
    for f in z.glob("*.zip") if z.is_dir() else []:
        assert f.stat().st_size <= build.ZIP_LIMIT


def test_mobile_files_are_wired_in():
    """Phone layout: mobile.css / mobile.js are shipped and referenced; the menu, bar, sheet close button,
    rotate hint and the touch-only help illustration exist in the markup."""
    html = (PLAY / "index.html").read_text(encoding="utf-8")
    assert (PLAY / "css" / "mobile.css").is_file() and (PLAY / "js" / "mobile.js").is_file()
    assert 'href="css/mobile.css"' in html and 'src="js/mobile.js"' in html
    for needle in ('id="menu-btn"', 'id="menu"', 'id="mob-bar"', 'id="mob-panel"', 'id="mob-opts"', 'id="panel-close"',
                   'id="rotate-hint"', 'id="rot-ok"', 'class="hc touch-only"', "<svg", 'id="side"', "viewport-fit=cover"):
        assert needle in html, needle
    css = (PLAY / "css" / "mobile.css").read_text(encoding="utf-8")
    for needle in ("body.touchp", "body.touchl", "100dvh", "safe-area-inset", "touch-action: none", "sheet-panel", "sheet-opts"):
        assert needle in css, needle


def test_footer_and_credits_carry_the_public_email():
    s = (PLAY / "js" / "credits.js").read_text(encoding="utf-8")
    data = json.loads(s[s.index("{"): s.rindex("}") + 1])
    assert data["AUTHOR_EMAIL"] == "gaoshuyao.mk@gmail.com"
    app = (PLAY / "js" / "app.js").read_text(encoding="utf-8")
    assert "AUTHOR_EMAIL" in app


def test_published_repository_layout():
    """Only inside the published repository (tools/templates/ exists): root index.html redirects to play/,
    .nojekyll exists, README / CITATION / LICENSE-docs carry the e-mail and no placeholder is left."""
    if not (ROOT / "tools" / "templates").is_dir():
        return
    idx = (ROOT / "index.html").read_text(encoding="utf-8")
    assert 'http-equiv="refresh"' in idx and "url=play/index.html" in idx and 'href="play/index.html"' in idx
    assert (ROOT / ".nojekyll").is_file()
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "{{" not in readme
    assert "gaoshuyao.mk@gmail.com" in readme and "AI 教学演示案例 / AI Teaching Demos" in readme
    assert "email: \"gaoshuyao.mk@gmail.com\"" in (ROOT / "CITATION.cff").read_text(encoding="utf-8")
    assert "Contact: gaoshuyao.mk@gmail.com" in (ROOT / "LICENSE-docs").read_text(encoding="utf-8")
    for z in (ROOT / "release").glob("*.zip") if (ROOT / "release").is_dir() else []:
        import zipfile
        names = zipfile.ZipFile(z).namelist()
        assert "index.html" in names and "play/index.html" in names, names


def test_full_version_points_at_shared_three():
    full = ROOT / "app" / "index_full.html"
    assert full.is_file()
    html = full.read_text(encoding="utf-8")
    assert 'src="../play/vendor/three.min.js"' in html
    assert (full.parent / "../play/vendor/three.min.js").resolve().is_file()
