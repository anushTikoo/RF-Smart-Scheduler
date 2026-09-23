import React, { useState, useRef, useEffect } from 'react';

const FLAG_IMG_SRC = "https://lh3.googleusercontent.com/aida/AEtjO1Ul4VVCweAGnjmVHZ6Cqwhho9t5b1n0FxJ4L5qTzGuHFLzlCH_5j7DqRpnj6xb5U6DV05vIN8MhKKGbP7Tw6FXY6TGR9L8g3My3WWJxl96c8aq3Po7N7MXBQPCiAc-_ko0GUPpFw1Q8lEbDBt85-ydJu6-rBX01Et3efgbrtN0fHrXQB4tYkTNa2vo01xI6cVaL2RuRqAGnLSI0bOXAkOj0yIqZqORWqEfYDM6gnpC9smapVhaSS5h5ig";

export default function Header({
  viewMode,
  setViewMode,
  onDatasetUpload,
  loadedDataset
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const fileInputRef = useRef(null);

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
      onDatasetUpload(file);
    }
  };

  return (
    <header className="w-full min-h-20 bg-white border-b border-slate-100 px-4 sm:px-8 lg:px-10 py-3 flex flex-wrap items-center justify-between sticky top-0 z-50 gap-4">
      {/* Far Left Corner: Pure Waving Flag of India */}
      <div className="flex items-center gap-3">
        <img
          alt="Flag of India"
          className="drop-shadow-sm select-none"
          src={FLAG_IMG_SRC}
          onError={(e) => {
            e.currentTarget.src = "/india-flag.png";
          }}
          style={{
            width: '58px',
            height: '36px',
            minWidth: '58px',
            minHeight: '36px',
            maxWidth: '58px',
            maxHeight: '36px',
            objectFit: 'contain',
            display: 'block'
          }}
        />
      </div>

      {/* Center: Title and Subtitle */}
      <div className="flex flex-col items-center text-center order-first sm:order-none w-full sm:w-auto">
        <h1 className="text-[14px] sm:text-[15px] font-semibold tracking-tight text-on-surface">
          Adaptive RF Scan Scheduler
        </h1>
        <p className="font-body-sm text-[11px] text-outline font-normal mt-0.5">
          ML-Based Frequency Band Selection for Electronic Warfare
        </p>
      </div>

      {/* Right Side: Upload button, View Selector Pill & Matching Waving Indian Flag */}
      <div className="flex items-center justify-end gap-3 sm:gap-5 flex-wrap sm:flex-nowrap">
        {/* Upload Dataset Button */}
        <label
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white border border-slate-200 shadow-xs text-on-surface font-label-md text-xs font-medium hover:border-primary/50 hover:text-primary transition-all cursor-pointer"
          title="Upload .h5, .csv, or .dat dataset"
        >
          <input
            type="file"
            ref={fileInputRef}
            accept=".h5,.csv,.dat"
            className="hidden"
            onChange={handleFileChange}
          />
          <span className="material-symbols-outlined text-[16px] text-primary">
            upload_file
          </span>
          <span className="truncate max-w-[130px] sm:max-w-none">
            {loadedDataset ? loadedDataset.name : 'Upload Dataset (.h5)'}
          </span>
        </label>

        {/* View Selector Pill */}
        <div className="relative inline-block" ref={dropdownRef}>
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-slate-200 shadow-xs text-primary font-label-md text-[12px] font-semibold hover:border-primary/50 transition-all cursor-pointer"
            id="view-receiver-btn"
            type="button"
            onClick={() => setIsDropdownOpen((prev) => !prev)}
            aria-expanded={isDropdownOpen}
          >
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            <span>
              {viewMode === 'receiver' ? 'Receiver View' : 'Environment View'}
            </span>
            <span className={`material-symbols-outlined text-[16px] text-primary transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`}>
              expand_more
            </span>
          </button>

          {isDropdownOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-44 bg-white border border-slate-200 rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.06)] p-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
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
                <span>Receiver View</span>
                {viewMode === 'receiver' && (
                  <span className="material-symbols-outlined text-[15px]">check</span>
                )}
              </button>
              <button
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-label-md text-[12px] text-left transition-colors cursor-pointer ${
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
                <span>Environment View</span>
                {viewMode === 'environment' && (
                  <span className="material-symbols-outlined text-[15px]">check</span>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Mirrored Flag of India */}
        <img
          alt="Flag of India (Mirrored)"
          className="drop-shadow-sm select-none hidden sm:block"
          src={FLAG_IMG_SRC}
          onError={(e) => {
            e.currentTarget.src = "/india-flag.png";
          }}
          style={{
            width: '58px',
            height: '36px',
            minWidth: '58px',
            minHeight: '36px',
            maxWidth: '58px',
            maxHeight: '36px',
            objectFit: 'contain',
            display: 'block',
            transform: 'scaleX(-1)'
          }}
        />
      </div>
    </header>
  );
}

