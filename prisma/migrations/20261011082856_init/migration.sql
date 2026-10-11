-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ACCOUNTANT', 'VIEWER');

-- CreateEnum
CREATE TYPE "BalanceConvention" AS ENUM ('DEBIT_PLUS', 'CREDIT_PLUS');

-- CreateEnum
CREATE TYPE "CalendarSystem" AS ENUM ('BS', 'AD');

-- CreateEnum
CREATE TYPE "NumberGrouping" AS ENUM ('INTERNATIONAL', 'INDIAN');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('DRAFT', 'POSTED', 'VOID');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('CSV', 'XLSX', 'PDF');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('COMPLETED', 'REFERENCE_ONLY', 'FAILED');

-- CreateTable
CREATE TABLE "Business" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'My Business',
    "address" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "panNumber" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'NPR',
    "currencySymbol" TEXT NOT NULL DEFAULT 'Rs.',
    "displayCalendar" "CalendarSystem" NOT NULL DEFAULT 'BS',
    "numberGrouping" "NumberGrouping" NOT NULL DEFAULT 'INTERNATIONAL',
    "balanceConvention" "BalanceConvention" NOT NULL DEFAULT 'DEBIT_PLUS',
    "fyCalendar" "CalendarSystem" NOT NULL DEFAULT 'BS',
    "fyStartMonth" INTEGER NOT NULL DEFAULT 4,
    "fyStartDay" INTEGER NOT NULL DEFAULT 1,
    "defaultSortField" TEXT NOT NULL DEFAULT 'date',
    "defaultSortDir" TEXT NOT NULL DEFAULT 'asc',
    "reportHeader" TEXT NOT NULL DEFAULT '',
    "reportFooter" TEXT NOT NULL DEFAULT '',
    "settlementAccountId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ACCOUNTANT',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialYear" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningBalance" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "financialYearId" UUID NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CategoryKind" NOT NULL,
    "accountId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "businessId" UUID NOT NULL,
    "transactionDate" DATE NOT NULL,
    "enteredDateText" TEXT NOT NULL DEFAULT '',
    "enteredCalendar" "CalendarSystem" NOT NULL DEFAULT 'AD',
    "billNumber" TEXT NOT NULL DEFAULT '',
    "debitAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "creditAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "categoryId" UUID,
    "status" "TransactionStatus" NOT NULL DEFAULT 'POSTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "clientToken" TEXT,
    "reversalOfId" UUID,
    "voidReason" TEXT,
    "importJobId" UUID,
    "createdBy" UUID NOT NULL,
    "updatedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "entryDate" DATE NOT NULL,
    "memo" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "transactionId" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" UUID NOT NULL,
    "journalEntryId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "debit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(16,2) NOT NULL DEFAULT 0,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID,
    "userName" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "mapping" JSONB,
    "report" JSONB,
    "fileData" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_businessId_idx" ON "User"("businessId");

-- CreateIndex
CREATE INDEX "FinancialYear_businessId_startDate_idx" ON "FinancialYear"("businessId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYear_businessId_label_key" ON "FinancialYear"("businessId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalance_financialYearId_key" ON "OpeningBalance"("financialYearId");

-- CreateIndex
CREATE INDEX "OpeningBalance_businessId_effectiveDate_idx" ON "OpeningBalance"("businessId", "effectiveDate");

-- CreateIndex
CREATE INDEX "Category_businessId_idx" ON "Category"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_businessId_name_key" ON "Category"("businessId", "name");

-- CreateIndex
CREATE INDEX "Account_businessId_type_idx" ON "Account"("businessId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Account_businessId_code_key" ON "Account"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_seq_key" ON "Transaction"("seq");

-- CreateIndex
CREATE INDEX "Transaction_businessId_transactionDate_seq_idx" ON "Transaction"("businessId", "transactionDate", "seq");

-- CreateIndex
CREATE INDEX "Transaction_businessId_billNumber_idx" ON "Transaction"("businessId", "billNumber");

-- CreateIndex
CREATE INDEX "Transaction_businessId_status_idx" ON "Transaction"("businessId", "status");

-- CreateIndex
CREATE INDEX "Transaction_businessId_categoryId_idx" ON "Transaction"("businessId", "categoryId");

-- CreateIndex
CREATE INDEX "Transaction_importJobId_idx" ON "Transaction"("importJobId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_businessId_clientToken_key" ON "Transaction"("businessId", "clientToken");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_transactionId_key" ON "JournalEntry"("transactionId");

-- CreateIndex
CREATE INDEX "JournalEntry_businessId_entryDate_idx" ON "JournalEntry"("businessId", "entryDate");

-- CreateIndex
CREATE INDEX "JournalLine_journalEntryId_idx" ON "JournalLine"("journalEntryId");

-- CreateIndex
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");

-- CreateIndex
CREATE INDEX "AuditLog_businessId_createdAt_idx" ON "AuditLog"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ImportJob_businessId_createdAt_idx" ON "ImportJob"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialYear" ADD CONSTRAINT "FinancialYear_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_financialYearId_fkey" FOREIGN KEY ("financialYearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data-integrity constraints that Prisma cannot express in the schema file.
-- ---------------------------------------------------------------------------
ALTER TABLE "Transaction"
  ADD CONSTRAINT "Transaction_amounts_nonnegative" CHECK ("debitAmount" >= 0 AND "creditAmount" >= 0),
  ADD CONSTRAINT "Transaction_has_amount" CHECK ("debitAmount" > 0 OR "creditAmount" > 0),
  ADD CONSTRAINT "Transaction_billnumber_when_posted" CHECK ("status" = 'DRAFT' OR "status" = 'VOID' OR length(btrim("billNumber")) > 0);

ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_amounts_nonnegative" CHECK ("debit" >= 0 AND "credit" >= 0),
  ADD CONSTRAINT "JournalLine_one_side_only" CHECK (("debit" = 0) <> ("credit" = 0));

ALTER TABLE "FinancialYear"
  ADD CONSTRAINT "FinancialYear_dates_ordered" CHECK ("endDate" >= "startDate");

-- A journal entry may only be committed when it balances. Deferred so that all
-- lines can be inserted inside one database transaction first.
CREATE OR REPLACE FUNCTION kusbill_check_journal_balanced() RETURNS trigger AS $$
DECLARE
  entry_id uuid;
  diff numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN entry_id := OLD."journalEntryId"; ELSE entry_id := NEW."journalEntryId"; END IF;
  IF NOT EXISTS (SELECT 1 FROM "JournalEntry" WHERE id = entry_id) THEN
    RETURN NULL; -- entry itself was deleted (cascade)
  END IF;
  SELECT COALESCE(SUM("debit"), 0) - COALESCE(SUM("credit"), 0) INTO diff
    FROM "JournalLine" WHERE "journalEntryId" = entry_id;
  IF diff <> 0 THEN
    RAISE EXCEPTION 'Journal entry % is not balanced (difference %)', entry_id, diff;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "JournalLine_balanced"
  AFTER INSERT OR UPDATE OR DELETE ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kusbill_check_journal_balanced();
