# Thesis outline (target 50-60 pages)

**Title:** Development and Evaluation of a Low-Cost EMG and Force-Myography Sensor Band for Real-Time Virtual Prosthesis Training

| Chapter | Content | Source in this repo | Pages |
|---|---|---|---|
| Abstract | 250 words, English (+ German "Kurzfassung" if required) | write last | 1 |
| 1 Introduction | upper-limb loss, waiting time before fitting, home training, research questions RQ1-RQ4, structure | - | 4 |
| 2 Fundamentals | muscle physiology, sEMG (origin, electrodes, noise, filtering), FMG (FSR physics, voltage divider, hysteresis), pattern recognition (windows, Hudgins features, LDA), measurement terms (accuracy, latency, repeatability) | `pb/features.py` | 10 |
| 3 State of the art | myoelectric control, virtual/VR training, EMG vs FMG vs hybrid, public datasets (NinaPro, MyoKi, GREF, GRABMyo), gap | literature | 6 |
| 4 System design | band hardware, wiring, ESP32 firmware, data format, real-time software, virtual hand on the scanned limb | `firmware/`, `realtime/`, `virtual_hand/` | 10 |
| 5 Methods | Part A experiments E1-E4; Part B protocol and experiments B1-B4; statistics | `analysis/`, `docs/protocol_self_experiment.md` | 7 |
| 6 Results | Part A figures and tables; Part B figures; latency | `results_partA/`, `results_partB/` | 10 |
| 7 Discussion | answers to RQ1-RQ4, low-cost vs lab sensors, limitations (single subject, healthy, sensor mismatch), clinical relevance | - | 5 |
| 8 Conclusion and outlook | summary, future work: amputee study, scan-fitted 3D-printed band, VR (WebXR), more movements | - | 2 |
| References, appendix | wiring diagram, code listing excerpts, protocol, raw tables | - | - |

## Research questions
- **RQ1** How do EMG, FMG and hybrid sensing compare for grasp classification, and how much accuracy is lost with a low-cost 2 EMG + 16 FSR configuration? (Part A, E1)
- **RQ2** How many calibration repetitions does a new user need, and does pre-training on other people's data reduce this? (E2, B3)
- **RQ3** How robust is each modality to re-donning and shifting/rotating the band? (E3, B2, B4)
- **RQ4** Does the complete low-cost real-time system meet a latency target below 150 ms? (B, latency)

## Writing order (fits the 8-week plan)
Week 2: Ch. 2, 3 · Week 3-4: Ch. 4 · Week 4: Ch. 5 · Week 6: Ch. 6 · Week 7: Ch. 7, 8, abstract · Week 8: corrections.
