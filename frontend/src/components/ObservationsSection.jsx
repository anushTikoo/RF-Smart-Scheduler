import React, { useState, useRef } from 'react';

const DEFAULT_OBSERVATIONS = [
  { id: 1, timestamp: "t=528.2s", band: "Band 7", centerFreq: "6.50 GHz", signalType: "Pulsed Radar (X-Band)", duration: "22 μs", status: "Intercepted", confidence: "98.4%" },
  { id: 2, timestamp: "t=482.0s", band: "Band 9", centerFreq: "8.80 GHz", signalType: "Frequency Agility Chirp", duration: "45 μs", status: "Intercepted", confidence: "94.1%" },
  { id: 3, timestamp: "t=410.5s", band: "Band 2", centerFreq: "1.80 GHz", signalType: "Tactical Comms Jammer", duration: "110 μs", status: "Intercepted", confidence: "99.2%" },
  { id: 4, timestamp: "t=312.8s", band: "Band 7", centerFreq: "6.85 GHz", signalType: "Target Tracking Radar", duration: "18 μs", status: "Intercepted", confidence: "96.8%" },
  { id: 5, timestamp: "t=184.1s", band: "Band 4", centerFreq: "3.40 GHz", signalType: "Phased Array Acquisition", duration: "60 μs", status: "Intercepted", confidence: "91.5%" },
  { id: 6, timestamp: "t=122.4s", band: "Band 6", centerFreq: "5.45 GHz", signalType: "Fire Control Radar", duration: "30 μs", status: "Intercepted", confidence: "95.2%" },
  { id: 7, timestamp: "t=88.0s", band: "Band 8", centerFreq: "7.20 GHz", signalType: "Airborne Early Warning", duration: "85 μs", status: "Intercepted", confidence: "97.0%" },
];

export default function ObservationsSection({ onExportNotify }) {
  const [viewMode, setViewMode] = useState('graph'); // 'graph' | 'table'
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const sliderRef = useRef(null);
  const isDownRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);

  // Mouse pan handlers for the graph
  const handleMouseDown = (e) => {
    if (!sliderRef.current) return;
    isDownRef.current = true;
    startXRef.current = e.pageX - sliderRef.current.offsetLeft;
    scrollLeftRef.current = sliderRef.current.scrollLeft;
  };

  const handleMouseLeaveOrUp = () => {
    isDownRef.current = false;
  };

  const handleMouseMove = (e) => {
    if (!isDownRef.current || !sliderRef.current) return;
    e.preventDefault();
    const x = e.pageX - sliderRef.current.offsetLeft;
    const walk = (x - startXRef.current) * 1.5;
    sliderRef.current.scrollLeft = scrollLeftRef.current - walk;
  };

  // CSV download function
  const handleExportCSV = () => {
    const headers = ["Timestamp", "Frequency Band", "Center Frequency", "Signal Type", "Duration", "Rx Status", "Confidence"];
    const rows = DEFAULT_OBSERVATIONS.map(obs => [
      obs.timestamp,
      obs.band,
      obs.centerFreq,
      `"${obs.signalType}"`,
      obs.duration,
      obs.status,
      obs.confidence
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [
      headers.join(","),
      ...rows.map(e => e.join(","))
    ].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `rf_observations_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (onExportNotify) {
      onExportNotify("Observations exported as CSV file");
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.03)] border border-slate-200/90 p-5 sm:p-6 flex flex-col">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary"></span>
            <h3 className="font-label-md text-label-md font-semibold text-on-surface uppercase tracking-wide">
              Frequency vs. Time Observations
            </h3>
          </div>
          <p className="font-body-sm text-[12px] text-primary font-medium pl-4">
            Scanned bands and detected emissions
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* View Switcher Pill Dropdown */}
          <div className="relative inline-block">
            <button
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-slate-200 shadow-xs text-primary font-label-md text-[12px] font-semibold hover:border-primary/50 transition-all cursor-pointer"
              id="view-graph-btn"
              type="button"
              onClick={() => setIsDropdownOpen(prev => !prev)}
            >
              <span className="material-symbols-outlined text-[15px] text-primary" id="graph-view-icon">
                {viewMode === 'graph' ? 'show_chart' : 'table_chart'}
              </span>
              <span id="current-graph-view-label">
                {viewMode === 'graph' ? 'Graph View' : 'Tabular View'}
              </span>
              <span className={`material-symbols-outlined text-[16px] text-primary transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`}>
                expand_more
              </span>
            </button>

            {isDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-40 bg-white border border-slate-200 rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.06)] p-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                <button
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-label-md text-[12px] text-left transition-colors cursor-pointer ${
                    viewMode === 'graph'
                      ? 'bg-slate-50 text-primary font-semibold'
                      : 'text-on-surface-variant hover:bg-slate-50 hover:text-on-surface'
                  }`}
                  onClick={() => {
                    setViewMode('graph');
                    setIsDropdownOpen(false);
                  }}
                  type="button"
                >
                  <span>Graph View</span>
                  {viewMode === 'graph' && (
                    <span className="material-symbols-outlined text-[15px]">check</span>
                  )}
                </button>
                <button
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-label-md text-[12px] text-left transition-colors cursor-pointer ${
                    viewMode === 'table'
                      ? 'bg-slate-50 text-primary font-semibold'
                      : 'text-on-surface-variant hover:bg-slate-50 hover:text-on-surface'
                  }`}
                  onClick={() => {
                    setViewMode('table');
                    setIsDropdownOpen(false);
                  }}
                  type="button"
                >
                  <span>Tabular View</span>
                  {viewMode === 'table' && (
                    <span className="material-symbols-outlined text-[15px]">check</span>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Export CSV Button */}
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-on-surface font-label-sm text-label-sm hover:bg-slate-200 transition-colors cursor-pointer"
            onClick={handleExportCSV}
            type="button"
          >
            <span className="material-symbols-outlined text-[15px] text-primary">download</span>
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Graph Container Display */}
      {viewMode === 'graph' && (
        <div className="mt-4 flex flex-col" id="observation-graph-display">
          <div className="flex items-start">
            {/* Y-Axis Labels */}
            <div className="flex flex-col justify-between h-64 text-right pr-3 font-label-sm text-[11px] text-outline select-none pb-5 shrink-0">
              <span className="font-semibold text-on-surface-variant">Frequency (GHz)</span>
              <span>20 GHz</span>
              <span>15 GHz</span>
              <span>10 GHz</span>
              <span>5 GHz</span>
              <span>0 GHz</span>
            </div>

            {/* Pannable Graph Viewport */}
            <div
              className="relative flex-1 h-64 border-l border-b border-slate-300 bg-white rounded-tr-lg overflow-x-auto cursor-grab active:cursor-grabbing select-none"
              id="graph-pan-container"
              ref={sliderRef}
              onMouseDown={handleMouseDown}
              onMouseLeave={handleMouseLeaveOrUp}
              onMouseUp={handleMouseLeaveOrUp}
              onMouseMove={handleMouseMove}
            >
              {/* Horizontal Gridlines */}
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none w-[1000px]">
                <div className="w-full border-t border-dashed border-slate-200"></div>
                <div className="w-full border-t border-dashed border-slate-200"></div>
                <div className="w-full border-t border-dashed border-slate-200"></div>
                <div className="w-full border-t border-dashed border-slate-200"></div>
                <div></div>
              </div>

              {/* Vertical Gridlines */}
              <div className="absolute inset-0 flex justify-between pointer-events-none w-[1000px]">
                <div className="h-full border-r border-dashed border-slate-200"></div>
                <div className="h-full border-r border-dashed border-slate-200"></div>
                <div className="h-full border-r border-dashed border-slate-200"></div>
                <div className="h-full border-r border-dashed border-slate-200"></div>
                <div className="h-full border-r border-dashed border-slate-200"></div>
                <div className="h-full border-r border-dashed border-slate-200"></div>
                <div className="h-full border-r border-dashed border-slate-200"></div>
              </div>

              {/* Stepped Digital Signal SVG */}
              <svg className="absolute inset-0 h-full w-[1000px]" preserveAspectRatio="none" viewBox="0 0 1000 200">
                {/* Open Loop Scan Baseline (Grey dashed) */}
                <path
                  d="M 0,180 L 100,180 L 100,150 L 200,150 L 200,120 L 300,120 L 300,90 L 450,90 L 450,60 L 650,60 L 650,30 L 1000,30"
                  fill="none"
                  opacity="0.3"
                  stroke="#94A3B8"
                  strokeDasharray="4 4"
                  strokeWidth="1.5"
                />
                {/* Adaptive ML Scan (DQN ε-Greedy) Stepped Line (Teal solid) */}
                <path
                  d="M 0,135 L 40,135 L 40,70 L 90,70 L 90,135 L 250,135 L 250,95 L 310,95 L 310,135 L 390,135 L 390,180 L 440,180 L 440,135 L 530,135 L 530,45 L 580,45 L 580,135 L 720,135 L 720,80 L 780,80 L 780,135 L 890,135 L 890,110 L 940,110 L 940,135 L 1000,135"
                  fill="none"
                  stroke="#006972"
                  strokeLinecap="square"
                  strokeWidth="2.5"
                />
              </svg>

              {/* Vertical Time Indicator (Cursor line at t=528s) */}
              <div className="absolute left-[780px] top-0 bottom-0 w-[1.5px] bg-primary">
                <div className="absolute -top-1 -translate-x-1/2 font-label-sm text-[9px] bg-primary text-white px-1.5 py-0.5 rounded shadow-xs whitespace-nowrap">
                  t=528s
                </div>
              </div>
            </div>
          </div>

          {/* X-Axis Time Labels */}
          <div className="flex justify-between pl-24 sm:pl-28 pt-2 font-label-sm text-[11px] text-outline select-none">
            <span>0 s</span>
            <span>150 s</span>
            <span className="font-semibold text-on-surface-variant">Time (s)</span>
            <span>300 s</span>
            <span>450 s</span>
            <span>600 s</span>
          </div>
        </div>
      )}

      {/* Tabular View Container */}
      {viewMode === 'table' && (
        <div className="mt-4 overflow-x-auto" id="observation-table-display">
          <table className="w-full text-left text-xs font-label-sm border-collapse min-w-[640px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3 text-outline font-semibold">Timestamp</th>
                <th className="py-2.5 px-3 text-outline font-semibold">Frequency Band</th>
                <th className="py-2.5 px-3 text-outline font-semibold">Center Freq</th>
                <th className="py-2.5 px-3 text-outline font-semibold">Signal Type</th>
                <th className="py-2.5 px-3 text-outline font-semibold">Duration</th>
                <th className="py-2.5 px-3 text-outline font-semibold">Rx Status</th>
                <th className="py-2.5 px-3 text-outline font-semibold text-right">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-on-surface font-mono text-[11px]">
              {DEFAULT_OBSERVATIONS.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-2 px-3">{row.timestamp}</td>
                  <td className="py-2 px-3 font-semibold text-primary">{row.band}</td>
                  <td className="py-2 px-3">{row.centerFreq}</td>
                  <td className="py-2 px-3">{row.signalType}</td>
                  <td className="py-2 px-3">{row.duration}</td>
                  <td className="py-2 px-3">
                    <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-medium border border-emerald-200">
                      {row.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right">{row.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

