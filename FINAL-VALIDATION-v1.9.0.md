# v1.9.0 Validation

Validated before packaging:

- JavaScript syntax for app/routes/services/middleware/config
- EJS static JavaScript syntax
- POST form CSRF scan
- Modal target scan
- Shell script syntax
- Dashboard feature markers: PSB chart, site summary, current-week duty
- Customer and invoice reliable row-action handlers
- Payment reference field removed from UI and generated server-side
- Cash purchase-source fields wired through UI, route and schema migration
- Package version and asset cache version set to 1.9.0

Runtime database/network behavior must still be verified after deployment against the production MariaDB instance.
