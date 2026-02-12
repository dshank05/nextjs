const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const entries = await prisma.vendor_ledger.findMany({
      where: { vendor_id: 6 },
      select: {
        id: true,
        transaction_type: true,
        transaction_id: true,
        reference_type: true,
        reference_id: true,
        reference_no: true,
        credit: true,
        debit: true
      },
      orderBy: { id: 'asc' }
    });
    
    console.log('\n=== Arnav Motors (vendor_id=6) Ledger Entries ===\n');
    console.table(entries);
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();
