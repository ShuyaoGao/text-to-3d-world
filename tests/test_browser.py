# -*- coding: utf-8 -*-
"""Browser acceptance of play/index.html in the locally installed Edge / Chrome (headless):
the page's built-in self-test at 1920x1080 and 1366x768, and the phone / desktop scenario of
tools/mobile_check_ttw.py (390x844, 414x896, 360x780, 768x1024 with touch, 844x390 landscape, 1920x1080, 1366x768).

Opt-in (it starts a browser):  TTW_BROWSER_TEST=1 python -m pytest tests/test_browser.py
Uses only an already installed Edge / Chrome through Playwright (channel "msedge"); nothing is downloaded.
"""

import os
import tempfile

import pytest

pytestmark = pytest.mark.skipif(os.environ.get("TTW_BROWSER_TEST") != "1", reason="set TTW_BROWSER_TEST=1 to run")


def _playwright():
    try:
        import playwright.sync_api  # noqa: F401
        return True
    except ImportError:
        return False


def test_selftest_in_browser():
    from tools import browser_check
    if not _playwright():
        pytest.skip("Playwright not installed")
    results = {}
    with browser_check.shared_lock():
        res = browser_check.run_playwright(False, None, results)
    if res is None:
        pytest.skip("no Edge / Chrome channel available to Playwright")
    ok, info, _ = res
    for size, r in results.items():
        assert browser_check.good(r), (size, [c for c in r.get("checks", []) if not c[1]], r.get("errors"))
    assert ok


def test_phone_and_desktop_sizes():
    from tools import mobile_check_ttw
    from tools.mobile_check import run, SIZES
    if not _playwright():
        pytest.skip("Playwright not installed")
    out = tempfile.mkdtemp(prefix="ttw_mobile_test_")
    sizes = SIZES[:4] + [mobile_check_ttw.LANDSCAPE] + SIZES[4:]
    rep = run(mobile_check_ttw.INDEX.as_uri(), out, scenario=mobile_check_ttw.scenario, sizes=sizes, settle_ms=800,
              launch_args=mobile_check_ttw.SWIFTSHADER)
    bad = [(s["name"], s["fails"]) for s in rep["sizes"] if s["fails"]]
    assert not bad, bad
    assert rep["ok"]
