"""End-to-end test: server in simulator mode + browser. Calibrates, then checks live decoding.
python tests/e2e_sim.py --shots out_dir
"""
import argparse
import json
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

ap = argparse.ArgumentParser()
ap.add_argument("--shots", default="shots")
ap.add_argument("--out", default="/tmp/pb_e2e")
a = ap.parse_args()
os.makedirs(a.shots, exist_ok=True)
srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "realtime", "server.py"), "--source", "sim", "--out", a.out],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
time.sleep(2.5)
ok = True
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        pg = b.new_page(viewport={"width": 1400, "height": 820})
        logs = []
        pg.on("console", lambda m: logs.append(m.text))
        pg.goto("http://localhost:8000")
        pg.wait_for_function("document.querySelector('#conn').classList.contains('on')", timeout=10000)
        pg.fill("#reps", "2")
        pg.fill("#hold", "2.5")
        pg.click("#bCal")
        time.sleep(6)
        pg.screenshot(path=os.path.join(a.shots, "calibrating.png"))
        pg.wait_for_function("document.querySelector('#mode').textContent.includes('model lda_')", timeout=60000)
        results = {}
        for g in ["open", "close", "pinch", "rest"]:
            pg.keyboard.press(str(["rest", "open", "close", "pinch"].index(g) + 1))
            time.sleep(1.5)
            st = pg.inner_text("#state").strip().lower()
            results[g] = st
            pg.screenshot(path=os.path.join(a.shots, f"live_{g}.png"))
        meta = pg.inner_text("#meta")
        print("decoded:", json.dumps(results))
        print("meta:", meta.replace("\n", " | "))
        ok = all(results[g] == g for g in results)
        if logs:
            print("console:", logs[:5])
        b.close()
finally:
    srv.terminate()
    out = srv.communicate(timeout=5)[0]
    print(out[-800:])
print("E2E", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
