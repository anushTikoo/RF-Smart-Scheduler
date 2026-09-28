import React, { useState, useEffect } from 'react';
import { fetchModelState } from '../services/telemetryService';

export default function RLParametersAccordion({
  mlMetrics = {},
  openLoopMetrics = {},
  hasDataset = false,
  config = null,
  modelState: externalModelState = null,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [localModelState, setLocalModelState] = useState(null);

  const activeModelState = externalModelState || localModelState;

  // Poll or fetch model state when expanded or when dataset is loaded (if not pushed via WS)
  useEffect(() => {
    let isMounted = true;
    async function loadState() {
      if (!hasDataset) return;
      try {
        const state = await fetchModelState();
        if (isMounted && state && state.initialized) {
          setLocalModelState(state);
        }
      } catch (err) {
        console.debug('Could not load model state:', err);
      }
    }

    if (hasDataset && !externalModelState) {
      loadState();
    }
    return () => {
      isMounted = false;
    };
  }, [hasDataset, isExpanded, mlMetrics.totalHits, externalModelState]);

  const linCfg = config?.linucb || {};
  const alpha = linCfg.alpha !== undefined ? linCfg.alpha : 0.5;
  const regularization = linCfg.regularization !== undefined ? linCfg.regularization : 1.0;
  const uncertaintyWeight = linCfg.uncertainty_weight !== undefined ? linCfg.uncertainty_weight : 0.75;
  const coverageWeight = linCfg.coverage_bonus_weight !== undefined ? linCfg.coverage_bonus_weight : 1.0;

  const defaultFeatures = [
    'bias',
    'time_since_visit',
    'observed_hit_ewma',
    'previous_observed_pulse_count',
    'consecutive_no_hits',
    'learned_periodicity',
  ];

  const weights = activeModelState?.weights && Object.keys(activeModelState.weights).length > 0
    ? activeModelState.weights
    : Object.fromEntries(defaultFeatures.map((f) => [f, 0.0]));

  const featureDescriptions = {
    observed_hit_ewma: 'EWMA historical hit frequency on band',
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
            <span className="text-[16px] sm:text-[18px] font-semibold text-slate-900 tracking-tight">
              Reinforcement Learning Parameters & Policy Model
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-slate-500">
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
          className="border-t border-slate-100 px-5 sm:px-6 py-6 bg-white flex flex-col gap-6 animate-in fade-in duration-200"
          id="rl-params-content"
        >
          {/* Section 1: Live Average & Cumulative Reward Comparison Cards */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-semibold text-slate-800 uppercase tracking-wide">
                Live Reward Signals & Policy Comparison
              </span>
              <span className="text-[11px] text-slate-500 font-mono">
                Streamed live from running simulation
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* LinUCB Adaptive ML Card */}
              <div className="p-4 rounded-xl bg-slate-50/90 border border-slate-200 shadow-2xs flex flex-col justify-between gap-3 text-left">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-primary">neurology</span>
                    <span className="text-[14px] font-semibold text-slate-900 uppercase">
                      Adaptive ML
                    </span>
                  </div>
                  <span className="px-2.5 py-1 rounded-md bg-primary/10 text-primary border border-primary/20 text-[11px] font-semibold uppercase tracking-wider">
                    LinUCB Contextual Bandit
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 py-1.5">
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Avg Reward / Dwell</span>
                    <span className="font-mono text-[16px] sm:text-[18px] font-semibold text-primary">
                      {hasDataset ? (mlMetrics.avgReward && mlMetrics.avgReward !== '-' ? mlMetrics.avgReward : '0.000') : '-'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Cumulative Reward</span>
                    <span className="font-mono text-[16px] sm:text-[18px] font-semibold text-slate-800">
                      {hasDataset ? (mlMetrics.cumulativeReward && mlMetrics.cumulativeReward !== '-' ? mlMetrics.cumulativeReward : '0.00') : '-'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Pulses Detected</span>
                    <span className="font-mono text-[16px] sm:text-[18px] font-semibold text-slate-800">
                      {hasDataset ? (mlMetrics.totalHits !== undefined && mlMetrics.totalHits !== '-' ? mlMetrics.totalHits : 0) : '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Open Loop Round Robin Card */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-2xs flex flex-col justify-between gap-3 text-left">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-slate-500">sync</span>
                    <span className="text-[14px] font-semibold text-slate-800 uppercase">
                      Open Loop
                    </span>
                  </div>
                  <span className="px-2.5 py-1 rounded-md bg-slate-200/80 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
                    Sequential Sweep
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 py-1.5">
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Avg Reward / Dwell</span>
                    <span className="font-mono text-[16px] sm:text-[18px] font-semibold text-slate-700">
                      {hasDataset ? (openLoopMetrics.avgReward && openLoopMetrics.avgReward !== '-' ? openLoopMetrics.avgReward : '0.000') : '-'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Cumulative Reward</span>
                    <span className="font-mono text-[16px] sm:text-[18px] font-semibold text-slate-800">
                      {hasDataset ? (openLoopMetrics.cumulativeReward && openLoopMetrics.cumulativeReward !== '-' ? openLoopMetrics.cumulativeReward : '0.00') : '-'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Pulses Detected</span>
                    <span className="font-mono text-[16px] sm:text-[18px] font-semibold text-slate-700">
                      {hasDataset ? (openLoopMetrics.totalHits !== undefined && openLoopMetrics.totalHits !== '-' ? openLoopMetrics.totalHits : 0) : '-'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Mathematical Formulation & Decision Rule (Compact Light Theme) */}
          <div className="flex flex-col gap-2 p-4 rounded-xl bg-slate-50/80 border border-slate-200/90 shadow-2xs font-sans">
            <div className="flex items-center justify-between pb-2 mb-1 border-b border-slate-200/60">
              <span className="text-[14px] font-semibold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">functions</span>
                LinUCB Decision Rule & Closed-Form Update
              </span>
              <span className="text-slate-500 font-mono text-[11px]">v2 Context Architecture</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
              <div className="flex flex-col gap-1.5 bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200/80 shadow-2xs text-left">
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 text-[12px] uppercase font-semibold tracking-wider">
                    UCB Arm Selection
                  </span>
                  <span className="text-[11px] text-slate-500 font-medium">Score + Covariance + Urgency</span>
                </div>
                <div className="font-mono text-[13px] sm:text-[14px] font-medium bg-slate-50 px-3 py-2.5 rounded-lg border border-slate-200/60 overflow-x-auto whitespace-nowrap mt-1.5 text-slate-800 leading-normal">
                  a* = argmax [ θ̂ᵀ x_a + α √(x_aᵀ A⁻¹ x_a) + w_c · urgency_a ]
                </div>
                {/* Individual Identifiers Breakdown */}
                <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-col gap-2 text-[12px] text-slate-600">
                  <span className="font-medium text-slate-500 uppercase tracking-wider text-[11px]">Formula Identifiers:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
                    <div><span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">a*</span> : Selected optimal band (action/arm)</div>
                    <div><span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">θ̂</span> : Estimated feature weight vector</div>
                    <div><span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">x_a</span> : Context feature vector for band <i>a</i></div>
                    <div><span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">α</span> : UCB exploration weight factor ({alpha})</div>
                    <div><span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">A⁻¹</span> : Feature covariance matrix (uncertainty)</div>
                    <div><span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">w_c</span> : Coverage urgency weight ({coverageWeight})</div>
                    <div className="sm:col-span-2"><span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">urgency_a</span> : Urgency score based on time elapsed since band <i>a</i> was visited</div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200/80 shadow-2xs text-left">
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 text-[12px] uppercase font-semibold tracking-wider">
                    Ridge Online Update
                  </span>
                  <span className="text-[11px] font-medium text-slate-500">Rank-1 O(d²) • &lt; 0.2 ms</span>
                </div>
                <div className="font-mono text-[13px] sm:text-[14px] font-medium text-slate-800 bg-slate-50 px-3 py-2.5 rounded-lg border border-slate-200/60 overflow-x-auto whitespace-nowrap mt-1.5 leading-normal">
                  A ← A + x_a x_aᵀ, &nbsp; b ← b + r_t x_a, &nbsp; θ̂ = A⁻¹ b
                </div>
                {/* Individual Identifiers Breakdown */}
                <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-col gap-2 text-[12px] text-slate-600">
                  <span className="font-medium text-slate-500 uppercase tracking-wider text-[11px]">Formula Identifiers:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
                    <div><span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">A</span> : Feature covariance matrix (reg = {regularization})</div>
                    <div><span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">x_a x_aᵀ</span> : Outer-product rank-1 update matrix</div>
                    <div><span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">b</span> : Reward-weighted context accumulator vector</div>
                    <div><span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">r_t</span> : Scalar dwell reward (+0.02 hit, -0.01 miss)</div>
                    <div><span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">θ̂</span> : Closed-form ridge parameter solution (A⁻¹ b)</div>
                    <div><span className="font-mono font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded text-[12px]">A⁻¹</span> : Sherman-Morrison inverse matrix update in O(d²)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Learned Bandit Feature Weights (Live from Model) */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-semibold text-slate-800 uppercase tracking-wide">
                Learned Context Feature Weights (θ̂ Vector)
              </span>
              {activeModelState && (
                <span className="text-[11px] text-slate-500 font-mono">
                  {(activeModelState.num_updates ?? 0)} online updates • MSE: {(activeModelState.reward_prediction_mse ?? 0).toExponential(2)}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {Object.entries(weights).map(([feat, w]) => {
                const isPos = w >= 0;
                return (
                  <div
                    key={feat}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-2 shadow-2xs text-left"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[12px] font-medium text-slate-800 truncate" title={feat}>
                        {feat}
                      </span>
                      <span
                        className={`font-mono text-[12px] font-semibold px-1.5 py-0.5 rounded ${
                          isPos
                            ? 'bg-emerald-100/70 text-emerald-800'
                            : 'bg-amber-100/70 text-amber-800'
                        }`}
                      >
                        {isPos ? `+${w.toFixed(4)}` : w.toFixed(4)}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 leading-[16px]">
                      {featureDescriptions[feat] || 'Learned contextual linear parameter'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 4: Architecture & Hyperparameters Table */}
          <div className="flex flex-col gap-2">
            <span className="text-[14px] font-semibold text-slate-800 uppercase tracking-wide">
              Scheduler Hyperparameters
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1 text-left">
                <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Exploration Factor (α)</span>
                <span className="font-semibold text-slate-900 font-mono text-[13px] sm:text-[14px]">{alpha.toFixed(2)}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1 text-left">
                <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Ridge Regularizer (λ)</span>
                <span className="font-semibold text-slate-900 font-mono text-[13px] sm:text-[14px]">{regularization.toFixed(2)}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1 text-left">
                <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Uncertainty Weight</span>
                <span className="font-semibold text-slate-900 font-mono text-[13px] sm:text-[14px]">{uncertaintyWeight.toFixed(2)}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1 text-left">
                <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Coverage Urgency (w_c)</span>
                <span className="font-semibold text-slate-900 font-mono text-[13px] sm:text-[14px]">{coverageWeight.toFixed(2)}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1 text-left">
                <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Dwell Time</span>
                <span className="font-semibold text-slate-900 font-mono text-[13px] sm:text-[14px]">0.5 ms (500 µs)</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1 text-left">
                <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Channel Count</span>
                <span className="font-semibold text-slate-900 font-mono text-[13px] sm:text-[14px]">20 Disjoint Arms</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1 text-left">
                <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Frequency Range</span>
                <span className="font-semibold text-slate-900 font-mono text-[13px] sm:text-[14px]">0.50 – 18.00 GHz</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1 text-left">
                <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">Decision Latency</span>
                <span className="font-semibold text-slate-900 font-mono text-[13px] sm:text-[14px]">&lt; 0.2 ms</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
