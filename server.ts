import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareTraditionalRecipe, searchTraditionalRecipes } from './lib/recipes-service.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // API Routes (mirrored 1:1 with Vercel serverless endpoints in /api/*)
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    );
    res.json({
      ok: true,
      service: 'focolare-api',
      runtime: 'node-express',
      geminiConfigured,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/recipes/search', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : typeof req.query.query === 'string' ? req.query.query : '';
      const result = await searchTraditionalRecipes(q);
      res.json(result);
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      res.status(error.statusCode || 500).json({
        error: error.message || 'Errore durante la ricerca delle ricette.',
      });
    }
  });

  app.post('/api/recipes/search', async (req, res) => {
    try {
      const q = typeof req.body?.query === 'string' ? req.body.query : '';
      const result = await searchTraditionalRecipes(q);
      res.json(result);
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      res.status(error.statusCode || 500).json({
        error: error.message || 'Errore durante la ricerca delle ricette.',
      });
    }
  });

  app.post('/api/recipes/prepare', async (req, res) => {
    try {
      const recipe = await prepareTraditionalRecipe({
        url: typeof req.body?.url === 'string' ? req.body.url : undefined,
        title: typeof req.body?.title === 'string' ? req.body.title : undefined,
        query: typeof req.body?.query === 'string' ? req.body.query : undefined,
      });
      res.json({ recipe });
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      res.status(error.statusCode || 500).json({
        error: error.message || 'Errore durante la preparazione della ricetta.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Focolare server in ascolto su http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Errore avvio server:', err);
  process.exit(1);
});
