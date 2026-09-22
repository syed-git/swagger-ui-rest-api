import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { Store } from './store.js';
import { seed } from './seed.js';
import { Registry } from './registry.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerActionRoutes } from './routes/actions.js';
import { registerResourceRoutes } from './routes/resources.js';
import { buildOpenApi } from './openapi.js';
import { errorHandler, notFoundHandler } from './errors.js';

export const API_BASE = '/api/v1';

export function createApp() {
  const store = new Store();
  seed(store);

  const app = express();
  app.disable('x-powered-by');
  app.set('json spaces', 2);
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  const registry = new Registry(api);

  // Order matters: literal paths (e.g. /invoices/overdue) must be registered
  // before the generic /:id routes so they are not swallowed as ids.
  registerSystemRoutes(registry, store);
  registerActionRoutes(registry, store);
  registerResourceRoutes(registry, store);

  const spec = buildOpenApi(registry, API_BASE);

  app.get('/openapi.json', (req, res) => res.json(spec));
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: 'PolicyHub Insurance REST API',
      swaggerOptions: {
        docExpansion: 'none',
        filter: true,
        displayRequestDuration: true,
        persistAuthorization: true,
        tryItOutEnabled: true,
        tagsSorter: 'alpha',
      },
    }),
  );
  app.get('/', (req, res) => res.redirect('/docs'));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use(API_BASE, api);
  app.use(notFoundHandler);
  app.use(errorHandler);

  app.locals.store = store;
  app.locals.registry = registry;
  app.locals.spec = spec;
  return app;
}
