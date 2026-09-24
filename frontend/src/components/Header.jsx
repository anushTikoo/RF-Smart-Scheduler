import React, { useState, useRef, useEffect } from 'react';

// High-fidelity waving Indian flag animated sources (WebP / GIF) with fallback chain
const WAVING_FLAG_SOURCES = [
  "https://raw.githubusercontent.com/Malith-Rukshan/animated-country-flags/main/webp/IN.webp",
  "https://upload.wikimedia.org/wikipedia/commons/a/a4/India_flag-XL-anim.gif",
  "https://upload.wikimedia.org/wikipedia/commons/4/4b/Animated-Flag-India.gif",
  "https://lh3.googleusercontent.com/aida/AEtjO1Ul4VVCweAGnjmVHZ6Cqwhho9t5b1n0FxJ4L5qTzGuHFLzlCH_5j7DqRpnj6xb5U6DV05vIN8MhKKGbP7Tw6FXY6TGR9L8g3My3WWJxl96c8aq3Po7N7MXBQPCiAc-_ko0GUPpFw1Q8lEbDBt85-ydJu6-rBX01Et3efgbrtN0fHrXQB4tYkTNa2vo01xI6cVaL2RuRqAGnLSI0bOXAkOj0yIqZqORWqEfYDM6gnpC9smapVhaSS5h5ig",
  "/india-flag.png"
];

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
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-slate-200 shadow-xs text-primary font-label-md text-[12px] font-semibold hover:border-primary/50 transition-all cursor-pointer"
              id="view-receiver-btn"
              type="button"
              onClick={() => setIsDropdownOpen((prev) => !prev)}
              aria-expanded={isDropdownOpen}
            >
              <span className="material-symbols-outlined text-[17px] text-primary">
                {viewMode === 'receiver' ? 'sensors' : 'public'}
              </span>
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
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-label-md text-[12px] font-semibold text-left transition-colors cursor-pointer ${
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
                    <span className="material-symbols-outlined text-[17px]">sensors</span>
                    <span>Receiver View</span>
                  </div>
                  {viewMode === 'receiver' && (
                    <span className="material-symbols-outlined text-[15px]">check</span>
                  )}
                </button>
                <button
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-label-md text-[12px] text-left transition-colors ${
                    viewMode === 'environment'
                      ? 'bg-slate-50 text-primary font-semibold cursor-pointer'
                      : 'text-on-surface-variant hover:bg-slate-50 hover:text-on-surface cursor-pointer'
                  }`}
                  type="button"
                  onClick={() => {
                    setViewMode('environment');
                    setIsDropdownOpen(false);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[17px]">public</span>
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
