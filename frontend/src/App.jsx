import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import RadarScanner, { BAND_CONFIG } from './components/RadarScanner';
import ObservationsSection from './components/ObservationsSection';
import RLParametersAccordion from './components/RLParametersAccordion';
import Toast from './components/Toast';
import {
  subscribeTelemetry,
  TOTAL_SIMULATION_DWELLS,
  DWELL_DURATION_MS,
  MOCK_120_DWELLS,
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
    pulsesDetected: adapt.pulsesDetected !== undefined ? adapt.pulsesDetected : (isHit ? 3 : 0),
    isIntercepted: isHit,
    actualBands: envBands,
    actualBand: envBands.length > 0 ? envBands[0] : null,
    actualEmissions: actualEmissionsData,
    actualFreqStr: env.emissionFrequency || (actualEmissionsData.length > 0 ? actualEmissionsData.map((e) => e.freqStr).join(', ') : '-'),
  };
}

export default function App() {
  // App states
  const [viewMode, setViewMode] = useState('receiver'); // 'receiver' | 'environment'
  const [isScanning, setIsScanning] = useState(false);
  const [isSimulationComplete, setIsSimulationComplete] = useState(false);
  const [loadedDataset, setLoadedDataset] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Speed and Replay mode states
  const [isSlowReplay, setIsSlowReplay] = useState(false); // false = High-Speed, true = Slower Replay
  const [streamStartIndex, setStreamStartIndex] = useState(0);
  const [scrubberTimeMs, setScrubberTimeMs] = useState(0.5);

  // Dynamic observations stream for Adaptive ML Scan
  const [observations, setObservations] = useState([]);

  // Radar Scanner & Telemetry states
  const [telemetrySource, setTelemetrySource] = useState('initializing');
  const [mlCurrentBand, setMlCurrentBand] = useState(null);
  const [openLoopCurrentBand, setOpenLoopCurrentBand] = useState(null);
  const [actualEmissionBand, setActualEmissionBand] = useState(null);
  const [actualEmissionBands, setActualEmissionBands] = useState([]);
  const [emissionFrequency, setEmissionFrequency] = useState(null);
  const [mlInterceptedFreq, setMlInterceptedFreq] = useState(null);
  const [openLoopInterceptedFreq, setOpenLoopInterceptedFreq] = useState(null);

  // Simulation metrics
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

  // Subscribe to live telemetry service
  useEffect(() => {
    if (!isScanning) return;

    const unsubscribe = subscribeTelemetry(
      (snapshot) => {
        if (!snapshot) return;
        setTelemetrySource(snapshot.source || 'connected');

        if (snapshot.isComplete) {
          setIsScanning(false);
          setIsSimulationComplete(true);
          showToast(
            snapshot.completionMessage ||
              `Simulation completed! All ${TOTAL_SIMULATION_DWELLS} dwell windows (${(TOTAL_SIMULATION_DWELLS * DWELL_DURATION_MS).toFixed(1)} ms) processed.`
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

        // High-Speed Mode: Populates chunks of 20 dwells all at once
        if (snapshot.mode === 'batch' && snapshot.batch) {
          const newEntries = snapshot.batch.map(dwellToObservation).filter(Boolean);
          setObservations((prev) => [...prev, ...newEntries]);
          const latestIdx = snapshot.batchEndIndex || (snapshot.batch[snapshot.batch.length - 1]?.dwellIndex);
          if (latestIdx) {
            setScrubberTimeMs(Number((latestIdx * DWELL_DURATION_MS).toFixed(1)));
          }
        } else if (snapshot.mode === 'slow' && snapshot.singleDwell) {
          // Slow Mode: Populates 1 dwell at a time for live decision-by-decision circular radar sweep
          const obsItem = dwellToObservation(snapshot.singleDwell);
          if (obsItem) {
            setObservations((prev) => [...prev, obsItem]);
          }
          if (snapshot.dwellIndex) {
            setScrubberTimeMs(Number((snapshot.dwellIndex * DWELL_DURATION_MS).toFixed(1)));
          }
        }
      },
      {
        mode: isSlowReplay ? 'slow' : 'batch',
        batchSize: 20,
        intervalMs: isSlowReplay ? 750 : 1200,
        startIndex: streamStartIndex,
      }
    );

    return () => {
      unsubscribe();
    };
  }, [isScanning, isSlowReplay, streamStartIndex]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 4000);
  };

  const handleDatasetUpload = (file) => {
    setLoadedDataset(file);
    setObservations([]);
    setIsSimulationComplete(false);
    setIsSlowReplay(false);
    setStreamStartIndex(0);
    setScrubberTimeMs(0.5);
    setIsScanning(true);
    showToast(`Dataset loaded: ${file.name}. Starting cognitive RF scan scheduler...`);
  };

  const handleTogglePause = () => {
    if (!loadedDataset) {
      showToast('Please upload a dataset (.h5) from the top-right header to start scanning.');
      return;
    }
    const nextState = !isScanning;
    setIsScanning(nextState);
    showToast(nextState ? 'Simulation resumed.' : 'Simulation paused.');
  };

  const handleReplaySimulation = () => {
    setObservations([]);
    setIsSimulationComplete(false);
    setStreamStartIndex(0);
    setScrubberTimeMs(0.5);
    setIsScanning(true);
    showToast(isSlowReplay ? 'Replaying slow scan from 0.0 ms...' : 'Replaying from 0.0 ms...');
  };

  const handleSwitchToSlowReplay = () => {
    setIsSlowReplay(true);
    setObservations([]);
    setIsSimulationComplete(false);
    setStreamStartIndex(0);
    setScrubberTimeMs(0.5);
    setIsScanning(true);
    showToast('Starting slow replay with circular radar scans...');
  };

  const handleSwitchToHighSpeed = () => {
    setIsSlowReplay(false);
    showToast('Switched to live mode view.');
  };

  // Dragging or clicking timeline jumps exactly to that timestamp and starts playing from there
  const handleScrubberChange = (timeVal) => {
    const val = parseFloat(timeVal);
    setScrubberTimeMs(val);
    const targetDwell = Math.max(1, Math.min(TOTAL_SIMULATION_DWELLS, Math.round(val / DWELL_DURATION_MS)));

    // Immediately reconstruct observations up to this timestamp
    const historicalObservations = MOCK_120_DWELLS.slice(0, targetDwell).map(dwellToObservation);
    setObservations(historicalObservations);

    // Update active radar and metrics display
    const dwell = MOCK_120_DWELLS[targetDwell - 1];
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
        setActualEmissionBands(dwell.environment.actualEmissionBands || [dwell.environment.actualEmissionBand]);
        setEmissionFrequency(dwell.environment.emissionFrequency);
      }
    }

    if (targetDwell >= TOTAL_SIMULATION_DWELLS) {
      setIsSimulationComplete(true);
      setIsScanning(false);
    } else {
      setIsSimulationComplete(false);
    }

    // Set stream start index so live stream plays forward from this point
    setStreamStartIndex(targetDwell);
  };

  const handleClearSimulation = () => {
    setLoadedDataset(null);
    setIsScanning(false);
    setIsSimulationComplete(false);
    setIsSlowReplay(false);
    setStreamStartIndex(0);
    setScrubberTimeMs(0.5);
    setObservations([]);
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
      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 flex flex-col gap-5">
        {/* Simulation Control & Dataset Bar */}
        {!loadedDataset ? (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.03)] self-start text-[12px] font-medium text-slate-600 select-none">
            <span className="material-symbols-outlined text-[17px] text-primary">info</span>
            <span>Upload a dataset <strong className="font-semibold text-slate-800">(.h5)</strong> from the header to begin simulation</span>
          </div>
        ) : (
          <div className="w-full flex flex-col gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 shadow-2xs">
            {/* Top Row: Dataset Info and Action Buttons */}
            <div className="w-full flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {/* Dataset Badge */}
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200/90 text-slate-700 shadow-2xs">
                  <span className="material-symbols-outlined text-[14px] text-primary">
                    folder_open
                  </span>
                  <span className="font-label-sm text-[9.5px] uppercase text-slate-500 font-semibold tracking-wide">
                    Dataset:
                  </span>
                  <span
                    className="font-mono text-[10.5px] font-bold text-slate-900 truncate max-w-[150px] sm:max-w-xs"
                    title={loadedDataset.name}
                  >
                    {loadedDataset.name}
                  </span>
                </div>

                {/* Band Bins Configuration Pill */}
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-50 border border-slate-200/90 text-slate-600 select-none shadow-2xs">
                  <span className="material-symbols-outlined text-[12px] text-primary">view_column</span>
                  <span className="font-label-sm text-[9.5px] uppercase text-slate-500 font-semibold tracking-wide">
                    Band Bins:
                  </span>
                  <span className="font-mono text-[10px] font-bold text-slate-800">
                    20 Channels (875 MHz)
                  </span>
                </div>
              </div>

              {/* Action Buttons: Play/Pause/Replay, Slow Replay, Remove (Micro compact size) */}
              <div className="flex flex-wrap items-center gap-1">
                {/* When in high-speed mode */}
                {!isSlowReplay && (
                  <>
                    {/* While running / paused before complete */}
                    {!isSimulationComplete ? (
                      <button
                        onClick={handleTogglePause}
                        type="button"
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md font-label-md text-[9.5px] font-medium transition-colors select-none cursor-pointer shadow-2xs ${
                          isScanning
                            ? 'bg-slate-50 hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-200 hover:border-amber-300'
                            : 'bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200 hover:border-emerald-300'
                        }`}
                        title={isScanning ? 'Pause the ongoing simulation' : 'Resume scanning simulation'}
                      >
                        <span className="material-symbols-outlined text-[12px]">
                          {isScanning ? 'pause' : 'play_arrow'}
                        </span>
                        <span>{isScanning ? 'Pause' : 'Resume'}</span>
                      </button>
                    ) : (
                      <>
                        {/* Simulation Completed: Replay button */}
                        <button
                          onClick={handleReplaySimulation}
                          type="button"
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md font-label-md text-[9.5px] font-medium bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 transition-colors select-none cursor-pointer shadow-2xs"
                          title="Replay from 0.0 ms"
                        >
                          <span className="material-symbols-outlined text-[12px]">replay</span>
                          <span>Replay</span>
                        </button>

                        {/* Slow Replay button: Visible ONLY after actual mode has completed */}
                        <button
                          onClick={handleSwitchToSlowReplay}
                          type="button"
                          className="flex items-center gap-1 px-2 py-0.5 rounded-md font-label-md text-[9.5px] font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 hover:border-indigo-300 transition-colors select-none cursor-pointer shadow-2xs"
                          title="Replay decision-by-decision at a slower speed with circular radar scans"
                        >
                          <span className="material-symbols-outlined text-[13px] text-indigo-600">slow_motion_video</span>
                          <span>Slow Replay</span>
                        </button>
                      </>
                    )}
                  </>
                )}

                {/* When in slower speed mode */}
                {isSlowReplay && (
                  <>
                    {isSimulationComplete ? (
                      <button
                        onClick={handleReplaySimulation}
                        type="button"
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md font-label-md text-[9.5px] font-medium bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 transition-colors select-none cursor-pointer shadow-2xs"
                        title="Replay from 0.0 ms"
                      >
                        <span className="material-symbols-outlined text-[12px]">replay</span>
                        <span>Replay</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleTogglePause}
                        type="button"
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md font-label-md text-[9.5px] font-medium transition-colors select-none cursor-pointer shadow-2xs ${
                          isScanning
                            ? 'bg-slate-50 hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-200 hover:border-amber-300'
                            : 'bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200 hover:border-emerald-300'
                        }`}
                        title={isScanning ? 'Pause the ongoing simulation' : 'Resume scanning simulation'}
                      >
                        <span className="material-symbols-outlined text-[12px]">
                          {isScanning ? 'pause' : 'play_arrow'}
                        </span>
                        <span>{isScanning ? 'Pause' : 'Resume'}</span>
                      </button>
                    )}

                    {/* Switch to High-Speed Mode Button */}
                    <button
                      onClick={handleSwitchToHighSpeed}
                      type="button"
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md font-label-md text-[9.5px] font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 hover:border-emerald-400 transition-colors select-none cursor-pointer shadow-2xs"
                      title="Switch back to high-speed batch streaming mode"
                    >
                      <span className="material-symbols-outlined text-[13px] text-emerald-600">bolt</span>
                      <span>Switch to Live Mode</span>
                    </button>
                  </>
                )}

                {/* Remove Simulation Button */}
                <button
                  onClick={handleClearSimulation}
                  type="button"
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md font-label-md text-[9.5px] font-medium text-slate-600 hover:text-rose-700 bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 transition-colors cursor-pointer select-none shadow-2xs"
                  title="Remove simulation, unload dataset, and return to default state"
                >
                  <span className="material-symbols-outlined text-[12px]">delete_outline</span>
                  <span>Remove Simulation</span>
                </button>
              </div>
            </div>

            {/* Bottom Row: Simulation Timeline Slider (Shown ONLY in slower speed mode) */}
            {isSlowReplay && (
              <div className="w-full pt-2.5 border-t border-slate-100 flex flex-col gap-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-700 text-[11px] uppercase tracking-wide">
                    <span className="material-symbols-outlined text-[15px] text-primary">timeline</span>
                    <span>Simulation Timeline</span>
                  </div>
                  <span className="font-mono text-[11.5px] font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-md border border-primary/20">
                    {scrubberTimeMs.toFixed(1)} ms / {(TOTAL_SIMULATION_DWELLS * DWELL_DURATION_MS).toFixed(1)} ms
                  </span>
                </div>
                <div className="relative w-full flex items-center">
                  <input
                    type="range"
                    min="0.5"
                    max={(TOTAL_SIMULATION_DWELLS * DWELL_DURATION_MS).toFixed(1)}
                    step="0.5"
                    value={scrubberTimeMs}
                    onChange={(e) => handleScrubberChange(e.target.value)}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary focus:outline-hidden"
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
        <div className="flex flex-col gap-6">
          {loadedDataset && (
            <ObservationsSection
              observations={observations}
              isScanning={isScanning}
              hasDataset={!!loadedDataset}
              viewMode={viewMode}
              onExportNotify={showToast}
            />
          )}
          <RLParametersAccordion
            avgReward={mlMetrics.avgReward || '+0.74'}
            hasDataset={!!loadedDataset}
          />
        </div>
      </main>

      {/* Global Toast for Interactive Feedback */}
      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
