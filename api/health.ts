interface ServerlessRequest {
  method?: string;
}

interface ServerlessResponse {
  status: (code: number) => ServerlessResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: () => void;
}

export default function handler(req: ServerlessRequest, res: ServerlessResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Metodo non consentito. Usa GET.' });
    return;
  }

  const geminiConfigured = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
  );

  res.status(200).json({
    ok: true,
    service: 'focolare-api',
    runtime: process.env.VERCEL ? 'vercel-serverless' : 'node-express',
    geminiConfigured,
    timestamp: new Date().toISOString(),
  });
}
