import { badRequest, conflict, notFound } from '../errors.js';
import { createRecord, present, presentAll } from '../model.js';
import { paginate } from '../store.js';
import { validateBody, parseId } from '../validate.js';
import { resourceByName } from '../resources.js';
import { json, errorResponse, pageSchema } from './resources.js';

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } };
const ref = (singular) => ({ $ref: `#/components/schemas/${singular}` });
const listOf = (singular) => json({ type: 'object', properties: { total: { type: 'integer' }, data: { type: 'array', items: ref(singular) } } });
const okResponses = (singular) => ({ 200: { description: 'Updated record', content: json(ref(singular)) }, 404: errorResponse('Not found'), 409: errorResponse('Invalid state transition') });
const round2 = (n) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

export function registerActionRoutes(registry, store) {
  const col = (name) => store.collection(name);

  /** GET /parent/:id/children  (children filtered by fk === parent id) */
  const nested = (parent, child, fk, summary) => {
    const parentRes = resourceByName[parent];
    const childRes = resourceByName[child];
    registry.add({
      method: 'get',
      path: `/${parent}/:id/${child}`,
      tag: parentRes.tag,
      summary: summary || `List ${child} for a ${parentRes.singular}`,
      parameters: [idParam],
      responses: { 200: { description: `${childRes.singular} list`, content: listOf(childRes.singular) }, 404: errorResponse('Parent not found') },
      handler: (req, res) => {
        const id = parseId(req.params.id);
        col(parent).get(id);
        const data = col(child).filter({ [fk]: id });
        res.json({ [`${parentRes.singular.charAt(0).toLowerCase()}${parentRes.singular.slice(1)}Id`]: id, total: data.length, data: presentAll(child, data) });
      },
    });
  };

  /** POST /resource/:id/action  - state transition */
  const transition = ({ resource, action, summary, from, to, apply, body, description }) => {
    const r = resourceByName[resource];
    registry.add({
      method: 'post',
      path: `/${resource}/:id/${action}`,
      tag: r.tag,
      summary,
      description: description || (from ? `Allowed when status is one of: ${from.join(', ')}. Sets status to ${to}.` : undefined),
      parameters: [idParam],
      requestBody: body ? { required: false, content: json(body.schema, body.example) } : undefined,
      responses: okResponses(r.singular),
      handler: (req, res) => {
        const id = parseId(req.params.id);
        const record = col(resource).get(id);
        if (from && !from.includes(record.status)) {
          throw conflict(`${r.singular} ${id} is '${record.status}'; '${action}' requires status in [${from.join(', ')}]`);
        }
        const changes = apply ? apply(record, req.body || {}) : {};
        const updated = col(resource).patch(id, { ...(to ? { status: to } : {}), ...changes });
        res.json(present(resource, updated));
      },
    });
  };

  // ---------------------------------------------------------------- accounts
  nested('accounts', 'contacts', 'accountId');
  nested('accounts', 'addresses', 'accountId');
  nested('accounts', 'policies', 'accountId');
  nested('accounts', 'quotes', 'accountId');
  nested('accounts', 'invoices', 'accountId');
  nested('accounts', 'payments', 'accountId');

  registry.add({
    method: 'get',
    path: '/accounts/:id/claims',
    tag: 'Accounts',
    summary: 'List claims across all policies of an Account',
    parameters: [idParam],
    responses: { 200: { description: 'Claims', content: listOf('Claim') }, 404: errorResponse('Not found') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      col('accounts').get(id);
      const policyIds = new Set(col('policies').filter({ accountId: id }).map((p) => p.id));
      const data = col('claims').all().filter((c) => policyIds.has(c.policyId));
      res.json({ accountId: id, total: data.length, data });
    },
  });

  registry.add({
    method: 'get',
    path: '/accounts/:id/summary',
    tag: 'Accounts',
    summary: 'Account summary (policies, premium, balance, claims)',
    parameters: [idParam],
    responses: { 200: { description: 'Summary', content: json({ type: 'object' }) }, 404: errorResponse('Not found') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      const account = col('accounts').get(id);
      const policies = col('policies').filter({ accountId: id });
      const policyIds = new Set(policies.map((p) => p.id));
      const claims = col('claims').all().filter((c) => policyIds.has(c.policyId));
      const invoices = col('invoices').filter({ accountId: id });
      const outstanding = invoices.filter((i) => ['Due', 'Overdue'].includes(i.status)).reduce((s, i) => s + i.amount, 0);
      res.json({
        account,
        agent: account.agentId ? present('agents', col('agents').items.get(account.agentId)) ?? null : null,
        primaryContact: col('contacts').filter({ accountId: id, primary: true })[0] ?? null,
        policies: { total: policies.length, inForce: policies.filter((p) => p.status === 'InForce').length, totalPremium: round2(policies.reduce((s, p) => s + (p.premium || 0), 0)) },
        claims: { total: claims.length, open: claims.filter((c) => ['Open', 'UnderReview'].includes(c.status)).length, totalPaid: round2(claims.reduce((s, c) => s + (c.paidAmount || 0), 0)) },
        billing: { invoices: invoices.length, outstandingBalance: round2(outstanding), overdue: invoices.filter((i) => i.status === 'Overdue').length },
      });
    },
  });

  transition({ resource: 'accounts', action: 'close', summary: 'Close an Account', from: ['Active', 'Pending'], to: 'Closed' });
  transition({ resource: 'accounts', action: 'reopen', summary: 'Reopen a closed Account', from: ['Closed'], to: 'Active' });
  transition({ resource: 'accounts', action: 'activate', summary: 'Activate a pending Account', from: ['Pending'], to: 'Active' });

  // ------------------------------------------------------------------ agencies / agents
  nested('agencies', 'agents', 'agencyId');
  nested('agents', 'accounts', 'agentId');
  nested('agents', 'policies', 'agentId');
  nested('agents', 'quotes', 'agentId');
  transition({ resource: 'agents', action: 'deactivate', summary: 'Deactivate an Agent', apply: () => ({ active: false }) });
  transition({ resource: 'agents', action: 'activate', summary: 'Activate an Agent', apply: () => ({ active: true }) });
  registry.add({
    method: 'post',
    path: '/agents/:id/transfer-book',
    tag: 'Agents',
    summary: 'Transfer all accounts & policies of this Agent to another Agent',
    parameters: [idParam],
    requestBody: { required: true, content: json({ type: 'object', required: ['toAgentId'], properties: { toAgentId: { type: 'integer' } } }, { toAgentId: 2 }) },
    responses: { 200: { description: 'Transfer summary', content: json({ type: 'object' }) }, 400: errorResponse('Bad request'), 404: errorResponse('Not found') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      col('agents').get(id);
      const { toAgentId } = req.body || {};
      if (!Number.isInteger(toAgentId)) throw badRequest('toAgentId (integer) is required');
      if (toAgentId === id) throw badRequest('toAgentId must differ from the source agent');
      col('agents').get(toAgentId);
      const accounts = col('accounts').filter({ agentId: id }).map((a) => col('accounts').patch(a.id, { agentId: toAgentId }));
      const policies = col('policies').filter({ agentId: id }).map((p) => col('policies').patch(p.id, { agentId: toAgentId }));
      res.json({ fromAgentId: id, toAgentId, accountsTransferred: accounts.length, policiesTransferred: policies.length });
    },
  });

  // ------------------------------------------------------------------ products
  registry.add({
    method: 'get',
    path: '/products/active',
    tag: 'Products',
    summary: 'List active products',
    responses: { 200: { description: 'Active products', content: listOf('Product') } },
    handler: (req, res) => {
      const data = col('products').filter({ active: true });
      res.json({ total: data.length, data });
    },
  });
  nested('products', 'policies', 'productId');
  nested('products', 'quotes', 'productId');
  transition({ resource: 'products', action: 'activate', summary: 'Activate a Product', apply: () => ({ active: true }) });
  transition({ resource: 'products', action: 'deactivate', summary: 'Deactivate a Product', apply: () => ({ active: false }) });

  // ------------------------------------------------------------------ billing plans
  registry.add({
    method: 'get',
    path: '/billing-plans/:id/schedule',
    tag: 'Billing Plans',
    summary: 'Compute an installment schedule for a premium amount',
    parameters: [idParam, { name: 'premium', in: 'query', required: true, schema: { type: 'number' } }, { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } }],
    responses: { 200: { description: 'Schedule', content: json({ type: 'object' }) }, 400: errorResponse('Bad request'), 404: errorResponse('Not found') },
    handler: (req, res) => {
      const plan = col('billing-plans').get(parseId(req.params.id));
      const premium = Number(req.query.premium);
      if (!Number.isFinite(premium) || premium <= 0) throw badRequest("Query parameter 'premium' must be a positive number");
      const start = req.query.startDate ? new Date(req.query.startDate) : new Date();
      if (Number.isNaN(start.getTime())) throw badRequest("Query parameter 'startDate' must be a valid date");
      const down = round2((premium * plan.downPaymentPercent) / 100);
      const remaining = premium - down;
      const perInstallment = plan.installments > 1 ? round2(remaining / (plan.installments - (down > 0 ? 1 : 0) || 1)) : round2(premium);
      const installments = [];
      for (let i = 0; i < plan.installments; i++) {
        const due = new Date(start);
        due.setMonth(due.getMonth() + Math.round((12 / plan.installments) * i));
        const isDown = i === 0 && down > 0;
        installments.push({ number: i + 1, dueDate: due.toISOString().slice(0, 10), amount: round2((isDown ? down : plan.installments === 1 ? premium : perInstallment) + (i === 0 ? 0 : plan.installmentFee)) });
      }
      res.json({ plan, premium, downPayment: down, installmentFee: plan.installmentFee, total: round2(installments.reduce((s, x) => s + x.amount, 0)), installments });
    },
  });

  // ------------------------------------------------------------------ users
  nested('users', 'activities', 'assignedToUserId', 'List activities assigned to a User');
  nested('users', 'claims', 'adjusterId', 'List claims assigned to a User (adjuster)');
  transition({ resource: 'users', action: 'activate', summary: 'Activate a User', apply: () => ({ active: true }) });
  transition({ resource: 'users', action: 'deactivate', summary: 'Deactivate a User', apply: () => ({ active: false }) });
  registry.add({
    method: 'post',
    path: '/users/:id/reset-password',
    tag: 'Users',
    summary: 'Reset a User password',
    parameters: [idParam],
    requestBody: { required: true, content: json({ type: 'object', required: ['newPassword'], properties: { newPassword: { type: 'string', minLength: 8 } } }, { newPassword: 'Password123!' }) },
    responses: { 200: { description: 'Password reset', content: json({ type: 'object', properties: { reset: { type: 'boolean' }, userId: { type: 'integer' } } }) }, 400: errorResponse('Bad request'), 404: errorResponse('Not found') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      col('users').get(id);
      const { newPassword } = req.body || {};
      if (typeof newPassword !== 'string' || newPassword.length < 8) throw badRequest('newPassword must be a string of at least 8 characters');
      col('users').patch(id, { password: newPassword });
      res.json({ reset: true, userId: id });
    },
  });

  // ------------------------------------------------------------------ contacts
  nested('contacts', 'addresses', 'contactId');
  nested('contacts', 'drivers', 'contactId');
  transition({ resource: 'contacts', action: 'make-primary', summary: 'Mark a Contact as the primary contact of its account', apply: (record) => {
    col('contacts').filter({ accountId: record.accountId, primary: true }).forEach((c) => col('contacts').patch(c.id, { primary: false }));
    return { primary: true };
  } });

  // ------------------------------------------------------------------ quotes
  nested('quotes', 'underwriting-issues', 'quoteId');
  registry.add({
    method: 'post',
    path: '/quotes/:id/rate',
    tag: 'Quotes',
    summary: 'Rate a Quote (calculates premium, Draft/Rated -> Rated)',
    parameters: [idParam],
    responses: okResponses('Quote'),
    handler: (req, res) => {
      const id = parseId(req.params.id);
      const quote = col('quotes').get(id);
      if (!['Draft', 'Rated'].includes(quote.status)) throw conflict(`Quote ${id} is '${quote.status}' and cannot be rated`);
      const product = col('products').get(quote.productId);
      const account = col('accounts').get(quote.accountId);
      const premium = round2(product.basePremium * (quote.term === 6 ? 0.55 : 1) * (account.type === 'Commercial' ? 1.6 : 1));
      res.json(col('quotes').patch(id, { status: 'Rated', premium }));
    },
  });
  registry.add({
    method: 'post',
    path: '/quotes/:id/bind',
    tag: 'Quotes',
    summary: 'Bind a rated Quote - creates a Policy',
    description: 'Requires status Rated and no open underwriting issues. Returns the quote plus the newly created policy.',
    parameters: [idParam],
    requestBody: { required: false, content: json({ type: 'object', properties: { billingPlanId: { type: 'integer' } } }, { billingPlanId: 4 }) },
    responses: { 200: { description: 'Quote bound', content: json({ type: 'object', properties: { quote: ref('Quote'), policy: ref('Policy') } }) }, 404: errorResponse('Not found'), 409: errorResponse('Invalid state') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      const quote = col('quotes').get(id);
      if (quote.status !== 'Rated') throw conflict(`Quote ${id} is '${quote.status}'; only Rated quotes can be bound`);
      const open = col('underwriting-issues').filter({ quoteId: id, status: 'Open' });
      if (open.length) throw conflict(`Quote ${id} has ${open.length} open underwriting issue(s)`);
      const billingPlanId = req.body?.billingPlanId ?? null;
      if (billingPlanId !== null) col('billing-plans').get(billingPlanId);
      const expiration = new Date(quote.effectiveDate);
      expiration.setMonth(expiration.getMonth() + quote.term);
      const policy = createRecord(store, 'policies', {
        accountId: quote.accountId, productId: quote.productId, agentId: quote.agentId, billingPlanId, status: 'Bound',
        effectiveDate: quote.effectiveDate, expirationDate: expiration.toISOString().slice(0, 10), term: quote.term, premium: quote.premium, cancellationReason: null,
      });
      const updated = col('quotes').patch(id, { status: 'Bound', policyId: policy.id });
      res.json({ quote: updated, policy });
    },
  });
  transition({ resource: 'quotes', action: 'decline', summary: 'Decline a Quote', from: ['Draft', 'Rated'], to: 'Declined' });
  transition({ resource: 'quotes', action: 'reopen', summary: 'Reopen a declined Quote', from: ['Declined'], to: 'Draft', apply: () => ({ premium: null }) });
  registry.add({
    method: 'post',
    path: '/quotes/:id/copy',
    tag: 'Quotes',
    summary: 'Clone a Quote into a new Draft quote',
    parameters: [idParam],
    responses: { 201: { description: 'New quote', content: json(ref('Quote')) }, 404: errorResponse('Not found') },
    handler: (req, res) => {
      const source = col('quotes').get(parseId(req.params.id));
      const copy = createRecord(store, 'quotes', { accountId: source.accountId, productId: source.productId, agentId: source.agentId, status: 'Draft', effectiveDate: source.effectiveDate, term: source.term, premium: null, policyId: null });
      res.status(201).json(copy);
    },
  });

  // ------------------------------------------------------------------ policies
  nested('policies', 'vehicles', 'policyId');
  nested('policies', 'drivers', 'policyId');
  nested('policies', 'coverages', 'policyId');
  nested('policies', 'discounts', 'policyId');
  nested('policies', 'endorsements', 'policyId');
  nested('policies', 'claims', 'policyId');
  nested('policies', 'invoices', 'policyId');
  nested('policies', 'underwriting-issues', 'policyId');
  registry.add({
    method: 'get',
    path: '/policies/:id/documents',
    tag: 'Policies',
    summary: 'List documents attached to a Policy',
    parameters: [idParam],
    responses: { 200: { description: 'Documents', content: listOf('Document') }, 404: errorResponse('Not found') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      col('policies').get(id);
      const data = col('documents').filter({ relatedType: 'Policy', relatedId: id });
      res.json({ policyId: id, total: data.length, data });
    },
  });
  registry.add({
    method: 'get',
    path: '/policies/:id/notes',
    tag: 'Policies',
    summary: 'List notes attached to a Policy',
    parameters: [idParam],
    responses: { 200: { description: 'Notes', content: listOf('Note') }, 404: errorResponse('Not found') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      col('policies').get(id);
      const data = col('notes').filter({ relatedType: 'Policy', relatedId: id });
      res.json({ policyId: id, total: data.length, data });
    },
  });
  registry.add({
    method: 'get',
    path: '/policies/:id/premium',
    tag: 'Policies',
    summary: 'Premium breakdown (coverages, discounts, total)',
    parameters: [idParam],
    responses: { 200: { description: 'Premium breakdown', content: json({ type: 'object' }) }, 404: errorResponse('Not found') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      const policy = col('policies').get(id);
      const coverages = col('coverages').filter({ policyId: id });
      const discounts = col('discounts').filter({ policyId: id });
      const coveragePremium = round2(coverages.reduce((s, c) => s + (c.premium || 0), 0));
      const discountPercent = discounts.reduce((s, d) => s + d.percentage, 0);
      const discountAmount = round2((coveragePremium * discountPercent) / 100);
      res.json({ policyId: id, policyNumber: policy.policyNumber, writtenPremium: policy.premium, coverages: coverages.map((c) => ({ code: c.code, name: c.name, premium: c.premium })), coveragePremium, discounts: discounts.map((d) => ({ code: d.code, percentage: d.percentage })), discountPercent, discountAmount, calculatedPremium: round2(coveragePremium - discountAmount) });
    },
  });
  registry.add({
    method: 'get',
    path: '/policies/:id/summary',
    tag: 'Policies',
    summary: 'Policy summary with related counts',
    parameters: [idParam],
    responses: { 200: { description: 'Summary', content: json({ type: 'object' }) }, 404: errorResponse('Not found') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      const policy = col('policies').get(id);
      const counts = Object.fromEntries(['vehicles', 'drivers', 'coverages', 'discounts', 'endorsements', 'claims', 'invoices'].map((c) => [c, col(c).count({ policyId: id })]));
      res.json({ policy, account: col('accounts').items.get(policy.accountId) ?? null, product: col('products').items.get(policy.productId) ?? null, agent: present('agents', col('agents').items.get(policy.agentId)) ?? null, counts });
    },
  });
  transition({ resource: 'policies', action: 'issue', summary: 'Issue a bound Policy (Bound -> InForce)', from: ['Bound', 'Quoted'], to: 'InForce' });
  transition({
    resource: 'policies', action: 'cancel', summary: 'Cancel a Policy', from: ['Bound', 'InForce'], to: 'Cancelled',
    body: { schema: { type: 'object', properties: { reason: { type: 'string' } } }, example: { reason: 'Insured request' } },
    apply: (record, body) => ({ cancellationReason: body.reason || 'Insured request' }),
  });
  transition({ resource: 'policies', action: 'reinstate', summary: 'Reinstate a cancelled Policy', from: ['Cancelled'], to: 'InForce', apply: () => ({ cancellationReason: null }) });
  transition({ resource: 'policies', action: 'expire', summary: 'Expire a Policy at end of term', from: ['InForce'], to: 'Expired' });
  registry.add({
    method: 'post',
    path: '/policies/:id/renew',
    tag: 'Policies',
    summary: 'Renew a Policy - creates a new term policy',
    description: 'Allowed for InForce or Expired policies. Copies coverages, discounts, vehicles and drivers onto the renewal.',
    parameters: [idParam],
    requestBody: { required: false, content: json({ type: 'object', properties: { premiumAdjustmentPercent: { type: 'number' } } }, { premiumAdjustmentPercent: 3.5 }) },
    responses: { 201: { description: 'Renewal created', content: json({ type: 'object', properties: { renewedFrom: ref('Policy'), renewal: ref('Policy') } }) }, 404: errorResponse('Not found'), 409: errorResponse('Invalid state') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      const policy = col('policies').get(id);
      if (!['InForce', 'Expired'].includes(policy.status)) throw conflict(`Policy ${id} is '${policy.status}' and cannot be renewed`);
      const adj = Number(req.body?.premiumAdjustmentPercent ?? 0);
      if (!Number.isFinite(adj)) throw badRequest('premiumAdjustmentPercent must be a number');
      const start = new Date(policy.expirationDate);
      const end = new Date(start);
      end.setMonth(end.getMonth() + policy.term);
      const renewal = createRecord(store, 'policies', {
        accountId: policy.accountId, productId: policy.productId, agentId: policy.agentId, billingPlanId: policy.billingPlanId, status: 'Bound',
        effectiveDate: start.toISOString().slice(0, 10), expirationDate: end.toISOString().slice(0, 10), term: policy.term,
        premium: round2(policy.premium * (1 + adj / 100)), cancellationReason: null,
      });
      for (const child of ['coverages', 'discounts', 'vehicles', 'drivers']) {
        for (const item of col(child).filter({ policyId: id })) {
          const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = item;
          createRecord(store, child, { ...rest, policyId: renewal.id });
        }
      }
      res.status(201).json({ renewedFrom: policy, renewal });
    },
  });

  // ------------------------------------------------------------------ vehicles / drivers
  registry.add({
    method: 'get',
    path: '/vehicles/by-vin/:vin',
    tag: 'Vehicles',
    summary: 'Find a Vehicle by VIN',
    parameters: [{ name: 'vin', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Vehicle', content: json(ref('Vehicle')) }, 404: errorResponse('Not found') },
    handler: (req, res) => {
      const vehicle = col('vehicles').all().find((v) => v.vin.toLowerCase() === String(req.params.vin).toLowerCase());
      if (!vehicle) throw notFound('vehicle with vin', req.params.vin);
      res.json(vehicle);
    },
  });
  registry.add({
    method: 'post',
    path: '/vehicles/:id/transfer',
    tag: 'Vehicles',
    summary: 'Move a Vehicle to another Policy',
    parameters: [idParam],
    requestBody: { required: true, content: json({ type: 'object', required: ['policyId'], properties: { policyId: { type: 'integer' } } }, { policyId: 2 }) },
    responses: okResponses('Vehicle'),
    handler: (req, res) => {
      const id = parseId(req.params.id);
      col('vehicles').get(id);
      const { policyId } = req.body || {};
      if (!Number.isInteger(policyId)) throw badRequest('policyId (integer) is required');
      col('policies').get(policyId);
      res.json(col('vehicles').patch(id, { policyId }));
    },
  });
  transition({ resource: 'drivers', action: 'exclude', summary: 'Exclude a Driver from coverage', apply: () => ({ excluded: true }) });
  transition({ resource: 'drivers', action: 'include', summary: 'Re-include an excluded Driver', apply: () => ({ excluded: false }) });

  // ------------------------------------------------------------------ endorsements
  registry.add({
    method: 'post',
    path: '/endorsements/:id/apply',
    tag: 'Endorsements',
    summary: 'Apply a pending Endorsement (adjusts policy premium)',
    parameters: [idParam],
    responses: okResponses('Endorsement'),
    handler: (req, res) => {
      const id = parseId(req.params.id);
      const e = col('endorsements').get(id);
      if (e.status !== 'Pending') throw conflict(`Endorsement ${id} is '${e.status}'; only Pending endorsements can be applied`);
      const policy = col('policies').get(e.policyId);
      col('policies').patch(policy.id, { premium: round2(policy.premium + (e.premiumChange || 0)) });
      res.json(col('endorsements').patch(id, { status: 'Applied' }));
    },
  });
  transition({ resource: 'endorsements', action: 'withdraw', summary: 'Withdraw a pending Endorsement', from: ['Pending'], to: 'Withdrawn' });

  // ------------------------------------------------------------------ claims
  registry.add({
    method: 'get',
    path: '/claims/open',
    tag: 'Claims',
    summary: 'List open / under review claims',
    responses: { 200: { description: 'Open claims', content: listOf('Claim') } },
    handler: (req, res) => {
      const data = col('claims').all().filter((c) => ['Open', 'UnderReview'].includes(c.status));
      res.json({ total: data.length, data });
    },
  });
  registry.add({
    method: 'get',
    path: '/claims/:id/notes',
    tag: 'Claims',
    summary: 'List notes on a Claim',
    parameters: [idParam],
    responses: { 200: { description: 'Notes', content: listOf('Note') }, 404: errorResponse('Not found') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      col('claims').get(id);
      const data = col('notes').filter({ relatedType: 'Claim', relatedId: id });
      res.json({ claimId: id, total: data.length, data });
    },
  });
  registry.add({
    method: 'post',
    path: '/claims/:id/notes',
    tag: 'Claims',
    summary: 'Add a note to a Claim',
    parameters: [idParam],
    requestBody: { required: true, content: json({ type: 'object', required: ['subject', 'body'], properties: { subject: { type: 'string' }, body: { type: 'string' }, author: { type: 'string' } } }, { subject: 'Adjuster visit', body: 'Inspected vehicle, estimate pending.', author: 'admin' }) },
    responses: { 201: { description: 'Note created', content: json(ref('Note')) }, 404: errorResponse('Not found'), 422: errorResponse('Validation error') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      col('claims').get(id);
      const data = validateBody(resourceByName.notes, { ...req.body, relatedType: 'Claim', relatedId: id }, 'create', store);
      res.status(201).json(createRecord(store, 'notes', data));
    },
  });
  registry.add({
    method: 'get',
    path: '/claims/:id/documents',
    tag: 'Claims',
    summary: 'List documents on a Claim',
    parameters: [idParam],
    responses: { 200: { description: 'Documents', content: listOf('Document') }, 404: errorResponse('Not found') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      col('claims').get(id);
      const data = col('documents').filter({ relatedType: 'Claim', relatedId: id });
      res.json({ claimId: id, total: data.length, data });
    },
  });
  nested('claims', 'payments', 'claimId');
  registry.add({
    method: 'post',
    path: '/claims/:id/payments',
    tag: 'Claims',
    summary: 'Issue a claim payment (increments paidAmount)',
    parameters: [idParam],
    requestBody: { required: true, content: json({ type: 'object', required: ['amount', 'method'], properties: { amount: { type: 'number' }, method: { type: 'string', enum: ['Card', 'ACH', 'Check', 'Cash', 'Wire'] }, reference: { type: 'string' } } }, { amount: 1250, method: 'ACH', reference: 'CLMPAY-1001' }) },
    responses: { 201: { description: 'Payment created', content: json({ type: 'object', properties: { payment: ref('Payment'), claim: ref('Claim') } }) }, 404: errorResponse('Not found'), 409: errorResponse('Invalid state'), 422: errorResponse('Validation error') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      const claim = col('claims').get(id);
      if (!['Approved', 'UnderReview', 'Open'].includes(claim.status)) throw conflict(`Claim ${id} is '${claim.status}'; payments not allowed`);
      const policy = col('policies').get(claim.policyId);
      const data = validateBody(resourceByName.payments, { accountId: policy.accountId, claimId: id, invoiceId: null, amount: req.body?.amount, method: req.body?.method, reference: req.body?.reference, status: 'Completed', paidDate: today() }, 'create', store);
      const payment = createRecord(store, 'payments', data);
      const updated = col('claims').patch(id, { paidAmount: round2((claim.paidAmount || 0) + payment.amount) });
      res.status(201).json({ payment, claim: updated });
    },
  });
  registry.add({
    method: 'post',
    path: '/claims/:id/assign',
    tag: 'Claims',
    summary: 'Assign an adjuster to a Claim',
    parameters: [idParam],
    requestBody: { required: true, content: json({ type: 'object', required: ['adjusterId'], properties: { adjusterId: { type: 'integer' } } }, { adjusterId: 7 }) },
    responses: okResponses('Claim'),
    handler: (req, res) => {
      const id = parseId(req.params.id);
      col('claims').get(id);
      const { adjusterId } = req.body || {};
      if (!Number.isInteger(adjusterId)) throw badRequest('adjusterId (integer) is required');
      col('users').get(adjusterId);
      res.json(col('claims').patch(id, { adjusterId, status: 'UnderReview' }));
    },
  });
  transition({ resource: 'claims', action: 'review', summary: 'Move a Claim to UnderReview', from: ['Open'], to: 'UnderReview' });
  transition({ resource: 'claims', action: 'approve', summary: 'Approve a Claim', from: ['Open', 'UnderReview'], to: 'Approved', body: { schema: { type: 'object', properties: { reserveAmount: { type: 'number' } } }, example: { reserveAmount: 4200 } }, apply: (record, body) => (typeof body.reserveAmount === 'number' ? { reserveAmount: body.reserveAmount, denialReason: null } : { denialReason: null }) });
  transition({ resource: 'claims', action: 'deny', summary: 'Deny a Claim', from: ['Open', 'UnderReview'], to: 'Denied', body: { schema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } }, example: { reason: 'Loss not covered under policy terms' } }, apply: (record, body) => {
    if (!body.reason) throw badRequest('reason is required to deny a claim');
    return { denialReason: body.reason };
  } });
  transition({ resource: 'claims', action: 'close', summary: 'Close a Claim', from: ['Approved', 'Denied'], to: 'Closed' });
  transition({ resource: 'claims', action: 'reopen', summary: 'Reopen a closed or denied Claim', from: ['Closed', 'Denied'], to: 'Open', apply: () => ({ denialReason: null }) });

  // ------------------------------------------------------------------ invoices / payments
  registry.add({
    method: 'get',
    path: '/invoices/overdue',
    tag: 'Invoices',
    summary: 'List overdue invoices',
    responses: { 200: { description: 'Overdue invoices', content: listOf('Invoice') } },
    handler: (req, res) => {
      const data = col('invoices').filter({ status: 'Overdue' });
      res.json({ total: data.length, totalAmount: round2(data.reduce((s, i) => s + i.amount, 0)), data });
    },
  });
  nested('invoices', 'payments', 'invoiceId');
  registry.add({
    method: 'post',
    path: '/invoices/:id/pay',
    tag: 'Invoices',
    summary: 'Pay an Invoice (creates a Payment, marks invoice Paid)',
    parameters: [idParam],
    requestBody: { required: true, content: json({ type: 'object', required: ['method'], properties: { method: { type: 'string', enum: ['Card', 'ACH', 'Check', 'Cash', 'Wire'] }, reference: { type: 'string' } } }, { method: 'Card', reference: 'PAY-2001' }) },
    responses: { 200: { description: 'Invoice paid', content: json({ type: 'object', properties: { invoice: ref('Invoice'), payment: ref('Payment') } }) }, 404: errorResponse('Not found'), 409: errorResponse('Invalid state'), 422: errorResponse('Validation error') },
    handler: (req, res) => {
      const id = parseId(req.params.id);
      const invoice = col('invoices').get(id);
      if (!['Due', 'Overdue'].includes(invoice.status)) throw conflict(`Invoice ${id} is '${invoice.status}' and cannot be paid`);
      const data = validateBody(resourceByName.payments, { accountId: invoice.accountId, invoiceId: id, claimId: null, amount: invoice.amount, method: req.body?.method, reference: req.body?.reference, status: 'Completed', paidDate: today() }, 'create', store);
      const payment = createRecord(store, 'payments', data);
      const updated = col('invoices').patch(id, { status: 'Paid', paidDate: today() });
      res.json({ invoice: updated, payment });
    },
  });
  transition({ resource: 'invoices', action: 'void', summary: 'Void an Invoice', from: ['Due', 'Overdue'], to: 'Void' });
  transition({ resource: 'invoices', action: 'mark-overdue', summary: 'Mark a due Invoice as Overdue', from: ['Due'], to: 'Overdue' });
  registry.add({
    method: 'post',
    path: '/payments/:id/refund',
    tag: 'Payments',
    summary: 'Refund a completed Payment (re-opens the invoice if any)',
    parameters: [idParam],
    responses: okResponses('Payment'),
    handler: (req, res) => {
      const id = parseId(req.params.id);
      const payment = col('payments').get(id);
      if (payment.status !== 'Completed') throw conflict(`Payment ${id} is '${payment.status}' and cannot be refunded`);
      if (payment.invoiceId && col('invoices').has(payment.invoiceId)) col('invoices').patch(payment.invoiceId, { status: 'Due', paidDate: null });
      res.json(col('payments').patch(id, { status: 'Refunded' }));
    },
  });
  transition({ resource: 'payments', action: 'complete', summary: 'Complete a pending Payment', from: ['Pending'], to: 'Completed' });
  transition({ resource: 'payments', action: 'fail', summary: 'Mark a pending Payment as Failed', from: ['Pending'], to: 'Failed' });

  // ------------------------------------------------------------------ documents / notes / activities / uw issues
  transition({ resource: 'documents', action: 'archive', summary: 'Archive a Document', apply: () => ({ archived: true }) });
  transition({ resource: 'documents', action: 'restore', summary: 'Restore an archived Document', apply: () => ({ archived: false }) });
  registry.add({
    method: 'get',
    path: '/documents/archived',
    tag: 'Documents',
    summary: 'List archived documents',
    responses: { 200: { description: 'Archived documents', content: listOf('Document') } },
    handler: (req, res) => {
      const data = col('documents').filter({ archived: true });
      res.json({ total: data.length, data });
    },
  });
  registry.add({
    method: 'get',
    path: '/notes/by-related/:relatedType/:relatedId',
    tag: 'Notes',
    summary: 'List notes for any related record',
    parameters: [{ name: 'relatedType', in: 'path', required: true, schema: { type: 'string', enum: ['Account', 'Policy', 'Claim', 'Quote'] } }, { name: 'relatedId', in: 'path', required: true, schema: { type: 'integer' } }],
    responses: { 200: { description: 'Notes', content: listOf('Note') }, 400: errorResponse('Bad request') },
    handler: (req, res) => {
      const { relatedType } = req.params;
      if (!['Account', 'Policy', 'Claim', 'Quote'].includes(relatedType)) throw badRequest('relatedType must be one of Account, Policy, Claim, Quote');
      const relatedId = parseId(req.params.relatedId);
      const data = col('notes').filter({ relatedType, relatedId });
      res.json({ relatedType, relatedId, total: data.length, data });
    },
  });
  registry.add({
    method: 'get',
    path: '/activities/overdue',
    tag: 'Activities',
    summary: 'List open activities whose due date has passed',
    responses: { 200: { description: 'Overdue activities', content: listOf('Activity') } },
    handler: (req, res) => {
      const t = today();
      const data = col('activities').all().filter((a) => a.status === 'Open' && a.dueDate && a.dueDate < t);
      res.json({ asOf: t, total: data.length, data });
    },
  });
  transition({ resource: 'activities', action: 'complete', summary: 'Complete an Activity', from: ['Open'], to: 'Complete' });
  transition({ resource: 'activities', action: 'cancel', summary: 'Cancel an Activity', from: ['Open'], to: 'Cancelled' });
  transition({ resource: 'activities', action: 'reopen', summary: 'Reopen an Activity', from: ['Complete', 'Cancelled'], to: 'Open' });
  registry.add({
    method: 'post',
    path: '/activities/:id/reassign',
    tag: 'Activities',
    summary: 'Reassign an Activity to another User',
    parameters: [idParam],
    requestBody: { required: true, content: json({ type: 'object', required: ['assignedToUserId'], properties: { assignedToUserId: { type: 'integer' } } }, { assignedToUserId: 2 }) },
    responses: okResponses('Activity'),
    handler: (req, res) => {
      const id = parseId(req.params.id);
      col('activities').get(id);
      const { assignedToUserId } = req.body || {};
      if (!Number.isInteger(assignedToUserId)) throw badRequest('assignedToUserId (integer) is required');
      col('users').get(assignedToUserId);
      res.json(col('activities').patch(id, { assignedToUserId }));
    },
  });
  registry.add({
    method: 'get',
    path: '/underwriting-issues/open',
    tag: 'Underwriting Issues',
    summary: 'List open underwriting issues',
    responses: { 200: { description: 'Open issues', content: listOf('UnderwritingIssue') } },
    handler: (req, res) => {
      const data = col('underwriting-issues').filter({ status: 'Open' });
      res.json({ total: data.length, data });
    },
  });
  transition({ resource: 'underwriting-issues', action: 'approve', summary: 'Approve an Underwriting Issue', from: ['Open'], to: 'Approved', body: { schema: { type: 'object', properties: { note: { type: 'string' } } }, example: { note: 'Approved by senior underwriter' } }, apply: (record, body) => ({ decisionNote: body.note || 'Approved' }) });
  transition({ resource: 'underwriting-issues', action: 'reject', summary: 'Reject an Underwriting Issue', from: ['Open'], to: 'Rejected', body: { schema: { type: 'object', properties: { note: { type: 'string' } } }, example: { note: 'Risk outside appetite' } }, apply: (record, body) => ({ decisionNote: body.note || 'Rejected' }) });
  transition({ resource: 'underwriting-issues', action: 'reopen', summary: 'Reopen an Underwriting Issue', from: ['Approved', 'Rejected'], to: 'Open', apply: () => ({ decisionNote: null }) });

  // ------------------------------------------------------------------ reports
  registry.add({
    method: 'get',
    path: '/reports/premium-by-product',
    tag: 'Reports',
    summary: 'Total written premium grouped by product',
    responses: { 200: { description: 'Report', content: json({ type: 'object' }) } },
    handler: (req, res) => {
      const rows = col('products').all().map((p) => {
        const policies = col('policies').filter({ productId: p.id });
        return { productId: p.id, code: p.code, name: p.name, policies: policies.length, premium: round2(policies.reduce((s, x) => s + (x.premium || 0), 0)) };
      });
      res.json({ generatedAt: new Date().toISOString(), rows, total: round2(rows.reduce((s, r) => s + r.premium, 0)) });
    },
  });
  registry.add({
    method: 'get',
    path: '/reports/claims-by-status',
    tag: 'Reports',
    summary: 'Claim counts and amounts grouped by status',
    responses: { 200: { description: 'Report', content: json({ type: 'object' }) } },
    handler: (req, res) => {
      const rows = {};
      for (const c of col('claims').all()) {
        rows[c.status] = rows[c.status] || { status: c.status, count: 0, reserveAmount: 0, paidAmount: 0 };
        rows[c.status].count += 1;
        rows[c.status].reserveAmount = round2(rows[c.status].reserveAmount + (c.reserveAmount || 0));
        rows[c.status].paidAmount = round2(rows[c.status].paidAmount + (c.paidAmount || 0));
      }
      res.json({ generatedAt: new Date().toISOString(), rows: Object.values(rows) });
    },
  });
  registry.add({
    method: 'get',
    path: '/reports/agent-production',
    tag: 'Reports',
    summary: 'Policies and premium per agent',
    parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }, { name: 'pageSize', in: 'query', schema: { type: 'integer' } }],
    responses: { 200: { description: 'Report', content: pageSchema({ type: 'object' }) } },
    handler: (req, res) => {
      const rows = col('agents').all().map((a) => {
        const policies = col('policies').filter({ agentId: a.id });
        return { agentId: a.id, agent: `${a.firstName} ${a.lastName}`, agencyId: a.agencyId, accounts: col('accounts').count({ agentId: a.id }), policies: policies.length, premium: round2(policies.reduce((s, p) => s + (p.premium || 0), 0)) };
      });
      res.json(paginate(rows, { ...req.query, sortBy: req.query.sortBy || 'premium', sortOrder: req.query.sortOrder || 'desc' }));
    },
  });
  registry.add({
    method: 'get',
    path: '/reports/billing-aging',
    tag: 'Reports',
    summary: 'Outstanding invoice balance bucketed by age',
    responses: { 200: { description: 'Report', content: json({ type: 'object' }) } },
    handler: (req, res) => {
      const buckets = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
      const now = Date.now();
      for (const inv of col('invoices').all().filter((i) => ['Due', 'Overdue'].includes(i.status))) {
        const days = Math.floor((now - Date.parse(inv.dueDate)) / 86400000);
        const key = days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
        buckets[key] = round2(buckets[key] + inv.amount);
      }
      res.json({ generatedAt: new Date().toISOString(), buckets, total: round2(Object.values(buckets).reduce((s, v) => s + v, 0)) });
    },
  });
}
