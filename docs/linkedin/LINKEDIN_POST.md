# LinkedIn post: KusBill

**How to post:** choose *Add a document* (not photo) and upload `KusBill-carousel.pdf`. LinkedIn shows it as a swipeable carousel. Paste the text below as the post, and set the document title to "KusBill: replacing a paper billpad".
Prefer single images? Use `slide-1.png` to `slide-9.png` (1080 x 1350, the best portrait size for the feed). Lead with `slide-1.png`.

---

## Post text (copy from here)

My uncle runs a small shop in Nepal. Every sale, payment and balance lives on a paper billpad: Date, Bill No., Debit, Credit, Balance.

It works, until one wrong addition makes every balance after it wrong, or a page gets lost.

So I built him KusBill, a billing and ledger app that looks and feels like the pad he already knows, but never adds up wrong. It's live in production.

What it does (swipe through the screenshots):

→ Type a bill exactly like the pad. Bikram Sambat (Nepali) or English dates, with a calendar picker. Duplicate bill numbers are flagged before you save.
→ A running balance that can't drift. Balances are calculated from the full history, never stored, so fixing an old entry updates everything after it.
→ Parties: every customer and supplier gets their own ledger, with "who owes me" aged by 30 / 60 / 90 days and one-step payment recording. This came straight from my uncle's first question: "How much does Ram Traders owe me?"
→ Print it like the pad (brought-forward and carried-forward totals) or export to PDF, Excel and CSV. Profit and loss and a trial balance come from balanced journals.
→ Nepali language with proper Nepali PDFs, a phone-friendly layout, and an encrypted offline queue so entries survive the internet dropping.
→ Import old records from Excel, CSV or a typed PDF, so he can carry on from where the paper left off.

Under the hood: Next.js 15, TypeScript, PostgreSQL with Prisma, Zod, Tailwind, and 148 automated tests that run against a real database, because when money is involved I want boring and provable.

What I learned:
1. Start from the real paper process. People adopt software that feels like what they already do.
2. Make wrong states impossible, not just unlikely.
3. Ship to a real user early. Their questions write your roadmap.

Next up: daily cash closing, automatic email backups, and a party column in imports.

If you run or know a small shop that still lives on paper, I'd love to hear what would make this useful for them.

#SoftwareEngineering #NextJS #TypeScript #PostgreSQL #Nepal #SmallBusiness #BuildInPublic #WebDevelopment #Fintech

---

## Shorter version (if you want something quick)

I replaced my uncle's paper billpad with software.

KusBill keeps the familiar Date / Bill No. / Debit / Credit / Balance layout, but calculates every balance from the full history so it can never drift. It has customer ledgers with "who owes me", Nepali language and PDFs, offline entry, and imports from Excel or PDF.

Built with Next.js, TypeScript and PostgreSQL, with 148 tests against a real database. Screenshots in the carousel.

#NextJS #TypeScript #Nepal #BuildInPublic

---

## Tips before you post

- **Tag people carefully.** Naming your uncle's shop or showing real customer names is a privacy risk. These slides use demo data ("Kus Traders", "Ram Traders") only, so keep it that way if you add screenshots.
- **Don't share the live link with data in it.** Share the site address only if sign-up is open and you're happy for strangers to create accounts.
- **First comment idea:** "Happy to share how the offline queue and the balance calculation work. Which would you like to read about?"
- **Best time:** a weekday morning in your audience's time zone.

## Slide list

| # | Slide | What it shows |
|---|-------|---------------|
| 1 | Cover | Headline and the live ledger |
| 2 | The problem | A paper billpad with a wrong balance |
| 3 | Familiar on purpose | Billpad-style entry form |
| 4 | Numbers you can trust | Ledger with running balance |
| 5 | Parties | Who owes you, and a party's page |
| 6 | Reports | Billpad-style print |
| 7 | Built for the real shop | Nepali, phone and offline |
| 8 | Under the hood | Stack and numbers |
| 9 | What I learned | Closing lessons |
