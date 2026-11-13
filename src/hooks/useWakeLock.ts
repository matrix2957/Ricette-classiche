import { useCallback, useEffect, useRef, useState } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}

export function useWakeLock() {
  const [isSupported] = useState<boolean>(
    () => typeof navigator !== 'undefined' && 'wakeLock' in navigator
  );
  const [isActive, setIsActive] = useState(false);
  const [wantLock, setWantLock] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  const acquire = useCallback(async () => {
    if (!isSupported) {
      setNotice('Il browser attuale non supporta il blocco schermo automatico.');
      return false;
    }
    try {
      const wakeLockApi = (navigator as unknown as {
        wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
      }).wakeLock;
      const sentinel = await wakeLockApi.request('screen');
      sentinelRef.current = sentinel;
      setIsActive(true);
      setNotice(null);
      sentinel.addEventListener('release', () => {
        setIsActive(false);
      });
      return true;
    } catch {
      setIsActive(false);
      setNotice('Schermo sempre acceso non autorizzato in questa vista (funziona da Safari/PWA installata).');
      return false;
    }
  }, [isSupported]);

  const requestWakeLock = useCallback(async () => {
    setWantLock(true);
    return acquire();
  }, [acquire]);

  const releaseWakeLock = useCallback(async () => {
    setWantLock(false);
    setNotice(null);
    if (sentinelRef.current && !sentinelRef.current.released) {
      try {
        await sentinelRef.current.release();
      } catch {
        // ignore release error
      }
    }
    sentinelRef.current = null;
    setIsActive(false);
  }, []);

  const toggleWakeLock = useCallback(async () => {
    if (wantLock || isActive) {
      await releaseWakeLock();
    } else {
      await requestWakeLock();
    }
  }, [wantLock, isActive, releaseWakeLock, requestWakeLock]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && wantLock && (!sentinelRef.current || sentinelRef.current.released)) {
        void acquire();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [wantLock, acquire]);

  useEffect(() => {
    return () => {
      if (sentinelRef.current && !sentinelRef.current.released) {
        void sentinelRef.current.release();
      }
    };
  }, []);

  return {
    isSupported,
    isActive,
    wantLock,
    notice,
    requestWakeLock,
    releaseWakeLock,
    toggleWakeLock,
  };
}

export function playKitchenChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playTone = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.24, now + startOffset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration);
    };

    playTone(880, 0, 0.45);
    playTone(1174.66, 0.22, 0.55);
    playTone(880, 0.65, 0.45);
    playTone(1174.66, 0.87, 0.7);

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([220, 100, 220, 100, 320]);
    }
  } catch {
    // Audio playback blocked or unsupported
  }
}
