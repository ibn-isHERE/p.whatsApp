const express = require("express");
const bodyParser = require("body-parser");
const http = require('http');
const cors = require("cors");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const path = require("path"); // DITAMBAHKAN

// DITAMBAHKAN: Socket.IO
const { Server } = require('socket.io');

// DITAMBAHKAN: Impor untuk fitur import dan upload
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const xlsx = require('xlsx');

const app = express();
const port = 3000;

// DITAMBAHKAN: Setup HTTP Server untuk Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware Express
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use('/media', express.static(path.join(__dirname, 'media')));

// DITAMBAHKAN: Konfigurasi Multer untuk menangani upload file
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const upload = multer({ dest: uploadDir });

// Inisialisasi Client WhatsApp
const client = new Client({
    puppeteer: {
        executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        headless: true,
    },
    authStrategy: new LocalAuth(),
});
app.locals.whatsappClient = client;

// DITAMBAHKAN: Set WhatsApp client dan Socket.IO untuk routes
app.set('whatsappClient', client);
app.set('io', io);

client.on("qr", (qr) => {
    console.log("Pindai kode QR ini dengan aplikasi WhatsApp Anda:");
    qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
    console.log("Client WhatsApp siap digunakan!");
    
    // Set client ke schedules module
    schedulesModule.setWhatsappClient(client);
    
    // Load schedules yang existing
    schedulesModule.loadAndScheduleExistingMessages();
    
    // Inisialisasi meetings module jika ada
    if (meetingsModule.initializeMeetings) {
        meetingsModule.initializeMeetings(db, client);
    }
});

// DITAMBAHKAN: Listener untuk pesan masuk WhatsApp
client.on('message', async (message) => {
    try {
        if (message.fromMe) return;

        const fromNumber = message.from.replace('@c.us', '');
        let messageContent = message.body;
        let messageType = message.type || 'chat';
        let mediaUrl = null;

        // ✅ LANGKAH KUNCI: Cek jika pesan memiliki media
        if (message.hasMedia) {
            const media = await message.downloadMedia();
            
            // Hanya proses jika tipenya gambar dan datanya ada
            if (media && media.mimetype.startsWith('image/')) {
                // Buat nama file yang unik
                const fileName = `${Date.now()}_${media.filename || fromNumber + '.jpg'}`;
                const filePath = path.join(mediaDir, fileName);

                // Simpan file gambar
                fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));

                // Siapkan URL yang akan diakses oleh frontend
                mediaUrl = `/media/${fileName}`;
                messageType = 'image'; // Ganti tipe pesan menjadi 'image'
                messageContent = '[Gambar]'; // Teks pengganti untuk notifikasi
                
                console.log(`🖼️ Gambar diterima dan disimpan di: ${filePath}`);
            }
        }

        // Jika tidak ada media atau media bukan gambar, proses seperti biasa
        if (messageType === 'chat' && !message.body) return; // Abaikan pesan kosong non-media

        const messageData = {
            fromNumber: fromNumber,
            message: messageContent,
            direction: 'in',
            timestamp: new Date().toISOString(),
            messageType: messageType,
            mediaUrl: mediaUrl, // <-- Simpan URL media
            isRead: false
        };

        // Simpan ke database (tambahkan kolom mediaUrl jika perlu)
        const insertQuery = `
            INSERT INTO chats (fromNumber, message, direction, timestamp, messageType, mediaUrl, isRead)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        
        db.run(insertQuery, [
            messageData.fromNumber, messageData.message, messageData.direction,
            messageData.timestamp, messageData.messageType, messageData.mediaUrl, messageData.isRead
        ], function(err) {
            if (err) {
                console.error('Error menyimpan pesan masuk:', err);
                return;
            }
            
            const completeMessageData = { id: this.lastID, ...messageData };
            io.emit('newIncomingMessage', completeMessageData);
            console.log('✅ Pesan (termasuk media) berhasil di-emit ke frontend');
        });

    } catch (error) {
        console.error('Error handling incoming message:', error);
    }
});

client.on("auth_failure", (msg) => {
    console.error("Gagal autentikasi WhatsApp:", msg);
});

client.on("disconnected", (reason) => {
    console.log("Client WhatsApp terputus:", reason);
    client.initialize();
});

client.initialize();

// Inisialisasi Database SQLite dari file terpisah
const db = require("./database.js");

// (Catatan: Blok impor modul di bawah ini mungkin perlu dihapus jika semua logika Anda masih di index.js)
const schedulesModule = require("./routes/schedules.js");
const meetingsModule = require("./routes/meetings");
const createContactsRouter = require("./routes/contacts");

// DITAMBAHKAN: Import chat routes
const createChatsRouter = require("./routes/chats");

// Setup routers
app.use("/", schedulesModule.router);
app.use("/", meetingsModule.router);
app.use("/api/contacts", createContactsRouter(db));

// DITAMBAHKAN: Setup chat routes
app.use("/api/chats", createChatsRouter(db, client, io));
app.use('/media', express.static(path.join(__dirname, 'media')));


// DITAMBAHKAN: Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('👤 Admin connected:', socket.id);
    
    // Handle test event dari frontend
    socket.on('test', (data) => {
        console.log('🧪 Test event received from frontend:', data);
        socket.emit('testResponse', { message: 'Backend received test' });
    });
    
    socket.on('disconnect', () => {
        console.log('👤 Admin disconnected:', socket.id);
    });
    
    // Debug: Log semua events yang diterima
    socket.onAny((eventName, ...args) => {
        console.log('📡 Socket event from client:', eventName, args);
    });
});

app.get("/get-all-schedules", (req, res) => {
  const { status } = req.query;

  let scheduleQuery = `SELECT *, 'message' as type FROM schedules`;
  let scheduleParams = [];
  
  // ==========================================================
  // PERBAIKAN #1: Ambil kolom 'filesData' yang asli dari database
  // ==========================================================
  let meetingQuery = `SELECT
    id,
    numbers,
    meetingTitle as message,
    filesData,
    datetime(start_epoch / 1000, 'unixepoch', 'localtime') as scheduledTime,
    status,
    meetingRoom,
    date,
    startTime,
    endTime,
    datetime(end_epoch / 1000, 'unixepoch', 'localtime') as meetingEndTime, -- <-- PERBAIKAN DI SINI
    'meeting' as type
  FROM meetings`;
  // ==========================================================
  
  let meetingParams = [];

  if (status && status !== "all") {
    scheduleQuery += ` WHERE status = ?`;
    meetingQuery += ` WHERE status = ?`;
    scheduleParams.push(status);
    meetingParams.push(status);
  }

  db.all(scheduleQuery, scheduleParams, (err, scheduleRows) => {
    if (err) {
      console.error("Gagal mengambil data schedules:", err.message);
      return res.status(500).json({ error: "Gagal mengambil data schedules." });
    }

    db.all(meetingQuery, meetingParams, (errMeeting, meetingRows) => {
      if (errMeeting) {
        console.error("Gagal mengambil data meetings:", errMeeting.message);
        return res.status(500).json({ error: "Gagal mengambil data meetings." });
      }

      try {
        const processedSchedules = scheduleRows.map((row) => {
          // ... (bagian ini sudah benar)
          return {
            id: row.id,
            numbers: JSON.parse(row.numbers || '[]'),
            message: row.message,
            filesData: JSON.parse(row.filesData || '[]'),
            scheduledTime: row.scheduledTime,
            status: row.status,
            type: "message",
          };
        });

        const processedMeetings = meetingRows.map((row) => {
          return {
            id: row.id,
            numbers: JSON.parse(row.numbers || '[]'),
            originalNumbers: JSON.parse(row.numbers || '[]'),
            message: row.message,
            meetingTitle: row.message,
            
            // ==========================================================
            // PERBAIKAN #2: Parse 'filesData' dari database, bukan array kosong
            // ==========================================================
            filesData: JSON.parse(row.filesData || '[]'),
            // ==========================================================

            scheduledTime: row.scheduledTime,
            meetingEndTime: row.meetingEndTime,
            status: row.status,
            type: "meeting",
            meetingRoom: row.meetingRoom,
            date: row.date,
            startTime: row.startTime,
            endTime: row.endTime,
          };
        });

        const allSchedules = [...processedSchedules, ...processedMeetings];
        
        // ... (logika sorting Anda tetap sama)
        allSchedules.sort((a, b) => {
          const isActiveA = a.status === "terjadwal" || a.status === "terkirim";
          const isActiveB = b.status === "terjadwal" || b.status === "terkirim";
          if (isActiveA && !isActiveB) return -1;
          if (!isActiveA && isActiveB) return 1;
          if (isActiveA && isActiveB) {
            return new Date(a.scheduledTime) - new Date(b.scheduledTime);
          } else {
            return new Date(b.scheduledTime) - new Date(a.scheduledTime);
          }
        });

        res.json(allSchedules);
      } catch (error) {
        console.error("Error processing combined schedule data:", error);
        res.status(500).json({ error: "Error processing combined schedule data" });
      }
    });
  });
});

app.get("/system-stats", (req, res) => {
  db.get(
    `SELECT COUNT(*) as totalMessages FROM schedules`,
    (err, messageCount) => {
      if (err) {
        return res.status(500).json({ error: "Error getting message stats" });
      }

      db.get(
        `SELECT COUNT(*) as totalMeetings FROM meetings`,
        (errMeeting, meetingCount) => {
          if (errMeeting) {
            return res
              .status(500)
              .json({ error: "Error getting meeting stats" });
          }

          db.get(
            `SELECT COUNT(*) as totalContacts FROM contacts`,
            (errContacts, contactCount) => {
              // DITAMBAHKAN: Stats untuk chats
              db.get(
                `SELECT COUNT(*) as totalChats, 
                        COUNT(CASE WHEN direction = 'in' AND isRead = FALSE THEN 1 END) as unreadMessages,
                        COUNT(DISTINCT fromNumber) as uniqueContacts
                 FROM chats`,
                (errChats, chatStats) => {
                  const stats = {
                    messages: {
                      total: messageCount ? messageCount.totalMessages : 0,
                    },

                    meetings: {
                      total: meetingCount ? meetingCount.totalMeetings : 0,
                    },

                    contacts: {
                      total: contactCount ? contactCount.totalContacts : 0,
                    },

                    // DITAMBAHKAN: Chat stats
                    chats: {
                      total: chatStats ? chatStats.totalChats : 0,
                      unread: chatStats ? chatStats.unreadMessages : 0,
                      uniqueContacts: chatStats ? chatStats.uniqueContacts : 0,
                    },

                    whatsappStatus: client.info ? "connected" : "disconnected",

                    serverUptime: process.uptime(),

                    timestamp: new Date().toISOString(),
                  }; 

                  // Get detailed status counts if needed
                  db.all(
                    `SELECT status, COUNT(*) as count FROM schedules GROUP BY status`,
                    (errStatus, statusRows) => {
                      if (!errStatus && statusRows) {
                        stats.messages.byStatus = {};

                        statusRows.forEach((row) => {
                          stats.messages.byStatus[row.status] = row.count;
                        });
                      }

                      db.all(
                        `SELECT status, COUNT(*) as count FROM meetings GROUP BY status`,
                        (errMeetingStatus, meetingStatusRows) => {
                          if (!errMeetingStatus && meetingStatusRows) {
                            stats.meetings.byStatus = {};

                            meetingStatusRows.forEach((row) => {
                              stats.meetings.byStatus[row.status] = row.count;
                            });
                          }

                          res.json(stats);
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    }
  );
});

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    whatsapp: client.info ? "connected" : "disconnected",
  });
});

app.post('/api/import', upload.single('contactFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('Tidak ada file yang diunggah.');
    }

    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    let contactsToImport = [];

    const processAndSave = (contacts) => {
        if (!contacts || contacts.length === 0) {
            fs.unlinkSync(filePath);
            return res.redirect('/?import_status=error&message=No+valid+contacts+found');
        }

        const sql = 'INSERT OR IGNORE INTO contacts (name, number) VALUES (?, ?)';
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            const stmt = db.prepare(sql);
            contacts.forEach(contact => {
                if (contact.name && contact.number) {
                    const cleanedNumber = String(contact.number).replace(/[^0-9+]/g, '');
                    stmt.run(String(contact.name), cleanedNumber);
                }
            });
            stmt.finalize();
            db.run('COMMIT', (err) => {
                fs.unlinkSync(filePath);
                if (err) {
                    return res.redirect('/?import_status=error&message=Database+error');
                }
                res.redirect('/?import_status=success');
            });
        });
    };

    try {
        if (fileExt === '.csv') {
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (row) => contactsToImport.push(row))
                .on('end', () => processAndSave(contactsToImport));
        } else if (fileExt === '.xlsx' || fileExt === '.xls') {
            const workbook = xlsx.readFile(filePath);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            contactsToImport = xlsx.utils.sheet_to_json(sheet);
            processAndSave(contactsToImport);
        } else if (fileExt === '.json') {
            contactsToImport = JSON.parse(fs.readFileSync(filePath));
            processAndSave(contactsToImport);
        } else {
            fs.unlinkSync(filePath);
            res.status(400).send('Tipe file tidak didukung. Harap gunakan CSV, Excel, atau JSON.');
        }
    } catch (error) {
        console.error("Gagal memproses file import:", error);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).send('Terjadi kesalahan saat memproses file.');
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    // ... (Logika error handling Anda)
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  client.destroy();
  db.close((err) => {
    if (err) {
      console.error("Error closing database:", err.message);
    } else {
      console.log("Database connection closed.");
    }
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Shutting down gracefully...");
  client.destroy();
  db.close((err) => {
    if (err) {
      console.error("Error closing database:", err.message);
    } else {
      console.log("Database connection closed.");
    }
    process.exit(0);
  });
});


// DIUBAH: Gunakan server.listen() bukan app.listen() untuk Socket.IO
server.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
  console.log(`Socket.IO server ready`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log("=".repeat(50));
});

module.exports = app;
