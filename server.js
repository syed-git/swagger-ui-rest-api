import { createApp, API_BASE } from './src/app.js';

// Render injects PORT; bind to 0.0.0.0 so the service is reachable from outside the container.
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';

const app = createApp();
const server = app.listen(port, host, () => {
  console.log(`PolicyHub Insurance REST API listening on http://${host}:${port}`);
  console.log(`  Swagger UI : http://localhost:${port}/docs`);
  console.log(`  OpenAPI    : http://localhost:${port}/openapi.json`);
  console.log(`  API base   : http://localhost:${port}${API_BASE}  (${app.locals.registry.operations.length} endpoints)`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
