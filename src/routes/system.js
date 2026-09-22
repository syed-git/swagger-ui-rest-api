import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resources } from '../resources.js';
import { seed } from '../seed.js';
import { badRequest, unauthorized, notFound } from '../errors.js';
import { present } from '../model.js';
import { json, errorResponse } from './resources.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const TOKEN_TTL_MS = 60 * 60 * 1000;

function issueToken(store, user) {
  const token = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  store.tokens.set(token, { userId: user.id, expiresAt });
  return { token, tokenType: 'Bearer', expiresAt, user: present('users', user) };
}

export function authenticate(store, req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized('Missing Bearer token');
  const session = store.tokens.get(token);
  if (!session) throw unauthorized('Invalid token');
  if (Date.parse(session.expiresAt) < Date.now()) {
    store.tokens.delete(token);
    throw unauthorized('Token expired');
  }
  return { token, session, user: store.collection('users').get(session.userId) };
}

export function registerSystemRoutes(registry, store) {
  registry.add({
    method: 'get',
    path: '/health',
    tag: 'System',
    summary: 'Health check',
    responses: { 200: { description: 'Service is healthy', content: json({ type: 'object', properties: { status: { type: 'string' }, uptimeSeconds: { type: 'number' }, timestamp: { type: 'string' } } }) } },
    handler: (req, res) => {
      res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()), timestamp: new Date().toISOString() });
    },
  });

  registry.add({
    method: 'get',
    path: '/version',
    tag: 'System',
    summary: 'API version information',
    responses: { 200: { description: 'Version', content: json({ type: 'object', properties: { name: { type: 'string' }, version: { type: 'string' }, apiVersion: { type: 'string' }, node: { type: 'string' } } }) } },
    handler: (req, res) => {
      res.json({ name: pkg.name, version: pkg.version, apiVersion: 'v1', node: process.version, environment: process.env.NODE_ENV || 'development' });
    },
  });

  registry.add({
    method: 'get',
    path: '/meta/endpoints',
    tag: 'System',
    summary: 'List every endpoint exposed by this API',
    responses: { 200: { description: 'Endpoint catalogue', content: json({ type: 'object', properties: { total: { type: 'integer' }, byMethod: { type: 'object' }, endpoints: { type: 'array', items: { type: 'object' } } } }) } },
    handler: (req, res) => {
      const endpoints = registry.list();
      const byMethod = endpoints.reduce((acc, e) => ({ ...acc, [e.method]: (acc[e.method] || 0) + 1 }), {});
      res.json({ total: endpoints.length, byMethod, endpoints });
    },
  });

  registry.add({
    method: 'get',
    path: '/meta/resources',
    tag: 'System',
    summary: 'Describe every resource and its fields',
    responses: { 200: { description: 'Resource catalogue', content: json({ type: 'object' }) } },
    handler: (req, res) => {
      res.json({
        total: resources.length,
        resources: resources.map((r) => ({
          name: r.name,
          singular: r.singular,
          description: r.description,
          searchFields: r.searchFields,
          fields: Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, { type: v.type, required: !!v.required, enum: v.enum, ref: v.ref, auto: !!v.auto, default: v.default }])),
        })),
      });
    },
  });

  registry.add({
    method: 'get',
    path: '/meta/stats',
    tag: 'System',
    summary: 'Record counts per resource',
    responses: { 200: { description: 'Counts', content: json({ type: 'object' }) } },
    handler: (req, res) => {
      const counts = store.counts();
      res.json({ startedAt: store.startedAt.toISOString(), lastResetAt: store.lastResetAt, totalRecords: Object.values(counts).reduce((a, b) => a + b, 0), counts });
    },
  });

  registry.add({
    method: 'post',
    path: '/auth/login',
    tag: 'Auth',
    summary: 'Login with username & password',
    description: 'All seeded users share the password Password123!  (e.g. username admin).',
    requestBody: { required: true, content: json({ $ref: '#/components/schemas/LoginRequest' }, { username: 'admin', password: 'Password123!' }) },
    responses: { 200: { description: 'Token issued', content: json({ $ref: '#/components/schemas/AuthToken' }) }, 400: errorResponse('Bad request'), 401: errorResponse('Invalid credentials') },
    handler: (req, res) => {
      const { username, password } = req.body || {};
      if (!username || !password) throw badRequest('username and password are required');
      const user = store.collection('users').all().find((u) => u.username === username);
      if (!user || user.password !== password) throw unauthorized('Invalid username or password');
      if (!user.active) throw unauthorized('User account is inactive');
      store.collection('users').patch(user.id, { lastLoginAt: new Date().toISOString() });
      res.json(issueToken(store, store.collection('users').get(user.id)));
    },
  });

  registry.add({
    method: 'get',
    path: '/auth/me',
    tag: 'Auth',
    summary: 'Current user for the supplied Bearer token',
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: 'Current user', content: json({ $ref: '#/components/schemas/User' }) }, 401: errorResponse('Unauthorized') },
    handler: (req, res) => {
      const { user, session } = authenticate(store, req);
      res.json({ ...present('users', user), tokenExpiresAt: session.expiresAt });
    },
  });

  registry.add({
    method: 'post',
    path: '/auth/refresh',
    tag: 'Auth',
    summary: 'Exchange a valid token for a fresh one',
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: 'New token', content: json({ $ref: '#/components/schemas/AuthToken' }) }, 401: errorResponse('Unauthorized') },
    handler: (req, res) => {
      const { token, user } = authenticate(store, req);
      store.tokens.delete(token);
      res.json(issueToken(store, user));
    },
  });

  registry.add({
    method: 'post',
    path: '/auth/logout',
    tag: 'Auth',
    summary: 'Invalidate the supplied Bearer token',
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: 'Logged out', content: json({ type: 'object', properties: { loggedOut: { type: 'boolean' } } }) }, 401: errorResponse('Unauthorized') },
    handler: (req, res) => {
      const { token } = authenticate(store, req);
      store.tokens.delete(token);
      res.json({ loggedOut: true });
    },
  });

  registry.add({
    method: 'post',
    path: '/auth/change-password',
    tag: 'Auth',
    summary: 'Change the password of the current user',
    security: [{ bearerAuth: [] }],
    requestBody: { required: true, content: json({ type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string', minLength: 8 } } }, { currentPassword: 'Password123!', newPassword: 'NewPassword456!' }) },
    responses: { 200: { description: 'Password changed', content: json({ type: 'object', properties: { changed: { type: 'boolean' } } }) }, 400: errorResponse('Bad request'), 401: errorResponse('Unauthorized') },
    handler: (req, res) => {
      const { user } = authenticate(store, req);
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) throw badRequest('currentPassword and newPassword are required');
      if (typeof newPassword !== 'string' || newPassword.length < 8) throw badRequest('newPassword must be at least 8 characters');
      if (user.password !== currentPassword) throw unauthorized('currentPassword is incorrect');
      store.collection('users').patch(user.id, { password: newPassword });
      res.json({ changed: true });
    },
  });

  registry.add({
    method: 'post',
    path: '/admin/reset',
    tag: 'Admin',
    summary: 'Reset all data back to the seed dataset',
    description: 'Restores every collection to its deterministic seed state and revokes all tokens. Handy before an automated test run.',
    responses: { 200: { description: 'Reset complete', content: json({ type: 'object', properties: { reset: { type: 'boolean' }, resetAt: { type: 'string' }, counts: { type: 'object' } } }) } },
    handler: (req, res) => {
      const counts = seed(store);
      res.json({ reset: true, resetAt: store.lastResetAt, counts });
    },
  });

  registry.add({
    method: 'delete',
    path: '/admin/collections/:name',
    tag: 'Admin',
    summary: 'Delete every record in a collection',
    parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string', enum: resources.map((r) => r.name) } }],
    responses: { 200: { description: 'Collection cleared', content: json({ type: 'object', properties: { cleared: { type: 'boolean' }, resource: { type: 'string' }, removed: { type: 'integer' } } }) }, 404: errorResponse('Unknown collection') },
    handler: (req, res) => {
      const name = req.params.name;
      if (!store.collections[name]) throw notFound('collection', name);
      const removed = store.collections[name].items.size;
      store.collections[name].items.clear();
      res.json({ cleared: true, resource: name, removed });
    },
  });

  registry.add({
    method: 'get',
    path: '/search',
    tag: 'System',
    summary: 'Global search across all resources',
    parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Matches grouped by resource', content: json({ type: 'object' }) }, 400: errorResponse('Missing q') },
    handler: (req, res) => {
      const q = req.query.q;
      if (q === undefined || String(q).trim() === '') throw badRequest("Query parameter 'q' is required");
      const results = {};
      let total = 0;
      for (const r of resources) {
        const hits = store.collection(r.name).search(q, r.searchFields).map((h) => present(r.name, h));
        if (hits.length) {
          results[r.name] = hits;
          total += hits.length;
        }
      }
      res.json({ q, total, results });
    },
  });
}
