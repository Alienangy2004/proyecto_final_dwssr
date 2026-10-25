#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ================= CREDENCIALES DE RED Y MQTT =================
const char* WIFI_SSID       = "TU_RED_WIFI";
const char* WIFI_PASSWORD   = "TU_PASSWORD_WIFI";
const char* MQTT_BROKER_IP  = "192.168.1.100"; // IP local donde corre Mosquitto
const uint16_t MQTT_PORT    = 1883;
const char* MQTT_TOPIC      = "bomba/telemetria";
const char* DEVICE_ID       = "esp32-bomba-01";
const char* EXPERIMENT_RUN  = "corrida-001";

// ================= PINES DE SENSORES =================
constexpr int PIN_CURRENT_ADC = 34; // ADC1_CH6 para ACS712 / SCT-013
constexpr int PIN_ONEWIRE     = 4;  // Sonda DS18B20

// Parámetros de calibración ACS712 (versión 5A = 0.185 V/A, 20A = 0.100 V/A)
constexpr float ADC_VREF         = 3.3f;
constexpr float ADC_RESOLUTION   = 4095.0f;
constexpr float ACS712_SENS      = 0.185f;
float zeroCurrentVoltage         = 1.65f;

WiFiClient espClient;
PubSubClient mqttClient(espClient);
Adafruit_MPU6050 mpu;
OneWire oneWire(PIN_ONEWIRE);
DallasTemperature tempSensor(&oneWire);

bool mpuAvailable = false;
unsigned long lastPublishMs = 0;
constexpr unsigned long PUBLISH_INTERVAL_MS = 1000; // 1 Hz

// ================= FUNCIONES DE ADQUISICIÓN =================

void calibrateCurrentSensor() {
  long sum = 0;
  constexpr int samples = 200;
  for (int i = 0; i < samples; i++) {
    sum += analogRead(PIN_CURRENT_ADC);
    delay(2);
  }
  zeroCurrentVoltage = (sum / (float)samples) * (ADC_VREF / ADC_RESOLUTION);
}

float readCurrentRMS() {
  constexpr int numSamples = 160;
  double sumSquares = 0.0;

  for (int i = 0; i < numSamples; i++) {
    int raw = analogRead(PIN_CURRENT_ADC);
    float voltage = raw * (ADC_VREF / ADC_RESOLUTION);
    float instantCurrent = (voltage - zeroCurrentVoltage) / ACS712_SENS;
    sumSquares += (instantCurrent * instantCurrent);
    delayMicroseconds(250);
  }
  return sqrt(sumSquares / numSamples);
}

float readVibrationRMS() {
  if (!mpuAvailable) {
    return 0.0f;
  }
  constexpr int samples = 32;
  double sumDynamicSq = 0.0;

  for (int i = 0; i < samples; i++) {
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);
    float mag = sqrt(
      a.acceleration.x * a.acceleration.x +
      a.acceleration.y * a.acceleration.y +
      a.acceleration.z * a.acceleration.z
    );
    // Restar aceleración de la gravedad (9.80665 m/s^2)
    float dynamicAcc = fabs(mag - 9.80665f);
    sumDynamicSq += (dynamicAcc * dynamicAcc);
    delay(2);
  }
  return sqrt(sumDynamicSq / samples);
}

float readTemperatureC() {
  tempSensor.requestTemperatures();
  float tempC = tempSensor.getTempCByIndex(0);
  if (tempC == DEVICE_DISCONNECTED_C || tempC < -40.0f || tempC > 125.0f) {
    return 25.0f; // Valor de respaldo si la sonda se desconecta
  }
  return tempC;
}

// ================= CONECTIVIDAD WIFI Y MQTT =================

void connectWiFi() {
  Serial.printf("[WiFi] Conectando a %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n[WiFi] Conectado. IP: %s\n", WiFi.localIP().toString().c_str());
}

void ensureMqttConnected() {
  while (!mqttClient.connected()) {
    Serial.print("[MQTT] Intentando conexión a Mosquitto...");
    String clientId = String(DEVICE_ID) + "-" + String(random(0xffff), HEX);
    if (mqttClient.connect(clientId.c_str())) {
      Serial.println(" conectado.");
    } else {
      Serial.printf(" falló (rc=%d). Reintentando en 2 s...\n", mqttClient.state());
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);

  // Inicializar sensores
  tempSensor.begin();
  Wire.begin(21, 22);
  if (mpu.begin()) {
    mpuAvailable = true;
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setFilterBandwidth(MPU6050_BAND_94_HZ);
    Serial.println("[MPU6050] Sensor de vibración inicializado.");
  } else {
    Serial.println("[MPU6050] No detectado en bus I2C.");
  }

  calibrateCurrentSensor();
  connectWiFi();
  mqttClient.setServer(MQTT_BROKER_IP, MQTT_PORT);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }
  if (!mqttClient.connected()) {
    ensureMqttConnected();
  }
  mqttClient.loop();

  unsigned long now = millis();
  if (now - lastPublishMs >= PUBLISH_INTERVAL_MS) {
    lastPublishMs = now;

    float currentA     = readCurrentRMS();
    float vibrationRms = readVibrationRMS();
    float temperatureC = readTemperatureC();

    JsonDocument doc;
    doc["deviceId"]        = DEVICE_ID;
    doc["experimentRunId"] = EXPERIMENT_RUN;
    JsonObject vars        = doc["variables"].to<JsonObject>();
    vars["current_a"]      = serialized(String(currentA, 3));
    vars["vibration_rms"]  = serialized(String(vibrationRms, 3));
    vars["temperature_c"]  = serialized(String(temperatureC, 2));

    char buffer[256];
    size_t len = serializeJson(doc, buffer, sizeof(buffer));

    if (mqttClient.publish(MQTT_TOPIC, buffer, len)) {
      Serial.printf("[MQTT TX] %s\n", buffer);
    } else {
      Serial.println("[MQTT TX] Error al publicar paquete JSON");
    }
  }
}

