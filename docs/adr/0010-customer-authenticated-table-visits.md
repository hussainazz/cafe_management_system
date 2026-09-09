# ADR 0010: Authenticate table QR waiter calls with customer OTP visits

## Status

Accepted on 9 September 2026.

## Decision

The public menu remains browse-only. A table QR establishes a hash-backed,
rotatable table context, and the table menu requires a customer to submit a full
name and phone number then verify a one-time password. The resulting remembered
customer session lasts one year; each QR/table visit lasts four hours and is
bound to the exact table credential.

A waiter call requires a valid table context, customer session, and current
credential-bound visit. It does not require the table to be marked occupied.
Occupancy remains a separate Staff/Manager POS operation. No customer identity
is exposed in POS, and no ordering, payment, tracking, loyalty, marketing, or
CRM capability is granted.

Development and test use the controlled OTP code. Production startup rejects
that mechanism and remains blocked until a separate SMS-provider decision.

## Consequences

The server stores a normalized full name and keyed phone lookup hash, never a
plaintext phone, OTP, QR token, or browser session token. Table clearing and QR
rotation invalidate affected visits. One pending waiter call remains deduplicated
per table and Staff/Manager acknowledgement remains unchanged.
