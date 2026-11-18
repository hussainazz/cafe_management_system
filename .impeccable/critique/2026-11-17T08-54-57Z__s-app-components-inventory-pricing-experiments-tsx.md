---
target: pricing experiment page and inventory navigation
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
p2_count: 6
audit_score: 14
audit_max_score: 20
timestamp: 2026-11-17T08-54-57Z
slug: s-app-components-inventory-pricing-experiments-tsx
---
Method: dual-agent (A: /root/design_review · B: /root/technical_audit)

Review of the pricing-experiment page and inventory navigation at http://localhost:3002/pos, 17 November 2026. This is an Operate surface. No interface fixes were applied.

The charcoal and amber styling fits the approved inventory identity, and the financial report handles unknown costs honestly. The most urgent defect is functional: every pricing trend SVG renders only 22px high. Draft protection and Persian numeric entry also need attention before the page is dependable.

Design critique: 22/40, Acceptable.

| Heuristic | Score /4 | Main evidence |
|---|---:|---|
| System status | 3 | Loading, errors and result state are visible; save lacks a specific busy label. |
| Real-world fit | 2 | Persian, Toman and Tehran fit; Persian numeric entry fails. |
| User control | 2 | Disclosures and removable rows help; section changes discard drafts. |
| Consistency | 3 | Coherent visual system; pricing omits neighboring editors' draft guard. |
| Error prevention | 2 | Bounds exist; implicit product defaults and weak input guidance remain. |
| Recognition | 2 | Duplicate product names and no category/current-price context. |
| Efficiency | 2 | Multiple targets, presets and CSV help; large selectors lack search. |
| Minimalist design | 2 | Long navigation and unavailable report sections burden scanning. |
| Error recovery | 2 | Alerts announce errors but do not identify the invalid field or row. |
| Contextual help | 2 | Useful caveats; technical terms and missing corrective actions. |
| Total | 22/40 | Acceptable |

Technical audit: 14/20, Good within the inspected scope.

| Dimension | Score /4 | Main evidence |
|---|---:|---|
| Accessibility | 3 | Native controls, labels and data tables; shared unassociated errors. |
| Performance | 3 | No obvious heavy assets or effects; comparison edits launch requests immediately. |
| Responsive design | 3 | Mobile form reflows without page overflow; chart geometry is broken. |
| Theming | 3 | Scoped dark palette; some chart/status colors bypass tokens. |
| Implementation integrity | 2 | Sound financial disclosures; generic SVG rule and omitted draft integration. |
| Total | 14/20 | Good |

The implementation expresses a coherent café analysis system through Tehran dates, whole-Toman amounts, packaging economics, and explicit unknown costs. It fails functional integrity in chart sizing and draft handling. The deterministic detector returned [] with exit 0 across both reviewed TSX files: zero findings and no false positives to dismiss. That scan did not catch the browser-confirmed defects.

Priority issues:

1. [P1] All five trend charts are compressed to 22px high.
   Location: apps/pos/app/globals.css:6366 and :6625; inventory-pricing-experiments.tsx:102.
   The generic .inventory-workspace svg:not(.inventory-chart svg) icon rule overrides pricing chart height because it has greater specificity. At both 1280×720 and 390×844, each chart measured 620×22px. Its 720×160 viewBox needs about 138px height at that width. The drawing and labels become too small to read.
   Fix: scope 22px sizing to actual icons and preserve chart aspect ratio. Command: $impeccable harden.

2. [P1] Leaving pricing silently discards an unfinished draft.
   Location: inventory-workspace.tsx:103 and :219; inventory-pricing-experiments.tsx:137.
   Pricing receives no onDirtyChange callback, while sibling editors use the workspace guard. Browser reproduction entered an unsaved name, switched to sales channels, returned, and found an empty name with no confirmation dialog.
   Fix: register both forms with the existing dirty-state guard and retain recoverable draft values across remounts. Command: $impeccable harden.

3. [P2] Persian and Arabic numerals fail price/date validation.
   Location: inventory-pricing-experiments.tsx:59, :205, :237, :281; apps/pos/app/lib/tehran-date.ts:14.
   ASCII-only parsing rejects naturally entered values such as ۲۰۰۰۰ and ۰۸/۲۶. This is source-confirmed; forms were not submitted.
   Fix: normalize numeral sets and accepted grouping before strict validation, preserving whole-Toman limits. Command: $impeccable harden.

4. [P2] Product choices are ambiguous in a large catalog.
   Location: inventory-pricing-experiments.tsx:50, :279 and :315.
   The live catalog contains duplicate names. Plain name-only selectors and an implicitly selected first product do not give enough context to review the target.
   Fix: distinguish category and current price, add search, and start with an explicit selection. Packaging labels already include category context. Command: $impeccable clarify.

5. [P2] The navigation groups remain one long horizontal strip.
   Location: inventory-workspace.tsx:194; globals.css:6375.
   The rail measured 1560px within 1190px available on desktop, and 1448px within 313px on mobile. This is contained internal scrolling, not document overflow, but important destinations and the active section can be outside the visible slice.
   Fix: use a visible management/analysis choice followed by that group's destinations. Preserve role rules. Command: $impeccable layout.

Additional actionable findings:

6. [P2] Shared errors do not identify the invalid row or field.
   Location: inventory-pricing-experiments.tsx:202, :206, :240 and :260.
   Generic errors above the whole task force users to inspect several target rows. role=alert announces the message, but controls lack aria-invalid and error associations.
   Fix: give row-specific inline feedback, connect it with aria-describedby, and focus the first invalid control. Command: $impeccable harden.

7. [P2] Custom comparison edits immediately request intermediate values.
   Location: inventory-pricing-experiments.tsx:182–194 and :296.
   Clearing the field becomes Number("") = 0 and starts a request. min/max do not gate the effect. Request IDs prevent stale display but do not cancel work.
   Fix: validate integer 1–90 before requesting; use Apply or a debounced committed value. No runtime performance benchmark was taken. Command: $impeccable optimize.

8. [P2] Inconclusive reports lack a short route to readiness.
   Location: inventory-pricing-experiments.tsx:300, :391 and :413.
   The saved report correctly says the result is inconclusive, then shows extensive unavailable analytics while detailed history/cost blockers sit lower down.
   Fix: put missing-history, cost-coverage and comparison-period actions beside the assessment; collapse unavailable detail and define contribution once. Command: $impeccable clarify, then $impeccable distill.

Cognitive load is high in the expanded form. Users must distinguish two duration concepts, choose among a large catalog, and remember product and prior-price context. The visual grouping and disclosures help, but they do not remove those decisions.

The emotional journey begins with a calm palette and reassurance that analysis does not change menu prices. It becomes harder at target selection and inconclusive results, and draft loss can break trust.

Persona red flags:
- A first-time analyst must interpret expected evaluation duration versus comparison duration and technical report terminology.
- A keyboard or screen-reader user gets useful native controls and tables, but shared errors do not locate the offending control. A full assistive-technology walkthrough was not run.
- An interrupted café operator loses a draft when consulting another inventory section and may struggle to distinguish identically named products.

Strengths to retain:
- Unknown costs remain unknown, with explicit inconclusive results and line-gap explanations.
- Consistent charcoal/amber identity, Persian RTL, Toman and Tehran dates.
- Labeled controls, native disclosures, 44px form fields, named scroll regions, daily data tables and CSV.
- Mobile form reflow worked in the inspected state without page overflow. No captured console warnings/errors.

Minor observations:
- Supporting labels use approximately 10–12px text. Increase important guidance within the existing hierarchy.
- Refresh/CSV buttons measured 42px high, below the project's 44px preference but not automatically a WCAG 2.5.8 failure.
- A few chart and status colors should use semantic tokens.
- The saved selector's empty option says no experiment exists even when saved experiments are listed.

Recommended order: $impeccable harden for chart geometry, drafts, numeric entry and error handling; $impeccable layout and $impeccable clarify for navigation and target context; $impeccable optimize for comparison requests; $impeccable distill for unavailable reports; finish with $impeccable polish and rerun the audit.

Questions for a subsequent fix pass:
- Should fixes begin with reliability issues, or include navigation and report structure in the same pass?
- Should the initial pricing view prioritize reviewing a saved experiment or creating a new one?
