---
target: POS inventory visual refresh
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-11-11T10-20-43Z
slug: apps-pos-app-components-inventory-workspace-tsx
---
Method: dual-agent (A: /root/inventory_critique_a; B: /root/inventory_critique_b).

# Inventory visual refresh critique

This is the pre-correction review of the implemented refresh. Assessment A
reviewed source and the four supplied references without detector findings.
Assessment B independently ran the detector and inspected implementation evidence.
The user waived browser inspection after both attempts reported an unavailable
browser access host. No rendered, device, contrast or overlay acceptance is claimed.

## Design specificity and overall impression

The design fits Run Cafe's operational product. It uses the existing POS theme,
Persian task names, actual balances, saved recipe previews and authoritative
full-payment profit reporting. It adopts useful table and summary composition
from the references without inventing daily trends, reorder forecasts or
previous-period comparisons. The primary opportunity is task transitions and
interpretable activity, rather than additional decoration.

The deterministic scanner returned zero findings for inventory-workspace.tsx,
inventory-dashboard.tsx and inventory-profit.tsx. There were no detector rules,
locations or false positives to classify. That result does not establish usability.

## Heuristic scores before corrections

| Heuristic | Score | Main evidence |
| --- | --- | --- |
| System status | 3/4 | Loading, success and incomplete-cost states; previews lack pending feedback. |
| Match with real-world tasks | 3/4 | Purchase lifecycle and Toman labels; recent movements omit units/types. |
| User control | 2/4 | Confirmation cancellation works; section switches discard unsaved forms. |
| Consistency | 3/4 | Shared theme/table patterns; duplicate recipe selectors. |
| Error prevention | 2/4 | Write safeguards retained; drafts lack section-navigation guards. |
| Recognition | 3/4 | Clear stock statuses; activity requires recall of units/context. |
| Efficiency | 2/4 | Search and sorting work; row-to-editor focus is missing. |
| Visual simplicity | 3/4 | Quiet metric band and tables; repeated selection controls. |
| Error recovery | 2/4 | Report retry works; missing purchase prerequisite error and destructive recipe reload. |
| Contextual help | 3/4 | Useful purchase, costing and coverage guidance. |
| Total | 26/40 | Acceptable; provisional source-based assessment. |

Assessment A independently scored 29/40. Synthesis reduces user control,
error prevention and recovery by one point each for concrete issues supplied
by Assessment B. No post-correction visual score is inferred.

## Strengths

- Unknown costs remain unavailable rather than zero-filled. Aggregate profit and
  margin never become reassuring invented figures.
- Purchase draft creation, review and posting remain distinct. Confirmation
  includes concrete line quantities and costs before inventory changes.
- Product selection is separate from ingredient work, and previews explicitly
  describe the saved recipe rather than unsaved form content.

## Priority issues and correction batch

1. **P1: Protect unfinished work.** Section navigation unmounts local forms;
   recipe recovery can clear edited fields. Guard section/product switches and
   page unloads. Expose configuration reload only for failed configuration reads.
   Suggested workflow: Impeccable harden.
2. **P1: Distinguish failed prerequisites from empty stock.** The default purchase
   view omits stock from the read-error dependency mapping. Show the stock-read
   error and retry rather than a prompt to add the first item.
   Suggested workflow: Impeccable harden.
3. **P2: Make actions visibly respond.** Focus the stock form after choosing an
   edit action. Add pending feedback and duplicate/stale-result protection to
   saved-recipe cost previews. Suggested workflow: Impeccable harden.
4. **P2: Make data interpretable.** Recent activity needs movement type, quantity
   unit and currency; return options need Persian units; negative profit bars
   need a text loss label. Identify the capped attention list explicitly.
   Suggested workflow: Impeccable clarify.
5. **P2: Reduce navigation friction.** Use one recipe selector per viewport;
   add table-scroll cues to stock/purchases/history; give movement history a
   labelled keyboard-focusable scroll region. Suggested workflows: Impeccable
   distill and adapt.

These findings are source-backed. Consequences involving viewport position,
clipping or mobile reach remain inferred because no browser render was available.

## Cognitive load and emotional journey

Seven destinations are reasonable persistent navigation for an existing
operational workspace. The duplicate product selection is unnecessary repeated
work. Four summary figures are appropriate; retain financial qualifiers rather
than removing explanations to make the layout smaller.

Arrival is calm and credible. Attention lists and product search reduce hunting.
Unlabelled activity creates uncertainty during investigation. Purchase review
provides reassurance at the consequential step. Success messaging supplies
closure, while row editing needs a clear focus transition.

## Persona findings

- Alex, the frequent manager, benefits from search and profit sorting but must
  hunt for the changed stock form and traverse repeated recipe selection.
- Sam, the keyboard/screen-reader user, benefits from labels, row headings,
  confirmation focus management and textual statuses. Stock editing needs a
  focus transition and movement history needs a focusable scrolling region.
- Casey, the interrupted mobile user, needs guarded drafts, discoverable table
  scrolling and one compact product-selection control. Source breakpoints are
  present; actual mobile composition has not been rendered.

## Minor observations

Show when only six attention items are displayed. Avoid implying that every
unknown movement item was archived; use an unavailable-name fallback. Normalize
new activity numerals consistently. Do not present this source review as a
light/dark contrast or physical café-terminal acceptance run.

Questions skipped: the user explicitly requested application of the relevant
recommendations, and the correction batch requires no additional design choice.

## Applied follow-up

All five priority groups were addressed in the authorized correction batch:
inventory-tab/page-unload guards, non-destructive recipe error recovery, stock
prerequisite retry, stock-editor focus, pending/duplicate/stale preview handling,
movement labels/units/currency, translated purchase-return units, explicit loss
labels, attention-list count, responsive single product selection and table
scroll cues/keyboard regions. Pending pagination is labelled as a lower bound.

Final verification: 207 POS tests pass across 30 files; production build and
standalone typecheck pass with Node 24.21.0; extracted Persian copy and whitespace
checks pass. The 26/40 score above describes the pre-correction source review.
No new score or rendered/browser acceptance is claimed. Browser verification was
explicitly waived by the owner.
