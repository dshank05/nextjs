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
  });
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
