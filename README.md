# Entorno de Integración Continua y Desarrollo (Branch: `dev`)

> **Rama:** `dev`  
> **Estado:** Integración Activa y Pruebas End-to-End (Staging)  
> **Propósito:** Espacio centralizado de convergencia donde se integran, prueban y validan los cambios provenientes de `back-end`, `front-end` y `firmware` antes de ser promovidos a producción (`main`).

---

## 1. Rol de la Rama `dev` en la Arquitectura de Ramas

En este monorepositorio, la rama **`dev`** actúa como el núcleo de integración del proyecto (*Integration Trunk*). 

```
   ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
   │  firmware   │       │  back-end   │       │  front-end  │
   │ (ESP32 C++) │       │ (Node/Mongo)│       │ (React/Vite)│
   └──────┬──────┘       └──────┬──────┘       └──────┬──────┘
          │                     │                     │
          └───────────────┐     │     ┌───────────────┘
                          v     v     v
                  ┌───────────────────────┐
                  │      rama: dev        │  <── Pruebas de Integración E2E,
                  │  (Integración Activa) │      Calibración y Validación
                  └───────────┬───────────┘
                              │
                              v  (Merge de versión estable)
                  ┌───────────────────────┐
                  │      rama: main       │  <── Producción Lista
                  │  (Despliegue Estable) │
                  └───────────────────────┘
```

### ¿Por qué existe esta rama?
* **Aislamiento de Errores de Integración:** Evita que pruebas intermedias, calibraciones de sensores o cambios de diseño afecten directamente a la rama de producción (`main`).
* **Verificación de Contratos de Interfaz:** Permite validar que el JSON emitido por el firmware C++ coincida exactamente con lo que espera el parser de Node.js y que los eventos SSE coincidan con el formato consumido por React.
* **Pruebas de Estrés y Simulación:** En esta rama se ensayan los escenarios extremos de falla de la bomba de agua mediante inyecciones simuladas o datos de telemetría de laboratorio.

---

## 2. Subsistemas Integrados y Funcionamiento en `dev`

En la rama `dev` coexisten e interactúan los tres componentes del sistema IoT:

### A. Módulo Firmware (`/firmware`)
* **Código C++ para ESP32 (PlatformIO):**
  * Rutina de calibración automática de punto cero para el sensor de corriente alterna ACS712 en GPIO 34.
  * Muestreo continuo del sensor de vibración triaxial MPU6050 vía I2C (GPIO 21/22), descontando la gravedad para obtener vibración RMS real en $m/s^2$.
  * Adquisición de temperatura con la sonda digital OneWire DS18B20 en GPIO 4.
  * Empaquetado en formato JSON (`ArduinoJson`) y despacho MQTT a 1 Hz en el tópico `bomba/telemetria`.

### B. Módulo Backend (`/backend`)
* **Servidor Node.js + Express:**
  * Conexión con MongoDB mediante Mongoose con esquemas fuertemente tipados e indexados (`models/Telemetry.js`).
  * Suscripción activa al broker Mosquitto (`mqtt://127.0.0.1:1883`).
  * **Motor de Análisis de Datos (100% JavaScript en `services/anomalyDetector.js`):**
    * **Umbrales Fijos:** Evalúa violaciones físicas inmediatas (marcha en seco, sobrecarga, cavitación, sobrecalentamiento).
    * **Z-Score y Modified Z-Score / MAD:** Ventana móvil de las últimas 30 muestras. Calcula la desviación típica y la Desviación Absoluta de la Mediana para filtrar falsos positivos causados por outliers.
    * **EWMA:** Suavizado exponencial para identificar derivas y fallas mecánicas progresivas.
    * **Modo Híbrido:** Ponderación conjunta de los tres métodos.
  * **Canal Server-Sent Events (SSE):** Transmisión continua de métricas en `/api/stream` con heartbeat automático para evitar desconexiones.
  * **Modo de Simulación de Respaldo:** El endpoint `/api/simulate` permite procesar y emitir anomalías en vivo aun cuando no se disponga físicamente del broker Mosquitto o del circuito.

### C. Módulo Frontend (`/frontend`)
* **Single Page Application en React 19 + Vite:**
  * Estilizado utilitario con Tailwind CSS v4 en modo oscuro responsivo.
  * Indicador de estado de conexión SSE en vivo.
  * Gráficas reactivas generadas en SVG puro (sin librerías pesadas) para corriente, vibración y temperatura, con marcadores automáticos en lecturas anómalas.
  * Selector dinámico de algoritmo de backend en caliente y conmutador de corridas experimentales (`experimentRunId`).
  * Historial reactivo con filtrado exclusivo de anomalías consultado desde MongoDB.

---

## 3. Dependencias Instaladas y Justificación de Arquitectura

### En el Backend (`backend/package.json`)
| Dependencia | Rol en la Integración |
| :--- | :--- |
| **`express`** | Servidor base para las rutas REST de consulta, configuración y el canal de eventos SSE. |
| **`mongoose`** | Modelado estricto del documento de telemetría y persistencia estructurada en MongoDB. |
| **`mqtt`** | Comunicación asíncrona para recibir el paquete de sensores enviado por Mosquitto. |
| **`cors`** | Permite el consumo de endpoints entre el puerto del frontend (`5173`) y el backend (`3000`). |
| **`dotenv`** | Centraliza la configuración de entorno (`PORT`, `MONGO_URI`, `MQTT_TOPIC`) sin exponer credenciales. |
| **`nodemon`** | Recarga en caliente en desarrollo para acelerar pruebas de ajuste algorítmico. |

### En el Frontend (`frontend/package.json`)
| Dependencia | Rol en la Integración |
| :--- | :--- |
| **`react`** y **`react-dom`** (v19) | Construcción de la interfaz de usuario reactiva para refresco de métricas por telemetría. |
| **`vite`** | Servidor de desarrollo con Hot Module Replacement (HMR) y compilación optimizada. |
| **`tailwindcss`** (v4) | Framework CSS para estructurar el panel de control industrial de alta legibilidad. |
| **`@tailwindcss/postcss`** | Adaptador requerido por Tailwind v4 para integrarse correctamente con el pipeline de PostCSS en Vite. |
| **`postcss`** y **`autoprefixer`** | Procesamiento y compatibilidad de hojas de estilo entre navegadores. |

### En el Firmware (`firmware/platformio.ini`)
| Dependencia | Rol en la Integración |
| :--- | :--- |
| **`PubSubClient`** | Cliente MQTT liviano para publicación de paquetes en microcontroladores con recursos limitados. |
| **`ArduinoJson`** | Serialización JSON eficiente sin fragmentación de memoria heap en el ESP32. |
| **`OneWire`** & **`DallasTemperature`** | Lectura digital calibrada de la temperatura de la bomba por bus 1-Wire. |
| **`Adafruit MPU6050`** & **`Unified Sensor`** | Interfaz I2C para adquisición y filtrado de la aceleración del motor. |

---

## 4. Cambios Funcionales Probados con Éxito en `dev`

1. **Fusión Limpia Multi-Rama:** Integración exitosa de los árboles de trabajo de `firmware`, `back-end` y `front-end` sin colisiones de dependencias.
2. **Evaluación de Algoritmos en Tiempo Real:** Validación de la detección simultánea de umbrales y Z-Score con MAD sobre series temporales de 30 datos.
3. **Resiliencia de Streaming:** Pruebas exitosas de recepción en el frontend vía `EventSource` conectando con `GET /api/stream`.
4. **Endpoints de Control y Diagnóstico:**
   * `GET /api/estado`: Reporte del estado de conexión de MongoDB y Mosquitto.
   * `GET /api/config` y `POST /api/config`: Modificación en caliente del algoritmo activo y reinicio de la ventana móvil.
   * `POST /api/simulate`: Inyección de muestras nominales y fallas críticas directamente a la cadena de procesamiento.
5. **Configuración Validada de Tailwind v4:** Solución aplicada mediante `@tailwindcss/postcss` y `@import "tailwindcss"` en `index.css`.

---

## 5. Guía de Ejecución y Pruebas E2E en `dev`

### Iniciar Servicios de Respaldo
Asegúrate de tener corriendo en tu máquina local:
* **MongoDB:** en el puerto por defecto `27017`
* **Mosquitto MQTT:** en el puerto `1883` *(opcional si pruebas con el simulador web)*

### Levantar el Entorno de Pruebas
1. **Terminal 1 — Backend:**
   ```bash
   cd backend
   npm run dev
   ```
2. **Terminal 2 — Frontend:**
   ```bash
   cd frontend
   npm run dev
   ```
3. Abre en tu navegador: `http://localhost:5173`

### Inyección de Pruebas Rápidas
* **Prueba Nominal:** Pulsa `+ Muestra Nominal` en el dashboard para verificar la estabilidad de las bandas estadísticas.
* **Prueba de Anomalía Crítica:** Pulsa `⚡ Simular Cavitación / Falla` para disparar el estado `CRITICAL`, observar el trazo de puntos rojos en las gráficas SVG y verificar la persistencia en MongoDB.

