export type PipelineStage = {
  stage: "purchase_order" | "warehouse_dispatch" | "campus_receiving" | "course_issue" | "available_inventory";
  quantity: number;
  difference: number | null;
  purchase: number;
  profit: number;
  sale: number;
  payable: number | null;
};

export type PipelineTotals = {
  poQty: number;
  poCost: number;
  poSale: number;
  dispatchQty: number;
  dispatchCost: number;
  dispatchSale: number;
  receivedQty: number;
  receivedCost: number;
  receivedSale: number;
  issuedQty: number;
  issuedCost: number;
  issuedSale: number;
};

function money(qty: number, cost: number, sale: number) {
  const purchase = round2(cost);
  const selling = round2(sale);
  return { purchase, sale: selling, profit: round2(selling - purchase), quantity: qty };
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Client reconciliation: each stage vs purchase-order quantity, with cost, profit, sale, and warehouse payable. */
export function buildReconciliationPipeline(t: PipelineTotals): PipelineStage[] {
  const po = money(t.poQty, t.poCost, t.poSale);
  const dispatch = money(t.dispatchQty, t.dispatchCost, t.dispatchSale);
  const received = money(t.receivedQty, t.receivedCost, t.receivedSale);
  const issued = money(t.issuedQty, t.issuedCost, t.issuedSale);
  const availableQty = Math.max(0, t.receivedQty - t.issuedQty);
  const unitCost = t.receivedQty > 0 ? t.receivedCost / t.receivedQty : t.poQty > 0 ? t.poCost / t.poQty : 0;
  const unitSale = t.receivedQty > 0 ? t.receivedSale / t.receivedQty : t.poQty > 0 ? t.poSale / t.poQty : 0;
  const available = money(availableQty, availableQty * unitCost, availableQty * unitSale);
  const diff = (qty: number) => round2(t.poQty - qty);

  return [
    { stage: "purchase_order", ...po, difference: null, payable: po.purchase },
    { stage: "warehouse_dispatch", ...dispatch, difference: diff(dispatch.quantity), payable: dispatch.purchase },
    { stage: "campus_receiving", ...received, difference: diff(received.quantity), payable: received.purchase },
    { stage: "course_issue", ...issued, difference: diff(issued.quantity), payable: null },
    { stage: "available_inventory", ...available, difference: null, payable: null },
  ];
}
