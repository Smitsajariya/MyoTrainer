"""End-to-end test of camera mode + game with synthetic hand-tracking frames (no webcam needed).
1) server --source camera, browser page connected
2) a test client streams fake camera features that follow the on-screen calibration prompts
3) the trained model must decode all 4 gestures
4) the game is played automatically from the banner instructions; success rate is reported
"""
import asyncio
import json
import os
import subprocess
import sys
import threading
import time

import numpy as np
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/pb_cam"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "/tmp/pb_cam_shots"
os.makedirs(SHOTS, exist_ok=True)
PROTO = {"rest": [0.3, 0.35, 0.4, 0.45, 0.5, 0.8, 0.9], "open": [0.1, 0.05, 0.05, 0.05, 0.05, 1.3, 1.6],
         "close": [0.7, 0.9, 0.9, 0.9, 0.9, 0.5, 0.3], "pinch": [0.6, 0.5, 0.4, 0.4, 0.4, 0.15, 0.9]}
rng = np.random.default_rng(0)
shared = {"want": "rest", "prompt": None, "state": None, "stop": False}


async def client():
    from websockets.asyncio.client import connect
    async with connect("ws://localhost:8765") as ws:
        async def reader():
            async for msg in ws:
                m = json.loads(msg)
                shared["prompt"] = m.get("prompt")
                shared["state"] = m.get("state")
        rt = asyncio.create_task(reader())
        while not shared["stop"]:
            p = shared["prompt"]
            g = (p["gesture"] if p["phase"] == "hold" else "rest") if p else shared["want"]
            f = (np.array(PROTO[g]) + rng.normal(0, 0.04, 7)).round(3).tolist()
            await ws.send(json.dumps({"cmd": "cam", "f": f, "g": g}))
            await asyncio.sleep(1 / 30)
        rt.cancel()


srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "realtime", "server.py"), "--source", "camera", "--out", OUT],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
time.sleep(2.5)
th = threading.Thread(target=lambda: asyncio.run(client()), daemon=True)
th.start()
ok = True
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        pg = b.new_page(viewport={"width": 1400, "height": 860})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:8000")
        pg.wait_for_function("document.querySelector('#conn').classList.contains('on')", timeout=10000)
        # feature extraction sanity check on synthetic landmarks (straight vs curled finger)
        feats = pg.evaluate("""async () => {
            const m = await import('./camera.js');
            const straight = [], curled = [];
            for (let i = 0; i < 21; i++) { straight.push({x: 0.5, y: 0.9 - i * 0.03, z: 0}); }
            for (let i = 0; i < 21; i++) { const k = i % 4; curled.push({x: 0.5 + (k >= 2 ? 0.03 : 0), y: 0.9 - (i < 1 ? 0 : 0.1) - (k === 1 ? 0.04 : k === 2 ? 0.05 : k === 3 ? 0.02 : 0), z: 0}); }
            return [m.featuresFromLandmarks(straight), m.featuresFromLandmarks(curled), m.teacherGesture([0,0,0,0,0,1.4,1.6]), m.teacherGesture([0.7,0.9,0.9,0.9,0.9,0.5,0.3])];
        }""")
        print("features straight:", [round(v, 2) for v in feats[0]])
        print("features curled  :", [round(v, 2) for v in feats[1]])
        print("teacher open/close:", feats[2], feats[3])
        pg.fill("#reps", "2"); pg.fill("#hold", "2.5")
        pg.click("#bCal")
        time.sleep(5)
        pg.screenshot(path=os.path.join(SHOTS, "cam_calibrating.png"))
        pg.wait_for_function("document.querySelector('#mode').textContent.includes('model lda_cam')", timeout=60000)
        dec = {}
        for g in ["open", "close", "pinch", "rest"]:
            shared["want"] = g
            time.sleep(1.0)
            dec[g] = shared["state"]
        print("decoded:", dec)
        ok &= all(dec[g] == g for g in dec)
        # play the game from the instructions on screen
        pg.click("#bGame")
        t_end = time.time() + 40
        shot = 0
        while time.time() < t_end:
            title = pg.inner_text("#bg").lower()
            sub = pg.inner_text("#bph").lower()
            if "fist" in title and "grab" in sub:
                shared["want"] = "close"
            elif "pinch" in title and "grab" in sub:
                shared["want"] = "pinch"
            elif "open" in title:
                shared["want"] = "open"
            elif "well done" in title or "arriving" in sub:
                shared["want"] = "rest"
            if shot < 3 and ("grab" in sub or "open" in title):
                pg.screenshot(path=os.path.join(SHOTS, f"game_{shot}.png")); shot += 1
            time.sleep(0.1)
        pg.click("#bGameStop")
        stats = {k: pg.inner_text("#" + k) for k in ("sTrials", "sRate", "sGrab", "sRel", "sWrong", "sDrop")}
        print("game stats:", stats)
        pg.screenshot(path=os.path.join(SHOTS, "game_end.png"))
        ok &= int(stats["sTrials"]) >= 3 and stats["sRate"] not in ("-", "0%")
        if errors:
            print("page errors:", errors); ok = False
        b.close()
finally:
    shared["stop"] = True
    srv.terminate()
    print(srv.communicate(timeout=5)[0][-1200:])
print("CAMERA E2E", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
