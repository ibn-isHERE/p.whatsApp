const express = require('express');

function createChatsRouter(db, whatsappClient, io) {
    const router = express.Router();

    // Endpoint untuk mendapatkan daftar percakapan unik dengan info kontak
 router.get('/conversations', (req, res) => {
    const query = `
        SELECT 
            c.fromNumber,
            MAX(c.timestamp) as lastTimestamp,
            (SELECT message FROM chats WHERE fromNumber = c.fromNumber ORDER BY timestamp DESC LIMIT 1) as lastMessage,
            (SELECT direction FROM chats WHERE fromNumber = c.fromNumber ORDER BY timestamp DESC LIMIT 1) as direction,
            (SELECT messageType FROM chats WHERE fromNumber = c.fromNumber ORDER BY timestamp DESC LIMIT 1) as messageType,
            COUNT(CASE WHEN c.direction = 'in' AND c.isRead = 0 THEN 1 END) as unreadCount,
            contacts.name as contactName
        FROM chats c
        LEFT JOIN contacts ON (
            contacts.number = c.fromNumber 
            OR contacts.number = ('0' || SUBSTR(c.fromNumber, 3))
            OR contacts.number = ('62' || SUBSTR(c.fromNumber, 2))
        )
        GROUP BY c.fromNumber 
        ORDER BY lastTimestamp DESC
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error getting conversations:', err);
            // Jadikan respons error juga konsisten
            return res.status(500).json({ success: false, message: err.message });
        }
        
        console.log(`📋 Found ${rows.length} conversations`);
        
        // ✅ PERBAIKAN UTAMA ADA DI SINI
        // Membungkus 'rows' dalam objek agar sesuai dengan harapan frontend
        res.json({ success: true, data: rows });
    });
});


    // Endpoint untuk mendapatkan riwayat chat dengan nomor tertentu
    router.get('/conversation/:number', (req, res) => {
        const number = req.params.number;
        const limit = req.query.limit || 50;
        const offset = req.query.offset || 0;
        
        const query = `
            SELECT 
                c.*,
                contacts.name as contactName
            FROM chats c
            LEFT JOIN contacts ON contacts.number = c.fromNumber 
                OR contacts.number = ('+' || c.fromNumber)
                OR contacts.number = ('62' || SUBSTR(c.fromNumber, 2))
            WHERE c.fromNumber = ? 
            ORDER BY c.timestamp ASC
            LIMIT ? OFFSET ?
        `;
        
        db.all(query, [number, limit, offset], (err, rows) => {
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
                        // Notify via Socket.IO that messages were marked as read
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

    // Endpoint untuk mencari chat berdasarkan nomor atau nama
    router.get('/search/:query', (req, res) => {
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
        
        const searchParam = `%${searchQuery}%`;
        db.all(query, [searchParam, searchParam, searchParam], (err, rows) => {
            if (err) {
                console.error('Error searching conversations:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            
            const conversations = rows.map(row => ({
                fromNumber: row.fromNumber,
                contactName: row.contactName || row.fromNumber,
                lastMessage: row.lastMessage,
                lastTimestamp: row.lastTimestamp,
                direction: row.direction,
                unreadCount: row.unreadCount,
                hasUnread: row.unreadCount > 0
            }));
            
            res.json(conversations);
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

        // 1. Kirim pesan via WhatsApp terlebih dahulu
        const formattedNumber = to.includes('@c.us') ? to : `${to}@c.us`;
        await whatsappClient.sendMessage(formattedNumber, message);
        
        // 2. Simpan ke database menggunakan Promise agar bisa di-await
        const dbResult = await new Promise((resolve, reject) => {
            const timestamp = new Date().toISOString();
            const query = `
                INSERT INTO chats (fromNumber, message, direction, timestamp, messageType, isRead)
                VALUES (?, ?, 'out', ?, 'chat', TRUE)
            `;
            
            db.run(query, [to, message, timestamp], function(err) {
                if (err) {
                    console.error('Error menyimpan pesan keluar:', err);
                    // Jika error, reject Promise
                    return reject(new Error('Pesan terkirim tapi gagal disimpan ke database'));
                }
                // Jika sukses, resolve dengan data yang dibutuhkan
                resolve({
                    id: this.lastID,
                    timestamp: timestamp
                });
            });
        });
        
        // 3. Siapkan data dan kirim notifikasi real-time
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
        
        // 4. Kirim respons sukses ke pengirim
        res.json({ 
            success: true, 
            message: 'Pesan berhasil dikirim dan disimpan',
            data: messageData
        });
        
    } catch (error) {
        // Blok catch ini sekarang menangani SEMUA error (WA & Database)
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
        
        console.log('📊 Unread count:', result);
        res.json(result);
    });
});

    // Endpoint untuk menandai pesan sebagai sudah dibaca
  // Ganti endpoint '/mark-read' Anda dengan yang ini
router.put('/mark-read/:number', (req, res) => {
    // 1. Ambil nomor dari parameter URL (bukan dari body)
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
    
    // 2. Gunakan variabel 'number' yang baru
    db.run(query, [number], function(err) {
        if (err) {
            console.error('Error marking messages as read:', err);
            return res.status(500).json({ success: false, message: err.message });
        }
        
        // Emit update via Socket.IO
        io.emit('messagesMarkedAsRead', { fromNumber: number, updatedCount: this.changes });
        
        res.json({ 
            success: true, 
            message: 'Pesan berhasil ditandai sebagai sudah dibaca',
            updatedCount: this.changes
        });
    });
});

    // Endpoint untuk mendapatkan statistik chat
    router.get('/stats', (req, res) => {
        const statsQuery = `
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
                console.error('Error getting chat stats:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            
            const todayStats = rows.find(row => row.today !== 'total') || {};
            const totalStats = rows.find(row => row.today === 'total') || {};
            
            res.json({
                today: {
                    totalMessages: todayStats.totalMessages || 0,
                    incomingMessages: todayStats.incomingMessages || 0,
                    outgoingMessages: todayStats.outgoingMessages || 0,
                    unreadMessages: todayStats.unreadMessages || 0,
                    uniqueContacts: todayStats.uniqueContacts || 0
                },
                total: {
                    totalMessages: totalStats.totalMessages || 0,
                    incomingMessages: totalStats.incomingMessages || 0,
                    outgoingMessages: totalStats.outgoingMessages || 0,
                    unreadMessages: totalStats.unreadMessages || 0,
                    uniqueContacts: totalStats.uniqueContacts || 0
                }
            });
        });
    });

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
            
            // Emit update via Socket.IO
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
        
        // Ambil data pesan terlebih dahulu untuk emit
        db.get('SELECT fromNumber FROM chats WHERE id = ?', [messageId], (err, messageData) => {
            if (err) {
                console.error('Error getting message data:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            
            if (!messageData) {
                return res.status(404).json({ error: 'Pesan tidak ditemukan' });
            }
            
            // Hapus pesan
            db.run('DELETE FROM chats WHERE id = ?', [messageId], function(deleteErr) {
                if (deleteErr) {
                    console.error('Error deleting message:', deleteErr);
                    res.status(500).json({ error: deleteErr.message });
                    return;
                }
                
                // Emit update via Socket.IO
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
        
        db.get(contactQuery, [number, number, number], (err, contact) => {
            if (err) {
                console.error('Error getting contact info:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            
            if (!contact) {
                // Jika tidak ada di contacts, ambil info dari chats
                const chatQuery = `
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
                        console.error('Error getting chat info:', chatErr);
                        res.status(500).json({ error: chatErr.message });
                        return;
                    }
                    
                    res.json({
                        name: null,
                        number: number,
                        totalMessages: chatInfo ? chatInfo.totalMessages : 0,
                        lastMessageTime: chatInfo ? chatInfo.lastMessageTime : null,
                        firstMessageTime: chatInfo ? chatInfo.firstMessageTime : null,
                        isContact: false
                    });
                });
            } else {
                res.json({
                    name: contact.name,
                    number: contact.number,
                    totalMessages: contact.totalMessages || 0,
                    lastMessageTime: contact.lastMessageTime,
                    firstMessageTime: contact.firstMessageTime,
                    isContact: true
                });
            }
        });
    });

    // Endpoint untuk backup chat data
// GANTI BLOK LAMA INI: router.get('/backup/:number?', ...);

// MENJADI DUA BLOK BARU INI:

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

    return router;
}

module.exports = createChatsRouter;