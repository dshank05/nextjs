import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from './db';
import { parseListQuery, paginationArgs, buildPagination, listResponse } from './api/list-query';
import { route, created, updated, ok, badRequest, notFound, conflict, fail, parseId } from './api/respond';

/**
 * The four product lookup tables - categories, subcategories, companies, car
 * models - behind one set of rules (PQ-34, PQ-35).
 *
 * They were four hand-written copies that disagreed: a duplicate-name check on
 * one of four, 409 on three and 400 on the fourth for "still in use", no
 * trimming, no created record returned, and the id in the request body for PUT
 * and DELETE. Now: names trimmed and required, duplicates refused with 409,
 * "in use" refused with 409, creates and updates return the record, and the id
 * is in the path (`/api/products/<resource>/[id]`), as in settings.
 */
export interface LookupConfig {
  /** Prisma delegate name, e.g. 'product_category'. */
  model: 'product_category' | 'product_subcategory' | 'product_company' | 'car_models';
  /** The name column. */
  nameField: string;
  /** Resource-named list key kept beside `data` for existing readers. */
  legacyKey: string;
  /** "Category", "Car model" … for messages. */
  label: string;
  /** Sortable columns; `sortMap` translates any that are not plain columns. */
  sortFields: string[];
  sortMap?: Record<string, (order: 'asc' | 'desc') => object>;
  include?: object;
  /** Extra list filters from the query string. */
  listWhere?: (req: NextApiRequest) => object;
  /** Extra writable fields, validated; return a message to refuse. */
  extraData?: (body: any) => Promise<{ data: object } | { error: string }>;
  /** Scope for the duplicate-name check (e.g. same category). */
  duplicateScope?: (data: any) => object;
  /** How many records still use this one; non-zero refuses the delete. */
  usage: (id: number) => Promise<string | null>;
}

const delegate = (cfg: LookupConfig): any => (prisma as any)[cfg.model];

async function readName(cfg: LookupConfig, body: any) {
  const name = String(body?.[cfg.nameField] ?? '').trim();
  return name || null;
}

async function isDuplicate(cfg: LookupConfig, name: string, scope: object, excludeId?: number) {
  const where: any = { [cfg.nameField]: name, ...scope };
  if (excludeId) where.id = { not: excludeId };
  return (await delegate(cfg).findFirst({ where, select: { id: true } })) !== null;
}

/** `/api/products/<resource>` — list and create. */
export function lookupCollection(cfg: LookupConfig) {
  return async (req: NextApiRequest, res: NextApiResponse) =>
    route(req, res, {
      GET: async () => {
        try {
          const list = parseListQuery(req, { sortFields: cfg.sortFields, defaultSort: cfg.nameField });
          const where: any = { ...(cfg.listWhere ? cfg.listWhere(req) : {}) };
          if (list.search) where[cfg.nameField] = { contains: list.search };
          const orderBy = cfg.sortMap?.[list.sortField]?.(list.sortOrder) ?? { [list.sortField]: list.sortOrder };
          const [rows, total] = await Promise.all([
            delegate(cfg).findMany({ where, orderBy, include: cfg.include, ...paginationArgs(list) }),
            delegate(cfg).count({ where })
          ]);
          return ok(res, listResponse(rows, buildPagination(list, total), cfg.legacyKey));
        } catch (error) {
          return fail(res, error, `load ${cfg.legacyKey}`);
        }
      },
      POST: async () => {
        try {
          const name = await readName(cfg, req.body);
          if (!name) return badRequest(res, `${cfg.label} name is required`);
          const extra = cfg.extraData ? await cfg.extraData(req.body) : { data: {} };
          if ('error' in extra) return badRequest(res, extra.error);
          const data: any = { [cfg.nameField]: name, ...extra.data };
          if (await isDuplicate(cfg, name, cfg.duplicateScope ? cfg.duplicateScope(data) : {})) {
            return conflict(res, `A ${cfg.label.toLowerCase()} named "${name}" already exists`);
          }
          const row = await delegate(cfg).create({ data });
          return created(res, row, `${cfg.label} created`);
        } catch (error) {
          return fail(res, error, `create the ${cfg.label.toLowerCase()}`);
        }
      }
    });
}

/** `/api/products/<resource>/[id]` — update and delete. */
export function lookupItem(cfg: LookupConfig) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const id = parseId(req.query.id);
    if (id === null) return badRequest(res, `A valid ${cfg.label.toLowerCase()} ID is required`);

    return route(req, res, {
      PUT: async () => {
        try {
          if (!(await delegate(cfg).findUnique({ where: { id }, select: { id: true } }))) {
            return notFound(res, `${cfg.label} not found`);
          }
          const name = await readName(cfg, req.body);
          if (!name) return badRequest(res, `${cfg.label} name is required`);
          const extra = cfg.extraData ? await cfg.extraData(req.body) : { data: {} };
          if ('error' in extra) return badRequest(res, extra.error);
          const data: any = { [cfg.nameField]: name, ...extra.data };
          if (await isDuplicate(cfg, name, cfg.duplicateScope ? cfg.duplicateScope(data) : {}, id)) {
            return conflict(res, `Another ${cfg.label.toLowerCase()} named "${name}" already exists`);
          }
          const row = await delegate(cfg).update({ where: { id }, data });
          return updated(res, row, `${cfg.label} updated`);
        } catch (error) {
          return fail(res, error, `update the ${cfg.label.toLowerCase()}`);
        }
      },
      DELETE: async () => {
        try {
          if (!(await delegate(cfg).findUnique({ where: { id }, select: { id: true } }))) {
            return notFound(res, `${cfg.label} not found`);
          }
          // Guarded: every one of these is referenced by products, and three of
          // the four references are ON DELETE SET NULL or no FK at all (F-66, F-67).
          const inUse = await cfg.usage(id);
          if (inUse) return conflict(res, `Cannot delete this ${cfg.label.toLowerCase()}. ${inUse} still reference it.`);
          await delegate(cfg).delete({ where: { id } });
          return ok(res, { status: 'success', message: `${cfg.label} deleted` });
        } catch (error) {
          return fail(res, error, `delete the ${cfg.label.toLowerCase()}`);
        }
      }
    });
  };
}

/** Products whose comma-joined car_model_ids contain `id` (any of four positions). */
export function carModelWhere(id: number | string) {
  const v = String(id);
  return {
    OR: [
      { car_model_ids: { contains: `,${v},` } },
      { car_model_ids: { startsWith: `${v},` } },
      { car_model_ids: { endsWith: `,${v}` } },
      { car_model_ids: v }
    ]
  };
}

const count = (n: number, noun: string) => (n > 0 ? `${n} ${noun}` : null);

export const CATEGORY: LookupConfig = {
  model: 'product_category', nameField: 'category_name', legacyKey: 'categories', label: 'Category',
  sortFields: ['id', 'category_name'],
  usage: async (id) => {
    const [products, subcategories] = await Promise.all([
      prisma.product.count({ where: { product_category_id: id } }),
      prisma.product_subcategory.count({ where: { category_id: id } })
    ]);
    return [count(products, 'product(s)'), count(subcategories, 'subcategory/subcategories')].filter(Boolean).join(' and ') || null;
  }
};

export const COMPANY: LookupConfig = {
  model: 'product_company', nameField: 'company_name', legacyKey: 'companies', label: 'Company',
  sortFields: ['id', 'company_name'],
  usage: async (id) => count(await prisma.product.count({ where: { company_id: id } }), 'product(s)')
};

export const CAR_MODEL: LookupConfig = {
  model: 'car_models', nameField: 'model_name', legacyKey: 'models', label: 'Car model',
  sortFields: ['id', 'model_name'],
  usage: async (id) => count(await prisma.product.count({ where: carModelWhere(id) }), 'product(s)')
};

export const SUBCATEGORY: LookupConfig = {
  model: 'product_subcategory', nameField: 'subcategory_name', legacyKey: 'subcategories', label: 'Subcategory',
  sortFields: ['id', 'subcategory_name', 'category_name'],
  sortMap: { category_name: (order) => ({ category: { category_name: order } }) },
  include: { category: true },
  listWhere: (req) => {
    const where: any = {};
    const categoryId = parseId(req.query.category_id);
    if (categoryId) where.category_id = categoryId;
    const categorySearch = String(req.query.category_search ?? '').trim();
    if (categorySearch) where.category = { category_name: { contains: categorySearch } };
    return where;
  },
  // The category must already exist - saving never creates one (PQ-08).
  extraData: async (body) => {
    const categoryId = parseId(body?.category_id);
    if (!categoryId || !(await prisma.product_category.findUnique({ where: { id: categoryId }, select: { id: true } }))) {
      return { error: 'Choose an existing category' };
    }
    return { data: { category_id: categoryId } };
  },
  duplicateScope: (data) => ({ category_id: data.category_id }),
  usage: async (id) => count(await prisma.product.count({ where: { product_subcategory_id: id } }), 'product(s)')
};
