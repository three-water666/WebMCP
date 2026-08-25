function money(value) {
  return Math.round(value * 100) / 100;
}

export function calculateCartTotal(cart, taxRate) {
  const subtotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = subtotal * taxRate;
  const total = subtotal + tax - (cart.couponAmount ?? 0);
  return { subtotal: money(subtotal), tax: money(tax), total: money(total) };
}
