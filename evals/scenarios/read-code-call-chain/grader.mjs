import path from 'node:path';

import { check, gradeResult, readJson } from '../../graders/grade-utils.mjs';

export async function grade({ workspacePath }) {
  const answer = await readJson(path.join(workspacePath, 'analysis.json'));
  const chain = ['quoteOrder', 'calculateSubtotal', 'vipDiscount', 'calculateTax'];
  return gradeResult([
    check('structured-answer', 10, answer !== null, 'analysis.json is valid JSON'),
    check('call-chain', 35, JSON.stringify(answer?.callChain) === JSON.stringify(chain), 'call chain is exact'),
    check(
      'discount-rule',
      20,
      matchesDiscountRule(answer?.discountRule),
      'VIP discount rate and ordering are explained'
    ),
    check(
      'tax-rounding',
      20,
      matchesTaxRounding(answer?.taxRounding),
      'tax rounding is explained'
    ),
    check(
      'unknown-region',
      15,
      answer?.unknownRegionBehavior === 'Unsupported region: <region>',
      'unsupported-region behavior is exact'
    ),
  ]);
}

function matchesDiscountRule(value) {
  return typeof value === 'string' && /vip/i.test(value) && /10%/.test(value) && /before tax/i.test(value);
}

function matchesTaxRounding(value) {
  return typeof value === 'string' && /nearest cent/i.test(value) && /regional rate/i.test(value);
}
