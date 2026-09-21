/**
 * Phase 4 (Purchase) audit seed — vendors.
 *
 * Idempotent. Safe to re-run.
 *
 * Creates the minimum vendor master needed to exercise both tax paths:
 *
 *   - "Other" (id = 0). Not test data - the app's purchase form offers an
 *     "Other" vendor option that writes vendor_id = 0, and purchase.vendor_id
 *     carries a foreign key to vendor_details, so a row with id 0 has to exist
 *     or the insert fails. scripts/fix_vendor_other_and_cascade.sql created it
 *     originally; the 2026-09-20 data wipe removed it along with the fake
 *     vendors, so the Other path is broken until it is back (audit lead L-10).
 *
 *   - AUDIT TEST VENDOR UP, state code 9. Same state as the business
 *     (business_details.gstin = 09ABFPM3900M1ZI -> 09 Uttar Pradesh), so a
 *     purchase from this vendor is intra-state and should split CGST + SGST.
 *
 *   - AUDIT TEST VENDOR PB, state code 3. Different state, so a purchase from
 *     this vendor is inter-state and should be IGST.
 *
 * Note on id 0: MySQL turns an explicit 0 into the next AUTO_INCREMENT value
 * unless the session runs with NO_AUTO_VALUE_ON_ZERO. Rather than depend on
 * sql_mode, this inserts normally and then moves the row to id 0, which works
 * either way. Doing that is only safe while nothing references the row yet.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TEST_VENDORS = [
  {
    vendor_name: 'AUDIT TEST VENDOR UP',
    address: 'F-6 Professor Colony',
    address_2: 'Kamla Nagar',
    city: 'Agra',
    pin_code: '282004',
    state: 'Uttar Pradesh',
    state_code: 9,
    contact_no: '9000000001',
    email: 'audit-up@example.invalid',
    tax_id: '09AAACT2727Q1ZW',
    status: 'Active'
  },
  {
    vendor_name: 'AUDIT TEST VENDOR PB',
    address: '12 Industrial Area',
    address_2: 'Phase II',
    city: 'Ludhiana',
    pin_code: '141001',
    state: 'Punjab',
    state_code: 3,
    contact_no: '9000000002',
    email: 'audit-pb@example.invalid',
    tax_id: '03AAACT2727Q1ZS',
    status: 'Active'
  }
];

async function ensureOtherVendor() {
  const existing = await prisma.vendor_details.findUnique({ where: { id: 0 } });
  if (existing) {
    return { id: 0, created: false, name: existing.vendor_name };
  }

  const created = await prisma.vendor_details.create({
    data: {
      vendor_name: 'Other',
      status: 'Active',
      address: 'Manual Entry',
      city: 'Manual Entry',
      state: 'Uttar Pradesh',
      state_code: 9
    }
  });

  if (created.id !== 0) {
    await prisma.$executeRawUnsafe(
      'UPDATE vendor_details SET id = 0 WHERE id = ?',
      created.id
    );
  }

  const check = await prisma.vendor_details.findUnique({ where: { id: 0 } });
  if (!check) throw new Error('Failed to place the "Other" vendor at id 0');
  return { id: 0, created: true, name: check.vendor_name, movedFrom: created.id };
}

async function ensureTestVendor(spec) {
  const existing = await prisma.vendor_details.findFirst({
    where: { vendor_name: spec.vendor_name }
  });
  if (existing) {
    return { id: existing.id, created: false, name: existing.vendor_name, state_code: existing.state_code };
  }
  const created = await prisma.vendor_details.create({ data: spec });
  return { id: created.id, created: true, name: created.vendor_name, state_code: created.state_code };
}

(async () => {
  const results = [];

  results.push({ role: 'Other (FK target)', ...(await ensureOtherVendor()) });
  for (const spec of TEST_VENDORS) {
    results.push({ role: spec.state_code === 9 ? 'intra-state (CGST+SGST)' : 'inter-state (IGST)', ...(await ensureTestVendor(spec)) });
  }

  console.log('');
  for (const r of results) {
    console.log(
      `  id=${String(r.id).padEnd(5)} ${String(r.name).padEnd(24)} ` +
      `state_code=${String(r.state_code ?? 9).padEnd(3)} ` +
      `${r.created ? 'CREATED' : 'already present'}` +
      (r.movedFrom !== undefined ? ` (moved from id ${r.movedFrom})` : '')
    );
  }

  const total = await prisma.vendor_details.count();
  console.log(`\n  vendor_details now holds ${total} rows.\n`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('SEED FAILED:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
