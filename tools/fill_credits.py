# -*- coding: utf-8 -*-
"""Fill every {{PLACEHOLDER}} from credits.json (author, series, GitHub user, repo name ...)
and the numbers from results/result.json, then rebuild play/js/credits.js.

    python -m tools.fill_credits            # render tools/templates/*.tmpl -> repo root
    python -m tools.fill_credits --release  # ... and rebuild release/*.zip

Templates live in tools/templates/ (README.md.tmpl -> README.md, ...). Re-running is safe:
outputs are always regenerated from the templates. Finally it lists any placeholder that is
still unfilled anywhere in the repository.
"""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "tools" / "templates"
PH = re.compile(r"\{\{([A-Z0-9_]+)\}\}")
TEXT_EXT = {".md", ".txt", ".cff", ".json", ".js", ".html", ".css", ".py", ".ini", ".tmpl", ""}
AREA = {"center": "中间", "north": "北", "south": "南", "east": "东", "west": "西", "northeast": "东北",
        "northwest": "西北", "southeast": "东南", "southwest": "西南"}
TYPE = {"custom": "火山（自拼）", "tree": "树", "house": "房子", "tower": "塔", "mountain": "山", "water": "水面", "rock": "石头",
        "flower": "花", "person": "小人", "box": "方块", "sphere": "球", "cylinder": "圆柱", "cone": "圆锥"}


def numbers_from_results():
    p = ROOT / "results" / "result.json"
    if not p.exists():
        return {}
    r = json.loads(p.read_text(encoding="utf-8"))
    e, t = r["engine"], r["three_js"]
    rows = ["| 句子 | 档位 | 计划里的物体类数 | 放下的物体 | 落点尝试 / 被拒绝 | 没认出来的词 |", "|---|---|---|---|---|---|"]
    for d in r["demos"]:
        for lv in ("1", "4"):
            x = d["levels"][lv]
            rows.append(f"| {d['text']} | {lv} | {len(x['plan'])} | {x['objects_placed']} | {x['placement_tries']} / {x['rejected']} | "
                        f"{'、'.join(x['unknown_words']) or '—'} |")
    d0 = r["demos"][0]["levels"]
    l1 = "；".join(f"{TYPE.get(it['type'], it['type'])} ×{it['count']}" for it in d0["1"]["plan"])
    l4 = "；".join(f"{TYPE.get(it['type'], it['type'])} ×{it['count']}（{AREA.get(it.get('area'), '随机')}{'，挨着“' + it['near'] + '”' if it.get('near') else ''}）" for it in d0["4"]["plan"])
    return {
        "LEX_ENTRIES": str(e["lexicon_entries"]), "LEX_WORDS": str(e["lexicon_words"]),
        "KW_RULES": str(e["original_keyword_rules"]), "PRESET_TYPES": str(e["preset_object_types"]),
        "OVERLAP": f"{e['overlap_default']:g}", "TRIES": str(e["tries_default"]), "SEED": str(e["seed"]),
        "THREE_VERSION": t["version"], "THREE_BYTES": f"{t['bytes']:,}", "THREE_SHA256": t["sha256"],
        "DEMO_TABLE": "\n".join(rows), "DEMO0_TEXT": r["demos"][0]["text"], "DEMO0_L1": l1, "DEMO0_L4": l4,
        "N_DEMOS": str(len(r["demos"])),
    }


def numbers_from_checks():
    """README placeholders for the browser acceptance (results/browser_check.json, results/mobile_check.json)."""
    out = {}
    b = ROOT / "results" / "browser_check.json"
    if b.exists():
        r = json.loads(b.read_text(encoding="utf-8"))
        info = r.get("browser") or {}
        out["BROWSER_LINE"] = f"{info.get('name', '')} {info.get('version', '')}".strip() +             ("（Playwright 驱动，无头，WebGL 用软件渲染）" if info.get("driver") == "playwright" else "（无头，WebGL 用软件渲染）")
        s = r.get("sizes", {})
        out["SELFTEST_CHECKS"] = str(max([v.get("checks", 0) for v in s.values()] or [0]))
        out["SELFTEST_SIZES"] = "、".join(k.replace("x", "×") for k, v in s.items() if v.get("ok"))
        out["CHECK_DATE"] = r.get("date", "")
    m = ROOT / "results" / "mobile_check.json"
    if m.exists():
        r = json.loads(m.read_text(encoding="utf-8"))
        ok = [x for x in r.get("sizes", []) if x.get("ok")]
        port = [x for x in ok if x["touch"] and x["orientation"] == "portrait"]
        land = [x for x in ok if x["touch"] and x["orientation"] == "landscape"]
        desk = [x for x in ok if not x["touch"]]
        fmt = lambda x: f"{x['w']}×{x['h']}" + (f"（DPR {x['dpr']}）" if x["dpr"] > 1 else "")
        out["MOBILE_PORTRAIT_SIZES"] = "、".join(fmt(x) for x in port)
        out["MOBILE_LANDSCAPE_SIZES"] = "、".join(fmt(x) for x in land)
        out["MOBILE_DESKTOP_SIZES"] = "、".join(fmt(x) for x in desk)
        out["MOBILE_N_OK"] = str(len(ok)); out["MOBILE_N_TOTAL"] = str(len(r.get("sizes", [])))
        lo_, hi_ = min([x.get("checks", 0) for x in port] or [0]), max([x.get("checks", 0) for x in port] or [0])
        out["MOBILE_CHECKS_MIN"], out["MOBILE_CHECKS_MAX"] = str(lo_), str(hi_)
        out["MOBILE_CHECKS_RANGE"] = str(lo_) if lo_ == hi_ else f"{lo_}–{hi_}"
    return out


def render(values):
    written = []
    for tpl in sorted(TEMPLATES.glob("*.tmpl")):
        text = tpl.read_text(encoding="utf-8")
        text = PH.sub(lambda m: str(values[m.group(1)]) if m.group(1) in values else m.group(0), text)
        out = ROOT / tpl.name[:-len(".tmpl")]
        out.write_text(text, encoding="utf-8", newline="\n")
        written.append(out)
    return written


def leftover_placeholders():
    left = []
    for p in ROOT.rglob("*"):
        if not p.is_file() or ".git" in p.parts or "templates" in p.parts or p.suffix not in TEXT_EXT or p.name == "fill_credits.py":
            continue
        if p.stat().st_size > 2_000_000:
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for m in PH.finditer(text):
            left.append((p.relative_to(ROOT).as_posix(), m.group(0)))
    return left


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", action="store_true")
    args = ap.parse_args(argv)
    if not TEMPLATES.is_dir():
        raise SystemExit("tools/templates/ not found (run this inside the published repository)")
    credits = json.loads((ROOT / "credits.json").read_text(encoding="utf-8"))
    values = {k: v for k, v in credits.items() if not k.startswith("_")}
    values.update(numbers_from_results())
    values.update(numbers_from_checks())
    for p in render(values):
        print("wrote", p.relative_to(ROOT).as_posix())
    from tools import build
    build.main(["--skip-report"] + (["--release"] if args.release else []))
    left = leftover_placeholders()
    if left:
        print("UNFILLED placeholders:")
        for f, ph in left:
            print("  ", f, ph)
    else:
        print("no unfilled placeholders")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
