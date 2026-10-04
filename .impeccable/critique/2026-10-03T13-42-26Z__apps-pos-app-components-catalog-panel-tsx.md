---
target: ویرایش محصول component in Manager dashboard → catalog
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-10-03T13-42-26Z
slug: apps-pos-app-components-catalog-panel-tsx
---
# Critique: Manager → Catalog → «ویرایش محصول»

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 2 | Saving shows a busy state, but success/error feedback is not clearly anchored in the drawer. |
| 2 | Match System / Real World | 2 | “نمایش در POS/منو” does not clearly distinguish active status from sellable availability; weighted price lacks its unit. |
| 3 | User Control and Freedom | 2 | The only visible exit is ×; unsaved edits can be abandoned without a clear cancel path or warning. |
| 4 | Consistency and Standards | 3 | Persian RTL controls and familiar form conventions are mostly consistent. |
| 5 | Error Prevention | 2 | Required fields and numeric minimums help, but option bounds and price semantics remain easy to misconfigure. |
| 6 | Recognition Rather Than Recall | 3 | Fields are labeled and current values appear; category choice and option overrides still need context. |
| 7 | Flexibility and Efficiency | 2 | Catalog maintenance is one product at a time, with no evident keyboard shortcut or batch path. |
| 8 | Aesthetic and Minimalist Design | 2 | The drawer combines product settings, option configuration, image upload, and archive in a long scroll. |
| 9 | Error Recovery | 2 | Upload progress exists, but failed product saves may rely on parent-level messaging and state retention. |
| 10 | Help and Documentation | 1 | No contextual explanation clarifies weighted prices, prep time, selection bounds, or overrides. |
| **Total** |  | **21/40** | **Acceptable (52.5%)** |

## Design Specificity Verdict

The drawer is moderately specific to Run Cafe’s operational catalog: it uses Persian labels, Toman, preparation time, POS/menu settings, and product option groups. Its structure is otherwise a conventional admin form. The visible unit and status language should make café-specific decisions safer and more explicit.

## Cognitive Load and Emotional Journey

The drawer keeps the user in the catalog and progressively hides option details, which helps. Once expanded, option controls become dense; the category selector exposes 16 alternatives; and the two status checkboxes require users to infer the difference between “active” and “available.” “قیمت (تومان)” also leaves the weighted mode’s per-kilogram basis implicit.

The user can identify the task immediately. Uncertainty rises when interpreting status and pricing, then again at the end of the long form: save is visible, but the image/archive actions are separate and there is no clear cancel or unsaved-changes safeguard. This weakens confidence at the point of exit.

## What’s Working

- Product editing stays anchored to the catalog in a right-side drawer.
- Persian field labels, Toman pricing, and preparation time match day-to-day café work.
- Option groups are collapsed by default, keeping advanced settings out of the initial scan.

## Priority Issues

1. **[P1] Clarify product state labels.** “نمایش در POS” maps to `isActive`, while “نمایش در منو” maps to `isAvailable`; cards separately describe “فعال/غیرفعال” and “موجود/ناموجود.” These concepts are easy to conflate. Use labels that name the actual outcomes, and distinguish POS eligibility, public-menu visibility, and sellable availability according to the server rules. Suggested command: `$impeccable clarify`.
2. **[P1] State the weighted price unit.** The field remains “قیمت (تومان)” for both fixed and weighted pricing. When weighted mode is selected, display “تومان به‌ازای هر کیلو” and show a readable price summary. Suggested command: `$impeccable clarify`.
3. **[P1] Make closing safe and predictable.** The × is the only apparent exit; no unsaved-change prompt, Escape handling, or clear cancel action was observed. Add a labeled cancel/close action, preserve focus behavior, and warn before discarding dirty edits. Suggested command: `$impeccable harden`.
4. **[P2] Keep save feedback and recovery with the form.** The save action enters a busy state, but a clear saved/error result and retained values after failure are not evident inside the drawer. Anchor feedback to the editor and retain entered data on failure. Suggested command: `$impeccable harden`.
5. **[P2] Separate the main edit from secondary actions.** Image upload and archive sit below the product form and have separate behavior. Clarify which action saves product fields, which uploads the image, and which archives; keep the primary save and close/cancel controls easy to reach during scrolling. Suggested command: `$impeccable layout`.

## Persona Red Flags

- **Alex (Power User):** Product-by-product editing makes repeated catalog cleanup slow. The 16-item category select and nested option controls add repeated navigation; no keyboard shortcut or batch workflow was evident.
- **Sam (Accessibility-Dependent User):** The dialog and fields have accessible names, which is a good base. Escape/focus-trap/return-focus behavior was not evident; expanded option groups create a long sequence of checkbox and numeric inputs. The status labels risk conveying the wrong state even to a screen-reader user.

## Minor Observations

- At 1280×720, the drawer and the page both show vertical scrollbars.
- The native file chooser displays English “No file chosen / Choose File” inside the Persian editor.
- Several product cards visible behind the drawer showed broken-image icons; this is outside the editor itself but weakens catalog trust.
- No contrast measurement was performed; the screenshot was in the dark theme.

## Questions to Consider

- Can the editor name the three distinct outcomes—POS ordering, public-menu presence, and current sellability—without asking Managers to remember internal status flags?
- Could the weighted price unit and resulting customer-facing price be visible together while editing?
- Should image upload remain a separate action, or should the drawer make its save boundary unmistakable?
