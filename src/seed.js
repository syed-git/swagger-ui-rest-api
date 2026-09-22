import { createRecord } from './model.js';

// mulberry32 - tiny deterministic PRNG so every reset produces identical data.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['John', 'Maria', 'Wei', 'Aisha', 'Carlos', 'Priya', 'Liam', 'Fatima', 'Noah', 'Sofia', 'Ethan', 'Chloe', 'Omar', 'Emma', 'Raj', 'Grace', 'Diego', 'Hannah', 'Kenji', 'Zara'];
const LAST = ['Smith', 'Lopez', 'Chen', 'Khan', 'Garcia', 'Patel', 'Murphy', 'Ali', 'Brown', 'Rossi', 'Nguyen', 'Dubois', 'Hassan', 'Wilson', 'Sharma', 'Kim', 'Martinez', 'Schmidt', 'Tanaka', 'Ahmed'];
const CITIES = [
  ['Boston', 'MA', '02108'], ['Austin', 'TX', '73301'], ['Denver', 'CO', '80202'], ['Seattle', 'WA', '98101'],
  ['Chicago', 'IL', '60601'], ['Miami', 'FL', '33101'], ['Phoenix', 'AZ', '85001'], ['Atlanta', 'GA', '30301'],
  ['Portland', 'OR', '97201'], ['Nashville', 'TN', '37201'],
];
const STREETS = ['Main St', 'Oak Ave', 'Maple Dr', 'Cedar Ln', 'Lake Rd', 'Hill St', 'Park Blvd', 'River Way'];
const MAKES = {
  Honda: ['Accord', 'Civic', 'CR-V'], Toyota: ['Camry', 'RAV4', 'Corolla'], Ford: ['F-150', 'Escape', 'Explorer'],
  Tesla: ['Model 3', 'Model Y'], BMW: ['330i', 'X5'], Subaru: ['Outback', 'Forester'], Hyundai: ['Elantra', 'Tucson'],
};
const COVERAGES = [
  ['BI', 'Bodily Injury Liability', '100000/300000'], ['PD', 'Property Damage Liability', '100000'],
  ['COLL', 'Collision', null], ['COMP', 'Comprehensive', null], ['UM', 'Uninsured Motorist', '100000/300000'],
  ['MED', 'Medical Payments', '5000'], ['RENTAL', 'Rental Reimbursement', '30/900'], ['TOWING', 'Towing & Labor', '100'],
];
const DISCOUNTS = [
  ['MULTI_CAR', 'Multi-Car Discount', 10], ['GOOD_DRIVER', 'Good Driver Discount', 15], ['GOOD_STUDENT', 'Good Student Discount', 8],
  ['PAPERLESS', 'Paperless Discount', 3], ['LOYALTY', 'Loyalty Discount', 5], ['ANTI_THEFT', 'Anti-Theft Device Discount', 4],
];
const LOSS = ['Collision', 'Comprehensive', 'Liability', 'Theft', 'Glass', 'Weather'];
const LOSS_DESC = {
  Collision: 'Rear-ended at a stop light', Comprehensive: 'Tree branch fell on hood', Liability: 'Backed into parked car',
  Theft: 'Vehicle stolen from driveway', Glass: 'Windshield cracked by road debris', Weather: 'Hail damage to roof and hood',
};

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const between = (r, min, max) => Math.floor(r() * (max - min + 1)) + min;
const money = (r, min, max) => Math.round((r() * (max - min) + min) * 100) / 100;
const isoDate = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const randomDate = (r, fromYear, toYear) => isoDate(between(r, fromYear, toYear), between(r, 1, 12), between(r, 1, 28));
const addYear = (date, years) => `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;
const vin = (r) => {
  const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 17; i++) out += chars[Math.floor(r() * chars.length)];
  return out;
};

export function seed(store) {
  store.clear();
  const r = rng(20250901);
  const add = (name, data) => createRecord(store, name, data);

  const agencies = [
    ['Graystone Insurance Partners', 'GIP-001', 'Northeast'], ['Lone Star Coverage', 'LSC-002', 'Southwest'],
    ['Pacific Shield Agency', 'PSA-003', 'West'], ['Heartland Mutual Brokers', 'HMB-004', 'Midwest'],
    ['Sunbelt Insurance Group', 'SIG-005', 'Southeast'],
  ].map(([name, code, region], i) =>
    add('agencies', { name, code, region, phone: `212-555-01${String(i).padStart(2, '0')}`, email: `office@${code.toLowerCase()}.example.com`, active: true }),
  );

  const agents = [];
  for (let i = 0; i < 10; i++) {
    const firstName = FIRST[i];
    const lastName = LAST[(i * 3) % LAST.length];
    agents.push(add('agents', {
      firstName, lastName, email: `${firstName}.${lastName}@agency.example.com`.toLowerCase(),
      phone: `312-555-0${between(r, 100, 199)}`, licenseNumber: `LIC-${80000 + i * 137}`,
      agencyId: agencies[i % agencies.length].id, active: i !== 9,
    }));
  }

  const products = [
    ['PA', 'Personal Auto', 'PersonalAuto', 650], ['HO', 'Homeowners', 'Homeowners', 1100], ['CA', 'Commercial Auto', 'CommercialAuto', 1800],
    ['UMB', 'Personal Umbrella', 'Umbrella', 300], ['RENT', 'Renters', 'Renters', 180], ['MC', 'Motorcycle', 'Motorcycle', 420],
  ].map(([code, name, lineOfBusiness, basePremium]) => add('products', { code, name, lineOfBusiness, basePremium, active: code !== 'MC' }));

  const billingPlans = [
    ['Annual', 'ANNUAL', 1, 100, 0], ['Semi-Annual', 'SEMI', 2, 50, 3], ['Quarterly', 'QUARTERLY', 4, 25, 4], ['Monthly', 'MONTHLY', 12, 10, 5],
  ].map(([name, code, installments, downPaymentPercent, installmentFee]) =>
    add('billing-plans', { name, code, installments, downPaymentPercent, installmentFee }),
  );

  const roles = ['Admin', 'Underwriter', 'Underwriter', 'CSR', 'CSR', 'Agent', 'Adjuster', 'Adjuster', 'CSR', 'Underwriter'];
  const users = roles.map((role, i) => {
    const firstName = FIRST[(i + 5) % FIRST.length];
    const lastName = LAST[(i + 7) % LAST.length];
    const username = i === 0 ? 'admin' : `${firstName[0]}${lastName}`.toLowerCase();
    return add('users', {
      username, email: `${username}@policyhub.example.com`, fullName: `${firstName} ${lastName}`, role,
      password: 'Password123!', active: i !== 8, lastLoginAt: null,
    });
  });

  const accounts = [];
  for (let i = 0; i < 25; i++) {
    const commercial = i % 5 === 4;
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7) % LAST.length];
    accounts.push(add('accounts', {
      name: commercial ? `${last} Logistics LLC` : `${first} ${last}`,
      type: commercial ? 'Commercial' : 'Personal',
      status: i === 23 ? 'Closed' : i === 24 ? 'Pending' : 'Active',
      email: `${first}.${last}${i}@example.com`.toLowerCase(),
      phone: `617-555-0${between(r, 100, 199)}`,
      agentId: agents[i % agents.length].id,
      createdDate: randomDate(r, 2019, 2024),
    }));
  }

  const contacts = [];
  accounts.forEach((account, i) => {
    const [first, last] = account.type === 'Commercial' ? [FIRST[(i + 3) % FIRST.length], account.name.split(' ')[0]] : account.name.split(' ');
    contacts.push(add('contacts', {
      firstName: first, lastName: last, email: account.email, phone: account.phone,
      dateOfBirth: randomDate(r, 1955, 2000), accountId: account.id, role: 'PolicyHolder', primary: true,
    }));
    if (i % 2 === 0) {
      contacts.push(add('contacts', {
        firstName: FIRST[(i + 11) % FIRST.length], lastName: last, email: null, phone: null,
        dateOfBirth: randomDate(r, 1960, 2006), accountId: account.id, role: i % 4 === 0 ? 'Spouse' : 'Driver', primary: false,
      }));
    }
  });

  const addresses = [];
  accounts.forEach((account, i) => {
    const [city, state, postalCode] = CITIES[i % CITIES.length];
    addresses.push(add('addresses', {
      line1: `${between(r, 10, 999)} ${pick(r, STREETS)}`, line2: i % 3 === 0 ? `Apt ${between(r, 1, 40)}` : null,
      city, state, postalCode, country: 'US', type: account.type === 'Commercial' ? 'Business' : 'Home',
      contactId: contacts.find((c) => c.accountId === account.id).id, accountId: account.id,
    }));
  });
  for (let i = 0; i < 5; i++) {
    const [city, state, postalCode] = CITIES[(i + 4) % CITIES.length];
    addresses.push(add('addresses', {
      line1: `${between(r, 10, 999)} ${pick(r, STREETS)}`, line2: null, city, state, postalCode, country: 'US', type: 'Garaging',
      contactId: null, accountId: accounts[i].id,
    }));
  }

  const policies = [];
  for (let i = 0; i < 30; i++) {
    const account = accounts[i % accounts.length];
    const product = account.type === 'Commercial' ? products[2] : products[i % 2 === 0 ? 0 : 1];
    const effectiveDate = randomDate(r, 2023, 2025);
    const term = i % 4 === 0 ? 6 : 12;
    const statuses = ['InForce', 'InForce', 'InForce', 'Bound', 'Cancelled', 'Expired'];
    policies.push(add('policies', {
      accountId: account.id, productId: product.id, agentId: account.agentId, billingPlanId: billingPlans[i % billingPlans.length].id,
      status: statuses[i % statuses.length], effectiveDate,
      expirationDate: term === 12 ? addYear(effectiveDate, 1) : isoDate(Number(effectiveDate.slice(0, 4)), ((Number(effectiveDate.slice(5, 7)) + 5) % 12) + 1, Number(effectiveDate.slice(8, 10))),
      term, premium: money(r, 600, 3200), cancellationReason: statuses[i % statuses.length] === 'Cancelled' ? 'Non-payment' : null,
    }));
  }

  const quotes = [];
  for (let i = 0; i < 15; i++) {
    const account = accounts[(i * 3) % accounts.length];
    const status = ['Draft', 'Rated', 'Bound', 'Declined', 'Rated'][i % 5];
    quotes.push(add('quotes', {
      accountId: account.id, productId: products[i % 4].id, agentId: account.agentId, status,
      effectiveDate: randomDate(r, 2025, 2026), term: 12,
      premium: status === 'Draft' ? null : money(r, 500, 2500),
      policyId: status === 'Bound' ? policies[i % policies.length].id : null,
    }));
  }

  const autoPolicies = policies.filter((p) => [products[0].id, products[2].id].includes(p.productId));
  const vehicles = [];
  autoPolicies.forEach((policy, i) => {
    const count = i % 3 === 0 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const make = pick(r, Object.keys(MAKES));
      vehicles.push(add('vehicles', {
        policyId: policy.id, vin: vin(r), make, model: pick(r, MAKES[make]), year: between(r, 2012, 2025),
        usage: pick(r, ['Commute', 'Pleasure', 'Business']), annualMileage: between(r, 5, 25) * 1000,
        garagingAddressId: addresses.find((a) => a.accountId === policy.accountId)?.id ?? null,
      }));
    }
  });

  const drivers = [];
  autoPolicies.forEach((policy, i) => {
    const accountContacts = contacts.filter((c) => c.accountId === policy.accountId);
    accountContacts.forEach((c, k) => {
      const [, , state] = CITIES[i % CITIES.length];
      drivers.push(add('drivers', {
        policyId: policy.id, contactId: c.id, firstName: c.firstName, lastName: c.lastName,
        licenseNumber: `${state}${between(r, 10000000, 99999999)}`, licenseState: state, dateOfBirth: c.dateOfBirth,
        relationship: k === 0 ? 'Insured' : c.role === 'Spouse' ? 'Spouse' : 'Child', excluded: false,
      }));
    });
  });

  const coverages = [];
  policies.forEach((policy, i) => {
    const count = 2 + (i % 3);
    for (let k = 0; k < count; k++) {
      const [code, name, limit] = COVERAGES[(i + k) % COVERAGES.length];
      coverages.push(add('coverages', {
        policyId: policy.id, code, name, limit, deductible: ['COLL', 'COMP'].includes(code) ? pick(r, [250, 500, 1000]) : 0, premium: money(r, 40, 600),
      }));
    }
  });

  const discounts = [];
  policies.forEach((policy, i) => {
    if (i % 2 === 0) {
      const [code, name, percentage] = DISCOUNTS[i % DISCOUNTS.length];
      discounts.push(add('discounts', { policyId: policy.id, code, name, percentage }));
    }
  });

  const endorsements = [];
  for (let i = 0; i < 12; i++) {
    const type = ['AddVehicle', 'RemoveVehicle', 'AddDriver', 'ChangeAddress', 'CoverageChange', 'RemoveDriver'][i % 6];
    endorsements.push(add('endorsements', {
      policyId: policies[(i * 2) % policies.length].id, type, effectiveDate: randomDate(r, 2024, 2025),
      description: `${type} endorsement`, premiumChange: type.startsWith('Remove') ? -money(r, 20, 200) : money(r, 20, 300),
      status: i % 3 === 0 ? 'Pending' : 'Applied',
    }));
  }

  const adjusters = users.filter((u) => u.role === 'Adjuster');
  const claims = [];
  for (let i = 0; i < 20; i++) {
    const lossType = LOSS[i % LOSS.length];
    const status = ['Open', 'UnderReview', 'Approved', 'Denied', 'Closed'][i % 5];
    const reserve = money(r, 500, 15000);
    claims.push(add('claims', {
      policyId: policies[(i * 3) % policies.length].id, lossDate: randomDate(r, 2024, 2025), lossType, description: LOSS_DESC[lossType],
      status, reserveAmount: reserve, paidAmount: ['Approved', 'Closed'].includes(status) ? Math.round(reserve * 0.8 * 100) / 100 : 0,
      adjusterId: adjusters[i % adjusters.length].id, denialReason: status === 'Denied' ? 'Loss not covered under policy terms' : null,
    }));
  }

  for (let i = 0; i < 30; i++) {
    const relatedType = ['Claim', 'Policy', 'Account', 'Quote'][i % 4];
    const relatedId = { Claim: claims, Policy: policies, Account: accounts, Quote: quotes }[relatedType][i % 10].id;
    add('notes', {
      subject: ['Called customer', 'Documents received', 'Follow-up required', 'Payment reminder sent'][i % 4],
      body: `Note ${i + 1}: ${['Left voicemail regarding renewal.', 'Customer uploaded photos of damage.', 'Awaiting police report.', 'Reminder emailed for upcoming installment.'][i % 4]}`,
      relatedType, relatedId, author: users[i % users.length].username, createdAt: `${randomDate(r, 2024, 2025)}T${String(between(r, 8, 17)).padStart(2, '0')}:${String(between(r, 0, 59)).padStart(2, '0')}:00.000Z`,
    });
  }

  const invoices = [];
  policies.forEach((policy, i) => {
    const status = ['Paid', 'Due', 'Paid', 'Overdue', 'Void'][i % 5];
    const dueDate = randomDate(r, 2024, 2025);
    invoices.push(add('invoices', {
      accountId: policy.accountId, policyId: policy.id, amount: Math.round((policy.premium / 12) * 100) / 100, dueDate, status,
      paidDate: status === 'Paid' ? dueDate : null,
    }));
  });

  invoices.filter((inv) => inv.status === 'Paid').forEach((inv, i) => {
    add('payments', {
      accountId: inv.accountId, invoiceId: inv.id, claimId: null, amount: inv.amount, method: ['Card', 'ACH', 'Check'][i % 3],
      status: 'Completed', reference: `PAY-${80000 + i}`, paidDate: inv.paidDate,
    });
  });
  claims.filter((c) => c.paidAmount > 0).forEach((c, i) => {
    const policy = policies.find((p) => p.id === c.policyId);
    add('payments', {
      accountId: policy.accountId, invoiceId: null, claimId: c.id, amount: c.paidAmount, method: i % 2 === 0 ? 'ACH' : 'Check',
      status: 'Completed', reference: `CLMPAY-${90000 + i}`, paidDate: randomDate(r, 2024, 2025),
    });
  });

  policies.slice(0, 20).forEach((policy, i) => {
    add('documents', {
      name: i % 2 === 0 ? 'Declarations Page' : 'Auto ID Card', type: i % 2 === 0 ? 'Declaration' : 'IDCard', relatedType: 'Policy', relatedId: policy.id,
      url: `https://files.policyhub.example.com/policies/${policy.id}/${i % 2 === 0 ? 'dec' : 'idcard'}.pdf`, mimeType: 'application/pdf', archived: i % 7 === 6,
    });
  });
  claims.slice(0, 5).forEach((claim) => {
    add('documents', {
      name: 'Damage photo', type: 'Photo', relatedType: 'Claim', relatedId: claim.id,
      url: `https://files.policyhub.example.com/claims/${claim.id}/photo-1.jpg`, mimeType: 'image/jpeg', archived: false,
    });
  });

  for (let i = 0; i < 20; i++) {
    const relatedType = ['Policy', 'Claim', 'Quote', 'Account'][i % 4];
    const relatedId = { Claim: claims, Policy: policies, Account: accounts, Quote: quotes }[relatedType][i % 8].id;
    add('activities', {
      subject: ['Review renewal', 'Call claimant', 'Approve quote', 'Verify address'][i % 4], type: ['Task', 'FollowUp', 'Approval', 'Reminder'][i % 4],
      assignedToUserId: users[i % users.length].id, relatedType, relatedId, dueDate: randomDate(r, 2025, 2026),
      priority: ['Low', 'Normal', 'High', 'Urgent'][i % 4], status: i % 3 === 2 ? 'Complete' : 'Open',
    });
  }

  const uwCodes = [
    ['HIGH_VALUE_VEHICLE', 'Vehicle value exceeds $100,000', 'Medium'], ['YOUTHFUL_DRIVER', 'Driver under 21 listed on policy', 'Low'],
    ['PRIOR_CLAIMS', 'More than 2 claims in the last 3 years', 'High'], ['LAPSE_IN_COVERAGE', 'Coverage lapse greater than 30 days', 'Medium'],
    ['CREDIT_HOLD', 'Account has outstanding balance', 'Blocker'],
  ];
  for (let i = 0; i < 10; i++) {
    const [code, description, severity] = uwCodes[i % uwCodes.length];
    add('underwriting-issues', {
      quoteId: i % 2 === 0 ? quotes[i % quotes.length].id : null, policyId: i % 2 === 1 ? policies[i % policies.length].id : null,
      code, description, severity, status: ['Open', 'Approved', 'Rejected', 'Open'][i % 4], decisionNote: i % 4 === 1 ? 'Approved by senior underwriter' : null,
    });
  }

  store.lastResetAt = new Date().toISOString();
  return store.counts();
}
