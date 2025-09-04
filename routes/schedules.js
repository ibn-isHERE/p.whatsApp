const express = require("express");
const { MessageMedia } = require("whatsapp-web.js");
const schedule = require("node-schedule");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();
const db = require('../database.js'); // Pastikan path ini benar
let jobs = {}; // Untuk menyimpan job terjadwal
let client = null;

function setWhatsappClient(whatsappClient) {
    client = whatsappClient;
}

/**
 * Format nomor ke format WhatsApp: 62XXXXXXXXXX@c.us
 * @param {string} inputNumber - Nomor yang akan diformat
 * @returns {string|null} - Nomor terformat atau null jika tidak valid
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
 * Konfigurasi Multer untuk Upload File
 */
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname.replace(/\s/g, "_"));
    },
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            "image/jpeg",
            "image/png",
            "image/gif",
            "video/mp4",
            "video/webm",
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(
                new Error(
                    "Tipe file tidak didukung! Hanya gambar, video, PDF, dan dokumen yang diperbolehkan."
                )
            );
        }
    },
}).array("files", 10);

/**
 * Hapus file jika ada
 * @param {string} filePath - Path file yang akan dihapus
 */
function deleteFileIfExists(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr)
                console.error(`Gagal menghapus file ${filePath}:`, unlinkErr);
            else console.log(`Berhasil menghapus file: ${filePath}`);
        });
    }
}

/**
 * Fungsi untuk menjadwalkan pengiriman pesan
 * @param {Object} scheduleData - Data jadwal pesan
 */
async function scheduleMessage(scheduleData) {
    const { id, numbers, message, filesData, scheduledTime } = scheduleData;
    const reminderTime = new Date(scheduledTime);
    const now = new Date();

    const jobId = `message_${id}`;

    // Batalkan job lama jika ada
    if (jobs[jobId]) {
        jobs[jobId].cancel();
        console.log(`Job pesan lama dibatalkan dengan ID: ${jobId}`);
    }

    // Cek apakah jadwal sudah lewat lebih dari 1 menit
    if (
        reminderTime.getTime() < now.getTime() - 60 * 1000 &&
        scheduleData.status === "terjadwal"
    ) {
        console.warn(
            `Jadwal pesan ID ${id} lebih dari 1 menit lewat. Menandai sebagai 'gagal'.`
        );
        db.run(
            `UPDATE schedules SET status = ? WHERE id = ?`,
            ["gagal", id],
            (err) => {
                if (err)
                    console.error(
                        "Gagal memperbarui status untuk jadwal pesan yang telah lewat:",
                        err.message
                    );
            }
        );
        
        // Hapus file yang terkait
        if (filesData) {
            try {
                const files = JSON.parse(filesData);
                files.forEach((file) => deleteFileIfExists(file.path));
            } catch (parseErr) {
                console.error(
                    `Gagal mengurai filesData untuk penghapusan pada jadwal pesan ID ${id} yang telah lewat:`,
                    parseErr
                );
            }
        }
        return;
    }

    // Skip jika status bukan terjadwal
    if (scheduleData.status !== "terjadwal") {
        console.log(
            `Jadwal pesan ID ${id} memiliki status '${scheduleData.status}', tidak dijadwalkan ulang.`
        );
        return;
    }

    // Buat job baru
    jobs[jobId] = schedule.scheduleJob(reminderTime, async () => {
        await executeScheduledMessage(id, numbers, message, filesData);
    });
    
    console.log(
        `Jadwal pesan ID ${id} berhasil ditambahkan/dijadwalkan ulang untuk dikirim pada ${reminderTime.toLocaleString()}.`
    );
}

/**
 * Eksekusi pengiriman pesan terjadwal
 * @param {string} id - ID jadwal
 * @param {string} numbers - JSON string berisi array nomor
 * @param {string} message - Pesan teks
 * @param {string} filesData - JSON string berisi data file
 */
async function executeScheduledMessage(id, numbers, message, filesData) {
    // VALIDASI: Pastikan client tersedia
    if (!client) {
        console.error(`Client WhatsApp tidak tersedia untuk pesan ID ${id}`);
        
        // Update status ke gagal dan bersihkan file
        handleFailedMessage(id, filesData, "Client WhatsApp tidak tersedia");
        return;
    }

    let medias = [];
    let allFilesReady = true;

    // Persiapkan media files jika ada
    if (filesData) {
        try {
            const filesMetadata = JSON.parse(filesData);
            
            if (Array.isArray(filesMetadata)) {
                for (const file of filesMetadata) {
                    if (file.path && fs.existsSync(file.path)) {
                        try {
                            const fileBuffer = fs.readFileSync(file.path);
                            const media = new MessageMedia(
                                file.mimetype,
                                fileBuffer.toString("base64"),
                                file.name
                            );
                            medias.push(media);
                            console.log(`MessageMedia berhasil dibuat untuk file ${file.name} (ID ${id}).`);
                        } catch (mediaErr) {
                            console.error(`Gagal membuat MessageMedia untuk file ${file.name}:`, mediaErr);
                            allFilesReady = false;
                            break;
                        }
                    } else {
                        console.error(`File ${file.path} tidak ditemukan untuk pesan ID ${id}.`);
                        allFilesReady = false;
                        break;
                    }
                }
            }
        } catch (parseErr) {
            console.error(`Gagal mengurai filesData untuk pesan ID ${id}:`, parseErr);
            allFilesReady = false;
        }
    }

    // Jika ada masalah dengan file, update status ke gagal
    if (!allFilesReady) {
        handleFailedMessage(id, filesData, "Gagal memproses file");
        return;
    }

    // Kirim pesan ke semua nomor
    let allSent = true;
    let numbersFailed = [];
    let targetNumbers;

    try {
        targetNumbers = JSON.parse(numbers);
        if (!Array.isArray(targetNumbers) || targetNumbers.length === 0) {
            throw new Error("Format numbers tidak valid");
        }
    } catch (parseErr) {
        console.error(`Gagal mengurai numbers untuk pesan ID ${id}:`, parseErr);
        handleFailedMessage(id, filesData, "Format nomor tidak valid");
        return;
    }

    for (const num of targetNumbers) {
        const formattedNum = formatNumber(num);
        if (!formattedNum) {
            console.error(`Nomor tidak valid ${num} untuk pesan ID ${id}.`);
            allSent = false;
            numbersFailed.push(num);
            continue;
        }
        
        try {
            // Kirim pesan teks jika ada
            if (message && message.trim() !== '') {
                await client.sendMessage(formattedNum, message.trim());
                console.log(`Pesan teks ID ${id} berhasil dikirim ke ${num}.`);
            }

            // Kirim setiap file jika ada
            if (medias.length > 0) {
                for (const media of medias) {
                    await client.sendMessage(formattedNum, media);
                    console.log(`File ${media.filename} dikirim ke ${num}.`);
                }
            }

            // Tunggu sebentar antara pengiriman untuk menghindari rate limit
            await new Promise(resolve => setTimeout(resolve, 500));
            
        } catch (err) {
            console.error(`Gagal mengirim pesan/file ID ${id} ke ${num}:`, err.message);
            allSent = false;
            numbersFailed.push(num);
        }
    }

    // Bersihkan file setelah pengiriman (sukses atau gagal)
    cleanupFiles(filesData);

    // Update status di database
    const finalStatus = allSent ? "terkirim" : "gagal";
    updateMessageStatus(id, finalStatus, numbersFailed);

    // Hapus job dari memori
    const jobId = `message_${id}`;
    if (jobs[jobId]) {
        delete jobs[jobId];
        console.log(`Job pesan ID ${jobId} dihapus dari memori.`);
    }
}

// FUNGSI HELPER UNTUK MEMISAHKAN LOGIKA

function handleFailedMessage(id, filesData, reason) {
    console.error(`Pesan ID ${id} gagal: ${reason}`);
    
    // Update status di database
    db.run(
        `UPDATE schedules SET status = ? WHERE id = ?`,
        ["gagal", id],
        (err) => {
            if (err) {
                console.error("Gagal memperbarui status:", err.message);
            }
        }
    );
    
    // Bersihkan file
    cleanupFiles(filesData);
}

function cleanupFiles(filesData) {
    if (filesData) {
        try {
            const files = JSON.parse(filesData);
            if (Array.isArray(files)) {
                files.forEach((file) => {
                    if (file.path) {
                        deleteFileIfExists(file.path);
                    }
                });
            }
        } catch (parseErr) {
            console.error("Gagal mengurai filesData untuk penghapusan:", parseErr);
        }
    }
}

function updateMessageStatus(id, status, failedNumbers = []) {
    let additionalInfo = '';
    if (failedNumbers.length > 0) {
        additionalInfo = `, gagal ke: ${failedNumbers.join(', ')}`;
    }
    
    db.run(
        `UPDATE schedules SET status = ? WHERE id = ?`,
        [status, id],
        (err) => {
            if (err) {
                console.error("Gagal memperbarui status:", err.message);
            } else {
                console.log(`Status pesan ID ${id} diperbarui menjadi ${status}${additionalInfo}`);
            }
        }
    );
}

/**
 * Memuat dan menjadwalkan ulang pesan yang belum terkirim saat server restart
 */
function loadAndScheduleExistingMessages() {
    if (!db) {
        console.error("Database belum diinisialisasi untuk memuat jadwal pesan");
        return;
    }

    db.all(`SELECT * FROM schedules WHERE status = 'terjadwal'`, (err, rows) => {
        if (err) {
            console.error("Gagal mengambil jadwal pesan dari DB:", err.message);
            return;
        }
        rows.forEach((scheduleData) => {
            console.log(
                `Menjadwalkan ulang pesan ID ${scheduleData.id} (status: ${scheduleData.status})`
            );
            scheduleMessage(scheduleData);
        });
    });
}

/**
 * Validasi nomor telepon
 * @param {Array} numbers - Array nomor telepon
 * @returns {Array} - Array nomor yang tidak valid
 */
function validateNumbers(numbers) {
    return numbers.filter(
        (n) => !/^(0|62)\d{8,13}$/.test(String(n).trim())
    );
}

/**
 * Validasi waktu jadwal
 * @param {string} datetime - String datetime
 * @returns {Object} - {isValid: boolean, adjustedTime: string, error: string}
 */
function validateScheduleTime(datetime) {
    let reminderTime = new Date(datetime);
    const now = new Date();

    if (isNaN(reminderTime.getTime())) {
        return {
            isValid: false,
            error: "Format tanggal/waktu tidak valid."
        };
    }

    const timeDifferenceMs = reminderTime.getTime() - now.getTime();
    const oneMinuteInMs = 60 * 1000;

    if (timeDifferenceMs < -oneMinuteInMs) {
        return {
            isValid: false,
            error: "Waktu lebih dari 1 menit di masa lalu. Harap pilih waktu yang lebih dekat dengan sekarang atau di masa depan."
        };
    }

    // Adjust time if it's in the past but within 1 minute
    if (reminderTime.getTime() <= now.getTime()) {
        console.log(
            "Waktu pengiriman pesan sekarang atau sedikit di masa lalu, akan segera dikirim."
        );
        reminderTime.setSeconds(now.getSeconds() + 1);
        datetime = reminderTime.toISOString();
    }

    return {
        isValid: true,
        adjustedTime: datetime
    };
}

// ===== ROUTES =====

/**
 * Endpoint untuk menambah pesan terjadwal
 */
router.post("/add-reminder", (req, res) => {
    upload(req, res, async (err) => {
        // Handle upload errors
        if (err) {
            cleanupUploadedFiles(req.files);
            
            if (err instanceof multer.MulterError) {
                if (err.code === "LIMIT_FILE_SIZE") {
                    return res.status(400).json({ 
                        error: "Ukuran file terlalu besar. Maksimal 20 MB per file." 
                    });
                }
                return res.status(400).json({ 
                    error: `Kesalahan unggah file: ${err.message}` 
                });
            } else {
                return res.status(400).json({ 
                    error: `Tipe file tidak didukung: ${err.message}` 
                });
            }
        }

        let { numbers, message, datetime } = req.body;
        const uploadedFiles = req.files;

        try {
            // Validasi data input
            const validationError = validateReminderInput(numbers, message, datetime, uploadedFiles);
            if (validationError) {
                cleanupUploadedFiles(uploadedFiles);
                return res.status(400).json({ error: validationError });
            }

            // Parse dan validasi nomor
            const parsedNumbers = parseAndValidateNumbers(numbers);
            if (parsedNumbers.error) {
                cleanupUploadedFiles(uploadedFiles);
                return res.status(400).json({ error: parsedNumbers.error });
            }

            // Validasi waktu jadwal
            const timeValidation = validateScheduleTime(datetime);
            if (!timeValidation.isValid) {
                cleanupUploadedFiles(uploadedFiles);
                return res.status(400).json({ error: timeValidation.error });
            }
            datetime = timeValidation.adjustedTime;

            // Persiapkan data file
            const filesData = prepareFilesData(uploadedFiles);

            const scheduleId = Date.now().toString();

            // Simpan ke database
            db.run(
                `INSERT INTO schedules (id, numbers, message, filesData, scheduledTime, status) VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    scheduleId,
                    JSON.stringify(parsedNumbers.validNumbers),
                    message ? message.trim() : null,
                    filesData,
                    datetime,
                    "terjadwal",
                ],
                function (insertErr) {
                    if (insertErr) {
                        console.error("Gagal menyimpan jadwal pesan:", insertErr.message);
                        cleanupUploadedFiles(uploadedFiles);
                        return res.status(500).json({ error: "Gagal menyimpan jadwal pesan ke database." });
                    }

                    console.log(`Jadwal pesan baru disimpan dengan ID: ${scheduleId}`);
                    
                    // Dapatkan client dari app locals
                    const client = req.app.locals.whatsappClient;
                    
                    // Jadwalkan pesan
                    scheduleMessage({
                        id: scheduleId,
                        numbers: JSON.stringify(parsedNumbers.validNumbers),
                        message: message ? message.trim() : null,
                        filesData,
                        scheduledTime: datetime,
                        status: "terjadwal",
                    }, client);
                    
                    res.status(200).json({ 
                        success: true, 
                        message: "Pesan/File berhasil ditambahkan dan dijadwalkan.",
                        scheduleId: scheduleId
                    });
                }
            );

        } catch (error) {
            console.error("Error dalam /add-reminder:", error);
            cleanupUploadedFiles(uploadedFiles);
            return res.status(500).json({ error: "Terjadi kesalahan internal server." });
        }
    });
});

// ===== FUNGSI HELPER =====

function validateReminderInput(numbers, message, datetime, uploadedFiles) {
    if (!numbers) return "Nomor kontak harus diisi.";
    if (!datetime) return "Waktu jadwal tidak boleh kosong.";
    
    if (!message && (!uploadedFiles || uploadedFiles.length === 0)) {
        return "Pesan atau setidaknya satu file harus disediakan.";
    }
    
    return null;
}

function parseAndValidateNumbers(numbers) {
    try {
        const parsedNumbers = JSON.parse(numbers);
        
        if (!Array.isArray(parsedNumbers) || parsedNumbers.length === 0) {
            return { error: "Nomor kontak harus dalam format array JSON dan tidak boleh kosong." };
        }

        const invalidNumbers = validateNumbers(parsedNumbers);
        if (invalidNumbers.length > 0) {
            return { 
                error: `Nomor tidak valid: ${invalidNumbers.join(", ")}. Pastikan format 08xxxxxxxxxx atau 628xxxxxxxxxx.`
            };
        }

        return { validNumbers: parsedNumbers };

    } catch (e) {
        console.error("Kesalahan parsing nomor:", e.message);
        return { error: "Format nomor tidak valid. Harus berupa array JSON." };
    }
}

function prepareFilesData(uploadedFiles) {
    if (!uploadedFiles || uploadedFiles.length === 0) {
        return null;
    }

    return JSON.stringify(
        uploadedFiles.map((file) => ({
            path: file.path,
            name: file.originalname,
            mimetype: file.mimetype,
            size: file.size
        }))
    );
}

function cleanupUploadedFiles(files) {
    if (files && Array.isArray(files)) {
        files.forEach((file) => {
            if (file.path) {
                deleteFileIfExists(file.path);
            }
        });
    }
}

/**
 * Endpoint untuk mendapatkan jadwal pesan
 */
router.get("/get-schedules", (req, res) => {
    const { status } = req.query;
    let query = `SELECT * FROM schedules`;
    let params = [];

    if (status && status !== 'all') {
        query += ` WHERE status = ?`;
        params.push(status);
    }

    query += ` ORDER BY scheduledTime DESC`;

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error("Gagal mengambil jadwal pesan dari database:", err.message);
            return res.status(500).json({ error: "Gagal mengambil jadwal pesan dari database." });
        }

        try {
            const schedulesWithParsedFiles = rows.map((row) => {
                let numbersArray = [];
                if (row.numbers) {
                    try {
                        numbersArray = JSON.parse(row.numbers);
                        if (!Array.isArray(numbersArray)) {
                            numbersArray = [numbersArray];
                        }
                    } catch (parseErr) {
                        console.error("Kesalahan parsing nomor:", parseErr.message);
                        numbersArray = [];
                    }
                }

                let filesMetadata = [];
                if (row.filesData) {
                    try {
                        filesMetadata = JSON.parse(row.filesData);
                        if (!Array.isArray(filesMetadata)) {
                            filesMetadata = [filesMetadata];
                        }
                    } catch (parseErr) {
                        console.error("Kesalahan parsing filesData:", parseErr.message);
                        filesMetadata = [];
                    }
                }

                return {
                    id: row.id,
                    numbers: numbersArray,
                    message: row.message,
                    filesData: filesMetadata,
                    scheduledTime: row.scheduledTime,
                    status: row.status,
                    type: 'message'
                };
            });

            res.json(schedulesWithParsedFiles);
        } catch (error) {
            console.error("Error processing schedule data:", error);
            res.status(500).json({ error: "Error processing schedule data" });
        }
    });
});

/**
 * Endpoint untuk membatalkan jadwal pesan
 */
router.delete("/cancel-schedule/:id", (req, res) => {
    const { id } = req.params;

    db.get(
        `SELECT filesData FROM schedules WHERE id = ? AND status = 'terjadwal'`,
        [id],
        (err, row) => {
            if (err) {
                console.error(
                    "Kesalahan mengambil jadwal pesan untuk dibatalkan:",
                    err.message
                );
                return res.status(500).send("Gagal menemukan jadwal pesan.");
            }
            if (!row) {
                return res
                    .status(404)
                    .send(
                        "Jadwal pesan tidak ditemukan atau tidak dalam status 'terjadwal' untuk dibatalkan."
                    );
            }

            // Batalkan job
            const jobId = `message_${id}`;
            if (jobs[jobId]) {
                jobs[jobId].cancel();
                delete jobs[jobId];
                console.log(`Job pesan ID ${jobId} dibatalkan.`);
            }

            // Hapus file terkait
            if (row.filesData) {
                try {
                    const files = JSON.parse(row.filesData);
                    files.forEach((file) => deleteFileIfExists(file.path));
                } catch (parseErr) {
                    console.error(
                        `Gagal parsing filesData untuk penghapusan saat pembatalan untuk pesan ID ${id}:`,
                        parseErr
                    );
                }
            }

            // Update status di database
            db.run(
                `UPDATE schedules SET status = ? WHERE id = ?`,
                ["dibatalkan", id],
                function (updateErr) {
                    if (updateErr) {
                        console.error(
                            "Kesalahan memperbarui status jadwal pesan di database:",
                            updateErr.message
                        );
                        return res
                            .status(500)
                            .send("Gagal memperbarui status jadwal pesan di database.");
                    }
                    res.status(200).send("Jadwal pesan berhasil dibatalkan.");
                }
            );
        }
    );
});

/**
 * Endpoint untuk hapus riwayat pesan
 */
router.delete("/delete-history/:id", (req, res) => {
    const { id } = req.params;

    db.get(
        `SELECT filesData FROM schedules WHERE id = ? AND (status = 'terkirim' OR status = 'gagal')`,
        [id],
        (err, row) => {
            if (err) {
                console.error(
                    "Kesalahan mengambil riwayat pesan untuk dihapus:",
                    err.message
                );
                return res.status(500).send("Gagal menemukan riwayat pesan.");
            }
            if (!row) {
                return res
                    .status(404)
                    .send(
                        "Riwayat pesan tidak ditemukan atau tidak dalam status 'terkirim'/'gagal'."
                    );
            }

            // Hapus file terkait
            if (row.filesData) {
                try {
                    const files = JSON.parse(row.filesData);
                    files.forEach((file) => deleteFileIfExists(file.path));
                } catch (parseErr) {
                    console.error(
                        `Gagal parsing filesData untuk penghapusan riwayat pesan ID ${id}:`,
                        parseErr
                    );
                }
            }

            // Hapus dari database
            db.run(`DELETE FROM schedules WHERE id = ?`, [id], function (deleteErr) {
                if (deleteErr) {
                    console.error(
                        "Kesalahan menghapus riwayat pesan dari database:",
                        deleteErr.message
                    );
                    return res
                        .status(500)
                        .send("Gagal menghapus riwayat pesan dari database.");
                }
                console.log(`Riwayat pesan ID ${id} berhasil dihapus.`);
                res.status(200).send("Riwayat pesan berhasil dihapus.");
            });
        }
    );
});

/**
 * Endpoint untuk edit jadwal pesan
 */
router.put("/edit-schedule/:id", (req, res) => {
    upload(req, res, async (err) => {
        const { id } = req.params;
        const newFiles = req.files;
        let newFilesDataTemp = null;

        if (newFiles && newFiles.length > 0) {
            newFilesDataTemp = JSON.stringify(
                newFiles.map((file) => ({
                    path: file.path,
                    name: file.originalname,
                    mimetype: file.mimetype,
                }))
            );
        }

        if (err instanceof multer.MulterError) {
            if (newFiles && Array.isArray(newFiles)) {
                newFiles.forEach((file) => deleteFileIfExists(file.path));
            }
            if (err.code === "LIMIT_FILE_SIZE") {
                return res
                    .status(400)
                    .send("Ukuran file terlalu besar. Maksimal 20 MB per file.");
            }
            return res.status(400).send(`Kesalahan unggah file: ${err.message}`);
        } else if (err) {
            if (newFiles && Array.isArray(newFiles)) {
                newFiles.forEach((file) => deleteFileIfExists(file.path));
            }
            return res.status(400).send(`Tipe file tidak didukung: ${err.message}`);
        }

        let { numbers, message, datetime, keepOriginalFile } = req.body;
        const shouldKeepOriginalFile = keepOriginalFile === "true";

        // Validasi nomor
        let parsedNumbers;
        try {
            parsedNumbers = JSON.parse(numbers);
            if (!Array.isArray(parsedNumbers) || parsedNumbers.length === 0) {
                throw new Error(
                    "Nomor kontak harus dalam format array JSON dan tidak boleh kosong."
                );
            }
        } catch (e) {
            console.error("Kesalahan parsing nomor di /edit-schedule:", e.message);
            if (newFiles && Array.isArray(newFiles)) {
                newFiles.forEach((file) => deleteFileIfExists(file.path));
            }
            return res.status(400).send("Format nomor tidak valid atau bukan array.");
        }

        if (!datetime) {
            if (newFiles && Array.isArray(newFiles)) {
                newFiles.forEach((file) => deleteFileIfExists(file.path));
            }
            return res
                .status(400)
                .send("Data tidak lengkap: Waktu jadwal tidak boleh kosong.");
        }

        // Ambil data lama dari database
        db.get(
            `SELECT * FROM schedules WHERE id = ?`,
            [id],
            (err, oldSchedule) => {
                if (err || !oldSchedule) {
                    if (newFiles && Array.isArray(newFiles)) {
                        newFiles.forEach((file) => deleteFileIfExists(file.path));
                    }
                    return res
                        .status(404)
                        .send("Jadwal pesan tidak ditemukan atau gagal mengambil data lama.");
                }

                const oldFilesDataParsed = oldSchedule.filesData
                    ? JSON.parse(oldSchedule.filesData)
                    : [];

                // Validasi data lengkap
                if (
                    !message &&
                    (!newFiles || newFiles.length === 0) &&
                    !shouldKeepOriginalFile &&
                    oldFilesDataParsed.length === 0
                ) {
                    if (newFiles && Array.isArray(newFiles)) {
                        newFiles.forEach((file) => deleteFileIfExists(file.path));
                    }
                    return res
                        .status(400)
                        .send(
                            "Data tidak lengkap: Pesan atau setidaknya satu file harus disediakan."
                        );
                }

                // Validasi format nomor
                const invalidNumbers = validateNumbers(parsedNumbers);
                if (invalidNumbers.length > 0) {
                    if (newFiles && Array.isArray(newFiles)) {
                        newFiles.forEach((file) => deleteFileIfExists(file.path));
                    }
                    return res
                        .status(400)
                        .send(
                            `Nomor tidak valid: ${invalidNumbers.join(
                                ", "
                            )}. Pastikan format 08xxxxxxxxxx atau 628xxxxxxxxxx.`
                        );
                }

                // Validasi waktu jadwal
                const timeValidation = validateScheduleTime(datetime);
                if (!timeValidation.isValid) {
                    if (newFiles && Array.isArray(newFiles)) {
                        newFiles.forEach((file) => deleteFileIfExists(file.path));
                    }
                    return res.status(400).send(timeValidation.error);
                }
                datetime = timeValidation.adjustedTime;

                // Tentukan file data final
                let finalFilesData = null;

                if (newFiles && newFiles.length > 0) {
                    // Gunakan file baru, hapus file lama
                    finalFilesData = newFilesDataTemp;
                    oldFilesDataParsed.forEach((file) => deleteFileIfExists(file.path));
                } else if (shouldKeepOriginalFile && oldFilesDataParsed.length > 0) {
                    // Pertahankan file lama
                    finalFilesData = JSON.stringify(oldFilesDataParsed);
                } else {
                    // Hapus semua file lama
                    oldFilesDataParsed.forEach((file) => deleteFileIfExists(file.path));
                }

                // Batalkan job lama
                const jobId = `message_${id}`;
                if (jobs[jobId]) {
                    jobs[jobId].cancel();
                    delete jobs[jobId];
                    console.log(`Job pesan lama ID ${jobId} dibatalkan untuk pengeditan.`);
                }

                // Update database
                db.run(
                    `UPDATE schedules SET
                        numbers = ?,
                        message = ?,
                        filesData = ?,
                        scheduledTime = ?,
                        status = ?
                    WHERE id = ?`,
                    [
                        JSON.stringify(parsedNumbers),
                        message,
                        finalFilesData,
                        datetime,
                        "terjadwal",
                        id,
                    ],
                    function (updateErr) {
                        if (updateErr) {
                            console.error(
                                "Gagal memperbarui jadwal pesan di database:",
                                updateErr.message
                            );
                            if (newFiles && Array.isArray(newFiles)) {
                                newFiles.forEach((file) => deleteFileIfExists(file.path));
                            }
                            return res.status(500).send("Gagal memperbarui jadwal pesan.");
                        }

                        console.log(`Jadwal pesan ID ${id} berhasil diperbarui.`);
                        scheduleMessage({
                            id,
                            numbers: JSON.stringify(parsedNumbers),
                            message,
                            filesData: finalFilesData,
                            scheduledTime: datetime,
                            status: "terjadwal",
                        });
                        res
                            .status(200)
                            .send("Jadwal pesan berhasil diperbarui dan dijadwalkan ulang.");
                    }
                );
            }
        );
    });
});

// Export module
module.exports = {
    router,
    setWhatsappClient, // Tambahkan ini
    loadAndScheduleExistingMessages,
    scheduleMessage,
    formatNumber,
    validateNumbers,
    validateScheduleTime,
    deleteFileIfExists
};