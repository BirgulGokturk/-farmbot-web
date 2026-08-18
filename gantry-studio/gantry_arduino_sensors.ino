/*
 * gantry_arduino_sensors.ino — faster version for R&D.
 *
 * Changes from the current sketch:
 *   - INTERVAL_MS 5000 -> 250. Five seconds is fine for a field crop; it is
 *     useless when you are watching a value while turning a knob.
 *   - analogRead is averaged over 4 samples, because at 4 Hz you see the ADC
 *     noise that the 5 s interval was hiding.
 *   - Sends only what changed... no. It sends everything every time; the app
 *     overwrites its dict anyway and partial payloads would break the CSV
 *     history columns.
 *
 * Do NOT go much below 250 ms. The app appends a CSV history row per reading,
 * so 4 Hz is already 14k rows an hour on the SD card. (The patched app throttles
 * the JSON snapshot to 1 Hz, but the CSV row is per reading by design.)
 *
 * Temperature / humidity / pressure are still the placeholder constants from
 * the original sketch. The DHT and BMP280 blocks below are commented out and
 * ready — uncomment them when the sensors are actually fitted, and delete the
 * three constants. Until then, treat 22.5 / 60 / 1013.25 on the HMI as "not
 * wired", not as data.
 */

#define INTERVAL_MS 250        // was 5000

#define WATER_PIN A0
#define RAIN_PIN  A1

// ---- real sensors: uncomment when fitted -------------------------------
// #include <DHT.h>
// #include <Adafruit_BMP280.h>
// #define DHT_PIN  2
// #define DHT_TYPE DHT22
// DHT dht(DHT_PIN, DHT_TYPE);
// Adafruit_BMP280 bmp;
// ------------------------------------------------------------------------

unsigned long last_read = 0;

int readAveraged(int pin) {
  long sum = 0;
  for (int i = 0; i < 4; i++) { sum += analogRead(pin); delayMicroseconds(200); }
  return (int)(sum / 4);
}

void setup() {
  Serial.begin(115200);
  delay(100);
  // dht.begin();
  // bmp.begin(0x76);
  Serial.println("{\"status\": \"Arduino ready\"}");
}

void loop() {
  unsigned long now = millis();
  if (now - last_read < INTERVAL_MS) return;   // no delay() — keeps the loop responsive
  last_read = now;

  int water_raw = readAveraged(WATER_PIN);
  int rain_raw  = readAveraged(RAIN_PIN);

  float water_pct = (water_raw / 1023.0) * 100.0;
  float rain_pct  = (rain_raw  / 1023.0) * 100.0;

  float temperature = 22.5;    // placeholder — not a real reading
  float humidity    = 60.0;    // placeholder
  float pressure    = 1013.25; // placeholder
  // temperature = dht.readTemperature();
  // humidity    = dht.readHumidity();
  // pressure    = bmp.readPressure() / 100.0;

  Serial.print("{\"water_level_pct\": ");   Serial.print((int)water_pct);
  Serial.print(", \"rain_pct\": ");         Serial.print((int)rain_pct);
  Serial.print(", \"temperature\": ");      Serial.print(temperature, 1);
  Serial.print(", \"humidity\": ");         Serial.print(humidity, 1);
  Serial.print(", \"pressure_hpa\": ");     Serial.print(pressure, 2);
  Serial.println("}");
}
