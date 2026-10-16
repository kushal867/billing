"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCtx } from "@/lib/auth/server";
import { run } from "@/lib/action";
import { validation } from "@/lib/errors";
import { createParty, getParty, mergeParties, setPartyActive, updateParty } from "@/lib/services/parties";
import { createTransaction } from "@/lib/services/transactions";

function refresh(id?: string) {
  for (const p of ["/parties", "/dashboard", "/ledger", "/entries/new"]) revalidatePath(p);
  if (id) revalidatePath(`/parties/${id}`);
}

export async function addParty(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const p = await createParty(ctx, input);
    refresh();
    return { id: p.id };
  });
}

export async function editParty(id: string, input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    await updateParty(ctx, id, input);
    refresh(id);
  });
}

export async function archiveParty(id: string, active: boolean) {
  return run(async () => {
    const ctx = await requireCtx();
    await setPartyActive(ctx, id, active);
    refresh(id);
  });
}

export async function mergeParty(fromId: string, intoId: string) {
  return run(async () => {
    const ctx = await requireCtx();
    const n = await mergeParties(ctx, fromId, intoId);
    refresh(intoId);
    return { moved: n };
  });
}

const paymentSchema = z.object({
  dateText: z.string().min(1, "Enter the date"),
  calendar: z.enum(["BS", "AD"]),
  amount: z.string().min(1, "Enter the amount"),
  billNumber: z.string().max(40).default(""),
  note: z.string().max(500).default(""),
  /** RECEIVED = money came in from the party (credit); PAID = money went out to the party (debit). */
  direction: z.enum(["RECEIVED", "PAID"]),
  clientToken: z.string().max(100).optional(),
});

/** One-step "record a payment" from a party's page. */
export async function recordPartyPayment(partyId: string, input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const parsed = paymentSchema.safeParse(input);
    if (!parsed.success) throw validation("Please fix the highlighted fields", Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    const v = parsed.data;
    const party = await getParty(ctx, partyId);
    const r = await createTransaction(ctx, {
      dateText: v.dateText, calendar: v.calendar,
      billNumber: v.billNumber.trim() || "PAY",
      debit: v.direction === "PAID" ? v.amount : "", credit: v.direction === "RECEIVED" ? v.amount : "",
      description: v.note || (v.direction === "RECEIVED" ? "Payment received" : "Payment made"),
      partyName: party.name, status: "POSTED", allowDuplicate: true, clientToken: v.clientToken,
    });
    refresh(partyId);
    return { saved: r.status === "saved" };
  });
}
