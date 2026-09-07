# POS Frontend Design Direction

## Document Control

**Status:** design-direction baseline; implementation intentionally pending  
**Applies to:** `apps/pos`, the shared Staff and Manager POS only  
**Companion authorities:** `scope.md`, `roadmap.md`, ADR 0009, and
`current-left.md` remain authoritative for product scope, roles, business
rules, delivery order, and stage status.

This document records the POS visual direction. It does not authorize a
product-scope or backend-contract change.

## Purpose

The POS needs a deliberate operational identity rather than a generic admin
dashboard. It must make fast, safe Persian RTL service work legible during a
busy shift, while preserving the server as the authority for prices,
availability, permissions, totals, idempotency, and concurrency.

This is a documentation-first reset. No replacement UI code is implied by this
document. The user will provide an initial visual and experiential description
before implementation; the remaining design decisions may be developed
creatively inside the constraints below and presented for review in bounded
passes.

## Design Method

Use a narrow, evidence-driven design brief, inspired by Theo Browne's approach
to frontend-design context:

1. Keep permanent project and product rules in planning documentation, not in a
   broad generic frontend skill.
2. Load this design brief only when designing or substantially changing POS UI.
3. Make a purposeful visual direction before composing components. Typography,
   spatial hierarchy, density, contrast, interaction feedback, and motion are
   design decisions—not accidental defaults from a component library.
4. Produce meaningfully distinct directions when exploration is requested.
   Compare options in the same design context so later options deliberately
   diverge instead of repeating the first familiar dashboard pattern.
5. Turn the selected direction into a small reusable token/component contract;
   do not build a giant, generic design system.

## Non-Negotiable Product Boundaries

- One shared `apps/pos` application serves Staff and Manager users. Manager
  capability is role-gated; there is no separate Manager application.
- Stage 7 is operational work only: sign-in/session recovery, physical-table
  awareness, table or takeaway order composition, controlled `OPEN`-order
  work, payment, receipts, logical deletion/clear flow, conflicts/reconnect,
  and waiter calls.
- Do not introduce customer ordering, payment, order tracking, QR credential
  management, reporting, catalog management, settings, audit screens, or any
  other Stage 8/9 capability during this redesign.
- Persian RTL is the default. POS numeric values use English digits without a
  displayed currency suffix; Toman amounts remain integers in the domain.
  Critical status
  cannot rely on color alone.
- UI state never substitutes for server authorization or server-calculated
  values. The design must expose uncertainty, retries, stale-version conflicts,
  unavailable items, and restricted actions honestly.

## Experience Principles

1. **See the café at a glance.** The primary surface should make table state,
   urgent waiter calls, active work, and the next useful action immediately
   understandable.
2. **Preserve momentum without hiding risk.** Common actions should be quick;
   consequential actions—settlement, deletion, conflicts, and printing—need
   unambiguous review and confirmation boundaries.
3. **Design for interruption.** A staff member must be able to leave and
   resume a draft or table context without losing what the UI knows, while the
   server remains authoritative.
4. **Use purposeful density.** A POS is not a landing page. Information should
   be compact enough for service but never cramped, ambiguous, or dependent on
   tiny targets.
5. **Let hierarchy do the work.** Favor type, grouping, alignment, whitespace,
   and tonal contrast over decorative cards, arbitrary badges, gradients, or
   ornamental motion.
6. **Make device changes intentional.** Desktop supports simultaneous table,
   catalog, and order context. Normal mobile becomes a focused single-task
   flow; it is not a squeezed desktop layout.

## Required Design Inputs Before the First UI Pass

The user-supplied description is the primary creative brief. Capture and
confirm these decisions in a dated section below before implementation:

- intended atmosphere and references;
- preferred light/dark or mixed color character, brand cues, and elements to
  avoid;
- desired operational feel (for example, calm, tactile, minimal, expressive,
  industrial, or editorial);
- appetite for density, illustration, photography, animation, and sound;
- any required desktop hardware context or normal-mobile constraints.

### Active Creative Brief

**Status:** approved for the first UI-only pass on 5 September 2026.

- **Direction:** a light, warm, calm Persian café workspace with soft cream
  surfaces, restrained earthy accent color, generous but operational spacing,
  clear hierarchy, and practical rounding. The light mood of the referenced
  Cosy POS case study is inspiration only; its composition and features are not
  copied.
- **Operational feel:** touch-friendly and quick to scan, with the physical
  table state taking priority over decoration. Desktop keeps simultaneous
  context; normal mobile uses a deliberate focused flow.
- **Brand and restraint:** retain Run Cafe identity and realistic Persian copy.
  Avoid dark canvases, generic admin-dashboard chrome, gradients, decorative
  illustration or photography, ornamental animation, glass effects, and any
  feature outside the requested order-entry slice.
- **First bounded surface:** the shared Staff/Manager `سفارش` workspace only:
  left-side hamburger navigation, `سالن` and `بیرون بر` entry points, the table
  dashboard and accessible occupancy action, the three-column order composer,
  and required server-catalog product-option selection. Settlement, payment,
  printing, transfer, discounts, waiter-call UI, QR management, deletion, and
  later Manager workflows remain deferred.

## Information Architecture And Surface Inventory

The following is an operational inventory, not a mandate for exact layouts or
navigation labels.

| Surface                    | Primary job                                                                                                            | Stage |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----- |
| Session entry and recovery | Establish the signed-in operator, connection state, logout, and safe recovery                                          | 7     |
| Service overview           | Orient around the 16 physical tables, occupancy, active order/payment state, reminders, and pending waiter calls       | 7     |
| Order workspace            | Start table/takeaway work; browse catalog; choose options, quantities, and notes; show server-confirmed totals         | 7     |
| Active order               | Review and safely edit allowed `OPEN` order contents and table assignment                                              | 7     |
| Settlement                 | Select eligible quantities; record cash, terminal, or card-to-card tenders; communicate partial/paid state             | 7     |
| Print and clear            | Present bar ticket/receipt outcomes and confirmed logical deletion/clear actions                                       | 7     |
| Recovery states            | Explain loading, offline/reconnect, retry, idempotent replay, stale conflict, forbidden, unavailable, and API failures | 7     |

Future Manager panels remain intentionally outside the first visual build. The
shared shell should accommodate role-gated expansion later without inventing
those screens now.

## Responsive And Interaction Contract

- **Desktop:** keep the service overview and current work context concurrently
  readable; avoid modal chains for frequent tasks.
- **Normal mobile:** use an explicit focused workspace with a clear back path,
  preserved task context, and touch targets sized for active service. Do not
  depend on horizontal scrolling to expose core actions.
- **RTL:** logical reading direction, focus order, icon placement, quantity
  controls, dates, money, truncation, and drawers/sheets must be tested in the
  actual Persian UI—not inferred from an LTR layout.
- **Keyboard:** common desktop actions need practical focus order and visible
  focus treatment. Keyboard shortcuts may be introduced only when they do not
  obscure discoverability or conflict with Persian input.
- **Motion:** motion, if selected in the active brief, should clarify state
  changes and never delay service, hide a result, or be required to understand
  status. Respect reduced-motion preferences.
- **Accessibility:** maintain legible type, sufficient contrast, labels for
  controls, status text/icons in addition to color, and robust loading/error
  announcements.

## Design Delivery Protocol

Work in small, reviewable passes. Do not redesign the entire POS in one prompt
or silently extend into adjacent workflows.

1. Record the active creative brief and select the first surface.
2. Produce up to five deliberately distinct directions only when the user asks
   for exploration; otherwise choose one clear direction and explain its
   operational rationale.
3. Obtain direction approval before writing production UI code.
4. Implement one bounded surface or workflow pass.
5. Verify the implemented slice against real authenticated API/session state
   where available, at desktop and normal-mobile sizes, including relevant
   empty/loading/error/recovery states.
6. Update this document and `docs/current-left.md` with what was implemented,
   what was validated, and the next explicitly bounded pass.

## Review Checklist

Before a POS design pass is accepted, confirm:

- It still serves the shared Staff/Manager operational workflow and stays
  inside the active roadmap stage.
- A Persian-speaking operator can identify the active table/order, urgent
  state, money, and next action without interpreting decoration.
- Totals, availability, permissions, and conflicts visibly reflect server
  truth or clearly indicate pending/unknown state.
- The normal-mobile version is a deliberate task flow, not a scaled-down
  desktop canvas.
- The UI avoids familiar generated-dashboard tropes unless the active creative
  brief intentionally calls for them.
- The slice has proportionate type/build/browser validation, with any missing
  authenticated visual proof recorded rather than assumed.

## Reset And Cleanup Boundary

The current `codex/stage-7-pos-ui-foundation` branch includes approved
non-visual groundwork in addition to the first POS UI: package setup, API
proxy/session integration, local development-user provisioning, contracts,
waiter-call/backend changes, and planning updates. Do **not** delete the whole
branch to remove the old design.

Before the first replacement implementation pass, make a targeted cleanup plan
that distinguishes these categories:

| Preserve pending review                                                                                                                                         | Retire/replace with the new UI                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| approved planning and ADR changes; backend/auth/contract changes; POS package/runtime configuration that remains necessary; setup guidance that remains correct | old page composition, components, CSS, icon set, and superseded POS design/product documents |

The exact file list was reviewed against the selected design and branch diff
before this first implementation. The old page composition, UI primitives,
workspace, icon set, and CSS were retired or replaced; package/runtime setup,
session/API integration, backend/contracts, and planning history were
preserved.

## First UI-Only Pass Record — 5 September 2026

Implemented the approved bounded `سفارش` surface in the shared `apps/pos`
application. It preserves the existing session/API boundary and adds the
left-side one-item navigation, `سالن`/`بیرون بر` entry, the API-backed table
dashboard, accessible occupancy controls, active-order subtotal/elapsed-time
presentation, and the responsive category/product/current-order composer.
Option-bearing products require a current available server-catalog choice
before entering the local draft.

Verified in this pass: authored-source lint, POS typecheck, focused formatter
and elapsed-time tests, production build, the running POS document metadata,
and authenticated Staff requests through the POS origin for session, 16
tables, 16 categories, 143 products (34 option-bearing), and open orders. A
live browser instance was unavailable, so desktop/mobile visual, focus-order,
and touch interaction proof remains explicitly pending.

Next bounded pass: review this visual and interaction slice in an attached
browser, then separately decide whether to connect draft submission/active
order editing. Settlement, payment, printing, transfer, discounts,
waiter-call UI, QR management, logical deletion, and Manager-only surfaces
remain outside this pass.
