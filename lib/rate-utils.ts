// ===== RATE MANAGEMENT UTILITIES =====
// Utility functions for rate validation, calculation, and business logic

export interface ProductRateData {
  opening_rate: number | null;
  latest_purchase_rate: number | null;
  mrp: number | null;
  margin: number | null;
  discount: number | null;
}

export interface RateValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates purchase rate business rules
 * @param rate - Purchase rate to validate
 * @returns Validation result with errors and warnings
 */
export function validatePurchaseRate(rate: number): RateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (rate <= 0) {
    errors.push('Purchase rate must be greater than 0');
  }

  if (rate > 100000) {
    warnings.push('Purchase rate seems unusually high - please verify');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validates selling price against purchase cost and business rules
 * @param purchaseRate - The purchase rate (cost)
 * @param sellingPrice - The proposed selling price
 * @param mrp - Maximum retail price (optional ceiling)
 * @returns Validation result with errors and warnings
 */
export function validateSellingPrice(
  purchaseRate: number,
  sellingPrice: number,
  mrp?: number | null
): RateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (sellingPrice <= 0) {
    errors.push('Selling price must be greater than 0');
  }

  // Allow selling at cost or with reasonable discount (max 30% loss)
  const minAllowedPrice = purchaseRate * 0.7;
  if (sellingPrice < minAllowedPrice) {
    errors.push(`Selling price cannot be less than ${minAllowedPrice.toFixed(2)} (30% below cost)`);
  }

  // Check MRP ceiling if provided
  if (mrp && mrp > 0 && sellingPrice > mrp) {
    errors.push(`Selling price cannot exceed MRP of ${mrp}`);
  }

  // Calculate profit margin
  const profitMargin = ((sellingPrice - purchaseRate) / purchaseRate) * 100;
  if (profitMargin < 5) {
    warnings.push(`Low profit margin: ${profitMargin.toFixed(2)}% - consider price increase`);
  } else if (profitMargin > 200) {
    warnings.push(`High profit margin: ${profitMargin.toFixed(2)}% - please verify pricing`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Calculates selling price from product rate data
 * Formula: opening_rate + margin - discount
 * @param rateData - Product rate information
 * @returns Calculated selling price or null if insufficient data
 */
export function calculateSellingPrice(rateData: ProductRateData): number | null {
  const { opening_rate, margin, discount } = rateData;

  if (!opening_rate || opening_rate <= 0) {
    return null;
  }

  const marginAmount = margin || 0;
  const discountAmount = discount || 0;

  return opening_rate + marginAmount - discountAmount;
}

/**
 * Determines display rate based on business logic
 * Priority: opening_rate || latest_purchase_rate || 0
 * @param rateData - Product rate information
 * @returns Display rate for the product
 */
export function calculateDisplayRate(rateData: ProductRateData): number {
  const { opening_rate, latest_purchase_rate } = rateData;

  // Primary: Original price (stable, never changes)
  if (opening_rate && opening_rate > 0) {
    return opening_rate;
  }

  // Fallback: Latest purchase rate (for reference)
  if (latest_purchase_rate && latest_purchase_rate > 0) {
    return latest_purchase_rate;
  }

  // Default: 0
  return 0;
}

/**
 * Validates complete product rate data for business consistency
 * @param rateData - Complete product rate information
 * @returns Validation result with comprehensive checks
 */
export function validateProductRates(rateData: ProductRateData): RateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { opening_rate, latest_purchase_rate, mrp } = rateData;

  // At least one rate should be set for active products
  if ((!opening_rate || opening_rate <= 0) && (!latest_purchase_rate || latest_purchase_rate <= 0)) {
    errors.push('Product must have either an opening rate or purchase history');
  }

  // MRP should be reasonable if set
  if (mrp && mrp > 0) {
    const displayRate = calculateDisplayRate(rateData);
    if (displayRate > 0 && mrp < displayRate) {
      errors.push('MRP cannot be less than the display price');
    }

    if (mrp > displayRate * 3) {
      warnings.push('MRP is significantly higher than display price - please verify');
    }
  }

  // Cross-reference rates for consistency
  if (opening_rate && latest_purchase_rate) {
    const difference = Math.abs(opening_rate - latest_purchase_rate);
    const percentageChange = (difference / opening_rate) * 100;

    if (percentageChange > 50) {
      warnings.push(`Opening rate and latest purchase rate differ by ${percentageChange.toFixed(1)}% - significant price change`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Formats currency amount for display
 * @param amount - Numeric amount
 * @param currency - Currency code (default: INR)
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number, currency: string = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Calculates profit margin percentage
 * @param costPrice - Purchase/cost price
 * @param sellingPrice - Selling price
 * @returns Profit margin percentage or null if invalid inputs
 */
export function calculateProfitMargin(costPrice: number, sellingPrice: number): number | null {
  if (!costPrice || costPrice <= 0 || !sellingPrice || sellingPrice <= 0) {
    return null;
  }

  return ((sellingPrice - costPrice) / costPrice) * 100;
}

/**
 * Checks if a rate change requires special approval
 * @param oldRate - Previous rate
 * @param newRate - New rate
 * @param thresholdPercentage - Percentage change that requires approval (default: 25%)
 * @returns True if approval is required
 */
export function requiresApproval(oldRate: number, newRate: number, thresholdPercentage: number = 25): boolean {
  if (!oldRate || oldRate <= 0 || !newRate || newRate <= 0) {
    return false;
  }

  const changePercentage = Math.abs((newRate - oldRate) / oldRate) * 100;
  return changePercentage >= thresholdPercentage;
}

// ===== BUSINESS LOGIC CONSTANTS =====
export const RATE_VALIDATION = {
  MIN_PURCHASE_RATE: 0.01,
  MAX_DISCOUNT_PERCENTAGE: 30, // Maximum discount from cost price
  MIN_PROFIT_MARGIN_WARNING: 5, // Warn if profit margin below this %
  HIGH_PROFIT_MARGIN_WARNING: 200, // Warn if profit margin above this %
  APPROVAL_THRESHOLD_PERCENTAGE: 25, // Rate changes above this require approval
} as const;
