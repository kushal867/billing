# KusBill

**Your Bills. Your Balance. Automatically.**

KusBill replaces a paper billpad with a simple, secure, database-backed web app. You type the **date, bill number and amount** from the billpad; KusBill saves it, keeps the running balance correct, and produces daily, monthly and annual statements and a profit & loss report with no manual calculation.

- Next.js 15 (App Router) · TypeScript · Tailwind CSS · shadcn/ui-style components (Radix) · Recharts · Lucide
- PostgreSQL + Prisma · Zod + React Hook Form
- Cookie sessions (signed JWT via `jose`) with bcrypt password hashing and DB-backed rate limiting
- PDF (`pdfkit`), Excel (`exceljs`) and CSV exports · CSV/Excel import (`papaparse`, `exceljs`)
- Bikram Sambat (BS) and Gregorian (AD) dates

> Authentication is implemented directly (signed cookie + bcrypt) rather than with Auth.js. For a small single-business app this is fewer moving parts and keeps session invalidation, rate limiting and role checks in one place (`src/lib/auth`).

---

**📖 Using the app? Read the [User Guide](docs/USER_GUIDE.md)** (also as a [PDF](docs/KusBill-User-Guide.pdf)), a step-by-step guide with screenshots, in English with a short Nepali section.

---

## Quick start (local)

Requirements: Node.js 20+ and a PostgreSQL 14+ database.

```bash
npm install
cp .env.example .env          # then edit the values (see below)
npx prisma migrate deploy     # creates the tables
npm run db:seed               # creates the owner login, chart of accounts, current financial year
npm run dev                   # http://localhost:3000
```

Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, then:

1. **Settings → Business**: enter the business name (optional details can wait).
2. **Settings → Opening balance**: enter the balance brought forward from the physical billpad.
3. **Add Entry** (always one click away in the header): type date, bill number and debit or credit amount, press Enter.

`SEED_DEMO=1 npm run db:seed` additionally adds a few clearly labelled sample entries (never use on real data).

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (use the pooled URL on serverless hosts). |
| `DIRECT_URL` | Non-pooled URL used by `prisma migrate`. Same as `DATABASE_URL` if you have no pooler. |
| `SESSION_SECRET` | ≥ 32 random characters used to sign session cookies: `openssl rand -base64 48`. The app refuses to run without it. |
| `ALLOW_SIGNUP` | `true` (default) shows a public **Create account** page; `false` hides it. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Only read by `npm run db:seed`. No default credentials exist in the code. |

Secrets are read on the server only; nothing is exposed to the browser. `.env` is git-ignored.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development, production build, production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest suite (needs a Postgres database, see *Testing*) |
| `npm run db:migrate` | Create/apply a migration in development |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:seed` | Seed first owner, chart of accounts, current financial year |
| `npm run db:backup` | `pg_dump` backup into `./backups` |

---

## How the ledger works

See [`docs/LEDGER.md`](docs/LEDGER.md) for the full rules. In short:

- The billpad columns are reproduced: **Date, Bill No., Debit, Credit, Balance** (plus Description).
- **Default rule (billpad-compatible): `Balance = Previous Balance + Debit − Credit`.** The alternative `Previous + Credit − Debit` can be chosen in **Settings → Balance rule**. The rule in force is printed on every ledger and report.
- Balances are **never stored**; they are computed from the complete, deterministically ordered history (date, then entry sequence) in SQL. Editing, inserting, reversing or deleting a historical entry therefore recalculates every later balance automatically, and paging/searching/filtering never changes a balance.
- The **opening balance is its own record** (not a fake transaction) tied to a financial year. Balances **carry forward** across months and years and are never reset by a calendar boundary.
- Debit does **not** mean expense and credit does **not** mean income. Income/expense/profit are computed only from entries you classify with a **category** (or manual journal entries) — see below.

### Profit & Loss, accounts and the trial balance

The billpad ledger and the accounting ledger are kept separate:

- Giving an entry an income or expense **category** (Sales, Purchases, Rent, …) posts a **balanced double-entry journal** behind the scenes (income: Dr cash/bank, Cr income account; expense: Dr expense account, Cr cash/bank). The database itself refuses any unbalanced journal (deferred constraint trigger).
- **Profit & Loss** and the **Trial Balance** read only those journals. Uncategorised entries are never counted; reports and the dashboard list how many are excluded. With no classified data the dashboard shows **"Insufficient data"** instead of presenting the balance as profit.
- Manual journal entries (owner investment, bank charges, …) are available under **Accounts** and must balance before they can be saved.

### Dates (BS / AD)

- Dates are stored as AD `DATE` values. The text exactly as typed and the calendar it was typed in are kept too, so the original is always preserved.
- BS ⇄ AD conversion lives in `src/lib/dates.ts`: day-counting from the anchor BS 2000-01-01 = AD 1943-04-14 using the month-length table from `nepali-date-converter` (BS 2000–2090). Impossible dates (e.g. `2082-01-33`) are **rejected, not rolled over**; nothing is approximated. Tests verify every month boundary of all 91 years against the reference library, round-trips, continuity across year/leap boundaries, and the New Year dates.
- Financial years follow a configurable start (default: Shrawan 1, BS) and calendar, so they do not assume January 1.

### Importing old records

**Imports** accepts CSV and Excel (.xlsx). Flow: upload → map columns (auto-suggested) → choose whether text dates are BS or AD → **check** (nothing is saved) → review per-row results with row numbers → import. The server re-validates inside the import transaction; rows with errors are never imported, exact duplicates are skipped by default, and the summary reports imported / skipped / failed. Excel date cells are read as unambiguous AD; text dates use your calendar choice and suspicious combinations are flagged.

PDFs with typed text are read into the same column-mapping and preview step as Excel/CSV (`pdfjs-dist`; table rebuilt from text positions), so nothing is saved until the user has reviewed it. Scanned or photographed PDFs are not OCR’d and are refused with a clear message; a PDF can also be stored for reference only.

---

## Everyday-use features

- **Nepali language (नेपाली).** One-click switch (sidebar, sign-in page and setup wizard). Screens, buttons, validation messages and report labels are translated; month names show in Nepali script. Reports exported to **PDF, Excel and CSV follow the chosen language**, and PDFs embed *Noto Sans Devanagari* (SIL Open Font License, `src/lib/exporters/fonts/`), so Nepali text prints correctly. Numbers and bill numbers stay in Latin digits. Translations live in `src/lib/i18n/ne.ts` (the English text is the key; anything untranslated falls back to English). Coverage is the daily screens (entry, ledger, dashboard, reports, alerts, setup, bulk entry); some long Settings/Accounts/Import form labels are still English.
- **Parties (`/parties`).** Optional customer/supplier on every entry (type-ahead; a new name creates the party, matching ignores case and spacing). Each party has a ledger-style **statement** (PDF/Excel/CSV/print via the report engine, slug `party-statement`), a balance (net debit: positive = they owe you), first-in-first-out **ageing** (0-30/31-60/61-90/90+ days, brought-forward balance counts as oldest), a quick *record payment* form that posts a normal entry, merge/hide, an *outstanding* report (`outstanding`), a dashboard widget and a 60-day overdue alert. Parties are tenant-scoped (`Party` model, `Transaction.partyId`); editing an entry without a `partyName` leaves its party unchanged, an empty one clears it. Imports and Bulk Entry do not set a party yet.
- **Guided first-time setup (`/welcome`).** Three skippable steps: business name and date calendar, opening balance, first entry. New accounts land there; until all three are done the dashboard shows a checklist (progress is derived from real data).
- **Billpad-style print (`Reports → Billpad Print`).** Ruled pages like the paper pad: Date, Bill No., Debit, Credit, Balance, with *Brought forward* at the top of each page and *Carried forward / Closing Balance* page totals. Choose rows per page (10-40). Prints one pad page per sheet, and exports to PDF/Excel/CSV.
- **Calendar date picker.** Calendar button on every date field: BS or AD month view with the other calendar's day shown small under each date.
- **Bulk entry (`/entries/bulk`).** Type or paste (from Excel) a whole page of bills. Rows are validated with the same rules as imports; **nothing is saved unless every row is valid**; unsaved pages survive a reload. Batches appear in Import history.
- **Alerts and reminders (`/alerts`, header bell, dashboard).** Missing bill numbers in a numeric series, unusually large recent amounts, duplicate bill numbers, drafts waiting, future-dated entries, no entries for 3+ days, uncategorised entries. Reminders can be dismissed per device and reappear only if their content changes.
- **Works through internet drops.** If the connection fails while you save an entry (single entry, quick-add row or bulk page), it is kept **on this device** and sent automatically, in order, when the internet returns (banner shows what is waiting). Each queued entry has a unique token so retrying, or a second open tab syncing, can never create a duplicate. Entries the server rejects (invalid, duplicate) are held under *Needs attention* with Retry / Save anyway / Discard. If the page is reloaded while offline, a small offline page (`/offline.html`, served by a service worker that caches **only static files, never pages or financial data**) lets you keep typing bills. Limits: this covers *adding* entries; viewing or editing existing data needs a connection. Queued entries are stored unencrypted in the browser's local storage on that device, so use it only on devices you trust.

## Project structure

```
prisma/
  schema.prisma            data model (money is Decimal(16,2))
  migrations/              SQL migrations incl. CHECK constraints and the balanced-journal trigger
  seed.ts                  first owner, chart of accounts, current financial year
src/
  app/
    (auth)/login/          sign in
    (app)/                 authenticated shell
      dashboard/ entries/ ledger/ reports/ accounts/ imports/ settings/
    api/export  api/backup  api/imports/[id]   report/backup/PDF downloads
  actions/                 server actions (validate → authorise → call a service)
  components/              UI (ui/ = shadcn-style primitives), forms, charts
  lib/
    auth/                  sessions, passwords, rate limiting, request context
    services/              ALL business logic and DB access (ledger, transactions, reports, imports, accounting, settings…)
    exporters/             PDF / XLSX / CSV renderers for a common ReportDoc
    dates.ts money.ts      BS/AD module, decimal helpers
tests/                     Vitest suites (run against a real PostgreSQL)
scripts/                   backup.sh, restore.sh
docs/LEDGER.md             ledger & accounting rules
```

Design notes: every service function takes an explicit `{ userId, businessId, role }` context derived **server-side** from the session; every query is scoped by `businessId`, and records are fetched by `id AND businessId`. All reports are built as one renderer-neutral `ReportDoc`, so the on-screen view, print, PDF, Excel and CSV always agree and always reflect the active filters.

---

## Security

- Passwords hashed with bcrypt (cost 12); policy ≥ 8 chars with letters and numbers.
- Sessions: signed, `httpOnly`, `SameSite=Lax`, `Secure` in production, 7-day expiry; the user is re-loaded from the database on every request, so disabling a user or changing a password signs out other devices immediately.
- Login rate limiting (per email and per IP) stored in PostgreSQL so it works on serverless.
- Server-side authorisation on every action and route handler (roles: **Owner**, **Accountant** = add/edit, **Viewer** = read-only). Cross-business access returns “not found”. Hiding a button is never relied on.
- All input validated with Zod/explicit parsers; SQL is parameterised; CSV/XLSX exports neutralise spreadsheet-formula injection.
- Audit log for creates, edits, deletions (soft-delete with reason), reversals, imports, settings, convention changes, user and password changes, and backups.
- Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`); uploaded PDFs are served sandboxed.
- Concurrency: writes take a per-business advisory lock inside a transaction; entries carry a version number so a stale edit is rejected instead of overwriting; the entry form sends an idempotency token so a double-click cannot create duplicates.

Roles are assigned in **Settings → Users** (owner only).

---

## Backup and recovery

Data lives only in PostgreSQL (never in the browser).

**1. In-app export (owner):** *Settings → Backup → Download full backup (JSON)* — all business data, transactions, journals and audit history (password hashes are excluded). Reports can also be exported to Excel/CSV at any time.

**2. PostgreSQL backup (recommended, restorable):**

```bash
DATABASE_URL="postgresql://USER:PASS@HOST:5432/kusbill" npm run db:backup      # writes backups/kusbill-<timestamp>.dump
# equivalent: pg_dump --format=custom --no-owner --file=kusbill.dump "postgresql://USER:PASS@HOST:5432/kusbill"
```

Schedule it (cron / your host's backup feature). Hosted providers (Neon, Supabase, Railway, RDS) also offer automatic snapshots and point-in-time recovery — enable them. Keep copies off the server.

**3. Restore** into a new, empty database:

```bash
createdb kusbill_restored
DATABASE_URL="postgresql://USER:PASS@HOST:5432/kusbill_restored" bash scripts/restore.sh backups/kusbill-XXXX.dump
# equivalent: pg_restore --no-owner --exit-on-error --dbname=postgresql://.../kusbill_restored kusbill.dump
```

`restore.sh` refuses to run against a database that already contains KusBill tables. Point `DATABASE_URL` at the restored database and restart. Test a restore occasionally.

**Schema changes** are only made through Prisma migrations (`prisma/migrations`); deploy with `npx prisma migrate deploy`. Destructive actions in the UI (deleting entries, disabling users) need a confirmation dialog, and deleted entries are soft-deleted and stay in the audit trail.

---

## Deploying to Vercel with a hosted PostgreSQL

1. Create a PostgreSQL database (e.g. Neon, Supabase, Vercel Postgres). Copy the **pooled** connection string and the **direct** (non-pooled) one.
2. Push this repository to GitHub and **Import Project** in Vercel (framework: Next.js; `vercel.json` already sets `installCommand: npm ci` and `buildCommand: prisma migrate deploy && next build`).
3. Add environment variables in *Project → Settings → Environment Variables*:
   - `DATABASE_URL` — pooled URL (add `?sslmode=require` if your provider needs it, and `&pgbouncer=true` for PgBouncer-style poolers)
   - `DIRECT_URL` — direct URL (used only for migrations during the build)
   - `SESSION_SECRET` — output of `openssl rand -base64 48`
4. Deploy. Migrations are applied during the build.
5. Create the first owner **once**, from your own machine, against the production database:
   ```bash
   DATABASE_URL="<production url>" DIRECT_URL="<direct url>" \
   SEED_ADMIN_EMAIL="you@example.com" SEED_ADMIN_PASSWORD="<strong password>" npm run db:seed
   ```
   Then sign in, change the password in *Settings → My account*, and set the business name and opening balance.
6. Enable automatic database backups with your provider.

PDF generation uses Node.js runtime route handlers; `next.config.mjs` already includes PDFKit's font metrics in the serverless trace.

---

## Testing

```bash
createdb kusbill_test    # or set TEST_DATABASE_URL to any empty database you can write to
npm test
```

The suite creates isolated businesses per test and applies migrations automatically (`tests/global-setup.ts`). Default test URL: `postgresql://kusbill:kusbill@localhost:5432/kusbill_test`. It covers: debit/credit entry, running balance, opening balance and carry-forward, historical edits/inserts/reversals/deletions, duplicate warnings, idempotent double-submit, concurrent writers, financial-year filtering, daily/monthly/annual totals and reconciliation, P&L and trial balance from categorised data (including the DB-level balanced-journal constraint), BS/AD conversion (every month of BS 2000–2090, leap years, boundaries), tenant isolation and role enforcement, import validation (row-numbered errors, duplicates, Excel dates, PDF reference), and PDF/XLSX/CSV export.

Before releasing: `npm run lint && npm run typecheck && npm test && npm run build`.

---

## Known limitations

- **Self-service sign-up creates a separate business per account.** Data is isolated per business (tested), but there is **no email verification or password-reset email yet**; sign-up is rate limited to 5 per hour per IP. Set `ALLOW_SIGNUP=false` to turn the public sign-up page off.
- **PDF export uses the embedded Noto Sans Devanagari font**, which covers Latin and Devanagari. Other scripts are not supported in PDFs.
- **BS conversion covers 2000–2090.** Dates outside this range are rejected for BS entry (AD entry always works).
- **Scanned/photographed PDFs are not OCR’d** (typed-text PDFs are imported; see Imports).
- Balances are derived on read with a SQL window function; this is comfortably fast for tens of thousands of entries. For millions of rows a materialised running balance would be the next step.
