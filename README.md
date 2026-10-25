# Módulo Frontend: Panel de Monitoreo y Visualización de Anomalías en Tiempo Real (React + Tailwind CSS)

> **Rama:** `front-end`  
> **Estado:** Funcional y Verificado  
> **Ámbito:** Interfaz de usuario (SPA), consumo de Server-Sent Events (SSE), componentes SVG en tiempo real y controles interactivos de experimentación

---

## 1. Rol de la Rama `front-end` en la Arquitectura

Esta rama aloja de manera exclusiva el **código de la interfaz gráfica de usuario**. Su separación en una rama dedicada responde a los siguientes principios de ingeniería:

1. **Desacoplamiento Visual y de Despliegue:** Permite desarrollar componentes, ajustar estilos, probar responsividad y optimizar el empaquetado de Vite sin interferir con la lógica de negocio del servidor o con el código embebido en C++.
2. **Independencia de Dependencias:** El cliente utiliza React 19, Tailwind CSS v4 y Vite, manteniendo un árbol de dependencias (`package.json`) completamente aislado del backend y del microcontrolador.
3. **Compatibilidad con Plataformas de Hosting Estático:** Al estar encapsulada en la carpeta `frontend/`, la aplicación puede compilarse y desplegarse de manera directa en servicios en la nube como **Vercel** o **Netlify**.

```
                           Backend Express
                           (Puerto: 3000)
                                 │
                     GET /api/stream (SSE)
                                 │
                                 v
               ┌──────────────────────────────────┐
               │         frontend/src/            │
               │            App.jsx               │
               └─────────────────┬────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         v                       v                       v
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Tarjetas KPI   │     │  Gráficas SVG   │     │  Historial y    │
│  (Valores RMS,  │     │  (Sparklines    │     │  Filtrado de    │
│  Z-Score, MAD)  │     │   en vivo)      │     │  MongoDB        │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## 2. Estructura de Archivos del Frontend

```text
frontend/
├── package.json              # Dependencias de React, Vite y Tailwind
├── postcss.config.js         # Configuración del plugin @tailwindcss/postcss
├── vite.config.js            # Configuración de Vite y plugin de React
├── index.html                # Plantilla HTML base
└── src/
    ├── main.jsx              # Punto de entrada de React (StrictMode y render)
    ├── index.css             # Directivas de Tailwind CSS v4 y tema base oscuro
    └── App.jsx               # Dashboard interactivo con SSE, SVG y controles
```

---

## 3. Funcionamiento de la Interfaz y Componentes

### A. Comunicación en Tiempo Real mediante SSE (`EventSource`)
El componente principal [`App.jsx`](file:///c:/Users/ditom/Proyectos/proyecto_final_dwssr/frontend/src/App.jsx) establece un canal persistente con el backend a través de la API estándar del navegador:
```javascript
const evtSource = new EventSource(`${API_BASE}/api/stream`);
```
* **Recepción de Telemetría:** Cada vez que el backend emite un evento `telemetry`, se agrega a una ventana de las últimas **60 muestras** (`prev.slice(-59)`), asegurando un uso controlado y constante de la memoria en el navegador.
* **Sincronización de Configuración:** Escucha el evento `config` para reflejar automáticamente si otro operador cambia el algoritmo o la corrida experimental.
* **Indicador de Conectividad:** Muestra una insignia reactiva:
  * `🟢 SSE Tiempo Real Activo` cuando el flujo está sincronizado.
  * `🔴 Reconectando SSE...` si se pierde la conexión de red.

### B. Tarjetas KPI de Estado Inmediato
Presentan la lectura más reciente de los tres parámetros físicos del motor:
1. **Corriente del Motor:** Valor RMS en Amperios (A) + Z-Score y MAD-Z.
2. **Vibración Mecánica:** Valor RMS dinámico en $m/s^2$ + Z-Score y MAD-Z.
3. **Temperatura de Carcasa:** Grados Celsius (°C) + Z-Score y MAD-Z.

### C. Banner Reactivo de Severidad Operativa
Adapta sus estilos dinámicamente según el dictamen del algoritmo en backend:
* **`NORMAL`:** Fondo verde esmeralda translúcido (`bg-emerald-500/15`). Operación dentro de parámetros nominales.
* **`WARNING`:** Fondo ámbar preventivo (`bg-amber-500/15`). Desviaciones estadísticas moderadas o proximidad a umbrales.
* **`CRITICAL`:** Fondo rojo carmesí con animación de pulso (`animate-pulse`). Alerta de cavitación, rotor trabado o sobrecalentamiento inminente.

### D. Gráficas Vectoriales en Tiempo Real (`RealtimeSparkChart`)
Diseñadas utilizando **SVG nativo** sin dependencias externas pesadas (como Chart.js o Recharts):
* **Normalización Automática:** Transforma los valores físicos en coordenadas de pantalla `(x, y)` calculando escalas dinámicas en función de los límites de advertencia y crítico.
* **Trazado de Tendencia:** Renderiza un `<polyline>` vectorial suavizado con el histórico temporal.
* **Líneas de Umbral:** Líneas punteadas horizontales para el nivel preventivo (amarillo) y crítico (rojo).
* **Marcadores de Anomalía:** Renderiza elementos `<circle fill="#ef4444">` en el punto exacto donde la variable violó un umbral o disparó la puntuación estadística.

### E. Panel de Control y Simulador de Pruebas
* **Conmutador de Algoritmo:** Permite al usuario cambiar en caliente entre:
  * `Híbrido (Umbral + Z/MAD + EWMA)`
  * `Umbrales Fijos`
  * `Ventana Móvil (Z-Score / MAD)`
  * `Suavizado Exponencial (EWMA)`
* **Control de Corridas Experimentales:** Permite modificar el `experimentRunId` y reiniciar la ventana móvil de análisis (`resetWindow: true`).
* **Botones de Inyección Rápida:**
  * `+ Muestra Nominal`: Envía una lectura normal para probar la estabilidad de las bandas.
  * `⚡ Simular Cavitación / Falla`: Inyecta valores elevados ($I=3.15\text{ A}$, $\text{Vib}=4.85\text{ m/s}^2$, $T=71.2\text{ °C}$) para observar la respuesta del sistema de alerta.

### F. Historial de Eventos de MongoDB
* Muestra en una tabla reactiva los registros recuperados de la base de datos.
* Incluye una casilla de verificación para **filtrar únicamente los eventos anómalos**, facilitando la auditoría de fallas.

---

## 4. Dependencias del Frontend y Justificación Técnica

```json
{
  "dependencies": {
    "react": "^19.3.1",
    "react-dom": "^19.3.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.3.3",
    "tailwindcss": "^4.3.3",
    "postcss": "^8.5.31",
    "autoprefixer": "^10.6.1",
    "vite": "^8.3.4",
    "@vitejs/plugin-react": "^6.1.2"
  }
}
```

* **`react` & `react-dom` (v19):** Biblioteca estándar para la construcción de interfaces declarativas basadas en componentes reutilizables, utilizando hooks nativos (`useState`, `useEffect`, `useMemo`).
* **`vite` (v8):** Servidor de desarrollo con tiempos de inicio inmediatos y empaquetador de producción altamente optimizado basado en ES Modules.
* **`tailwindcss` (v4):** Sistema de utilidades CSS para maquetar el panel de control industrial en modo oscuro de forma responsiva y con cero CSS innecesario.
* **`@tailwindcss/postcss`:** Plugin oficial indispensable en la arquitectura de **Tailwind CSS v4** para compilar la directiva `@import "tailwindcss";` mediante PostCSS en el flujo de construcción de Vite.
* **`postcss` & `autoprefixer`:** Pipeline de procesamiento CSS que garantiza compatibilidad entre diferentes motores de navegación.

---

## 5. Guía de Ejecución Local del Frontend

### Paso 1: Instalar Dependencias
Dentro de la carpeta `frontend/`:
```bash
npm install
```

### Paso 2: Configurar la URL de la API (Opcional)
Por defecto, la aplicación se conecta a `http://localhost:3000`. Si el backend corre en otro puerto o en un servidor remoto, crea un archivo `.env` en la raíz de `frontend/`:
```env
VITE_API_URL=http://localhost:3000
```

### Paso 3: Iniciar el Servidor de Desarrollo
```bash
npm run dev
```

El panel estará disponible de inmediato en **`http://localhost:5173`**.

### Paso 4: Compilar para Producción (Despliegue)
```bash
npm run build
```
Genera la carpeta optimizada `dist/` lista para ser servida por Nginx, Vercel, Netlify o cualquier servidor estático.

