import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import RadarScanner, { BAND_CONFIG } from './components/RadarScanner';
import ObservationsSection from './components/ObservationsSection';
import RLParametersAccordion from './components/RLParametersAccordion';
import Toast from './components/Toast';
import {
  subscribeTelemetry,
  sendTelemetryCommand,
  fetchDwellHistory,
  fetchDatasetInfo,
  uploadDataset,
  resetSimulation,
  fetchConfig,
  TOTAL_SIMULATION_DWELLS,
  DWELL_DURATION_MS,
} from './services/telemetryService';

/**
 * Transforms a raw dwell snapshot record into an observation object for graph & table
 */
function dwellToObservation(dwellItem) {
  if (!dwellItem) return null;
  const env = dwellItem.environment || {};
  const adapt = dwellItem.adaptive || {};
  const bandId = adapt.currentBand || 1;
  const bConf = (BAND_CONFIG && BAND_CONFIG.find((b) => b.id === bandId)) || {
    id: bandId,
    center: `${(0.5 + bandId * 0.875).toFixed(2)} GHz`,
    range: `Band ${bandId}`,
  };

  const isHit = Boolean(adapt.isIntercepted);
  const result = isHit ? 'HIT' : 'SCAN MISS';

  const envBands = env.actualEmissionBands || (env.actualEmissionBand ? [env.actualEmissionBand] : []);
  const emissionsList = env.emissions || envBands.map((bId) => {
    const c = BAND_CONFIG && BAND_CONFIG.find((b) => b.id === bId);
    return { bandId: bId, freq: c ? c.center : '', type: '', pulses: 3 };
  });

  const actualEmissionsData = emissionsList.map((e) => {
    const isDetected = e.bandId === bandId;
    return {
      bandId: e.bandId,
      freqStr: e.freq,
      freqGhz: parseFloat(e.freq) || (BAND_CONFIG && BAND_CONFIG.find((b) => b.id === e.bandId) ? parseFloat(BAND_CONFIG.find((b) => b.id === e.bandId).center) : null),
      type: e.type,
      pulses: e.pulses || 3,
      isDetected: isDetected,
      status: isDetected ? 'DETECTED' : `Missed (Receiver on Band ${bandId})`,
    };
  });

  let scanFreq = parseFloat(bConf.center);
  if (isHit && adapt.interceptedFrequency && adapt.interceptedFrequency !== '-') {
    scanFreq = parseFloat(adapt.interceptedFrequency);
  }

  const startMs = dwellItem.startMs !== undefined ? dwellItem.startMs : (dwellItem.dwellIndex - 1) * DWELL_DURATION_MS;
  const endMs = dwellItem.endMs !== undefined ? dwellItem.endMs : dwellItem.dwellIndex * DWELL_DURATION_MS;
  const timeWindow = dwellItem.timeWindow || `${startMs.toFixed(1)}–${endMs.toFixed(1)} ms`;

  const dwellReward = dwellItem.reward !== undefined
    ? dwellItem.reward
    : (adapt.reward !== undefined ? adapt.reward : (isHit ? 0.02 : -0.01));

  return {
    id: dwellItem.dwellIndex,
    dwellIndex: dwellItem.dwellIndex,
    startMs,
    endMs,
    timeWindow,
    timestamp: timeWindow,
    band: `Band ${bandId}`,
    bandId: bandId,
    centerFreq: bConf.center,
    interceptedFreq: isHit ? (adapt.interceptedFrequency || bConf.center) : '-',
    exactFreq: isHit ? (adapt.interceptedFrequency || bConf.center) : bConf.center,
    range: bConf.range,
    freqGhz: scanFreq || (0.5 + bandId * 0.875),
    status: result,
    result: result,
    reward: dwellReward,
    pulsesDetected: adapt.pulsesDetected !== undefined ? adapt.pulsesDetected : (isHit ? 3 : 0),
    isIntercepted: isHit,
    actualBands: envBands,
    actualBand: envBands.length > 0 ? envBands[0] : null,
    actualEmissions: actualEmissionsData,
    actualFreqStr: env.emissionFrequency || (actualEmissionsData.length > 0 ? actualEmissionsData.map((e) => e.freqStr).join(', ') : '-'),
    hasEmission: envBands.length > 0,
  };
}

export default function App() {
  // App states
  const [viewMode, setViewMode] = useState('receiver'); // 'receiver' | 'environment'
  const [isScanning, setIsScanning] = useState(false);
  const [isSimulationComplete, setIsSimulationComplete] = useState(false);
  const [loadedDataset, setLoadedDataset] = useState(null);
  const [totalDwells, setTotalDwells] = useState(TOTAL_SIMULATION_DWELLS);
  const [toastMessage, setToastMessage] = useState(null);
  const [rlConfig, setRlConfig] = useState(null);
  const [realTimeSeconds, setRealTimeSeconds] = useState(0);

  // Speed and Replay mode states
  const [isSlowReplay, setIsSlowReplay] = useState(false); // false = High-Speed, true = Slower Replay
  const [streamStartIndex, setStreamStartIndex] = useState(0);
  const [scrubberTimeMs, setScrubberTimeMs] = useState(0.5);

  // Live mode real-time stopwatch: increments elapsed seconds while scanning in live mode
  useEffect(() => {
    let timer = null;
    if (isScanning && !isSimulationComplete && !isSlowReplay) {
      const startTime = Date.now() - realTimeSeconds * 1000;
      timer = setInterval(() => {
        setRealTimeSeconds(Math.max(0, (Date.now() - startTime) / 1000));
      }, 100);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isScanning, isSimulationComplete, isSlowReplay]);

  // Dynamic observations stream for Adaptive ML Scan
  const [observations, setObservations] = useState([]);
  const observationsRef = useRef([]);
  const completedLiveStateRef = useRef(null);
  const hasLiveCompletedRef = useRef(false);
  const latestDwellIndexRef = useRef(0);
  useEffect(() => {
    observationsRef.current = observations;
  }, [observations]);

  // Radar Scanner & Telemetry states
  const [telemetrySource, setTelemetrySource] = useState('initializing');
  const [mlCurrentBand, setMlCurrentBand] = useState(null);
  const [openLoopCurrentBand, setOpenLoopCurrentBand] = useState(null);
  const [actualEmissionBand, setActualEmissionBand] = useState(null);
  const [actualEmissionBands, setActualEmissionBands] = useState([]);
  const [emissionFrequency, setEmissionFrequency] = useState(null);
  const [mlInterceptedFreq, setMlInterceptedFreq] = useState(null);
  const [openLoopInterceptedFreq, setOpenLoopInterceptedFreq] = useState(null);

  // Simulation metrics - initialized clean to '-'
  const [mlMetrics, setMlMetrics] = useState({
    interceptRate: '-',
    correctScanRate: '-',
    hitRate: '-',
    probDetection: '-',
    avgInterceptDelay: '-',
    avgReward: '-',
    meanRevisitInterval: '-',
    totalHits: '-',
    totalScanMisses: '-',
    totalActualEmissions: '-',
  });

  const [openLoopMetrics, setOpenLoopMetrics] = useState({
    interceptRate: '-',
    correctScanRate: '-',
    hitRate: '-',
    probDetection: '-',
    avgInterceptDelay: '-',
    avgReward: '-',
    meanRevisitInterval: '-',
    totalHits: '-',
    totalScanMisses: '-',
    totalActualEmissions: '-',
  });

  // On mount: check if backend already has a dataset loaded and fetch RL config
  useEffect(() => {
    let isMounted = true;
    async function initFromBackend() {
      try {
        const info = await fetchDatasetInfo();
        if (isMounted && info && info.loaded) {
          setLoadedDataset(info);
          if (info.total_dwells) {
            setTotalDwells(info.total_dwells);
          }
        }
        const cfg = await fetchConfig();
        if (isMounted && cfg) {
          setRlConfig(cfg);
        }
      } catch (err) {
        // Backend not yet reachable on initial load
      }
    }
    initFromBackend();
    return () => {
      isMounted = false;
    };
  }, []);

  // Active WebSocket session: stays connected while scanning OR while paused during slow replay
  const isWsSessionActive = isScanning || (isSlowReplay && !isSimulationComplete);

  // Subscribe to live telemetry WebSocket stream
  useEffect(() => {
    if (!isWsSessionActive) return;

    const unsubscribe = subscribeTelemetry(
      (snapshot) => {
        if (!snapshot) return;
        setTelemetrySource(snapshot.source || 'connected');
        if (snapshot.totalDwells && snapshot.totalDwells > 0) {
          setTotalDwells((prev) => (prev !== snapshot.totalDwells ? snapshot.totalDwells : prev));
        }

        if (snapshot.isComplete) {
          setIsScanning(false);
          setIsSimulationComplete(true);
          showToast(
            snapshot.completionMessage ||
              `Simulation completed! All ${totalDwells} dwell windows (${(totalDwells * DWELL_DURATION_MS).toFixed(1)} ms) processed.`
          );
        }

        if (snapshot.environment) {
          setActualEmissionBand(snapshot.environment.actualEmissionBand);
          setActualEmissionBands(
            snapshot.environment.actualEmissionBands ||
              (snapshot.environment.actualEmissionBand ? [snapshot.environment.actualEmissionBand] : [])
          );
          if (snapshot.environment.emissionFrequency) {
            setEmissionFrequency(snapshot.environment.emissionFrequency);
          }
        }

        if (snapshot.adaptive) {
          setMlCurrentBand(snapshot.adaptive.currentBand);
          setMlInterceptedFreq(snapshot.adaptive.interceptedFrequency);
          if (snapshot.adaptive.metrics) {
            setMlMetrics(snapshot.adaptive.metrics);
          }
        }

        if (snapshot.openLoop) {
          setOpenLoopCurrentBand(snapshot.openLoop.currentBand);
          setOpenLoopInterceptedFreq(snapshot.openLoop.interceptedFrequency);
          if (snapshot.openLoop.metrics) {
            setOpenLoopMetrics(snapshot.openLoop.metrics);
          }
        }

        // Live Mode (batch): Show the latest 20 dwells window streaming in real-time
        if (snapshot.mode === 'batch' && snapshot.batch) {
          const newEntries = snapshot.batch.map(dwellToObservation).filter(Boolean);
          // Set to latest chunk window (do not pile up 58,000 array elements in React state)
          setObservations(newEntries);
          const latestIdx = snapshot.dwellIndex || snapshot.batchEndIndex || (snapshot.batch[snapshot.batch.length - 1]?.dwellIndex);
          if (latestIdx) {
            latestDwellIndexRef.current = latestIdx;
            setScrubberTimeMs(Number((latestIdx * DWELL_DURATION_MS).toFixed(1)));
          }
          if (snapshot.isComplete) {
            hasLiveCompletedRef.current = true;
            completedLiveStateRef.current = {
              observations: newEntries,
              mlMetrics: snapshot.adaptive?.metrics || null,
              openLoopMetrics: snapshot.openLoop?.metrics || null,
              mlCurrentBand: snapshot.adaptive?.currentBand || null,
              mlInterceptedFreq: snapshot.adaptive?.interceptedFrequency || null,
              openLoopCurrentBand: snapshot.openLoop?.currentBand || null,
              openLoopInterceptedFreq: snapshot.openLoop?.interceptedFrequency || null,
              actualEmissionBand: snapshot.environment?.actualEmissionBand || null,
              actualEmissionBands: snapshot.environment?.actualEmissionBands || [],
              emissionFrequency: snapshot.environment?.emissionFrequency || null,
              scrubberTimeMs: latestIdx ? Number((latestIdx * DWELL_DURATION_MS).toFixed(1)) : 0,
            };
          }
        } else if (snapshot.mode === 'slow' && snapshot.singleDwell) {
          // Slow Replay Mode: Steps 1 dwell at a time for circular radar sweep
          const obsItem = dwellToObservation(snapshot.singleDwell);
          if (obsItem) {
            const curIdx = obsItem.dwellIndex || obsItem.id;
            latestDwellIndexRef.current = curIdx;
            setObservations((prev) => {
              if (!prev || prev.length === 0) {
                return [obsItem];
              }
              const lastItem = prev[prev.length - 1];
              const lastIdx = lastItem ? (lastItem.dwellIndex || lastItem.id) : 0;

              // 1. Strict monotonic sequential step: next dwell in order
              if (curIdx === lastIdx + 1) {
                return [...prev, obsItem];
              }

              // 2. Full replay / restart from dwell 1
              if (curIdx === 1) {
                return [obsItem];
              }

              // 3. Duplicate check: if this exact dwell is already in list, update it in place
              const existingIndex = prev.findIndex((item) => (item.dwellIndex || item.id) === curIdx);
              if (existingIndex !== -1) {
                const updated = [...prev];
                updated[existingIndex] = obsItem;
                return updated;
              }

              // 4. If incoming dwell index is <= lastIdx (time went backwards or restarted partway):
              // truncate any orphaned future dwells and append cleanly
              if (curIdx <= lastIdx) {
                const truncated = prev.filter((item) => (item.dwellIndex || item.id) < curIdx);
                return [...truncated, obsItem];
              }

              // 5. Gap / jump forward: append cleanly
              return [...prev, obsItem];
            });
          }
          if (snapshot.dwellIndex) {
            latestDwellIndexRef.current = snapshot.dwellIndex;
            setScrubberTimeMs(Number((snapshot.dwellIndex * DWELL_DURATION_MS).toFixed(1)));
          }
        }
      },
      {
        mode: isSlowReplay ? 'slow' : 'batch',
        batchSize: 20,
        intervalMs: isSlowReplay ? 750 : 250,
        startIndex: streamStartIndex,
        getStartIndex: () => latestDwellIndexRef.current || streamStartIndex || 0,
        autoStart: isScanning,
      }
    );

    return () => {
      unsubscribe();
    };
  }, [isWsSessionActive, isSlowReplay, streamStartIndex, totalDwells]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 4000);
  };

  const handleDatasetUpload = async (file) => {
    try {
      showToast(`Uploading dataset ${file.name} to cognitive backend...`);
      const uploadRes = await uploadDataset(file);
      const datasetInfo = uploadRes.dataset || uploadRes || {};

      setLoadedDataset({
        name: file.name,
        ...datasetInfo,
      });
      if (datasetInfo.total_dwells) {
        setTotalDwells(datasetInfo.total_dwells);
      }
      const cfg = await fetchConfig();
      if (cfg) setRlConfig(cfg);

      setObservations([]);
      completedLiveStateRef.current = null;
      hasLiveCompletedRef.current = false;
      setIsSimulationComplete(false);
      setIsSlowReplay(false);
      latestDwellIndexRef.current = 0;
      setStreamStartIndex(0);
      setScrubberTimeMs(0.5);
      setRealTimeSeconds(0);
      setIsScanning(true);
      showToast(`Dataset loaded: ${file.name}. Starting cognitive RF scan scheduler...`);
    } catch (err) {
      console.error('Failed to upload dataset:', err);
      showToast(`Failed to upload dataset: ${err.message || err}`);
    }
  };

  const handleTogglePause = () => {
    if (!loadedDataset) {
      showToast('Please upload a dataset (.h5) from the top-right header to start scanning.');
      return;
    }
    if (!isSlowReplay) {
      return; // Pausing dataset is disabled in live mode
    }
    const nextState = !isScanning;
    setIsScanning(nextState);
    const curDwell = latestDwellIndexRef.current || Math.round(scrubberTimeMs / DWELL_DURATION_MS) || 0;
    const sent = sendTelemetryCommand({
      command: nextState ? 'resume' : 'pause',
      dwell_index: curDwell,
    });
    if (!sent && nextState) {
      setStreamStartIndex(curDwell);
    }
    showToast(nextState ? 'Simulation resumed.' : 'Simulation paused.');
  };

  const handleReplaySimulation = () => {
    setObservations([]);
    setIsSimulationComplete(false);
    latestDwellIndexRef.current = 0;
    setStreamStartIndex(0);
    setScrubberTimeMs(0.5);
    setRealTimeSeconds(0);
    setIsScanning(true);
    sendTelemetryCommand({ command: 'replay' });
    showToast(isSlowReplay ? 'Replaying slow scan from 0.0 ms...' : 'Replaying from 0.0 ms...');
  };

  const handleSwitchToSlowReplay = () => {
    setIsSlowReplay(true);
    setObservations([]);
    setIsSimulationComplete(false);
    latestDwellIndexRef.current = 0;
    setStreamStartIndex(0);
    setScrubberTimeMs(0.5);
    setRealTimeSeconds(0);
    setIsScanning(true);
    sendTelemetryCommand({ command: 'set_mode', mode: 'slow' });
    sendTelemetryCommand({ command: 'set_interval', interval_ms: 750 });
    sendTelemetryCommand({ command: 'replay' });
    showToast('Starting slow replay with circular radar scans...');
  };

  const handleSwitchToHighSpeed = async () => {
    // Pause/stop slow replay stream on backend
    sendTelemetryCommand({ command: 'pause' });
    sendTelemetryCommand({ command: 'set_mode', mode: 'batch' });
    sendTelemetryCommand({ command: 'set_interval', interval_ms: 250 });

    setIsSlowReplay(false);
    setIsScanning(false);
    setIsSimulationComplete(true);

    if (completedLiveStateRef.current) {
      const cached = completedLiveStateRef.current;
      if (cached.observations && cached.observations.length > 0) {
        setObservations(cached.observations);
      }
      if (cached.mlMetrics) setMlMetrics(cached.mlMetrics);
      if (cached.openLoopMetrics) setOpenLoopMetrics(cached.openLoopMetrics);
      if (cached.mlCurrentBand) setMlCurrentBand(cached.mlCurrentBand);
      if (cached.mlInterceptedFreq) setMlInterceptedFreq(cached.mlInterceptedFreq);
      if (cached.openLoopCurrentBand) setOpenLoopCurrentBand(cached.openLoopCurrentBand);
      if (cached.openLoopInterceptedFreq) setOpenLoopInterceptedFreq(cached.openLoopInterceptedFreq);
      if (cached.actualEmissionBand) setActualEmissionBand(cached.actualEmissionBand);
      if (cached.actualEmissionBands) setActualEmissionBands(cached.actualEmissionBands);
      if (cached.emissionFrequency) setEmissionFrequency(cached.emissionFrequency);
      setScrubberTimeMs(cached.scrubberTimeMs || Number((totalDwells * DWELL_DURATION_MS).toFixed(1)));
    } else {
      const finalTime = Number((totalDwells * DWELL_DURATION_MS).toFixed(1));
      setScrubberTimeMs(finalTime);
      try {
        const fromDwell = Math.max(1, totalDwells - 20);
        const historyData = await fetchDwellHistory(fromDwell, totalDwells);
        if (historyData && historyData.dwells && historyData.dwells.length > 0) {
          const finalObs = historyData.dwells.map(dwellToObservation).filter(Boolean);
          setObservations(finalObs);
          const lastDwell = historyData.dwells[historyData.dwells.length - 1];
          if (lastDwell) {
            if (lastDwell.adaptive) {
              setMlCurrentBand(lastDwell.adaptive.currentBand);
              setMlInterceptedFreq(lastDwell.adaptive.interceptedFrequency);
              if (lastDwell.adaptive.metrics) setMlMetrics(lastDwell.adaptive.metrics);
            }
            if (lastDwell.openLoop) {
              setOpenLoopCurrentBand(lastDwell.openLoop.currentBand);
              setOpenLoopInterceptedFreq(lastDwell.openLoop.interceptedFrequency);
              if (lastDwell.openLoop.metrics) setOpenLoopMetrics(lastDwell.openLoop.metrics);
            }
            if (lastDwell.environment) {
              setActualEmissionBand(lastDwell.environment.actualEmissionBand);
              setActualEmissionBands(lastDwell.environment.actualEmissionBands || []);
              setEmissionFrequency(lastDwell.environment.emissionFrequency);
            }
          }
        }
      } catch (err) {
        console.warn('Could not restore final dwell history on switch to live:', err);
      }
    }

    showToast('Switched to completed live mode view.');
  };

  // Dragging or clicking timeline jumps exactly to that timestamp and starts playing from there
  const handleScrubberChange = async (timeVal) => {
    const val = parseFloat(timeVal);
    setScrubberTimeMs(val);
    const targetDwell = Math.max(1, Math.min(totalDwells, Math.round(val / DWELL_DURATION_MS)));

    try {
      const fromDwell = Math.max(1, targetDwell - 60);
      const historyData = await fetchDwellHistory(fromDwell, targetDwell);
      if (historyData && historyData.dwells) {
        const historicalObservations = historyData.dwells.map(dwellToObservation).filter(Boolean);
        setObservations(historicalObservations);

        const dwell = historyData.dwells[historyData.dwells.length - 1];
        if (dwell) {
          if (dwell.adaptive) {
            setMlCurrentBand(dwell.adaptive.currentBand);
            setMlInterceptedFreq(dwell.adaptive.interceptedFrequency);
            if (dwell.adaptive.metrics) setMlMetrics(dwell.adaptive.metrics);
          }
          if (dwell.openLoop) {
            setOpenLoopCurrentBand(dwell.openLoop.currentBand);
            setOpenLoopInterceptedFreq(dwell.openLoop.interceptedFrequency);
            if (dwell.openLoop.metrics) setOpenLoopMetrics(dwell.openLoop.metrics);
          }
          if (dwell.environment) {
            setActualEmissionBand(dwell.environment.actualEmissionBand);
            setActualEmissionBands(
              dwell.environment.actualEmissionBands ||
                (dwell.environment.actualEmissionBand ? [dwell.environment.actualEmissionBand] : [])
            );
            setEmissionFrequency(dwell.environment.emissionFrequency);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch historical dwells on scrub:', err);
    }

    sendTelemetryCommand({ command: 'scrub', dwell_index: targetDwell });

    if (targetDwell >= totalDwells) {
      setIsSimulationComplete(true);
      setIsScanning(false);
    } else {
      setIsSimulationComplete(false);
    }

    latestDwellIndexRef.current = targetDwell;
    setStreamStartIndex(targetDwell);
  };

  // Called when user scrolls backwards in graph or table to dynamically expand the local observation cache from backend
  const handleLoadEarlierDwells = async (count = 20) => {
    const currentObs = observationsRef.current && observationsRef.current.length > 0
      ? observationsRef.current
      : observations;
    if (!currentObs || currentObs.length === 0) return { addedCount: 0, observations: currentObs };
    const earliestDwellIndex = currentObs[0]?.dwellIndex || 1;
    if (earliestDwellIndex <= 1) return { addedCount: 0, observations: currentObs }; // Already reached the very start

    const fromDwell = Math.max(1, earliestDwellIndex - count);
    const toDwell = earliestDwellIndex - 1;
    try {
      const historyData = await fetchDwellHistory(fromDwell, toDwell);
      if (historyData && historyData.dwells && historyData.dwells.length > 0) {
        const earlierObs = historyData.dwells.map(dwellToObservation).filter(Boolean);
        const updated = [...earlierObs, ...currentObs];
        observationsRef.current = updated;
        setObservations(updated);
        return { addedCount: earlierObs.length, observations: updated };
      }
    } catch (err) {
      console.error('Failed to load earlier dwells:', err);
    }
    return { addedCount: 0, observations: currentObs };
  };

  const handleClearSimulation = async () => {
    try {
      await resetSimulation();
    } catch (e) {
      console.warn('Reset error:', e);
    }
    sendTelemetryCommand({ command: 'reset' });
    setLoadedDataset(null);
    setIsScanning(false);
    setIsSimulationComplete(false);
    setIsSlowReplay(false);
    completedLiveStateRef.current = null;
    hasLiveCompletedRef.current = false;
    latestDwellIndexRef.current = 0;
    setStreamStartIndex(0);
    setScrubberTimeMs(0.5);
    setObservations([]);
    setRealTimeSeconds(0);
    setMlCurrentBand(null);
    setOpenLoopCurrentBand(null);
    setActualEmissionBand(null);
    setActualEmissionBands([]);
    setEmissionFrequency(null);
    setMlInterceptedFreq(null);
    setOpenLoopInterceptedFreq(null);
    setMlMetrics({
      interceptRate: '-',
      correctScanRate: '-',
      hitRate: '-',
      probDetection: '-',
      avgInterceptDelay: '-',
      avgReward: '-',
      meanRevisitInterval: '-',
      totalHits: '-',
      totalScanMisses: '-',
      totalActualEmissions: '-',
    });
    setOpenLoopMetrics({
      interceptRate: '-',
      correctScanRate: '-',
      hitRate: '-',
      probDetection: '-',
      avgInterceptDelay: '-',
      avgReward: '-',
      meanRevisitInterval: '-',
      totalHits: '-',
      totalScanMisses: '-',
      totalActualEmissions: '-',
    });
    if (viewMode === 'environment') {
      setViewMode('receiver');
    }
    showToast('Simulation removed. Dataset unloaded.');
  };

  return (
    <div className="bg-[#F8FAFC] font-body-md text-on-surface antialiased min-h-screen flex flex-col selection:bg-primary/20 selection:text-primary">
      {/* Top Header with Indian Flag Background, Saffron, White, Ashoka Chakra, and Green */}
      <Header
        viewMode={viewMode}
        setViewMode={setViewMode}
        onDatasetUpload={handleDatasetUpload}
        loadedDataset={loadedDataset}
        isScanning={isScanning}
      />

      {/* Main Content Area */}
      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex-1 flex flex-col gap-8">
        {/* Simulation Control & Dataset Bar */}
        {!loadedDataset ? (
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.03)] self-start text-[13px] font-medium text-slate-600 select-none">
            <span className="material-symbols-outlined text-[18px] text-primary">info</span>
            <span>Upload a dataset <strong className="font-semibold text-slate-800">(.h5)</strong> from the header to begin simulation</span>
          </div>
        ) : (
          <div className="w-full flex flex-col gap-3 p-3.5 sm:p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs">
            {/* Top Row: Dataset Info and Action Buttons */}
            <div className="w-full flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {/* Dataset Badge */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200/90 text-slate-700 shadow-2xs">
                  <span className="material-symbols-outlined text-[16px] text-primary">
                    folder_open
                  </span>
                  <span className="font-label-sm text-[11px] uppercase text-slate-500 font-medium tracking-wide">
                    Dataset:
                  </span>
                  <span
                    className="font-mono text-[12px] font-semibold text-slate-900 truncate max-w-[150px] sm:max-w-xs"
                    title={loadedDataset.name}
                  >
                    {loadedDataset.name}
                  </span>
                </div>

                {/* Band Bins Configuration Pill */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200/90 text-slate-600 select-none shadow-2xs">
                  <span className="material-symbols-outlined text-[16px] text-primary">view_column</span>
                  <span className="font-label-sm text-[11px] uppercase text-slate-500 font-medium tracking-wide">
                    Band Bins:
                  </span>
                  <span className="font-mono text-[12px] font-semibold text-slate-800">
                    20 Channels (875 MHz)
                  </span>
                </div>

                {/* Live Real Time Stopwatch Pill (hidden in Slow Replay Mode) */}
                {!isSlowReplay && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200/90 text-slate-600 select-none shadow-2xs">
                    <span className={`material-symbols-outlined text-[16px] text-primary ${isScanning ? 'animate-pulse' : ''}`}>
                      timer
                    </span>
                    <span className="font-label-sm text-[11px] uppercase text-slate-500 font-medium tracking-wide">
                      Real Time:
                    </span>
                    <span className="font-mono text-[12px] font-semibold text-slate-800">
                      {realTimeSeconds.toFixed(1)}s
                    </span>
                  </div>
                )}

                {/* RF Simulation Time Window Pill */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200/90 text-slate-600 select-none shadow-2xs">
                  <span className="material-symbols-outlined text-[16px] text-primary">schedule</span>
                  <span className="font-label-sm text-[11px] uppercase text-slate-500 font-medium tracking-wide">
                    RF Sim:
                  </span>
                  <span className="font-mono text-[12px] font-semibold text-slate-800">
                    {scrubberTimeMs.toFixed(1)} ms
                  </span>
                </div>
              </div>

              {/* Action Buttons: Play/Pause/Replay, Slow Replay, Remove */}
              <div className="flex flex-wrap items-center gap-2">
                {/* When in live mode: pause is disabled; show Slow Replay once simulation completes */}
                {!isSlowReplay && isSimulationComplete && (
                  <button
                    onClick={handleSwitchToSlowReplay}
                    type="button"
                    className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-label-md text-[12px] sm:text-[13px] font-medium bg-white hover:bg-primary/5 text-primary border border-slate-200 hover:border-primary/40 transition-colors select-none cursor-pointer shadow-2xs"
                    title="Replay decision-by-decision at a slower speed with circular radar scans"
                  >
                    <span className="material-symbols-outlined text-[16px] text-primary anim-slow-motion-hover">slow_motion_video</span>
                    <span>Slow Replay</span>
                  </button>
                )}

                {/* When in slower speed mode */}
                {isSlowReplay && (
                  <>
                    {isSimulationComplete ? (
                      <button
                        onClick={handleReplaySimulation}
                        type="button"
                        className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-label-md text-[12px] sm:text-[13px] font-medium bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200 hover:border-slate-300 transition-colors select-none cursor-pointer shadow-2xs"
                        title="Replay from 0.0 ms"
                      >
                        <span className="material-symbols-outlined text-[15px] text-slate-600 anim-replay-hover">replay</span>
                        <span>Replay</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleTogglePause}
                        type="button"
                        className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-label-md text-[12px] sm:text-[13px] font-medium transition-colors select-none cursor-pointer shadow-2xs ${
                          isScanning
                            ? 'bg-slate-50 hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-200 hover:border-amber-300'
                            : 'bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200 hover:border-emerald-300'
                        }`}
                        title={isScanning ? 'Pause the ongoing simulation' : 'Resume scanning simulation'}
                      >
                        <span className="material-symbols-outlined text-[15px] anim-play-pause-hover">
                          {isScanning ? 'pause' : 'play_arrow'}
                        </span>
                        <span>{isScanning ? 'Pause' : 'Resume'}</span>
                      </button>
                    )}

                    {/* Switch to High-Speed Mode Button */}
                    <button
                      onClick={handleSwitchToHighSpeed}
                      type="button"
                      className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-label-md text-[12px] sm:text-[13px] font-medium bg-white hover:bg-slate-50 text-slate-700 hover:text-primary border border-slate-200 hover:border-primary/30 transition-colors select-none cursor-pointer shadow-2xs"
                      title="Switch back to high-speed batch streaming mode"
                    >
                      <span className="material-symbols-outlined text-[16px] text-slate-500 group-hover:text-primary anim-bolt-hover transition-colors">bolt</span>
                      <span>Switch to Live Mode</span>
                    </button>
                  </>
                )}

                {/* Remove Dataset Button */}
                <button
                  onClick={handleClearSimulation}
                  type="button"
                  className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-label-md text-[12px] sm:text-[13px] font-medium text-slate-600 hover:text-rose-700 bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 transition-colors cursor-pointer select-none shadow-2xs"
                  title="Remove dataset and return to default state"
                  id="btn-remove-dataset"
                >
                  <span className="material-symbols-outlined text-[15px] anim-trash-hover">delete_outline</span>
                  <span>Remove Dataset</span>
                </button>
              </div>
            </div>

            {/* Bottom Row: Simulation Timeline Slider (Shown ONLY in slower speed mode) */}
            {isSlowReplay && (
              <div className="group/timeline w-full pt-3 border-t border-slate-100 flex flex-col gap-2 text-[12px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-slate-700 text-[12px] uppercase tracking-wide">
                    <span className="material-symbols-outlined text-[16px] text-primary anim-timeline-hover">timeline</span>
                    <span>Simulation Timeline</span>
                  </div>
                  <span className="font-mono text-[12px] font-semibold text-primary bg-primary/10 px-2.5 py-0.5 rounded-md border border-primary/20">
                    {scrubberTimeMs.toFixed(1)} ms / {(totalDwells * DWELL_DURATION_MS).toFixed(1)} ms
                  </span>
                </div>
                <div className="relative w-full flex items-center">
                  <input
                    type="range"
                    min="0.5"
                    max={(totalDwells * DWELL_DURATION_MS).toFixed(1)}
                    step="0.5"
                    value={scrubberTimeMs}
                    onChange={(e) => handleScrubberChange(e.target.value)}
                    style={{
                      background: `linear-gradient(to right, #006972 0%, #008996 ${Math.min(100, Math.max(0, (scrubberTimeMs / ((totalDwells * DWELL_DURATION_MS) || 1)) * 100)).toFixed(1)}%, #e2e8f0 ${Math.min(100, Math.max(0, (scrubberTimeMs / ((totalDwells * DWELL_DURATION_MS) || 1)) * 100)).toFixed(1)}%, #e2e8f0 100%)`
                    }}
                    className="timeline-slider w-full h-2 hover:h-2.5 bg-slate-200 rounded-lg appearance-none cursor-pointer focus:outline-hidden transition-all duration-200"
                    title="Drag slider to inspect timeline and play from that timestamp"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Circular Radar Scanners Side-by-Side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Scanner: Adaptive ML Scan */}
          <RadarScanner
            title="ADAPTIVE ML SCAN"
            type="adaptive"
            viewMode={viewMode}
            currentBand={mlCurrentBand}
            actualEmissionBand={actualEmissionBand}
            actualEmissionBands={actualEmissionBands}
            emissionFrequency={emissionFrequency}
            interceptedFrequency={mlInterceptedFreq}
            metrics={mlMetrics}
            isScanning={isScanning}
            isCompleted={isSimulationComplete}
            hasDataset={!!loadedDataset}
            showCircularScan={isSlowReplay}
          />

          {/* Right Scanner: Open Loop Scan */}
          <RadarScanner
            title="OPEN LOOP SCAN"
            type="open-loop"
            viewMode={viewMode}
            currentBand={openLoopCurrentBand}
            actualEmissionBand={actualEmissionBand}
            actualEmissionBands={actualEmissionBands}
            emissionFrequency={emissionFrequency}
            interceptedFrequency={openLoopInterceptedFreq}
            metrics={openLoopMetrics}
            isScanning={isScanning}
            isCompleted={isSimulationComplete}
            hasDataset={!!loadedDataset}
            showCircularScan={isSlowReplay}
          />
        </div>

        {/* Bottom Section: Observations Graph/Table & RL Parameters Accordion with Live Average Reward */}
        <div className="flex flex-col gap-8">
          {loadedDataset && (
            <ObservationsSection
              observations={observations}
              totalDwells={totalDwells}
              isScanning={isScanning}
              isCompleted={isSimulationComplete}
              isSlowReplay={isSlowReplay}
              hasDataset={!!loadedDataset}
              viewMode={viewMode}
              onExportNotify={showToast}
              onLoadEarlier={handleLoadEarlierDwells}
            />
          )}
          <RLParametersAccordion
            mlMetrics={mlMetrics}
            openLoopMetrics={openLoopMetrics}
            hasDataset={!!loadedDataset}
            config={rlConfig}
          />
        </div>
      </main>

      {/* Global Toast for Interactive Feedback */}
      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
