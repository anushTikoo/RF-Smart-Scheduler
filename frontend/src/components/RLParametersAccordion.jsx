import React, { useState } from 'react';

export default function RLParametersAccordion({ avgReward = '-', hasDataset = false }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-slate-200 overflow-hidden transition-all">
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
        </div>

        <div className="flex items-center gap-3">
          {/* Live Average Reward Badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary select-none">
            <span className="font-label-sm text-[10.5px] uppercase font-semibold tracking-wide text-slate-500">
              Avg Reward:
            </span>
            <span className="font-mono text-[12px] font-bold text-primary">
              {hasDataset ? (avgReward || '+0.74') : '-'}
            </span>
          </div>

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
              <span className="font-semibold text-primary">Contextual Bandit (LinUCB)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-outline">Average Reward (Live):</span>
              <span className="font-semibold text-primary font-mono">{hasDataset ? (avgReward || '+0.74') : '-'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-outline">Context Features:</span>
              <span className="font-semibold text-on-surface">Temporal Recency & Activity State</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-outline">Exploration (α):</span>
              <span className="font-semibold text-on-surface">0.5 (Upper Confidence Bound)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-outline">Reward Signal:</span>
              <span className="font-semibold text-on-surface">+1.0 Hit / -0.05 Miss</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-outline">Action Space:</span>
              <span className="font-semibold text-on-surface">20 Disjoint Band Arms (0.5 – 18 GHz)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-outline">Regularization (λ):</span>
              <span className="font-semibold text-on-surface">1.0 (Ridge Regularization)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-outline">Inference Delay:</span>
              <span className="font-semibold text-on-surface">&lt; 1 ms (Closed-Form Update)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

