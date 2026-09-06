# Customer-authenticated table waiter calls

## Security boundary

OTP reduces anonymous repeated waiter calls and establishes control of a phone
number. It does not establish physical presence: a photographed or shared table
QR can still be used remotely by someone controlling a verified number. The
server therefore requires a current QR context, customer login, and four-hour
credential-bound table visit for every call; it retains table-level pending-call
deduplication and invalidates visits on clearing or rotation.

Implementation follows [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html),
the [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
and the [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
OTP and customer cookies are authentication evidence, never table/order/payment
authority by themselves.

## Personal data and retention

`Customer.phoneLookupHash` is a keyed derived personal-data identifier used only
to reuse a verified customer without retaining plaintext phone numbers. OTP code
hashes, customer session-token hashes, and QR-token hashes are authentication
secrets and are accessible only to the API/database service. Staff POS users see
table calls, never phone identity or authentication material.

Never log raw phone numbers, OTPs, QR tokens, cookie values, or session tokens.
Delete OTP challenges after 24 hours, visits after 90 days, and revoked/expired
customer sessions after 90 days. Retain customer identifiers only until an
approved deletion workflow exists. A future OTP provider receives a normalized
number only in memory through a production adapter; its credentials belong in
secret management, not repository configuration. `CUSTOMER_OTP_DEV_CODE` is a
controlled development/test mechanism and production startup rejects it.

## Future Customer Club

`Customer.id` is the only deliberate extension point. Any profile, consent,
loyalty, communication, or CRM data requires a separately approved ADR, schema
migration, retention policy, and staff-access model.
