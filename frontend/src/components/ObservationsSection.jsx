import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import { downloadFullCsv } from '../services/telemetryService';

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
  totalDwells = 0,
  isScanning = false,
  isCompleted = false,
  isSlowReplay = false,
  hasDataset = false,
  viewMode = 'receiver', // 'receiver' | 'environment'
  onExportNotify,
  onLoadEarlier,
}) {
  const isInteractive = isCompleted || isSlowReplay;

  const [displayMode, setDisplayMode] = useState('graph'); // 'graph' | 'table'
  const [tableShowInterceptedOnly, setTableShowInterceptedOnly] = useState(false);
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const CHUNK_SIZE = 20;
  const SLOT_WIDTH = 44;
  const PADDING_LEFT = 20;

  // Graph state: graphRevealedCount starts at CHUNK_SIZE (shows latest 20 dwells).
  const [graphRevealedCount, setGraphRevealedCount] = useState(CHUNK_SIZE);
  const [isLoadingEarlierGraph, setIsLoadingEarlierGraph] = useState(false);
  const [isJumpingToHit, setIsJumpingToHit] = useState(false);
  const [highlightedHitDwellId, setHighlightedHitDwellId] = useState(null);
  const highlightTimeoutRef = useRef(null);
  const pendingScrollToDwellIndexRef = useRef(null);
  const lastJumpedHitIdRef = useRef(null);

  // Table state: tableVisibleCount starts at CHUNK_SIZE (20).
  const [tableVisibleCount, setTableVisibleCount] = useState(CHUNK_SIZE);
  const [isLoadingEarlierTable, setIsLoadingEarlierTable] = useState(false);
  const [userScrolledBack, setUserScrolledBack] = useState(false);
  const [tableScrolledDown, setTableScrolledDown] = useState(false);

  const sliderRef = useRef(null);
  const isDownRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const userScrolledBackRef = useRef(false);
  const prevObsLengthRef = useRef(0);
  const observationsRef = useRef(observations);

  useEffect(() => {
    observationsRef.current = observations;
  }, [observations]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    };
  }, []);

  // Robust loading lock & re-arm flags to guarantee fixed-chunk increments
  const isLoadingGraphRef = useRef(false);
  const canLoadEarlierGraphRef = useRef(true);
  const isPrependingGraphRef = useRef(false);
  const prevGraphDwellsLenRef = useRef(0);

  const isLoadingTableRef = useRef(false);
  const canLoadTableRef = useRef(true);

  const [hoverInfo, setHoverInfo] = useState(null);

  // Graph dwells: always continuous latest graphRevealedCount dwells from full timeline
  const graphDwells = observations.slice(-Math.max(CHUNK_SIZE, graphRevealedCount));

  // Table source: either all dwells or strictly intercepted dwells
  const tableSource = useMemo(() => {
    return tableShowInterceptedOnly
      ? observations.filter((obs) => Boolean(obs.isIntercepted))
      : observations;
  }, [observations, tableShowInterceptedOnly]);

  const displayedTableDwells = tableSource.slice(-tableVisibleCount);
  const filteredTableRows = [...displayedTableDwells].reverse();

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

  // Seamless scrollLeft offset compensation or smooth centering on jump
  useLayoutEffect(() => {
    if (!sliderRef.current) return;
    const currentLen = graphDwells.length;
    const added = currentLen - prevGraphDwellsLenRef.current;

    // Check if there is a pending jump to a hit dwell
    if (pendingScrollToDwellIndexRef.current != null) {
      const targetIdx = graphDwells.findIndex(
        (d) => (d.dwellIndex || d.id) === pendingScrollToDwellIndexRef.current
      );
      if (targetIdx !== -1) {
        const midX = PADDING_LEFT + targetIdx * SLOT_WIDTH + SLOT_WIDTH / 2;
        const targetScrollLeft = Math.max(0, midX - sliderRef.current.clientWidth / 2);
        sliderRef.current.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
        scrollLeftRef.current = targetScrollLeft;
        userScrolledBackRef.current = true;
        pendingScrollToDwellIndexRef.current = null;
      }
    } else if (added > 0 && isPrependingGraphRef.current) {
      const addedPx = added * SLOT_WIDTH;
      sliderRef.current.scrollLeft += addedPx;
      scrollLeftRef.current += addedPx;
      isPrependingGraphRef.current = false;
    }

    prevGraphDwellsLenRef.current = currentLen;
  }, [graphDwells.length, graphDwells]);

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
      setIsJumpingToHit(false);
      setHighlightedHitDwellId(null);
      pendingScrollToDwellIndexRef.current = null;
      lastJumpedHitIdRef.current = null;
      setUserScrolledBack(false);
      setTableScrolledDown(false);
      prevGraphDwellsLenRef.current = 0;
    }
  }, [observations.length]);

  // Helper to ensure enough matching entries exist in table cache when tableShowInterceptedOnly is true
  const ensureTableEntries = useCallback(async (targetCount) => {
    if (!onLoadEarlier) return;
    if (!tableShowInterceptedOnly) {
      if (observations.length < targetCount) {
        await onLoadEarlier(CHUNK_SIZE);
      }
      return;
    }
    let attempts = 0;
    while (attempts < 6) {
      const currentHits = observations.filter((o) => Boolean(o.isIntercepted));
      if (currentHits.length >= targetCount) break;
      const earliestIdx = observations[0]?.dwellIndex || 1;
      if (earliestIdx <= 1) break;
      const needed = Math.max(CHUNK_SIZE, (targetCount - currentHits.length) * 3);
      const res = await onLoadEarlier(needed);
      const added = typeof res === 'number' ? res : (res?.addedCount || 0);
      if (res && res.observations) {
        observationsRef.current = res.observations;
      }
      if (!added || added === 0) break;
      attempts++;
    }
  }, [observations, tableShowInterceptedOnly, onLoadEarlier]);

  // Automatically load earlier entries into table if empty or below CHUNK_SIZE
  useEffect(() => {
    if (displayMode !== 'table' || !isInteractive || isLoadingTableRef.current) return;
    const earliestIdx = observations[0]?.dwellIndex || 1;
    if (earliestIdx <= 1) return;

    if (displayedTableDwells.length < CHUNK_SIZE) {
      isLoadingTableRef.current = true;
      setIsLoadingEarlierTable(true);
      ensureTableEntries(CHUNK_SIZE)
        .then(() => {
          setTableVisibleCount((prev) => Math.max(prev, CHUNK_SIZE));
        })
        .catch((err) => console.error('Auto-load table error:', err))
        .finally(() => {
          setIsLoadingEarlierTable(false);
          isLoadingTableRef.current = false;
        });
    }
  }, [displayMode, isInteractive, tableShowInterceptedOnly, displayedTableDwells.length, observations.length, ensureTableEntries]);

  // Trigger loading earlier dwells into the graph (prepending fixed chunk of 20 dwells)
  const triggerLoadEarlierGraph = useCallback(async () => {
    if (!isInteractive || isLoadingGraphRef.current || !canLoadEarlierGraphRef.current) return;

    isLoadingGraphRef.current = true;
    canLoadEarlierGraphRef.current = false;
    setIsLoadingEarlierGraph(true);

    try {
      if (graphRevealedCount >= observations.length && onLoadEarlier) {
        const res = await onLoadEarlier(CHUNK_SIZE);
        if (res && res.observations) {
          observationsRef.current = res.observations;
        }
      }
      isPrependingGraphRef.current = true;
      setGraphRevealedCount((prev) => prev + CHUNK_SIZE);
    } catch (err) {
      console.error('Failed to load earlier graph dwells:', err);
    } finally {
      setIsLoadingEarlierGraph(false);
      isLoadingGraphRef.current = false;
    }
  }, [isInteractive, graphRevealedCount, observations.length, onLoadEarlier]);

  // Jump to Previous Interception in Graph: Steps backward through RF hits, loading earlier chunks as needed
  const handleJumpToPreviousInterception = useCallback(async () => {
    if (!isInteractive || isJumpingToHit) return;
    setIsJumpingToHit(true);

    try {
      let currentObs = observationsRef.current && observationsRef.current.length > 0
        ? observationsRef.current
        : observations;

      if (!currentObs || currentObs.length === 0) {
        if (onExportNotify) onExportNotify("No observations recorded yet.");
        return;
      }

      let hitObs = currentObs.filter((o) => Boolean(o.isIntercepted));
      const currentHitId = lastJumpedHitIdRef.current;
      let targetHit = null;

      if (currentHitId == null) {
        // First jump: find the latest hit — keep loading earlier chunks until a hit is found or data runs out
        let attempts = 0;
        while (hitObs.length === 0 && onLoadEarlier && attempts < 50) {
          const earliestIdx = currentObs[0]?.dwellIndex || 1;
          if (earliestIdx <= 1) break;

          const res = await onLoadEarlier(CHUNK_SIZE);
          const added = typeof res === 'number' ? res : (res?.addedCount || 0);
          if (res && res.observations) {
            observationsRef.current = res.observations;
            currentObs = res.observations;
          } else {
            currentObs = observationsRef.current && observationsRef.current.length > 0
              ? observationsRef.current
              : observations;
          }
          if (!added || added === 0) break;
          hitObs = currentObs.filter((o) => Boolean(o.isIntercepted));
          attempts++;
        }

        if (hitObs.length === 0) {
          if (onExportNotify) onExportNotify("No RF interceptions found in the dataset.");
          return;
        }

        targetHit = hitObs[hitObs.length - 1];
      } else {
        // Step backward: find earlier hit before currentHitId — keep loading until one is found or data runs out
        let earlierHits = hitObs.filter((h) => (h.dwellIndex || h.id) < currentHitId);

        let attempts = 0;
        while (earlierHits.length === 0 && onLoadEarlier && attempts < 50) {
          const earliestIdx = currentObs[0]?.dwellIndex || 1;
          if (earliestIdx <= 1) break;

          const res = await onLoadEarlier(CHUNK_SIZE);
          const added = typeof res === 'number' ? res : (res?.addedCount || 0);
          if (res && res.observations) {
            observationsRef.current = res.observations;
            currentObs = res.observations;
          } else {
            currentObs = observationsRef.current && observationsRef.current.length > 0
              ? observationsRef.current
              : observations;
          }
          if (!added || added === 0) break;
          hitObs = currentObs.filter((o) => Boolean(o.isIntercepted));
          earlierHits = hitObs.filter((h) => (h.dwellIndex || h.id) < currentHitId);
          attempts++;
        }

        if (earlierHits.length > 0) {
          targetHit = earlierHits[earlierHits.length - 1];
        } else {
          if (onExportNotify) {
            onExportNotify("Reached earliest recorded hit in simulation.");
          }
          targetHit = hitObs.find((h) => (h.dwellIndex || h.id) === currentHitId) || hitObs[0];
        }
      }

      if (!targetHit) return;

      const targetHitId = targetHit.dwellIndex || targetHit.id;
      lastJumpedHitIdRef.current = targetHitId;

      const targetIdxInObs = currentObs.findIndex(
        (o) => (o.dwellIndex || o.id) === targetHitId
      );

      if (targetIdxInObs === -1) return;

      const distFromEnd = currentObs.length - targetIdxInObs;

      if (graphRevealedCount < distFromEnd + 5) {
        const neededCount = Math.max(
          CHUNK_SIZE,
          Math.ceil((distFromEnd + 10) / CHUNK_SIZE) * CHUNK_SIZE
        );
        isPrependingGraphRef.current = false;
        setGraphRevealedCount(neededCount);
      }

      userScrolledBackRef.current = true;
      setUserScrolledBack(true);
      pendingScrollToDwellIndexRef.current = targetHitId;

      setHighlightedHitDwellId(targetHitId);
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedHitDwellId(null);
      }, 3500);

      const currentGraphDwells = currentObs.slice(-Math.max(CHUNK_SIZE, graphRevealedCount));
      const targetGraphIdx = currentGraphDwells.findIndex(
        (d) => (d.dwellIndex || d.id) === targetHitId
      );

      if (targetGraphIdx !== -1 && sliderRef.current) {
        const midX = PADDING_LEFT + targetGraphIdx * SLOT_WIDTH + SLOT_WIDTH / 2;
        const targetScrollLeft = Math.max(0, midX - sliderRef.current.clientWidth / 2);
        sliderRef.current.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
        scrollLeftRef.current = targetScrollLeft;
        pendingScrollToDwellIndexRef.current = null;
      }
    } catch (err) {
      console.error('Failed to jump to previous interception:', err);
    } finally {
      setIsJumpingToHit(false);
    }
  }, [isInteractive, isJumpingToHit, observations, onLoadEarlier, graphRevealedCount, onExportNotify]);

  // Graph wheel handler (supports natural wheel panning & backward fetch)
  const handleGraphWheel = (e) => {
    if (!isInteractive || !sliderRef.current) return;
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
    setUserScrolledBack(!isAtRightEdge || graphRevealedCount > CHUNK_SIZE);
    if (isAtRightEdge && graphRevealedCount <= CHUNK_SIZE) {
      lastJumpedHitIdRef.current = null;
    }
  };

  // Mouse pan handlers for the graph (only active when isInteractive)
  const handleMouseDown = (e) => {
    if (!isInteractive || !sliderRef.current) return;
    isDownRef.current = true;
    setHoverInfo(null);
    startXRef.current = e.pageX;
    scrollLeftRef.current = sliderRef.current.scrollLeft;
  };

  const handleMouseLeaveOrUp = () => {
    isDownRef.current = false;
  };

  const handleMouseMove = (e) => {
    if (!isInteractive || !isDownRef.current || !sliderRef.current) return;
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
    setUserScrolledBack(!isAtRightEdge || graphRevealedCount > CHUNK_SIZE);
    if (isAtRightEdge && graphRevealedCount <= CHUNK_SIZE) {
      lastJumpedHitIdRef.current = null;
    }
  };

  // Jump back to latest scan timeline (last 20 dwells)
  const handleJumpToLatest = () => {
    lastJumpedHitIdRef.current = null;
    userScrolledBackRef.current = false;
    setUserScrolledBack(false);
    setGraphRevealedCount(CHUNK_SIZE);
    if (sliderRef.current) {
      sliderRef.current.scrollTo({
        left: sliderRef.current.scrollWidth,
        behavior: 'smooth',
      });
      scrollLeftRef.current = sliderRef.current.scrollWidth;
    }
  };

  // Jump back to top of table (latest 20 entries)
  const handleJumpToLatestTable = () => {
    setTableVisibleCount(CHUNK_SIZE);
    setTableScrolledDown(false);
    const tableEl = document.getElementById('observation-table-scroll-area');
    if (tableEl) {
      tableEl.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Table scroll handler: infinite scroll downwards to load older decisions in fixed CHUNK_SIZE (20) increments
  const handleTableScroll = async (e) => {
    if (!isInteractive) return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

    setTableScrolledDown(scrollTop > 40 || tableVisibleCount > CHUNK_SIZE);

    if (distanceFromBottom > 50) {
      canLoadTableRef.current = true;
    }

    if (distanceFromBottom <= 35 && canLoadTableRef.current && !isLoadingTableRef.current) {
      isLoadingTableRef.current = true;
      canLoadTableRef.current = false;
      setIsLoadingEarlierTable(true);
      try {
        await ensureTableEntries(tableVisibleCount + CHUNK_SIZE);
        setTableVisibleCount((prev) => prev + CHUNK_SIZE);
      } catch (err) {
        console.error('Failed to load earlier table dwells:', err);
      } finally {
        setIsLoadingEarlierTable(false);
        isLoadingTableRef.current = false;
      }
    }
  };

  // CSV download function: calls backend to stream complete dataset (only available after simulation is done)
  const handleExportCSV = async () => {
    if (!isCompleted || isExporting) return;
    setIsExporting(true);

    const exportFilter = (displayMode === 'table' && tableShowInterceptedOnly) ? 'interceptions' : 'all';

    try {
      await downloadFullCsv(viewMode, exportFilter);
      if (onExportNotify) {
        onExportNotify(
          exportFilter === 'interceptions'
            ? `Exported complete ${viewMode} interceptions dataset as CSV`
            : `Exported complete ${viewMode} simulation dataset as CSV`
        );
      }
    } catch (err) {
      console.warn('Backend CSV download failed, falling back to local snapshot:', err);
      exportLocalCSV();
    } finally {
      setIsExporting(false);
    }
  };

  const exportLocalCSV = () => {
    const isInterceptedOnly = displayMode === 'table' && tableShowInterceptedOnly;
    const allFiltered = isInterceptedOnly
      ? observations.filter((obs) => Boolean(obs.isIntercepted))
      : observations;

    if (!allFiltered || allFiltered.length === 0) {
      if (onExportNotify) {
        onExportNotify("No observations to export.");
      }
      return;
    }

    const isEnv = viewMode === 'environment';
    const headers = isEnv
      ? ["Time Window", "Selected Band", "Intercepted Frequency", "Result", "Reward", "Pulses Detected", "Active Emissions in Window", "Frequency Range"]
      : ["Time Window", "Selected Band", "Intercepted Frequency", "Result", "Reward", "Pulses Detected", "Frequency Range"];

    const rows = allFiltered.map((obs) => {
      const hasEm = Boolean(obs.hasEmission || (obs.actualEmissions && obs.actualEmissions.length > 0) || (obs.actualBands && obs.actualBands.length > 0));
      const resultText = obs.isIntercepted
        ? 'HIT'
        : (isEnv ? (hasEm ? 'SCAN MISS' : 'QUIET MISS') : 'SCAN MISS');
      const pulses = obs.pulsesDetected !== undefined ? obs.pulsesDetected : (obs.isIntercepted ? 3 : 0);
      const exactIntercepted = obs.isIntercepted ? (obs.interceptedFreq && obs.interceptedFreq !== '-' ? obs.interceptedFreq : obs.centerFreq) : '-';
      const dwellReward = obs.reward !== undefined ? Number(obs.reward) : (obs.isIntercepted ? 0.02 : -0.01);
      const rewardStr = dwellReward > 0 ? `+${dwellReward.toFixed(2)}` : dwellReward.toFixed(2);

      const emissionStr = obs.actualEmissions && obs.actualEmissions.length > 0
        ? obs.actualEmissions.map((e) => `Band ${e.bandId} (${e.freqStr}) [${e.isDetected ? 'Detected' : 'Missed'}]`).join(' • ')
        : (obs.actualFreqStr || '-');

      return isEnv
        ? [
            `"${obs.timeWindow || obs.timestamp}"`,
            `"${obs.band}"`,
            `"${exactIntercepted}"`,
            `"${resultText}"`,
            `"${rewardStr}"`,
            `"${pulses}"`,
            `"${emissionStr}"`,
            `"${obs.range}"`,
          ]
        : [
            `"${obs.timeWindow || obs.timestamp}"`,
            `"${obs.band}"`,
            `"${exactIntercepted}"`,
            `"${resultText}"`,
            `"${rewardStr}"`,
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
    link.setAttribute("download", `adaptive_ml_observations_${viewMode}_${isInterceptedOnly ? 'interceptions' : 'all'}_${Date.now()}.csv`);
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
  if (pts.length > 1) {
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      if (prev.y !== curr.y) {
        verticalLines.push({
          id: `vl-${curr.obs.id || i}-${i}`,
          x: curr.startX,
          y1: prev.y,
          y2: curr.y,
        });
      }
    }
  }

  const latestPt = pts.length > 0 ? pts[pts.length - 1] : null;
  const cursorX = latestPt ? latestPt.endX : 0;

  // Visibility of graph layers (graph displays true continuous scan timeline)
  const showInterceptions = true;
  const showMisses = true;
  const showActualEmissions = viewMode === 'environment';

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-slate-200 p-5 sm:p-6 flex flex-col">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 relative z-30">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <BandStepGraphIcon className="w-[20px] h-[20px] text-primary" />
            <h3 className="text-[18px] font-semibold text-on-surface tracking-tight">
              Band vs. Time Observations
            </h3>
          </div>
          <p className="text-[13px] text-slate-500 font-normal pl-7 leading-[20px]">
            Adaptive ML scan timeline
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Jump to Previous Interception Button (Only in Graph View) */}
          {displayMode === 'graph' && (
            <button
              type="button"
              onClick={handleJumpToPreviousInterception}
              disabled={!isInteractive || isJumpingToHit || observations.length === 0}
              className="group flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/60 text-slate-700 hover:text-emerald-900 font-label-md text-[13px] sm:text-[14px] font-medium transition-all cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
              title={!isInteractive ? "Available after live simulation completes or in replay mode" : "Step backward to earlier RF interceptions in timeline"}
              id="btn-jump-prev-hit"
            >
              {isJumpingToHit ? (
                <span className="material-symbols-outlined text-[15px] text-emerald-600 animate-spin">
                  progress_activity
                </span>
              ) : (
                <span className="material-symbols-outlined text-[15px] text-emerald-600 anim-prev-hit-hover">
                  skip_previous
                </span>
              )}
              <span>{isJumpingToHit ? 'Finding Hit...' : 'Previous Hit'}</span>
            </button>
          )}

          {/* View Switcher Pill Dropdown (Graph View vs Tabular View) */}
          <div className="relative inline-block">
            <button
              className="group flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-200 shadow-2xs text-primary font-label-md text-[13px] sm:text-[14px] font-medium hover:border-primary/50 transition-all cursor-pointer"
              id="view-graph-btn"
              type="button"
              onClick={() => {
                setIsViewDropdownOpen((prev) => !prev);
              }}
            >
              <span className={`material-symbols-outlined text-[16px] text-primary ${displayMode === 'graph' ? 'anim-graph-hover' : 'anim-table-hover'}`} id="graph-view-icon">
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
              <div className="absolute right-0 top-full mt-2 w-36 bg-white border border-slate-200 rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.08)] p-1.5 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                <button
                  className={`group/opt w-full flex items-center justify-between px-3 py-2 rounded-lg font-label-md text-[13px] text-left transition-colors cursor-pointer ${
                    displayMode === 'graph'
                      ? 'bg-slate-50 text-primary font-semibold'
                      : 'text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900'
                  }`}
                  onClick={() => {
                    setDisplayMode('graph');
                    setIsViewDropdownOpen(false);
                  }}
                  type="button"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-primary anim-graph-hover">show_chart</span>
                    <span>Graph View</span>
                  </div>
                  {displayMode === 'graph' && (
                    <span className="material-symbols-outlined text-[14px]">check</span>
                  )}
                </button>
                <button
                  className={`group/opt w-full flex items-center justify-between px-3 py-2 rounded-lg font-label-md text-[13px] text-left transition-colors cursor-pointer ${
                    displayMode === 'table'
                      ? 'bg-slate-50 text-primary font-semibold'
                      : 'text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900'
                  }`}
                  onClick={() => {
                    setDisplayMode('table');
                    setIsViewDropdownOpen(false);
                  }}
                  type="button"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[15px] text-primary anim-table-hover">table_chart</span>
                    <span>Tabular View</span>
                  </div>
                  {displayMode === 'table' && (
                    <span className="material-symbols-outlined text-[14px]">check</span>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Export CSV Button with Loading State and Hover Tooltip */}
          <div className="relative group">
            <button
              className="group flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-50 text-slate-700 hover:text-slate-900 font-label-md text-[13px] sm:text-[14px] font-semibold border border-slate-200 hover:bg-slate-100 transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleExportCSV}
              type="button"
              disabled={!isCompleted || isExporting}
              title={!isCompleted ? "Export CSV is available after the simulation completes" : undefined}
            >
              {isExporting ? (
                <span className="material-symbols-outlined text-[15px] text-primary animate-spin">
                  progress_activity
                </span>
              ) : (
                <span className="material-symbols-outlined text-[15px] text-primary anim-download-hover">download</span>
              )}
              <span>{isExporting ? 'Exporting All...' : 'Export CSV'}</span>
            </button>
            {/* Hover Tooltip explaining full data download */}
            <div className="absolute right-0 top-full mt-1.5 hidden group-hover:flex flex-col items-end z-50 pointer-events-none">
              <div className="px-2.5 py-1 rounded-md bg-slate-900/95 text-white text-[11px] font-medium tracking-wide shadow-md whitespace-nowrap">
                {!isCompleted
                  ? 'Available after simulation completes'
                  : displayMode === 'table' && tableShowInterceptedOnly
                  ? 'Downloads all intercepted dwells (all hits) from backend'
                  : 'Downloads complete dataset (all decisions) from backend'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Graph Container Display */}
      {displayMode === 'graph' && (
        <div className="mt-4 flex flex-col w-full overflow-hidden relative" id="observation-graph-display">
          {/* Go to Latest Entries Arrow Button (Rightmost end of graph) */}
          {userScrolledBack && (
            <button
              type="button"
              onClick={handleJumpToLatest}
              className="absolute right-2.5 top-[115px] -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-slate-900/90 hover:bg-slate-900 text-white shadow-xl border border-slate-700/80 flex items-center justify-center transition-all cursor-pointer hover:scale-110 active:scale-95 backdrop-blur-xs group"
              title="Go to latest emissions"
              id="btn-graph-jump-latest"
            >
              <span className="material-symbols-outlined text-[19px] text-white group-hover:translate-x-0.5 transition-transform">
                arrow_forward
              </span>
            </button>
          )}
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
                {/* Y-Axis Grid Tick Values (Band 20 down to Band 1) */}
                {[20, 16, 12, 8, 4, 1].map((b) => (
                  <g key={`y-tick-${b}`}>
                    <text
                      x="56"
                      y={getY(b)}
                      dominantBaseline="central"
                      textAnchor="end"
                      className="text-[11px] font-mono fill-slate-500 font-medium"
                    >
                      {`Band ${b}`}
                    </text>
                    <line x1="61" y1={getY(b)} x2="68" y2={getY(b)} stroke="#CBD5E1" strokeWidth="1" />
                  </g>
                ))}
              </svg>
            </div>

            {/* Pannable & Scrollable Graph Viewport (Interactive only when completed or slow replay) */}
            <div
              className={`relative flex-1 h-[230px] bg-white overflow-x-auto select-none ${isInteractive ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
              id="graph-pan-container"
              ref={sliderRef}
              title={!isInteractive ? "Live stream active • Panning & scrolling will unlock when simulation completes" : "Click and drag to pan through earlier observation history"}
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

                {/* Receiver Dwell Segments: Green for Hits, Orange for Scan Miss with Emission, Slate for Quiet Miss */}
                {pts.map((pt, idx) => {
                  const isHit = pt.obs.isIntercepted;
                  const hasEmissionThisDwell = Boolean(pt.obs.hasEmission || (pt.obs.actualEmissions && pt.obs.actualEmissions.length > 0) || (pt.obs.actualBands && pt.obs.actualBands.length > 0));
                  const isEnvView = viewMode === 'environment';

                  if (isHit && !showInterceptions) return null;
                  if (!isHit && !showMisses) return null;

                  // Green for hit; in env view: amber = scan miss with emission, slate = quiet idle miss
                  // In receiver view: all misses look the same (can't tell from receiver POV)
                  const strokeColor = isHit ? '#10B981' : (isEnvView ? (hasEmissionThisDwell ? '#F59E0B' : '#94A3B8') : '#F59E0B');
                  const freqText = pt.obs.interceptedFreq && pt.obs.interceptedFreq !== '-' ? pt.obs.interceptedFreq : pt.obs.centerFreq;
                  const isHighlighted = (pt.obs.dwellIndex || pt.obs.id) === highlightedHitDwellId;

                  return (
                    <g key={`dwell-group-${pt.obs.id || idx}-${idx}`}>
                      {/* Pulsing Beacon & Badge if this is the jumped-to hit */}
                      {isHighlighted && (
                        <g key={`hit-beacon-${pt.obs.id || idx}-${idx}`} className="pointer-events-none">
                          <line
                            x1={pt.midX}
                            y1="22"
                            x2={pt.midX}
                            y2="204"
                            stroke="#10B981"
                            strokeWidth="1.5"
                            strokeDasharray="3 3"
                            opacity="0.65"
                          />
                          <rect
                            x={pt.startX - 4}
                            y={pt.y - 8}
                            width={slotWidth + 8}
                            height="16"
                            rx="8"
                            fill="#10B981"
                            fillOpacity="0.22"
                            stroke="#10B981"
                            strokeWidth="1.8"
                            className="animate-pulse"
                          />

                          <g transform={`translate(${pt.midX}, ${Math.max(22, pt.y - 18)})`}>
                            <rect
                              x="-38"
                              y="-14"
                              width={76}
                              height="17"
                              rx="4"
                              fill="#064E3B"
                              stroke="#34D399"
                              strokeWidth="1"
                              className="drop-shadow-sm"
                            />
                            <text
                              x="0"
                              y="-2"
                              textAnchor="middle"
                              fill="#A7F3D0"
                              className="text-[11px] font-sans font-semibold uppercase tracking-wider select-none"
                            >
                              Previous Hit
                            </text>
                          </g>
                        </g>
                      )}
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
                                className="pointer-events-none"
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
                {(() => {
                  const totalDwells = pts.length;
                  let tickIntervalMs = 1.0;
                  if (totalDwells > 150) {
                    tickIntervalMs = 10.0;
                  } else if (totalDwells > 25) {
                    tickIntervalMs = 5.0;
                  } else {
                    tickIntervalMs = 1.0;
                  }

                  let lastLabelX = -999;
                  const MIN_LABEL_DISTANCE_PX = 80;

                  return (
                    <>
                      {/* Starting axis tick mark */}
                      {pts.length > 0 && (
                        <line
                          x1={pts[0].startX}
                          y1="205"
                          x2={pts[0].startX}
                          y2="210"
                          stroke="#94A3B8"
                          strokeWidth="1.2"
                        />
                      )}
                      {pts.map((pt, idx) => {
                        const timeMs = pt.obs.endMs;
                        const intervalTenths = Math.round(tickIntervalMs * 10);
                        const timeTenths = Math.round(timeMs * 10);
                        const isIntervalTick = timeTenths % intervalTenths === 0;

                        // Only show label if it aligns with the interval and maintains minimum distance to prevent text collisions
                        const canShowLabel = isIntervalTick && (pt.endX - lastLabelX >= MIN_LABEL_DISTANCE_PX);
                        if (canShowLabel) {
                          lastLabelX = pt.endX;
                        }

                        const labelStr = `${timeMs.toFixed(1)} ms`;

                        return (
                          <g key={`x-tick-${pt.obs.id || idx}-${idx}`}>
                            <line
                              x1={pt.endX}
                              y1="205"
                              x2={pt.endX}
                              y2={isIntervalTick ? "211" : "208"}
                              stroke={isIntervalTick ? "#64748B" : "#CBD5E1"}
                              strokeWidth={isIntervalTick ? 1.2 : 1}
                            />
                            {canShowLabel && (
                              <text
                                x={pt.endX}
                                y="222"
                                textAnchor="middle"
                                className="text-[11px] font-mono fill-slate-500 font-medium select-none"
                              >
                                {labelStr}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </>
                  );
                })()}
              </svg>

              {/* Clean Minimal Hover Tooltip: Shows ONLY the frequency */}
              {hoverInfo && !isDownRef.current && (
                <div
                  className="absolute pointer-events-none select-none z-30 shadow-md rounded-lg bg-slate-900/95 text-emerald-400 border border-slate-700/80 px-2.5 py-1 backdrop-blur-xs font-mono text-[13px] font-semibold tracking-wide whitespace-nowrap"
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
                  <span className="text-[13px] font-medium">Awaiting scan steps to plot timeline...</span>
                </div>
              )}
            </div>
          </div>

          {/* Graph Footer Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-slate-100 mt-2 text-[12px] text-slate-500 select-none">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px] text-primary">touch_app</span>
              <span>
                Hover over intercepted dwells or emissions to inspect exact frequency. Drag or scroll backwards to view earlier history.
              </span>
            </div>

            {/* Dynamic Visual Legend reflecting current filter and viewMode */}
            <div className="flex flex-wrap items-center gap-4 text-[12px]">
              {showInterceptions && (
                <div className="flex items-center gap-1.5">
                  <span className="w-4 h-1 rounded bg-[#10B981]" />
                  <span className="text-emerald-700 font-semibold">HIT</span>
                </div>
              )}
              {showMisses && viewMode === 'receiver' && (
                <div className="flex items-center gap-1.5">
                  <span className="w-4 h-1 rounded bg-[#F59E0B]" />
                  <span className="text-amber-700 font-medium">Scan Miss <span className="text-[11px] font-normal text-slate-500">(scan miss or quiet miss)</span></span>
                </div>
              )}
              {showMisses && viewMode === 'environment' && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-1 rounded bg-[#F59E0B]" />
                    <span className="text-amber-700 font-medium">Scan Miss <span className="text-[11px] font-normal text-slate-500">(active emission)</span></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-1 rounded bg-[#94A3B8]" />
                    <span className="text-slate-600 font-medium">Quiet Miss <span className="text-[11px] font-normal text-slate-500">(no emission)</span></span>
                  </div>
                </>
              )}
              {showActualEmissions && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rotate-45 bg-[#10B981] border border-white shadow-2xs" />
                    <span className="text-emerald-800 font-semibold">Detected Emission</span>
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
        <div className="mt-4 flex flex-col w-full relative" id="observation-table-display">
          {/* Go to Top (Latest Entries) Arrow Button */}
          {tableScrolledDown && (
            <button
              type="button"
              onClick={handleJumpToLatestTable}
              className="absolute right-4 bottom-4 z-30 w-8 h-8 rounded-full bg-slate-900/90 hover:bg-slate-900 text-white shadow-xl border border-slate-700/80 flex items-center justify-center transition-all cursor-pointer hover:scale-110 active:scale-95 backdrop-blur-xs group"
              title="Go to top (latest 20 entries)"
              id="btn-table-jump-latest"
            >
              <span className="material-symbols-outlined text-[19px] text-white group-hover:-translate-y-0.5 transition-transform">
                arrow_upward
              </span>
            </button>
          )}
          {/* Subtitle note on table with Intercepted Only toggle */}
          <div className="pb-3 text-[12px] text-slate-500 flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono font-semibold text-slate-700 text-[12px]">
              {filteredTableRows.length} / {totalDwells || observations.length}
            </span>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[11px] text-slate-400 hidden sm:inline">
                {isInteractive ? 'Scroll down or use button to load earlier' : 'Live stream active'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setTableShowInterceptedOnly((prev) => !prev);
                  setTableVisibleCount(CHUNK_SIZE);
                }}
                className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all cursor-pointer shadow-2xs border ${
                  tableShowInterceptedOnly
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-1 ring-emerald-300'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                }`}
                title="Toggle between showing only intercepted dwells (hits) and all dwells"
              >
                <span className={`material-symbols-outlined text-[15px] anim-check-hover ${tableShowInterceptedOnly ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {tableShowInterceptedOnly ? 'check_circle' : 'radio_button_unchecked'}
                </span>
                <span>Intercepted Only</span>
              </button>
            </div>
          </div>

          {/* Scrollable table container with visible high-contrast scrollbar */}
          <div
            className="max-h-[340px] overflow-y-scroll overflow-x-auto rounded-xl border border-slate-200 shadow-2xs [scrollbar-width:thin] [scrollbar-color:#94a3b8_#f8fafc]"
            id="observation-table-scroll-area"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#94a3b8 #f8fafc',
            }}
            onScroll={handleTableScroll}
          >
            <table className="w-full text-left border-collapse min-w-[620px]">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10 shadow-2xs">
                <tr>
                  <th className="py-2.5 px-3.5 text-slate-600 font-medium uppercase tracking-wider text-[12px] whitespace-nowrap">Time Window</th>
                  <th className="py-2.5 px-3.5 text-slate-600 font-medium uppercase tracking-wider text-[12px] whitespace-nowrap">Selected Band</th>
                  <th className="py-2.5 px-3.5 text-slate-600 font-medium uppercase tracking-wider text-[12px] whitespace-nowrap">Intercepted Frequency</th>
                  <th className="py-2.5 px-3.5 text-slate-600 font-medium uppercase tracking-wider text-[12px] whitespace-nowrap">Result</th>
                  <th className="py-2.5 px-3.5 text-slate-600 font-medium uppercase tracking-wider text-[12px] whitespace-nowrap">Reward</th>
                  <th className="py-2.5 px-3.5 text-slate-600 font-medium uppercase tracking-wider text-[12px] whitespace-nowrap">Pulses Detected</th>
                  {viewMode === 'environment' && (
                    <th className="py-2.5 px-3.5 text-slate-600 font-medium uppercase tracking-wider text-[12px] whitespace-nowrap">Active Emissions in Window (Exact Freq)</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-on-surface text-[12px]">
                {filteredTableRows.length > 0 ? (
                  filteredTableRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3.5 font-medium text-slate-900 whitespace-nowrap font-mono text-[12px]">{row.timeWindow || row.timestamp}</td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-primary font-sans text-[12px]">{row.band}</span>
                          <span className="text-slate-500 font-mono text-[11px]">({row.range})</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap font-mono text-[12px]">
                        {row.isIntercepted ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold shadow-2xs whitespace-nowrap">
                            {row.interceptedFreq && row.interceptedFreq !== '-' ? row.interceptedFreq : row.centerFreq}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-medium">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        {row.isIntercepted ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold shadow-2xs font-sans text-[11px] tracking-wide">
                            HIT
                          </span>
                        ) : viewMode === 'receiver' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-semibold shadow-2xs font-sans text-[11px] tracking-wide" title="Scan Miss: Receiver detected 0 transmissions in this dwell window">
                            SCAN MISS
                          </span>
                        ) : (row.hasEmission || (row.actualEmissions && row.actualEmissions.length > 0) || (row.actualBands && row.actualBands.length > 0)) ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-semibold shadow-2xs font-sans text-[11px] tracking-wide" title="Active emission was present in spectrum but receiver was on a different band">
                            SCAN MISS
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-50 text-slate-500 border border-slate-200 font-medium shadow-2xs font-sans text-[11px] tracking-wide" title="No emission active — idle dwell window">
                            QUIET MISS
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap font-mono text-[12px]">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md font-semibold text-[12px] shadow-2xs ${
                            (row.reward !== undefined ? Number(row.reward) : (row.isIntercepted ? 0.02 : -0.01)) > 0
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : (row.reward !== undefined ? Number(row.reward) : (row.isIntercepted ? 0.02 : -0.01)) < 0
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-slate-50 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {(() => {
                            const r = row.reward !== undefined ? Number(row.reward) : (row.isIntercepted ? 0.02 : -0.01);
                            return r > 0 ? `+${r.toFixed(2)}` : r.toFixed(2);
                          })()}
                        </span>
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap font-mono text-[12px]">
                        <span className="font-semibold text-slate-700">{row.pulsesDetected}</span>
                      </td>
                      {viewMode === 'environment' && (
                        <td className="py-2.5 px-3.5">
                          <div className="flex flex-wrap items-center gap-1">
                            {row.actualEmissions && row.actualEmissions.length > 0 ? (
                              row.actualEmissions.map((em, idx) => (
                                <span
                                  key={`table-em-${row.id}-${em.bandId}-${idx}`}
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono ${
                                    em.isDetected
                                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold'
                                      : 'bg-slate-50 text-slate-600 border border-slate-200 font-medium'
                                  }`}
                                >
                                  <span>Band {em.bandId}</span>
                                  <span>({em.freqStr})</span>
                                  <span className={em.isDetected ? 'text-emerald-700 font-semibold' : 'text-slate-400'}>
                                    [{em.isDetected ? 'Caught' : 'Missed'}]
                                  </span>
                                </span>
                              ))
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
                    <td colSpan={viewMode === 'environment' ? 7 : 6} className="py-8 text-center text-slate-400 select-none text-[13px]">
                      No dwell records in this window matching the selected filter.
                    </td>
                  </tr>
                )}
                {/* Inline loading indicator at the bottom of the table: ONLY spinning icon, no text */}
                {isLoadingEarlierTable && (
                  <tr>
                    <td colSpan={viewMode === 'environment' ? 7 : 6} className="py-3 bg-slate-50/90 border-t border-slate-200 text-center">
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
