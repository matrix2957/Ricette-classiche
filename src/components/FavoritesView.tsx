import React, { useMemo, useState } from 'react';
import { ArrowRight, Bookmark, Check, Search, Trash2, Utensils } from 'lucide-react';
import type { SavedFavoriteRecipe } from '../types/recipe.ts';
import { formatDurationMinutes } from '../lib/formatQuantity.ts';

interface FavoritesViewProps {
  favorites: SavedFavoriteRecipe[];
  onOpenRecipe: (entry: SavedFavoriteRecipe) => void;
  onUpdateNotes: (recipeId: string, notes: string) => Promise<void>;
  onRemoveFavorite: (recipeId: string) => Promise<void>;
  onGoToSearch: () => void;
}

export const FavoritesView: React.FC<FavoritesViewProps> = ({
  favorites,
  onOpenRecipe,
  onUpdateNotes,
  onRemoveFavorite,
  onGoToSearch,
}) => {
  const [filterText, setFilterText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [savedToastId, setSavedToastId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return favorites;
    return favorites.filter(
      (f) =>
        f.recipe.title.toLowerCase().includes(q) ||
        f.personalNotes.toLowerCase().includes(q) ||
        f.recipe.ingredients.some((i) => i.name.toLowerCase().includes(q))
    );
  }, [favorites, filterText]);

  const startEditing = (entry: SavedFavoriteRecipe) => {
    setEditingId(entry.recipe.id);
    setNoteDraft(entry.personalNotes);
  };

  const commitNote = async (recipeId: string) => {
    await onUpdateNotes(recipeId, noteDraft);
    setEditingId(null);
    setSavedToastId(recipeId);
    window.setTimeout(() => setSavedToastId(null), 2000);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#E2E0D8] bg-white p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold text-[#1C1D1A]">
              Ricette preferite offline
            </h1>
            <p className="mt-1 text-sm text-[#55574E]">
              Tutte le ricette salvate restano nella memoria del dispositivo insieme alle tue note personali, pronte anche senza rete.
            </p>
          </div>
          <div className="font-mono-tabular text-sm font-semibold text-[#2D5A3D] shrink-0">
            {favorites.length} {favorites.length === 1 ? 'salvata' : 'salvate'}
          </div>
        </div>

        {favorites.length > 0 && (
          <div className="mt-4 relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#55574E]" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filtra tra i preferiti per titolo, ingrediente o nota..."
              className="w-full min-h-[44px] rounded-xl border border-[#D4D1C7] bg-[#FAFAF7] pl-10 pr-4 text-sm text-[#1C1D1A] placeholder:text-[#8A8C80] focus:border-[#2D5A3D] focus:bg-white focus:outline-none"
            />
          </div>
        )}
      </section>

      {favorites.length === 0 ? (
        <section className="rounded-2xl border border-[#E2E0D8] bg-white p-8 text-center">
          <Bookmark className="mx-auto h-9 w-9 text-[#2D5A3D]/60" />
          <h2 className="mt-3 font-display text-xl font-semibold text-[#1C1D1A]">
            Nessuna ricetta salvata offline
          </h2>
          <p className="mt-1.5 max-w-md mx-auto text-sm text-[#55574E]">
            Cerca una ricetta tradizionale o incolla un link web, poi tocca “Salva offline” per conservarla sul tuo iPhone o computer.
          </p>
          <button
            type="button"
            onClick={onGoToSearch}
            className="mt-5 min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#2D5A3D] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1E3F2B] transition-colors"
          >
            <span>Cerca una ricetta</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </section>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#E2E0D8] bg-white p-6 text-center text-sm text-[#55574E]">
          Nessun preferito corrisponde a “{filterText}”.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((entry) => {
            const { recipe } = entry;
            const totalMinutes = recipe.prepTimeMinutes + recipe.cookTimeMinutes;
            const isEditing = editingId === recipe.id;
            const isConfirmDelete = confirmDeleteId === recipe.id;

            return (
              <article
                key={recipe.id}
                className="flex flex-col justify-between rounded-2xl border border-[#E2E0D8] bg-white p-5"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-[#55574E]">
                    <span className="truncate font-medium text-[#2D5A3D]">
                      {recipe.sourceName}
                    </span>
                    <span className="font-mono-tabular shrink-0">
                      {entry.preferredServings} porz. · {formatDurationMinutes(totalMinutes)}
                    </span>
                  </div>

                  <h2 className="mt-2 font-display text-xl font-semibold text-[#1C1D1A]">
                    {recipe.title}
                  </h2>

                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#55574E]">
                    <span className="inline-flex items-center gap-1">
                      <Utensils className="h-3.5 w-3.5 text-[#2D5A3D]" />
                      {recipe.traditionalUtensils.slice(0, 2).join(', ')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{recipe.steps.length} passaggi</span>
                  </div>

                  {/* Personal Notes inline */}
                  <div className="mt-4 rounded-xl border border-[#E2E0D8] bg-[#FAFAF7] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#1C1D1A]">
                        Note personali
                      </span>
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => startEditing(entry)}
                          className="text-xs font-medium text-[#2D5A3D] hover:underline"
                        >
                          {entry.personalNotes ? 'Modifica' : 'Aggiungi nota'}
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="mt-2 space-y-2">
                        <textarea
                          rows={3}
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder="Scrivi qui le tue annotazioni..."
                          className="w-full rounded-lg border border-[#D4D1C7] bg-white p-2 text-xs text-[#1C1D1A] focus:border-[#2D5A3D] focus:outline-none"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="min-h-[36px] rounded-lg px-3 text-xs text-[#55574E] hover:bg-[#E2E0D8]/50"
                          >
                            Annulla
                          </button>
                          <button
                            type="button"
                            onClick={() => void commitNote(recipe.id)}
                            className="min-h-[36px] inline-flex items-center gap-1 rounded-lg bg-[#2D5A3D] px-3 text-xs font-semibold text-white"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>Salva</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-xs text-[#55574E] whitespace-pre-wrap">
                        {entry.personalNotes
                          ? entry.personalNotes
                          : 'Nessuna nota aggiunta.'}
                      </p>
                    )}

                    {savedToastId === recipe.id && (
                      <p className="mt-1.5 text-xs font-medium text-[#2D5A3D]">
                        Nota aggiornata offline.
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#F2F1EC] flex items-center justify-between gap-2">
                  {isConfirmDelete ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void onRemoveFavorite(recipe.id);
                          setConfirmDeleteId(null);
                        }}
                        className="min-h-[40px] rounded-xl bg-[#B45309] px-3 text-xs font-semibold text-white"
                      >
                        Conferma elimina
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="min-h-[40px] rounded-xl px-2.5 text-xs text-[#55574E]"
                      >
                        Annulla
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(recipe.id)}
                      aria-label={`Rimuovi ${recipe.title} dai preferiti`}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-[#55574E] hover:bg-[#F2F1EC] hover:text-[#B45309]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onOpenRecipe(entry)}
                    className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#2D5A3D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E3F2B] transition-colors"
                  >
                    <span>Cucina ora</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
