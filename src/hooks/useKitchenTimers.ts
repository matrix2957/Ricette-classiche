import { useCallback, useEffect, useState } from 'react';
import { playKitchenChime } from './useWakeLock.ts';

export interface KitchenTimer {
  id: string;
  label: string;
  stepNumber?: number;
  totalSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  isFinished: boolean;
  endTimestamp: number | null;
}

export function useKitchenTimers(onTimerStarted?: () => void) {
  const [timers, setTimers] = useState<KitchenTimer[]>([]);

  useEffect(() => {
    const hasRunning = timers.some((t) => t.isRunning);
    if (!hasRunning) return;

    const interval = window.setInterval(() => {
      const now = Date.now();
      let anyFinishedJustNow = false;

      setTimers((prev) =>
        prev.map((timer) => {
          if (!timer.isRunning || timer.endTimestamp === null) return timer;
          const remaining = Math.max(0, Math.ceil((timer.endTimestamp - now) / 1000));
          if (remaining === 0 && !timer.isFinished) {
            anyFinishedJustNow = true;
            return {
              ...timer,
              remainingSeconds: 0,
              isRunning: false,
              isFinished: true,
              endTimestamp: null,
            };
          }
          if (remaining !== timer.remainingSeconds) {
            return { ...timer, remainingSeconds: remaining };
          }
          return timer;
        })
      );

      if (anyFinishedJustNow) {
        playKitchenChime();
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, [timers]);

  const startOrCreateTimer = useCallback(
    (opts: { id: string; label: string; seconds: number; stepNumber?: number }) => {
      const safeSeconds = Math.max(5, Math.round(opts.seconds));
      const now = Date.now();
      setTimers((prev) => {
        const existing = prev.find((t) => t.id === opts.id);
        if (existing) {
          const baseSeconds = existing.isFinished || existing.remainingSeconds === 0
            ? safeSeconds
            : existing.remainingSeconds;
          return prev.map((t) =>
            t.id === opts.id
              ? {
                  ...t,
                  isRunning: true,
                  isFinished: false,
                  remainingSeconds: baseSeconds,
                  endTimestamp: now + baseSeconds * 1000,
                }
              : t
          );
        }
        return [
          ...prev,
          {
            id: opts.id,
            label: opts.label,
            stepNumber: opts.stepNumber,
            totalSeconds: safeSeconds,
            remainingSeconds: safeSeconds,
            isRunning: true,
            isFinished: false,
            endTimestamp: now + safeSeconds * 1000,
          },
        ];
      });
      onTimerStarted?.();
    },
    [onTimerStarted]
  );

  const togglePauseTimer = useCallback(
    (id: string) => {
      const now = Date.now();
      setTimers((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          if (t.isRunning) {
            return {
              ...t,
              isRunning: false,
              endTimestamp: null,
            };
          }
          const base = t.remainingSeconds > 0 ? t.remainingSeconds : t.totalSeconds;
          onTimerStarted?.();
          return {
            ...t,
            isRunning: true,
            isFinished: false,
            remainingSeconds: base,
            endTimestamp: now + base * 1000,
          };
        })
      );
    },
    [onTimerStarted]
  );

  const addMinuteToTimer = useCallback((id: string, deltaSeconds = 60) => {
    const now = Date.now();
    setTimers((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const nextRemaining = Math.max(5, t.remainingSeconds + deltaSeconds);
        return {
          ...t,
          totalSeconds: Math.max(t.totalSeconds, nextRemaining),
          remainingSeconds: nextRemaining,
          isFinished: false,
          endTimestamp: t.isRunning ? now + nextRemaining * 1000 : null,
        };
      })
    );
  }, []);

  const resetTimer = useCallback((id: string) => {
    setTimers((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              remainingSeconds: t.totalSeconds,
              isRunning: false,
              isFinished: false,
              endTimestamp: null,
            }
          : t
      )
    );
  }, []);

  const dismissTimer = useCallback((id: string) => {
    setTimers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissFinishedAlert = useCallback((id: string) => {
    setTimers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isFinished: false } : t))
    );
  }, []);

  return {
    timers,
    startOrCreateTimer,
    togglePauseTimer,
    addMinuteToTimer,
    resetTimer,
    dismissTimer,
    dismissFinishedAlert,
  };
}
