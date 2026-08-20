const TAX_RATES = { CN: 0.06, DE: 0.19, US: 0.0725 };

export function calculateTax(amount, region) {
  const rate = TAX_RATES[region];
  if (rate === undefined) {
    throw new Error(`Unsupported region: ${region}`);
  }
  return Math.round(amount * rate * 100) / 100;
}
