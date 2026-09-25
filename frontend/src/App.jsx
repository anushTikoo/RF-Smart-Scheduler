import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import RadarScanner, { BAND_CONFIG } from './components/RadarScanner';
import ObservationsSection from './components/ObservationsSection';
import RLParametersAccordion from './components/RLParametersAccordion';
import Toast from './components/Toast';
import { subscribeTelemetry } from './services/telemetryService';

export default function App() {
  // App states
  const [viewMode, setViewMode] = useState('receiver'); // 'receiver' | 'environment'
  const [isScanning, setIsScanning] = useState(false); // Does NOT start instantly; starts only after dataset upload
  const [isSimulationComplete, setIsSimulationComplete] = useState(false);
  const [loadedDataset, setLoadedDataset] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Dynamic observations stream for Adaptive ML Scan
  const [observations, setObservations] = useState([]);
  const timeUsRef = useRef(0);
  const obsIdRef = useRef(0);

  // Radar Scanner & Telemetry states (backend-connected / real-time streaming)
  const [telemetrySource, setTelemetrySource] = useState('initializing');
  const [mlCurrentBand, setMlCurrentBand] = useState(null);
  const [openLoopCurrentBand, setOpenLoopCurrentBand] = useState(null);
  const [actualEmissionBand, setActualEmissionBand] = useState(null);
  const [actualEmissionBands, setActualEmissionBands] = useState([]);
  const [emissionFrequency, setEmissionFrequency] = useState(null);
  const [mlInterceptedFreq, setMlInterceptedFreq] = useState(null);
  const [openLoopInterceptedFreq, setOpenLoopInterceptedFreq] = useState(null);

  // Simulation metrics for Receiver & Environment views (defaults to '-' before dataset upload)
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

  // Subscribe to live telemetry service (WebSocket / REST API with deterministic simulation fallback)
  useEffect(() => {
    if (!isScanning) return;

    const unsubscribe = subscribeTelemetry((snapshot) => {
      if (!snapshot) return;
      setTelemetrySource(snapshot.source || 'connected');

      // Check if simulation sequence finished
      if (snapshot.isComplete) {
        setIsScanning(false);
        setIsSimulationComplete(true);
        showToast(snapshot.completionMessage || 'Simulation completed! All 20 dwell windows (100 ms) processed across cognitive environment.');
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

        // Dynamically append dwell observation for Adaptive ML Scan (5 ms dwell window)
        const bandId = snapshot.adaptive.currentBand;
        if (bandId) {
          const bConf = (BAND_CONFIG && BAND_CONFIG.find(b => b.id === bandId)) || {
            id: bandId,
            center: `${(0.5 + bandId * 0.875).toFixed(2)} GHz`,
            range: `Band ${bandId}`,
          };
          const isHit = Boolean(snapshot.adaptive.isIntercepted);
          obsIdRef.current += 1;
          const startMs = (obsIdRef.current - 1) * 5;
          const endMs = startMs + 5;
          const timeWindow = `${startMs}–${endMs} ms`;
          const pulsesDetected = snapshot.adaptive.pulsesDetected !== undefined
            ? snapshot.adaptive.pulsesDetected
            : (isHit ? 3 : 0);
          const result = isHit ? 'HIT' : 'SCAN MISS';

          // Parse actual emission frequencies (support single and multiple simultaneous emissions)
          const envBands = snapshot.environment?.actualEmissionBands || (snapshot.environment?.actualEmissionBand ? [snapshot.environment.actualEmissionBand] : []);
          const emissionsList = snapshot.environment?.emissions || envBands.map((bId) => {
            const c = BAND_CONFIG.find(b => b.id === bId);
            return { bandId: bId, freq: c ? c.center : '', type: '', pulses: 3 };
          });
          const actualEmissionsData = emissionsList.map((e) => {
            const isDetected = e.bandId === bandId;
            return {
              bandId: e.bandId,
              freqStr: e.freq,
              freqGhz: parseFloat(e.freq) || (BAND_CONFIG.find(b => b.id === e.bandId) ? parseFloat(BAND_CONFIG.find(b => b.id === e.bandId).center) : null),
              type: e.type,
              pulses: e.pulses || 3,
              isDetected: isDetected,
              status: isDetected ? 'DETECTED' : `Missed (Receiver on Band ${bandId})`,
            };
          });

          let scanFreq = parseFloat(bConf.center);
          if (isHit && snapshot.adaptive.interceptedFrequency) {
            scanFreq = parseFloat(snapshot.adaptive.interceptedFrequency);
          }

          setObservations((prev) => {
            const newEntry = {
              id: obsIdRef.current,
              dwellIndex: obsIdRef.current,
              startMs,
              endMs,
              timeWindow,
              timestamp: timeWindow,
              band: `Band ${bandId}`,
              bandId: bandId,
              centerFreq: bConf.center,
              interceptedFreq: isHit ? (snapshot.adaptive.interceptedFrequency || bConf.center) : '-',
              exactFreq: isHit ? (snapshot.adaptive.interceptedFrequency || bConf.center) : bConf.center,
              range: bConf.range,
              freqGhz: scanFreq || (0.5 + bandId * 0.875),
              status: result,
              result: result,
              pulsesDetected: pulsesDetected,
              isIntercepted: isHit,
              actualBands: envBands,
              actualBand: envBands.length > 0 ? envBands[0] : null,
              actualEmissions: actualEmissionsData,
              actualFreqStr: snapshot.environment?.emissionFrequency || (actualEmissionsData.length > 0 ? actualEmissionsData.map(e => e.freqStr).join(', ') : '-'),
            };
            return [...prev, newEntry].slice(-60);
          });
        }
      }

      if (snapshot.openLoop) {
        setOpenLoopCurrentBand(snapshot.openLoop.currentBand);
        setOpenLoopInterceptedFreq(snapshot.openLoop.interceptedFrequency);
        if (snapshot.openLoop.metrics) {
          setOpenLoopMetrics(snapshot.openLoop.metrics);
        }
      }
    }, 1400);

    return () => {
      unsubscribe();
    };
  }, [isScanning]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 4000);
  };

  const handleDatasetUpload = (file) => {
    setLoadedDataset(file);
    setObservations([]);
    timeUsRef.current = 0;
    obsIdRef.current = 0;
    setIsSimulationComplete(false);
    setIsScanning(true); // Automatically starts running after uploading a dataset
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
    obsIdRef.current = 0;
    setIsSimulationComplete(false);
    setIsScanning(true);
    showToast('Replaying simulation from 0 ms...');
  };

  const handleClearSimulation = () => {
    setLoadedDataset(null);
    setIsScanning(false);
    setIsSimulationComplete(false);
    setObservations([]);
    timeUsRef.current = 0;
    obsIdRef.current = 0;
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
        {/* Simulation Control & Dataset Bar: Compact initially when no dataset loaded; controls only after upload */}
        {!loadedDataset ? (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white border border-slate-200 shadow-[0_2px_8px_rgba(0,0,0,0.03)] self-start text-[12px] font-medium text-slate-600 select-none">
            <span className="material-symbols-outlined text-[17px] text-primary">info</span>
            <span>Upload a dataset <strong className="font-semibold text-slate-800">(.h5)</strong> from the header to begin simulation</span>
          </div>
        ) : (
          <div className="w-full flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3 rounded-2xl bg-white border border-slate-200 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
            {/* Active Dataset Name & Simulation Controls */}
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3.5">
              {/* Dataset Badge */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/90 text-slate-700">
                <span className="material-symbols-outlined text-[18px] text-primary">
                  folder_open
                </span>
                <span className="font-label-sm text-[11px] uppercase text-slate-500 font-semibold tracking-wide">
                  Dataset:
                </span>
                <span
                  className="font-mono text-[12px] font-bold text-slate-900 truncate max-w-[200px] sm:max-w-xs"
                  title={loadedDataset.name}
                >
                  {loadedDataset.name}
                </span>
              </div>

              {/* Band Bins Configuration Pill */}
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200/90 text-slate-600 select-none">
                <span className="material-symbols-outlined text-[15px] text-primary">view_column</span>
                <span className="font-label-sm text-[10.5px] uppercase text-slate-500 font-semibold tracking-wide">
                  Band Bins:
                </span>
                <span className="font-mono text-[11px] font-bold text-slate-800">
                  20 Channels (875 MHz)
                </span>
              </div>

              {/* Pause / Resume OR Replay Simulation Button */}
              {isSimulationComplete ? (
                <button
                  onClick={handleReplaySimulation}
                  type="button"
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg font-label-md text-[11px] font-medium bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 transition-colors select-none cursor-pointer shadow-2xs"
                  title="Replay the 5 ms dwell simulation from the beginning"
                >
                  <span className="material-symbols-outlined text-[15px]">replay</span>
                  <span>Replay Simulation</span>
                </button>
              ) : (
                <button
                  onClick={handleTogglePause}
                  type="button"
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-label-md text-[11px] font-medium transition-colors select-none cursor-pointer ${
                    isScanning
                      ? 'bg-slate-50 hover:bg-amber-50 text-slate-700 hover:text-amber-800 border border-slate-200 hover:border-amber-300'
                      : 'bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200 hover:border-emerald-300'
                  }`}
                  title={isScanning ? 'Pause the ongoing simulation' : 'Resume scanning simulation'}
                >
                  <span className="material-symbols-outlined text-[15px]">
                    {isScanning ? 'pause' : 'play_arrow'}
                  </span>
                  <span>{isScanning ? 'Pause Simulation' : 'Resume Simulation'}</span>
                </button>
              )}

              {/* Simulation Complete Status Badge */}
              {isSimulationComplete && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-semibold select-none shadow-2xs">
                  <span className="material-symbols-outlined text-[15px] text-blue-600">task_alt</span>
                  <span>Simulation Complete (20 Dwells)</span>
                </div>
              )}

              {/* Remove Simulation Button (Renamed from Stop Simulation) */}
              <button
                onClick={handleClearSimulation}
                type="button"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg font-label-md text-[11px] font-medium text-slate-600 hover:text-rose-700 bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 transition-colors cursor-pointer select-none"
                title="Remove simulation, unload dataset, and return to default state"
              >
                <span className="material-symbols-outlined text-[14px]">delete_outline</span>
                <span>Remove Simulation</span>
              </button>
            </div>
          </div>
        )}

        {/* Circular Radar Scanners Side-by-Side (Each with its dedicated scanning badge & meaningful icon) */}
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
