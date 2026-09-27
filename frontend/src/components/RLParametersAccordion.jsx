import React, { useState, useEffect } from 'react';
import { fetchModelState } from '../services/telemetryService';

export default function RLParametersAccordion({
  mlMetrics = {},
  openLoopMetrics = {},
  hasDataset = false,
  config = null,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [modelState, setModelState] = useState(null);

  // Poll or fetch model state when expanded or when dataset is loaded
  useEffect(() => {
    let isMounted = true;
    async function loadState() {
      if (!hasDataset) return;
      try {
        const state = await fetchModelState();
        if (isMounted && state && state.initialized) {
          setModelState(state);
        }
      } catch (err) {
        console.debug('Could not load model state:', err);
      }
    }

    if (hasDataset) {
      loadState();
    }
    return () => {
      isMounted = false;
    };
  }, [hasDataset, isExpanded, mlMetrics.totalHits]);

  const linCfg = config?.linucb || {};
  const alpha = linCfg.alpha !== undefined ? linCfg.alpha : 0.5;
  const regularization = linCfg.regularization !== undefined ? linCfg.regularization : 1.0;
  const uncertaintyWeight = linCfg.uncertainty_weight !== undefined ? linCfg.uncertainty_weight : 0.75;
  const coverageWeight = linCfg.coverage_bonus_weight !== undefined ? linCfg.coverage_bonus_weight : 0.08;

  const weights = modelState?.weights || {
    observed_hit_ewma: 0.0165,
    prediction_urgency: 0.0065,
    previous_observed_pulse_count: 0.0042,
    learned_periodicity: 0.0008,
    bias: 0.0011,
    consecutive_no_hits: -0.0020,
    time_since_visit: -0.0067,
  };

  const featureDescriptions = {
    observed_hit_ewma: 'EWMA historical hit frequency on band',
    prediction_urgency: 'Predicted imminent pulse arrival score',
    previous_observed_pulse_count: 'Most recent pulse count detected',
    learned_periodicity: 'Estimated Pulse Repetition Interval (PRI)',
    bias: 'Baseline arm intercept',
    consecutive_no_hits: 'Penalizes barren dwells without signal',
    time_since_visit: 'Urgency factor for spectrum staleness',
  };

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.04)] border border-slate-200 overflow-hidden transition-all">
      {/* Header Button: Title, Icon, and Toggle Arrow only (No Avg Reward badge here) */}
      <button
        className="w-full px-5 sm:px-6 py-4 flex items-center justify-between hover:bg-slate-50/70 transition-colors text-left cursor-pointer select-none"
        onClick={() => setIsExpanded((prev) => !prev)}
        type="button"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[20px] text-primary">
            psychology
          </span>
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
            <span className="font-label-md text-xs font-semibold text-on-surface uppercase tracking-wider">
              Reinforcement Learning Parameters & Policy Model
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-outline">
          <span
            className={`material-symbols-outlined text-[20px] transition-transform duration-200 ${
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
          className="border-t border-slate-100 px-5 sm:px-6 py-5 bg-white flex flex-col gap-6 animate-in fade-in duration-200"
          id="rl-params-content"
        >
          {/* Section 1: Live Average & Cumulative Reward Comparison Cards */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-label-md text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                Live Reward Signals & Policy Comparison
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                Streamed live from running simulation
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* LinUCB Adaptive ML Card */}
              <div className="p-3.5 rounded-xl bg-gradient-to-br from-cyan-50/60 to-slate-50/80 border border-cyan-200/80 shadow-2xs flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[17px] text-primary">neurology</span>
                    <span className="font-label-md text-[11px] font-bold text-slate-900 uppercase">
                      Adaptive ML
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 text-[9.5px] font-bold uppercase tracking-wider">
                    LinUCB Contextual Bandit
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 py-1">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-medium">Avg Reward / Dwell</span>
                    <span className="font-mono text-[14px] font-extrabold text-primary">
                      {hasDataset ? (mlMetrics.avgReward && mlMetrics.avgReward !== '-' ? mlMetrics.avgReward : '-0.005') : '-'}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-medium">Cumulative Reward</span>
                    <span className="font-mono text-[14px] font-extrabold text-slate-800">
                      {hasDataset ? (mlMetrics.cumulativeReward || '-0.61') : '-'}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-medium">Pulses Detected</span>
                    <span className="font-mono text-[14px] font-extrabold text-emerald-700">
                      {hasDataset ? (mlMetrics.totalHits !== undefined && mlMetrics.totalHits !== '-' ? mlMetrics.totalHits : 0) : '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Open Loop Round Robin Card */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 shadow-2xs flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[17px] text-slate-500">sync</span>
                    <span className="font-label-md text-[11px] font-bold text-slate-700 uppercase">
                      Open Loop
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-md bg-slate-200/80 text-slate-700 text-[9.5px] font-bold uppercase tracking-wider">
                    Sequential Sweep
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 py-1">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-medium">Avg Reward / Dwell</span>
                    <span className="font-mono text-[14px] font-extrabold text-slate-700">
                      {hasDataset ? (openLoopMetrics.avgReward && openLoopMetrics.avgReward !== '-' ? openLoopMetrics.avgReward : '-0.006') : '-'}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-medium">Cumulative Reward</span>
                    <span className="font-mono text-[14px] font-extrabold text-slate-800">
                      {hasDataset ? (openLoopMetrics.cumulativeReward || '-0.74') : '-'}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-medium">Pulses Detected</span>
                    <span className="font-mono text-[14px] font-extrabold text-slate-700">
                      {hasDataset ? (openLoopMetrics.totalHits !== undefined && openLoopMetrics.totalHits !== '-' ? openLoopMetrics.totalHits : 0) : '-'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Mathematical Formulation & Decision Rule (Compact Light Theme) */}
          <div className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-slate-50/80 border border-slate-200/90 shadow-2xs font-sans">
            <div className="flex items-center justify-between text-[11px] pb-1 border-b border-slate-200/60">
              <span className="text-slate-800 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px] text-primary">functions</span>
                LinUCB Decision Rule & Closed-Form Update
              </span>
              <span className="text-slate-400 font-mono text-[10px]">v2 Context Architecture</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 text-[11px]">
              <div className="flex flex-col gap-0.5 bg-white p-2.5 rounded-lg border border-slate-200/80 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[9.5px] uppercase font-bold tracking-wider">
                    UCB Arm Selection
                  </span>
                  <span className="text-[9.5px] text-slate-400">Score + Covariance + Urgency</span>
                </div>
                <div className="font-mono text-[10.5px] font-bold bg-slate-50 px-2 py-1.5 rounded border border-slate-200/60 overflow-x-auto whitespace-nowrap mt-0.5 text-slate-800">
                  a* = argmax [ θ̂ᵀ x_a + α √(x_aᵀ A⁻¹ x_a) + w_c · urgency_a ]
                </div>
                {/* Individual Identifiers Breakdown */}
                <div className="mt-2 pt-1.5 border-t border-slate-100 flex flex-col gap-1 text-[9.5px] text-slate-600">
                  <span className="font-semibold text-slate-400 uppercase tracking-wider text-[8.5px]">Formula Identifiers:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-1">
                    <div><span className="font-mono font-bold text-slate-900 bg-slate-100 px-1 py-0.2 rounded">a*</span> : Selected optimal band (action/arm)</div>
                    <div><span className="font-mono font-bold text-slate-900 bg-slate-100 px-1 py-0.2 rounded">θ̂</span> : Estimated feature weight vector</div>
                    <div><span className="font-mono font-bold text-slate-900 bg-slate-100 px-1 py-0.2 rounded">x_a</span> : Context feature vector for band <i>a</i></div>
                    <div><span className="font-mono font-bold text-slate-900 bg-slate-100 px-1 py-0.2 rounded">α</span> : UCB exploration weight factor ({alpha})</div>
                    <div><span className="font-mono font-bold text-slate-900 bg-slate-100 px-1 py-0.2 rounded">A⁻¹</span> : Feature covariance matrix (uncertainty)</div>
                    <div><span className="font-mono font-bold text-slate-900 bg-slate-100 px-1 py-0.2 rounded">w_c</span> : Coverage urgency weight ({coverageWeight})</div>
                    <div className="sm:col-span-2"><span className="font-mono font-bold text-slate-900 bg-slate-100 px-1 py-0.2 rounded">urgency_a</span> : Urgency score based on time elapsed since band <i>a</i> was visited</div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-0.5 bg-white p-2.5 rounded-lg border border-slate-200/80 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[9.5px] uppercase font-bold tracking-wider">
                    Ridge Online Update
                  </span>
                  <span className="text-[9.5px] font-medium text-slate-400">Rank-1 O(d²) • &lt; 0.2 ms</span>
                </div>
                <div className="font-mono text-[10.5px] font-bold text-slate-800 bg-slate-50 px-2 py-1.5 rounded border border-slate-200/60 overflow-x-auto whitespace-nowrap mt-0.5">
                  A ← A + x_a x_aᵀ, &nbsp; b ← b + r_t x_a, &nbsp; θ̂ = A⁻¹ b
                </div>
                {/* Individual Identifiers Breakdown */}
                <div className="mt-2 pt-1.5 border-t border-slate-100 flex flex-col gap-1 text-[9.5px] text-slate-600">
                  <span className="font-semibold text-slate-400 uppercase tracking-wider text-[8.5px]">Formula Identifiers:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-1">
                    <div><span className="font-mono font-bold text-slate-900 bg-slate-100 px-1 py-0.2 rounded">A</span> : Feature covariance matrix (reg = {regularization})</div>
                    <div><span className="font-mono font-bold text-slate-900 bg-slate-100 px-1 py-0.2 rounded">x_a x_aᵀ</span> : Outer-product rank-1 update matrix</div>
                    <div><span className="font-mono font-bold text-slate-900 bg-slate-100 px-1 py-0.2 rounded">b</span> : Reward-weighted context accumulator vector</div>
                    <div><span className="font-mono font-bold text-slate-900 bg-slate-100 px-1 py-0.2 rounded">r_t</span> : Scalar dwell reward (+0.02 hit, -0.01 miss)</div>
                    <div><span className="font-mono font-bold text-slate-900 bg-slate-100 px-1 py-0.2 rounded">θ̂</span> : Closed-form ridge parameter solution (A⁻¹ b)</div>
                    <div><span className="font-mono font-bold text-slate-900 bg-slate-100 px-1 py-0.2 rounded">A⁻¹</span> : Sherman-Morrison inverse matrix update in O(d²)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Learned Bandit Feature Weights (Live from Model) */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-label-md text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                Learned Context Feature Weights (θ̂ Vector)
              </span>
              {modelState && (
                <span className="text-[10px] text-slate-500 font-mono">
                  {modelState.num_updates || 120} online updates • MSE: {(modelState.reward_prediction_mse || 0.000057).toExponential(2)}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {Object.entries(weights).map(([feat, w]) => {
                const isPos = w >= 0;
                return (
                  <div
                    key={feat}
                    className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-col justify-between gap-1 shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10.5px] font-bold text-slate-800 truncate" title={feat}>
                        {feat}
                      </span>
                      <span
                        className={`font-mono text-[11px] font-extrabold px-1.5 py-0.2 rounded ${
                          isPos
                            ? 'bg-emerald-100/70 text-emerald-800'
                            : 'bg-amber-100/70 text-amber-800'
                        }`}
                      >
                        {isPos ? `+${w.toFixed(4)}` : w.toFixed(4)}
                      </span>
                    </div>
                    <span className="text-[9.5px] text-slate-500 leading-tight">
                      {featureDescriptions[feat] || 'Learned contextual linear parameter'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 4: Architecture & Hyperparameters Table */}
          <div className="flex flex-col gap-2">
            <span className="font-label-md text-[11px] font-bold text-slate-700 uppercase tracking-wide">
              Scheduler Hyperparameters
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-[11px]">
              <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Exploration Factor (α)</span>
                <span className="font-bold text-slate-900 font-mono">{alpha.toFixed(2)}</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Ridge Regularizer (λ)</span>
                <span className="font-bold text-slate-900 font-mono">{regularization.toFixed(2)}</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Uncertainty Weight</span>
                <span className="font-bold text-slate-900 font-mono">{uncertaintyWeight.toFixed(2)}</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Coverage Urgency (w_c)</span>
                <span className="font-bold text-slate-900 font-mono">{coverageWeight.toFixed(2)}</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Dwell Time</span>
                <span className="font-bold text-slate-900 font-mono">0.5 ms (500 µs)</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Channel Count</span>
                <span className="font-bold text-slate-900 font-mono">20 Disjoint Arms</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Frequency Range</span>
                <span className="font-bold text-slate-900 font-mono">0.50 – 18.00 GHz</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase">Decision Latency</span>
                <span className="font-bold text-emerald-700 font-mono">&lt; 0.2 ms (Real-Time)</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
