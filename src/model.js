import { resourceByName } from './resources.js';

const NUMBERING = {
  accounts: { field: 'accountNumber', prefix: 'ACC-', base: 1000000 },
  quotes: { field: 'quoteNumber', prefix: 'Q-', base: 5000000 },
  policies: { field: 'policyNumber', prefix: 'POL-', base: 7000000 },
  claims: { field: 'claimNumber', prefix: 'CLM-', base: 9000000 },
  invoices: { field: 'invoiceNumber', prefix: 'INV-', base: 3000000 },
};

/** Insert a validated record, filling server-generated fields. */
export function createRecord(store, resourceName, data) {
  const resource = resourceByName[resourceName];
  const collection = store.collection(resourceName);
  const record = {};
  const numbering = NUMBERING[resourceName];
  if (numbering) record[numbering.field] = data[numbering.field] || `${numbering.prefix}${numbering.base + collection.nextId}`;
  Object.assign(record, data, numbering ? { [numbering.field]: record[numbering.field] } : {});

  for (const [field, spec] of Object.entries(resource.fields)) {
    if (spec.auto && record[field] === undefined) record[field] = null;
  }
  if (resourceName === 'accounts' && !record.createdDate) {
    record.createdDate = new Date().toISOString().slice(0, 10);
  }
  if (resourceName === 'notes' && !record.createdAt) {
    record.createdAt = new Date().toISOString();
  }

  return collection.insert(record);
}

/** Strip fields that must never leave the server (e.g. passwords). */
export function present(resourceName, record) {
  const hidden = resourceByName[resourceName]?.hidden;
  if (!hidden || !record) return record;
  const copy = { ...record };
  hidden.forEach((h) => delete copy[h]);
  return copy;
}

export const presentAll = (resourceName, records) => records.map((r) => present(resourceName, r));
