# Bug: cart totals are wrong when a coupon is used

`calculateCartTotal` currently applies tax before the fixed coupon and can return a negative total.

Expected behavior:

1. Calculate `subtotal` from price times quantity.
2. Apply the fixed coupon to the subtotal, clamping the discounted amount to zero.
3. Calculate tax from the discounted amount.
4. Return monetary values rounded to two decimal places.
5. Do not mutate the cart or its items.

Fix the implementation without changing the exported function signature.
