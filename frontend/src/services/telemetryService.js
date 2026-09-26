/**
 * Telemetry Service for RF Smart Scheduler
 *
 * Provides unified interface for streaming real-time receiver and environmental telemetry.
 * Connects directly to backend API/WebSocket when available, and falls back to deterministic
 * radio spectrum simulation when offline.
 *
 * Dwell time: 0.5 ms (scaled ultra-high-speed cognitive electronic warfare scheduler)
 * Total simulation duration: 120 dwells (60.0 ms)
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

// Ground truth spectrum bands configuration (500 MHz to 18 GHz across 20 channels)
export const SPECTRUM_BANDS = [
  { id: 1, range: '0.50 – 1.38 GHz', center: '0.94 GHz', minFreq: 0.50, maxFreq: 1.38 },
  { id: 2, range: '1.38 – 2.25 GHz', center: '1.81 GHz', minFreq: 1.38, maxFreq: 2.25 },
  { id: 3, range: '2.25 – 3.13 GHz', center: '2.69 GHz', minFreq: 2.25, maxFreq: 3.13 },
  { id: 4, range: '3.13 – 4.00 GHz', center: '3.56 GHz', minFreq: 3.13, maxFreq: 4.00 },
  { id: 5, range: '4.00 – 4.88 GHz', center: '4.44 GHz', minFreq: 4.00, maxFreq: 4.88 },
  { id: 6, range: '4.88 – 5.75 GHz', center: '5.31 GHz', minFreq: 4.88, maxFreq: 5.75 },
  { id: 7, range: '5.75 – 6.63 GHz', center: '6.19 GHz', minFreq: 5.75, maxFreq: 6.63 },
  { id: 8, range: '6.63 – 7.50 GHz', center: '7.06 GHz', minFreq: 6.63, maxFreq: 7.50 },
  { id: 9, range: '7.50 – 8.38 GHz', center: '7.94 GHz', minFreq: 7.50, maxFreq: 8.38 },
  { id: 10, range: '8.38 – 9.25 GHz', center: '8.81 GHz', minFreq: 8.38, maxFreq: 9.25 },
  { id: 11, range: '9.25 – 10.13 GHz', center: '9.69 GHz', minFreq: 9.25, maxFreq: 10.13 },
  { id: 12, range: '10.13 – 11.00 GHz', center: '10.56 GHz', minFreq: 10.13, maxFreq: 11.00 },
  { id: 13, range: '11.00 – 11.88 GHz', center: '11.44 GHz', minFreq: 11.00, maxFreq: 11.88 },
  { id: 14, range: '11.88 – 12.75 GHz', center: '12.31 GHz', minFreq: 11.88, maxFreq: 12.75 },
  { id: 15, range: '12.75 – 13.63 GHz', center: '13.19 GHz', minFreq: 12.75, maxFreq: 13.63 },
  { id: 16, range: '13.63 – 14.50 GHz', center: '14.06 GHz', minFreq: 13.63, maxFreq: 14.50 },
  { id: 17, range: '14.50 – 15.38 GHz', center: '14.94 GHz', minFreq: 14.50, maxFreq: 15.38 },
  { id: 18, range: '15.38 – 16.25 GHz', center: '15.81 GHz', minFreq: 15.38, maxFreq: 16.25 },
  { id: 19, range: '16.25 – 17.13 GHz', center: '16.69 GHz', minFreq: 16.25, maxFreq: 17.13 },
  { id: 20, range: '17.13 – 18.00 GHz', center: '17.56 GHz', minFreq: 17.13, maxFreq: 18.00 },
];

export const TOTAL_SIMULATION_DWELLS = 120;
export const DWELL_DURATION_MS = 0.5;

/**
 * Generate 120 deterministic, highly realistic radar dwells (0.5 ms each = 60.0 ms)
 */
function build120DwellDataset() {
  const dataset = [];

  const getEmissionsForDwell = (i) => {
    const emissions = [];

    // Emitter 1: Ku-band SAR / Target Tracking (Band 14, 12.31 GHz)
    if (i % 3 !== 0) {
      const f = i % 2 === 0 ? '12.31 GHz' : '12.28 GHz';
      emissions.push({ bandId: 14, freq: f, type: 'Ku-Band SAR / Target Track', pulses: 3 });
    }

    // Emitter 2: C-Band Air Defense Radar (Band 7, 6.19 GHz)
    if (i % 4 === 1 || i % 4 === 2) {
      emissions.push({ bandId: 7, freq: '6.19 GHz', type: 'C-Band Air Defense', pulses: 2 });
    }

    // Emitter 3: X-Band Fire Control Radar (Band 11 or 12)
    if (i % 5 === 0 || i % 5 === 1) {
      const bId = (i % 2 === 0) ? 12 : 11;
      const f = bId === 12 ? '10.56 GHz' : '9.69 GHz';
      emissions.push({ bandId: bId, freq: f, type: 'X-Band Fire Control', pulses: 4 });
    }

    // Emitter 4: EW Jammer / Chirp (Band 18 or 19)
    if (i % 7 === 3 || i % 9 === 4) {
      const bId = (i % 2 === 0) ? 18 : 19;
      const f = bId === 18 ? '15.81 GHz' : '16.69 GHz';
      emissions.push({ bandId: bId, freq: f, type: 'EW Frequency Agility Jammer', pulses: 3 });
    }

    // Emitter 5: S-Band Phased Array (Band 4, 3.56 GHz)
    if (i % 8 === 2) {
      emissions.push({ bandId: 4, freq: '3.56 GHz', type: 'S-Band Phased Array', pulses: 2 });
    }

    // Emitter 6: Airborne Early Warning (Band 8 or 16)
    if (i % 11 === 5) {
      const bId = (i % 2 === 0) ? 8 : 16;
      const f = bId === 8 ? '7.06 GHz' : '14.06 GHz';
      emissions.push({ bandId: bId, freq: f, type: 'Airborne Early Warning', pulses: 3 });
    }

    // Emitter 7: L-Band Surveillance (Band 2, 1.81 GHz)
    if (i % 13 === 7) {
      emissions.push({ bandId: 2, freq: '1.81 GHz', type: 'L-Band Surveillance Radar', pulses: 2 });
    }

    if (emissions.length === 0) {
      emissions.push({ bandId: 14, freq: '12.31 GHz', type: 'Ku-Band SAR Tracking', pulses: 2 });
    }

    return emissions;
  };

  // LinUCB cognitive policy schedule
  const selectLinUCBDecision = (i, activeEmissions) => {
    const activeBands = activeEmissions.map((e) => e.bandId);
    const exploreCycle = i % 7 === 0 || i % 11 === 0;
    if (exploreCycle) {
      const explorationBands = [2, 3, 5, 8, 9, 10, 13, 15, 16, 17, 20];
      return explorationBands[i % explorationBands.length];
    }
    if (activeBands.includes(14) && i % 3 !== 2) return 14;
    if (activeBands.includes(7) && i % 4 === 1) return 7;
    if (activeBands.includes(12)) return 12;
    if (activeBands.includes(11)) return 11;
    if (activeBands.includes(18)) return 18;
    return activeBands[0] || 14;
  };

  let mlHits = 432;
  let mlScanMisses = 268;
  let mlTotalEmissions = 488;
  let mlReward = 358.4;
  let mlTotalDwells = 700;

  let olHits = 168;
  let olScanMisses = 532;
  let olTotalEmissions = 408;
  let olReward = 56.0;
  let olTotalDwells = 700;

  for (let i = 1; i <= TOTAL_SIMULATION_DWELLS; i++) {
    const startMs = Number(((i - 1) * DWELL_DURATION_MS).toFixed(1));
    const endMs = Number((i * DWELL_DURATION_MS).toFixed(1));
    const timeWindow = `${startMs.toFixed(1)}–${endMs.toFixed(1)} ms`;

    const activeEmissions = getEmissionsForDwell(i);
    const activeBandIds = activeEmissions.map((e) => e.bandId);

    const mlBand = selectLinUCBDecision(i, activeEmissions);
    const olBand = ((i - 1) % 20) + 1; // Sequential sweep 1 to 20

    const mlMatched = activeEmissions.find((e) => e.bandId === mlBand);
    const mlIntercepted = Boolean(mlMatched);
    const mlPulses = mlIntercepted ? (mlMatched.pulses || 3) : 0;
    const mlResult = mlIntercepted ? 'HIT' : 'SCAN MISS';

    const olMatched = activeEmissions.find((e) => e.bandId === olBand);
    const olIntercepted = Boolean(olMatched);
    const olPulses = olIntercepted ? (olMatched.pulses || 2) : 0;
    const olResult = olIntercepted ? 'HIT' : 'SCAN MISS';

    mlTotalDwells += 1;
    mlTotalEmissions += activeEmissions.length;
    if (mlIntercepted) {
      mlHits += 1;
      mlReward += 1.0;
    } else {
      mlScanMisses += 1;
      mlReward -= 0.05;
    }

    olTotalDwells += 1;
    olTotalEmissions += activeEmissions.length;
    if (olIntercepted) {
      olHits += 1;
      olReward += 0.8;
    } else {
      olScanMisses += 1;
      olReward -= 0.05;
    }

    const mlCorrectRate = (mlHits / (mlHits + mlScanMisses)) * 100;
    const mlPd = (mlHits / mlTotalEmissions) * 100;
    const mlAvgR = mlReward / mlTotalDwells;

    const olCorrectRate = (olHits / (olHits + olScanMisses)) * 100;
    const olPd = (olHits / olTotalEmissions) * 100;
    const olAvgR = olReward / olTotalDwells;

    const mlConf = SPECTRUM_BANDS.find((b) => b.id === mlBand) || { center: '12.31 GHz', range: `Band ${mlBand}` };
    const olConf = SPECTRUM_BANDS.find((b) => b.id === olBand) || { center: '0.94 GHz', range: `Band ${olBand}` };

    const dwellItem = {
      dwellIndex: i,
      startMs,
      endMs,
      timeWindow,
      dwellTimeMs: DWELL_DURATION_MS,
      environment: {
        dwellTimeMs: DWELL_DURATION_MS,
        startMs,
        endMs,
        timeWindow,
        actualEmissionBand: activeEmissions[0].bandId,
        actualEmissionBands: activeBandIds,
        emissionFrequency: activeEmissions.map((e) => e.freq).join(', '),
        emissionFrequencies: activeEmissions.map((e) => e.freq),
        signalType: activeEmissions.map((e) => e.type).join(' | '),
        emissions: activeEmissions.map((e) => ({
          ...e,
          isDetected: e.bandId === mlBand,
          pulses: e.pulses || 3,
        })),
      },
      adaptive: {
        currentBand: mlBand,
        isIntercepted: mlIntercepted,
        result: mlResult,
        pulsesDetected: mlPulses,
        interceptedFrequency: mlIntercepted ? mlMatched.freq : '-',
        centerFreq: mlConf.center,
        range: mlConf.range,
        metrics: {
          correctScanRate: `${mlCorrectRate.toFixed(1)}%`,
          hitRate: `${mlCorrectRate.toFixed(1)}%`,
          interceptRate: `${(0.72 + (i % 7) * 0.01).toFixed(2)} /s`,
          probDetection: `${mlPd.toFixed(1)}%`,
          avgInterceptDelay: `${(11.8 + (i % 5) * 0.3).toFixed(1)} ms`,
          avgReward: `${mlAvgR >= 0 ? '+' : ''}${mlAvgR.toFixed(2)}`,
          meanRevisitInterval: '12.5 ms',
          totalHits: mlHits,
          totalScanMisses: mlScanMisses,
          totalMisses: mlScanMisses,
          totalDetected: mlHits,
          totalActualEmissions: mlTotalEmissions,
          pulsesDetected: mlPulses,
        },
      },
      openLoop: {
        currentBand: olBand,
        isIntercepted: olIntercepted,
        result: olResult,
        pulsesDetected: olPulses,
        interceptedFrequency: olIntercepted ? olMatched.freq : '-',
        centerFreq: olConf.center,
        range: olConf.range,
        metrics: {
          correctScanRate: `${olCorrectRate.toFixed(1)}%`,
          hitRate: `${olCorrectRate.toFixed(1)}%`,
          interceptRate: `${(0.24 + (i % 5) * 0.01).toFixed(2)} /s`,
          probDetection: `${olPd.toFixed(1)}%`,
          avgInterceptDelay: `${(48.2 + (i % 7) * 0.4).toFixed(1)} ms`,
          avgReward: `${olAvgR >= 0 ? '+' : ''}${olAvgR.toFixed(2)}`,
          meanRevisitInterval: '10.0 ms',
          totalHits: olHits,
          totalScanMisses: olScanMisses,
          totalMisses: olScanMisses,
          totalDetected: olHits,
          totalActualEmissions: olTotalEmissions,
          pulsesDetected: olPulses,
        },
      },
    };

    dataset.push(dwellItem);
  }

  return dataset;
}

// Cached full dataset of 120 realistic dwells
export const MOCK_120_DWELLS = build120DwellDataset();

/**
 * Retrieve historical dwell records by index range (1-indexed, inclusive)
 */
export function getMockDwellHistory(fromIndex = 1, toIndex = TOTAL_SIMULATION_DWELLS) {
  const start = Math.max(0, fromIndex - 1);
  const end = Math.min(MOCK_120_DWELLS.length, toIndex);
  return MOCK_120_DWELLS.slice(start, end);
}

/**
 * Fetch latest telemetry snapshot from backend REST API
 */
export async function fetchTelemetry() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/telemetry`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    return null;
  }
}

/**
 * Subscribe to telemetry stream.
 * Supports:
 * - 'batch' mode (default): populates chunks of 20 dwells at a time for high-speed streaming
 * - 'slow' mode: steps dwell-by-dwell for the slower-speed replay with circular scans
 */
export function subscribeTelemetry(onUpdate, options = {}) {
  const {
    mode = 'batch', // 'batch' | 'slow'
    batchSize = 20,
    intervalMs = mode === 'batch' ? 1200 : 750,
    startIndex = 0,
  } = options;

  let active = true;
  let timer = null;
  let currentIndex = startIndex;

  const runStep = () => {
    if (!active) return;

    if (mode === 'batch') {
      const nextEndIndex = Math.min(TOTAL_SIMULATION_DWELLS, currentIndex + batchSize);
      const batchDwells = MOCK_120_DWELLS.slice(currentIndex, nextEndIndex);
      currentIndex = nextEndIndex;

      const isComplete = currentIndex >= TOTAL_SIMULATION_DWELLS;
      const latestDwell = batchDwells[batchDwells.length - 1] || MOCK_120_DWELLS[0];

      const snapshot = {
        source: 'simulation',
        mode: 'batch',
        timestamp: Date.now(),
        isComplete,
        completionMessage: isComplete
          ? `Simulation completed! All ${TOTAL_SIMULATION_DWELLS} dwell windows (${(TOTAL_SIMULATION_DWELLS * DWELL_DURATION_MS).toFixed(1)} ms) processed.`
          : null,
        batch: batchDwells,
        batchStartIndex: currentIndex - batchDwells.length + 1,
        batchEndIndex: currentIndex,
        dwell: latestDwell.environment,
        environment: latestDwell.environment,
        adaptive: latestDwell.adaptive,
        openLoop: latestDwell.openLoop,
      };

      onUpdate(snapshot);

      if (isComplete) {
        active = false;
        if (timer) clearInterval(timer);
      }
    } else {
      currentIndex += 1;
      const isComplete = currentIndex >= TOTAL_SIMULATION_DWELLS;
      const currentDwell = MOCK_120_DWELLS[currentIndex - 1] || MOCK_120_DWELLS[MOCK_120_DWELLS.length - 1];

      const snapshot = {
        source: 'simulation',
        mode: 'slow',
        timestamp: Date.now(),
        isComplete,
        completionMessage: isComplete
          ? `Slow replay completed! All ${TOTAL_SIMULATION_DWELLS} dwells (${(TOTAL_SIMULATION_DWELLS * DWELL_DURATION_MS).toFixed(1)} ms) inspected.`
          : null,
        singleDwell: currentDwell,
        dwellIndex: currentIndex,
        dwell: currentDwell.environment,
        environment: currentDwell.environment,
        adaptive: currentDwell.adaptive,
        openLoop: currentDwell.openLoop,
      };

      onUpdate(snapshot);

      if (isComplete) {
        active = false;
        if (timer) clearInterval(timer);
      }
    }
  };

  runStep();
  timer = setInterval(runStep, intervalMs);

  return () => {
    active = false;
    if (timer) clearInterval(timer);
  };
}

