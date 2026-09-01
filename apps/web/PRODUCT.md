# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Run Cafe customers browsing on their phones after scanning a QR code. They usually use Persian in a right-to-left interface and need to quickly decide what to order in person.

## Product Purpose

The public QR menu helps customers discover Run Cafe drinks, food, desserts, prices, availability, and product options. Success is a fast, reliable mobile browsing experience that supports an in-person order without adding customer ordering or payment flows.

## Positioning

Run Cafe's menu is a focused, API-driven café browsing experience: it exposes the current live menu and final Toman prices while deliberately keeping all ordering and payment authority with café staff.

## Operating Context

Customers commonly open the menu on a phone in the café. The menu supports search, category navigation, and product-detail dialogs with images and options. The current catalog and availability come from the public menu API.

## Capabilities and Constraints

- The current web scope is only the public QR menu; Staff POS and Manager surfaces are future work.
- The menu is browse-only: customers must not order, pay, create accounts, or track orders.
- Preserve Persian RTL support, mobile usability, current categories and products, search, category navigation, product dialogs, product images, final integer Toman prices, availability indicators, and API-driven menu data.
- Do not change API behavior or business logic through public-menu UI work.

## Brand Commitments

Run Cafe has a dark, warm, intimate identity. Future work must avoid SaaS-dashboard styling, purple gradients, glassmorphism, excessive rounded cards, tiny text, and decorative animation that slows browsing.

## Evidence on Hand

- Implemented menu route and interactions: `app/menu/page.tsx` and `components/menu-experience.tsx`.
- Existing visual system and RTL/mobile treatment: `app/globals.css` and `app/layout.tsx`.
- Brand and product assets: `public/run-cafe-logo.webp`, `public/Logo.png`, and `public/items_pictures/`.
- Typed public-menu data client: `lib/public-menu-api.ts` and `lib/menu-types.ts`.
- The current API has no English category or product names; the English interface preserves API-provided Persian names instead of inventing translations.

## Product Principles

- Make in-café menu discovery fast on a phone.
- Keep customer-facing information current, clear, and truthful.
- Let staff-owned workflows remain staff-owned; never imply self-service ordering.
- Respect Persian RTL reading and interaction patterns.
- Preserve the focused Run Cafe character without sacrificing scanability.

## Accessibility & Inclusion

Prioritize legible mobile typography, usable touch targets, keyboard-accessible dialogs, and clear availability and price information for Persian RTL users.
