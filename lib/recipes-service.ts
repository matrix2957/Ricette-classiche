import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  CookingDifficulty,
  CookingParams,
  GroundingSource,
  PreparedRecipe,
  RecipeIngredient,
  RecipeSearchResponse,
  RecipeSearchResult,
  RecipeStep,
} from '../src/types/recipe.ts';

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
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
  if (lower.includes('facil') || lower.includes('semplic') || lower.includes('molto bassa') || lower.includes('bassa') || lower.includes('easy')) {
    return 'Facile';
  }
  if (lower.includes('impegn') || lower.includes('diffic') || lower.includes('alta') || lower.includes('hard')) {
    return 'Impegnativa';
  }
  return 'Media';
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&rsquo;|&lsquo;/gi, '’')
    .replace(/&rdquo;|&ldquo;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&egrave;/g, 'è')
    .replace(/&eacute;/g, 'é')
    .replace(/&agrave;/g, 'à')
    .replace(/&ograve;/g, 'ò')
    .replace(/&ugrave;/g, 'ù')
    .replace(/&igrave;/g, 'ì')
    .replace(/&deg;/g, '°');
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

async function fetchCleanWebRecipePage(rawUrl: string, timeoutMs = 8000): Promise<ExtractedWebPage | null> {
  const parsed = isSafePublicUrl(rawUrl);
  if (!parsed) return null;

  try {
    const response = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
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

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' ').trim()) : parsed.hostname;

    const ogImgMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    let imageUrl = ogImgMatch ? ogImgMatch[1] : null;
    if (imageUrl && !imageUrl.startsWith('http')) {
      imageUrl = null;
    }

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
          jsonLdRecipe = JSON.stringify(recipeNode).slice(0, 16000);
          break;
        }
      } catch {
        // Ignore malformed JSON-LD block
      }
    }

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
      'Quota temporanea delle richieste Gemini esaurita (429). Riprova tra qualche istante oppure incolla direttamente il link URL della ricetta.'
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

function parseNumericToken(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '½') return 0.5;
  if (trimmed === '¼') return 0.25;
  if (trimmed === '¾') return 0.75;
  if (trimmed === '⅓') return 0.33;
  const fracMatch = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fracMatch) {
    const den = Number(fracMatch[2]);
    return den > 0 ? Number(fracMatch[1]) / den : null;
  }
  const num = Number(trimmed.replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

function parseIngredientLine(line: string, idx: number): RecipeIngredient {
  const cleaned = decodeHtmlEntities(line).replace(/\s+/g, ' ').trim();

  // Extract optional trailing or inline parenthetical note when helpful
  let working = cleaned;
  let note: string | null = null;

  // Pattern A: Quantity FIRST -> "320 g di spaghetti", "1/2 cipolla", "2 cucchiai di olio extravergine"
  const leadRegex =
    /^(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+|[½¼¾⅓])\s*(g|gr|kg|ml|cl|dl|l|litri|litro|cucchiai[o]?|cucchiain[oi]?|spicchi[o]?|fett[ae]|pizzic[oi]|foglie|mazz[oi]|ramett[oi]|vasett[oi]|bicchier[ei]|tazz[ae]|scatole)?\s*(?:di\s+|d['’])?(.+)$/i;
  const leadMatch = working.match(leadRegex);
  if (leadMatch) {
    const qty = parseNumericToken(leadMatch[1]);
    const unit = (leadMatch[2] || '').trim();
    const rest = leadMatch[3].trim();
    if (qty !== null && rest.length > 0 && !/^\d/.test(rest)) {
      return {
        id: `ing_${idx + 1}`,
        name: rest,
        quantity: qty,
        unit,
        note,
        group: null,
      };
    }
  }

  // Pattern B: Italian "Name Quantity Unit" -> "Spaghetti 320 g", "Tuorli (di uova medie) 6", "Pepe nero q.b."
  const qbMatch = working.match(/^(.+?)\s+(q\.?\s*b\.?|quanto basta|a piacere)$/i);
  if (qbMatch) {
    return {
      id: `ing_${idx + 1}`,
      name: qbMatch[1].trim(),
      quantity: null,
      unit: 'q.b.',
      note,
      group: null,
    };
  }

  const tailUnitRegex =
    /^(.+?)\s+(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+|[½¼¾⅓])\s*(g|gr|kg|ml|cl|dl|l|litri|litro|cucchiai[o]?|cucchiain[oi]?|spicchi[o]?|fett[ae]|pizzic[oi]|foglie|mazz[oi]|ramett[oi]|vasett[oi]|bicchier[ei]|tazz[ae])?$/i;
  const tailMatch = working.match(tailUnitRegex);
  if (tailMatch) {
    const rawName = tailMatch[1].trim();
    const qty = parseNumericToken(tailMatch[2]);
    const unit = (tailMatch[3] || '').trim();
    const parenMatch = rawName.match(/^(.+?)\s*\(([^)]+)\)$/);
    const name = parenMatch ? parenMatch[1].trim() : rawName;
    if (parenMatch) note = parenMatch[2].trim();

    if (qty !== null && name.length > 0) {
      return {
        id: `ing_${idx + 1}`,
        name,
        quantity: qty,
        unit,
        note,
        group: null,
      };
    }
  }

  return {
    id: `ing_${idx + 1}`,
    name: working,
    quantity: null,
    unit: 'q.b.',
    note,
    group: null,
  };
}

function cleanStepText(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/<[^>]+>/g, ' ')
    // Remove GialloZafferano-style inline step photo indices like "a fette 1 e poi 2 3 ."
    .replace(/\s+(?:\d{1,2}\s+)+([.,;!?])/g, '$1')
    .replace(/([a-zàèéìòù])\s+\d{1,2}(?=\s+(?:e|o|poi|nel|nella|sul|sulla|con|per|in|a|da|di)\b)/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferCookingParamsFromText(text: string): CookingParams {
  // Duration extraction
  let durationSeconds: number | null = null;
  let durationLabel: string | null = null;

  const hourMinMatch = text.match(/(\d+)\s*(?:ora|ore)\s*(?:e\s*(\d+)\s*min(?:uti)?)?/i);
  const minMatch = text.match(/(?:circa\s*)?(\d+(?:-\d+)?)\s*(?:minuti|minuto|min\b)/i);
  const secMatch = text.match(/(?:circa\s*)?(\d+)\s*(?:secondi|secondo|sec\b)/i);

  if (hourMinMatch) {
    const h = Number(hourMinMatch[1]);
    const m = Number(hourMinMatch[2] || 0);
    durationSeconds = h * 3600 + m * 60;
    durationLabel = m > 0 ? `${h} h ${m} min` : `${h} h`;
  } else if (minMatch) {
    const firstNum = Number(minMatch[1].split('-')[0]);
    durationSeconds = firstNum * 60;
    durationLabel = `${minMatch[1]} min`;
  } else if (secMatch) {
    durationSeconds = Number(secMatch[1]);
    durationLabel = `${secMatch[1]} sec`;
  }

  // Heat or Oven Temp
  let heatOrTemp: string | null = null;
  const ovenMatch = text.match(/(forno(?:\s+(?:statico|ventilato|preriscaldato))?[^.,;]{0,20}\d{2,3}\s*°\s*C?|\d{2,3}\s*°\s*C?)/i);
  if (ovenMatch) {
    const tempNum = ovenMatch[0].match(/\d{2,3}/)?.[0];
    const isVentilato = /ventilat/i.test(text);
    heatOrTemp = tempNum
      ? `Forno ${isVentilato ? 'ventilato' : 'statico'} ${tempNum}°C`
      : ovenMatch[0].trim();
  } else if (/fiamma\s+medio[-\s]?alt[ao]|fuoco\s+medio[-\s]?alt[ao]/i.test(text)) {
    heatOrTemp = 'Fiamma medio-alta';
  } else if (/fiamma\s+medio[-\s]?bass[ao]|fuoco\s+medio[-\s]?bass[ao]/i.test(text)) {
    heatOrTemp = 'Fuoco medio-basso';
  } else if (/fuoco\s+dolc|fuoco\s+bass|fiamma\s+dolc|fiamma\s+bass|fuoco\s+lent/i.test(text)) {
    heatOrTemp = 'Fuoco dolce';
  } else if (/fiamma\s+vivac|fuoco\s+vivac|fuoco\s+alt|fiamma\s+alt/i.test(text)) {
    heatOrTemp = 'Fiamma vivace';
  } else if (/fuoco\s+medi|fiamma\s+medi/i.test(text)) {
    heatOrTemp = 'Fuoco medio';
  } else if (/boll/i.test(text)) {
    heatOrTemp = 'Ebollizione su fornello';
  } else if (/fuoco|fornell|padell|pentol/i.test(text)) {
    heatOrTemp = 'Fuoco medio';
  } else {
    heatOrTemp = 'A crudo / Temperatura ambiente';
  }

  // Utensil
  let utensil = 'Piano di lavoro / Ciotola';
  if (/forno|teglia|pirofila|tortiera|stampo/i.test(text)) {
    utensil = 'Teglia da forno';
  } else if (/padella/i.test(text)) {
    utensil = 'Padella ampia';
  } else if (/casseruola/i.test(text)) {
    utensil = 'Casseruola';
  } else if (/tegame/i.test(text)) {
    utensil = 'Tegame';
  } else if (/pentola/i.test(text)) {
    utensil = 'Pentola';
  } else if (/frusta/i.test(text)) {
    utensil = 'Ciotola e frusta a mano';
  } else if (/ciotola|terrina/i.test(text)) {
    utensil = 'Ciotola';
  }

  // Method
  let method = 'Preparazione manuale';
  if (/inforn|forno/i.test(text)) method = 'Cottura in forno';
  else if (/rosol|dorar|soffrig|soffritt/i.test(text)) method = 'Rosolatura';
  else if (/mantec/i.test(text)) method = 'Mantecatura';
  else if (/bolli|tuffat|cuoceteli\s+al\s+dente|scolat/i.test(text)) method = 'Bollitura';
  else if (/sfum/i.test(text)) method = 'Sfumatura e riduzione';
  else if (/sbatt|mescol|amalgam|monta/i.test(text)) method = 'Lavorazione a mano';
  else if (/ripos|raffredd|frigorifer/i.test(text)) method = 'Riposo';
  else if (/tagli|trit|affett|cubetti|listarelle/i.test(text)) method = 'Taglio al coltello';

  return {
    durationSeconds,
    durationLabel,
    heatOrTemp,
    utensil,
    method,
  };
}

function inferStepTitle(text: string, idx: number, method: string): string {
  const firstClause = text.split(/[.,;:]/)[0].trim();
  if (firstClause.length > 4 && firstClause.length <= 44) {
    return firstClause.charAt(0).toUpperCase() + firstClause.slice(1);
  }
  return `${method} · Fase ${idx + 1}`;
}

function sanitizeRobotMentions(text: string): { text: string; wasAdapted: boolean } {
  const robotRegex = /\b(bimby|thermomix|monsieur\s+cuisine|kcook|multicooker|varoma|boccale\s+del\s+bimby)\b/i;
  if (!robotRegex.test(text)) {
    return { text, wasAdapted: false };
  }
  const adapted = text
    .replace(/\bnel\s+boccale(?:\s+del\s+bimby)?\b/gi, 'in una pentola o ciotola capiente')
    .replace(/\bcon\s+il\s+(?:bimby|thermomix|monsieur\s+cuisine|robot)\b/gi, 'a mano sul fornello')
    .replace(/\b(?:bimby|thermomix|monsieur\s+cuisine|kcook|multicooker)\b/gi, 'pentola tradizionale')
    .replace(/\bvaroma\b/gi, 'cestello per cottura a vapore su pentola');
  return { text: adapted, wasAdapted: true };
}

function buildRecipeFromJsonLdFallback(
  jsonLdRaw: string,
  sourceHost: string,
  cleanUrl: string,
  imageUrl: string | null
): PreparedRecipe | null {
  try {
    const node = JSON.parse(jsonLdRaw) as Record<string, unknown>;
    const rawTitle = typeof node.name === 'string' ? decodeHtmlEntities(node.name).trim() : '';
    if (!rawTitle) return null;

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
        const cleaned = cleanStepText(entry);
        if (cleaned) stepsText.push(cleaned);
      } else if (entry && typeof entry === 'object') {
        const obj = entry as Record<string, unknown>;
        if (typeof obj.text === 'string') {
          const cleaned = cleanStepText(obj.text);
          if (cleaned) stepsText.push(cleaned);
        } else if (Array.isArray(obj.itemListElement)) {
          for (const sub of obj.itemListElement) {
            if (sub && typeof sub === 'object' && typeof (sub as Record<string, unknown>).text === 'string') {
              const cleaned = cleanStepText(String((sub as Record<string, unknown>).text));
              if (cleaned) stepsText.push(cleaned);
            }
          }
        }
      }
    }

    if (ingredients.length === 0 || stepsText.length === 0) return null;

    let adaptedFromRobot = false;
    const utensilSet = new Set<string>();

    const steps: RecipeStep[] = stepsText.map((rawStep, idx) => {
      const sanitized = sanitizeRobotMentions(rawStep);
      if (sanitized.wasAdapted) adaptedFromRobot = true;
      const cookingParams = inferCookingParamsFromText(sanitized.text);
      utensilSet.add(cookingParams.utensil);
      return {
        stepNumber: idx + 1,
        title: inferStepTitle(sanitized.text, idx, cookingParams.method),
        instruction: sanitized.text,
        cookingParams,
        tip: null,
      };
    });

    const yieldRaw = Array.isArray(node.recipeYield) ? node.recipeYield[0] : node.recipeYield;
    const yieldMatch =
      typeof yieldRaw === 'string' || typeof yieldRaw === 'number'
        ? String(yieldRaw).match(/\d+/)
        : null;
    const servings = yieldMatch ? Math.max(1, Number(yieldMatch[0])) : 4;

    const desc =
      typeof node.description === 'string'
        ? cleanStepText(node.description).slice(0, 170)
        : 'Ricetta tradizionale estratta in formato pulito senza pubblicità.';

    const slug = rawTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);

    return {
      id: `rec_${slug || 'ricetta'}_${Date.now()}`,
      title: rawTitle,
      subtitle: desc,
      sourceName: sourceHost,
      sourceUrl: cleanUrl || null,
      imageUrl,
      servings,
      prepTimeMinutes: parseIsoDurationMinutes(node.prepTime) ?? 15,
      cookTimeMinutes: parseIsoDurationMinutes(node.cookTime) ?? 25,
      difficulty: 'Media',
      traditionalUtensils: Array.from(utensilSet).slice(0, 4),
      adaptedFromRobot,
      ingredients,
      steps,
      preparedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function isRobotRecipeUrlOrText(text: string): boolean {
  return /\b(bimby|thermomix|monsieur[- ]cuisine|multicooker|tm5|tm6|tm31|kcook)\b/i.test(text);
}

function detectPrimaryUtensil(text: string): string {
  const hasForno = /\b(forno|teglia|pirofila|infornat)\b/i.test(text);
  const hasPadella = /\b(padella|rosolat|soffritt|saltat)\b/i.test(text);
  const hasPentola = /\b(pentola|casseruola|tegame|bollit|less)\b/i.test(text);
  if (hasForno && (hasPadella || hasPentola)) return 'Fornelli e Forno';
  if (hasForno) return 'Forno';
  if (hasPadella) return 'Padella';
  if (hasPentola) return 'Pentola';
  return 'Padella / Pentola';
}

async function discoverRecipeUrlsFromWeb(query: string): Promise<Array<{ url: string; titleHint: string }>> {
  const candidates: Array<{ url: string; titleHint: string }> = [];
  const seen = new Set<string>();

  const blockedHosts = [
    'youtube.com',
    'youtu.be',
    'pinterest.',
    'facebook.com',
    'instagram.com',
    'tiktok.com',
    'amazon.',
    'ricettario-bimby',
    'ricetteperbimby',
  ];

  const addCandidate = (rawUrl: string, titleHint = '') => {
    const parsed = isSafePublicUrl(rawUrl);
    if (!parsed) return;
    const normalized = parsed.toString();
    const host = parsed.hostname.toLowerCase();
    if (blockedHosts.some((b) => host.includes(b))) return;
    if (isRobotRecipeUrlOrText(normalized) || isRobotRecipeUrlOrText(titleHint)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push({ url: normalized, titleHint: decodeHtmlEntities(titleHint).trim() });
  };

  // 1) DuckDuckGo HTML Search (fast, multi-source Italian web search)
  try {
    const ddgQuery = encodeURIComponent(`ricetta ${query} tradizionale -bimby -thermomix -multicooker`);
    const ddgRes = await fetch(`https://html.duckduckgo.com/html/?q=${ddgQuery}`, {
      signal: AbortSignal.timeout(5500),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'it-IT,it;q=0.9',
      },
    });
    if (ddgRes.ok) {
      const html = await ddgRes.text();
      const linkRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRegex.exec(html)) !== null) {
        let href = m[1];
        const titleHint = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
        if (uddgMatch) {
          try {
            href = decodeURIComponent(uddgMatch[1]);
          } catch {
            // keep href
          }
        }
        addCandidate(href, titleHint);
        if (candidates.length >= 7) break;
      }
    }
  } catch {
    // Continue to direct culinary site search fallback
  }

  // 2) GialloZafferano direct search fallback if DDG returned few results
  if (candidates.length < 3) {
    try {
      const slug = encodeURIComponent(query.trim().toLowerCase().replace(/\s+/g, '+'));
      const gzRes = await fetch(`https://www.giallozafferano.it/ricerca-ricette/${slug}/`, {
        signal: AbortSignal.timeout(5500),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15',
        },
      });
      if (gzRes.ok) {
        const html = await gzRes.text();
        const urlMatches = html.matchAll(/https:\/\/ricette\.giallozafferano\.it\/[A-Za-z0-9_-]+\.html/g);
        for (const um of urlMatches) {
          addCandidate(um[0], '');
          if (candidates.length >= 6) break;
        }
      }
    } catch {
      // Ignore
    }
  }

  return candidates.slice(0, 6);
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

  // Primary: Real multi-source web discovery + Schema.org JSON-LD inspection (instant, zero quota burn, ad-free!)
  const candidates = await discoverRecipeUrlsFromWeb(query);

  if (candidates.length > 0) {
    const inspected = await Promise.all(
      candidates.slice(0, 5).map(async (cand, idx): Promise<RecipeSearchResult | null> => {
        const page = await fetchCleanWebRecipePage(cand.url, 4500);
        let host = 'Fonte Web';
        try {
          host = new URL(cand.url).hostname.replace(/^www\./, '');
        } catch {
          // ignore
        }

        if (page?.jsonLdRecipe) {
          try {
            const node = JSON.parse(page.jsonLdRecipe) as Record<string, unknown>;
            const title =
              typeof node.name === 'string'
                ? decodeHtmlEntities(node.name).trim()
                : cand.titleHint || page.title;
            if (isRobotRecipeUrlOrText(title)) return null;

            const descRaw =
              typeof node.description === 'string'
                ? cleanStepText(node.description)
                : 'Ricetta tradizionale preparata senza robot da cucina.';
            const prepMins = parseIsoDurationMinutes(node.prepTime);
            const cookMins = parseIsoDurationMinutes(node.cookTime);
            const yieldRaw = Array.isArray(node.recipeYield) ? node.recipeYield[0] : node.recipeYield;
            const yieldMatch =
              typeof yieldRaw === 'string' || typeof yieldRaw === 'number'
                ? String(yieldRaw).match(/\d+/)
                : null;
            const servings = yieldMatch ? Math.max(1, Number(yieldMatch[0])) : 4;

            return {
              id: `res_${Date.now()}_${idx}`,
              title,
              sourceName: host,
              sourceUrl: cand.url,
              description: descRaw.length > 145 ? `${descRaw.slice(0, 142)}...` : descRaw,
              prepTimeMinutes: prepMins,
              cookTimeMinutes: cookMins,
              servings,
              primaryUtensil: detectPrimaryUtensil(`${title} ${page.jsonLdRecipe}`),
              difficulty: 'Media',
              region: 'Tradizione italiana',
            };
          } catch {
            // Fall through to metadata result
          }
        }

        if (cand.titleHint || page?.title) {
          const cleanTitle = (cand.titleHint || page?.title || query)
            .replace(/\s*[-|–]\s*(GialloZafferano|La Cucina Italiana|Cucchiaio).*$/i, '')
            .trim();
          return {
            id: `res_${Date.now()}_${idx}`,
            title: cleanTitle,
            sourceName: host,
            sourceUrl: cand.url,
            description: 'Ricetta tradizionale dal web pronta per essere estratta senza pubblicità.',
            prepTimeMinutes: null,
            cookTimeMinutes: null,
            servings: 4,
            primaryUtensil: detectPrimaryUtensil(`${cleanTitle} ${page?.cleanText || ''}`),
            difficulty: 'Media',
            region: null,
          };
        }

        return null;
      })
    );

    const cleanResults = inspected.filter((r): r is RecipeSearchResult => r !== null);
    if (cleanResults.length > 0) {
      return {
        query,
        results: cleanResults,
        groundingSources: cleanResults.map((r) => ({
          title: `${r.title} (${r.sourceName})`,
          url: r.sourceUrl,
        })),
      };
    }
  }

  // Secondary fallback: Gemini Google Search grounding if direct web discovery returned nothing
  const ai = getGeminiClient();
  if (!ai) {
    return { query, results: [], groundingSources: [] };
  }

  const prompt = `Cerca sul web ricette di cucina tradizionale per: "${query}".
Scegli SOLO ricette senza robot da cucina (solo fornelli, forno, padella, pentola).
Restituisci esclusivamente JSON valido:
{
  "results": [
    {
      "title": "Nome autentico del piatto",
      "sourceName": "Nome del sito",
      "sourceUrl": "URL completo della ricetta",
      "description": "Breve descrizione pulita in italiano (max 140 caratteri).",
      "prepTimeMinutes": 15,
      "cookTimeMinutes": 25,
      "servings": 4,
      "primaryUtensil": "Padella | Pentola | Forno | Casseruola | Fornelli e Forno",
      "difficulty": "Facile | Media | Impegnativa",
      "region": "Regione o tradizione"
    }
  ]
}`;

  let response;
  try {
    response = await ai.models.generateContent({
      model: PRIMARY_MODEL,
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
        prepTimeMinutes:
          typeof item.prepTimeMinutes === 'number' ? Math.max(1, Math.round(item.prepTimeMinutes)) : null,
        cookTimeMinutes:
          typeof item.cookTimeMinutes === 'number' ? Math.max(1, Math.round(item.cookTimeMinutes)) : null,
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

async function generateStructuredRecipeWithFallbackModel(
  ai: GoogleGenAI,
  systemInstruction: string,
  rawSourceMaterial: string
): Promise<Record<string, unknown>> {
  const modelsToTry = [PRIMARY_MODEL, FALLBACK_MODEL];
  let lastError: unknown;

  for (const model of modelsToTry) {
    try {
      const structuredResponse = await ai.models.generateContent({
        model,
        contents: `Trasforma e normalizza la seguente ricetta in una scheda pulita, senza pubblicità, pronta per cucinare passo dopo passo.\n\n${rawSourceMaterial}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: PREPARED_RECIPE_SCHEMA,
          ...(model === PRIMARY_MODEL ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
        },
      });
      return parseJsonLoose<Record<string, unknown>>(structuredResponse.text ?? '{}', {});
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

export async function prepareTraditionalRecipe(input: PrepareRecipeInput): Promise<PreparedRecipe> {
  let cleanUrl = input.url?.trim() || '';
  const cleanTitle = input.title?.trim() || '';
  const cleanQuery = input.query?.trim() || '';

  if (!cleanUrl && !cleanTitle && !cleanQuery) {
    const err = new Error('Fornisci un URL oppure il titolo della ricetta da preparare.') as Error & {
      statusCode?: number;
    };
    err.statusCode = 400;
    throw err;
  }

  // If no URL was provided, first check if we can discover a real traditional URL on the web
  if (!cleanUrl && (cleanTitle || cleanQuery)) {
    const discovered = await discoverRecipeUrlsFromWeb(cleanTitle || cleanQuery);
    if (discovered[0]?.url) {
      cleanUrl = discovered[0].url;
    }
  }

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

  const ai = getGeminiClient();

  const systemInstruction = `Sei un maestro di cucina tradizionale italiana che ripulisce e struttura ricette web eliminando completamente pubblicità, banner, storie superflue e qualsiasi robot da cucina.
REGOLE TASSATIVE:
1. Lingua: 100% italiano naturale, preciso e pratico.
2. NIENTE ROBOT DA CUCINA: È vietato usare Bimby, Thermomix, Monsieur Cuisine, kCook, planetarie automatiche o robot multifunzione. Se la ricetta originale li menziona, converti ogni passaggio alla cucina tradizionale manuale usando fornelli, forno, padella, pentola, casseruola, ciotola, frusta a mano o coltello, e imposta adaptedFromRobot = true.
3. INGREDIENTI RICALCOLABILI: Separa sempre con precisione quantità numerica (es. 320, 0.5, null per q.b.), unità di misura e nome ingrediente, così l'app possa ricalcolare le porzioni con esattezza matematica.
4. PARAMETRI DI COTTURA PER OGNI STEP: Ogni passaggio deve specificare utensile tradizionale, metodo, intensità fiamma o temperatura del forno (es. "Forno statico 180°C", "Fuoco dolce"), e quando c'è un tempo di cottura/riposo, inserisci durationSeconds (intero, es. 480 per 8 minuti) e durationLabel (es. "8 min") per alimentare il timer integrato.`;

  let rawSourceMaterial = '';
  let parsed: Record<string, unknown> = {};

  try {
    if (!ai) {
      throw new Error('GEMINI_MISSING');
    }

    if (extractedPage && (extractedPage.jsonLdRecipe || extractedPage.cleanText.length > 250)) {
      rawSourceMaterial = `FONTE WEB ESTRATTA (${sourceHost} - ${cleanUrl}):
TITOLO PAGINA: ${extractedPage.title}
${extractedPage.jsonLdRecipe ? `\nDATI STRUTTURATI JSON-LD:\n${extractedPage.jsonLdRecipe}\n` : ''}
TESTO PULITO DELLA PAGINA:
${extractedPage.cleanText}`;
    } else if (cleanUrl) {
      const contextResponse = await ai.models.generateContent({
        model: PRIMARY_MODEL,
        contents: `Leggi questa pagina ricetta (${cleanUrl}) ed estrai tutti gli ingredienti esatti, le dosi, le porzioni, i tempi, le temperature di forno/fornelli e tutti i passaggi di preparazione in italiano, ignorando pubblicità e cookie banner.`,
        config: {
          tools: [{ urlContext: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      rawSourceMaterial = `CONTENUTO ESTRATTO DA ${cleanUrl}:\n${contextResponse.text ?? ''}`;
    } else {
      const searchLookup = await ai.models.generateContent({
        model: PRIMARY_MODEL,
        contents: `Cerca sul web la ricetta tradizionale autentica di "${cleanTitle || cleanQuery}" cucinata senza robot da cucina (solo fornelli, forno, padella, pentola). Riporta in dettaglio dosi esatte degli ingredienti, porzioni, tempi e temperature di ogni passaggio.`,
        config: {
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      rawSourceMaterial = `RICETTA TRADIZIONALE TROVATA SUL WEB PER "${cleanTitle || cleanQuery}":\n${searchLookup.text ?? ''}`;
    }

    parsed = await generateStructuredRecipeWithFallbackModel(ai, systemInstruction, rawSourceMaterial);
  } catch (err) {
    // Immediate high-precision Italian JSON-LD fallback when Gemini quota is exhausted (429) or unavailable
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
    if ((err as Error).message === 'GEMINI_MISSING') {
      const configErr = new Error(
        'Chiave API Gemini non configurata e pagina priva di dati ricetta strutturati.'
      ) as Error & { statusCode?: number };
      configErr.statusCode = 500;
      throw configErr;
    }
    throw toCleanApiError(err);
  }

  if (!parsed || typeof parsed.title !== 'string' || !Array.isArray(parsed.ingredients) || !Array.isArray(parsed.steps)) {
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
