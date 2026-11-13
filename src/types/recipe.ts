export type CookingDifficulty = 'Facile' | 'Media' | 'Impegnativa';

export interface GroundingSource {
  title: string;
  url: string;
}

export interface RecipeSearchResult {
  id: string;
  title: string;
  sourceName: string;
  sourceUrl: string;
  description: string;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: number;
  primaryUtensil: string;
  difficulty: CookingDifficulty;
  region: string | null;
}

export interface RecipeSearchResponse {
  query: string;
  results: RecipeSearchResult[];
  groundingSources: GroundingSource[];
}

export interface RecipeIngredient {
  id: string;
  name: string;
  quantity: number | null;
  unit: string;
  note: string | null;
  group: string | null;
}

export interface CookingParams {
  durationSeconds: number | null;
  durationLabel: string | null;
  heatOrTemp: string | null;
  utensil: string;
  method: string;
}

export interface RecipeStep {
  stepNumber: number;
  title: string;
  instruction: string;
  cookingParams: CookingParams;
  tip: string | null;
}

export interface PreparedRecipe {
  id: string;
  title: string;
  subtitle: string;
  sourceName: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  servings: number;
  prepTimeMinutes: number;
  cookTimeMinutes: number;
  difficulty: CookingDifficulty;
  traditionalUtensils: string[];
  adaptedFromRobot: boolean;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  preparedAt: string;
}

export interface SavedFavoriteRecipe {
  recipe: PreparedRecipe;
  savedAt: string;
  updatedAt: string;
  personalNotes: string;
  preferredServings: number;
}
