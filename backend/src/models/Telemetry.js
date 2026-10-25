const mongoose = require('mongoose');

const TelemetrySchema = new mongoose.Schema(
  {
    timestamp: {
      type: Date,
      default: Date.now,
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
      trim: true,
      index: true,
      default: 'esp32-bomba-01',
    },
    experimentRunId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    variables: {
      current_a: {
        type: Number,
        required: true, // Corriente RMS en Amperios (A)
      },
      vibration_rms: {
        type: Number,
        required: true, // Vibración RMS en m/s^2
      },
      temperature_c: {
        type: Number,
        required: true, // Temperatura de carcasa en °C
      },
    },
    algorithmUsed: {
      type: String,
      required: true,
      enum: ['FIXED_THRESHOLD', 'ROLLING_ZSCORE_MAD', 'EWMA', 'COMBINED'],
      index: true,
    },
    detectionResult: {
      isAnomaly: {
        type: Boolean,
        required: true,
        index: true,
      },
      severity: {
        type: String,
        required: true,
        enum: ['NORMAL', 'WARNING', 'CRITICAL'],
        default: 'NORMAL',
      },
      anomalousVariables: {
        type: [String],
        default: [],
      },
      reason: {
        type: String,
        default: 'Operación dentro de parámetros nominales',
      },
      metrics: {
        thresholdViolations: {
          type: [String],
          default: [],
        },
        zScores: {
          current_a: { type: Number, default: 0 },
          vibration_rms: { type: Number, default: 0 },
          temperature_c: { type: Number, default: 0 },
        },
        madScores: {
          current_a: { type: Number, default: 0 },
          vibration_rms: { type: Number, default: 0 },
          temperature_c: { type: Number, default: 0 },
        },
        ewmaDeviation: {
          current_a: { type: Number, default: 0 },
          vibration_rms: { type: Number, default: 0 },
          temperature_c: { type: Number, default: 0 },
        },
      },
    },
  },
  {
    versionKey: false,
    timestamps: false,
  }
);

// Índices compuestos para acelerar consultas históricas por corrida y filtrado de alertas
TelemetrySchema.index({ experimentRunId: 1, timestamp: -1 });
TelemetrySchema.index({ 'detectionResult.isAnomaly': 1, timestamp: -1 });

module.exports = mongoose.model('Telemetry', TelemetrySchema);

