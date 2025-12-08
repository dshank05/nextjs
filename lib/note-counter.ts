import { prisma } from './db'

/**
 * Note Counter Service
 * Generates sequential debit note and credit note numbers per financial year
 * Format: DN-{FY}-{NUMBER} or CN-{FY}-{NUMBER}
 */

export type NoteType = 'DEBIT' | 'CREDIT'

/**
 * Generate next note number for the given type and financial year
 * @param noteType - 'DEBIT' or 'CREDIT'
 * @param fy - Financial year (e.g., 2025)
 * @returns Formatted note number (e.g., "DN-2025-001")
 */
export async function generateNoteNumber(
  noteType: NoteType,
  fy: number
): Promise<string> {
  // Use transaction to ensure thread-safety
  const noteNumber = await prisma.$transaction(async (tx) => {
    // Try to find existing counter
    let counter = await tx.note_counters.findFirst({
      where: {
        note_type: noteType,
        fy: fy
      }
    })

    // Create counter if it doesn't exist
    if (!counter) {
      counter = await tx.note_counters.create({
        data: {
          note_type: noteType,
          fy: fy,
          last_number: 0
        }
      })
    }

    // Increment counter
    const nextNumber = counter.last_number + 1

    // Update counter
    await tx.note_counters.update({
      where: { id: counter.id },
      data: { last_number: nextNumber }
    })

    return nextNumber
  })

  // Format the note number
  const prefix = noteType === 'DEBIT' ? 'DN' : 'CN'
  const paddedNumber = String(noteNumber).padStart(3, '0')

  return `${prefix}-${fy}-${paddedNumber}`
}

/**
 * Get current counter value without incrementing
 * @param noteType - 'DEBIT' or 'CREDIT'
 * @param fy - Financial year
 * @returns Current counter value or 0 if not exists
 */
export async function getCurrentNoteNumber(
  noteType: NoteType,
  fy: number
): Promise<number> {
  const counter = await prisma.note_counters.findFirst({
    where: {
      note_type: noteType,
      fy: fy
    }
  })

  return counter?.last_number || 0
}

/**
 * Reset counter for a specific financial year (use with caution)
 * @param noteType - 'DEBIT' or 'CREDIT'
 * @param fy - Financial year
 */
export async function resetNoteCounter(
  noteType: NoteType,
  fy: number
): Promise<void> {
  await prisma.note_counters.updateMany({
    where: {
      note_type: noteType,
      fy: fy
    },
    data: {
      last_number: 0
    }
  })
}

/**
 * Get all counters for a financial year
 * @param fy - Financial year
 */
export async function getAllCountersForYear(fy: number) {
  return await prisma.note_counters.findMany({
    where: { fy },
    orderBy: { note_type: 'asc' }
  })
}
