-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('CUSTOMER', 'SUPPLIER');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "partyId" UUID;

-- CreateTable
CREATE TABLE "Party" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PartyKind" NOT NULL DEFAULT 'CUSTOMER',
    "phone" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "openingNet" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Party_businessId_isActive_idx" ON "Party"("businessId", "isActive");

-- CreateIndex
CREATE INDEX "Transaction_businessId_partyId_idx" ON "Transaction"("businessId", "partyId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One party name per business, ignoring upper/lower case.
CREATE UNIQUE INDEX "Party_businessId_lower_name_key" ON "Party"("businessId", lower("name"));
