# Virtual Prosthesis Trainer

Train myoelectric hand control before the real prosthesis is ready: a virtual prosthetic hand on a forearm,
driven by camera hand tracking today and by a self-designed EMG + FMG sensor band next, with three therapy games.

**Gameplay videos and 3D band:** https://smit-sakariya-thesis.pages.dev

## Demo

**▶ Play it in your browser:** https://smitsajariya.github.io/virtual-prosthesis-trainer/  
Needs a laptop with a webcam and Chrome or Edge. Click **Start camera**, allow the camera, show your right hand, then pick a game.


| Game 1 · Build a tower | Game 2 · Fruit basket | Game 3 · Match it |
|---|---|---|
| ![Build a tower](docs/demo/tower.gif) | ![Fruit basket](docs/demo/fruit.gif) | ![Match it](docs/demo/match.gif) |
| [Full video (1:43)](docs/demo/game1_tower.mp4) | [Full video (1:31)](docs/demo/game2_fruit.mp4) | [Full video (2:31)](docs/demo/game3_match.mp4) |

The hand is tracked by the laptop camera; the blue band on the forearm marks where the sensor band will sit.
Each game trains grasp, carry and release, with selectable rounds and "pick it up yourself" reach rounds.

## 3D sensor band

[![Sensor band](docs/demo/band3d.jpg)](https://smitsajariya.github.io/virtual-prosthesis-trainer/hardware/band/band_print_parts.html)

**▶ Turn the band in 3D:** https://smitsajariya.github.io/virtual-prosthesis-trainer/hardware/band/band_print_parts.html  
**Band design (sensors, wiring, ESP32):** https://smitsajariya.github.io/virtual-prosthesis-trainer/docs/band_design/band_design.html

A 3D-printed band for the forearm: 8 pods with 16 force sensors (FSR 402, two per pod), 2 EMG sensors and an ESP32 box.
Printable files are in [`hardware/band/`](hardware/band/) (`band_pod_x8.stl`, `band_button_x16.stl`, `band_box.stl`, `band_box_lid.stl`);
`make_band.py` generates them, so sizes can be changed in one place.

## Proposal B: EMG + FMG sensor band for virtual prosthesis training

M.Sc. thesis project, Smit Gangdasbhai Sakariya, AIMS, Coburg University.

A low-cost band (2 dry EMG sensors + 16 force-sensitive resistors) reads muscle activity on the forearm.
An LDA classifier decodes four movements (rest, open, close, pinch) in real time and drives a
virtual prosthetic hand mounted on a 3D-scanned residual limb, shown in the browser.

```
proposal-b/
  pb/                   shared signal processing and classifiers (used offline AND in real time)
  analysis/             Part A: public dataset (MyoKi) experiments  |  Part B: own recordings
  realtime/             real-time server (sensor band / simulator / replay -> classifier -> browser)
  virtual_hand/         browser app (Three.js), works offline; open via the server
  firmware/esp32_band/  ESP32 firmware for the band
  tests/                end-to-end test and synthetic data generators
  docs/                 protocol, shopping list, band design, thesis outline
```

## 1. Install (Windows, once)

1. Install Python 3.11 or newer from python.org (tick "Add python.exe to PATH").
2. Open a terminal in this folder and run:
   ```
   python -m pip install -r requirements.txt
   ```

## 2. Camera mode and game (no band needed)

Double-click `start_demo.bat` (or `python realtime\server.py --source camera`), then in http://localhost:8000:
1. **Start camera** and allow webcam access. Show your hand; the green skeleton and finger bars follow it.
   (The hand model is downloaded from Google the first time, so internet is needed once.)
2. **Calibrate** (3 repetitions, hold 3 s): copy each gesture shown on screen in front of the camera.
3. **Start game**: apples need a FIST, grapes need a PINCH; hold, then OPEN to drop into the basket.
   Results: `recordings\game_<time>.csv` (reaction time, success, wrong grasp, drops).
- *Mirror my fingers directly*: the virtual hand copies every finger without the AI (demo).
- *Use camera as teacher*: when the band is connected (`--source serial`), the camera gives the labels
  for training instead of the on-screen prompts (mirror training: free hand in front of the camera).

## 2. Copy my whole hand (Lab page, http://localhost:8000)

Start camera -> the virtual arm copies your hand like a mirror: every finger joint (3D landmarks), the hand's
orientation (turn, tilt) and its position (left-right, up-down, near-far from hand size).
**Record my movement** saves the camera movement (21 3D points per frame) to `recordings\motion_<time>.json`
and **Replay** plays it back on the virtual arm. Uncheck "Copy my whole hand" to see only the decoded gesture
(what the band AI will do).

## 2a. Smit's Kitchen: the training game (http://localhost:8000/play.html)

`start_demo.bat` opens it directly. Three levels plus a progress dashboard:
| Level | What you do | What it measures |
|---|---|---|
| 1 Gesture Rhythm | make fist / open / pinch as each card hits the ring, speed adapts | accuracy, reaction time per gesture, confusions |
| 2 Fruit Kitchen | fist for apple/orange/banana, pinch for berries/grapes, open over the blender | task time, wrong grasps, drops |
| 3 Steady Pour | squeeze just enough to pour water to the line | grip-force control error, splashes |

Input order: AI model on the server (band) -> camera -> keyboard (1 rest, 2 open, 3 fist, 4 pinch, Space = squeeze) and mouse.
**Auto-reach** moves the hand by itself, so a band-only user (no position sensor) can play with gestures only.
Every session is saved to `recordings\game_history.json` and `recordings\game_events.jsonl` (thesis data).

**Calibrate my hand (20 s):** copy OPEN, FIST, PINCH, REST twice. A personal camera AI is trained on your hand and its
honest accuracy (train on round 1, test on round 2) is shown per gesture. It is saved in the browser and the report goes to
`recordings\camera_calibration.jsonl`. With the band, these better camera labels are what the band AI learns from.
**Fingers: mirror:** every virtual finger follows your own finger (camera). Off = the hand only shows the decoded gesture
(what the band can do).

**Your printed hand:** the virtual hand is built from your own STL files (`Hand4RIGHT`, `Fingerdesign_8-7_*`, `ArmPiece_1`)
by `python tools\build_arm_model.py "<folder with the STLs>"` -> `virtual_hand\models\arm\`. `virtual_hand\hand_viewer.html`
shows it in every pose. Delete `models\arm` to go back to the built-in hand.

**Meshy models:** download fruit GLBs from meshy.ai (CC0, ~10k faces is best). At start the server copies
`Downloads\*apple*.glb`, `*orange*`, `*banana*`, `*strawberr*`, `*grape*`, `*cherr*`, `*bowl*` into `virtual_hand\models\`
and the game uses them instead of the built-in shapes.

## 2b. Try it with the simulated band

```
python realtime\server.py --source sim
```
Open http://localhost:8000 in Chrome.
1. Set Repetitions = 3, press **Calibrate**, and follow the prompts (in simulator mode the
   gestures are performed automatically).
2. After calibration a model is trained (`models\lda_....joblib`).
3. Press keys **1-4** (rest, open, close, pinch): the simulated muscles change and the hand follows the decoder.

Without the server, the page still opens from `virtual_hand\index.html` through any local web server as a demo.

## 3. Part A: public data (no hardware)

Download MyoKi participants **P26-P35** (the ones with FMG) from
https://doi.org/10.6084/m9.figshare.28696778 (each file is about 4 GB; start with 3 files).

```
python analysis\run_experiments.py --data-dir D:\MyoKi --subjects P26-P28 --out results_partA
```
The first run is slow (it filters the raw data); features are cached in `results_partA\cache`,
so later runs take seconds. Outputs: CSV tables and thesis figures (`fig_e1...png` etc.).

| Experiment | Question |
|---|---|
| E1 within-subject | EMG vs FMG vs hybrid, full lab setup vs low-cost (2 EMG + 16 FSR) |
| E2 calibration | how many calibration repetitions a new user needs, with/without pre-training on others |
| E3 band rotation | accuracy when the band is put on rotated by one sensor module |
| E4 cross-subject | accuracy for a new user without any calibration |

Test the pipeline without the real data:
```
python analysis\make_synthetic_myoki.py --out synthetic_data --n 4
python analysis\run_experiments.py --data-dir synthetic_data --subjects P26-P29 --out results_test
```

> Check assumption: the loader assumes the 24 FMG columns are grouped 4 per bracelet module in
> module order (`analysis\myoki_loader.py`, `fmg_module_cols`). Verify against Fig. 4 of the MyoKi paper.

## 4. Hardware

Wiring is at the top of `firmware\esp32_band\esp32_band.ino`. Flash it with the Arduino IDE
(board: "ESP32 Dev Module"), then:
```
python realtime\server.py --source serial --port COM5
```

## 5. Part B: your own sessions (single subject)

Follow `docs\protocol_self_experiment.md`. In the web page use **Record** with a tag such as
`day1`, `day3_shift1cm`. Then:
```
python analysis\own_experiments.py --rec recordings --out results_partB
```

## 6. Test everything

```
python tests\make_sim_sessions.py sim_recordings
python analysis\own_experiments.py --rec sim_recordings --out results_sim
python tests\e2e_sim.py            (needs: pip install playwright && playwright install chromium)
```

## Data and licences
- MyoKi: Andreas et al., *Scientific Data* 12:1507 (2025), CC BY 4.0.
- Residual-limb model derived from "Arm" by Artec 3D (artec3d.com), CC BY 3.0.
- Three.js (MIT licence) is included in `virtual_hand/vendor`.
