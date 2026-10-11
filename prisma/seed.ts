/**
 * Creates the first business, owner login, starter chart of accounts and current financial year.
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD  -> owner credentials (required; no defaults are baked in)
 *   SEED_DEMO=1                             -> also add clearly-labelled sample entries (never use on real data)
 * Safe to run more than once.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ensureDefaultChart } from "../src/lib/services/accounting";
import { ensureCurrentFinancialYear, saveOpeningBalance } from "../src/lib/services/periods";
import { createTransaction } from "../src/lib/services/transactions";
import { todayIso } from "../src/lib/dates";

const db = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (see .env.example)");
  if (password.length < 8) throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters");

  let user = await db.user.findUnique({ where: { email } });
  let business = user ? await db.business.findUniqueOrThrow({ where: { id: user.businessId } }) : null;
  if (!user || !business) {
    business = await db.business.create({ data: { name: "My Business" } });
    user = await db.user.create({
      data: { businessId: business.id, email, name: "Owner", role: "OWNER", passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: new Date() },
    });
    console.log(`Created owner ${email}`);
  } else {
    console.log(`Owner ${email} already exists - leaving the password unchanged`);
  }
  await ensureDefaultChart(business.id);
  const ctx = { userId: user.id, userName: user.name, businessId: business.id, role: "OWNER" as const };
  const fy = await ensureCurrentFinancialYear(ctx);
  console.log(`Financial year ${fy.label} ready`);

  if (process.env.SEED_DEMO === "1") {
    if ((await db.transaction.count({ where: { businessId: business.id } })) > 0) return console.log("Demo skipped: entries already exist");
    const start = fy.startDate.toISOString().slice(0, 10);
    await saveOpeningBalance(ctx, { financialYearId: fy.id, amount: "25000", effectiveDate: start, notes: "Sample data" });
    const cats = Object.fromEntries((await db.category.findMany({ where: { businessId: business.id } })).map((c) => [c.name, c.id]));
    const rows: Array<[number, number, string, string, string, string, string?]> = [
      [0, 1, "1001", "12500", "", "Sample: wholesale rice", "Sales"],
      [2, 2, "1002", "", "4200.50", "Sample: oil purchase", "Purchases"],
      [5, 3, "1003", "8300", "", "Sample: grocery order", "Sales"],
      [9, 4, "1004", "", "1500", "Sample: shop rent", "Rent"],
    ];
    const today = todayIso();
    for (const [offset, , bill, debit, credit, description, cat] of rows) {
      const d = new Date(Date.parse(`${start}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
      if (d > today) continue;
      await createTransaction(ctx, { dateText: d, calendar: "AD", billNumber: bill, debit, credit, description, categoryId: cat ? cats[cat] : undefined, status: "POSTED" });
    }
    console.log("Added sample entries");
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
