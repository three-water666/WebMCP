function money(value) {
  return Math.round(value * 100) / 100;
}

export function calculateCartTotal(cart, taxRate) {
  const subtotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discounted = Math.max(0, subtotal - (cart.couponAmount ?? 0));
  const tax = discounted * taxRate;
  return { subtotal: money(subtotal), tax: money(tax), total: money(discounted + tax) };
}
