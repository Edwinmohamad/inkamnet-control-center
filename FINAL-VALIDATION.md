# FINAL VALIDATION — INKAMNET Control Center v1.2

Validated in the build environment on 2026-08-16.

## Passed

- `node --check` for `app.js`, `public/js/app.js`, and all backend JS under routes/services/middleware/config.
- Dashboard inline Chart.js script extracted and passed `node --check` after replacing EJS JSON payloads with fixtures.
- Static EJS preflight: 29 templates.
- Modal trigger integrity: 20 targets found.
- POST form CSRF scan: 41 POST forms include `_csrf`.
- CSS parsed with `tinycss2`: 0 parser errors.
- Docker Compose YAML parsed successfully with PyYAML.
- Shell syntax checked for install/upgrade/backup scripts.
- Package version verified as `1.2.0`.
- `.env` is not included in the release folder.
- HQ logo assets exist as RGBA PNG and are referenced by login cover/sidebar/loader/settings.
- Dashboard subscriber-growth references verified in both route and template.
- Existing v1.1 migration remains intact; v1.2 introduces no database schema migration.

## Runtime validation still required on CasaOS staging

The build environment does not have Docker/MariaDB/RouterOS, so the following must be verified on the user's staging server before live deployment:

1. `docker compose ps` → app Up/healthy + db Up/healthy.
2. `/healthz` returns HTTP 200.
3. Login works through the staging Cloudflare hostname.
4. Dashboard All Site and per-Site filters render the new PSB graph.
5. Add/Edit modals open and submit normally.
6. XLSX template/export/import works with a test file.
7. Payment transfer proof preview/verification works.
8. Cash-to-staff reconciliation works.
9. Piket Server CRUD/status works.
10. MikroTik test connection is tested only against a safe/test router before enabling any automation.

Do not promote v1.2 to live until these staging checks pass.
