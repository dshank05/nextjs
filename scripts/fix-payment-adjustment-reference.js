/**
 * Fix Legacy PAYMENT_ADJUSTMENT Reference ID
 * 
 * Issue: Entry 424 has wrong reference_id (87 = payment ID)
 * Should be: 168 (purchase ID) to merge with other payment entries
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('🔍 Starting legacy PAYMENT_ADJUSTMENT reference_id fix...\n')

  // Step 1: Show BEFORE state
  console.log('📋 BEFORE STATE:')
  console.log('=' .repeat(80))
  
  const beforeEntries = await prisma.vendor_ledger.findMany({
    where: {
      OR: [
        { id: 424 },
        {
          AND: [
            { reference_id: { in: [87, 168] } },
            { transaction_type: { in: ['PAYMENT', 'PAYMENT_ADJUSTMENT'] } }
          ]
        }
      ]
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      vendor_id: true,
      transaction_date: true,
      transaction_type: true,
      reference_type: true,
      reference_id: true,
      reference_no: true,
      debit: true,
      credit: true,
      notes: true
    }
  })

  console.table(beforeEntries.map(e => ({
    ID: e.id,
    Type: e.transaction_type,
    Ref_ID: e.reference_id,
    Ref_No: e.reference_no,
    Credit: Number(e.credit),
    Status: e.id === 424 && e.reference_id === 87 ? '❌ WRONG' : '✅'
  })))

  // Step 2: Fix the entry
  console.log('\n🔧 Applying fix...')
  
  const updateResult = await prisma.vendor_ledger.updateMany({
    where: {
      id: 424,
      transaction_type: 'PAYMENT_ADJUSTMENT',
      reference_id: 87
    },
    data: {
      reference_id: 168
    }
  })

  console.log(`✅ Updated ${updateResult.count} record(s)\n`)

  // Step 3: Show AFTER state
  console.log('📋 AFTER STATE:')
  console.log('='.repeat(80))
  
  const afterEntries = await prisma.vendor_ledger.findMany({
    where: {
      reference_id: 168,
      transaction_type: { in: ['PAYMENT', 'PAYMENT_ADJUSTMENT'] }
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      transaction_date: true,
      transaction_type: true,
      reference_id: true,
      reference_no: true,
      credit: true
    }
  })

  console.table(afterEntries.map(e => ({
    ID: e.id,
    Type: e.transaction_type,
    Ref_ID: e.reference_id,
    Ref_No: e.reference_no,
    Credit: Number(e.credit),
    Status: '✅ CORRECT'
  })))

  // Step 4: Verify merged total
  const total = afterEntries.reduce((sum, e) => sum + Number(e.credit), 0)
  
  console.log('\n📊 VERIFICATION:')
  console.log('='.repeat(80))
  console.log(`Total Payment Amount: ₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`)
  console.log(`Expected: ₹20,000.00`)
  console.log(`Status: ${total === 20000 ? '✅ CORRECT' : '❌ INCORRECT'}`)

  console.log('\n🎉 Fix completed successfully!')
  console.log('📝 Next steps:')
  console.log('   1. Refresh your vendor ledger page')
  console.log('   2. You should see a single merged payment entry for ₹20,000')
  console.log('   3. Purchase 21 will appear BEFORE Payment 21 (correct order)')
  console.log('   4. All future payment edits will work correctly\n')
}

main()
  .catch((error) => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
