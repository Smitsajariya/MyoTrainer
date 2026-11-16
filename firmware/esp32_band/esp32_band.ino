/*
  Proposal B sensor band firmware (ESP32 DevKit).

  Inputs
    EMG 1 (flexor side)   -> GPIO34  (DFRobot/OYMotion Gravity analog EMG, 0-3 V, 1.5 V reference)
    EMG 2 (extensor side) -> GPIO35
    16 FSR via CD74HC4067 multiplexer:
      SIG -> GPIO36 (VP), S0..S3 -> GPIO25, 26, 27, 14, EN -> GND
      each FSR: 3V3 -> FSR -> SIG node, and 10 kOhm from SIG node to GND (voltage divider)
  Output (USB serial, 921600 baud, text lines)
    E,<ms>,<emg1>,<emg2>          every 1 ms  (1 kHz)
    F,<ms>,<f0>,...,<f15>         every 10 ms (100 Hz)
  Input (single characters from the PC, used for latency measurement with a camera)
    'C' -> LED on (hand closed), 'O','R','P' -> LED off
  Only ADC1 pins are used so that Wi-Fi/Bluetooth can be added later for home use.
*/

const int EMG_PINS[2] = {34, 35};
const int MUX_SIG = 36;
const int MUX_S[4] = {25, 26, 27, 14};
const int LED_PIN = 2;

const uint32_t EMG_PERIOD_US = 1000;   // 1 kHz
const uint32_t FMG_EVERY_N = 10;       // FMG every 10 EMG samples -> 100 Hz

uint32_t nextTick = 0;
uint32_t tickCount = 0;

void setMux(int ch) {
  for (int b = 0; b < 4; b++) digitalWrite(MUX_S[b], (ch >> b) & 1);
}

void setup() {
  Serial.begin(921600);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);      // full 0-3.3 V range
  for (int b = 0; b < 4; b++) pinMode(MUX_S[b], OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  nextTick = micros();
}

void loop() {
  // commands from the PC (latency LED)
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'C') digitalWrite(LED_PIN, HIGH);
    else if (c == 'O' || c == 'R' || c == 'P') digitalWrite(LED_PIN, LOW);
  }

  uint32_t now = micros();
  if ((int32_t)(now - nextTick) < 0) return;
  nextTick += EMG_PERIOD_US;
  uint32_t ms = millis();

  int e1 = analogRead(EMG_PINS[0]);
  int e2 = analogRead(EMG_PINS[1]);
  Serial.printf("E,%lu,%d,%d\n", (unsigned long)ms, e1, e2);

  if (++tickCount % FMG_EVERY_N == 0) {
    char buf[160];
    int n = snprintf(buf, sizeof(buf), "F,%lu", (unsigned long)ms);
    for (int ch = 0; ch < 16; ch++) {
      setMux(ch);
      delayMicroseconds(5);            // let the mux settle
      n += snprintf(buf + n, sizeof(buf) - n, ",%d", analogRead(MUX_SIG));
    }
    Serial.println(buf);
  }
}
