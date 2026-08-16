# v1.10.0 Validation

Validation performed before packaging:

- Node syntax check for application, routes, services, middleware, and config.
- EJS embedded JavaScript compile validation.
- Bootstrap modal target validation.
- POST form CSRF validation.
- Native action-dialog target validation.
- Confirmed row three-dot actions use native top-layer dialogs for Customer, Invoice, Cash, and Server Duty.
- Confirmed Bootstrap dropdown remains only for the account/profile menu.
- Confirmed customer import template no longer defines a `customer_code` input column.
- Confirmed customer import required headers are `name`, `site_code`, and `package_name`.
- Confirmed import Customer ID generator uses site/due-day prefix, sequence cache, database uniqueness, and a MariaDB advisory lock.
- Confirmed dedicated customer `Harga Paket` column uses package price from the customer query.
- Shell scripts pass `bash -n`.
- Docker Compose and GitHub Actions YAML parse successfully.
- No production `.env`, private key, or runtime proof upload files are included in the release archive.
- ZIP integrity tested after creation.

This validation reduces source/configuration regressions but does not claim that production runtime can never encounter an environment- or data-specific error.
