import React from 'react';

// Band definition metadata
export const BAND_CONFIG = [
  { id: 1, range: '0.5 – 1.0 GHz', center: '0.75 GHz', startDeg: 288, endDeg: 324 },
  { id: 2, range: '1.0 – 2.0 GHz', center: '1.50 GHz', startDeg: 324, endDeg: 360 },
  { id: 3, range: '2.0 – 3.0 GHz', center: '2.50 GHz', startDeg: 0, endDeg: 36 },
  { id: 4, range: '3.0 – 4.0 GHz', center: '3.50 GHz', startDeg: 144, endDeg: 180 }, // reference band 4
  { id: 5, range: '4.0 – 5.0 GHz', center: '4.50 GHz', startDeg: 180, endDeg: 216 },
  { id: 6, range: '5.0 – 6.0 GHz', center: '5.50 GHz', startDeg: 216, endDeg: 252 },
  { id: 7, range: '6.0 – 7.0 GHz', center: '6.50 GHz', startDeg: 72, endDeg: 108 },  // reference band 7
  { id: 8, range: '7.0 – 8.0 GHz', center: '7.50 GHz', startDeg: 108, endDeg: 144 },
  { id: 9, range: '8.0 – 10.0 GHz', center: '9.00 GHz', startDeg: 36, endDeg: 72 },
  { id: 10, range: '10.0 – 18.0 GHz', center: '14.0 GHz', startDeg: 252, endDeg: 288 },
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
  subtitleDotColor = "bg-primary-container",
  type = "adaptive", // "adaptive" | "open-loop"
  currentBand = 7,
  metrics = {},
  onSelectBand
}) {
  const isAdaptive = type === 'adaptive';
  const bandInfo = BAND_CONFIG.find((b) => b.id === currentBand) || BAND_CONFIG[6]; // default band 7

  // Sector lines for 10 bands
  const sectorLines = [
    { x1: 200, y1: 200, x2: 380, y2: 200 },
    { x1: 200, y1: 200, x2: 345.6, y2: 305.8 },
    { x1: 200, y1: 200, x2: 255.6, y2: 371.2 },
    { x1: 200, y1: 200, x2: 144.4, y2: 371.2 },
    { x1: 200, y1: 200, x2: 54.4, y2: 305.8 },
    { x1: 200, y1: 200, x2: 20, y2: 200 },
    { x1: 200, y1: 200, x2: 54.4, y2: 94.2 },
    { x1: 200, y1: 200, x2: 144.4, y2: 28.8 },
    { x1: 200, y1: 200, x2: 255.6, y2: 28.8 },
    { x1: 200, y1: 200, x2: 345.6, y2: 94.2 },
  ];

  const wedgePathOuter = getSectorPath(200, 200, 180, bandInfo.startDeg, bandInfo.endDeg);
  const wedgePathInner = getSectorPath(200, 200, 125, bandInfo.startDeg, bandInfo.endDeg);

  return (
    <div className={`bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.03)] border border-slate-200/90 p-5 sm:p-6 flex flex-col justify-between items-center transition-all ${
      isAdaptive ? 'hover:border-primary/40' : 'hover:border-slate-300'
    }`}>
      {/* Card Header */}
      <div className="w-full flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isAdaptive
                ? 'bg-primary-container shadow-[0_0_6px_rgba(0,198,215,0.8)] animate-pulse'
                : 'bg-outline'
            }`}
          ></span>
          <h2 className="font-label-md text-[13px] font-semibold text-on-surface uppercase tracking-wider">
            {title}
          </h2>
        </div>
      </div>

      {/* Radar SVG Circle */}
      <div className="relative w-64 h-64 sm:w-80 sm:h-80 my-4 sm:my-5 flex items-center justify-center select-none">
        <svg
          className="w-full h-full transform -rotate-90 transition-transform duration-500"
          viewBox="0 0 400 400"
        >
          {/* Concentric Radar Rings */}
          <circle cx="200" cy="200" fill="none" r="180" stroke="#CBD5E1" strokeDasharray="2 4" strokeWidth="1.2" />
          <circle cx="200" cy="200" fill="none" r="140" stroke="#CBD5E1" strokeWidth="1.2" />
          <circle cx="200" cy="200" fill="none" r="100" stroke="#CBD5E1" strokeDasharray="3 3" strokeWidth="1.2" />
          <circle cx="200" cy="200" fill="none" r="60" stroke="#CBD5E1" strokeWidth="1.2" />

          {/* Exactly 10 Radial Sector Lines (36 deg intervals spanning 10 spectrum bands) */}
          <g opacity="0.65" stroke="#94A3B8" strokeWidth="1.2">
            {sectorLines.map((line, idx) => (
              <line key={idx} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
            ))}
          </g>

          {/* Interactive clickable invisible sectors */}
          {BAND_CONFIG.map((b) => (
            <path
              key={`clickable-${b.id}`}
              d={getSectorPath(200, 200, 180, b.startDeg, b.endDeg)}
              fill="transparent"
              className="cursor-pointer hover:fill-slate-200/20 transition-colors"
              onClick={() => onSelectBand && onSelectBand(b.id)}
            >
              <title>{`Band ${b.id}: ${b.range}`}</title>
            </path>
          ))}

          {/* Active Wedge Sector Highlight */}
          {isAdaptive ? (
            <>
              <path
                d={wedgePathOuter}
                fill="#00C6D7"
                fillOpacity="0.32"
                stroke="#00C6D7"
                strokeWidth="1.8"
                className="transition-all duration-300"
              />
              <path
                d={wedgePathInner}
                fill="#00C6D7"
                fillOpacity="0.2"
                className="transition-all duration-300"
              />
            </>
          ) : (
            <path
              d={wedgePathOuter}
              fill="#94A3B8"
              fillOpacity="0.25"
              stroke="#64748B"
              strokeWidth="1.8"
              className="transition-all duration-300"
            />
          )}

          {/* Center Core Geometry */}
          {isAdaptive ? (
            <>
              <circle cx="200" cy="200" fill="#FFFFFF" r="34" stroke="#006972" strokeWidth="1.5" />
              <circle cx="200" cy="200" fill="#E8FBFD" r="20" stroke="#00C6D7" strokeWidth="1.2" />
              <circle cx="200" cy="200" fill="#006972" r="4.5" />
            </>
          ) : (
            <>
              <circle cx="200" cy="200" fill="#FFFFFF" r="34" stroke="#64748B" strokeWidth="1.5" />
              <circle cx="200" cy="200" fill="#F1F5F9" r="20" stroke="#94A3B8" strokeWidth="1.2" />
              <circle cx="200" cy="200" fill="#64748B" r="4.5" />
            </>
          )}
        </svg>

        {/* Center Readout Badge */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-center bg-white/95 px-3 py-1.5 rounded-lg border border-slate-200/90 shadow-xs backdrop-blur-sm pointer-events-auto">
            <span className="block font-label-sm text-[10px] uppercase text-outline">
              Current Band
            </span>
            <span
              className={`block font-headline-sm text-headline-sm font-bold ${
                isAdaptive ? 'text-primary' : 'text-on-surface'
              }`}
            >
              Band {bandInfo.id}
            </span>
            <span className="block font-label-sm text-[11px] text-on-surface-variant font-medium">
              {bandInfo.range}
            </span>
          </div>
        </div>

        {/* Frequency Ticks Around Perimeter */}
        <div className="absolute top-1 left-1/2 -translate-x-1/2 font-label-sm text-[11px] text-outline">
          10 GHz
        </div>
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 font-label-sm text-[11px] text-outline">
          1 GHz
        </div>
        <div className="absolute left-1 top-1/2 -translate-y-1/2 font-label-sm text-[11px] text-outline">
          5 GHz
        </div>
        <div className="absolute right-1 top-1/2 -translate-y-1/2 font-label-sm text-[11px] text-outline">
          15 GHz
        </div>
      </div>

      {/* 5-Column Metrics Grid */}
      <div className="w-full grid grid-cols-2 md:grid-cols-5 gap-2 pt-3 border-t border-slate-100">
        <div className="text-center p-2 rounded-lg bg-slate-50">
          <span className="block font-label-sm text-[10px] text-outline">Hit Rate</span>
          <span
            className={`font-label-md font-bold text-[14px] ${
              isAdaptive ? 'text-primary' : 'text-on-surface'
            }`}
          >
            {metrics.hitRate || '0.0%'}
          </span>
        </div>

        <div className="text-center p-2 rounded-lg bg-slate-50">
          <span className="block font-label-sm text-[10px] text-outline">
            {isAdaptive ? 'Intercept/s' : 'Intercept Lag'}
          </span>
          <span
            className={`font-label-md font-bold text-[14px] ${
              !isAdaptive ? 'text-error' : 'text-on-surface'
            }`}
          >
            {isAdaptive ? metrics.interceptPerSec || '0.72 /s' : metrics.interceptLag || '1.82 s'}
          </span>
        </div>

        <div className="text-center p-2 rounded-lg bg-slate-50">
          <span className="block font-label-sm text-[10px] text-outline">Total Hits</span>
          <span
            className={`font-label-md font-bold text-[14px] ${
              isAdaptive ? 'text-primary' : 'text-on-surface'
            }`}
          >
            {metrics.totalHits ?? 0}
          </span>
        </div>

        <div className="text-center p-2 rounded-lg bg-slate-50">
          <span className="block font-label-sm text-[10px] text-outline">Total Misses</span>
          <span className="font-label-md font-bold text-on-surface text-[14px]">
            {metrics.totalMisses ?? 0}
          </span>
        </div>

        <div className="text-center p-2 rounded-lg bg-slate-50 col-span-2 md:col-span-1">
          <span className="block font-label-sm text-[10px] text-outline">Avg Delay</span>
          <span
            className={`font-label-md font-bold text-[14px] ${
              isAdaptive ? 'text-primary' : 'text-on-surface'
            }`}
          >
            {metrics.avgDelay || '0.00s'}
          </span>
        </div>
      </div>
    </div>
  );
}

