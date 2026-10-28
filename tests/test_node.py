# -*- coding: utf-8 -*-
"""Run the JavaScript tests (tests/js/*.test.js) with Node's built-in test runner.

They load the very same files the page uses (play/js/*.js + play/vendor/three.min.js) and check
them against the original page (index.html, or app/index_full.html in the published repository):
level 1 of the rule engine = the original keyword engine, every preset object = the original
BUILD code part by part, custom objects = the original buildCustom, plus the new rules and placement.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js not installed")
def test_js_suite():
    files = sorted(str(p) for p in (ROOT / "tests" / "js").glob("*.test.js"))
    assert files
    r = subprocess.run(["node", "--test", *files], cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                       env=dict(os.environ, NODE_NO_WARNINGS="1"))
    print(r.stdout[-3000:])
    assert r.returncode == 0, r.stdout[-4000:] + r.stderr[-2000:]
