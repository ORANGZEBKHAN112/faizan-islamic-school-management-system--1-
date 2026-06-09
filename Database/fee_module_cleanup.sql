SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- 1) Merge duplicate Monthly/Admission vouchers for same student+month+year+fee_type.
;WITH ranked AS (
  SELECT
    id,
    student_id,
    month,
    year,
    fee_type,
    paid_amount,
    discount_amount,
    fine_amount,
    balance_amount,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY student_id, month, year, fee_type
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM Fees
  WHERE fee_type IN ('Monthly', 'Admission')
),
keepers AS (
  SELECT * FROM ranked WHERE rn = 1
),
dupes AS (
  SELECT * FROM ranked WHERE rn > 1
),
agg AS (
  SELECT
    d.student_id,
    d.month,
    d.year,
    d.fee_type,
    SUM(ISNULL(d.paid_amount, 0)) AS paid_sum,
    SUM(ISNULL(d.discount_amount, 0)) AS discount_sum,
    SUM(ISNULL(d.fine_amount, 0)) AS fine_sum
  FROM dupes d
  GROUP BY d.student_id, d.month, d.year, d.fee_type
)
UPDATE k
SET
  paid_amount = ISNULL(k.paid_amount, 0) + a.paid_sum,
  discount_amount = ISNULL(k.discount_amount, 0) + a.discount_sum,
  fine_amount = ISNULL(k.fine_amount, 0) + a.fine_sum
FROM Fees k
JOIN keepers kk ON kk.id = k.id
JOIN agg a
  ON a.student_id = kk.student_id
 AND a.month = kk.month
 AND a.year = kk.year
 AND a.fee_type = kk.fee_type;

DELETE f
FROM Fees f
JOIN ranked r ON r.id = f.id
WHERE r.rn > 1;

-- Recompute balances/status after merge.
UPDATE Fees
SET
  balance_amount = CASE
    WHEN (ISNULL(amount, 0) + ISNULL(arrears, 0) + ISNULL(fine_amount, 0) - ISNULL(discount_amount, 0) - ISNULL(paid_amount, 0)) < 0 THEN 0
    ELSE (ISNULL(amount, 0) + ISNULL(arrears, 0) + ISNULL(fine_amount, 0) - ISNULL(discount_amount, 0) - ISNULL(paid_amount, 0))
  END;

UPDATE Fees
SET status = CASE
  WHEN ISNULL(balance_amount, 0) <= 0 THEN 'Paid'
  WHEN ISNULL(paid_amount, 0) > 0 THEN 'Partially Paid'
  ELSE 'Unpaid'
END
WHERE fee_type IN ('Monthly', 'Admission', 'Arrears', 'Fine', 'Security Deposit', 'Summer Camp', 'ID Card', 'Educational Trip');

-- 2) Null duplicate transaction_ref values except latest row.
;WITH tx AS (
  SELECT
    id,
    transaction_ref,
    ROW_NUMBER() OVER (PARTITION BY transaction_ref ORDER BY created_at DESC, id DESC) AS rn
  FROM Fees
  WHERE transaction_ref IS NOT NULL AND LTRIM(RTRIM(transaction_ref)) <> ''
)
UPDATE f
SET transaction_ref = NULL
FROM Fees f
JOIN tx t ON t.id = f.id
WHERE t.rn > 1;

-- 3) Canonical outstanding = sum of unpaid/partial balances from Fees.
UPDATE s
SET outstanding_fees = ISNULL(x.total_outstanding, 0)
FROM Students s
OUTER APPLY (
  SELECT SUM(CASE WHEN ISNULL(f.balance_amount, 0) > 0 THEN f.balance_amount ELSE 0 END) AS total_outstanding
  FROM Fees f
  WHERE f.student_id = s.id
    AND f.status IN ('Unpaid', 'Partially Paid', 'Overdue', 'Pending')
) x;

COMMIT TRANSACTION;

