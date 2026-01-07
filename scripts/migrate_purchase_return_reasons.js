const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// New purchase return reasons (only these should be active)
const newPurchaseReasons = [
  'Incorrect Quantity',
  'Wrong Item Shipped',
  'Manufacturing Defect',
  'Not as Described'
];

// Old purchase return reasons to deactivate
const oldPurchaseReasons = [
  'Poor Quality',
  'Damaged in Transit',
  'Expired Product',
  'Packaging Issues'
];

async function main() {
  console.log('Migrating purchase return reasons...');

  try {
    // Deactivate old purchase return reasons
    for (const reasonName of oldPurchaseReasons) {
      const existing = await prisma.return_reasons.findFirst({
        where: {
          reason_name: reasonName,
          type: 'purchase'
        }
      });

      if (existing && existing.status === 'Active') {
        await prisma.return_reasons.update({
          where: { id: existing.id },
          data: { status: 'Inactive' }
        });
        console.log(`✓ Deactivated: ${reasonName} (purchase)`);
      } else if (existing) {
        console.log(`- Already inactive: ${reasonName} (purchase)`);
      } else {
        console.log(`- Not found: ${reasonName} (purchase)`);
      }
    }

    // Ensure new purchase return reasons are active
    for (const reasonName of newPurchaseReasons) {
      const existing = await prisma.return_reasons.findFirst({
        where: {
          reason_name: reasonName,
          type: 'purchase'
        }
      });

      if (!existing) {
        await prisma.return_reasons.create({
          data: {
            reason_name: reasonName,
            type: 'purchase',
            status: 'Active'
          }
        });
        console.log(`✓ Created: ${reasonName} (purchase)`);
      } else if (existing.status !== 'Active') {
        await prisma.return_reasons.update({
          where: { id: existing.id },
          data: { status: 'Active' }
        });
        console.log(`✓ Activated: ${reasonName} (purchase)`);
      } else {
        console.log(`- Already active: ${reasonName} (purchase)`);
      }
    }

    console.log('Purchase return reasons migration completed!');

    // Show current active purchase return reasons
    const activePurchaseReasons = await prisma.return_reasons.findMany({
      where: {
        type: 'purchase',
        status: 'Active'
      },
      select: {
        reason_name: true,
        status: true
      },
      orderBy: {
        reason_name: 'asc'
      }
    });

    console.log('\nCurrent active purchase return reasons:');
    activePurchaseReasons.forEach(reason => {
      console.log(`  - ${reason.reason_name}`);
    });

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
