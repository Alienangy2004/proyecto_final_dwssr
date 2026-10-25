# Módulo Backend: API REST, Server-Sent Events y Motor de Detección de Anomalías en JavaScript

> **Rama:** `back-end`  
> **Estado:** Funcional y Verificado  
> **Ámbito:** Servidor Node.js, Express, Persistencia Mongoose (MongoDB) y Procesamiento de Señales IoT en JavaScript puro

---

## 1. Rol de la Rama `back-end` en la Arquitectura

Esta rama contiene exclusivamente la lógica del **servidor central del sistema de monitoreo**. Aísla el backend de la interfaz visual (`front-end`) y del microcontrolador (`firmware`), permitiendo:

1. **Desarrollar y ajustar algoritmos matemáticos** de detección de anomalías sin alterar el código de los clientes ni del hardware embebido.
2. **Gestionar las dependencias específicas del servidor** (`express`, `mongoose`, `mqtt`, etc.) de manera limpia e independiente.
3. **Mantener la integridad de los contratos de datos**, garantizando que las cargas útiles JSON recibidas desde Mosquitto se validen, procesen y almacenen correctamente en MongoDB.

```
                  MQTT (Broker Mosquitto)
                             │
                             v
                 ┌───────────────────────┐
                 │    backend/src/       │
                 │       index.js        │ <── API REST + SSE Gateway
                 └───────────┬───────────┘
                             │
               ┌─────────────┴─────────────┐
               v                           v
   ┌───────────────────────┐   ┌───────────────────────┐
   │ services/             │   │ models/               │
   │   anomalyDetector.js  │   │   Telemetry.js        │
   │ (Algoritmos en JS)    │   │ (Mongoose / MongoDB)  │
   │ • Umbrales Fijos      │   └───────────────────────┘
   │ • Rolling Z-Score/MAD │
   │ • EWMA Exponencial    │
   └───────────────────────┘
```

---

## 2. Estructura de Archivos del Backend

```text
backend/
├── .env                          # Configuración de variables de entorno
├── package.json                  # Dependencias y scripts del servidor
└── src/
    ├── index.js                  # Punto de entrada, suscripción MQTT, rutas REST y SSE
    ├── models/
    │   └── Telemetry.js          # Esquema de Mongoose con subdocumentos e índices compuestos
    └── services/
        └── anomalyDetector.js    # Motor de detección de anomalías 100% en JavaScript
```

---

## 3. Algoritmos de Detección de Anomalías (100% JavaScript en Node.js)

El núcleo algorítmico del proyecto reside en `src/services/anomalyDetector.js`. Se diseñó para ejecutarse nativamente en el runtime de Node.js sin requerir microservicios externos en Python:

### A. Algoritmo 1: Umbrales Fijos (`FIXED_THRESHOLD`)
Evalúa las tres variables físicas contra límites nominales preestablecidos:
* **Corriente RMS (`current_a`):**
  * $I \le 0.20\text{ A}$: Marcha en seco / succión vacía (`CRITICAL`).
  * $I \le 0.35\text{ A}$: Baja carga preventiva (`WARNING`).
  * $I \ge 2.20\text{ A}$: Sobrecarga mecánica moderada (`WARNING`).
  * $I \ge 2.80\text{ A}$: Rotor bloqueado o cortocircuito (`CRITICAL`).
* **Vibración RMS (`vibration_rms`):**
  * $\text{RMS} \ge 2.80\text{ m/s}^2$: Desalineación / inicio de cavitación (`WARNING`).
  * $\text{RMS} \ge 4.20\text{ m/s}^2$: Cavitación severa o falla en rodamientos (`CRITICAL`).
* **Temperatura de Carcasa (`temperature_c`):**
  * $T \ge 58.0\text{ °C}$: Calentamiento preventivo (`WARNING`).
  * $T \ge 68.0\text{ °C}$: Sobrecalentamiento crítico de devanados (`CRITICAL`).

### B. Algoritmo 2: Ventana Móvil con Z-Score y Modified Z-Score / MAD (`ROLLING_ZSCORE_MAD`)
Mantiene una ventana deslizante de las últimas **30 muestras** por dispositivo en memoria RAM:
1. **Puntuación Z Clásica:**
   $$Z = \frac{|x - \mu|}{\sigma}$$
   Donde $\mu$ es la media y $\sigma$ es la desviación estándar muestral.
2. **Modified Z-Score basado en MAD (Median Absolute Deviation):**
   La media y la desviación estándar estándar son muy sensibles a lecturas atípicas previas. Para evitar que una falla contamine la referencia, se calcula la mediana ($\tilde{x}$) y la desviación absoluta respecto a ella:
   $$\text{MAD} = \text{mediana}(|x_i - \tilde{x}|)$$
   $$M = \frac{0.6745 \cdot |x - \tilde{x}|}{\text{MAD}}$$
   Si $M \ge 2.5 \rightarrow \text{WARNING}$; si $M \ge 3.5 \rightarrow \text{CRITICAL}$.

### C. Algoritmo 3: Media Móvil Ponderada Exponencialmente (`EWMA`)
Detecta derivas progresivas mediante un factor de suavizado $\alpha = 0.25$:
$$\bar{x}_t = \alpha x_t + (1 - \alpha) \bar{x}_{t-1}$$
Rastrea la varianza exponencial para definir bandas dinámicas de control a $\pm 3\sigma$. Identifica fallas incipientes antes de que superen los umbrales estáticos.

### D. Modo Híbrido (`COMBINED`)
Ejecuta concurrentemente los tres algoritmos anteriores y determina la severidad final priorizando el dictamen más estricto (`CRITICAL` > `WARNING` > `NORMAL`).

---

## 4. Persistencia en Base de Datos (Modelo Mongoose)

El modelo en `src/models/Telemetry.js` garantiza la persistencia obligatoria de:
* `timestamp`: Fecha y hora exacta (Date).
* `deviceId`: Identificador único de la bomba (String, ej. `'esp32-bomba-01'`).
* `experimentRunId`: Identificador de la corrida de pruebas (String, ej. `'corrida-001'`).
* `variables`: Subdocumento con `current_a`, `vibration_rms` y `temperature_c`.
* `algorithmUsed`: Algoritmo empleado en la evaluación.
* `detectionResult`: Objeto estructurado con:
  * `isAnomaly`: Booleano para indexación rápida.
  * `severity`: `'NORMAL'` | `'WARNING'` | `'CRITICAL'`.
  * `anomalousVariables`: Lista de variables que originaron la alerta.
  * `reason`: Diagnóstico descriptivo del evento.
  * `metrics`: Z-Scores, MAD-Scores y desviaciones EWMA calculadas.

**Índices Compuestos:**
* `{ experimentRunId: 1, timestamp: -1 }`: Para acelerar la consulta del historial de corridas.
* `{ 'detectionResult.isAnomaly': 1, timestamp: -1 }`: Para el filtrado de eventos de falla sin escaneo total de la colección.

---

## 5. Comunicación en Tiempo Real: Server-Sent Events (SSE)

En lugar de WebSockets bidireccionales, el backend implementa **Server-Sent Events** en `GET /api/stream`:
* **Eficiencia:** Protocolo unidireccional HTTP estándar, ideal para telemetría donde el servidor publica continuamente datos al cliente.
* **Mantenimiento de Conexión:** Envía un *heartbeat* cada 15 segundos (`: heartbeat\n\n`) para evitar que proxies o navegadores cierren la conexión por inactividad.
* **Reconexión Automática:** Consumible directamente en el navegador con la API nativa `EventSource`.

---

## 6. Endpoints REST Disponibles

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `GET` | `/` | Información general de la API y lista de rutas activas. |
| `GET` | `/api/estado` | Diagnóstico de salud de conexiones (MongoDB y Mosquitto). |
| `GET` | `/api/stream` | Canal Server-Sent Events (SSE) para recepción de telemetría en vivo. |
| `GET` | `/api/telemetry/history` | Consulta histórica de eventos con parámetros `limit`, `runId` y `onlyAnomalies`. |
| `GET` | `/api/stats` | Agregaciones estadísticas: total de muestras, porcentaje de anomalías y desglose por algoritmo. |
| `GET` | `/api/config` | Consulta la corrida activa (`experimentRunId`), algoritmo y umbrales. |
| `POST` | `/api/config` | Actualiza la corrida activa, cambia de algoritmo en caliente o reinicia la ventana móvil (`resetWindow: true`). |
| `POST` | `/api/simulate` | Inyecta una muestra personalizada o aleatoria. Opera vía MQTT o en modo de respaldo directo si Mosquitto no está disponible. |

---

## 7. Dependencias del Backend y Justificación

```json
{
  "dependencies": {
    "express": "^5.3.0",
    "mongoose": "^9.11.4",
    "mqtt": "^5.16.1",
    "cors": "^2.8.6",
    "dotenv": "^18.0.9"
  },
  "devDependencies": {
    "nodemon": "^3.1.14"
  }
}
```

* **`express`:** Servidor HTTP liviano, rápido y estándar para montar endpoints REST y gestionar el stream de SSE.
* **`mongoose`:** Abstracción ODM para definir el esquema de telemetría, validación de tipos y creación de índices en MongoDB.
* **`mqtt`:** Cliente MQTT que implementa la conexión por sockets TCP con el broker Mosquitto en el puerto 1883.
* **`cors`:** Middleware para permitir el consumo seguro de la API desde el cliente Vite (`http://localhost:5173`) o despliegues web.
* **`dotenv`:** Inyección de variables de entorno desde el archivo `.env` para facilitar el cambio de puertos y cadenas de conexión.
* **`nodemon`:** Herramienta de desarrollo que reinicia automáticamente el servidor al detectar cambios en los archivos de `src/`.

---

## 8. Guía de Ejecución Local del Backend

### Configurar `.env`
Crea o verifica el archivo `backend/.env`:
```env
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/bomba_iot
MQTT_BROKER_URL=mqtt://127.0.0.1:1883
MQTT_TOPIC=bomba/telemetria
EXPERIMENT_RUN_ID=corrida-001
DEFAULT_ALGORITHM=COMBINED
```

### Iniciar en Desarrollo
```bash
cd backend
npm install
npm run dev
```

El servidor estará escuchando en `http://localhost:3000` y confirmará la conexión a MongoDB y Mosquitto en la terminal.

