import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Check,
  ChefHat,
  Clock,
  ExternalLink,
  Flame,
  ListChecks,
  Minus,
  Plus,
  RotateCcw,
  Share2,
  Sun,
  Timer,
  Utensils,
} from 'lucide-react';
import type { PreparedRecipe, SavedFavoriteRecipe } from '../types/recipe.ts';
import type { KitchenTimer } from '../hooks/useKitchenTimers.ts';
import {
  formatDurationMinutes,
  formatScaledQuantity,
  formatTimerSeconds,
} from '../lib/formatQuantity.ts';

interface RecipeDetailViewProps {
  recipe: PreparedRecipe;
  savedFavorite: SavedFavoriteRecipe | null;
  timers: KitchenTimer[];
  wakeLockActive: boolean;
  wakeLockSupported: boolean;
  wakeLockNotice: string | null;
  onToggleWakeLock: () => void;
  onStartStepTimer: (opts: {
    id: string;
    label: string;
    seconds: number;
    stepNumber?: number;
  }) => void;
  onTogglePauseTimer: (id: string) => void;
  onToggleFavorite: (recipe: PreparedRecipe, preferredServings: number) => Promise<void>;
  onSavePersonalNotes: (recipeId: string, notes: string, servings: number) => Promise<void>;
  onBack: () => void;
}

export const RecipeDetailView: React.FC<RecipeDetailViewProps> = ({
  recipe,
  savedFavorite,
  timers,
  wakeLockActive,
  wakeLockSupported,
  wakeLockNotice,
  onToggleWakeLock,
  onStartStepTimer,
  onTogglePauseTimer,
  onToggleFavorite,
  onSavePersonalNotes,
  onBack,
}) => {
  const [servings, setServings] = useState<number>(
    savedFavorite?.preferredServings || recipe.servings || 4
  );
  const [checkedIngredients, setCheckedIngredients] = useState<Record<string, boolean>>({});
  const [completedSteps, setCompletedSteps] = useState<Record<number, boolean>>({});
  const [focusMode, setFocusMode] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [imgError, setImgError] = useState(false);
  const [notesDraft, setNotesDraft] = useState(savedFavorite?.personalNotes || '');
  const [notesStatus, setNotesStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  useEffect(() => {
    setServings(savedFavorite?.preferredServings || recipe.servings || 4);
    setCheckedIngredients({});
    setCompletedSteps({});
    setActiveStepIndex(0);
    setImgError(false);
    setNotesDraft(savedFavorite?.personalNotes || '');
    setNotesStatus('idle');
  }, [recipe.id]);

  useEffect(() => {
    if (savedFavorite) {
      setNotesDraft(savedFavorite.personalNotes);
    }
  }, [savedFavorite?.personalNotes]);

  const checkedCount = useMemo(
    () => recipe.ingredients.filter((ing) => checkedIngredients[ing.id]).length,
    [recipe.ingredients, checkedIngredients]
  );

  const completedStepsCount = useMemo(
    () => recipe.steps.filter((st) => completedSteps[st.stepNumber]).length,
    [recipe.steps, completedSteps]
  );

  const groupedIngredients = useMemo(() => {
    const groups: Array<{ groupName: string | null; items: typeof recipe.ingredients }> = [];
    for (const ing of recipe.ingredients) {
      const gName = ing.group || null;
      let target = groups.find((g) => g.groupName === gName);
      if (!target) {
        target = { groupName: gName, items: [] };
        groups.push(target);
      }
      target.items.push(ing);
    }
    return groups;
  }, [recipe.ingredients]);

  const handleToggleIngredient = (id: string) => {
    setCheckedIngredients((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToggleStep = (stepNumber: number) => {
    setCompletedSteps((prev) => ({ ...prev, [stepNumber]: !prev[stepNumber] }));
  };

  const handleSaveNotes = async () => {
    setNotesStatus('saving');
    await onSavePersonalNotes(recipe.id, notesDraft, servings);
    setNotesStatus('saved');
    window.setTimeout(() => setNotesStatus('idle'), 2000);
  };

  const handleShareRecipe = async () => {
    const ingLines = recipe.ingredients
      .map((ing) => {
        const qty = formatScaledQuantity(ing.quantity, recipe.servings, servings);
        return `- ${qty ? `${qty} ` : ''}${ing.unit ? `${ing.unit} ` : ''}${ing.name}${ing.note ? ` (${ing.note})` : ''}`;
      })
      .join('\n');

    const stepLines = recipe.steps
      .map((st) => `${st.stepNumber}. ${st.title}: ${st.instruction}`)
      .join('\n\n');

    const text = `${recipe.title} (${servings} porzioni)\n\nIngredienti:\n${ingLines}\n\nPreparazione:\n${stepLines}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: recipe.title, text });
        return;
      } catch {
        // user cancelled or unsupported
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setShareFeedback('Testo ricetta copiato negli appunti');
      window.setTimeout(() => setShareFeedback(null), 2500);
    } catch {
      setShareFeedback('Impossibile copiare automaticamente');
    }
  };

  const stepsToRender = focusMode
    ? recipe.steps.slice(activeStepIndex, activeStepIndex + 1)
    : recipe.steps;

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#E2E0D8] bg-white px-3.5 py-2 text-sm font-medium text-[#1C1D1A] hover:bg-[#F2F1EC] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Ricerca</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleShareRecipe()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#E2E0D8] bg-white px-3.5 py-2 text-sm font-medium text-[#1C1D1A] hover:bg-[#F2F1EC] transition-colors"
          >
            <Share2 className="h-4 w-4 text-[#55574E]" />
            <span>Condividi</span>
          </button>

          <button
            type="button"
            onClick={() => void onToggleFavorite(recipe, servings)}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
              savedFavorite
                ? 'bg-[#2D5A3D] text-white hover:bg-[#1E3F2B]'
                : 'border border-[#2D5A3D] bg-white text-[#2D5A3D] hover:bg-[#2D5A3D]/5'
            }`}
          >
            {savedFavorite ? (
              <>
                <BookmarkCheck className="h-4 w-4" />
                <span>Salvata offline</span>
              </>
            ) : (
              <>
                <Bookmark className="h-4 w-4" />
                <span>Salva offline</span>
              </>
            )}
          </button>
        </div>
      </div>

      {shareFeedback && (
        <div className="rounded-xl border border-[#2D5A3D]/30 bg-[#2D5A3D]/5 px-4 py-2.5 text-xs font-medium text-[#1E3F2B]">
          {shareFeedback}
        </div>
      )}

      {/* Recipe Overview Header */}
      <article className="overflow-hidden rounded-2xl border border-[#E2E0D8] bg-white">
        <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#55574E]">
                <span className="font-medium text-[#2D5A3D]">{recipe.sourceName}</span>
                {recipe.sourceUrl && (
                  <>
                    <span aria-hidden="true">·</span>
                    <a
                      href={recipe.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-[#1C1D1A] hover:underline"
                    >
                      <span>Pagina originale</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </>
                )}
                {recipe.adaptedFromRobot && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-[#B45309]">
                      Convertita senza robot da cucina
                    </span>
                  </>
                )}
              </div>

              <h1 className="mt-3 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#1C1D1A] text-balance">
                {recipe.title}
              </h1>

              <p className="mt-2.5 text-sm sm:text-base text-[#55574E] leading-relaxed">
                {recipe.subtitle}
              </p>
            </div>

            <div className="mt-6 pt-5 border-t border-[#F2F1EC] grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-[#55574E]">Preparazione</div>
                <div className="mt-0.5 font-mono-tabular text-base font-semibold text-[#1C1D1A]">
                  {formatDurationMinutes(recipe.prepTimeMinutes)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#55574E]">Cottura</div>
                <div className="mt-0.5 font-mono-tabular text-base font-semibold text-[#1C1D1A]">
                  {formatDurationMinutes(recipe.cookTimeMinutes)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#55574E]">Difficoltà</div>
                <div className="mt-0.5 text-base font-semibold text-[#1C1D1A]">
                  {recipe.difficulty}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#55574E]">Utensili</div>
                <div className="mt-0.5 text-sm font-medium text-[#1C1D1A] truncate">
                  {recipe.traditionalUtensils.slice(0, 2).join(', ')}
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 min-h-[200px] lg:min-h-[260px] bg-[#F2F1EC] relative">
            {recipe.imageUrl && !imgError ? (
              <img
                src={recipe.imageUrl}
                alt={recipe.title}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center p-6 text-center bg-[#F2F1EC]">
                <ChefHat className="h-10 w-10 text-[#2D5A3D]/60" />
                <p className="mt-3 text-sm font-medium text-[#1C1D1A]">
                  {recipe.traditionalUtensils.join(' · ')}
                </p>
                <p className="mt-1 text-xs text-[#55574E]">
                  Scheda tradizionale senza pubblicità
                </p>
              </div>
            )}
          </div>
        </div>
      </article>

      {/* Main 2-column Workspace (Desktop) / Stacked (Mobile) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* 2) Ingredients Section with Portion Recalculation & Interactive Check */}
        <section
          aria-labelledby="ingredients-heading"
          className="lg:col-span-5 lg:sticky lg:top-20 rounded-2xl border border-[#E2E0D8] bg-white p-5 sm:p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2
                id="ingredients-heading"
                className="font-display text-2xl font-semibold text-[#1C1D1A]"
              >
                Ingredienti
              </h2>
              <p className="mt-0.5 text-xs text-[#55574E] font-mono-tabular">
                {checkedCount} / {recipe.ingredients.length} spuntati
              </p>
            </div>

            {/* Servings Stepper */}
            <div className="flex items-center gap-1 rounded-xl border border-[#E2E0D8] bg-[#FAFAF7] p-1">
              <button
                type="button"
                onClick={() => setServings((s) => Math.max(1, s - 1))}
                aria-label="Riduci porzioni"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[#1C1D1A] hover:bg-white transition-colors"
              >
                <Minus className="h-4 w-4" />
              </button>
              <div className="min-w-[82px] text-center">
                <span className="font-mono-tabular text-sm font-semibold text-[#1C1D1A]">
                  {servings}
                </span>{' '}
                <span className="text-xs text-[#55574E]">
                  {servings === 1 ? 'porzione' : 'porzioni'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setServings((s) => Math.min(24, s + 1))}
                aria-label="Aumenta porzioni"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[#1C1D1A] hover:bg-white transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {(servings !== recipe.servings || checkedCount > 0) && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              {servings !== recipe.servings ? (
                <button
                  type="button"
                  onClick={() => setServings(recipe.servings)}
                  className="inline-flex items-center gap-1 text-[#2D5A3D] hover:underline"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Ripristina {recipe.servings} porzioni originali</span>
                </button>
              ) : (
                <span />
              )}
              {checkedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setCheckedIngredients({})}
                  className="text-[#55574E] hover:text-[#1C1D1A] hover:underline"
                >
                  Deseleziona tutti
                </button>
              )}
            </div>
          )}

          <div className="mt-4 space-y-5">
            {groupedIngredients.map((group) => (
              <div key={group.groupName || 'default'}>
                {group.groupName && (
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-[#2D5A3D]">
                    {group.groupName}
                  </h3>
                )}
                <ul className="divide-y divide-[#F2F1EC]">
                  {group.items.map((ing) => {
                    const isChecked = Boolean(checkedIngredients[ing.id]);
                    const scaledQty = formatScaledQuantity(
                      ing.quantity,
                      recipe.servings,
                      servings
                    );
                    return (
                      <li key={ing.id}>
                        <button
                          type="button"
                          onClick={() => handleToggleIngredient(ing.id)}
                          aria-pressed={isChecked}
                          className="w-full min-h-[48px] py-2.5 px-2 -mx-2 rounded-xl flex items-center gap-3 text-left transition-colors hover:bg-[#FAFAF7]"
                        >
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors ${
                              isChecked
                                ? 'border-[#2D5A3D] bg-[#2D5A3D] text-white'
                                : 'border-[#C9C6BA] bg-white'
                            }`}
                          >
                            {isChecked && <Check className="h-3.5 w-3.5 stroke-[2.5]" />}
                          </span>

                          <span
                            className={`flex-1 text-sm leading-snug ${
                              isChecked ? 'line-through text-[#8A8C80]' : 'text-[#1C1D1A]'
                            }`}
                          >
                            {(scaledQty || ing.unit) && (
                              <strong className="font-mono-tabular font-semibold mr-1.5">
                                {scaledQty}
                                {scaledQty && ing.unit ? ' ' : ''}
                                {ing.unit}
                              </strong>
                            )}
                            <span>{ing.name}</span>
                            {ing.note && (
                              <span className="text-[#55574E]"> ({ing.note})</span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* 3) Step-by-Step Preparation + Cooking Parameters + Integrated Timer & Wake Lock */}
        <section aria-labelledby="steps-heading" className="lg:col-span-7 space-y-4">
          <div className="rounded-2xl border border-[#E2E0D8] bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2
                  id="steps-heading"
                  className="font-display text-2xl font-semibold text-[#1C1D1A]"
                >
                  Preparazione
                </h2>
                <p className="mt-0.5 text-xs text-[#55574E] font-mono-tabular">
                  {completedStepsCount} / {recipe.steps.length} passaggi completati
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {wakeLockSupported && (
                  <button
                    type="button"
                    onClick={onToggleWakeLock}
                    aria-pressed={wakeLockActive}
                    className={`min-h-[44px] inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                      wakeLockActive
                        ? 'bg-[#2D5A3D] text-white'
                        : 'border border-[#D4D1C7] bg-[#FAFAF7] text-[#1C1D1A] hover:bg-[#F2F1EC]'
                    }`}
                  >
                    <Sun className="h-4 w-4" />
                    <span>
                      {wakeLockActive ? 'Schermo sempre acceso' : 'Tieni schermo acceso'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setFocusMode((f) => !f)}
                  className={`min-h-[44px] inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                    focusMode
                      ? 'bg-[#1C1D1A] text-white'
                      : 'border border-[#D4D1C7] bg-[#FAFAF7] text-[#1C1D1A] hover:bg-[#F2F1EC]'
                  }`}
                >
                  <ListChecks className="h-4 w-4" />
                  <span>{focusMode ? 'Mostra tutti' : '1 passo alla volta'}</span>
                </button>
              </div>
            </div>

            {wakeLockNotice && (
              <p className="mt-3 text-xs text-[#B45309]">{wakeLockNotice}</p>
            )}

            <div className="mt-4 pt-4 border-t border-[#F2F1EC] flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#55574E]">
              <span className="font-medium text-[#1C1D1A]">Attrezzatura tradizionale:</span>
              <span>{recipe.traditionalUtensils.join(' · ')}</span>
            </div>
          </div>

          {/* Step Cards */}
          <div className="space-y-4">
            {stepsToRender.map((step) => {
              const isDone = Boolean(completedSteps[step.stepNumber]);
              const timerId = `${recipe.id}_step_${step.stepNumber}`;
              const activeTimer = timers.find((t) => t.id === timerId);

              return (
                <article
                  key={step.stepNumber}
                  className={`rounded-2xl border p-5 sm:p-6 transition-colors ${
                    isDone
                      ? 'border-[#E2E0D8] bg-[#F2F1EC]/60'
                      : 'border-[#E2E0D8] bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono-tabular text-sm font-semibold text-[#2D5A3D]">
                        {String(step.stepNumber).padStart(2, '0')}.
                      </span>
                      <h3
                        className={`text-lg font-semibold ${
                          isDone ? 'text-[#55574E] line-through' : 'text-[#1C1D1A]'
                        }`}
                      >
                        {step.title}
                      </h3>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggleStep(step.stepNumber)}
                      aria-pressed={isDone}
                      className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-colors shrink-0 ${
                        isDone
                          ? 'bg-[#2D5A3D] text-white'
                          : 'border border-[#D4D1C7] bg-[#FAFAF7] text-[#1C1D1A] hover:bg-[#F2F1EC]'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>{isDone ? 'Fatto' : 'Segna fatto'}</span>
                    </button>
                  </div>

                  {/* Cooking Parameters Grid */}
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2.5 rounded-xl bg-[#FAFAF7] border border-[#E2E0D8] p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-[#2D5A3D] shrink-0" />
                      <div>
                        <span className="text-[#55574E] block">Tempo</span>
                        <span className="font-mono-tabular font-semibold text-[#1C1D1A]">
                          {step.cookingParams.durationLabel || 'A vista'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Flame className="h-4 w-4 text-[#B45309] shrink-0" />
                      <div>
                        <span className="text-[#55574E] block">Fuoco / Forno</span>
                        <span className="font-semibold text-[#1C1D1A]">
                          {step.cookingParams.heatOrTemp || 'Temperatura ambiente'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Utensils className="h-4 w-4 text-[#2D5A3D] shrink-0" />
                      <div className="min-w-0">
                        <span className="text-[#55574E] block">Utensile e metodo</span>
                        <span className="font-semibold text-[#1C1D1A] block truncate">
                          {step.cookingParams.utensil} · {step.cookingParams.method}
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="mt-4 text-base text-[#1C1D1A] leading-relaxed">
                    {step.instruction}
                  </p>

                  {step.tip && (
                    <div className="mt-4 rounded-xl border border-[#E2E0D8] bg-[#F2F1EC]/70 px-4 py-3 text-xs sm:text-sm text-[#55574E]">
                      <strong className="text-[#1C1D1A]">Consiglio pratico:</strong> {step.tip}
                    </div>
                  )}

                  {step.cookingParams.durationSeconds && (
                    <div className="mt-4 pt-3 border-t border-[#F2F1EC] flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs text-[#55574E]">
                        Timer passaggio ({step.cookingParams.durationLabel})
                      </div>

                      {activeTimer ? (
                        <button
                          type="button"
                          onClick={() => onTogglePauseTimer(activeTimer.id)}
                          className={`min-h-[44px] inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors ${
                            activeTimer.isFinished
                              ? 'bg-[#B45309] text-white'
                              : activeTimer.isRunning
                              ? 'bg-[#1C1D1A] text-white'
                              : 'bg-[#2D5A3D] text-white'
                          }`}
                        >
                          <Timer className="h-4 w-4" />
                          <span className="font-mono-tabular">
                            {activeTimer.isFinished
                              ? 'Pronto!'
                              : `${activeTimer.isRunning ? 'In corso' : 'In pausa'} · ${formatTimerSeconds(
                                  activeTimer.remainingSeconds
                                )}`}
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            onStartStepTimer({
                              id: timerId,
                              label: step.title,
                              seconds: step.cookingParams.durationSeconds!,
                              stepNumber: step.stepNumber,
                            })
                          }
                          className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-[#2D5A3D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E3F2B] transition-colors"
                        >
                          <Timer className="h-4 w-4" />
                          <span>Avvia timer {step.cookingParams.durationLabel}</span>
                        </button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {focusMode && recipe.steps.length > 1 && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#E2E0D8] bg-white p-4">
              <button
                type="button"
                disabled={activeStepIndex === 0}
                onClick={() => setActiveStepIndex((i) => Math.max(0, i - 1))}
                className="min-h-[44px] rounded-xl border border-[#D4D1C7] px-4 text-sm font-medium text-[#1C1D1A] disabled:opacity-40"
              >
                Passo precedente
              </button>
              <span className="font-mono-tabular text-xs text-[#55574E]">
                {activeStepIndex + 1} / {recipe.steps.length}
              </span>
              <button
                type="button"
                disabled={activeStepIndex >= recipe.steps.length - 1}
                onClick={() =>
                  setActiveStepIndex((i) => Math.min(recipe.steps.length - 1, i + 1))
                }
                className="min-h-[44px] rounded-xl bg-[#2D5A3D] px-4 text-sm font-semibold text-white disabled:opacity-40"
              >
                Prossimo passo
              </button>
            </div>
          )}

          {/* Personal Notes Card (Offline ready) */}
          <section className="rounded-2xl border border-[#E2E0D8] bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-xl font-semibold text-[#1C1D1A]">
                Note personali di cucina
              </h3>
              {notesStatus === 'saved' && (
                <span className="text-xs font-medium text-[#2D5A3D]">
                  Salvata offline
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-[#55574E]">
              Annota modifiche a sale, cottura del tuo forno o abbinamenti: verranno salvate nei Preferiti anche offline.
            </p>
            <textarea
              rows={3}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Es. Nel mio forno statico bastano 22 minuti; aggiungere un pizzico di pepe nero a crudo..."
              className="mt-3 w-full rounded-xl border border-[#D4D1C7] bg-[#FAFAF7] p-3 text-sm text-[#1C1D1A] placeholder:text-[#8A8C80] focus:border-[#2D5A3D] focus:bg-white focus:outline-none"
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => void handleSaveNotes()}
                disabled={notesStatus === 'saving'}
                className="min-h-[44px] rounded-xl bg-[#2D5A3D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1E3F2B] transition-colors"
              >
                {savedFavorite ? 'Salva nota offline' : 'Salva ricetta e nota offline'}
              </button>
            </div>
          </section>
        </section>
      </div>
    </div>
  );
};
