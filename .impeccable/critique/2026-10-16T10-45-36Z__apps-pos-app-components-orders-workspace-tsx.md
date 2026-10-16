---
target: Payment dialog SettlementSheet
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-10-16T10-45-36Z
slug: apps-pos-app-components-orders-workspace-tsx
---
Method: dual-agent (A: /root/design_review · B: /root/evidence_review)

# Payment dialog critique

The wording is clearer, and the simple dialog fits desktop and mobile. The largest remaining problems are payment-entry guardrails and small touch controls. Copy changes alone do not resolve them. Overall score: 26/40.

## Design specificity

The dialog belongs to this POS: Persian RTL, Toman, unpaid quantities, selected-item payments, and mixed methods all support actual café work. Cream and sage match the incumbent interface. Preserve that identity. The generic bag/accounting icons add little, but do not warrant a redesign.

The independent detector returned [] with exit code 0: zero whole-file or settlement-specific findings. That result covers its implemented rules, not financial UX or accessibility. Manual inspection found issues outside the detector's coverage.

## Heuristic scores

| Heuristic | Score /4 | Main finding |
|---|---:|---|
| Visibility of system status | 3 | Clear total and mismatch feedback; zero tender can still look ready. |
| Match with real world | 3 | Natural café terminology; Persian amount digits are stripped. |
| User control and freedom | 3 | Cancel, close, Escape and removal work; mixed amounts can be overwritten. |
| Consistency and standards | 3 | Coherent RTL styling; disabled stepper looks enabled. |
| Error prevention | 2 | Aggregate equality does not validate every tender. |
| Recognition rather than recall | 3 | Items and counts visible; table identity missing in heading. |
| Flexibility and efficiency | 2 | Fast default card payment; mixed splits require extra correction. |
| Aesthetic and minimalist design | 3 | Calm hierarchy; mixed mode repeats monetary totals. |
| Error recovery | 2 | Drafts persist; actual server recovery paths were not exercised. |
| Help and documentation | 2 | Useful mismatch advice; new zero tender lacks next-step guidance. |
| Total | 26/40 | Acceptable, with material operational friction. |

## What works

- A prominent amount with an explicit Toman unit gives staff an immediate reference.
- Item selection, unpaid count and quantity adjustment stay together.
- Reconciliation uses explanatory text and a checkmark as well as color.

## Priority issues

1. **P1 — A zero-value payment method appears ready to submit.** Browser-observed: adding a method to a fully allocated card payment creates cash 0, while the matching-total message and enabled submit remain. Aggregate equality is the only readiness check. Treat retained zero rows as unfinished and explain that staff must enter an amount or remove the row. This finding concerns misleading frontend readiness; no payment was submitted and server acceptance was not tested. Sources: orders-workspace.tsx:1733,1851,1855. Suggested workflow: $impeccable harden.

2. **P1 — Persian amount entry is silently removed.** Source-confirmed: the field retains only ASCII 0-9. Native Persian digits therefore disappear rather than becoming a valid amount. Normalize Persian and Arabic digits and supported separators before validation. This was not typed live. Source: orders-workspace.tsx:1870. Suggested workflow: $impeccable harden.

3. **P2 — Item and quantity controls are too small for dependable touch use.** Browser measurements at 390x844 confirm 26x26 item selection and 32x32 quantity buttons. Use at least 44x44 hit areas while retaining compact symbols. Disabled plus also uses the same foreground/background as enabled controls; add a clear disabled treatment. Sources: globals.css:5481,5488,5489. Suggested workflow: $impeccable adapt.

4. **P2 — Item changes overwrite the first amount in a mixed payment.** Source-confirmed: when the selected total changes, the effect replaces the first tender with the whole new total while preserving later tenders. That destroys a deliberate split and creates a new mismatch. Agree on the adjustment rule before implementing it; preserve intentional entry and explain any resulting mismatch. Not exercised live. Source: orders-workspace.tsx:1738. Suggested workflow: $impeccable shape, then clarify the chosen behavior.

5. **P2 — The heading loses table context.** The dialog shows only the daily order number; the physical table remains in the dimmed background. Put table or takeaway identity next to the order number so interrupted staff can verify which bill they are recording. Source: orders-workspace.tsx:1807. Suggested workflow: $impeccable clarify.

## Cognitive load and emotional journey

The default sequence is easy to scan: selected amount, item, payment method, submit. Mixed payment adds several amounts to reconcile, starting with a fully allocated first tender and an empty second one. No payment-method decision has more than three options. The main load is arithmetic and unexpected amount replacement, not too many menu choices. Opening feels calm; the mixed-payment readiness signal creates false reassurance. Completion feedback was not tested.

## Persona red flags

- Busy cashier: the default card flow is quick, but adding a second method requires correcting the already-full first amount.
- Touch operator: small item selectors and steppers increase missed taps; the disabled plus still looks actionable.
- Interrupted staff member: the dialog omits table identity, and item changes may replace a carefully entered split.

## Minor observations and limits

Editable 255000 and displayed 255,000 use inconsistent grouping. The same accounting icon appears for every method. Initial focus goes to close; focus trapping and return focus remain unverified, not confirmed defects. Desktop 1280x720 and mobile 390x844 default one-item views fit with footer visible. A development badge overlaps the mobile button edge; this is not established as a production defect. Long lists, keyboard-open mobile, historical corrections and server-error/success paths remain untested.

## Questions to resolve

- After changing selected items in a mixed payment, should all entered amounts remain fixed for manual reconciliation, or should one designated method absorb the difference?
- Should the next pass fix payment-entry safeguards first, touch controls first, or both together?
