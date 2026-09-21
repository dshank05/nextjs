/**
 * Twin reconciliation harness (P4-26, and the concrete half of G-02).
 *
 * lib/ledger-handler.ts (vendor/purchase) and lib/customer-ledger-handler.ts
 * (customer/sale) are the same state machine written twice. The audit's thesis
 * is that the copies are not the bug - the DIVERGENCE between them is.
 *
 * This feeds the SAME change set to both, normalises the vendor vocabulary onto
 * the customer one, and compares the operation lists structurally.
 *
 * Be clear about what it can and cannot catch, because the two defects this
 * phase found are one of each:
 *
 *   L-7 (0->2 missing) it would NOT have caught. Both twins were missing the
 *       transition in exactly the same way, and two identical wrongs compare
 *       equal. That is why every transition is ENUMERATED here and a reachable
 *       transition that emits nothing is reported as EMPTY - the state-space
 *       check, not the twin check, is what finds a shared gap.
 *
 *   L-8 (the customer handler deriving reference_type as
 *       `invoiceId ? 'sale' : 'salex'` where the vendor handler hardcodes it)
 *       it also would not catch, because the normaliser maps both 'sale' and
 *       'salex' onto one token. L-8 is a defect in what that ternary EVALUATES
 *       to at runtime, not in the shape of the operation, so it needs the
 *       caller exercised - Phase 5's job.
 *
 * What it does catch is the thing that actually goes wrong over time: one twin
 * being changed and the other not.
 *
 *   node scripts/audit-twin-check.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-'));

function compile() {
  execFileSync('npx', [
    'tsc',
    'lib/ledger-handler.ts',
    'lib/customer-ledger-handler.ts',
    '--outDir', OUT,
    '--module', 'commonjs',
    '--target', 'es2019',
    '--skipLibCheck',
    '--esModuleInterop'
  ], { cwd: REPO, stdio: 'pipe', shell: true });
}

/** Vendor vocabulary -> customer vocabulary, so the two can be compared. */
function normalise(op, side) {
  const clone = JSON.parse(JSON.stringify(op));
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return node;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string') {
        node[k] = v
          .replace(/PAYMENT_RECEIVED/g, 'PAYMENT')
          .replace(/\bSALE\b/g, 'PURCHASE')
          .replace(/\bsalex\b/g, 'purchase')
          .replace(/\bsale\b/g, 'purchase')
          .replace(/\bSale\b/g, 'Purchase');
      } else {
        walk(v);
      }
    }
    return node;
  };
  walk(clone);

  if (clone.entry) {
    const e = clone.entry;
    // The two ledgers mirror each other: money owed to a VENDOR is a credit on
    // the vendor side and a debit on the customer side. Swap so the shapes line
    // up; a difference that survives this is a real divergence.
    if (side === 'customer') {
      const d = e.debit; e.debit = e.credit; e.credit = d;
    }
    delete e.customer_id;
    delete e.vendor_id;
    delete e.transaction_date;
    delete e.payment_date;
    delete e.reference_id;
    // Human wording is compared separately: "Payment made for purchase" and
    // "Payment received for sale" are each correct for their own side, and
    // holding them to be identical would drown a real structural divergence in
    // cosmetic noise.
    delete e.notes;
  }
  delete clone.description;
  if (clone.where) {
    delete clone.where.reference_id;
    delete clone.where.transaction_id;
  }
  return clone;
}

const STATUSES = [0, 1, 2];
const LABEL = { 0: 'Unpaid', 1: 'Paid', 2: 'Partial' };

(function main() {
  console.log('\nTwin reconciliation — purchase vs sale ledger handlers');
  console.log('='.repeat(64));

  try {
    compile();
  } catch (e) {
    console.error('Could not compile the handlers:\n' + (e.stdout || e.message).toString().slice(0, 800));
    process.exit(1);
  }

  const { ledgerHandler } = require(path.join(OUT, 'ledger-handler.js'));
  const { customerLedgerHandler } = require(path.join(OUT, 'customer-ledger-handler.js'));

  const base = {
    oldTotal: 1000, newTotal: 1200, amountChanged: true,
    paymentMode: 1, fy: 4, totalAllocated: 400,
    isTypeA: true, hasPaymentLedger: true,
    currentBalance: { total_paid: 0, total_allocated: 0, total_refunded: 0, total_refund_allocated: 0 }
  };

  let divergences = 0;
  let missing = 0;

  for (const oldStatus of STATUSES) {
    for (const newStatus of STATUSES) {
      const label = `${LABEL[oldStatus]} -> ${LABEL[newStatus]}  (${oldStatus}->${newStatus})`;

      const vendor = ledgerHandler.getPurchaseLedgerOps({
        ...base, oldStatus, newStatus,
        vendorId: 7, purchaseId: 42, invoiceNo: 'INV-42'
      });
      const customer = customerLedgerHandler.getSaleLedgerOps({
        ...base, oldStatus, newStatus,
        customerId: 7, invoiceId: 42, invoiceNo: 'INV-42'
      });

      const v = {
        creates: vendor.creates.map(o => normalise(o, 'vendor')),
        updates: vendor.updates.map(o => normalise(o, 'vendor')),
        deletes: vendor.deletes.map(o => normalise(o, 'vendor'))
      };
      const c = {
        creates: customer.creates.map(o => normalise(o, 'customer')),
        updates: customer.updates.map(o => normalise(o, 'customer')),
        deletes: customer.deletes.map(o => normalise(o, 'customer'))
      };

      const total = v.creates.length + v.updates.length + v.deletes.length;
      const same = JSON.stringify(v) === JSON.stringify(c);
      const shape = (x) => `${x.creates.length}C ${x.updates.length}U ${x.deletes.length}D`;
      const shapeSame = shape(v) === shape(c);

      if (total === 0) {
        missing++;
        console.log(`  EMPTY  ${label}  - neither twin emits anything for a reachable transition`);
        continue;
      }

      if (same) {
        console.log(`  MATCH  ${label}  (${shape(v)})`);
      } else if (shapeSame) {
        divergences++;
        console.log(`  DIFFER ${label}  - same operation shape (${shape(v)}), different contents`);
        console.log(`         purchase: ${JSON.stringify(v)}`);
        console.log(`         sale    : ${JSON.stringify(c)}`);
      } else {
        divergences++;
        console.log(`  DIFFER ${label}`);
        console.log(`         purchase: ${JSON.stringify(v)}`);
        console.log(`         sale    : ${JSON.stringify(c)}`);
      }
    }
  }

  fs.rmSync(OUT, { recursive: true, force: true });

  console.log('\n' + '='.repeat(64));
  console.log(`${divergences} divergence(s), ${missing} transition(s) emitting nothing.`);
  if (divergences === 0 && missing === 0) {
    console.log('The twins agree on all nine transitions.\n');
  }
  process.exit(divergences === 0 && missing === 0 ? 0 : 1);
})();
