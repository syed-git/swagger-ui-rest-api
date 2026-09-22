# swagger-ui-rest-api — PolicyHub Insurance REST API

A self-contained mock **insurance platform REST API** with **287 JSON endpoints**
(GET / POST / PUT / PATCH / DELETE) across 22 resources, a built-in **Swagger UI**
for exploring and testing every endpoint, and a one-click **Render** deployment.

It is the system-under-test for the Mocha automation framework in
[syed-git/MOCHA_REST_API_TESTING](https://github.com/syed-git/MOCHA_REST_API_TESTING).

| URL | What |
| --- | --- |
| `/docs` | Swagger UI (root `/` redirects here) |
| `/openapi.json` | OpenAPI 3.0 document (generated from the real routes) |
| `/health` | Health check used by Render |
| `/api/v1/...` | The API |

## Quick start

```bash
npm ci
npm start            # http://localhost:3000/docs
npm test             # node:test API tests
npm run lint
npm run openapi      # print the OpenAPI document to stdout
```

`PORT` (default 3000) and `HOST` (default 0.0.0.0) are honoured.

## Deploy to Render

The repo contains a [`render.yaml`](render.yaml) blueprint:

1. Render dashboard → **New → Blueprint** → select this repository.
2. Render builds with `npm ci --omit=dev`, starts with `npm start` and health-checks `/health`.
3. Swagger UI is then available at `https://<service>.onrender.com/docs`.

`autoDeploy: true` redeploys on every push to the connected branch. If you prefer to
deploy only after CI passes, add a `RENDER_DEPLOY_HOOK_URL` repository secret
(Render → service → Settings → Deploy Hook); the `deploy` job in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) calls it after lint + tests succeed.

## API overview

All data is held in memory and **deterministically seeded** at start
(≈500 records). `POST /api/v1/admin/reset` restores the seed at any time, which
makes the API safe to run automated suites against repeatedly.

### Standard endpoints (every resource)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/{resource}` | Paged list. `page`, `pageSize`, `sortBy`, `sortOrder`, plus any field as an exact-match filter (`?status=Active`) |
| GET | `/{resource}/count` | `{ count }`, accepts the same filters |
| GET | `/{resource}/search?q=` | Case-insensitive substring search over the resource's search fields |
| GET | `/{resource}/{id}` | 404 when missing, 400 when id is not an integer |
| POST | `/{resource}` | 201 + `Location` header; 422 with per-field `details` on validation errors |
| PUT | `/{resource}/{id}` | Full replace (required fields enforced) |
| PATCH | `/{resource}/{id}` | Partial update (at least one field) |
| DELETE | `/{resource}/{id}` | `{ deleted: true, resource, id }` |

Resources: `agencies`, `agents`, `products`, `billing-plans`, `users`, `accounts`,
`contacts`, `addresses`, `quotes`, `policies`, `vehicles`, `drivers`, `coverages`,
`discounts`, `endorsements`, `claims`, `notes`, `invoices`, `payments`, `documents`,
`activities`, `underwriting-issues`.

Validation rules (types, required, enums, foreign keys via `ref`, server-generated
`auto` fields) live in a single catalogue: [`src/resources.js`](src/resources.js).
Adding a resource there automatically adds its 8 endpoints, OpenAPI schemas and
seed-able collection.

### Domain / action endpoints (examples)

| Method | Path | Behaviour |
| --- | --- | --- |
| POST | `/auth/login` | `admin` / `Password123!` → Bearer token (`/auth/me`, `/auth/refresh`, `/auth/logout`, `/auth/change-password`) |
| POST | `/admin/reset` | Reseed everything |
| GET | `/meta/endpoints`, `/meta/resources`, `/meta/stats` | Endpoint catalogue, field metadata, record counts |
| GET | `/search?q=` | Global search across all resources |
| GET | `/accounts/{id}/summary`, `/accounts/{id}/policies`, `/accounts/{id}/claims`, … | Nested collections |
| POST | `/quotes/{id}/rate` → `/quotes/{id}/bind` | Rating and binding (bind creates a policy; 409 if open UW issues) |
| POST | `/policies/{id}/issue` / `cancel` / `reinstate` / `expire` / `renew` | Policy lifecycle (409 on illegal transitions) |
| POST | `/claims/{id}/assign` / `approve` / `deny` / `close` / `reopen` / `payments` / `notes` | Claim lifecycle |
| POST | `/invoices/{id}/pay`, `/payments/{id}/refund` | Billing |
| GET | `/reports/premium-by-product`, `/reports/claims-by-status`, `/reports/agent-production`, `/reports/billing-aging` | Aggregations |

Full list: open Swagger UI or `GET /api/v1/meta/endpoints`.

### Error format

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request body failed validation",
             "details": [ { "field": "type", "message": "must be one of: Personal, Commercial", "received": "Nope" } ] } }
```

| Status | Code |
| --- | --- |
| 400 | `BAD_REQUEST`, `INVALID_JSON` |
| 401 | `UNAUTHORIZED` |
| 404 | `NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 409 | `CONFLICT` (illegal state transition) |
| 422 | `VALIDATION_ERROR` |

## Project layout

```
server.js               entry point (PORT / HOST)
src/app.js              express app, Swagger UI wiring
src/resources.js        resource catalogue (fields, validation, examples)
src/routes/resources.js generic CRUD/search/count routes for every resource
src/routes/actions.js   domain actions, nested lists, reports
src/routes/system.js    health, version, meta, auth, admin, global search
src/registry.js         route registry that feeds both Express and OpenAPI
src/openapi.js          OpenAPI 3.0 document builder
src/store.js            in-memory collections, filtering, pagination
src/seed.js             deterministic seed data
src/validate.js         request body validation
test/api.test.js        node:test suite run in CI
```
