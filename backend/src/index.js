require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const mqtt = require('mqtt');
const cors = require('cors');

const Telemetry = require('./models/Telemetry');
const anomalyDetector = require('./services/anomalyDetector');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/bomba_iot';
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'bomba/telemetria';

// Configuración activa del experimento (modificable en caliente vía API)
let runtimeConfig = {
  experimentRunId: process.env.EXPERIMENT_RUN_ID || 'corrida-001',
  algorithmUsed: process.env.DEFAULT_ALGORITHM || 'COMBINED', // FIXED_THRESHOLD | ROLLING_ZSCORE_MAD | EWMA | COMBINED
};

// Conjunto de clientes suscritos por Server-Sent Events (SSE)
const sseClients = new Set();

function broadcastSSE(eventType, payload) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const clientRes of sseClients) {
    try {
      clientRes.write(message);
    } catch (err) {
      sseClients.delete(clientRes);
    }
  }
}

// 1. Conexión a MongoDB (con timeout reducido para evitar bloqueos si no está iniciado)
mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 2500 })
  .then(() => console.log('✅ [MongoDB] Conectado exitosamente a:', MONGO_URI))
  .catch((err) => console.warn('⚠️ [MongoDB] No se pudo conectar a Mongo local (opcional en simulaciones):', err.message));

// 2. Conexión a Broker MQTT (Mosquitto)
const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
  clientId: `backend_express_${Math.random().toString(16).slice(2, 8)}`,
  reconnectPeriod: 3000,
  connectTimeout: 3000,
});

mqttClient.on('connect', () => {
  console.log('✅ [MQTT] Conectado a Mosquitto en:', MQTT_BROKER_URL);
  mqttClient.subscribe(MQTT_TOPIC, { qos: 0 }, (err) => {
    if (err) {
      console.error('❌ [MQTT] Error al suscribirse:', err);
    } else {
      console.log(`📡 [MQTT] Suscrito al tópico: "${MQTT_TOPIC}"`);
    }
  });
});

mqttClient.on('error', (err) => {
  // Manejo silencioso de reconexión si Mosquitto no está activo
});

// Función central de procesamiento de telemetría y detección de anomalías
async function processTelemetryPayload(rawPayload) {
  const deviceId = rawPayload.deviceId || 'esp32-bomba-01';
  const experimentRunId =
    rawPayload.experimentRunId || runtimeConfig.experimentRunId;

  const variables = {
    current_a: Number(rawPayload.current_a ?? rawPayload.variables?.current_a ?? 0),
    vibration_rms: Number(
      rawPayload.vibration_rms ?? rawPayload.variables?.vibration_rms ?? 0
    ),
    temperature_c: Number(
      rawPayload.temperature_c ?? rawPayload.variables?.temperature_c ?? 0
    ),
  };

  // Ejecutar algoritmo de detección en JavaScript
  const detectionResult = anomalyDetector.analyze(
    deviceId,
    variables,
    runtimeConfig.algorithmUsed
  );

  let telemetryDoc = {
    _id: new mongoose.Types.ObjectId().toString(),
    timestamp: rawPayload.timestamp ? new Date(rawPayload.timestamp) : new Date(),
    deviceId,
    experimentRunId,
    variables,
    algorithmUsed: runtimeConfig.algorithmUsed,
    detectionResult,
  };

  // Guardar registro en MongoDB si está disponible
  if (mongoose.connection.readyState === 1) {
    try {
      telemetryDoc = await Telemetry.create(telemetryDoc);
    } catch (error) {
      console.warn('[MongoDB] Error guardando registro:', error.message);
    }
  }

  // Despachar en tiempo real a todos los navegadores conectados vía SSE
  broadcastSSE('telemetry', telemetryDoc);
  return telemetryDoc;
}

mqttClient.on('message', async (topic, messageBuffer) => {
  if (topic !== MQTT_TOPIC) return;
  try {
    const rawPayload = JSON.parse(messageBuffer.toString());
    await processTelemetryPayload(rawPayload);
  } catch (error) {
    console.error('[MQTT->Processor] Error procesando mensaje:', error.message);
  }
});

// 3. Endpoint SSE para Tiempo Real
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Enviar estado de configuración inicial al conectar
  res.write(`event: config\ndata: ${JSON.stringify(runtimeConfig)}\n\n`);

  sseClients.add(res);

  // Heartbeat cada 15 segundos para mantener viva la conexión HTTP
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// 4. Endpoints REST para el Frontend
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    servicio: 'Sistema de Monitoreo y Deteccion de Anomalias IoT',
    endpointsDisponibles: [
      '/api/estado',
      '/api/config',
      '/api/stats',
      '/api/telemetry/history',
      '/api/stream',
      '/api/simulate',
    ],
  });
});

app.get('/api/estado', (req, res) => {
  res.json({
    status: 'ok',
    mensaje: 'El servidor backend esta funcionando correctamente',
    mongodb: mongoose.connection.readyState === 1 ? 'conectado' : 'desconectado',
    mqtt: mqttClient.connected ? 'conectado' : 'desconectado',
    runtimeConfig,
  });
});

app.get('/api/telemetry/history', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json([]);
    }
    const { limit = 60, runId, onlyAnomalies } = req.query;
    const filter = {};
    if (runId) filter.experimentRunId = runId;
    if (onlyAnomalies === 'true') filter['detectionResult.isAnomaly'] = true;

    const records = await Telemetry.find(filter)
      .sort({ timestamp: -1 })
      .limit(Math.min(Number(limit), 500))
      .lean();

    res.json(records.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({
        experimentRunId: runtimeConfig.experimentRunId,
        totalSamples: 0,
        anomalyCount: 0,
        anomalyRatePercent: 0,
        byAlgorithm: [],
      });
    }
    const { runId } = req.query;
    const matchStage = runId ? { experimentRunId: runId } : {};

    const [totalSamples, anomalyCount, byAlgorithm] = await Promise.all([
      Telemetry.countDocuments(matchStage),
      Telemetry.countDocuments({
        ...matchStage,
        'detectionResult.isAnomaly': true,
      }),
      Telemetry.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$algorithmUsed',
            total: { $sum: 1 },
            anomalies: {
              $sum: { $cond: ['$detectionResult.isAnomaly', 1, 0] },
            },
          },
        },
      ]),
    ]);

    res.json({
      experimentRunId: runId || runtimeConfig.experimentRunId,
      totalSamples,
      anomalyCount,
      anomalyRatePercent:
        totalSamples > 0 ? Number(((anomalyCount / totalSamples) * 100).toFixed(2)) : 0,
      byAlgorithm,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    ...runtimeConfig,
    thresholds: anomalyDetector.thresholds,
  });
});

app.post('/api/config', (req, res) => {
  const { experimentRunId, algorithmUsed, resetWindow } = req.body;
  const validAlgorithms = [
    'FIXED_THRESHOLD',
    'ROLLING_ZSCORE_MAD',
    'EWMA',
    'COMBINED',
  ];

  if (experimentRunId && typeof experimentRunId === 'string') {
    runtimeConfig.experimentRunId = experimentRunId.trim();
  }
  if (algorithmUsed && validAlgorithms.includes(algorithmUsed)) {
    runtimeConfig.algorithmUsed = algorithmUsed;
  }
  if (resetWindow) {
    anomalyDetector.resetDeviceMemory();
  }

  broadcastSSE('config', runtimeConfig);
  res.json({ message: 'Configuración actualizada', config: runtimeConfig });
});

// Endpoint para simular inyección de datos (funciona con o sin Mosquitto local activo)
app.post('/api/simulate', async (req, res) => {
  const payload = {
    deviceId: req.body.deviceId || 'esp32-bomba-01',
    current_a: req.body.current_a ?? Number((1.15 + (Math.random() - 0.5) * 0.15).toFixed(3)),
    vibration_rms:
      req.body.vibration_rms ?? Number((1.2 + (Math.random() - 0.5) * 0.25).toFixed(3)),
    temperature_c:
      req.body.temperature_c ?? Number((42.0 + (Math.random() - 0.5) * 0.6).toFixed(2)),
  };

  // Si Mosquitto está conectado, publicamos por MQTT; si no, procesamos directamente
  if (mqttClient.connected) {
    mqttClient.publish(MQTT_TOPIC, JSON.stringify(payload));
  } else {
    await processTelemetryPayload(payload);
  }

  res.json({ published: payload, mqttConnected: mqttClient.connected });
});

app.listen(PORT, () => {
  console.log(`[Express] Servidor escuchando en http://localhost:${PORT}`);
});
