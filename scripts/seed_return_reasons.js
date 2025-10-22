const { PrismaClient } = require('@prisma/client');

async function seedReturnReasons() {
  const prisma = new PrismaClient();

  try {
    console.log('Seeding return reasons...\n');

    const returnReasons = [
      // Sale return reasons
      { reason_name: 'Damaged Product', type: 'sale' },
      { reason_name: 'Wrong Item Delivered', type: 'sale' },
      { reason_name: 'Customer Dissatisfaction', type: 'sale' },
      { reason_name: 'Size/Color Issue', type: 'sale' },
      { reason_name: 'Defective Product', type: 'sale' },

      // Purchase return reasons
      { reason_name: 'Damaged during shipping', type: 'purchase' },
      { reason_name: 'Wrong item received', type: 'purchase' },
      { reason_name: 'Quality not as expected', type: 'purchase' },
      { reason_name: 'Excess inventory', type: 'purchase' },
      { reason_name: 'Defective product', type: 'purchase' },
    ];

    for (const reason of returnReasons) {
      // Check if reason already exists
      const existing = await prisma.return_reasons.findFirst({
        where: {
          reason_name: reason.reason_name,
          type: reason.type
        }
      });

      if (!existing) {
        await prisma.return_reasons.create({
          data: reason
        });
        console.log(`✅ Created: ${reason.reason_name} (${reason.type})`);
      } else {
        console.log(`⚠️  Already exists: ${reason.reason_name} (${reason.type})`);
      }
    }

    // Verify seeding
    const count = await prisma.return_reasons.count();
    console.log(`\nTotal return reasons: ${count}`);

  } catch (error) {
    console.error('Error seeding return reasons:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Check if script is run directly
if (require.main === module) {
  seedReturnReasons();
}

module.exports = { seedReturnReasons };
