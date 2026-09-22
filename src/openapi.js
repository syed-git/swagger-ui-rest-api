import { readFileSync } from 'node:fs';
import { resources } from './resources.js';
import { toOpenApiPath } from './registry.js';
import { json, errorResponse, ERROR_EXAMPLES } from './routes/resources.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function fieldSchema(spec) {
  const schema = {};
  switch (spec.type) {
    case 'date':
      schema.type = 'string';
      schema.format = 'date';
      break;
    case 'datetime':
      schema.type = 'string';
      schema.format = 'date-time';
      break;
    case 'number':
      schema.type = 'number';
      schema.format = 'double';
      break;
    default:
      schema.type = spec.type;
  }
  if (spec.enum) schema.enum = spec.enum;
  if (spec.example !== undefined) schema.example = spec.example;
  if (spec.default !== undefined) schema.default = spec.default;
  if (spec.ref) schema.description = `Id of an existing ${spec.ref} record`;
  if (spec.auto) schema.readOnly = true;
  if (!spec.required && !spec.auto) schema.nullable = true;
  return schema;
}

function resourceSchemas(resource) {
  const visible = Object.entries(resource.fields).filter(([f]) => !resource.hidden?.includes(f));
  const full = {
    type: 'object',
    properties: {
      id: { type: 'integer', readOnly: true, example: 1 },
      ...Object.fromEntries(visible.map(([f, s]) => [f, fieldSchema(s)])),
      createdAt: { type: 'string', format: 'date-time', readOnly: true },
      updatedAt: { type: 'string', format: 'date-time', readOnly: true },
    },
  };
  const writable = Object.entries(resource.fields).filter(([, s]) => !s.auto);
  const input = {
    type: 'object',
    required: writable.filter(([, s]) => s.required).map(([f]) => f),
    properties: Object.fromEntries(writable.map(([f, s]) => [f, fieldSchema(s)])),
    additionalProperties: false,
  };
  const patch = { ...input, required: undefined, minProperties: 1 };
  delete patch.required;
  return {
    [resource.singular]: full,
    [`${resource.singular}Input`]: input,
    [`${resource.singular}Patch`]: patch,
  };
}

export function buildOpenApi(registry, basePath) {
  const paths = {};
  for (const op of registry.operations) {
    const path = toOpenApiPath(op.path);
    paths[path] = paths[path] || {};
    const pathParams = [...op.path.matchAll(/:([A-Za-z_]+)/g)].map((m) => m[1]);
    const declared = new Set((op.parameters || []).filter((p) => p.in === 'path').map((p) => p.name));
    const parameters = [
      ...(op.parameters || []),
      ...pathParams.filter((p) => !declared.has(p)).map((p) => ({ name: p, in: 'path', required: true, schema: { type: 'string' } })),
    ];
    const responses = { ...(op.responses || {}) };
    if (!responses[400] && parameters.some((p) => p.in === 'path' && p.name === 'id')) {
      responses[400] = errorResponse('Invalid id');
    }
    responses[500] = responses[500] || errorResponse('Unexpected error');
    for (const [status, response] of Object.entries(responses)) {
      const media = response.content?.['application/json'];
      if (media && media.schema?.$ref === '#/components/schemas/Error' && !media.example && ERROR_EXAMPLES[status]) {
        responses[status] = { ...response, content: json(media.schema, { error: ERROR_EXAMPLES[status] }) };
      }
    }

    paths[path][op.method] = {
      tags: [op.tag],
      summary: op.summary,
      description: op.description,
      operationId: `${op.method}${path.replace(/[{}]/g, '').split('/').filter(Boolean).map((s) => s.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase())).join('')}`,
      parameters: parameters.length ? parameters : undefined,
      requestBody: op.requestBody,
      security: op.security,
      responses,
    };
  }

  const tags = [
    { name: 'System', description: 'Health, version, endpoint catalogue and global search' },
    { name: 'Auth', description: 'Token based authentication (seeded users use password Password123!)' },
    { name: 'Admin', description: 'Dataset maintenance for test automation' },
    ...resources.map((r) => ({ name: r.tag, description: r.description })),
    { name: 'Reports', description: 'Aggregated reporting endpoints' },
  ];

  return {
    openapi: '3.0.3',
    info: {
      title: 'PolicyHub Insurance REST API',
      version: pkg.version,
      description: [
        `Mock insurance platform API exposing **${registry.operations.length} JSON endpoints** (GET / POST / PUT / PATCH / DELETE) across ${resources.length} resources.`,
        '',
        'All data lives in memory and is deterministically seeded on start. Use `POST /admin/reset` to restore the seed at any time.',
        '',
        '* Every resource supports `list` (paged, filterable, sortable), `count`, `search`, `get`, `create`, `replace (PUT)`, `patch` and `delete`.',
        '* Validation errors return **422** with a per-field `details` array; unknown ids return **404**; illegal state transitions return **409**.',
        '* `POST /auth/login` with `admin` / `Password123!` to obtain a Bearer token for the `/auth/*` endpoints.',
      ].join('\n'),
      contact: { name: 'syed-git', url: 'https://github.com/syed-git/swagger-ui-rest-api' },
      license: { name: 'ISC' },
    },
    servers: [{ url: basePath, description: 'This server' }],
    tags,
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'NOT_FOUND', enum: ['BAD_REQUEST', 'INVALID_JSON', 'UNAUTHORIZED', 'NOT_FOUND', 'ROUTE_NOT_FOUND', 'CONFLICT', 'VALIDATION_ERROR', 'INTERNAL_ERROR'] },
                message: { type: 'string', example: 'Account 999 not found' },
                details: {
                  type: 'array',
                  description: 'Present only for VALIDATION_ERROR',
                  items: { type: 'object', properties: { field: { type: 'string', example: 'type' }, message: { type: 'string', example: 'must be one of: Personal, Commercial' }, received: { example: 'Nope' } } },
                },
              },
            },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: { username: { type: 'string', example: 'admin' }, password: { type: 'string', example: 'Password123!' } },
        },
        AuthToken: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            tokenType: { type: 'string', example: 'Bearer' },
            expiresAt: { type: 'string', format: 'date-time' },
            user: { $ref: '#/components/schemas/User' },
          },
        },
        ...Object.assign({}, ...resources.map(resourceSchemas)),
      },
    },
  };
}
