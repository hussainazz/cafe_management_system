---
name: Run Cafe POS inventory
description: Scoped charcoal and amber inventory system inside the shared POS.
colors:
  inventory-canvas: "#191c1b"
  inventory-surface: "#222524"
  inventory-raised: "#2b2d2b"
  inventory-inset: "#191c1b"
  inventory-hover: "#30322e"
  inventory-ink: "#f2efe8"
  inventory-muted: "#b7b5ad"
  inventory-line: "#454640"
  inventory-control-border: "#62625a"
  inventory-amber: "#e6ad60"
  inventory-amber-hover: "#f3c383"
  inventory-amber-soft: "#4c3923"
  inventory-profit: "#7ed4ac"
  inventory-success-soft: "#203c2e"
  inventory-warning: "#efb35d"
  inventory-warning-soft: "#4a3720"
  inventory-danger: "#f3978e"
  inventory-danger-soft: "#492926"
  inventory-focus: "#f4c27c"
  inventory-cost-series: "#aaa0dc"
typography:
  display:
    fontFamily: '"Manrope Digits", "Estedad", Tahoma, Arial, sans-serif'
    fontSize: "clamp(1.15rem, 1.7cqi, 1.4rem)"
    fontWeight: 700
    lineHeight: 1.6
  title:
    fontFamily: '"Manrope Digits", "Estedad", Tahoma, Arial, sans-serif'
    fontSize: "1.02rem"
    fontWeight: 700
    lineHeight: 1.7
    letterSpacing: "0"
  body:
    fontFamily: '"Manrope Digits", "Estedad", Tahoma, Arial, sans-serif'
    fontSize: ".85rem"
    lineHeight: 1.8
  label:
    fontFamily: '"Manrope Digits", "Estedad", Tahoma, Arial, sans-serif'
    fontSize: ".8rem"
    lineHeight: 1.8
rounded:
  control: "8px"
  table: "10px"
  card: "12px"
  workspace: "16px"
spacing:
  tight: "8px"
  row: "12px"
  compact-panel: "14px"
  section: "16px"
  panel: "20px"
components:
  button-primary:
    textColor: "#fff9ef"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "#282b28"
    textColor: "#e7e3db"
    rounded: "{rounded.control}"
    padding: "8px 13px"
  search-field:
    backgroundColor: "{colors.inventory-inset}"
    textColor: "{colors.inventory-ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  status-neutral:
    backgroundColor: "{colors.inventory-raised}"
    textColor: "{colors.inventory-ink}"
    rounded: "{rounded.control}"
    padding: "5px 9px"
  status-warning:
    backgroundColor: "{colors.inventory-warning-soft}"
    textColor: "{colors.inventory-focus}"
    rounded: "{rounded.control}"
    padding: "5px 9px"
  status-success:
    backgroundColor: "{colors.inventory-success-soft}"
    textColor: "#8ee0b6"
    rounded: "{rounded.control}"
    padding: "5px 9px"
  panel:
    rounded: "{rounded.card}"
    padding: "20px"
---

# Design System: Run Cafe POS inventory

## Overview

**Creative North Star: "Charcoal panels, amber actions"**

This document records the approved inventory exception inside Run Cafe POS. Its tokens apply only within the inventory workspace. The surrounding POS retains its incumbent light and dark themes, cream or espresso surfaces, and existing controls. Do not apply these inventory tokens to the global theme or unrelated screens.

The owner's supplied screenshots establish the visual authority: Image 4 for the overview, Image 1 for the stock inspector, and Image 2 for the profit report. The implemented world uses charcoal panels, amber actions, green profit, thin warm borders, Estedad and Persian RTL. Text and operational SVG icons identify inventory items. Product images are excluded throughout inventory. There is no generated concept, concept-roll seed, shipping raster asset, or raster provenance to record.

**Key Characteristics:**
- Inventory remains dark in both surrounding POS themes.
- Amber marks actions and selection; green and red support explicit operational values and status text.
- Persian RTL, Persian numbers, Toman labels and visible unknown values preserve accounting clarity.
- Bordered panels, tables and charts keep stock work accessible on desktop and phone.

## Colors

The inventory palette uses warm amber against green-tinted charcoal, with pale text and quiet warm dividers. Frontmatter values are normative for this scoped exception; gradients and interaction treatments live in the sidecar.

### Primary

- Inventory amber identifies operational icons, selection and focus-adjacent accents. The primary action itself uses the darker amber gradient recorded in the button snippet.
- Amber soft marks selected detail controls and recipe products. Amber hover is the scoped accent hover source.

### Secondary

- Profit green marks known positive profit and positive stock movement. Success-soft backgrounds support textual availability badges.
- Warning amber and its soft background identify Manager-defined shortage thresholds.
- Danger coral and its soft background identify negative values and error states.
- Cost-series lavender distinguishes theoretical material costs in the multi-series chart. It is a data-series color, not an action color.

### Neutral

- Inventory canvas and inset are the darkest layers for the workspace interior and editable fields.
- Inventory surface and raised provide panel and badge layers. The repeated panel gradient adds a small tonal change.
- Inventory ink carries main copy; inventory muted carries explanations, metadata and unavailable-value language.
- Inventory line divides panels and rows. Control border is stronger so editable fields remain identifiable.

**The Scoped Inventory Rule.** Keep this dark palette inside inventory, independent of the surrounding POS theme.

**The Accounting State Rule.** Keep an unknown amount visibly unknown. Use text alongside color for stock status, missing costs and negative values; never draw an unknown cost as zero.

## Typography

Persian text uses the bundled Estedad family. The inherited font stack starts with Manrope Digits for its restricted Latin-digit and punctuation range, then Estedad, Tahoma, Arial and sans-serif. Persian inventory digits therefore remain Estedad. The root size is (15px).

There is no inventory hero or separate display face. The frontmatter display role describes financial metric values, not marketing headings. Values use bold type, while table rows and descriptions stay compact.

### Hierarchy

- Display is the responsive metric value, with weight (700) and line-height (1.6). Its size follows the inventory container.
- Title is the recurring panel heading, with weight (700) and line-height (1.7). The workspace heading is slightly larger; compact chart headings use a smaller local size.
- Body describes empty states, activity names and supporting text. Paragraph line-height is (1.8), with longer panel explanations constrained to (85ch).
- Label is the recurring metric or filter label, with line-height (1.8). Status badges and table annotations use smaller supporting styles.

**The Numeric Clarity Rule.** Keep quantities and money paired with their units and Toman labels. Preserve bidirectional isolation where used and tabular numerals on numeric details and activity totals.

## Layout

The inventory workspace is an inline-size query container with no fixed desktop width. The surrounding manager workspace removes its usual maximum width when inventory is present. Desktop metrics form four columns, become two at the inventory container threshold (1050px), and become one at (420px).

Panel spacing commonly uses the frontmatter's tight, row, section and panel steps. Dense overview panels use compact-panel padding. Other manager panels use panel padding, reducing to section padding at the narrower container threshold (740px). The overview has a tighter vertical rhythm to keep stock content within the first desktop screen.

The stock workspace places a narrower inspector beside a wider table, with the inspector on the right in RTL. The inspector sticks at (12px) from the top. At the (1050px) container threshold the layout stacks and the inspector becomes static. The overview's charts and report sections use responsive grids rather than a fixed canvas. Secondary columns stack at the recorded container thresholds in the sidecar.

Tables keep a minimum width of (640px) inside keyboard-focusable horizontal scroll regions. Confine this overflow to the table region; the document itself must fit the screen. Tabs also scroll horizontally. Search and status controls wrap, with full-width fields at the smallest inventory size. Phone workspace padding is compact, and chart range/day controls remain available.

Charts have a left-to-right plotting area with RTL readouts, legends and controls. Preserve the SVG aspect ratio (680 / 225). At a chart container width of (420px) or less, interior date ticks disappear and SVG text enlarges in viewBox units so edge dates and axes remain legible.

## Elevation & Depth

Inventory uses tonal layers, small gradients and thin borders. Its recurring manager panels explicitly have no box shadow. Selection uses an amber fill and an inset outline; controls use a visible border and a keyboard focus ring. Do not replace this material with glass blur or decorative floating shadows.

**The Border and Tone Rule.** Use the panel border and charcoal tonal change to separate inventory regions. Keep recurring panels shadowless.

Keyboard focus is a (2px) warm outline offset by (3px). Hover brightens enabled buttons by the observed filter factor (1.12). Disabled buttons reduce opacity to (0.5). There is no inventory-specific animation system. The reduced-motion rule removes animations and transitions throughout inventory.

## Shapes

Controls and badges have gently rounded corners. Tables use a slightly larger enclosing radius, and cards have the repeated card radius. The outer workspace uses the workspace radius, reducing to the card radius on narrow viewports. Navigation tabs round only their upper corners. Fine one-pixel borders retain a clear table and field structure.

Small circular dots belong to chart legends and data observations. The stock inspector uses an outlined SVG inventory symbol inside a rounded amber-tinted square. Neither this symbol nor any other inventory identity uses a product photo.

## Components

### Buttons

Primary actions use a dark amber gradient, pale text, a warm border and semibold type. Secondary actions use a neutral charcoal fill with a stronger border. The primary and inventory action controls have a minimum height of (44px). Preserve the shared hover, focus and disabled treatments. The inspector's edit action spans its panel width.

### Chips

Status badges use short explicit text, soft fills and the control radius. The neutral badge denotes an unstarted or neutral state; warning and success variants have their own backgrounds and foregrounds. A colored badge must still state the stock condition.

### Cards / Containers

Recurring panels use the card radius, a one-pixel line border, the dark panel gradient and no shadow. Compact overview chart panels reduce padding; stock tables use a bordered scroll wrapper. Metric cards retain individual borders and subtle semantic gradients instead of a single joined strip.

### Inputs / Fields

Search and toolbar fields use the inset fill, stronger control border, inherited type and control radius. Search and status fields have a minimum height of (44px); compact chart and date controls use (40px). Preserve accessible labels even when their visible text is hidden. Use the same warm focus outline as buttons.

### Navigation

Inventory tabs use horizontally scrollable, non-wrapping labels and a minimum height of (44px). Inactive tabs are charcoal with muted pale text. The active tab has a dark amber gradient and warm border. Inspector tabs use a soft amber selected state with explicit pressed semantics. Preserve practical keyboard navigation and visible focus.

### Stock tables and inspector

Tables retain column headers, separated rows, textual statuses and a selected-row amber outline. Item-name buttons open the inspector. Quantity, value and threshold fields distinguish unrecorded, unvalued and unset states. The inspector repeats this information in a two-column definition grid, then gives the relevant Manager threshold explanation and movement history.

### Charts and report values

Use SVG charts, explicit legends, Toman and percentage labels, and selectable day controls. Multi-series trends distinguish amber sales, lavender costs and green gross profit. Compact gross-profit trends use amber, matching the built reference treatment. Missing daily costs split paths and leave a visible explanatory note. Isolated known margin observations remain visible as points. Category contribution describes its current-menu classification basis. Do not turn these charts into forecasts or automatic purchasing suggestions.

## Do's and Don'ts

### Do:

- **Do** keep inventory dark and scoped while preserving the surrounding light/dark POS identity.
- **Do** use Estedad, Persian RTL, explicit units, Toman labels and legible numeric alignment.
- **Do** preserve visible unknown-cost states and gaps in charts when costs are incomplete.
- **Do** retain focus outlines, keyboard-accessible scroll regions, day selectors and reduced-motion behavior.
- **Do** keep stock information, alerts and actions visible within the compact working layout.

### Don't:

- **Don't** add product images anywhere in inventory.
- **Don't** spread the inventory palette or screenshot compositions into unrelated POS screens.
- **Don't** replace operational status text with color alone or silently render unknown amounts as zero.
- **Don't** add glassmorphism, marketing heroes, decorative shadows or distracting animation to inventory.
- **Don't** infer forecasts, automatic purchasing, a generated concept seed or shipping raster assets from this build.
