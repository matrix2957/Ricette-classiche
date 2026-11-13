import { searchTraditionalRecipes } from '../../lib/recipes-service.ts';

interface ServerlessRequest {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ServerlessResponse {
  status: (code: number) => ServerlessResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: () => void;
}

function parseBody(body: unknown): Record<string, unknown> {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof body === 'object') return body as Record<string, unknown>;
  return {};
}

export default async function handler(req: ServerlessRequest, res: ServerlessResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Metodo non consentito. Usa GET o POST.' });
    return;
  }

  try {
    const queryParam = req.query?.q ?? req.query?.query;
    const bodyData = parseBody(req.body);
    const rawQuery =
      typeof queryParam === 'string'
        ? queryParam
        : Array.isArray(queryParam)
        ? queryParam[0]
        : typeof bodyData.query === 'string'
        ? bodyData.query
        : '';

    const data = await searchTraditionalRecipes(rawQuery || '');
    res.status(200).json(data);
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    const status = error.statusCode || 500;
    res.status(status).json({
      error: error.message || 'Errore durante la ricerca delle ricette sul web.',
    });
  }
}
