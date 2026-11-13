import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/usePWAInstall.ts';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-[#B45309] text-white px-4 py-2 text-xs font-medium flex items-center justify-center gap-2"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      <span>Sei offline — I tuoi Preferiti salvati e i timer restano disponibili.</span>
    </div>
  );
};
