<<<<<<< HEAD
const express = require('express');
const multer = require('multer'); // Pastikan multer di-import
const path = require('path');
const fs = require('fs');
const { MessageMedia } = require('whatsapp-web.js'); // Import MessageMedia


function createChatsRouter(db, whatsappClient, io) {
    const router = express.Router();
    
    // --- Multer setup untuk menyimpan media chat ---
    const uploadDir = path.join(__dirname, '..', 'uploads', 'chat_media');
    fs.mkdirSync(uploadDir, { recursive: true });

    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname);
            const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
            cb(null, uniqueName);
        }
    });

    const upload = multer({
        storage,
        limits: { fileSize: 50 * 1024 * 1024 } // batas 50MB, ubah sesuai kebutuhan
    });

    // Endpoint untuk mendapatkan daftar percakapan unik dengan info kontak
router.get('/conversations', (req, res) => {
    const { status } = req.query;
    // Menentukan klausa WHERE berdasarkan status yang diminta
    const whereClause = (status === 'history') 
        ? "WHERE status = 'history'" 
        : "WHERE status IS NULL OR status = 'active'";

=======
const express = require("express");
const multer = require("multer"); // Pastikan multer di-import
const path = require("path");
const fs = require("fs");
const { MessageMedia } = require("whatsapp-web.js"); // Import MessageMedia

function createChatsRouter(db, whatsappClient, io) {
  const router = express.Router();

  // --- Multer setup untuk menyimpan media chat ---
  const uploadDir = path.join(__dirname, "..", "uploads", "chat_media");
  fs.mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const uniqueName = `${Date.now()}-${Math.round(
        Math.random() * 1e9
      )}${ext}`;
      cb(null, uniqueName);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // batas 50MB, ubah sesuai kebutuhan
  });

  // Endpoint untuk mendapatkan daftar percakapan unik dengan info kontak
  router.get("/conversations", (req, res) => {
    const { status } = req.query;
    // Menentukan klausa WHERE berdasarkan status yang diminta
    const whereClause =
      status === "history"
        ? "WHERE status = 'history'"
        : "WHERE status IS NULL OR status = 'active'";

>>>>>>> c30fff9d07870d08fef454d3581482465002141b
    const query = `
        SELECT
            c.fromNumber,
            MAX(c.timestamp) as lastTimestamp,
            (SELECT message FROM chats WHERE fromNumber = c.fromNumber ORDER BY timestamp DESC LIMIT 1) as lastMessage,
            (SELECT direction FROM chats WHERE fromNumber = c.fromNumber ORDER BY timestamp DESC LIMIT 1) as direction,
            (SELECT messageType FROM chats WHERE fromNumber = c.fromNumber ORDER BY timestamp DESC LIMIT 1) as messageType,
            (SELECT COUNT(*) FROM chats WHERE fromNumber = c.fromNumber AND direction = 'in' AND isRead = 0 AND (status IS NULL OR status = 'active')) as unreadCount,
            COALESCE(contacts.name, c.fromNumber) as contactName
        FROM chats c
        LEFT JOIN contacts ON 
            contacts.number = c.fromNumber OR 
            contacts.number = ('0' || SUBSTR(c.fromNumber, 3)) OR 
            contacts.number = ('62' || SUBSTR(c.fromNumber, 2))
        ${whereClause}
        GROUP BY c.fromNumber
        ORDER BY lastTimestamp DESC
    `;

    db.all(query, [], (err, rows) => {
<<<<<<< HEAD
        if (err) {
            console.error('Error getting conversations:', err.message);
            return res.status(500).json({ success: false, message: 'Gagal mengambil data dari database.' });
        }
        res.json({ success: true, data: rows });
=======
      if (err) {
        console.error("Error getting conversations:", err.message);
        return res
          .status(500)
          .json({
            success: false,
            message: "Gagal mengambil data dari database.",
          });
      }
      res.json({ success: true, data: rows });
>>>>>>> c30fff9d07870d08fef454d3581482465002141b
    });
  });

  // Endpoint untuk mendapatkan riwayat chat dengan nomor tertentu (SUDAH DIPERBAIKI)
  router.get("/conversation/:number", (req, res) => {
    const number = req.params.number;

<<<<<<< HEAD




    // Endpoint untuk mendapatkan riwayat chat dengan nomor tertentu (SUDAH DIPERBAIKI)
    router.get('/conversation/:number', (req, res) => {
        const number = req.params.number;

        // **PERBAIKAN: Menghapus LIMIT dan OFFSET untuk memuat semua pesan**
        const query = `
=======
    // **PERBAIKAN: Menghapus LIMIT dan OFFSET untuk memuat semua pesan**
    const query = `
>>>>>>> c30fff9d07870d08fef454d3581482465002141b
            SELECT
                c.*,
                contacts.name as contactName
            FROM chats c
            LEFT JOIN contacts ON contacts.number = c.fromNumber
                OR contacts.number = ('+' || c.fromNumber)
                OR contacts.number = ('62' || SUBSTR(c.fromNumber, 2))
            WHERE c.fromNumber = ?
            ORDER BY c.timestamp ASC
        `;
<<<<<<< HEAD

        db.all(query, [number], (err, rows) => {
            if (err) {
                console.error('Error getting conversation history:', err);
                res.status(500).json({ error: err.message });
                return;
            }

            // Mark messages as read when conversation is opened
            db.run(
                'UPDATE chats SET isRead = TRUE WHERE fromNumber = ? AND direction = "in" AND isRead = FALSE',
                [number],
                (updateErr) => {
                    if (updateErr) {
                        console.error('Error marking messages as read:', updateErr);
                    } else {
                        io.emit('messagesMarkedAsRead', { fromNumber: number });
                    }
                }
            );

            res.json({
                success: true,
                data: {
                    messages: rows,
                    contactName: rows.length > 0 ? (rows[0].contactName || number) : number,
                    totalMessages: rows.length
                }
            });
        });
    });
=======
>>>>>>> c30fff9d07870d08fef454d3581482465002141b

    db.all(query, [number], (err, rows) => {
      if (err) {
        console.error("Error getting conversation history:", err);
        res.status(500).json({ error: err.message });
        return;
      }

      const normalized = rows.map((r) => {
        let parsedMsg = r.message;
        try {
          parsedMsg =
            typeof r.message === "string" ? JSON.parse(r.message) : r.message;
        } catch (e) {
          parsedMsg = r.message; // fallback: tetap string teks
        }

        return {
          ...r,
          message: parsedMsg,
          messageType: r.messageType || determineTypeFromPayload(parsedMsg),
        };
      });

      res.json({
        success: true,
        data: {
          messages: rows,
          contactName: rows.length > 0 ? rows[0].contactName || number : number,
          totalMessages: rows.length,
        },
      });
    });
  });

  // Endpoint untuk mencari chat berdasarkan nomor atau nama
  router.get("/search/:query", (req, res) => {
    const searchQuery = req.params.query.toLowerCase();

    const query = `
            SELECT 
                c.fromNumber,
                MAX(c.timestamp) as lastTimestamp,
                c.message as lastMessage,
                c.direction,
                COUNT(CASE WHEN c.direction = 'in' AND c.isRead = FALSE THEN 1 END) as unreadCount,
                contacts.name as contactName
            FROM chats c
            LEFT JOIN contacts ON contacts.number = c.fromNumber 
                OR contacts.number = ('+' || c.fromNumber)
                OR contacts.number = ('62' || SUBSTR(c.fromNumber, 2))
            WHERE 
                c.fromNumber LIKE ? 
                OR LOWER(contacts.name) LIKE ?
                OR LOWER(c.message) LIKE ?
            GROUP BY c.fromNumber 
            ORDER BY lastTimestamp DESC
        `;

<<<<<<< HEAD
     router.put('/end-chat/:number', (req, res) => {
    const { number } = req.params;
    const endMessage = `--- Sesi chat berakhir pada ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB ---`;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Langkah 1: Ubah status semua pesan dari nomor ini menjadi 'history'
        db.run(`UPDATE chats SET status = 'history' WHERE fromNumber = ?`, [number], function(err) {
            if (err) {
                db.run('ROLLBACK');
                console.error("Error updating chat status to history:", err);
                return res.status(500).json({ success: false, message: 'Gagal mengupdate status chat.' });
            }

            // --- AWAL PERBAIKAN ---
            // Langkah 2: Tambahkan pesan penutup sesi dengan direction 'out' yang valid
            const insertQuery = `
                INSERT INTO chats (fromNumber, message, direction, timestamp, messageType, status) 
                VALUES (?, ?, 'out', ?, 'system', 'history')
            `;
            // --- AKHIR PERBAIKAN ---
            
            db.run(insertQuery, [number, endMessage, new Date().toISOString()], function (err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error("Error inserting end-of-session message:", err);
                    return res.status(500).json({ success: false, message: 'Gagal menambahkan pesan akhir sesi.' });
                }

                db.run('COMMIT', (err) => {
                    if (err) {
                        console.error("Error committing transaction:", err);
                        return res.status(500).json({ success: false, message: 'Gagal melakukan commit transaksi.' });
                    }
                    console.log(`[LOGIC] Sesi untuk ${number} telah diakhiri dan dipindahkan ke history.`);
                    res.json({ success: true, message: 'Chat berhasil diarsipkan.' });
                });
            });
        });
    });
});


    // Endpoint untuk mengirim pesan balasan
     router.post('/send', async (req, res) => {
        const { to, message } = req.body;
        
        if (!to || !message) {
            return res.status(400).json({ success: false, message: 'Nomor tujuan dan pesan harus diisi' });
        }

        try {
            if (!whatsappClient || !whatsappClient.info) {
                return res.status(500).json({ success: false, message: 'WhatsApp client tidak tersedia atau tidak terhubung' });
            }

            const formattedNumber = to.includes('@c.us') ? to : `${to}@c.us`;
            await whatsappClient.sendMessage(formattedNumber, message);
            
            const dbResult = await new Promise((resolve, reject) => {
                const timestamp = new Date().toISOString();
                const query = `
                    INSERT INTO chats (fromNumber, message, direction, timestamp, messageType, isRead)
                    VALUES (?, ?, 'out', ?, 'chat', TRUE)
                `;
                
                db.run(query, [to, message, timestamp], function(err) {
                    if (err) {
                        console.error('Error menyimpan pesan keluar:', err);
                        return reject(new Error('Pesan terkirim tapi gagal disimpan ke database'));
                    }
                    resolve({
                        id: this.lastID,
                        timestamp: timestamp
                    });
                });
            });
            
            const messageData = {
                id: dbResult.id,
                fromNumber: to,
                message: message,
                direction: 'out',
                timestamp: dbResult.timestamp,
                messageType: 'chat',
                isRead: true
            };
            
            io.emit('messageSent', messageData);
            
            res.json({ 
                success: true, 
                message: 'Pesan berhasil dikirim dan disimpan',
                data: messageData
            });
            
        } catch (error) {
            console.error('Error dalam proses mengirim pesan:', error.message);
            
            if (error.message && error.message.includes('phone number is not registered')) {
                return res.status(400).json({ success: false, message: 'Nomor WhatsApp tidak terdaftar' });
            }
            
            res.status(500).json({ 
                success: false, 
                message: 'Gagal mengirim pesan',
                details: error.message 
            });
        }
    });

    // NEW: Endpoint untuk mengirim media (foto/video/pdf)
 router.post('/send-media', upload.single('media'), async (req, res) => {
    const to = req.body.to;
    const caption = req.body.caption || '';

    if (!to || !req.file) {
        if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ success: false, message: 'Nomor tujuan dan file media harus disediakan' });
    }

    try {
        if (!whatsappClient || !whatsappClient.info) {
            fs.unlink(req.file.path, () => {});
            return res.status(500).json({ success: false, message: 'WhatsApp client tidak tersedia' });
        }

        const formattedNumber = to.includes('@c.us') ? to : `${to}@c.us`;
        const filePath = req.file.path;
        const media = MessageMedia.fromFilePath(filePath);

        await whatsappClient.sendMessage(formattedNumber, media, { caption });

        // --- AWAL PERBAIKAN ---
        let messageType = 'document';
        if (req.file.mimetype.startsWith('image/')) messageType = 'image';
        else if (req.file.mimetype.startsWith('video/')) messageType = 'video';

        const mediaUrl = `/media/${req.file.filename}`;
        const mediaData = {
            filename: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            url: mediaUrl
        };

        const dbResult = await new Promise((resolve, reject) => {
            const timestamp = new Date().toISOString();
            const query = `
                INSERT INTO chats (fromNumber, message, direction, timestamp, messageType, isRead, mediaUrl, mediaData, status)
                VALUES (?, ?, 'out', ?, ?, TRUE, ?, ?, 'active')
            `;
            db.run(query, [to, caption, timestamp, messageType, mediaUrl, JSON.stringify(mediaData)], function(err) {
                if (err) return reject(new Error('Media terkirim tapi gagal disimpan ke database'));
                resolve({ id: this.lastID, timestamp: timestamp });
            });
        });

        const messageData = {
            id: dbResult.id,
            fromNumber: to,
            message: caption,
            direction: 'out',
            timestamp: dbResult.timestamp,
            messageType: messageType,
            mediaUrl: mediaUrl,
            mediaData: mediaData,
            isRead: true,
            status: 'active'
        };
        // --- AKHIR PERBAIKAN ---

        io.emit('messageSent', messageData);
        res.json({ success: true, message: 'Media berhasil dikirim dan disimpan', data: messageData });

    } catch (error) {
        console.error('Error mengirim media:', error);
        if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
        res.status(500).json({ success: false, message: 'Gagal mengirim media', details: error.message });
=======
    const searchParam = `%${searchQuery}%`;
    db.all(query, [searchParam, searchParam, searchParam], (err, rows) => {
      if (err) {
        console.error("Error searching conversations:", err);
        res.status(500).json({ error: err.message });
        return;
      }

      const conversations = rows.map((row) => ({
        fromNumber: row.fromNumber,
        contactName: row.contactName || row.fromNumber,
        lastMessage: row.lastMessage,
        lastTimestamp: row.lastTimestamp,
        direction: row.direction,
        unreadCount: row.unreadCount,
        hasUnread: row.unreadCount > 0,
      }));

      res.json(conversations);
    });
  });

  router.put("/end-chat/:number", (req, res) => {
    const { number } = req.params;
    const endMessage = `--- Sesi chat berakhir pada ${new Date().toLocaleString(
      "id-ID",
      { timeZone: "Asia/Jakarta" }
    )} WIB ---`;

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");

      // Langkah 1: Ubah status semua pesan dari nomor ini menjadi 'history'
      db.run(
        `UPDATE chats SET status = 'history' WHERE fromNumber = ?`,
        [number],
        function (err) {
          if (err) {
            db.run("ROLLBACK");
            console.error("Error updating chat status to history:", err);
            return res
              .status(500)
              .json({
                success: false,
                message: "Gagal mengupdate status chat.",
              });
          }

          // --- AWAL PERBAIKAN ---
          // Langkah 2: Tambahkan pesan penutup sesi dengan direction 'out' yang valid
          const insertQuery = `
                INSERT INTO chats (fromNumber, message, direction, timestamp, messageType, status) 
                VALUES (?, ?, 'out', ?, 'system', 'history')
            `;
          // --- AKHIR PERBAIKAN ---

          db.run(
            insertQuery,
            [number, endMessage, new Date().toISOString()],
            function (err) {
              if (err) {
                db.run("ROLLBACK");
                console.error("Error inserting end-of-session message:", err);
                return res
                  .status(500)
                  .json({
                    success: false,
                    message: "Gagal menambahkan pesan akhir sesi.",
                  });
              }

              db.run("COMMIT", (err) => {
                if (err) {
                  console.error("Error committing transaction:", err);
                  return res
                    .status(500)
                    .json({
                      success: false,
                      message: "Gagal melakukan commit transaksi.",
                    });
                }
                console.log(
                  `[LOGIC] Sesi untuk ${number} telah diakhiri dan dipindahkan ke history.`
                );
                res.json({
                  success: true,
                  message: "Chat berhasil diarsipkan.",
                });
              });
            }
          );
        }
      );
    });
  });

  // Endpoint untuk mengirim pesan balasan
  router.post("/send", async (req, res) => {
    const { to, message } = req.body;

    if (!to || !message) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Nomor tujuan dan pesan harus diisi",
        });
    }

    try {
      if (!whatsappClient || !whatsappClient.info) {
        return res
          .status(500)
          .json({
            success: false,
            message: "WhatsApp client tidak tersedia atau tidak terhubung",
          });
      }

      const formattedNumber = to.includes("@c.us") ? to : `${to}@c.us`;
      await whatsappClient.sendMessage(formattedNumber, message);

      const dbResult = await new Promise((resolve, reject) => {
        const timestamp = new Date().toISOString();
        const query = `
                    INSERT INTO chats (fromNumber, message, direction, timestamp, messageType, isRead)
                    VALUES (?, ?, 'out', ?, 'chat', TRUE)
                `;

        db.run(query, [to, message, timestamp], function (err) {
          if (err) {
            console.error("Error menyimpan pesan keluar:", err);
            return reject(
              new Error("Pesan terkirim tapi gagal disimpan ke database")
            );
          }
          resolve({
            id: this.lastID,
            timestamp: timestamp,
          });
        });
      });

      const messageData = {
        id: dbResult.id,
        fromNumber: to,
        message: message,
        direction: "out",
        timestamp: dbResult.timestamp,
        messageType: "chat",
        isRead: true,
      };

      io.emit("messageSent", messageData);

      res.json({
        success: true,
        message: "Pesan berhasil dikirim dan disimpan",
        data: messageData,
      });
    } catch (error) {
      console.error("Error dalam proses mengirim pesan:", error.message);

      if (
        error.message &&
        error.message.includes("phone number is not registered")
      ) {
        return res
          .status(400)
          .json({ success: false, message: "Nomor WhatsApp tidak terdaftar" });
      }

      res.status(500).json({
        success: false,
        message: "Gagal mengirim pesan",
        details: error.message,
      });
    }
  });

  // NEW: Endpoint untuk mengirim media (foto/video/pdf)
  router.post("/send-media", upload.array("media", 12), async (req, res) => {
    const to = req.body.to;
    const caption = req.body.caption || "";
    if (!to || !req.files || req.files.length === 0) {
      // cleanup any uploaded files if needed
      (req.files || []).forEach((f) => f.path && fs.unlink(f.path, () => {}));
      return res
        .status(400)
        .json({
          success: false,
          message: "Nomor tujuan dan file harus disediakan",
        });
>>>>>>> c30fff9d07870d08fef454d3581482465002141b
    }

<<<<<<< HEAD

    // Endpoint untuk mendapatkan jumlah pesan yang belum dibaca
    router.get('/unread-count', (req, res) => {
        const query = `
            SELECT 
                COUNT(*) as totalUnread,
                COUNT(DISTINCT fromNumber) as conversationsWithUnread
            FROM chats 
            WHERE direction = 'in' AND isRead = 0
        `;
        
        db.get(query, [], (err, row) => {
            if (err) {
                console.error('Error getting unread count:', err);
                return res.status(500).json({ error: err.message });
            }
            
            const result = {
                totalUnread: row.totalUnread || 0,
                conversationsWithUnread: row.conversationsWithUnread || 0
            };
            
            res.json(result);
        });
    });

    // Endpoint untuk menandai pesan sebagai sudah dibaca
    router.put('/mark-read/:number', (req, res) => {
        const { number } = req.params; 
        
        if (!number) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nomor telepon harus disediakan di URL' 
            });
        }
        
        const query = `
            UPDATE chats 
            SET isRead = TRUE 
            WHERE fromNumber = ? AND direction = 'in' AND isRead = FALSE
        `;
        
        db.run(query, [number], function(err) {
            if (err) {
                console.error('Error marking messages as read:', err);
                return res.status(500).json({ success: false, message: err.message });
            }
            
            io.emit('messagesMarkedAsRead', { fromNumber: number, updatedCount: this.changes });
            
            res.json({ 
                success: true, 
                message: 'Pesan berhasil ditandai sebagai sudah dibaca',
                updatedCount: this.changes
            });
        });
    });

    // ... (sisa kode di file chats.js tidak perlu diubah) ...
    // Endpoint untuk mendapatkan statistik chat
    router.get('/stats', (req, res) => {
        const statsQuery = `
=======
    try {
      if (!whatsappClient || !whatsappClient.info) {
        (req.files || []).forEach((f) => f.path && fs.unlink(f.path, () => {}));
        return res
          .status(500)
          .json({ success: false, message: "WhatsApp client tidak tersedia" });
      }

      const formattedNumber = to.includes("@c.us") ? to : `${to}@c.us`;
      const results = [];

      for (const file of req.files) {
        const filePath = file.path; // physical path on server
        const publicUrl = `${req.protocol}://${req.get(
          "host"
        )}/uploads/chat_media/${encodeURIComponent(file.filename)}`;

        // Determine message type
        let mtype = "document";
        if (file.mimetype.startsWith("image/")) mtype = "image";
        else if (file.mimetype.startsWith("video/")) mtype = "video";

        // prepare MessageMedia
        const media = MessageMedia.fromFilePath(filePath);

        // options for whatsapp-web.js
        const options = { caption };
        if (mtype === "document") options.sendMediaAsDocument = true;

        // send to whatsapp
        await whatsappClient.sendMessage(formattedNumber, media, options);

        // build message payload to store in DB (object)
        const messageObj = {
          url: publicUrl,
          filename: file.filename,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          caption,
        };

        // insert into DB (separate row per file)
        const dbResult = await new Promise((resolve, reject) => {
          const timestamp = new Date().toISOString();
          const query = `
          INSERT INTO chats (fromNumber, message, direction, timestamp, messageType, isRead)
          VALUES (?, ?, 'out', ?, ?, TRUE)
        `;
          db.run(
            query,
            [to, JSON.stringify(messageObj), timestamp, mtype],
            function (err) {
              if (err) return reject(err);
              resolve({ id: this.lastID, timestamp });
            }
          );
        });

        const resultMessage = {
          id: dbResult.id,
          fromNumber: to,
          message: messageObj,
          direction: "out",
          timestamp: dbResult.timestamp,
          messageType: mtype,
          isRead: true,
        };

        results.push(resultMessage);

        // DO NOT delete file here if you want to keep preview/download available.
        // If you want to cleanup disk later, schedule a cleanup job.
      }

      // emit all messages (or single) via socket
      results.forEach((m) => io.emit("messageSent", m));

      res.json({
        success: true,
        message: "Media berhasil dikirim",
        data: results,
      });
    } catch (err) {
      console.error("Error send-media:", err);
      (req.files || []).forEach((f) => f.path && fs.unlink(f.path, () => {})); // cleanup
      res
        .status(500)
        .json({
          success: false,
          message: "Gagal mengirim media",
          details: err.message,
        });
    }
  });

  // Endpoint untuk mendapatkan jumlah pesan yang belum dibaca
  router.get("/unread-count", (req, res) => {
    const query = `
            SELECT 
                COUNT(*) as totalUnread,
                COUNT(DISTINCT fromNumber) as conversationsWithUnread
            FROM chats 
            WHERE direction = 'in' AND isRead = 0
        `;

    db.get(query, [], (err, row) => {
      if (err) {
        console.error("Error getting unread count:", err);
        return res.status(500).json({ error: err.message });
      }

      const result = {
        totalUnread: row.totalUnread || 0,
        conversationsWithUnread: row.conversationsWithUnread || 0,
      };

      res.json(result);
    });
  });

  // Endpoint untuk menandai pesan sebagai sudah dibaca
  router.put("/mark-read/:number", (req, res) => {
    const { number } = req.params;

    if (!number) {
      return res.status(400).json({
        success: false,
        message: "Nomor telepon harus disediakan di URL",
      });
    }

    const query = `
            UPDATE chats 
            SET isRead = TRUE 
            WHERE fromNumber = ? AND direction = 'in' AND isRead = FALSE
        `;

    db.run(query, [number], function (err) {
      if (err) {
        console.error("Error marking messages as read:", err);
        return res.status(500).json({ success: false, message: err.message });
      }

      io.emit("messagesMarkedAsRead", {
        fromNumber: number,
        updatedCount: this.changes,
      });

      res.json({
        success: true,
        message: "Pesan berhasil ditandai sebagai sudah dibaca",
        updatedCount: this.changes,
      });
    });
  });

  // ... (sisa kode di file chats.js tidak perlu diubah) ...
  // Endpoint untuk mendapatkan statistik chat
  router.get("/stats", (req, res) => {
    const statsQuery = `
>>>>>>> c30fff9d07870d08fef454d3581482465002141b
            SELECT 
                COUNT(*) as totalMessages,
                COUNT(CASE WHEN direction = 'in' THEN 1 END) as incomingMessages,
                COUNT(CASE WHEN direction = 'out' THEN 1 END) as outgoingMessages,
                COUNT(CASE WHEN direction = 'in' AND isRead = FALSE THEN 1 END) as unreadMessages,
                COUNT(DISTINCT fromNumber) as uniqueContacts,
                DATE(timestamp) as today
            FROM chats
            WHERE DATE(timestamp) = DATE('now')
            
            UNION ALL
            
            SELECT 
                COUNT(*) as totalMessages,
                COUNT(CASE WHEN direction = 'in' THEN 1 END) as incomingMessages,
                COUNT(CASE WHEN direction = 'out' THEN 1 END) as outgoingMessages,
                COUNT(CASE WHEN direction = 'in' AND isRead = FALSE THEN 1 END) as unreadMessages,
                COUNT(DISTINCT fromNumber) as uniqueContacts,
                'total' as today
            FROM chats
        `;

    db.all(statsQuery, [], (err, rows) => {
      if (err) {
        console.error("Error getting chat stats:", err);
        res.status(500).json({ error: err.message });
        return;
      }

      const todayStats = rows.find((row) => row.today !== "total") || {};
      const totalStats = rows.find((row) => row.today === "total") || {};

      res.json({
        today: {
          totalMessages: todayStats.totalMessages || 0,
          incomingMessages: todayStats.incomingMessages || 0,
          outgoingMessages: todayStats.outgoingMessages || 0,
          unreadMessages: todayStats.unreadMessages || 0,
          uniqueContacts: todayStats.uniqueContacts || 0,
        },
        total: {
          totalMessages: totalStats.totalMessages || 0,
          incomingMessages: totalStats.incomingMessages || 0,
          outgoingMessages: totalStats.outgoingMessages || 0,
          unreadMessages: totalStats.unreadMessages || 0,
          uniqueContacts: totalStats.uniqueContacts || 0,
        },
      });
    });
  });

  // Endpoint untuk menghapus chat dengan nomor tertentu
  router.delete("/conversation/:number", (req, res) => {
    const number = req.params.number;

    const deleteQuery = "DELETE FROM chats WHERE fromNumber = ?";

    db.run(deleteQuery, [number], function (err) {
      if (err) {
        console.error("Error deleting conversation:", err);
        res.status(500).json({ error: err.message });
        return;
      }

      io.emit("conversationDeleted", {
        fromNumber: number,
        deletedCount: this.changes,
      });

      res.json({
        success: true,
        message: "Percakapan berhasil dihapus",
        deletedCount: this.changes,
      });
    });
  });

  // Endpoint untuk menghapus pesan tertentu
  router.delete("/message/:messageId", (req, res) => {
    const messageId = req.params.messageId;

    db.get(
      "SELECT fromNumber FROM chats WHERE id = ?",
      [messageId],
      (err, messageData) => {
        if (err) {
          console.error("Error getting message data:", err);
          res.status(500).json({ error: err.message });
          return;
        }

        if (!messageData) {
          return res.status(404).json({ error: "Pesan tidak ditemukan" });
        }

        db.run(
          "DELETE FROM chats WHERE id = ?",
          [messageId],
          function (deleteErr) {
            if (deleteErr) {
              console.error("Error deleting message:", deleteErr);
              res.status(500).json({ error: deleteErr.message });
              return;
            }

            io.emit("messageDeleted", {
              messageId: messageId,
              fromNumber: messageData.fromNumber,
            });

            res.json({
              success: true,
              message: "Pesan berhasil dihapus",
            });
          }
        );
      }
    );
  });

<<<<<<< HEAD
    // Endpoint untuk menghapus chat dengan nomor tertentu
    router.delete('/conversation/:number', (req, res) => {
        const number = req.params.number;
        
        const deleteQuery = 'DELETE FROM chats WHERE fromNumber = ?';
        
        db.run(deleteQuery, [number], function(err) {
            if (err) {
                console.error('Error deleting conversation:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            
            io.emit('conversationDeleted', { fromNumber: number, deletedCount: this.changes });
            
            res.json({ 
                success: true, 
                message: 'Percakapan berhasil dihapus',
                deletedCount: this.changes
            });
        });
    });

    // Endpoint untuk menghapus pesan tertentu
    router.delete('/message/:messageId', (req, res) => {
        const messageId = req.params.messageId;
        
        db.get('SELECT fromNumber FROM chats WHERE id = ?', [messageId], (err, messageData) => {
            if (err) {
                console.error('Error getting message data:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            
            if (!messageData) {
                return res.status(404).json({ error: 'Pesan tidak ditemukan' });
            }
            
            db.run('DELETE FROM chats WHERE id = ?', [messageId], function(deleteErr) {
                if (deleteErr) {
                    console.error('Error deleting message:', deleteErr);
                    res.status(500).json({ error: deleteErr.message });
                    return;
                }
                
                io.emit('messageDeleted', { 
                    messageId: messageId, 
                    fromNumber: messageData.fromNumber 
                });
                
                res.json({ 
                    success: true, 
                    message: 'Pesan berhasil dihapus' 
                });
            });
        });
    });

    // Endpoint untuk mendapatkan info kontak berdasarkan nomor
     router.get('/contact-info/:number', (req, res) => {
        const number = req.params.number;
        
        const contactQuery = `
=======
  // Endpoint untuk mendapatkan info kontak berdasarkan nomor
  router.get("/contact-info/:number", (req, res) => {
    const number = req.params.number;

    const contactQuery = `
>>>>>>> c30fff9d07870d08fef454d3581482465002141b
            SELECT 
                contacts.name,
                contacts.number,
                COUNT(chats.id) as totalMessages,
                MAX(chats.timestamp) as lastMessageTime,
                MIN(chats.timestamp) as firstMessageTime
            FROM contacts
            LEFT JOIN chats ON (
                contacts.number = chats.fromNumber 
                OR contacts.number = ('+' || chats.fromNumber)
                OR contacts.number = ('62' || SUBSTR(chats.fromNumber, 2))
            )
            WHERE contacts.number = ? 
                OR contacts.number = ('+' || ?)
                OR contacts.number = ('62' || SUBSTR(?, 2))
            GROUP BY contacts.id
        `;
<<<<<<< HEAD
        
        db.get(contactQuery, [number, number, number], (err, contact) => {
            if (err) {
                console.error('Error getting contact info:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            
            if (!contact) {
                const chatQuery = `
=======

    db.get(contactQuery, [number, number, number], (err, contact) => {
      if (err) {
        console.error("Error getting contact info:", err);
        res.status(500).json({ error: err.message });
        return;
      }

      if (!contact) {
        const chatQuery = `
>>>>>>> c30fff9d07870d08fef454d3581482465002141b
                    SELECT 
                        fromNumber as number,
                        COUNT(*) as totalMessages,
                        MAX(timestamp) as lastMessageTime,
                        MIN(timestamp) as firstMessageTime
                    FROM chats 
                    WHERE fromNumber = ?
                `;

        db.get(chatQuery, [number], (chatErr, chatInfo) => {
          if (chatErr) {
            console.error("Error getting chat info:", chatErr);
            res.status(500).json({ error: chatErr.message });
            return;
          }

          res.json({
            name: null,
            number: number,
            totalMessages: chatInfo ? chatInfo.totalMessages : 0,
            lastMessageTime: chatInfo ? chatInfo.lastMessageTime : null,
            firstMessageTime: chatInfo ? chatInfo.firstMessageTime : null,
            isContact: false,
          });
        });
      } else {
        res.json({
          name: contact.name,
          number: contact.number,
          totalMessages: contact.totalMessages || 0,
          lastMessageTime: contact.lastMessageTime,
          firstMessageTime: contact.firstMessageTime,
          isContact: true,
        });
      }
    });
  });

<<<<<<< HEAD
    // Endpoint untuk backup chat DENGAN nomor spesifik
    router.get('/backup/:number', (req, res) => {
        const number = req.params.number;
        const query = 'SELECT * FROM chats WHERE fromNumber = ? ORDER BY timestamp ASC';
        
        db.all(query, [number], (err, rows) => {
            if (err) {
                console.error('Error getting backup data:', err);
                return res.status(500).json({ error: err.message });
            }
            
            const filename = `chat_backup_${number}_${new Date().toISOString().split('T')[0]}.json`;
            
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.json({
                exportDate: new Date().toISOString(),
                totalMessages: rows.length,
                filterNumber: number,
                messages: rows
            });
        });
    });
    // Endpoint untuk backup SEMUA chat
    router.get('/backup', (req, res) => {
        const query = 'SELECT * FROM chats ORDER BY timestamp ASC';
        
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error('Error getting backup data:', err);
                return res.status(500).json({ error: err.message });
            }
            
            const filename = `chat_backup_all_${new Date().toISOString().split('T')[0]}.json`;
            
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.json({
                exportDate: new Date().toISOString(),
                totalMessages: rows.length,
                filterNumber: null,
                messages: rows
            });
        });
    });

=======
  // Endpoint untuk backup chat DENGAN nomor spesifik
  router.get("/backup/:number", (req, res) => {
    const number = req.params.number;
    const query =
      "SELECT * FROM chats WHERE fromNumber = ? ORDER BY timestamp ASC";

    db.all(query, [number], (err, rows) => {
      if (err) {
        console.error("Error getting backup data:", err);
        return res.status(500).json({ error: err.message });
      }

      const filename = `chat_backup_${number}_${
        new Date().toISOString().split("T")[0]
      }.json`;

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.json({
        exportDate: new Date().toISOString(),
        totalMessages: rows.length,
        filterNumber: number,
        messages: rows,
      });
    });
  });
  // Endpoint untuk backup SEMUA chat
  router.get("/backup", (req, res) => {
    const query = "SELECT * FROM chats ORDER BY timestamp ASC";

    db.all(query, [], (err, rows) => {
      if (err) {
        console.error("Error getting backup data:", err);
        return res.status(500).json({ error: err.message });
      }
>>>>>>> c30fff9d07870d08fef454d3581482465002141b

      const filename = `chat_backup_all_${
        new Date().toISOString().split("T")[0]
      }.json`;

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.json({
        exportDate: new Date().toISOString(),
        totalMessages: rows.length,
        filterNumber: null,
        messages: rows,
      });
    });
  });

  return router;
}

module.exports = createChatsRouter;
