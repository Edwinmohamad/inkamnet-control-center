INKAMNET Control Center v1.6.0 CUMULATIVE FULL UPDATE
Base: FINAL v1.2.1
Includes sequential changes from v1.3.0 + v1.4.0 + v1.5.0 + v1.6.0.

This package is intended for users who have NOT applied v1.3-v1.5 yet.
Do not copy .env from this package; production .env remains on the server and is excluded from deployment sync.

VERIFIED PACKAGE NOTES
- .env.example restored for repository/clean-install completeness.
- Existing production .env is never included and remains protected by deploy workflow.
- Install helper now prepares payment, profile-photo, and cash-proof storage directories.
- Cumulative source was compared byte-for-byte with sequential overlay: v1.2.1 + v1.3 + v1.4 + v1.5 + v1.6.
