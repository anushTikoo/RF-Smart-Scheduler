import React, { useState, useRef, useEffect } from 'react';

// High-fidelity waving Indian flag animated sources (continuous loop GIFs) with fallback chain
const WAVING_FLAG_SOURCES = [
  "https://upload.wikimedia.org/wikipedia/commons/a/a4/India_flag-XL-anim.gif",
  "https://upload.wikimedia.org/wikipedia/commons/4/4b/Animated-Flag-India.gif",
  "/india-flag.png"
];

// Receiver Radio Wave Sensor Icon with static center dot and animated radiating wave curves
function ReceiverWaveIcon({ className = "w-[17px] h-[17px]" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 overflow-visible ${className}`}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Central static receiver dot (never animates, perfectly stationary) */}
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />

      {/* Inner wave arcs - ripples with headroom in 24x24 viewBox */}
      <g className="receiver-wave-inner" strokeWidth="1.6">
        <path d="M 8.8 8.8 A 4.5 4.5 0 0 0 8.8 15.2" />
        <path d="M 15.2 8.8 A 4.5 4.5 0 0 1 15.2 15.2" />
      </g>

      {/* Outer wave arcs - safe margin inside 24x24 viewBox, never clips */}
      <g className="receiver-wave-outer" strokeWidth="1.5">
        <path d="M 6.0 6.0 A 8.5 8.5 0 0 0 6.0 18.0" />
        <path d="M 18.0 6.0 A 8.5 8.5 0 0 1 18.0 18.0" />
      </g>
    </svg>
  );
}

// Earth Globe Icon that rotates in 3D like a sphere on its polar axis
function EarthGlobeIcon({ className = "w-[17px] h-[17px]" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 overflow-visible ${className}`}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Outer constant spherical boundary (always maintains round planet silhouette) */}
      <circle cx="12" cy="12" r="8.8" stroke="currentColor" strokeWidth="1.6" />

      {/* Rotating 3D spherical inner meridians and parallels */}
      <g className="earth-sphere-inner">
        {/* Prime Meridian */}
        <line x1="12" y1="3.2" x2="12" y2="20.8" stroke="currentColor" strokeWidth="1.2" />

        {/* Curved longitude meridian ellipse */}
        <ellipse cx="12" cy="12" rx="4.8" ry="8.8" stroke="currentColor" strokeWidth="1.2" />

        {/* Equator */}
        <line x1="3.2" y1="12" x2="20.8" y2="12" stroke="currentColor" strokeWidth="1.2" />

        {/* Curved latitude parallels */}
        <path d="M 5.8 7.5 Q 12 9.2 18.2 7.5" stroke="currentColor" strokeWidth="0.9" opacity="0.65" />
        <path d="M 5.8 16.5 Q 12 14.8 18.2 16.5" stroke="currentColor" strokeWidth="0.9" opacity="0.65" />
      </g>
    </svg>
  );
}

export default function Header({
  viewMode,
  setViewMode,
  onDatasetUpload,
  loadedDataset,
  isScanning = false
}) {
  const [flagIndex, setFlagIndex] = useState(0);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleFlagError = () => {
    setFlagIndex((prev) => (prev < WAVING_FLAG_SOURCES.length - 1 ? prev + 1 : prev));
  };

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.h5')) {
        alert('Please select a valid .h5 dataset file.');
        return;
      }
      onDatasetUpload(file);
    }
  };

  return (
    <header className="w-full min-h-20 bg-white border-b border-slate-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-4 sm:px-8 lg:px-10 py-3 flex flex-wrap items-center justify-between sticky top-0 z-50 gap-4">
      {/* Top Left: Animated Waving Indian Flag & Title */}
      <div className="flex items-center gap-3.5">
        <div
          className="relative flex items-center justify-center overflow-hidden rounded-md select-none flag-waving-anim"
          style={{
            width: '54px',
            height: '35px',
            minWidth: '54px',
            minHeight: '35px',
            maxWidth: '54px',
            maxHeight: '35px'
          }}
        >
          <img
            key={flagIndex}
            alt="Flag of India (Waving)"
            className="select-none w-full h-full object-cover block"
            src={WAVING_FLAG_SOURCES[flagIndex]}
            onError={handleFlagError}
          />
        </div>

        {/* Title & Subtitle */}
        <div className="flex flex-col text-left">
          <h1 className="text-[15px] sm:text-[16px] font-bold tracking-tight text-on-surface leading-tight">
            Adaptive RF Scan Scheduler
          </h1>
          <p className="font-body-sm text-[11px] text-outline font-normal mt-0.5">
            ML-Based Frequency Band Selection for Electronic Warfare
          </p>
        </div>
      </div>

      {/* Right Side: Upload Dataset Button & View Selector Dropdown */}
      <div className="flex items-center justify-end gap-3 sm:gap-4 flex-wrap sm:flex-nowrap">
        {/* Upload Dataset Button (Disabled when simulation is actively running) */}
        <label
          className={`group inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border shadow-xs font-label-md text-xs font-medium transition-all select-none ${
            isScanning
              ? 'bg-slate-100/90 border-slate-200 text-slate-400 cursor-not-allowed opacity-75'
              : 'bg-white border-slate-200 text-on-surface hover:border-primary/50 hover:text-primary cursor-pointer'
          }`}
          title={
            isScanning
              ? 'Simulation is running. Stop/Pause simulation to upload a new dataset.'
              : 'Upload .h5 dataset file'
          }
        >
          <input
            type="file"
            ref={fileInputRef}
            accept=".h5,application/x-hdf5"
            className="hidden"
            disabled={isScanning}
            onChange={handleFileChange}
          />
          <span
            className={`material-symbols-outlined text-[18px] transition-transform duration-300 ${
              isScanning ? 'text-slate-400' : 'text-primary upload-hover-anim'
            }`}
          >
            {isScanning ? 'lock' : 'file_upload'}
          </span>
          <span className="truncate max-w-[130px] sm:max-w-none">
            {loadedDataset ? loadedDataset.name : 'Upload Dataset (.h5)'}
          </span>
        </label>

        {/* View Selector Pill (Hidden until a dataset is uploaded) */}
        {loadedDataset && (
          <div className="relative inline-block" ref={dropdownRef}>
            <button
              className="group flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-slate-200 shadow-xs text-primary font-label-md text-[12px] font-semibold hover:border-primary/50 transition-all cursor-pointer"
              id="view-receiver-btn"
              type="button"
              onClick={() => setIsDropdownOpen((prev) => !prev)}
              aria-expanded={isDropdownOpen}
            >
              {viewMode === 'receiver' ? (
                <ReceiverWaveIcon className="w-[17px] h-[17px] text-primary" />
              ) : (
                <EarthGlobeIcon className="w-[17px] h-[17px] text-primary" />
              )}
              <span>
                {viewMode === 'receiver' ? 'Receiver View' : 'Environment View'}
              </span>
              <span className={`material-symbols-outlined text-[16px] text-primary transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`}>
                expand_more
              </span>
            </button>

            {isDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-48 bg-white border border-slate-200 rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.06)] p-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                <button
                  className={`group w-full flex items-center justify-between px-3 py-2 rounded-lg font-label-md text-[12px] font-semibold text-left transition-colors cursor-pointer ${
                    viewMode === 'receiver'
                      ? 'bg-slate-50 text-primary'
                      : 'text-on-surface-variant hover:bg-slate-50 hover:text-on-surface'
                  }`}
                  type="button"
                  onClick={() => {
                    setViewMode('receiver');
                    setIsDropdownOpen(false);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <ReceiverWaveIcon className="w-[17px] h-[17px]" />
                    <span>Receiver View</span>
                  </div>
                  {viewMode === 'receiver' && (
                    <span className="material-symbols-outlined text-[15px]">check</span>
                  )}
                </button>
                <button
                  className={`group w-full flex items-center justify-between px-3 py-2 rounded-lg font-label-md text-[12px] text-left transition-colors cursor-pointer ${
                    viewMode === 'environment'
                      ? 'bg-slate-50 text-primary font-semibold'
                      : 'text-on-surface-variant hover:bg-slate-50 hover:text-on-surface'
                  }`}
                  type="button"
                  onClick={() => {
                    setViewMode('environment');
                    setIsDropdownOpen(false);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <EarthGlobeIcon className="w-[17px] h-[17px]" />
                    <span>Environment View</span>
                  </div>
                  {viewMode === 'environment' && (
                    <span className="material-symbols-outlined text-[15px]">check</span>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
