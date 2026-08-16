# INKAMNET v1.12.0 — Final Validation

Validation performed on the cumulative source before packaging:

- Node.js syntax check on all `.js` files.
- Static EJS validation, Bootstrap modal-target validation, CSRF POST-form validation, and action-popover target validation.
- package.json JSON parse.
- Docker Compose / GitHub Actions YAML parse.
- Shell scripts checked with `bash -n`.
- Uploaded WifiNetBill reference workbook inspected and its header row successfully maps to the INKAMNET importer aliases.
- Required reference columns map successfully: Nama, Server, Paket Internet, Alamat, Whatsapp, Tanggal Instalasi, Tanggal Jatuh Tempo.
- Import template no longer requires Customer ID and backend generates the code under a MySQL advisory lock.
- Site/package pairing is revalidated server-side before insertion.
- Invoice correction is transactional and reverses linked automatic revenue records while retaining payment audit history.
- Persistent upload directories remain excluded from production rsync deployment.

Runtime behavior against the production database should still be smoke-tested after GitHub Actions reports a healthy deployment.
