---
target: product options section in the POS catalog editor
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-10-03T16-34-35Z
slug: apps-pos-app-components-catalog-panel-tsx
---
### Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|---:|---|
| 1 | Visibility of System Status | 2 | Unselected groups/options still expose editable dependent values, so the effective configuration is unclear. |
| 2 | Match System / Real World | 3 | Group, option, minimum/maximum, and Toman override concepts fit the Manager's task. |
| 3 | User Control and Freedom | 3 | The disclosure rows, Save, and Cancel provide useful control. |
| 4 | Consistency and Standards | 2 | Parent group and nested option controls do not make their dependency hierarchy visually strong. |
| 5 | Error Prevention | 1 | The interface does not show how invalid min/max relationships or inactive overrides will be handled before saving. |
| 6 | Recognition Rather Than Recall | 2 | The paragraph explains the rules, but users must remember them while configuring each group. |
| 7 | Flexibility and Efficiency | 2 | Long groups become dense repeated rows without a quick summary of selected options. |
| 8 | Aesthetic and Minimalist Design | 2 | Compactness helps, but the dense paragraph and repeated price placeholders compete with choices. |
| 9 | Error Recovery | 2 | Save errors have a status area, but local guidance for correcting group-level settings is not evident. |
| 10 | Help and Documentation | 2 | The section has help text, but it is a single block rather than guidance attached to each decision. |
| **Total** | | **21/40** | **Needs focused refinement** |

### Design Specificity Verdict

**LLM assessment:** The section is clearly about attaching reusable option groups to a catalog product, choosing permitted options, setting selection limits, and overriding prices. That is appropriate to a café Manager's catalog workflow. The main weakness is operational clarity: the user must infer which fields will actually be saved when a parent group or option is unchecked.

**Deterministic scan:** `detect.mjs` returned `[]` for `apps/pos/app/components/catalog-panel.tsx` (0 findings). The detector found no rule violations; this does not cover the dependency-state or validation issues found through interface review. No false positives were reported.

**Visual evidence:** The selected browser view shows the product editor in its dark theme. A separate browser pass reached the Manager catalog and expanded an option group. Long rows and the relationship between group selection, option selection, limits, and price overrides are difficult to scan. No detector overlay was displayed.

### Overall Impression

The necessary controls are all present in one editor, and Save/Cancel are clear. The section shifts from understandable to risky once a group is expanded: it shows many values without making the active configuration legible. The largest opportunity is to make parent-child state and the resulting saved configuration obvious.

### What's Working

- The heading and concise task framing identify this as product option configuration.
- Group inclusion, allowed options, selection limits, and per-product price overrides live together.
- The editor keeps Save and Cancel available, so the user can leave without saving.

### Priority Issues

**[P1] Dependent controls look active when their parent is off.** In the expanded group, an unchecked group still reveals editable limits, option checkboxes, and price fields; unchecked options can retain editable override inputs. Users may waste time editing values that are not part of the effective product configuration, or assume a change will be saved. Disable dependent fields until their parent is selected, or visibly mark them as excluded; disable each override until its option is allowed.

Suggested command: `$impeccable harden` — clarify dependency states in the product option editor.

**[P1] Min/max rules are not made clear at the point of entry.** Separate numeric controls show minimum and maximum, but the section does not explain the valid relationship or expose inline correction beside the pair. Invalid or surprising limits can make order entry behave differently than the Manager expects. Validate the pair in context and state the allowed range before save.

Suggested command: `$impeccable harden` — add clear paired validation for each group's selection limits.

**[P2] The help paragraph makes users retain too many rules.** The helper copy explains group inclusion, allowed options, and selection counts in one dense block above the disclosures. Users must keep it in mind as they move through long groups. Split the guidance into short instructions beside the group toggle and selection-limit fields.

Suggested command: `$impeccable clarify` — make the product-options instructions scannable and local to each decision.

**[P2] Price override meaning disappears after entry.** “قیمت جایگزین (تومان)” is a placeholder, so it vanishes when a value is present. A Manager then has to recall whether a number is inherited or overrides the base option price. Add a persistent label and a visible inherited/overridden state.

Suggested command: `$impeccable clarify` — make option price inheritance and overrides explicit.

**[P2] Long option groups are hard to scan.** Repeated option names, checkboxes, and price inputs crowd the narrow editor, especially in larger groups such as syrup. Improve row separation and alignment so names, selection state, and prices can be read quickly.

Suggested command: `$impeccable layout` — improve scanability of expanded option groups while preserving the existing RTL form.

### Persona Red Flags

- **Alex, Manager configuring a large group:** Can miss whether an unchecked option's override is active and must inspect many repeated rows to confirm the setup.
- **Sam, Manager working quickly between service tasks:** Has to reread the explanatory paragraph and remember its rules while switching between groups.
- **Keyboard or screen-reader user:** The visible parent-child relationship may not be obvious while tabbing through checkboxes and override fields; verify that each price input remains clearly associated with its option and that inactive controls are skipped or announced as unavailable.

### Minor Observations

- The selected dark-theme screenshot shows muted helper text above a dense group list; long content further reduces scanability.
- The numeric controls expose per-field bounds (`min=0` and `min=1`), but those alone do not explain the valid relationship between the two values.
- `detect.mjs` did not flag these semantic and workflow concerns.

### Questions to Consider

- Should an option price be editable before its option is selected?
- Should an enabled group show a compact summary of its selected options and limits before saving?
- Can the Manager understand the final order-entry behavior without rereading the paragraph?
