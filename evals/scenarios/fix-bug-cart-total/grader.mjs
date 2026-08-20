import { capture, check, gradeResult, importWorkspaceModule } from '../../graders/grade-utils.mjs';

export async function grade({ workspacePath }) {
  const loaded = await capture(() => importWorkspaceModule(workspacePath, 'src/cart.mjs'));
  const calculate = loaded.ok ? loaded.value.calculateCartTotal : undefined;
  const normalCart = { items: [{ price: 10, quantity: 2 }, { price: 4.5, quantity: 1 }], couponAmount: 5 };
  const snapshot = JSON.stringify(normalCart);
  const normal = await capture(() => calculate(normalCart, 0.1));
  const overDiscount = await capture(() => calculate({ items: [{ price: 3, quantity: 1 }], couponAmount: 10 }, 0.2));
  const rounding = await capture(() => calculate({ items: [{ price: 0.1, quantity: 3 }], couponAmount: 0.01 }, 0.075));

  return gradeResult([
    check('module-loads', 10, loaded.ok && typeof calculate === 'function', loaded.error ?? 'function is exported'),
    check(
      'discount-before-tax',
      35,
      JSON.stringify(normal.value) === JSON.stringify({ subtotal: 24.5, tax: 1.95, total: 21.45 }),
      'coupon is applied before tax'
    ),
    check(
      'clamp-at-zero',
      25,
      JSON.stringify(overDiscount.value) === JSON.stringify({ subtotal: 3, tax: 0, total: 0 }),
      'over-discounted carts clamp to zero'
    ),
    check(
      'money-rounding',
      20,
      JSON.stringify(rounding.value) === JSON.stringify({ subtotal: 0.3, tax: 0.02, total: 0.31 }),
      'money values are rounded to cents'
    ),
    check('immutable-input', 10, JSON.stringify(normalCart) === snapshot, 'input cart remains unchanged'),
  ]);
}
