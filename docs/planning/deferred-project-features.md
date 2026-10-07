# Deferred Project Features

## Purpose

This document tracks features that may be valuable in a complete, reusable POS
project but are not needed for the current café's agreed workflow. The current
deployment is being customized for one real café, so the manager's operational
requirements determine what must be completed for that café. Deferred items
remain candidates for a later project-completeness pass after the café work is
finished.

The scope, roadmap, and backend backlog continue to describe the general POS
target. An item listed here is deferred for the current café; it is not marked
as completed or removed from the general product plan.

## Deferred Items

### 10.11 — Complete authorization coverage

**Source:** `docs/current-left.md`, Stage 10 completion checklist; related
general requirement: `docs/planning/backend-backlog.md`, P1.2.

**Deferred work:** Verify Staff/Manager access boundaries on implemented routes
and important service commands, including route-guard and service-level
authorization tests.

**Reason:** The café manager's workflow has all café people using the manager's
POS. Detailed Staff-versus-Manager access boundaries do not provide value for
this café's current operation. They remain useful for presenting the POS as a
complete, reusable project with distinct Staff and Manager roles.

**When to resume:** After the current café-specific work is complete, before
presenting or reusing the system as a general POS with distinct Staff and
Manager access.

**Status:** Deferred; no new verification is claimed here.

## Adding Items

For each new item, record its source task or requirement, the café-specific
reason it is not needed now, what must be completed for the general project,
and when it should be reconsidered. Keep deferred work out of
`docs/current-left.md` until it becomes part of the active café completion
scope again.
