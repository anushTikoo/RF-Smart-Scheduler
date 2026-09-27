/**
 * Telemetry Service for RF Smart Scheduler
 *
 * Real-time WebSocket streaming and REST communication with the FastAPI backend.
 * All mock data has been completely removed.
 *
 * Dwell time: 0.5 ms (scaled ultra-high-speed cognitive electronic warfare scheduler)
 * Total simulation duration: determined by uploaded dataset (default: 120 dwells = 60.0 ms)
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS_BASE_URL =
  import.meta.env.VITE_WS_URL ||
  (typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:') +
    '//' +
    (typeof window !== 'undefined' ? window.location.hostname : 'localhost') +
    ':8000';

// Ground truth spectrum bands configuration (500 MHz to 18 GHz across 20 channels)
export const SPECTRUM_BANDS = [
  { id: 1, range: '0.50 – 1.38 GHz', center: '0.94 GHz', minFreq: 0.5, maxFreq: 1.38 },
  { id: 2, range: '1.38 – 2.25 GHz', center: '1.81 GHz', minFreq: 1.38, maxFreq: 2.25 },
  { id: 3, range: '2.25 – 3.13 GHz', center: '2.69 GHz', minFreq: 2.25, maxFreq: 3.13 },
  { id: 4, range: '3.13 – 4.00 GHz', center: '3.56 GHz', minFreq: 3.13, maxFreq: 4.0 },
  { id: 5, range: '4.00 – 4.88 GHz', center: '4.44 GHz', minFreq: 4.0, maxFreq: 4.88 },
  { id: 6, range: '4.88 – 5.75 GHz', center: '5.31 GHz', minFreq: 4.88, maxFreq: 5.75 },
  { id: 7, range: '5.75 – 6.63 GHz', center: '6.19 GHz', minFreq: 5.75, maxFreq: 6.63 },
  { id: 8, range: '6.63 – 7.50 GHz', center: '7.06 GHz', minFreq: 6.63, maxFreq: 7.5 },
  { id: 9, range: '7.50 – 8.38 GHz', center: '7.94 GHz', minFreq: 7.5, maxFreq: 8.38 },
  { id: 10, range: '8.38 – 9.25 GHz', center: '8.81 GHz', minFreq: 8.38, maxFreq: 9.25 },
  { id: 11, range: '9.25 – 10.13 GHz', center: '9.69 GHz', minFreq: 9.25, maxFreq: 10.13 },
  { id: 12, range: '10.13 – 11.00 GHz', center: '10.56 GHz', minFreq: 10.13, maxFreq: 11.0 },
  { id: 13, range: '11.00 – 11.88 GHz', center: '11.44 GHz', minFreq: 11.0, maxFreq: 11.88 },
  { id: 14, range: '11.88 – 12.75 GHz', center: '12.31 GHz', minFreq: 11.88, maxFreq: 12.75 },
  { id: 15, range: '12.75 – 13.63 GHz', center: '13.19 GHz', minFreq: 12.75, maxFreq: 13.63 },
  { id: 16, range: '13.63 – 14.50 GHz', center: '14.06 GHz', minFreq: 13.63, maxFreq: 14.5 },
  { id: 17, range: '14.50 – 15.38 GHz', center: '14.94 GHz', minFreq: 14.5, maxFreq: 15.38 },
  { id: 18, range: '15.38 – 16.25 GHz', center: '15.81 GHz', minFreq: 15.38, maxFreq: 16.25 },
  { id: 19, range: '16.25 – 17.13 GHz', center: '16.69 GHz', minFreq: 16.25, maxFreq: 17.13 },
  { id: 20, range: '17.13 – 18.00 GHz', center: '17.56 GHz', minFreq: 17.13, maxFreq: 18.0 },
];

export const TOTAL_SIMULATION_DWELLS = 120;
export const DWELL_DURATION_MS = 0.5;

// Shared active WebSocket reference for bi-directional command dispatch
let activeSocket = null;

/**
 * Check if the WebSocket session is currently active and open.
 */
export function isTelemetryConnected() {
  return Boolean(activeSocket && activeSocket.readyState === WebSocket.OPEN);
}

/**
 * Dispatch a command message to the running backend WebSocket session.
 */
export function sendTelemetryCommand(commandObj) {
  if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
    try {
      activeSocket.send(JSON.stringify(commandObj));
      return true;
    } catch (err) {
      console.error('Failed to send WebSocket command:', err);
      return false;
    }
  }
  return false;
}

/**
 * Subscribe to the real-time backend WebSocket stream.
 *
 * Supports:
 * - mode: 'batch' (chunks of 20 dwells for high-speed streaming)
 * - mode: 'slow' (single dwell ticks for circular scan sweep replay)
 * - bi-directional commands: pause, resume, replay, scrub, step, set_mode, set_interval, reset
 */
export function subscribeTelemetry(onUpdate, options = {}) {
  const {
    mode = 'batch',
    batchSize = 20,
    intervalMs = mode === 'batch' ? 250 : 750,
    startIndex = 0,
    getStartIndex,
    autoStart = true,
  } = options;

  let isClosedManually = false;
  let reconnectTimer = null;

  const connect = () => {
    if (isClosedManually) return;

    const baseWs = WS_BASE_URL.replace(/^http/, 'ws');
    const startIdx = typeof getStartIndex === 'function' ? getStartIndex() : startIndex;
    const wsUrl = `${baseWs}/ws/telemetry?mode=${mode}&batch_size=${batchSize}&interval_ms=${intervalMs}&auto_start=${autoStart}&start_index=${startIdx}`;

    const ws = new WebSocket(wsUrl);
    activeSocket = ws;

    ws.onopen = () => {
      // Successfully connected to backend WebSocket
    };

    ws.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data);
        onUpdate(snapshot);
      } catch (err) {
        console.error('Failed to parse telemetry snapshot JSON:', err);
      }
    };

    ws.onerror = (err) => {
      console.warn('Telemetry WebSocket error:', err);
    };

    ws.onclose = (event) => {
      if (!isClosedManually && !event.wasClean) {
        // Attempt automatic reconnection if disconnected unexpectedly
        reconnectTimer = setTimeout(connect, 2000);
      }
    };
  };

  connect();

  return () => {
    isClosedManually = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (activeSocket) {
      if (activeSocket.readyState === WebSocket.OPEN) {
        try {
          activeSocket.send(JSON.stringify({ command: 'pause' }));
        } catch (e) {
          console.debug('Socket pause error:', e);
        }
      }
      activeSocket.close();
      activeSocket = null;
    }
  };
}

/**
 * Fetch latest telemetry snapshot from backend REST API
 */
export async function fetchTelemetry() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/telemetry`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch telemetry snapshot:', err);
    return null;
  }
}

/**
 * Fetch historical dwell records by index range (1-indexed, inclusive) from backend
 */
export async function fetchDwellHistory(fromIndex = 1, toIndex = TOTAL_SIMULATION_DWELLS, limit = 500) {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/dwells?from_index=${fromIndex}&to_index=${toIndex}&limit=${limit}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch dwell history:', err);
    return null;
  }
}

/**
 * Stream/download the complete simulation dataset (all 58,415+ decisions) as CSV directly from backend
 */
export async function downloadFullCsv(viewMode = 'receiver', filterType = 'all') {
  const url = `${API_BASE_URL}/api/export/csv?view_mode=${viewMode}&filter_type=${filterType}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = `rf_scheduler_full_${viewMode}_${filterType}_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
}

/**
 * Fetch a single dwell record by 1-based index from backend
 */
export async function fetchSingleDwell(dwellIndex) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/dwells/${dwellIndex}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`Failed to fetch dwell ${dwellIndex}:`, err);
    return null;
  }
}

/**
 * Upload a .h5 dataset file to the backend
 */
export async function uploadDataset(file) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE_URL}/api/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    let errMsg = `Upload failed with status ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson.detail) errMsg = errJson.detail;
    } catch {
      // Body is not JSON
    }
    throw new Error(errMsg);
  }

  return await res.json();
}

/**
 * Fetch metadata about the currently loaded dataset
 */
export async function fetchDatasetInfo() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/dataset/info`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Reset the simulation environment and schedulers to step 0
 */
export async function resetSimulation() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/reset`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to reset simulation:', err);
    return null;
  }
}

/**
 * Fetch current receiver, reward, and LinUCB algorithm configuration
 */
export async function fetchConfig() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/config`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch config:', err);
    return null;
  }
}

/**
 * Dynamically adjust RL and receiver parameters during runtime
 */
export async function updateConfig(configParams) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(configParams),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to update config:', err);
    throw err;
  }
}

/**
 * Fetch detailed figures of merit comparing Adaptive ML with Open Loop
 */
export async function fetchMetrics() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/metrics`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch metrics:', err);
    return null;
  }
}

/**
 * Fetch internal LinUCB bandit state (theta weights, feature names, covariances)
 */
export async function fetchModelState() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/model/state`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to fetch model state:', err);
    return null;
  }
}

/**
 * Run a multi-scheduler comparative benchmark
 */
export async function fetchBenchmark(numDwells = 50) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/benchmark`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ num_dwells: numDwells }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to run benchmark:', err);
    throw err;
  }
}
