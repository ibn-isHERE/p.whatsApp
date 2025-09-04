// routes/contacts.js
const express = require('express');

// Kita akan membuat fungsi yang menerima 'db' sebagai argumen
// Ini adalah cara yang baik agar router ini bisa mengakses database dari index.js
function createContactsRouter(db) {
    const router = express.Router();

    // READ: Mendapatkan semua kontak (GET /api/contacts)
    // routes/contacts.js

router.get('/', (req, res) => {
    const sql = "SELECT * FROM contacts ORDER BY name ASC";
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'success', data: rows });
    });
});

    // CREATE: Menambah kontak baru (POST /api/contacts)
    router.post('/', (req, res) => {
        const { name, number } = req.body;
        if (!name || !number) {
            return res.status(400).json({ error: "Nama dan nomor wajib diisi." });
        }
        
        const sql = 'INSERT INTO contacts (name, number) VALUES (?, ?)';
        db.run(sql, [name, number], function (err) {
            if (err) {
                // Cek jika error karena nomor duplikat (UNIQUE constraint)
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(409).json({ error: `Nomor ${number} sudah ada.` });
                }
                return res.status(500).json({ error: err.message });
            }
            res.status(201).json({
                message: 'Kontak berhasil dibuat',
                data: { id: this.lastID, name, number }
            });
        });
    });

    // UPDATE: Mengubah kontak berdasarkan ID (PUT /api/contacts/:id)
    router.put('/:id', (req, res) => {
        const { name, number } = req.body;
        const { id } = req.params;
        const sql = 'UPDATE contacts SET name = ?, number = ? WHERE id = ?';
        db.run(sql, [name, number, id], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(409).json({ error: `Nomor ${number} sudah digunakan oleh kontak lain.` });
                }
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ message: `Kontak dengan ID ${id} tidak ditemukan.` });
            }
            res.json({ message: `Kontak ${id} berhasil diperbarui`, changes: this.changes });
        });
    });

    // DELETE: Menghapus kontak berdasarkan ID (DELETE /api/contacts/:id)
    router.delete('/:id', (req, res) => {
        const { id } = req.params;
        const sql = 'DELETE FROM contacts WHERE id = ?';
        db.run(sql, id, function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ message: `Kontak dengan ID ${id} tidak ditemukan.` });
            }
            res.json({ message: `Kontak ${id} berhasil dihapus`, changes: this.changes });
        });
    });

    return router;
}

module.exports = createContactsRouter;