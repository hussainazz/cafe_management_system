# ADR 0010: Authenticate table QR waiter calls with customer OTP visits

## Status

Accepted on 6 September 2026.

## Decision

The public menu remains browse-only. A table QR still establishes a hash-backed,
rotatable table context, but a waiter call now requires both that context and a
valid customer-table visit created after phone OTP verification. Occupancy remains
an operational POS state and scan reminders remain informational; neither is a
public-call precondition.

Customer authentication is remembered in a secure browser cookie for one year.
Every table scan creates a separate four-hour table visit, bound to that exact QR
credential and table. Table clearing, QR rotation, expiry, credential disablement,
or explicit logout invalidates the visit. OTP establishes phone-number control,
not physical presence: a copied QR can still be used remotely by an authenticated
person.

No order, payment, loyalty, marketing, CRM, or Customer Club capability is added.

## Consequences

The server records minimal customer identity and visit evidence for accountability,
without storing plaintext phone numbers, OTPs, QR tokens, or browser session
tokens. One pending waiter call remains deduplicated per table and Staff/Manager
acknowledgement remains unchanged. A later Customer Club initiative may add
consented profile data keyed by the stable customer ID in a separate approved ADR.
