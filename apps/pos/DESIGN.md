---
name: Run Cafe POS
description: A light, warm operational system for fast Persian RTL cafe service.
colors:
  ink: "#2d261f"
  ink-soft: "#655747"
  paper: "#f7f1e8"
  surface: "#fffdf9"
  surface-raised: "#f1e7d9"
  line: "#d9c9b5"
  amber: "#b86e27"
  amber-strong: "#8d511c"
  success: "#28734b"
  warning: "#8a5a17"
  danger: "#a53e31"
  info: "#246f8d"
typography:
  body:
    fontFamily: "Tahoma, Arial, Noto Sans Arabic, sans-serif"
    fontSize: "15px"
    lineHeight: 1.9
  headline:
    fontFamily: "Tahoma, Arial, Noto Sans Arabic, sans-serif"
    fontSize: "clamp(27px, 3vw, 38px)"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
rounded:
  control: "10px"
  surface: "14px"
spacing:
  compact: "8px"
  control: "12px"
  panel: "28px"
components:
  button-primary:
    backgroundColor: "{colors.amber}"
    textColor: "#fffaf4"
    rounded: "{rounded.control}"
    height: "42px"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "42px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
---

# Design System: Run Cafe POS

## Overview

**Creative North Star: "The Warm Service Counter"**

Run Cafe POS is a light operational workspace: cream paper-like surfaces,
dark readable text, and one restrained amber action color. It should feel
calm and settled during a busy service, never like a consumer marketing page
or a decorative dashboard.

**Key Characteristics:**

- Light warm surfaces with high-contrast operational information.
- Practical Persian RTL sans-serif typography and dense, clear controls.
- Amber reserved for primary action and identity; semantic colors carry state.
- Tonal layering and fine borders establish structure without glass effects.

## Colors

The palette is deliberately light and warm; color communicates role and state,
not decoration.

### Primary

- **Service Amber** (`#b86e27`): primary actions, focused identity marks, and
  small emphasis only.
- **Deep Amber** (`#8d511c`): hover and high-emphasis amber states.

### Neutral

- **Warm Paper** (`#f7f1e8`): page canvas.
- **Clean Surface** (`#fffdf9`): panels and toolbar.
- **Raised Linen** (`#f1e7d9`): secondary controls and dialog surfaces.
- **Roasted Ink** (`#2d261f`): primary text.
- **Soft Roasted Ink** (`#655747`): supporting text.
- **Fine Divider** (`#d9c9b5`): structural separation.

### Named Rules

**The Amber Reserve Rule.** Amber identifies the action that moves work
forward; it is not a general-purpose decoration or a default status color.

## Typography

**Body Font:** Tahoma, Arial, "Noto Sans Arabic", sans-serif.

**Character:** One practical sans-serif family keeps Persian labels, numbers,
and operational status easy to scan. The scale is intentionally tight.

### Hierarchy

- **Headline** (700, `clamp(27px, 3vw, 38px)`, 1.25): workspace and state
  headings.
- **Body** (400, 15px, 1.9): recovery guidance and supporting explanations.
- **Label** (700, 12–13px): controls, badges, and compact status context.

## Layout

Desktop uses a persistent 76px toolbar and a centered operational canvas up to
1480px wide. The first responsive breakpoint is 760px: the toolbar becomes a
vertical compact stack and the workspace becomes a single-column mobile
surface. Touch controls remain at least 38px high on mobile and 42px on larger
screens.

## Elevation & Depth

The system is mostly flat. Warm tonal layers and fine `#d9c9b5` borders define
resting surfaces. Only confirmation dialogs lift, using one soft, offset warm
shadow so protected focus is unmistakable.

## Shapes

Controls use 10px corners; major surfaces and dialogs use 14px corners. Status
badges are the only pill-shaped elements. Borders are quiet and structural.

## Components

### Buttons

- **Primary:** Service Amber with light text; reserved for the next confirmed
  action.
- **Secondary:** Raised Linen with a fine border; used for safe actions such
  as refetching.
- **Destructive:** a distinct muted red with light text; used only after a
  confirmation boundary.
- **Focus:** a 3px Deep Amber outline with offset.

### Status Badges

Compact pills pair a consistent line icon with text. Success, warning, danger,
and info have dedicated foreground, border, and pale surface colors; status is
never color-only.

### Panels and Dialogs

Panels are Clean Surface with a Fine Divider and 14px corners. Dialogs use the
Raised Linen layer, a soft shadow, and a muted warm backdrop.

### Inputs

Inputs use Clean Surface, a Fine Divider, 10px corners, and a Deep Amber focus
boundary. They inherit the same RTL-friendly sans-serif system as controls.

## Do's and Don'ts

### Do:

- **Do** keep operational text dark against light warm surfaces.
- **Do** reserve amber for primary action, focus, and small identity details.
- **Do** use semantic state colors with text and icons.
- **Do** preserve the shared Staff/Manager shell and server-authoritative
  boundaries.

### Don't:

- **Don't** reintroduce a dark page canvas for POS surfaces.
- **Don't** use glassmorphism, oversized rounded cards, hero sections, or
  decorative motion.
- **Don't** use color alone to identify connection, payment, or urgent states.
