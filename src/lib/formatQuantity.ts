export function formatScaledQuantity(
  baseQuantity: number | null,
  baseServings: number,
  targetServings: number
): string {
  if (baseQuantity === null || !Number.isFinite(baseQuantity)) {
    return '';
  }

  const safeBase = baseServings > 0 ? baseServings : 4;
  const scaled = (baseQuantity * targetServings) / safeBase;

  if (scaled <= 0) return '0';

  // Common culinary fractions for small values
  const whole = Math.floor(scaled);
  const frac = scaled - whole;

  const fractionMap: Array<[number, string]> = [
    [0.25, '¼'],
    [0.33, '⅓'],
    [0.5, '½'],
    [0.66, '⅔'],
    [0.75, '¾'],
  ];

  if (scaled < 10) {
    for (const [val, symbol] of fractionMap) {
      if (Math.abs(frac - val) < 0.06) {
        return whole > 0 ? `${whole} ${symbol}` : symbol;
      }
    }
  }

  if (scaled >= 20) {
    return String(Math.round(scaled));
  }

  const roundedOneDecimal = Math.round(scaled * 10) / 10;
  if (Number.isInteger(roundedOneDecimal)) {
    return String(roundedOneDecimal);
  }

  return roundedOneDecimal.toLocaleString('it-IT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function formatTimerSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function formatDurationMinutes(minutes: number | null): string {
  if (!minutes || minutes <= 0) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}
