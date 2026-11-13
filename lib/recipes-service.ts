import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  CookingDifficulty,
  GroundingSource,
  PreparedRecipe,
  RecipeSearchResponse,
  RecipeSearchResult,
} from '../src/types/recipe.ts';

const MODEL_NAME = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    const err = new Error(
      'Chiave API Gemini non configurata sul server. Imposta GEMINI_API_KEY nelle variabili di ambiente o nel pannello Secrets.'
    ) as Error & { statusCode?: number };
    err.statusCode = 500;
    throw err;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isSafePublicUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseJsonLoose<T>(rawText: string, fallback: T): T {
  const trimmed = rawText.trim();
  if (!trimmed) return fallback;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

function normalizeDifficulty(val: string | undefined): CookingDifficulty {
  if (!val) return 'Media';
  const lower = val.toLowerCase();
  if (lower.includes('facil') || lower.includes('semplic') || lower.includes('easy')) return 'Facile';
  if (lower.includes('impegn') || lower.includes('diffic') || lower.includes('hard')) return 'Impegnativa';
  return 'Media';
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&egrave;/g, 'è')
    .replace(/&eacute;/g, 'é')
    .replace(/&agrave;/g, 'à')
    .replace(/&ograve;/g, 'ò')
    .replace(/&ugrave;/g, 'ù')
    .replace(/&igrave;/g, 'ì');
}

interface ExtractedWebPage {
  title: string;
  imageUrl: string | null;
  jsonLdRecipe: string | null;
  cleanText: string;
}

function findRecipeInJsonLd(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeInJsonLd(item);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const typeVal = obj['@type'];
  if (
    typeVal === 'Recipe' ||
    (Array.isArray(typeVal) && typeVal.some((t) => String(t).toLowerCase() === 'recipe'))
  ) {
    return obj;
  }
  if (Array.isArray(obj['@graph'])) {
    return findRecipeInJsonLd(obj['@graph']);
  }
  return null;
}

function extractImageFromJsonLd(recipeObj: Record<string, unknown>): string | null {
  const img = recipeObj.image;
  if (typeof img === 'string' && img.startsWith('http')) return img;
  if (Array.isArray(img)) {
    for (const item of img) {
      if (typeof item === 'string' && item.startsWith('http')) return item;
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).url === 'string') {
        return String((item as Record<string, unknown>).url);
      }
    }
  }
  if (img && typeof img === 'object' && typeof (img as Record<string, unknown>).url === 'string') {
    return String((img as Record<string, unknown>).url);
  }
  return null;
}

async function fetchCleanWebRecipePage(rawUrl: string): Promise<ExtractedWebPage | null> {
  const parsed = isSafePublicUrl(rawUrl);
  if (!parsed) return null;

  try {
    const response = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(9000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.7',
      },
    });

    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return null;
    }

    const html = await response.text();
    if (!html || html.length < 200) return null;

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' ').trim()) : parsed.hostname;

    // Extract og:image
    const ogImgMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    let imageUrl = ogImgMatch ? ogImgMatch[1] : null;
    if (imageUrl && !imageUrl.startsWith('http')) {
      imageUrl = null;
    }

    // Extract JSON-LD Recipe blocks (ad-free structured data!)
    let jsonLdRecipe: string | null = null;
    const ldRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let ldMatch: RegExpExecArray | null;
    while ((ldMatch = ldRegex.exec(html)) !== null) {
      try {
        const parsedJson = JSON.parse(ldMatch[1].trim());
        const recipeNode = findRecipeInJsonLd(parsedJson);
        if (recipeNode) {
          const ldImage = extractImageFromJsonLd(recipeNode);
          if (ldImage) imageUrl = ldImage;
          jsonLdRecipe = JSON.stringify(recipeNode).slice(0, 14000);
          break;
        }
      } catch {
        // Ignore malformed JSON-LD block and keep scanning
      }
    }

    // Strip ads, scripts, nav, footer, cookie banners and extract readable text
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<(header|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, '\n');

    const cleanLines = decodeHtmlEntities(stripped)
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 2)
      .filter(
        (line) =>
          !/cookie|privacy|accetta tutti|pubblicità|advertisement|iscriviti alla newsletter|seguici su/i.test(
            line
          )
      );

    const cleanText = cleanLines.join('\n').slice(0, 14000);

    return {
      title,
      imageUrl,
      jsonLdRecipe,
      cleanText,
    };
  } catch {
    return null;
  }
}

function toCleanApiError(err: unknown): Error & { statusCode?: number } {
  const existing = err as Error & { statusCode?: number; status?: number };
  const rawMessage = existing?.message || String(err);

  if (rawMessage.includes('RESOURCE_EXHAUSTED') || rawMessage.includes('"code":429') || existing?.status === 429) {
    const cleanErr = new Error(
      'Quota temporanea delle richieste Gemini esaurita (429). Attendi qualche istante e riprova, oppure verifica la chiave API nel pannello Settings > Secrets.'
    ) as Error & { statusCode?: number };
    cleanErr.statusCode = 429;
    return cleanErr;
  }

  if (
    rawMessage.includes('API_KEY_INVALID') ||
    rawMessage.includes('PERMISSION_DENIED') ||
    rawMessage.includes('"code":403') ||
    existing?.status === 403
  ) {
    const cleanErr = new Error(
      'Chiave API Gemini non valida o non autorizzata. Controlla GEMINI_API_KEY nel pannello Settings > Secrets.'
    ) as Error & { statusCode?: number };
    cleanErr.statusCode = 403;
    return cleanErr;
  }

  if (existing?.statusCode) {
    return existing;
  }

  const fallback = new Error(
    rawMessage.startsWith('{') ? 'Servizio ricette temporaneamente non disponibile. Riprova tra poco.' : rawMessage
  ) as Error & { statusCode?: number };
  fallback.statusCode = 500;
  return fallback;
}

function parseIsoDurationMinutes(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const mins = Number(match[2] || 0);
  const secs = Number(match[3] || 0);
  const total = hours * 60 + mins + Math.round(secs / 60);
  return total > 0 ? total : null;
}

function parseIngredientLine(line: string, idx: number) {
  const cleaned = decodeHtmlEntities(line).replace(/\s+/g, ' ').trim();
  const match = cleaned.match(/^(\d+(?:[.,]\d+)?)\s*(g|gr|kg|ml|cl|l|cucchiai[o]?|cucchiain[oi]?|spicchi[o]?|fett[ae]|pizzic[oi]|foglie|mazz[oi])?\s+(?:di\s+)?(.+)$/i);
  if (match) {
    const qty = Number(match[1].replace(',', '.'));
    return {
      id: `ing_${idx + 1}`,
      name: match[3].trim(),
      quantity: Number.isFinite(qty) ? qty : null,
      unit: (match[2] || '').trim(),
      note: null,
      group: null,
    };
  }
  return {
    id: `ing_${idx + 1}`,
    name: cleaned,
    quantity: null,
    unit: 'q.b.',
    note: null,
    group: null,
  };
}

function buildRecipeFromJsonLdFallback(
  jsonLdRaw: string,
  sourceHost: string,
  cleanUrl: string,
  imageUrl: string | null
): PreparedRecipe | null {
  try {
    const node = JSON.parse(jsonLdRaw) as Record<string, unknown>;
    const title = typeof node.name === 'string' ? decodeHtmlEntities(node.name).trim() : '';
    if (!title) return null;

    const rawIngredients = Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [];
    const ingredients = rawIngredients
      .map((item, idx) => parseIngredientLine(String(item), idx))
      .filter((i) => i.name.length > 0);

    const rawInstructions = Array.isArray(node.recipeInstructions)
      ? node.recipeInstructions
      : typeof node.recipeInstructions === 'string'
      ? [node.recipeInstructions]
      : [];

    const stepsText: string[] = [];
    for (const entry of rawInstructions) {
      if (typeof entry === 'string') {
        stepsText.push(decodeHtmlEntities(entry).trim());
      } else if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        if (typeof obj.text === 'string') {
          stepsText.push(decodeHtmlEntities(obj.text).trim());
        } else if (Array.isArray(obj.itemListElement)) {
          for (const sub of obj.itemListElement) {
            if (sub && typeof sub === 'object' && typeof (sub as Record<string, unknown>).text === 'string') {
              stepsText.push(decodeHtmlEntities(String((sub as Record<string, unknown>).text)).trim());
            }
          }
        }
      }
    }

    if (ingredients.length === 0 || stepsText.length === 0) return null;

    const steps = stepsText.filter(Boolean).map((text, idx) => {
      const minMatch = text.match(/(\d+)\s*(?:minuti|minuto|min\b)/i);
      const durationSeconds = minMatch ? Number(minMatch[1]) * 60 : null;
      const tempMatch = text.match(/(\d{2,3})\s*°\s*C?/i);
      return {
        stepNumber: idx + 1,
        title: `Passaggio ${idx + 1}`,
        instruction: text,
        cookingParams: {
          durationSeconds,
          durationLabel: minMatch ? `${minMatch[1]} min` : null,
          heatOrTemp: tempMatch ? `Forno ${tempMatch[1]}°C` : null,
          utensil: /forno|teglia/i.test(text) ? 'Forno e teglia' : /padella/i.test(text) ? 'Padella' : 'Pentola / Casseruola',
          method: /forno|inforn/i.test(text) ? 'Cottura in forno' : /bolli|less/i.test(text) ? 'Bollitura' : 'Preparazione tradizionale',
        },
        tip: null,
      };
    });

    const yieldRaw = Array.isArray(node.recipeYield) ? node.recipeYield[0] : node.recipeYield;
    const yieldMatch = typeof yieldRaw === 'string' || typeof yieldRaw === 'number' ? String(yieldRaw).match(/\d+/) : null;
    const servings = yieldMatch ? Math.max(1, Number(yieldMatch[0])) : 4;

    return {
      id: `rec_jsonld_${Date.now()}`,
      title,
      subtitle:
        typeof node.description === 'string'
          ? decodeHtmlEntities(node.description).slice(0, 160).trim()
          : 'Ricetta estratta dal formato strutturato della pagina senza pubblicità.',
      sourceName: sourceHost,
      sourceUrl: cleanUrl || null,
      imageUrl,
      servings,
      prepTimeMinutes: parseIsoDurationMinutes(node.prepTime) ?? 15,
      cookTimeMinutes: parseIsoDurationMinutes(node.cookTime) ?? 25,
      difficulty: 'Media',
      traditionalUtensils: ['Padella', 'Pentola', 'Forno'],
      adaptedFromRobot: false,
      ingredients,
      steps,
      preparedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function searchTraditionalRecipes(rawQuery: string): Promise<RecipeSearchResponse> {
  const query = rawQuery.trim();
  if (!query) {
    const err = new Error('Inserisci il nome di un piatto o un ingrediente da cercare.') as Error & {
      statusCode?: number;
    };
    err.statusCode = 400;
    throw err;
  }

  const ai = getGeminiClient();

  const prompt = `Cerca sul web ricette di cucina tradizionale per: "${query}".

REGOLE RIGIDE DI SELEZIONE:
1. Scegli SOLO ricette di cucina tradizionale casalinga cucinate senza robot da cucina (niente Bimby, Thermomix, Monsieur Cuisine, Multicooker automatici o robot simili: solo fornelli, forno, padella, pentola, casseruola, tegame, frusta a mano).
2. Escludi pagine spam, annunci pubblicitari o siti non pertinenti. Prediligi fonti italiane affidabili e ricette autentiche.
3. Restituisci esclusivamente un JSON valido (senza testo extra prima o dopo) con questa esatta struttura:
{
  "results": [
    {
      "title": "Nome autentico del piatto",
      "sourceName": "Nome del sito (es. GialloZafferano)",
      "sourceUrl": "URL completo della ricetta trovata sul web",
      "description": "Breve descrizione pulita in italiano (max 140 caratteri) del piatto e del metodo tradizionale.",
      "prepTimeMinutes": 15,
      "cookTimeMinutes": 25,
      "servings": 4,
      "primaryUtensil": "Padella | Pentola | Forno | Casseruola | Fornelli e Forno",
      "difficulty": "Facile | Media | Impegnativa",
      "region": "Regione o tradizione (es. Lazio, Emilia-Romagna, Tradizione italiana)"
    }
  ]
}
Fornisci da 4 a 6 risultati concreti e reali trovati tramite la ricerca web.`;

  let response;
  try {
    response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction:
          'Sei un esperto gastronomo italiano di cucina tradizionale casalinga. Rispondi sempre in italiano corretto e restituisci solo JSON valido.',
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
  } catch (err) {
    throw toCleanApiError(err);
  }

  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const groundingSources: GroundingSource[] = [];
  const seenUrls = new Set<string>();

  for (const chunk of groundingChunks) {
    const web = chunk.web;
    if (web?.uri && !seenUrls.has(web.uri)) {
      seenUrls.add(web.uri);
      groundingSources.push({
        title: web.title || new URL(web.uri).hostname,
        url: web.uri,
      });
    }
  }

  interface RawSearchShape {
    results?: Array<{
      title?: string;
      sourceName?: string;
      sourceUrl?: string;
      description?: string;
      prepTimeMinutes?: number | null;
      cookTimeMinutes?: number | null;
      servings?: number;
      primaryUtensil?: string;
      difficulty?: string;
      region?: string | null;
    }>;
  }

  const parsed = parseJsonLoose<RawSearchShape>(response.text ?? '{}', { results: [] });
  const rawResults = Array.isArray(parsed.results) ? parsed.results : [];

  const results: RecipeSearchResult[] = rawResults
    .filter((item) => item && typeof item.title === 'string' && item.title.trim().length > 0)
    .slice(0, 6)
    .map((item, idx) => {
      let url = typeof item.sourceUrl === 'string' ? item.sourceUrl.trim() : '';
      if (!url || !isSafePublicUrl(url)) {
        url = groundingSources[idx]?.url || groundingSources[0]?.url || '';
      }
      let hostLabel = item.sourceName?.trim() || 'Fonte Web';
      if (!item.sourceName && url) {
        try {
          hostLabel = new URL(url).hostname.replace(/^www\./, '');
        } catch {
          hostLabel = 'Fonte Web';
        }
      }

      return {
        id: `res_${Date.now()}_${idx}`,
        title: item.title!.trim(),
        sourceName: hostLabel,
        sourceUrl: url,
        description:
          item.description?.trim() || 'Ricetta tradizionale preparata con metodi classici da cucina.',
        prepTimeMinutes: typeof item.prepTimeMinutes === 'number' ? Math.max(1, Math.round(item.prepTimeMinutes)) : null,
        cookTimeMinutes: typeof item.cookTimeMinutes === 'number' ? Math.max(1, Math.round(item.cookTimeMinutes)) : null,
        servings: typeof item.servings === 'number' && item.servings > 0 ? Math.round(item.servings) : 4,
        primaryUtensil: item.primaryUtensil?.trim() || 'Padella / Pentola',
        difficulty: normalizeDifficulty(item.difficulty),
        region: item.region?.trim() || null,
      };
    });

  return {
    query,
    results,
    groundingSources,
  };
}

const PREPARED_RECIPE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Titolo pulito e tradizionale del piatto in italiano.' },
    subtitle: { type: Type.STRING, description: 'Breve sottotitolo descrittivo in una frase, senza pubblicità.' },
    sourceName: { type: Type.STRING, description: 'Nome del sito o tradizione culinaria di origine.' },
    servings: { type: Type.INTEGER, description: 'Numero di porzioni base (es. 4).' },
    prepTimeMinutes: { type: Type.INTEGER, description: 'Minuti di preparazione manuale.' },
    cookTimeMinutes: { type: Type.INTEGER, description: 'Minuti totali di cottura su fornelli o forno.' },
    difficulty: { type: Type.STRING, description: 'Facile, Media o Impegnativa.' },
    traditionalUtensils: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Solo utensili tradizionali (padella, pentola, forno, teglia, casseruola, frusta a mano). Mai robot da cucina.',
    },
    adaptedFromRobot: {
      type: Type.BOOLEAN,
      description: 'True se la fonte originale conteneva robot da cucina ed è stata convertita ai fornelli/forno/mano.',
    },
    ingredients: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: 'Nome ingrediente pulito (es. Guanciale stagionato).' },
          quantity: {
            type: Type.NUMBER,
            nullable: true,
            description: 'Quantità numerica per le porzioni base (es. 150, 0.5). Null se q.b. o a piacere.',
          },
          unit: { type: Type.STRING, description: 'Unità di misura (es. g, ml, cucchiai, spicchi, uova, q.b.).' },
          note: { type: Type.STRING, nullable: true, description: 'Eventuale dettaglio di taglio o stato (es. a cubetti).' },
          group: { type: Type.STRING, nullable: true, description: 'Sezione opzionale (es. Per il sugo, Per l impasto).' },
        },
        required: ['name', 'unit'],
      },
    },
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          stepNumber: { type: Type.INTEGER },
          title: { type: Type.STRING, description: 'Titolo breve dell azione (es. Rosolatura del guanciale).' },
          instruction: {
            type: Type.STRING,
            description: 'Istruzione chiara, passo per passo, senza chiacchiere promozionali né robot da cucina.',
          },
          cookingParams: {
            type: Type.OBJECT,
            properties: {
              durationSeconds: {
                type: Type.INTEGER,
                nullable: true,
                description: 'Durata esatta in secondi per questo passaggio se prevede attesa/cottura (es. 480 per 8 minuti). Null se istantaneo.',
              },
              durationLabel: {
                type: Type.STRING,
                nullable: true,
                description: 'Durata leggibile (es. "8 min", "25 min", "45 sec"). Null se non applicabile.',
              },
              heatOrTemp: {
                type: Type.STRING,
                nullable: true,
                description: 'Temperatura forno o intensità fiamma (es. "Forno statico 180°C", "Fuoco dolce", "Fiamma vivace", "A crudo").',
              },
              utensil: {
                type: Type.STRING,
                description: 'Utensile tradizionale impiegato in questo passaggio (es. "Padella ampia", "Pentola alta", "Teglia da forno").',
              },
              method: {
                type: Type.STRING,
                description: 'Tecnica o metodo (es. "Rosolatura", "Bollitura", "Cottura in forno", "Mantecatura", "Riposo").',
              },
            },
            required: ['utensil', 'method'],
          },
          tip: {
            type: Type.STRING,
            nullable: true,
            description: 'Consiglio pratico della tradizione per evitare errori in questo passaggio.',
          },
        },
        required: ['stepNumber', 'title', 'instruction', 'cookingParams'],
      },
    },
  },
  required: [
    'title',
    'subtitle',
    'sourceName',
    'servings',
    'prepTimeMinutes',
    'cookTimeMinutes',
    'difficulty',
    'traditionalUtensils',
    'adaptedFromRobot',
    'ingredients',
    'steps',
  ],
};

export interface PrepareRecipeInput {
  url?: string;
  title?: string;
  query?: string;
}

export async function prepareTraditionalRecipe(input: PrepareRecipeInput): Promise<PreparedRecipe> {
  const cleanUrl = input.url?.trim() || '';
  const cleanTitle = input.title?.trim() || '';
  const cleanQuery = input.query?.trim() || '';

  if (!cleanUrl && !cleanTitle && !cleanQuery) {
    const err = new Error('Fornisci un URL oppure il titolo della ricetta da preparare.') as Error & {
      statusCode?: number;
    };
    err.statusCode = 400;
    throw err;
  }

  const ai = getGeminiClient();

  let extractedPage: ExtractedWebPage | null = null;
  let sourceHost = 'Tradizione Web';

  if (cleanUrl) {
    const safeUrl = isSafePublicUrl(cleanUrl);
    if (!safeUrl) {
      const err = new Error('Il link URL inserito non è valido. Controlla che inizi con https:// o http://.') as Error & {
        statusCode?: number;
      };
      err.statusCode = 400;
      throw err;
    }
    sourceHost = safeUrl.hostname.replace(/^www\./, '');
    extractedPage = await fetchCleanWebRecipePage(safeUrl.toString());
  }

  const systemInstruction = `Sei un maestro di cucina tradizionale italiana che ripulisce e struttura ricette web eliminando completamente pubblicità, banner, storie superflue e qualsiasi robot da cucina.
REGOLE TASSATIVE:
1. Lingua: 100% italiano naturale, preciso e pratico.
2. NIENTE ROBOT DA CUCINA: È vietato usare Bimby, Thermomix, Monsieur Cuisine, kCook, planetarie automatiche o robot multifunzione. Se la ricetta originale li menziona, converti ogni passaggio alla cucina tradizionale manuale usando fornelli, forno, padella, pentola, casseruola, ciotola, frusta a mano o coltello, e imposta adaptedFromRobot = true.
3. INGREDIENTI RICALCOLABILI: Separa sempre con precisione quantità numerica (es. 320, 0.5, null per q.b.), unità di misura e nome ingrediente, così l'app possa ricalcolare le porzioni con esattezza matematica.
4. PARAMETRI DI COTTURA PER OGNI STEP: Ogni passaggio deve specificare utensile tradizionale, metodo, intensità fiamma o temperatura del forno (es. "Forno statico 180°C", "Fuoco dolce"), e quando c'è un tempo di cottura/riposo, inserisci durationSeconds (intero, es. 480 per 8 minuti) e durationLabel (es. "8 min") per alimentare il timer integrato.`;

  let rawSourceMaterial = '';
  let parsed: Record<string, unknown> = {};

  try {
    if (extractedPage && (extractedPage.jsonLdRecipe || extractedPage.cleanText.length > 250)) {
      rawSourceMaterial = `FONTE WEB ESTRATTA (${sourceHost} - ${cleanUrl}):
TITOLO PAGINA: ${extractedPage.title}
${extractedPage.jsonLdRecipe ? `\nDATI STRUTTURATI JSON-LD:\n${extractedPage.jsonLdRecipe}\n` : ''}
TESTO PULITO DELLA PAGINA:
${extractedPage.cleanText}`;
    } else if (cleanUrl) {
      // Fallback with Gemini urlContext when website blocked direct server fetch
      const contextResponse = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: `Leggi questa pagina ricetta (${cleanUrl}) ed estrai tutti gli ingredienti esatti, le dosi, le porzioni, i tempi, le temperature di forno/fornelli e tutti i passaggi di preparazione in italiano, ignorando pubblicità e cookie banner.`,
        config: {
          tools: [{ urlContext: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      rawSourceMaterial = `CONTENUTO ESTRATTO DA ${cleanUrl}:\n${contextResponse.text ?? ''}`;
    } else {
      // Lookup via Google Search for dish title/query
      const searchLookup = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: `Cerca sul web la ricetta tradizionale autentica di "${cleanTitle || cleanQuery}" cucinata senza robot da cucina (solo fornelli, forno, padella, pentola). Riporta in dettaglio dosi esatte degli ingredienti, porzioni, tempi e temperature di ogni passaggio.`,
        config: {
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      rawSourceMaterial = `RICETTA TRADIZIONALE TROVATA SUL WEB PER "${cleanTitle || cleanQuery}":\n${searchLookup.text ?? ''}`;
    }

    const structuredResponse = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Trasforma e normalizza la seguente ricetta in una scheda pulita, senza pubblicità, pronta per cucinare passo dopo passo.\n\n${rawSourceMaterial}`,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: PREPARED_RECIPE_SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      },
    });

    parsed = parseJsonLoose<Record<string, unknown>>(structuredResponse.text ?? '{}', {});
  } catch (err) {
    if (extractedPage?.jsonLdRecipe) {
      const jsonLdFallback = buildRecipeFromJsonLdFallback(
        extractedPage.jsonLdRecipe,
        sourceHost,
        cleanUrl,
        extractedPage.imageUrl
      );
      if (jsonLdFallback) {
        return jsonLdFallback;
      }
    }
    throw toCleanApiError(err);
  }

  if (!parsed || typeof parsed.title !== 'string' || !Array.isArray(parsed.ingredients) || !Array.isArray(parsed.steps)) {
    const err = new Error(
      'Non è stato possibile estrarre una ricetta valida da questa fonte. Prova un altro link o cerca per nome piatto.'
    ) as Error & { statusCode?: number };
    err.statusCode = 422;
    throw err;
  }

  const servings = typeof parsed.servings === 'number' && parsed.servings > 0 ? Math.round(parsed.servings) : 4;
  const prepTimeMinutes =
    typeof parsed.prepTimeMinutes === 'number' && parsed.prepTimeMinutes >= 0
      ? Math.round(parsed.prepTimeMinutes)
      : 15;
  const cookTimeMinutes =
    typeof parsed.cookTimeMinutes === 'number' && parsed.cookTimeMinutes >= 0
      ? Math.round(parsed.cookTimeMinutes)
      : 20;

  const ingredients = (parsed.ingredients as Array<Record<string, unknown>>)
    .filter((ing) => ing && typeof ing.name === 'string' && ing.name.trim())
    .map((ing, idx) => ({
      id: `ing_${idx + 1}`,
      name: String(ing.name).trim(),
      quantity: typeof ing.quantity === 'number' && Number.isFinite(ing.quantity) ? ing.quantity : null,
      unit: typeof ing.unit === 'string' && ing.unit.trim() ? ing.unit.trim() : ing.quantity == null ? 'q.b.' : '',
      note: typeof ing.note === 'string' && ing.note.trim() ? ing.note.trim() : null,
      group: typeof ing.group === 'string' && ing.group.trim() ? ing.group.trim() : null,
    }));

  const steps = (parsed.steps as Array<Record<string, unknown>>)
    .filter((st) => st && typeof st.instruction === 'string' && st.instruction.trim())
    .map((st, idx) => {
      const cp = (st.cookingParams as Record<string, unknown>) || {};
      const durationSeconds =
        typeof cp.durationSeconds === 'number' && cp.durationSeconds > 0
          ? Math.round(cp.durationSeconds)
          : null;
      return {
        stepNumber: typeof st.stepNumber === 'number' ? Math.round(st.stepNumber) : idx + 1,
        title: typeof st.title === 'string' && st.title.trim() ? st.title.trim() : `Passaggio ${idx + 1}`,
        instruction: String(st.instruction).trim(),
        cookingParams: {
          durationSeconds,
          durationLabel:
            typeof cp.durationLabel === 'string' && cp.durationLabel.trim()
              ? cp.durationLabel.trim()
              : durationSeconds
              ? durationSeconds >= 60
                ? `${Math.round(durationSeconds / 60)} min`
                : `${durationSeconds} sec`
              : null,
          heatOrTemp: typeof cp.heatOrTemp === 'string' && cp.heatOrTemp.trim() ? cp.heatOrTemp.trim() : null,
          utensil: typeof cp.utensil === 'string' && cp.utensil.trim() ? cp.utensil.trim() : 'Pentola / Padella',
          method: typeof cp.method === 'string' && cp.method.trim() ? cp.method.trim() : 'Preparazione manuale',
        },
        tip: typeof st.tip === 'string' && st.tip.trim() ? st.tip.trim() : null,
      };
    });

  const traditionalUtensils = Array.isArray(parsed.traditionalUtensils)
    ? parsed.traditionalUtensils.map((u) => String(u).trim()).filter(Boolean)
    : ['Padella', 'Pentola'];

  const slug = String(parsed.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

  return {
    id: `rec_${slug || 'ricetta'}_${Date.now()}`,
    title: String(parsed.title).trim(),
    subtitle:
      typeof parsed.subtitle === 'string' && parsed.subtitle.trim()
        ? parsed.subtitle.trim()
        : 'Preparazione tradizionale senza robot da cucina.',
    sourceName:
      typeof parsed.sourceName === 'string' && parsed.sourceName.trim() ? parsed.sourceName.trim() : sourceHost,
    sourceUrl: cleanUrl || null,
    imageUrl: extractedPage?.imageUrl ?? null,
    servings,
    prepTimeMinutes,
    cookTimeMinutes,
    difficulty: normalizeDifficulty(typeof parsed.difficulty === 'string' ? parsed.difficulty : undefined),
    traditionalUtensils: traditionalUtensils.length > 0 ? traditionalUtensils : ['Padella', 'Pentola'],
    adaptedFromRobot: Boolean(parsed.adaptedFromRobot),
    ingredients,
    steps,
    preparedAt: new Date().toISOString(),
  };
}
