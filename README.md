# Módulo Firmware: Adquisición de Señales Físicas, Procesamiento Embebido y Telemetría MQTT en ESP32

> **Rama:** `firmware`  
> **Estado:** Funcional y Verificado  
> **Ámbito:** Sistemas embebidos en C++ (PlatformIO / Arduino Framework), adquisición de sensores (ACS712, MPU6050, DS18B20) y publicación MQTT sobre WiFi

---

## 1. Rol de la Rama `firmware` en la Arquitectura

Esta rama contiene exclusivamente el **código fuente embebido y la configuración de hardware** para el microcontrolador **ESP32**. 

Su separación en una rama dedicada del monorepositorio responde a razones técnicas fundamentales:

1. **Aislamiento de Toolchain y Compilador:** El microcontrolador requiere el compilador `xtensa-esp32-elf-g++` y el entorno **PlatformIO**, totalmente ajenos a los paquetes de Node.js o React.
2. **Ciclo de Desarrollo Especializado:** Permite a los desarrolladores de hardware calibrar sensores, ajustar filtros analógicos o modificar el mapeo de pines GPIO sin riesgo de alterar el código del backend o de la interfaz web.
3. **Optimización de Recursos Embebidos:** El código está diseñado para operar con estrictas restricciones de memoria RAM (SRAM del ESP32) y tiempos de ciclo precisos en microsegundos.

```
       SENSORES FÍSICOS (BOMBA DE AGUA)
┌──────────────────────────────────────────────┐
│ • Corriente AC:  ACS712 (GPIO 34 / ADC1)     │
│ • Vibración:     MPU6050 (I2C: GPIO 21/22)   │
│ • Temperatura:   DS18B20 (OneWire: GPIO 4)   │
└──────────────────────┬───────────────────────┘
                       │ Señales analógicas / digitales
                       v
         ┌────────────────────────────┐
         │       ESP32 Microchip      │
         │   (firmware/src/main.cpp)  │
         │ ┌────────────────────────┐ │
         │ │ Calibración Punto Cero │ │
         │ │ Cálculo RMS Real de AC │ │
         │ │ Filtro Dinámico Grav.  │ │
         │ │ Serialización JSON     │ │
         │ └───────────┬────────────┘ │
         └─────────────┼──────────────┘
                       │ WiFi (WPA2) / MQTT Tópico: bomba/telemetria
                       v
         ┌────────────────────────────┐
         │   Broker MQTT (Mosquitto)  │
         │    (Puerto estándar: 1883) │
         └────────────────────────────┘
```

---

## 2. Estructura de Archivos del Firmware

```text
firmware/
├── platformio.ini              # Configuración de compilación, placa y dependencias C++
└── src/
    └── main.cpp                # Rutinas de adquisición, filtros, conectividad WiFi y MQTT
```

---

## 3. Mapeo de Hardware y Conexión de Sensores

| Sensor | Variable Física | Pin ESP32 | Protocolo / Tipo | Detalles Técnicos |
| :--- | :--- | :--- | :--- | :--- |
| **ACS712 (5A)** | Corriente del motor (`current_a`) | `GPIO 34` | Analógico (ADC1_CH6) | Utiliza ADC1 (independiente del módem WiFi). Muestreo a 4 kHz para cálculo RMS en corriente alterna (50/60 Hz). |
| **MPU6050** | Vibración mecánica (`vibration_rms`) | `SDA: GPIO 21`<br>`SCL: GPIO 22` | Digital (I2C) | Rango $\pm 8\text{ g}$, filtro pasabajas de hardware a $94\text{ Hz}$. Resta el vector de gravedad para aislar aceleración dinámica en $\text{m/s}^2$. |
| **DS18B20** | Temperatura de carcasa (`temperature_c`) | `GPIO 4` | Digital (OneWire) | Sonda impermeable. Requiere resistencia pull-up de $4.7\text{ k}\Omega$ entre datos y $3.3\text{ V}$. Verificación por CRC. |

---

## 4. Funcionamiento de los Módulos de Software (`main.cpp`)

### A. Calibración y Cálculo de Corriente RMS Real (`readCurrentRMS`)
1. **Calibración de Inicio (`calibrateCurrentSensor`):** Promedia 200 muestras analógicas en vacío al encender el sistema para establecer la tensión de referencia de cero corriente ($V_{\text{zero}} \approx 1.65\text{ V}$), mitigando desviaciones térmicas y tolerancias de fabricación.
2. **Cálculo RMS:** Muestrea 160 lecturas con intervalos de $250\ \mu\text{s}$ (cubriendo dos ciclos completos de red a 50 Hz o más de dos a 60 Hz). Aplica la integral discreta cuadrática media:
   $$I_{\text{RMS}} = \sqrt{\frac{1}{N} \sum_{i=1}^{N} \left( \frac{V_i - V_{\text{zero}}}{\text{Sensibilidad}} \right)^2}$$
   Donde la sensibilidad para el modelo ACS712-05B es de $0.185\text{ V/A}$.

### B. Aceleración Dinámica y Vibración RMS (`readVibrationRMS`)
1. **Adquisición Vectorial:** Obtiene la aceleración instantánea en los tres ejes espaciales ($a_x, a_y, a_z$).
2. **Supresión de Gravedad:** Calcula la magnitud escalar total y le resta la componente estática de la gravedad terrestre ($g = 9.80665\text{ m/s}^2$):
   $$a_{\text{dinámica}} = | \sqrt{a_x^2 + a_y^2 + a_z^2} - 9.80665 |$$
3. **Valor RMS de Vibración:** Promedia ráfagas de 32 muestras consecutivas para estimar la severidad vibratoria de la bomba en $\text{m/s}^2$.

### C. Medición Digital de Temperatura (`readTemperatureC`)
* Solicita la conversión de temperatura al sensor DS18B20 por protocolo 1-Wire.
* Incorpora validación de seguridad: si la sonda se desconecta físicamente (`DEVICE_DISCONNECTED_C`), reporta un valor nominal de contingencia ($25.0\text{ °C}$) y previene lecturas atípicas erróneas.

### D. Máquina de Estados de Conectividad (WiFi + MQTT)
* **`connectWiFi()`:** Configura el ESP32 en modo estación (`WIFI_STA`) y se conecta a la red inalámbrica con sondeo de estado.
* **`ensureMqttConnected()`:** Si se pierde la conexión con Mosquitto, genera un `clientId` con entropía aleatoria y reintenta la conexión de manera persistente cada 2 segundos sin reiniciar el microcontrolador.
* **Publicación Periódica:** Mediante un temporizador no bloqueante basado en `millis()`, cada 1000 ms empaqueta la telemetría en un objeto `JsonDocument` estático y lo publica en `bomba/telemetria`:

```json
{
  "deviceId": "esp32-bomba-01",
  "experimentRunId": "corrida-001",
  "variables": {
    "current_a": 1.152,
    "vibration_rms": 1.238,
    "temperature_c": 42.15
  }
}
```

---

## 5. Dependencias y Bibliotecas en PlatformIO

Configuradas en `firmware/platformio.ini`:

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200
lib_deps =
    knolleary/PubSubClient @ ^2.8
    bblanchon/ArduinoJson @ ^7.0.4
    paulstoffregen/OneWire @ ^2.3.8
    milesburton/DallasTemperature @ ^3.11.0
    adafruit/Adafruit MPU6050 @ ^2.2.6
    adafruit/Adafruit Unified Sensor @ ^1.1.14
```

| Biblioteca | Justificación Técnica |
| :--- | :--- |
| **`PubSubClient`** (@^2.8) | Cliente MQTT estándar para sistemas embebidos. Implementación optimizada con mínimo consumo de RAM y sockets ligeros. |
| **`ArduinoJson`** (@^7.0.4) | Serialización de telemetría a formato JSON de alto rendimiento, evitando fragmentación de memoria dinámica (*heap fragmentation*). |
| **`OneWire`** (@^2.3.8) | Controlador a nivel de bits (*bit-banging*) para el bus propietario digital 1-Wire de Dallas/Maxim. |
| **`DallasTemperature`** (@^3.11.0) | Abstracción de alto nivel para gestionar la sonda DS18B20, conversión de temperatura en °C y verificación CRC de 8 bits. |
| **`Adafruit MPU6050`** (@^2.2.6) | Inicialización del circuito integrado MPU6050, control de registros I2C y configuración del filtro pasabajas digital (DLPF). |
| **`Adafruit Unified Sensor`** (@^1.1.14) | Capa de abstracción estándar para sensores inerciales de Adafruit. |

---

## 6. Guía de Compilación y Flasheo del ESP32

### Requisitos
* [Visual Studio Code](https://code.visualstudio.com/)
* Extensión oficial **PlatformIO IDE** instalada en VS Code
* Cable micro-USB conectado al ESP32

### Paso 1: Configurar Credenciales
Abre `firmware/src/main.cpp` y edita las constantes de red con los datos de tu entorno:
```cpp
const char* WIFI_SSID       = "NOMBRE_DE_TU_WIFI";
const char* WIFI_PASSWORD   = "PASSWORD_DE_TU_WIFI";
const char* MQTT_BROKER_IP  = "192.168.1.100"; // IP local donde corre Mosquitto
```

### Paso 2: Compilar el Proyecto
Haz clic en el icono de PlatformIO en la barra lateral de VS Code y selecciona:
* **Project Tasks** $\rightarrow$ `esp32dev` $\rightarrow$ **General** $\rightarrow$ **Build**  
*(O presiona el icono de la palomita `✓` en la barra inferior de VS Code).*

### Paso 3: Subir el Firmware al ESP32
Conecta el ESP32 al puerto USB y selecciona:
* **Project Tasks** $\rightarrow$ `esp32dev` $\rightarrow$ **General** $\rightarrow$ **Upload**  
*(O presiona la flecha `→` en la barra inferior).*

### Paso 4: Monitorear por Puerto Serie
Abre el monitor serie integrado configurado a **115200 baudios**:
* Presiona el icono del enchufe en la barra inferior de PlatformIO.
* Observarás el log de inicialización de sensores, la asignación de IP por WiFi y las publicaciones periódicas:
  ```text
  [MPU6050] Sensor de vibracion inicializado.
  [WiFi] Conectando a MiRed..... Conectado. IP: 192.168.1.50
  [MQTT] Conectado a Mosquitto.
  [MQTT TX] {"deviceId":"esp32-bomba-01","experimentRunId":"corrida-001","variables":{"current_a":1.152,"vibration_rms":1.238,"temperature_c":42.15}}
  ```

