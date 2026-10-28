import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReconciliationPipeline } from '../server/bookstore/reconciliationMath.ts';

test('course reconciliation matches the client sample', () => {
  const stages = buildReconciliationPipeline({
    poQty: 1000,
    poCost: 500000,
    poSale: 600000,
    dispatchQty: 950,
    dispatchCost: 475000,
    dispatchSale: 570000,
    receivedQty: 940,
    receivedCost: 470000,
    receivedSale: 564000,
    issuedQty: 800,
    issuedCost: 400000,
    issuedSale: 480000,
  });

  assert.equal(stages[0].difference, null);
  assert.equal(stages[0].payable, 500000);
  assert.equal(stages[1].quantity, 950);
  assert.equal(stages[1].difference, 50);
  assert.equal(stages[1].payable, 475000);
  assert.equal(stages[2].difference, 60);
  assert.equal(stages[2].profit, 94000);
  assert.equal(stages[3].difference, 200);
  assert.equal(stages[3].payable, null);
  assert.equal(stages[4].quantity, 140);
  assert.equal(stages[4].purchase, 70000);
  assert.equal(stages[4].profit, 14000);
  assert.equal(stages[4].sale, 84000);
  assert.equal(stages[4].payable, null);
});
