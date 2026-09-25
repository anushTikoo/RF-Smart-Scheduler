import React, { useState, useRef, useEffect } from 'react';

export default function ObservationsSection({
  observations = [],
  isScanning = false,
  hasDataset = false,
  viewMode = 'receiver', // 'receiver' | 'environment'
  onExportNotify,
}) {
  const [displayMode, setDisplayMode] = useState('graph'); // 'graph' | 'table'
  const [filter, setFilter] = useState('all'); // 'all' | 'interceptions' | 'misses' | 'emissions'
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);

  const sliderRef = useRef(null);
  const isDownRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);

  // Fallback to 'all' if user switched to receiver view while 'emissions' was selected
  const effectiveFilter = (viewMode === 'receiver' && filter === 'emissions') ? 'all' : filter;

  // Filter options based on whether we are in Receiver View or Environmental View
  const filterOptions = viewMode === 'environment'
    ? [
        { id: 'all', label: 'All', desc: 'Hits, Misses & Emissions' },
        { id: 'interceptions', label: 'Interceptions Only', desc: 'Detected hits only' },
        { id: 'misses', label: 'Misses Only', desc: 'Searching misses only' },
        { id: 'emissions', label: 'Actual Emissions Only', desc: 'Target emissions only' },
      ]
    : [
        { id: 'all', label: 'Both (Hits & Misses)', desc: 'Full receiver scan timeline' },
        { id: 'interceptions', label: 'Interceptions Only', desc: 'Detected hits only' },
        { id: 'misses', label: 'Misses Only', desc: 'Searching misses only' },
      ];

  const currentFilterMeta = filterOptions.find((f) => f.id === effectiveFilter) || filterOptions[0];

  // Auto-scroll graph to newest observation smoothly without CSS transition jitter
  useEffect(() => {
    if (sliderRef.current && isScanning && !isDownRef.current) {
      sliderRef.current.scrollLeft = sliderRef.current.scrollWidth;
    }
  }, [observations.length, isScanning]);

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

  // Filter rows for the tabular view and CSV export
  const filteredObservations = observations.filter((obs) => {
    if (effectiveFilter === 'interceptions') return obs.isIntercepted;
    if (effectiveFilter === 'misses') return !obs.isIntercepted;
    return true; // 'all' and 'emissions'
  });

  // CSV download function
  const handleExportCSV = () => {
    if (!filteredObservations || filteredObservations.length === 0) {
      if (onExportNotify) {
        onExportNotify("No observations matching filter to export.");
      }
      return;
    }

    const isEnv = viewMode === 'environment';
    const headers = isEnv
      ? ["Time (µs)", "Scheduled Band", "Intercepted Frequency", "Actual Emission(s)", "Frequency Range", "Rx Status"]
      : ["Time (µs)", "Scheduled Band", "Intercepted Frequency", "Frequency Range", "Rx Status"];

    const rows = filteredObservations.map((obs) => {
      const emissionStr = obs.actualEmissions && obs.actualEmissions.length > 0
        ? obs.actualEmissions.map((e) => `Band ${e.bandId} (${e.freqStr})`).join(' • ')
        : (obs.actualFreqStr || '-');

      return isEnv
        ? [
            `"${obs.timestamp || obs.timeUs + ' µs'}"`,
            `"${obs.band}"`,
            `"${obs.interceptedFreq || (obs.isIntercepted ? obs.centerFreq : '-')}"`,
            `"${emissionStr}"`,
            `"${obs.range}"`,
            `"${obs.status}"`,
          ]
        : [
            `"${obs.timestamp || obs.timeUs + ' µs'}"`,
            `"${obs.band}"`,
            `"${obs.interceptedFreq || (obs.isIntercepted ? obs.centerFreq : '-')}"`,
            `"${obs.range}"`,
            `"${obs.status}"`,
          ];
    });

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `adaptive_ml_observations_${viewMode}_${effectiveFilter}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (onExportNotify) {
      onExportNotify(`Exported ${filteredObservations.length} ${viewMode} observations as CSV`);
    }
  };

  // Coordinate mapping for SVG Graph:
  // 0.50 GHz (bottom) maps to Y=205, 18.00 GHz (top) maps to Y=25. Usable height = 180px.
  const slotWidth = 56;
  const paddingLeft = 24;
  const paddingRight = 50;
  const plotWidth = Math.max(680, paddingLeft + observations.length * slotWidth + paddingRight);
  const plotHeight = 230;

  // Exact mathematical mapping: clamped between 0.5 and 18.0 GHz
  const getY = (freqGhz) => {
    const clamped = Math.min(18.0, Math.max(0.5, freqGhz || 0.5));
    return 205 - ((clamped - 0.5) / 17.5) * 180;
  };

  // Prepare geometry for each observation step
  // Dwell segment covers the entire slot width so green (hit) and yellow (miss) lines are continuous
  const pts = observations.map((obs, i) => {
    const startX = paddingLeft + i * slotWidth;
    const endX = startX + slotWidth;
    const midX = (startX + endX) / 2;
    const y = getY(obs.freqGhz);

    // Calculate Y for all actual emissions (single or simultaneous multi-emitter)
    const emissions = (obs.actualEmissions || []).map((em) => ({
      ...em,
      y: getY(em.freqGhz),
    }));

    return {
      obs,
      startX,
      endX,
      midX,
      y,
      emissions,
    };
  });

  // Direct vertical lines connecting receiver band decisions between consecutive steps
  // Only rendered when 'all' filter is active (i.e. both hits and misses toggled)
  const verticalLines = [];
  if (effectiveFilter === 'all' && pts.length > 1) {
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      if (prev.y !== curr.y) {
        verticalLines.push({
          id: `vl-${curr.obs.id}`,
          x: curr.startX,
          y1: prev.y,
          y2: curr.y,
        });
      }
    }
  }

  const latestPt = pts.length > 0 ? pts[pts.length - 1] : null;
  const cursorX = latestPt ? latestPt.endX : 0;

  // Control visibility of graph layers based on viewMode and active filter
  const showInterceptions = effectiveFilter === 'all' || effectiveFilter === 'interceptions';
  const showMisses = effectiveFilter === 'all' || effectiveFilter === 'misses';
  const showActualEmissions = viewMode === 'environment' && (effectiveFilter === 'all' || effectiveFilter === 'emissions');

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-slate-200 p-5 sm:p-6 flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-primary select-none">
              timeline
            </span>
            <h3 className="font-label-md text-label-md font-semibold text-on-surface uppercase tracking-wide">
              Frequency vs. Time Observations
            </h3>
          </div>
          <p className="font-body-sm text-[11px] text-slate-500 font-normal pl-7">
            Adaptive ML scan timeline • <span className="font-semibold text-slate-700 capitalize">{viewMode} View</span>
          </p>
        </div>

        <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
          {/* Filter Dropdown Pill */}
          <div className="relative inline-block">
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 shadow-2xs text-slate-700 hover:text-slate-900 font-label-md text-[11.5px] font-semibold hover:border-primary/50 transition-all cursor-pointer"
              type="button"
              onClick={() => {
                setIsFilterDropdownOpen((prev) => !prev);
                setIsViewDropdownOpen(false);
              }}
            >
              <span className="material-symbols-outlined text-[16px] text-primary">filter_list</span>
              <span>Filter: <strong className="text-slate-900 font-bold">{currentFilterMeta.label}</strong></span>
              <span className={`material-symbols-outlined text-[15px] text-slate-400 transition-transform duration-200 ${isFilterDropdownOpen ? 'rotate-180' : ''}`}>
                expand_more
              </span>
            </button>

            {isFilterDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-52 bg-white border border-slate-200 rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.08)] p-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="px-2.5 py-1 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Show in {viewMode} view
                </div>
                {filterOptions.map((opt) => (
                  <button
                    key={opt.id}
                    className={`w-full flex flex-col px-2.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                      effectiveFilter === opt.id
                        ? 'bg-slate-50 text-primary font-semibold'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                    onClick={() => {
                      setFilter(opt.id);
                      setIsFilterDropdownOpen(false);
                    }}
                    type="button"
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-[11.5px] font-medium">{opt.label}</span>
                      {effectiveFilter === opt.id && (
                        <span className="material-symbols-outlined text-[14px] text-primary">check</span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 font-normal">{opt.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* View Switcher Pill Dropdown (Graph View vs Tabular View) */}
          <div className="relative inline-block">
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 shadow-2xs text-primary font-label-md text-[11.5px] font-semibold hover:border-primary/50 transition-all cursor-pointer"
              id="view-graph-btn"
              type="button"
              onClick={() => {
                setIsViewDropdownOpen((prev) => !prev);
                setIsFilterDropdownOpen(false);
              }}
            >
              <span className="material-symbols-outlined text-[16px] text-primary" id="graph-view-icon">
                {displayMode === 'graph' ? 'show_chart' : 'table_chart'}
              </span>
              <span id="current-graph-view-label">
                {displayMode === 'graph' ? 'Graph View' : 'Tabular View'}
              </span>
              <span className={`material-symbols-outlined text-[15px] text-primary transition-transform duration-200 ${isViewDropdownOpen ? 'rotate-180' : ''}`}>
                expand_more
              </span>
            </button>

            {isViewDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-36 bg-white border border-slate-200 rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.08)] p-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                <button
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-label-md text-[11.5px] text-left transition-colors cursor-pointer ${
                    displayMode === 'graph'
                      ? 'bg-slate-50 text-primary font-semibold'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                  onClick={() => {
                    setDisplayMode('graph');
                    setIsViewDropdownOpen(false);
                  }}
                  type="button"
                >
                  <span>Graph View</span>
                  {displayMode === 'graph' && (
                    <span className="material-symbols-outlined text-[14px]">check</span>
                  )}
                </button>
                <button
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-label-md text-[11.5px] text-left transition-colors cursor-pointer ${
                    displayMode === 'table'
                      ? 'bg-slate-50 text-primary font-semibold'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                  onClick={() => {
                    setDisplayMode('table');
                    setIsViewDropdownOpen(false);
                  }}
                  type="button"
                >
                  <span>Tabular View</span>
                  {displayMode === 'table' && (
                    <span className="material-symbols-outlined text-[14px]">check</span>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Export CSV Button */}
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-50 text-slate-700 hover:text-slate-900 font-label-sm text-[11.5px] font-medium border border-slate-200 hover:bg-slate-100 transition-colors cursor-pointer shadow-2xs"
            onClick={handleExportCSV}
            type="button"
            title="Export dynamic observations stream as CSV"
          >
            <span className="material-symbols-outlined text-[15px] text-primary">download</span>
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Graph Container Display */}
      {displayMode === 'graph' && (
        <div className="mt-4 flex flex-col w-full overflow-hidden" id="observation-graph-display">
          <div className="flex items-start w-full border border-slate-200 rounded-xl bg-white overflow-hidden shadow-2xs">
            {/* Synchronized Fixed Y-Axis SVG Ruler */}
            <div className="shrink-0 select-none bg-slate-50 border-r border-slate-200">
              <svg width="68" height={plotHeight} className="block">
                <text
                  x="60"
                  y="13"
                  textAnchor="end"
                  className="text-[9px] font-sans font-bold fill-slate-600 uppercase tracking-wide"
                >
                  Freq (GHz)
                </text>
                {/* Y-Axis Grid Tick Values (Aligned to grid lines at 25, 61, 97, 133, 169, 205) */}
                {[
                  { ghz: 18.0, y: 25 },
                  { ghz: 14.5, y: 61 },
                  { ghz: 11.0, y: 97 },
                  { ghz: 7.5, y: 133 },
                  { ghz: 4.0, y: 169 },
                  { ghz: 0.5, y: 205 },
                ].map((tick) => (
                  <g key={`y-tick-${tick.ghz}`}>
                    <text
                      x="56"
                      y={tick.y}
                      dominantBaseline="central"
                      textAnchor="end"
                      className="text-[10px] font-mono fill-slate-500 font-medium"
                    >
                      {tick.ghz.toFixed(1)}
                    </text>
                    <line x1="61" y1={tick.y} x2="68" y2={tick.y} stroke="#CBD5E1" strokeWidth="1" />
                  </g>
                ))}
              </svg>
            </div>

            {/* Pannable & Scrollable Graph Viewport */}
            <div
              className="relative flex-1 h-[230px] bg-white overflow-x-auto cursor-grab active:cursor-grabbing select-none"
              id="graph-pan-container"
              ref={sliderRef}
              onMouseDown={handleMouseDown}
              onMouseLeave={handleMouseLeaveOrUp}
              onMouseUp={handleMouseLeaveOrUp}
              onMouseMove={handleMouseMove}
            >
              <svg
                style={{ width: `${plotWidth}px`, height: `${plotHeight}px` }}
                className="overflow-visible block"
              >
                {/* Horizontal Gridlines spanning plot width */}
                <line x1="0" y1="25" x2={plotWidth} y2="25" stroke="#F1F5F9" strokeDasharray="3 3" strokeWidth="1" />
                <line x1="0" y1="61" x2={plotWidth} y2="61" stroke="#F1F5F9" strokeDasharray="3 3" strokeWidth="1" />
                <line x1="0" y1="97" x2={plotWidth} y2="97" stroke="#F1F5F9" strokeDasharray="3 3" strokeWidth="1" />
                <line x1="0" y1="133" x2={plotWidth} y2="133" stroke="#F1F5F9" strokeDasharray="3 3" strokeWidth="1" />
                <line x1="0" y1="169" x2={plotWidth} y2="169" stroke="#F1F5F9" strokeDasharray="3 3" strokeWidth="1" />
                <line x1="0" y1="205" x2={plotWidth} y2="205" stroke="#E2E8F0" strokeWidth="1.5" />

                {/* Vertical Time Step Gridlines */}
                {pts.map((pt) => (
                  <line
                    key={`v-grid-${pt.obs.id}`}
                    x1={pt.midX}
                    y1="20"
                    x2={pt.midX}
                    y2="205"
                    stroke="#F8FAFC"
                    strokeDasharray="2 3"
                    strokeWidth="1"
                  />
                ))}

                {/* Direct vertical lines connecting receiver band decisions (only when All or Both is active) */}
                {verticalLines.map((vl) => (
                  <line
                    key={vl.id}
                    x1={vl.x}
                    y1={vl.y1}
                    x2={vl.x}
                    y2={vl.y2}
                    stroke="#0F172A"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                ))}

                {/* Receiver Dwell Segments: Green (#10B981) for Interceptions, Yellow (#F59E0B) for Misses */}
                {pts.map((pt) => {
                  const isHit = pt.obs.isIntercepted;

                  // Filter check: hide if filter excludes this observation type
                  if (isHit && !showInterceptions) return null;
                  if (!isHit && !showMisses) return null;

                  const strokeColor = isHit ? '#10B981' : '#F59E0B';

                  return (
                    <g key={`dwell-group-${pt.obs.id}`}>
                      {/* Full-width horizontal receiver dwell line */}
                      <line
                        x1={pt.startX}
                        y1={pt.y}
                        x2={pt.endX}
                        y2={pt.y}
                        stroke={strokeColor}
                        strokeWidth="3.2"
                        strokeLinecap="round"
                      />
                      <title>{`${pt.obs.timestamp} • Receiver Scan: ${pt.obs.band} (${pt.obs.centerFreq}) • Rx: ${pt.obs.status}${isHit ? ' (CAUGHT TARGET)' : ''}`}</title>
                    </g>
                  );
                })}

                {/* Actual Emission Markers (Environmental View only: Consistent Solid Filled Emerald Diamonds) */}
                {showActualEmissions &&
                  pts.map((pt) => (
                    <g key={`actual-emissions-group-${pt.obs.id}`}>
                      {pt.emissions.map((em, idx) => {
                        const isCaughtHere = pt.obs.isIntercepted && pt.obs.bandId === em.bandId;

                        return (
                          <g key={`em-marker-${pt.obs.id}-${em.bandId}-${idx}`}>
                            {/* Solid filled diamond reticle consistent with the legend */}
                            <polygon
                              points={`${pt.midX},${em.y - 5} ${pt.midX + 5},${em.y} ${pt.midX},${em.y + 5} ${pt.midX - 5},${em.y}`}
                              fill="#10B981"
                              stroke="#FFFFFF"
                              strokeWidth="1.2"
                              className="drop-shadow-[0_0_5px_rgba(16,185,129,0.85)]"
                            />
                            <title>{`${pt.obs.timestamp} • Target Emission: Band ${em.bandId} (${em.freqStr || em.freqGhz + ' GHz'})${isCaughtHere ? ' • [CAUGHT BY RECEIVER]' : ' • [UNMONITORED]'}`}</title>
                          </g>
                        );
                      })}
                    </g>
                  ))}

                {/* Leading Edge Cursor (Current Microsecond Position) */}
                {cursorX > 0 && (
                  <g>
                    <line
                      x1={cursorX}
                      y1="20"
                      x2={cursorX}
                      y2="205"
                      stroke="#94A3B8"
                      strokeWidth="1.5"
                      strokeDasharray="3 2"
                    />
                    <circle cx={cursorX} cy="20" r="2.5" fill="#94A3B8" />
                  </g>
                )}

                {/* X-Axis Microsecond Time Ticks */}
                {pts.map((pt) => (
                  <text
                    key={`time-tick-${pt.obs.id}`}
                    x={pt.midX}
                    y="222"
                    textAnchor="middle"
                    className="text-[9.5px] font-mono fill-slate-500 font-semibold select-none"
                  >
                    {pt.obs.timeUs} µs
                  </text>
                ))}
              </svg>

              {/* Standby Message if no observations accumulated yet */}
              {observations.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-1.5 select-none pointer-events-none">
                  <span className="material-symbols-outlined text-[24px] text-slate-300">timeline</span>
                  <span className="text-[12px] font-medium">Awaiting scan steps to plot timeline...</span>
                </div>
              )}
            </div>
          </div>

          {/* Graph Footer Bar: Interaction tip with subtle reduced-size icon and clear visual legend */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-slate-100 mt-2 text-[11px] text-slate-500 select-none">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[11px] text-slate-400">info</span>
              <span>
                Horizontal drag or scroll to review recorded scan observations.
              </span>
            </div>

            {/* Dynamic Visual Legend reflecting current filter and viewMode */}
            <div className="flex flex-wrap items-center gap-4">
              {showInterceptions && (
                <div className="flex items-center gap-1.5">
                  <span className="w-4 h-1 rounded bg-[#10B981]" />
                  <span className="text-emerald-700 font-bold">Intercepted (Hit)</span>
                </div>
              )}
              {showMisses && (
                <div className="flex items-center gap-1.5">
                  <span className="w-4 h-1 rounded bg-[#F59E0B]" />
                  <span className="text-amber-700 font-medium">Miss (Searching)</span>
                </div>
              )}
              {showActualEmissions && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rotate-45 bg-[#10B981] border border-white shadow-2xs" />
                  <span className="text-emerald-800 font-bold">Actual Target Emission</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabular View Container */}
      {displayMode === 'table' && (
        <div className="mt-4 flex flex-col w-full overflow-hidden" id="observation-table-display">
          {/* Subtitle note on table */}
          <div className="pb-2 text-[11px] text-slate-500 flex items-center justify-between">
            <span>
              Recorded observations stream ({filteredObservations.length} of {observations.length} total entries)
            </span>
            <span className="font-mono text-[10px] text-slate-400">Newest events displayed first</span>
          </div>

          {/* Scrollable table container */}
          <div className="max-h-[340px] overflow-y-auto overflow-x-auto rounded-xl border border-slate-200 shadow-2xs">
            <table className="w-full text-left text-xs font-label-sm border-collapse min-w-[550px]">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 shadow-2xs">
                <tr>
                  <th className="py-2.5 px-3.5 text-slate-600 font-bold uppercase tracking-wider text-[10.5px]">Time (µs)</th>
                  <th className="py-2.5 px-3.5 text-slate-600 font-bold uppercase tracking-wider text-[10.5px]">Scheduled Band</th>
                  <th className="py-2.5 px-3.5 text-slate-600 font-bold uppercase tracking-wider text-[10.5px]">Intercepted Frequency</th>
                  {viewMode === 'environment' && (
                    <th className="py-2.5 px-3.5 text-emerald-800 font-bold uppercase tracking-wider text-[10.5px]">Actual Emission(s)</th>
                  )}
                  <th className="py-2.5 px-3.5 text-slate-600 font-bold uppercase tracking-wider text-[10.5px]">Frequency Range</th>
                  <th className="py-2.5 px-3.5 text-slate-600 font-bold uppercase tracking-wider text-[10.5px]">Rx Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-on-surface font-mono text-[11px]">
                {filteredObservations.length > 0 ? (
                  [...filteredObservations].reverse().map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3.5 font-bold text-slate-900">{row.timestamp}</td>
                      <td className="py-2.5 px-3.5 font-semibold text-primary">{row.band}</td>
                      <td className="py-2.5 px-3.5">
                        {row.isIntercepted ? (
                          <span className="font-bold text-emerald-700 font-mono text-[11px]">
                            {row.interceptedFreq || row.centerFreq}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-mono text-[11px]">-</span>
                        )}
                      </td>
                      {viewMode === 'environment' && (
                        <td className="py-2.5 px-3.5 text-emerald-800 font-semibold text-[10.5px]">
                          {row.actualEmissions && row.actualEmissions.length > 0 ? (
                            row.actualEmissions.map((em, idx) => (
                              <span key={`em-${row.id}-${em.bandId}-${idx}`}>
                                {idx > 0 && <span className="text-slate-400 mx-1">•</span>}
                                Band {em.bandId} <span className="text-emerald-700/80 font-normal">({em.freqStr})</span>
                              </span>
                            ))
                          ) : (
                            row.actualFreqStr || '-'
                          )}
                        </td>
                      )}
                      <td className="py-2.5 px-3.5 text-slate-500 text-[10.5px]">{row.range}</td>
                      <td className="py-2.5 px-3.5">
                        {row.isIntercepted ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[10px] border border-emerald-200 tracking-wide uppercase shadow-2xs">
                            INTERCEPTED (HIT)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium text-[10px] border border-amber-200 tracking-wide uppercase">
                            SEARCHING (MISS)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={viewMode === 'environment' ? 6 : 5} className="py-10 text-center text-slate-400 font-sans text-xs">
                      No observations matching the selected filter ({currentFilterMeta.label}).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
