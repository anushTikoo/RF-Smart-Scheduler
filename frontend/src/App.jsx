import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import RadarScanner from './components/RadarScanner';
import ObservationsSection from './components/ObservationsSection';
import RLParametersAccordion from './components/RLParametersAccordion';
import Toast from './components/Toast';

export default function App() {
  // App states
  const [viewMode, setViewMode] = useState('receiver'); // 'receiver' | 'environment'
  const [isScanning, setIsScanning] = useState(true);
  const [isReplaying, setIsReplaying] = useState(false);
  const [loadedDataset, setLoadedDataset] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Radar Scanner states
  const [mlCurrentBand, setMlCurrentBand] = useState(7);
  const [openLoopCurrentBand, setOpenLoopCurrentBand] = useState(4);

  // Simulation metrics
  const [mlMetrics, setMlMetrics] = useState({
    hitRate: '61.7%',
    interceptPerSec: '0.72 /s',
    totalHits: 432,
    totalMisses: 268,
    avgDelay: '0.48s'
  });

  const [openLoopMetrics, setOpenLoopMetrics] = useState({
    hitRate: '24.3%',
    interceptLag: '1.82 s',
    totalHits: 168,
    totalMisses: 532,
    avgDelay: '1.82 s'
  });

  // Replay mode animation loop
  useEffect(() => {
    let interval = null;
    if (isReplaying) {
      const mlSequence = [7, 7, 9, 2, 7, 4, 6, 8, 7, 3];
      let step = 0;

      interval = setInterval(() => {
        step = (step + 1) % mlSequence.length;
        setMlCurrentBand(mlSequence[step]);
        setOpenLoopCurrentBand((prev) => (prev % 10) + 1);

        setMlMetrics((prev) => ({
          ...prev,
          totalHits: prev.totalHits + 1,
          hitRate: `${(61.0 + Math.random() * 1.5).toFixed(1)}%`
        }));

        setOpenLoopMetrics((prev) => ({
          ...prev,
          totalMisses: prev.totalMisses + 1,
          hitRate: `${(24.0 + Math.random() * 0.8).toFixed(1)}%`
        }));
      }, 1200);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isReplaying]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 4000);
  };

  const handleDatasetUpload = (file) => {
    setLoadedDataset(file);
    showToast(`Dataset loaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  };

  const handleReplayToggle = () => {
    const nextState = !isReplaying;
    setIsReplaying(nextState);
    if (nextState) {
      showToast('Replay Simulation active (t=0s – 600s)');
    } else {
      showToast('Replay paused');
      setMlCurrentBand(7);
      setOpenLoopCurrentBand(4);
    }
  };

  return (
    <div className="bg-white font-body-md text-on-surface antialiased min-h-screen flex flex-col selection:bg-primary/20 selection:text-primary">
      {/* Top Header */}
      <Header
        viewMode={viewMode}
        setViewMode={setViewMode}
        onDatasetUpload={handleDatasetUpload}
        loadedDataset={loadedDataset}
      />

      {/* Main Content Area */}
      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 flex flex-col gap-6 bg-white">
        {/* Replay Mode / Scanning Toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center justify-end w-full">
            {/* Live Scanning Status Pill */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 mr-3 rounded-full border font-label-md text-[11px] font-semibold select-none transition-colors ${
                isScanning
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-slate-100 border-slate-300 text-slate-600'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isScanning ? 'bg-emerald-700 animate-pulse' : 'bg-slate-500'
                }`}
              ></span>
              <span>{isScanning ? 'SCANNING' : 'PAUSED'}</span>
            </div>

            {/* Replay Button */}
            <button
              id="replay-btn"
              type="button"
              onClick={handleReplayToggle}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border font-label-md text-xs font-medium shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-all cursor-pointer group ${
                isReplaying
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-white border-slate-200/90 hover:border-primary/50 text-on-surface hover:text-primary'
              }`}
            >
              {isReplaying ? (
                <>
                  <span className="material-symbols-outlined text-[17px] text-primary animate-spin">
                    sync
                  </span>
                  <span>Replaying (0s-600s)...</span>
                  <span className="px-1.5 py-0.5 bg-primary text-white rounded font-label-sm text-[10px] ml-0.5">
                    ACTIVE
                  </span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[17px] text-primary group-hover:rotate-[-45deg] transition-transform">
                    replay
                  </span>
                  <span>Replay Mode</span>
                  <span className="px-1.5 py-0.5 bg-slate-100 rounded font-label-sm text-[10px] text-outline ml-0.5">
                    t=0s – 600s
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Circular Radar Scanners Side-by-Side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Scanner: Adaptive ML Scan */}
          <RadarScanner
            title="ADAPTIVE ML SCAN (DQN ε-GREEDY)"
            type="adaptive"
            currentBand={mlCurrentBand}
            metrics={mlMetrics}
            onSelectBand={(bandId) => setMlCurrentBand(bandId)}
          />

          {/* Right Scanner: Open Loop Scan */}
          <RadarScanner
            title="OPEN LOOP SCAN (SEQUENTIAL SWEEP)"
            type="open-loop"
            currentBand={openLoopCurrentBand}
            metrics={openLoopMetrics}
            onSelectBand={(bandId) => setOpenLoopCurrentBand(bandId)}
          />
        </div>

        {/* Bottom Section: Observations Graph/Table & RL Parameters Accordion */}
        <div className="flex flex-col gap-6">
          <ObservationsSection onExportNotify={showToast} />
          <RLParametersAccordion />
        </div>
      </main>

      {/* Global Toast for Interactive Feedback */}
      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}
