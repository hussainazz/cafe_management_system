---
target: new POS inventory and gross-profit UI
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-10-13T09-14-27Z
slug: apps-pos-app-components-inventory-workspace-tsx
---
Method: dual-agent (A: /root/design_review · B: /root/detector_review)

## Design health score

| # | Heuristic | Score | Main issue |
|---|---|---:|---|
| 1 | System status | 2 | Draft creation and posting are easy to confuse |
| 2 | Real-world language | 3 | Most terms match café work; a few labels do not |
| 3 | User control | 2 | Posting lacks a review step |
| 4 | Consistency | 3 | Forms follow the POS pattern |
| 5 | Error prevention | 2 | Free-text component keys and direct posting invite mistakes |
| 6 | Recognition over recall | 2 | Recipe rules require remembering internal keys |
| 7 | Efficiency | 2 | Dense nested navigation slows frequent tasks |
| 8 | Minimal design | 2 | The report and recipe editor present too much at once |
| 9 | Error recovery | 2 | Form errors appear, but high-impact actions need clearer review |
| 10 | Help | 2 | Hints exist, but do not explain the next step at key decisions |
| **Total** | | **22/40** | **Acceptable** |

## Design specificity verdict

Run Cafe's Persian RTL layout, Toman values, inventory terms, and restrained palette are specific to the café. Repeated cards become a generic admin pattern in dense forms. The independent CLI detector found zero issues in inventory-workspace.tsx. The live browser showed workflow problems that the detector does not check. Browser mutation was blocked, so no overlay was injected.

## Overall impression

The feature is functional and coherent, but its high-impact steps need clearer state, review, and choices. The largest opportunity is to make draft creation, posting, and recipe component selection unambiguous.

## What's working

- Purchase drafts and posted receipts have distinct history states.
- The profit report explains estimated consumption and incomplete costing.
- Loading, empty, and error states are present across the workspace.

## Priority issues

1. **P1 — Ambiguous purchase creation.** "ثبت خرید" creates a draft while "ثبت رسید" posts value to inventory. Rename the draft action and state the next step. Suggested command: `$impeccable clarify`.
2. **P1 — Posting lacks contextual review.** Purchase and count posting act immediately without showing quantities, cost, differences, or absorbed pending orders together. Add a concise review confirmation. Suggested command: `$impeccable harden`.
3. **P1 — Recipe rules require internal-key recall.** The free-text component key is not shown in the recipe editor. Select a current component by readable name and keep its key secondary. Suggested commands: `$impeccable clarify`, `$impeccable distill`.
4. **P2 — Report table is cramped.** The six-column table needs horizontal scrolling even on a desktop viewport. Give totals clear priority and allocate full width to product results; signal narrow-screen scrolling. Suggested commands: `$impeccable layout`, `$impeccable adapt`.
5. **P2 — Navigation and dialog state are under-announced.** The active inventory section is visual only, and the archive dialog lacks focus management. Add programmatic state and keyboard handling. Suggested command: `$impeccable harden`.
6. **P2 — Several labels and defaults mislead.** Correct the repeated packaging word, describe purchase quantity using the selected unit, and update the packaging default when base unit changes. Suggested command: `$impeccable clarify`.

## Cognitive load and emotional journey

Four checks fail: single focus, minimal choices, one thing at a time, and progressive disclosure. Six nested inventory sections sit below the Manager navigation. Recipe costing presents base method, option rules, combination rules, and preview together. The entry is calm; purchase and count posting are the anxiety point because financial effects are not reviewed. The report ends with useful cost-coverage explanations.

## Persona red flags

- **Jordan, new Manager:** May take "ثبت خرید" to mean the stock and cost have already been posted.
- **Sam, keyboard or screen-reader user:** Cannot hear the active inventory section and may lose focus in the archive dialog.
- **Alex, busy Manager:** Must scan dense recipe controls and scroll a product report horizontally.

## Minor observations

The packaging error repeats "بندی". The default kilogram conversion remains after a base-unit change. "Number of packs" can be wrong when the purchase unit is grams.

## Provocative questions

Would the purchase screen be easier to trust if it stated "draft" before every consequential step? Can each recipe rule begin with a named ingredient rather than an internal key?
