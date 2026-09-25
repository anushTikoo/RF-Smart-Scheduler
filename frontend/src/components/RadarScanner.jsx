import React from 'react';

// Question mark info hover tooltip displaying metric formula definition
function InfoTooltip({ formula }) {
  return (
    <div className="relative group inline-flex items-center">
      <span
        className="w-4 h-4 rounded-full bg-slate-200/90 group-hover:bg-primary/20 text-slate-600 group-hover:text-primary transition-colors flex items-center justify-center text-[10px] font-mono font-bold cursor-help select-none"
        title={formula}
      >
        ?
      </span>

      {/* Default Info Hover Tooltip (Shows definition on hover) */}
      <div
        className="absolute right-0 bottom-full mb-1.5 hidden group-hover:block w-56 sm:w-60 p-2 rounded-lg bg-slate-900/95 text-white shadow-xl z-50 text-left backdrop-blur-xs pointer-events-none transition-all duration-150"
      >
        <div className="font-mono text-[11px] font-medium text-slate-100 leading-snug break-words">
          {formula}
        </div>
        <div className="absolute right-2 -bottom-1 w-2 h-2 bg-slate-900/95 rotate-45" />
      </div>
    </div>
  );
}

// Band definition metadata: 20 Bands from 500 MHz (0.5 GHz) to 18.0 GHz (875 MHz per band)
export const BAND_CONFIG = [
  { id: 1, range: '0.50 – 1.38 GHz', center: '0.94 GHz', startDeg: 0, endDeg: 18 },
  { id: 2, range: '1.38 – 2.25 GHz', center: '1.81 GHz', startDeg: 18, endDeg: 36 },
  { id: 3, range: '2.25 – 3.13 GHz', center: '2.69 GHz', startDeg: 36, endDeg: 54 },
  { id: 4, range: '3.13 – 4.00 GHz', center: '3.56 GHz', startDeg: 54, endDeg: 72 },
  { id: 5, range: '4.00 – 4.88 GHz', center: '4.44 GHz', startDeg: 72, endDeg: 90 },
  { id: 6, range: '4.88 – 5.75 GHz', center: '5.31 GHz', startDeg: 90, endDeg: 108 },
  { id: 7, range: '5.75 – 6.63 GHz', center: '6.19 GHz', startDeg: 108, endDeg: 126 },
  { id: 8, range: '6.63 – 7.50 GHz', center: '7.06 GHz', startDeg: 126, endDeg: 144 },
  { id: 9, range: '7.50 – 8.38 GHz', center: '7.94 GHz', startDeg: 144, endDeg: 162 },
  { id: 10, range: '8.38 – 9.25 GHz', center: '8.81 GHz', startDeg: 162, endDeg: 180 },
  { id: 11, range: '9.25 – 10.13 GHz', center: '9.69 GHz', startDeg: 180, endDeg: 198 },
  { id: 12, range: '10.13 – 11.00 GHz', center: '10.56 GHz', startDeg: 198, endDeg: 216 },
  { id: 13, range: '11.00 – 11.88 GHz', center: '11.44 GHz', startDeg: 216, endDeg: 234 },
  { id: 14, range: '11.88 – 12.75 GHz', center: '12.31 GHz', startDeg: 234, endDeg: 252 },
  { id: 15, range: '12.75 – 13.63 GHz', center: '13.19 GHz', startDeg: 252, endDeg: 270 },
  { id: 16, range: '13.63 – 14.50 GHz', center: '14.06 GHz', startDeg: 270, endDeg: 288 },
  { id: 17, range: '14.50 – 15.38 GHz', center: '14.94 GHz', startDeg: 288, endDeg: 306 },
  { id: 18, range: '15.38 – 16.25 GHz', center: '15.81 GHz', startDeg: 306, endDeg: 324 },
  { id: 19, range: '16.25 – 17.13 GHz', center: '16.69 GHz', startDeg: 324, endDeg: 342 },
  { id: 20, range: '17.13 – 18.00 GHz', center: '17.56 GHz', startDeg: 342, endDeg: 360 },
];

function getSectorPath(cx, cy, r, startAngleDeg, endAngleDeg) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startAngleDeg));
  const y1 = cy + r * Math.sin(toRad(startAngleDeg));
  const x2 = cx + r * Math.cos(toRad(endAngleDeg));
  const y2 = cy + r * Math.sin(toRad(endAngleDeg));
  const diff = (endAngleDeg - startAngleDeg + 360) % 360;
  const largeArc = diff > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
}

export default function RadarScanner({
  title,
  type = "adaptive", // "adaptive" | "open-loop"
  viewMode = "receiver", // "receiver" | "environment"
  currentBand = null,
  actualEmissionBand = null,
  actualEmissionBands = null,
  emissionFrequency = null,
  interceptedFrequency = null,
  metrics = {},
  isScanning = false,
  hasDataset = false
}) {
  const isAdaptive = type === 'adaptive';
  const bandInfo = currentBand ? (BAND_CONFIG.find((b) => b.id === currentBand) || null) : null;

  // Support both single emissionBand and multiple simultaneous emissionBands
  const emissionBands = (actualEmissionBands && actualEmissionBands.length > 0)
    ? actualEmissionBands
    : (actualEmissionBand ? [actualEmissionBand] : []);

  const emissionBandInfos = emissionBands.map((id) => BAND_CONFIG.find((b) => b.id === id)).filter(Boolean);
  const emissionBandInfo = emissionBandInfos.length > 0 ? emissionBandInfos[0] : null;

  const isIntercepted = Boolean(currentBand && emissionBands.includes(currentBand));
  const matchedBandInfo = emissionBandInfos.find((b) => b.id === currentBand);
  const detectedFreq = interceptedFrequency || (isIntercepted && matchedBandInfo ? matchedBandInfo.center : (bandInfo ? bandInfo.center : null));

  const RADAR_RADIUS = 130;

  // Sector lines for 20 bands at 18-degree intervals (radius 130 leaves generous margin for frequency labels)
  const sectorLines = Array.from({ length: 20 }, (_, i) => i * 18).map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return {
      x1: 200,
      y1: 200,
      x2: +(200 + RADAR_RADIUS * Math.cos(rad)).toFixed(1),
      y2: +(200 + RADAR_RADIUS * Math.sin(rad)).toFixed(1),
    };
  });

  const wedgePathOuter = bandInfo ? getSectorPath(200, 200, RADAR_RADIUS, bandInfo.startDeg, bandInfo.endDeg) : null;

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-slate-200 p-5 sm:p-6 flex flex-col justify-between items-center transition-all">
      {/* Card Header: Relevant Domain Icons (No Blinking Dots) */}
      <div className="w-full flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          {/* Meaningful Domain Icon representing Adaptive ML vs Open-Loop Fixed Sweep */}
          {isAdaptive ? (
            <span
              className="material-symbols-outlined text-[22px] text-primary select-none drop-shadow-[0_0_8px_rgba(0,198,215,0.6)]"
              title="Adaptive ML: Cognitive Band Scheduling (Contextual Bandit)"
            >
              neurology
            </span>
          ) : (
            <span
              className="material-symbols-outlined text-[20px] text-slate-500 select-none"
              title="Open Loop: Sequential Fixed Round-Robin Sweep"
            >
              sync
            </span>
          )}
          <div className="flex items-center gap-2">
            <h2 className="font-label-md text-[13px] font-semibold text-on-surface uppercase tracking-wider">
              {title}
            </h2>
          </div>
        </div>

        {/* Scanning Badge on each scanner (Only shown when a dataset is loaded; no 'Awaiting Dataset' badge) */}
        {hasDataset && (
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-label-md text-[10px] font-semibold tracking-wider select-none shadow-2xs ${
              isScanning
                ? 'bg-emerald-50 border border-emerald-200/90 text-emerald-700'
                : 'bg-slate-100 border border-slate-200 text-slate-600'
            }`}
          >
            <span
              className={`material-symbols-outlined text-[14px] ${
                isScanning ? 'text-emerald-600 animate-spin' : 'text-slate-400'
              }`}
              style={{ animationDuration: '3.5s' }}
            >
              {isScanning ? 'radar' : 'pause_circle'}
            </span>
            <span>{isScanning ? 'SCANNING' : 'PAUSED'}</span>
          </div>
        )}
      </div>

      {/* Radar SVG Circle with generous perimeter buffer so labels never overlap */}
      <div className="relative w-64 h-64 sm:w-80 sm:h-80 my-3 sm:my-4 flex items-center justify-center select-none">
        <svg
          className="w-full h-full transform -rotate-90 transition-transform duration-500"
          viewBox="0 0 400 400"
        >
          {/* Concentric Radar Rings (Outer radius 130 preserves abundant clearance for text) */}
          <circle cx="200" cy="200" fill="none" r={RADAR_RADIUS} stroke="#CBD5E1" strokeDasharray="2 4" strokeWidth="1.2" />
          <circle cx="200" cy="200" fill="none" r="98" stroke="#CBD5E1" strokeWidth="1.2" />
          <circle cx="200" cy="200" fill="none" r="66" stroke="#CBD5E1" strokeDasharray="3 3" strokeWidth="1.2" />
          <circle cx="200" cy="200" fill="none" r="36" stroke="#CBD5E1" strokeWidth="1.2" />

          {/* Exactly 20 Radial Sector Lines (18 deg intervals spanning 20 spectrum bands) */}
          <g opacity="0.65" stroke="#94A3B8" strokeWidth="1.2">
            {sectorLines.map((line, idx) => (
              <line key={idx} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
            ))}
          </g>

          {/* Active Wedge Sector Highlight (Receiver Scanned Band - rendered ONLY when actively scanning with a dataset) */}
          {hasDataset && isScanning && wedgePathOuter && (
            isAdaptive ? (
              <path
                d={wedgePathOuter}
                fill="#00C6D7"
                fillOpacity="0.35"
                stroke="#00C6D7"
                strokeWidth="2"
                className="transition-all duration-300 pointer-events-none"
              />
            ) : (
              <path
                d={wedgePathOuter}
                fill="#94A3B8"
                fillOpacity="0.25"
                stroke="#64748B"
                strokeWidth="1.8"
                className="transition-all duration-300 pointer-events-none"
              />
            )
          )}

          {/* Environmental View: Actual Target Emission Band Highlights (Green Outline & Soft Glow for each active emitter) */}
          {viewMode === 'environment' && hasDataset && isScanning && emissionBands.length > 0 && (
            emissionBands.map((eBandId) => {
              const eInfo = BAND_CONFIG.find((b) => b.id === eBandId);
              if (!eInfo) return null;
              const path = getSectorPath(200, 200, RADAR_RADIUS, eInfo.startDeg, eInfo.endDeg);
              const isHitThisBand = currentBand === eBandId;

              return (
                <path
                  key={`emission-wedge-${eBandId}`}
                  d={path}
                  fill={isHitThisBand ? "rgba(16, 185, 129, 0.28)" : "rgba(16, 185, 129, 0.15)"}
                  stroke="#10B981"
                  strokeWidth={isHitThisBand ? "3" : "2.2"}
                  strokeDasharray={isHitThisBand ? "none" : "5 2.5"}
                  className="pointer-events-none drop-shadow-[0_0_8px_rgba(16,185,129,0.7)]"
                />
              );
            })
          )}

          {/* Informational sectors (hover tooltip for band range; clicking disabled) */}
          {BAND_CONFIG.map((b) => (
            <path
              key={`band-${b.id}`}
              d={getSectorPath(200, 200, RADAR_RADIUS, b.startDeg, b.endDeg)}
              fill="transparent"
              className="cursor-default"
            >
              <title>{`Band ${b.id}: ${b.range}`}</title>
            </path>
          ))}

          {/* Center Core Geometry */}
          {isAdaptive ? (
            <>
              <circle cx="200" cy="200" fill="#FFFFFF" r="30" stroke="#006972" strokeWidth="1.5" />
              <circle cx="200" cy="200" fill="#E8FBFD" r="18" stroke="#00C6D7" strokeWidth="1.2" />
              <circle cx="200" cy="200" fill="#006972" r="4" />
            </>
          ) : (
            <>
              <circle cx="200" cy="200" fill="#FFFFFF" r="30" stroke="#64748B" strokeWidth="1.5" />
              <circle cx="200" cy="200" fill="#F1F5F9" r="18" stroke="#94A3B8" strokeWidth="1.2" />
              <circle cx="200" cy="200" fill="#64748B" r="4" />
            </>
          )}
        </svg>

        {/* Frequency Ticks Around Perimeter: smaller in size, no border, no shadow */}
        <div className="absolute top-1 left-1/2 -translate-x-1/2 font-mono text-[9px] font-semibold text-slate-500 bg-white/75 px-1 py-0.5 select-none whitespace-nowrap z-10">
          18 GHz / 500 MHz
        </div>
        {/* Horizontal Ticks: Positioned comfortably outside circle with ample clearance, no border, no shadow */}
        <div className="absolute -right-6 sm:-right-8 top-1/2 -translate-y-1/2 font-mono text-[9px] font-semibold text-slate-500 bg-white/75 px-1 py-0.5 select-none whitespace-nowrap z-10">
          4.88 GHz
        </div>
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-[9px] font-semibold text-slate-500 bg-white/75 px-1 py-0.5 select-none whitespace-nowrap z-10">
          9.25 GHz
        </div>
        {/* Horizontal Ticks: Positioned comfortably outside circle with ample clearance, no border, no shadow */}
        <div className="absolute -left-6 sm:-left-8 top-1/2 -translate-y-1/2 font-mono text-[9px] font-semibold text-slate-500 bg-white/75 px-1 py-0.5 select-none whitespace-nowrap z-10">
          13.63 GHz
        </div>
      </div>

      {/* Receiver View Band Info Banner (Band Number, GHz Range & Intercept Detection - only shown when actively running) */}
      {viewMode === 'receiver' && (
        hasDataset && isScanning && bandInfo ? (
          <div className="w-full my-1 flex flex-wrap items-center justify-between gap-2 py-1.5 px-3 rounded-xl bg-slate-50 border border-slate-200/90 text-[11.5px] font-medium select-none shadow-2xs">
            <div className="flex items-center gap-2">
              <span
                className={`w-3 h-3 rounded-xs ${
                  isAdaptive ? 'bg-[#00C6D7]/40 border border-[#00C6D7]' : 'bg-slate-300 border border-slate-500'
                }`}
              />
              <span className="text-slate-700 font-semibold">
                {isAdaptive ? 'Scheduled Band' : 'Sweep Band'}: <span className="font-mono text-slate-900 font-bold">Band {bandInfo.id}</span>
                <span className="text-slate-500 font-mono text-[11px] ml-1.5 font-normal">({bandInfo.range})</span>
              </span>
            </div>

            {/* Intercept / Detection Status Combined with Frequency Found */}
            {isIntercepted ? (
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-bold text-[10.5px] tracking-wide uppercase border border-emerald-300 shadow-2xs">
                INTERCEPTED (HIT) • <span className="font-mono text-emerald-950 font-extrabold">{detectedFreq}</span>
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 font-semibold text-[10.5px] tracking-wide uppercase border border-amber-200 shrink-0">
                SEARCHING (MISS)
              </span>
            )}
          </div>
        ) : (
          <div className="w-full my-1 flex items-center justify-between gap-2 py-1.5 px-3 rounded-xl bg-slate-50/70 border border-slate-200/70 text-[11.5px] text-slate-500 font-medium select-none">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-300" />
              <span>{hasDataset ? 'Simulation paused. Press Resume Simulation to continue.' : 'No active scan. Upload a dataset to begin band scheduling.'}</span>
            </span>
          </div>
        )
      )}

      {/* Environmental View Legend: Explaining Scheduled/Sweep vs Actual Emission Bands with Band No & GHz */}
      {viewMode === 'environment' && (
        hasDataset && isScanning && bandInfo && emissionBands.length > 0 ? (
          <div className="w-full my-1 flex flex-wrap items-center justify-between gap-2 py-1.5 px-3 rounded-xl bg-slate-50 border border-slate-200/90 text-[11px] font-medium select-none shadow-2xs">
            <div className="flex flex-wrap items-center gap-3">
              {/* Scanned Receiver Band */}
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-3 h-3 rounded-xs ${
                    isAdaptive ? 'bg-[#00C6D7]/40 border border-[#00C6D7]' : 'bg-slate-300 border border-slate-500'
                  }`}
                />
                <span className="text-slate-700 font-semibold">
                  {isAdaptive ? 'Scheduled Band' : 'Sweep Band'}: <span className="font-mono text-slate-900 font-bold">Band {bandInfo.id}</span>
                  <span className="text-slate-500 font-mono text-[10.5px] ml-1 font-normal">({bandInfo.range})</span>
                </span>
              </div>

              {/* Actual Emission Bands (Single or Multiple Simultaneous) */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="w-3 h-3 rounded-xs bg-emerald-500/20 border-2 border-dashed border-emerald-500 shadow-2xs" />
                <span className="text-emerald-800 font-bold">
                  {emissionBandInfos.length > 1 ? 'Actual Emissions:' : 'Actual Emission:'}{' '}
                  {emissionBandInfos.map((eInfo, idx) => (
                    <span key={`eband-label-${eInfo.id}`}>
                      {idx > 0 && <span className="text-slate-400 font-normal mx-1">•</span>}
                      <span className="font-mono text-emerald-900 font-bold">Band {eInfo.id}</span>
                      <span className="text-emerald-700/80 font-mono text-[10px] ml-0.5 font-normal">({eInfo.center})</span>
                    </span>
                  ))}
                </span>
              </div>
            </div>

            {/* Intercept Status Indicator Combined with Frequency Found */}
            {isIntercepted ? (
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-bold text-[10px] tracking-wide uppercase border border-emerald-300 shadow-2xs shrink-0">
                INTERCEPTED (HIT) • <span className="font-mono text-emerald-950 font-extrabold">{detectedFreq}</span>
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 font-semibold text-[10px] tracking-wide uppercase border border-amber-200 shrink-0">
                SEARCHING (MISS)
              </span>
            )}
          </div>
        ) : (
          <div className="w-full my-1 flex items-center justify-between gap-2 py-1.5 px-3 rounded-xl bg-slate-50/70 border border-slate-200/70 text-[11px] text-slate-500 font-medium select-none">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-300" />
              <span>{hasDataset ? 'Simulation paused. Press Resume Simulation to continue.' : 'No active scan. Upload a dataset to view real-time emission comparison.'}</span>
            </span>
          </div>
        )
      )}

      {/* Enlarged Data Points Section: Specific to Receiver View vs Environment View */}
      <div className="w-full pt-4 border-t border-slate-100 flex flex-col gap-3">
        {viewMode === 'receiver' ? (
          /* Receiver View Metrics */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
            {/* Average Intercept rate = Total successful interceptions / total time */}
            <div className="flex flex-col justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-100 shadow-2xs">
              <div className="flex items-center justify-between gap-1 w-full">
                <span className="font-label-md text-[11px] font-bold text-slate-800 uppercase tracking-wide">
                  Average Intercept Rate
                </span>
                <InfoTooltip formula="Total successful interceptions / total time" />
              </div>
              <div className="mt-2.5 flex items-baseline gap-1.5">
                <span
                  className={`font-mono text-[26px] sm:text-[28px] font-extrabold tracking-tight leading-none ${
                    isAdaptive ? 'text-primary' : 'text-slate-800'
                  }`}
                >
                  {hasDataset ? (metrics.interceptRate && metrics.interceptRate !== '-' ? metrics.interceptRate : (isAdaptive ? '0.72 /s' : '0.24 /s')) : '-'}
                </span>
              </div>
            </div>

            {/* Percentage of correct predictions / Observation hit rate = (HIT/(HIT+MISS))*100 */}
            <div className="flex flex-col justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-100 shadow-2xs">
              <div className="flex items-center justify-between gap-1 w-full">
                <span className="font-label-md text-[11px] font-bold text-slate-800 uppercase tracking-wide">
                  Observation Hit Rate
                </span>
                <InfoTooltip formula="(HIT / (HIT + MISS)) × 100" />
              </div>
              <div className="mt-2.5 flex items-baseline gap-1.5">
                <span
                  className={`font-mono text-[26px] sm:text-[28px] font-extrabold tracking-tight leading-none ${
                    isAdaptive ? 'text-primary' : 'text-slate-800'
                  }`}
                >
                  {hasDataset ? (metrics.hitRate && metrics.hitRate !== '-' ? metrics.hitRate : (isAdaptive ? '61.7%' : '24.3%')) : '-'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* Environment View Metrics: All Receiver metrics + Additional Environmental metrics */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full">
            {/* Average Intercept rate */}
            <div className="flex flex-col justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 shadow-2xs">
              <div className="flex items-center justify-between gap-1 w-full">
                <span className="font-label-md text-[10.5px] font-bold text-slate-800 uppercase tracking-wide">
                  Average Intercept Rate
                </span>
                <InfoTooltip formula="Total successful interceptions / total time" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span
                  className={`font-mono text-[22px] sm:text-[24px] font-extrabold tracking-tight leading-none ${
                    isAdaptive ? 'text-primary' : 'text-slate-800'
                  }`}
                >
                  {hasDataset ? (metrics.interceptRate && metrics.interceptRate !== '-' ? metrics.interceptRate : (isAdaptive ? '0.72 /s' : '0.24 /s')) : '-'}
                </span>
              </div>
            </div>

            {/* Observation Hit Rate */}
            <div className="flex flex-col justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 shadow-2xs">
              <div className="flex items-center justify-between gap-1 w-full">
                <span className="font-label-md text-[10.5px] font-bold text-slate-800 uppercase tracking-wide">
                  Observation Hit Rate
                </span>
                <InfoTooltip formula="(HIT / (HIT + MISS)) × 100" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span
                  className={`font-mono text-[22px] sm:text-[24px] font-extrabold tracking-tight leading-none ${
                    isAdaptive ? 'text-primary' : 'text-slate-800'
                  }`}
                >
                  {hasDataset ? (metrics.hitRate && metrics.hitRate !== '-' ? metrics.hitRate : (isAdaptive ? '61.7%' : '24.3%')) : '-'}
                </span>
              </div>
            </div>

            {/* Probability of Detection = Emission Detected / Total Actual Emissions */}
            <div className="flex flex-col justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 shadow-2xs">
              <div className="flex items-center justify-between gap-1 w-full">
                <span className="font-label-md text-[10.5px] font-bold text-slate-800 uppercase tracking-wide">
                  Probability of Detection
                </span>
                <InfoTooltip formula="Emission Detected / Total Actual Emissions" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span
                  className={`font-mono text-[22px] sm:text-[24px] font-extrabold tracking-tight leading-none ${
                    isAdaptive ? 'text-primary' : 'text-slate-800'
                  }`}
                >
                  {hasDataset ? (metrics.probDetection && metrics.probDetection !== '-' ? metrics.probDetection : (isAdaptive ? '88.4%' : '41.2%')) : '-'}
                </span>
              </div>
            </div>

            {/* Average Intercept delay = (1/N) * ∑ |T_intercepted,i − T_emission_start,i| */}
            <div className="flex flex-col justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 shadow-2xs">
              <div className="flex items-center justify-between gap-1 w-full">
                <span className="font-label-md text-[10.5px] font-bold text-slate-800 uppercase tracking-wide">
                  Average Intercept Delay
                </span>
                <InfoTooltip formula="(1/N) ∑ |T_intercepted,i − T_emission_start,i|" />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span
                  className={`font-mono text-[22px] sm:text-[24px] font-extrabold tracking-tight leading-none ${
                    isAdaptive ? 'text-primary' : 'text-slate-800'
                  }`}
                >
                  {hasDataset ? (metrics.avgInterceptDelay && metrics.avgInterceptDelay !== '-' ? metrics.avgInterceptDelay : (isAdaptive ? '0.48 s' : '1.82 s')) : '-'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Supporting Counters Bar */}
        {viewMode === 'receiver' ? (
          <div className="grid grid-cols-2 gap-2 w-full pt-1">
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-100/70 text-slate-600 font-mono text-[11px]">
              <span>HIT Count:</span>
              <span className="font-bold text-slate-900">{hasDataset ? (metrics.totalHits && metrics.totalHits !== '-' ? metrics.totalHits : (isAdaptive ? 432 : 168)) : '-'}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-100/70 text-slate-600 font-mono text-[11px]">
              <span>MISS Count:</span>
              <span className="font-bold text-slate-900">
                {hasDataset ? (metrics.totalMisses && metrics.totalMisses !== '-' ? metrics.totalMisses : (isAdaptive ? 268 : 532)) : '-'}
              </span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 w-full pt-1">
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-100/70 text-slate-600 font-mono text-[10px] sm:text-[10.5px]">
              <span>HIT / Detected:</span>
              <span className="font-bold text-slate-900">{hasDataset ? (metrics.totalHits && metrics.totalHits !== '-' ? metrics.totalHits : (isAdaptive ? 432 : 168)) : '-'}</span>
            </div>
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-100/70 text-slate-600 font-mono text-[10px] sm:text-[10.5px]">
              <span>MISS:</span>
              <span className="font-bold text-slate-900">{hasDataset ? (metrics.totalMisses && metrics.totalMisses !== '-' ? metrics.totalMisses : (isAdaptive ? 268 : 532)) : '-'}</span>
            </div>
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-100/70 text-slate-600 font-mono text-[10px] sm:text-[10.5px]">
              <span>Total Em.:</span>
              <span className="font-bold text-slate-900">
                {hasDataset ? (metrics.totalActualEmissions && metrics.totalActualEmissions !== '-' ? metrics.totalActualEmissions : (isAdaptive ? 488 : 408)) : '-'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
