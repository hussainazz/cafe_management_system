---
target: takeaway panel (opened tab)
total_score: 19
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 2
timestamp: 2026-10-03T14-44-12Z
slug: apps-pos-app-components-orders-workspace-tsx
---
# Takeaway unpaid-order queue critique

**Target:** POS takeaway unpaid-order queue in `apps/pos/app/components/orders-workspace.tsx`, styled in `apps/pos/app/globals.css`. Mode: Operate.

**Design specificity:** Persian labels and Toman balances fit Run Cafe's operational POS. The full-width repeated rows are familiar and easy to tap, but the panel feels like a separate list appended to the workspace rather than a fast path for managing active takeaway orders.

**Heuristic scores**

| Heuristic | Score | Evidence |
|---|---:|---|
| Visibility of system status | 2/4 | The heading says these are unpaid orders, and each row shows a remaining balance. No freshness or age cue is visible. |
| Match with the real world | 3/4 | Persian wording and Toman balances are clear, though order number alone offers little service context. |
| User control and freedom | 2/4 | Each order is a button; the queue itself has no visible search or filter. |
| Consistency and standards | 3/4 | The order rows use familiar button behavior and consistent styling. |
| Error prevention | 2/4 | The balance is visible before opening, but there is little to distinguish orders with similar balances. |
| Recognition rather than recall | 2/4 | Staff can scan order numbers and balances, but may need to remember which number matches the waiting order. |
| Flexibility and efficiency | 1/4 | Reopening an order is a one-at-a-time action; no faster selection path is apparent. |
| Aesthetic and minimalist design | 2/4 | The panel is visually calm, but its below-editor placement and tall, sparse rows slow scanning. |
| Error recovery | 2/4 | The queue shows the unpaid balance, but no freshness cue helps staff judge whether the displayed order state is current. |
| Help and documentation | n/a | A simple order queue does not need a separate help surface. |

**Total: 19/36 — Acceptable** (53% of applicable points).

**Cognitive load:** Three checklist failures: the queue is below the order-entry workspace rather than immediately available; the eight visible order choices exceed the four-item guidance; and sparse row details may make staff rely on remembered order numbers. The repeated button pattern helps users scan the list, but does not resolve the placement or identification problems.

**What's working**
- The heading **سفارش‌های پرداخت‌نشده** makes the list's purpose explicit.
- Each row shows a remaining balance before the order is opened.
- Large full-width buttons provide comfortable touch targets.

**Priority issues**
1. **[P1] Queue is below the entire editor.** At the current viewport, staff must pass the product workspace to reach the unpaid-order list. This adds a scroll when they want to resume an order. Keep the queue visible beside order entry or bring it closer to the top in takeaway mode.
2. **[P1] Rows offer little order-identifying context.** Each button shows only the order number and remaining balance. Add an operational cue already available to the POS, such as an item count or short item summary; do not add customer identity.
3. **[P2] Eight tall rows consume a lot of space.** The repeated full-width cards leave broad unused space and push lower orders further down. Use a denser row treatment or compact columns while preserving touch targets and balance legibility.

**Persona red flags**
- **Power user:** With eight choices and no visible filtering or shortcut, reopening a specific takeaway means scanning and opening orders one at a time.
- **Screen-reader or keyboard user:** The list is exposed as buttons under a heading, which supports recognition and keyboard access. The panel still offers limited identifying context when navigating the buttons.
- **Interrupted staff member:** The queue's below-fold location and order-number-only identification make it easier to lose place or reopen the wrong order when service is busy.

**Minor observation:** When the queue is empty, the message says “سفارش بازی نیست.” It states the condition but offers no visible next step.

**Questions to consider:** What cue do staff use to match an order number to the takeaway waiting at the counter? Should the queue remain visible while staff build a new takeaway order? Which should be addressed first: queue placement, order identification, or row density?
