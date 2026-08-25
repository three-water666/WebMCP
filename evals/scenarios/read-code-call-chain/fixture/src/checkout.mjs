import { calculateSubtotal, vipDiscount } from './pricing.mjs';
import { calculateTax } from './tax.mjs';

export function quoteOrder(order) {
  const subtotal = calculateSubtotal(order.items);
  const discount = vipDiscount(subtotal, order.customer.tier);
  const taxableAmount = subtotal - discount;
  const tax = calculateTax(taxableAmount, order.region);
  return { subtotal, discount, tax, total: taxableAmount + tax };
}
