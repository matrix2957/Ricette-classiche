import type { PreparedRecipe, SavedFavoriteRecipe } from '../types/recipe.ts';

const DB_NAME = 'focolare_offline_db';
const DB_VERSION = 1;
const STORE_FAVORITES = 'favorites';
const STORE_META = 'meta';
const LS_FAVORITES_KEY = 'focolare_favorites_v1';
const LS_LAST_RECIPE_KEY = 'focolare_last_recipe_v1';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB non disponibile'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_FAVORITES)) {
        db.createObjectStore(STORE_FAVORITES, { keyPath: 'recipe.id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Errore apertura database locale'));
  });
}

function readLocalStorageFavorites(): SavedFavoriteRecipe[] {
  try {
    const raw = localStorage.getItem(LS_FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedFavoriteRecipe[]) : [];
  } catch {
    return [];
  }
}

function writeLocalStorageFavorites(items: SavedFavoriteRecipe[]) {
  try {
    localStorage.setItem(LS_FAVORITES_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

export async function getAllFavorites(): Promise<SavedFavoriteRecipe[]> {
  try {
    const db = await openDatabase();
    return await new Promise<SavedFavoriteRecipe[]>((resolve, reject) => {
      const tx = db.transaction(STORE_FAVORITES, 'readonly');
      const store = tx.objectStore(STORE_FAVORITES);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result as SavedFavoriteRecipe[]) || [];
        items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    const fallback = readLocalStorageFavorites();
    fallback.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return fallback;
  }
}

export async function saveFavoriteRecipe(
  recipe: PreparedRecipe,
  opts?: { personalNotes?: string; preferredServings?: number }
): Promise<SavedFavoriteRecipe> {
  const existing = await getAllFavorites();
  const prev = existing.find((f) => f.recipe.id === recipe.id);
  const now = new Date().toISOString();

  const entry: SavedFavoriteRecipe = {
    recipe,
    savedAt: prev?.savedAt || now,
    updatedAt: now,
    personalNotes: opts?.personalNotes !== undefined ? opts.personalNotes : prev?.personalNotes || '',
    preferredServings:
      opts?.preferredServings !== undefined
        ? opts.preferredServings
        : prev?.preferredServings || recipe.servings,
  };

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FAVORITES, 'readwrite');
      tx.objectStore(STORE_FAVORITES).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback handled below
  }

  const nextLocal = [entry, ...existing.filter((f) => f.recipe.id !== recipe.id)];
  writeLocalStorageFavorites(nextLocal);
  return entry;
}

export async function updateFavoriteNotes(
  recipeId: string,
  personalNotes: string,
  preferredServings?: number
): Promise<SavedFavoriteRecipe | null> {
  const existing = await getAllFavorites();
  const target = existing.find((f) => f.recipe.id === recipeId);
  if (!target) return null;

  const updated: SavedFavoriteRecipe = {
    ...target,
    personalNotes,
    preferredServings: preferredServings ?? target.preferredServings,
    updatedAt: new Date().toISOString(),
  };

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FAVORITES, 'readwrite');
      tx.objectStore(STORE_FAVORITES).put(updated);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback handled below
  }

  const nextLocal = existing.map((f) => (f.recipe.id === recipeId ? updated : f));
  writeLocalStorageFavorites(nextLocal);
  return updated;
}

export async function removeFavoriteRecipe(recipeId: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FAVORITES, 'readwrite');
      tx.objectStore(STORE_FAVORITES).delete(recipeId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback handled below
  }

  const existing = readLocalStorageFavorites();
  writeLocalStorageFavorites(existing.filter((f) => f.recipe.id !== recipeId));
}

export async function cacheLastOpenedRecipe(recipe: PreparedRecipe): Promise<void> {
  try {
    localStorage.setItem(LS_LAST_RECIPE_KEY, JSON.stringify(recipe));
  } catch {
    // ignore
  }
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put({ key: 'last_recipe', value: recipe });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function getLastOpenedRecipe(): Promise<PreparedRecipe | null> {
  try {
    const db = await openDatabase();
    const fromDb = await new Promise<PreparedRecipe | null>((resolve) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get('last_recipe');
      req.onsuccess = () => resolve((req.result?.value as PreparedRecipe) || null);
      req.onerror = () => resolve(null);
    });
    if (fromDb) return fromDb;
  } catch {
    // fallback to localStorage
  }
  try {
    const raw = localStorage.getItem(LS_LAST_RECIPE_KEY);
    return raw ? (JSON.parse(raw) as PreparedRecipe) : null;
  } catch {
    return null;
  }
}
