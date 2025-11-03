import { prisma } from './db';

/**
 * Get the next invoice number for the current financial year
 * This function uses a database transaction to ensure thread-safety
 * 
 * @param type - The type of invoice: 'purchase', 'invoice', or 'invoicex'
 * @returns Object with nextInvoiceNo and currentFy
 */
export async function getNextInvoiceNumber(
  type: 'purchase' | 'invoice' | 'invoicex'
): Promise<{ nextInvoiceNo: number; currentFy: number }> {
  // Retry logic for transaction timeouts
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Get current FY from settings
        const settings = await tx.settings.findFirst({
          select: { currentfy: true }
        });

        if (!settings || !settings.currentfy) {
          throw new Error('Current financial year not set in settings');
        }

        const currentFy = settings.currentfy;

        // Get max invoice_no for this FY based on type
        let maxInvoiceNo = 0;

        if (type === 'purchase') {
          const result = await tx.purchase.findFirst({
            where: { fy: currentFy },
            orderBy: { invoice_no: 'desc' },
            select: { invoice_no: true }
          });
          maxInvoiceNo = result?.invoice_no || 0;
        } else if (type === 'invoice') {
          const result = await tx.invoice.findFirst({
            where: { fy: currentFy },
            orderBy: { invoice_no: 'desc' },
            select: { invoice_no: true }
          });
          maxInvoiceNo = result?.invoice_no || 0;
        } else if (type === 'invoicex') {
          const result = await tx.invoicex.findFirst({
            where: { fy: currentFy },
            orderBy: { invoice_no: 'desc' },
            select: { invoice_no: true }
          });
          maxInvoiceNo = result?.invoice_no || 0;
        }

        return {
          nextInvoiceNo: maxInvoiceNo + 1,
          currentFy: currentFy
        };
      }, {
        timeout: 10000, // 10 second timeout instead of default
        maxWait: 5000, // Max wait time before starting transaction
      });
    } catch (error) {
      lastError = error as Error;
      console.warn(`Invoice number generation attempt ${attempt}/${maxRetries} failed:`, error);

      // If it's a transaction timeout error, retry
      if (error instanceof Error && error.message.includes('Unable to start a transaction')) {
        if (attempt < maxRetries) {
          // Wait before retrying (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
          continue;
        }
      }

      // If it's not a timeout error or we've exhausted retries, throw the error
      throw error;
    }
  }

  // If we get here, all retries failed
  throw lastError || new Error('Failed to generate invoice number after retries');
}

/**
 * Get the current financial year from settings
 * @returns The current financial year ID
 */
export async function getCurrentFinancialYear(): Promise<number> {
  const settings = await prisma.settings.findFirst({
    select: { currentfy: true }
  });
  
  if (!settings || !settings.currentfy) {
    throw new Error('Current financial year not set in settings');
  }
  
  return settings.currentfy;
}
