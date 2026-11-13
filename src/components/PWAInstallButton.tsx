import React, { useState } from 'react';
import { Download, Share, PlusSquare, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#2D5A3D] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1E3F2B] active:scale-[0.98] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2D5A3D]"
      >
        <Download className="h-4 w-4 shrink-0" />
        <span>Installa App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#D4D1C7] bg-white px-3.5 py-2 text-sm font-medium text-[#1C1D1A] transition-colors hover:bg-[#F2F1EC] active:scale-[0.98] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2D5A3D]"
        >
          <Smartphone className="h-4 w-4 text-[#2D5A3D] shrink-0" />
          <span>Installa su iPhone</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-xs p-0 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[#FAFAF7] border border-[#E2E0D8] p-6 pb-8 sm:pb-6 shadow-xl">
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[#D4D1C7] sm:hidden" />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3
                    id="ios-install-title"
                    className="font-display text-xl font-semibold text-[#1C1D1A]"
                  >
                    Installa Ricettario Ai su iPhone
                  </h3>
                  <p className="mt-1 text-sm text-[#55574E]">
                    Usala a schermo intero come un’app nativa e consulta i preferiti anche senza internet.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Chiudi guida installazione"
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-[#55574E] hover:bg-[#F2F1EC]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <ol className="mt-5 space-y-4 text-sm text-[#1C1D1A]">
                <li className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#2D5A3D] text-xs font-semibold text-white">
                    1
                  </span>
                  <div className="pt-0.5">
                    Apri questa pagina in <strong>Safari</strong> su iPhone e tocca il pulsante{' '}
                    <span className="inline-flex items-center gap-1 font-semibold text-[#2D5A3D]">
                      <Share className="h-4 w-4 inline" /> Condividi
                    </span>{' '}
                    nella barra in basso.
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#2D5A3D] text-xs font-semibold text-white">
                    2
                  </span>
                  <div className="pt-0.5">
                    Scorri il menu verso il basso e seleziona{' '}
                    <span className="inline-flex items-center gap-1 font-semibold text-[#2D5A3D]">
                      <PlusSquare className="h-4 w-4 inline" /> Aggiungi alla schermata Home
                    </span>
                    .
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#2D5A3D] text-xs font-semibold text-white">
                    3
                  </span>
                  <div className="pt-0.5">
                    Tocca <strong>Aggiungi</strong> in alto a destra per avere l’icona Ricettario Ai sempre pronta in cucina.
                  </div>
                </li>
              </ol>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full min-h-[48px] rounded-xl bg-[#2D5A3D] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1E3F2B] transition-colors"
              >
                Ho capito
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
