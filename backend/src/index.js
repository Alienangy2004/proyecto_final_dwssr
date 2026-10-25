const express = require('express');
const mongoose = require('mongoose');
const mqtt = require('mqtt');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Configuración de MongoDB (Asegúrate de tener tu Mongo abierto en CMD)
const MONGO_URI = 'mongodb://127.0.0.1:27017/motorDB';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Conectado a MongoDB (motorDB)'))
  .catch(err => console.error('❌ Error conectando a MongoDB:', err));

// 2. Configuración de MQTT (Asegúrate de que Mosquitto esté corriendo)
const MQTT_BROKER = 'mqtt://127.0.0.1:1883';
const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on('connect', () => {
  console.log('✅ Conectado al Broker MQTT (Mosquitto)');
  // Suscribirse al tema de telemetría del motor
  mqttClient.subscribe('motor/bomba1/telemetria', (err) => {
    if (!err) console.log('📡 Suscrito al tema: motor/bomba1/telemetria');
  });
});

mqttClient.on('message', (topic, message) => {
  console.log(`📩 Mensaje recibido en [${topic}]:`, message.toString());
  // Aquí más adelante conectaremos tu algoritmo de anomalías y el guardado en base de datos
});

// 3. Ruta de prueba HTTP
app.get('/api/estado', (req, res) => {
  res.json({ mensaje: 'El servidor backend está funcionando correctamente' });
});

// Levantar el servidor
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor Express corriendo en http://localhost:${PORT}`);
});