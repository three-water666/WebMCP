export function calculateSubtotal(items) {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
}

export function vipDiscount(subtotal, tier) {
  return tier === 'vip' ? subtotal * 0.1 : 0;
}
