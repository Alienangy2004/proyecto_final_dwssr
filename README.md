# Sistema IoT de Monitoreo y Detección de Anomalías en Tiempo Real para Bomba de Agua (MERN + ESP32 + MQTT)

> **Rama:** `main`  
> **Estado:** Producción / Versión Estable Integrada  
> **Arquitectura:** Monorepositorio desacoplado (Firmware C++ + Backend Node.js + Base de Datos MongoDB + Frontend React)

---

## 1. Visión General del Proyecto

Este repositorio contiene la solución completa de ingeniería para el **monitoreo en tiempo real y la detección automatizada de anomalías físico-mecánicas en una bomba de agua**. 

El sistema adquiere señales de sensores industriales mediante un microcontrolador **ESP32**, transmite los datos vía **MQTT (Mosquitto)**, los procesa y evalúa en un backend **Node.js / Express** utilizando **algoritmos matemáticos y estadísticos implementados estrictamente en JavaScript**, persiste los registros en **MongoDB** y proyecta la telemetría en vivo a un panel de control interactivo construido en **React + Tailwind CSS** mediante **Server-Sent Events (SSE)**.

```
┌─────────────────┐       MQTT (1883)       ┌────────────────────────┐
│  ESP32 Firmware │ ─────────────────────> │ Mosquitto MQTT Broker  │
│ (PlatformIO/C++)│                         └───────────┬────────────┘
└─────────────────┘                                     │
                                                   JSON │ Tópico: bomba/telemetria
                                                        v
                                            ┌────────────────────────┐
                                            │     Backend Express    │
                                            │ ┌────────────────────┐ │
                                            │ │ Anomaly Engine(JS) │ │
                                            │ │ • Umbrales Fijos   │ │
                                            │ │ • Z-Score / MAD    │ │
                                            │ │ • EWMA Adaptativo  │ │
                                            │ └─────────┬──────────┘ │
                                            └───────────┼────────────┘
                                                        │
                         ┌──────────────────────────────┴──────────────────────────────┐
                         │                                                             │
                         v (Mongoose ODM)                                              v (SSE /api/stream)
             ┌────────────────────────┐                                   ┌────────────────────────┐
             │    MongoDB Database    │                                   │     Frontend Client    │
             │  (Historial y Eventos) │                                   │     (React + Vite)     │
             └────────────────────────┘                                   └────────────────────────┘
```

---

## 2. Arquitectura de Ramas (Estrategia de Control de Versiones)

El repositorio fue diseñado bajo un esquema riguroso de branching para aislar responsabilidades tecnológicas heterogéneas (firmware embebido, servidor de análisis y cliente web):

| Rama | Propósito y Alcance Tecnológico |
| :--- | :--- |
| **`main`** | **Rama de Producción Consolidada (Esta rama).** Aloja la versión estable, integrada y verificada de todos los subsistemas. No recibe commits directos de desarrollo, únicamente merges de integración probados desde `dev`. |
| **`dev`** | **Rama de Integración Continua.** Espacio donde convergen los cambios validados de `front-end`, `back-end` y `firmware` para pruebas de interoperabilidad y pruebas de sistema end-to-end. |
| **`back-end`** | **Aislamiento del Servidor.** Contiene exclusivamente la API Express, la conexión con Mosquitto, la integración con MongoDB (Mongoose) y el motor de detección de anomalías ejecutado 100% en JavaScript. |
| **`front-end`** | **Aislamiento de la Interfaz Web.** Contiene la SPA desarrollada con React, Vite, Tailwind CSS y el consumidor en tiempo real Server-Sent Events (SSE). |
| **`firmware`** | **Aislamiento del Hardware Embebido.** Contiene el código fuente en C++, los controladores de periféricos (ADC, I2C, OneWire) y la configuración de PlatformIO para el microcontrolador ESP32. |

### ¿Por qué se dividió en estas ramas?
1. **Heterogeneidad de Entornos:** El microcontrolador utiliza un toolchain de C++ y PlatformIO, mientras que el resto del sistema opera sobre Node.js y React. Separarlos previene interferencias en herramientas de compilación y linters.
2. **Ciclo de Vida Independiente:** Es posible calibrar sensores o ajustar filtros en el firmware sin alterar la API de producción, o rediseñar la UI sin riesgo de tocar la persistencia de datos.
3. **Control de Calidad:** Garantiza que a `main` solo lleguen implementaciones donde la cadena completa (Sensor $\rightarrow$ Broker $\rightarrow$ Análisis $\rightarrow$ Base de Datos $\rightarrow$ UI) esté validada y libre de regresiones.

---

## 3. Funcionamiento de los Componentes del Sistema

### A. Adquisición y Telemetría (`firmware/`)
* **Corriente RMS (`current_a`):** Muestreo en ráfaga (160 lecturas @ 4 kHz) en ADC GPIO 34 (ACS712) para calcular el valor eficaz real ($I_{\text{RMS}}$) de corriente alterna, con autocalibración de punto cero en el arranque.
* **Vibración RMS (`vibration_rms`):** Lectura por bus I2C (GPIO 21/22) con el sensor MPU6050 a 94 Hz de ancho de banda. Calcula la magnitud tridimensional restando el vector de gravedad ($9.80665\text{ m/s}^2$).
* **Temperatura (`temperature_c`):** Adquisición digital mediante sonda OneWire DS18B20 en GPIO 4 con verificación de redundancia cíclica (CRC).
* **Publicación:** Serializa a JSON compacto y publica a 1 Hz en el tópico `bomba/telemetria` de Mosquitto con reconexión automática si cae la red WiFi o el broker.

### B. Análisis y Detección de Anomalías en JavaScript (`backend/`)
El motor de detección opera en tiempo real bajo tres métodos configurables:
1. **Umbrales Fijos (`FIXED_THRESHOLD`):** Compara contra límites operativos críticos (ej. marcha en seco por $I < 0.20\text{ A}$, rotor bloqueado por $I > 2.80\text{ A}$, cavitación por vibración $> 4.20\text{ m/s}^2$, sobrecalentamiento térmico $> 68\text{ °C}$).
2. **Puntuación Z y MAD en Ventana Deslizante (`ROLLING_ZSCORE_MAD`):** Mantiene una ventana de las últimas 30 muestras en memoria. Aplica tanto la puntuación Z estándar ($Z = |x - \mu| / \sigma$) como el **Z-Modificado por MAD (Desviación Absoluta de la Mediana)**, el cual evita que lecturas anómalas previas distorsionen la media de referencia.
3. **Media Móvil Ponderada Exponencialmente (`EWMA`):** Detecta derivas dinámicas y tendencias sutiles de falla sin esperar a que se violen los umbrales absolutos.
4. **Modo Híbrido (`COMBINED`):** Ejecuta simultáneamente los tres evaluadores y categoriza la severidad final en `NORMAL`, `WARNING` o `CRITICAL`.

### C. Persistencia en Base de Datos (MongoDB)
* Almacena cada evento bajo el modelo `Telemetry`: marca de tiempo, `deviceId`, `experimentRunId`, lecturas individuales, algoritmo activo y desglose del diagnóstico con métricas matemáticas.
* Índices compuestos (`experimentRunId` + `timestamp` y `isAnomaly` + `timestamp`) para consultas históricas y analítica de alto rendimiento.

### D. Visualización en Tiempo Real (`frontend/`)
* **Conexión SSE (`GET /api/stream`):** Flujo unidireccional HTTP de baja latencia con latido (*heartbeat*) periódico cada 15 segundos.
* **Métricas y Diagnóstico:** Tarjetas KPI de actualización inmediata, banner reactivo de severidad operativa y gráfica vectorial (SVG nativo) por cada variable física con líneas de aviso preventivo y crítico.
* **Simulador Integrado:** Permite inyectar lecturas nominales o inducir eventos de cavitación/sobrecalentamiento desde la propia interfaz, operando incluso en modo local de respaldo si Mosquitto no está activo.

---

## 4. Dependencias Instaladas y Justificación Técnica

### Backend (`/backend/package.json`)
| Dependencia | Tipo | Justificación Técnica |
| :--- | :--- | :--- |
| **`express`** (v5.3+) | Producción | Servidor HTTP minimalista para estructurar la API REST y gestionar las conexiones Server-Sent Events (SSE). |
| **`mongoose`** (v9.11+) | Producción | ODM para modelado estricto del esquema de telemetría, validación de tipos e indexación en MongoDB. |
| **`mqtt`** (v5.16+) | Producción | Cliente nativo MQTT para conectarse al broker Mosquitto y procesar el flujo entrante de telemetría del ESP32. |
| **`cors`** (v2.8+) | Producción | Habilita el intercambio de recursos de origen cruzado para permitir peticiones desde Vite (`localhost:5173`) y despliegues web. |
| **`dotenv`** (v18.0+) | Producción | Carga de variables de entorno para desacoplar credenciales, URIs de base de datos y puertos del código fuente. |
| **`nodemon`** (v3.1+) | Desarrollo | Monitor de procesos que reinicia el servidor Node.js automáticamente al modificar archivos de lógica. |

### Frontend (`/frontend/package.json`)
| Dependencia | Tipo | Justificación Técnica |
| :--- | :--- | :--- |
| **`react`** & **`react-dom`** (v19) | Producción | Librería base para la interfaz reactiva basada en componentes y actualización granular del DOM. |
| **`vite`** (v8) | Desarrollo | Herramienta de construcción y servidor de desarrollo con Hot Module Replacement (HMR) ultrarrápido. |
| **`tailwindcss`** (v4) | Desarrollo | Motor de diseño utilitario para estilos modernos, diseño responsivo y tema oscuro sin sobrecarga de CSS. |
| **`@tailwindcss/postcss`** | Desarrollo | Plugin oficial para procesar Tailwind CSS v4 dentro del pipeline de PostCSS. |
| **`postcss`** & **`autoprefixer`** | Desarrollo | Procesamiento de CSS moderno y prefijado automático de propiedades para compatibilidad entre navegadores. |

### Firmware (`/firmware/platformio.ini`)
| Dependencia / Librería | Justificación Técnica |
| :--- | :--- |
| **`knolleary/PubSubClient`** (@^2.8) | Cliente MQTT ligero y eficiente en consumo de memoria para ESP32. |
| **`bblanchon/ArduinoJson`** (@^7.0.4) | Serialización y deserialización JSON sin asignación dinámica fragmentada. |
| **`paulstoffregen/OneWire`** & **`milesburton/DallasTemperature`** | Comunicación digital con la sonda sumergible DS18B20 en un único pin GPIO. |
| **`adafruit/Adafruit MPU6050`** & **`Adafruit Unified Sensor`** | Manejo de registros I2C y filtros de aceleración del acelerómetro triaxial. |

---

## 5. Cambios y Mejoras Validadas en esta Rama (`main`)

* [x] **Unificación de Monorepositorio:** Fusión completa y validada de las ramas `back-end`, `front-end` y `firmware` en una sola estructura coherente.
* [x] **Ejecución Estricta de Algoritmos en JS:** El análisis se ejecuta 100% en Node.js, cumpliendo el requerimiento de análisis en backend sin librerías externas de Python.
* [x] **Canal Server-Sent Events:** Transmisión de telemetría y diagnósticos hacia el cliente web en milisegundos sin sobrecarga de WebSockets.
* [x] **Modo de Respaldo en Simulación:** El backend puede procesar y despachar anomalías tanto si Mosquitto está activo como en modo de prueba local offline.
* [x] **Visualización en Tiempo Real:** Dashboard con gráficas SVG dinámicas que destacan puntos anómalos y calculan desviaciones estadísticas instantáneamente.
* [x] **Compatibilidad Tailwind v4:** Configuración adaptada a Tailwind CSS v4 con `@tailwindcss/postcss` y `@import "tailwindcss"`.

---

## 6. Guía Rápida para Levantar el Proyecto Localmente

### Requisitos Previos
* Node.js v18+ y npm
* MongoDB instalado y corriendo en `mongodb://127.0.0.1:27017`
* Mosquitto MQTT Broker corriendo en `mqtt://127.0.0.1:1883` *(opcional si se usa el simulador integrado)*

### Paso 1: Levantar el Backend
```bash
cd backend
npm install
npm run dev
```
*API activa en: `http://localhost:3000` (Endpoints: `/`, `/api/estado`, `/api/stream`, `/api/simulate`)*

### Paso 2: Levantar el Frontend
En otra terminal:
```bash
cd frontend
npm install
npm run dev
```
*Panel web activo en: `http://localhost:5173`*

### Paso 3: Flashear el ESP32 (Si cuentas con el circuito físico)
1. Abre la carpeta `/firmware` en VS Code con PlatformIO.
2. Configura tu red WiFi y la IP de tu PC en `firmware/src/main.cpp`.
3. Compila y sube el firmware a la placa ESP32.

