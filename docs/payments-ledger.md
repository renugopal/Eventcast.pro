# Payments and Ledger

How payments are taken and recorded. The **locked decisions** are: **Razorpay**
as the gateway, **backend verification** of every payment, and an **immutable
integer-paise ledger**. This document defines the model and invariants; it
changes no payment code and introduces **no pricing, tax, fees, or limits**
(those are owner-supplied and marked `TBD`).

## Principles (locked)

1. **Razorpay, backend-verified.** A payment is only ever treated as successful
   after the backend verifies it with Razorpay (signature/verification on the
   server). Client-side success signals are never trusted on their own.
2. **Integer paise only.** All monetary amounts are stored as **integer paise**
   (₹1 = 100 paise). No floating-point currency. No fractional paise.
3. **Immutable ledger.** Ledger entries are **append-only**. An entry is never
   updated or deleted; corrections are made by appending a compensating entry.

## Payment flow (target)

1. **Intent** — an order/intent is created server-side for a known amount in
   integer paise. (The amount's source — pricing — is `TBD`, owner-supplied.)
2. **Pay** — the client completes payment via Razorpay.
3. **Verify** — the backend verifies the payment with Razorpay before granting
   anything.
4. **Record** — on verified success, **exactly one** immutable ledger entry is
   appended.
5. **Reconcile** — ledger entries are reconcilable one-to-one against Razorpay
   records.

## Ledger entry (shape — descriptive, fields to be finalized in code)

An entry should minimally capture: a stable entry id, the studio/tenant it
belongs to (**studio = tenant**), the associated event/order, the amount in
**integer paise**, currency, direction (credit/debit), the Razorpay reference(s)
used for verification/reconciliation, and an immutable timestamp. The exact
column/field names are `TBD` and are fixed when the ledger lands (a separate,
reviewed change).

## Invariants

- No entry is mutated or deleted after write.
- Every settled payment maps to exactly one ledger entry.
- Amounts are integer paise; arithmetic is integer arithmetic.
- A payment without successful backend verification produces **no** ledger
  entry.

## Explicitly not defined here (not invented)

- Prices, plans, or amounts — **TBD** (owner-supplied).
- Tax/GST treatment — **TBD**.
- Fees, refunds policy specifics, payout timing — **TBD**.
- Rate limits or transaction caps — **TBD**.
