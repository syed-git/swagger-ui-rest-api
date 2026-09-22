import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, API_BASE } from '../src/app.js';
import { resources } from '../src/resources.js';

let server;
let base;

before(async () => {
  const app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const api = async (method, path, body, headers = {}) => {
  const res = await fetch(`${base}${API_BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('exposes more than 150 endpoints covering all five HTTP methods', async () => {
  const { status, body } = await api('GET', '/meta/endpoints');
  assert.equal(status, 200);
  assert.ok(body.total > 150, `expected > 150 endpoints, got ${body.total}`);
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) assert.ok(body.byMethod[m] > 0, `no ${m} endpoints`);
});

test('OpenAPI document matches the registered routes and Swagger UI is served', async () => {
  const spec = await (await fetch(`${base}/openapi.json`)).json();
  const { body } = await api('GET', '/meta/endpoints');
  const opCount = Object.values(spec.paths).reduce((n, p) => n + Object.keys(p).length, 0);
  assert.equal(opCount, body.total);
  assert.equal(spec.openapi, '3.0.3');
  for (const r of resources) assert.ok(spec.components.schemas[r.singular], `missing schema ${r.singular}`);

  const docs = await fetch(`${base}/docs/`);
  assert.equal(docs.status, 200);
  assert.match(await docs.text(), /swagger-ui/i);
});

test('health and root redirect', async () => {
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  const root = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/docs');
});

test('every resource supports the full CRUD cycle', async () => {
  const { body: meta } = await api('GET', '/meta/resources');
  for (const r of meta.resources) {
    const list = await api('GET', `/${r.name}?pageSize=1`);
    assert.equal(list.status, 200, r.name);
    assert.ok(Array.isArray(list.body.data));
    assert.ok(list.body.total > 0, `${r.name} should be seeded`);

    const one = await api('GET', `/${r.name}/${list.body.data[0].id}`);
    assert.equal(one.status, 200, r.name);

    const count = await api('GET', `/${r.name}/count`);
    assert.equal(count.body.count, list.body.total);

    const missing = await api('GET', `/${r.name}/999999`);
    assert.equal(missing.status, 404, r.name);
    assert.equal(missing.body.error.code, 'NOT_FOUND');

    const invalid = await api('POST', `/${r.name}`, {});
    assert.ok([201, 422].includes(invalid.status), `${r.name} POST {} -> ${invalid.status}`);
  }
});

test('accounts CRUD with validation, PATCH, PUT and DELETE', async () => {
  const bad = await api('POST', '/accounts', { name: 'X', type: 'Nope' });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.details[0].field, 'type');

  const created = await api('POST', '/accounts', { name: 'Acme Corp', type: 'Commercial', email: 'ops@acme.example.com' });
  assert.equal(created.status, 201);
  assert.match(created.body.accountNumber, /^ACC-\d+$/);
  assert.equal(created.body.status, 'Active');

  const patched = await api('PATCH', `/accounts/${created.body.id}`, { phone: '555-0000' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.phone, '555-0000');
  assert.equal(patched.body.name, 'Acme Corp');

  const replaced = await api('PUT', `/accounts/${created.body.id}`, { name: 'Acme Holdings', type: 'Commercial' });
  assert.equal(replaced.status, 200);
  assert.equal(replaced.body.phone, null);
  assert.equal(replaced.body.accountNumber, created.body.accountNumber);

  const readOnly = await api('PATCH', `/accounts/${created.body.id}`, { accountNumber: 'HACK' });
  assert.equal(readOnly.status, 422);

  const deleted = await api('DELETE', `/accounts/${created.body.id}`);
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { deleted: true, resource: 'accounts', id: created.body.id });
  assert.equal((await api('GET', `/accounts/${created.body.id}`)).status, 404);
});

test('quote lifecycle: rate -> bind creates policy; illegal transitions are 409', async () => {
  const quote = await api('POST', '/quotes', { accountId: 1, productId: 1, effectiveDate: '2025-06-01' });
  assert.equal(quote.status, 201);
  const bindEarly = await api('POST', `/quotes/${quote.body.id}/bind`);
  assert.equal(bindEarly.status, 409);
  const rated = await api('POST', `/quotes/${quote.body.id}/rate`);
  assert.equal(rated.body.status, 'Rated');
  assert.ok(rated.body.premium > 0);
  const bound = await api('POST', `/quotes/${quote.body.id}/bind`, { billingPlanId: 4 });
  assert.equal(bound.status, 200);
  assert.equal(bound.body.quote.status, 'Bound');
  assert.equal(bound.body.policy.status, 'Bound');
  assert.equal(bound.body.policy.premium, rated.body.premium);
});

test('auth: login, me, logout', async () => {
  assert.equal((await api('POST', '/auth/login', { username: 'admin', password: 'wrong' })).status, 401);
  const login = await api('POST', '/auth/login', { username: 'admin', password: 'Password123!' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.password, undefined);
  const auth = { authorization: `Bearer ${login.body.token}` };
  const me = await api('GET', '/auth/me', undefined, auth);
  assert.equal(me.body.username, 'admin');
  assert.equal((await api('POST', '/auth/logout', undefined, auth)).status, 200);
  assert.equal((await api('GET', '/auth/me', undefined, auth)).status, 401);
});

test('admin reset restores seed data', async () => {
  const before = (await api('GET', '/accounts/count')).body.count;
  await api('POST', '/accounts', { name: 'Temp', type: 'Personal' });
  assert.equal((await api('GET', '/accounts/count')).body.count, before + 1);
  const reset = await api('POST', '/admin/reset');
  assert.equal(reset.body.reset, true);
  assert.equal((await api('GET', '/accounts/count')).body.count, reset.body.counts.accounts);
});
