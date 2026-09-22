import { resources } from '../resources.js';
import { paginate } from '../store.js';
import { validateBody, parseId } from '../validate.js';
import { createRecord, present, presentAll } from '../model.js';
import { badRequest } from '../errors.js';

const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'integer', minimum: 1 },
  description: 'Record id',
};

const listParams = (resource) => [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 20 } },
  { name: 'sortBy', in: 'query', schema: { type: 'string', default: 'id' } },
  { name: 'sortOrder', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } },
  ...Object.keys(resource.fields)
    .filter((f) => !resource.hidden?.includes(f))
    .map((f) => ({ name: f, in: 'query', schema: { type: 'string' }, description: `Filter by exact ${f}` })),
];

const RESERVED_QUERY = new Set(['page', 'pageSize', 'sortBy', 'sortOrder', 'q']);

export function extractFilters(resource, query) {
  const filters = {};
  for (const [k, v] of Object.entries(query)) {
    if (RESERVED_QUERY.has(k)) continue;
    if (!resource.fields[k]) throw badRequest(`Unknown filter '${k}' for ${resource.name}`);
    if (resource.hidden?.includes(k)) throw badRequest(`Cannot filter by '${k}'`);
    filters[k] = v;
  }
  return filters;
}

/** Register the 8 standard endpoints for every resource in the catalogue. */
export function registerResourceRoutes(registry, store) {
  for (const resource of resources) {
    const base = `/${resource.name}`;
    const schemaRef = { $ref: `#/components/schemas/${resource.singular}` };
    const inputRef = { $ref: `#/components/schemas/${resource.singular}Input` };
    const patchRef = { $ref: `#/components/schemas/${resource.singular}Patch` };
    const tag = resource.tag;
    const col = () => store.collection(resource.name);

    registry.add({
      method: 'get',
      path: base,
      tag,
      summary: `List ${resource.name}`,
      description: `Paginated list of ${resource.name}. Any field can be used as an exact-match filter query parameter.`,
      parameters: listParams(resource),
      responses: { 200: { description: 'Paginated list', content: pageSchema(schemaRef) } },
      handler: (req, res) => {
        const filters = extractFilters(resource, req.query);
        const page = paginate(col().filter(filters), req.query);
        res.json({ ...page, data: presentAll(resource.name, page.data) });
      },
    });

    registry.add({
      method: 'get',
      path: `${base}/count`,
      tag,
      summary: `Count ${resource.name}`,
      parameters: listParams(resource).slice(4),
      responses: { 200: { description: 'Count', content: json({ type: 'object', properties: { resource: { type: 'string' }, count: { type: 'integer' } } }) } },
      handler: (req, res) => {
        const filters = extractFilters(resource, req.query);
        res.json({ resource: resource.name, count: col().count(filters) });
      },
    });

    registry.add({
      method: 'get',
      path: `${base}/search`,
      tag,
      summary: `Search ${resource.name}`,
      description: `Case-insensitive substring search across: ${resource.searchFields.join(', ')}`,
      parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
      responses: {
        200: { description: 'Matches', content: json({ type: 'object', properties: { q: { type: 'string' }, total: { type: 'integer' }, data: { type: 'array', items: schemaRef } } }) },
        400: errorResponse('Missing q'),
      },
      handler: (req, res) => {
        const q = req.query.q;
        if (q === undefined || String(q).trim() === '') throw badRequest("Query parameter 'q' is required");
        const data = col().search(q, resource.searchFields);
        res.json({ q, total: data.length, data: presentAll(resource.name, data) });
      },
    });

    registry.add({
      method: 'get',
      path: `${base}/:id`,
      tag,
      summary: `Get ${resource.singular} by id`,
      parameters: [idParam],
      responses: { 200: { description: resource.singular, content: json(schemaRef) }, 404: errorResponse('Not found') },
      handler: (req, res) => {
        res.json(present(resource.name, col().get(parseId(req.params.id))));
      },
    });

    registry.add({
      method: 'post',
      path: base,
      tag,
      summary: `Create ${resource.singular}`,
      requestBody: { required: true, content: json(inputRef, exampleInput(resource)) },
      responses: { 201: { description: 'Created', content: json(schemaRef) }, 400: errorResponse('Bad request'), 422: errorResponse('Validation error') },
      handler: (req, res) => {
        const data = validateBody(resource, req.body, 'create', store);
        const created = createRecord(store, resource.name, data);
        res.status(201).location(`/api/v1${base}/${created.id}`).json(present(resource.name, created));
      },
    });

    registry.add({
      method: 'put',
      path: `${base}/:id`,
      tag,
      summary: `Replace ${resource.singular}`,
      description: 'Full replacement - all required fields must be supplied.',
      parameters: [idParam],
      requestBody: { required: true, content: json(inputRef, exampleInput(resource)) },
      responses: { 200: { description: 'Replaced', content: json(schemaRef) }, 404: errorResponse('Not found'), 422: errorResponse('Validation error') },
      handler: (req, res) => {
        const id = parseId(req.params.id);
        const existing = col().get(id);
        const data = validateBody(resource, req.body, 'replace', store);
        for (const [field, spec] of Object.entries(resource.fields)) {
          if (spec.auto) data[field] = existing[field];
        }
        res.json(present(resource.name, col().replace(id, data)));
      },
    });

    registry.add({
      method: 'patch',
      path: `${base}/:id`,
      tag,
      summary: `Partially update ${resource.singular}`,
      parameters: [idParam],
      requestBody: { required: true, content: json(patchRef, examplePatch(resource)) },
      responses: { 200: { description: 'Updated', content: json(schemaRef) }, 404: errorResponse('Not found'), 422: errorResponse('Validation error') },
      handler: (req, res) => {
        const id = parseId(req.params.id);
        col().get(id);
        const data = validateBody(resource, req.body, 'patch', store);
        res.json(present(resource.name, col().patch(id, data)));
      },
    });

    registry.add({
      method: 'delete',
      path: `${base}/:id`,
      tag,
      summary: `Delete ${resource.singular}`,
      parameters: [idParam],
      responses: {
        200: { description: 'Deleted', content: json({ type: 'object', properties: { deleted: { type: 'boolean' }, resource: { type: 'string' }, id: { type: 'integer' } } }) },
        404: errorResponse('Not found'),
      },
      handler: (req, res) => {
        const id = parseId(req.params.id);
        col().remove(id);
        res.json({ deleted: true, resource: resource.name, id });
      },
    });
  }
}

export const json = (schema, example) => ({ 'application/json': example ? { schema, example } : { schema } });

export const errorResponse = (description) => ({
  description,
  content: json({ $ref: '#/components/schemas/Error' }),
});

export const pageSchema = (itemRef) =>
  json({
    type: 'object',
    properties: {
      data: { type: 'array', items: itemRef },
      page: { type: 'integer' },
      pageSize: { type: 'integer' },
      total: { type: 'integer' },
      totalPages: { type: 'integer' },
      sortBy: { type: 'string' },
      sortOrder: { type: 'string' },
    },
  });

export function exampleInput(resource) {
  const out = {};
  for (const [field, spec] of Object.entries(resource.fields)) {
    if (spec.auto) continue;
    out[field] = spec.example;
  }
  return out;
}

export function examplePatch(resource) {
  const candidates = Object.entries(resource.fields).filter(([, s]) => !s.auto && !s.required && !s.ref);
  const [field, spec] = candidates[0] ?? Object.entries(resource.fields).find(([, s]) => !s.auto);
  return { [field]: spec.example };
}
