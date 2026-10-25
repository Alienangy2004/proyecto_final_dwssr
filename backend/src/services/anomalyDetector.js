/**
 * Motor de Detección de Anomalías en Tiempo Real para Bomba de Agua
 * Ejecutado 100% en JavaScript (Node.js)
 */

const DEFAULT_THRESHOLDS = {
  current_a: {
    minWarning: 0.35,   // Posible marcha en seco / succión vacía
    minCritical: 0.20,  // Bomba trabajando sin carga hidráulica
    maxWarning: 2.20,   // Sobrecarga moderada
    maxCritical: 2.80,  // Rotor bloqueado / falla eléctrica
  },
  vibration_rms: {
    minWarning: 0.0,
    minCritical: -1.0,
    maxWarning: 2.80,   // Inicio de cavitación o desalineación
    maxCritical: 4.20,  // Cavitación severa o daño en rodamiento
  },
  temperature_c: {
    minWarning: 5.0,
    minCritical: 1.0,
    maxWarning: 58.0,   // Calentamiento de carcasa
    maxCritical: 68.0,  // Sobrecalentamiento crítico del devanado
  },
};

class AnomalyDetector {
  constructor(options = {}) {
    this.windowSize = options.windowSize || 30; // Muestras en ventana móvil
    this.minSamplesForStats = options.minSamplesForStats || 8;
    this.zScoreThresholdWarning = options.zScoreThresholdWarning || 2.5;
    this.zScoreThresholdCritical = options.zScoreThresholdCritical || 3.5;
    this.ewmaAlpha = options.ewmaAlpha || 0.25; // Factor de suavizado (0.1 - 0.3)
    this.ewmaSigmaMultiplier = options.ewmaSigmaMultiplier || 3.0;
    this.thresholds = options.thresholds || DEFAULT_THRESHOLDS;

    // Estado en memoria por dispositivo: { [deviceId]: { windows: {...}, ewma: {...} } }
    this.deviceState = new Map();
  }

  _initDeviceState(deviceId) {
    if (!this.deviceState.has(deviceId)) {
      this.deviceState.set(deviceId, {
        windows: {
          current_a: [],
          vibration_rms: [],
          temperature_c: [],
        },
        ewma: {
          current_a: { mean: null, variance: 0 },
          vibration_rms: { mean: null, variance: 0 },
          temperature_c: { mean: null, variance: 0 },
        },
      });
    }
    return this.deviceState.get(deviceId);
  }

  // Utilidades estadísticas en JS puro
  _mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((acc, val) => acc + val, 0) / arr.length;
  }

  _stdDev(arr, meanVal) {
    if (arr.length < 2) return 0;
    const variance =
      arr.reduce((acc, val) => acc + Math.pow(val - meanVal, 2), 0) /
      (arr.length - 1);
    return Math.sqrt(variance);
  }

  _median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  _mad(arr, medianVal) {
    if (arr.length === 0) return 0;
    const absDeviations = arr.map((val) => Math.abs(val - medianVal));
    return this._median(absDeviations);
  }

  /**
   * 1. Algoritmo Base: Umbrales Fijos
   */
  evaluateFixedThresholds(variables) {
    const violations = [];
    const anomalousVars = new Set();
    let severity = 'NORMAL';

    const upgradeSeverity = (newSev) => {
      const order = { NORMAL: 0, WARNING: 1, CRITICAL: 2 };
      if (order[newSev] > order[severity]) severity = newSev;
    };

    for (const [key, value] of Object.entries(variables)) {
      const limits = this.thresholds[key];
      if (!limits || typeof value !== 'number') continue;

      if (value >= limits.maxCritical) {
        violations.push(`${key} superó límite crítico superior (${value.toFixed(2)} >= ${limits.maxCritical})`);
        anomalousVars.add(key);
        upgradeSeverity('CRITICAL');
      } else if (value <= limits.minCritical) {
        violations.push(`${key} cayó bajo límite crítico inferior (${value.toFixed(2)} <= ${limits.minCritical})`);
        anomalousVars.add(key);
        upgradeSeverity('CRITICAL');
      } else if (value >= limits.maxWarning) {
        violations.push(`${key} en zona de advertencia alta (${value.toFixed(2)} >= ${limits.maxWarning})`);
        anomalousVars.add(key);
        upgradeSeverity('WARNING');
      } else if (value <= limits.minWarning) {
        violations.push(`${key} en zona de advertencia baja (${value.toFixed(2)} <= ${limits.minWarning})`);
        anomalousVars.add(key);
        upgradeSeverity('WARNING');
      }
    }

    return {
      isAnomaly: severity !== 'NORMAL',
      severity,
      anomalousVariables: Array.from(anomalousVars),
      violations,
    };
  }

  /**
   * 2. Algoritmo Estadístico: Z-Score y Modified Z-Score (MAD) en Ventana Móvil
   */
  evaluateRollingZScoreAndMAD(deviceId, variables) {
    const state = this._initDeviceState(deviceId);
    const zScores = { current_a: 0, vibration_rms: 0, temperature_c: 0 };
    const madScores = { current_a: 0, vibration_rms: 0, temperature_c: 0 };
    const anomalousVars = new Set();
    const reasons = [];
    let severity = 'NORMAL';

    const upgradeSeverity = (newSev) => {
      const order = { NORMAL: 0, WARNING: 1, CRITICAL: 2 };
      if (order[newSev] > order[severity]) severity = newSev;
    };

    for (const [key, value] of Object.entries(variables)) {
      const windowArr = state.windows[key];
      if (!windowArr || typeof value !== 'number') continue;

      if (windowArr.length >= this.minSamplesForStats) {
        // Z-Score clásico sobre la ventana histórica inmediata
        const mean = this._mean(windowArr);
        const std = this._stdDev(windowArr, mean);
        const z = std > 1e-5 ? Math.abs(value - mean) / std : 0;
        zScores[key] = Number(z.toFixed(3));

        // Modified Z-Score usando MAD (robusto a outliers)
        const med = this._median(windowArr);
        const mad = this._mad(windowArr, med);
        const modZ = mad > 1e-5 ? (0.6745 * Math.abs(value - med)) / mad : z;
        madScores[key] = Number(modZ.toFixed(3));

        const effectiveScore = Math.max(zScores[key], madScores[key]);

        if (effectiveScore >= this.zScoreThresholdCritical) {
          anomalousVars.add(key);
          upgradeSeverity('CRITICAL');
          reasons.push(
            `${key} presenta desviación estadística crítica (Z=${zScores[key]}, MAD-Z=${madScores[key]})`
          );
        } else if (effectiveScore >= this.zScoreThresholdWarning) {
          anomalousVars.add(key);
          upgradeSeverity('WARNING');
          reasons.push(
            `${key} presenta desviación estadística moderada (Z=${zScores[key]}, MAD-Z=${madScores[key]})`
          );
        }
      }
    }

    return {
      isAnomaly: severity !== 'NORMAL',
      severity,
      anomalousVariables: Array.from(anomalousVars),
      zScores,
      madScores,
      reasons,
    };
  }

  /**
   * 3. Algoritmo Estadístico: EWMA (Exponentially Weighted Moving Average)
   */
  evaluateEWMA(deviceId, variables) {
    const state = this._initDeviceState(deviceId);
    const ewmaDeviation = { current_a: 0, vibration_rms: 0, temperature_c: 0 };
    const anomalousVars = new Set();
    const reasons = [];
    let severity = 'NORMAL';
    const alpha = this.ewmaAlpha;

    const upgradeSeverity = (newSev) => {
      const order = { NORMAL: 0, WARNING: 1, CRITICAL: 2 };
      if (order[newSev] > order[severity]) severity = newSev;
    };

    for (const [key, value] of Object.entries(variables)) {
      const tracker = state.ewma[key];
      if (!tracker || typeof value !== 'number') continue;

      if (tracker.mean === null) {
        tracker.mean = value;
        tracker.variance = 0;
        continue;
      }

      const diff = value - tracker.mean;
      const std = Math.sqrt(tracker.variance);

      if (std > 1e-4 && state.windows[key].length >= this.minSamplesForStats) {
        const normalizedDev = Math.abs(diff) / std;
        ewmaDeviation[key] = Number(normalizedDev.toFixed(3));

        if (normalizedDev >= this.ewmaSigmaMultiplier + 1.0) {
          anomalousVars.add(key);
          upgradeSeverity('CRITICAL');
          reasons.push(`${key} fuera de banda EWMA crítica (${normalizedDev.toFixed(2)}σ)`);
        } else if (normalizedDev >= this.ewmaSigmaMultiplier) {
          anomalousVars.add(key);
          upgradeSeverity('WARNING');
          reasons.push(`${key} fuera de banda EWMA preventiva (${normalizedDev.toFixed(2)}σ)`);
        }
      }

      // Actualizar media y varianza exponencial
      tracker.mean = alpha * value + (1 - alpha) * tracker.mean;
      tracker.variance =
        (1 - alpha) * (tracker.variance + alpha * Math.pow(diff, 2));
    }

    return {
      isAnomaly: severity !== 'NORMAL',
      severity,
      anomalousVariables: Array.from(anomalousVars),
      ewmaDeviation,
      reasons,
    };
  }

  /**
   * Actualiza la ventana deslizante una vez evaluada la muestra
   */
  _pushToWindow(deviceId, variables) {
    const state = this._initDeviceState(deviceId);
    for (const [key, value] of Object.entries(variables)) {
      if (state.windows[key] && typeof value === 'number') {
        state.windows[key].push(value);
        if (state.windows[key].length > this.windowSize) {
          state.windows[key].shift();
        }
      }
    }
  }

  /**
   * Punto de entrada principal para analizar un paquete de telemetría
   */
  analyze(deviceId, variables, algorithmUsed = 'COMBINED') {
    const fixedRes = this.evaluateFixedThresholds(variables);
    const statRes = this.evaluateRollingZScoreAndMAD(deviceId, variables);
    const ewmaRes = this.evaluateEWMA(deviceId, variables);

    // Actualizar ventana móvil con la lectura actual
    this._pushToWindow(deviceId, variables);

    const severityOrder = { NORMAL: 0, WARNING: 1, CRITICAL: 2 };
    let finalSeverity = 'NORMAL';
    let finalAnomalousVars = [];
    let finalReasons = [];

    if (algorithmUsed === 'FIXED_THRESHOLD') {
      finalSeverity = fixedRes.severity;
      finalAnomalousVars = fixedRes.anomalousVariables;
      finalReasons = fixedRes.violations;
    } else if (algorithmUsed === 'ROLLING_ZSCORE_MAD') {
      finalSeverity = statRes.severity;
      finalAnomalousVars = statRes.anomalousVariables;
      finalReasons = statRes.reasons;
    } else if (algorithmUsed === 'EWMA') {
      finalSeverity = ewmaRes.severity;
      finalAnomalousVars = ewmaRes.anomalousVariables;
      finalReasons = ewmaRes.reasons;
    } else {
      // COMBINED: fusiona Umbrales Fijos + Z-Score/MAD + EWMA
      const severities = [fixedRes.severity, statRes.severity, ewmaRes.severity];
      finalSeverity = severities.reduce((max, curr) =>
        severityOrder[curr] > severityOrder[max] ? curr : max
      , 'NORMAL');
      finalAnomalousVars = Array.from(
        new Set([
          ...fixedRes.anomalousVariables,
          ...statRes.anomalousVariables,
          ...ewmaRes.anomalousVariables,
        ])
      );
      finalReasons = [
        ...fixedRes.violations,
        ...statRes.reasons,
        ...ewmaRes.reasons,
      ];
    }

    return {
      isAnomaly: finalSeverity !== 'NORMAL',
      severity: finalSeverity,
      anomalousVariables: finalAnomalousVars,
      reason:
        finalReasons.length > 0
          ? finalReasons.join(' | ')
          : 'Operación dentro de parámetros nominales',
      metrics: {
        thresholdViolations: fixedRes.violations,
        zScores: statRes.zScores,
        madScores: statRes.madScores,
        ewmaDeviation: ewmaRes.ewmaDeviation,
      },
    };
  }

  resetDeviceMemory(deviceId) {
    if (deviceId) {
      this.deviceState.delete(deviceId);
    } else {
      this.deviceState.clear();
    }
  }
}

module.exports = new AnomalyDetector();

