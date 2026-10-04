import { prisma } from './db';
import { SaleError } from './sale';

/**
 * Customer and vendor master records, one implementation (DETAILS_PLAN D1).
 * The routes under pages/api/customers and pages/api/vendors were copies; the
 * customer create dropped Phone 2 / Phone 3 / status, a vendor edit turned an
 * inactive vendor active again, and only the forms checked phone, pin, GSTIN
 * and email. Response shapes are the ones the screens already read.
 */
export type PartyKind = 'customer' | 'vendor';

type Field = { key: string; label: string; required?: boolean; kind?: 'phone' | 'pin' | 'gstin' | 'email' | 'state' | 'int' };

const CUSTOMER_FIELDS: Field[] = [
  { key: 'billing_name', label: 'Billing name', required: true },
  { key: 'billing_address', label: 'Billing address', required: true },
  { key: 'billing_address_2', label: 'Billing address 2' },
  { key: 'billing_city', label: 'Billing city' },
  { key: 'billing_pin_code', label: 'Billing pin code', kind: 'pin' },
  { key: 'billing_state', label: 'Billing state', required: true, kind: 'state' },
  { key: 'billing_state_code', label: 'Billing state code', kind: 'int' },
  { key: 'billing_gstin', label: 'Billing GSTIN', kind: 'gstin' },
  { key: 'shipping_name', label: 'Shipping name' },
  { key: 'shipping_address', label: 'Shipping address' },
  { key: 'shipping_address_2', label: 'Shipping address 2' },
  { key: 'shipping_city', label: 'Shipping city' },
  { key: 'shipping_pin_code', label: 'Shipping pin code', kind: 'pin' },
  { key: 'shipping_state', label: 'Shipping state', kind: 'state' },
  { key: 'shipping_state_code', label: 'Shipping state code', kind: 'int' },
  { key: 'shipping_gstin', label: 'Shipping GSTIN', kind: 'gstin' },
  { key: 'contact_no', label: 'Contact number', required: true, kind: 'phone' },
  { key: 'contact_no_2', label: 'Phone 2', kind: 'phone' },
  { key: 'contact_no_3', label: 'Phone 3', kind: 'phone' },
  { key: 'email', label: 'Email', kind: 'email' }
];

const VENDOR_FIELDS: Field[] = [
  { key: 'vendor_name', label: 'Vendor name', required: true },
  { key: 'address', label: 'Address' },
  { key: 'address_2', label: 'Address 2' },
  { key: 'city', label: 'City' },
  { key: 'pin_code', label: 'Pin code', kind: 'pin' },
  { key: 'state', label: 'State', required: true, kind: 'state' },
  { key: 'state_code', label: 'State code', kind: 'int' },
  { key: 'contact_no', label: 'Contact number', required: true, kind: 'phone' },
  { key: 'contact_no_2', label: 'Phone 2', kind: 'phone' },
  { key: 'contact_no_3', label: 'Phone 3', kind: 'phone' },
  { key: 'email', label: 'Email', kind: 'email' },
  { key: 'tax_id', label: 'GST number', kind: 'gstin' }
];

export const PARTY_CFG = {
  customer: {
    table: 'customer_details', ledger: 'customer_ledger', listKey: 'customers', one: 'customer', label: 'Customer',
    nameField: 'billing_name', cityField: 'billing_city', stateField: 'billing_state', gstinField: 'billing_gstin',
    fields: CUSTOMER_FIELDS
  },
  vendor: {
    table: 'vendor_details', ledger: 'vendor_ledger', listKey: 'vendors', one: 'vendor', label: 'Vendor',
    nameField: 'vendor_name', cityField: 'city', stateField: 'state', gstinField: 'tax_id',
    fields: VENDOR_FIELDS
  }
} as const;

const PHONE = /^[6-9]\d{9}$/;
const PIN = /^\d{6}$/;
const EMAIL = /\S+@\S+\.\S+/;
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

/** The row to write, checked the way the forms check it. */
function buildData(kind: PartyKind, body: any, existing?: any) {
  const cfg = PARTY_CFG[kind];
  const errors: string[] = [];
  const data: any = {};
  for (const f of cfg.fields) {
    const raw = body[f.key];
    const value = f.kind === 'gstin' ? str(raw).toUpperCase() : str(raw);
    if (f.required && !value) errors.push(`${f.label} is required`);
    if (value) {
      if (f.kind === 'phone' && !PHONE.test(value)) errors.push(`${f.label} must be 10 digits and start with 6-9`);
      if (f.kind === 'pin' && !PIN.test(value)) errors.push(`${f.label} must be exactly 6 digits`);
      if (f.kind === 'gstin' && value.length !== 15) errors.push(`${f.label} must be 15 characters`);
      if (f.kind === 'email' && !EMAIL.test(value)) errors.push('Please enter a valid email address');
    }
    data[f.key] = f.kind === 'int' ? (parseInt(value, 10) || (kind === 'customer' ? 0 : null)) : (value || null);
  }
  if (kind === 'customer') {
    // Shipping falls back to billing (the column is NOT NULL); a create without
    // a shipping address used to fail with a database error.
    data.shipping_name = data.shipping_name || data.billing_name;
    data.shipping_address = data.shipping_address || data.billing_address || '';
    data.shipping_state = data.shipping_state || data.billing_state;
    data.shipping_state_code = data.shipping_state_code || data.billing_state_code || 0;
  }
  // Status is kept unless the request names one; editing an inactive vendor
  // made it active (`body.status || 'Active'`).
  const status = str(body.status);
  if (status) {
    if (status !== 'Active' && status !== 'Inactive') errors.push('Status must be Active or Inactive');
    data.status = status;
  } else if (!existing) {
    data.status = 'Active';
  }
  if (errors.length) {
    const e = new SaleError(400, 'Validation failed', 'VALIDATION');
    (e as any).errors = errors;
    throw e;
  }
  return data;
}

/** The record as the screens read it: string id, blanks as ''. */
function shape(kind: PartyKind, r: any, forList: boolean) {
  const cfg = PARTY_CFG[kind];
  const out: any = { id: String(r.id), status: r.status || 'Active' };
  for (const f of cfg.fields) {
    const v = r[f.key];
    out[f.key] = f.kind === 'int' ? (v ?? null) : forList ? (v ?? '') : (v ?? null);
  }
  return out;
}

export interface PartyListQuery {
  page: number;
  limit: number;
  search: string;
  dropdown: boolean;
  /** E-05: with `dropdown`, inactive rows too (report pickers; the bill and payment forms stay active-only). */
  includeInactive: boolean;
  status: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export function parsePartyListQuery(q: Record<string, unknown>): PartyListQuery {
  const one = (v: unknown) => String((Array.isArray(v) ? v[0] : v) ?? '').trim();
  return {
    page: Math.max(1, parseInt(one(q.page), 10) || 1),
    limit: Math.min(1000, Math.max(1, parseInt(one(q.limit), 10) || 50)),
    search: one(q.search),
    dropdown: one(q.dropdown) === 'true',
    includeInactive: one(q.includeInactive) === 'true',
    status: one(q.status),
    sortBy: one(q.sortBy) || 'name',
    sortOrder: one(q.sortOrder) === 'desc' ? 'desc' : 'asc'
  };
}

export async function listParties(kind: PartyKind, q: PartyListQuery) {
  const cfg = PARTY_CFG[kind];
  const db = prisma as any;
  const where: any = {};
  if (q.dropdown && !q.includeInactive) where.status = 'Active';
  else if (q.status === 'Active' || q.status === 'Inactive') where.status = q.status;
  if (q.search) {
    where.OR = [cfg.nameField, 'contact_no', 'email', cfg.cityField, cfg.gstinField].map(k => ({ [k]: { contains: q.search } }));
  }
  const sortField = ({ name: cfg.nameField, city: cfg.cityField, state: cfg.stateField, status: 'status', id: 'id' } as Record<string, string>)[q.sortBy] || cfg.nameField;
  const [rows, total] = await Promise.all([
    db[cfg.table].findMany({
      where,
      orderBy: [{ [sortField]: q.sortOrder }, { id: 'asc' }],
      // A dropdown needs every active row, not the first page (F-58).
      ...(q.dropdown ? {} : { skip: (q.page - 1) * q.limit, take: q.limit })
    }),
    db[cfg.table].count({ where })
  ]);
  const totalPages = Math.ceil(total / q.limit);
  return {
    [cfg.listKey]: rows.map((r: any) => shape(kind, r, true)),
    pagination: { page: q.page, limit: q.limit, total, totalPages, hasMore: q.page < totalPages }
  };
}

/** One record, with what the party owes / is owed: the ledger sum (F-47). */
export async function getParty(kind: PartyKind, id: number) {
  const cfg = PARTY_CFG[kind];
  const db = prisma as any;
  const r = await db[cfg.table].findUnique({ where: { id } });
  if (!r) throw new SaleError(404, `${cfg.label} not found`, 'NOT_FOUND');
  const sums = await db[cfg.ledger].aggregate({ where: { [`${kind}_id`]: id }, _sum: { debit: true, credit: true } });
  const outstanding = Math.round(((Number(sums?._sum?.debit) || 0) - (Number(sums?._sum?.credit) || 0)) * 100) / 100;
  return { ...shape(kind, r, false), outstanding };
}

export async function createParty(kind: PartyKind, body: any) {
  const cfg = PARTY_CFG[kind];
  const data = buildData(kind, body);
  const row = await (prisma as any)[cfg.table].create({ data });
  return shape(kind, row, false);
}

export async function updateParty(kind: PartyKind, id: number, body: any) {
  const cfg = PARTY_CFG[kind];
  const db = prisma as any;
  const existing = await db[cfg.table].findUnique({ where: { id } });
  if (!existing) throw new SaleError(404, `${cfg.label} not found`, 'NOT_FOUND');
  const row = await db[cfg.table].update({ where: { id }, data: buildData(kind, body, existing) });
  return shape(kind, row, false);
}

export async function setPartyStatus(kind: PartyKind, id: number, status: unknown, confirmed: unknown) {
  const cfg = PARTY_CFG[kind];
  const db = prisma as any;
  if (status !== 'Active' && status !== 'Inactive') throw new SaleError(400, 'Invalid status. Must be Active or Inactive.', 'VALIDATION');
  if (!confirmed) throw new SaleError(400, 'Confirmation required to change status', 'CONFIRM');
  const existing = await db[cfg.table].findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new SaleError(404, `${cfg.label} not found`, 'NOT_FOUND');
  await db[cfg.table].update({ where: { id }, data: { status } });
  return status;
}

/**
 * Deleting a party with any history would leave bills, payments and ledger rows
 * pointing at nothing; that is refused. A party without history can go.
 */
export async function deleteParty(kind: PartyKind, id: number) {
  const cfg = PARTY_CFG[kind];
  const db = prisma as any;
  const existing = await db[cfg.table].findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new SaleError(404, `${cfg.label} not found`, 'NOT_FOUND');
  const counts = kind === 'customer'
    ? await Promise.all([
        db.invoice.count({ where: { select_customer: id } }),
        db.invoicex.count({ where: { select_customer: id } }),
        db.customer_payments.count({ where: { customer_id: id } }),
        db.customer_refunds.count({ where: { customer_id: id } }),
        db.customer_ledger.count({ where: { customer_id: id } })
      ])
    : await Promise.all([
        db.purchase.count({ where: { vendor_id: id } }),
        db.purchase_returns.count({ where: { vendor_id: id } }),
        db.vendor_payments.count({ where: { vendor_id: id } }),
        db.vendor_refunds.count({ where: { vendor_id: id } }),
        db.vendor_ledger.count({ where: { vendor_id: id } })
      ]);
  if (counts.some((c: number) => c > 0)) {
    throw new SaleError(409, `This ${kind} has bills, payments or ledger entries and cannot be deleted. Mark it inactive instead.`, 'HAS_HISTORY');
  }
  await db[cfg.table].delete({ where: { id } });
}

/** Error answer for the party routes: a validation failure keeps its `errors` list. */
export function answerPartyError(res: any, error: any, context: string) {
  if (error instanceof SaleError) {
    return res.status(error.httpStatus).json({
      message: error.clientMessage,
      error_code: error.code,
      ...((error as any).errors ? { errors: (error as any).errors } : {})
    });
  }
  console.error(`${context}:`, error);
  return res.status(500).json({ message: `Failed to ${context}` });
}
