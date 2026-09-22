import { resources } from './resources.js';
import { badRequest, notFound } from './errors.js';

/**
 * In-memory data store. One collection per resource, integer ids, deterministic
 * seed data (see seed.js). POST /api/v1/admin/reset restores the seed.
 */
class Collection {
  constructor(name) {
    this.name = name;
    this.items = new Map();
    this.nextId = 1;
  }

  all() {
    return [...this.items.values()];
  }

  has(id) {
    return this.items.has(Number(id));
  }

  get(id) {
    const item = this.items.get(Number(id));
    if (!item) throw notFound(this.name, id);
    return item;
  }

  insert(data) {
    const id = this.nextId++;
    const item = { id, ...data, createdAt: now(), updatedAt: now() };
    this.items.set(id, item);
    return item;
  }

  replace(id, data) {
    const existing = this.get(id);
    const item = { id: existing.id, ...data, createdAt: existing.createdAt, updatedAt: now() };
    this.items.set(existing.id, item);
    return item;
  }

  patch(id, data) {
    const existing = this.get(id);
    const item = { ...existing, ...data, id: existing.id, createdAt: existing.createdAt, updatedAt: now() };
    this.items.set(existing.id, item);
    return item;
  }

  remove(id) {
    const existing = this.get(id);
    this.items.delete(existing.id);
    return existing;
  }

  count(filter = {}) {
    return this.filter(filter).length;
  }

  filter(filter = {}) {
    const entries = Object.entries(filter);
    if (entries.length === 0) return this.all();
    return this.all().filter((item) => entries.every(([k, v]) => looseEquals(item[k], v)));
  }

  search(q, fields) {
    const needle = String(q).toLowerCase();
    return this.all().filter((item) =>
      fields.some((f) => item[f] !== undefined && item[f] !== null && String(item[f]).toLowerCase().includes(needle)),
    );
  }

  clear() {
    this.items.clear();
    this.nextId = 1;
  }
}

function looseEquals(actual, expected) {
  if (actual === undefined || actual === null) return false;
  return String(actual).toLowerCase() === String(expected).toLowerCase();
}

const now = () => new Date().toISOString();

export function paginate(items, query = {}) {
  const page = clampInt(query.page, 1, 1, 100000);
  const pageSize = clampInt(query.pageSize, 20, 1, 500);
  const sortBy = query.sortBy || 'id';
  const sortOrder = String(query.sortOrder || 'asc').toLowerCase() === 'desc' ? -1 : 1;

  const sorted = [...items].sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    return (av > bv ? 1 : -1) * sortOrder;
  });

  const total = sorted.length;
  const start = (page - 1) * pageSize;
  return {
    data: sorted.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    sortBy,
    sortOrder: sortOrder === 1 ? 'asc' : 'desc',
  };
}

function clampInt(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`Query parameter must be an integer, received '${value}'`);
  return Math.min(max, Math.max(min, n));
}

export class Store {
  constructor() {
    this.collections = Object.fromEntries(resources.map((r) => [r.name, new Collection(r.name)]));
    this.tokens = new Map();
    this.startedAt = new Date();
    this.lastResetAt = null;
  }

  collection(name) {
    const c = this.collections[name];
    if (!c) throw notFound('resource', name);
    return c;
  }

  clear() {
    Object.values(this.collections).forEach((c) => c.clear());
    this.tokens.clear();
  }

  counts() {
    return Object.fromEntries(Object.entries(this.collections).map(([name, c]) => [name, c.items.size]));
  }
}
