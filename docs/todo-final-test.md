# Local TODO final-test handoff

The combined implementation is on `codex/todo-final-test`, in the managed `todo-final-test` worktree. Tasks #2–6 and #8–13 are implemented; #1 and #7 are excluded. `main` remains at `3c16a032af2e089af9afcf478ccea06295481da0`. No push, deployment, or development/production database mutation was performed. Task branches and worktrees are retained for acceptance.

## Behavior

- Active unavailable products are orderable in POS; archived products and unavailable option restrictions remain. Open unpaid/partially paid takeaway editing follows existing settled-item restrictions. Recent per-product notes are saved locally after successful writes (20 unique notes). Displayed quantity totals use the existing authoritative prices.
- Manager shift presets use Tehran settlement recording time: all, 08:00 inclusive to 16:00 exclusive, or 16:00 inclusive through the end of the selected dates. History and accounting receipts use the same filter; sales retain their order-creation metric.
- Customer receipts have no paid-item strikethrough. Bar preparation snapshots are acknowledged on the server after `afterprint`; additions/increases print as deltas, unchanged content reprints fully, and reductions issue no cancellation. A cancelled dialog can count as printed. Exact snapshot acknowledgments cannot mark later additions printed or regress a newer baseline.
- Recovery restores user-scoped browser-session work after authoritative reads, preserves retry identities without replaying writes, waits for connectivity and active requests/printing, and permits one reload per episode. Stale/closed/deleted order edits remain available for explicit review. Storage failure prevents destructive reload. Successful saves acknowledge their new version before remount.
- Compact POS panels/dialogs scroll at 469×343. Only the accounting card is sticky on suitable desktop viewports; small viewports use normal flow. The table section retains an accessible name without its visible heading.

## Verification

- Isolated API suite: 16 files / 102 tests passed. All 27 migrations applied during the authorized isolated reset.
- Final POS suite: 18 files / 87 tests passed. Contracts build and API/POS typechecks pass. POS production build and final diff checks pass.
- Live managed Chrome checks used synthetic Staff/Manager accounts against the isolated test API. Both roles were checked at 469×343, 390×844, and representative desktop sizes. Ordering, editing, payment and historical dialogs were reachable with document widths matching viewports. Desktop accounting stickiness preserved its initial grid position.
- Live recovery verified an editable restored quantity-two draft and note, payment amount restoration without submission, repeated-failure reload guard, and Manager shift-filter restoration, and Manager-to-Staff login isolation. Mounted regressions additionally cover stale/closed/deleted orders, uncertain-write keys, storage failures, offline waiting and active-print delay.
- Browser print acceptance inspected actual receipt/ticket documents and simulated `afterprint` against real preparation/acknowledgment endpoints. It does not prove a physical printer produced paper.

## Migration and acceptance

New migration: `20261002000100_bar_ticket_preparation`. It adds order baseline JSON/sequence fields and `bar_ticket_preparations`. A future release must include matching API, contracts, POS artifacts and migration; no production migration is authorized by this handoff. Fresh application was rehearsed only in `cafe_management_test`; populated production upgrade/restore rehearsal remains a release gate.

Manual acceptance before accepting the branch:

1. On the café POS browser/device, create and partially pay an open takeaway; edit eligible quantities, add an unavailable active product, reuse a remembered note, and confirm totals.
2. Compare payment history and receipt totals across shift boundaries and dates using representative café settlements.
3. Physically print full/customer/payer receipts, then bar additions/increases and an unchanged reprint; verify Persian glyphs, 80 mm layout, cancelled-dialog acknowledgment and a second POS device.
4. Exercise a real temporary connection loss with unsaved work and payment inputs; confirm restoration and no duplicated submission.

`docs/current-left.md` keeps historical Left items and separates implementation/browser verification from physical-device and release acceptance. `TODO.md` remains the repository’s ignored local checklist; task numbers are preserved.
