# Ledger and accounting rules

## 1. Billpad ledger

Columns: **Date · Bill No. · Debit · Credit · Balance** (+ Description).

### Balance convention (Settings → Balance rule)

| Setting | Formula |
|---|---|
| `DEBIT_PLUS` (default, billpad-compatible) | `Balance = Previous Balance + Debit − Credit` |
| `CREDIT_PLUS` | `Balance = Previous Balance + Credit − Debit` |

The first row's "Previous Balance" is the **opening balance**.

**Changing the rule never edits stored amounts.** Because balances are calculated from the debit/credit amounts on every read, switching the rule recalculates every displayed balance consistently (no half-converted history). Once entries exist, the owner must tick an explicit confirmation, and the change is audit-logged. The rule in force is printed on every ledger, report and export.

### Ordering and recalculation

Entries are ordered by **transaction date, then by entry sequence** (a unique, ever-increasing number) so same-date entries have a stable, deterministic order. The running balance is `opening + SUM(±(debit − credit)) OVER (ORDER BY date, seq)` computed in SQL over the **complete** ledger, then filtered/paged. Therefore:

- editing or deleting a historical entry, or inserting one in the middle, changes every later balance automatically;
- searching, filtering, sorting or paging never changes a balance;
- drafts and deleted entries never contribute to balances.

### Opening and closing balances

- An **opening balance** is an explicit record (amount, effective date, notes) attached to a financial year — never a fake transaction.
- The **earliest** opening balance (by effective date) starts the ledger. Entries dated before it are rejected, and its date cannot be moved after existing entries.
- For any period: `Opening = anchor + net effect of all entries before the period`; `Closing = Opening + Total Debit − Total Credit` (for `DEBIT_PLUS`). Balances carry forward across months and years; nothing resets at a boundary.
- A later year's recorded opening balance that differs from the carried-forward figure is **not** used in calculations; the Annual Report shows the difference in its reconciliation summary.

### Entry states

`POSTED` (counts), `DRAFT` (saved for later, no effect), `VOID` (deleted: soft-deleted with a reason, no effect, kept in history). **Reverse** adds an offsetting entry (debit/credit swapped) and keeps the original visible.

### Duplicate and unusual entries

- Same bill number used again: warning, can proceed ("Save anyway"). Identical date + bill number + amounts: shown as an exact duplicate, same confirmation.
- Ledger flags: duplicate bill number, unusually large amount (> mean + 3σ once 20+ entries exist), future-dated.

## 2. Accounting ledger (kept separate)

A billpad debit/credit does not say whether money is income or an expense, so KusBill never guesses.

- **Accounts** have a type: Asset, Liability, Equity, Income, Expense. **Categories** are Income or Expense and point at an account of the matching type.
- Classifying a posted entry posts one **balanced** journal entry for the (non-zero) billpad amount:
  - Income category: **Dr** settlement account (cash/bank), **Cr** income account
  - Expense category: **Dr** expense account, **Cr** settlement account
- Editing, re-classifying, deleting or reversing the entry regenerates/removes its journal.
- Every journal entry must balance — enforced by the application **and** a deferred PostgreSQL constraint trigger.
- **Profit & Loss**: `Net Profit = Revenue − Expenses` using Income accounts (Cr − Dr) and Expense accounts (Dr − Cr) in the period. Uncategorised entries are excluded and counted in a warning. With no classified data the report explains what is missing rather than showing a number.
- **Trial Balance**: per-account net debit/credit balances as of a date; totals and any imbalance are shown. It is generated only from journal data — the ledger's running balance is not a trial balance.
