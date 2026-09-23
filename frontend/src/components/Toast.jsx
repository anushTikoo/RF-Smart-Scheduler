import React from 'react';

export default function Toast({ message, onClose }) {
  if (!message) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-2.5 bg-slate-900 text-white rounded-xl shadow-lg border border-slate-700/50 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <span className="material-symbols-outlined text-primary text-[18px]">
        info
      </span>
      <span className="text-xs font-medium font-body-sm">{message}</span>
      <button
        onClick={onClose}
        className="ml-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
        type="button"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  );
}

