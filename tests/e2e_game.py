"""Automated play-through of Smit's Kitchen (keyboard input, server connected without a model)."""
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/pb_game"
SH = sys.argv[2] if len(sys.argv) > 2 else "/tmp/pb_game_shots"
os.makedirs(SH, exist_ok=True)
KEY = {"rest": "1", "open": "2", "close": "3", "pinch": "4"}
srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "realtime", "server.py"), "--source", "camera", "--out", OUT],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
time.sleep(2.5)
ok = True
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])
        pg = b.new_page(viewport={"width": 1440, "height": 860})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.goto("http://localhost:8000/play.html")
        pg.wait_for_timeout(3000)
        pg.screenshot(path=f"{SH}/0_menu.png")
        # ---------------- rhythm
        pg.click(".card.c1")
        t_end = time.time() + 75; shot = False; pressed = set()
        while time.time() < t_end:
            info = pg.evaluate("""() => { const L = window.__game.levels.rhythm; const now = performance.now()/1000;
                return {done: L.done, cards: L.cards.filter(c => c.state==='live').map(c => ({k: c.kind, dt: c.T - now, id: c.T}))}; }""")
            if info["done"]: break
            for c in info["cards"]:
                if c["dt"] < 0.05 and c["id"] not in pressed:
                    pg.keyboard.press(KEY[c["k"]]); pressed.add(c["id"])
                    pg.wait_for_timeout(250); pg.keyboard.press("1")
                    if not shot and len(pressed) > 3: pg.screenshot(path=f"{SH}/1_rhythm.png"); shot = True
            pg.wait_for_timeout(20)
        pg.wait_for_selector("#end.show", timeout=15000)
        print("rhythm:", pg.inner_text("#eScore"), "|", pg.inner_text("#eLines").replace("\n", " | "))
        pg.screenshot(path=f"{SH}/2_rhythm_end.png")
        # ---------------- kitchen (auto-reach)
        pg.click("#eMenu"); pg.click(".card.c2"); pg.wait_for_timeout(800)
        pg.click("#bAssist"); pg.evaluate("() => { window.__maxDt = 0.25; }")
        pg.mouse.move(5, 5)  # keep mouse still; assist moves the hand
        pg.evaluate("() => { window.__game.input.mouse.t = 0; }")
        t_end = time.time() + 280; shot = 0
        while time.time() < t_end:
            st = pg.evaluate("""() => { const L = window.__game.levels.kitchen; window.__game.input.mouse.t = 0;
                const n = L.gripPos ? L.candidateAt(L.gripPos) : null; return {done: L.done, held: !!L.held, near: n ? n.userData.need : null,
                 needed: n ? L.order.some(o => o.kind === n.userData.kind && o.got < o.n) : false,
                 overB: L.held && L.gripPos ? L.overBlender(L.gripPos) && L.gripPos.y > 1.0 : false,
                 state: window.__game.input.state, blending: !!L.blending}; }""")
            if st["done"]: break
            if int(time.time()) % 15 == 0: print("  kitchen progress:", pg.evaluate("() => window.__game.levels.kitchen.orderNo"), pg.evaluate("() => window.__game.levels.kitchen.order.map(o=>o.kind+o.got+'/'+o.n).join(' ')"), flush=True)
            if st["blending"]: pg.wait_for_timeout(100); continue
            if not st["held"] and st["near"] and st["needed"] and st["state"] in ("rest", "open"):
                pg.keyboard.press(KEY[st["near"]])
                if shot < 2: pg.wait_for_timeout(300); pg.screenshot(path=f"{SH}/3_kitchen_{shot}.png"); shot += 1
            elif st["held"] and st["overB"]:
                pg.keyboard.press("2"); pg.wait_for_timeout(400); pg.keyboard.press("1")
            pg.wait_for_timeout(80)
        pg.wait_for_selector("#end.show", timeout=15000)
        print("kitchen:", pg.inner_text("#eScore"), "|", pg.inner_text("#eLines").replace("\n", " | "))
        # ---------------- pour
        pg.click("#eMenu"); pg.click(".card.c3"); pg.wait_for_timeout(1500)
        t_end = time.time() + 400; shot = False
        while time.time() < t_end:
            st = pg.evaluate("() => { const L = window.__game.levels.pour; return {done: L.done, level: L.level, target: L.targetLevel, slide: L.slideIn}; }")
            if st["done"]: break
            v = 0.72 if st["slide"] >= 1 and st["level"] < st["target"] - 0.02 else 0.1
            pg.evaluate(f"() => {{ window.__game.input.forceIntensity = {v}; }}")
            if not shot and st["level"] > 0.25: pg.screenshot(path=f"{SH}/4_pour.png"); shot = True
            pg.wait_for_timeout(50)
        pg.wait_for_selector("#end.show", timeout=15000)
        print("pour:", pg.inner_text("#eScore"), "|", pg.inner_text("#eLines").replace("\n", " | "))
        pg.evaluate("() => { window.__game.input.forceIntensity = null; }")
        pg.click("#eDash"); pg.wait_for_timeout(1500)
        pg.screenshot(path=f"{SH}/5_dashboard.png")
        if errs: print("ERRORS:", errs[:8]); ok = False
        b.close()
finally:
    srv.terminate(); print(srv.communicate(timeout=5)[0][-900:])
print("GAME E2E", "PASS" if ok else "FAIL")
