"""Alpha-Sales bridge for Invisible Playwright (Python-only library).

The Node engine starts this script with the Software/Invisible-Playwright venv and talks
to it over stdin/stdout, one JSON object per line:

    -> {"id": 1, "method": "launch", "params": {...}}
    <- {"id": 1, "result": {...}}          or  {"id": 1, "error": "message"}

Logs go to stderr so they never corrupt the protocol stream.
"""
from __future__ import annotations

import json
import sys
import traceback
from typing import Any, Dict

session = None       # InvisiblePlaywright instance
context = None       # BrowserContext (persistent) or Browser
pages: Dict[str, Any] = {}
counter = 0


def log(*args):
    print("[invisible-bridge]", *args, file=sys.stderr, flush=True)


def register(page) -> str:
    global counter
    for pid, p in pages.items():
        if p == page:
            return pid
    counter += 1
    pid = f"p{counter}"
    pages[pid] = page
    return pid


def page_of(params) -> Any:
    pid = params.get("page")
    if pid not in pages:
        raise ValueError(f"Unknown page {pid}")
    return pages[pid]


def launch(params):
    global session, context
    from invisible_playwright import InvisiblePlaywright

    kwargs = {k: v for k, v in params.items() if v is not None and k in {
        "seed", "pin", "headless", "proxy", "humanize", "locale", "timezone",
        "extra_prefs", "profile_dir", "show_cursor", "extra_args",
    }}
    session = InvisiblePlaywright(**kwargs)
    context = session.__enter__()
    existing = list(getattr(context, "pages", []) or [])
    if not existing:
        existing = [context.new_page()]
    ids = [register(p) for p in existing]
    return {"seed": session.seed, "pages": ids}


def close(_params):
    global session, context
    if session is not None:
        try:
            session.__exit__(None, None, None)
        finally:
            session = None
            context = None
            pages.clear()
    return True


def new_page(_params):
    return register(context.new_page())


def list_pages(_params):
    return [register(p) for p in context.pages]


def cookies(params):
    return context.cookies(params.get("urls") or [])


def add_cookies(params):
    context.add_cookies(params["cookies"])
    return True


PAGE_OPS = {
    "goto": lambda p, a: (p.goto(a["url"], wait_until=a.get("waitUntil", "load"), timeout=a.get("timeout", 60000)) and None),
    "click": lambda p, a: p.click(a["selector"], timeout=a.get("timeout", 30000)),
    "dblclick": lambda p, a: p.dblclick(a["selector"], timeout=a.get("timeout", 30000)),
    "hover": lambda p, a: p.hover(a["selector"], timeout=a.get("timeout", 30000)),
    "fill": lambda p, a: p.fill(a["selector"], a["value"], timeout=a.get("timeout", 30000)),
    "type": lambda p, a: p.locator(a["selector"]).press_sequentially(a["text"], delay=a.get("delay", 60)),
    "press": lambda p, a: p.press(a["selector"], a["key"]),
    "check": lambda p, a: p.check(a["selector"]),
    "select_option": lambda p, a: p.select_option(a["selector"], a["value"]),
    "set_input_files": lambda p, a: p.set_input_files(a["selector"], a["files"]),
    "wait_for_selector": lambda p, a: (p.wait_for_selector(a["selector"], state=a.get("state", "visible"), timeout=a.get("timeout", 30000)) and True),
    "wait_for_timeout": lambda p, a: p.wait_for_timeout(a["ms"]),
    "wait_for_load_state": lambda p, a: p.wait_for_load_state(a.get("state", "load"), timeout=a.get("timeout", 60000)),
    "wait_for_url": lambda p, a: p.wait_for_url(a["url"], timeout=a.get("timeout", 60000)),
    "evaluate": lambda p, a: p.evaluate(a["expression"], a.get("arg")),
    "content": lambda p, a: p.content(),
    "title": lambda p, a: p.title(),
    "url": lambda p, a: p.url,
    "screenshot": lambda p, a: (p.screenshot(path=a["path"], full_page=a.get("fullPage", False)) and a["path"]),
    "inner_text": lambda p, a: p.inner_text(a["selector"]),
    "text_content": lambda p, a: p.text_content(a["selector"]),
    "get_attribute": lambda p, a: p.get_attribute(a["selector"], a["name"]),
    "count": lambda p, a: p.locator(a["selector"]).count(),
    "all_inner_texts": lambda p, a: p.locator(a["selector"]).all_inner_texts(),
    "is_visible": lambda p, a: p.is_visible(a["selector"]),
    "mouse_move": lambda p, a: p.mouse.move(a["x"], a["y"]),
    "mouse_click": lambda p, a: p.mouse.click(a["x"], a["y"]),
    "mouse_wheel": lambda p, a: p.mouse.wheel(a.get("dx", 0), a.get("dy", 0)),
    "keyboard_press": lambda p, a: p.keyboard.press(a["key"]),
    "keyboard_type": lambda p, a: p.keyboard.type(a["text"], delay=a.get("delay", 60)),
    "bring_to_front": lambda p, a: p.bring_to_front(),
    "close_page": lambda p, a: p.close(),
}


def page_call(params):
    op = params["op"]
    fn = PAGE_OPS.get(op)
    if fn is None:
        raise ValueError(f"Unsupported page operation {op}")
    page = page_of(params)
    result = fn(page, params.get("args") or {})
    if op == "close_page":
        pages.pop(params["page"], None)
    return result


METHODS = {
    "launch": launch,
    "close": close,
    "new_page": new_page,
    "pages": list_pages,
    "cookies": cookies,
    "add_cookies": add_cookies,
    "page": page_call,
    "ping": lambda _p: "pong",
}


def main():
    log("ready")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        mid = msg.get("id")
        try:
            result = METHODS[msg["method"]](msg.get("params") or {})
            out = {"id": mid, "result": result}
        except Exception as exc:  # report every failure back to Node
            log(traceback.format_exc())
            out = {"id": mid, "error": f"{type(exc).__name__}: {exc}"}
        try:
            sys.stdout.write(json.dumps(out, default=str) + "\n")
        except TypeError:
            sys.stdout.write(json.dumps({"id": mid, "result": None}) + "\n")
        sys.stdout.flush()
        if msg.get("method") == "close":
            break
    close({})


if __name__ == "__main__":
    main()
