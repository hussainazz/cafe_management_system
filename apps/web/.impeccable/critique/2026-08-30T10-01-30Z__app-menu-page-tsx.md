---
target: the /menu page
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-30T10-01-30Z
slug: app-menu-page-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3/4 | Deferred search has no explicit updating feedback. |
| 2 | Match System / Real World | 3/4 | The unlabeled `+` does not clearly mean product options. |
| 3 | User Control and Freedom | 3/4 | Product dialog does not restore focus to its trigger. |
| 4 | Consistency and Standards | 3/4 | Faded unavailable cards make their affordance ambiguous. |
| 5 | Error Prevention | 3/4 | Browse-only design prevents high-risk actions. |
| 6 | Recognition Rather Than Recall | 3/4 | Options are not visibly labeled on mobile. |
| 7 | Flexibility and Efficiency | 2/4 | Detail dialog has no keyboard focus return. |
| 8 | Aesthetic and Minimalist Design | 3/4 | Hero slightly delays menu utility after a QR scan. |
| 9 | Error Recovery | 3/4 | Error state has retry, but no richer recovery cue. |
| 10 | Help and Documentation | 2/4 | No clear cue that item options are informational, final-price variants. |
| **Total** | | **28/40** | **Solid, distinctive foundation; mobile scanability refinements needed.** |

## Design Specificity Verdict

The menu feels authored for Run Cafe: its amber-on-charcoal palette, coffee-orbit motif, Persian RTL typography, product imagery, and intimate footer avoid generic ordering-template language. The searchable card directory becomes more standard in the middle of the journey.

The deterministic detector reported zero findings for `app/menu/page.tsx` and `components/menu-experience.tsx`. Browser overlay evidence could not run because the browser runtime returned `No browser is available`.

## What's Working

- Sticky search, category jumps, continuous sections, and product sheets fit rapid in-cafe discovery.
- The dark, warm visual language is coherent and appropriately restrained.
- Browse-only scope discipline is excellent: no cart, payment, or false ordering affordances.

## Priority Issues

1. **[P1] Options are discoverable but not legible.** The card `+` has only a hover title, which phones do not expose. Replace it with a visible Persian options label and count; make option-group pricing explicit. Suggested command: `$impeccable clarify`.
2. **[P1] Availability is too muted.** The unavailable-card opacity and tiny badge risk poor readability under cafe lighting. Keep normal contrast and use a clear status chip near the name or price. Suggested command: `$impeccable harden`.
3. **[P2] The mobile hero delays utility.** Preserve the distinctive orbit but merge/compress the hero so search and categories arrive faster. Suggested command: `$impeccable layout`.
4. **[P2] Detail-dialog focus behavior is incomplete.** Trap focus, restore focus to the triggering card, and provide an accessible description for options. Suggested command: `$impeccable audit`.
5. **[P3] The category body loses visual momentum.** Use one subtle editorial treatment for a truly distinctive catalog-backed item per category, without inventing recommendations. Suggested command: `$impeccable delight`.

## Persona Red Flags

- **Jordan, first-time QR visitor:** cannot infer the meaning of the `+` badge and may not know whether a faded unavailable card is tappable.
- **Neda, low-vision customer in a dim cafe:** small metadata and faded unavailable cards are difficult to scan.
- **Reza, hurried regular:** search and categories work well, but the hero adds a beat before utility and focus does not return to the scanned item after closing a dialog.

## Minor Observations

- `Loading menu` remains English in an otherwise Persian surface.
- Search/category changes do not announce changing results to assistive technology.
- Product-card accessible names omit availability and option presence.

## Questions to Consider

- Should the first ten seconds optimize for immediate coffee discovery or a more editorial Run Cafe moment?
- Should option sheets show the exact final total of each possible variant, or frame them only as choices to request from staff?
