INKAMNET CONTROL CENTER v1.6.0
Payments, Customer Search, Cluster Context & Cash Evidence Upgrade

FITUR UTAMA
1. Search nama pelanggan / Customer ID / faktur / site / cluster pada modul yang berkaitan dengan pelanggan: Pembayaran, Tagihan, Rekonsiliasi, Ticketing, Jadwal Teknisi, Faktur Custom dan Laporan.
2. Action Pembayaran langsung dari menu Tagihan membuka modal pembayaran yang sama dengan menu Pembayaran.
3. Bulk payment: satu transaksi input dapat memilih banyak faktur dengan checkbox dan nominal per faktur dapat diatur. Transfer tanpa bukti diperbolehkan sebagai Pending dan ditandai "Belum ada bukti TF".
4. Nomor faktur dapat diklik untuk membuka PDF inline; tersedia action unduh PDF.
5. Data pelanggan yang menampilkan site kini juga menampilkan konteks cluster, misalnya KRW · Cluster RT.01.
6. Arus Kas: kategori pengeluaran tambahan, kode kategori dan kode transaksi unik, optional upload bukti JPG/PNG/WEBP/PDF, serta indikator bukti sudah/belum tersedia.
7. Storage bukti pengeluaran dipertahankan saat auto-deploy melalui pengecualian rsync/Git.

CATATAN DATABASE
- Tidak mereset database.
- Schema v1.6 ditambahkan otomatis saat aplikasi start melalui services/schemaService.js.
- database/migration_v16.sql juga disediakan untuk instalasi database baru.

CARA UPDATE
1. Extract ZIP patch.
2. Copy seluruh isi folder ini ke root repo INKAMNET dan pilih Replace/Merge.
3. Commit: Upgrade payments cluster and cash evidence v1.6.0
4. Push ke main. Workflow production akan menjalankan backup/build/deploy/health-check.

CATATAN
- File .env, database, payment proof lama, profile photo, dan cash proof tidak ada di patch ini.
- Folder storage/cash-proofs hanya berisi .gitkeep; file bukti asli tetap lokal/private.
