# Protocol: single-subject study with the sensor band (Part B)

**Participant:** the author only (healthy, right forearm). No other participants.
Check with the supervisor whether a self-experiment needs any ethics form at Coburg.

## Setup
- Band on the right forearm at the largest circumference, about 1/3 from the elbow.
- EMG 1 over the flexor side (palm side), EMG 2 over the extensor side (back of forearm).
- FSR ring evenly around the forearm, snug but comfortable (two fingers fit under the strap).
- Mark the band position on the skin with a skin marker at the first session (reference for later days).
- Sit with the elbow on the table at 90 degrees, forearm relaxed.

## Gestures (4)
rest · open (fingers extended) · close (fist, moderate force) · pinch (thumb + index)

## Each session (about 20 minutes)
1. Put the band on fresh (take it off between sessions).
2. Start `realtime\server.py --source serial --port COMx`, open http://localhost:8000.
3. **Record**: repetitions 6, hold 4 s, tag `dayN` (N = day number). Follow the on-screen prompts.
4. Day 3 only, after step 3: move the band 1 cm towards the wrist, record with tag `day3_shift1cm`;
   then 2 cm, tag `day3_shift2cm`.
5. **Calibrate** with 3 repetitions, then 2 minutes of free use (live demo; note observations).
6. Latency check (once): film the screen and the ESP32 LED with a phone at 240 fps while making
   a fist 10 times; count frames between LED-on and the hand closing on screen.

## Schedule
| Day | Sessions |
|---|---|
| 1, 2 | `dayN` |
| 3 | `day3`, `day3_shift1cm`, `day3_shift2cm` |
| 4-6 | `dayN` (6 days in total, ideally not consecutive) |

## Outcome measures
- Classification accuracy and macro-F1 (within session, across days, after band shift)
- Number of calibration repetitions needed (with and without pre-training on other days)
- Processing time per window (logged) and end-to-end latency (camera method)
- Signal quality: EMG RMS at rest vs. contraction (SNR), FSR drift over a 4 s hold

## Notes to keep
Date, time, room temperature, skin condition, band tightness, anything unusual.
