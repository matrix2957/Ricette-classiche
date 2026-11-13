import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, ChefHat, Search, Timer } from 'lucide-react';
import type {
  PreparedRecipe,
  RecipeSearchResult,
  SavedFavoriteRecipe,
} from './types/recipe.ts';
import { useOnlineStatus } from './hooks/usePWAInstall.ts';
import { useWakeLock } from './hooks/useWakeLock.ts';
import { useKitchenTimers } from './hooks/useKitchenTimers.ts';
import {
  cacheLastOpenedRecipe,
  getAllFavorites,
  getLastOpenedRecipe,
  removeFavoriteRecipe,
  saveFavoriteRecipe,
  updateFavoriteNotes,
} from './lib/offlineStorage.ts';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import { SearchSection } from './components/SearchSection.tsx';
import { RecipeDetailView } from './components/RecipeDetailView.tsx';
import { FavoritesView } from './components/FavoritesView.tsx';
import { TimerBar } from './components/TimerBar.tsx';

type AppTab = 'search' | 'recipe' | 'favorites';

export default function App() {
  const isOnline = useOnlineStatus();
  const wakeLock = useWakeLock();

  const handleTimerStarted = useCallback(() => {
    if (!wakeLock.wantLock) {
      void wakeLock.requestWakeLock();
    }
  }, [wakeLock]);

  const {
    timers,
    startOrCreateTimer,
    togglePauseTimer,
    addMinuteToTimer,
    resetTimer,
    dismissTimer,
    dismissFinishedAlert,
  } = useKitchenTimers(handleTimerStarted);

  const [activeTab, setActiveTab] = useState<AppTab>('search');
  const [currentRecipe, setCurrentRecipe] = useState<PreparedRecipe | null>(null);
  const [favorites, setFavorites] = useState<SavedFavoriteRecipe[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparingTitle, setPreparingTitle] = useState<string | null>(null);

  // Hydrate offline favorites and last opened recipe on mount
  useEffect(() => {
    let mounted = true;
    const loadOfflineState = async () => {
      const [loadedFavs, lastRec] = await Promise.all([
        getAllFavorites(),
        getLastOpenedRecipe(),
      ]);
      if (!mounted) return;
      setFavorites(loadedFavs);
      if (lastRec) {
        setCurrentRecipe(lastRec);
      }
    };
    void loadOfflineState();
    return () => {
      mounted = false;
    };
  }, []);

  const currentFavoriteEntry = useMemo(() => {
    if (!currentRecipe) return null;
    return favorites.find((f) => f.recipe.id === currentRecipe.id) || null;
  }, [currentRecipe, favorites]);

  const prepareRecipeFromPayload = async (payload: {
    url?: string;
    title?: string;
    query?: string;
  }) => {
    setIsPreparing(true);
    setPreparingTitle(payload.title || payload.url || payload.query || null);
    try {
      const res = await fetch('/api/recipes/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.recipe) {
        throw new Error(data.error || 'Impossibile preparare la ricetta.');
      }
      const prepared = data.recipe as PreparedRecipe;
      setCurrentRecipe(prepared);
      await cacheLastOpenedRecipe(prepared);
      setActiveTab('recipe');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setIsPreparing(false);
      setPreparingTitle(null);
    }
  };

  const handleOpenFromSearchResult = async (result: RecipeSearchResult) => {
    await prepareRecipeFromPayload({
      url: result.sourceUrl || undefined,
      title: result.title,
    });
  };

  const handleExtractFromUrl = async (url: string) => {
    await prepareRecipeFromPayload({ url });
  };

  const handleToggleFavorite = async (
    recipe: PreparedRecipe,
    preferredServings: number
  ) => {
    const exists = favorites.some((f) => f.recipe.id === recipe.id);
    if (exists) {
      await removeFavoriteRecipe(recipe.id);
      setFavorites((prev) => prev.filter((f) => f.recipe.id !== recipe.id));
    } else {
      const saved = await saveFavoriteRecipe(recipe, { preferredServings });
      setFavorites((prev) => [saved, ...prev.filter((f) => f.recipe.id !== recipe.id)]);
    }
  };

  const handleSavePersonalNotes = async (
    recipeId: string,
    notes: string,
    servings?: number
  ) => {
    const existing = favorites.find((f) => f.recipe.id === recipeId);
    if (!existing && currentRecipe && currentRecipe.id === recipeId) {
      const saved = await saveFavoriteRecipe(currentRecipe, {
        personalNotes: notes,
        preferredServings: servings ?? currentRecipe.servings,
      });
      setFavorites((prev) => [saved, ...prev]);
      return;
    }
    const updated = await updateFavoriteNotes(recipeId, notes, servings);
    if (updated) {
      setFavorites((prev) =>
        prev.map((f) => (f.recipe.id === recipeId ? updated : f))
      );
    }
  };

  const handleRemoveFavorite = async (recipeId: string) => {
    await removeFavoriteRecipe(recipeId);
    setFavorites((prev) => prev.filter((f) => f.recipe.id !== recipeId));
  };

  const handleOpenFavorite = (entry: SavedFavoriteRecipe) => {
    setCurrentRecipe(entry.recipe);
    void cacheLastOpenedRecipe(entry.recipe);
    setActiveTab('recipe');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleQuickTimer = () => {
    startOrCreateTimer({
      id: `custom_${Date.now()}`,
      label: 'Timer rapido cucina',
      seconds: 300,
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAF7] text-[#1C1D1A]">
      <OfflineIndicator />

      {/* Top Navigation Bar (Strict 3-zone contract) */}
      <header className="sticky top-0 z-30 h-[54px] md:h-[64px] border-b border-[#E2E0D8] bg-[#FAFAF7]/90 backdrop-blur-md pt-safe">
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-8 px-4 sm:px-6">
          {/* Zone 1: Single-element brand wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-[#1C1D1A] whitespace-nowrap shrink-0 text-left"
          >
            Focolare
          </button>

          {/* Zone 2: Clean single-line nav links (Desktop) */}
          <nav
            aria-label="Navigazione principale"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-[#55574E]"
          >
            <button
              type="button"
              onClick={() => setActiveTab('search')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'search'
                  ? 'text-[#1C1D1A] underline decoration-[#2D5A3D] decoration-2 underline-offset-8'
                  : 'hover:text-[#1C1D1A]'
              }`}
            >
              Cerca
            </button>
            <button
              type="button"
              onClick={() => {
                if (currentRecipe) setActiveTab('recipe');
              }}
              disabled={!currentRecipe}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
                activeTab === 'recipe'
                  ? 'text-[#1C1D1A] underline decoration-[#2D5A3D] decoration-2 underline-offset-8'
                  : 'hover:text-[#1C1D1A]'
              }`}
            >
              In cucina
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('favorites')}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'favorites'
                  ? 'text-[#1C1D1A] underline decoration-[#2D5A3D] decoration-2 underline-offset-8'
                  : 'hover:text-[#1C1D1A]'
              }`}
            >
              Preferiti ({favorites.length})
            </button>
            <button
              type="button"
              onClick={handleQuickTimer}
              className="py-1 transition-colors hover:text-[#1C1D1A] whitespace-nowrap shrink-0"
            >
              Timer +5m
            </button>
          </nav>

          {/* Zone 3: Single primary action */}
          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />
            {timers.length === 0 && (
              <button
                type="button"
                onClick={handleQuickTimer}
                aria-label="Avvia timer rapido da 5 minuti"
                className="md:hidden inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-[#E2E0D8] bg-white text-[#2D5A3D]"
              >
                <Timer className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 pt-5 sm:pt-8 pb-[calc(92px+env(safe-area-inset-bottom,0px))] lg:pb-24">
        {activeTab === 'search' && (
          <SearchSection
            isOnline={isOnline}
            onOpenFromSearchResult={handleOpenFromSearchResult}
            onExtractFromUrl={handleExtractFromUrl}
            isPreparing={isPreparing}
            preparingTitle={preparingTitle}
          />
        )}

        {activeTab === 'recipe' && currentRecipe && (
          <RecipeDetailView
            recipe={currentRecipe}
            savedFavorite={currentFavoriteEntry}
            timers={timers}
            wakeLockActive={wakeLock.isActive}
            wakeLockSupported={wakeLock.isSupported}
            wakeLockNotice={wakeLock.notice}
            onToggleWakeLock={() => void wakeLock.toggleWakeLock()}
            onStartStepTimer={startOrCreateTimer}
            onTogglePauseTimer={togglePauseTimer}
            onToggleFavorite={handleToggleFavorite}
            onSavePersonalNotes={(id, notes, servings) =>
              handleSavePersonalNotes(id, notes, servings)
            }
            onBack={() => setActiveTab('search')}
          />
        )}

        {activeTab === 'recipe' && !currentRecipe && (
          <div className="rounded-2xl border border-[#E2E0D8] bg-white p-8 text-center">
            <ChefHat className="mx-auto h-10 w-10 text-[#2D5A3D]/60" />
            <h2 className="mt-3 font-display text-xl font-semibold text-[#1C1D1A]">
              Nessuna ricetta aperta al momento
            </h2>
            <p className="mt-1.5 text-sm text-[#55574E]">
              Cerca una ricetta sul web oppure scegli un piatto dai tuoi Preferiti offline.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('search')}
                className="min-h-[44px] rounded-xl bg-[#2D5A3D] px-4 text-sm font-semibold text-white"
              >
                Vai alla ricerca
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('favorites')}
                className="min-h-[44px] rounded-xl border border-[#D4D1C7] px-4 text-sm font-medium text-[#1C1D1A]"
              >
                Preferiti ({favorites.length})
              </button>
            </div>
          </div>
        )}

        {activeTab === 'favorites' && (
          <FavoritesView
            favorites={favorites}
            onOpenRecipe={handleOpenFavorite}
            onUpdateNotes={(id, notes) => handleSavePersonalNotes(id, notes)}
            onRemoveFavorite={handleRemoveFavorite}
            onGoToSearch={() => setActiveTab('search')}
          />
        )}
      </main>

      {/* Desktop quiet footer */}
      <footer className="hidden md:block border-t border-[#E2E0D8] bg-[#F2F1EC]/50 py-5">
        <div className="mx-auto max-w-6xl px-6 flex items-center justify-between text-xs text-[#55574E]">
          <span>Focolare — Cucina tradizionale senza robot da cucina e senza pubblicità</span>
          <span>Preferiti e note salvati localmente sul dispositivo</span>
        </div>
      </footer>

      {/* Active Floating Timer Bar */}
      <TimerBar
        timers={timers}
        wakeLockActive={wakeLock.isActive}
        wakeLockSupported={wakeLock.isSupported}
        onToggleWakeLock={() => void wakeLock.toggleWakeLock()}
        onTogglePause={togglePauseTimer}
        onAddMinute={addMinuteToTimer}
        onReset={resetTimer}
        onDismiss={dismissTimer}
        onDismissFinished={dismissFinishedAlert}
        onAddCustomTimer={(minutes, label) =>
          startOrCreateTimer({
            id: `custom_${Date.now()}`,
            label,
            seconds: minutes * 60,
          })
        }
      />

      {/* Mobile Fixed Bottom Thumb Navigation Bar */}
      <nav
        aria-label="Barra di navigazione inferiore"
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-[#E2E0D8] bg-white/95 backdrop-blur-md pb-safe"
      >
        <div className="grid grid-cols-3 h-[58px] items-center">
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className={`flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              activeTab === 'search' ? 'text-[#2D5A3D]' : 'text-[#55574E]'
            }`}
          >
            <Search className="h-5 w-5" />
            <span>Cerca</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('recipe')}
            className={`flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              activeTab === 'recipe' ? 'text-[#2D5A3D]' : 'text-[#55574E]'
            }`}
          >
            <ChefHat className="h-5 w-5" />
            <span>{currentRecipe ? 'In cucina' : 'Ricetta'}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('favorites')}
            className={`flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              activeTab === 'favorites' ? 'text-[#2D5A3D]' : 'text-[#55574E]'
            }`}
          >
            <Bookmark className="h-5 w-5" />
            <span>Preferiti ({favorites.length})</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
