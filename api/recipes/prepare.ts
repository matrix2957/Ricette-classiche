import { prepareTraditionalRecipe } from '../../lib/recipes-service.ts';

interface ServerlessRequest {
  method?: string;
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
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Metodo non consentito. Usa POST.' });
    return;
  }

  try {
    const body = parseBody(req.body);
    const recipe = await prepareTraditionalRecipe({
      url: typeof body.url === 'string' ? body.url : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
      query: typeof body.query === 'string' ? body.query : undefined,
    });
    res.status(200).json({ recipe });
  } catch (err) {
    const error = err as Error & { statusCode?: number };
    const status = error.statusCode || 500;
    res.status(status).json({
      error: error.message || 'Errore durante la preparazione della ricetta.',
    });
  }
}
