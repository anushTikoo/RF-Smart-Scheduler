import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import RadarScanner from './components/RadarScanner';
import ObservationsSection from './components/ObservationsSection';
import RLParametersAccordion from './components/RLParametersAccordion';
import Toast from './components/Toast';
import { subscribeTelemetry } from './services/telemetryService';

export default function App() {
  // App states
  const [viewMode, setViewMode] = useState('receiver'); // 'receiver' | 'environment'
  const [isScanning, setIsScanning] = useState(false); // Does NOT start instantly; starts only after dataset upload
  const [loadedDataset, setLoadedDataset] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Radar Scanner & Telemetry states (backend-connected / real-time streaming)
  const [telemetrySource, setTelemetrySource] = useState('initializing');
  const [mlCurrentBand, setMlCurrentBand] = useState(null);
  const [openLoopCurrentBand, setOpenLoopCurrentBand] = useState(null);
  const [actualEmissionBand, setActualEmissionBand] = useState(null);
  const [emissionFrequency, setEmissionFrequency] = useState(null);
  const [mlInterceptedFreq, setMlInterceptedFreq] = useState(null);
  const [openLoopInterceptedFreq, setOpenLoopInterceptedFreq] = useState(null);

  // Simulation metrics for Receiver & Environment views (defaults to '-' before dataset upload)
  const [mlMetrics, setMlMetrics] = useState({
    interceptRate: '-',
    hitRate: '-',
    probDetection: '-',
    avgInterceptDelay: '-',
    totalHits: '-',
    totalMisses: '-',
    totalActualEmissions: '-',
  });

  const [openLoopMetrics, setOpenLoopMetrics] = useState({
    interceptRate: '-',
    hitRate: '-',
    probDetection: '-',
    avgInterceptDelay: '-',
    totalHits: '-',
    totalMisses: '-',
    totalActualEmissions: '-',
  });

  // Subscribe to live telemetry service (WebSocket / REST API with deterministic simulation fallback)
  useEffect(() => {
    if (!isScanning) return;

    const unsubscribe = subscribeTelemetry((snapshot) => {
      if (!snapshot) return;
      setTelemetrySource(snapshot.source || 'connected');

      if (snapshot.environment) {
        setActualEmissionBand(snapshot.environment.actualEmissionBand);
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

  const handleClearSimulation = () => {
    setLoadedDataset(null);
    setIsScanning(false);
    setMlCurrentBand(null);
    setOpenLoopCurrentBand(null);
    setActualEmissionBand(null);
    setEmissionFrequency(null);
    setMlInterceptedFreq(null);
    setOpenLoopInterceptedFreq(null);
    setMlMetrics({
      interceptRate: '-',
      hitRate: '-',
      probDetection: '-',
      avgInterceptDelay: '-',
      totalHits: '-',
      totalMisses: '-',
      totalActualEmissions: '-',
    });
    setOpenLoopMetrics({
      interceptRate: '-',
      hitRate: '-',
      probDetection: '-',
      avgInterceptDelay: '-',
      totalHits: '-',
      totalMisses: '-',
      totalActualEmissions: '-',
    });
    if (viewMode === 'environment') {
      setViewMode('receiver');
    }
    showToast('Simulation cleared. Dataset unloaded.');
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

              {/* Pause / Resume Simulation Button */}
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

              {/* Stop / Clear Simulation Button */}
              <button
                onClick={handleClearSimulation}
                type="button"
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg font-label-md text-[11px] font-medium text-slate-600 hover:text-rose-700 bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 transition-colors cursor-pointer select-none"
                title="Stop simulation, unload dataset, and return to default state"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
                <span>Stop Simulation</span>
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
            emissionFrequency={emissionFrequency}
            interceptedFrequency={mlInterceptedFreq}
            metrics={mlMetrics}
            isScanning={isScanning}
            hasDataset={!!loadedDataset}
          />

          {/* Right Scanner: Open Loop Scan */}
          <RadarScanner
            title="OPEN LOOP SCAN"
            type="open-loop"
            viewMode={viewMode}
            currentBand={openLoopCurrentBand}
            actualEmissionBand={actualEmissionBand}
            emissionFrequency={emissionFrequency}
            interceptedFrequency={openLoopInterceptedFreq}
            metrics={openLoopMetrics}
            isScanning={isScanning}
            hasDataset={!!loadedDataset}
          />
        </div>

        {/* Bottom Section: Observations Graph/Table (Hidden until dataset is uploaded) & RL Parameters Accordion */}
        <div className="flex flex-col gap-6">
          {loadedDataset && <ObservationsSection onExportNotify={showToast} />}
          <RLParametersAccordion />
        </div>
      </main>

      {/* Global Toast for Interactive Feedback */}
      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
