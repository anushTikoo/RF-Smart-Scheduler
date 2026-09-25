import React, { useState, useRef, useEffect } from 'react';

// Discrete Stepped Band vs. Time Graph Icon with orthogonal horizontal dwell lines & vertical transitions
function BandStepGraphIcon({ className = "w-[20px] h-[20px] text-primary" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      className={`shrink-0 select-none ${className}`}
    >
      {/* Coordinate axes for Band (Y) vs Time (X) */}
      <path
        d="M 3 3.5 V 20.5 H 21"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.38"
      />
      {/* Stepped binary scan trajectory: strictly horizontal band dwells & vertical band switches */}
      <path
        d="M 3.5 16 H 8 V 7 H 14 V 13.5 H 18 V 5.5 H 21.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

  const [hoverInfo, setHoverInfo] = useState(null);

  // Fallback to 'all' if user switched to receiver view while 'emissions' was selected
  const effectiveFilter = (viewMode === 'receiver' && filter === 'emissions') ? 'all' : filter;

  // Filter options based on whether we are in Receiver View or Environmental View
  const filterOptions = viewMode === 'environment'
    ? [
        { id: 'all', label: 'All Dwells', desc: 'Hits, Scan Misses & Emissions' },
        { id: 'interceptions', label: 'Hits Only', desc: 'Detected hits only' },
        { id: 'misses', label: 'Scan Misses Only', desc: 'Missed opportunities' },
        { id: 'emissions', label: 'Actual Emissions Only', desc: 'Target emissions only' },
      ]
    : [
        { id: 'all', label: 'All Dwells', desc: 'Full receiver scan timeline' },
        { id: 'interceptions', label: 'Hits Only', desc: 'Detected hits only' },
        { id: 'misses', label: 'Scan Misses Only', desc: 'Missed opportunities' },
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
    setHoverInfo(null);
    startXRef.current = e.pageX - sliderRef.current.offsetLeft;
    scrollLeftRef.current = sliderRef.current.scrollLeft;
  };

  const handleMouseLeaveOrUp = () => {
    isDownRef.current = false;
  };

  const handleMouseMove = (e) => {
    if (isDownRef.current && sliderRef.current) {
      e.preventDefault();
      const x = e.pageX - sliderRef.current.offsetLeft;
      const walk = (x - startXRef.current) * 1.5;
      sliderRef.current.scrollLeft = scrollLeftRef.current - walk;
    }
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
      ? ["Time Window", "Selected Band", "Intercepted Frequency", "Result", "Pulses Detected", "Active Emissions in Window", "Frequency Range"]
      : ["Time Window", "Selected Band", "Intercepted Frequency", "Result", "Pulses Detected", "Frequency Range"];

    const rows = filteredObservations.map((obs) => {
      const resultText = obs.result || (obs.isIntercepted ? 'HIT' : 'SCAN MISS');
      const pulses = obs.pulsesDetected !== undefined ? obs.pulsesDetected : (obs.isIntercepted ? 3 : 0);
      const exactIntercepted = obs.isIntercepted ? (obs.interceptedFreq && obs.interceptedFreq !== '-' ? obs.interceptedFreq : obs.centerFreq) : '-';

      const emissionStr = obs.actualEmissions && obs.actualEmissions.length > 0
        ? obs.actualEmissions.map((e) => `Band ${e.bandId} (${e.freqStr}) [${e.isDetected ? 'Detected' : 'Missed'}]`).join(' • ')
        : (obs.actualFreqStr || '-');

      return isEnv
        ? [
            `"${obs.timeWindow || obs.timestamp}"`,
            `"${obs.band}"`,
            `"${exactIntercepted}"`,
            `"${resultText}"`,
            `"${pulses}"`,
            `"${emissionStr}"`,
            `"${obs.range}"`,
          ]
        : [
            `"${obs.timeWindow || obs.timestamp}"`,
            `"${obs.band}"`,
            `"${exactIntercepted}"`,
            `"${resultText}"`,
            `"${pulses}"`,
            `"${obs.range}"`,
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
  // Band 1 (bottom) maps to Y=205, Band 20 (top) maps to Y=25. Usable height = 180px.
  const slotWidth = 56;
  const paddingLeft = 24;
  const paddingRight = 50;
  const plotWidth = Math.max(680, paddingLeft + observations.length * slotWidth + paddingRight);
  const plotHeight = 230;

  // Exact mathematical mapping: Band 1 to Band 20
  const getY = (band) => {
    const b = Math.min(20, Math.max(1, Number(band) || 1));
    return 205 - ((b - 1) / 19) * 180;
  };

  // Prepare geometry for each observation step
  // Dwell segment covers the entire slot width so green (hit) and yellow (miss) lines are continuous
  const pts = observations.map((obs, i) => {
    const startX = paddingLeft + i * slotWidth;
    const endX = startX + slotWidth;
    const midX = (startX + endX) / 2;
    const bandNum = obs.bandId || (obs.band ? parseInt(obs.band.replace(/\D/g, ''), 10) : 1);
    const y = getY(bandNum);

    // Calculate Y for all actual emissions (single or simultaneous multi-emitter)
    const emissions = (obs.actualEmissions || []).map((em) => ({
      ...em,
      y: getY(em.bandId || (em.band ? parseInt(em.band.replace(/\D/g, ''), 10) : 1)),
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
            <BandStepGraphIcon className="w-[20px] h-[20px] text-primary" />
            <h3 className="font-label-md text-label-md font-semibold text-on-surface uppercase tracking-wide">
              Band vs. Time Observations
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
                  Band
                </text>
                {/* Y-Axis Grid Tick Values (Band 20 down to Band 1) */}
                {[20, 16, 12, 8, 4, 1].map((b) => (
                  <g key={`y-tick-${b}`}>
                    <text
                      x="56"
                      y={getY(b)}
                      dominantBaseline="central"
                      textAnchor="end"
                      className="text-[10px] font-mono fill-slate-500 font-medium"
                    >
                      {`Band ${b}`}
                    </text>
                    <line x1="61" y1={getY(b)} x2="68" y2={getY(b)} stroke="#CBD5E1" strokeWidth="1" />
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
                {/* Horizontal Gridlines for Spectrum Bands */}
                {[20, 16, 12, 8, 4, 1].map((b) => (
                  <line
                    key={`h-grid-${b}`}
                    x1="0"
                    y1={getY(b)}
                    x2={plotWidth}
                    y2={getY(b)}
                    stroke={b === 1 ? "#E2E8F0" : "#F1F5F9"}
                    strokeDasharray={b === 1 ? "none" : "3 3"}
                    strokeWidth={b === 1 ? 1.5 : 1}
                  />
                ))}

                {/* Vertical Time Step Boundary Gridlines */}
                {pts.length > 0 && (
                  <line
                    x1={pts[0].startX}
                    y1="20"
                    x2={pts[0].startX}
                    y2="205"
                    stroke="#F1F5F9"
                    strokeDasharray="2 3"
                    strokeWidth="1"
                  />
                )}
                {pts.map((pt) => (
                  <line
                    key={`v-grid-${pt.obs.id}`}
                    x1={pt.endX}
                    y1="20"
                    x2={pt.endX}
                    y2="205"
                    stroke="#F1F5F9"
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
                  const freqText = pt.obs.interceptedFreq && pt.obs.interceptedFreq !== '-' ? pt.obs.interceptedFreq : pt.obs.centerFreq;

                  return (
                    <g key={`dwell-group-${pt.obs.id}`}>
                      {isHit ? (
                        <g
                          style={{ cursor: 'pointer' }}
                          className="cursor-pointer"
                          onMouseEnter={(e) => {
                            const rect = sliderRef.current?.getBoundingClientRect();
                            const mouseX = e.clientX - (rect?.left || 0) + (sliderRef.current?.scrollLeft || 0);
                            setHoverInfo({
                              freq: freqText,
                              x: mouseX,
                              y: pt.y,
                            });
                          }}
                          onMouseMove={(e) => {
                            const rect = sliderRef.current?.getBoundingClientRect();
                            const mouseX = e.clientX - (rect?.left || 0) + (sliderRef.current?.scrollLeft || 0);
                            setHoverInfo({
                              freq: freqText,
                              x: mouseX,
                              y: pt.y,
                            });
                          }}
                          onMouseLeave={() => setHoverInfo(null)}
                        >
                          {/* Invisible wider hit area for easy hover targeting on horizontal line */}
                          <line
                            x1={pt.startX}
                            y1={pt.y}
                            x2={pt.endX}
                            y2={pt.y}
                            stroke="transparent"
                            strokeWidth="14"
                          />
                          <line
                            x1={pt.startX}
                            y1={pt.y}
                            x2={pt.endX}
                            y2={pt.y}
                            stroke={strokeColor}
                            strokeWidth="3.5"
                            strokeLinecap="round"
                          />
                        </g>
                      ) : (
                        <line
                          x1={pt.startX}
                          y1={pt.y}
                          x2={pt.endX}
                          y2={pt.y}
                          stroke={strokeColor}
                          strokeWidth="3.2"
                          strokeLinecap="round"
                          className="pointer-events-none"
                        />
                      )}
                    </g>
                  );
                })}

                {/* Actual Emission Markers (Environmental View: Distinct Highlight for Detected vs Missed/Unmonitored Emissions) */}
                {showActualEmissions &&
                  pts.map((pt) => (
                    <g key={`actual-emissions-group-${pt.obs.id}`}>
                      {pt.emissions.map((em, idx) => {
                        const isCaughtHere = (pt.obs.isIntercepted && pt.obs.bandId === em.bandId) || em.isDetected;
                        const emissionFreq = em.freqStr || (em.freqGhz ? `${Number(em.freqGhz).toFixed(2)} GHz` : `Band ${em.bandId}`);

                        return (
                          <g
                            key={`em-marker-${pt.obs.id}-${em.bandId}-${idx}`}
                            style={{ cursor: 'pointer' }}
                            className="cursor-pointer"
                            onMouseEnter={(e) => {
                              const rect = sliderRef.current?.getBoundingClientRect();
                              const mouseX = e.clientX - (rect?.left || 0) + (sliderRef.current?.scrollLeft || 0);
                              setHoverInfo({
                                freq: emissionFreq,
                                x: mouseX,
                                y: em.y,
                              });
                            }}
                            onMouseMove={(e) => {
                              const rect = sliderRef.current?.getBoundingClientRect();
                              const mouseX = e.clientX - (rect?.left || 0) + (sliderRef.current?.scrollLeft || 0);
                              setHoverInfo({
                                freq: emissionFreq,
                                x: mouseX,
                                y: em.y,
                              });
                            }}
                            onMouseLeave={() => setHoverInfo(null)}
                          >
                            {/* Invisible wider hit area for easy hover targeting on diamond */}
                            <circle cx={pt.midX} cy={em.y} r="10" fill="transparent" />
                            {isCaughtHere ? (
                              /* Detected Emission: Solid Emerald Diamond with Glow */
                              <polygon
                                points={`${pt.midX},${em.y - 5.5} ${pt.midX + 5.5},${em.y} ${pt.midX},${em.y + 5.5} ${pt.midX - 5.5},${em.y}`}
                                fill="#10B981"
                                stroke="#FFFFFF"
                                strokeWidth="1.2"
                                className="drop-shadow-[0_0_6px_rgba(16,185,129,0.9)] pointer-events-none"
                              />
                            ) : (
                              /* Missed / Unmonitored Emission: Muted Slate Diamond */
                              <polygon
                                points={`${pt.midX},${em.y - 4.5} ${pt.midX + 4.5},${em.y} ${pt.midX},${em.y + 4.5} ${pt.midX - 4.5},${em.y}`}
                                fill="#94A3B8"
                                fillOpacity="0.4"
                                stroke="#64748B"
                                strokeWidth="1.2"
                                className="pointer-events-none"
                              />
                            )}
                          </g>
                        );
                      })}
                    </g>
                  ))}

                {/* Leading Edge Cursor (Current Dwell Position) */}
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

                {/* Standard Cartesian X-Axis Time Ticks: 0 ms, 5 ms, 10 ms, 15 ms, ... */}
                {pts.length > 0 && (
                  <g key="x-tick-0">
                    <line x1={pts[0].startX} y1="205" x2={pts[0].startX} y2="210" stroke="#94A3B8" strokeWidth="1.2" />
                    <text
                      x={pts[0].startX}
                      y="222"
                      textAnchor="middle"
                      className="text-[10px] font-mono fill-slate-500 font-semibold select-none"
                    >
                      0 ms
                    </text>
                  </g>
                )}
                {pts.map((pt, idx) => {
                  const timeMs = pt.obs.endMs !== undefined ? pt.obs.endMs : (idx + 1) * 5;
                  return (
                    <g key={`x-tick-${pt.obs.id}`}>
                      <line x1={pt.endX} y1="205" x2={pt.endX} y2="210" stroke="#94A3B8" strokeWidth="1.2" />
                      <text
                        x={pt.endX}
                        y="222"
                        textAnchor="middle"
                        className="text-[10px] font-mono fill-slate-500 font-semibold select-none"
                      >
                        {timeMs} ms
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Clean Minimal Hover Tooltip: Shows ONLY the frequency */}
              {hoverInfo && !isDownRef.current && (
                <div
                  className="absolute pointer-events-none select-none z-30 shadow-md rounded-lg bg-slate-900/95 text-emerald-400 border border-slate-700/80 px-2.5 py-1 backdrop-blur-xs font-mono text-[12px] font-bold tracking-wide whitespace-nowrap"
                  style={{
                    left: `${Math.min(plotWidth - 55, Math.max(55, hoverInfo.x))}px`,
                    top: hoverInfo.y < 45 ? `${hoverInfo.y + 12}px` : `${hoverInfo.y - 32}px`,
                    transform: 'translateX(-50%)',
                  }}
                >
                  {hoverInfo.freq}
                </div>
              )}

              {/* Standby Message if no observations accumulated yet */}
              {observations.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-1.5 select-none pointer-events-none">
                  <BandStepGraphIcon className="w-6 h-6 text-slate-300" />
                  <span className="text-[12px] font-medium">Awaiting scan steps to plot timeline...</span>
                </div>
              )}
            </div>
          </div>

          {/* Graph Footer Bar: Interaction tip with subtle reduced-size icon and clear visual legend */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-slate-100 mt-2 text-[11px] text-slate-500 select-none">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[13px] text-primary">touch_app</span>
              <span>
                Hover over intercepted dwells or emissions to inspect exact frequency. Drag to pan timeline.
              </span>
            </div>

            {/* Dynamic Visual Legend reflecting current filter and viewMode */}
            <div className="flex flex-wrap items-center gap-4">
              {showInterceptions && (
                <div className="flex items-center gap-1.5">
                  <span className="w-4 h-1 rounded bg-[#10B981]" />
                  <span className="text-emerald-700 font-bold">HIT</span>
                </div>
              )}
              {showMisses && (
                <div className="flex items-center gap-1.5">
                  <span className="w-4 h-1 rounded bg-[#F59E0B]" />
                  <span className="text-amber-700 font-medium">Scan Miss</span>
                </div>
              )}
              {showActualEmissions && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rotate-45 bg-[#10B981] border border-white shadow-2xs" />
                    <span className="text-emerald-800 font-bold">Detected Emission</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rotate-45 bg-slate-300 border border-slate-500 shadow-2xs" />
                    <span className="text-slate-600 font-medium">Missed Emission (Unmonitored)</span>
                  </div>
                </>
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
              Recorded dwell observations stream ({filteredObservations.length} of {observations.length} total dwells)
            </span>
            <span className="font-mono text-[10px] text-slate-400">Newest events displayed first</span>
          </div>

          {/* Scrollable table container */}
          <div className="max-h-[340px] overflow-y-auto overflow-x-auto rounded-xl border border-slate-200 shadow-2xs">
            <table className="w-full text-left text-xs font-label-sm border-collapse min-w-[620px]">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 shadow-2xs">
                <tr>
                  <th className="py-2.5 px-3.5 text-slate-600 font-bold uppercase tracking-wider text-[10.5px] whitespace-nowrap">Time Window</th>
                  <th className="py-2.5 px-3.5 text-slate-600 font-bold uppercase tracking-wider text-[10.5px] whitespace-nowrap">Selected Band</th>
                  <th className="py-2.5 px-3.5 text-slate-600 font-bold uppercase tracking-wider text-[10.5px] whitespace-nowrap">Intercepted Frequency</th>
                  <th className="py-2.5 px-3.5 text-slate-600 font-bold uppercase tracking-wider text-[10.5px] whitespace-nowrap">Result</th>
                  <th className="py-2.5 px-3.5 text-slate-600 font-bold uppercase tracking-wider text-[10.5px] whitespace-nowrap">Pulses Detected</th>
                  {viewMode === 'environment' && (
                    <th className="py-2.5 px-3.5 text-emerald-800 font-bold uppercase tracking-wider text-[10.5px] whitespace-nowrap">Active Emissions in Window (Exact Freq)</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-on-surface font-mono text-[11px]">
                {filteredObservations.length > 0 ? (
                  [...filteredObservations].reverse().map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3.5 font-bold text-slate-900 whitespace-nowrap">{row.timeWindow || row.timestamp}</td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-primary">{row.band}</span>
                          <span className="text-slate-400 font-mono text-[10px]">({row.range})</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap font-mono text-[11px]">
                        {row.isIntercepted ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold shadow-2xs whitespace-nowrap">
                            {row.interceptedFreq && row.interceptedFreq !== '-' ? row.interceptedFreq : row.centerFreq}
                          </span>
                        ) : (
                          <span className="text-slate-300 font-mono text-[13px] px-2 select-none">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        {row.isIntercepted ? (
                          <span className="whitespace-nowrap inline-flex items-center justify-center px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[10px] border border-emerald-200 tracking-wide uppercase shadow-2xs">
                            HIT
                          </span>
                        ) : (
                          <span className="whitespace-nowrap inline-flex items-center justify-center px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 font-semibold text-[10px] border border-amber-200 tracking-wide uppercase">
                            SCAN MISS
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <span className={`font-mono text-[11.5px] font-bold ${row.isIntercepted ? 'text-emerald-700' : 'text-slate-400'}`}>
                          {row.pulsesDetected !== undefined ? row.pulsesDetected : (row.isIntercepted ? 3 : 0)}
                        </span>
                      </td>
                      {viewMode === 'environment' && (
                        <td className="py-2.5 px-3.5 text-slate-700 font-semibold text-[10.5px]">
                          <div className="flex flex-wrap gap-1.5 items-center">
                            {row.actualEmissions && row.actualEmissions.length > 0 ? (
                              row.actualEmissions.map((em, idx) => {
                                const isDet = (row.isIntercepted && em.bandId === row.bandId) || em.isDetected;
                                return (
                                  <span
                                    key={`em-${row.id}-${em.bandId}-${idx}`}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] border font-mono whitespace-nowrap ${
                                      isDet
                                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold'
                                        : 'bg-slate-100 text-slate-600 border-slate-200 font-normal'
                                    }`}
                                  >
                                    <span>Band {em.bandId}</span>
                                    <span className={isDet ? 'text-emerald-700 font-extrabold' : 'text-slate-600'}>
                                      ({em.freqStr || (em.freqGhz ? `${em.freqGhz.toFixed(2)} GHz` : '')})
                                    </span>
                                    <span className={`text-[9px] uppercase font-bold ml-0.5 ${isDet ? 'text-emerald-900' : 'text-slate-500'}`}>
                                      {isDet ? '• Detected' : '• Missed'}
                                    </span>
                                  </span>
                                );
                              })
                            ) : (
                              <span className="text-slate-400 font-mono">-</span>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={viewMode === 'environment' ? 6 : 5} className="py-10 text-center text-slate-400 font-sans text-xs">
                      No dwell observations matching the selected filter ({currentFilterMeta.label}).
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
