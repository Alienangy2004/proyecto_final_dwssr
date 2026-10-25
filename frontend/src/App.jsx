import React, { useEffect, useState, useMemo } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const ALGORITHMS = [
  { id: 'COMBINED', label: 'Híbrido (Umbral + Z/MAD + EWMA)' },
  { id: 'FIXED_THRESHOLD', label: 'Umbrales Fijos' },
  { id: 'ROLLING_ZSCORE_MAD', label: 'Ventana Móvil (Z-Score / MAD)' },
  { id: 'EWMA', label: 'Suavizado Exponencial (EWMA)' },
];

function RealtimeSparkChart({ data, dataKey, label, unit, color, warnMax, critMax }) {
  const width = 520;
  const height = 150;
  const pad = 24;

  const values = data.map((d) => d.variables?.[dataKey] ?? 0);
  const minVal = Math.min(...values, 0);
  const maxVal = Math.max(...values, critMax * 1.15, 1);
  const range = maxVal - minVal || 1;

  const toX = (idx) =>
    pad + (idx / Math.max(data.length - 1, 1)) * (width - pad * 2);
  const toY = (val) =>
    height - pad - ((val - minVal) / range) * (height - pad * 2);

  const points = data
    .map((d, idx) => `${toX(idx)},${toY(d.variables?.[dataKey] ?? 0)}`)
    .join(' ');

  const warnY = toY(warnMax);
  const critY = toY(critMax);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-semibold text-slate-200">{label}</span>
        <span className="text-xs text-slate-400">
          Alerta: {warnMax} {unit} | Crítico: {critMax} {unit}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-36 overflow-visible">
        {/* Línea de umbral crítico */}
        <line
          x1={pad}
          y1={critY}
          x2={width - pad}
          y2={critY}
          stroke="#ef4444"
          strokeDasharray="4 4"
          strokeWidth="1"
        />
        {/* Línea de umbral preventivo */}
        <line
          x1={pad}
          y1={warnY}
          x2={width - pad}
          y2={warnY}
          stroke="#f59e0b"
          strokeDasharray="4 4"
          strokeWidth="1"
        />
        {/* Trazo de la serie temporal */}
        {data.length > 1 && (
          <polyline
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            points={points}
          />
        )}
        {/* Puntos de anomalía resaltados */}
        {data.map((d, idx) => {
          const isVarAnom = d.detectionResult?.anomalousVariables?.includes(dataKey);
          if (!isVarAnom) return null;
          return (
            <circle
              key={d._id || idx}
              cx={toX(idx)}
              cy={toY(d.variables?.[dataKey] ?? 0)}
              r="4.5"
              fill="#ef4444"
              stroke="#fff"
              strokeWidth="1.5"
            />
          );
        })}
      </svg>
    </div>
  );
}

export default function App() {
  const [telemetryList, setTelemetryList] = useState([]);
  const [onlyAnomalies, setOnlyAnomalies] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [config, setConfig] = useState({
    experimentRunId: 'corrida-001',
    algorithmUsed: 'COMBINED',
  });
  const [runInput, setRunInput] = useState('corrida-001');

  // Cargar historial inicial desde MongoDB
  const fetchHistory = async (runIdFilter) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/telemetry/history?limit=60&runId=${encodeURIComponent(
          runIdFilter || config.experimentRunId
        )}`
      );
      const data = await res.json();
      if (Array.isArray(data)) setTelemetryList(data);
    } catch (err) {
      console.error('Error cargando historial:', err);
    }
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/config`)
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.experimentRunId) {
          setConfig({
            experimentRunId: cfg.experimentRunId,
            algorithmUsed: cfg.algorithmUsed,
          });
          setRunInput(cfg.experimentRunId);
          fetchHistory(cfg.experimentRunId);
        }
      })
      .catch(console.error);
  }, []);

  // Suscripción en tiempo real mediante Server-Sent Events (SSE)
  useEffect(() => {
    const evtSource = new EventSource(`${API_BASE}/api/stream`);

    evtSource.onopen = () => setSseConnected(true);
    evtSource.onerror = () => setSseConnected(false);

    evtSource.addEventListener('telemetry', (event) => {
      const newDoc = JSON.parse(event.data);
      setTelemetryList((prev) => [...prev.slice(-59), newDoc]);
    });

    evtSource.addEventListener('config', (event) => {
      const updated = JSON.parse(event.data);
      setConfig(updated);
      setRunInput(updated.experimentRunId);
    });

    return () => evtSource.close();
  }, []);

  const handleUpdateConfig = async (newAlgo, newRunId, resetWindow = false) => {
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          algorithmUsed: newAlgo || config.algorithmUsed,
          experimentRunId: newRunId || runInput,
          resetWindow,
        }),
      });
      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
        fetchHistory(data.config.experimentRunId);
      }
    } catch (err) {
      console.error('Error actualizando configuración:', err);
    }
  };

  const simulateSample = async (override = {}) => {
    await fetch(`${API_BASE}/api/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(override),
    });
  };

  const latest = telemetryList[telemetryList.length - 1] || null;
  const severity = latest?.detectionResult?.severity || 'NORMAL';

  const statusStyles = {
    NORMAL: 'bg-emerald-500/15 border-emerald-500 text-emerald-300',
    WARNING: 'bg-amber-500/15 border-amber-500 text-amber-300',
    CRITICAL: 'bg-rose-500/20 border-rose-500 text-rose-300 animate-pulse',
  };

  const filteredTable = useMemo(() => {
    const reversed = [...telemetryList].reverse();
    return onlyAnomalies
      ? reversed.filter((item) => item.detectionResult?.isAnomaly)
      : reversed;
  }, [telemetryList, onlyAnomalies]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Cabecera y Estado de Conexión */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Monitoreo y Detección de Anomalías — Bomba de Agua IoT
            </h1>
            <p className="text-sm text-slate-400">
              Telemetría MQTT (ESP32) • Análisis Estadístico en JS • Persistencia MongoDB
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-2 ${
                sseConnected
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  sseConnected ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
              />
              {sseConnected ? 'SSE Tiempo Real Activo' : 'Reconectando SSE...'}
            </span>
          </div>
        </header>

        {/* Barra de Configuración del Experimento y Simulador */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-2xl">
          <div className="lg:col-span-4 flex flex-col gap-1">
            <label className="text-xs text-slate-400 font-medium">
              ID de Corrida Experimental (experimentRunId)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={runInput}
                onChange={(e) => setRunInput(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white flex-1"
              />
              <button
                onClick={() => handleUpdateConfig(config.algorithmUsed, runInput, true)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition"
              >
                Aplicar Corrida
              </button>
            </div>
          </div>

          <div className="lg:col-span-4 flex flex-col gap-1">
            <label className="text-xs text-slate-400 font-medium">
              Algoritmo de Detección en Backend (JS)
            </label>
            <select
              value={config.algorithmUsed}
              onChange={(e) => handleUpdateConfig(e.target.value, config.experimentRunId)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white"
            >
              {ALGORITHMS.map((alg) => (
                <option key={alg.id} value={alg.id}>
                  {alg.label}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-4 flex flex-col gap-1">
            <label className="text-xs text-slate-400 font-medium">
              Pruebas Rápidas (Publicar en MQTT)
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => simulateSample()}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-slate-700"
              >
                + Muestra Nominal
              </button>
              <button
                onClick={() =>
                  simulateSample({
                    current_a: 3.15,
                    vibration_rms: 4.85,
                    temperature_c: 71.2,
                  })
                }
                className="bg-rose-600/80 hover:bg-rose-600 text-white text-xs px-3 py-1.5 rounded-lg"
              >
                ⚡ Simular Cavitación / Falla
              </button>
            </div>
          </div>
        </section>

        {/* Banner de Estado Actual */}
        <section
          className={`border rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 ${statusStyles[severity]}`}
        >
          <div>
            <div className="text-xs uppercase tracking-wider font-bold">
              Estado Operativo Actual: {severity}
            </div>
            <div className="text-sm mt-1">
              {latest
                ? latest.detectionResult?.reason
                : 'Esperando primera lectura de telemetría desde Mosquitto...'}
            </div>
          </div>
          {latest && (
            <div className="text-xs font-mono opacity-90">
              Dispositivo: {latest.deviceId} | Algoritmo: {latest.algorithmUsed}
            </div>
          )}
        </section>

        {/* Tarjetas KPI de las 3 Variables */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
            <span className="text-xs text-slate-400 uppercase">Corriente del Motor</span>
            <div className="text-3xl font-bold text-sky-400 mt-1">
              {latest ? `${latest.variables.current_a.toFixed(2)} A` : '-- A'}
            </div>
            <div className="text-xs text-slate-400 mt-2 font-mono">
              Z-Score: {latest?.detectionResult?.metrics?.zScores?.current_a ?? 0} | MAD-Z:{' '}
              {latest?.detectionResult?.metrics?.madScores?.current_a ?? 0}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
            <span className="text-xs text-slate-400 uppercase">Vibración Mecánica RMS</span>
            <div className="text-3xl font-bold text-amber-400 mt-1">
              {latest ? `${latest.variables.vibration_rms.toFixed(2)} m/s²` : '-- m/s²'}
            </div>
            <div className="text-xs text-slate-400 mt-2 font-mono">
              Z-Score: {latest?.detectionResult?.metrics?.zScores?.vibration_rms ?? 0} | MAD-Z:{' '}
              {latest?.detectionResult?.metrics?.madScores?.vibration_rms ?? 0}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
            <span className="text-xs text-slate-400 uppercase">Temperatura Carcasa</span>
            <div className="text-3xl font-bold text-rose-400 mt-1">
              {latest ? `${latest.variables.temperature_c.toFixed(1)} °C` : '-- °C'}
            </div>
            <div className="text-xs text-slate-400 mt-2 font-mono">
              Z-Score: {latest?.detectionResult?.metrics?.zScores?.temperature_c ?? 0} | MAD-Z:{' '}
              {latest?.detectionResult?.metrics?.madScores?.temperature_c ?? 0}
            </div>
          </div>
        </section>

        {/* Gráficas en Tiempo Real */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <RealtimeSparkChart
            data={telemetryList}
            dataKey="current_a"
            label="Corriente RMS (A)"
            unit="A"
            color="#38bdf8"
            warnMax={2.2}
            critMax={2.8}
          />
          <RealtimeSparkChart
            data={telemetryList}
            dataKey="vibration_rms"
            label="Vibración RMS (m/s²)"
            unit="m/s²"
            color="#fbbf24"
            warnMax={2.8}
            critMax={4.2}
          />
          <RealtimeSparkChart
            data={telemetryList}
            dataKey="temperature_c"
            label="Temperatura (°C)"
            unit="°C"
            color="#fb7185"
            warnMax={58.0}
            critMax={68.0}
          />
        </section>

        {/* Historial de Eventos en MongoDB */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-white">
              Historial de Eventos Guardados en MongoDB ({filteredTable.length})
            </h2>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyAnomalies}
                onChange={(e) => setOnlyAnomalies(e.target.checked)}
                className="rounded border-slate-700"
              />
              Mostrar únicamente anomalías detectadas
            </label>
          </div>

          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 px-3">Fecha / Hora</th>
                  <th className="py-2 px-3">Corrida</th>
                  <th className="py-2 px-3">Corriente</th>
                  <th className="py-2 px-3">Vibración</th>
                  <th className="py-2 px-3">Temp</th>
                  <th className="py-2 px-3">Algoritmo</th>
                  <th className="py-2 px-3">Estado</th>
                  <th className="py-2 px-3">Diagnóstico</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredTable.map((row, i) => (
                  <tr
                    key={row._id || i}
                    className={
                      row.detectionResult?.isAnomaly ? 'bg-rose-950/30' : 'hover:bg-slate-800/40'
                    }
                  >
                    <td className="py-2 px-3 font-mono text-slate-300">
                      {new Date(row.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-400">
                      {row.experimentRunId}
                    </td>
                    <td className="py-2 px-3 font-mono">
                      {row.variables?.current_a?.toFixed(2)} A
                    </td>
                    <td className="py-2 px-3 font-mono">
                      {row.variables?.vibration_rms?.toFixed(2)} m/s²
                    </td>
                    <td className="py-2 px-3 font-mono">
                      {row.variables?.temperature_c?.toFixed(1)} °C
                    </td>
                    <td className="py-2 px-3 text-slate-300">{row.algorithmUsed}</td>
                    <td className="py-2 px-3">
                      <span
                        className={`px-2 py-0.5 rounded font-semibold ${
                          row.detectionResult?.severity === 'CRITICAL'
                            ? 'bg-rose-500/20 text-rose-300'
                            : row.detectionResult?.severity === 'WARNING'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-emerald-500/20 text-emerald-300'
                        }`}
                      >
                        {row.detectionResult?.severity}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-300">
                      {row.detectionResult?.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
