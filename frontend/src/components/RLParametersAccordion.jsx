import React, { useState } from 'react';

export default function RLParametersAccordion() {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.03)] border border-slate-200/90 overflow-hidden transition-all">
      <button
        className="w-full px-5 sm:px-6 py-4 flex items-center justify-between hover:bg-slate-50/70 transition-colors text-left cursor-pointer"
        onClick={() => setIsExpanded(prev => !prev)}
        type="button"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[20px] text-primary">
            psychology
          </span>
          <span className="font-label-md text-xs font-semibold text-on-surface uppercase tracking-wider">
            Reinforcement Learning Parameters
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-100 text-primary font-semibold text-[10px] font-label-sm">
            Episode 250
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-outline font-label-sm hidden sm:inline">
            DQN ε-Greedy Engine
          </span>
          <span
            className={`material-symbols-outlined text-[20px] text-outline transition-transform duration-200 ${
              isExpanded ? 'rotate-180' : ''
            }`}
            id="rl-arrow-icon"
          >
            expand_more
          </span>
        </div>
      </button>

      {/* Collapsible Content */}
      {isExpanded && (
        <div
          className="border-t border-slate-100 px-5 sm:px-6 py-4 bg-white animate-in fade-in duration-200"
          id="rl-params-content"
        >
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-3 font-label-sm text-[12px]">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-outline">Algorithm:</span>
              <span className="font-semibold text-primary">DQN (ε-greedy)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-outline">Exploration (ε):</span>
              <span className="font-semibold text-on-surface">0.12 (Active)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-outline">Current Reward:</span>
              <span className="font-semibold text-primary">+1.0 per Intercept</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-outline">Simulation Time:</span>
              <span className="font-semibold text-on-surface font-telemetry-metric">
                00:12:34
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-outline">Inference Delay:</span>
              <span className="font-semibold text-on-surface">12 ms</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-outline">Band Bins:</span>
              <span className="font-semibold text-on-surface">10 Channels (1 GHz)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

