const mineflayer = require('mineflayer');
const express = require('express');
const { Webhook } = require('discord-webhook-node');

// ==========================================
// CẤU HÌNH BIẾN ĐẦU FILE
// ==========================================
const CONFIG = {
    // Cấu hình kết nối Minecraft
    SERVER_IP: '2y2c.org',
    SERVER_PORT: 25565,
    BOT_NAME: 'nahiwinhaha',
    AUTH_COMMAND: '/dangnhap 03012001',
    NAVIGATE_COMMAND: '/2y2c',

    // Cấu hình Discord Webhook (Để trống nếu không dùng)
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1376391242576957562/2cmM6ySlCSlbSvYMIn_jVQ6zZLGH6OLx5LLhuzDNh4mxFdHNQSqgRnKcaNvilZ-m8HSe',

    // Cấu hình Spam Chat
    SPAM_ENABLED: false,
    SPAM_INTERVAL: 60000, // Thời gian giãn cách (milisecond) - Nên để > 30000ms
    SPAM_MESSAGES: [
        'Hello mọi người! Chúc một ngày tốt lành.',
        'Bot đang hoạt động ổn định chống AFK.',
        'Chào mừng đến với server!'
    ],

    // Cấu hình Web Uptime
    WEB_PORT: 3000
};

// ==========================================
// KHỞI TẠO BIẾN TRẠNG THÁI
// ==========================================
let bot;
let isFullyConnected = false;
let loginInterval = null;
let spamIntervalId = null;
let afkIntervalId = null;
let startTime = null;

const hook = CONFIG.DISCORD_WEBHOOK_URL ? new Webhook(CONFIG.DISCORD_WEBHOOK_URL) : null;

// ==========================================
// DỊCH VỤ WEB UPTIME (EXPRESS)
// ==========================================
const app = express();
app.get('/', (req, res) => {
    const onlineTime = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    res.json({
        status: isFullyConnected ? 'Đang trong server' : 'Đang thiết lập kết nối',
        bot_name: CONFIG.BOT_NAME,
        uptime_seconds: onlineTime
    });
});
app.listen(CONFIG.WEB_PORT, () => {
    console.log(`[UPTIME] Web server chạy tại port ${CONFIG.WEB_PORT}`);
});

// ==========================================
// HÀM GỬI THÔNG BÁO DISCORD
// ==========================================
function sendDiscordLog(message) {
    if (hook) {
        hook.send(message).catch(err => console.error('[DISCORD ERROR]', err.message));
    }
}

function getOnlineTimeStr() {
    if (!startTime) return '0s';
    const totalSecs = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${hours}h ${minutes}m ${secs}s`;
}

// ==========================================
// KHỞI TẠO VÀ XỬ LÝ LOGIC BOT MINECRAFT
// ==========================================
function createBot() {
    console.log(`[HỆ THỐNG] Đang kết nối đến ${CONFIG.SERVER_IP}...`);
    isFullyConnected = false;
    
    bot = mineflayer.createBot({
        host: CONFIG.SERVER_IP,
        port: CONFIG.SERVER_PORT,
        username: CONFIG.BOT_NAME,
        version: false // Tự động nhận diện phiên bản của server
    });

    // Sự kiện khi vào hàng chờ / Hub ban đầu
    bot.once('spawn', () => {
        console.log('[KẾT NỐI] Đã vào server ban đầu. Bắt đầu chu kỳ đăng nhập...');
        sendDiscordLog(`🔄 **${CONFIG.BOT_NAME}** đã kết nối vào Hub/Hàng chờ.`);
        
        // Chạy cơ chế đăng nhập liên tục cho đến khi thành công chuyển server
        startLoginLoop();
    });

    // Xử lý khi nhận được tin nhắn chat công khai
    bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        // Gửi log chat người chơi lên Discord
        sendDiscordLog(`💬 **[CHAT] ${username}:** ${message}`);
    });

    // Xử lý khi có menu GUI mở ra (Click slot điều hướng)
    bot.on('windowOpen', async (window) => {
        console.log(`[MENU] Phát hiện menu mở: ${window.title || window.type}`);
        
        // Duyệt click các slot từ 0 đến hết các item trong menu để kích hoạt dịch chuyển
        for (let slot = 0; slot < window.slots.length; slot++) {
            const item = window.slots[slot];
            if (item) {
                try {
                    await bot.clickWindow(slot, 0, 0);
                    // Đợi một khoảng ngắn giữa các lần click tránh bị kick do click quá nhanh
                    await new Promise(resolve => setTimeout(resolve, 500)); 
                } catch (err) {
                    // Bỏ qua lỗi nếu cửa sổ bị đóng bất ngờ khi đang click
                    break;
                }
            }
        }
    });

    // Xử lý khi dịch chuyển sang server chính thức thành công
    // Nhận biết qua việc thay đổi thế giới hoặc tọa độ ổn định ngoài hàng chờ
    bot.on('forcedMove', () => {
        // Nếu định vị được bot đã thoát khỏi cơ chế login cũ và ở server chính
        if (!isFullyConnected) {
            // Kiểm tra điều kiện phụ (nếu cần thiết) hoặc kích hoạt ngay sau khi qua cổng/menu thành công
            stopLoginLoop();
            activateMainFeatures();
        }
    });

    // Xử lý khi mất kết nối
    bot.on('end', (reason) => {
        console.log(`[MẤT KẾT NỐI] Bot ngắt kết nối: ${reason}`);
        cleanupIntervals();
        sendDiscordLog(`❌ **${CONFIG.BOT_NAME}** đã mất kết nối. Lý do: \`${reason}\`. Thời gian online: ${getOnlineTimeStr()}. Đang kết nối lại sau 10 giây...`);
        setTimeout(createBot, 10000);
    });

    // Xử lý lỗi hệ thống của bot
    bot.on('error', (err) => {
        console.error('[LỖI BOT]', err);
    });
}

// ==========================================
// CÁC HÀM BỔ TRỢ LOGIC TRONG SERVER
// ==========================================

function startLoginLoop() {
    if (loginInterval) clearInterval(loginInterval);
    
    const execution = () => {
        if (isFullyConnected) return;
        console.log('[LOGIN] Đang thực hiện chuỗi lệnh đăng nhập và chuyển server...');
        bot.chat(CONFIG.AUTH_COMMAND);
        
        setTimeout(() => {
            if (!isFullyConnected) bot.chat(CONFIG.NAVIGATE_COMMAND);
        }, 3000);
    };

    execution(); // Chạy ngay lập tức lần đầu
    loginInterval = setInterval(execution, 15000); // Lặp lại mỗi 15 giây nếu chưa vào được
}

function stopLoginLoop() {
    if (loginInterval) {
        clearInterval(loginInterval);
        loginInterval = null;
    }
}

function activateMainFeatures() {
    isFullyConnected = true;
    startTime = Date.now();
    console.log('[THÀNH CÔNG] Đã vào server chính thức. Kích hoạt tính năng phụ trợ.');
    sendDiscordLog(`✅ **${CONFIG.BOT_NAME}** đã vào server chính thức thành công! Bắt đầu chống AFK.`);

    // 1. Cơ chế chống AFK: Nhảy và vung tay liên tục
    if (afkIntervalId) clearInterval(afkIntervalId);
    afkIntervalId = setInterval(() => {
        if (!isFullyConnected) return;
        bot.setControlState('jump', true);
        bot.swingArm('right');
        setTimeout(() => {
            if (bot) bot.setControlState('jump', false);
        }, 500);
        
        // Cập nhật trạng thái định kỳ lên Discord mỗi 5 phút
        if (Math.floor((Date.now() - startTime) / 1000) % 300 === 0) {
            sendDiscordLog(`📊 **Trạng thái:** Hoạt động ổn định | **Thời gian online:** ${getOnlineTimeStr()}`);
        }
    }, 4000);

    // 2. Cơ chế Spam Chat tự chỉnh
    if (CONFIG.SPAM_ENABLED) {
        if (spamIntervalId) clearInterval(spamIntervalId);
        let msgIndex = 0;
        spamIntervalId = setInterval(() => {
            if (!isFullyConnected) return;
            const msg = CONFIG.SPAM_MESSAGES[msgIndex];
            bot.chat(msg);
            msgIndex = (msgIndex + 1) % CONFIG.SPAM_MESSAGES.length;
        }, CONFIG.SPAM_INTERVAL);
    }
}

function cleanupIntervals() {
    stopLoginLoop();
    if (spamIntervalId) clearInterval(spamIntervalId);
    if (afkIntervalId) clearInterval(afkIntervalId);
    isFullyConnected = false;
    spamIntervalId = null;
    afkIntervalId = null;
}

// Khởi chạy bot lần đầu tiên
createBot();

