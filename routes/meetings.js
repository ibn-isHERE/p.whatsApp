const express = require("express");
const schedule = require("node-schedule");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { MessageMedia } = require("whatsapp-web.js");
const router = express.Router();

// Middleware untuk parsing JSON body
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

// Di dalam file: meetings.js
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({ storage: storage });

// Variable untuk menyimpan instance database dan client WhatsApp
let db = null;
let client = null;
let meetingJobs = {}; // Untuk menyimpan scheduled jobs

// Ruangan yang tersedia
const ROOMS = [
  "Aula Lantai 3",
  "Ruang Sungkai", 
  "Ruang Distribusi",
  "Ruang Garda SE",
  "Ruang PST",
];

function deleteFileIfExists(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
            if (err) console.error(`Gagal menghapus file: ${filePath}`, err);
            else console.log(`File usang dihapus: ${filePath}`);
        });
    }
}

/**
 * Inisialisasi modul meetings dengan database dan WhatsApp client
 * @param {Object} database - Instance database SQLite
 * @param {Object} whatsappClient - Instance WhatsApp client
 */
function initializeMeetings(database, whatsappClient) {
    db = database;
    client = whatsappClient;
    
    console.log("Meeting module initialized");
    
    // Buat tabel meetings jika belum ada
    createMeetingsTable();
    
    // Load dan schedule existing meetings
    setTimeout(() => {
        loadAndScheduleExistingMeetings();
    }, 1000);
}

/**
 * Buat tabel meetings jika belum ada - UPDATED with epoch columns
 */
function createMeetingsTable() {
    if (!db) {
        console.error("Database tidak tersedia untuk meetings");
        return;
    }

    const createTableSQL = `
        CREATE TABLE IF NOT EXISTS meetings (
            id TEXT PRIMARY KEY,
            meetingTitle TEXT NOT NULL,
            numbers TEXT NOT NULL,
            meetingRoom TEXT NOT NULL,
            date TEXT NOT NULL,
            startTime TEXT NOT NULL,
            endTime TEXT NOT NULL,
            start_epoch INTEGER,
            end_epoch INTEGER,
            status TEXT DEFAULT 'terjadwal',
            filesData TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    db.run(createTableSQL, (err) => {
        if (err) {
            console.error("Gagal membuat tabel meetings:", err.message);
        } else {
            console.log("Tabel meetings berhasil dibuat/diperiksa");
            
            // Migrasi data lama jika kolom epoch belum ada
            db.run(`ALTER TABLE meetings ADD COLUMN start_epoch INTEGER`, (err) => {
                if (!err) console.log("Added start_epoch column");
            });
            db.run(`ALTER TABLE meetings ADD COLUMN end_epoch INTEGER`, (err) => {
                if (!err) console.log("Added end_epoch column");
            });
        }
    });
}

/**
 * Format nomor ke format WhatsApp: 62XXXXXXXXXX@c.us
 */
function formatNumber(inputNumber) {
    let number = String(inputNumber).trim();
    number = number.replace(/\D/g, "");

    if (number.startsWith("0")) {
        number = "62" + number.slice(1);
    }

    if (!/^62\d{8,13}$/.test(number)) {
        console.warn(`Format nomor tidak valid: ${inputNumber} -> ${number}`);
        return null;
    }
    return number + "@c.us";
}


/**
 * Convert datetime ke epoch dengan timezone Asia/Jakarta
 */
function dateTimeToEpoch(dateStr, timeStr) {
    // Format: YYYY-MM-DD dan HH:mm
    const isoString = `${dateStr}T${timeStr}:00.000+07:00`;
    return new Date(isoString).getTime();
}

/**
 * Convert epoch ke date dan time dengan timezone Asia/Jakarta
 */
function epochToDateTime(epochMs) {
    const date = new Date(epochMs);
    // Format ke timezone Asia/Jakarta
    const jakartaTime = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(date);
    
    const [datePart, timePart] = jakartaTime.split(' ');
    return { date: datePart, time: timePart };
}

/**
 * Parse datetime-local ke epoch dengan timezone Jakarta
 */
function parseDateTime(datetimeLocal) {
    // Input format: YYYY-MM-DDTHH:mm
    const [datePart, timePart] = datetimeLocal.split('T');
    const epoch = dateTimeToEpoch(datePart, timePart);
    return { 
        date: datePart, 
        time: timePart,
        epoch: epoch
    };
}

/**
 * Konversi waktu ke menit untuk perhitungan overlap
 */
function timeToMinutes(timeString) {
    const [hours, minutes] = timeString.split(":").map(Number);
    return hours * 60 + minutes;
}

/**
 * Cek overlap waktu
 */
function checkTimeOverlap(start1, end1, start2, end2) {
    const start1Min = timeToMinutes(start1);
    const end1Min = timeToMinutes(end1);
    const start2Min = timeToMinutes(start2);
    const end2Min = timeToMinutes(end2);

    return start1Min < end2Min && start2Min < end1Min;
}

/**
 * Cek apakah rapat masih aktif
 */
function isMeetingActive(meeting) {
    const now = new Date().getTime();
    
    // Gunakan epoch jika tersedia, fallback ke parsing manual
    let startEpoch, endEpoch;
    
    if (meeting.start_epoch && meeting.end_epoch) {
        startEpoch = meeting.start_epoch;
        endEpoch = meeting.end_epoch;
    } else {
        startEpoch = dateTimeToEpoch(meeting.date, meeting.startTime);
        endEpoch = dateTimeToEpoch(meeting.date, meeting.endTime);
    }

    const isStatusActive = ['terjadwal', 'terkirim'].includes(meeting.status);
    const isTimeActive = now >= startEpoch && now < endEpoch;
    const isScheduledFuture = now < startEpoch;

    return isStatusActive && (isTimeActive || isScheduledFuture);
}

/**
 * Update status rapat yang sudah expired
 */
function updateExpiredMeetings() {
    return new Promise((resolve) => {
        if (!db) return resolve();
        const now = new Date().getTime();
        db.all(`SELECT id, end_epoch, date, endTime FROM meetings WHERE status IN ('terjadwal', 'terkirim')`, [], (err, rows) => {
            if (err || rows.length === 0) return resolve();
            
            let completed = 0;
            rows.forEach((meeting) => {
                const endEpoch = meeting.end_epoch || dateTimeToEpoch(meeting.date, meeting.endTime);
                if (now > endEpoch) {
                    db.run(`UPDATE meetings SET status = 'selesai' WHERE id = ?`, [meeting.id], () => {
                        if (++completed === rows.length) resolve();
                    });
                } else {
                    if (++completed === rows.length) resolve();
                }
                // ---> TAMBAHKAN LOGIKA PENGHAPUSAN FILE DI SINI <---
                if (meeting.filesData) {
                    const files = JSON.parse(meeting.filesData);
                    if (Array.isArray(files)) {
                        files.forEach(file => deleteFileIfExists(file.path));
                    }
                }
            });
        });
    });
}

/**
 * Format waktu countdown
 */
function formatTimeLeft(timeDifferenceMs) {
    const hours = Math.floor(timeDifferenceMs / (1000 * 60 * 60));
    const minutes = Math.floor((timeDifferenceMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
        return `${hours} jam ${minutes} menit`;
    } else if (minutes > 0) {
        return `${minutes} menit`;
    } else {
        return "kurang dari 1 menit";
    }
}

/**
 * Kirim reminder WhatsApp
 */
async function sendWhatsAppReminder(meeting, customTimeLeft = null) {
    if (!client) {
        console.error("Client WA belum siap, skip pengiriman.");
        return false;
    }

    const meetingTimeStr = `${meeting.date} ${meeting.startTime}-${meeting.endTime}`;
    const timeLeftMessage = customTimeLeft || "1 jam";
    const message =
        `🔔 *PENGINGAT RAPAT*\n\n` +
        `🗓️ *Judul:* ${meeting.meetingTitle}\n` +
        `📍 *Ruangan:* ${meeting.meetingRoom}\n` +
        `⏰ *Waktu:* ${meetingTimeStr}\n\n` +
        `⏳ Rapat akan dimulai dalam *${timeLeftMessage}* lagi!`;

    let numbersArray = [];
    try {
        numbersArray = Array.isArray(meeting.numbers) ? meeting.numbers : JSON.parse(meeting.numbers);
    } catch (e) {
        console.error("Gagal parsing JSON numbers di sendWhatsAppReminder:", e);
        return false;
    }

    if (numbersArray.length === 0) return false;

    let medias = [];
    if (meeting.filesData) {
        try {
            const files = JSON.parse(meeting.filesData);
            for (const file of files) {
                if (fs.existsSync(file.path)) {
                    const media = MessageMedia.fromFilePath(file.path);
                    medias.push(media);
                } else {
                    console.warn(`File not found for meeting reminder: ${file.path}`);
                }
            }
        } catch (e) {
            console.error("Gagal memproses filesData untuk reminder:", e);
        }
    }

    let sentSuccess = true;
    for (const num of numbersArray) {
        try {
            const formattedNum = formatNumber(num);
            if (formattedNum) {
                // Kirim pesan teks utama terlebih dahulu
                await client.sendMessage(formattedNum, message);
                
                // Setelah itu, kirim setiap file satu per satu
                for (const media of medias) {
                    await client.sendMessage(formattedNum, media, { 
                        caption: `Dokumen untuk rapat: ${meeting.meetingTitle}` 
                    });
                }
                console.log("WA reminder rapat terkirim ke:", num);
            }
        } catch (err) {
            console.error(`Gagal kirim WA reminder rapat ke ${num}:`, err.message);
            sentSuccess = false;
        }
    }

    return sentSuccess;
}

/**
 * Schedule meeting reminder - UPDATED with epoch calculations
 */
function scheduleMeetingReminder(meeting) {
    const now = new Date().getTime();
    
    // Gunakan epoch jika tersedia
    let startEpoch;
    if (meeting.start_epoch) {
        startEpoch = meeting.start_epoch;
    } else {
        startEpoch = dateTimeToEpoch(meeting.date, meeting.startTime);
    }
    
    const timeDifference = startEpoch - now;
    const hourInMs = 60 * 60 * 1000;
    
    const jobId = `meeting_${meeting.id}`;
    
    // Cancel existing job
    if (meetingJobs[jobId]) {
        meetingJobs[jobId].cancel();
        delete meetingJobs[jobId];
    }

    // Jika kurang dari 1 jam, kirim langsung
    if (timeDifference < hourInMs && timeDifference > 0) {
        const timeLeft = formatTimeLeft(timeDifference);
        console.log(`Meeting ${meeting.id} dimulai dalam ${timeLeft}, kirim reminder langsung`);

        sendWhatsAppReminder(meeting, timeLeft).then((success) => {
            if (success) {
                updateMeetingStatus(meeting.id, 'terkirim');
            }
        });
        return;
    }

    // Jika sudah lewat, skip
    if (timeDifference <= 0) {
        console.log(`Meeting ${meeting.id} sudah lewat, tidak dijadwalkan`);
        return;
    }

    // Schedule 1 jam sebelumnya
    const reminderEpoch = startEpoch - hourInMs;
    const reminderTime = new Date(reminderEpoch);
    
    if (reminderEpoch < now) {
        console.log(`Reminder untuk meeting ${meeting.id} sudah lewat`);
        return;
    }

    meetingJobs[jobId] = schedule.scheduleJob(reminderTime, async () => {
        // Cek status terbaru sebelum kirim
        db.get(
            "SELECT * FROM meetings WHERE id = ?",
            [meeting.id],
            async (err, row) => {
                if (err || !row) {
                    console.error(`Error checking status for meeting ${meeting.id}`);
                    return;
                }

                if (row.status === 'terjadwal') {
                    const success = await sendWhatsAppReminder(row);
                    if (success) {
                        updateMeetingStatus(meeting.id, 'terkirim');
                    }
                }
            }
        );
        
        delete meetingJobs[jobId];
    });

    console.log(`Reminder untuk meeting ${meeting.id} dijadwalkan pada ${reminderTime.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
}

/**
 * Update status meeting di database
 */
function updateMeetingStatus(meetingId, status) {
    if (!db) return;

    db.run(
        `UPDATE meetings SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        [status, meetingId],
        (err) => {
            if (err) {
                console.error(`Gagal update status meeting ${meetingId}:`, err.message);
            } else {
                console.log(`Status meeting ${meetingId} diupdate ke '${status}'`);
            }
        }
    );
}

/**
 * Load dan schedule existing meetings dari database
 */
function loadAndScheduleExistingMeetings() {
    if (!db) {
        console.error("Database belum diinisialisasi untuk memuat meetings");
        return;
    }

    db.all(
        `SELECT * FROM meetings WHERE status = 'terjadwal' ORDER BY date ASC, startTime ASC`,
        [],
        (err, rows) => {
            if (err) {
                console.error("Gagal load meetings dari DB:", err.message);
                return;
            }

            console.log(`Ditemukan ${rows.length} meeting terjadwal`);

            let scheduledCount = 0;
            rows.forEach((meeting) => {
                if (isMeetingActive(meeting)) {
                    scheduleMeetingReminder(meeting);
                    scheduledCount++;
                }
            });

            console.log(`${scheduledCount} meeting reminder berhasil dijadwalkan`);
            
            // Update expired meetings
            updateExpiredMeetings();
        }
    );
}

/**
 * Cek conflict ruangan - UPDATED with epoch support
 */
function checkRoomConflict(date, startTime, endTime, meetingRoom, excludeId = null) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error("Database tidak tersedia"));
            return;
        }

        let query = `
            SELECT * FROM meetings 
            WHERE meetingRoom = ? AND date = ? AND status IN ('terjadwal', 'terkirim')
        `;
        let params = [meetingRoom, date];

        if (excludeId) {
            query += ` AND id != ?`;
            params.push(excludeId);
        }

        db.all(query, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            const conflictingMeeting = rows.find(meeting => 
                checkTimeOverlap(startTime, endTime, meeting.startTime, meeting.endTime)
            );

            resolve(conflictingMeeting);
        });
    });
}

/**
 * Validasi input meeting - UPDATED without day restriction
 */
function validateMeetingInput(meetingTitle, numbers, meetingRoom, startTime, endTime) {
    if (!meetingTitle || !numbers || !meetingRoom || !startTime || !endTime) {
        return "Semua field harus diisi";
    }

    if (!ROOMS.includes(meetingRoom)) {
        return "Ruangan tidak valid";
    }

    // Parse dengan timezone yang benar
    const startParsed = parseDateTime(startTime);
    const endParsed = parseDateTime(endTime);

    if (endParsed.epoch <= startParsed.epoch) {
        return "Waktu selesai harus lebih besar dari waktu mulai";
    }

    const durationMinutes = (endParsed.epoch - startParsed.epoch) / (1000 * 60);
    if (durationMinutes < 15) {
        return "Durasi rapat minimal 15 menit";
    }

    const now = new Date().getTime();
    if (startParsed.epoch <= now) {
        return "Waktu rapat harus di masa depan";
    }

    // Validasi format nomor
    let numbersArray;
    try {
        numbersArray = Array.isArray(numbers) ? numbers : JSON.parse(numbers);
        if (!Array.isArray(numbersArray) || numbersArray.length === 0) {
            throw new Error("Numbers harus berupa array dan tidak boleh kosong");
        }
    } catch (e) {
        return "Format nomor tidak valid";
    }

    const invalidNumbers = numbersArray.filter(
        (n) => !/^(0|62)\d{8,13}$/.test(String(n).trim().replace(/\D/g, ""))
    );
    
    if (invalidNumbers.length > 0) {
        return `Nomor tidak valid: ${invalidNumbers.join(", ")}. Pastikan format 08xxxxxxxxxx atau 628xxxxxxxxxx`;
    }

    return null; // Valid
}

// Auto update expired meetings setiap 5 menit
setInterval(() => {
    updateExpiredMeetings();
}, 5 * 1000);

// ===== ROUTES =====

/**
 * GET semua meetings
 */
router.get("/meetings", async (req, res) => {
    if (!db) return res.status(500).json({ error: "Database tidak tersedia" });
    try {
        await updateExpiredMeetings(); // Tunggu status selesai diupdate
        db.all(`SELECT * FROM meetings ORDER BY start_epoch DESC`, [], (err, rows) => {
            if (err) return res.status(500).json({ error: "Gagal mengambil data meetings" });
            const meetings = rows.map(m => ({
                ...m,
                numbers: JSON.parse(m.numbers || '[]'),
                filesData: JSON.parse(m.filesData || '[]'),
                scheduledTime: new Date(m.start_epoch).toISOString(),
                meetingEndTime: new Date(m.end_epoch).toISOString(),
                type: 'meeting'
            }));
            res.json(meetings);
        });
    } catch (error) {
        res.status(500).json({ error: "Gagal memproses permintaan." });
    }
});

/**
 * GET meeting by ID - UPDATED for proper edit form population
 */
router.get("/meeting/:id", (req, res) => {
    const { id } = req.params;
    
    if (!db) {
        return res.status(500).json({ error: "Database tidak tersedia" });
    }

    db.get(
        `SELECT * FROM meetings WHERE id = ?`,
        [id],
        (err, row) => {
            if (err) {
                console.error("Error mengambil meeting:", err.message);
                return res.status(500).json({ error: "Gagal mengambil data meeting" });
            }

            if (!row) {
                return res.status(404).json({ error: "Meeting tidak ditemukan" });
            }

            // Parse numbers dan convert back untuk display
            let displayNumbers = [];
            try {
                const storedNumbers = JSON.parse(row.numbers);
                displayNumbers = storedNumbers.map(num => {
                    // Convert dari format WhatsApp (628xxxxx@c.us) ke display (08xxxxx)
                    let cleanNum = String(num).replace('@c.us', '');
                    if (cleanNum.startsWith('62')) {
                        cleanNum = '0' + cleanNum.substring(2);
                    }
                    return cleanNum;
                });
            } catch (e) {
                console.error("Error parsing stored numbers:", e);
                displayNumbers = [];
            }

            // Parse files data - PENTING: harus dikembalikan
            let filesData = [];
            if (row.filesData) {
                try {
                    filesData = JSON.parse(row.filesData);
                } catch (e) {
                    console.error("Error parsing files data:", e);
                    filesData = [];
                }
            }

            const meeting = {
                ...row,
                numbers: displayNumbers,
                startDateTime: `${row.date}T${row.startTime}`,
                endDateTime: `${row.date}T${row.endTime}`,
                files: filesData, // PENTING: Return files data
                filesData: filesData // Keep both for compatibility
            };

            res.json(meeting);
        }
    );
});

/**
 * GET daftar ruangan
 */
router.get("/meeting-rooms", (req, res) => {
    res.json(ROOMS);
});

/**
 * GET active meetings
 */
router.get("/active-meetings", (req, res) => {
    if (!db) {
        return res.status(500).json({ error: "Database tidak tersedia" });
    }

    updateExpiredMeetings();
    
    db.all(
        `SELECT * FROM meetings WHERE status IN ('terjadwal', 'terkirim') ORDER BY date ASC, startTime ASC`,
        [],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: "Error mengambil active meetings" });
            }

            const activeMeetings = rows.filter(meeting => isMeetingActive(meeting));
            
            res.json({
                total: activeMeetings.length,
                meetings: activeMeetings.map(m => ({
                    id: m.id,
                    title: m.meetingTitle,
                    room: m.meetingRoom,
                    date: m.date,
                    startTime: m.startTime,
                    endTime: m.endTime,
                    status: m.status,
                    
                    // --- TAMBAHKAN BARIS INI UNTUK MENYERTAKAN FILE ---
                    filesData: JSON.parse(m.filesData || '[]')
                    
                }))
            });
        }
    );
});

/**
 * POST cek ketersediaan ruangan
 */
router.post("/check-room-availability", async (req, res) => {
    try {
        const { roomId, startTime, endTime, excludeId } = req.body;

        if (!roomId || !startTime || !endTime) {
            return res.json({
                available: false,
                message: "Data tidak lengkap (roomId, startTime, endTime harus diisi)",
            });
        }

        const startParsed = parseDateTime(startTime);
        const endParsed = parseDateTime(endTime);

        updateExpiredMeetings();
        
        const conflictingMeeting = await checkRoomConflict(
            startParsed.date,
            startParsed.time,
            endParsed.time,
            roomId,
            excludeId
        );

        if (conflictingMeeting) {
            const conflictMessage = 
                `<strong>Ruangan ${roomId} sudah terpakai pada waktu tersebut:</strong><br><br>` +
                `<strong>${conflictingMeeting.meetingTitle}</strong><br>` +
                `&nbsp;&nbsp;&nbsp;Waktu: ${conflictingMeeting.startTime} - ${conflictingMeeting.endTime}<br>` +
                `&nbsp;&nbsp;&nbsp;Status: ${conflictingMeeting.status}<br><br>` +
                `<small>Silakan pilih waktu atau ruangan lain.</small>`;

            return res.json({
                available: false,
                message: conflictMessage,
            });
        }

        res.json({
            available: true,
            message: "Ruangan tersedia",
        });
        
    } catch (error) {
        console.error("Error checking room availability:", error);
        res.json({
            available: false,
            message: "Terjadi kesalahan server saat memeriksa ketersediaan ruangan",
        });
    }
});

/**
 * POST tambah meeting - UPDATED with epoch storage
 */
router.post("/add-meeting", upload.array('files', 5), async (req, res) => {
    try {
        console.log("\n--- [CHECK] DATA DITERIMA DI /add-meeting ---");
        console.log("Isi dari req.files:", req.files);
        const { meetingTitle, numbers, meetingRoom, startTime, endTime } = req.body;

        // Validasi input
        const validationError = validateMeetingInput(meetingTitle, numbers, meetingRoom, startTime, endTime);
        if (validationError) {
            return res.status(400).json({ success: false, message: validationError });
        }

        const startParsed = parseDateTime(startTime);
        const endParsed = parseDateTime(endTime);

        // Cek conflict
        const conflictingMeeting = await checkRoomConflict(
            startParsed.date,
            startParsed.time,
            endParsed.time,
            meetingRoom
        );

        if (conflictingMeeting) {
            return res.status(400).json({
                success: false,
                message: `Ruangan ${meetingRoom} sudah terpakai pada ${conflictingMeeting.startTime} - ${conflictingMeeting.endTime} untuk rapat "${conflictingMeeting.meetingTitle}"`,
                conflictingMeeting: {
                    title: conflictingMeeting.meetingTitle,
                    startTime: conflictingMeeting.startTime,
                    endTime: conflictingMeeting.endTime,
                    status: conflictingMeeting.status
                }
            });
        }

        // Process files
        let filesData = null;
        let filesArray = [];
        if (req.files && req.files.length > 0) {
            filesArray = req.files.map(file => ({
                path: file.path,
                name: file.originalname,
                mimetype: file.mimetype
            }));
            filesData = JSON.stringify(filesArray);
        }

        // Proses nomor
        const numbersArray = Array.isArray(numbers) ? numbers : JSON.parse(numbers);
        const formattedNumbers = numbersArray.map((n) => {
            let num = String(n).trim().replace(/\D/g, "");
            if (num.startsWith("0")) num = "62" + num.slice(1);
            return num + "@c.us";
        });

        const meetingId = Date.now().toString();
        
        db.run(
            `INSERT INTO meetings (id, meetingTitle, numbers, meetingRoom, date, startTime, endTime, start_epoch, end_epoch, status, filesData, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [
                meetingId, 
                meetingTitle, 
                JSON.stringify(formattedNumbers), 
                meetingRoom, 
                startParsed.date, 
                startParsed.time, 
                endParsed.time,
                startParsed.epoch,
                endParsed.epoch,
                "terjadwal", 
                filesData
            ],
            function (err) {
                if (err) {
                    console.error("Gagal simpan meeting ke DB:", err.message);
                    return res.status(500).json({ success: false, message: "Gagal simpan meeting ke database" });
                }

                // Schedule reminder
                const meetingData = {
                    id: meetingId,
                    meetingTitle,
                    numbers: JSON.stringify(formattedNumbers),
                    meetingRoom,
                    date: startParsed.date,
                    startTime: startParsed.time,
                    endTime: endParsed.time,
                    start_epoch: startParsed.epoch,
                    end_epoch: endParsed.epoch,
                    status: "terjadwal",
                    filesData: filesData
                };
                
                scheduleMeetingReminder(meetingData);

                res.json({
                    success: true,
                    message: "Meeting berhasil dijadwalkan",
                    data: {
                        id: meetingId,
                        title: meetingTitle,
                        room: meetingRoom,
                        startTime: startTime,
                        endTime: endTime,
                        participants: numbersArray,
                        files: filesArray.map(f => f.name),
                        filesData: filesArray // Return full file data
                    },
                });
            }
        );
        
    } catch (error) {
        console.error("Error adding meeting:", error);
        res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
    }
});


router.put("/edit-meeting/:id", upload.array('files', 5), async (req, res) => {
    const { id } = req.params;
    const { meetingTitle, numbers, meetingRoom, startTime, endTime } = req.body;
    const newFiles = req.files;

    try {
        // 1. Validasi input
        const validationError = validateMeetingInput(meetingTitle, numbers, meetingRoom, startTime, endTime);
        if (validationError) {
            if (newFiles) newFiles.forEach(f => deleteFileIfExists(f.path));
            return res.status(400).json({ success: false, message: validationError });
        }

        // 2. Ambil data meeting lama (menggunakan Promise)
        const currentMeeting = await new Promise((resolve, reject) => {
            db.get("SELECT filesData FROM meetings WHERE id = ?", [id], (err, row) => {
                if (err) return reject(new Error("Gagal mengakses database."));
                resolve(row);
            });
        });

        if (!currentMeeting) {
            if (newFiles) newFiles.forEach(f => deleteFileIfExists(f.path));
            return res.status(404).json({ success: false, message: "Jadwal rapat tidak ditemukan." });
        }

       // 3. Logika Penanganan File yang Jelas dan Aman
let finalFilesData = currentMeeting.filesData; // Default: pertahankan file lama
const hasNewFiles = newFiles && newFiles.length > 0;

// Ambil status checkbox dari body request. 
// Nilainya akan 'on' jika dicentang, dan `undefined` jika tidak dicentang.
const keepOriginalFile = req.body.meetingKeepOriginalFile;

// KONDISI 1: Ada file baru diupload (Ganti file lama)
if (hasNewFiles) {
    console.log(`File baru terdeteksi untuk meeting ID ${id}. File lama akan diganti.`);
    
    // Hapus file fisik yang lama dari server
    const oldFiles = JSON.parse(currentMeeting.filesData || '[]');
    if (Array.isArray(oldFiles)) {
        oldFiles.forEach(file => deleteFileIfExists(file.path));
    }

    // Siapkan data JSON untuk file yang baru
    finalFilesData = JSON.stringify(newFiles.map(f => ({
        path: f.path, 
        name: f.originalname, 
        mimetype: f.mimetype
    })));
} 
// KONDISI 2 (BARU): TIDAK ada file baru DAN checkbox TIDAK dicentang (Hapus file lama)
else if (!keepOriginalFile && currentMeeting.filesData) {
    console.log(`Menghapus file lama untuk meeting ID ${id} karena checkbox tidak dicentang.`);

    // Hapus file fisik yang lama dari server
    const oldFiles = JSON.parse(currentMeeting.filesData || '[]');
    if (Array.isArray(oldFiles)) {
        oldFiles.forEach(file => deleteFileIfExists(file.path));
    }

    finalFilesData = null; // Set data di database menjadi null
}
// KONDISI 3 (Implisit): Tidak ada file baru DAN checkbox dicentang.
// Tidak ada kode yang dijalankan, sehingga `finalFilesData` tetap berisi data file yang lama.
        // 4. Update database
        const startParsed = parseDateTime(startTime);
        const endParsed = parseDateTime(endTime);
        const formattedNumbers = JSON.parse(numbers).map(num => formatNumber(num)).filter(Boolean);
        const query = `
            UPDATE meetings SET 
                meetingTitle = ?, numbers = ?, meetingRoom = ?, date = ?, startTime = ?, endTime = ?, 
                start_epoch = ?, end_epoch = ?, filesData = ?, updatedAt = CURRENT_TIMESTAMP 
            WHERE id = ?`;
        const params = [
            meetingTitle, JSON.stringify(formattedNumbers), meetingRoom,
            startParsed.date, startParsed.time, endParsed.time,
            startParsed.epoch, endParsed.epoch, finalFilesData, id
        ];

        await new Promise((resolve, reject) => {
            db.run(query, params, function(err) {
                if (err) return reject(new Error("Gagal menyimpan perubahan ke database."));
                resolve(this);
            });
        });

        console.log(`Meeting ID ${id} berhasil diupdate.`);
        // Jadwalkan ulang reminder... (jika diperlukan)
        
        res.json({ success: true, message: "Jadwal rapat berhasil diupdate!" });

    } catch (error) {
        if (newFiles) newFiles.forEach(f => deleteFileIfExists(f.path));
        console.error("Error fatal pada rute /edit-meeting:", error.message);
        res.status(500).json({ success: false, message: error.message || "Terjadi kesalahan server." });
    }
});


/**
 * PUT cancel meeting
 */
// Ganti route /cancel-meeting/:id Anda dengan versi lengkap ini
router.put('/cancel-meeting/:id', async (req, res) => {
    const { id } = req.params;

    if (!db) {
        return res.status(500).json({ success: false, message: "Database tidak tersedia" });
    }

    try {
        // LANGKAH 1 (BARU): Ambil data file SEBELUM mengubah status
        const meeting = await new Promise((resolve, reject) => {
            db.get("SELECT filesData FROM meetings WHERE id = ?", [id], (err, row) => {
                if (err) return reject(new Error("Gagal mengakses database."));
                resolve(row);
            });
        });

        if (!meeting) {
            return res.status(404).json({ success: false, message: "Meeting tidak ditemukan" });
        }

        // LANGKAH 2: Update status menjadi 'dibatalkan'
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE meetings SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
                ["dibatalkan", id],
                function (err) {
                    if (err) return reject(new Error("Gagal membatalkan meeting di database."));
                    if (this.changes === 0) return reject(new Error("Meeting tidak ditemukan saat update."));
                    resolve(this);
                }
            );
        });

        // LANGKAH 3 (BARU): Hapus file fisik yang terkait
        if (meeting.filesData) {
            const files = JSON.parse(meeting.filesData);
            if (Array.isArray(files)) {
                files.forEach(file => deleteFileIfExists(file.path)); // Menggunakan helper function Anda
            }
        }

        // LANGKAH 4: Batalkan reminder (logika ini sudah benar)
        const jobId = `meeting_${id}`;
        if (meetingJobs[jobId]) {
            meetingJobs[jobId].cancel();
            delete meetingJobs[jobId];
            console.log(`Reminder untuk meeting ${id} dibatalkan`);
        }

        res.json({
            success: true,
            message: "Meeting berhasil dibatalkan dan file terkait telah dihapus"
        });

    } catch (error) {
        console.error("Error pada rute /cancel-meeting:", error.message);
        res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
    }
});

/**
 * DELETE meeting
 */
router.delete("/delete-meeting/:id", (req, res) => {
    const { id } = req.params;

    if (!db) {
        return res.status(500).json({ success: false, message: "Database tidak tersedia" });
    }

    // First get the meeting to clean up files
    db.get("SELECT * FROM meetings WHERE id = ?", [id], (err, meeting) => {
        if (err) {
            console.error("Error getting meeting for deletion:", err.message);
            return res.status(500).json({ success: false, message: "Error mengambil data meeting" });
        }

        // Delete associated files
        // KODE BARU DENGAN LOG DETAIL
if (meeting && meeting.filesData) {
    try {
        console.log("========================================");
        console.log("Mencoba menghapus file untuk meeting:", id);
        const files = JSON.parse(meeting.filesData);
        console.log("Data file yang ditemukan di DB:", files);

        files.forEach(file => {
            const filePath = file.path; 
            console.log(`--> Mengecek path: ${filePath}`);

            if (fs.existsSync(filePath)) {
                console.log(`    Path DITEMUKAN. Mencoba menghapus...`);
                fs.unlinkSync(filePath);
                console.log(`    File BERHASIL dihapus: ${filePath}`);
            } else {
                console.log(`    Path TIDAK DITEMUKAN. File tidak dihapus.`);
            }
        });
        console.log("========================================");
    } catch (e) {
        console.error("Error saat parsing JSON atau menghapus file:", e);
    }
}

        // Delete from database
        db.run("DELETE FROM meetings WHERE id = ?", [id], function (err) {
            if (err) {
                console.error("Gagal hapus meeting dari DB:", err.message);
                return res.status(500).json({ success: false, message: "Gagal hapus meeting dari database" });
            }

            if (this.changes === 0) {
                return res.status(404).json({ success: false, message: "Meeting tidak ditemukan" });
            }

            // Cancel job
            const jobId = `meeting_${id}`;
            if (meetingJobs[jobId]) {
                meetingJobs[jobId].cancel();
                delete meetingJobs[jobId];
                console.log(`Reminder untuk meeting ${id} dibatalkan`);
            }

            res.json({
                success: true,
                message: "Meeting berhasil dihapus"
            });
        });
    });
});

/**
 * PUT finish meeting
 */
router.put('/finish-meeting/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // LANGKAH 1: Ambil data meeting dulu untuk mendapatkan info file
        const meeting = await new Promise((resolve, reject) => {
            db.get("SELECT filesData FROM meetings WHERE id = ?", [id], (err, row) => {
                if (err) return reject(new Error("Gagal mengakses database."));
                resolve(row);
            });
        });

        if (!meeting) {
            return res.status(404).json({ success: false, message: "Rapat tidak ditemukan." });
        }

        // LANGKAH 2: Update status di database
        await new Promise((resolve, reject) => {
            const sql = "UPDATE meetings SET status = ? WHERE id = ?";
            db.run(sql, ['selesai', id], function(err) {
                if (err) return reject(new Error("Gagal update status rapat."));
                resolve(this);
            });
        });

        // LANGKAH 3: Hapus file fisik terkait
        if (meeting.filesData) {
            const files = JSON.parse(meeting.filesData);
            if (Array.isArray(files)) {
                files.forEach(file => deleteFileIfExists(file.path)); // Menggunakan helper function Anda
            }
        }
        
        // Batalkan reminder jika ada
        const jobId = `meeting_${id}`;
        if (meetingJobs[jobId]) {
            meetingJobs[jobId].cancel();
            delete meetingJobs[jobId];
            console.log(`Reminder untuk meeting ${id} dibatalkan karena meeting selesai.`);
        }

        res.json({ success: true, message: "Rapat berhasil ditandai selesai dan file terkait telah dihapus." });

    } catch (error) {
        console.error("Error pada rute /finish-meeting:", error.message);
        res.status(500).json({ success: false, message: "Terjadi kesalahan server." });
    }
});

/**
 * POST update expired meetings (debug endpoint)
 */
router.post("/update-expired", (req, res) => {
    if (!db) {
        return res.status(500).json({ success: false, message: "Database tidak tersedia" });
    }

    updateExpiredMeetings();
    
    res.json({
        success: true,
        message: "Update expired meetings completed"
    });
});

/**
 * GET ketersediaan ruangan (endpoint legacy)
 */
router.get("/check-availability", (req, res) => {
    const { date, room } = req.query;

    if (!date || !room) {
        return res.status(400).json({
            success: false,
            message: "Parameter date dan room harus diisi",
        });
    }

    if (!db) {
        return res.status(500).json({ success: false, message: "Database tidak tersedia" });
    }

    updateExpiredMeetings();

    db.all(
        `SELECT * FROM meetings WHERE date = ? AND meetingRoom = ? AND status IN ('terjadwal', 'terkirim')`,
        [date, room],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ success: false, message: "Error mengecek availability" });
            }

            const roomMeetings = rows.map((m) => ({
                id: m.id,
                title: m.meetingTitle,
                startTime: m.startTime,
                endTime: m.endTime,
                status: m.status
            }));

            res.json({
                success: true,
                date,
                room,
                meetings: roomMeetings,
                isAvailable: roomMeetings.length === 0,
            });
        }
    );
});

// Export module
module.exports = {
    router,
    initializeMeetings,
    loadAndScheduleExistingMeetings,
    updateExpiredMeetings,
    formatNumber,
    validateMeetingInput,
    checkRoomConflict,
    dateTimeToEpoch,
    epochToDateTime,
    parseDateTime,
    ROOMS
};