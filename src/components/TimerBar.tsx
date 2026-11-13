import React, { useState } from 'react';
import { BellRing, Pause, Play, Plus, RotateCcw, Sun, Timer, X } from 'lucide-react';
import type { KitchenTimer } from '../hooks/useKitchenTimers.ts';
import { formatTimerSeconds } from '../lib/formatQuantity.ts';

interface TimerBarProps {
  timers: KitchenTimer[];
  wakeLockActive: boolean;
  wakeLockSupported: boolean;
  onToggleWakeLock: () => void;
  onTogglePause: (id: string) => void;
  onAddMinute: (id: string, deltaSeconds?: number) => void;
  onReset: (id: string) => void;
  onDismiss: (id: string) => void;
  onDismissFinished: (id: string) => void;
  onAddCustomTimer: (minutes: number, label: string) => void;
}

export const TimerBar: React.FC<TimerBarProps> = ({
  timers,
  wakeLockActive,
  wakeLockSupported,
  onToggleWakeLock,
  onTogglePause,
  onAddMinute,
  onReset,
  onDismiss,
  onDismissFinished,
  onAddCustomTimer,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [customMinutes, setCustomMinutes] = useState(5);

  const finishedTimers = timers.filter((t) => t.isFinished);
  const primaryTimer = finishedTimers[0] || timers.find((t) => t.isRunning) || timers[0];

  if (timers.length === 0 && !expanded) {
    return null;
  }

  return (
    <div className="fixed bottom-[calc(64px+env(safe-area-inset-bottom,0px))] lg:bottom-6 left-3 right-3 lg:left-auto lg:right-6 lg:w-[420px] z-40">
      {expanded && (
        <div className="mb-2 rounded-2xl border border-[#E2E0D8] bg-white p-4 shadow-lg">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E2E0D8]">
            <span className="text-sm font-semibold text-[#1C1D1A]">Timer da cucina</span>
            <div className="flex items-center gap-2">
              {wakeLockSupported && (
                <button
                  type="button"
                  onClick={onToggleWakeLock}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    wakeLockActive
                      ? 'bg-[#2D5A3D] text-white'
                      : 'bg-[#F2F1EC] text-[#55574E] hover:text-[#1C1D1A]'
                  }`}
                >
                  <Sun className="h-3.5 w-3.5" />
                  <span>{wakeLockActive ? 'Schermo acceso' : 'Schermo auto'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setExpanded(false)}
                aria-label="Riduci pannello timer"
                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-[#55574E] hover:bg-[#F2F1EC]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 max-h-56 overflow-y-auto space-y-2.5">
            {timers.map((timer) => (
              <div
                key={timer.id}
                className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${
                  timer.isFinished
                    ? 'border-[#B45309] bg-[#FEF3C7]/45'
                    : 'border-[#E2E0D8] bg-[#FAFAF7]'
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-[#55574E]">
                    {timer.stepNumber ? `Passo ${timer.stepNumber} · ` : ''}
                    {timer.label}
                  </div>
                  <div
                    className={`font-mono-tabular text-xl font-semibold ${
                      timer.isFinished ? 'text-[#B45309]' : 'text-[#1C1D1A]'
                    }`}
                  >
                    {timer.isFinished ? '00:00 · Pronto' : formatTimerSeconds(timer.remainingSeconds)}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {timer.isFinished ? (
                    <button
                      type="button"
                      onClick={() => onDismissFinished(timer.id)}
                      className="min-h-[40px] rounded-lg bg-[#B45309] px-3 text-xs font-semibold text-white"
                    >
                      OK
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onTogglePause(timer.id)}
                        aria-label={timer.isRunning ? 'Pausa timer' : 'Avvia timer'}
                        className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg bg-[#2D5A3D] text-white"
                      >
                        {timer.isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => onAddMinute(timer.id, 60)}
                        className="min-h-[40px] rounded-lg border border-[#E2E0D8] bg-white px-2.5 text-xs font-medium text-[#1C1D1A]"
                      >
                        +1m
                      </button>
                      <button
                        type="button"
                        onClick={() => onReset(timer.id)}
                        aria-label="Azzera timer"
                        className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-[#55574E] hover:bg-[#F2F1EC]"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => onDismiss(timer.id)}
                    aria-label="Elimina timer"
                    className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-[#55574E] hover:bg-[#F2F1EC]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 pt-3 border-t border-[#E2E0D8] flex items-center gap-2">
            <label htmlFor="custom-timer-min" className="text-xs text-[#55574E] shrink-0">
              Nuovo (min):
            </label>
            <input
              id="custom-timer-min"
              type="number"
              min={1}
              max={240}
              value={customMinutes}
              onChange={(e) => setCustomMinutes(Math.max(1, Number(e.target.value) || 1))}
              className="w-16 min-h-[40px] rounded-lg border border-[#E2E0D8] bg-[#FAFAF7] px-2 text-center font-mono-tabular text-sm"
            />
            <button
              type="button"
              onClick={() => {
                onAddCustomTimer(customMinutes, `Timer ${customMinutes} min`);
              }}
              className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2D5A3D] px-3 text-xs font-medium text-white hover:bg-[#1E3F2B]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Avvia timer</span>
            </button>
          </div>
        </div>
      )}

      {primaryTimer && (
        <div
          className={`flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-2 shadow-lg transition-colors ${
            primaryTimer.isFinished
              ? 'border-[#B45309] bg-[#B45309] text-white'
              : 'border-[#E2E0D8] bg-white/95 backdrop-blur-md text-[#1C1D1A]'
          }`}
        >
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left min-h-[44px]"
          >
            {primaryTimer.isFinished ? (
              <BellRing className="h-5 w-5 shrink-0" />
            ) : (
              <Timer className="h-5 w-5 shrink-0 text-[#2D5A3D]" />
            )}
            <div className="min-w-0">
              <div
                className={`truncate text-xs ${
                  primaryTimer.isFinished ? 'text-white/90' : 'text-[#55574E]'
                }`}
              >
                {primaryTimer.label}
                {timers.length > 1 ? ` (+${timers.length - 1})` : ''}
              </div>
              <div className="font-mono-tabular text-base font-semibold leading-tight">
                {primaryTimer.isFinished
                  ? 'Tempo scaduto'
                  : formatTimerSeconds(primaryTimer.remainingSeconds)}
              </div>
            </div>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            {primaryTimer.isFinished ? (
              <button
                type="button"
                onClick={() => onDismissFinished(primaryTimer.id)}
                className="min-h-[40px] rounded-xl bg-white px-3 text-xs font-semibold text-[#B45309]"
              >
                Silenzia
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onTogglePause(primaryTimer.id)}
                  aria-label={primaryTimer.isRunning ? 'Metti in pausa' : 'Riprendi'}
                  className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl bg-[#2D5A3D] text-white"
                >
                  {primaryTimer.isRunning ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onAddMinute(primaryTimer.id, 60)}
                  className="min-h-[40px] rounded-xl border border-[#E2E0D8] bg-[#FAFAF7] px-2.5 text-xs font-medium text-[#1C1D1A]"
                >
                  +1m
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
