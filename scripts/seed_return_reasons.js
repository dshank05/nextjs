const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const returnReasons = [
  // Purchase return reasons
  { reason_name: 'Manufacturing Defect', type: 'purchase' },
  { reason_name: 'Wrong Item Shipped', type: 'purchase' },
  { reason_name: 'Poor Quality', type: 'purchase' },
  { reason_name: 'Damaged in Transit', type: 'purchase' },
  { reason_name: 'Expired Product', type: 'purchase' },
  { reason_name: 'Incorrect Quantity', type: 'purchase' },
  { reason_name: 'Not as Described', type: 'purchase' },
  { reason_name: 'Packaging Issues', type: 'purchase' },

  // Sale return reasons
  { reason_name: 'Customer Dissatisfaction', type: 'sale' },
  { reason_name: 'Wrong Item Delivered', type: 'sale' },
  { reason_name: 'Defective Product', type: 'sale' },
  { reason_name: 'Size/Color Issue', type: 'sale' },
  { reason_name: 'Changed Mind', type: 'sale' },
  { reason_name: 'Damaged in Transit', type: 'sale' },
  { reason_name: 'Late Delivery', type: 'sale' },

  // SaleX return reasons (same as sale)
  { reason_name: 'Customer Dissatisfaction', type: 'salex' },
  { reason_name: 'Wrong Item Delivered', type: 'salex' },
  { reason_name: 'Defective Product', type: 'salex' },
  { reason_name: 'Size/Color Issue', type: 'salex' },
  { reason_name: 'Changed Mind', type: 'salex' },
  { reason_name: 'Damaged in Transit', type: 'salex' },
  { reason_name: 'Late Delivery', type: 'salex' }
];

async function main() {
  console.log('Seeding return reasons...');

  for (const reason of returnReasons) {
    try {
      const existing = await prisma.return_reasons.findFirst({
        where: {
          reason_name: reason.reason_name,
          type: reason.type
        }
      });

      if (!existing) {
        await prisma.return_reasons.create({
          data: {
            reason_name: reason.reason_name,
            type: reason.type,
            status: 'Active'
          }
        });
        console.log(`✓ Created: ${reason.reason_name} (${reason.type})`);
      } else {
        console.log(`- Skipped: ${reason.reason_name} (${reason.type}) - already exists`);
      }
    } catch (error) {
      console.error(`✗ Error creating ${reason.reason_name}:`, error.message);
    }
  }

  console.log('Return reasons seeding completed!');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
