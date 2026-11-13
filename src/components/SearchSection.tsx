import React, { useState } from 'react';
import { ArrowRight, ExternalLink, Flame, Link2, Search, Utensils } from 'lucide-react';
import type { GroundingSource, RecipeSearchResult } from '../types/recipe.ts';
import { formatDurationMinutes } from '../lib/formatQuantity.ts';

interface SearchSectionProps {
  isOnline: boolean;
  onOpenFromSearchResult: (result: RecipeSearchResult) => Promise<void>;
  onExtractFromUrl: (url: string) => Promise<void>;
  isPreparing: boolean;
  preparingTitle: string | null;
}

const SUGGESTED_DISHES = [
  'Carbonara tradizionale',
  'Ragù alla bolognese',
  'Risotto alla milanese',
  'Parmigiana di melanzane',
  'Lasagne al forno',
  'Tiramisù classico',
];

function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim();
  return /^https?:\/\/\S+/i.test(trimmed) || /^www\.\S+\.\S+/i.test(trimmed);
}

export const SearchSection: React.FC<SearchSectionProps> = ({
  isOnline,
  onOpenFromSearchResult,
  onExtractFromUrl,
  isPreparing,
  preparingTitle,
}) => {
  const [mode, setMode] = useState<'search' | 'url'>('search');
  const [inputValue, setInputValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [results, setResults] = useState<RecipeSearchResult[]>([]);
  const [groundingSources, setGroundingSources] = useState<GroundingSource[]>([]);
  const [lastQuery, setLastQuery] = useState<string>('');

  const handleSearch = async (queryOverride?: string) => {
    const raw = (queryOverride ?? inputValue).trim();
    if (!raw) {
      setErrorMsg(
        mode === 'url'
          ? 'Incolla il link completo di una ricetta (es. https://...).'
          : 'Scrivi il nome di una ricetta o di un ingrediente.'
      );
      return;
    }

    if (!isOnline) {
      setErrorMsg('Sei offline: la ricerca web richiede connessione. I tuoi Preferiti sono disponibili nella scheda Preferiti.');
      return;
    }

    setErrorMsg(null);

    if (mode === 'url' || looksLikeUrl(raw)) {
      const normalizedUrl = raw.startsWith('http') ? raw : `https://${raw}`;
      try {
        await onExtractFromUrl(normalizedUrl);
      } catch (err) {
        setErrorMsg((err as Error).message || 'Impossibile estrarre la ricetta da questo link.');
      }
      return;
    }

    setIsSearching(true);
    setLastQuery(raw);
    try {
      const res = await fetch('/api/recipes/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: raw }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Errore durante la ricerca sul web.');
      }
      setResults(Array.isArray(data.results) ? data.results : []);
      setGroundingSources(Array.isArray(data.groundingSources) ? data.groundingSources : []);
      if (!data.results || data.results.length === 0) {
        setErrorMsg('Nessuna ricetta tradizionale trovata per questa ricerca. Prova un termine diverso.');
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'Errore di connessione durante la ricerca.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Hero Search & URL Extractor */}
      <section className="rounded-2xl border border-[#E2E0D8] bg-white p-5 sm:p-8">
        <div className="max-w-2xl">
          <p className="text-xs font-medium tracking-wide text-[#2D5A3D]">
            Cucina di casa · Solo fornelli, forno, padella e pentola
          </p>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#1C1D1A] text-balance">
            Ricette tradizionali dal web, pulite e senza pubblicità.
          </h1>
          <p className="mt-2.5 text-sm sm:text-base text-[#55574E] leading-relaxed">
            Cerca un piatto tradizionale oppure incolla il link di una ricetta online: eliminiamo banner,
            chiacchiere e passaggi da robot da cucina, lasciando solo dosi precise e cotture reali.
          </p>
        </div>

        {/* Mode Segmented Control */}
        <div className="mt-6 inline-flex rounded-xl bg-[#F2F1EC] p-1">
          <button
            type="button"
            onClick={() => {
              setMode('search');
              setErrorMsg(null);
            }}
            className={`min-h-[40px] inline-flex items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              mode === 'search'
                ? 'bg-white text-[#1C1D1A] shadow-xs'
                : 'text-[#55574E] hover:text-[#1C1D1A]'
            }`}
          >
            <Search className="h-4 w-4" />
            <span>Cerca sul web</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('url');
              setErrorMsg(null);
            }}
            className={`min-h-[40px] inline-flex items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              mode === 'url'
                ? 'bg-white text-[#1C1D1A] shadow-xs'
                : 'text-[#55574E] hover:text-[#1C1D1A]'
            }`}
          >
            <Link2 className="h-4 w-4" />
            <span>Incolla link URL</span>
          </button>
        </div>

        {/* Search / URL Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSearch();
          }}
          className="mt-4 flex flex-col sm:flex-row gap-3"
        >
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#55574E]">
              {mode === 'url' || looksLikeUrl(inputValue) ? (
                <Link2 className="h-4 w-4 text-[#2D5A3D]" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </div>
            <input
              type={mode === 'url' ? 'url' : 'text'}
              inputMode={mode === 'url' ? 'url' : 'search'}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={
                mode === 'url'
                  ? 'https://ricette.giallozafferano.it/...'
                  : 'Es. Spaghetti alle vongole, Ossobuco, Ribollita...'
              }
              aria-label={mode === 'url' ? 'Link URL della ricetta' : 'Cerca ricetta tradizionale'}
              className="w-full min-h-[48px] rounded-xl border border-[#D4D1C7] bg-[#FAFAF7] pl-10 pr-4 text-base text-[#1C1D1A] placeholder:text-[#8A8C80] focus:border-[#2D5A3D] focus:bg-white focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={isSearching || isPreparing}
            className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#2D5A3D] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1E3F2B] disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <span>
              {isSearching
                ? 'Ricerca in corso...'
                : isPreparing
                ? 'Pulizia ricetta...'
                : mode === 'url' || looksLikeUrl(inputValue)
                ? 'Estrai ricetta pulita'
                : 'Cerca ricette'}
            </span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        {/* Quick suggestions */}
        {mode === 'search' && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#55574E] mr-1">Classici rapidi:</span>
            {SUGGESTED_DISHES.map((dish) => (
              <button
                key={dish}
                type="button"
                disabled={isSearching || isPreparing}
                onClick={() => {
                  setInputValue(dish);
                  void handleSearch(dish);
                }}
                className="min-h-[36px] rounded-lg border border-[#E2E0D8] bg-[#FAFAF7] px-3 py-1 text-xs font-medium text-[#1C1D1A] transition-colors hover:border-[#2D5A3D] hover:text-[#2D5A3D]"
              >
                {dish}
              </button>
            ))}
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-[#B45309]/30 bg-[#FEF3C7]/45 px-4 py-3 text-sm text-[#78350F]"
          >
            {errorMsg}
          </div>
        )}

        {isPreparing && (
          <div className="mt-4 rounded-xl border border-[#2D5A3D]/25 bg-[#2D5A3D]/5 px-4 py-3 text-sm text-[#1E3F2B]">
            Sto preparando <strong>{preparingTitle || 'la ricetta'}</strong>: rimozione pubblicità, conversione senza robot da cucina e calcolo parametri di cottura...
          </div>
        )}
      </section>

      {/* Loading skeletons */}
      {isSearching && (
        <section aria-label="Caricamento risultati" className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="rounded-2xl border border-[#E2E0D8] bg-white p-5 space-y-3 animate-pulse"
            >
              <div className="h-3 w-28 rounded bg-[#E2E0D8]" />
              <div className="h-6 w-3/4 rounded bg-[#E2E0D8]" />
              <div className="h-4 w-full rounded bg-[#F2F1EC]" />
              <div className="h-4 w-2/3 rounded bg-[#F2F1EC]" />
            </div>
          ))}
        </section>
      )}

      {/* Search Results */}
      {!isSearching && results.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-2xl font-semibold text-[#1C1D1A]">
              Risultati tradizionali per “{lastQuery}”
            </h2>
            <span className="text-xs text-[#55574E]">
              {results.length} ricette senza robot da cucina
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {results.map((item) => {
              const totalTime =
                (item.prepTimeMinutes || 0) + (item.cookTimeMinutes || 0);
              return (
                <article
                  key={item.id}
                  className="flex flex-col justify-between rounded-2xl border border-[#E2E0D8] bg-white p-5 transition-colors hover:border-[#2D5A3D]/50"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs text-[#55574E]">
                      <span className="truncate font-medium text-[#2D5A3D]">
                        {item.sourceName}
                        {item.region ? ` · ${item.region}` : ''}
                      </span>
                      {item.sourceUrl && (
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#55574E] hover:text-[#1C1D1A] shrink-0"
                        >
                          <span>Fonte</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>

                    <h3 className="mt-2 font-display text-xl font-semibold text-[#1C1D1A] leading-snug">
                      {item.title}
                    </h3>

                    <p className="mt-2 text-sm text-[#55574E] leading-relaxed">
                      {item.description}
                    </p>
                  </div>

                  <div className="mt-5 pt-4 border-t border-[#F2F1EC] flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#55574E] font-mono-tabular">
                      <span className="inline-flex items-center gap-1 font-sans">
                        <Utensils className="h-3.5 w-3.5 text-[#2D5A3D]" />
                        {item.primaryUtensil}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{totalTime > 0 ? formatDurationMinutes(totalTime) : 'Tempo var.'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-sans">{item.difficulty}</span>
                    </div>

                    <button
                      type="button"
                      disabled={isPreparing}
                      onClick={() => void onOpenFromSearchResult(item)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#2D5A3D] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1E3F2B] disabled:opacity-60 whitespace-nowrap shrink-0"
                    >
                      <span>Apri pulita</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {groundingSources.length > 0 && (
            <div className="rounded-xl border border-[#E2E0D8] bg-[#F2F1EC]/60 p-4">
              <p className="text-xs font-medium text-[#55574E]">
                Fonti web consultate durante la ricerca:
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                {groundingSources.slice(0, 6).map((src) => (
                  <a
                    key={src.url}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[#2D5A3D] hover:underline"
                  >
                    <span className="max-w-[220px] truncate">{src.title}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Empty initial guide */}
      {!isSearching && results.length === 0 && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-[#E2E0D8] bg-white p-5">
            <Flame className="h-5 w-5 text-[#2D5A3D]" />
            <h3 className="mt-3 text-base font-semibold text-[#1C1D1A]">
              Solo metodi tradizionali
            </h3>
            <p className="mt-1.5 text-sm text-[#55574E] leading-relaxed">
              Ogni ricetta viene convertita o selezionata escludendo robot da cucina: solo fornelli,
              forno, padella e pentola.
            </p>
          </div>
          <div className="rounded-2xl border border-[#E2E0D8] bg-white p-5">
            <Utensils className="h-5 w-5 text-[#2D5A3D]" />
            <h3 className="mt-3 text-base font-semibold text-[#1C1D1A]">
              Dosi ricalcolate e spunta
            </h3>
            <p className="mt-1.5 text-sm text-[#55574E] leading-relaxed">
              Aumenta o riduci le porzioni con un tocco e spunta ogni ingrediente mentre prepari il piano di lavoro.
            </p>
          </div>
          <div className="rounded-2xl border border-[#E2E0D8] bg-white p-5">
            <Search className="h-5 w-5 text-[#2D5A3D]" />
            <h3 className="mt-3 text-base font-semibold text-[#1C1D1A]">
              Timer e preferiti offline
            </h3>
            <p className="mt-1.5 text-sm text-[#55574E] leading-relaxed">
              Avvia il timer direttamente da ogni passaggio con schermo sempre acceso e salva le ricette con le tue note.
            </p>
          </div>
        </section>
      )}
    </div>
  );
};
