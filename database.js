const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Menentukan path ke file database agar tidak salah lokasi
const DB_PATH = path.join(__dirname, "reminders.db");

// Membuat koneksi ke database. File akan dibuat jika belum ada.
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error("Gagal membuka database:", err.message);
    } else {
        console.log("Terhubung ke database SQLite.");
    }
});

// Menggunakan db.serialize() untuk memastikan semua perintah pembuatan tabel
// dijalankan secara berurutan satu per satu.
db.serialize(() => {
    // 1. Tabel untuk pesan terjadwal (schedules)
    db.run(
        `CREATE TABLE IF NOT EXISTS schedules (
            id TEXT PRIMARY KEY,
            numbers TEXT NOT NULL,
            message TEXT,
            filesData TEXT,
            scheduledTime TEXT NOT NULL,
            status TEXT NOT NULL,
            createdAt TEXT DEFAULT CURRENT_TIMESTAMP
        )`,
        (err) => {
            if (err) {
                console.error("Gagal membuat tabel 'schedules':", err.message);
            } else {
                console.log("Tabel 'schedules' siap digunakan.");
            }
        }
    );

    // 2. Tabel untuk jadwal rapat (meetings)
    db.run(
        `CREATE TABLE IF NOT EXISTS meetings (
            id TEXT PRIMARY KEY,
            meetingTitle TEXT NOT NULL,
            numbers TEXT NOT NULL,
            meetingRoom TEXT NOT NULL,
            date TEXT NOT NULL,
            startTime TEXT NOT NULL,
            endTime TEXT NOT NULL,
            status TEXT NOT NULL,
            filesData TEXT,
            start_epoch INTEGER,
            end_epoch INTEGER,
            createdAt TEXT DEFAULT CURRENT_TIMESTAMP
        )`,
        (err) => {
            if (err) {
                console.error("Gagal membuat tabel 'meetings':", err.message);
            } else {
                console.log("Tabel 'meetings' siap digunakan.");
            }
        }
    );

    // 3. Tabel untuk manajemen kontak (contacts)
    db.run(
        `CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            number TEXT NOT NULL UNIQUE,
            createdAt TEXT DEFAULT CURRENT_TIMESTAMP
        )`,
        (err) => {
            if (err) {
                console.error("Gagal membuat tabel 'contacts':", err.message);
            } else {
                console.log("Tabel 'contacts' siap digunakan.");
            }
        }
    );

    // 4. Tabel untuk chat/customer service (UPDATED)
    db.run(
        `CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fromNumber TEXT NOT NULL,
            message TEXT,
            direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
            timestamp TEXT NOT NULL,
            messageType TEXT DEFAULT 'chat',
            mediaUrl TEXT,
            isRead BOOLEAN DEFAULT FALSE,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`,
        (err) => {
            if (err) {
                console.error("Gagal membuat tabel 'chats':", err.message);
            } else {
                console.log("Tabel 'chats' siap digunakan.");
                
                // Cek dan tambahkan kolom-kolom yang mungkin belum ada
                db.all("PRAGMA table_info(chats)", (pragmaErr, columns) => {
                    if (pragmaErr) {
                        console.error("Error checking chats table structure:", pragmaErr);
                        return;
                    }
                    
                    const columnNames = columns.map(col => col.name);
                    
                    // Fungsi pembantu untuk menambah kolom jika belum ada
                    const addColumnIfNotExists = (columnName, columnDefinition) => {
                        if (!columnNames.includes(columnName)) {
                            db.run(`ALTER TABLE chats ADD COLUMN ${columnDefinition}`, (alterErr) => {
                                if (alterErr) {
                                    console.error(`Error adding ${columnName} column:`, alterErr);
                                } else {
                                    console.log(`Added ${columnName} column to chats table`);
                                }
                            });
                        }
                    };

                    // Jalankan pengecekan untuk setiap kolom
                    addColumnIfNotExists('messageType', "messageType TEXT DEFAULT 'chat'");
                    addColumnIfNotExists('isRead', "isRead BOOLEAN DEFAULT FALSE");
                    addColumnIfNotExists('created_at', "created_at TEXT DEFAULT CURRENT_TIMESTAMP");

                    // ✅ PERBAIKAN UTAMA: Tambah kolom mediaUrl jika belum ada
                    addColumnIfNotExists('mediaUrl', "mediaUrl TEXT NULL");
                });
            }
        }
    );


    // 5. Buat index untuk performa yang lebih baik
    db.run("CREATE INDEX IF NOT EXISTS idx_chats_fromNumber ON chats(fromNumber)", (err) => {
        if (err) {
            console.error("Error creating fromNumber index:", err);
        } else {
            console.log("Index pada fromNumber siap digunakan.");
        }
    });

    db.run("CREATE INDEX IF NOT EXISTS idx_chats_timestamp ON chats(timestamp)", (err) => {
        if (err) {
            console.error("Error creating timestamp index:", err);
        } else {
            console.log("Index pada timestamp siap digunakan.");
        }
    });

    db.run("CREATE INDEX IF NOT EXISTS idx_chats_direction_isRead ON chats(direction, isRead)", (err) => {
        if (err) {
            console.error("Error creating direction_isRead index:", err);
        } else {
            console.log("Index pada direction dan isRead siap digunakan.");
        }
    });
});

// Mengekspor objek 'db' agar bisa digunakan di file lain (seperti index.js)
module.exports = db;