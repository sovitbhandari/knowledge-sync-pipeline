# Optional destination adapters

The default product surface is mock-source → canonical PostgreSQL.

A commercial listing-platform destination adapter (for example against a vendor Management API)
is intentionally **not** implemented in this repository.

If credentials and explicit authorization are available in the future:

1. Keep destination adapters separately configurable
2. Never hardcode secrets
3. Do not call third-party endpoints without explicit operator consent
4. Do not imply a live vendor integration exists until it is implemented and tested

Until then, the project remains mock-only for outbound destinations.
