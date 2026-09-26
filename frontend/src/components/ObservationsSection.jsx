import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';

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

  const CHUNK_SIZE = 20;
  const SLOT_WIDTH = 44;

  // Graph state: graphRevealedCount starts at CHUNK_SIZE (shows latest 20 dwells).
  // Scrolling/dragging backwards prepends earlier dwells by increasing graphRevealedCount in fixed CHUNK_SIZE increments.
  const [graphRevealedCount, setGraphRevealedCount] = useState(CHUNK_SIZE);
  const [isLoadingEarlierGraph, setIsLoadingEarlierGraph] = useState(false);

  // Table state: tableVisibleCount starts at CHUNK_SIZE (20).
  // Scrolling downwards to the bottom appends earlier decisions in fixed CHUNK_SIZE increments.
  const [tableVisibleCount, setTableVisibleCount] = useState(CHUNK_SIZE);
  const [isLoadingEarlierTable, setIsLoadingEarlierTable] = useState(false);

  const sliderRef = useRef(null);
  const isDownRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const userScrolledBackRef = useRef(false);
  const prevObsLengthRef = useRef(0);

  // Robust loading lock & re-arm flags to guarantee fixed-chunk increments
  const isLoadingGraphRef = useRef(false);
  const canLoadEarlierGraphRef = useRef(true);
  const isPrependingGraphRef = useRef(false);
  const prevGraphDwellsLenRef = useRef(0);

  const isLoadingTableRef = useRef(false);
  const canLoadTableRef = useRef(true);

  const [hoverInfo, setHoverInfo] = useState(null);

  // Graph dwells: latest graphRevealedCount dwells
  const graphDwells = observations.slice(-Math.max(CHUNK_SIZE, graphRevealedCount));

  // Auto-scroll graph to leading edge ONLY if user has NOT scrolled back
  useEffect(() => {
    if (!sliderRef.current) return;
    const len = observations.length;
    if (len > prevObsLengthRef.current) {
      if (!userScrolledBackRef.current && isScanning) {
        sliderRef.current.scrollLeft = sliderRef.current.scrollWidth;
      }
    }
    prevObsLengthRef.current = len;
  }, [observations.length, isScanning]);

  // Seamless scrollLeft offset compensation when earlier dwells are prepended to the graph
  useLayoutEffect(() => {
    if (!sliderRef.current) return;
    const currentLen = graphDwells.length;
    const added = currentLen - prevGraphDwellsLenRef.current;

    if (added > 0 && isPrependingGraphRef.current) {
      const addedPx = added * SLOT_WIDTH;
      sliderRef.current.scrollLeft += addedPx;
      scrollLeftRef.current += addedPx;
      isPrependingGraphRef.current = false;
    }

    prevGraphDwellsLenRef.current = currentLen;
  }, [graphDwells.length]);

  // When a new dataset or replay is loaded, reset revealed counts
  useEffect(() => {
    if (observations.length === 0) {
      setGraphRevealedCount(CHUNK_SIZE);
      setTableVisibleCount(CHUNK_SIZE);
      userScrolledBackRef.current = false;
      canLoadEarlierGraphRef.current = true;
      canLoadTableRef.current = true;
      isLoadingGraphRef.current = false;
      isLoadingTableRef.current = false;
      prevGraphDwellsLenRef.current = 0;
    }
  }, [observations.length]);

  // Fallback to 'all' if user switched to receiver view while 'emissions' was selected
  const effectiveFilter = (viewMode === 'receiver' && filter === 'emissions') ? 'all' : filter;

  // Filter options based on viewMode
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

  // Trigger loading earlier dwells into the graph (prepending fixed chunk of 20 dwells)
  const triggerLoadEarlierGraph = useCallback(() => {
    if (isLoadingGraphRef.current || !canLoadEarlierGraphRef.current) return;
    if (graphRevealedCount >= observations.length) return;

    isLoadingGraphRef.current = true;
    canLoadEarlierGraphRef.current = false;
    setIsLoadingEarlierGraph(true);

    setTimeout(() => {
      isPrependingGraphRef.current = true;
      setGraphRevealedCount((prev) => Math.min(observations.length, prev + CHUNK_SIZE));
      setIsLoadingEarlierGraph(false);
      isLoadingGraphRef.current = false;
    }, 280);
  }, [graphRevealedCount, observations.length]);

  // Graph wheel handler (supports natural wheel panning & backward fetch)
  const handleGraphWheel = (e) => {
    if (!sliderRef.current) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    sliderRef.current.scrollLeft += delta;

    if (sliderRef.current.scrollLeft > 35) {
      canLoadEarlierGraphRef.current = true;
    }

    // If scrolled back to the left edge with delta < 0 (attempting to scroll further back)
    if (sliderRef.current.scrollLeft <= 10 && delta < 0) {
      triggerLoadEarlierGraph();
    }

    // Check if user has scrolled away from the right edge
    const isAtRightEdge = sliderRef.current.scrollLeft >= sliderRef.current.scrollWidth - sliderRef.current.clientWidth - 20;
    userScrolledBackRef.current = !isAtRightEdge;
  };

  // Mouse pan handlers for the graph (works smoothly during slow replay, fast scan, or completed)
  const handleMouseDown = (e) => {
    if (!sliderRef.current) return;
    isDownRef.current = true;
    setHoverInfo(null);
    startXRef.current = e.pageX;
    scrollLeftRef.current = sliderRef.current.scrollLeft;
  };

  const handleMouseLeaveOrUp = () => {
    isDownRef.current = false;
  };

  const handleMouseMove = (e) => {
    if (isDownRef.current && sliderRef.current) {
      e.preventDefault();
      const dx = e.pageX - startXRef.current;
      sliderRef.current.scrollLeft = scrollLeftRef.current - dx;

      if (sliderRef.current.scrollLeft > 35) {
        canLoadEarlierGraphRef.current = true;
      }

      // If user drags towards right (dx > 30, meaning pulling earlier history) while at or near the left edge
      if (sliderRef.current.scrollLeft <= 5 && dx > 30) {
        triggerLoadEarlierGraph();
      }

      const isAtRightEdge = sliderRef.current.scrollLeft >= sliderRef.current.scrollWidth - sliderRef.current.clientWidth - 20;
      userScrolledBackRef.current = !isAtRightEdge;
    }
  };

  // Table scroll handler: infinite scroll downwards to load older decisions in fixed CHUNK_SIZE (20) increments
  const handleTableScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

    if (distanceFromBottom > 50) {
      canLoadTableRef.current = true;
    }

    if (distanceFromBottom <= 15 && canLoadTableRef.current && !isLoadingTableRef.current) {
      if (tableVisibleCount < observations.length) {
        isLoadingTableRef.current = true;
        canLoadTableRef.current = false;
        setIsLoadingEarlierTable(true);

        setTimeout(() => {
          setTableVisibleCount((prev) => Math.min(observations.length, prev + CHUNK_SIZE));
          setIsLoadingEarlierTable(false);
          isLoadingTableRef.current = false;
        }, 280);
      }
    }
  };

  // Table rows: newest at top, older entries down below
  const displayedTableDwells = observations.slice(-tableVisibleCount);
  const filteredTableRows = [...displayedTableDwells].reverse().filter((obs) => {
    if (effectiveFilter === 'interceptions') return obs.isIntercepted;
    if (effectiveFilter === 'misses') return !obs.isIntercepted;
    return true;
  });

  // CSV download function
  const handleExportCSV = () => {
    const allFiltered = observations.filter((obs) => {
      if (effectiveFilter === 'interceptions') return obs.isIntercepted;
      if (effectiveFilter === 'misses') return !obs.isIntercepted;
      return true;
    });

    if (!allFiltered || allFiltered.length === 0) {
      if (onExportNotify) {
        onExportNotify("No observations matching filter to export.");
      }
      return;
    }

    const isEnv = viewMode === 'environment';
    const headers = isEnv
      ? ["Time Window", "Selected Band", "Intercepted Frequency", "Result", "Pulses Detected", "Active Emissions in Window", "Frequency Range"]
      : ["Time Window", "Selected Band", "Intercepted Frequency", "Result", "Pulses Detected", "Frequency Range"];

    const rows = allFiltered.map((obs) => {
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
      onExportNotify(`Exported ${allFiltered.length} ${viewMode} observations as CSV`);
    }
  };

  // Coordinate mapping for SVG Graph:
  // Band 1 (bottom) maps to Y=205, Band 20 (top) maps to Y=25. Usable height = 180px.
  const slotWidth = SLOT_WIDTH;
  const paddingLeft = 20;
  const paddingRight = 40;
  const plotWidth = Math.max(680, paddingLeft + graphDwells.length * slotWidth + paddingRight);
  const plotHeight = 230;

  const getY = (band) => {
    const b = Math.min(20, Math.max(1, Number(band) || 1));
    return 205 - ((b - 1) / 19) * 180;
  };

  // Prepare geometry for each dwell in graphDwells
  const pts = graphDwells.map((obs, i) => {
    const startX = paddingLeft + i * slotWidth;
    const endX = startX + slotWidth;
    const midX = (startX + endX) / 2;
    const bandNum = obs.bandId || (obs.band ? parseInt(obs.band.replace(/\D/g, ''), 10) : 1);
    const y = getY(bandNum);

    const dwellIdx = obs.dwellIndex || obs.id || (i + 1);
    const startMs = obs.startMs !== undefined ? obs.startMs : Number(((dwellIdx - 1) * 0.5).toFixed(1));
    const endMs = obs.endMs !== undefined ? obs.endMs : Number((dwellIdx * 0.5).toFixed(1));

    const emissions = (obs.actualEmissions || []).map((em) => ({
      ...em,
      y: getY(em.bandId || (em.band ? parseInt(em.band.replace(/\D/g, ''), 10) : 1)),
    }));

    return {
      obs: {
        ...obs,
        startMs,
        endMs,
      },
      startX,
      endX,
      midX,
      y,
      emissions,
    };
  });

  // Direct vertical lines connecting receiver band decisions between consecutive steps
  const verticalLines = [];
  if (effectiveFilter === 'all' && pts.length > 1) {
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      if (prev.y !== curr.y) {
        verticalLines.push({
          id: `vl-${curr.obs.id || i}`,
          x: curr.startX,
          y1: prev.y,
          y2: curr.y,
        });
      }
    }
  }

  const latestPt = pts.length > 0 ? pts[pts.length - 1] : null;
  const cursorX = latestPt ? latestPt.endX : 0;

  // Visibility of graph layers
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
        <div className="mt-4 flex flex-col w-full overflow-hidden relative" id="observation-graph-display">
          {/* Loading indicator at the start of the graph when scrolling backwards: ONLY icon, no text */}
          {isLoadingEarlierGraph && (
            <div className="absolute left-[74px] top-1/2 -translate-y-1/2 z-30 flex items-center justify-center w-8 h-8 rounded-full bg-slate-900/90 text-primary shadow-lg border border-slate-700/60 pointer-events-none select-none backdrop-blur-xs">
              <span className="material-symbols-outlined text-[17px] text-primary animate-spin">
                progress_activity
              </span>
            </div>
          )}

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

            {/* Pannable & Scrollable Graph Viewport (Free drag & scroll during and after scan) */}
            <div
              className="relative flex-1 h-[230px] bg-white overflow-x-auto cursor-grab active:cursor-grabbing select-none"
              id="graph-pan-container"
              ref={sliderRef}
              onMouseDown={handleMouseDown}
              onMouseLeave={handleMouseLeaveOrUp}
              onMouseUp={handleMouseLeaveOrUp}
              onMouseMove={handleMouseMove}
              onWheel={handleGraphWheel}
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
                {pts.map((pt, idx) => (
                  <line
                    key={`v-grid-${pt.obs.id || idx}`}
                    x1={pt.endX}
                    y1="20"
                    x2={pt.endX}
                    y2="205"
                    stroke="#F1F5F9"
                    strokeDasharray="2 3"
                    strokeWidth="1"
                  />
                ))}

                {/* Direct vertical lines connecting receiver band decisions */}
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
                {pts.map((pt, idx) => {
                  const isHit = pt.obs.isIntercepted;

                  if (isHit && !showInterceptions) return null;
                  if (!isHit && !showMisses) return null;

                  const strokeColor = isHit ? '#10B981' : '#F59E0B';
                  const freqText = pt.obs.interceptedFreq && pt.obs.interceptedFreq !== '-' ? pt.obs.interceptedFreq : pt.obs.centerFreq;

                  return (
                    <g key={`dwell-group-${pt.obs.id || idx}`}>
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

                {/* Actual Emission Markers (Environmental View) */}
                {showActualEmissions &&
                  pts.map((pt, pIdx) => (
                    <g key={`actual-emissions-group-${pt.obs.id || pIdx}`}>
                      {pt.emissions.map((em, idx) => {
                        const isCaughtHere = (pt.obs.isIntercepted && pt.obs.bandId === em.bandId) || em.isDetected;
                        const emissionFreq = em.freqStr || (em.freqGhz ? `${Number(em.freqGhz).toFixed(2)} GHz` : `Band ${em.bandId}`);

                        return (
                          <g
                            key={`em-marker-${pt.obs.id || pIdx}-${em.bandId}-${idx}`}
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
                            <circle cx={pt.midX} cy={em.y} r="10" fill="transparent" />
                            {isCaughtHere ? (
                              <polygon
                                points={`${pt.midX},${em.y - 5.5} ${pt.midX + 5.5},${em.y} ${pt.midX},${em.y + 5.5} ${pt.midX - 5.5},${em.y}`}
                                fill="#10B981"
                                stroke="#FFFFFF"
                                strokeWidth="1.2"
                                className="drop-shadow-[0_0_6px_rgba(16,185,129,0.9)] pointer-events-none"
                              />
                            ) : (
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

                {/* Standard Cartesian X-Axis Time Ticks */}
                {pts.length > 0 && (
                  <g key="x-tick-start">
                    <line x1={pts[0].startX} y1="205" x2={pts[0].startX} y2="210" stroke="#94A3B8" strokeWidth="1.2" />
                    <text
                      x={pts[0].startX}
                      y="222"
                      textAnchor="middle"
                      className="text-[10px] font-mono fill-slate-500 font-semibold select-none"
                    >
                      {`${pts[0].obs.startMs.toFixed(1)} ms`}
                    </text>
                  </g>
                )}
                {pts.map((pt, idx) => {
                  const timeMs = pt.obs.endMs;
                  const isLast = idx === pts.length - 1;
                  const totalDwells = pts.length;

                  // Dynamic Tick Labeling:
                  // For normal window (<= 25 dwells, 0.5 ms dwell steps): labels every 1.0 ms or on last dwell.
                  // When dragged backwards (> 25 dwells): labels at 5.0 ms intervals (e.g. 5, 10, 15, 20 ms).
                  let showLabel = false;
                  if (totalDwells <= 25) {
                    showLabel = Math.round(timeMs * 10) % 10 === 0 || isLast;
                  } else {
                    showLabel = Math.round(timeMs * 10) % 50 === 0 || isLast;
                  }

                  const labelStr = `${timeMs.toFixed(1)} ms`;

                  return (
                    <g key={`x-tick-${pt.obs.id || idx}`}>
                      <line x1={pt.endX} y1="205" x2={pt.endX} y2="210" stroke="#94A3B8" strokeWidth="1.2" />
                      {showLabel && (
                        <text
                          x={pt.endX}
                          y="222"
                          textAnchor="middle"
                          className="text-[10px] font-mono fill-slate-500 font-semibold select-none"
                        >
                          {labelStr}
                        </text>
                      )}
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
              {graphDwells.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-1.5 select-none pointer-events-none">
                  <BandStepGraphIcon className="w-6 h-6 text-slate-300" />
                  <span className="text-[12px] font-medium">Awaiting scan steps to plot timeline...</span>
                </div>
              )}
            </div>
          </div>

          {/* Graph Footer Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-slate-100 mt-2 text-[11px] text-slate-500 select-none">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[13px] text-primary">touch_app</span>
              <span>
                Hover over intercepted dwells or emissions to inspect exact frequency. Drag or scroll backwards to view earlier history.
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
              Recorded dwell observations stream ({filteredTableRows.length} shown • {observations.length} total dwells)
            </span>
            <span className="font-mono text-[10px] text-slate-400">Scroll downwards to load previous decisions</span>
          </div>

          {/* Scrollable table container with infinite scroll downwards */}
          <div
            className="max-h-[340px] overflow-y-auto overflow-x-auto rounded-xl border border-slate-200 shadow-2xs"
            id="observation-table-scroll-area"
            onScroll={handleTableScroll}
          >
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
                {filteredTableRows.length > 0 ? (
                  filteredTableRows.map((row) => (
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
                          <span className="text-slate-400 font-medium">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        {row.isIntercepted ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold shadow-2xs">
                            HIT
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-medium shadow-2xs">
                            SCAN MISS
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap font-mono">
                        <span className="font-semibold text-slate-700">{row.pulsesDetected}</span>
                      </td>
                      {viewMode === 'environment' && (
                        <td className="py-2.5 px-3.5">
                          <div className="flex flex-wrap items-center gap-1">
                            {row.actualEmissions && row.actualEmissions.length > 0 ? (
                              row.actualEmissions.map((em, idx) => (
                                <span
                                  key={`table-em-${row.id}-${em.bandId}-${idx}`}
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                    em.isDetected
                                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold'
                                      : 'bg-slate-50 text-slate-600 border border-slate-200 font-medium'
                                  }`}
                                >
                                  <span>Band {em.bandId}</span>
                                  <span>({em.freqStr})</span>
                                  <span className={em.isDetected ? 'text-emerald-700 font-bold' : 'text-slate-400'}>
                                    [{em.isDetected ? 'Caught' : 'Missed'}]
                                  </span>
                                </span>
                              ))
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={viewMode === 'environment' ? 6 : 5} className="py-8 text-center text-slate-400 select-none">
                      No dwell records in this window matching the selected filter.
                    </td>
                  </tr>
                )}
                {/* Inline loading indicator at the bottom of the table: ONLY spinning icon, no text */}
                {isLoadingEarlierTable && (
                  <tr>
                    <td colSpan={viewMode === 'environment' ? 6 : 5} className="py-3 bg-slate-50/90 border-t border-slate-200 text-center">
                      <div className="inline-flex items-center justify-center">
                        <span className="material-symbols-outlined text-[18px] text-primary animate-spin">
                          progress_activity
                        </span>
                      </div>
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
