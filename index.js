require('dotenv').config();
const { MessageFlags, ChannelType,
    Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, UserSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, AuditLogEvent
 } = require('discord.js');
const { GiveawaysManager } = require('discord-giveaways');
const ms = require('ms');
const fs = require('fs');
const TRIVIA_LIST = JSON.parse(fs.readFileSync('./trivia.json', 'utf8'));
const axios = require('axios');

const { execFile, spawn } = require('child_process');
const path = require('path');


const cron = require('node-cron');
const WW = require('./werewolf_engine.js');

const voiceJoinTimes = new Map();

// --- BỘ NHỚ TẠM THỜI CHO ANTI-NUKE, ANTI-RAID & ANTI-SPAM ---
const nukeTracker = new Map(); // Lưu: { guildId: { userId: [{ action, timestamp }] } }
const raidTracker = new Map(); // Lưu: { guildId: [ timestamp, timestamp ] }
const spamTracker = new Map(); // Lưu: { userId: [{ content, timestamp }] }

const BANNED_USERS = ['1141650026049830963'];

// Chỉ định đường dẫn FFmpeg cho prism-media (dùng cho @discordjs/voice)

// Đường dẫn tới yt-dlp (cross-platform)
const YTDLP_PATH = path.join(__dirname, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

// Lấy thông tin video bằng yt-dlp (JSON)
// Danh sách player_client thử theo thứ tự khi không có cookies
// android_vr & mediaconnect hoạt động tốt nhất trên server/VPS năm 2025
const YT_PLAYER_CLIENTS = ['android_vr', 'tv_embedded', 'ios', 'android', 'mweb', 'web_creator', 'default'];

// User-agent giả lập Android mobile để tránh bot-check
const YTDLP_USER_AGENT = 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36';

function getCookiesPath() {
    // Ưu tiên: biến môi trường COOKIES_PATH → file cookies.txt bên cạnh bot
    return process.env.COOKIES_PATH || path.join(__dirname, 'cookies.txt');
}



// Thử chạy yt-dlp với nhiều player_client nếu gặp lỗi bot-check


// Resolve SoundCloud short URL (on.soundcloud.com) → full URL




// Stream audio từ YouTube bằng yt-dlp pipe vào ffmpeg


const configPath = './config.json';

// ========================
// CONFIG HELPERS
// ========================
function loadConfig() {
    if (fs.existsSync(configPath)) {
        try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); }
        catch (e) {}
    }
    return {};
}

function saveConfig(data) {
    fs.writeFileSync(configPath, JSON.stringify(data, null, 4));
}

function getGuildConfig(guildId) {
    const config = loadConfig();
    if (!config.guilds) config.guilds = {};
    if (guildId && config.guilds[guildId]) {
        return config.guilds[guildId];
    }
    return {};
}

async function sendAdvLog(guild, type, embed) {
    if (!guild) return;
    const config = getGuildConfig(guild.id);
    if (!config.advLogs) return;

    // Advanced category mapping for cleaner logs
    const categoryMap = {
        'message': 'message-log',
        'voice': 'member-log',
        'member': 'member-log',
        'channel': 'server-log',
        'role': 'server-log',
        'server': 'server-log',
        'emoji': 'server-log',
        'mod': 'mod-log',
        'ticket': 'server-log',
        'command': 'bot-log',
        'bot': 'bot-log',
        'error': 'bot-log'
    };

    const targetChannelKey = categoryMap[type] || (type + '-log');
    
    // Fallback to legacy channel names if they haven't re-run setupadvlogs
    let channelId = config.advLogs[targetChannelKey] || config.advLogs[type + '-log'];
    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);
    if (channel) {
        try {
            const enhancedEmbed = EmbedBuilder.from(embed);
            
            // Overhaul Aesthetics
            enhancedEmbed.setFooter({ 
                text: `Nexora Advanced Logs • ${type.toUpperCase()}`, 
                iconURL: guild.iconURL() 
            });
            if (!enhancedEmbed.data.timestamp) enhancedEmbed.setTimestamp();
            
            // Send the beautiful embed
            await channel.send({ embeds: [enhancedEmbed] });
        } catch (error) {
            console.error(`Error sending adv log ${type}:`, error);
        }
    }
}


function updateGuildConfig(guildId, key, value) {
    const config = loadConfig();
    if (!config.guilds) config.guilds = {};
    if (!config.guilds[guildId]) config.guilds[guildId] = {};
    config.guilds[guildId][key] = value;
    saveConfig(config);
}

function getPrefix(guildId) {
    const config = loadConfig();
    if (guildId && config.guilds && config.guilds[guildId] && config.guilds[guildId].prefix) {
        return config.guilds[guildId].prefix;
    }
    return config.prefix || process.env.PREFIX || '!';
}

function savePrefix(guildId, newPrefix) {
    if (guildId) {
        updateGuildConfig(guildId, 'prefix', newPrefix);
    } else {
        const config = loadConfig();
        config.prefix = newPrefix;
        saveConfig(config);
    }
}

// ========================
// HELP PAGES SYSTEM
// ========================
function buildHelpPages(prefix) {
    const color = '#2b2d31'; // Modern dark theme color for embeds
    
    return [
        // Page 0 - Tổng quan
        new EmbedBuilder()
            .setTitle('🌟 TỔNG QUAN HỆ THỐNG NEXORA')
            .setDescription(`Chào mừng bạn đến với **Lavie Bot** ✨\nMột trợ lý đa năng, hiện đại và tối ưu hóa cho cộng đồng của bạn.\n\n\`\`\`🚀 Prefix hiện tại: ${prefix} (Hoặc dùng lệnh Slash /)\`\`\`\n\n📌 **Hướng dẫn:** Vui lòng chọn các danh mục bên dưới qua menu thả xuống để khám phá các tính năng của bot.`)
            .addFields(
                { name: '🎮 Giải Trí & Kinh Tế', value: '> Cày coin, Ngân hàng, Minigame', inline: true },
                { name: '💕 Xã Hội & Tương Tác', value: '> Kết hôn, Lễ đường, Voice J2C', inline: true },
                { name: '🐺 Game Ma Sói', value: '> Trải nghiệm Boardgame cực cuốn', inline: true },
                { name: '🛡️ Quản Trị Hệ Thống', value: '> Cài đặt, Tù đày, Quản lý server', inline: true }
            )
            .setImage('https://media.tenor.com/t7rftXtbZxEAAAAd/discord-anime.gif')
            .setColor(color)
            .setFooter({ text: 'Trang 1/5 • Chọn danh mục bên dưới' })
            .setTimestamp(),

        // Page 1 - Giải Trí & Kinh Tế
        new EmbedBuilder()
            .setTitle('🎮 GIẢI TRÍ & KINH TẾ')
            .setDescription('Hệ thống tiền tệ (🪙) phong phú cùng các trò chơi giải trí, đầu tư và ngân hàng.')
            .addFields(
                { name: '💰 Kiếm Tiền', value: `> \`${prefix}daily\` - Nhận thưởng hằng ngày\n> \`${prefix}work\` - Làm việc kiếm coin\n\n> \`${prefix}dovui\` - Đố vui có thưởng> \`${prefix}noitu\` - Chơi nối từ nhận xu`, inline: true },
                { name: '🏦 Ngân Hàng', value: `> \`${prefix}bank\` - Quản lý tài khoản (Gửi/Rút)\n> \`${prefix}robbank\` - Cướp ngân hàng\n> \`${prefix}dautu\` - Đầu tư sinh lời`, inline: true },
                { name: '🎲 Cờ Bạc & Trò Chơi', value: `\`\`\`\n${prefix}tx    - Tài xỉu\n${prefix}bc    - Bầu cua\n${prefix}bj    - Blackjack\n${prefix}lode  - Lô đề\n${prefix}hack  - Hack tiền người khác\n\`\`\``, inline: false },
                { name: '🐾 Pokemon & Cửa Hàng', value: `> \`/shop\` - Mua sắm (Pokeball, Hạt giống...)\n> \`${prefix}cp\` (Bắt) | \`${prefix}pets\` (Xem túi) | \`${prefix}pb\` (Đấu)\n> \`${prefix}farm\` - Trồng trọt, thu hoạch`, inline: false },
                { name: '💳 Giao Dịch', value: `> \`${prefix}bal\` (Số dư) | \`${prefix}give\` (Chuyển tiền) | \`${prefix}top\` (BXH Giàu)`, inline: false }
            )
            .setColor(color)
            .setFooter({ text: 'Trang 2/5 • Giải Trí & Kinh Tế' }),

        // Page 2 - Xã Hội & Tương Tác
        new EmbedBuilder()
            .setTitle('💕 XÃ HỘI & TƯƠNG TÁC')
            .setDescription('Kết nối mọi người, tạo phòng Voice cá nhân và thăng cấp tương tác.')
            .addFields(
                { name: '💍 Kết Hôn', value: `> \`${prefix}marry [@user]\` - Cầu hôn\n> \`${prefix}divorce\` - Ly hôn`, inline: true },
                { name: '💘 Lễ Đường', value: `> \`${prefix}thinh\` - Xin câu thả thính\n> \`${prefix}boitinhyeu\` - Bói tình duyên\n> \`${prefix}cauduyen\` - Rút quẻ`, inline: true },
                { name: '🎧 Join To Create (J2C)', value: `> Tự động tạo phòng Voice khi tham gia kênh **"Tạo Phòng"**.\n\`\`\`\n/doiten  - Đổi tên phòng\n/gioihan - Giới hạn người\n/khoaan  - Ẩn phòng\n/khoavc  - Khóa phòng\n/kickvc  - Đuổi người\n\`\`\``, inline: false },
                { name: '📱 Tiện Ích Khác', value: `> \`${prefix}av\` - Xem Avatar nét căng\n> \`${prefix}rank / toprank\` - Xem cấp độ tương tác\n> **Tải TikTok tự động** - Chỉ cần dán link vào chat!`, inline: false }
            )
            .setColor(color)
            .setFooter({ text: 'Trang 3/5 • Xã Hội & Tương Tác' }),

        // Page 3 - Ma Sói
        new EmbedBuilder()
            .setTitle('🐺 GAME MA SÓI (WEREWOLF)')
            .setDescription('Trải nghiệm Boardgame suy luận đỉnh cao ngay trong Discord!')
            .addFields(
                { name: '🎮 Cách Chơi', value: `> \`${prefix}masoi\` - Mở phòng chờ (Cần tối thiểu 4 người)\n> \`${prefix}wwstop\` - Hủy game (Dành cho Host/Admin)`, inline: false },
                { name: '🎭 Các Vai Trò', value: `\`\`\`\n🐺 Ma Sói  - Giết 1 người mỗi đêm\n👨‍⚕️ Bác Sĩ  - Cứu 1 người mỗi đêm\n🔮 Tiên Tri - Soi vai trò 1 người\n🏹 Thợ Săn - Kéo theo 1 người khi chết\n👤 Dân Làng - Suy luận và vote treo cổ\n\`\`\``, inline: false },
                { name: '🏆 Phần Thưởng', value: `> 🏅 Tham gia: **+10,000 🪙**\n> 🎉 Dân thắng: **+100,000 🪙**\n> 🐺 Sói thắng: **+300,000 🪙**`, inline: false }
            )
            .setColor(color)
            .setFooter({ text: 'Trang 4/5 • Ma Sói' }),

        // Page 4 - Quản Trị
        new EmbedBuilder()
            .setTitle('🛡️ QUẢN TRỊ & HỆ THỐNG')
            .setDescription('Dành riêng cho Admin và Developer để vận hành server hiệu quả.')
            .addFields(
                { name: '⛓️ Tù Đày', value: `> \`${prefix}jail [@user] [số]\` - Giam giữ người vi phạm\n> \`${prefix}unjail [@user]\` - Ân xá, thả tự do\n> \`${prefix}nopphat\` - Tự chuộc thân (100,000 🪙)`, inline: false },
                { name: '🛡️ Bảo Mật', value: `> \`/antinuke / antiraid\` - Tắt/Mở Anti-Nuke, Anti-Raid\n> \`${prefix}setupjail\` - Setup Nhà tù tự động (Khóa Server)`, inline: false },
                { name: '💰 Quản Lý Kinh Tế', value: `> \`${prefix}addcoin / removecoin / setcoin\` - Điều chỉnh tiền\n> \`${prefix}resetcoin / resetallcoin\` - Làm mới tiền\n> \`${prefix}giveall\` - Phát tiền cho cả server (Dev)`, inline: false },
                { name: '⚙️ Cài Đặt Server', value: `> \`${prefix}setprefix\` - Đổi Prefix\n> \`/setwelcome / setpinggame / set1ar / setjail\` - Cài đặt tính năng\n> \`/setupadvlogs\` - Tạo hệ thống Log\n> \`${prefix}disable / enable\` - Tắt/Mở bot tại kênh`, inline: false },
                { name: '🛠️ Tiện Ích Admin', value: `> \`${prefix}clear [số]\` - Xóa tin nhắn\n> \`${prefix}say\` - Nói thay Bot\n> \`${prefix}admincheat\` - Bảng điều khiển tối thượng\n> \`${prefix}gstart / gend / greroll\` - Giveaway\n> \`${prefix}leave sv\` - Rời server (Dev)`, inline: false }
            )
            .setColor(color)
            .setFooter({ text: 'Trang 5/5 • Quản Trị & Hệ Thống' })
    ];
}

function buildHelpMenu() {
    return new StringSelectMenuBuilder()
        .setCustomId('help_menu')
        .setPlaceholder('📂 Khám phá tính năng...')
        .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('Tổng Quan').setValue('0').setDescription('Trang chính').setEmoji('🌟'),
            new StringSelectMenuOptionBuilder().setLabel('Giải Trí & Kinh Tế').setValue('1').setDescription('Tiền tệ, Bank, Minigame').setEmoji('🎮'),
            new StringSelectMenuOptionBuilder().setLabel('Xã Hội & Tương Tác').setValue('2').setDescription('Kết hôn, Lễ đường, Voice J2C').setEmoji('💕'),
            new StringSelectMenuOptionBuilder().setLabel('Game Ma Sói').setValue('3').setDescription('Boardgame suy luận').setEmoji('🐺'),
            new StringSelectMenuOptionBuilder().setLabel('Quản Trị & Hệ Thống').setValue('4').setDescription('Admin, Cài đặt, Developer').setEmoji('🛡️')
        );
}


// ========================
// MUSIC QUEUE SYSTEM
// ========================
// Map<guildId, { queue: [], player, connection, playing }>
const musicQueues = new Map();



// Tạo panel nút điều khiển nhạc (2 hàng)




// ========================
// TIKTOK DOWNLOADER
// ========================
async function downloadTikTok(url) {
    try {
        // Dùng tikwm.com API - free và ổn định
        const response = await axios.post('https://www.tikwm.com/api/', { url }, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000
        });

        const data = response.data;
        if (data.code === 0 && data.data) {
            return {
                success: true,
                videoUrl: data.data.play,       // Video không watermark
                title: data.data.title,
                author: data.data.author?.nickname || 'Unknown',
                likes: data.data.digg_count,
                views: data.data.play_count,
                cover: data.data.cover
            };
        }
        return { success: false, error: 'Không lấy được dữ liệu từ TikTok' };
    } catch (err) {
        console.error('Lỗi TikTok:', err.message);
        return { success: false, error: err.message };
    }
}

// ========================
// YOUTUBE DOWNLOADER
// ========================
async function downloadYouTubeVideo(url) {
    return new Promise((resolve) => {
        const tempId = Math.random().toString(36).substring(2, 10);
        const tempFile = `./scratch/yt_${tempId}.mp4`;
        
        // Ensure scratch dir exists
        if (!fs.existsSync('./scratch')) {
            fs.mkdirSync('./scratch', { recursive: true });
        }

        const args = [
            '--extractor-args', 'youtube:player_client=android_vr',
            '-f', 'best[filesize<25M]/w[filesize<25M]',
            '-o', tempFile,
            url
        ];

        
        
        proc.on('close', (code) => {
            if (code === 0 && fs.existsSync(tempFile)) {
                resolve({ success: true, file: tempFile });
            } else {
                resolve({ success: false, error: 'Không thể tải video YouTube (có thể do video quá dài/dung lượng lớn hơn 25MB hoặc bị chặn)' });
            }
        });
    });
}

// ========================
// IMAGE RESTRICTION CONFIG
// ========================
const imageChannelsPath = './image_channels.json';
let imageChannelConfig = {};
function loadImageChannels() {
    if (!fs.existsSync(imageChannelsPath)) return {};
    try { return JSON.parse(fs.readFileSync(imageChannelsPath, 'utf8')); }
    catch { return {}; }
}
function saveImageChannels() {
    fs.writeFileSync(imageChannelsPath, JSON.stringify(imageChannelConfig, null, 2));
}
imageChannelConfig = loadImageChannels();

// ========================
// COIN SYSTEM
// ========================
const levelsPath = './levels.json';
function loadLevels() {
    if (!fs.existsSync(levelsPath)) return {};
    try { return JSON.parse(fs.readFileSync(levelsPath, 'utf8')); }
    catch { return {}; }
}
function saveLevels(data) { fs.writeFileSync(levelsPath, JSON.stringify(data, null, 2)); }
const xpCooldowns = new Map();

async function checkLevelUp(userId, user, xpAdded) {
    const data = loadLevels();
    if (!data[userId]) {
        data[userId] = { xp: 0, level: 1, messages: 0, voiceTime: 0 };
    }
    
    data[userId].xp += xpAdded;
    let currentLevel = data[userId].level;
    let xpNeeded = currentLevel * 100;
    
    let leveledUp = false;
    while (data[userId].xp >= xpNeeded) {
        data[userId].xp -= xpNeeded;
        data[userId].level++;
        currentLevel = data[userId].level;
        xpNeeded = currentLevel * 100;
        leveledUp = true;
    }
    
    saveLevels(data);
    
    if (leveledUp) {
        // User requested to disable the level up notification in the specific channel
        // Do nothing for now, but leveling system remains active.
    }
}

const coinsPath = './coins.json';
function loadCoins() {
    if (!fs.existsSync(coinsPath)) return {};
    try { return JSON.parse(fs.readFileSync(coinsPath, 'utf8')); }
    catch { return {}; }
}
function saveCoins(data) { fs.writeFileSync(coinsPath, JSON.stringify(data, null, 2)); }

const lodePath = './lode.json';
function loadLode() {
    if (!fs.existsSync(lodePath)) return { bets: [] };
    try { return JSON.parse(fs.readFileSync(lodePath, 'utf8')); }
    catch { return { bets: [] }; }
}
function saveLode(data) { fs.writeFileSync(lodePath, JSON.stringify(data, null, 2)); }

function getUserCoins(userId) {
    const data = loadCoins();
    if (!data[userId]) { data[userId] = { coins: 500000, bank: 0, lastDaily: 0 }; saveCoins(data); }
    return data[userId].coins;
}

function getUserBank(userId) {
    const data = loadCoins();
    if (!data[userId]) { data[userId] = { coins: 500000, bank: 0, lastDaily: 0 }; saveCoins(data); }
    return data[userId].bank || 0;
}

function addCoins(userId, amount) {
    const data = loadCoins();
    if (!data[userId]) data[userId] = { coins: 500000, bank: 0, lastDaily: 0 };
    data[userId].coins = Math.max(0, Math.floor((data[userId].coins) + amount));
    saveCoins(data);
    return data[userId].coins;
}

function addBank(userId, amount) {
    const data = loadCoins();
    if (!data[userId]) data[userId] = { coins: 500000, bank: 0, lastDaily: 0 };
    data[userId].bank = Math.max(0, Math.floor((data[userId].bank || 0) + amount));
    saveCoins(data);
    return data[userId].bank;
}

function setCoins(userId, amount) {
    const data = loadCoins();
    if (!data[userId]) data[userId] = { coins: 500000, bank: 0, lastDaily: 0 };
    data[userId].coins = Math.max(0, Math.floor(amount));
    saveCoins(data);
    return data[userId].coins;
}

function claimDaily(userId) {
    const data = loadCoins();
    if (!data[userId]) data[userId] = { coins: 0, lastDaily: 0, streak: 0 };
    const now = Date.now();
    const last = data[userId].lastDaily || 0;
    const remaining = (24 * 60 * 60 * 1000) - (now - last);
    if (remaining > 0 && !data[userId]?.alwaysWin) return { success: false, remaining };

    let streak = data[userId].streak || 0;
    if (now - last > 48 * 60 * 60 * 1000) {
        streak = 1;
    } else {
        streak++;
    }

    const baseReward = Math.floor(Math.random() * 40001) + 10000; // 10,000 - 50,000
    const bonus = Math.min((streak - 1) * 5000, 50000); // +5000 mỗi ngày, tối đa +50,000
    const totalReward = baseReward + bonus;

    data[userId].coins = Math.max(0, Math.floor(data[userId].coins + totalReward));
    data[userId].lastDaily = now;
    data[userId].streak = streak;
    saveCoins(data);
    return { success: true, reward: totalReward, baseReward, bonus, streak, total: data[userId].coins };
}

function getLeaderboard() {
    const data = loadCoins();
    const rpgData = loadRPG();
    return Object.entries(data)
        .map(([id, d]) => {
            const invest = rpgData[id]?.investAmount || 0;
            return { id, coins: (d.coins || 0) + (d.bank || 0) + invest };
        })
        .sort((a, b) => b.coins - a.coins)
        .slice(0, 10);
}

function formatCoinShort(n) {
    if (n >= 1e12) return (n / 1e12).toFixed(1).replace(/\.0$/, '') + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toString();
}

function buildLeaderboardEmbed(client) {
    const lb = getLeaderboard();
    if (!lb.length) return new EmbedBuilder().setTitle('🏆 BẢNG XẾP HẠNG').setDescription('Chưa có ai có tài sản!').setColor('#FFD700');

    const medals = ['🥇', '🥈', '🥉'];
    const titles = ['ĐẠI TỶ PHÚ', 'Á QUÂN', 'QUÝ TỘC'];
    const barFull = '▰';
    const barEmpty = '▱';
    const maxCoins = lb[0].coins || 1;

    // Build top 3 section
    let top3Text = '';
    for (let i = 0; i < Math.min(3, lb.length); i++) {
        const e = lb[i];
        const barLen = Math.max(1, Math.round((e.coins / maxCoins) * 10));
        const bar = barFull.repeat(barLen) + barEmpty.repeat(10 - barLen);
        top3Text += `${medals[i]} **${titles[i]} TOP ${i + 1}**\n`;
        top3Text += `╰ <@${e.id}>\n`;
        top3Text += `╰ 💰 **${e.coins.toLocaleString()}** 🪙\n`;
        top3Text += `╰ ${bar}\n\n`;
    }

    // Build top 4-10 section
    let restText = '';
    for (let i = 3; i < lb.length; i++) {
        const e = lb[i];
        const rankEmoji = ['4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][i - 3] || `**#${i + 1}**`;
        restText += `${rankEmoji} <@${e.id}> — **${e.coins.toLocaleString()}** 🪙\n`;
    }

    const embed = new EmbedBuilder()
        .setTitle('🏆 BẢNG XẾP HẠNG ĐẠI GIA 🏆')
        .setDescription(
            `> Top ${lb.length} người giàu nhất server\n` +
            `> *(Tiền mặt + Ngân hàng + Đầu tư)*\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            top3Text
        )
        .setColor('#FFD700')
        .setThumbnail(client.user.displayAvatarURL());

    if (restText) {
        embed.addFields({
            name: '━━━━━ 🏅 DANH SÁCH TIẾP THEO ━━━━━',
            value: restText,
            inline: false
        });
    }

    const now = new Date();
    const timeStr = `Hôm nay lúc ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} ${now.getHours() >= 12 ? 'CH' : 'SA'}`;
    embed.setFooter({ text: `Cập nhật thời gian thực • ${timeStr}` }).setTimestamp();
    return embed;
}

function buildBankEmbed(user) {
    const cash = getUserCoins(user.id);
    const bank = getUserBank(user.id);
    const total = cash + bank;
    return new EmbedBuilder()
        .setTitle('🏦 NGÂN HÀNG TRUNG ƯƠNG')
        .setDescription(`Chào mừng **${user.username}** đến với Ngân Hàng.\nVui lòng sử dụng các nút bên dưới để thực hiện giao dịch.`)
        .addFields(
            { name: '💵 Tiền mặt (Ví)', value: `**${cash.toLocaleString()}** 🪙`, inline: true },
            { name: '💳 Tiền gửi ngân hàng', value: `**${bank.toLocaleString()}** 🪙`, inline: true },
            { name: '💰 Tổng tài sản', value: `**${total.toLocaleString()}** 🪙`, inline: false }
        )
        .setColor('#00ffcc')
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp()
        .setFooter({ text: 'Hệ thống Ngân hàng Lavie ❄️' });
}

function buildBankButtons(ownerId) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`bank_deposit_btn_${ownerId}`)
            .setLabel('Gửi tiền (Deposit)')
            .setEmoji('📥')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`bank_withdraw_btn_${ownerId}`)
            .setLabel('Rút tiền (Withdraw)')
            .setEmoji('📤')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`bank_top_btn_${ownerId}`)
            .setLabel('Bảng xếp hạng (Top)')
            .setEmoji('🏆')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`bank_refresh_btn_${ownerId}`)
            .setLabel('Làm mới (Refresh)')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary)
    );
    return [row];
}

// ========================
// WORK SYSTEM
// ========================
const WORK_JOBS = {
    'bottle': { name: 'Nhặt ve chai', duration: 1 * 60 * 1000, minR: 1000, maxR: 5000, emoji: '♻️' },
    'sweep': { name: 'Quét rác', duration: 3 * 60 * 1000, minR: 5000, maxR: 15000, emoji: '🧹' },
    'wash_dishes': { name: 'Rửa bát thuê', duration: 5 * 60 * 1000, minR: 10000, maxR: 50000, emoji: '🍽️' },
    'waiter': { name: 'Phục vụ quán', duration: 10 * 60 * 1000, minR: 30000, maxR: 80000, emoji: '☕' },
    'shipper': { name: 'Giao hàng', duration: 15 * 60 * 1000, minR: 50000, maxR: 150000, emoji: '🛵' },
    'mechanic': { name: 'Sửa xe', duration: 20 * 60 * 1000, minR: 80000, maxR: 200000, emoji: '🔧' },
    'developer': { name: 'Lập trình viên', duration: 30 * 60 * 1000, minR: 200000, maxR: 500000, emoji: '💻' },
    'manager': { name: 'Quản lý dự án', duration: 40 * 60 * 1000, minR: 300000, maxR: 700000, emoji: '📊' },
    'investor': { name: 'Đầu tư chứng khoán', duration: 50 * 60 * 1000, minR: 400000, maxR: 900000, emoji: '📈' },
    'ceo': { name: 'Giám đốc', duration: 60 * 60 * 1000, minR: 500000, maxR: 1200000, emoji: '🏢' }
};

async function handleWorkCommand(userId, msgOrInteraction) {
    const data = loadCoins();
    if (!data[userId]) data[userId] = { coins: 0, lastDaily: 0, streak: 0 };
    const user = data[userId];
    const now = Date.now();

    if (user.alwaysWin) {
        const jobKeys = Object.keys(WORK_JOBS);
        const randomJobId = jobKeys[Math.floor(Math.random() * jobKeys.length)];
        const job = WORK_JOBS[randomJobId];
        const reward = job.maxR; // Max reward for cheat
        user.coins = Math.max(0, Math.floor((user.coins || 0) + reward));
        saveCoins(data);
        const embedCheat = new EmbedBuilder()
            .setTitle('👑 [CHEAT] Hoàn thành công việc tức thì!')
            .setDescription(`Búng tay một cái, Hệ Thống (Developer) đã làm xong **${job.name}** ${job.emoji} và đút túi luôn **${reward.toLocaleString()} 🪙**!`)
            .setColor('#FF0000');
        return msgOrInteraction.reply({ embeds: [embedCheat] });
    }

    if (user.workEnd) {
        if (now >= user.workEnd) {
            const reward = user.workReward || 0;
            const jobName = user.workJob || 'Công việc';
            user.coins = Math.max(0, Math.floor((user.coins || 0) + reward));
            user.workEnd = null;
            user.workJob = null;
            user.workReward = null;
            saveCoins(data);
            return msgOrInteraction.reply(`🎉 Bạn đã hoàn thành công việc **${jobName}** và nhận được **${reward.toLocaleString()} 🪙**!`);
        } else {
            const remaining = user.workEnd - now;
            const m = Math.floor(remaining / 60000);
            const s = Math.floor((remaining % 60000) / 1000);
            return msgOrInteraction.reply(`⏳ Bạn đang làm **${user.workJob}**...\nHãy quay lại sau **${m} phút ${s} giây** để nhận lương!`);
        }
    }

    const jobKeys = Object.keys(WORK_JOBS);
    const randomJobId = jobKeys[Math.floor(Math.random() * jobKeys.length)];
    const job = WORK_JOBS[randomJobId];
    const reward = Math.floor(Math.random() * (job.maxR - job.minR + 1)) + job.minR;
    
    user.workEnd = now + job.duration;
    user.workJob = job.name;
    user.workReward = reward;
    saveCoins(data);

    const embed2 = new EmbedBuilder()
        .setTitle('💼 Bắt đầu làm việc!')
        .setDescription(`Hệ thống đã phân công ngẫu nhiên cho bạn công việc **${job.name}** ${job.emoji}.\nThời gian: **${job.duration / 60000} phút**.\nLương dự kiến: **${job.minR.toLocaleString()} - ${job.maxR.toLocaleString()} 🪙**.\n\nHãy dùng lệnh \`!work\` hoặc \`/work\` sau khi hết thời gian để nhận lương!`)
        .setColor('#00FF00');
    return msgOrInteraction.reply({ embeds: [embed2] });
}

// ========================
// RPG SYSTEM
// ========================
const rpgPath = './rpg.json';

const RPG_ITEMS = {
    weapons: {
        'wood_sword': { name: 'Kiếm Gỗ', atk: 5, price: 250000, emoji: '🗡️' },
        'iron_sword': { name: 'Kiếm Sắt', atk: 15, price: 1000000, emoji: '⚔️' },
        'steel_sword': { name: 'Kiếm Thép', atk: 30, price: 3000000, emoji: '🤺' },
        'diamond_sword': { name: 'Kiếm Kim Cương', atk: 70, price: 10000000, emoji: '💠' },
        'mythic_sword': { name: 'Kiếm Thần Thoại', atk: 150, price: 50000000, emoji: '🔱' }
    },
    armors: {
        'leather_armor': { name: 'Giáp Da', def: 5, price: 500000, emoji: '🦺' },
        'iron_armor': { name: 'Giáp Sắt', def: 15, price: 1500000, emoji: '🛡️' },
        'steel_armor': { name: 'Giáp Thép', def: 30, price: 4000000, emoji: '🦾' },
        'diamond_armor': { name: 'Giáp Kim Cương', def: 70, price: 15000000, emoji: '💎' },
        'mythic_armor': { name: 'Giáp Thần Thoại', def: 150, price: 50000000, emoji: '🔰' }
    },
    potions: {
        'small_potion': { name: 'Bình Máu Nhỏ', heal: 50, price: 10000, emoji: '🧪' },
        'large_potion': { name: 'Bình Máu Lớn', heal: 150, price: 50000, emoji: '💊' },
        'xp_potion': { name: 'Bình EXP', heal: 0, exp: 500, price: 20000, emoji: '🔮' }
    },
    materials: {
        'iron_ore': { name: 'Quặng Sắt', emoji: '🪨', price: 5000 },
        'dragon_scale': { name: 'Vảy Rồng', emoji: '🐲', price: 25000 },
        'magic_dust': { name: 'Bụi Ma Thuật', emoji: '✨', price: 10000 },
        'demon_horn': { name: 'Sừng Quỷ', emoji: '👿', price: 50000 },
        'wood_log': { name: 'Gỗ Sồi', emoji: '🪵', price: 1000 },
        'herb': { name: 'Thảo Dược', emoji: '🌿', price: 2000 },
        'mega_stone': { name: 'Đá Mega', emoji: '🔮', price: 200000 },
        'z_crystal': { name: 'Đá Tuyệt Kỹ Z', emoji: '💠', price: 250000 },
        'gold_ore': { name: 'Quặng Vàng', emoji: '🪙', price: 15000 },
        'fire_crystal': { name: 'Tinh Thể Lửa', emoji: '🔥', price: 20000 },
        'ice_gem': { name: 'Băng Ngọc', emoji: '🧊', price: 30000 },
        'water_soul': { name: 'Linh Hồn Nước', emoji: '💧', price: 35000 },
        'void_shard': { name: 'Mảnh Vỡ Không Gian', emoji: '🌌', price: 80000 },
        'obsidian': { name: 'Hắc Diện Thạch', emoji: '⬛', price: 100000 }
    },
    artifacts: {
        'ring_of_power': { name: 'Nhẫn Sức Mạnh', emoji: '💍', atkBonus: 0.10, defBonus: 0, hpBonus: 0, price: 500000 },
        'amulet_of_defense': { name: 'Dây Chuyền Hộ Mệnh', emoji: '📿', atkBonus: 0, defBonus: 0.10, hpBonus: 0, price: 500000 },
        'gem_of_life': { name: 'Ngọc Sinh Lực', emoji: '💎', atkBonus: 0, defBonus: 0, hpBonus: 0.20, price: 800000 },
        'hero_badge': { name: 'Huy Hiệu Dũng Sĩ', emoji: '🎖️', atkBonus: 0.15, defBonus: 0.15, hpBonus: 0, price: 2000000 }
    },
    pokeballs: {
        'basic_ball': { name: 'Bóng Thường', catchRate: 0.3, price: 10000, emoji: '🔴' },
        'great_ball': { name: 'Bóng Siêu Cấp', catchRate: 0.5, price: 50000, emoji: '🔵' },
        'ultra_ball': { name: 'Bóng Tối Thượng', catchRate: 0.8, price: 200000, emoji: '🟡' },
        'master_ball': { name: 'Bóng Vô Cực', catchRate: 1.0, price: 1000000, emoji: '🟣' }
    },
    seeds: {
        'wheat_seed': { name: 'Hạt giống Lúa Mì', emoji: '🌱', growTime: 5 * 60 * 1000, yieldItem: 'wheat', price: 1000 },
        'carrot_seed': { name: 'Hạt giống Cà Rốt', emoji: '🥕', growTime: 30 * 60 * 1000, yieldItem: 'carrot', price: 5000 },
        'tomato_seed': { name: 'Hạt giống Cà Chua', emoji: '🍅', growTime: 120 * 60 * 1000, yieldItem: 'tomato', price: 15000 },
        'magic_seed': { name: 'Hạt giống Cây Thần', emoji: '🌳', growTime: 12 * 60 * 60 * 1000, yieldItem: 'magic_leaf', price: 100000 }
    },
    crops: {
        'wheat': { name: 'Lúa Mì', emoji: '🌾', price: 2000 },
        'carrot': { name: 'Cà Rốt', emoji: '🥕', price: 12000 },
        'tomato': { name: 'Cà Chua', emoji: '🍅', price: 40000 },
        'magic_leaf': { name: 'Lá Cây Thần', emoji: '🍃', price: 300000 }
    },
    tools: {
        'laptop': { name: 'Laptop Hacker', emoji: '💻', price: 1000000 },
        'virus': { name: 'Virus Trojan', emoji: '🦠', price: 100000 },
        'firewall': { name: 'Tường Lửa', emoji: '🧱', price: 300000 }
    }
};

const MONSTERS = [
    { name: 'Slime Nhỏ', hp: 30, atk: 5, def: 2, exp: 10, coin: 20, emoji: '💧' },
    { name: 'Yêu Tinh Goblin', hp: 60, atk: 12, def: 5, exp: 25, coin: 50, emoji: '👺' },
    { name: 'Sói Hoang', hp: 100, atk: 25, def: 10, exp: 40, coin: 80, emoji: '🐺' },
    { name: 'Chiến Binh Orc', hp: 200, atk: 40, def: 20, exp: 80, coin: 150, emoji: '👹' },
    { name: 'Hồn Ma', hp: 350, atk: 60, def: 15, exp: 120, coin: 250, emoji: '👻' },
    { name: 'Rồng Con', hp: 600, atk: 90, def: 40, exp: 200, coin: 400, emoji: '🐉' },
    { name: 'Golem Dung Nham', hp: 1000, atk: 120, def: 80, exp: 350, coin: 800, emoji: '🪨' },
    { name: 'Ma Sói Đột Biến', hp: 1500, atk: 180, def: 60, exp: 500, coin: 1200, emoji: '🐺🌑' },
    { name: 'Tinh Linh Băng', hp: 1200, atk: 250, def: 50, exp: 600, coin: 1500, emoji: '🧊' },
    { name: 'Rồng Hư Không', hp: 3000, atk: 400, def: 150, exp: 1500, coin: 5000, emoji: '🌌🐉' }
];

// ========================
// RPG EXPANSION CONSTANTS
// ========================

// DUNGEON SYSTEM
const DUNGEONS = [
    {
        id: 'goblin_cave', name: '🏚️ Hang Yêu Tinh', minLevel: 1,
        floors: [
            { name: 'Slime Nhầy', hp: 40, atk: 8, def: 3, emoji: '💧' },
            { name: 'Yêu Tinh Lính', hp: 60, atk: 12, def: 5, emoji: '👺' },
            { name: 'Yêu Tinh Cung', hp: 50, atk: 18, def: 4, emoji: '🏹' },
            { name: 'Yêu Tinh Giáp', hp: 80, atk: 15, def: 12, emoji: '🛡️' },
            { name: 'Sói Canh Gác', hp: 100, atk: 22, def: 8, emoji: '🐺' },
        ],
        boss: { name: 'Vua Yêu Tinh', hp: 250, atk: 35, def: 15, emoji: '👹' },
        rewards: { coin: 5000, exp: 150, chestChance: 0.4, chestType: 'wood' },
        cooldown: 30 * 60 * 1000
    },
    {
        id: 'magic_tower', name: '🗼 Tháp Ma Thuật', minLevel: 5,
        floors: [
            { name: 'Bóng Ma', hp: 120, atk: 30, def: 10, emoji: '👻' },
            { name: 'Phù Thủy Đen', hp: 150, atk: 40, def: 12, emoji: '🧙' },
            { name: 'Gollem Đá', hp: 250, atk: 25, def: 30, emoji: '🗿' },
            { name: 'Rồng Con Lửa', hp: 200, atk: 50, def: 18, emoji: '🐉' },
            { name: 'Sứ Giả Bóng Tối', hp: 180, atk: 55, def: 20, emoji: '🦇' },
        ],
        boss: { name: 'Chúa Tể Bóng Tối', hp: 500, atk: 70, def: 30, emoji: '🌑' },
        rewards: { coin: 20000, exp: 500, chestChance: 0.6, chestType: 'iron' },
        cooldown: 30 * 60 * 1000
    },
    {
        id: 'hell_gate', name: '🔥 Cổng Địa Ngục', minLevel: 10,
        floors: [
            { name: 'Quỷ Lửa', hp: 300, atk: 60, def: 25, emoji: '👿' },
            { name: 'Cerberus', hp: 400, atk: 70, def: 30, emoji: '🐕' },
            { name: 'Tử Thần', hp: 350, atk: 90, def: 20, emoji: '💀' },
            { name: 'Hydra 3 Đầu', hp: 600, atk: 80, def: 35, emoji: '🐍' },
            { name: 'Titan Cổ Đại', hp: 500, atk: 100, def: 40, emoji: '⚡' },
        ],
        boss: { name: 'Ma Vương Diablo', hp: 1200, atk: 120, def: 50, emoji: '😈' },
        rewards: { coin: 100000, exp: 2000, chestChance: 0.8, chestType: 'gold' },
        cooldown: 30 * 60 * 1000
    },
    {
        id: 'frozen_ruins', name: '❄️ Tàn Tích Băng Giá', minLevel: 15,
        floors: [
            { name: 'Slime Băng', hp: 500, atk: 80, def: 40, emoji: '💧' },
            { name: 'Sói Tuyết', hp: 700, atk: 100, def: 50, emoji: '🐺' },
            { name: 'Người Đá Băng', hp: 1000, atk: 90, def: 100, emoji: '🗿' },
            { name: 'Phù Thủy Băng', hp: 800, atk: 150, def: 60, emoji: '🧙' },
            { name: 'Kỵ Sĩ Rồng Tuyết', hp: 1500, atk: 200, def: 80, emoji: '🐎' },
        ],
        boss: { name: 'Rồng Băng Mắt Xanh', hp: 3500, atk: 300, def: 120, emoji: '🐉❄️' },
        rewards: { coin: 250000, exp: 5000, chestChance: 1.0, chestType: 'legendary' },
        cooldown: 60 * 60 * 1000
    },
    {
        id: 'nightmare_realm', name: '🌑 Lãnh Địa Ác Mộng', minLevel: 20,
        floors: [
            { name: 'Bóng Ma Khóc', hp: 1000, atk: 200, def: 80, emoji: '👻' },
            { name: 'Kỵ Sĩ Địa Ngục', hp: 2000, atk: 250, def: 150, emoji: '🐎🔥' },
            { name: 'Tử Thần Cổ Đại', hp: 2500, atk: 350, def: 100, emoji: '💀' },
            { name: 'Quái Vật Hỗn Mang', hp: 3000, atk: 400, def: 200, emoji: '🐙' },
            { name: 'Sứ Giả Tận Thế', hp: 4000, atk: 450, def: 180, emoji: '🦇' },
        ],
        boss: { name: 'Quỷ Vương Hủy Diệt', hp: 8000, atk: 600, def: 300, emoji: '👿👑' },
        rewards: { coin: 1000000, exp: 12000, chestChance: 1.0, chestType: 'legendary' },
        cooldown: 120 * 60 * 1000
    },
    {
        id: 'endless_abyss', name: '🌀 Vực Thẳm Vô Tận', minLevel: 30,
        floors: [
            { name: 'Tinh Linh Hư Không', hp: 5000, atk: 500, def: 250, emoji: '👾' },
            { name: 'Kẻ Nuốt Chửng', hp: 6000, atk: 600, def: 280, emoji: '🧿' },
            { name: 'Bóng Ma Khổng Lồ', hp: 7500, atk: 700, def: 300, emoji: '👻' },
            { name: 'Xúc Tu Hắc Ám', hp: 9000, atk: 800, def: 350, emoji: '🐙' },
            { name: 'Thống Soái Vực Thẳm', hp: 11000, atk: 900, def: 400, emoji: '🛡️' },
        ],
        boss: { name: 'Chúa Tể Hư Không', hp: 20000, atk: 1200, def: 600, emoji: '🌌👑' },
        rewards: { coin: 2500000, exp: 25000, chestChance: 1.0, chestType: 'legendary' },
        cooldown: 180 * 60 * 1000
    },
    {
        id: 'divine_realm', name: '⛰️ Vương Quốc Thần Linh', minLevel: 40,
        floors: [
            { name: 'Vệ Binh Thiên Thần', hp: 12000, atk: 1000, def: 500, emoji: '👼' },
            { name: 'Chiến Binh Ánh Sáng', hp: 15000, atk: 1200, def: 600, emoji: '⚔️' },
            { name: 'Sư Tử Thần', hp: 18000, atk: 1500, def: 700, emoji: '🦁' },
            { name: 'Pháp Sư Tối Cao', hp: 16000, atk: 2000, def: 400, emoji: '🧙‍♂️' },
            { name: 'Tổng Lãnh Thiên Thần', hp: 22000, atk: 1800, def: 800, emoji: '🕊️' },
        ],
        boss: { name: 'Thần Ánh Sáng', hp: 45000, atk: 2500, def: 1200, emoji: '☀️👑' },
        rewards: { coin: 6000000, exp: 50000, chestChance: 1.0, chestType: 'legendary' },
        cooldown: 240 * 60 * 1000
    },
    {
        id: 'shattered_heaven', name: '🌠 Thiên Đình Gãy Nát', minLevel: 50,
        floors: [
            { name: 'Mảnh Vỡ Hỗn Mang', hp: 25000, atk: 2200, def: 1000, emoji: '☄️' },
            { name: 'Tàn Dư Thần Linh', hp: 30000, atk: 2500, def: 1200, emoji: '🧟' },
            { name: 'Thú Cưỡi Bạo Chúa', hp: 35000, atk: 3000, def: 1500, emoji: '🐅' },
            { name: 'Bóng Đen Thời Gian', hp: 40000, atk: 3500, def: 1800, emoji: '⏳' },
            { name: 'Kẻ Hủy Diệt Thế Giới', hp: 50000, atk: 4000, def: 2000, emoji: '🌍💥' },
        ],
        boss: { name: 'Hệ Thống (Developer) Đọa Lạc', hp: 100000, atk: 6000, def: 3000, emoji: '🌌🎭' },
        rewards: { coin: 15000000, exp: 120000, chestChance: 1.0, chestType: 'legendary' },
        cooldown: 360 * 60 * 1000
    }
];

const REGIONS = {
    'rung_sau': { id: 'rung_sau', name: 'Khu Rừng Yên Bình', minLevel: 1, emoji: '🌲', drops: ['wood_log', 'herb'], chances: [0.7, 0.3] },
    'hang_dong': { id: 'hang_dong', name: 'Hang Động Gió Hú', minLevel: 5, emoji: '🦇', drops: ['iron_ore', 'magic_dust'], chances: [0.6, 0.4] },
    'nui_lua': { id: 'nui_lua', name: 'Núi Lửa Cổ Đại', minLevel: 10, emoji: '🌋', drops: ['gold_ore', 'fire_crystal'], chances: [0.5, 0.5] },
    'dao_bang': { id: 'dao_bang', name: 'Đảo Băng Giá', minLevel: 15, emoji: '🧊', drops: ['ice_gem', 'water_soul'], chances: [0.5, 0.5] },
    'hu_khong': { id: 'hu_khong', name: 'Hư Không', minLevel: 20, emoji: '🌌', drops: ['void_shard', 'obsidian', 'dragon_scale', 'demon_horn'], chances: [0.3, 0.3, 0.2, 0.2] }
};

// CLASS SYSTEM
const RPG_CLASSES = {
    warrior: { name: 'Chiến Binh', emoji: '⚔️', desc: '+30% ATK. Chiêu: Cuồng Nộ (x2 DMG 3 lượt)', atkBonus: 0.3, defBonus: 0, hpBonus: 0, coinBonus: 0, skillName: 'Cuồng Nộ', skillEmoji: '💥', skillCD: 3 },
    knight: { name: 'Hiệp Sĩ', emoji: '🛡️', desc: '+30% DEF, +20% HP. Chiêu: Bất Tử (chặn 100% dmg)', atkBonus: 0, defBonus: 0.3, hpBonus: 0.2, coinBonus: 0, skillName: 'Bất Tử', skillEmoji: '✨', skillCD: 3 },
    mage: { name: 'Pháp Sư', emoji: '🧙', desc: '+20% ATK, +15% coin hunt. Chiêu: Thiên Thạch (bỏ qua giáp)', atkBonus: 0.2, defBonus: 0, hpBonus: 0, coinBonus: 0.15, skillName: 'Thiên Thạch', skillEmoji: '☄️', skillCD: 5 }
};

// DAILY QUEST TEMPLATES
const QUEST_TEMPLATES = [
    { id: 'hunt_3', desc: '⚔️ Đánh bại 3 con quái', type: 'hunt', target: 3, reward: { coin: 15000, exp: 50 } },
    { id: 'hunt_5', desc: '⚔️ Đánh bại 5 con quái', type: 'hunt', target: 5, reward: { coin: 30000, exp: 100 } },
    { id: 'hunt_10', desc: '⚔️ Đánh bại 10 con quái', type: 'hunt', target: 10, reward: { coin: 60000, exp: 200 } },
    { id: 'catch_1', desc: '🐾 Bắt 1 Pokemon', type: 'catch', target: 1, reward: { coin: 20000, exp: 50 } },
    { id: 'catch_3', desc: '🐾 Bắt 3 Pokemon', type: 'catch', target: 3, reward: { coin: 50000, exp: 100 } },
    { id: 'dungeon_1', desc: '🏰 Hoàn thành 1 Dungeon', type: 'dungeon', target: 1, reward: { coin: 40000, exp: 150 } },
    { id: 'buy_1', desc: '🛒 Mua 1 món đồ từ Shop', type: 'buy', target: 1, reward: { coin: 10000, exp: 30 } },
    { id: 'pvp_1', desc: '⚔️ Thắng 1 trận PvP', type: 'pvp_win', target: 1, reward: { coin: 50000, exp: 100 } },
    { id: 'heal_2', desc: '💊 Hồi máu 2 lần', type: 'heal', target: 2, reward: { coin: 10000, exp: 30 } },
    { id: 'earn_50k', desc: '💰 Kiếm tổng 50,000 coin', type: 'earn_coin', target: 50000, reward: { coin: 25000, exp: 80 } },
];

const QUEST_COMPLETION_BONUS = { coin: 100000, exp: 200 };

// CHEST DEFINITIONS
const RPG_CHESTS = {
    wood: { name: 'Rương Gỗ', emoji: '📦', color: '#8B4513', loot: [
        { type: 'coin', min: 5000, max: 20000, chance: 0.5 },
        { type: 'potion', item: 'small_potion', min: 1, max: 3, chance: 0.3 },
        { type: 'potion', item: 'large_potion', min: 1, max: 2, chance: 0.15 },
        { type: 'pokeball', item: 'basic_ball', min: 1, max: 3, chance: 0.05 },
    ]},
    iron: { name: 'Rương Sắt', emoji: '🗄️', color: '#708090', loot: [
        { type: 'coin', min: 20000, max: 100000, chance: 0.35 },
        { type: 'potion', item: 'large_potion', min: 2, max: 5, chance: 0.2 },
        { type: 'pokeball', item: 'great_ball', min: 1, max: 3, chance: 0.2 },
        { type: 'weapon', items: ['iron_sword', 'steel_sword'], chance: 0.15 },
        { type: 'armor', items: ['iron_armor', 'steel_armor'], chance: 0.1 },
    ]},
    gold: { name: 'Rương Vàng', emoji: '✨', color: '#FFD700', loot: [
        { type: 'coin', min: 100000, max: 500000, chance: 0.3 },
        { type: 'pokeball', item: 'ultra_ball', min: 1, max: 3, chance: 0.2 },
        { type: 'weapon', items: ['steel_sword', 'diamond_sword'], chance: 0.2 },
        { type: 'armor', items: ['steel_armor', 'diamond_armor'], chance: 0.15 },
        { type: 'pokeball', item: 'master_ball', min: 1, max: 1, chance: 0.1 },
        { type: 'exp', amount: 500, chance: 0.05 },
    ]},
    legendary: { name: 'Rương Huyền Thoại', emoji: '👑', color: '#FF4500', loot: [
        { type: 'coin', min: 500000, max: 2000000, chance: 0.25 },
        { type: 'weapon', items: ['diamond_sword'], chance: 0.2 },
        { type: 'armor', items: ['diamond_armor'], chance: 0.2 },
        { type: 'pokeball', item: 'master_ball', min: 1, max: 3, chance: 0.15 },
        { type: 'exp', amount: 2000, chance: 0.1 },
        { type: 'title', titles: ['🔥 Chinh Phục Huyền Thoại', '⭐ Người Được Chọn', '💫 Bất Khả Chiến Bại'], chance: 0.1 },
    ]}
};

// POKEMON EVOLUTION MAP (id -> evolves_to, requires candy)
const EVOLUTION_MAP = {
    'bulbasaur': { to: 'ivysaur', candy: 10 },
    'ivysaur': { to: 'venusaur', candy: 25 },
    'charmander': { to: 'charmeleon', candy: 10 },
    'charmeleon': { to: 'charizard', candy: 25 },
    'squirtle': { to: 'wartortle', candy: 10 },
    'wartortle': { to: 'blastoise', candy: 25 },
    'caterpie': { to: 'metapod', candy: 5 },
    'metapod': { to: 'butterfree', candy: 15 },
    'weedle': { to: 'kakuna', candy: 5 },
    'kakuna': { to: 'beedrill', candy: 15 },
    'pidgey': { to: 'pidgeotto', candy: 10 },
    'pidgeotto': { to: 'pidgeot', candy: 25 },
    'rattata': { to: 'raticate', candy: 15 },
    'ekans': { to: 'arbok', candy: 15 },
    'pikachu': { to: 'raichu', candy: 20 },
    'sandshrew': { to: 'sandslash', candy: 15 },
    'nidoran-f': { to: 'nidorina', candy: 10 },
    'nidorina': { to: 'nidoqueen', candy: 25 },
    'nidoran-m': { to: 'nidorino', candy: 10 },
    'nidorino': { to: 'nidoking', candy: 25 },
    'clefairy': { to: 'clefable', candy: 20 },
    'vulpix': { to: 'ninetales', candy: 20 },
    'jigglypuff': { to: 'wigglytuff', candy: 20 },
    'zubat': { to: 'golbat', candy: 15 },
    'oddish': { to: 'gloom', candy: 10 },
    'gloom': { to: 'vileplume', candy: 25 },
    'paras': { to: 'parasect', candy: 15 },
    'venonat': { to: 'venomoth', candy: 15 },
    'diglett': { to: 'dugtrio', candy: 15 },
    'meowth': { to: 'persian', candy: 15 },
    'psyduck': { to: 'golduck', candy: 15 },
    'mankey': { to: 'primeape', candy: 15 },
    'growlithe': { to: 'arcanine', candy: 20 },
    'poliwag': { to: 'poliwhirl', candy: 10 },
    'poliwhirl': { to: 'poliwrath', candy: 25 },
    'abra': { to: 'kadabra', candy: 10 },
    'kadabra': { to: 'alakazam', candy: 25 },
    'machop': { to: 'machoke', candy: 10 },
    'machoke': { to: 'machamp', candy: 25 },
    'bellsprout': { to: 'weepinbell', candy: 10 },
    'weepinbell': { to: 'victreebel', candy: 25 },
    'tentacool': { to: 'tentacruel', candy: 15 },
    'geodude': { to: 'graveler', candy: 10 },
    'graveler': { to: 'golem', candy: 25 },
    'ponyta': { to: 'rapidash', candy: 15 },
    'slowpoke': { to: 'slowbro', candy: 15 },
    'magnemite': { to: 'magneton', candy: 15 },
    'doduo': { to: 'dodrio', candy: 15 },
    'seel': { to: 'dewgong', candy: 15 },
    'grimer': { to: 'muk', candy: 15 }
};

const CRAFTING_RECIPES = {
    'iron_sword': {
        name: 'Kiếm Sắt', type: 'weapon', emoji: '⚔️', atk: 15,
        req: { iron_ore: 25, wood_log: 10 }, coin: 10000
    },
    'steel_sword': {
        name: 'Kiếm Thép', type: 'weapon', emoji: '🤺', atk: 30,
        req: { iron_ore: 75, gold_ore: 10, magic_dust: 5 }, coin: 50000
    },
    'diamond_sword': {
        name: 'Kiếm Kim Cương', type: 'weapon', emoji: '💠', atk: 70,
        req: { iron_ore: 250, gold_ore: 100, magic_dust: 50, dragon_scale: 5 }, coin: 500000
    },
    'mythic_sword': {
        name: 'Kiếm Thần Thoại', type: 'weapon', emoji: '🔱', atk: 150,
        req: { iron_ore: 500, dragon_scale: 25, magic_dust: 100, demon_horn: 10, void_shard: 5 }, coin: 2000000
    },
    'iron_armor': {
        name: 'Giáp Sắt', type: 'armor', emoji: '🛡️', def: 15,
        req: { iron_ore: 40 }, coin: 15000
    },
    'steel_armor': {
        name: 'Giáp Thép', type: 'armor', emoji: '🦾', def: 30,
        req: { iron_ore: 100, gold_ore: 25 }, coin: 60000
    },
    'diamond_armor': {
        name: 'Giáp Kim Cương', type: 'armor', emoji: '💎', def: 70,
        req: { iron_ore: 300, gold_ore: 125, magic_dust: 75 }, coin: 600000
    },
    'mythic_armor': {
        name: 'Giáp Thần Thoại', type: 'armor', emoji: '🔰', def: 150,
        req: { iron_ore: 600, dragon_scale: 25, magic_dust: 125, demon_horn: 10, obsidian: 5 }, coin: 2500000
    },
    'ring_of_power': {
        name: 'Nhẫn Sức Mạnh', type: 'artifact', emoji: '💍',
        req: { gold_ore: 50, magic_dust: 50, fire_crystal: 10 }, coin: 100000
    },
    'amulet_of_defense': {
        name: 'Dây Chuyền Hộ Mệnh', type: 'artifact', emoji: '📿',
        req: { gold_ore: 50, magic_dust: 50, ice_gem: 10 }, coin: 100000
    },
    'gem_of_life': {
        name: 'Ngọc Sinh Lực', type: 'artifact', emoji: '💎',
        req: { gold_ore: 100, water_soul: 25, herb: 250 }, coin: 200000
    },
    'hero_badge': {
        name: 'Huy Hiệu Dũng Sĩ', type: 'artifact', emoji: '🎖️',
        req: { demon_horn: 5, dragon_scale: 10, void_shard: 5, obsidian: 5 }, coin: 1000000
    }
};

let PET_LIST = [];
try {
    PET_LIST = JSON.parse(fs.readFileSync('./pokemon.json', 'utf8'));
} catch (err) {
    console.error('Không thể load pokemon.json, dùng danh sách mặc định:', err);
    PET_LIST = [
        { id: 'bulbasaur', name: 'Bulbasaur', rarity: 'Thường', price: 5000, emoji: '🐸', weight: 50, imageUrl: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/1.png' }
    ];
}




function loadConfig() {
    if (!fs.existsSync(configPath)) return {};
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { return {}; }
}
function saveConfig(data) { fs.writeFileSync(configPath, JSON.stringify(data, null, 2)); }



const raidPath = './raid.json';
function loadRaid() {
    if (!fs.existsSync(raidPath)) return {};
    try { return JSON.parse(fs.readFileSync(raidPath, 'utf8')); } catch { return {}; }
}
function saveRaid(data) { fs.writeFileSync(raidPath, JSON.stringify(data, null, 2)); }


function loadRPG() {
    if (!fs.existsSync(rpgPath)) return {};
    try { return JSON.parse(fs.readFileSync(rpgPath, 'utf8')); } catch { return {}; }
}
function saveRPG(data) { fs.writeFileSync(rpgPath, JSON.stringify(data, null, 2)); }
function getRaidBoss() {
    const data = loadRaid();
    const now = Date.now();
    if (!data.boss || (data.boss.status === 'dead' && now - data.boss.deathTime > 12 * 60 * 60 * 1000)) {
        let maxHp = 5000000;
        let def = 100;
        let name = 'Hắc Long Vương';
        let emoji = '🐉';
        if (data.boss && data.boss.level) {
            maxHp = Math.floor(data.boss.maxHp * 1.5);
            def = Math.floor(data.boss.def * 1.2);
            name = 'Ma Thần Hư Không';
            emoji = '👿';
        }
        data.boss = {
            name, emoji, maxHp, hp: maxHp, level: data.boss ? data.boss.level + 10 : 50, def,
            participants: {}, status: 'alive'
        };
        saveRaid(data);
    }
    return data.boss;
}

function getPlayer(userId) {
    const data = loadRPG();
    if (!data[userId]) {
        data[userId] = {
            level: 1, exp: 0, 
            hp: 100, maxHp: 100,
            baseAtk: 10, baseDef: 5,
            weapon: null, armor: null, artifact: null,
            inventory: { small_potion: 0, large_potion: 0 },
            lastHunt: 0,
            lastGather: 0,
            lastCatch: 0,
            pets: {},
            partner: null,
            investAmount: 0,
            investTime: 0,
            messageCount: 0,
            voiceTime: 0,
            // RPG Expansion
            rpgClass: null,
            classChangedAt: 0,
            dailyQuests: [],
            questsLastReset: 0,
            dungeonClears: 0,
            lastDungeon: 0,
            chests: { wood: 0, iron: 0, gold: 0, legendary: 0 },
            pvpWins: 0,
            pvpLosses: 0,
            lastPvp: 0,
            titles: [],
            candy: 0
        };
        saveRPG(data);
    } else {
        let changed = false;
        if (data[userId].artifact === undefined) { data[userId].artifact = null; changed = true; }
        if (data[userId].lastGather === undefined) { data[userId].lastGather = 0; changed = true; }
        if (data[userId].farm === undefined) { data[userId].farm = { slots: 3, plants: {} }; changed = true; }
        if (!data[userId].pets) { data[userId].pets = {}; changed = true; }
        if (data[userId].lastCatch === undefined) { data[userId].lastCatch = 0; changed = true; }
        if (data[userId].partner === undefined) { data[userId].partner = null; changed = true; }
        if (data[userId].investAmount > 0) {
            const coinsData = loadCoins();
            if (!coinsData[userId]) coinsData[userId] = { coins: 0, bank: 0 };
            coinsData[userId].coins += data[userId].investAmount;
            saveCoins(coinsData);
            console.log(`Refunded ${data[userId].investAmount} investAmount to ${userId}`);
            changed = true;
        }
        if (data[userId].investAmount !== undefined) { delete data[userId].investAmount; changed = true; }
        if (data[userId].investTime !== undefined) { delete data[userId].investTime; changed = true; }
        if (data[userId].messageCount === undefined) { data[userId].messageCount = 0; changed = true; }
        if (data[userId].voiceTime === undefined) { data[userId].voiceTime = 0; changed = true; }
        // Migrate new RPG fields
        if (data[userId].rpgClass === undefined) { data[userId].rpgClass = null; changed = true; }
        if (data[userId].classChangedAt === undefined) { data[userId].classChangedAt = 0; changed = true; }
        if (data[userId].dailyQuests === undefined) { data[userId].dailyQuests = []; changed = true; }
        if (data[userId].questsLastReset === undefined) { data[userId].questsLastReset = 0; changed = true; }
        if (data[userId].dungeonClears === undefined) { data[userId].dungeonClears = 0; changed = true; }
        if (data[userId].lastDungeon === undefined) { data[userId].lastDungeon = 0; changed = true; }
        if (data[userId].chests === undefined) { data[userId].chests = { wood: 0, iron: 0, gold: 0, legendary: 0 }; changed = true; }
        if (data[userId].pvpWins === undefined) { data[userId].pvpWins = 0; changed = true; }
        if (data[userId].pvpLosses === undefined) { data[userId].pvpLosses = 0; changed = true; }
        if (data[userId].lastPvp === undefined) { data[userId].lastPvp = 0; changed = true; }
        if (data[userId].titles === undefined) { data[userId].titles = []; changed = true; }
        if (data[userId].candy === undefined) { data[userId].candy = 0; changed = true; }
        if (changed) saveRPG(data);
    }
    return data[userId];
}

function updatePlayer(userId, updater) {
    const data = loadRPG();
    if (!data[userId]) {
        getPlayer(userId);
        Object.assign(data, loadRPG());
    }
    updater(data[userId]);
    // Check level up (có thể lên nhiều cấp liên tiếp)
    let p = data[userId];
    let leveledUp = false;
    while (p.exp >= p.level * 100) {
        p.exp -= p.level * 100;
        p.level++;
        p.maxHp += 20;
        p.hp = p.maxHp;
        p.baseAtk += 3;
        p.baseDef += 2;
        leveledUp = true;
    }
    saveRPG(data);
    return data[userId];
}

function getPlayerStats(p) {
    let atk = p.baseAtk;
    let def = p.baseDef;
    let maxHp = p.maxHp;
    if (p.weapon && RPG_ITEMS.weapons[p.weapon]) atk += RPG_ITEMS.weapons[p.weapon].atk;
    if (p.armor && RPG_ITEMS.armors[p.armor]) def += RPG_ITEMS.armors[p.armor].def;
    
    let artifactAtkBonus = 0;
    let artifactDefBonus = 0;
    let artifactHpBonus = 0;
    
    if (p.artifact && RPG_ITEMS.artifacts[p.artifact]) {
        const art = RPG_ITEMS.artifacts[p.artifact];
        artifactAtkBonus += art.atkBonus || 0;
        artifactDefBonus += art.defBonus || 0;
        artifactHpBonus += art.hpBonus || 0;
    }

    // Class bonuses + Artifact bonuses
    let totalAtkBonus = artifactAtkBonus;
    let totalDefBonus = artifactDefBonus;
    let totalHpBonus = artifactHpBonus;

    if (p.rpgClass && RPG_CLASSES[p.rpgClass]) {
        const cls = RPG_CLASSES[p.rpgClass];
        totalAtkBonus += cls.atkBonus;
        totalDefBonus += cls.defBonus;
        totalHpBonus += cls.hpBonus;
    }
    
    // Ring bonuses (only if married and equipped ring)
    if (p.partner && p.equippedRing && MARRY_RINGS[p.equippedRing]) {
        const ring = MARRY_RINGS[p.equippedRing];
        atk += ring.atkBonus || 0;
        def += ring.defBonus || 0;
        maxHp += ring.hpBonus || 0;
    }

    atk = Math.floor(atk * (1 + totalAtkBonus));
    def = Math.floor(def * (1 + totalDefBonus));
    maxHp = Math.floor(maxHp * (1 + totalHpBonus));
    
    return { atk, def, maxHp };
}

// Quest progress tracking
function trackQuestProgress(userId, type, amount = 1) {
    const data = loadRPG();
    if (!data[userId] || !data[userId].dailyQuests) return;
    let changed = false;
    for (const q of data[userId].dailyQuests) {
        if (q.type === type && !q.claimed) {
            q.progress = (q.progress || 0) + amount;
            changed = true;
        }
    }
    if (changed) saveRPG(data);
}

// Generate daily quests
function generateDailyQuests(userId) {
    const p = getPlayer(userId);
    const now = Date.now();
    const today = new Date().setHours(0, 0, 0, 0);
    
    if (p.questsLastReset >= today && p.dailyQuests.length > 0) return p.dailyQuests;
    
    // Pick 3 random unique quests
    const shuffled = [...QUEST_TEMPLATES].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 3).map(q => ({
        ...q,
        progress: 0,
        claimed: false
    }));
    
    updatePlayer(userId, dp => {
        dp.dailyQuests = selected;
        dp.questsLastReset = now;
    });
    
    return selected;
}

function formatVoiceTime(seconds) {
    if (!seconds) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    let parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
}

async function buildProfileEmbed(user) {
    const uid = user.id;
    const pData = getPlayer(uid);
    
    let marryText = 'Đang độc thân 💔';
    let partnerAvatar = null;
    if (pData.partner) {
        marryText = `Đã kết hôn với <@${pData.partner}> 💍`;
        try {
            const partnerUser = await user.client.users.fetch(pData.partner).catch(()=>null);
            if (partnerUser) {
                partnerAvatar = partnerUser.displayAvatarURL({ dynamic: true, size: 512 });
            }
        } catch(e){}
    }

    let attachment = null;
    let bdayText = 'Chưa cài đặt';
    let isBirthday = false;

    let vTime = pData.voiceTime || 0;
    
    const session = typeof voiceJoinTimes !== 'undefined' ? voiceJoinTimes.get(uid) : null;
    if (session) {
        const joinTime = typeof session === 'number' ? session : session.time;
        const diffSecs = (Date.now() - joinTime) / 1000;
        vTime += diffSecs;
    }

    if (pData.birthday) {
        bdayText = `**${pData.birthday}**`;
        const today = new Date();
        const d = today.getDate().toString().padStart(2, '0');
        const m = (today.getMonth() + 1).toString().padStart(2, '0');
        if (`${d}/${m}` === pData.birthday) {
            isBirthday = true;
            try {
                const { AttachmentBuilder } = require('discord.js');
                attachment = new AttachmentBuilder('./birthday.png', { name: 'birthday.png' });
            } catch (e) {}
        }
    }

    const embed = new EmbedBuilder()
        .setTitle(isBirthday ? `🎉 CHÚC MỪNG SINH NHẬT ${user.username.toUpperCase()} 🎉` : `👤 Hồ Sơ: ${user.username}`)
        .setColor(isBirthday ? '#FF69B4' : '#9B59B6')
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 512 }))
        .addFields(
            { name: '🎤 Thời gian Voice', value: `**${formatVoiceTime(vTime)}**`, inline: true },
            { name: '🎂 Ngày sinh nhật', value: bdayText, inline: true },
            { name: '📅 Ngày tạo tài khoản', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
            { name: '💍 Hôn nhân', value: marryText, inline: false }
        )
        .setTimestamp();
        
    if (partnerAvatar) {
        embed.setImage(partnerAvatar);
    } else if (isBirthday && attachment) {
        embed.setImage('attachment://birthday.png');
    }

    return { embed, attachment };
}

// ========================
// RPG SHOP HANDLER
// ========================
function buildShopEmbed(tab) {
    if (tab === 'pet') {
        return new EmbedBuilder()
            .setTitle('🐾 Cửa Hàng Thú Cưng')
            .setDescription('Mua các loại bóng để ném và bắt thú cưng hoang dã!\n> 💰 Giá sẽ tự động trừ vào Coin của bạn!')
            .addFields(
                ...Object.entries(RPG_ITEMS.pokeballs).map(([k, p]) => ({
                    name: `${p.emoji} ${p.name}`,
                    value: `Giá: **${p.price.toLocaleString()} 🪙**\nTỉ lệ bắt: **${p.catchRate * 100}%**`,
                    inline: true
                }))
            )
            .setColor('#2ECC71')
            .setThumbnail('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png')
            .setFooter({ text: 'Chọn bóng từ menu bên dưới để mua' });
    }
    if (tab === 'ring') {
        return new EmbedBuilder()
            .setTitle('💍 Cửa Hàng Nhẫn Kết Hôn')
            .setDescription('Nhẫn dùng để **cầu hôn** khi dùng lệnh `/marry` hoặc `!marry`.\n> Nhẫn được lưu vào kho và dùng khi cầu hôn!')
            .addFields(
                ...Object.entries(MARRY_RINGS).map(([k, r]) => ({
                    name: `${r.emoji} ${r.name}`,
                    value: `Giá: **${r.price.toLocaleString()} 🪙**`,
                    inline: true
                }))
            )
            .setColor('#FF69B4')
            .setThumbnail('https://cdn-icons-png.flaticon.com/512/833/833472.png')
            .setFooter({ text: 'Chọn nhẫn từ menu bên dưới để mua' });
    }
    if (tab === 'tools') {
        return new EmbedBuilder()
            .setTitle('💻 Mạng Ngầm - Cửa Hàng Hacker')
            .setDescription('Mua công cụ để đi hack tiền người khác hoặc bảo vệ bản thân!\n> ⚠️ Gõ `!hack @user` để bắt đầu tấn công!')
            .addFields(
                ...Object.entries(RPG_ITEMS.tools).map(([k, p]) => ({
                    name: `${p.emoji} ${p.name}`,
                    value: `Giá: **${p.price.toLocaleString()} 🪙**`,
                    inline: true
                }))
            )
            .setColor('#000000')
            .setThumbnail('https://cdn-icons-png.flaticon.com/512/2906/2906274.png')
            .setFooter({ text: 'Chọn công cụ từ menu bên dưới để mua' });
    }
    if (tab === 'farm') {
        return new EmbedBuilder()
            .setTitle('🏡 Cửa Hàng Nông Trại')
            .setDescription('Mua hạt giống hoặc mở rộng thêm ô đất trồng cây!\n> 💰 Giá sẽ tự động trừ vào Coin của bạn!')
            .setColor('#F39C12')
            .setThumbnail('https://cdn-icons-png.flaticon.com/512/3063/3063822.png')
            .setFooter({ text: 'Chọn món đồ từ menu bên dưới để mua' });
    }
    return new EmbedBuilder()
        .setTitle('🛒 Cửa Hàng RPG')
        .setDescription('Vui lòng chọn danh mục và món đồ bạn muốn mua.\n\n> 💰 Giá sẽ tự động trừ vào Coin của bạn!')
        .setColor('#3498DB')
        .setFooter({ text: 'Chọn tab ở trên để xem danh mục khác' });
}

function buildShopCategoryRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('shop_tab_pet').setLabel('🐾 Bắt Pet').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('shop_tab_ring').setLabel('💍 Nhẫn Kết Hôn').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('shop_tab_farm').setLabel('🏡 Nông Trại').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('shop_tab_tools').setLabel('💻 Hacker').setStyle(ButtonStyle.Primary)
    );
}

function buildShopSelectRow(tab) {
    const options = [];
    if (tab === 'pet') {
        for (const [k, p] of Object.entries(RPG_ITEMS.pokeballs)) {
            options.push(new StringSelectMenuOptionBuilder()
                .setLabel(`${p.name} (Tỉ lệ: ${p.catchRate * 100}%)`)
                .setValue(`pokeball_${k}`)
                .setDescription(`Giá: ${p.price.toLocaleString()} 🪙`)
                .setEmoji(p.emoji));
        }
        return new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('rpg_shop_select').setPlaceholder('🔴 Chọn bóng muốn mua...').addOptions(options)
        );
    }
    if (tab === 'ring') {
        for (const [k, r] of Object.entries(MARRY_RINGS)) {
            options.push(new StringSelectMenuOptionBuilder()
                .setLabel(`${r.name}`)
                .setValue(`ring_${k}`)
                .setDescription(`Giá: ${r.price.toLocaleString()} 🪙 — Dùng để cầu hôn`)
                .setEmoji(r.emoji));
        }
        return new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('rpg_shop_select').setPlaceholder('💍 Chọn nhẫn muốn mua...').addOptions(options)
        );
    }
    if (tab === 'tools') {
        for (const [k, v] of Object.entries(RPG_ITEMS.tools)) {
            options.push(new StringSelectMenuOptionBuilder()
                .setLabel(`${v.name}`)
                .setValue(`tool_${k}`)
                .setDescription(`Giá: ${v.price.toLocaleString()} 🪙`)
                .setEmoji(v.emoji));
        }
        return new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('rpg_shop_select').setPlaceholder('💻 Chọn công cụ muốn mua...').addOptions(options)
        );
    }
    if (tab === 'farm') {
        for (const [k, v] of Object.entries(RPG_ITEMS.seeds)) {
            options.push(new StringSelectMenuOptionBuilder()
                .setLabel(`${v.name}`)
                .setValue(`seed_${k}`)
                .setDescription(`Giá: ${v.price.toLocaleString()} 🪙`)
                .setEmoji(v.emoji));
        }
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel(`Mở rộng đất`)
            .setValue(`farm_expand`)
            .setDescription(`Mở thêm 1 ô đất`)
            .setEmoji('🌍'));
        return new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('rpg_shop_select').setPlaceholder('🏡 Chọn món đồ muốn mua...').addOptions(options)
        );
    }
    // RPG tab
    for (const [k, v] of Object.entries(RPG_ITEMS.weapons)) {
        options.push(new StringSelectMenuOptionBuilder().setLabel(`Vũ khí: ${v.name} (+${v.atk} ATK)`).setValue(`weapon_${k}`).setDescription(`Giá: ${v.price.toLocaleString()} 🪙`).setEmoji(v.emoji));
    }
    for (const [k, v] of Object.entries(RPG_ITEMS.armors)) {
        options.push(new StringSelectMenuOptionBuilder().setLabel(`Giáp: ${v.name} (+${v.def} DEF)`).setValue(`armor_${k}`).setDescription(`Giá: ${v.price.toLocaleString()} 🪙`).setEmoji(v.emoji));
    }
    for (const [k, v] of Object.entries(RPG_ITEMS.potions)) {
        options.push(new StringSelectMenuOptionBuilder().setLabel(`Bình: ${v.name} (Hồi ${v.heal} HP)`).setValue(`potion_${k}`).setDescription(`Giá: ${v.price.toLocaleString()} 🪙`).setEmoji(v.emoji));
    }
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('rpg_shop_select').setPlaceholder('🛒 Chọn món đồ muốn mua...').addOptions(options)
    );
}

async function handleShop(userId, msgOrInteraction) {
    let currentTab = 'pet';

    const embed = buildShopEmbed(currentTab);
    const catRow = buildShopCategoryRow();
    const selectRow = buildShopSelectRow(currentTab);

    let msg;
    if (msgOrInteraction.isChatInputCommand && msgOrInteraction.isChatInputCommand()) {
        await msgOrInteraction.reply({ embeds: [embed], components: [catRow, selectRow] });
        msg = await msgOrInteraction.fetchReply();
    } else {
        msg = await msgOrInteraction.reply({ embeds: [embed], components: [catRow, selectRow] });
    }

    const collector = msg.createMessageComponentCollector({ time: 120000 });
    collector.on('collect', async i => {
        if (i.user.id !== userId) return i.reply({ content: '❌ Cửa hàng này không phải của bạn!', flags: MessageFlags.Ephemeral });

        // Tab buttons
        if (i.customId === 'shop_tab_ring' || i.customId === 'shop_tab_pet' || i.customId === 'shop_tab_farm' || i.customId === 'shop_tab_tools') {
            if (i.customId === 'shop_tab_ring') currentTab = 'ring';
            else if (i.customId === 'shop_tab_pet') currentTab = 'pet';
            else if (i.customId === 'shop_tab_farm') currentTab = 'farm';
            else if (i.customId === 'shop_tab_tools') currentTab = 'tools';
            else currentTab = 'pet';
            const newEmbed = buildShopEmbed(currentTab);
            const newCatRow = buildShopCategoryRow();
            const newSelectRow = buildShopSelectRow(currentTab);
            return i.update({ embeds: [newEmbed], components: [newCatRow, newSelectRow] });
        }

        // Select menu purchase
        if (i.customId === 'rpg_shop_select') {
            const val = i.values[0];
            
            if (val === 'farm_expand') {
                const p = getPlayer(userId);
                if (!p.farm) p.farm = { slots: 3, plants: {} };
                if (p.farm.slots >= 10) return i.reply({ content: `❌ Bạn đã mở rộng tối đa ô đất!`, flags: MessageFlags.Ephemeral });
                const expandCost = p.farm.slots * 10000;
                if (getUserCoins(userId) < expandCost) return i.reply({ content: `❌ Bạn cần **${expandCost.toLocaleString()} 🪙** để mở rộng!`, flags: MessageFlags.Ephemeral });
                addCoins(userId, -expandCost);
                updatePlayer(userId, dp => { if(!dp.farm) dp.farm = { slots: 3, plants: {} }; dp.farm.slots += 1; });
                return i.reply({ content: `✅ Đã mở rộng Nông trại lên **${p.farm.slots + 1}** ô đất! (Trừ ${expandCost.toLocaleString()} 🪙)`, flags: MessageFlags.Ephemeral });
            }

            const firstUnderscore = val.indexOf('_');
            const type = val.substring(0, firstUnderscore);
            const itemCode = val.substring(firstUnderscore + 1);

            if (type === 'weapon' || type === 'armor' || type === 'ring') {
                let item;
                if (type === 'weapon') item = RPG_ITEMS.weapons[itemCode];
                else if (type === 'armor') item = RPG_ITEMS.armors[itemCode];
                else if (type === 'ring') item = MARRY_RINGS[itemCode];

                if (!item) return i.reply({ content: '❌ Mã món đồ không tồn tại!', flags: MessageFlags.Ephemeral });
                if (getUserCoins(userId) < item.price) return i.reply({ content: `❌ Bạn không đủ Coin! (Cần ${item.price.toLocaleString()} 🪙)`, flags: MessageFlags.Ephemeral });

                addCoins(userId, -item.price);
                updatePlayer(userId, p => {
                    p.inventory[itemCode] = (p.inventory[itemCode] || 0) + 1;
                    if (type === 'weapon') p.weapon = itemCode;
                    else if (type === 'armor') p.armor = itemCode;
                    else if (type === 'ring') {
                        if (!p.rings) p.rings = {};
                        p.rings[itemCode] = (p.rings[itemCode] || 0) + 1;
                    }
                });

                let msgContent = `✅ Bạn đã mua **${item.emoji} ${item.name}** thành công! Số dư: **${getUserCoins(userId).toLocaleString()} 🪙**`;
                if (type === 'ring') msgContent += `\n> Dùng lệnh \`/marry\` để cầu hôn với nhẫn này!`;
                trackQuestProgress(userId, 'buy', 1);

                return i.reply({ content: msgContent, flags: MessageFlags.Ephemeral });
            } else {
                // Hiển thị modal nhập số lượng cho potion, pokeball
                const modal = new ModalBuilder()
                    .setCustomId(`shop_buy_modal_${type}_${itemCode}`)
                    .setTitle('Nhập số lượng muốn mua');
                
                const amountInput = new TextInputBuilder()
                    .setCustomId('buy_amount_input')
                    .setLabel('Số lượng (Ví dụ: 10)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Nhập số nguyên dương lớn hơn 0...')
                    .setRequired(true);
                
                const row = new ActionRowBuilder().addComponents(amountInput);
                modal.addComponents(row);
                
                return i.showModal(modal);
            }
        }
    });
    collector.on('end', () => {
        if (msgOrInteraction.editReply) msgOrInteraction.editReply({ components: [] }).catch(() => {});
        else if (msg.edit) msg.edit({ components: [] }).catch(() => {});
    });
}

// ========================
// WILD PET SPAWN SYSTEM
// ========================
const activeChannels = new Map(); // guildId -> channelId
const activeSpawns = new Map();   // msgId -> { guildId, channelId, petId, active, expireTimeout }

function startWildPetSpawns(client) {
    const delay = Math.floor(Math.random() * (120 - 60 + 1) + 60) * 60 * 1000;
    setTimeout(() => spawnWildPet(client), delay);
}

async function spawnWildPet(client, manual = false) {
    if (!manual) startWildPetSpawns(client);
    
    const config = loadConfig();
    let targets = [];
    if (config.spawnChannelId) {
        targets.push({ guildId: null, channelId: config.spawnChannelId, roleId: config.pokemonRoleId });
    }
    if (config.guilds) {
        for (const [gId, guildConf] of Object.entries(config.guilds)) {
            if (guildConf.spawnChannelId) {
                targets.push({ guildId: gId, channelId: guildConf.spawnChannelId, roleId: guildConf.pokemonRoleId });
            }
        }
    }
    targets = targets.filter((v, i, a) => a.findIndex(t => (t.channelId === v.channelId)) === i);
    
    if (targets.length === 0) {
        for (const [guildId, channelId] of activeChannels.entries()) {
            const guildConf = config.guilds?.[guildId] || {};
            targets.push({ guildId, channelId, roleId: guildConf.pokemonRoleId || config.pokemonRoleId });
        }
    }
    
    for (const target of targets) {
        try {
            const channel = client.channels.cache.get(target.channelId);
            if (!channel) continue;
            
            // Lấy từ toàn bộ pool dựa trên tỷ lệ weight
            const totalWeight = PET_LIST.reduce((sum, pet) => sum + pet.weight, 0);
            let rand = Math.random() * totalWeight;
            let spawnPet = null;
            for (const pet of PET_LIST) {
                if (rand < pet.weight) { spawnPet = pet; break; }
                rand -= pet.weight;
            }
            if (!spawnPet) spawnPet = PET_LIST[Math.floor(Math.random() * PET_LIST.length)];
            
            let color = '#FFFFFF';
            if (spawnPet.rarity === 'Thường') color = '#AAB7B8';
            if (spawnPet.rarity === 'Hiếm') color = '#3498DB';
            if (spawnPet.rarity === 'Cực Hiếm') color = '#9B59B6';
            if (spawnPet.rarity === 'Thần Thoại') color = '#E74C3C';
            if (spawnPet.rarity === 'Huyền Thoại') color = '#F1C40F';
            if (spawnPet.rarity === 'Hệ Thống (Developer)') color = '#00FFFF';
            
            const isLegendary = ['Huyền Thoại', 'Hệ Thống (Developer)'].includes(spawnPet.rarity);
            const embedTitle = spawnPet.rarity === 'Hệ Thống (Developer)'
                ? '🌟 ĐẤNG SÁNG TẠO GIÁNG TRẦN!!!'
                : spawnPet.rarity === 'Huyền Thoại'
                ? '🔥 POKEMON HUYỀN THOẠI XUẤT HIỆN!!!'
                : spawnPet.rarity === 'Cực Hiếm' || spawnPet.rarity === 'Thần Thoại'
                ? '✨ POKEMON HIẾM XUẤT HIỆN!'
                : '🐾 POKEMON HOANG DÃ XUẤT HIỆN!';
            const embedDesc = isLegendary
                ? `⚠️ **CẢNH BÁO KHẨN CẤP!** ⚠️\nMột Pokemon **${spawnPet.rarity}** cực kỳ hiếm vừa xuất hiện!\nĐộ hiếm: **${spawnPet.rarity}** ✨\n\nĐây là cơ hội ngàn năm có một — Hãy bắt ngay trước khi nó biến mất!`
                : `Một Pokemon hoang dã vừa xuất hiện ở khu vực này!\nĐộ hiếm: **${spawnPet.rarity}**\n\nHãy mau lấy bóng ra bắt nó trước khi nó chạy mất!`;
            const embed = new EmbedBuilder()
                .setTitle(embedTitle)
                .setDescription(embedDesc)
                .setColor(color)
                .setImage(spawnPet.imageUrl);
                
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`wild_catch_${spawnPet.id}`).setLabel('Ném Bóng').setStyle(ButtonStyle.Success).setEmoji('🎯')
            );
            
            let msgContent = undefined;
            if (target.roleId) msgContent = `<@&${target.roleId}>`;
            const msg = await channel.send({ content: msgContent, embeds: [embed], components: [row] });
            activeSpawns.set(msg.id, { guildId: target.guildId || channel.guild.id, channelId: target.channelId, petId: spawnPet.id, active: true, expireTimeout: setTimeout(() => expireSpawn(msg), 1 * 60 * 1000) });
        } catch (e) {
            console.error('Lỗi spawn pet:', e);
        }
    }
}

async function expireSpawn(msg) {
    const spawnData = activeSpawns.get(msg.id);
    if (!spawnData || !spawnData.active) return;
    spawnData.active = false;
    activeSpawns.delete(msg.id);
    const oldEmbed = msg.embeds[0];
    const newEmbed = EmbedBuilder.from(oldEmbed)
        .setDescription('💨 Pokemon đã hoảng sợ và chạy mất vào rừng sâu!')
        .setImage(null)
        .setColor('#888888');
    await msg.edit({ components: [], embeds: [newEmbed] }).catch(()=>{});
}

// ========================
// PET SYSTEM
// ========================

const CATCH_COST = 20000;
const CATCH_COOLDOWN = 1 * 60 * 1000; // 1 minute

async function handleCatchPet(userId, msgOrInteraction) {
    const p = getPlayer(userId);
    const now = Date.now();
    
    const cData = loadCoins();
    const isCheatOn = cData[userId]?.alwaysWin === true;

    // cooldown removed
    
    const ballTypes = ['basic_ball', 'great_ball', 'ultra_ball', 'master_ball'];
    let usedBall = null;
    for (const b of ballTypes) {
        if (p.inventory && p.inventory[b] > 0) {
            usedBall = b;
            break;
        }
    }

    if (!usedBall) {
        const msg = `❌ Bạn không có bất kỳ quả **Bóng Bắt Pet** nào! Hãy vào \`/shop\` (Tab Bắt Pet) để mua!`;
        return msgOrInteraction.reply ? msgOrInteraction.reply({ content: msg, flags: MessageFlags.Ephemeral }) : msgOrInteraction.channel.send(msg);
    }
    
    // Deduct ball
    updatePlayer(userId, dp => {
        dp.inventory[usedBall]--;
    });
    
    // Gacha logic
    let allowedRarities = [];
    if (usedBall === 'basic_ball') allowedRarities = ['Thường', 'Hiếm'];
    else if (usedBall === 'great_ball') allowedRarities = ['Thường', 'Hiếm', 'Cực Hiếm'];
    else if (usedBall === 'ultra_ball') allowedRarities = ['Hiếm', 'Cực Hiếm', 'Thần Thoại'];
    else if (usedBall === 'master_ball') allowedRarities = ['Cực Hiếm', 'Thần Thoại', 'Huyền Thoại'];

    const AVAILABLE_PETS = PET_LIST.filter(p => allowedRarities.includes(p.rarity));
    const totalWeight = AVAILABLE_PETS.reduce((sum, pet) => sum + pet.weight, 0);
    let rand = Math.random() * totalWeight;
    let caughtPet = null;
    
    for (const pet of AVAILABLE_PETS) {
        if (rand < pet.weight) {
            caughtPet = pet;
            break;
        }
        rand -= pet.weight;
    }
    
    updatePlayer(userId, dp => {
        dp.lastCatch = now;
        dp.pets[caughtPet.id] = (dp.pets[caughtPet.id] || 0) + 1;
    });
    trackQuestProgress(userId, 'catch', 1);
    
    let color = '#FFFFFF';
    if (caughtPet.rarity === 'Thường') color = '#AAB7B8';
    if (caughtPet.rarity === 'Hiếm') color = '#3498DB';
    if (caughtPet.rarity === 'Cực Hiếm') color = '#9B59B6';
    if (caughtPet.rarity === 'Thần Thoại') color = '#E74C3C';
    if (caughtPet.rarity === 'Huyền Thoại') color = '#F1C40F';
    
    const ballObj = RPG_ITEMS.pokeballs[usedBall];
    const userAvatar = msgOrInteraction.user ? msgOrInteraction.user.displayAvatarURL() : msgOrInteraction.author.displayAvatarURL();
    const embed = new EmbedBuilder()
        .setTitle('✨ THU PHỤC THÀNH CÔNG! ✨')
        .setDescription(`Một tia sáng lóe lên... Bạn đã ném **${ballObj.emoji} ${ballObj.name}** và bắt trúng một **${caughtPet.emoji} ${caughtPet.name}** hoang dã!`)
        .addFields(
            { name: '🌟 Độ Hiếm', value: `**${caughtPet.rarity}**`, inline: true },
            { name: '💰 Giá Trị Định Giá', value: `**${caughtPet.price.toLocaleString()} 🪙**`, inline: true },
            { name: '🎒 Chuồng Thú', value: `Xem bằng lệnh \`/pets\``, inline: true }
        )
        .setColor(color)
        .setImage(caughtPet.imageUrl)
        .setThumbnail(userAvatar)
        .setFooter({ text: 'Hệ thống Pokemon • Pokemon Hunter' })
        .setTimestamp();
        
    return msgOrInteraction.reply ? msgOrInteraction.reply({ embeds: [embed] }) : msgOrInteraction.channel.send({ embeds: [embed] });
}

async function handlePets(userId, msgOrInteraction) {
    const p = getPlayer(userId);
    const pets = p.pets || {};
    
    const ownedPets = [];
    for (const pet of PET_LIST) {
        const amount = pets[pet.id] || 0;
        if (amount > 0) {
            ownedPets.push({ pet, amount });
        }
    }
    
    if (ownedPets.length === 0) {
        const emptyEmbed = new EmbedBuilder()
            .setTitle('🏕️ Chuồng Thú Cưng')
            .setColor('#2ECC71')
            .setDescription('Chuồng thú của bạn đang trống trơn! Hãy dùng lệnh `/catchpet` hoặc ném bóng vào pokemon hoang dã để bắt thêm.');
        return msgOrInteraction.reply ? msgOrInteraction.reply({ embeds: [emptyEmbed] }) : msgOrInteraction.channel.send({ embeds: [emptyEmbed] });
    }

    // Sort by price (strength) descending
    ownedPets.sort((a, b) => (b.pet.price || 0) - (a.pet.price || 0));
    
    const strongest = ownedPets[0];
    
    const embed = new EmbedBuilder()
        .setTitle(`🏕️ Chuồng Thú Cưng của bạn`)
        .setColor('#F1C40F')
        .addFields({ name: '👑 Thú Cưng Mạnh Nhất', value: `${strongest.pet.emoji} **${strongest.pet.name}**\nĐộ hiếm: **${strongest.pet.rarity}** | Sức mạnh: **${(strongest.pet.price||0).toLocaleString()}**\n*(Sở hữu: ${strongest.amount} con)*`, inline: false });
        
    if (strongest.pet.imageUrl) {
        embed.setImage(strongest.pet.imageUrl);
    }
    
    let totalPetsCount = 0;
    for (const op of ownedPets) {
        totalPetsCount += op.amount;
    }
    
    embed.addFields({ name: '📊 Tổng Quan Thú Cưng', value: `Bạn đang sở hữu **${totalPetsCount}** thú cưng thuộc **${ownedPets.length}** loài khác nhau.`, inline: false });

    return msgOrInteraction.reply ? msgOrInteraction.reply({ embeds: [embed] }) : msgOrInteraction.channel.send({ embeds: [embed] });
}


async function handleSellPet(userId, msgOrInteraction) {
    const p = getPlayer(userId);
    const pets = p.pets || {};
    
    let ownedPets = [];
    for (const pet of PET_LIST) {
        const amount = pets[pet.id] || 0;
        if (amount > 0) {
            ownedPets.push({ pet, amount });
        }
    }
    
    if (ownedPets.length === 0) {
        const msg = '❌ Bạn không có con thú nào để bán cả!';
        return msgOrInteraction.reply ? msgOrInteraction.reply({ content: msg, flags: MessageFlags.Ephemeral }) : msgOrInteraction.channel.send(msg);
    }

    ownedPets.sort((a, b) => a.pet.price - b.pet.price);
    
    const options = ownedPets.slice(0, 23).map(p => 
        new StringSelectMenuOptionBuilder()
            .setLabel(`Bán 1 ${p.pet.name} (Có: ${p.amount})`)
            .setValue(`sellpet_${p.pet.id}`)
            .setDescription(`Giá: ${p.pet.price.toLocaleString()} 🪙`)
            .setEmoji(p.pet.emoji)
    );
    
    options.push(new StringSelectMenuOptionBuilder()
        .setLabel(`Bán Tất Cả (Giữ con mạnh nhất)`)
        .setValue(`sellpet_all_keep_best`)
        .setDescription(`Bán hết, chỉ chừa lại 1 con đắt nhất`)
        .setEmoji('💎'));
        
    options.push(new StringSelectMenuOptionBuilder()
        .setLabel(`Bán Tất Cả Thú Cưng`)
        .setValue(`sellpet_all`)
        .setDescription(`Bán sạch rương để lấy tiền`)
        .setEmoji('💰'));
        
    const embed = new EmbedBuilder()
        .setTitle('🏪 Thương Nhân Mua Thú')
        .setDescription('Hãy chọn loại thú cưng bạn muốn bán từ Menu bên dưới.')
        .setColor('#E67E22');
        
    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`sellpet_select_${userId}`).setPlaceholder('💰 Chọn thú cưng để bán...').addOptions(options)
    );
    
    let msg;
    if (msgOrInteraction.reply && typeof msgOrInteraction.reply === 'function') {
        if (msgOrInteraction.isCommand && msgOrInteraction.isCommand()) {
            await msgOrInteraction.reply({ embeds: [embed], components: [row] });
            msg = await msgOrInteraction.fetchReply();
        } else {
            msg = await msgOrInteraction.reply({ embeds: [embed], components: [row] });
        }
    } else {
        msg = await msgOrInteraction.channel.send({ embeds: [embed], components: [row] });
    }

    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });
    collector.on('collect', async i => {
        if (i.user.id !== userId) return i.reply({ content: '❌ Cửa hàng thú này không phải của bạn!', flags: MessageFlags.Ephemeral });
        
        const val = i.values[0].replace('sellpet_', '');
        
        let sellCoin = 0;
        let soldMsg = '';
        
        updatePlayer(userId, dp => {
            if (val === 'all') {
                for (const pet of PET_LIST) {
                    if (dp.pets[pet.id]) {
                        sellCoin += dp.pets[pet.id] * pet.price;
                        dp.pets[pet.id] = 0;
                    }
                }
                soldMsg = `✅ Bạn đã bán **tất cả** thú cưng và nhận được **${sellCoin.toLocaleString()} 🪙**!`;
            } else if (val === 'all_keep_best') {
                let bestPetId = null;
                let maxPrice = -1;
                for (const pet of PET_LIST) {
                    if (dp.pets[pet.id] > 0 && pet.price > maxPrice) {
                        maxPrice = pet.price;
                        bestPetId = pet.id;
                    }
                }
                if (!bestPetId) {
                    soldMsg = `❌ Bạn không có thú cưng nào!`;
                } else {
                    for (const pet of PET_LIST) {
                        if (dp.pets[pet.id]) {
                            const keepAmount = (pet.id === bestPetId) ? 1 : 0;
                            const sellAmount = dp.pets[pet.id] - keepAmount;
                            if (sellAmount > 0) {
                                sellCoin += sellAmount * pet.price;
                                dp.pets[pet.id] -= sellAmount;
                            }
                        }
                    }
                    const bestPetConfig = PET_LIST.find(p => p.id === bestPetId);
                    soldMsg = `✅ Đã bán hết thú cưng, giữ lại 1 **${bestPetConfig.emoji} ${bestPetConfig.name}**. Nhận được **${sellCoin.toLocaleString()} 🪙**!`;
                }
            } else {
                const petConfig = PET_LIST.find(p => p.id === val);
                if (dp.pets[val] > 0) {
                    sellCoin += petConfig.price;
                    dp.pets[val]--;
                    soldMsg = `✅ Bạn đã bán 1 **${petConfig.emoji} ${petConfig.name}** và nhận được **${sellCoin.toLocaleString()} 🪙**!`;
                } else {
                    soldMsg = `❌ Bạn không còn **${petConfig.name}** để bán nữa!`;
                }
            }
        });
        
        if (sellCoin > 0) addCoins(userId, sellCoin);
        
        return i.reply({ content: soldMsg, flags: MessageFlags.Ephemeral });
    });
    
    collector.on('end', () => {
        if (msgOrInteraction.editReply) msgOrInteraction.editReply({ components: [] }).catch(() => {});
        else if (msg.edit) msg.edit({ components: [] }).catch(() => {});
    });
}

async function handlePetTrade(userId, targetId, msgOrInteraction) {
    if (userId === targetId) return replyMsg(msgOrInteraction, '❌ Bạn không thể tự giao dịch với chính mình!');
    if (!targetId || targetId === msgOrInteraction.client?.user?.id) return replyMsg(msgOrInteraction, '❌ Đối tác không hợp lệ!');
    
    const p1 = getPlayer(userId);
    const pets1 = p1.pets || {};
    
    const options = [];
    for (const pet of PET_LIST) {
        const amount = pets1[pet.id] || 0;
        if (amount > 0) {
            options.push(new StringSelectMenuOptionBuilder()
                .setLabel(`Chọn ${pet.name}`)
                .setValue(`ptradeA_${pet.id}`)
                .setDescription(`Độ hiếm: ${pet.rarity} - Có: ${amount} con`)
                .setEmoji(pet.emoji));
        }
    }
    
    if (options.length === 0) {
        return replyMsg(msgOrInteraction, '❌ Bạn không có con thú nào để giao dịch cả!');
    }
    
    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`ptrade_offerA_${userId}_${targetId}`)
            .setPlaceholder('🐾 Chọn thú cưng bạn muốn đem đổi...')
            .addOptions(options.slice(0, 25))
    );
    
    return replyMsg(msgOrInteraction, { content: `<@${userId}> muốn giao dịch với <@${targetId}>! Hãy chọn thú cưng bạn đưa ra trước:`, components: [row] });
}

async function handlePetBattle(userId, targetId, bet, msgOrInteraction) {
    if (userId === targetId) return replyMsg(msgOrInteraction, '❌ Bạn không thể tự solo với chính mình!');
    if (!targetId || targetId === msgOrInteraction.client?.user?.id) return replyMsg(msgOrInteraction, '❌ Đối thủ không hợp lệ!');
    
    // Check bet
    const p1Coins = getUserCoins(userId);
    if (p1Coins < bet) return replyMsg(msgOrInteraction, `❌ Bạn không đủ **${bet.toLocaleString()} 🪙** để cược!`);
    const p2Coins = getUserCoins(targetId);
    if (p2Coins < bet) return replyMsg(msgOrInteraction, `❌ Đối thủ không đủ **${bet.toLocaleString()} 🪙** để cược!`);
    
    // Check pets
    const p1 = getPlayer(userId);
    const p2 = getPlayer(targetId);
    
    let p1Best = null, p1MaxPrice = -1;
    for (const pet of PET_LIST) {
        if (p1.pets && p1.pets[pet.id] > 0 && pet.price > p1MaxPrice) {
            p1MaxPrice = pet.price;
            p1Best = pet;
        }
    }
    
    let p2Best = null, p2MaxPrice = -1;
    for (const pet of PET_LIST) {
        if (p2.pets && p2.pets[pet.id] > 0 && pet.price > p2MaxPrice) {
            p2MaxPrice = pet.price;
            p2Best = pet;
        }
    }
    
    if (!p1Best) return replyMsg(msgOrInteraction, `❌ Bạn chưa có con thú cưng nào để mang đi solo! (Hãy đi bắt 1 con bằng lệnh \`/catchpet\`)`);
    if (!p2Best) return replyMsg(msgOrInteraction, `❌ Đối thủ chưa có thú cưng nào, không thể solo!`);
    
    const embed = new EmbedBuilder()
        .setTitle('⚔️ THÁCH ĐẤU THÚ CƯNG ⚔️')
        .setDescription(`<@${userId}> đang thách đấu <@${targetId}> một trận Pet Battle!\n\n💰 **Mức cược:** ${bet.toLocaleString()} 🪙\n\n**Đội hình dự kiến:**\n<@${userId}>: ${p1Best.emoji} **${p1Best.name}** (Sức mạnh: ${p1Best.price})\n<@${targetId}>: ${p2Best.emoji} **${p2Best.name}** (Sức mạnh: ${p2Best.price})`)
        .setColor('#E74C3C');
        
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pb_accept_${userId}_${targetId}_${bet}`).setLabel('Đồng ý Solo').setStyle(ButtonStyle.Success).setEmoji('⚔️'),
        new ButtonBuilder().setCustomId(`pb_decline_${userId}_${targetId}`).setLabel('Từ chối').setStyle(ButtonStyle.Danger)
    );
    
    return replyMsg(msgOrInteraction, { content: `<@${targetId}>, bạn có lời thách đấu!`, embeds: [embed], components: [row] });
}


async function handleTrivia(userId, msgOrInteraction, isNextRound = false) {
    const questionData = TRIVIA_LIST[Math.floor(Math.random() * TRIVIA_LIST.length)];
    const gameId = Date.now().toString();
    
    const embed = new EmbedBuilder()
        .setTitle('🧠 Đố Vui Tập Thể!')
        .setDescription(`**Câu hỏi:** ${questionData.question}\n\nMọi người có **1 phút 15 giây** để chọn đáp án đúng! Phần thưởng: **${questionData.reward} ĐT**`)
        .setColor('#9B59B6');
        
    const labels = ['A', 'B', 'C', 'D'];
    const buttons = questionData.answers.map((ans, index) => {
        return new ButtonBuilder()
            .setCustomId(`trivia_${index}_${gameId}`)
            .setLabel(`${labels[index]}. ${ans}`)
            .setStyle(ButtonStyle.Primary);
    });
    
    const row = new ActionRowBuilder().addComponents(buttons);
    
    let msg;
    if (!isNextRound && msgOrInteraction.reply && typeof msgOrInteraction.reply === 'function') {
        if (msgOrInteraction.isCommand && msgOrInteraction.isCommand()) {
            await msgOrInteraction.reply({ embeds: [embed], components: [row] });
            msg = await msgOrInteraction.fetchReply();
        } else {
            msg = await msgOrInteraction.reply({ embeds: [embed], components: [row] });
        }
    } else {
        const channel = msgOrInteraction.channel || msgOrInteraction;
        msg = await channel.send({ embeds: [embed], components: [row] });
    }
    
    const filter = i => i.customId.startsWith('trivia_') && i.customId.includes(gameId);
    const collector = msg.createMessageComponentCollector({ filter, time: 75000 });
    
    const answeredUsers = new Map();
    
    collector.on('collect', async i => {
        if (answeredUsers.has(i.user.id)) {
            return i.reply({ content: '❌ Bạn đã chọn đáp án rồi, không thể đổi lại!', flags: MessageFlags.Ephemeral });
        }
        
        const parts = i.customId.split('_');
        const selectedIndex = parseInt(parts[1]);
        
        answeredUsers.set(i.user.id, selectedIndex);
        await i.reply({ content: `✅ Bạn đã khóa đáp án **${labels[selectedIndex]}**! Hãy chờ hết giờ để xem kết quả.`, flags: MessageFlags.Ephemeral });
    });
    
    collector.on('end', () => {
        const disabledRow = new ActionRowBuilder().addComponents(
            buttons.map((b, idx) => {
                const btn = ButtonBuilder.from(b).setDisabled(true);
                if (idx === questionData.correctIndex) btn.setStyle(ButtonStyle.Success);
                return btn;
            })
        );
        
        const winners = [];
        
        answeredUsers.forEach((selectedIndex, uId) => {
            if (selectedIndex === questionData.correctIndex) {
                winners.push(`<@${uId}>`);
                updatePlayer(uId, p => {
                    p.coins += questionData.reward;
                });
            }
        });
        
        let resultMsg = `**Câu hỏi:** ${questionData.question}\n\n⏰ **HẾT GIỜ!** Đáp án đúng là **${labels[questionData.correctIndex]}**.\n\n`;
        
        if (winners.length > 0) {
            embed.setColor('#2ECC71');
            resultMsg += `🎉 **Chúc mừng những người trả lời đúng nhận được ${questionData.reward} ĐT:**\n${winners.join(', ')}`;
        } else {
            embed.setColor('#E74C3C');
            if (answeredUsers.size === 0) {
                resultMsg += `😢 Không có ai tham gia trả lời.`;
            } else {
                resultMsg += `😢 Rất tiếc, không có ai trả lời đúng!`;
            }
        }
        
        embed.setDescription(resultMsg);
        
        if (msgOrInteraction.editReply && !isNextRound) msgOrInteraction.editReply({ embeds: [embed], components: [disabledRow] }).catch(()=>{});
        else if (msg.edit) msg.edit({ embeds: [embed], components: [disabledRow] }).catch(()=>{});

        // Tự động ra câu tiếp theo nếu có người chơi
        if (answeredUsers.size > 0) {
            setTimeout(() => {
                handleTrivia(userId, msgOrInteraction, true);
            }, 3000);
        } else {
            const channel = msgOrInteraction.channel || msgOrInteraction;
            channel.send('🛑 Đố vui đã dừng lại vì không có ai tham gia trả lời. Dùng lệnh đố vui để chơi tiếp nhé!');
        }
    });
}

function replyMsg(interaction, options) {
    if (typeof options === 'string') options = { content: options };
    if (interaction.reply && typeof interaction.reply === 'function') {
        if (interaction.deferred) return interaction.editReply(options);
        return interaction.reply(options);
    }
    return interaction.channel.send(options);
}

async function awaitConfirmation(msgOrInteraction, userId, promptText, onConfirm) {
    const confirmId = `confirm_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
    const declineId = `decline_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel('Đồng ý').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId(declineId).setLabel('Hủy bỏ').setStyle(ButtonStyle.Danger).setEmoji('❌')
    );

    let confirmMsg;
    if (msgOrInteraction.commandName) {
        confirmMsg = await msgOrInteraction.reply({ content: `⚠️ **XÁC NHẬN:** ${promptText}`, components: [row], withResponse: true });
    } else {
        confirmMsg = await msgOrInteraction.reply({ content: `⚠️ **XÁC NHẬN:** ${promptText}`, components: [row] });
    }

    const filter = i => {
        if (i.user.id !== userId) {
            i.reply({ content: '❌ Bạn không có quyền bấm nút này!', flags: MessageFlags.Ephemeral }).catch(()=>{});
            return false;
        }
        return i.customId === confirmId || i.customId === declineId;
    };
    
    try {
        const i = await confirmMsg.awaitMessageComponent({ filter, time: 15000 });
        if (i.customId === confirmId) {
            await i.deferUpdate();
            const successText = await onConfirm();
            await i.editReply({ content: successText, components: [] });
        } else {
            await i.update({ content: '❌ Giao dịch đã bị hủy.', components: [] });
        }
    } catch (e) {
        if (msgOrInteraction.commandName) {
            await msgOrInteraction.editReply({ content: '⏳ Giao dịch đã hết hạn xác nhận.', components: [] }).catch(()=>{});
        } else {
            await confirmMsg.edit({ content: '⏳ Giao dịch đã hết hạn xác nhận.', components: [] }).catch(()=>{});
        }
    }
}
// ========================
// RPG EXPANSION HANDLERS
// ========================





// --- FARMING SYSTEM ---


// --- DUNGEON SYSTEM ---
async function handleDungeon(userId, msgOrInteraction) {
    const p = getPlayer(userId);
    if (p.hp <= 0) return replyMsg(msgOrInteraction, '❌ Bạn đã hết máu! Dùng `/heal` trước.');

    const now = Date.now();
    if (now - p.lastDungeon < 30 * 60 * 1000) {
        const mins = Math.ceil((30 * 60 * 1000 - (now - p.lastDungeon)) / 60000);
        return replyMsg(msgOrInteraction, `⏳ Dungeon đang hồi phục! Quay lại sau **${mins} phút**.`);
    }

    // Build dungeon selection
    const options = DUNGEONS.map(d => {
        const emoji = d.name.match(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+/u)?.[0] || '🏰';
        return new StringSelectMenuOptionBuilder()
            .setLabel(d.name.replace(/[^\w\sÀ-ỹ]/g, '').trim())
            .setValue(d.id)
            .setDescription(`Cấp tối thiểu: Lv.${d.minLevel} | Thưởng: ${d.rewards.coin.toLocaleString()} 🪙`)
            .setEmoji(emoji);
    });

    const embed = new EmbedBuilder()
        .setTitle('🏰 CHỌN DUNGEON')
        .setDescription(`**${p.level >= 50 ? '🌠' : p.level >= 40 ? '⛰️' : p.level >= 30 ? '🌀' : p.level >= 20 ? '🌑' : p.level >= 15 ? '❄️' : p.level >= 10 ? '🔥' : p.level >= 5 ? '🗼' : '🏚️'} Cấp độ của bạn: Lv.${p.level}**\n\n` +
            DUNGEONS.map(d => {
                const locked = p.level < d.minLevel;
                return `${locked ? '🔒' : '✅'} **${d.name}** (Lv.${d.minLevel}+)\n> Thưởng: ${d.rewards.coin.toLocaleString()} 🪙 + ${d.rewards.exp} EXP\n> Boss: ${d.boss.emoji} ${d.boss.name}`;
            }).join('\n\n'))
        .setColor('#E67E22')
        .setFooter({ text: 'Cooldown: 30 phút | Mỗi dungeon có 5 tầng + 1 Boss' });

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`dungeon_select_${userId}`).setPlaceholder('🏰 Chọn Dungeon...').addOptions(options)
    );

    let msg;
    if (msgOrInteraction.isChatInputCommand?.()) {
        await msgOrInteraction.reply({ embeds: [embed], components: [row] });
        msg = await msgOrInteraction.fetchReply();
    } else {
        msg = await msgOrInteraction.reply({ embeds: [embed], components: [row] });
    }

    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 30000 });
    collector.on('collect', async i => {
        if (i.user.id !== userId) return i.reply({ content: '❌ Đây không phải lượt của bạn!', flags: MessageFlags.Ephemeral });
        
        const dungeonId = i.values[0];
        const dungeon = DUNGEONS.find(d => d.id === dungeonId);
        if (!dungeon) return i.reply({ content: '❌ Dungeon không tồn tại!', flags: MessageFlags.Ephemeral });
        if (p.level < dungeon.minLevel) return i.reply({ content: `❌ Cần tối thiểu **Lv.${dungeon.minLevel}** để vào ${dungeon.name}!`, flags: MessageFlags.Ephemeral });

        collector.stop();
        await i.deferUpdate();

        // Simulate dungeon combat
        const stats = getPlayerStats(p);
        let playerHp = p.hp;
        const combatLog = [];
        let cleared = true;
        let floorReached = 0;
        let extraCoins = 0;
        const extraChests = {};

        // Fight through floors
        for (let f = 0; f < dungeon.floors.length; f++) {
            const monster = dungeon.floors[f];
            
            let eventMsg = '';
            let isElite = false;
            const eventRoll = Math.random();
            
            if (eventRoll < 0.05) {
                const trapDmg = Math.floor(p.maxHp * 0.1);
                playerHp -= trapDmg;
                eventMsg = ` ⚠️ Bẫy (-${trapDmg} HP)`;
            } else if (eventRoll < 0.15) {
                const healAmt = Math.floor(p.maxHp * 0.2);
                playerHp = Math.min(p.maxHp, playerHp + healAmt);
                eventMsg = ` ⛲ Suối tiên (+${healAmt} HP)`;
            } else if (eventRoll < 0.25) {
                isElite = true;
                eventMsg = ` 💀 Quái Tinh Anh (x2 thưởng)!`;
            } else if (eventRoll < 0.35) {
                const type = Math.random() < 0.5 ? 'wood' : 'iron';
                extraChests[type] = (extraChests[type] || 0) + 1;
                eventMsg = ` 📦 Nhặt được ${type === 'wood' ? 'Rương Gỗ' : 'Rương Sắt'}!`;
            }

            if (playerHp <= 0) {
                combatLog.push(`❌ Tầng ${f + 1}: Bị cạm bẫy hạ gục trước khi đánh!`);
                cleared = false;
                floorReached = f + 1;
                break;
            }

            let mHp = isElite ? monster.hp * 1.5 : monster.hp;
            let mAtk = isElite ? monster.atk * 1.5 : monster.atk;
            let mName = isElite ? `[ELITE] ${monster.name}` : monster.name;

            const pDmg = Math.max(1, stats.atk - monster.def);
            const mDmg = Math.max(1, mAtk - stats.def);
            let rounds = 0;

            while (mHp > 0 && playerHp > 0 && rounds < 20) {
                mHp -= pDmg;
                if (mHp <= 0) break;
                playerHp -= mDmg;
                rounds++;
            }

            if (playerHp <= 0) {
                combatLog.push(`❌ Tầng ${f + 1}: ${monster.emoji} **${mName}** đã hạ gục bạn!${eventMsg}`);
                cleared = false;
                floorReached = f + 1;
                break;
            }
            if (isElite) extraCoins += Math.floor(dungeon.rewards.coin / dungeon.floors.length);
            combatLog.push(`✅ Tầng ${f + 1}: Đánh bại ${monster.emoji} **${mName}** (HP còn: ${Math.floor(playerHp)})${eventMsg}`);
            floorReached = f + 1;
        }

        // Boss fight
        let bossDefeated = false;
        let rareMaterial = null;
        if (cleared && playerHp > 0) {
            const boss = dungeon.boss;
            let bHp = boss.hp;
            const pDmg = Math.max(1, stats.atk - boss.def);
            const bDmg = Math.max(1, boss.atk - stats.def);
            let rounds = 0;

            while (bHp > 0 && playerHp > 0 && rounds < 30) {
                bHp -= pDmg;
                if (bHp <= 0) break;
                playerHp -= bDmg;
                rounds++;
            }

            if (playerHp <= 0) {
                combatLog.push(`\n💀 **BOSS** ${boss.emoji} **${boss.name}** đã hạ gục bạn!`);
                cleared = false;
            } else {
                combatLog.push(`\n🏆 **BOSS** Đánh bại ${boss.emoji} **${boss.name}**!`);
                bossDefeated = true;
                
                // Drop Rare Material for end-game dungeons
                if (dungeon.minLevel >= 20 && Math.random() < 0.4) {
                    const materials = ['obsidian', 'void_shard', 'dragon_scale', 'demon_horn', 'mega_stone', 'z_crystal'];
                    rareMaterial = materials[Math.floor(Math.random() * materials.length)];
                }
            }
        }

        // Calculate rewards
        let coinReward = Math.floor(dungeon.rewards.coin * (floorReached / dungeon.floors.length));
        let expReward = Math.floor(dungeon.rewards.exp * (floorReached / dungeon.floors.length));
        if (bossDefeated) {
            coinReward = dungeon.rewards.coin;
            expReward = dungeon.rewards.exp;
        }

        // Chest drop
        let chestDropped = null;
        if (bossDefeated && Math.random() < dungeon.rewards.chestChance) {
            chestDropped = dungeon.rewards.chestType;
            // Small chance for legendary
            if (Math.random() < 0.005) chestDropped = 'legendary';
        }

        // Update player
        updatePlayer(userId, dp => {
            dp.hp = Math.max(0, Math.floor(playerHp));
            dp.lastDungeon = now;
            dp.exp += expReward;
            if (bossDefeated) dp.dungeonClears = (dp.dungeonClears || 0) + 1;
            if (chestDropped) dp.chests[chestDropped] = (dp.chests[chestDropped] || 0) + 1;
            for (const cType in extraChests) {
                dp.chests[cType] = (dp.chests[cType] || 0) + extraChests[cType];
            }
            if (rareMaterial) {
                if (!dp.inventory) dp.inventory = {};
                dp.inventory[rareMaterial] = (dp.inventory[rareMaterial] || 0) + 1;
            }
        });
        addCoins(userId, coinReward + extraCoins);

        if (bossDefeated) trackQuestProgress(userId, 'dungeon', 1);

        // Build result embed
        const resultEmbed = new EmbedBuilder()
            .setTitle(bossDefeated ? `🏆 ${dungeon.name} — HOÀN THÀNH!` : `💀 ${dungeon.name} — THẤT BẠI`)
            .setDescription(combatLog.join('\n'))
            .addFields(
                { name: '💰 Coin', value: `+${(coinReward + extraCoins).toLocaleString()} 🪙`, inline: true },
                { name: '⭐ EXP', value: `+${expReward}`, inline: true },
                { name: '❤️ HP còn lại', value: `${Math.max(0, Math.floor(playerHp))}/${p.maxHp}`, inline: true }
            )
            .setColor(bossDefeated ? '#2ECC71' : '#E74C3C')
            .setTimestamp();

        if (chestDropped || rareMaterial || Object.keys(extraChests).length > 0) {
            const lootLog = [];
            if (chestDropped) {
                const chest = RPG_CHESTS[chestDropped];
                lootLog.push(`${chest.emoji} **${chest.name}**`);
            }
            if (rareMaterial) {
                const mat = RPG_ITEMS.materials[rareMaterial];
                lootLog.push(`✨ ${mat.emoji} **${mat.name}** (Rớt từ Boss)`);
            }
            for (const type in extraChests) {
                const chest = RPG_CHESTS[type];
                lootLog.push(`${chest.emoji} **${chest.name}** x${extraChests[type]}`);
            }
            resultEmbed.addFields({ name: '🎁 Loot nhận được!', value: lootLog.join('\n') + '\n*Dùng `/openbox` để mở rương!*', inline: false });
        }

        await i.editReply({ embeds: [resultEmbed], components: [] });
    });

    collector.on('end', (_, reason) => {
        if (reason === 'time') msg.edit({ components: [] }).catch(() => {});
    });
}

// --- PVP SYSTEM ---
async function handlePvP(userId, targetId, bet, msgOrInteraction) {
    if (userId === targetId) return replyMsg(msgOrInteraction, '❌ Bạn không thể tự đánh chính mình!');
    
    const p1 = getPlayer(userId);
    const p2 = getPlayer(targetId);
    
    if (p1.hp <= 0) return replyMsg(msgOrInteraction, '❌ Bạn đã hết máu! Dùng `/heal` trước.');
    if (p2.hp <= 0) return replyMsg(msgOrInteraction, '❌ Đối thủ đã hết máu, không thể PvP!');
    
    const now = Date.now();
    if (now - p1.lastPvp < 5 * 60 * 1000) {
        const secs = Math.ceil((5 * 60 * 1000 - (now - p1.lastPvp)) / 1000);
        return replyMsg(msgOrInteraction, `⏳ PvP cooldown! Đợi **${secs}s** nữa.`);
    }

    if (getUserCoins(userId) < bet) return replyMsg(msgOrInteraction, `❌ Bạn không đủ **${bet.toLocaleString()} 🪙**!`);
    if (getUserCoins(targetId) < bet) return replyMsg(msgOrInteraction, `❌ Đối thủ không đủ **${bet.toLocaleString()} 🪙**!`);

    const s1 = getPlayerStats(p1);
    const s2 = getPlayerStats(p2);
    const c1 = p1.rpgClass ? RPG_CLASSES[p1.rpgClass] : null;
    const c2 = p2.rpgClass ? RPG_CLASSES[p2.rpgClass] : null;

    const challengeEmbed = new EmbedBuilder()
        .setTitle('⚔️ THÁCH ĐẤU PVP ⚔️')
        .setDescription(
            `<@${userId}> thách đấu <@${targetId}>!\n\n` +
            `💰 **Mức cược:** ${bet.toLocaleString()} 🪙\n\n` +
            `**Người thách đấu:**\n` +
            `> Lv.${p1.level} ${c1 ? c1.emoji : '👤'} | ⚔️ ${s1.atk} | 🛡️ ${s1.def} | ❤️ ${p1.hp}\n` +
            `**Đối thủ:**\n` +
            `> Lv.${p2.level} ${c2 ? c2.emoji : '👤'} | ⚔️ ${s2.atk} | 🛡️ ${s2.def} | ❤️ ${p2.hp}`
        )
        .setColor('#E74C3C');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pvp_accept_${userId}_${targetId}_${bet}`).setLabel('⚔️ Chấp nhận').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`pvp_decline_${userId}_${targetId}`).setLabel('❌ Từ chối').setStyle(ButtonStyle.Danger)
    );

    const reply = await replyMsg(msgOrInteraction, { content: `<@${targetId}>, bạn có lời thách đấu PvP!`, embeds: [challengeEmbed], components: [row] });
    
    // PvP accept/decline is handled in interactionCreate button handler
}

function executePvPBattle(p1Data, p2Data) {
    const s1 = getPlayerStats(p1Data);
    const s2 = getPlayerStats(p2Data);
    
    let hp1 = p1Data.hp;
    let hp2 = p2Data.hp;
    const log = [];
    let round = 0;

    while (hp1 > 0 && hp2 > 0 && round < 15) {
        round++;
        // Player 1 attacks
        let dmg1 = Math.max(1, s1.atk - s2.def);
        const crit1 = Math.random() < 0.2;
        if (crit1) dmg1 = Math.floor(dmg1 * 2);
        hp2 -= dmg1;
        log.push(`⚔️ R${round}: P1 ${crit1 ? '💥CHÍ MẠNG ' : ''}→ **${dmg1}** dmg (HP2: ${Math.max(0, hp2)})`);

        if (hp2 <= 0) break;

        // Player 2 attacks
        let dmg2 = Math.max(1, s2.atk - s1.def);
        const crit2 = Math.random() < 0.2;
        if (crit2) dmg2 = Math.floor(dmg2 * 2);
        hp1 -= dmg2;
        log.push(`🛡️ R${round}: P2 ${crit2 ? '💥CHÍ MẠNG ' : ''}→ **${dmg2}** dmg (HP1: ${Math.max(0, hp1)})`);
    }

    return { hp1: Math.max(0, hp1), hp2: Math.max(0, hp2), log, winner: hp1 > hp2 ? 1 : hp2 > hp1 ? 2 : 0 };
}

// --- DAILY QUEST SYSTEM ---
async function handleQuest(userId, msgOrInteraction) {
    const quests = generateDailyQuests(userId);
    
    const allCompleted = quests.every(q => q.progress >= q.target);
    const allClaimed = quests.every(q => q.claimed);
    
    let questText = quests.map((q, i) => {
        const done = q.progress >= q.target;
        const claimed = q.claimed;
        const icon = claimed ? '✅' : done ? '🟢' : '🔴';
        const progress = q.type === 'earn_coin' 
            ? `${Math.min(q.progress, q.target).toLocaleString()}/${q.target.toLocaleString()}`
            : `${Math.min(q.progress, q.target)}/${q.target}`;
        return `${icon} **${q.desc}** — ${progress}\n> Thưởng: ${q.reward.coin.toLocaleString()} 🪙 + ${q.reward.exp} EXP${claimed ? ' *(Đã nhận)*' : ''}`;
    }).join('\n\n');

    if (allCompleted && !allClaimed) {
        questText += `\n\n🎉 **BONUS HOÀN THÀNH TẤT CẢ:** +${QUEST_COMPLETION_BONUS.coin.toLocaleString()} 🪙 + ${QUEST_COMPLETION_BONUS.exp} EXP`;
    }

    const embed = new EmbedBuilder()
        .setTitle('🎯 Nhiệm Vụ Hàng Ngày')
        .setDescription(questText)
        .setColor(allClaimed ? '#2ECC71' : '#3498DB')
        .setFooter({ text: 'Nhiệm vụ reset lúc 0:00 mỗi ngày' })
        .setTimestamp();

    const components = [];
    if (!allClaimed) {
        const hasClaimable = quests.some(q => q.progress >= q.target && !q.claimed);
        if (hasClaimable) {
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`quest_claim_${userId}`).setLabel('🎁 Nhận Thưởng').setStyle(ButtonStyle.Success)
            ));
        }
    }

    let msg;
    if (msgOrInteraction.isChatInputCommand?.()) {
        await msgOrInteraction.reply({ embeds: [embed], components });
        msg = await msgOrInteraction.fetchReply();
    } else {
        msg = await replyMsg(msgOrInteraction, { embeds: [embed], components });
    }

    if (components.length === 0) return;

    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });
    collector.on('collect', async i => {
        if (i.user.id !== userId) return i.reply({ content: '❌ Đây không phải nhiệm vụ của bạn!', flags: MessageFlags.Ephemeral });
        
        let totalCoin = 0, totalExp = 0;
        updatePlayer(userId, dp => {
            for (const q of dp.dailyQuests) {
                if (q.progress >= q.target && !q.claimed) {
                    totalCoin += q.reward.coin;
                    totalExp += q.reward.exp;
                    q.claimed = true;
                }
            }
            if (dp.dailyQuests.every(q => q.claimed)) {
                totalCoin += QUEST_COMPLETION_BONUS.coin;
                totalExp += QUEST_COMPLETION_BONUS.exp;
            }
            dp.exp += totalExp;
        });
        addCoins(userId, totalCoin);

        await i.update({
            embeds: [new EmbedBuilder()
                .setTitle('🎁 Nhận Thưởng Nhiệm Vụ')
                .setDescription(`Bạn đã nhận:\n💰 **+${totalCoin.toLocaleString()} 🪙**\n⭐ **+${totalExp} EXP**`)
                .setColor('#2ECC71').setTimestamp()
            ],
            components: []
        });
    });
}

// --- CLASS SYSTEM ---
async function handleClass(userId, msgOrInteraction) {
    const p = getPlayer(userId);
    
    if (p.level < 5) return replyMsg(msgOrInteraction, `❌ Bạn cần đạt **Lv.5** để chọn class! (Hiện tại: Lv.${p.level})`);

    const currentClass = p.rpgClass ? RPG_CLASSES[p.rpgClass] : null;
    
    let desc = currentClass 
        ? `Class hiện tại: ${currentClass.emoji} **${currentClass.name}**\n> ${currentClass.desc}\n\n🔄 Đổi class tốn **5,000,000 🪙**. Chọn class mới:`
        : '🆓 Bạn chưa chọn class! Hãy chọn miễn phí lần đầu:';

    const options = Object.entries(RPG_CLASSES).map(([id, cls]) => 
        new StringSelectMenuOptionBuilder()
            .setLabel(`${cls.name}`)
            .setValue(id)
            .setDescription(cls.desc.substring(0, 100))
            .setEmoji(cls.emoji)
    );

    const embed = new EmbedBuilder()
        .setTitle('🏅 Chọn Class Nhân Vật')
        .setDescription(desc + '\n\n' + Object.entries(RPG_CLASSES).map(([id, cls]) => 
            `${cls.emoji} **${cls.name}**\n> ${cls.desc}`
        ).join('\n\n'))
        .setColor('#9B59B6')
        .setFooter({ text: `Cấp: Lv.${p.level}` });

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`class_select_${userId}`).setPlaceholder('🏅 Chọn Class...').addOptions(options)
    );

    let msg;
    if (msgOrInteraction.isChatInputCommand?.()) {
        await msgOrInteraction.reply({ embeds: [embed], components: [row] });
        msg = await msgOrInteraction.fetchReply();
    } else {
        msg = await replyMsg(msgOrInteraction, { embeds: [embed], components: [row] });
    }

    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 30000 });
    collector.on('collect', async i => {
        if (i.user.id !== userId) return i.reply({ content: '❌ Không phải lượt của bạn!', flags: MessageFlags.Ephemeral });

        const classId = i.values[0];
        const cls = RPG_CLASSES[classId];
        const currentP = getPlayer(userId);

        if (currentP.rpgClass === classId) return i.reply({ content: `❌ Bạn đã là **${cls.name}** rồi!`, flags: MessageFlags.Ephemeral });

        // Nếu đã có class → phải trả phí
        if (currentP.rpgClass) {
            const changeCost = 5000000;
            if (getUserCoins(userId) < changeCost) return i.reply({ content: `❌ Không đủ **${changeCost.toLocaleString()} 🪙** để đổi class!`, flags: MessageFlags.Ephemeral });
            addCoins(userId, -changeCost);
        }

        updatePlayer(userId, dp => {
            dp.rpgClass = classId;
            dp.classChangedAt = Date.now();
        });

        await i.update({
            embeds: [new EmbedBuilder()
                .setTitle(`${cls.emoji} Chuyển Class thành công!`)
                .setDescription(`Bạn đã trở thành **${cls.name}**!\n\n> ${cls.desc}\n\nChiêu đặc biệt: **${cls.skillEmoji} ${cls.skillName}**`)
                .setColor('#2ECC71').setTimestamp()
            ],
            components: []
        });
    });
}

// --- CHEST/LOOT SYSTEM ---
async function handleOpenBox(userId, msgOrInteraction) {
    const p = getPlayer(userId);
    const chests = p.chests || {};
    
    const hasChests = Object.values(chests).some(v => v > 0);
    if (!hasChests) return replyMsg(msgOrInteraction, '❌ Bạn không có rương nào! Hoàn thành Dungeon để nhận rương.');

    const options = [];
    for (const [type, count] of Object.entries(chests)) {
        if (count > 0 && RPG_CHESTS[type]) {
            const chest = RPG_CHESTS[type];
            options.push(new StringSelectMenuOptionBuilder()
                .setLabel(`${chest.name} (x${count})`)
                .setValue(type)
                .setDescription(`Mở 1 ${chest.name}`)
                .setEmoji(chest.emoji));
        }
    }

    if (options.length === 0) return replyMsg(msgOrInteraction, '❌ Bạn không có rương nào!');

    const embed = new EmbedBuilder()
        .setTitle('🎁 Kho Rương')
        .setDescription(Object.entries(chests).filter(([t, c]) => c > 0 && RPG_CHESTS[t]).map(([t, c]) => {
            const ch = RPG_CHESTS[t];
            return `${ch.emoji} **${ch.name}**: ${c} cái`;
        }).join('\n'))
        .setColor('#FFD700')
        .setFooter({ text: 'Chọn rương để mở!' });

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`openbox_select_${userId}`).setPlaceholder('🎁 Chọn rương...').addOptions(options)
    );

    let msg;
    if (msgOrInteraction.isChatInputCommand?.()) {
        await msgOrInteraction.reply({ embeds: [embed], components: [row] });
        msg = await msgOrInteraction.fetchReply();
    } else {
        msg = await replyMsg(msgOrInteraction, { embeds: [embed], components: [row] });
    }

    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 30000 });
    collector.on('collect', async i => {
        if (i.user.id !== userId) return i.reply({ content: '❌ Không phải rương của bạn!', flags: MessageFlags.Ephemeral });

        const chestType = i.values[0];
        const chestDef = RPG_CHESTS[chestType];
        const curPlayer = getPlayer(userId);

        if (!curPlayer.chests[chestType] || curPlayer.chests[chestType] <= 0) {
            return i.reply({ content: '❌ Hết rương loại này rồi!', flags: MessageFlags.Ephemeral });
        }

        // Roll loot
        const rand = Math.random();
        let cumChance = 0;
        let loot = null;
        for (const item of chestDef.loot) {
            cumChance += item.chance;
            if (rand <= cumChance) { loot = item; break; }
        }
        if (!loot) loot = chestDef.loot[0];

        let lootText = '';
        updatePlayer(userId, dp => {
            dp.chests[chestType]--;

            if (loot.type === 'coin') {
                const amount = Math.floor(Math.random() * (loot.max - loot.min + 1) + loot.min);
                addCoins(userId, amount);
                lootText = `💰 **${amount.toLocaleString()} Coin**`;
            } else if (loot.type === 'potion' || loot.type === 'pokeball') {
                const amount = Math.floor(Math.random() * (loot.max - loot.min + 1) + loot.min);
                dp.inventory[loot.item] = (dp.inventory[loot.item] || 0) + amount;
                const itemName = RPG_ITEMS.potions[loot.item]?.name || RPG_ITEMS.pokeballs[loot.item]?.name || loot.item;
                lootText = `🧪 **${amount}x ${itemName}**`;
            } else if (loot.type === 'weapon') {
                const item = loot.items[Math.floor(Math.random() * loot.items.length)];
                dp.inventory[item] = (dp.inventory[item] || 0) + 1;
                dp.weapon = item;
                lootText = `⚔️ **${RPG_ITEMS.weapons[item].name}** (Tự động trang bị!)`;
            } else if (loot.type === 'armor') {
                const item = loot.items[Math.floor(Math.random() * loot.items.length)];
                dp.inventory[item] = (dp.inventory[item] || 0) + 1;
                dp.armor = item;
                lootText = `🛡️ **${RPG_ITEMS.armors[item].name}** (Tự động trang bị!)`;
            } else if (loot.type === 'exp') {
                dp.exp += loot.amount;
                lootText = `⭐ **+${loot.amount} EXP**`;
            } else if (loot.type === 'title') {
                const title = loot.titles[Math.floor(Math.random() * loot.titles.length)];
                if (!dp.titles.includes(title)) dp.titles.push(title);
                lootText = `🏅 Danh hiệu: **${title}**`;
            }
        });

        const resultEmbed = new EmbedBuilder()
            .setTitle(`${chestDef.emoji} Mở ${chestDef.name}`)
            .setDescription(`🎉 Bạn nhận được:\n\n${lootText}`)
            .setColor(chestDef.color)
            .setTimestamp();

        await i.update({ embeds: [resultEmbed], components: [] });
    });
}

// --- POKEMON EVOLUTION ---
async function handleEvolve(userId, msgOrInteraction) {
    const p = getPlayer(userId);
    const pets = p.pets || {};

    const evolveOptions = [];
    for (const pet of PET_LIST) {
        if (!pets[pet.id] || pets[pet.id] <= 0) continue;
        const nextEvo = PET_LIST.find(np => np.evolvesFrom === pet.id);
        if (nextEvo) {
            evolveOptions.push({ from: pet, to: nextEvo, owned: pets[pet.id] });
        }
    }

    if (evolveOptions.length === 0) {
        const dupes = [];
        for (const pet of PET_LIST) {
            if (pets[pet.id] && pets[pet.id] > 1) dupes.push({ pet, count: pets[pet.id] - 1 });
        }
        
        let desc = '❌ Bạn chưa có Pokemon nào có thể tiến hóa.\n\n';
        if (dupes.length > 0) {
            desc += '💡 Bạn có Pokemon dư, bạn có thể **bán thú cưng dư để lấy Vàng**!\n\n';
            desc += dupes.slice(0, 10).map(d => `${d.pet.emoji} ${d.pet.name}: ${d.count} con dư → **+${((d.count * (d.pet.price || 1000)) / 2).toLocaleString()} 🪙**`).join('\n');
            
            const convertRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`sell_dupe_pets_${userId}`).setLabel('💰 Bán Tất Cả Thú Dư').setStyle(ButtonStyle.Success)
            );
            
            const embed = new EmbedBuilder()
                .setTitle('🔄 Tiến Hóa Pokemon')
                .setDescription(desc)
                .setColor('#9B59B6');

            return replyMsg(msgOrInteraction, { embeds: [embed], components: [convertRow] });
        }
        
        return replyMsg(msgOrInteraction, `❌ Bạn chưa có Pokemon nào có thể tiến hóa hoặc dư để bán.\n> Hãy bắt thêm Pokemon và quay lại sau!`);
    }

    const options = evolveOptions.slice(0, 25).map(opt => 
        new StringSelectMenuOptionBuilder()
            .setLabel(`${opt.from.name} → ${opt.to.name}`)
            .setValue(`evolve_${opt.from.id}_${opt.to.id}`)
            .setDescription(`Miễn phí Kẹo! (Sở hữu: ${opt.owned})`)
            .setEmoji(opt.from.emoji)
    );

    const embed = new EmbedBuilder()
        .setTitle('🔄 Tiến Hóa Pokemon')
        .setDescription(`Tiến hóa **hoàn toàn miễn phí**!\n\n` + evolveOptions.map(opt =>
            `${opt.from.emoji} **${opt.from.name}** → ${opt.to.emoji} **${opt.to.name}**`
        ).join('\n'))
        .setColor('#9B59B6');

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`evolve_select_${userId}`).setPlaceholder('🔄 Chọn Pokemon để tiến hóa...').addOptions(options)
    );

    return replyMsg(msgOrInteraction, { embeds: [embed], components: [row] });
}

// --- POKE SOLO ---
async function handlePokeSolo(userId, msgOrInteraction) {
    const p = getPlayer(userId);
    const pets = p.pets || {};
    
    // Find strongest pet
    let bestPet = null;
    let maxPrice = -1;
    for (const pet of PET_LIST) {
        if (pets[pet.id] && pets[pet.id] > 0 && (pet.price || 0) > maxPrice) {
            maxPrice = pet.price || 0;
            bestPet = pet;
        }
    }
    
    if (!bestPet) {
        return replyMsg(msgOrInteraction, '❌ Bạn chưa có Pokemon nào! Hãy dùng lệnh `/catchpet` để bắt Pokemon trước.');
    }
    
    // Cooldown 15 mins
    const now = Date.now();
    if (now - (p.lastPokeSolo || 0) < 15 * 60 * 1000) {
        const mins = Math.ceil((15 * 60 * 1000 - (now - p.lastPokeSolo)) / 60000);
        return replyMsg(msgOrInteraction, `⏳ Thú cưng của bạn đang nghỉ ngơi! Hãy quay lại sau **${mins} phút**.`);
    }
    
    // Random wild pokemon
    const wildPet = PET_LIST[Math.floor(Math.random() * PET_LIST.length)];
    
    const pPower = bestPet.price || 1000;
    const wildPower = (wildPet.price || 1000) * (Math.random() * 1.5 + 0.5); // Random modifier
    
    updatePlayer(userId, dp => {
        dp.lastPokeSolo = now;
    });
    
    const win = pPower >= wildPower;
    
    const embed = new EmbedBuilder()
        .setTitle('⚔️ Poke Solo - Trận Chiến Sinh Tử')
        .setDescription(`Bạn cử **${bestPet.emoji} ${bestPet.name}** (Sức mạnh: ${pPower.toLocaleString()}) đi khám phá...\nĐụng độ **${wildPet.emoji} ${wildPet.name}** Hoang Dã (Sức mạnh: ${Math.floor(wildPower).toLocaleString()})!`)
        .setColor(win ? '#2ECC71' : '#E74C3C');
        
    if (!win) {
        embed.addFields({ name: 'Thất bại!', value: `Thú cưng của bạn đã bị đánh bại và bỏ chạy về! 😭` });
        return replyMsg(msgOrInteraction, { embeds: [embed] });
    }
    
    // Win
    let rewardText = `Thú cưng của bạn đã đánh bại đối thủ và mang về chiến lợi phẩm! 🎉\n\n`;
    
    let droppedMega = false;
    let droppedZ = false;
    
    const randDrop = Math.random();
    if (randDrop < 0.05) {
        droppedMega = true;
    } else if (randDrop < 0.10) {
        droppedZ = true;
    }
    
    const coinReward = Math.floor(Math.random() * 10000) + 5000;
    addCoins(userId, coinReward);
    rewardText += `💰 **+${coinReward.toLocaleString()} 🪙**\n`;
    
    updatePlayer(userId, dp => {
        if (droppedMega) dp.inventory['mega_stone'] = (dp.inventory['mega_stone'] || 0) + 1;
        if (droppedZ) dp.inventory['z_crystal'] = (dp.inventory['z_crystal'] || 0) + 1;
        dp.exp += 50;
    });
    
    rewardText += `⭐ **+50 EXP**\n`;
    
    if (droppedMega) {
        rewardText += `🔮 **Nhặt được: 1x Đá Mega!**\n`;
    }
    if (droppedZ) {
        rewardText += `💠 **Nhặt được: 1x Đá Tuyệt Kỹ Z!**\n`;
    }
    
    embed.addFields({ name: 'Chiến Thắng!', value: rewardText });
    
    return replyMsg(msgOrInteraction, { embeds: [embed] });
}

// --- RPG LEADERBOARD ---
async function handleRpgTop(userId, msgOrInteraction) {
    const data = loadRPG();
    const cData = loadCoins();
    
    const players = Object.entries(data).map(([id, p]) => {
        const stats = getPlayerStats(p);
        const petCount = p.pets ? Object.values(p.pets).reduce((s, v) => s + v, 0) : 0;
        const petTypes = p.pets ? Object.keys(p.pets).filter(k => p.pets[k] > 0).length : 0;
        return { id, ...p, totalPower: stats.atk + stats.def + p.level * 10, petCount, petTypes };
    });

    let currentTab = 'level';
    const tabLabels = { level: '🔰 Top Level', power: '💪 Top Sức Mạnh', dungeon: '🏰 Top Dungeon', pokemon: '🐾 Top Pokemon', pvp: '⚔️ Top PvP' };

    function buildTopEmbed(tab) {
        let sorted, desc;
        const rankEmojis = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

        if (tab === 'level') {
            sorted = [...players].sort((a, b) => b.level - a.level || b.exp - a.exp).slice(0, 10);
            desc = sorted.map((p, i) => `${rankEmojis[i]} <@${p.id}> — **Lv.${p.level}** (${p.exp} EXP)`).join('\n');
        } else if (tab === 'power') {
            sorted = [...players].sort((a, b) => b.totalPower - a.totalPower).slice(0, 10);
            desc = sorted.map((p, i) => `${rankEmojis[i]} <@${p.id}> — ⚡ **${p.totalPower}** sức mạnh`).join('\n');
        } else if (tab === 'dungeon') {
            sorted = [...players].sort((a, b) => (b.dungeonClears || 0) - (a.dungeonClears || 0)).slice(0, 10);
            desc = sorted.map((p, i) => `${rankEmojis[i]} <@${p.id}> — 🏰 **${p.dungeonClears || 0}** lần clear`).join('\n');
        } else if (tab === 'pokemon') {
            sorted = [...players].sort((a, b) => b.petTypes - a.petTypes || b.petCount - a.petCount).slice(0, 10);
            desc = sorted.map((p, i) => `${rankEmojis[i]} <@${p.id}> — 🐾 **${p.petTypes}** loại (**${p.petCount}** con)`).join('\n');
        } else if (tab === 'pvp') {
            sorted = [...players].sort((a, b) => (b.pvpWins || 0) - (a.pvpWins || 0)).slice(0, 10);
            desc = sorted.map((p, i) => `${rankEmojis[i]} <@${p.id}> — ⚔️ **${p.pvpWins || 0}W** / ${p.pvpLosses || 0}L`).join('\n');
        }

        return new EmbedBuilder()
            .setTitle(`🏆 Bảng Xếp Hạng RPG — ${tabLabels[tab]}`)
            .setDescription(desc || '*Chưa có dữ liệu*')
            .setColor('#FFD700')
            .setThumbnail('https://cdn-icons-png.flaticon.com/512/3113/3113054.png')
            .setTimestamp();
    }

    function buildTabRow() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rpgtop_level').setLabel('🔰 Level').setStyle(currentTab === 'level' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rpgtop_power').setLabel('💪 Power').setStyle(currentTab === 'power' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rpgtop_dungeon').setLabel('🏰 Dungeon').setStyle(currentTab === 'dungeon' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rpgtop_pokemon').setLabel('🐾 Pokemon').setStyle(currentTab === 'pokemon' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rpgtop_pvp').setLabel('⚔️ PvP').setStyle(currentTab === 'pvp' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        );
    }

    let msg;
    if (msgOrInteraction.isChatInputCommand?.()) {
        await msgOrInteraction.reply({ embeds: [buildTopEmbed(currentTab)], components: [buildTabRow()] });
        msg = await msgOrInteraction.fetchReply();
    } else {
        msg = await replyMsg(msgOrInteraction, { embeds: [buildTopEmbed(currentTab)], components: [buildTabRow()] });
    }

    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120000 });
    collector.on('collect', async i => {
        const tab = i.customId.replace('rpgtop_', '');
        if (tabLabels[tab]) {
            currentTab = tab;
            await i.update({ embeds: [buildTopEmbed(tab)], components: [buildTabRow()] });
        }
    });

    collector.on('end', () => {
        msg.edit({ components: [] }).catch(() => {});
    });
}

const ADMIN_ID = process.env.ADMIN_ID || '1204627726254997546';
const ROB_COOLDOWN = 5 * 60 * 1000; // 5 minutes
const HEIST_COOLDOWN = 4 * 60 * 60 * 1000; // 4 hours

async function handleDeposit(userId, amount, msgOrInteraction) {
    const data = loadCoins();
    if (!data[userId]) data[userId] = { coins: 500000, bank: 0, lastDaily: 0 };
    const cash = data[userId].coins || 0;
    if (amount === 'all') amount = cash;
    else {
        amount = parseInt(amount);
        if (isNaN(amount) || amount <= 0) return replyMsg(msgOrInteraction, '❌ Số tiền không hợp lệ!');
    }
    if (cash < amount) return replyMsg(msgOrInteraction, `❌ Bạn không có đủ tiền mặt! (Hiện có: **${cash.toLocaleString()} 🪙**)`);
    
    // Atomic: trừ ví và cộng bank trong cùng 1 lượt load/save
    data[userId].coins = Math.max(0, Math.floor(cash - amount));
    data[userId].bank = Math.max(0, Math.floor((data[userId].bank || 0) + amount));
    saveCoins(data);
    return replyMsg(msgOrInteraction, `✅ Đã gửi **${amount.toLocaleString()} 🪙** vào ngân hàng!`);
}

async function handleWithdraw(userId, amount, msgOrInteraction) {
    const data = loadCoins();
    if (!data[userId]) data[userId] = { coins: 500000, bank: 0, lastDaily: 0 };
    const bank = data[userId].bank || 0;
    if (amount === 'all') amount = bank;
    else {
        amount = parseInt(amount);
        if (isNaN(amount) || amount <= 0) return replyMsg(msgOrInteraction, '❌ Số tiền không hợp lệ!');
    }
    if (bank < amount) return replyMsg(msgOrInteraction, `❌ Ngân hàng của bạn không đủ tiền! (Hiện có: **${bank.toLocaleString()} 🪙**)`);
    
    // Atomic: trừ bank và cộng ví trong cùng 1 lượt load/save
    data[userId].bank = Math.max(0, Math.floor(bank - amount));
    data[userId].coins = Math.max(0, Math.floor((data[userId].coins || 0) + amount));
    saveCoins(data);
    return replyMsg(msgOrInteraction, `✅ Đã rút **${amount.toLocaleString()} 🪙** về ví!`);
}

async function handleRob(userId, targetId, msgOrInteraction) {
    if (userId === targetId) return replyMsg(msgOrInteraction, '❌ Bạn không thể tự trộm chính mình!');
    if (targetId === msgOrInteraction.client?.user?.id) return replyMsg(msgOrInteraction, '❌ Bạn định trộm tiền của bot sao? Không thể nào!');
    
    // Bảo vệ Admin
    if (targetId === ADMIN_ID) {
        // Phạt nặng người dám trộm
        const currentCoins = getUserCoins(userId);
        const penalty = Math.floor(currentCoins * 0.5); // Trừ 50% tiền mặt
        addCoins(userId, -penalty);
        return replyMsg(msgOrInteraction, `⚡ **TRỜI PHẠT!** Bạn dám trộm tiền của Admin tối cao? Ngài ấy đã phát hiện và giáng sét xuống đầu bạn. Bạn bị phạt mất **${penalty.toLocaleString()} 🪙**!`);
    }

    const data = loadCoins();
    if (!data[userId]) data[userId] = { coins: 0, bank: 0, lastRob: 0, lastHeist: 0 };
    if (!data[targetId]) data[targetId] = { coins: 0, bank: 0 };
    
    const now = Date.now();
    const lastRob = data[userId].lastRob || 0;
    
    if (now - lastRob < ROB_COOLDOWN && userId !== ADMIN_ID) {
        const r = ROB_COOLDOWN - (now - lastRob);
        return replyMsg(msgOrInteraction, `⏳ Cảnh sát đang tuần tra! Hãy đợi **${Math.floor(r/60000)}p ${Math.floor((r%60000)/1000)}s** nữa để đi trộm tiếp.`);
    }
    
    data[userId].lastRob = now;
    
    const targetCash = data[targetId].coins || 0;
    if (targetCash < 1000) {
        saveCoins(data);
        return replyMsg(msgOrInteraction, '❌ Người này quá nghèo, hãy tha cho họ (cần có ít nhất 1000 🪙 tiền mặt để trộm)!');
    }
    
    const success = Math.random() < 0.3; // 30%
    if (success || userId === ADMIN_ID) { // Admin rob always success
        const pct = Math.random() * 0.2 + 0.1; // 10 - 30%
        const stolen = Math.floor(targetCash * pct);
        data[targetId].coins = Math.max(0, Math.floor((data[targetId].coins || 0) - stolen));
        data[userId].coins = Math.max(0, Math.floor((data[userId].coins || 0) + stolen));
        saveCoins(data);
        return replyMsg(msgOrInteraction, `🥷 **THÀNH CÔNG!** Bạn đã lẻn vào nhà <@${targetId}> và trộm được **${stolen.toLocaleString()} 🪙**!`);
    } else {
        const cash = data[userId].coins || 0;
        const fine = Math.floor(cash * 0.20);
        data[userId].coins = Math.max(0, cash - fine);
        data[userId].jailEnd = Date.now() + 5 * 60 * 1000; // 5 phút tù
        saveCoins(data);
        return replyMsg(msgOrInteraction,
            `🚨 **BỊ BẮT QUẢ TANG!** Bạn đã bị bắt khi cố trộm nhà <@${targetId}>!\n` +
            `Bị phạt **20% tiền mặt** (**-${fine.toLocaleString()} 🪙**) và **bỏ tù 5 phút**!\n` +
            `*(Dùng \`!nopphat\` hoặc \`/nopphat\` để hối lộ 100k ra sớm)*`
        );
    }
}

async function handleRobbank(userId, msgOrInteraction, targetId = null) {
    const data = loadCoins();
    if (!data[userId]) data[userId] = { coins: 0, bank: 0, lastHeist: 0 };
    
    const now = Date.now();
    const last = data[userId].lastHeist || 0;
    
    if (now - last < HEIST_COOLDOWN && userId !== ADMIN_ID) {
        const r = HEIST_COOLDOWN - (now - last);
        const h = Math.floor(r / 3600000);
        const m = Math.floor((r % 3600000) / 60000);
        return replyMsg(msgOrInteraction, `⏳ Phi vụ đang được lên kế hoạch. Hãy đợi **${h}h ${m}p** nữa để thực hiện vụ cướp tiếp theo!`);
    }
    
    // === Cướp ngân hàng của USER KHÁC ===
    if (targetId && targetId !== userId) {
        if (!data[targetId]) data[targetId] = { coins: 500000, bank: 0, lastDaily: 0 };
        
        const targetBank = data[targetId].bank || 0;
        if (targetBank <= 0) {
            return replyMsg(msgOrInteraction, `🏦 Ngân hàng của <@${targetId}> **trống rỗng**, không có gì để cướp cả!`);
        }
        
        data[userId].lastHeist = now;
        saveCoins(data);
        
        const success = Math.random() < 0.40 || userId === ADMIN_ID; // 40%
        if (success) {
            // Lấy 10% - 30% bank của nạn nhân
            const stealRate = (Math.random() * 0.20) + 0.10;
            const stolen = Math.floor(targetBank * stealRate);
            data[userId].coins = (data[userId].coins || 0) + stolen;
            data[targetId].bank = Math.max(0, targetBank - stolen);
            saveCoins(data);
            return replyMsg(msgOrInteraction,
                `🥷 **CƯỚP THÀNH CÔNG!**\n` +
                `Bạn đã bẻ khóa két sắt ngân hàng của <@${targetId}> và cướp đi **${stolen.toLocaleString()} 🪙** ` +
                `(${(stealRate * 100).toFixed(0)}% tiền bank của họ)!\n` +
                `💰 Tiền về ví của bạn ngay!`
            );
        } else {
            const cash = data[userId].coins || 0;
            const penalty = Math.floor(cash * 0.20);
            data[userId].coins = Math.max(0, cash - penalty);
            data[userId].jailEnd = Date.now() + 3 * 60 * 1000; // 3 phút tù
            saveCoins(data);
            return replyMsg(msgOrInteraction,
                `🚔 **BỊ BẮT QUẢ TANG!**\n` +
                `Bạn đang cưa két của <@${targetId}> thì bảo vệ ngân hàng gọi cảnh sát!\n` +
                `Bị tịch thu **20% tiền mặt** (**-${penalty.toLocaleString()} 🪙**) và **bỏ tù 3 phút**!\n` +
                `*(Dùng \`!nopphat\` hoặc \`/nopphat\` để hối lộ 100k ra sớm)*`
            );
        }
    }
    
    // === Cướp ngân hàng HỆ THỐNG (không tag ai) ===
    data[userId].lastHeist = now;
    
    const success = Math.random() < 0.15; // 15%
    if (success || userId === ADMIN_ID) {
        const reward = Math.floor(Math.random() * (20000000 - 5000000 + 1)) + 5000000;
        data[userId].coins = (data[userId].coins || 0) + reward;
        saveCoins(data);
        return replyMsg(msgOrInteraction, `🏦 **TRÚNG MÁNH KHỔNG LỒ!** Bạn đã phá két sắt Ngân hàng Trung ương và cướp thành công **${reward.toLocaleString()} 🪙**!!!`);
    } else {
        const cash = data[userId].coins || 0;
        const penalty = Math.floor(cash * 0.20);
        data[userId].coins = Math.max(0, cash - penalty);
        data[userId].jailEnd = Date.now() + 5 * 60 * 1000; // 5 phút tù
        saveCoins(data);
        return replyMsg(msgOrInteraction, `🚔 **BỊ CÔNG AN BẮT!** Vụ cướp ngân hàng thất bại. Bạn bị tịch thu **20% tiền mặt** (**-${penalty.toLocaleString()} 🪙**) và **bị bỏ tù 5 phút**! (Gõ !nopphat hoặc /nopphat để hối lộ 100k ra sớm)`);
    }
}


// ========================
// HACKING SYSTEM (DARK WEB)
// ========================
const hackingSessions = new Map(); // Store active hacking sessions

async function handleHackCommand(userId, targetId, msgOrInteraction) {
    if (!targetId) return replyMsg(msgOrInteraction, '❌ Cú pháp: `/hack @user` hoặc `!hack @user`');
    if (userId === targetId) return replyMsg(msgOrInteraction, '❌ Bạn không thể tự hack chính mình!');
    if (targetId === client.user.id) return replyMsg(msgOrInteraction, '❌ Tôi là hệ thống vạn năng, không thể bị hack!');
    
    if (hackingSessions.has(userId)) return replyMsg(msgOrInteraction, '❌ Bạn đang trong một phiên hack rồi! Hãy giải mã đi.');

    const pData = getPlayer(userId);
    if (!pData.inventory['laptop']) return replyMsg(msgOrInteraction, '❌ Bạn không có **💻 Laptop Hacker**! Hãy mua trong Cửa hàng.');
    if (!pData.inventory['virus'] || pData.inventory['virus'] < 1) return replyMsg(msgOrInteraction, '❌ Bạn đã hết **🦠 Virus Trojan**! Hãy mua thêm để tấn công.');
    
    const targetCoins = getUserCoins(targetId);
    if (targetCoins < 1000000) return replyMsg(msgOrInteraction, '❌ Mục tiêu quá nghèo (dưới 1M 🪙), không bõ công hack!');
    
    // Tiêu thụ 1 Virus
    updatePlayer(userId, p => {
        p.inventory['virus'] -= 1;
        if (p.inventory['virus'] <= 0) delete p.inventory['virus'];
    });
    
    const targetData = getPlayer(targetId);
    if (targetData.inventory['firewall'] && targetData.inventory['firewall'] > 0) {
        updatePlayer(targetId, p => {
            p.inventory['firewall'] -= 1;
            if (p.inventory['firewall'] <= 0) delete p.inventory['firewall'];
        });
        return replyMsg(msgOrInteraction, `💥 **HACK THẤT BẠI!**\nMục tiêu đã trang bị **🧱 Tường Lửa**. Mã độc của bạn đã bị tiêu diệt và Tường Lửa của nạn nhân cũng bị phá vỡ!`);
    }
    
    // Bắt đầu Minigame
    const digits = [];
    while (digits.length < 3) {
        const d = Math.floor(Math.random() * 10);
        if (!digits.includes(d)) digits.push(d); // 3 số không trùng nhau
    }
    const secretCode = digits.join('');
    
    hackingSessions.set(userId, { code: secretCode, attempts: 4, targetId });
    
    const embed = new EmbedBuilder()
        .setTitle('💻 BẮT ĐẦU XÂM NHẬP (MASTERMIND)')
        .setDescription(`Đã vượt qua lớp vỏ bọc, đang truy cập vào hệ thống lõi của <@${targetId}>!\n\n> Hãy nhập **3 chữ số không trùng nhau** (Ví dụ: \`123\`) lên kênh chat để giải mã két sắt.\n> Trạng thái:\n🟢: Đúng số, đúng vị trí\n🟡: Có số này nhưng sai vị trí\n🔴: Số sai hoàn toàn\n\nBạn có **4 lần thử**. Nhập mã của bạn ngay!`)
        .setColor('#00FF00');
        
    return replyMsg(msgOrInteraction, { embeds: [embed] });
}



const QUOTES_TYDC = [
    "💙 Tình yêu Discord là thứ duy nhất online 24/7 nhưng tương lai thì offline mãi.",
    "🎧 Yêu qua Discord, chia tay qua Discord, block xong vẫn chung server.",
    "💀 \"Mãi mãi\" trên Discord thường kéo dài đến khi người ta đổi avatar.",
    "😮💨 Hứa cưới nhau sau vài đêm call, sáng hôm sau thấy đang ghép đôi với người khác.",
    "🤡 Discord không thiếu tình yêu, chỉ thiếu người yêu mình thật lòng.",
    "💔 Có người xem Discord là nơi chơi game, có người xem là nơi thay người yêu theo từng season.",
    "🥀 Tình yêu Discord giống Nitro: hết hạn là mất quyền lợi.",
    "😆 \"Em chỉ nói chuyện với mình anh thôi.\" — 5 phút sau thấy đang ở voice room khác.",
    "🎭 Yêu trên Discord là bài kiểm tra niềm tin, còn kết quả thì toàn điểm liệt.",
    "📱 Tin nhắn thì ghim, lời hứa thì quên.",
    "🫠 Trên Discord ai cũng là \"bé cưng\", chỉ có mình là tưởng mình đặc biệt.",
    "🎮 Call đêm đến 4 giờ sáng không chứng minh được tình yêu, chỉ chứng minh cả hai đều chưa buồn ngủ.",
    "💀 Avatar đôi, bio đôi, status đôi... nhưng ngoài đời thì chẳng ai biết nhau là ai.",
    "🥲 Đừng ghen khi người yêu Discord rep chậm, biết đâu họ đang rep nhanh hơn với người khác.",
    "🤝 Discord giúp kết nối mọi người... và cũng giúp mọi người kết nối với người yêu của bạn.",
    "😌 Yêu Discord không đáng sợ, đáng sợ là nghĩ người kia cũng yêu mình như mình yêu họ.",
    "🚩 Cờ đỏ trên Discord không phải role màu đỏ, mà là câu \"Anh với nó chỉ là bạn\".",
    "💬 Một câu \"ngủ ngon\" được copy paste cho cả danh sách bạn bè.",
    "🗿 Voice call hàng nghìn giờ nhưng gặp mặt thì \"để khi nào có dịp\".",
    "🎪 Tình yêu Discord giống event giới hạn: lúc mới thì đông vui, hết event là chẳng còn ai nhớ.",
    "💙 Discord dạy tôi một điều: online không đồng nghĩa với thuộc về nhau.",
    "🥀 Voice cả đêm, sáng ra thành người dưng.",
    "🤡 \"Chỉ yêu mình em.\" Câu này chắc được bind vào Ctrl+C Ctrl+V.",
    "💀 Người yêu Discord hôm nay, người quen Discord ngày mai.",
    "🎭 Bio để tên nhau, DM lại để tên người khác.",
    "😮💨 Discord có chế độ Invisible, còn tình cảm thì biến mất thật.",
    "🚩 Cờ đỏ lớn nhất là: \"Anh thân với ai cũng vậy.\"",
    "🎧 Call 8 tiếng không bằng người khác nhắn \"ê\" một câu.",
    "📱 Tin nhắn ghim vẫn còn, người ghim đã đổi.",
    "🫠 Tưởng là ngoại lệ, hóa ra là ngoại tuyến.",
    "💔 Hứa gặp nhau ngoài đời, cuối cùng chỉ gặp nhau trong danh sách Block.",
    "🎮 Discord là nơi chơi game, không phải nơi chơi tim người khác.",
    "🤝 Chia tay xong vẫn chung server, đúng là định mệnh.",
    "😆 Người thay avatar còn nhanh hơn thay tính cách.",
    "🥲 \"Em ngủ đi.\" Xong quay sang call với người khác.",
    "💬 \"Anh bận.\" Nhưng trạng thái lại đang In Voice.",
    "🎪 Discord đông người, nhưng người thật lòng thì hiếm.",
    "😌 Người ta mất mạng còn quay lại, mất tình cảm thì không.",
    "🎭 Đừng tin avatar anime dễ thương, có khi cái miệng còn sắc hơn dao.",
    "💀 Một server, ba người yêu cũ.",
    "📢 Mối quan hệ bền nhất trên Discord là quyền Admin.",
    "🫡 Mỗi lần đổi nickname là mỗi lần đổi đối tượng.",
    "🎧 Tai nghe còn kết nối, trái tim thì mất tín hiệu.",
    "🚩 \"Anh coi em như em gái.\" Một tuần sau thấy cưới em gái khác.",
    "💙 Discord không thiếu người, chỉ thiếu người ở lại.",
    "🤡 Người ta sợ mất acc, còn mình sợ mất người.",
    "🥀 Nitro hết hạn còn mua lại được, lòng tin thì không.",
    "😶 \"Đừng suy nghĩ nhiều.\" Chính câu đó khiến suy nghĩ nhiều nhất.",
    "🎮 Chơi game thì thắng, yêu Discord thì toàn thua.",
    "💀 Cuối cùng cũng hiểu vì sao Discord có nút Disconnect.",
    "💔 Có những người vào Discord để chơi game, còn anh vào để sưu tầm người yêu.",
    "🎭 \"Em là duy nhất.\" Chỉ là duy nhất trong tối nay.",
    "🤡 Call với mình thì \"buồn ngủ\", call với người khác thì tới sáng.",
    "🥀 Discord không có tính năng hoàn tác, cũng như tình cảm đã mất.",
    "💀 Thứ online lâu nhất không phải tình yêu, mà là trạng thái \"Idle\".",
    "🎧 Hứa nghe giọng nhau cả đời, cuối cùng chỉ còn nghe tiếng leave voice.",
    "🚩 \"Anh không thích ai đâu.\" Đúng, anh thích tất cả.",
    "😮💨 Yêu trên Discord giống đánh rank, càng cố càng tụt.",
    "📱 Seen trong 1 giây, rep sau 1 ngày.",
    "🫠 Avatar đôi đẹp lắm, tiếc là mỗi tháng đổi một lần.",
    "💬 \"Đừng ghen.\" Ừ, chỉ là em đang ngồi trong lòng người khác thôi.",
    "🎮 Có người cày level, có người cày lòng tin... rồi mất cả hai.",
    "🤝 Chia tay văn minh nhất là lặng lẽ unfriend.",
    "🥀 Chỉ cần người mới vào server là người cũ thành quá khứ.",
    "💀 Discord lưu lịch sử chat, nhưng không lưu lời hứa.",
    "🎭 Người ta đổi theme Discord, còn anh đổi người yêu.",
    "😌 Em bảo bận học, nhưng voice lại full người.",
    "🎧 Mic bật cả đêm, tình cảm tắt từ lâu.",
    "🚩 \"Chỉ là bạn.\" Câu nói mở đầu cho mọi drama.",
    "🤡 Người thay đổi nhanh nhất không phải ping, mà là lòng người.",
    "💙 Hôm qua gọi là \"bé\", hôm nay gọi là \"bro\".",
    "📢 Discord có mute, tiếc là không mute được nỗi thất vọng.",
    "🥀 Người hứa không bỏ đi thường là người đi đầu tiên.",
    "😆 Tình yêu Discord giống giveaway, tưởng trúng mà hóa ra hụt.",
    "💔 Đến role cũng có màu riêng, còn mình thì chẳng có vị trí.",
    "🎮 Em bảo AFK, nhưng lại active ở voice khác.",
    "🫡 Càng thân càng dễ thành người lạ.",
    "💀 Đừng trách Discord, hãy trách người biết nói mà không biết giữ lời.",
    "🎭 Yêu Discord thì nhớ một điều: người ta có thể online với bạn, nhưng trái tim lại online ở nơi khác.",
    "🥀 Cuối cùng mới nhận ra, thứ ổn định nhất trên Discord là nút Leave Server.",
    "💀 Discord chỉ báo \"User is typing...\", chứ không bao giờ báo \"User is đang nói dối.\"",
    "🤡 Người ta bật cam để ngắm nhau, còn anh bật cam để người khác ngắm.",
    "🥀 Đừng yêu người có quá nhiều server, vì tim họ cũng nhiều slot như thế.",
    "🎧 Call với em là giải trí, call với người khác mới là ưu tiên.",
    "🚩 \"Em hiểu lầm rồi.\" Câu nói cứu cánh của mọi kẻ tệ bạc.",
    "💙 Người ta giữ streak trên Discord còn tốt hơn giữ lời hứa.",
    "📱 Đang nhắn tin với mình nhưng status lại \"Streaming\" cùng người khác.",
    "😮💨 Hôm qua còn gọi \"vợ\", hôm nay gọi người khác là \"bé\".",
    "🎭 Cái nhanh nhất trên Discord là tốc độ đổi đối tượng.",
    "💔 Hứa sẽ không bỏ đi, rồi lặng lẽ rời server không một lời.",
    "🤝 Discord kết nối hàng triệu người, nhưng chẳng kết nối nổi một tấm lòng thật.",
    "🥀 Anh nói em đặc biệt... đặc biệt giống những người trước.",
    "🎮 Càng nhiều role, càng ít trách nhiệm.",
    "🫠 Điều buồn nhất không phải bị block, mà là thấy họ vui với người khác.",
    "💀 Người yêu Discord giống event giới hạn: hết hứng là kết thúc.",
    "🎧 \"Anh đang bận.\" Nhưng voice room vẫn đủ chỗ cho người khác.",
    "🤡 Hóa ra em không phải người đến sau, chỉ là người đến đúng lượt.",
    "🚩 \"Đừng xem Last Seen.\" Vì sự thật còn đau hơn.",
    "💬 Có những đoạn chat dài cả ngàn tin nhắn, kết thúc bằng một chữ \"Ừ.\"",
    "🥀 Người ta xóa tin nhắn để quên, còn em đọc lại để đau.",
    "😆 Discord có thể khôi phục tài khoản, nhưng không khôi phục được niềm tin.",
    "💙 Yêu trên Discord giống ping @everyone, tưởng dành cho mình, hóa ra dành cho tất cả.",
    "🎭 Có người giỏi nói yêu, có người giỏi yêu. Hai kiểu đó hiếm khi là một.",
    "📢 Hôm nay là \"mine\", mai thành \"mutual\".",
    "💀 Điều đáng sợ nhất không phải ghost, mà là bị thay thế khi vẫn còn ở đó.",
    "🎮 Một cái Invite Link có thể kéo người mới vào, nhưng không kéo được người cũ quay lại.",
    "🥀 Họ không phản bội vì Discord, họ chỉ dùng Discord để phản bội.",
    "🤝 Mối quan hệ trên Discord bền nhất là... quyền Owner.",
    "😌 Người từng hứa \"không rời đi\" giờ chỉ còn trong danh sách thành viên cũ.",
    "💔 Cuối cùng, Discord vẫn ở đó... chỉ có người từng gọi là \"cả thế giới\" đã đổi nickname trong cuộc đời mình.",
    "💀 Discord không thiếu người để yêu, chỉ thiếu người biết dừng lại sau một lời hứa.",
    "🥀 Người ta bảo \"đừng yêu qua mạng\", mình không tin... đến khi trở thành bài học.",
    "🤡 Tưởng mình là Main Character, hóa ra chỉ là NPC trong câu chuyện của họ.",
    "🎭 Thứ dễ thay nhất trên Discord không phải avatar, mà là cách người ta đối xử với nhau.",
    "🚩 \"Anh chỉ đùa thôi.\" Câu nói dùng để chữa cháy sau khi làm người khác tổn thương.",
    "💙 Hôm nay em là người được @, ngày mai em chỉ còn là người xem lịch sử chat.",
    "📱 Có những cuộc trò chuyện dài cả tháng, nhưng chẳng đủ để đổi lấy một lần chân thành.",
    "🫠 Điều buồn nhất không phải bị xóa bạn, mà là nhận ra mình chưa từng là ưu tiên.",
    "🥀 Discord chỉ là ứng dụng, người khiến em thất vọng mới là vấn đề.",
    "☠️ Tình yêu Discord cũng như Wi-Fi công cộng: lúc đầu kết nối rất nhanh, dùng một thời gian mới biết... ai cũng đang truy cập.",
    "💀 TYDC à? Yêu nhau chưa đủ một tháng đã gọi nhau là \"chồng - vợ\", chia tay thì quay về \"bro\".",
    "🤡 TYDC là nơi lời hứa sống ngắn hơn thời hạn Nitro.",
    "🎭 Bảo \"chỉ yêu mình em\", Discord thì mở 15 tab DM.",
    "📶 Tình yêu của họ phụ thuộc vào Wi-Fi, không phải lòng chung thủy.",
    "🎤 Giọng thì 10 điểm, nhân cách chờ bản cập nhật.",
    "💌 Bio ghi \"Taken ❤️\", nhưng tim thì phát miễn phí cả server.",
    "👀 Mỗi server một người yêu, vẫn tự nhận mình chung tình.",
    "🎮 Leo rank không nổi nhưng leo vào tim người khác thì nhanh lắm.",
    "🚪 Hôm qua còn \"mãi mãi\", hôm nay \"User not found\".",
    "💔 Yêu nhau bằng avatar AI, chia tay vì bật camera.",
    "🤣 Discord không thiếu tình yêu, chỉ thiếu người không yêu cả server.",
    "🌚 Mới quen 3 ngày đã tính đặt tên con.",
    "🎭 Đổi avatar đôi còn nhanh hơn đổi tính nết.",
    "📱 Online 24/24 nhưng rep tin nhắn thì \"xin lỗi anh bận\".",
    "🐍 Miệng nói \"không thích drama\", chân chạy đầu tiên vào drama.",
    "💀 TYDC giống game thử nghiệm, update người yêu liên tục.",
    "🎪 Yêu nhau công khai để thiên hạ biết, chia tay âm thầm vì ngại quê.",
    "😂 Không phải yêu online, mà là sưu tầm người yêu online.",
    "📢 Ping @everyone còn ít hơn ping người yêu mỗi khi cãi nhau.",
    "🎨 Avatar đôi chỉ là dấu hiệu cho thấy sắp có avatar mới.",
    "🍿 TYDC không cần kết thúc đẹp, chỉ cần đủ drama để cả server hóng.",
    "🫠 Lúc tán thì \"em là duy nhất\", lúc chia tay thì \"coi nhau như bạn nhé\".",
    "🎯 Hứa cưới nhau sau này, hiện tại còn chưa biết tên thật.",
    "🎭 Yêu qua Discord nhưng diễn như nhận giải Oscar.",
    "🪞 Camera là máy phát hiện sự thật nhanh nhất của TYDC.",
    "💬 Một câu \"ngủ ngon ❤️\" gửi cho nhiều người thì vẫn là ngủ ngon mà.",
    "😶 Tình yêu online bền nhất là khi chưa ai đòi gặp mặt.",
    "🧃 Đừng gọi đó là tình yêu, gọi là \"đúng lúc đang cô đơn\".",
    "📉 Độ chung thủy tỉ lệ nghịch với số server đang tham gia.",
    "🧠 Điều duy nhất họ nhớ là UID của người yêu cũ.",
    "🔥 Discord là nơi biến \"em là tất cả\" thành \"ai đây?\".",
    "🤝 Chia tay xong vẫn chung server, nhưng block để tỏ vẻ trưởng thành.",
    "🗿 Nói ghét red flag, nhưng toàn yêu cột cờ.",
    "🎪 Drama TYDC nhiều hơn số tin nhắn yêu thật lòng.",
    "🥇 Huy chương vàng môn hứa hẹn thuộc về các cặp đôi Discord.",
    "💸 Nitro hết hạn còn gia hạn được, niềm tin thì không.",
    "📦 Tình yêu đóng gói bằng sticker, vận chuyển bằng lời hứa, nhận hàng là thất vọng.",
    "🌧️ TYDC: yêu nhanh, nhớ lâu, quên chậm, quay lại nhiều.",
    "🎭 Cả server biết hai đứa yêu nhau trước khi hai đứa kịp hiểu nhau.",
    "💀 Đừng hỏi TYDC có thật không. Hỏi xem nó tồn tại được bao lâu.",
    "💘 \"Anh chỉ thích mình em.\" — Phần còn lại nằm trong mục **Tin nhắn đang chờ.** 🤡",
    "🌹 \"Em là người cuối cùng.\" — Cuối cùng... của tuần này.",
    "💬 \"Anh không biết thả thính đâu.\" — Chỉ biết rải đại trà thôi.",
    "🥺 \"Anh nhớ em.\" — Gửi nhầm cho cả danh sách bạn bè.",
    "❤️ \"Em là ngoại lệ.\" — Ngoại lệ số 18.",
    "✨ \"Anh chưa từng rung động như thế.\" — Kể từ... tối qua.",
    "🌙 \"Ngủ ngon nha bé.\" — Tin nhắn mẫu, chỉ thay tên người nhận.",
    "💍 \"Sau này mình cưới nhé.\" — Sau khi cưới vài người trong tưởng tượng đã.",
    "🎭 \"Anh chỉ mở lòng với em.\" — Còn DM thì mở với cả server.",
    "📱 \"Anh bận thật mà.\" — Bận call với người khác.",
    "🎤 \"Giọng em dễ thương quá.\" — Câu này anh thuộc lòng rồi.",
    "💌 \"Em khác những người còn lại.\" — Vì người còn lại cũng được nghe câu này.",
    "🤍 \"Anh sẽ không bỏ em đâu.\" — Chỉ bỏ rep thôi.",
    "🫶 \"Anh yêu tính cách của em.\" — Vì mặt còn chưa thấy.",
    "🌸 \"Em là định mệnh.\" — Discord ghép chung voice thì thành định mệnh.",
    "🎮 \"Chơi game với em vui hơn.\" — Vì người kia chưa online.",
    "💖 \"Anh chỉ để ý mỗi em.\" — Nếu bỏ qua danh sách Following.",
    "🌹 \"Cho anh cơ hội nhé.\" — Để anh có thêm một người trong bio.",
    "😂 \"Anh nghiêm túc.\" — Nghiêm túc... mỗi lần tán.",
    "💀 Thả thính như dân chuyên nghiệp, giữ lời hứa như mạng 3G.",
    "🤡 Miệng thì rải thính, tim thì phát hành phiên bản dùng thử.",
    "🎣 Thính không thiếu, chỉ thiếu người chưa dính.",
    "🪝 Thả thính cả server rồi bảo \"anh hướng nội\".",
    "🍃 Gió thì không có, mà thính bay khắp nơi.",
    "🎪 Đừng trách cá cắn câu, trách mồi giống nhau quá.",
    "📦 Thính sản xuất hàng loạt, cảm xúc gia công.",
    "🎯 Không sợ hết thính, chỉ sợ hết người để thả.",
    "🗿 Thả thính như nghệ thuật, yêu thật như truyền thuyết.",
    "🚩 Red flag đẹp nhất là câu: \"Anh chỉ nói vậy với mình em.\""
];

const BIEN_SO_JOKES = {
    "11": { name: "Cao Bằng", joke: "11 Cao Bằng: Cao bằng cái gì thì không biết nhưng chắc chắn là cao hơn chiều cao của m." },
    "12": { name: "Lạng Sơn", joke: "12 Lạng Sơn: Lạnh thì có lạnh nhưng được cái mùa đông cũng lạnh nốt. Ai thích buôn lậu thì lên." },
    "14": { name: "Quảng Ninh", joke: "14 Quảng Ninh: Quê em biển gọi, vàng đen bạt ngàn. Dân 14 ra đường không mang tiền, mang than đi đổi đồ." },
    "15": { name: "Hải Phòng", joke: "15 Hải Phòng: Không lòng vòng, 15 điểm là đỗ đại học... à nhầm, Hải Phòng gắt lắm đừng đùa." },
    "16": { name: "Hải Phòng", joke: "16 Hải Phòng: Phượng hoa đỏ rực cháy, yêu thì chốt, không yêu thì rút để anh còn đi đua xe." },
    "17": { name: "Thái Bình", joke: "17 Thái Bình: Quê hương năm tấn, không ăn thua bằng 5 tỷ. Đất mỏ cày anh cày nát trái tim em." },
    "18": { name: "Nam Định", joke: "18 Nam Định: Phở ở đây thì ngon nhưng người Nam Định còn mặn hơn cả nước phở." },
    "19": { name: "Phú Thọ", joke: "19 Phú Thọ: Quê cha đất tổ, Hùng Vương giỗ tổ nhưng em vẫn chưa tìm được tổ ấm." },
    "20": { name: "Thái Nguyên", joke: "20 Thái Nguyên: Đệ nhất danh trà, uống xong thức trắng đêm tương tư người cũ." },
    "21": { name: "Yên Bái", joke: "21 Yên Bái: Trai Yên Bái bắt vợ siêu đỉnh, cẩn thận đi chơi không ngày về." },
    "22": { name: "Tuyên Quang", joke: "22 Tuyên Quang: Chè Thái gái Tuyên, nhưng nếu bạn xấu thì ở đâu cũng thế thôi." },
    "23": { name: "Hà Giang", joke: "23 Hà Giang: Leo đèo Mã Pí Lèng rớt tim ra ngoài, quay lại thấy em rớt vào tay thằng khác." },
    "24": { name: "Lào Cai", joke: "24 Lào Cai: Lên Sa Pa ngắm tuyết rơi mà lòng lạnh hơn cả thái độ của crush lúc seen không rep." },
    "25": { name: "Lai Châu", joke: "25 Lai Châu: Xa xôi hẻo lánh, đường vào tim em còn khó hơn đường lên Lai Châu." },
    "26": { name: "Sơn La", joke: "26 Sơn La: Mận Mộc Châu chua chua ngọt ngọt, giống hệt cái mỏ của em." },
    "27": { name: "Điện Biên", joke: "27 Điện Biên: Chấn động địa cầu năm xưa, còn bây giờ nhan sắc của 27 chấn động tim m." },
    "28": { name: "Hòa Bình", joke: "28 Hòa Bình: Thủy điện Hòa Bình xả lũ cũng không bằng em xả cơn giận." },
    "29": { name: "Hà Nội", joke: "29 Hà Nội: Đặc sản là trà đá vỉa hè và combo \"Mày biết bố mày là ai không?\"" },
    "30": { name: "Hà Nội", joke: "30 Hà Nội: Mùa thu Hà Nội hoa sữa thơm lừng... ngửi nhiều thì tiền đình luôn chứ lãng mạn gì." },
    "31": { name: "Hà Nội", joke: "31 Hà Nội: Tắc đường từ sáng đến tối, thanh xuân trôi qua ở ngã tư Sở." },
    "32": { name: "Hà Nội", joke: "32 Hà Nội: Ra đường ngắm phố cổ, lên Tạ Hiện uống bia ngắm mấy em xập xình." },
    "33": { name: "Hà Nội", joke: "33 Hà Tây (cũ): Từ ngày sáp nhập, mang tiếng trai thủ đô mà vẫn phải chăn bò." },
    "34": { name: "Hải Dương", joke: "34 Hải Dương: Bánh đậu xanh ăn vào nghẹn thở, nhưng nghẹn thở nhất là khi thấy m rep tin nhắn." },
    "35": { name: "Ninh Bình", joke: "35 Ninh Bình: Cơm cháy thịt dê, ăn xong dê hay không thì không biết nhưng chắc chắn là mập." },
    "36": { name: "Thanh Hóa", joke: "36 Thanh Hóa: Vương quốc Nem Chua. Cẩn thận không lại bị ăn hoa thanh táo." },
    "37": { name: "Nghệ An", joke: "37 Nghệ An: Cá gỗ truyền thuyết, nhà có con lợn mập nhưng nhất quyết bán lấy tiền mua SH." },
    "38": { name: "Hà Tĩnh", joke: "38 Hà Tĩnh: Kẹo cu đơ cứng ngắc gãy cả răng, tình yêu quê mi cũng cứng cỏi như rứa." },
    "39": { name: "Đồng Nai", joke: "39 Đồng Nai: Dân Biên Hòa ra đường không sợ bố con thằng nào, chỉ sợ hugo." },
    "40": { name: "Hà Nội", joke: "40 Hà Nội: Biển mới đét. Ra đường vẫn tắc y chang biển 29." },
    "41": { name: "TP. Hồ Chí Minh", joke: "41 Sài Gòn: Biển 41 ra đường lạng lách đánh võng vẫn bị kẹt xe ở vòng xoay Dân Chủ." },
    "43": { name: "Đà Nẵng", joke: "43 Đà Nẵng: Thành phố đáng sống... trừ khi bạn không có tiền." },
    "47": { name: "Đắk Lắk", joke: "47 Đắk Lắk: Sinh ra ở đây auto biết cưỡi voi đi học, đừng chối nữa." },
    "48": { name: "Đắk Nông", joke: "48 Đắk Nông: Đường đất đỏ mù mịt, đi một vòng về áo trắng thành áo cam." },
    "49": { name: "Lâm Đồng", joke: "49 Lâm Đồng: Lên Đà Lạt đi 2 về 1, lời nguyền chưa bao giờ sai. Đi chung cho cố rồi sừng dài cả mét." },
    "50": { name: "TP. Hồ Chí Minh", joke: "50 Sài Gòn: Đặc sản là kẹt xe, ngập nước, và những cơn mưa tới nhanh hơn cách người yêu cũ trở mặt." },
    "51": { name: "TP. Hồ Chí Minh", joke: "51 Sài Gòn: Hoa lệ: hoa cho người giàu, lệ rơi cho kẻ kẹt xe 1 tiếng đồng hồ ở đường Cộng Hòa." },
    "52": { name: "TP. Hồ Chí Minh", joke: "52 Sài Gòn: Ngồi cafe bệt 15 cành mà view triệu đô lầu 81 tầng." },
    "53": { name: "TP. Hồ Chí Minh", joke: "53 Sài Gòn: Ra đường trưa 12h nắng cháy da cá sấu, chỉ muốn kiếm quán bún đậu mắm tôm máy lạnh." },
    "54": { name: "TP. Hồ Chí Minh", joke: "54 Sài Gòn: Anh ba khía lên Sài Gòn mang theo ước mơ... cuối cùng đi chạy xe ôm công nghệ." },
    "55": { name: "TP. Hồ Chí Minh", joke: "55 Sài Gòn: Cầm 10k ra đường mua được ổ bánh mì không, xin thêm tí nước tương mặn chát như tình đời." },
    "56": { name: "TP. Hồ Chí Minh", joke: "56 Sài Gòn: Đi ăn cơm tấm sườn bì chả mà miếng sườn mỏng hơn tờ giấy." },
    "57": { name: "TP. Hồ Chí Minh", joke: "57 Sài Gòn: Chạy xe ngang Phạm Văn Đồng auto quẹo cổ vì gái xinh rợp trời." },
    "58": { name: "TP. Hồ Chí Minh", joke: "58 Sài Gòn: Dân 58 lướt phố Nguyễn Huệ bằng con SH mượn của bạn." },
    "59": { name: "TP. Hồ Chí Minh", joke: "59 Sài Gòn: Gái 59 đỏng đảnh khó chiều nhưng lên xe là ngoan ngoãn liền." },
    "60": { name: "Đồng Nai", joke: "60 Đồng Nai: Thủ phủ khu công nghiệp. Tiếng còi tan tầm là bản giao hưởng quê hương." },
    "61": { name: "Bình Dương", joke: "61 Bình Dương: Gotham của Việt Nam. Chuyện gì kì dị nhất cũng bắt nguồn từ Bình Dương." },
    "62": { name: "Long An", joke: "62 Long An: Rượu đế Gò Đen uống xong cháy họng, tỉnh dậy thấy đang nằm dưới mương." },
    "63": { name: "Tiền Giang", joke: "63 Tiền Giang: Hủ tiếu Mỹ Tho ngon nức nở, trai Tiền Giang thì cưa hoài không đổ." },
    "64": { name: "Vĩnh Long", joke: "64 Vĩnh Long: Đi chợ nổi Trà Ôn dòm trái cây thì ít mà dòm mấy anh chèo ghe thì nhiều." },
    "65": { name: "Cần Thơ", joke: "65 Cần Thơ: Gạo trắng nước trong. Ai đi đến đó... say sml vì nhậu quá nhiều." },
    "66": { name: "Đồng Tháp", joke: "66 Đồng Tháp: Tháp Mười đẹp nhất bông sen, Đồng Tháp đẹp nhất mấy ẻm miền Tây chèo xuồng." },
    "67": { name: "An Giang", joke: "67 An Giang: Miếu Bà Chúa Xứ đông kinh hồn, đi xin xăm mà mém bị đè bẹp." },
    "68": { name: "Kiên Giang", joke: "68 Kiên Giang: Ra Phú Quốc tắm biển mặn lòi, đi hít thở không khí cũng tốn chục củ." },
    "69": { name: "Cà Mau", joke: "69 Cà Mau: Đất mũi xa xôi, cua Cà Mau bự bằng cái mặt m, kẹp một phát là đau thấu trời xanh." },
    "70": { name: "Tây Ninh", joke: "70 Tây Ninh: Không có biển mà bán toàn muối tôm. Bánh tráng phơi sương nhai muốn rớt cái quai hàm." },
    "71": { name: "Bến Tre", joke: "71 Bến Tre: Bến Tre toàn dừa. Lấy chồng Bến Tre ngày nào cũng bị ăn kẹo dừa dính răng." },
    "72": { name: "Bà Rịa - Vũng Tàu", joke: "72 Vũng Tàu: Ngày lễ chạy xuống Vũng Tàu tắm... người chứ làm gì có nước mà tắm biển." },
    "73": { name: "Quảng Bình", joke: "73 Quảng Bình: Gió Lào thổi bay luôn cả tóc giả, nắng vỡ đầu, được cái hang Sơn Đoòng cứu vớt." },
    "74": { name: "Quảng Trị", joke: "74 Quảng Trị: Nơi thời tiết cực đoan nhất VN. Mùa đông lạnh quéo, mùa hè nực cháy cả da." },
    "75": { name: "Thừa Thiên Huế", joke: "75 Huế: Mưa Huế rơi thúi đất thúi đai. Dân Huế nói rứa mà nỏ phải rứa mô." },
    "76": { name: "Quảng Ngãi", joke: "76 Quảng Ngãi: Tỏi Lý Sơn hôi mồm nhưng tốt cho sức khỏe. Người Quảng nói nghe đau hết cả tai." },
    "77": { name: "Bình Định", joke: "77 Bình Định: Đất võ Tây Sơn. Cưới vợ Bình Định xác định cãi nhau nó múa cho vài đường quyền." },
    "78": { name: "Phú Yên", joke: "78 Phú Yên: Hoa vàng trên cỏ xanh. Nắng thì gắt mà đen hết cả người." },
    "79": { name: "Khánh Hòa", joke: "79 Nha Trang: Yến sào đại bổ, ăn xong chỉ muốn đi bơi bùn cho mát." },
    "81": { name: "Gia Lai", joke: "81 Gia Lai: Đôi mắt Pleiku biển hồ đầy... đầy bụi. Nắng gió Tây Nguyên thổi bay não." },
    "82": { name: "Kon Tum", joke: "82 Kon Tum: Gà gáy ngã ba Đông Dương ba nước nghe. Buồn buồn xách xe lạng sang Lào chơi." },
    "83": { name: "Sóc Trăng", joke: "83 Sóc Trăng: Ăn bánh pía uống trà, ngửi mùi sầu riêng là chạy 8 cây số." },
    "84": { name: "Trà Vinh", joke: "84 Trà Vinh: Chùa Miên khắp nơi, đi vòng vòng không khéo bị hốt đi tu luôn." },
    "85": { name: "Ninh Thuận", joke: "85 Ninh Thuận: Nắng như phang, gió như rang. Ai da trắng đến Ninh Thuận xong auto đen nhẻm." },
    "86": { name: "Bình Thuận", joke: "86 Bình Thuận: Xứ sở thanh long. Nhà không có gì ngoài thanh long, ăn đến mức 💩 cũng có hột." },
    "88": { name: "Vĩnh Phúc", joke: "88 Vĩnh Phúc: Dân chơi 88 phóng xe lên Tam Đảo đổ đèo rát mặt, khét lẹt phanh mòn bánh." },
    "89": { name: "Hưng Yên", joke: "89 Hưng Yên: Nhãn lồng tiến vua. Ăn nhãn nhiều nóng trong người, hay quạo vô cớ." },
    "90": { name: "Hà Nam", joke: "90 Hà Nam: Quê hương Chí Phèo. Ở đây thiếu gì thì thiếu chứ không thiếu rạch mặt ăn vạ." },
    "92": { name: "Quảng Nam", joke: "92 Quảng Nam: Mì Quảng ăn bao ngon. Hội An thu tiền vé bị chửi te tua một thời." },
    "93": { name: "Bình Phước", joke: "93 Bình Phước: Đại gia cao su. Đi làm nông mà tiền rớt vô đầu cái bịch bịch bịch." },
    "94": { name: "Bạc Liêu", joke: "94 Bạc Liêu: Công tử Bạc Liêu đốt tiền nấu trứng. Giờ trai Bạc Liêu toàn đốt tiền vô game." },
    "95": { name: "Hậu Giang", joke: "95 Hậu Giang: Kênh rạch chằng chịt, qua phà rớt mẹ đôi dép." },
    "97": { name: "Bắc Kạn", joke: "97 Bắc Kạn: Rừng thiêng nước độc, đi lơ ngơ trên hồ Ba Bể coi chừng mất mạng... 4G." },
    "98": { name: "Bắc Giang", joke: "98 Bắc Giang: Vương quốc vải thiều. Đến mùa vải rẻ như cho, bóc mỏi cả tay." },
    "99": { name: "Bắc Ninh", joke: "99 Bắc Ninh: Quê hương quan họ. Nhà nhà làm xưởng, ai cũng giàu nứt vách, mỗi tội không có người yêu." }
};

let QUOTES_THINH = [];
try {
    const thinhData = fs.readFileSync(path.join(__dirname, 'thinh_genz.txt'), 'utf8');
    QUOTES_THINH = thinhData.split('\n').map(line => line.trim()).filter(line => line.length > 0);
} catch (e) {
    console.error('Không thể đọc file thinh_genz.txt:', e);
    QUOTES_THINH = [
        "Muốn bình yên thì lên chùa cầu phúc. Muốn hạnh phúc thì đứng đó chờ em.",
        "Anh ơi gió lạnh cận kề, bao nhiêu lớp áo không bằng love em."
    ];
}

const IMAGES_THINH = [
    "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdW5pOTk5eGRnNmV0b2FyeTB6dXV4Mm5lOWg3cnAwaGR1Z202enhybSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/26BRv0ThflsHCIChy/giphy.gif",
    "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExeGJyMXFmbXZwbzNpd3pkaTRtbndxODRoc3UybmN3ZnI3amZ3ZGhyZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3CCXHZWV6F6O9VQ7FL/giphy.gif",
    "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNmQ1cXZiMTB3Mjd1bHh5dndmNHhwbGR6dHJ5cm9xMzQ4YnVtbXV6ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/MDJ9IbxxvDUQM/giphy.gif",
    "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExMjMzdWhvOTcxd2I3ODk0cXA4czEzb3FqNzNjdWZvNGcwaDN3OWgybSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/LqO7P1Wk3J2bC/giphy.gif",
    "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExbDVqNzFnOHIycmF2bzI0bmN0bnYxdnExaHJ3cmI2Ym9oZjAzaHRuNSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/osjgQPWRx3cac/giphy.gif",
    "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExZjIyZXY5d3g2NWQyeWg3OW9mNXRzOTkycGhpMXZ1aGNpdjlvcnFmNSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/gSotjtzJaI2OQ/giphy.gif"
];

const QUE_TINH_DUYEN = [
    "Đại Cát: Hôm nay tình duyên rực rỡ, crush sẽ chủ động nhắn tin cho bạn!",
    "Trung Cát: Tình duyên bình ổn, có người đang thầm thương trộm nhớ bạn đấy.",
    "Tiểu Cát: Có cơ hội gặp gỡ người mới, hãy tích cực ra ngoài nhé.",
    "Bình Hòa: Chuyện tình cảm hôm nay bình thường, nên tập trung vào sự nghiệp.",
    "Tiểu Hung: Cẩn thận lời ăn tiếng nói, dễ cãi nhau với người ấy.",
    "Đại Hung: Hôm nay cẩn thận gặp trap boy/trap girl, tuyệt đối không được lụy tình!",
    "Đặc Biệt: Thần Cupid đã giương cung, bạn chuẩn bị trúng tiếng sét ái tình đi là vừa!"
];

const MARRY_RINGS = {
    'grass': { name: 'Nhẫn Cỏ Dại', price: 10000000, emoji: '🌿' },
    'silver': { name: 'Nhẫn Bạc Thô', price: 20000000, emoji: '🥈' },
    'gold': { name: 'Nhẫn Vàng Cổ Điển', price: 30000000, emoji: '🥇' },
    'ruby': { name: 'Nhẫn Hồng Ngọc Đam Mê', price: 45000000, emoji: '💖' },
    'sapphire': { name: 'Nhẫn Lam Ngọc Thuỷ Chung', price: 60000000, emoji: '💙' },
    'emerald': { name: 'Nhẫn Ngọc Lục Bảo Hy Vọng', price: 75000000, emoji: '💚' },
    'diamond': { name: 'Nhẫn Kim Cương Lấp Lánh', price: 90000000, emoji: '💎' },
    'amethyst': { name: 'Nhẫn Tử Tinh Mộng Mơ', price: 110000000, emoji: '💜' },
    'obsidian': { name: 'Nhẫn Hắc Diện Thạch Bí Ẩn', price: 130000000, emoji: '🖤' },
    'infinity': { name: 'Nhẫn Quyền Năng Vô Cực', price: 150000000, emoji: '👑' },
    'eternal': { name: 'Nhẫn Tình Yêu Vĩnh Cửu', price: 175000000, emoji: '💞' },
    'celestial': { name: 'Nhẫn Tinh Tú Thiên Hà', price: 200000000, emoji: '🌌' }
};

async function handleMarry(userId, targetId, msgOrInteraction) {
    const channel = msgOrInteraction.channel;

    let finalTargetId = targetId;

    if (!finalTargetId) {
        try {
            const guild = msgOrInteraction.guild;
            await guild.members.fetch();
            const members = guild.members.cache.filter(m => !m.user.bot && m.user.id !== userId);
            if (members.size === 0) return replyMsg(msgOrInteraction, '❌ Trong server không có ai khác để ghép đôi!');
            finalTargetId = members.random().user.id;
        } catch (e) {
            return replyMsg(msgOrInteraction, '❌ Lỗi khi tìm kiếm người ghép đôi!');
        }
    }

    if (userId === finalTargetId) return replyMsg(msgOrInteraction, '❌ Bạn không thể tự cưới chính mình!');
    if (finalTargetId === msgOrInteraction.client?.user?.id) return replyMsg(msgOrInteraction, '❌ Tôi là Bot, chúng ta không hợp đâu!');
    
    const p1 = getPlayer(userId);
    const p2 = getPlayer(finalTargetId);
    
    if (p1.partner) return replyMsg(msgOrInteraction, '❌ Bạn đã kết hôn rồi! Muốn cưới người mới thì ly hôn trước đi!');
    if (p2.partner) return replyMsg(msgOrInteraction, '❌ Người ấy đã có nơi có chốn rồi. Xin đừng làm người thứ ba!');
    
    const embed = new EmbedBuilder()
        .setTitle('💍 Chọn Nhẫn Cầu Hôn')
        .setDescription(`Để cầu hôn <@${finalTargetId}>, bạn cần chuẩn bị một chiếc nhẫn thật xứng đáng.\nHãy chọn loại nhẫn bạn muốn trao:`)
        .setColor('#FF69B4');
        
    const options = [];
    if (p1.rings) {
        for (const [id, count] of Object.entries(p1.rings)) {
            if (count > 0 && MARRY_RINGS[id]) {
                const r = MARRY_RINGS[id];
                options.push(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(`${r.name}`)
                        .setValue(id)
                        .setDescription(`Số lượng đang có: ${count}`)
                        .setEmoji(r.emoji)
                );
            }
        }
    }

    if (options.length === 0) {
        return replyMsg(msgOrInteraction, '❌ Bạn chưa có chiếc nhẫn nào trong túi! Hãy dùng lệnh `/shop` hoặc `!shop` để mua nhẫn trước khi đi cầu hôn nhé!');
    }

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`marry_ring_${userId}_${finalTargetId}`).setPlaceholder('💍 Chọn nhẫn...').addOptions(options)
    );
        
    return replyMsg(msgOrInteraction, { embeds: [embed], components: [row] });
}

async function handleSetBday(userId, msgOrInteraction, dateStr) {
    if (!dateStr || !/^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])$/.test(dateStr)) {
        return replyMsg(msgOrInteraction, '❌ Định dạng ngày tháng không hợp lệ! Vui lòng dùng định dạng **DD/MM** (ví dụ: 29/03).');
    }
    const p = getPlayer(userId);
    if (p.birthday) {
        return replyMsg(msgOrInteraction, `❌ Bạn đã cài đặt sinh nhật là **${p.birthday}** rồi! Không thể thay đổi được nữa. Nếu cần đổi, hãy nhờ Admin nhé!`);
    }
    updatePlayer(userId, dp => {
        dp.birthday = dateStr;
    });
    return replyMsg(msgOrInteraction, `🎉 Cài đặt sinh nhật thành công! Bot đã ghi nhận sinh nhật của bạn là **${dateStr}**.\nĐến ngày đó hãy gõ \`/profile\` để nhận bất ngờ nhé!`);
}

async function handleDivorce(userId, msgOrInteraction) {
    const p = getPlayer(userId);
    if (!p.partner) return replyMsg(msgOrInteraction, '❌ Bạn còn đang ế, ly hôn với ai?');
    
    const partnerId = p.partner;
    const DIVORCE_FEE = 1000000;
    
    if (getUserCoins(userId) < DIVORCE_FEE) {
        return replyMsg(msgOrInteraction, `❌ Thuê luật sư ly hôn tốn **${DIVORCE_FEE.toLocaleString()} 🪙**. Bạn không đủ tiền trả án phí!`);
    }
    
    // Deduct fee first
    addCoins(userId, -DIVORCE_FEE);
    
    // Clear partner status
    updatePlayer(userId, dp => dp.partner = null);
    updatePlayer(partnerId, dp => dp.partner = null);
    
    // Phân chia tài sản (Coins & Bank)
    const cData = loadCoins();
    if (!cData[userId]) cData[userId] = { coins: 0, bank: 0, lastDaily: 0 };
    if (!cData[partnerId]) cData[partnerId] = { coins: 0, bank: 0, lastDaily: 0 };
    
    const totalCoins = (cData[userId].coins || 0) + (cData[partnerId].coins || 0);
    const totalBank = (cData[userId].bank || 0) + (cData[partnerId].bank || 0);
    
    const halfCoins = Math.floor(totalCoins / 2);
    const halfBank = Math.floor(totalBank / 2);
    
    cData[userId].coins = halfCoins;
    cData[partnerId].coins = totalCoins - halfCoins; // Give the remainder to partner
    
    cData[userId].bank = halfBank;
    cData[partnerId].bank = totalBank - halfBank;
    
    saveCoins(cData);
    
    return replyMsg(msgOrInteraction, `💔 Đã nộp ${DIVORCE_FEE.toLocaleString()} 🪙 án phí. Bạn và <@${partnerId}> đã chính thức đường ai nấy đi!\n⚖️ **Phân chia tài sản:** Toàn bộ Tiền mặt và Ngân hàng đã được gộp chung và cưa đôi. Mỗi người nhận **${halfCoins.toLocaleString()} 🪙** tiền mặt và **${halfBank.toLocaleString()} 🪙** trong ngân hàng.`);
}



async function handleAdminCheat(userId, msgOrInteraction) {
    if (userId !== ADMIN_ID) return replyMsg(msgOrInteraction, '❌ Bạn không phải là Hệ Thống (Developer)!');
    
    const cData = loadCoins();
    const isCheatOn = cData[ADMIN_ID]?.alwaysWin === true;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('admin_toggle_cheat')
            .setLabel(isCheatOn ? 'TẮT CHEAT' : 'BẬT CHEAT')
            .setStyle(isCheatOn ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji('👑')
    );
    
    const embed = new EmbedBuilder()
        .setTitle('👑 Bảng Điều Khiển Tối Cao')
        .setDescription('Chào mừng ngài trở lại. Xin hãy chọn quyền năng ngài muốn sử dụng hôm nay.')
        .setColor('#000000');
        
    return replyMsg(msgOrInteraction, { embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

// ========================
// WEREWOLF GAME STATE
// ========================
const wwGames = new Map(); // channelId -> GameState
const WW_ROLES = { 
    WOLF: 'Ma Sói 🐺', 
    WOLF_CUB: 'Sói Con 🐶',
    SEER: 'Tiên Tri 🔮', 
    GUARD: 'Bảo Vệ 🛡️', 
    WITCH: 'Phù Thủy 🧪',
    HUNTER: 'Thợ Săn 🔫',
    IDIOT: 'Thằng Ngốc 🤡',
    FOOL: 'Kẻ Khờ 🃏',
    VILLAGER: 'Dân Làng 🧑‍🌾' 
};

function initWWGame(channelId, hostId) {
    if (wwGames.has(channelId)) return false;
    wwGames.set(channelId, {
        channelId,
        hostId,
        status: 'LOBBY', // LOBBY, NIGHT, DAY, HUNTER_SHOOT
        players: new Map(), // userId -> { id, user, role, alive, protected, potionSave, potionKill, idiotRevealed }
        day: 0,
        nightActions: { wolfVotes: new Map(), wolfCubKilled: false, guardTarget: null, seerTarget: null, witchSave: false, witchKill: null },
        dayVotes: new Map(),
        msgRef: null,
        timer: null,
        hunterId: null
    });
    return true;
}

function assignRoles(playerIds) {
    let shuffled = [...playerIds].sort(() => 0.5 - Math.random());
    let roles = [];
    const count = shuffled.length;
    
    // Advanced role distribution
    if (count <= 4) roles = [WW_ROLES.WOLF, WW_ROLES.SEER, WW_ROLES.GUARD, WW_ROLES.VILLAGER];
    else if (count === 5) roles = [WW_ROLES.WOLF, WW_ROLES.SEER, WW_ROLES.GUARD, WW_ROLES.WITCH, WW_ROLES.VILLAGER];
    else if (count === 6) roles = [WW_ROLES.WOLF, WW_ROLES.WOLF_CUB, WW_ROLES.SEER, WW_ROLES.GUARD, WW_ROLES.WITCH, WW_ROLES.HUNTER];
    else if (count === 7) roles = [WW_ROLES.WOLF, WW_ROLES.WOLF_CUB, WW_ROLES.SEER, WW_ROLES.GUARD, WW_ROLES.WITCH, WW_ROLES.HUNTER, WW_ROLES.FOOL];
    else if (count === 8) roles = [WW_ROLES.WOLF, WW_ROLES.WOLF, WW_ROLES.WOLF_CUB, WW_ROLES.SEER, WW_ROLES.GUARD, WW_ROLES.WITCH, WW_ROLES.HUNTER, WW_ROLES.IDIOT];
    else {
        const wolves = Math.floor(count / 3);
        roles.push(WW_ROLES.WOLF_CUB);
        for(let i=0; i<wolves-1; i++) roles.push(WW_ROLES.WOLF);
        roles.push(WW_ROLES.SEER, WW_ROLES.GUARD, WW_ROLES.WITCH, WW_ROLES.HUNTER, WW_ROLES.IDIOT, WW_ROLES.FOOL);
        while(roles.length < count) roles.push(WW_ROLES.VILLAGER);
    }
    
    const assignment = new Map();
    for (let i = 0; i < count; i++) {
        assignment.set(shuffled[i], roles[i]);
    }
    return assignment;
}

async function startNightPhase(game, client) {
    game.status = 'NIGHT';
    game.day++;
    game.nightActions = { wolfVotes: new Map(), wolfCubKilled: game.nightActions.wolfCubKilled, guardTarget: null, seerTarget: null, witchSave: false, witchKill: null };
    game.dayVotes.clear();
    for (const p of game.players.values()) { p.protected = false; }
    
    const channel = client.channels.cache.get(game.channelId);
    if (!channel) return;
    
    const embed = new EmbedBuilder().setTitle(`🌙 ĐÊM THỨ ${game.day}`)
        .setDescription('Màn đêm đã buông xuống. Tất cả đi ngủ.\nCác chức năng hãy thức dậy và sử dụng kỹ năng của mình!')
        .setColor('#2C3E50');
        
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ww_action_${game.channelId}`).setLabel('Sử Dụng Kỹ Năng').setStyle(ButtonStyle.Primary).setEmoji('🌃')
    );
    
    game.msgRef = await channel.send({ embeds: [embed], components: [row] });
    game.timer = setTimeout(() => resolveNight(game, client), 45000); // 45s night
}

async function resolveNight(game, client) {
    const channel = client.channels.cache.get(game.channelId);
    if (!channel) { wwGames.delete(game.channelId); return; }
    if (game.msgRef) await game.msgRef.edit({ components: [] }).catch(()=>{});
    
    // Resolve Wolves
    let targetVotes = new Map();
    for (const targetId of game.nightActions.wolfVotes.values()) {
        targetVotes.set(targetId, (targetVotes.get(targetId) || 0) + 1);
    }
    let maxVotes = 0; let victimId1 = null; let victimId2 = null;
    
    // If Wolf Cub was killed previous cycle, wolves can kill 2 targets. Currently, we just pick the top 1 or 2 voted.
    // For simplicity, wolves vote, and we pick the top voted. If wolfCubKilled is true, we pick top 2.
    let sortedTargets = Array.from(targetVotes.entries()).sort((a,b)=>b[1]-a[1]);
    if (sortedTargets.length > 0) victimId1 = sortedTargets[0][0];
    if (game.nightActions.wolfCubKilled && sortedTargets.length > 1) victimId2 = sortedTargets[1][0];
    game.nightActions.wolfCubKilled = false; // reset
    
    let nightReport = `☀️ **TRỜI SÁNG RỒI! MỌI NGƯỜI DẬY ĐI!** ☀️\n\n`;
    let deaths = [];
    
    let victims = [victimId1, victimId2].filter(x => x);
    
    // Process Witch save
    if (game.nightActions.witchSave && victims.length > 0) {
        victims.shift(); // Save the first victim
    }
    
    // Process Guard
    victims = victims.filter(vId => vId !== game.nightActions.guardTarget);
    
    // Process Witch kill
    if (game.nightActions.witchKill) {
        if (!victims.includes(game.nightActions.witchKill)) victims.push(game.nightActions.witchKill);
    }
    
    for (const vId of victims) {
        const victim = game.players.get(vId);
        if (victim && victim.alive) {
            victim.alive = false;
            deaths.push(vId);
            if (victim.role === WW_ROLES.WOLF_CUB) game.nightActions.wolfCubKilled = true;
        }
    }
    
    if (deaths.length > 0) {
        nightReport += `Đêm qua, có **${deaths.length}** người đã chết:\n`;
        deaths.forEach(d => nightReport += `- <@${d}>\n`);
    } else {
        nightReport += `Đêm qua bình yên vô sự! 🌙\n`;
    }
    
    channel.send({ embeds: [new EmbedBuilder().setDescription(nightReport).setColor('#F1C40F')] });
    if (checkWWEnd(game, channel)) return;
    
    // Check if Hunter died
    const deadHunters = deaths.filter(d => game.players.get(d).role === WW_ROLES.HUNTER);
    if (deadHunters.length > 0) {
        handleHunterShoot(game, client, deadHunters[0]);
    } else {
        startDayPhase(game, client);
    }
}

async function handleHunterShoot(game, client, hunterId) {
    game.status = 'HUNTER_SHOOT';
    game.hunterId = hunterId;
    const channel = client.channels.cache.get(game.channelId);
    if (!channel) return;
    
    const alivePlayers = Array.from(game.players.values()).filter(p => p.alive);
    const options = alivePlayers.map(p => ({ label: p.user.username, value: p.id }));
    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`ww_hunter_${game.channelId}`).setPlaceholder('Thợ Săn chọn người để bắn chết!').addOptions(options)
    );
    
    game.msgRef = await channel.send({ content: `🔫 <@${hunterId}> (Thợ Săn) trước khi chết có quyền kéo theo một người! Hãy chọn mục tiêu trong 30s:`, components: [row] });
    game.timer = setTimeout(() => {
        channel.send(`⏳ Thợ Săn đã không nhắm bắn ai kịp thời!`);
        if (!checkWWEnd(game, channel)) startDayPhase(game, client);
    }, 30000);
}

async function startDayPhase(game, client) {
    game.status = 'DAY';
    const channel = client.channels.cache.get(game.channelId);
    if (!channel) return;
    
    const alivePlayers = Array.from(game.players.values()).filter(p => p.alive && p.role !== WW_ROLES.IDIOT || (p.role === WW_ROLES.IDIOT && p.alive && !p.idiotRevealed));
    // Idiot loses vote if revealed
    
    const options = alivePlayers.map(p => ({ label: p.user.username, value: p.id }));
    options.push({ label: 'Skip Vote', value: 'skip' });
    
    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`ww_vote_${game.channelId}`).setPlaceholder('Chọn người để treo cổ...').addOptions(options)
    );
    
    game.msgRef = await channel.send({ embeds: [new EmbedBuilder().setTitle(`☀️ NGÀY THỨ ${game.day} - THẢO LUẬN & VOTE`).setDescription('Các bạn có 60 giây để thảo luận và treo cổ kẻ tình nghi!').setColor('#F1C40F')], components: [row] });
    game.timer = setTimeout(() => resolveDay(game, client), 60000);
}

async function resolveDay(game, client) {
    const channel = client.channels.cache.get(game.channelId);
    if (!channel) return;
    if (game.msgRef) await game.msgRef.edit({ components: [] }).catch(()=>{});
    
    let targetVotes = new Map();
    for (const targetId of game.dayVotes.values()) targetVotes.set(targetId, (targetVotes.get(targetId) || 0) + 1);
    
    let maxVotes = 0; let victimId = null; let isTie = false;
    for (const [tId, v] of targetVotes.entries()) {
        if (v > maxVotes) { maxVotes = v; victimId = tId; isTie = false; }
        else if (v === maxVotes) { isTie = true; }
    }
    
    let dayReport = `⚖️ **KẾT QUẢ VOTE** ⚖️\n`;
    if (!victimId || isTie || victimId === 'skip') {
        dayReport += `Dân làng không thể thống nhất ý kiến. Không ai bị treo cổ hôm nay!\n`;
        channel.send({ embeds: [new EmbedBuilder().setDescription(dayReport).setColor('#E74C3C')] });
        if (checkWWEnd(game, channel)) return;
        startNightPhase(game, client);
        return;
    } 
    
    const victim = game.players.get(victimId);
    
    if (victim.role === WW_ROLES.FOOL) {
        dayReport += `🤡 <@${victimId}> đã bị treo cổ! NHƯNG HẮN LÀ **KẺ KHỜ**!\nTrò chơi kết thúc, Kẻ Khờ đã đánh lừa tất cả và giành chiến thắng một mình!`;
        channel.send({ embeds: [new EmbedBuilder().setDescription(dayReport).setColor('#9B59B6')] });
        revealRoles(game, channel);
        wwGames.delete(game.channelId);
        return;
    }
    
    if (victim.role === WW_ROLES.IDIOT && !victim.idiotRevealed) {
        victim.idiotRevealed = true;
        dayReport += `🤡 <@${victimId}> đã bị mang ra treo cổ! Nhưng mọi người nhận ra hắn chỉ là **Thằng Ngốc**!\nThằng Ngốc được tha mạng, nhưng từ nay sẽ bị tước quyền biểu quyết.`;
        channel.send({ embeds: [new EmbedBuilder().setDescription(dayReport).setColor('#E74C3C')] });
        if (checkWWEnd(game, channel)) return;
        startNightPhase(game, client);
        return;
    }
    
    victim.alive = false;
    dayReport += `<@${victimId}> đã bị dân làng treo cổ! 🪢\n`;
    if (victim.role === WW_ROLES.WOLF_CUB) game.nightActions.wolfCubKilled = true;
    channel.send({ embeds: [new EmbedBuilder().setDescription(dayReport).setColor('#E74C3C')] });
    
    if (checkWWEnd(game, channel)) return;
    
    if (victim.role === WW_ROLES.HUNTER) {
        handleHunterShoot(game, client, victimId);
    } else {
        startNightPhase(game, client);
    }
}

function checkWWEnd(game, channel) {
    let wolves = 0; let villagers = 0;
    for (const p of game.players.values()) {
        if (p.alive) {
            if (p.role === WW_ROLES.WOLF || p.role === WW_ROLES.WOLF_CUB) wolves++;
            else villagers++; // Includes Fools, Idiots, etc. as non-wolves
        }
    }
    if (wolves === 0) {
        channel.send({ embeds: [new EmbedBuilder().setTitle('🏆 DÂN LÀNG CHIẾN THẮNG!').setDescription('Tất cả Sói đã bị tiêu diệt! Dân làng đã mang lại bình yên.').setColor('#00FF00')] });
        revealRoles(game, channel);
        wwGames.delete(game.channelId);
        return true;
    }
    if (wolves >= villagers) {
        channel.send({ embeds: [new EmbedBuilder().setTitle('🏆 MA SÓI CHIẾN THẮNG!').setDescription('Số lượng Sói đã áp đảo dân làng. Cả làng chìm trong bể máu!').setColor('#FF0000')] });
        revealRoles(game, channel);
        wwGames.delete(game.channelId);
        return true;
    }
    return false;
}

function revealRoles(game, channel) {
    let desc = '';
    for (const p of game.players.values()) desc += `<@${p.id}>: **${p.role}** ${p.alive ? '' : '(💀)'}\n`;
    channel.send({ embeds: [new EmbedBuilder().setTitle('📜 DANH SÁCH VAI TRÒ').setDescription(desc).setColor('#95A5A6')] });
}


// ========================
const taixiuGames = new Map(); // msgId -> { uid, bet }
const taixiuHistory = []; // array of sums
const txCooldowns = new Map(); // uid -> timestamp
const TX_COOLDOWN_MS = 15000; // 15 seconds

const baucuaChannels = new Map(); // channelId -> { msgId, bets: [], endTime, messageObj }

function bcButtons(disabled = false) {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bc_bau').setLabel('Bầu').setEmoji('🍐').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('bc_cua').setLabel('Cua').setEmoji('🦀').setStyle(ButtonStyle.Danger).setDisabled(disabled),
        new ButtonBuilder().setCustomId('bc_tom').setLabel('Tôm').setEmoji('🦐').setStyle(ButtonStyle.Success).setDisabled(disabled)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bc_ca').setLabel('Cá').setEmoji('🐟').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('bc_ga').setLabel('Gà').setEmoji('🐓').setStyle(ButtonStyle.Danger).setDisabled(disabled),
        new ButtonBuilder().setCustomId('bc_nai').setLabel('Nai').setEmoji('🦌').setStyle(ButtonStyle.Success).setDisabled(disabled)
    );
    return [row1, row2];
}

async function startBaucuaMultiplayer(interactionOrMessage, channelId, clientInstance) {
    if (baucuaChannels.has(channelId)) {
        const replyObj = { content: '❌ Kênh này đang có một bàn Bầu Cua chưa kết thúc!', flags: MessageFlags.Ephemeral };
        if (interactionOrMessage.reply && typeof interactionOrMessage.reply === 'function') {
            return interactionOrMessage.reply(replyObj);
        }
        return interactionOrMessage.reply('❌ Kênh này đang có một bàn Bầu Cua chưa kết thúc!');
    }
    const endTime = Date.now() + 30000;
    
    const embed = new EmbedBuilder()
        .setTitle('🎲 BÀN BẦU CUA TÔM CÁ 🎲')
        .setDescription('Bàn cược đã mở! Hãy nhấn vào linh vật bên dưới để đặt cược.\nThời gian còn lại: **30 giây**\n\n**Danh sách cược:**\n(Chưa có ai)')
        .setColor('#E67E22');
        
    let msg;
    const options = { embeds: [embed], components: bcButtons() };
    
    if (interactionOrMessage.reply && typeof interactionOrMessage.reply === 'function') {
        if (!interactionOrMessage.deferred) {
            msg = await interactionOrMessage.reply({ ...options, withResponse: true });
        } else {
            msg = await interactionOrMessage.editReply(options);
        }
    } else {
        msg = await interactionOrMessage.reply(options);
    }
    
    const realMsgId = msg ? msg.id : interactionOrMessage.id;
    
    baucuaChannels.set(channelId, {
        msgId: realMsgId,
        bets: [],
        endTime,
        messageObj: msg
    });
    
    setTimeout(async () => {
        const game = baucuaChannels.get(channelId);
        if (!game || game.msgId !== realMsgId) return;
        baucuaChannels.delete(channelId);
        
        const faces = ['bau', 'cua', 'tom', 'ca', 'ga', 'nai'];
        const faceNames = { 'bau': 'Bầu 🍐', 'cua': 'Cua 🦀', 'tom': 'Tôm 🦐', 'ca': 'Cá 🐟', 'ga': 'Gà 🐓', 'nai': 'Nai 🦌' };
        
        const roll1 = faces[Math.floor(Math.random() * faces.length)];
        const roll2 = faces[Math.floor(Math.random() * faces.length)];
        const roll3 = faces[Math.floor(Math.random() * faces.length)];
        const results = [roll1, roll2, roll3];
        
        let resultStr = `**Xúc xắc:** ${faceNames[roll1]} | ${faceNames[roll2]} | ${faceNames[roll3]}\n\n**KẾT QUẢ TRẢ THƯỞNG:**\n`;
        let someoneWon = false;
        
        for (const bet of game.bets) {
            let matchCount = 0;
            results.forEach(r => { if (r === bet.choice) matchCount++; });
            
            if (matchCount > 0) {
                const winAmount = bet.amount + (bet.amount * matchCount);
                addCoins(bet.uid, winAmount);
                resultStr += `<@${bet.uid}> trúng **${faceNames[bet.choice]}** (x${matchCount}): +**${winAmount.toLocaleString()} 🪙**\n`;
                someoneWon = true;
            }
        }
        
        if (!someoneWon && game.bets.length > 0) resultStr += '💥 Không ai trúng thưởng! Nhà cái húp trọn!';
        if (game.bets.length === 0) resultStr += '🤷 Không có ai đặt cược!';
        
        const finalEmbed = new EmbedBuilder()
            .setTitle('🎲 KẾT QUẢ BẦU CUA 🎲')
            .setDescription(resultStr)
            .setColor('#E67E22');
            
        if (game.messageObj) {
            game.messageObj.edit({ embeds: [finalEmbed], components: bcButtons(true) }).catch(() => {});
        }
    }, 30000);
}

const dautuCooldowns = new Map();
const DAUTU_COOLDOWN_MS = 20000; // 20 seconds

function txButtons() {
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tx_tai').setLabel('Tài (11-18)').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('tx_xiu').setLabel('Xỉu (3-10)').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('tx_chan').setLabel('Chẵn').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tx_le').setLabel('Lẻ').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('tx_3').setLabel('Số 3').setStyle(ButtonStyle.Primary)
    );
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tx_4').setLabel('Số 4').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tx_5').setLabel('Số 5').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tx_6').setLabel('Số 6').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tx_7').setLabel('Số 7').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tx_8').setLabel('Số 8').setStyle(ButtonStyle.Primary)
    );
    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tx_9').setLabel('Số 9').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tx_10').setLabel('Số 10').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tx_11').setLabel('Số 11').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tx_12').setLabel('Số 12').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tx_13').setLabel('Số 13').setStyle(ButtonStyle.Primary)
    );
    const row4 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tx_14').setLabel('Số 14').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tx_15').setLabel('Số 15').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tx_16').setLabel('Số 16').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tx_17').setLabel('Số 17').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('tx_18').setLabel('Số 18').setStyle(ButtonStyle.Primary)
    );
    return [row1, row2, row3, row4];
}

function buildTxChartUrl() {
    if (taixiuHistory.length === 0) return null;
    const labels = taixiuHistory.map((_, i) => i + 1);
    const data = taixiuHistory;
    const chartConfig = {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Tổng điểm Tài Xỉu',
                data: data,
                borderColor: 'rgba(255, 99, 132, 1)',
                backgroundColor: 'rgba(255, 99, 132, 0.2)',
                fill: true,
                tension: 0.1
            }]
        },
        options: { scales: { y: { min: 3, max: 18 } } }
    };
    return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
}

const TX_MULTIPLIERS = {
    '3': 50, '18': 50, '4': 15, '17': 15, '5': 10, '16': 10,
    '6': 8, '15': 8, '7': 6, '14': 6, '8': 4, '13': 4,
    '9': 3, '10': 3, '11': 3, '12': 3
};

// ========================
// BLACKJACK GAME
// ========================
const blackjackGames = new Map();
const SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

function createDeck() {
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ s, r });
    return deck.sort(() => Math.random() - 0.5);
}
function cardVal(card) {
    if (['J','Q','K'].includes(card.r)) return 10;
    if (card.r === 'A') return 11;
    return parseInt(card.r);
}
function handVal(hand) {
    let v = hand.reduce((s, c) => s + cardVal(c), 0);
    let aces = hand.filter(c => c.r === 'A').length;
    while (v > 21 && aces-- > 0) v -= 10;
    return v;
}
function fmtHand(hand, hideIdx = -1) {
    return hand.map((c, i) => i === hideIdx ? '\ud83c\udca0' : `${c.r}${c.s}`).join('  ');
}
function bjEmbed(game, title, color, revealDealer = false) {
    const pv = handVal(game.p), dv = handVal(game.d);
    return new EmbedBuilder()
        .setTitle(`\ud83c\udccf Blackjack \u2014 ${title}`)
        .setColor(color)
        .addFields(
            { name: `\ud83e\udd16 Dealer (${revealDealer ? dv : '?'})`, value: fmtHand(game.d, revealDealer ? -1 : 1), inline: false },
            { name: `\ud83d\udc64 B\u1ea1n (${pv})`, value: fmtHand(game.p), inline: false },
            { name: '\ud83d\udcb0 C\u01b0\u1ee3c', value: `${game.bet.toLocaleString()} \ud83e\ude99`, inline: true },
            { name: '\ud83d\udcb5 S\u1ed1 d\u01b0', value: `${getUserCoins(game.uid).toLocaleString()} \ud83e\ude99`, inline: true }
        )
        .setFooter({ text: 'A=1/11  J/Q/K=10' });
}
function bjButtons(canDouble) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bj_hit').setLabel('\ud83c\udccf R\u00fat (Hit)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('bj_stand').setLabel('\ud83d\uded1 D\u1eebng (Stand)').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('bj_double').setLabel('\u26a1 G\u1ea5p \u0111\u00f4i (Double)').setStyle(ButtonStyle.Success).setDisabled(!canDouble)
    );
}
function dealerPlay(game) {
    while (handVal(game.d) < 17) game.d.push(game.deck.pop());
}

// ========================
// BOT CLIENT
// ========================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildModeration,
    ],
    allowedMentions: { parse: ['users', 'roles'], repliedUser: true }
});

client.setMaxListeners(0);

// Khởi tạo Giveaway Manager
const manager = new GiveawaysManager(client, {
    storage: './giveaways.json',
    default: {
        botsCanWin: false,
        embedColor: '#FF0000',
        embedColorEnd: '#000000',
        reaction: '<a:1000063764:1492460870054182994>'
    }
});
client.giveawaysManager = manager;

// Từ khóa auto-reply
const greetingResponses = [
    // Dễ thương / Cute
    "Nya~ Xin chào cậu chủ nhỏ! (✿◠‿◠)",
    "Hí luuu! Cậu có khỏe khum dạ? 🌸",
    "Meow meow, chào đằng ấy nha! 🐾",
    "Xin chào người đẹp! Chúc cậu một ngày đầy nắng và tiếng cười! ✨",
    "Uwaaa, gặp được cậu ở đây thật là dui quá đi! (≧◡≦) ♡",
    "Bíp bíp! Bot Lavie xin gửi đến bạn một cái ôm ấm áp! 🤗",
    
    // Nghiêm túc / Lịch sự
    "Xin chào bạn. Tôi có thể giúp gì cho bạn hôm nay?",
    "Chào bạn! Chúc bạn một ngày làm việc và học tập hiệu quả.",
    "Kính chào quý khách. Rất hân hạnh được phục vụ.",
    "Xin chào. Hệ thống Lavie Bot luôn sẵn sàng hỗ trợ bạn.",
    
    // Ngầu / Lạnh lùng
    "Chào. Có việc gì không?",
    "Hừm... chào. Đang bận chút nhưng vẫn nghe đây.",
    "Sup! Cần gì nói lẹ đê bro. 😎",
    
    // Hài hước / Lầy lội
    "Ủa ai gọi đó? Có tôi đây! Xin chào nha!",
    "Chào thì chào, không chào thì trúng đòn! 🥊",
    "Chào người anh em thiện lành! Ăn cơm chưa?",
    "Xin chào! Bạn đã nạp năng lượng cho ngày mới chưa đấy? 🔋",
    "Hello bóng hồng/nam thần! Lâu rồi không gặp!"
];

const anmQuotes = [
    "📖 **Điều 1 - Phạm vi**\nQuy định về bảo vệ an ninh mạng, quyền và nghĩa vụ của tổ chức, cá nhân trên không gian mạng.",
    "📖 **Điều 2 - An ninh mạng**\nBảo đảm hệ thống thông tin và dữ liệu an toàn, bảo vệ quyền lợi hợp pháp của tổ chức, cá nhân.",
    "📖 **Điều 5 - Bảo vệ an ninh mạng**\n• Giám sát hệ thống.\n• Phòng, chống tấn công mạng.\n• Ứng phó sự cố.\n• Ngăn chặn thông tin vi phạm.",
    "🚫 **Hành vi bị nghiêm cấm**\n• Đăng, chia sẻ tin giả.\n• Xúc phạm, vu khống người khác.\n• Mạo danh cá nhân, tổ chức.\n• Hack, phát tán mã độc.\n• Đánh cắp, mua bán dữ liệu cá nhân.\n• Lừa đảo trên không gian mạng.\n• Kích động bạo lực, chống phá Nhà nước.",
    "👤 **Trách nhiệm người dùng**\n• Tuân thủ pháp luật.\n• Không phát tán nội dung vi phạm.\n• Bảo vệ tài khoản và thông tin cá nhân.\n• Hợp tác với cơ quan chức năng khi có yêu cầu theo quy định.",
    "🏢 **Trách nhiệm nền tảng**\n• Bảo vệ dữ liệu người dùng.\n• Gỡ bỏ nội dung vi phạm theo quy định.\n• Phối hợp với cơ quan có thẩm quyền."
];

const autoReplies = {
    'lavie': `Lavie chào bạn ạ, bạn cần làm code bot custom cho server liên hệ với <@${ADMIN_ID}> . Cảm ơn bạn ạ`,
    'anm': anmQuotes
};

// ========================
// SLASH COMMANDS
// ========================
const slashCommands = [
    new SlashCommandBuilder()
        .setName('dovui')
        .setDescription('🧠 Tham gia đố vui để nhận tiền thưởng!'),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Xem danh sách các tính năng của bot.'),
    new SlashCommandBuilder()
        .setName('qr')
        .setDescription('Tạo mã QR thanh toán ngân hàng.')
        .addIntegerOption(option =>
            option.setName('amount').setDescription('Số tiền cần thanh toán').setRequired(true))
        .addStringOption(option =>
            option.setName('content').setDescription('Nội dung chuyển khoản (tùy chọn)').setRequired(false)),
    new SlashCommandBuilder()
        .setName('noitu')
        .setDescription('Bắt đầu trò chơi Nối Từ Tiếng Việt.'),
    new SlashCommandBuilder()
        .setName('stopnoitu')
        .setDescription('Dừng trò chơi Nối Từ đang diễn ra.'),
    new SlashCommandBuilder()
        .setName('noituen')
        .setDescription('🔤 Bắt đầu trò chơi Nối Từ Tiếng Anh (ký tự cuối = ký tự đầu).'),
    new SlashCommandBuilder()
        .setName('stopnoituen')
        .setDescription('🔤 Dừng trò chơi Nối Từ Tiếng Anh đang diễn ra.'),
    // --- MUSIC COMMANDS ---
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('🎵 Phát nhạc (YouTube hoặc file mp3) vào voice.')
        .addStringOption(o => o.setName('query').setDescription('Tên bài hát hoặc link YouTube').setRequired(false))
        .addAttachmentOption(o => o.setName('file').setDescription('Upload file nhạc (mp3/wav)').setRequired(false)),
    new SlashCommandBuilder()
        .setName('skip')
        .setDescription('⏭ Bỏ qua bài nhạc hiện tại.'),
    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('⏹ Dừng nhạc và rời kênh thoại.'),
    new SlashCommandBuilder()
        .setName('pause')
        .setDescription('⏸ Tạm dừng nhạc.'),
    new SlashCommandBuilder()
        .setName('resume')
        .setDescription('▶ Tiếp tục phát nhạc.'),
    new SlashCommandBuilder()
        .setName('queue')
        .setDescription('📋 Xem danh sách hàng đợi nhạc.'),
    new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('🎵 Xem bài nhạc đang phát.'),
    // --- GIVEAWAY ---
    new SlashCommandBuilder()
        .setName('gstart')
        .setDescription('Bắt đầu Giveaway (Chỉ Admin).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addStringOption(o => o.setName('duration').setDescription('Thời gian (VD: 10m, 1h)').setRequired(true))
        .addIntegerOption(o => o.setName('winners').setDescription('Số người thắng').setRequired(true))
        .addStringOption(o => o.setName('prize').setDescription('Phần thưởng').setRequired(true)),
    new SlashCommandBuilder()
        .setName('gend')
        .setDescription('Kết thúc sớm Giveaway (Chỉ Admin).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addStringOption(o => o.setName('message_id').setDescription('ID tin nhắn Giveaway').setRequired(true)),
    new SlashCommandBuilder()
        .setName('greroll')
        .setDescription('Chọn lại người thắng Giveaway (Chỉ Admin).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addStringOption(o => o.setName('message_id').setDescription('ID tin nhắn Giveaway').setRequired(true)),
    new SlashCommandBuilder()
        .setName('antinuke')
        .setDescription('🛡️ (Admin) Bật/Tắt hệ thống chống phá hoại (xoá kênh, xoá role, ban mem hàng loạt).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder()
        .setName('antiraid')
        .setDescription('🛡️ (Admin) Bật/Tắt hệ thống chống bot join ồ ạt & spam tin nhắn.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder()
        .setName('setjail')
        .setDescription('🛠️ (Admin) Cài đặt Role và Kênh cho hệ thống Tù/Lao Động.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addRoleOption(o => o.setName('role').setDescription('Role Tù nhân').setRequired(true))
        .addChannelOption(o => o.setName('channel').setDescription('Kênh Cải tạo').setRequired(true)),
    new SlashCommandBuilder()
        .setName('set1ar')
        .setDescription('🛠️ (Admin) Cài đặt lệnh cấp role nhanh (mặc định: 1ar).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addRoleOption(o => o.setName('role').setDescription('Role sẽ được cấp khi gõ lệnh').setRequired(true))
        .addRoleOption(o => o.setName('allowed_role').setDescription('Role ĐƯỢC PHÉP dùng lệnh này (không bắt buộc)').setRequired(false)),
    new SlashCommandBuilder()
        .setName('setpinggame')
        .setDescription('🛠️ (Admin) Cài đặt kênh & nội dung auto-message hướng dẫn ping game.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addChannelOption(o => o.setName('channel').setDescription('Kênh sẽ gửi auto-message').setRequired(true)),
    new SlashCommandBuilder()
        .setName('setwelcome')
        .setDescription('🛠️ (Admin) Cài đặt kênh chào mừng thành viên mới.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addChannelOption(o => o.setName('channel').setDescription('Kênh sẽ gửi lời chào').setRequired(true)),
    new SlashCommandBuilder()
        .setName('setupadvlogs')
        .setDescription('🛠️ (Admin) Tự động tạo hệ thống Log Nâng Cao 12 kênh.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder()
        .setName('deposit')
        .setDescription('🏦 Gửi tiền mặt vào Ngân Hàng.')
        .addStringOption(o => o.setName('amount').setDescription('Số tiền (hoặc gõ "all")').setRequired(true)),
    new SlashCommandBuilder()
        .setName('withdraw')
        .setDescription('🏦 Rút tiền từ Ngân Hàng về tiền mặt.')
        .addStringOption(o => o.setName('amount').setDescription('Số tiền (hoặc gõ "all")').setRequired(true)),
    new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Đuổi bot khỏi kênh thoại.'),
    new SlashCommandBuilder()
        .setName('join')
        .setDescription('Gọi bot vào kênh thoại.'),

    new SlashCommandBuilder()
        .setName('giveall')
        .setDescription('Phát tiền cho toàn bộ server (Chỉ Admin).')
        .addIntegerOption(o => o.setName('amount').setDescription('Số tiền mỗi người nhận').setRequired(true)),
    new SlashCommandBuilder()
        .setName('addpetvip')
        .setDescription('🐲 (Admin) Tặng Pet VIP (hoặc bất kỳ pet nào) cho người dùng.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addUserOption(o => o.setName('user').setDescription('Người nhận').setRequired(true))
        .addStringOption(o => o.setName('petid').setDescription('ID của Pet (vd: arceus, lugia...)').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Số lượng').setRequired(false)),
    new SlashCommandBuilder()
        .setName('rob')
        .setDescription('🥷 Trộm tiền người chơi khác (Tỉ lệ 50%, bị phạt nếu trượt).')
        .addUserOption(o => o.setName('user').setDescription('Mục tiêu').setRequired(true)),
    new SlashCommandBuilder()
        .setName('heist')
        .setDescription('🏦 Cướp ngân hàng hệ thống (Siêu rủi ro 15%!).'),
    new SlashCommandBuilder()
        .setName('robbank')
        .setDescription('🏦 Cướp ngân hàng hệ thống hoặc ngân hàng của người khác!')
        .addUserOption(o => o.setName('user').setDescription('Tag người muốn cướp bank (bỏ trống = cướp hệ thống)').setRequired(false)),
    new SlashCommandBuilder()
        .setName('nopphat')
        .setDescription('🚓 Hối lộ công an 100,000 🪙 để ra tù sớm.'),
    new SlashCommandBuilder()
        .setName('hack')
        .setDescription('💻 Xâm nhập hệ thống lấy trộm tiền từ người chơi khác (Cần Laptop & Virus).')
        .addUserOption(o => o.setName('user').setDescription('Mục tiêu bị hack').setRequired(true)),
    new SlashCommandBuilder()
        .setName('dautu')
        .setDescription('📈 Đầu tư cổ phiếu ngẫu nhiên (Lãi to hoặc Lỗ nặng).')
        .addStringOption(o => o.setName('amount').setDescription('Số tiền (hoặc "all")').setRequired(true)),
    new SlashCommandBuilder()
        .setName('marry')
        .setDescription('💍 Cầu hôn người chơi khác bằng những chiếc nhẫn lãng mạn.')
        .addUserOption(o => o.setName('user').setDescription('Người bạn muốn chung sống (Bỏ trống để ghép ngẫu nhiên)').setRequired(false)),
    new SlashCommandBuilder()
        .setName('togglevoice')
        .setDescription('Bật/Tắt thông báo tham gia kênh thoại.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder()
        .setName('divorce')
        .setDescription('💔 Ly hôn (Phí ra tòa 100,000 Coin).'),
    new SlashCommandBuilder()
        .setName('admincheat')
        .setDescription('👑 [Đặc quyền] Menu Cheat của Hệ Thống (Developer).'),
    new SlashCommandBuilder()
        .setName('masoi')
        .setDescription('🐺 Bắt đầu game Ma Sói (Werewolf) trong kênh này.'),
    new SlashCommandBuilder()
        .setName('wwstop')
        .setDescription('🛑 Hủy game Ma Sói đang chạy (Admin).'),
    new SlashCommandBuilder()
        .setName('setlodechannel')
        .setDescription('👑 [Admin] Cài đặt kênh hiển thị kết quả Lô đề 18h30 hàng ngày.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addChannelOption(o => o.setName('channel').setDescription('Kênh hiển thị kết quả').setRequired(true)),
    // --- COIN / MINIGAME ---
    new SlashCommandBuilder()
        .setName('daily')
        .setDescription('💰 Nhận coin hằng ngày (mỗi 24 giờ).'),
    new SlashCommandBuilder()
        .setName('balance')
        .setDescription('💵 Xem số dư coin (Cash & Bank).')
        .addUserOption(o => o.setName('user').setDescription('Xem coin của người khác').setRequired(false)),
    new SlashCommandBuilder()
        .setName('give')
        .setDescription('🎁 Tặng coin cho người khác.')
        .addUserOption(o => o.setName('user').setDescription('Người nhận').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Số coin muốn tặng').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('🏆 Bảng xếp hạng coin.'),
    new SlashCommandBuilder()
        .setName('top')
        .setDescription('🏆 Xem bảng xếp hạng những người giàu nhất Server.'),
    new SlashCommandBuilder()
        .setName('bank')
        .setDescription('🏦 Quản lý ngân hàng: gửi, rút tiền và xem bảng xếp hạng.')
        .addUserOption(o => o.setName('user').setDescription('Xem ngân hàng của người khác (không tương tác)').setRequired(false)),
    new SlashCommandBuilder()
        .setName('blackjack')
        .setDescription('🃏 Chơi Blackjack cược coin.')
        .addStringOption(o => o.setName('bet').setDescription('Số coin cược (hoặc gõ "all")').setRequired(true)),
    new SlashCommandBuilder()
        .setName('lode')
        .setDescription('💸 Đánh lô đề (đoán số 00-99), trúng x5 coin cược.')
        .addStringOption(o => o.setName('so').setDescription('Số muốn đánh (00-99)').setRequired(true))
        .addStringOption(o => o.setName('bet').setDescription('Số coin cược (hoặc "all")').setRequired(true)),
    new SlashCommandBuilder()
        .setName('taixiu')
        .setDescription('🎲 Chơi Tài Xỉu (Sic Bo).')
        .addStringOption(o => o.setName('bet').setDescription('Số coin cược (hoặc gõ "all")').setRequired(true)),
    new SlashCommandBuilder()
        .setName('baucua')
        .setDescription('🎲 Mở bàn Bầu Cua Tôm Cá (Nhiều người chơi).'),
    // --- RPG COMMANDS ---
    new SlashCommandBuilder()
        .setName('setbday')
        .setDescription('🎂 Cài đặt ngày sinh của bạn.')
        .addStringOption(o => o.setName('date').setDescription('Ngày/Tháng (VD: 15/08)').setRequired(true)),
    new SlashCommandBuilder()
        .setName('profile')
        .setDescription('👤 Xem hồ sơ nhân vật RPG của bạn.'),
    new SlashCommandBuilder()
        .setName('hunt')
        .setDescription('⚔️ Đi săn quái vật để nhận EXP và Coin.'),
    new SlashCommandBuilder()
        .setName('shop')
        .setDescription('🛒 Mở cửa hàng mua sắm vũ khí, giáp, bình máu.'),
    new SlashCommandBuilder()
        .setName('inv')
        .setDescription('🎒 Xem túi đồ và trang bị hiện tại.'),
    new SlashCommandBuilder()
        .setName('work')
        .setDescription('💼 Làm việc kiếm coin (từ 1 đến 60 phút).'),
    new SlashCommandBuilder()
        .setName('catchpet')
        .setDescription('🐾 Đi săn thú cưng (tốn 2000 Coin).'),
    new SlashCommandBuilder()
        .setName('pets')
        .setDescription('🏕️ Xem danh sách thú cưng của bạn.'),
    new SlashCommandBuilder()
        .setName('sellpet')
        .setDescription('🏪 Bán thú cưng để nhận Coin.'),
    new SlashCommandBuilder()
        .setName('petbattle')
        .setDescription('⚔️ Mang con thú xịn nhất ra solo nhận thưởng!')
        .addUserOption(o => o.setName('user').setDescription('Đối thủ').setRequired(true))
        .addIntegerOption(o => o.setName('bet').setDescription('Số tiền cược').setRequired(true).setMinValue(10)),
    new SlashCommandBuilder()
        .setName('resetwork')
        .setDescription('🔧 [Admin] Reset thời gian chờ làm việc cho user.')
        .addUserOption(o => o.setName('user').setDescription('Người dùng cần reset').setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder()
        .setName('heal')
        .setDescription('❤️ Hồi phục máu cho nhân vật.'),
    // --- ADMIN COMMANDS ---
    new SlashCommandBuilder()
        .setName('addcoin')
        .setDescription('🛠️ (Admin) Thêm coin cho người dùng.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addUserOption(o => o.setName('user').setDescription('Người dùng').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Số lượng coin').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
        .setName('addxp')
        .setDescription('🛠️ (Admin) Thêm EXP cho người dùng.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addUserOption(o => o.setName('user').setDescription('Người dùng').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Số lượng EXP').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
        .setName('removecoin')
        .setDescription('🛠️ (Admin) Trừ coin của người dùng.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addUserOption(o => o.setName('user').setDescription('Người dùng').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Số lượng coin').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
        .setName('setcoin')
        .setDescription('🛠️ (Admin) Cài đặt số coin của người dùng.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addUserOption(o => o.setName('user').setDescription('Người dùng').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Số lượng coin mới').setRequired(true).setMinValue(0)),
    new SlashCommandBuilder()
        .setName('gather')
        .setDescription('🌍 Mở Menu hoặc thu thập tài nguyên tại Khu Vực đã chọn.'),
    new SlashCommandBuilder()
        .setName('pokesolo')
        .setDescription('⚔️ Mang thú cưng mạnh nhất của bạn đi solo với Pokemon hoang dã!'),
    new SlashCommandBuilder()
        .setName('resetcoin')
        .setDescription('🛠️ (Admin) Reset số coin và ngân hàng của người dùng về mặc định.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addUserOption(o => o.setName('user').setDescription('Người dùng').setRequired(true)),
    new SlashCommandBuilder()
        .setName('resetallcoin')
        .setDescription('🛠️ (Admin) Reset số coin và ngân hàng của TẤT CẢ mọi người về mặc định.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('🛠️ (Admin) Xóa tin nhắn trong kênh.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addIntegerOption(o => o.setName('amount').setDescription('Số tin nhắn cần xóa (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder()
        .setName('say')
        .setDescription('🛠️ (Admin) Bot gửi tin nhắn thay bạn.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addChannelOption(o => o.setName('channel').setDescription('Kênh muốn gửi').setRequired(true))
        .addStringOption(o => o.setName('message').setDescription('Nội dung tin nhắn').setRequired(true)),
    new SlashCommandBuilder()
        .setName('setspawnchannel')
        .setDescription('🛠️ (Admin) Cài đặt kênh duy nhất xuất hiện Pokemon hoang dã.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addChannelOption(o => o.setName('channel').setDescription('Kênh xuất hiện Pokemon').setRequired(true)),
    new SlashCommandBuilder()
        .setName('setuppokemonrole')
        .setDescription('👑 [Chủ Bot] Tạo Role Pokemon và gửi tin nhắn để user nhận role.'),
    new SlashCommandBuilder()
        .setName('setuprpgrole')
        .setDescription('👑 [Chủ Bot] Tạo Role RPG và gửi tin nhắn để user nhận role.'),

    new SlashCommandBuilder()
        .setName('disablewelcome')
        .setDescription('🛠️ (Admin) Tắt tính năng tự động gửi lời chào mừng.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder()
        .setName('testwelcome')
        .setDescription('🛠️ (Admin) Dùng thử để kiểm tra hiển thị của lệnh chào mừng.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    new SlashCommandBuilder()
        .setName('setj2c')
        .setDescription('🛠️ (Admin) Cài đặt kênh gốc để tạo Join to Create.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addChannelOption(o => o.setName('channel').setDescription('Kênh Join to Create gốc').setRequired(true)),
    // --- J2C SLASH COMMANDS ---
    new SlashCommandBuilder()
        .setName('doiten')
        .setDescription('📝 Đổi tên phòng Voice J2C của bạn.')
        .addStringOption(o => o.setName('name').setDescription('Tên phòng mới').setRequired(true)),
    new SlashCommandBuilder()
        .setName('gioihan')
        .setDescription('👥 Giới hạn số người trong phòng Voice J2C (0 = không giới hạn).')
        .addIntegerOption(o => o.setName('so').setDescription('Số người tối đa (0-99)').setRequired(true).setMinValue(0).setMaxValue(99)),
    new SlashCommandBuilder()
        .setName('khoaan')
        .setDescription('👻 Bật/tắt ẩn phòng Voice J2C khỏi danh sách.'),
    new SlashCommandBuilder()
        .setName('khoavc')
        .setDescription('🔒 Bật/tắt khóa kết nối phòng Voice J2C.'),
    new SlashCommandBuilder()
        .setName('kickvc')
        .setDescription('👢 Kích một người ra khỏi phòng Voice J2C của bạn.')
        .addUserOption(o => o.setName('user').setDescription('Người muốn kích').setRequired(true)),
    new SlashCommandBuilder()
        .setName('1an')
        .setDescription('Ẩn phòng Voice hiện tại của bạn đối với một người cụ thể.')
        .addUserOption(o => o.setName('user').setDescription('Người bạn muốn ẩn phòng').setRequired(true)),
    new SlashCommandBuilder()
        .setName('senddm')
        .setDescription('👑 [Chủ Bot] Gửi tin nhắn trực tiếp qua Bot tới User.')
        .addUserOption(o => o.setName('user').setDescription('Người dùng muốn gửi tin').setRequired(true))
        .addStringOption(o => o.setName('message').setDescription('Nội dung tin nhắn').setRequired(true)),
    // --- RPG EXPANSION ---
    new SlashCommandBuilder()
        .setName('dungeon')
        .setDescription('🏰 Vào Dungeon đánh quái nhiều tầng + Boss.'),
    new SlashCommandBuilder()
        .setName('raid')
        .setDescription('⚔️ Tham gia đánh Raid Boss Toàn Máy Chủ cùng mọi người.'),
    new SlashCommandBuilder()
        .setName('pvp')
        .setDescription('⚔️ Thách đấu PvP 1v1 với người chơi khác.')
        .addUserOption(o => o.setName('user').setDescription('Đối thủ').setRequired(true))
        .addIntegerOption(o => o.setName('bet').setDescription('Số coin cược').setRequired(true).setMinValue(100)),
    new SlashCommandBuilder()
        .setName('quest')
        .setDescription('🎯 Xem nhiệm vụ hàng ngày và nhận thưởng.'),
    new SlashCommandBuilder()
        .setName('class')
        .setDescription('🏅 Chọn hoặc đổi class nhân vật (Lv.5+).'),
    new SlashCommandBuilder()
        .setName('openbox')
        .setDescription('🎁 Mở rương nhận vật phẩm.'),
    new SlashCommandBuilder()
        .setName('evolve')
        .setDescription('🔄 Tiến hóa Pokemon hoặc chuyển dư thành candy.'),
    new SlashCommandBuilder()
        .setName('rpgtop')
        .setDescription('🏆 Bảng xếp hạng RPG (Level, Power, Dungeon, Pokemon, PvP).')
].map(command => command.toJSON());

// ========================
// NEW COMMAND HANDLERS
// ========================
async function handleLeave(msgOrInteraction) {
    const guildId = msgOrInteraction.guildId;
    const state = getQueue(guildId);
    state.queue.length = 0;
    state.player?.stop();
    state.connection?.destroy();
    musicQueues.delete(guildId);
    return replyMsg(msgOrInteraction, '👋 Đã rời khỏi phòng Voice!');
}

async function handleJoin(msgOrInteraction) {
    const member = msgOrInteraction.member;
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) return replyMsg(msgOrInteraction, '❌ Bạn phải ở trong một voice channel trước!');
    const state = getQueue(msgOrInteraction.guildId);
    state.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: msgOrInteraction.guildId,
        adapterCreator: msgOrInteraction.guild.voiceAdapterCreator,
        selfDeaf: true
    });
    return replyMsg(msgOrInteraction, `🔊 Đã kết nối vào **${voiceChannel.name}**!`);
}

async function handleGive(userId, targetId, amount, msgOrInteraction) {
    if (!targetId || targetId === msgOrInteraction.client?.user?.id) return replyMsg(msgOrInteraction, '❌ Người nhận không hợp lệ!');
    if (userId === targetId) return replyMsg(msgOrInteraction, '❌ Bạn không thể tự chuyển tiền cho chính mình!');
    if (isNaN(amount) || amount <= 0) return replyMsg(msgOrInteraction, '❌ Số tiền không hợp lệ!');
    if (getUserCoins(userId) < amount) return replyMsg(msgOrInteraction, '❌ Bạn không đủ tiền!');
    
    return awaitConfirmation(msgOrInteraction, userId, `Bạn muốn **CHUYỂN** ${amount.toLocaleString()} 🪙 cho <@${targetId}>?`, async () => {
        if (getUserCoins(userId) < amount) return '❌ Giao dịch thất bại: Bạn không còn đủ tiền!';
        addCoins(userId, -amount);
        addCoins(targetId, amount);
        return `💸 **CHUYỂN KHOẢN THÀNH CÔNG**\nBạn đã tặng <@${targetId}> **${amount.toLocaleString()} 🪙**!`;
    });
}

async function handleGiveAll(userId, amount, msgOrInteraction) {
    if (userId !== ADMIN_ID) return replyMsg(msgOrInteraction, '❌ Bạn không có quyền sử dụng lệnh này!');
    if (isNaN(amount) || amount <= 0) return replyMsg(msgOrInteraction, '❌ Số tiền không hợp lệ!');
    
    return awaitConfirmation(msgOrInteraction, userId, `Hệ Thống (Developer) muốn **PHÁT LỘC** ${amount.toLocaleString()} 🪙 cho TOÀN SERVER?`, async () => {
        const cData = loadCoins();
        let count = 0;
        for (const uid in cData) {
            if (cData[uid].coins !== undefined) {
                cData[uid].coins = Math.max(0, Math.floor((cData[uid].coins || 0) + amount));
                count++;
            }
        }
        saveCoins(cData);
        return `🎁 **PHÁT LỘC TOÀN SERVER**\nHệ Thống (Developer) <@${userId}> vừa phát **${amount.toLocaleString()} 🪙** cho tất cả người chơi! (Tổng cộng ${count} người nhận)`;
    });
}

// ========================
// WORD CHAIN (NỐI TỪ)
// ========================
const vnDictionary = new Set();
const noituGames = new Map();
let noituMatchCounter = 0;
const globalUsedWords = new Map();
// --- ENGLISH WORD CHAIN ---
const enDictionary = new Set();
const noituEnGames = new Map();
let noituEnMatchCounter = 0;
const globalUsedEnWords = new Map();
global.RAID_BOSS = null; // { name, hp, maxHp, atk, def, emoji, participants: Map<userId, damage>, endTime }
const j2cPath = path.join(__dirname, 'j2c.json');
function loadJ2C() {
    if (!fs.existsSync(j2cPath)) return {};
    return JSON.parse(fs.readFileSync(j2cPath, 'utf-8'));
}
function saveJ2C(data) {
    fs.writeFileSync(j2cPath, JSON.stringify(data, null, 2));
}
const j2cChannels = new Map(); // channelId => ownerId

async function initDictionary() {
    // Ưu tiên dùng file đã lọc sạch (được tạo bởi build_vn_dict.js)
    const cleanPath = path.join(__dirname, 'vn_words_clean.txt');
    if (fs.existsSync(cleanPath)) {
        const words = fs.readFileSync(cleanPath, 'utf-8').split('\n');
        for (const w of words) {
            const clean = w.trim().toLowerCase();
            if (clean && clean.split(' ').length === 2) {
                vnDictionary.add(clean);
            }
        }
        console.log(`📖 Đã nạp ${vnDictionary.size} từ ghép sạch vào bộ nhớ (từ vn_words_clean.txt).`);
        return;
    }
    // Fallback: dùng vn_words.txt nếu chưa có file sạch
    const dictPath = path.join(__dirname, 'vn_words.txt');
    if (!fs.existsSync(dictPath)) {
        console.log('Đang tải từ điển Tiếng Việt...');
        try {
            const res = await axios.get('https://raw.githubusercontent.com/duyet/vietnamese-wordlist/master/Viet74K.txt');
            fs.writeFileSync(dictPath, res.data);
            console.log('✅ Đã tải xong từ điển Tiếng Việt!');
        } catch (err) {
            console.error('❌ Lỗi tải từ điển:', err);
        }
    }
    
    if (fs.existsSync(dictPath)) {
        const words = fs.readFileSync(dictPath, 'utf-8').split('\n');
        for (const w of words) {
            const trimmed = w.trim();
            if (!trimmed) continue;
            // Chỉ giữ từ ghép 2 âm tiết
            const parts = trimmed.split(' ');
            if (parts.length !== 2) continue;
            // Loại bỏ tên riêng (chữ hoa đầu tiên mỗi âm tiết = tên địa danh/người)
            if (/^[A-ZÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ]/.test(parts[0]) && /^[A-ZÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ]/.test(parts[1])) continue;
            // Loại bỏ từ có gạch nối (thuật ngữ ngoại lai)
            if (trimmed.includes('-')) continue;
            // Loại bỏ từ có số hoặc ký tự đặc biệt
            if (/[0-9()\[\]{}]/.test(trimmed)) continue;
            const clean = trimmed.toLowerCase();
            vnDictionary.add(clean);
        }
        console.log(`📖 Đã nạp ${vnDictionary.size} từ ghép 2 âm tiết vào bộ nhớ.`);
    }
}

async function initEnglishDictionary() {
    const dictPath = path.join(__dirname, 'en_words.txt');
    if (!fs.existsSync(dictPath)) {
        console.log('Đang tải từ điển Tiếng Anh...');
        try {
            const res = await axios.get('https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt');
            fs.writeFileSync(dictPath, res.data);
            console.log('✅ Đã tải xong từ điển Tiếng Anh!');
        } catch (err) {
            console.error('❌ Lỗi tải từ điển Tiếng Anh:', err);
        }
    }
    
    if (fs.existsSync(dictPath)) {
        const words = fs.readFileSync(dictPath, 'utf-8').split(/\r?\n/);
        for (const w of words) {
            const clean = w.trim().toLowerCase();
            // Chỉ giữ từ 2-15 ký tự, chỉ chữ cái a-z
            if (clean && /^[a-z]{2,15}$/.test(clean)) {
                enDictionary.add(clean);
            }
        }
        console.log(`📖 Đã nạp ${enDictionary.size} từ tiếng Anh vào bộ nhớ.`);
    }
}

function getBotNoiTuWord(lastWord, usedWords, currentMatchId) {
    const lastSyllable = lastWord.split(' ').pop();
    const possibleWords = [];
    for (const word of vnDictionary) {
        if (word.startsWith(`${lastSyllable} `) && !usedWords.has(word)) {
            const lastUsed = globalUsedWords.get(word);
            if (lastUsed === undefined || currentMatchId - lastUsed > 5) {
                possibleWords.push(word);
            }
        }
    }
    if (possibleWords.length > 0) {
        return possibleWords[Math.floor(Math.random() * possibleWords.length)];
    }
    return null;
}

// ========================
// BOT READY
// ========================
client.once('clientReady', async () => {
    await initDictionary();
    await initEnglishDictionary();
    console.log(`✅ Bot đã đăng nhập với tên: ${client.user.tag}`);
    
    // Đổi tên và biệt danh tự động
    try {
        if (client.user.username !== 'Lavie') {
            await client.user.setUsername('Lavie').catch(() => console.log('Không thể đổi username (có thể do rate limit)'));
        }
        for (const guild of client.guilds.cache.values()) {
            const botMember = await guild.members.fetchMe().catch(() => null);
            if (botMember && botMember.nickname !== 'Lavie') {
                await botMember.setNickname('Lavie').catch(() => {});
            }
        }
        console.log('✅ Đã cập nhật tên và biệt danh thành Lavie trên toàn bộ server!');
    } catch (e) {}
    
    const statuses = [
        "🤖 Lavie | Đồng hành cùng Tuyển sinh UTEHY K26 💙",
        "💙 Lavie • Welcome to UTEHY Admissions 2026",
        "🎓 Lavie | Chào mừng K26 đến với UTEHY!",
        "📚 Lavie | Hỗ trợ tuyển sinh UTEHY 24/7",
        "🌸 Lavie • Your UTEHY Admissions Assistant",
        "✨ Lavie | Future Starts Here",
        "🚀 Lavie • Cùng bạn chinh phục UTEHY K26",
        "💬 Lavie | Hỏi gì cũng biết về tuyển sinh!",
        "🎯 Lavie • Đồng hành cùng sĩ tử 2026",
        "📩 Lavie | Luôn sẵn sàng hỗ trợ bạn",
        "💙 Lavie • Kết nối ước mơ đến UTEHY",
        "🎓 Lavie | Admissions Made Easy",
        "🌟 Lavie • Chào đón Tân sinh viên K26",
        "📖 Lavie | Tuyển sinh UTEHY 2026",
        "🚀 Lavie • Your Journey Begins Here",
        "💙 Lavie | Vì một K26 rực rỡ",
        "✨ Lavie • Let's Join UTEHY Together",
        "🎉 Lavie | Welcome Future UTEHY Students",
        "🌈 Lavie • Nơi mọi câu hỏi đều có lời giải",
        "🤖 Lavie | Luôn bên bạn trên hành trình vào UTEHY"
    ];
    let statusIndex = 0;
    setInterval(() => {
        // type 1 = Streaming. Cần kèm theo 1 link twitch hoặc youtube hợp lệ thì Discord mới hiện màu tím (Đang stream)
        client.user.setActivity(statuses[statusIndex], { 
            type: 1, 
            url: "https://www.twitch.tv/discord" 
        }); 
        statusIndex = (statusIndex + 1) % statuses.length;
    }, 5000);

    // Cleanup empty J2C channels on startup
    const savedJ2C = loadJ2C();
    let j2cChanged = false;
    for (const [chId, ownerId] of Object.entries(savedJ2C)) {
        const channel = client.channels.cache.get(chId);
        if (!channel) {
            delete savedJ2C[chId];
            j2cChanged = true;
        } else if (channel.members.size === 0) {
            channel.delete('J2C Cleanup on startup').catch(() => {});
            delete savedJ2C[chId];
            j2cChanged = true;
        } else {
            j2cChannels.set(chId, ownerId);
        }
    }
    if (j2cChanged) saveJ2C(savedJ2C);

    // Phục hồi tracking voice cho những người đã ở sẵn trong kênh thoại khi bot restart
    client.guilds.cache.forEach(guild => {
        guild.channels.cache.filter(c => c.isVoiceBased()).forEach(channel => {
            channel.members.forEach(member => {
                if (!member.user.bot) {
                    voiceJoinTimes.set(member.user.id, { time: Date.now(), channel: channel.id });
                }
            });
        });
    });

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Đang đăng ký Slash Commands...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
        console.log('✅ Đã đăng ký Slash Commands thành công!');
        startWildPetSpawns(client);

        // --- LÔ ĐỀ CRON JOB (18:30 hàng ngày) ---
        cron.schedule('30 18 * * *', async () => {
            console.log('⏰ Bắt đầu xổ số lô đề 18h30...');
            const config = loadConfig();
            
            let targetChannels = [];
            if (config.lodeChannelId) targetChannels.push(config.lodeChannelId);
            if (config.guilds) {
                for (const guildConf of Object.values(config.guilds)) {
                    if (guildConf.lodeChannelId) targetChannels.push(guildConf.lodeChannelId);
                }
            }
            targetChannels = [...new Set(targetChannels)];
            
            if (targetChannels.length === 0) {
                console.log('❌ Chưa cấu hình lodeChannelId ở bất kỳ server nào!');
                return;
            }

            const lodeData = loadLode();
            if (!lodeData.bets || lodeData.bets.length === 0) {
                for (const chId of targetChannels) {
                    const channel = client.channels.cache.get(chId);
                    if (channel) channel.send('📊 **XỔ SỐ 18H30**\nHôm nay không có ai ghi lô đề. Hẹn gặp lại ngày mai!');
                }
                return;
            }

            const winningNumber = Math.floor(Math.random() * 100);
            const formattedWinNum = winningNumber.toString().padStart(2, '0');

            let winners = [];
            const coinsData = loadCoins();

            for (const betObj of lodeData.bets) {
                if (betObj.so === winningNumber) {
                    const prize = betObj.bet * 5;
                    if (!coinsData[betObj.userId]) coinsData[betObj.userId] = { coins: 0, bank: 0 };
                    coinsData[betObj.userId].coins = Math.max(0, Math.floor((coinsData[betObj.userId].coins || 0) + prize));
                    winners.push({ userId: betObj.userId, prize: prize });
                }
            }

            saveCoins(coinsData);
            saveLode({ bets: [] });

            const embed = new EmbedBuilder()
                .setTitle('🎉 KẾT QUẢ XỔ SỐ LÔ ĐỀ 18H30 🎉')
                .setDescription(`Con số may mắn ngày hôm nay là: **${formattedWinNum}** 🎯`)
                .setColor('#FF0000');

            if (winners.length > 0) {
                const winnerText = winners.map(w => `<@${w.userId}> trúng **${w.prize.toLocaleString()} 🪙**`).join('\n');
                embed.addFields({ name: '🏆 Chúc mừng các đại gia đã trúng lô', value: winnerText });
                for (const chId of targetChannels) {
                    const channel = client.channels.cache.get(chId);
                    if (channel) channel.send({ content: `🔔 Loa loa loa! Đã có kết quả xổ số: ${winners.map(w => `<@${w.userId}>`).join(' ')}`, embeds: [embed] });
                }
            } else {
                embed.addFields({ name: '😢 Chia buồn', value: 'Rất tiếc hôm nay không có ai trúng lô cả. Chúc các bạn may mắn lần sau!' });
                for (const chId of targetChannels) {
                    const channel = client.channels.cache.get(chId);
                    if (channel) channel.send({ embeds: [embed] });
                }
            }
        }, {
            timezone: 'Asia/Ho_Chi_Minh'
        });

    } catch (error) {
        console.error('Lỗi khi đăng ký Slash Commands:', error);
    }
});

// ========================
// MEMBER JOIN - WELCOME
// ========================
client.on('guildMemberAdd', async (member) => {
    try {
        // LOGGING
        const logEmbed = new EmbedBuilder()
            .setTitle('📥 THÀNH VIÊN MỚI')
            .setDescription(`**${member.user.tag}** (<@${member.id}>) đã tham gia server.\nSố lượng thành viên: ${member.guild.memberCount}`)
            .setColor('#2ECC71')
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp();
        sendAdvLog(member.guild, 'member', logEmbed);

        const config = getGuildConfig(member.guild.id);
        
        // --- ANTI-RAID CHECK ---
        if (config.antiRaidEnabled !== false) {
            let joinTimes = raidTracker.get(member.guild.id) || [];
            joinTimes.push(Date.now());
            joinTimes = joinTimes.filter(t => Date.now() - t < 10000); // 10 giây
            raidTracker.set(member.guild.id, joinTimes);
            
            if (joinTimes.length >= 5) {
                await member.ban({ reason: 'Anti-Raid: Phát hiện mass join' }).catch(() => {});
                return; // Kicked, no need to welcome
            }
        }
        const welcomeChannelId = config.welcomeChannelId || (loadConfig().welcomeChannelId) || process.env.WELCOME_CHANNEL_ID;
        const receptionistRoleId = process.env.RECEPTIONIST_ROLE_ID;
        if (welcomeChannelId === 'disabled') return;
        let channel;
        if (welcomeChannelId && welcomeChannelId !== 'YOUR_WELCOME_CHANNEL_ID_HERE') {
            channel = member.guild.channels.cache.get(welcomeChannelId);
        } else {
            channel = member.guild.channels.cache.find(ch =>
                ch.name.includes('welcome') || ch.name.includes('chào-mừng') || ch.name === 'general'
            );
        }
        if (!channel) return;
        
        let description = '';
        if (config.welcomeMessage) {
            description = config.welcomeMessage.replace(/{user}/g, `<@${member.user.id}>`).replace(/{server}/g, member.guild.name).replace(/\\n/g, '\n');
        } else {
            description = `Chào mừng bạn **${member.user.username}** đã hạ cánh an toàn tại **${member.guild.name}**! 🛬\n\n> Đừng quên đọc luật và tự nhiên giao lưu nhé! Rất vui được gặp bạn! 💕`;
        }
        
        let title = config.welcomeTitle || `🎉 Welcome ${member.user.displayName} 🎉`;
        
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor('#2b2d31')
            .setFooter({ text: 'づ♡ど' })
            .setImage('https://cdn.discordapp.com/attachments/1491631607596187688/1528457728144576602/ChatGPT_Image_20_18_37_12_thg_7_2026.png?ex=6a5e5eaf&is=6a5d0d2f&hm=f383da5bf037b4c327d84f99d6c2a9b9b8d4d962eaeb42be4b2ef2268c3b6cc4&');
        
        // Ping user và role đón khách trên kênh
        let pingContent = `<@${member.user.id}>`;
        if (config.welcomePingRoles) {
            pingContent += ` | ${config.welcomePingRoles} ra đón khách kìa! 🎉`;
        } else if (config.welcomeRoleId) {
            pingContent += ` | <@&${config.welcomeRoleId}> ra đón khách kìa! 🎉`;
        } else if (receptionistRoleId && receptionistRoleId !== 'YOUR_RECEPTIONIST_ROLE_ID_HERE') {
            pingContent += ` | <@&${receptionistRoleId}> ra đón khách kìa! 🎉`;
        } else {
            pingContent += ` | <@&1491977303473914036> ra đón thành viên mới kìa! 🎉`;
        }
        
        const messageOptions = { content: pingContent, embeds: [embed] };
        
        channel.send(messageOptions);
        
        // Gửi DM riêng cho user bằng chính embed đã cài đặt cho server đó (không kèm tag role)
        member.send({ embeds: [embed] }).catch(() => {});
    } catch (error) {
        console.error('Lỗi khi gửi lời chào:', error);
    }
});

// ========================
// BOOST NOTIFICATION
// ========================
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    // LOGGING
    if (oldMember.nickname !== newMember.nickname) {
        const logEmbed = new EmbedBuilder()
            .setTitle('📝 CẬP NHẬT BIỆT DANH')
            .setDescription(`**${newMember.user.tag}** (<@${newMember.id}>)`)
            .addFields(
                { name: 'Cũ', value: oldMember.nickname || 'Không có', inline: true },
                { name: 'Mới', value: newMember.nickname || 'Không có', inline: true }
            )
            .setColor('#3498DB')
            .setTimestamp();
        sendAdvLog(newMember.guild, 'member', logEmbed);
    }
    if (oldMember.roles.cache.size !== newMember.roles.cache.size) {
        const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
        const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));
        if (addedRoles.size > 0 || removedRoles.size > 0) {
            const logEmbed = new EmbedBuilder()
                .setTitle('🎭 CẬP NHẬT ROLE')
                .setDescription(`**${newMember.user.tag}** (<@${newMember.id}>)`)
                .setColor('#9B59B6')
                .setTimestamp();
            if (addedRoles.size > 0) logEmbed.addFields({ name: 'Role Thêm', value: addedRoles.map(r => `<@&${r.id}>`).join(', ') });
            if (removedRoles.size > 0) logEmbed.addFields({ name: 'Role Xóa', value: removedRoles.map(r => `<@&${r.id}>`).join(', ') });
            sendAdvLog(newMember.guild, 'member', logEmbed);
        }
    }

    // Check if the member just started boosting the server
    if (!oldMember.premiumSince && newMember.premiumSince) {
        try {
            const channelId = '1491618335689805856';
            const channel = newMember.guild.channels.cache.get(channelId);
            if (!channel) return;
            
            const embed = new EmbedBuilder()
                .setTitle('🚀 Cảm ơn bạn đã Boost Server! 🚀')
                .setDescription(`Tuyệt vời quá! Cảm ơn **${newMember.user.displayName}** đã boost server **${newMember.guild.name}**! 💖\nSự ủng hộ của bạn là động lực rất lớn đối với chúng mình!`)
                .setColor('#ff73fa')
                .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true, size: 512 }))
                .addFields(
                    { name: '🔥 Tổng số Boost hiện tại', value: `**${newMember.guild.premiumSubscriptionCount || 0}** Boosts!`, inline: true },
                    { name: '💎 Server Level', value: `Cấp **${newMember.guild.premiumTier || 0}**`, inline: true }
                )
                .setFooter({ text: 'Cảm ơn tình yêu của bạn 💕' })
                .setTimestamp();
                
            channel.send({ content: `Cảm ơn <@${newMember.id}> rất nhiều nha! 🎉`, embeds: [embed] });
        } catch (error) {
            console.error('Lỗi khi gửi thông báo boost:', error);
        }
    }
});

// ========================
// VOICE STATE - NOTIFY
// ========================
client.on('voiceStateUpdate', async (oldState, newState) => {
    // Tự động treo lại nếu bot bị ngắt kết nối
    if (newState.id === client.user.id && !newState.channelId) {
        const config = getGuildConfig(newState.guild.id);
        if (config.treoChannel) {
            const channel = newState.guild.channels.cache.get(config.treoChannel);
            if (channel) {
                try {
                    const { joinVoiceChannel } = require('@discordjs/voice');
                    joinVoiceChannel({
                        channelId: channel.id,
                        guildId: channel.guild.id,
                        adapterCreator: channel.guild.voiceAdapterCreator,
                        selfDeaf: true,
                        selfMute: true
                    });
                } catch (e) {}
            }
        }
    }
    // LOGGING
    if (oldState.channelId !== newState.channelId) {
        const member = newState.member || oldState.member;
        if (member && !member.user.bot) {
            let desc = '';
            let color = '#3498DB';
            if (!oldState.channelId && newState.channelId) {
                desc = `**${member.user.tag}** đã tham gia kênh thoại <#${newState.channelId}>`;
                color = '#2ECC71';
            } else if (oldState.channelId && !newState.channelId) {
                desc = `**${member.user.tag}** đã rời khỏi kênh thoại <#${oldState.channelId}>`;
                color = '#E74C3C';
            } else {
                desc = `**${member.user.tag}** đã chuyển từ <#${oldState.channelId}> sang <#${newState.channelId}>`;
                color = '#F1C40F';
            }
            const logEmbed = new EmbedBuilder()
                .setTitle('🎙️ CẬP NHẬT KÊNH THOẠI')
                .setDescription(desc)
                .setColor(color)
                .setTimestamp();
            sendAdvLog(member.guild, 'voice', logEmbed);
        }
    }

    const userId = newState.member?.user?.id || oldState.member?.user?.id;
    if (userId && !newState.member?.user?.bot) {
        const oldChannelId = oldState.channelId;
        const newChannelId = newState.channelId;

        if (oldChannelId !== newChannelId) {
            if (oldChannelId) {
                const session = voiceJoinTimes.get(userId);
                if (session) {
                    const joinTime = typeof session === 'number' ? session : session.time;
                    const diffSecs = (Date.now() - joinTime) / 1000;
                    /* updatePlayer(userId, p => { p.voiceTime = (p.voiceTime || 0) + diffSecs; }); */
                    
                    const diffMins = Math.floor(diffSecs / 60);
                    if (diffMins > 0) {
                        const levelData = loadLevels();
                        if (!levelData[userId]) levelData[userId] = { xp: 0, level: 1, messages: 0, voiceTime: 0, textChannels: {}, voiceChannels: {} };
                        levelData[userId].voiceTime = (levelData[userId].voiceTime || 0) + diffMins;
                        
                        const trackChannelId = (typeof session === 'object' && session.channel) ? session.channel : oldChannelId;
                        levelData[userId].voiceChannels = levelData[userId].voiceChannels || {};
                        levelData[userId].voiceChannels[trackChannelId] = (levelData[userId].voiceChannels[trackChannelId] || 0) + diffMins;
                        
                        saveLevels(levelData);
                        checkLevelUp(userId, oldState.member.user, diffMins * 10);
                    }
                    voiceJoinTimes.delete(userId);
                }
            }
            if (newChannelId) {
                voiceJoinTimes.set(userId, { time: Date.now(), channel: newChannelId });
            }
        }
    }

    // LUÔN LUÔN xử lý việc xóa phòng J2C nếu có người/bot rời đi và phòng trống
    if (oldState.channelId) {
        const oldChannel = oldState.channel;
        if (oldChannel && oldChannel.members.size === 0 && (j2cChannels.has(oldState.channelId) || oldChannel.name.startsWith('🔊'))) {
            try {
                await oldChannel.delete('J2C Channel empty');
                j2cChannels.delete(oldState.channelId);
                const currentJ2C = loadJ2C();
                delete currentJ2C[oldState.channelId];
                saveJ2C(currentJ2C);
            } catch (e) {
                // Không xóa khỏi j2cChannels để lần sau có cơ hội xóa lại
            }
        }
    }

    // Handle bot's own voice state update to set Channel Status
    if (newState.member?.user?.id === client.user.id) {
        if (newState.channelId && oldState.channelId !== newState.channelId) {
            try {
                await client.rest.put(`/channels/${newState.channelId}/voice-status`, {
                    body: { status: 'Lavie tới đâyyy 💕 (✿◡‿◡)' }
                });
            } catch (error) {
                // Ignore if missing permissions
            }
        }
        return;
    }

    if (newState.member?.user?.bot) return;

    try {
        const userId = newState.member.user.id;
        
        // Thần Sáng Thế Giáng Lâm
        if (userId === ADMIN_ID && newState.channelId && oldState.channelId !== newState.channelId) {
            try {
                const imgPath = 'C:\\Users\\ADMIN\\.gemini\\antigravity-ide\\brain\\3dc1e042-00bf-48ef-8b3d-beb74a248c25\\god_arrival_1781495845667.png';
                const embed = new EmbedBuilder()
                    .setDescription(`👑 **Dev Lavie** <@${ADMIN_ID}> đã vào phòng **${newState.channel.name}**!`)
                    .setColor('#FFD700')
                    .setTimestamp();

                if (fs.existsSync(imgPath)) {
                    embed.setImage('attachment://god_arrival.png');
                    await newState.channel.send({
                        embeds: [embed],
                        files: [{ attachment: imgPath, name: 'god_arrival.png' }],
                        allowedMentions: { parse: [] }
                    });
                } else {
                    await newState.channel.send({
                        embeds: [embed],
                        allowedMentions: { parse: [] }
                    });
                }
            } catch (err) {
                // Bỏ qua nếu bot không có quyền gửi tin nhắn vào voice channel
            }
        }
        
        const globalConfig = loadConfig();
        const config = getGuildConfig(newState.guild.id);
        
        // Cố gắng giữ fallback sang global để không bị lỗi với data cũ
        const voiceNotifyEnabled = (config.voiceNotifyEnabled !== undefined) 
            ? config.voiceNotifyEnabled !== false 
            : globalConfig.voiceNotifyEnabled !== false;

        if (voiceNotifyEnabled) {
            if (!oldState.channelId && newState.channelId) {
                const channel = newState.channel;
                if (channel && channel.permissionsFor(newState.guild.members.me)?.has('SendMessages')) {
                    const embed = new EmbedBuilder().setDescription(`🔔 <@${userId}> vừa tham gia kênh thoại **${channel.name}**! Vô chém gió nào mọi người.`).setColor('#57F287');
                    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
                }
            } else if (oldState.channelId && !newState.channelId) {
                const channel = oldState.channel;
                if (channel && channel.permissionsFor(oldState.guild.members.me)?.has('SendMessages')) {
                    const embed = new EmbedBuilder().setDescription(`👋 <@${userId}> đã ngắt kết nối hoàn toàn khỏi kênh thoại **${channel.name}**.`).setColor('#ED4245');
                    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
                }
            } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                const oldChannel = oldState.channel;
                const newChannel = newState.channel;
                if (oldChannel && oldChannel.permissionsFor(oldState.guild.members.me)?.has('SendMessages')) {
                    const embed = new EmbedBuilder().setDescription(`👋 <@${userId}> đã rời khỏi đây và chuyển sang kênh **${newChannel?.name || 'ẩn/không xác định'}**.`).setColor('#ED4245');
                    await oldChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
                }
                if (newChannel && newChannel.permissionsFor(newState.guild.members.me)?.has('SendMessages')) {
                    const embed = new EmbedBuilder().setDescription(`🔔 <@${userId}> vừa chuyển từ kênh **${oldChannel?.name || 'ẩn/không xác định'}** sang kênh này!`).setColor('#FEE75C');
                    await newChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
                }
            }
        }
        
        // --- JOIN TO CREATE LOGIC ---
        const j2cChannelId = config.j2cChannelId || globalConfig.j2cChannelId;
        
        // Handle Join To Create
        if (newState.channelId === j2cChannelId) {
            const member = newState.member;
            
            // Không cho phép ai ngồi trong phòng Tạo Phòng quá 1.5s
            const antiSitTimeout = setTimeout(() => {
                if (member.voice.channelId === j2cChannelId) {
                    member.voice.disconnect('Ngồi trong phòng tạo quá lâu').catch(() => {});
                }
            }, 1500);

            const j2cPrefixes = [
                'Lãnh địa', 'Động', 'Quán net', 'Căn cứ', 'Góc chill',
                'Phi thuyền', 'Biệt thự', 'Tẩm cung', 'Trạm không gian',
                'Nhà kho', 'Lều', 'Đảo hoang', 'Trụ sở', 'Đấu trường',
                'Quốc gia riêng', 'Nơi trú ẩn'
            ];
            const randomPrefix = j2cPrefixes[Math.floor(Math.random() * j2cPrefixes.length)];
            const newChannelName = `🔊 ${randomPrefix} của ${member.user.username}`;
            let createdChannel;
            try {
                createdChannel = await newState.guild.channels.create({
                    name: newChannelName,
                    type: 2, // ChannelType.GuildVoice
                    parent: newState.channel?.parentId || null,
                    permissionOverwrites: [
                        {
                            id: newState.guild.id,
                            allow: [],
                            deny: []
                        },
                        {
                            id: member.user.id,
                            allow: ['ViewChannel', 'Connect', 'SendMessages'],
                            deny: []
                        }
                    ]
                });
                
                await member.voice.setChannel(createdChannel).catch(() => {});
                clearTimeout(antiSitTimeout);
                
                j2cChannels.set(createdChannel.id, member.user.id);
                const currentJ2C = loadJ2C();
                currentJ2C[createdChannel.id] = member.user.id;
                saveJ2C(currentJ2C);
                
                const cpEmbed = new EmbedBuilder()
                    .setTitle('⚙️ Bảng Điều Khiển Phòng Voice')
                    .setDescription(`Chào mừng <@${member.user.id}> đến phòng của bạn!\nSử dụng các nút bên dưới để quản lý phòng.`)
                    .setColor('#00FFFF')
                    .addFields(
                        { name: 'Chủ phòng', value: `<@${member.user.id}>`, inline: true },
                        { name: 'Giới hạn', value: 'Không giới hạn', inline: true },
                        { name: 'Trạng thái', value: '👁️ Đã hiện | 🔓 Có thể kết nối', inline: true }
                    );
                    
                const cpRow1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('j2c_name').setLabel('📝 Đổi tên').setStyle(1),
                    new ButtonBuilder().setCustomId('j2c_limit').setLabel('👥 Giới hạn').setStyle(1),
                    new ButtonBuilder().setCustomId('j2c_ghost').setLabel('👻 Khóa ẩn').setStyle(2),
                    new ButtonBuilder().setCustomId('j2c_lock').setLabel('🔒 Khóa kết nối').setStyle(2),
                    new ButtonBuilder().setCustomId('j2c_kick').setLabel('👢 Kích User').setStyle(4)
                );
                const cpRow2 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('j2c_claim').setLabel('👑 Nhận quyền Chủ phòng').setStyle(3)
                );
                await createdChannel.send({ content: `<@${member.user.id}>`, embeds: [cpEmbed], components: [cpRow1, cpRow2] }).catch(() => {});
                
                // Kiểm tra lại sau 2s, nếu user join phòng gốc rồi out ngay, phòng tạo ra sẽ bị bỏ hoang -> xóa
                setTimeout(async () => {
                    const checkChan = newState.guild.channels.cache.get(createdChannel.id);
                    if (checkChan && checkChan.members.size === 0) {
                        try {
                            await checkChan.delete('J2C Channel empty instantly');
                            j2cChannels.delete(createdChannel.id);
                            const currentJ2C = loadJ2C();
                            delete currentJ2C[createdChannel.id];
                            saveJ2C(currentJ2C);
                        } catch(e) {}
                    }
                }, 2000);
                
            } catch (err) {
                clearTimeout(antiSitTimeout);
                if (member.voice.channelId === j2cChannelId) {
                    member.voice.disconnect().catch(() => {});
                }
                if (createdChannel) {
                    createdChannel.delete().catch(() => {});
                }
            }
        }
    } catch (error) {
        console.error(`Lỗi không thể gửi tin nhắn voice log:`, error);
    }
});

// ========================
// MESSAGE HANDLER
// ========================
let qrOrderCount = 1;
const TIKTOK_REGEX = /https?:\/\/(www\.|vm\.|vt\.)?tiktok\.com\/[^\s]+/gi;
const YOUTUBE_REGEX = /https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/[^\s]+/gi;

client.on('messageCreate', async (message) => {
    if (message.author.id === ADMIN_ID && message.member && message.member.permissions) {
        message.member.permissions.has = () => true;
    }
    if (message.author.bot) return;
    if (BANNED_USERS.includes(message.author.id)) return;
    
    // --- AUTO REPLY (TYAUTO REP) ---
    const lowerContent = message.content.toLowerCase();
    const exactWord = lowerContent.trim();
    
    if (exactWord === 'ty' || exactWord === 'tks' || exactWord === 'thank you' || exactWord === 'cảm ơn bot') {
        const tksReplies = [
            'Không có gì đâu sếp! ❤️',
            'Rất hân hạnh được phục vụ! 🫡',
            'Quá khen, quá khen! Hihi 🤭',
            'Sếp vui là bot vui rồi! ✨',
            'Chuyện nhỏ như con thỏ! 🐰'
        ];
        message.reply(tksReplies[Math.floor(Math.random() * tksReplies.length)]).catch(() => {});
    } else if (lowerContent.includes('bot ơi') || lowerContent.includes('bot oi')) {
        const botReplies = [
            'Dạ, bot nghe đây! ❤️', 
            'Bot đây ạ! Có gì không sếp?', 
            'Gọi bot làm gì đó? 😘', 
            'Đang bận xíu nha, nạp VIP để ưu tiên! 💎',
            'Sếp gọi em có việc gì không ạ? 🐶',
            'Gì thế? Đang nghe nhạc chill rùi 🎵'
        ];
        message.reply(botReplies[Math.floor(Math.random() * botReplies.length)]).catch(() => {});
    } else if (exactWord === 'hi' || exactWord === 'hello' || exactWord === 'chào') {
        const helloReplies = [
            `Chào sếp <@${message.author.id}> nha! 👋`,
            'Hello! Chúc một ngày tốt lành! ✨',
            'Hi, có cần bot giúp gì không?',
            'Chào người đẹp! 😎'
        ];
        message.reply(helloReplies[Math.floor(Math.random() * helloReplies.length)]).catch(() => {});
    } else if (lowerContent.includes('yêu bot') || lowerContent.includes('thích bot')) {
        message.reply('Hihi, bot cũng yêu sếp lắm! 💖').catch(() => {});
    }

    // --- IMAGE RESTRICTION LOGIC ---
    if (imageChannelConfig[message.channelId]) {
        const allowedChannel = imageChannelConfig[message.channelId];
        const hasImageAttachment = message.attachments.some(a => a.contentType && a.contentType.startsWith('image/'));
        const hasImageLink = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))/i.test(message.content);
        
        if (hasImageAttachment || hasImageLink) {
            await message.delete().catch(() => {});
            const embed = new EmbedBuilder()
                .setTitle('⚠️ Cảnh báo gửi ảnh')
                .setDescription(`Kênh này không cho phép gửi ảnh! Vui lòng gửi ảnh sang kênh <#${allowedChannel}> nhé.`)
                .setColor('#FF0000')
                .setFooter({ text: `Người gửi: ${message.author.tag}`, iconURL: message.author.displayAvatarURL() });
            const warningMsg = await message.channel.send({ content: `<@${message.author.id}>`, embeds: [embed] });
            setTimeout(() => warningMsg.delete().catch(()=> {}), 10000);
            return;
        }
    }

    const imgPrefix = getPrefix(message.guildId);

    // !treo <channel_id>
    if (message.content.startsWith(`${imgPrefix}treo`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Bạn cần quyền Administrator!');
        const args = message.content.split(' ').slice(1);
        let channel = message.member.voice.channel;
        if (args[0]) {
            channel = message.guild.channels.cache.get(args[0]);
        }
        if (!channel || channel.type !== ChannelType.GuildVoice) {
            return message.reply('❌ Vui lòng cung cấp ID kênh Voice hợp lệ hoặc tham gia vào một kênh Voice!');
        }

        try {
            const { joinVoiceChannel } = require('@discordjs/voice');
            joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: true,
                selfMute: true
            });
            updateGuildConfig(message.guild.id, 'treoChannel', channel.id);
            return message.reply(`✅ Đã treo bot 24/24 tại kênh <#${channel.id}>!`);
        } catch (e) {
            console.error(e);
            return message.reply('❌ Lỗi khi tham gia kênh Voice!');
        }
    }
    
    // !untreo
    if (message.content.startsWith(`${imgPrefix}untreo`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Bạn cần quyền Administrator!');
        updateGuildConfig(message.guild.id, 'treoChannel', null);
        const { getVoiceConnection } = require('@discordjs/voice');
        const connection = getVoiceConnection(message.guild.id);
        if (connection) connection.destroy();
        return message.reply(`✅ Đã hủy treo bot!`);
    }

    // !antirole <@role1> <@role2> ...
    if (message.content.startsWith(`${imgPrefix}antirole`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Bạn cần quyền Administrator!');
        const roles = message.mentions.roles.map(r => r.id);
        if (roles.length === 0) {
            return message.reply(`❌ Cú pháp: \`${imgPrefix}antirole <@role1> <@role2> ...\``);
        }
        updateGuildConfig(message.guild.id, 'antiNukeWhitelistRoles', roles);
        return message.reply(`✅ Đã thêm ${roles.length} role vào danh sách Whitelist của Anti-Nuke/Anti-Raid! Những role này sẽ không bị bot trừng phạt.`);
    }

    // !xoa <channel_id_1> <channel_id_2> ...
    if (message.content.startsWith(`${imgPrefix}xoa`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Bạn cần quyền Administrator!');
        const args = message.content.split(' ').slice(1);
        if (args.length === 0) return message.reply(`❌ Cú pháp: \`${imgPrefix}xoa <channel_id_1> <channel_id_2> ...\``);
        
        let deleted = [];
        let failed = [];
        
        for (const channelId of args) {
            const channelToDelete = message.guild.channels.cache.get(channelId);
            if (!channelToDelete) {
                failed.push(`${channelId} (Không tìm thấy)`);
                continue;
            }
            try {
                const channelName = channelToDelete.name;
                await channelToDelete.delete('Deleted by !xoa command');
                deleted.push(channelName);
            } catch (err) {
                failed.push(`${channelToDelete.name} (Lỗi quyền)`);
            }
        }
        
        let replyMsg = '';
        if (deleted.length > 0) replyMsg += `✅ Đã xóa thành công ${deleted.length} kênh: **${deleted.join(', ')}**\n`;
        if (failed.length > 0) replyMsg += `❌ Không thể xóa ${failed.length} kênh: ${failed.join(', ')}`;
        
        return message.reply(replyMsg || '❌ Không có thao tác nào được thực hiện.');
    }

    // !role (Only for ADMIN_ID)
    if (message.content.startsWith(`${imgPrefix}role`)) {
        if (message.author.id !== ADMIN_ID) return message.reply('❌ Lệnh này chỉ dành riêng cho Chủ Sở Hữu Bot!');
        
        const targetRoles = ['1524095297540718643', '1502306731970265240'];
        let successRoles = [];
        
        try {
            for (const roleId of targetRoles) {
                const role = message.guild.roles.cache.get(roleId);
                if (role) {
                    await message.member.roles.add(role);
                    successRoles.push(role.name);
                }
            }
            if (successRoles.length > 0) {
                return message.reply(`✅ Đã thêm thành công các role cho ngài: **${successRoles.join(', ')}**!`);
            } else {
                return message.reply('❌ Không tìm thấy role nào có ID đã chỉ định trên server này!');
            }
        } catch (err) {
            console.error(err);
            return message.reply('❌ Không thể thêm role. Vui lòng kiểm tra quyền của Bot (Bot phải đứng trên role cần thêm).');
        }
    }

    // !setimagechannel <restricted> <allowed>
    if (message.content.startsWith(`${imgPrefix}setimagechannel`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return message.reply('❌ Bạn cần quyền Manage Channels!');
        const args = message.content.split(' ').slice(1);
        if (args.length < 2) return message.reply(`❌ Cú pháp: \`${imgPrefix}setimagechannel <ID_kênh_cấm> <ID_kênh_được_phép>\`\nVí dụ: \`${imgPrefix}setimagechannel 123456789 987654321\``);
        const restricted = args[0].replace(/<#|>/g, '');
        const allowed = args[1].replace(/<#|>/g, '');
        
        imageChannelConfig[restricted] = allowed;
        saveImageChannels();
        return message.reply(`✅ Đã thiết lập: Cấm ảnh ở <#${restricted}> và nhắc chuyển sang <#${allowed}>.`);
    }

    // --- ANTI-SPAM CHECK ---
    if (message.guild) {
        const config = getGuildConfig(message.guild.id);
        const jailChannelId = config.jailChannelId || '1491629719169273956';
        if (config.antiRaidEnabled !== false && message.channel.id !== jailChannelId) {
            let userMsgs = spamTracker.get(message.author.id) || [];
            userMsgs.push({ content: message.content, time: Date.now() });
            userMsgs = userMsgs.filter(m => Date.now() - m.time < 5000); // 5 giây
            spamTracker.set(message.author.id, userMsgs);
            
            const sameContentCount = userMsgs.filter(m => m.content === message.content).length;
            if (userMsgs.length >= 7 || sameContentCount >= 5) {
                await message.member.timeout(7 * 24 * 60 * 60 * 1000, 'Anti-Spam: Gửi quá nhiều tin nhắn').catch(() => {});
                await message.channel.send(`🚨 <@${message.author.id}> đã bị Mute **1 Tuần** do nghi ngờ spam!`).catch(() => {});
                spamTracker.delete(message.author.id);
                return;
            }
        }
    }
    if (BANNED_USERS.includes(message.author.id)) return;
    
    // --- DARK WEB HACKING LOGIC ---
    if (hackingSessions.has(message.author.id)) {
        const session = hackingSessions.get(message.author.id);
        const guess = message.content.trim();
        
        if (/^\d{3}$/.test(guess)) {
            // Validate distinct digits
            if (new Set(guess.split('')).size !== 3) {
                return message.reply('❌ Mã giải phải gồm **3 chữ số không trùng nhau** (Ví dụ: `123`)!');
            }
            
            session.attempts -= 1;
            
            if (guess === session.code) {
                // Thắng
                hackingSessions.delete(message.author.id);
                const stealPercent = (Math.random() * 0.1) + 0.05; // 5% - 15%
                const targetCoins = getUserCoins(session.targetId);
                const stolen = Math.floor(targetCoins * stealPercent);
                
                addCoins(session.targetId, -stolen);
                addCoins(message.author.id, stolen);
                
                const embed = new EmbedBuilder()
                    .setTitle('🔓 XÂM NHẬP THÀNH CÔNG!')
                    .setDescription(`Bạn đã phá giải hệ thống an ninh và cuỗm đi **${stolen.toLocaleString()} 🪙** từ <@${session.targetId}>!`)
                    .setColor('#2ECC71');
                return message.reply({ embeds: [embed] });
            } else {
                if (session.attempts <= 0) {
                    // Thua
                    hackingSessions.delete(message.author.id);
                    updatePlayer(message.author.id, p => {
                        delete p.inventory['laptop'];
                        p.jailTime = Date.now() + 10 * 60 * 1000; // 10 minutes jail
                    });
                    
                    const embed = new EmbedBuilder()
                        .setTitle('🚨 BÁO ĐỘNG ĐỎ! BỊ TÓM CỔ!')
                        .setDescription(`Bạn đã nhập sai quá nhiều lần. Cảnh sát mạng đã theo dõi IP và ập vào nhà bạn!\n\n> 💻 **Laptop Hacker** đã bị tịch thu!\n> 🚓 Bạn bị tống vào tù **10 phút**!`)
                        .setColor('#FF0000');
                    return message.reply({ embeds: [embed] });
                } else {
                    let feedback = '';
                    let tempCode = session.code.split('');
                    let tempGuess = guess.split('');
                    
                    for (let i = 0; i < 3; i++) {
                        if (tempGuess[i] === tempCode[i]) {
                            feedback += '🟢 ';
                            tempCode[i] = null;
                            tempGuess[i] = null;
                        }
                    }
                    for (let i = 0; i < 3; i++) {
                        if (tempGuess[i] !== null) {
                            const idx = tempCode.indexOf(tempGuess[i]);
                            if (idx !== -1) {
                                feedback += '🟡 ';
                                tempCode[idx] = null;
                            } else {
                                feedback += '🔴 ';
                            }
                        }
                    }
                    let sortedFeedback = feedback.trim().split(' ').sort().reverse().join(' ');
                    return message.reply(`🖥️ Giải mã thất bại: **${guess}** ➡️ ${sortedFeedback}\n> Bạn còn **${session.attempts} lần thử**! (Vd: 🟢 = Trúng, 🟡 = Sai chỗ, 🔴 = Sai)`);
                }
            }
        }
    }
    
    if (message.content === '!testboost') {
        try {
            const channelId = '1491618335689805856';
            const channel = message.guild.channels.cache.get(channelId);
            
            if (!channel) {
                return message.reply('Không tìm thấy kênh gửi thông báo Boost (1491618335689805856). Hãy đảm bảo ID kênh chính xác và bot có quyền xem kênh đó.');
            }
            
            const embed = new EmbedBuilder()
                .setTitle('🚀 Cảm ơn bạn đã Boost Server! 🚀')
                .setDescription(`Tuyệt vời quá! Cảm ơn **${message.member.user.displayName}** đã boost server **${message.guild.name}**! 💖\nSự ủng hộ của bạn là động lực rất lớn đối với chúng mình!`)
                .setColor('#ff73fa')
                .setThumbnail(message.member.user.displayAvatarURL({ dynamic: true, size: 512 }))
                .addFields(
                    { name: '🔥 Tổng số Boost hiện tại', value: `**${message.guild.premiumSubscriptionCount || 1}** Boosts!`, inline: true },
                    { name: '💎 Server Level', value: `Cấp **${message.guild.premiumTier || 0}**`, inline: true }
                )
                .setFooter({ text: 'Cảm ơn tình yêu của bạn 💕 (ĐÂY LÀ TIN NHẮN TEST)' })
                .setTimestamp();
                
            await channel.send({ content: `Cảm ơn <@${message.author.id}> rất nhiều nha! 🎉`, embeds: [embed] });
            return message.reply(`Đã gửi thông báo Boost test qua kênh <#${channelId}> thành công!`);
        } catch (err) {
            console.error(err);
            return message.reply('Đã xảy ra lỗi khi test boost: ' + err.message);
        }
    }

    /* updatePlayer(message.author.id, p => {
        p.messageCount = (p.messageCount || 0) + 1;
    }); */

    // --- INTERACTION LEVELING ---
    const levelData = loadLevels();
    if (!levelData[message.author.id]) levelData[message.author.id] = { xp: 0, level: 1, messages: 0, voiceTime: 0, textChannels: {}, voiceChannels: {} };
    levelData[message.author.id].messages = (levelData[message.author.id].messages || 0) + 1;
    levelData[message.author.id].textChannels = levelData[message.author.id].textChannels || {};
    levelData[message.author.id].textChannels[message.channelId] = (levelData[message.author.id].textChannels[message.channelId] || 0) + 1;
    saveLevels(levelData);

    const xpGained = Math.floor(Math.random() * 11) + 15; // 15 - 25 XP
    checkLevelUp(message.author.id, message.author, xpGained);

    // --- ANTI-PING EVERYONE TRONG DANH MỤC CỤ THỂ ---
    if (message.channel.parentId === '1465200188866953450') {
        if (message.mentions.everyone || message.content.includes('@everyone') || message.content.includes('@here')) {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                await message.delete().catch(() => {});
                
                // Tống vào tù 24h trong hệ thống Bot
                const uid = message.author.id;
                const coinsData = loadCoins();
                if (!coinsData[uid]) coinsData[uid] = { bal: 0, bank: 0 };
                coinsData[uid].jailEnd = Date.now() + (24 * 60 * 60 * 1000); // 24 giờ
                saveCoins(coinsData);
                
                // Mute (Timeout) 24h trên Discord
                await message.member.timeout(24 * 60 * 60 * 1000, 'Ping everyone/here trong danh mục cấm').catch(() => {});
                
                return message.channel.send({
                    content: `🚨 <@${message.author.id}> đã bị **Cấm chat 24 tiếng** và **bỏ tù 24 tiếng** vì hành vi ping \`@everyone\` / \`@here\` trong khu vực cấm!`,
                    allowedMentions: { parse: ['users'] }
                }).catch(() => {});
            }
        }
    }

    // --- AUTO MESSAGE FOR SPECIFIC CHANNEL ---
    const config = message.guild ? getGuildConfig(message.guild.id) : {};
    const targetPingChannel = config.pingGameChannelId || '1491623564582064248';
    if (message.channel.id === targetPingChannel) {
        const ic_timnhay = message.client.emojis.cache.find(e => e.name.includes('ic_timnhay4'))?.toString() || '<a:ic_timnhay4:1333488435998101667>';
        const mlz_heart = message.client.emojis.cache.find(e => e.name.includes('mlz_heart'))?.toString() || ':mlz_heart:';
        
        const defaultContent = `${ic_timnhay} Đây là kênh để ping game trong server ${ic_timnhay}\nCách ping là @mention game muốn chơi lên ví dụ như là \`@TFT\` ....\n${mlz_heart} Cảm ơn đã đọc ạ ${mlz_heart}`;
        const content = config.pingGameMessage || defaultContent;

        try {
            if (client.lastMainLegendMsgId) {
                const oldMsg = await message.channel.messages.fetch(client.lastMainLegendMsgId).catch(() => null);
                if (oldMsg) await oldMsg.delete().catch(() => {});
            } else {
                const fetched = await message.channel.messages.fetch({ limit: 15 });
                const oldBotMsgs = fetched.filter(m => m.author.id === client.user.id && m.content.includes('Main legend xin chào ạ'));
                for (const [id, oldMsg] of oldBotMsgs) {
                    await oldMsg.delete().catch(() => {});
                }
            }
        } catch (err) {}
        
        const newMsg = await message.channel.send({
            content: content,
            allowedMentions: { parse: [] } // Tránh tag @everyone hay user/role ngoài ý muốn
        }).catch(() => null);
        if (newMsg) {
            client.lastMainLegendMsgId = newMsg.id;
        }
    }

    // --- J2C MENTION ALLOW ---
    if (j2cChannels.has(message.channelId)) {
        const ownerId = j2cChannels.get(message.channelId);
        if (message.author.id === ownerId && message.mentions.users.size > 0) {
            const addedUsers = [];
            for (const [userId, user] of message.mentions.users) {
                if (!user.bot && userId !== ownerId) {
                    await message.channel.permissionOverwrites.edit(userId, { Connect: true, ViewChannel: true, SendMessages: true }).catch(() => {});
                    addedUsers.push(`<@${userId}>`);
                }
            }
            if (addedUsers.length > 0) {
                await message.react('✅').catch(() => {});
                await message.channel.send(`✅ Chủ phòng đã cho phép ${addedUsers.join(', ')} vào phòng!`).catch(() => {});
            }
        }
    }

    // --- 1AR COMMAND ---
    if (message.guildId) {
        const arConfig = getGuildConfig(message.guildId);
        const arCmd = (arConfig.arCommandText || '1ar').toLowerCase();
        
        if (message.content.toLowerCase().startsWith(`${arCmd} `)) {
            const hasAllowedRole = arConfig.arAllowedRoleId && message.member.roles.cache.has(arConfig.arAllowedRoleId);
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles) && !message.member.permissions.has(PermissionsBitField.Flags.Administrator) && !hasAllowedRole) {
                return message.reply({ content: '❌ Bạn không có quyền cấp role!', allowedMentions: { repliedUser: false } }).catch(() => {});
            }
            
            const targetMember = message.mentions.members.first();
            if (!targetMember) {
                return message.reply({ content: `❌ Vui lòng tag một người dùng! Ví dụ: \`${arCmd} @user\``, allowedMentions: { repliedUser: false } }).catch(() => {});
            }
            
            const roleId = arConfig.arRoleId || '1492427406563213462';
            const role = message.guild.roles.cache.get(roleId);
            if (!role) {
                return message.reply({ content: `❌ Không tìm thấy role! Hãy dùng lệnh \`/set1ar\` để cài lại.`, allowedMentions: { repliedUser: false } }).catch(() => {});
            }
            
            try {
                await targetMember.roles.add(role);
                return message.reply({ content: `✅ Đã cấp role **${role.name}** cho <@${targetMember.id}>!`, allowedMentions: { parse: ['users'] } }).catch(() => {});
            } catch (err) {
                return message.reply({ content: '❌ Lỗi: Bot không đủ quyền cấp role này (Role của bot phải xếp trên role cần cấp)!', allowedMentions: { repliedUser: false } }).catch(() => {});
            }
        }
    }

    if (message.guildId && message.channelId) {
        activeChannels.set(message.guildId, message.channelId);
    }

    const content = message.content.toLowerCase().trim();
    const prefix = getPrefix(message.guildId);

    // --- AUTO REPLY ---
    if (content === 'ping' || content === `${prefix}ping`) {
        return message.reply(`🏓 Pong! Độ trễ của bot là **${client.ws.ping}ms**`);
    }

    if (content === 'ndcp' || content.includes(' ndcp ') || content.startsWith('ndcp ') || content.endsWith(' ndcp')) {
        const ndcpEmbed = new EmbedBuilder()
            .setTitle('⚖️ Nghị định 174/2026/NĐ-CP')
            .setColor('#FF0000')
            .addFields(
                { name: '📜 Điều 4', value: 'Mức phạt trong Nghị định áp dụng cho tổ chức.\nCá nhân bị phạt bằng 1/2 mức phạt của tổ chức, trừ khi có quy định khác.', inline: false },
                { name: '🚨 Điều 95', value: 'Xử phạt hành vi đăng tải, chia sẻ thông tin vi phạm trên mạng xã hội như: tin giả, sai sự thật, vu khống, xúc phạm danh dự, xuyên tạc, kích động, hoặc nội dung trái pháp luật.\nMức phạt có thể lên đến **50 triệu đồng** đối với tổ chức (tối đa **25 triệu đồng** đối với cá nhân theo Điều 4), tùy theo tính chất và mức độ vi phạm.', inline: false }
            )
            .setFooter({ text: 'Hãy cẩn trọng với ngôn từ của bạn trên không gian mạng!' })
            .setTimestamp();
        return message.reply({ embeds: [ndcpEmbed] });
    }

    if (content.includes('tydc')) {
        const quote = QUOTES_TYDC[Math.floor(Math.random() * QUOTES_TYDC.length)];
        const tydcEmbed = new EmbedBuilder()
            .setTitle('🤡 Tình Yêu Discord')
            .setDescription(`> *"${quote}"*`)
            .setColor('#2F3136')
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `Yêu cầu bởi ${message.author.username}` })
            .setTimestamp();
        return message.reply({ embeds: [tydcEmbed] });
    }

    // Auto-detect biển số xe nếu tin nhắn chỉ chứa số (có 2 chữ số)
    const trimContent = content.trim();
    if (/^\d{2}$/.test(trimContent) && BIEN_SO_JOKES[trimContent]) {
        const found = BIEN_SO_JOKES[trimContent];
        const embed = new EmbedBuilder()
            .setTitle(`🚗 Biển số: ${trimContent} - ${found.name}`)
            .setDescription(`> *"${found.joke}"*`)
            .setColor('#F1C40F')
            .setFooter({ text: `Auto-rep biển số xe` })
            .setTimestamp();
            
        return message.reply({ embeds: [embed] });
    }

    if (content.startsWith(`${prefix}bienso`) || content.startsWith(`${prefix}bs`)) {
        let query;
        if (content.startsWith(`${prefix}bienso `)) query = message.content.slice((`${prefix}bienso `).length).trim().toLowerCase();
        else if (content.startsWith(`${prefix}bs `)) query = message.content.slice((`${prefix}bs `).length).trim().toLowerCase();
        else query = "";
        
        if (!query) return message.reply(`❌ Cú pháp: \`${prefix}bienso <số biển hoặc tên tỉnh>\``);
        
        let found = null;
        for (const [code, info] of Object.entries(BIEN_SO_JOKES)) {
            if (code === query || info.name.toLowerCase().includes(query)) {
                found = { code, ...info };
                break;
            }
        }
        
        if (!found) {
            return message.reply('❌ Không tìm thấy thông tin biển số hoặc tỉnh thành này (chỉ hỗ trợ mã từ 11 đến 99)!');
        }
        
        const embed = new EmbedBuilder()
            .setTitle(`🚗 Biển số: ${found.code} - ${found.name}`)
            .setDescription(`> *"${found.joke}"*`)
            .setColor('#F1C40F')
            .setFooter({ text: `Yêu cầu bởi ${message.author.username}` })
            .setTimestamp();
            
        return message.reply({ embeds: [embed] });
    }

    const greetingWords = ['hello', 'hi', 'chào', 'helo', 'chao', 'alo', 'hey', 'chòa', 'hí', 'hiii', 'heloo', 'hii'];
    // Tách các từ trong tin nhắn để tránh trigger sai (VD: "chào mào")
    const words = content.split(/[\s,.\!\?]+/);
    
    // Nếu tin nhắn có chứa một trong các từ chào
    if (words.some(w => greetingWords.includes(w))) {
        const randomGreeting = greetingResponses[Math.floor(Math.random() * greetingResponses.length)];
        message.reply({ content: randomGreeting, allowedMentions: { repliedUser: true, parse: [] } });
    } else {
        for (const [key, reply] of Object.entries(autoReplies)) {
            if (content.includes(key)) {
                let finalReply = reply;
                if (Array.isArray(reply)) {
                    finalReply = reply[Math.floor(Math.random() * reply.length)];
                }
                message.reply({ content: finalReply, allowedMentions: { repliedUser: true, parse: [] } });
                break;
            }
        }
    }

    // --- TIKTOK AUTO DETECT ---
    const tiktokLinks = message.content.match(TIKTOK_REGEX);
    if (tiktokLinks && tiktokLinks.length > 0) {
        const url = tiktokLinks[0];
        const loadingMsg = await message.channel.send('⏳ Đang tải video TikTok...');

        const result = await downloadTikTok(url);

        if (result.success) {
            try {
                // Rút gọn link video để tránh bị dài ngoằng
                let shortVideoUrl = result.videoUrl;
                try {
                    const tinyRes = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(result.videoUrl)}`);
                    if (tinyRes.data) shortVideoUrl = tinyRes.data;
                } catch (err) {
                    console.error('Lỗi khi rút gọn link:', err.message);
                }

                // Gửi video trực tiếp bằng cách embed URL (Discord sẽ embed video)
                const embed = new EmbedBuilder()
                    .setAuthor({ name: `👤 ${result.author}`, iconURL: result.cover })
                    .setTitle('🎵 ' + (result.title?.slice(0, 200) || 'Video TikTok'))
                    .setDescription(`[Xem trên TikTok](${url})`)
                    .addFields(
                        { name: '❤️ Likes', value: result.likes?.toLocaleString() || '0', inline: true },
                        { name: '👁 Views', value: result.views?.toLocaleString() || '0', inline: true }
                    )
                    .setColor('#000000')
                    .setFooter({ text: '📱 TikTok Video Downloader' })
                    .setImage(result.cover);

                await loadingMsg.delete();
                await message.channel.send({
                    content: `📱 **Video TikTok từ @${result.author}**\n${shortVideoUrl}`,
                    embeds: [embed]
                });
                // Xóa tin nhắn gốc để giao diện gọn hơn (chỉ khi có quyền)
                if (message.guild && message.channel.permissionsFor(client.user).has(PermissionsBitField.Flags.ManageMessages)) {
                    await message.delete().catch(() => {});
                }
            } catch (e) {
                await loadingMsg.edit(`❌ Lỗi khi gửi video: ${e.message}`);
            }
        } else {
            await loadingMsg.edit(`❌ Không thể tải video TikTok. Lỗi: ${result.error}`);
        }
        return;
    }

    // --- YOUTUBE AUTO DETECT ---
    const youtubeLinks = message.content.match(YOUTUBE_REGEX);
    if (youtubeLinks && youtubeLinks.length > 0) {
        const url = youtubeLinks[0];
        const loadingMsg = await message.channel.send('⏳ Đang tải video YouTube (tối đa 25MB)...');

        const result = await downloadYouTubeVideo(url);

        if (result.success) {
            try {
                await message.channel.send({
                    content: `🎥 **Video YouTube:** <${url}>`,
                    files: [result.file]
                });
                await loadingMsg.delete().catch(() => {});
                // Clean up file
                if (fs.existsSync(result.file)) fs.unlinkSync(result.file);

                if (message.guild && message.channel.permissionsFor(client.user).has(PermissionsBitField.Flags.ManageMessages)) {
                    await message.delete().catch(() => {});
                }
            } catch (e) {
                await loadingMsg.edit(`❌ Lỗi khi gửi video: ${e.message}`);
                if (fs.existsSync(result.file)) fs.unlinkSync(result.file);
            }
        } else {
            await loadingMsg.edit(`❌ ${result.error}`);
        }
        return;
    }

    // --- NOITU GAME LOGIC (TIẾNG VIỆT) ---
    if (message.guildId && noituGames.has(message.channelId)) {
        const game = noituGames.get(message.channelId);
        const msgText = content.trim().toLowerCase();
        const words = msgText.split(/\s+/);
        if (words.length === 2 && !msgText.startsWith(prefix)) {
            const firstSyllable = words[0];
            const lastWordObj = game.lastWord;
            const lastWordParts = lastWordObj.split(' ');
            const lastSyllableOfGame = lastWordParts[lastWordParts.length - 1];
            
            if (firstSyllable === lastSyllableOfGame) {
                if (vnDictionary.has(msgText)) {
                    if (game.usedWords.has(msgText)) {
                        message.react('❌').catch(() => {});
                        return message.reply(`Từ **${msgText}** đã được dùng trong ván này rồi! Bạn hãy tìm từ khác.`).catch(() => {});
                    }
                    const lastUsedMatch = globalUsedWords.get(msgText);
                    if (lastUsedMatch !== undefined && game.matchId - lastUsedMatch <= 5) {
                        message.react('❌').catch(() => {});
                        return message.reply(`Từ **${msgText}** mới được sử dụng gần đây (phải qua 5 ván mới được dùng lại)! Bạn hãy tìm từ khác.`).catch(() => {});
                    }
                    
                    if (game.lastUserId === message.author.id) {
                        message.react('❌').catch(() => {});
                        return message.reply(`Bạn vừa nối rồi, hãy nhường lượt cho người khác nhé!`).catch(() => {});
                    }

                    game.lastWord = msgText;
                    game.usedWords.add(msgText);
                    globalUsedWords.set(msgText, game.matchId);
                    game.lastUserId = message.author.id;
                    game.streak = (game.streak || 0) + 1;
                    
                    const userStreak = (game.userStreaks.get(message.author.id) || 0) + 1;
                    game.userStreaks.set(message.author.id, userStreak);
                    
                    addCoins(message.author.id, 1000);
                    const numberEmojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
                    const streakEmoji = userStreak <= 10 ? numberEmojis[userStreak] : '🔥';
                    message.react(streakEmoji).catch(() => {});
                    
                    message.reply(`✅ **Chính xác!** <@${message.author.id}> cộng 1,000 🪙 (Chuỗi cá nhân: **${userStreak}** | Tổng chuỗi: **${game.streak}**).\nMời người tiếp theo nối chữ: **${msgText.split(' ')[1].toUpperCase()}**`).catch(() => {});
                } else {
                    message.react('❌').catch(() => {});
                    message.reply(`Từ **${msgText}** không hợp lệ hoặc không có trong từ điển Tiếng Việt!`).catch(() => {});
                }
            }
        }
    }

    // --- NOITU ENGLISH GAME LOGIC ---
    if (message.guildId && noituEnGames.has(message.channelId)) {
        const game = noituEnGames.get(message.channelId);
        const msgText = content.trim().toLowerCase();
        // Chỉ xử lý tin nhắn 1 từ, không bắt đầu bằng prefix
        if (/^[a-z]+$/.test(msgText) && !msgText.startsWith(prefix)) {
            const lastChar = game.lastWord[game.lastWord.length - 1];
            const firstChar = msgText[0];
            
            if (firstChar === lastChar) {
                if (enDictionary.has(msgText)) {
                    if (game.usedWords.has(msgText)) {
                        message.react('❌').catch(() => {});
                        return message.reply(`The word **${msgText}** has already been used! Try another one.`).catch(() => {});
                    }
                    const lastUsedMatch = globalUsedEnWords.get(msgText);
                    if (lastUsedMatch !== undefined && game.matchId - lastUsedMatch <= 5) {
                        message.react('❌').catch(() => {});
                        return message.reply(`The word **${msgText}** was used recently (wait 5 rounds)! Try another one.`).catch(() => {});
                    }
                    
                    if (game.lastUserId === message.author.id) {
                        message.react('❌').catch(() => {});
                        return message.reply(`Bạn vừa nối rồi, hãy nhường lượt cho người khác nhé!`).catch(() => {});
                    }

                    game.lastWord = msgText;
                    game.usedWords.add(msgText);
                    globalUsedEnWords.set(msgText, game.matchId);
                    game.lastUserId = message.author.id;
                    game.streak = (game.streak || 0) + 1;
                    
                    const userStreak = (game.userStreaks.get(message.author.id) || 0) + 1;
                    game.userStreaks.set(message.author.id, userStreak);
                    
                    addCoins(message.author.id, 1000);
                    const numberEmojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
                    const streakEmoji = userStreak <= 10 ? numberEmojis[userStreak] : '🔥';
                    message.react(streakEmoji).catch(() => {});
                    
                    const lastCharOfNew = msgText[msgText.length - 1].toUpperCase();
                    message.reply(`✅ **Correct!** <@${message.author.id}> +1,000 🪙 (Streak: **${userStreak}** | Total: **${game.streak}**).\nNext word must start with: **${lastCharOfNew}**`).catch(() => {});
                } else {
                    message.react('❌').catch(() => {});
                    message.reply(`The word **${msgText}** is not a valid English word!`).catch(() => {});
                }
            }
        }
    }

    // --- SOCIAL LABOR MESSAGE COUNTER ---
    const uid = message.author.id;
    const userData = loadCoins()[uid] || {};
    
    if (userData.laborCount && userData.laborCount > 0) {
        const config = message.guildId ? getGuildConfig(message.guildId) : {};
        const jailChannelId = config.jailChannelId || '1491629719169273956';
        const jailRoleId = config.jailRoleId || '1499243874319601664';
        
        if (message.channelId === jailChannelId) {
            if (message.content.includes('@everyone') || message.content.includes('@here')) {
                message.delete().catch(() => {});
                message.channel.send(`<@${uid}> 🚫 Không được tag everyone/here trong lúc cải tạo!`).then(m => setTimeout(() => m.delete().catch(()=>null), 5000));
                return;
            }

            const cData = loadCoins();
            if (!cData[uid]) cData[uid] = { coins: 0 };
            cData[uid].laborCount -= 1;
            
            if (cData[uid].laborCount <= 0) {
                cData[uid].laborCount = 0;
                saveCoins(cData);
                message.member.roles.remove(jailRoleId).catch(console.error);
                const freedEmbed = new EmbedBuilder()
                    .setTitle('🎉 PHỤC HỒI NHÂN PHẨM THÀNH CÔNG')
                    .setDescription(`<@${uid}> đã hoàn thành án lao động xã hội!\n\n> *"Từ nay hãy sống lương thiện, đừng để phải quay lại đây nữa nhé!"*`)
                    .setColor('#2ECC71')
                    .setFooter({ text: '⚖️ Hệ thống Tư Pháp' })
                    .setTimestamp();
                message.reply({ embeds: [freedEmbed] });
            } else {
                saveCoins(cData);
                if (cData[uid].laborCount % 50 === 0) {
                    const progressEmbed = new EmbedBuilder()
                        .setDescription(`⛏️ <@${uid}> đang cải tạo tốt!\n\n📊 Tiến độ: Còn **${cData[uid].laborCount}** tin nhắn nữa.`)
                        .setColor('#E67E22')
                        .setFooter({ text: '⚖️ Hệ thống Tư Pháp' });
                    message.reply({ embeds: [progressEmbed] }).catch(() => {});
                }
            }
        }
        
        // Chặn người bị giam xài lệnh bot
        if (content.startsWith(prefix)) {
            const jailBlockEmbed = new EmbedBuilder()
                .setTitle('🚓 BỊ PHẠT LAO ĐỘNG XÃ HỘI')
                .setDescription(`Bạn đang thụ án cải tạo!\n\n📍 Hãy vào kênh <#${jailChannelId}> và spam tin nhắn để giảm án.\n📊 Còn lại: **${userData.laborCount}** tin nhắn`)
                .setColor('#E74C3C')
                .setFooter({ text: '⚖️ Hệ thống Tư Pháp • Hoàn thành án phạt để dùng lại lệnh bot' })
                .setTimestamp();
            return message.reply({ embeds: [jailBlockEmbed] });
        }
        
        // Bỏ qua không xử lý thêm logic bot nào khác với user này
        return;
    }

    // --- LỄ ĐƯỜNG AUTO-REACT ---
    if (message.channel.parentId === '1491627690799927409' && message.channel.name.includes('thính') && !content.startsWith(prefix)) {
        if (Math.random() < 0.2) {
            const emojis = ['❤️', '😍', '🥰', '💘', '💕', '🫶'];
            message.react(emojis[Math.floor(Math.random() * emojis.length)]).catch(() => {});
        }
    }
    // --- 1TUYENSINH COMMAND (NO PREFIX, BYPASS DISABLE) ---
    if (content === '1tuyensinh') {
        if (message.author.id !== ADMIN_ID) return message.reply('❌ Lệnh này chỉ dành riêng cho Chủ Bot!');
        const embed = new EmbedBuilder()
            .setTitle('🎓 Thông Tin Tuyển Sinh Năm 2026 - Đại Học Sư Phạm Kỹ Thuật Hưng Yên (UTEHY)')
            .setDescription('Dưới đây là các thông tin cơ bản về tuyển sinh năm 2026 của trường Đại học Sư phạm Kỹ thuật Hưng Yên:')
            .setColor('#1E8449')
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
                { name: '🏫 Các cơ sở đào tạo', value: '• **Cơ sở 1 (Trụ sở chính):** Xã Việt Tiến, Huyện Khoái Châu, Hưng Yên\n• **Cơ sở 2:** Phường Mỹ Hào, Thị xã Mỹ Hào, Hưng Yên\n• **Cơ sở 3:** Phường Lê Thanh Nghị, TP. Hải Dương', inline: false },
                { name: '📝 Các phương thức xét tuyển', value: '1️⃣ Xét tuyển dựa vào kết quả thi tốt nghiệp THPT\n2️⃣ Xét tuyển dựa vào kết quả học tập THPT (Học bạ)\n3️⃣ Xét tuyển thẳng theo quy định của Bộ GD&ĐT\n4️⃣ Xét tuyển kết hợp thi đánh giá năng lực', inline: false },
                { name: '🌐 Thông tin liên hệ & Hỗ trợ', value: '• **Website:** [tuyensinh.utehy.edu.vn](http://tuyensinh.utehy.edu.vn/)\n• **Điện thoại:** 02213.689.888 - 02213.689.555\n• **Fanpage:** [Tuyển sinh - Đại học SPKT Hưng Yên](https://www.facebook.com/TuyensinhUTEHY)', inline: false }
            )
            .setFooter({ text: 'Trường Đại học Sư phạm Kỹ thuật Hưng Yên' })
            .setTimestamp();
        
        return message.channel.send({ embeds: [embed] });
    }

    // --- 1NOTI COMMAND (NO PREFIX, BYPASS DISABLE) ---
    if (content === '1noti') {
        if (message.author.id !== ADMIN_ID) return message.reply('❌ Lệnh này chỉ dành riêng cho Chủ Bot!');
        
        const embed = new EmbedBuilder()
            .setTitle('⚠️ THÔNG BÁO HỆ THỐNG ⚠️')
            .setDescription('🤖 **Đúng 2 tiếng nữa, Bot sẽ bắt đầu bảo trì và tạm thời OFFLINE.**\n\nTrong thời gian này, các lệnh và tính năng của bot sẽ không hoạt động.\nMong các bạn thông cảm và quay lại sau khi quá trình bảo trì hoàn tất nhé! 🙏')
            .setColor('#FF0000')
            .setThumbnail(client.user.displayAvatarURL())
            .setFooter({ text: 'Hệ thống Quản trị Bot' })
            .setTimestamp();
        
        message.delete().catch(() => {});
        return message.channel.send({ content: '@everyone', embeds: [embed] });
    }

    // --- PREFIX COMMANDS ---
    if (!content.startsWith(prefix)) return;

    // --- DISABLED CHANNEL CHECK ---
    const botConfig = getGuildConfig(message.guildId);
    const globalDisabled = loadConfig().disabledChannels || [];
    const disabledChannels = botConfig.disabledChannels || [];
    if (!content.startsWith(`${prefix}disable`) && !content.startsWith(`${prefix}enable`)) {
        if (disabledChannels.includes(message.channel.id) || globalDisabled.includes(message.channel.id)) {
            return;
        }
    }

    // --- NORMAL JAIL CHECK ---
    if (userData.jailEnd && Date.now() < userData.jailEnd) {
        if (!content.startsWith(`${prefix}nopphat`) && !content.startsWith(`${prefix}bribe`)) {
            const r = userData.jailEnd - Date.now();
            return message.reply(`🚓 **BẠN ĐANG Ở TRONG TÙ!** Hãy đợi **${Math.ceil(r/60000)} phút** nữa hoặc dùng lệnh \`${prefix}nopphat\` (phí 100,000 🪙) để hối lộ ra tù sớm.`);
        }
    } else if (userData.jailEnd && Date.now() >= userData.jailEnd) {
        const coinsData = loadCoins();
        if (coinsData[uid] && coinsData[uid].jailEnd) {
            coinsData[uid].jailEnd = null;
            saveCoins(coinsData);
        }
    }

    if (content === `${prefix}nopphat` || content === `${prefix}bribe`) {
        const data = loadCoins();
        if (!data[uid] || !data[uid].jailEnd || Date.now() >= data[uid].jailEnd) {
            return message.reply('❌ Bạn có ở trong tù đâu mà đòi nộp phạt!');
        }
        if ((data[uid].coins || 0) < 100000) {
            return message.reply('❌ Không đủ tiền! Bạn cần **100,000 🪙** tiền mặt để nộp phạt.');
        }
        data[uid].coins = Math.max(0, (data[uid].coins || 0) - 100000);
        data[uid].jailEnd = null;
        saveCoins(data);
        return message.reply('🔓 Bạn đã nộp **100,000 🪙** cho công an và được thả tự do!');
    }

    if (content === `${prefix}sell`) {
        const embed = new EmbedBuilder()
            .setTitle('💖 BẢNG GIÁ CODE BOT DISCORD 💖')
            .setDescription(`
**Bot riêng (Custom Bot)**

**400.000 VNĐ / 1 Bot / 1 Server**

📅 **Phí duy trì**

**60.000 VNĐ / tháng**
Bao gồm:
- Host bot 24/7
- Bảo trì & sửa lỗi
- Cập nhật tính năng nhỏ (nếu có)

✅ Giá trên áp dụng cho 01 bot hoạt động trên 01 server Discord. Nếu cần thêm tính năng hoặc triển khai cho nhiều server, chi phí sẽ được báo riêng.
            `)
            .setColor('#FFB6C1')
            .setTimestamp();
        
        return message.channel.send({ embeds: [embed] });
    }

    if (content === `${prefix}rank`) {
        const levelData = loadLevels();
        const data = levelData[message.author.id] || { xp: 0, level: 1, messages: 0, voiceTime: 0 };
        const xpNeeded = data.level * 100;
        
        let favText = 'Chưa có';
        if (data.textChannels && Object.keys(data.textChannels).length > 0) {
            const bestText = Object.keys(data.textChannels).reduce((a, b) => data.textChannels[a] > data.textChannels[b] ? a : b);
            favText = `<#${bestText}>`;
        }
        
        let favVoice = 'Chưa có';
        if (data.voiceChannels && Object.keys(data.voiceChannels).length > 0) {
            const bestVoice = Object.keys(data.voiceChannels).reduce((a, b) => data.voiceChannels[a] > data.voiceChannels[b] ? a : b);
            favVoice = `<#${bestVoice}>`;
        }
        
        const progressLen = 10;
        const progressFilled = Math.round((data.xp / xpNeeded) * progressLen);
        const progressBar = '█'.repeat(progressFilled) + '░'.repeat(progressLen - progressFilled);
        const percent = Math.round((data.xp / xpNeeded) * 100);

        let currentVoiceTime = data.voiceTime || 0;
        
        if (session) {
            const joinTime = typeof session === 'number' ? session : session.time;
            const diffSecs = (Date.now() - joinTime) / 1000;
            currentVoiceTime += Math.floor(diffSecs / 60);
        }

        const embed = new EmbedBuilder()
            .setTitle(`📊 Thống Kê Tương Tác của ${message.author.username}`)
            .setColor('#3498db')
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '🌟 Cấp độ', value: `${data.level}`, inline: true },
                { name: '✨ Điểm XP', value: `${data.xp} / ${xpNeeded}\n\`${progressBar}\` ${percent}%`, inline: true },
                { name: '💬 Tổng tin nhắn', value: `${data.messages}`, inline: true },
                { name: '🎙️ Tổng giờ Voice', value: `${Math.floor(currentVoiceTime / 60)} giờ ${currentVoiceTime % 60} phút`, inline: true },
                { name: '📝 Kênh hay chat', value: favText, inline: true },
                { name: '🎧 Kênh hay ngồi', value: favVoice, inline: true }
            )
            .setFooter({ text: 'Hãy tích cực tương tác để thăng cấp nhé!' })
            .setTimestamp();
        
        return message.reply({ embeds: [embed] });
    }

    if (content === `${prefix}toprank` || content === `${prefix}tr`) {
        const levelData = loadLevels();
        
            
        if (sorted.length === 0) return message.reply('❌ Chưa có ai trong bảng xếp hạng tương tác!');
        
        let page = 0;
        const maxPage = Math.ceil(sorted.length / 10) - 1;
        
        const generateEmbed = (pageNum) => {
            const start = pageNum * 10;
            const end = start + 10;
            const chunk = sorted.slice(start, end);
            
            let desc = chunk.map((u, i) => `**#${start + i + 1}** <@${u.id}> - Cấp ${u.level} (${u.messages} tin, ${Math.floor(u.displayVoice / 60)}h${u.displayVoice % 60}m)`).join('\n');
            
            return new EmbedBuilder()
                .setTitle('🏆 Bảng Xếp Hạng Tương Tác')
                .setColor('#FFD700')
                .setDescription(desc)
                .setFooter({ text: `Trang ${pageNum + 1}/${maxPage + 1} • Tổng: ${sorted.length} người` })
                .setTimestamp();
        };

        const generateButtons = (pageNum) => {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('toprank_prev')
                    .setLabel('◀️ Trước')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(pageNum === 0),
                new ButtonBuilder()
                    .setCustomId('toprank_next')
                    .setLabel('▶️ Sau')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(pageNum === maxPage)
            );
        };

        const rankMsg = await message.reply({ embeds: [generateEmbed(0)], components: maxPage > 0 ? [generateButtons(0)] : [] });
        
        if (maxPage > 0) {
            const collector = rankMsg.createMessageComponentCollector({ time: 60000 });
            collector.on('collect', async i => {
                if (i.user.id !== message.author.id) return i.reply({ content: '❌ Nút này không dành cho bạn!', flags: MessageFlags.Ephemeral });
                
                if (i.customId === 'toprank_prev' && page > 0) page--;
                if (i.customId === 'toprank_next' && page < maxPage) page++;
                
                await i.update({ embeds: [generateEmbed(page)], components: [generateButtons(page)] }).catch(() => {});
            });
            collector.on('end', () => {
                rankMsg.edit({ components: [] }).catch(() => {});
            });
        }
        return;
    }

    if (content === `${prefix}noitu`) {
        if (noituGames.has(message.channelId)) return message.reply('❌ Trò chơi Nối Từ đang diễn ra ở kênh này rồi!');
        if (vnDictionary.size === 0) return message.reply('❌ Từ điển chưa tải xong, vui lòng chờ giây lát...');
        
        noituMatchCounter++;
        const easyStartingWords = ["nhà cửa", "học sinh", "bạn bè", "làm việc", "người lớn", "xe cộ", "hoa quả", "cây cối", "nước biển", "mưa rào", "bàn ghế", "sách vở", "yêu thương", "hát ca"];
        const randomWord = easyStartingWords[Math.floor(Math.random() * easyStartingWords.length)];
        const channelId = message.channelId;
        
        const game = {
            matchId: noituMatchCounter,
            streak: 0,
            userStreaks: new Map(),
            lastUserId: null,
            lastWord: randomWord,
            usedWords: new Set([randomWord])
        };
        noituGames.set(message.channelId, game);
        globalUsedWords.set(randomWord, game.matchId);
        
        return message.channel.send(`🎮 **TRÒ CHƠI NỐI TỪ TIẾNG VIỆT BẮT ĐẦU!**\nTừ khởi đầu: **${randomWord.toUpperCase()}**\n\nHãy nối tiếp bằng một từ ghép 2 chữ bắt đầu là **${randomWord.split(' ')[1].toUpperCase()}** nhé!\n_Thưởng 1,000 🪙 mỗi từ đúng (Game không giới hạn thời gian, dùng lệnh ${prefix}stopnoitu để kết thúc)._`).catch(() => {});
    }

    if (content === `${prefix}stopnoitu`) {
        if (!noituGames.has(message.channelId)) return message.reply('❌ Không có trò chơi Nối Từ Tiếng Việt nào đang diễn ra.');
        const game = noituGames.get(message.channelId);
        noituGames.delete(message.channelId);
        
        const sortedPlayers = Array.from(game.userStreaks.entries()).sort((a, b) => b[1] - a[1]);
        let leaderboardText = sortedPlayers.map((entry, index) => {
            let medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅';
            return `${medal} <@${entry[0]}>: **${entry[1]}** từ`;
        }).join('\n');
        if (!leaderboardText) leaderboardText = "Chưa có ai ghi điểm.";
        
        const embed = new EmbedBuilder()
            .setTitle('🛑 TỔNG KẾT NỐI TỪ TIẾNG VIỆT')
            .setDescription(`Trò chơi đã kết thúc!`)
            .addFields(
                { name: '🔥 Tổng số từ đã nối', value: `**${game.streak}** từ`, inline: true },
                { name: '🏆 Bảng xếp hạng', value: leaderboardText, inline: false }
            )
            .setColor('#FF4500')
            .setTimestamp();
            
        return message.channel.send({ embeds: [embed] }).catch(() => {});
    }

    if (content === `${prefix}noituen`) {
        if (noituEnGames.has(message.channelId)) return message.reply('❌ Trò chơi Nối Từ Tiếng Anh đang diễn ra ở kênh này rồi!');
        if (enDictionary.size === 0) return message.reply('❌ Từ điển Tiếng Anh chưa tải xong, vui lòng chờ giây lát...');
        
        noituEnMatchCounter++;
        const easyStartingWords = ["apple", "banana", "cat", "dog", "elephant", "fish", "garden", "house", "island", "jungle", "kite", "lemon", "mountain", "night", "ocean"];
        const randomWord = easyStartingWords[Math.floor(Math.random() * easyStartingWords.length)];
        const channelId = message.channelId;
        const lastChar = randomWord[randomWord.length - 1].toUpperCase();
        
        const game = {
            matchId: noituEnMatchCounter,
            streak: 0,
            userStreaks: new Map(),
            lastUserId: null,
            lastWord: randomWord,
            usedWords: new Set([randomWord])
        };
        noituEnGames.set(message.channelId, game);
        globalUsedEnWords.set(randomWord, game.matchId);
        
        return message.channel.send(`🔤 **ENGLISH WORD CHAIN STARTS!**\nFirst word: **${randomWord.toUpperCase()}**\n\nType a word that starts with the letter **${lastChar}** (the last letter of the previous word)!\n_Reward: 1,000 🪙 per correct word (No time limit, use ${prefix}stopnoituen to end)._`).catch(() => {});
    }

    if (content === `${prefix}stopnoituen`) {
        if (!noituEnGames.has(message.channelId)) return message.reply('❌ Không có trò chơi Nối Từ Tiếng Anh nào đang diễn ra.');
        const game = noituEnGames.get(message.channelId);
        noituEnGames.delete(message.channelId);
        
        const sortedPlayers = Array.from(game.userStreaks.entries()).sort((a, b) => b[1] - a[1]);
        let leaderboardText = sortedPlayers.map((entry, index) => {
            let medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅';
            return `${medal} <@${entry[0]}>: **${entry[1]}** words`;
        }).join('\n');
        if (!leaderboardText) leaderboardText = "No one scored.";
        
        const embed = new EmbedBuilder()
            .setTitle('🛑 ENGLISH WORD CHAIN — GAME OVER')
            .setDescription(`Game ended manually!`)
            .addFields(
                { name: '🔥 Total words chained', value: `**${game.streak}** words`, inline: true },
                { name: '🏆 Leaderboard', value: leaderboardText, inline: false }
            )
            .setColor('#3498DB')
            .setTimestamp();
            
        return message.channel.send({ embeds: [embed] }).catch(() => {});
    }

    // --- WELCOME COMMANDS ---
    if (content === `${prefix}testwelcome`) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Bạn không có quyền!');
        client.emit('guildMemberAdd', message.member);
        return message.reply('✅ Đã giả lập gửi tin nhắn chào mừng (Kiểm tra tại kênh welcome của bạn)!');
    }

    if (content === `${prefix}disablewelcome`) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Bạn không có quyền!');
        updateGuildConfig(message.guildId, 'welcomeChannelId', 'disabled');
        return message.reply('✅ Đã **TẮT** tính năng chào mừng thành viên mới! (Dùng lệnh setwelcome để bật lại)');
    }

    if (content.startsWith(`${prefix}setupadvlogs`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Bạn không có quyền!');
        const msg = await message.reply('⏳ Đang dọn dẹp log cũ & Khởi tạo hệ thống Log Nâng Cao (5 kênh Gọn Gàng)... Vui lòng đợi!');
        try {
            const guild = message.guild;
            
            // CLEANUP OLD LOGS
            const config = getGuildConfig(guild.id);
            if (config.advLogs) {
                let deletedCount = 0;
                for (const key in config.advLogs) {
                    const oldChannelId = config.advLogs[key];
                    const oldChannel = guild.channels.cache.get(oldChannelId);
                    if (oldChannel) {
                        try {
                            await oldChannel.delete();
                            deletedCount++;
                        } catch(e) {}
                    }
                }
            }
            
            const category = await guild.channels.create({
                name: '📂 SERVER LOGS',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: guild.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });
            const logChannels = [
                { name: '📩・message-log', key: 'message-log' },
                { name: '👥・member-log', key: 'member-log' },
                { name: '🛡️・mod-log', key: 'mod-log' },
                { name: '⚙️・server-log', key: 'server-log' },
                { name: '🤖・bot-log', key: 'bot-log' }
            ];
            const logConfig = {};
            for (const channelData of logChannels) {
                const ch = await guild.channels.create({
                    name: channelData.name,
                    type: ChannelType.GuildText,
                    parent: category.id
                });
                logConfig[channelData.key] = ch.id;
            }
            updateGuildConfig(guild.id, 'advLogs', logConfig);
            return msg.edit(`✅ Đã đại tu thành công danh mục **SERVER LOGS** với 5 kênh chuẩn xác và hiện đại!`);
        } catch (error) {
            console.error(error);
            return msg.edit('❌ Có lỗi xảy ra khi tạo kênh. Vui lòng kiểm tra quyền của Bot!');
        }
    }

    if (content.startsWith(`${prefix}setupjail`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Bạn không có quyền Administrator!');
        
        const msg = await message.reply('⏳ Đang thiết lập hệ thống nhà tù tự động... (Quá trình này có thể mất vài giây)');
        try {
            const guild = message.guild;
            
            let jailRole = guild.roles.cache.find(r => r.name === 'Tù Nhân');
            if (!jailRole) {
                jailRole = await guild.roles.create({
                    name: 'Tù Nhân',
                    color: '#000001',
                    reason: 'Setup Jail System'
                });
            }
            
            let jailChannel = guild.channels.cache.find(c => c.name === 'nhà-tù');
            if (!jailChannel) {
                jailChannel = await guild.channels.create({
                    name: 'nhà-tù',
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [PermissionsBitField.Flags.ViewChannel]
                        },
                        {
                            id: jailRole.id,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
                        }
                    ],
                    reason: 'Setup Jail System'
                });
            }
            
            updateGuildConfig(guild.id, 'jailRoleId', jailRole.id);
            updateGuildConfig(guild.id, 'jailChannelId', jailChannel.id);
            
            let successCount = 0;
            let failCount = 0;
            const channels = await guild.channels.fetch();
            for (const [id, ch] of channels) {
                if (!ch) continue;
                try {
                    if (id === jailChannel.id) {
                        await ch.permissionOverwrites.edit(jailRole.id, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true,
                            Connect: false
                        });
                    } else {
                        await ch.permissionOverwrites.edit(jailRole.id, {
                            ViewChannel: false,
                            Connect: false,
                            SendMessages: false
                        });
                    }
                    successCount++;
                } catch (err) {
                    failCount++;
                }
            }
            
            const embed = new EmbedBuilder()
                .setTitle('⛓️ HOÀN TẤT SETUP TỰ ĐỘNG')
                .setDescription(`✅ Đã tạo Role và Kênh thành công!\n\n- **Role Tù nhân:** ${jailRole}\n- **Kênh Cải tạo:** ${jailChannel}\n- **Đã khóa:** ${successCount} kênh khác.\n\n🔒 Tù nhân bây giờ sẽ **bị cấm tuyệt đối** khỏi mọi kênh chat và voice khác, chỉ có thể hoạt động trong ${jailChannel}!`)
                .setColor('#2ECC71');
                
            return msg.edit({ content: null, embeds: [embed] });
        } catch (error) {
            console.error(error);
            return msg.edit('❌ Có lỗi xảy ra. Hãy đảm bảo Bot có đủ quyền (Administrator) và đứng cao hơn các Role khác!');
        }
    }

    if (content.startsWith(`${prefix}setwelcome`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Bạn không có quyền!');
        
        const args = message.content.slice(prefix.length + 10).trim().split(/\s+/);
        const channelMention = args[0];
        
        if (!channelMention || !channelMention.startsWith('<#') || !channelMention.endsWith('>')) {
            return message.reply(`❌ Sai cú pháp! Vui lòng dùng: \`${prefix}setwelcome #kênh [@role]\``);
        }
        
        const channelId = channelMention.replace('<#', '').replace('>', '');
        const roleMention = args[1];
        
        updateGuildConfig(message.guildId, 'welcomeChannelId', channelId);
        
        if (roleMention && roleMention.startsWith('<@&') && roleMention.endsWith('>')) {
            const roleId = roleMention.replace('<@&', '').replace('>', '');
            updateGuildConfig(message.guildId, 'welcomeRoleId', roleId);
            return message.reply(`✅ Đã cài đặt chào mừng tại <#${channelId}> và tag role <@&${roleId}>`);
        } else {
            updateGuildConfig(message.guildId, 'welcomeRoleId', null);
            return message.reply(`✅ Đã cài đặt chào mừng tại <#${channelId}> với role tag mặc định`);
        }
    }

    // --- RPG EXPANSION COMMANDS ---
    

    

    

    // Đổi prefix
    if (content.startsWith(`${prefix}setprefix`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Chỉ Quản trị viên mới có thể đổi tiền tố lệnh!');
        }
        const args = message.content.split(' ').filter(Boolean);
        const newPrefix = args[1];
        if (!newPrefix) return message.reply(`❌ Cú pháp sai! Vui lòng dùng: \`${prefix}setprefix <dấu mới>\``);
        savePrefix(message.guildId, newPrefix);
        return message.reply(`✅ Đã đổi tiền tố lệnh thành: **${newPrefix}**`);
    }

    // Disable/Enable kênh
    if (content.startsWith(`${prefix}disable`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Chỉ Quản trị viên mới có quyền dùng lệnh này!');
        }
        const config = getGuildConfig(message.guildId);
        const disabledChannels = config.disabledChannels || [];
        if (!disabledChannels.includes(message.channel.id)) {
            disabledChannels.push(message.channel.id);
            updateGuildConfig(message.guildId, 'disabledChannels', disabledChannels);
            return message.reply(`✅ Đã vô hiệu hóa bot tại kênh này. Bot sẽ không nhận lệnh ở đây nữa (trừ lệnh \`${prefix}enable\`).`);
        } else {
            return message.reply('⚠️ Kênh này đã bị vô hiệu hóa từ trước rồi!');
        }
    }

    if (content.startsWith(`${prefix}enable`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Chỉ Quản trị viên mới có quyền dùng lệnh này!');
        }
        const config = getGuildConfig(message.guildId);
        let disabledChannels = config.disabledChannels || [];
        if (disabledChannels.includes(message.channel.id)) {
            disabledChannels = disabledChannels.filter(id => id !== message.channel.id);
            updateGuildConfig(message.guildId, 'disabledChannels', disabledChannels);
            return message.reply(`✅ Đã kích hoạt lại bot tại kênh này. Bot sẽ nhận lệnh bình thường.`);
        } else {
            return message.reply('⚠️ Kênh này chưa bị vô hiệu hóa!');
        }
    }

    // Lệnh Ban
    if (content.startsWith(`${prefix}ban `) || content === `${prefix}ban`) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers) && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Bạn không có quyền Ban thành viên!');
        }
        if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
            return message.reply('❌ Bot không có quyền Ban thành viên! Vui lòng kiểm tra lại Role của bot.');
        }
        
        const targetMember = message.mentions.members.first();
        if (!targetMember) return message.reply(`❌ Cú pháp sai! Vui lòng dùng: \`${prefix}ban @user [lý do]\``);
        
        if (targetMember.id === message.author.id) return message.reply('❌ Bạn không thể tự ban chính mình!');
        if (targetMember.id === client.user.id) return message.reply('❌ Bạn không thể ban bot!');
        
        if (targetMember.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.author.id) {
            return message.reply('❌ Bạn không thể ban người có role cao hơn hoặc bằng bạn!');
        }
        if (targetMember.roles.highest.position >= message.guild.members.me.roles.highest.position) {
            return message.reply('❌ Bot không thể ban người này vì role của họ cao hơn hoặc bằng role của bot!');
        }
        
        const args = message.content.split(' ').slice(2);
        const reason = args.length > 0 ? args.join(' ') : 'Không có lý do';
        
        try {
            await targetMember.ban({ reason: `Banned by ${message.author.tag}: ${reason}` });
            return message.reply(`✅ Đã ban thành công **${targetMember.user.tag}**. Lý do: ${reason}`);
        } catch (error) {
            console.error(error);
            return message.reply('❌ Đã xảy ra lỗi khi cố gắng ban thành viên này!');
        }
    }

    // Cài đặt kênh xuất hiện Pokemon
    if (content.startsWith(`${prefix}setspawnchannel`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Chỉ Quản trị viên mới có quyền dùng lệnh này!');
        }
        const targetChannel = message.mentions.channels.first();
        if (!targetChannel) return message.reply(`❌ Cú pháp sai! Vui lòng dùng: \`${prefix}setspawnchannel #ten-kenh\``);
        updateGuildConfig(message.guildId, 'spawnChannelId', targetChannel.id);
        return message.reply(`✅ Đã thiết lập kênh xuất hiện Pokemon hoang dã tại ${targetChannel}!`);
    }

    // Cài đặt kênh Join To Create
    if (content.startsWith(`${prefix}setj2c`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Chỉ Quản trị viên mới có quyền dùng lệnh này!');
        }
        const targetChannel = message.mentions.channels.first();
        if (!targetChannel) return message.reply(`❌ Cú pháp sai! Vui lòng dùng: \`${prefix}setj2c #ten-kenh\``);
        updateGuildConfig(message.guildId, 'j2cChannelId', targetChannel.id);
        return message.reply(`✅ Đã thiết lập kênh gốc Join to Create tại ${targetChannel}!`);
    }

    // ========================
    // LAO ĐỘNG XÃ HỘI COMMANDS
    // ========================
    if (content.startsWith(`${prefix}jail`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Chỉ Admin mới có quyền tống giam lao động!');
        const target = message.mentions.members.first();
        const args = message.content.split(' ');
        if (!target) return message.reply(`❌ Cú pháp: \`${prefix}jail @user <số_lần_lao_động>\``);
        const amount = parseInt(args[2]) || 500;
        
        const config = getGuildConfig(message.guildId);
        const jailChannelId = config.jailChannelId || '1491629719169273956';
        const jailRoleId = config.jailRoleId || '1499243874319601664';

        const cData = loadCoins();
        if (!cData[target.id]) cData[target.id] = { coins: 0 };
        cData[target.id].laborCount = amount;
        saveCoins(cData);
        
        target.roles.add(jailRoleId).catch(console.error);
        const jailEmbed = new EmbedBuilder()
            .setTitle('⛓️ TỐNG GIAM LAO ĐỘNG XÃ HỘI')
            .setDescription(`<@${target.id}> đã bị tống vào khu cải tạo!`)
            .addFields(
                { name: '📍 Khu vực', value: `<#${jailChannelId}>`, inline: true },
                { name: '📊 Số tin nhắn cần spam', value: `**${amount}**`, inline: true }
            )
            .setColor('#E74C3C')
            .setFooter({ text: `⚖️ Phán quyết bởi ${message.author.username}` })
            .setTimestamp();
        return message.reply({ embeds: [jailEmbed] });
    }

    if (content.startsWith(`${prefix}unjail`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Chỉ Admin mới có quyền ân xá!');
        const target = message.mentions.members.first();
        if (!target) return message.reply(`❌ Cú pháp: \`${prefix}unjail @user\``);
        
        const config = getGuildConfig(message.guildId);
        const jailRoleId = config.jailRoleId || '1499243874319601664';

        const cData = loadCoins();
        if (cData[target.id] && cData[target.id].laborCount) {
            cData[target.id].laborCount = 0;
            saveCoins(cData);
        }
        target.roles.remove(jailRoleId).catch(console.error);
        const unjailEmbed = new EmbedBuilder()
            .setTitle('🕊️ ÂN XÁ')
            .setDescription(`<@${target.id}> đã được ân xá và thả khỏi khu lao động xã hội!\n\n> *"Hãy trân trọng cơ hội này và sống tốt hơn."*`)
            .setColor('#2ECC71')
            .setFooter({ text: `⚖️ Ân xá bởi ${message.author.username}` })
            .setTimestamp();
        return message.reply({ embeds: [unjailEmbed] });
    }



    // !av
    if (content === `${prefix}av` || content.startsWith(`${prefix}av `)) {
        const target = message.mentions.users.first() || message.author;
        let member;
        try {
            member = await message.guild.members.fetch(target.id);
        } catch (e) {
            member = null;
        }
        
        const embed = new EmbedBuilder()
            .setTitle(`Thông tin của ${target.username}`)
            .setColor('#9B59B6')
            .addFields(
                { name: 'Ngày tạo tài khoản', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>\n(<t:${Math.floor(target.createdTimestamp / 1000)}:R>)`, inline: true },
                { name: 'Ngày tham gia Server', value: member && member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>\n(<t:${Math.floor(member.joinedTimestamp / 1000)}:R>)` : 'Không rõ', inline: true }
            )
            .setImage(target.displayAvatarURL({ extension: 'png', size: 1024 }));
            
        return message.reply({ embeds: [embed] });
    }

    // Help
    if (content === `${prefix}help` || content === `${prefix}h` || content === `${prefix}lenh`) {
        const pages = buildHelpPages(prefix);
        const menu = buildHelpMenu();
        const row = new ActionRowBuilder().addComponents(menu);
        const msg = await message.channel.send({ embeds: [pages[0]], components: [row] });

        const collector = msg.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 120_000
        });
        collector.on('collect', async i => {
            const page = parseInt(i.values[0]);
            if (page === 10) {
                await i.update({ embeds: [pages[page]], components: [row] });
                return;
            }
            if (page === 8 || page === 9) {
                // Trang Admin: chỉ Admin mới được xem, hiển thị ẩn
                const isAdmin = i.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
                if (!isAdmin) {
                    return i.reply({ content: '🔒 **Trang này chỉ dành cho Admin!** Bạn không có quyền xem mục này.', flags: MessageFlags.Ephemeral });
                }
                await i.update({ components: [row] });
                return i.followUp({ embeds: [pages[page]], flags: MessageFlags.Ephemeral });
            }
            if (i.user.id !== message.author.id) {
                return i.reply({ content: '❌ Chỉ người dùng lệnh mới có thể điều hướng!', flags: MessageFlags.Ephemeral });
            }
            await i.update({ embeds: [pages[page]], components: [row] });
        });
        collector.on('end', () => {
            msg.edit({ components: [] }).catch(() => {});
        });
        return;
    }

    // Thông báo cập nhật & Hướng dẫn sử dụng
    if (content === `${prefix}noti` || content === `${prefix}update`) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Chỉ Admin mới có quyền gửi thông báo!');
        const embed = new EmbedBuilder()
            .setTitle('💖 BẢNG GIÁ CODE BOT DISCORD 💖')
            .setDescription(`
**Bot riêng (Custom Bot)**

**400.000 VNĐ / 1 Bot / 1 Server**

📅 **Phí duy trì**

**60.000 VNĐ / tháng**
Bao gồm:
- Host bot 24/7
- Bảo trì & sửa lỗi
- Cập nhật tính năng nhỏ (nếu có)

✅ Giá trên áp dụng cho 01 bot hoạt động trên 01 server Discord. Nếu cần thêm tính năng hoặc triển khai cho nhiều server, chi phí sẽ được báo riêng.
            `)
            .setColor('#FFB6C1')
            .setTimestamp();
        
        message.delete().catch(() => {});
        return message.channel.send({ embeds: [embed] });
    }

    // Cập nhật yt-dlp
    

    // QR
    if (content.startsWith(`${prefix}qr`)) {
        if (message.author.id !== ADMIN_ID && (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator))) return message.reply('❌ Lệnh này chỉ dành cho Admin!');
        const args = message.content.split(' ').slice(1);
        if (!args.length) return message.reply(`❌ Cú pháp: \`${prefix}qr <số tiền> [nội dung]\``);
        const amount = args[0];
        let baseInfo = args.slice(1).join(' ').replace(/[^a-zA-Z0-9 ]/g, '');
        let addInfo = baseInfo ? `${baseInfo} MH${Math.floor(10000 + Math.random() * 90000)}` : `MH${Math.floor(10000 + Math.random() * 90000)}`;
        if (isNaN(amount) || amount <= 0) return message.reply('❌ Số tiền không hợp lệ.');
        const bankId = process.env.BANK_ID, accountNo = process.env.ACCOUNT_NO, accountName = process.env.ACCOUNT_NAME;
        if (!bankId || !accountNo || bankId === 'YOUR_BANK_ID_HERE') return message.reply('❌ Chưa cấu hình thông tin ngân hàng trong `.env`.');
        let qrUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(addInfo)}`;
        if (accountName && accountName !== 'YOUR_ACCOUNT_NAME_HERE') qrUrl += `&accountName=${encodeURIComponent(accountName)}`;
        const embed = new EmbedBuilder()
            .setTitle('Mã QR Thanh Toán')
            .setDescription(`- **Số tiền:** ${parseInt(amount).toLocaleString('vi-VN')} VNĐ\n- **Nội dung:** ${addInfo}`)
            .setImage(qrUrl).setColor('#00FF00').setFooter({ text: 'Powered by VietQR' });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`confirm_payment_${addInfo}`).setLabel('✅ Xác nhận đã thanh toán').setStyle(ButtonStyle.Success)
        );
        await message.channel.send({ embeds: [embed], components: [row] });
    }

    // Giveaway prefix
    if (content.startsWith(`${prefix}gstart`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
            return message.reply('❌ Bạn không có quyền!');
        const args = message.content.split(' ').slice(1);
        if (args.length < 3) return message.reply(`❌ Cú pháp: \`${prefix}gstart <time> <winners> <prize>\``);
        const [duration, winnerCount, ...prizeArr] = args;
        if (isNaN(parseInt(winnerCount))) return message.reply('❌ Số người thắng không hợp lệ!');
        client.giveawaysManager.start(message.channel, {
            duration: ms(duration), winnerCount: parseInt(winnerCount), prize: prizeArr.join(' '),
            thumbnail: 'https://cdn.discordapp.com/attachments/1491631607596187688/1528457728144576602/ChatGPT_Image_20_18_37_12_thg_7_2026.png?ex=6a5e5eaf&is=6a5d0d2f&hm=f383da5bf037b4c327d84f99d6c2a9b9b8d4d962eaeb42be4b2ef2268c3b6cc4&',
            image: 'https://cdn.discordapp.com/attachments/1491631607596187688/1528456772174483566/00_34_53_20_thg_7_2026.png?ex=6a5e5dcb&is=6a5d0c4b&hm=9417936767e35ff7ffaa4b9669536f455eb9b15f30407840f383eac061a7b760&',
            hostedBy: message.author,
            messages: giveawayMessages()
        });
    }

    if (content.startsWith(`${prefix}gend`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return message.reply('❌ Bạn không có quyền!');
        const args = message.content.split(' ').slice(1);
        if (!args[0]) return message.reply('❌ Cung cấp ID tin nhắn!');
        client.giveawaysManager.end(args[0]).then(() => message.reply('✅ Đã kết thúc!')).catch(() => message.reply('❌ Không tìm thấy.'));
    }

    if (content.startsWith(`${prefix}greroll`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return message.reply('❌ Bạn không có quyền!');
        const args = message.content.split(' ').slice(1);
        if (!args[0]) return message.reply('❌ Cung cấp ID tin nhắn!');
        client.giveawaysManager.reroll(args[0]).then(() => message.reply('✅ Đã chọn lại!')).catch(() => message.reply('❌ Không tìm thấy.'));
    }

    // ========================
    // NHẠC - PREFIX COMMANDS
    // ========================

    // !play <tên / link>
    

    // !skip
    

    // !stop
    

    // !leave
    if (content === `${prefix}leave`) {
        return handleLeave(message);
    }

    // !join
    if (content === `${prefix}join`) {
        return handleJoin(message);
    }

    // !give
    if (content.startsWith(`${prefix}give `)) {
        const args = message.content.split(' ');
        const target = message.mentions.users.first();
        const amount = parseInt(args[2]);
        return handleGive(message.author.id, target ? target.id : null, amount, message);
    }

    // !giveall
    if (content.startsWith(`${prefix}giveall `)) {
        const args = message.content.split(' ');
        const amount = parseInt(args[1]);
        return handleGiveAll(message.author.id, amount, message);
    }

    // !sendapology
    if (content === `${prefix}sendapology`) {
        if (message.author.id !== ADMIN_ID) return message.reply('❌ Bạn không có quyền!');
        
        const cData = loadCoins();
        const userIds = Object.keys(cData);
        if (userIds.length === 0) return message.reply('❌ Không có người dùng nào!');
        
        const statusMsg = await message.channel.send(`⏳ Đang bắt đầu gửi tin nhắn xin lỗi đến **${userIds.length}** người dùng... (Vui lòng đợi vài phút để tránh bị Discord khóa bot)`);
        let success = 0;
        let fail = 0;
        
        const embed = new EmbedBuilder()
            .setTitle('🙏 Lời Xin Lỗi Từ BQT Bot')
            .setDescription('Chào bạn,\n\nThời gian qua bot có sử dụng tính năng gửi tin nhắn rác (DM) mỗi khi bạn ra vào kênh Voice, gây phiền hà cho nhiều người.\n\nBQT thành thật xin lỗi vì sự bất tiện này. Tính năng gửi DM đó đã bị **gỡ bỏ hoàn toàn**.\n\nCảm ơn bạn đã luôn ủng hộ bot! ❤️')
            .setColor('#2ECC71')
            .setFooter({ text: 'Đây là tin nhắn tự động. Bạn không cần phản hồi.' });

        for (const uid of userIds) {
            try {
                const user = await client.users.fetch(uid);
                await user.send({ embeds: [embed] });
                success++;
            } catch (err) {
                fail++;
            }
            // Delay 1.5s để chống rate limit
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
        
        return statusMsg.edit(`✅ **Đã gửi xong!**\n- Gửi thành công: **${success}**\n- Thất bại (chặn DM): **${fail}**`);
    }

    // !pause
    

    // !resume
    

    // !queue / !q
    

    // !np / !nowplaying
    

    // !vol <0-200>
    if (content.startsWith(`${prefix}vol`)) {
        const state = getQueue(message.guildId);
        if (!state.player) return message.reply('❌ Không có nhạc đang phát!');
        if (message.author.id !== state.djId) return message.reply(`❌ Chỉ <@${state.djId}> mới có thể điều khiển!`);
        const vol = parseInt(message.content.split(' ')[1]);
        if (isNaN(vol) || vol < 0 || vol > 200) return message.reply(`❌ Âm lượng phải từ 0–200. VD: \`${prefix}vol 80\``);
        state.volume = vol / 100;
        if (state.resource?.volume) state.resource.volume.setVolume(state.volume);
        return message.reply(`🔊 Đã đặt âm lượng thành **${vol}%**`);
    }

    // ========================
    // COIN - PREFIX COMMANDS
    // ========================

    // !daily
    if (content === `${prefix}daily` || content === `${prefix}d`) {
        const result = claimDaily(message.author.id);
        if (!result.success) {
            const h = Math.floor(result.remaining / 3600000);
            const m = Math.floor((result.remaining % 3600000) / 60000);
            return message.reply({ embeds: [new EmbedBuilder().setTitle('⏰ Chưa đến giờ nhận').setDescription(`Chờ thêm **${h} giờ ${m} phút** nữa!`).setColor('#FFA500')] });
        }
        const desc = `Bạn nhận được **+${result.reward} 🪙**! (Cơ bản: ${result.baseReward}, Thưởng chuỗi: ${result.bonus})\n🔥 **Chuỗi điểm danh:** ${result.streak} ngày\n→ Số dư: **${result.total.toLocaleString()} 🪙**`;
        return message.reply({ embeds: [new EmbedBuilder().setTitle('💰 Nhận coin hằng ngày!').setDescription(desc).setColor('#FFD700')] });
    }

    // !shop / !sh
    if (content === `${prefix}shop` || content === `${prefix}sh`) {
        return handleShop(message.author.id, message);
    }

    // !balance / !bal / !bank [@user]
    if (content.startsWith(`${prefix}balance`) || content.startsWith(`${prefix}bal`) || content.startsWith(`${prefix}bank`)) {
        const mentioned = message.mentions.users.first();
        
        if (content.startsWith(`${prefix}bank`) && !mentioned) {
            const embed = buildBankEmbed(message.author);
            const buttons = buildBankButtons(message.author.id);
            return message.reply({ embeds: [embed], components: buttons });
        }
        
        const target = mentioned || message.author;
        const cash = getUserCoins(target.id);
        const bank = getUserBank(target.id);
        const p = getPlayer(target.id);
        const invest = p.investAmount || 0;
        const total = cash + bank + invest;
        const investMsg = invest > 0 ? `\n📈 **Đang đầu tư:** ${invest.toLocaleString()} 🪙` : '';
        
        const embed = new EmbedBuilder()
            .setTitle(`💵 Tài sản của ${target.username}`)
            .setDescription(`**Tiền mặt:** ${cash.toLocaleString()} 🪙\n**Ngân hàng:** ${bank.toLocaleString()} 🪙\n**Tổng tài sản:** ${total.toLocaleString()} 🪙${investMsg}`)
            .setColor('#FFD700')
            .setThumbnail(target.displayAvatarURL());
        return message.reply({ embeds: [embed] });
    }

    // !give @user <amount>
    if (content.startsWith(`${prefix}give`)) {
        const target = message.mentions.users.first();
        const args = message.content.split(' ');
        const amount = parseInt(args[2]);
        if (!target) return message.reply(`❌ Cú pháp: \`${prefix}give @người_dùng <số_coin>\``);
        if (isNaN(amount) || amount < 1) return message.reply('❌ Số coin phải lớn hơn 0!');
        if (target.id === message.author.id) return message.reply('❌ Không thể tặng cho chính mình!');
        if (target.bot) return message.reply('❌ Không thể tặng cho bot!');
        const senderCoins = getUserCoins(message.author.id);
        if (senderCoins < amount) return message.reply(`❌ Bạn chỉ có **${senderCoins.toLocaleString()} 🪙**, không đủ!`);
        addCoins(message.author.id, -amount);
        addCoins(target.id, amount);
        return message.reply({ embeds: [new EmbedBuilder().setTitle('🎁 Tặng coin!').setDescription(`<@${message.author.id}> đã tặng **${amount.toLocaleString()} 🪙** cho <@${target.id}>!`).setColor('#00FF88')] });
    }

    // !leaderboard / !lb / !top
    if (content === `${prefix}leaderboard` || content === `${prefix}lb` || content === `${prefix}top`) {
        const embed = buildLeaderboardEmbed(message.client);
        return message.reply({ embeds: [embed] });
    }

    // !blackjack / !bj <bet>
    if (content.startsWith(`${prefix}blackjack`) || content.startsWith(`${prefix}bj`)) {
        const uid = message.author.id;
        const args = message.content.split(' ');
        const betInput = args[1]?.toLowerCase();
        let bet = parseInt(betInput);
        if (betInput === 'all') {
            bet = Math.min(getUserCoins(uid), 500000);
            if (bet < 10) return message.reply(`❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`);
        } else if (isNaN(bet) || bet < 10) return message.reply(`❌ Cú pháp: \`${prefix}bj <số_coin|all>\` (tối thiểu 10)`);
        
        if (bet > 500000) return message.reply('❌ Mức cược tối đa là **500,000 🪙**!');
        if (blackjackGames.has(uid)) return message.reply('❌ Bạn đang có game chưa xong!');
        if (getUserCoins(uid) < bet) return message.reply(`❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`);
        addCoins(uid, -bet);
        const deck = createDeck();
        const game = { uid, bet, deck, p: [deck.pop(), deck.pop()], d: [deck.pop(), deck.pop()] };
        blackjackGames.set(uid, game);
        const pv = handVal(game.p);
        if (pv === 21) {
            dealerPlay(game);
            const dv = handVal(game.d);
            const win = dv === 21 ? game.bet : Math.floor(game.bet * 2.5);
            addCoins(uid, win);
            blackjackGames.delete(uid);
            return message.reply({ embeds: [bjEmbed(game, dv === 21 ? '🤝 Hòa Blackjack!' : `🎉 BLACKJACK! +${(win-game.bet).toLocaleString()} 🪙`, '#FFD700', true)] });
        }
        return message.reply({ embeds: [bjEmbed(game, '🃏 Game đang diễn ra...', '#0099ff')], components: [bjButtons(getUserCoins(uid) >= bet)] });
    }

    // !lode <số> <bet>
    if (content.startsWith(`${prefix}setlodechannel`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) && message.author.id !== ADMIN_ID) {
            return message.reply('❌ Chỉ Admin mới có thể sử dụng lệnh này!');
        }
        let targetChannel = message.mentions.channels.first();
        if (!targetChannel) targetChannel = message.channel;
        
        updateGuildConfig(message.guildId, 'lodeChannelId', targetChannel.id);
        
        return message.reply(`✅ Đã thiết lập kênh xổ số lô đề 18h30 tại <#${targetChannel.id}>`);
    }

    if (content.startsWith(`${prefix}lode`) || content.startsWith(`${prefix}ld `)) {
        const uid = message.author.id;
        const args = message.content.split(' ');
        const soInput = args[1];
        const betInput = args[2]?.toLowerCase();
        
        let so = parseInt(soInput);
        if (isNaN(so) || so < 0 || so > 99) return message.reply(`❌ Bạn phải chọn một số từ **00** đến **99**!`);
        
        if (!betInput) return message.reply(`❌ Cú pháp: \`${prefix}lode <số 00-99> <số_coin|all>\` (tối thiểu 10)`);
        
        let bet = parseInt(betInput);
        if (betInput === 'all') {
            bet = Math.min(getUserCoins(uid), 500000);
            if (bet < 10) return message.reply(`❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`);
        } else if (isNaN(bet) || bet < 10) return message.reply(`❌ Cú pháp: \`${prefix}lode <số 00-99> <số_coin|all>\` (tối thiểu 10)`);
        
        if (bet > 500000) return message.reply('❌ Mức cược tối đa là **500,000 🪙**!');
        if (getUserCoins(uid) < bet) return message.reply(`❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`);
        
        addCoins(uid, -bet);
        
        const lodeData = loadLode();
        lodeData.bets.push({ userId: uid, so: so, bet: bet });
        saveLode(lodeData);
        
        return message.reply(`✅ Bạn đã ghi lô số **${so.toString().padStart(2, '0')}** với số tiền **${bet.toLocaleString()} 🪙**. Chờ kết quả xổ số lúc 18h30 hàng ngày nhé!`);
    }

    // !taixiu <bet>
    if (content.startsWith(`${prefix}taixiu`) || content.startsWith(`${prefix}tx `)) {
        const uid = message.author.id;
        const args = message.content.split(' ');
        const betInput = args[1]?.toLowerCase();
        let bet = parseInt(betInput);
        if (betInput === 'all') {
            bet = Math.min(getUserCoins(uid), 500000);
            if (bet < 10) return message.reply(`❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`);
        } else if (isNaN(bet) || bet < 10) return message.reply(`❌ Cú pháp: \`${prefix}tx <số_coin|all>\` (tối thiểu 10)`);
        
        if (bet > 500000) return message.reply('❌ Mức cược tối đa là **500,000 🪙**!');
        if (getUserCoins(uid) < bet) return message.reply(`❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`);
        
        if (txCooldowns.has(uid)) {
            const remaining = txCooldowns.get(uid) - Date.now();
            if (remaining > 0) return message.reply(`⏳ Vui lòng đợi **${Math.ceil(remaining/1000)}s** nữa trước khi cược Tài Xỉu tiếp!`);
        }
        txCooldowns.set(uid, Date.now() + TX_COOLDOWN_MS);

        const msg = await message.reply({ 
            embeds: [new EmbedBuilder().setTitle('🎲 Bàn Tài Xỉu').setDescription(`Bạn đã cược **${bet.toLocaleString()} 🪙**.\nHãy chọn một cửa bên dưới để tung xúc xắc!`).setColor('#9B59B6')],
            components: txButtons()
        });
        taixiuGames.set(msg.id, { uid, bet });
        return;
    }

    // !baucua
    if (content === `${prefix}baucua` || content === `${prefix}bc`) {
        return startBaucuaMultiplayer(message, message.channelId, client);
    }

    // !work
    if (content === `${prefix}work` || content === `${prefix}w`) {
        return handleWorkCommand(message.author.id, message);
    }

    // !thinh
    if (content === `${prefix}thinh`) {
        let thinhList = QUOTES_THINH; // Fallback
        try {
            const thinhData = fs.readFileSync(path.join(__dirname, 'thinh_genz.txt'), 'utf8');
            const parsed = thinhData.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            if (parsed.length > 0) thinhList = parsed;
        } catch (e) {}

        const quote = thinhList[Math.floor(Math.random() * thinhList.length)];
        const img = IMAGES_THINH[Math.floor(Math.random() * IMAGES_THINH.length)];
        const thinhEmbed = new EmbedBuilder()
            .setTitle('💘 Thần Cupid Gợi Ý Thính')
            .setDescription(`> *"${quote}"*`)
            .setColor('#FF69B4')
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .setImage(img)
            .setFooter({ text: `💞 Thả thính bởi ${message.author.username}` })
            .setTimestamp();
        return message.reply({ embeds: [thinhEmbed] });
    }

    // !catchpet
    if (content === `${prefix}catchpet` || content === `${prefix}cp`) {
        return handleCatchPet(message.author.id, message);
    }

    // !pets
    if (content === `${prefix}pets` || content === `${prefix}p`) {
        return handlePets(message.author.id, message);
    }

    // !ptrade
    if (content.startsWith(`${prefix}ptrade`) || content.startsWith(`${prefix}pt`)) {
        const target = message.mentions.users.first();
        if (!target) return message.reply(`❌ Cú pháp: \`${prefix}ptrade @user\``);
        return handlePetTrade(message.author.id, target.id, message);
    }

    // !dovui
    if (content.startsWith(`${prefix}dovui`)) {
        return handleTrivia(message.author.id, message);
    }

    // !petbattle
    if (content.startsWith(`${prefix}petbattle`) || content.startsWith(`${prefix}pb`)) {
        const target = message.mentions.users.first();
        if (!target) return message.reply(`❌ Cú pháp: \`${prefix}petbattle @user [tiền cược]\``);
        const args = content.split(' ');
        const bet = parseInt(args[2]) || 1000;
        return handlePetBattle(message.author.id, target.id, bet, message);
    }

    // !resetwork
    if (content.startsWith(`${prefix}resetwork`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Lệnh này chỉ dành cho Admin!');
        const target = message.mentions.users.first();
        if (!target) return message.reply(`❌ Cú pháp: \`${prefix}resetwork @user\``);
        const data = loadCoins();
        if (data[target.id]) {
            data[target.id].workEnd = null;
            data[target.id].workJob = null;
            data[target.id].workReward = null;
            saveCoins(data);
        }
        return message.reply(`✅ Đã reset thời gian làm việc cho <@${target.id}>!`);
    }

    // !reset (Admin reset dữ liệu)
    if (content.startsWith(`${prefix}reset`)) {
        if (message.author.id !== ADMIN_ID) return message.reply('❌ Lệnh này chỉ dành cho Admin tối cao (Hệ Thống (Developer))!');
        
        if (content === `${prefix}reset all`) {
            saveCoins({});
            saveRPG({});
            return message.reply('✅ Đã khôi phục TOÀN BỘ dữ liệu của server về trạng thái ban đầu!');
        }

        const target = message.mentions.users.first();
        if (!target) return message.reply(`❌ Cú pháp: \`${prefix}reset @user\` hoặc \`${prefix}reset all\``);
        
        const uid = target.id;
        // Reset coins
        const cData = loadCoins();
        delete cData[uid];
        saveCoins(cData);
        
        // Reset RPG
        const rData = loadRPG();
        delete rData[uid];
        saveRPG(rData);
        
        return message.reply(`✅ Dữ liệu của <@${uid}> đã được khôi phục về trạng thái ban đầu!`);
    }

    // ========================
    // BOT EMOJIS (Pagination)
    // ========================
    if (content === `${prefix}botemojis`) {
        if (!client.application) return message.reply('❌ Bot application chưa được load!');
        try {
            const emojis = await client.application.emojis.fetch();
            if (emojis.size === 0) return message.reply('❌ Bạn chưa upload emoji nào cho bot trên Discord Developer Portal cả!');
            
            const emojiArray = [...emojis.values()];
            const perPage = 25;
            const totalPages = Math.ceil(emojiArray.length / perPage);
            let currentPage = 0;

            function buildEmojiPage(page) {
                const start = page * perPage;
                const end = Math.min(start + perPage, emojiArray.length);
                const pageEmojis = emojiArray.slice(start, end);
                const emojiList = pageEmojis.map((e, i) => {
                    const prefix_tag = e.animated ? 'a' : '';
                    return `${start + i + 1}. ${e} — \`<${prefix_tag}:${e.name}:${e.id}>\``;
                }).join('\n');

                const embed = new EmbedBuilder()
                    .setTitle('🌟 Danh sách Emoji của Bot')
                    .setDescription(emojiList)
                    .setColor('#FFD700')
                    .setFooter({ text: `Trang ${page + 1}/${totalPages} • Tổng: ${emojiArray.length} emoji • Dùng ${prefix}clonebotemojis để copy vào server` })
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('botemoji_prev')
                        .setLabel('◀ Trước')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(page === 0),
                    new ButtonBuilder()
                        .setCustomId('botemoji_info')
                        .setLabel(`${page + 1} / ${totalPages}`)
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('botemoji_next')
                        .setLabel('Sau ▶')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(page >= totalPages - 1)
                );
                return { embeds: [embed], components: [row] };
            }

            const reply = await message.reply(buildEmojiPage(0));
            
            const collector = reply.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 120000,
                filter: (i) => i.user.id === message.author.id
            });

            collector.on('collect', async (i) => {
                if (i.customId === 'botemoji_prev' && currentPage > 0) currentPage--;
                if (i.customId === 'botemoji_next' && currentPage < totalPages - 1) currentPage++;
                await i.update(buildEmojiPage(currentPage));
            });

            collector.on('end', () => {
                reply.edit({ components: [] }).catch(() => {});
            });
            return;
        } catch (error) {
            return message.reply(`❌ Lỗi khi lấy emoji: ${error.message}`);
        }
    }

    if (content === `${prefix}clonebotemojis`) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Chỉ Admin mới có quyền copy emoji!');
        if (!client.application) return message.reply('❌ Bot application chưa được load!');
        
        try {
            const emojis = await client.application.emojis.fetch();
            if (emojis.size === 0) return message.reply('❌ Bot không có emoji nào để copy!');
            
            // Lấy danh sách emoji đã có trên server để skip trùng
            const serverEmojis = await message.guild.emojis.fetch();
            const existingNames = new Set(serverEmojis.map(e => e.name.toLowerCase()));
            
            const emojiArray = [...emojis.values()];
            const toClone = emojiArray.filter(e => !existingNames.has(e.name.toLowerCase()));
            const skippedCount = emojiArray.length - toClone.length;

            if (toClone.length === 0) {
                return message.reply(`✅ Server đã có đủ tất cả **${emojiArray.length}** emoji từ Bot rồi! Không cần copy thêm.`);
            }

            const estimatedTime = Math.ceil(toClone.length * 2 / 60); // ~2s mỗi emoji
            const startEmbed = new EmbedBuilder()
                .setTitle('⏳ Đang Copy Emoji')
                .setDescription(
                    `Đang copy **${toClone.length}** emoji từ Bot sang Server...\n` +
                    (skippedCount > 0 ? `⏭️ Bỏ qua **${skippedCount}** emoji đã có trên server.\n` : '') +
                    `⏱️ Ước tính: **~${estimatedTime} phút** (chậm có chủ ý để tránh Discord chặn)\n` +
                    `\n> Bot sẽ chờ 1.5 giây giữa mỗi emoji và tự động thử lại tối đa 3 lần nếu bị lỗi.`
                )
                .setColor('#3498DB')
                .setTimestamp();
            const progressMsg = await message.reply({ embeds: [startEmbed] });
            
            let successCount = 0;
            let errorCount = 0;
            const failedEmojis = [];

            // Hàm delay
            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            
            for (let i = 0; i < toClone.length; i++) {
                const emoji = toClone[i];
                let created = false;

                // Thử tối đa 3 lần với backoff tăng dần
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        await message.guild.emojis.create({ attachment: emoji.url, name: emoji.name });
                        successCount++;
                        created = true;
                        break;
                    } catch (e) {
                        const isRateLimit = e.message?.includes('rate') || e.message?.includes('429') || e.status === 429;
                        if (isRateLimit && attempt < 3) {
                            // Rate limited → chờ lâu hơn rồi thử lại
                            const waitTime = attempt * 3000; // 3s, 6s
                            console.warn(`[cloneEmoji] Rate limited on "${emoji.name}", retry ${attempt}/3 after ${waitTime}ms...`);
                            await delay(waitTime);
                        } else if (attempt < 3) {
                            // Lỗi khác → thử lại sau 2s
                            await delay(2000);
                        } else {
                            // Hết lượt retry
                            errorCount++;
                            failedEmojis.push({ name: emoji.name, reason: e.message || 'Unknown error' });
                        }
                    }
                }

                // Delay 1.5 giây giữa mỗi emoji để tránh rate limit
                if (i < toClone.length - 1) await delay(1500);

                // Cập nhật tiến độ mỗi 5 emoji
                if ((i + 1) % 5 === 0 || i === toClone.length - 1) {
                    const pct = Math.round((i + 1) / toClone.length * 100);
                    const filled = Math.round(pct / 5);
                    const progressEmbed = new EmbedBuilder()
                        .setTitle('⏳ Đang Copy Emoji...')
                        .setDescription(
                            `**Tiến độ:** ${i + 1}/${toClone.length} emoji\n` +
                            `✅ Thành công: **${successCount}** | ❌ Lỗi: **${errorCount}**\n` +
                            `${'█'.repeat(filled)}${'░'.repeat(20 - filled)} ${pct}%\n` +
                            `⏱️ Còn lại: ~${Math.ceil((toClone.length - i - 1) * 2 / 60)} phút`
                        )
                        .setColor('#3498DB')
                        .setTimestamp();
                    await progressMsg.edit({ embeds: [progressEmbed] }).catch(() => {});
                }
            }
            
            // Embed kết quả cuối cùng
            const doneEmbed = new EmbedBuilder()
                .setTitle('✅ Hoàn Tất Copy Emoji')
                .addFields(
                    { name: '✅ Thành công', value: `**${successCount}**`, inline: true },
                    { name: '❌ Thất bại', value: `**${errorCount}**`, inline: true },
                    { name: '⏭️ Đã bỏ qua (trùng)', value: `**${skippedCount}**`, inline: true }
                )
                .setColor(errorCount === 0 ? '#2ECC71' : '#E67E22')
                .setTimestamp();

            // Nếu có emoji lỗi, liệt kê chi tiết
            if (failedEmojis.length > 0) {
                let failDetail = failedEmojis.slice(0, 15).map(f => `• **${f.name}**: ${f.reason}`).join('\n');
                if (failedEmojis.length > 15) failDetail += `\n... và ${failedEmojis.length - 15} emoji khác`;
                doneEmbed.addFields({ name: '📋 Chi tiết lỗi', value: failDetail, inline: false });
                doneEmbed.setFooter({ text: 'Lỗi thường do: file quá lớn (>256KB), server hết slot, hoặc tên emoji không hợp lệ' });
            } else {
                doneEmbed.setFooter({ text: 'Tất cả emoji đã được copy thành công! 🎉' });
            }

            return progressMsg.edit({ embeds: [doneEmbed] });
        } catch (error) {
            return message.reply(`❌ Lỗi hệ thống: ${error.message}`);
        }
    }

    // ========================
    // MASSIVE SYSTEMS (Prefix)
    // ========================
    if (content.startsWith(`${prefix}deposit`)) {
        const args = message.content.split(' ');
        if (!args[1]) return message.reply(`❌ Cú pháp: \`${prefix}deposit <số tiền|all>\``);
        return handleDeposit(message.author.id, args[1].toLowerCase(), message);
    }
    if (content.startsWith(`${prefix}withdraw`)) {
        const args = message.content.split(' ');
        if (!args[1]) return message.reply(`❌ Cú pháp: \`${prefix}withdraw <số tiền|all>\``);
        return handleWithdraw(message.author.id, args[1].toLowerCase(), message);
    }
    if (content.startsWith(`${prefix}robbank`) || content.startsWith(`${prefix}heist`)) {
        const robTarget = message.mentions.users.first();
        return handleRobbank(message.author.id, message, robTarget ? robTarget.id : null);
    }
    if (content.startsWith(`${prefix}rob `) || content === `${prefix}rob`) {
        const target = message.mentions.users.first();
        if (!target) return message.reply(`❌ Cú pháp: \`${prefix}rob @user\``);
        return handleRob(message.author.id, target.id, message);
    }
    if (content.startsWith(`${prefix}hack`)) {
        const targetId = message.mentions.users.first()?.id;
        return handleHackCommand(message.author.id, targetId, message);
    }
    // !dautu
    if (content.startsWith(`${prefix}dautu`) || content.startsWith(`${prefix}invest`)) {
        const args = content.split(' ');
        const amountStr = args[1];
        if (!amountStr) return message.reply(`❌ Cú pháp: \`${prefix}dautu <số tiền/all>\``);

        const uid = message.author.id;
        
        if (dautuCooldowns.has(uid)) {
            const remaining = dautuCooldowns.get(uid) - Date.now();
            if (remaining > 0) return message.reply(`⏳ Đang chờ phân tích thị trường... Vui lòng đợi **${Math.ceil(remaining/1000)}s** nữa trước khi đầu tư tiếp!`);
        }
        
        const coins = getUserCoins(uid);
        let amount = 0;

        if (amountStr.toLowerCase() === 'all') amount = coins;
        else amount = parseInt(amountStr);

        if (isNaN(amount) || amount <= 0) return message.reply('❌ Số tiền đầu tư không hợp lệ!');
        if (coins < amount) return message.reply(`❌ Bạn không đủ tiền! (Hiện có: **${coins.toLocaleString()} 🪙**)`);

        dautuCooldowns.set(uid, Date.now() + DAUTU_COOLDOWN_MS);

        // Gacha logic: 40% win (up to +80%), 60% lose (up to -50%)
        const roll = Math.random();
        let isWin = roll < 0.40;
        let multiplier = 0;

        if (isWin) {
            multiplier = Math.random() * (0.8 - 0.1) + 0.1; // +10% to +80%
        } else {
            multiplier = -(Math.random() * (0.5 - 0.1) + 0.1); // -10% to -50%
        }

        const profit = Math.floor(amount * multiplier);
        addCoins(uid, profit);

        const embed = new EmbedBuilder()
            .setTitle('📈 KẾT QUẢ ĐẦU TƯ')
            .setDescription(`Bạn đã đầu tư **${amount.toLocaleString()} 🪙** vào thị trường chứng khoán.`)
            .addFields(
                { name: 'Thị trường', value: isWin ? 'Tăng giá! 🚀' : 'Sập sàn! 📉', inline: false },
                { name: isWin ? 'Lợi nhuận' : 'Thua lỗ', value: `**${Math.abs(profit).toLocaleString()} 🪙** (${(multiplier * 100).toFixed(1)}%)`, inline: false },
                { name: 'Số dư ví', value: `**${getUserCoins(uid).toLocaleString()} 🪙**`, inline: false }
            )
            .setColor(isWin ? '#00FF00' : '#FF0000');

        return message.reply({ embeds: [embed] });
    }
    if (content.startsWith(`${prefix}marry`)) {
        let targetId = null;
        if (message.mentions.users.size > 0) targetId = message.mentions.users.first().id;
        return handleMarry(message.author.id, targetId, message);
    }
    if (content === `${prefix}divorce`) {
        return handleDivorce(message.author.id, message);
    }
    if (content === `${prefix}admincheat`) {
        return handleAdminCheat(message.author.id, message);
    }

    // ========================
    // LỄ ĐƯỜNG COMMANDS
    // ========================
    if (content === `${prefix}thinh`) {
        const quote = QUOTES_THINH[Math.floor(Math.random() * QUOTES_THINH.length)];
        const img = IMAGES_THINH[Math.floor(Math.random() * IMAGES_THINH.length)];
        const thinhEmbed = new EmbedBuilder()
            .setTitle('💕 Thần Cupid Gợi Ý Thính')
            .setDescription(`> *"${quote}"*`)
            .setColor('#FF69B4')
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .setImage(img)
            .setFooter({ text: `🏹 Thả thính bởi ${message.author.username}` })
            .setTimestamp();
        return message.reply({ embeds: [thinhEmbed] });
    }

    if (content.startsWith(`${prefix}boitinhyeu`)) {
        const target = message.mentions.users.first();
        if (!target) return message.reply(`❌ Cú pháp: \`${prefix}boitinhyeu @user\``);
        if (target.id === message.author.id) return message.reply('❌ Sao lại đi bói tình yêu với chính mình thế kia?');
        if (target.bot) return message.reply('❌ Bot chỉ biết làm việc thôi, không biết yêu đâu!');
        
        const percent = Math.floor(Math.random() * 101);
        let phan = '';
        let barFilled = Math.round(percent / 10);
        let bar = '💖'.repeat(barFilled) + '🖤'.repeat(10 - barFilled);
        if (percent >= 90) phan = 'Trời sinh một cặp! Cưới ngay kẻo lỡ! 💍';
        else if (percent >= 70) phan = 'Rất có tiềm năng, hãy chủ động tiến tới nhé! 🌹';
        else if (percent >= 50) phan = 'Cũng có chút hy vọng, cần cố gắng nhiều hơn. 🤞';
        else if (percent >= 30) phan = 'Khá gian nan đấy, chắc chỉ hợp làm bạn bè thôi. 😅';
        else phan = 'Oan gia ngõ hẹp! Tránh xa nhau ra cho nước nó trong! 💔';
        
        const embed = new EmbedBuilder()
            .setTitle('💘 Cầu Bói Tình Yêu 💘')
            .setDescription(`<@${message.author.id}> ❤️ <@${target.id}>`)
            .setThumbnail(target.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '📊 Độ hợp nhau', value: `${bar}\n\n🎯 **${percent}%**`, inline: false },
                { name: '📜 Thần Cupid phán', value: `*${phan}*`, inline: false }
            )
            .setColor(percent >= 70 ? '#FF1493' : percent >= 40 ? '#FFA500' : '#808080')
            .setFooter({ text: '🏹 Đền Thần Cupid • Kết quả chỉ mang tính giải trí' })
            .setTimestamp();
            
        if (percent >= 80) embed.setImage('https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdW5pOTk5eGRnNmV0b2FyeTB6dXV4Mm5lOWg3cnAwaGR1Z202enhybSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/26BRv0ThflsHCIChy/giphy.gif');
        
        return message.reply({ embeds: [embed] });
    }

    if (content === `${prefix}cauduyen`) {
        const que = QUE_TINH_DUYEN[Math.floor(Math.random() * QUE_TINH_DUYEN.length)];
        const cauduyenEmbed = new EmbedBuilder()
            .setTitle('🙏 Rút Quẻ Tình Duyên')
            .setDescription(`<@${message.author.id}> đã thắp nhang và rút được quẻ:\n\n🎴 **${que}**`)
            .setColor('#E74C3C')
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .setImage('https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExMjMzdWhvOTcxd2I3ODk0cXA4czEzb3FqNzNjdWZvNGcwaDN3OWgybSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/LqO7P1Wk3J2bC/giphy.gif')
            .setFooter({ text: '🏹 Đền Thần Cupid • Mỗi ngày một quẻ, tin hay không là do bạn' })
            .setTimestamp();
        return message.reply({ embeds: [cauduyenEmbed] });
    }

    // ========================
    // MA SÓI PREFIX
    // ========================
    if (content === `${prefix}masoi` || content === `${prefix}ww`) {
        WW.openLobby(message.guildId, message.channel, message.author.id, client).then(result => {
            if (result?.game) result.game._addCoins = addCoins;
        });
        return;
    }
    if (content === `${prefix}wwstop`) {
        const game = WW.WW_GAMES.get(message.guildId);
        if (!game) return message.reply('❌ Không có game Ma Sói nào đang chạy!');
        const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
        if (!isAdmin && message.author.id !== game.hostId) return message.reply('❌ Chỉ host hoặc Admin mới có thể hủy game!');
        WW.WW_GAMES.delete(message.guildId);
        if (game.nightTimeout) clearTimeout(game.nightTimeout);
        if (game.dayTimeout) clearTimeout(game.dayTimeout);
        if (game.lobbyTimeout) clearTimeout(game.lobbyTimeout);
        if (game.voteMsg) await game.voteMsg.edit({ components: [] }).catch(() => {});
        if (game.lobbyMsg) await game.lobbyMsg.edit({ components: [] }).catch(() => {});
        return message.reply('🛑 Game Ma Sói đã bị hủy!');
    }

    // ========================
    // WEREWOLF GAME COMMANDS
    // ========================
    if (content === `${prefix}ww create`) {
        if (initWWGame(message.channelId, message.author.id)) {
            const game = wwGames.get(message.channelId);
            game.players.set(message.author.id, { id: message.author.id, user: message.author, role: null, alive: true, protected: false });
            return message.reply('🐺 Đã tạo phòng chờ **Game Ma Sói**!\nDùng `!ww join` để tham gia. (Cần ít nhất 4 người)');
        }
        return message.reply('❌ Kênh này đang có một game Ma Sói chưa kết thúc!');
    }
    
    if (content === `${prefix}ww join`) {
        const game = wwGames.get(message.channelId);
        if (!game) return message.reply('❌ Không có game Ma Sói nào đang mở phòng chờ ở kênh này! Dùng `!ww create`.');
        if (game.status !== 'LOBBY') return message.reply('❌ Game đã bắt đầu, không thể tham gia nữa!');
        if (game.players.has(message.author.id)) return message.reply('❌ Bạn đã tham gia rồi!');
        
        game.players.set(message.author.id, { id: message.author.id, user: message.author, role: null, alive: true, protected: false });
        return message.reply(`✅ <@${message.author.id}> đã tham gia! (Hiện có: **${game.players.size}** người)`);
    }

    if (content === `${prefix}ww leave`) {
        const game = wwGames.get(message.channelId);
        if (!game) return;
        if (game.status !== 'LOBBY') return message.reply('❌ Game đã bắt đầu, không thể rời phòng!');
        if (!game.players.has(message.author.id)) return;
        
        game.players.delete(message.author.id);
        if (game.hostId === message.author.id) {
            wwGames.delete(message.channelId);
            return message.reply('❌ Chủ phòng đã rời đi. Phòng chờ đã bị hủy!');
        }
        return message.reply(`🚪 <@${message.author.id}> đã rời phòng! (Hiện có: **${game.players.size}** người)`);
    }

    if (content === `${prefix}ww start`) {
        const game = wwGames.get(message.channelId);
        if (!game) return;
        if (game.status !== 'LOBBY') return message.reply('❌ Game đã bắt đầu rồi!');
        if (game.hostId !== message.author.id && message.author.id !== ADMIN_ID) return message.reply('❌ Chỉ chủ phòng mới có thể bắt đầu!');
        if (game.players.size < 4) return message.reply('❌ Cần tối thiểu **4 người chơi** để bắt đầu!');
        
        const assignments = assignRoles(Array.from(game.players.keys()));
        for (const [uid, role] of assignments.entries()) {
            game.players.get(uid).role = role;
        }
        
        message.channel.send('🌕 **TRÒ CHƠI BẮT ĐẦU!**\nVai trò đã được phân phát bí mật. Đêm đầu tiên đang tới...');
        
        const roleRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ww_myrole_${game.channelId}`).setLabel('Xem Vai Trò Của Mình').setStyle(ButtonStyle.Success).setEmoji('📜')
        );
        message.channel.send({ content: 'Hãy nhấn vào nút bên dưới để xem vai trò của bạn (Chỉ bạn nhìn thấy)!', components: [roleRow] });
        
        setTimeout(() => startNightPhase(game, client), 10000); // 10s delay
        return;
    }

    if (content === `${prefix}ww stop`) {
        const game = wwGames.get(message.channelId);
        if (!game) return;
        if (game.hostId !== message.author.id && message.author.id !== ADMIN_ID) return message.reply('❌ Chỉ chủ phòng hoặc Admin mới có thể hủy game!');
        clearTimeout(game.timer);
        wwGames.delete(message.channelId);
        return message.reply('🛑 Game Ma Sói đã bị hủy bỏ!');
    }

    // ========================
    // RPG - PREFIX COMMANDS
    // ========================
    
    // !setbday
    if (content.startsWith(`${prefix}setbday `) || content.startsWith(`${prefix}bday `)) {
        const args = message.content.split(' ');
        return handleSetBday(message.author.id, message, args[1]);
    }

    // !profile
    if (content.startsWith(`${prefix}profile`) || content.startsWith(`${prefix}pr`)) {
        const target = message.mentions.users.first() || message.author;
        const profileData = await buildProfileEmbed(target);
        const options = { embeds: [profileData.embed] };
        if (profileData.attachment) options.files = [profileData.attachment];
        return message.reply(options).catch(() => {});
    }

    // !hunt
    

    // !shop
    

    // RPG EXPANSION PREFIX COMMANDS
    
    if (content === `${prefix}pokesolo`) {
        return handlePokeSolo(message.author.id, message);
    }
    
    
    
    
    
    
    
    
    
    
    
    

    // !inv
    

    // !heal
    



    // ========================
    // ADMIN - PREFIX COMMANDS
    // ========================
    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    
    // !spawnpet
    
    
    // !getallvip
    

    // !addpetvip @user <petId> [amount]
    if (content.startsWith(`${prefix}addpetvip`)) {
        if (!isAdmin && message.author.id !== '1150393275806650429') return message.reply('❌ Lệnh này chỉ dành cho Admin hoặc Owner!');
        const args = content.split(' ');
        const target = message.mentions.users.first();
        if (!target) return message.reply(`❌ Cú pháp: \`${prefix}addpetvip @user <petId> [số lượng]\``);
        const petId = args[2];
        if (!petId) return message.reply(`❌ Cú pháp: \`${prefix}addpetvip @user <petId> [số lượng]\``);
        const amount = parseInt(args[3]) || 1;
        
        const petInfo = PET_LIST.find(p => p.id === petId);
        if (!petInfo) return message.reply('❌ Pet ID không hợp lệ! (Ví dụ: pikachu, arceus, lugia...)');
        
        return awaitConfirmation(message, message.author.id, `Bạn muốn tặng **${amount}x ${petInfo.emoji} ${petInfo.name}** cho <@${target.id}>?`, async () => {
            const data = loadRPG();
            if (!data[target.id]) getPlayer(target.id);
            if (!data[target.id].pets) data[target.id].pets = {};
            
            data[target.id].pets[petId] = (data[target.id].pets[petId] || 0) + amount;
            saveRPG(data);
            return `✅ Đã tặng **${amount}x ${petInfo.emoji} ${petInfo.name}** cho <@${target.id}>!`;
        });
    }
    

    // !addxp @user <amount>
    if (content.startsWith(`${prefix}addxp`)) {
        if (!isAdmin) return message.reply('❌ Bạn không có quyền!');
        const target = message.mentions.users.first();
        const amount = parseInt(message.content.split(' ')[2]);
        if (!target || isNaN(amount) || amount < 1) return message.reply(`❌ Cú pháp: \`${prefix}addxp @user <số>\``);
        return awaitConfirmation(message, message.author.id, `Bạn muốn **CỘNG** ${amount.toLocaleString()} EXP cho <@${target.id}>?`, async () => {
            let np;
            updatePlayer(target.id, dp => { 
                dp.exp += amount;
                np = dp;
            });
            return `✅ Đã thêm **${amount.toLocaleString()} EXP** cho <@${target.id}>. Cấp độ hiện tại: **Lv. ${np.level || getPlayer(target.id).level}**`;
        });
    }

    // !addcoin @user <amount>
    if (content.startsWith(`${prefix}addcoin`)) {
        if (message.author.id !== ADMIN_ID) return message.reply('❌ Lệnh này chỉ dành riêng cho Chủ Bot!');
        const target = message.mentions.users.first();
        const amount = parseInt(message.content.split(' ')[2]);
        if (!target || isNaN(amount) || amount < 1) return message.reply(`❌ Cú pháp: \`${prefix}addcoin @user <số>\``);
        return awaitConfirmation(message, message.author.id, `Bạn muốn **CỘNG** ${amount.toLocaleString()} 🪙 cho <@${target.id}>?`, async () => {
            addCoins(target.id, amount);
            return `✅ Đã thêm **${amount.toLocaleString()} 🪙** cho <@${target.id}>.`;
        });
    }

    // !removecoin @user <amount>
    if (content.startsWith(`${prefix}removecoin`)) {
        if (message.author.id !== ADMIN_ID) return message.reply('❌ Lệnh này chỉ dành riêng cho Chủ Bot!');
        const target = message.mentions.users.first();
        const amount = parseInt(message.content.split(' ')[2]);
        if (!target || isNaN(amount) || amount < 1) return message.reply(`❌ Cú pháp: \`${prefix}removecoin @user <số>\``);
        return awaitConfirmation(message, message.author.id, `Bạn muốn **TRỪ** ${amount.toLocaleString()} 🪙 của <@${target.id}>?`, async () => {
            addCoins(target.id, -amount);
            return `✅ Đã trừ **${amount.toLocaleString()} 🪙** của <@${target.id}>.`;
        });
    }

    // !setcoin @user <amount>
    if (content.startsWith(`${prefix}setcoin`)) {
        if (message.author.id !== ADMIN_ID) return message.reply('❌ Lệnh này chỉ dành riêng cho Chủ Bot!');
        const target = message.mentions.users.first();
        const amount = parseInt(message.content.split(' ')[2]);
        if (!target || isNaN(amount) || amount < 0) return message.reply(`❌ Cú pháp: \`${prefix}setcoin @user <số>\``);
        return awaitConfirmation(message, message.author.id, `Bạn muốn **ĐẶT** số coin của <@${target.id}> thành ${amount.toLocaleString()} 🪙?`, async () => {
            setCoins(target.id, amount);
            return `✅ Đã đặt số coin của <@${target.id}> thành **${amount.toLocaleString()} 🪙**.`;
        });
    }

    // !resetcoin @user
    if (content.startsWith(`${prefix}resetcoin`)) {
        if (message.author.id !== ADMIN_ID) return message.reply('❌ Lệnh này chỉ dành riêng cho Chủ Bot!');
        const target = message.mentions.users.first();
        if (!target) return message.reply(`❌ Cú pháp: \`${prefix}resetcoin @user\``);
        return awaitConfirmation(message, message.author.id, `Bạn CHẮC CHẮN muốn **RESET** tài khoản của <@${target.id}> về 500,000 🪙?`, async () => {
            const data = loadCoins();
            data[target.id] = { coins: 500000, bank: 0, lastDaily: 0 };
            saveCoins(data);
            return `✅ Đã reset tài khoản của <@${target.id}> về mặc định (500,000 🪙 tiền mặt, 0 ngân hàng).`;
        });
    }

    // !resetallcoin
    if (content.startsWith(`${prefix}resetallcoin`)) {
        if (message.author.id !== ADMIN_ID) return message.reply('❌ Lệnh này chỉ dành riêng cho Chủ Bot!');
        return awaitConfirmation(message, message.author.id, `Bạn CHẮC CHẮN muốn **RESET TẤT CẢ** tài khoản server về 500,000 🪙? Hành động này không thể hoàn tác!`, async () => {
            const data = loadCoins();
            for (const userId in data) {
                data[userId] = { coins: 500000, bank: 0, lastDaily: 0 };
            }
            saveCoins(data);
            return `✅ Đã reset tài khoản của TẤT CẢ mọi người về mặc định (500,000 🪙 tiền mặt, 0 ngân hàng).`;
        });
    }

    // !clear <amount>
    if (content.startsWith(`${prefix}clear`)) {
        if (!message.member?.permissions.has(PermissionsBitField.Flags.ManageMessages)) return message.reply('❌ Bạn không có quyền!');
        const amount = parseInt(message.content.split(' ')[1]);
        if (isNaN(amount) || amount < 1 || amount > 100) return message.reply(`❌ Cú pháp: \`${prefix}clear <1-100>\``);
        try {
            await message.channel.bulkDelete(amount + 1, true);
            const msg = await message.channel.send(`✅ Đã xóa **${amount}** tin nhắn.`);
            setTimeout(() => msg.delete().catch(() => {}), 3000);
        } catch (err) {
            message.reply('❌ Không thể xóa tin nhắn (có thể do tin nhắn quá 14 ngày tuổi).');
        }
        return;
    }

    // !leave sv
    if (content === `${prefix}leave sv` || content === `${prefix}leaveserver`) {
        if (message.author.id !== ADMIN_ID) {
            return message.reply('❌ Lệnh này chỉ dành riêng cho Chủ Bot!');
        }
        await message.reply('👋 Bot đang rời khỏi server theo yêu cầu của Hệ Thống (Developer). Tạm biệt!');
        return message.guild.leave().catch(console.error);
    }

    // !muteall
    if (content.startsWith(`${prefix}muteall`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.MuteMembers)) {
            return message.reply('❌ Bạn không có quyền Tắt tiếng thành viên!');
        }
        
        let targetChannel = message.member.voice.channel;
        const args = message.content.trim().split(/\s+/);
        if (args[1]) {
            const channelId = args[1].replace(/<#|>/g, '');
            targetChannel = message.guild.channels.cache.get(channelId);
        }
        
        if (!targetChannel || !targetChannel.isVoiceBased()) {
            return message.reply('❌ Không tìm thấy kênh thoại! Hãy vào một kênh hoặc chỉ định đúng ID/tag kênh thoại.');
        }
        
        await message.reply(`⏳ Đang tắt mic tất cả mọi người trong kênh **${targetChannel.name}**...`);
        let count = 0;
        for (const [memberId, member] of targetChannel.members) {
            if (!member.user.bot && !member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                await member.voice.setMute(true).catch(() => {});
                count++;
            }
        }
        return message.channel.send(`✅ Đã tắt mic **${count}** người trong kênh thoại!`);
    }

    // !unmuteall
    if (content.startsWith(`${prefix}unmuteall`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.MuteMembers)) {
            return message.reply('❌ Bạn không có quyền Tắt tiếng thành viên!');
        }
        
        let targetChannel = message.member.voice.channel;
        const args = message.content.trim().split(/\s+/);
        if (args[1]) {
            const channelId = args[1].replace(/<#|>/g, '');
            targetChannel = message.guild.channels.cache.get(channelId);
        }
        
        if (!targetChannel || !targetChannel.isVoiceBased()) {
            return message.reply('❌ Không tìm thấy kênh thoại! Hãy vào một kênh hoặc chỉ định đúng ID/tag kênh thoại.');
        }
        
        await message.reply(`⏳ Đang bật mic lại cho tất cả mọi người trong kênh **${targetChannel.name}**...`);
        let count = 0;
        for (const [memberId, member] of targetChannel.members) {
            if (!member.user.bot) {
                await member.voice.setMute(false).catch(() => {});
                count++;
            }
        }
        return message.channel.send(`✅ Đã bật mic lại cho **${count}** người trong kênh thoại!`);
    }

    // !say #channel <message>
    if (content.startsWith(`${prefix}say`)) {
        if (!isAdmin) return message.reply('❌ Bạn không có quyền!');
        const channel = message.mentions.channels.first();
        if (!channel) return message.reply(`❌ Cú pháp: \`${prefix}say #channel <nội dung>\``);
        const text = message.content.replace(`${prefix}say`, '').replace(`<#${channel.id}>`, '').trim();
        if (!text) return message.reply('❌ Nội dung không được để trống!');
        channel.send(text);
        return message.reply(`✅ Đã gửi tin nhắn vào ${channel}.`);
    }

    

});

// ========================
// GIVEAWAY MESSAGES HELPER
// ========================
function giveawayMessages() {
    return {
        giveaway: '🎉🎉 **SỰ KIỆN GIVEAWAY ĐẶC BIỆT** 🎉🎉',
        giveawayEnded: '🛑 **SỰ KIỆN ĐÃ KẾT THÚC** 🛑',
        title: '🎁 Phần thưởng: **{this.prize}**',
        drawing: '⏳ **Thời gian kết thúc:** {timestamp}',
        dropMessage: 'Hãy là người đầu tiên phản hồi bằng <a:1000063764:1492460870054182994> để nhận giải!',
        inviteToParticipate: '✨ **CÁCH THỨC THAM GIA:**\n> 👇 Nhấn vào biểu tượng <a:1000063764:1492460870054182994> ở dưới để ghi danh!\n> 🍀 Chúc bạn may mắn nhé!\n\n👥 **Người tham gia hiện tại:** {this.messageReaction ? this.messageReaction.count - 1 : 0}',
        winMessage: {
            content: '🎊 Chúc mừng {winners}! 🎊\nCảm ơn {this.hostedBy} đã tổ chức sự kiện tuyệt vời này!',
            embed: new EmbedBuilder()
                .setTitle('🏆 GIVEAWAY ĐÃ KẾT THÚC!')
                .setDescription('🎁 **Phần thưởng:** {this.prize}\n👑 **Người trúng giải:** {winners}\n👤 **Tổ chức bởi:** {this.hostedBy}\n\n🎫 **CÁCH NHẬN GIẢI:**\n> Vui lòng mở ticket hoặc nhắn tin trực tiếp cho người tổ chức để nhận phần thưởng nhé!')
                .setColor('#FF0055')
                .setImage('https://media.giphy.com/media/26tNZ8bVqV8XJ1Qcw/giphy.gif')
        },
        embedFooter: '{this.winnerCount} người chiến thắng',
        noWinner: '😔 Rất tiếc, giveaway đã bị hủy do không có ai tham gia hợp lệ.',
        hostedBy: 'Tổ chức bởi: {this.hostedBy}',
        winners: '🏆 Người thắng:',
        endedAt: 'Kết thúc lúc'
    };
}

// ========================
// INTERACTION HANDLER
// ========================
client.on('interactionCreate', async (interaction) => {
    if (BANNED_USERS.includes(interaction.user.id)) return;
    
    // --- JAIL CHECK ---
    const uid = interaction.user.id;
    const userData = loadCoins()[uid] || {};
    if (userData.jailEnd && Date.now() < userData.jailEnd) {
        if (!interaction.isChatInputCommand() || (interaction.commandName !== 'nopphat' && interaction.commandName !== 'bribe')) {
            const r = userData.jailEnd - Date.now();
            return interaction.reply({ content: `🚓 **BẠN ĐANG Ở TRONG TÙ!** Hãy đợi **${Math.ceil(r/60000)} phút** nữa hoặc dùng lệnh \`/nopphat\` (phí 100,000 🪙) để hối lộ ra tù sớm.`, flags: MessageFlags.Ephemeral });
        }
    } else if (userData.jailEnd && Date.now() >= userData.jailEnd) {
        const coinsData = loadCoins();
        if (coinsData[uid] && coinsData[uid].jailEnd) {
            coinsData[uid].jailEnd = null;
            saveCoins(coinsData);
        }
    }

    // === MESSAGE COMPONENT (BUTTONS & MENUS) ===
    if (interaction.isMessageComponent()) {
        const cid = interaction.customId;



        // INVENTORY INTERACTIVE SYSTEM
        if (interaction.isStringSelectMenu() && cid.startsWith('inv_select_')) {
            const ownerId = cid.replace('inv_select_', '');
            if (interaction.user.id !== ownerId) {
                return interaction.reply({ content: '❌ Đây không phải là túi đồ của bạn!', flags: MessageFlags.Ephemeral });
            }
            
            const selectedVal = interaction.values[0];
            const itemId = selectedVal.replace('invitem_', '');
            
            let itemDef = RPG_ITEMS.potions[itemId] || RPG_ITEMS.pokeballs[itemId] || RPG_ITEMS.materials[itemId] || RPG_ITEMS.weapons?.[itemId] || RPG_ITEMS.armors?.[itemId] || RPG_ITEMS.artifacts?.[itemId] || RPG_ITEMS.seeds?.[itemId] || RPG_ITEMS.crops?.[itemId] || PET_LIST.find(p => p.id === itemId);
            
            if (!itemDef) return interaction.reply({ content: '❌ Không tìm thấy vật phẩm này!', flags: MessageFlags.Ephemeral });
            
            const isPotion = !!RPG_ITEMS.potions[itemId];
            
            const buttons = new ActionRowBuilder();
            
            if (isPotion) {
                buttons.addComponents(
                    new ButtonBuilder().setCustomId(`invuse_${itemId}`).setLabel('Sử dụng 1 cái').setStyle(ButtonStyle.Success).setEmoji('✨')
                );
            }
            
            buttons.addComponents(
                new ButtonBuilder().setCustomId(`invsell_${itemId}`).setLabel('Bán 1 cái').setStyle(ButtonStyle.Primary).setEmoji('💰'),
                new ButtonBuilder().setCustomId(`invsellall_${itemId}`).setLabel('Bán Tất Cả').setStyle(ButtonStyle.Danger).setEmoji('💸')
            );
            
            const sellPrice = Math.floor((itemDef.price || 0) * 0.5);
            
            const embed = new EmbedBuilder()
                .setTitle(`Tương tác: ${itemDef.emoji || ''} ${itemDef.name}`)
                .setDescription(`Bạn muốn làm gì với vật phẩm này?\n> Giá bán lại: **${sellPrice.toLocaleString()} 🪙 / cái**`)
                .setColor('#3498DB');
                
            if (itemDef.imageUrl) {
                embed.setThumbnail(itemDef.imageUrl);
            }
                
            return interaction.reply({ embeds: [embed], components: [buttons], flags: MessageFlags.Ephemeral });
        }

        if (interaction.isStringSelectMenu() && cid.startsWith('gather_region_select_')) {
            const ownerId = cid.replace('gather_region_select_', '');
            if (interaction.user.id !== ownerId) {
                return interaction.reply({ content: '❌ Đây không phải là menu của bạn!', flags: MessageFlags.Ephemeral });
            }
            const selectedRegion = interaction.values[0];
            updatePlayer(ownerId, dp => {
                dp.selectedRegion = selectedRegion;
            });
            return interaction.update({ content: `✅ Đã chọn khu vực **${REGIONS[selectedRegion].name}** làm nơi farm! Gõ lệnh \`!gather\` để bắt đầu thu thập.`, embeds: [], components: [] });
        }
        
        
        
        // =============================================
        // FARM INTERACTION HANDLERS
        // =============================================
        if (cid.startsWith('gather_again_')) {
            const ownerId = cid.replace('gather_again_', '');
            if (interaction.user.id !== ownerId) return interaction.reply({ content: '❌ Đây không phải là hành động của bạn!', flags: MessageFlags.Ephemeral });
            return handleGather(ownerId, interaction, ['gather']);
        }

        

        

        

        

        
        
        if (interaction.isButton() && (cid.startsWith('invuse_') || cid.startsWith('invsell_') || cid.startsWith('invsellall_'))) {
            const uid = interaction.user.id;
            const p = getPlayer(uid);
            
            let action = '';
            let itemId = '';
            if (cid.startsWith('invuse_')) { action = 'use'; itemId = cid.replace('invuse_', ''); }
            if (cid.startsWith('invsell_')) { action = 'sell'; itemId = cid.replace('invsell_', ''); }
            if (cid.startsWith('invsellall_')) { action = 'sellall'; itemId = cid.replace('invsellall_', ''); }
            
            let itemDef = RPG_ITEMS.potions[itemId] || RPG_ITEMS.pokeballs[itemId] || RPG_ITEMS.materials[itemId] || RPG_ITEMS.weapons?.[itemId] || RPG_ITEMS.armors?.[itemId] || RPG_ITEMS.artifacts?.[itemId] || RPG_ITEMS.seeds?.[itemId] || RPG_ITEMS.crops?.[itemId] || PET_LIST.find(pt => pt.id === itemId);
            if (!itemDef) return interaction.reply({ content: '❌ Lỗi: Vật phẩm không tồn tại.', flags: MessageFlags.Ephemeral });
            
            const isPet = !!PET_LIST.find(pt => pt.id === itemId);
            let userQty = isPet ? (p.pets[itemId] || 0) : (p.inventory[itemId] || 0);
            
            if (userQty <= 0) return interaction.reply({ content: `❌ Bạn không còn **${itemDef.name}** nào trong túi!`, flags: MessageFlags.Ephemeral });
            
            if (action === 'use') {
                if (RPG_ITEMS.potions[itemId]) {
                    if (itemId === 'xp_potion') {
                        const xpAmount = RPG_ITEMS.potions[itemId].exp;
                        updatePlayer(uid, dp => { 
                            dp.exp += xpAmount; 
                            dp.inventory[itemId]--; 
                        });
                        const np = getPlayer(uid);
                        return interaction.update({ content: `🔮 Đã sử dụng **${itemDef.name}**! Bạn nhận được **+${xpAmount} EXP**.\nCấp độ hiện tại: **Lv. ${np.level}**`, embeds: [], components: [] });
                    }
                    if (p.hp >= p.maxHp) return interaction.reply({ content: '✅ Máu của bạn đã đầy!', flags: MessageFlags.Ephemeral });
                    const healAmount = RPG_ITEMS.potions[itemId].heal;
                    updatePlayer(uid, dp => { 
                        dp.hp = Math.min(dp.maxHp, dp.hp + healAmount); 
                        dp.inventory[itemId]--; 
                    });
                    const np = getPlayer(uid);
                    return interaction.update({ content: `💊 Đã sử dụng **${itemDef.name}**! Sinh lực hiện tại: **❤️ ${np.hp}/${np.maxHp}**`, embeds: [], components: [] });
                }
            }
            
            if (action === 'sell' || action === 'sellall') {
                const sellQty = action === 'sellall' ? userQty : 1;
                let unitPrice = Math.floor((itemDef.price || 0) * 0.5);
                

                
                const sellPrice = unitPrice * sellQty;
                
                updatePlayer(uid, dp => {
                    if (isPet) {
                        dp.pets[itemId] -= sellQty;
                        if (dp.pets[itemId] <= 0) delete dp.pets[itemId];
                    } else {
                        dp.inventory[itemId] -= sellQty;
                        if (dp.inventory[itemId] <= 0) delete dp.inventory[itemId];
                    }
                });
                
                const cData = loadCoins();
                if (!cData[uid]) cData[uid] = { coins: 0 };
                cData[uid].coins += sellPrice;
                saveCoins(cData);
                
                return interaction.update({ content: `💰 Đã bán **x${sellQty} ${itemDef.name}** và nhận được **${sellPrice.toLocaleString()} 🪙**!`, embeds: [], components: [] });
            }
        }

        // =============================================
        // JOIN TO CREATE BUTTONS
        // =============================================
        if (cid.startsWith('j2c_')) {
            const channelId = interaction.channel.id;
            const channel = interaction.channel;
            
            if (!j2cChannels.has(channelId)) {
                return interaction.reply({ content: '❌ Đây không phải là phòng được tạo bởi tính năng Join To Create!', flags: MessageFlags.Ephemeral });
            }
            
            const ownerId = j2cChannels.get(channelId);
            const isOwner = interaction.user.id === ownerId;
            
            if (cid === 'j2c_claim') {
                if (isOwner) return interaction.reply({ content: '❌ Bạn đã là chủ phòng rồi!', flags: MessageFlags.Ephemeral });
                const ownerInChannel = channel.members.has(ownerId);
                if (ownerInChannel) {
                    return interaction.reply({ content: '❌ Chủ phòng cũ vẫn đang ở trong kênh. Không thể chiếm quyền!', flags: MessageFlags.Ephemeral });
                }
                
                j2cChannels.set(channelId, interaction.user.id);
                await channel.permissionOverwrites.edit(interaction.user.id, { Connect: true, ViewChannel: true, SendMessages: true }).catch(() => {});
                
                const oldEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(oldEmbed);
                newEmbed.data.fields[0].value = `<@${interaction.user.id}>`;
                
                await interaction.update({ embeds: [newEmbed] });
                return interaction.followUp({ content: `✅ <@${interaction.user.id}> đã trở thành chủ phòng mới!`, flags: 0 });
            }
            
            if (!isOwner) {
                return interaction.reply({ content: '❌ Chỉ chủ phòng mới có thể dùng chức năng này!', flags: MessageFlags.Ephemeral });
            }
            
            if (cid === 'j2c_name') {
                const modal = new ModalBuilder()
                    .setCustomId('j2c_name_modal')
                    .setTitle('📝 Đổi Tên Phòng');
                const nameInput = new TextInputBuilder()
                    .setCustomId('new_name')
                    .setLabel('Nhập tên phòng mới')
                    .setStyle(1)
                    .setRequired(true)
                    .setMaxLength(100);
                modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
                return interaction.showModal(modal).catch(() => {});
            }
            
            if (cid === 'j2c_limit') {
                const modal = new ModalBuilder()
                    .setCustomId('j2c_limit_modal')
                    .setTitle('👥 Chỉnh Giới Hạn Người');
                const limitInput = new TextInputBuilder()
                    .setCustomId('new_limit')
                    .setLabel('Nhập số (0-99). 0 = Không giới hạn')
                    .setStyle(1)
                    .setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(limitInput));
                return interaction.showModal(modal).catch(() => {});
            }
            
            if (cid === 'j2c_ghost') {
                const everyoneRole = interaction.guild.roles.everyone;
                const perms = channel.permissionOverwrites.cache.get(everyoneRole.id);
                const isGhosted = perms && perms.deny.has('ViewChannel');
                
                await channel.permissionOverwrites.edit(everyoneRole, {
                    ViewChannel: isGhosted ? null : false
                });
                
                const oldEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(oldEmbed);
                const lockState = newEmbed.data.fields[2].value.includes('Không kết nối') ? '🔒 Không kết nối' : '🔓 Có thể kết nối';
                newEmbed.data.fields[2].value = (isGhosted ? '👁️ Đã hiện' : '👻 Đang ẩn') + ` | ${lockState}`;
                
                await interaction.update({ embeds: [newEmbed] });
                return interaction.followUp({ content: isGhosted ? '✅ Đã BỎ ẨN phòng.' : '✅ Đã ẨN phòng khỏi mọi người.', flags: MessageFlags.Ephemeral });
            }
            
            if (cid === 'j2c_lock') {
                const everyoneRole = interaction.guild.roles.everyone;
                const perms = channel.permissionOverwrites.cache.get(everyoneRole.id);
                const isLocked = perms && perms.deny.has('Connect');
                
                await channel.permissionOverwrites.edit(everyoneRole, {
                    Connect: isLocked ? null : false
                });
                
                const oldEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(oldEmbed);
                const ghostState = newEmbed.data.fields[2].value.includes('Đang ẩn') ? '👻 Đang ẩn' : '👁️ Đã hiện';
                newEmbed.data.fields[2].value = `${ghostState} | ` + (isLocked ? '🔓 Có thể kết nối' : '🔒 Không kết nối');
                
                await interaction.update({ embeds: [newEmbed] });
                return interaction.followUp({ content: isLocked ? '✅ Đã MỞ KHÓA kết nối.' : '✅ Đã KHÓA kết nối phòng.', flags: MessageFlags.Ephemeral });
            }

            if (cid === 'j2c_kick') {
                const voiceChannel = interaction.channel;
                const otherMembers = voiceChannel.members.filter(m => m.id !== interaction.user.id && !m.user.bot);
                if (otherMembers.size === 0) {
                    return interaction.reply({ content: '❌ Không có ai khác trong phòng để kích!', flags: MessageFlags.Ephemeral });
                }

                const options = otherMembers.map(m => {
                    return new StringSelectMenuOptionBuilder()
                        .setLabel(m.user.username)
                        .setValue(m.id)
                        .setDescription(`Kích ${m.user.username} khỏi phòng`);
                });

                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`vkick_select_${voiceChannel.id}`)
                        .setPlaceholder('Chọn người muốn kích...')
                        .addOptions(options.slice(0, 25))
                );

                return interaction.reply({ content: 'Chọn người mà bạn muốn kích khỏi phòng (Chỉ mình bạn thấy tin nhắn này):', components: [row], flags: MessageFlags.Ephemeral });
            }
        }

        // =============================================
        // POKEMON ROLE BUTTON
        // =============================================
        if (cid === 'get_pokemon_role') {
            const config = loadConfig();
            const roleId = config.pokemonRoleId;
            if (!roleId) return interaction.reply({ content: '❌ Hệ thống chưa cài đặt role.', flags: MessageFlags.Ephemeral });
            
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) return interaction.reply({ content: '❌ Role không tồn tại hoặc đã bị xóa.', flags: MessageFlags.Ephemeral });
            
            try {
                if (interaction.member.roles.cache.has(roleId)) {
                    await interaction.member.roles.remove(roleId);
                    return interaction.reply({ content: '✅ Bạn đã **hủy** role Pokemon!', flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.member.roles.add(roleId);
                    return interaction.reply({ content: '✅ Bạn đã **nhận** role Pokemon!', flags: MessageFlags.Ephemeral });
                }
            } catch (err) {
                return interaction.reply({ content: '❌ Bot không đủ quyền để cấp role cho bạn (Role bot phải xếp cao hơn role Pokemon).', flags: MessageFlags.Ephemeral });
            }
        }

        // =============================================
        // RPG ROLE BUTTON
        // =============================================
        if (cid === 'get_rpg_role') {
            const config = loadConfig();
            const roleId = config.rpgRoleId;
            if (!roleId) return interaction.reply({ content: '❌ Hệ thống chưa cài đặt role.', flags: MessageFlags.Ephemeral });
            
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) return interaction.reply({ content: '❌ Role không tồn tại hoặc đã bị xóa.', flags: MessageFlags.Ephemeral });
            
            try {
                if (interaction.member.roles.cache.has(roleId)) {
                    await interaction.member.roles.remove(roleId);
                    return interaction.reply({ content: '✅ Bạn đã **hủy** role RPG!', flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.member.roles.add(roleId);
                    return interaction.reply({ content: '✅ Bạn đã **nhận** role RPG!', flags: MessageFlags.Ephemeral });
                }
            } catch (err) {
                return interaction.reply({ content: '❌ Bot không đủ quyền để cấp role cho bạn.', flags: MessageFlags.Ephemeral });
            }
        }

        // =============================================
        // WILD PET SYSTEM BUTTONS
        // =============================================
        if (cid.startsWith('wild_catch_')) {
            const petId = cid.replace('wild_catch_', '');
            const spawnData = activeSpawns.get(interaction.message.id);
            
            if (!spawnData || !spawnData.active) {
                return interaction.reply({ content: '❌ Thú cưng này đã bị người khác bắt hoặc đã chạy mất!', flags: MessageFlags.Ephemeral }).catch(() => {});
            }
            
            const p = getPlayer(interaction.user.id);
            const options = [];
            for (const [k, v] of Object.entries(RPG_ITEMS.pokeballs)) {
                const count = p.inventory[k] || 0;
                if (count > 0) {
                    options.push(new StringSelectMenuOptionBuilder()
                        .setLabel(`${v.name} (Có: ${count})`)
                        .setValue(`throw_${interaction.message.id}_${k}`)
                        .setDescription(`Tỉ lệ: ${v.catchRate * 100}%`)
                        .setEmoji(v.emoji));
                }
            }
            
            if (options.length === 0) {
                return interaction.reply({ content: '❌ Bạn không có quả bóng nào trong túi! Hãy vào `/shop` (Tab Bắt Pet) để mua!', flags: MessageFlags.Ephemeral });
            }
            
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`wild_throw_select`).setPlaceholder('🎯 Chọn bóng để ném...').addOptions(options)
            );
            
            return interaction.reply({ content: 'Hãy nhanh tay chọn bóng để ném!', components: [row], flags: MessageFlags.Ephemeral });
        }
        
        if (cid === 'wild_throw_select') {
            const val = interaction.values[0];
            const parts = val.split('_'); // throw_{msgId}_{ballKey}
            const msgId = parts[1];
            const ballKey = parts.slice(2).join('_');
            
            const spawnData = activeSpawns.get(msgId);
            if (!spawnData || !spawnData.active) {
                return interaction.update({ content: '❌ Quá muộn! Thú cưng đã biến mất hoặc bị người khác bắt!', components: [] }).catch(() => {});
            }
            
            const p = getPlayer(interaction.user.id);
            if (!p.inventory[ballKey] || p.inventory[ballKey] <= 0) {
                return interaction.update({ content: '❌ Bạn không còn quả bóng loại này!', components: [] });
            }
            
            // Trừ bóng
            updatePlayer(interaction.user.id, dp => {
                dp.inventory[ballKey]--;
            });
            
            const ballConfig = RPG_ITEMS.pokeballs[ballKey];
            const petConfig = PET_LIST.find(pt => pt.id === spawnData.petId);
            
            let rarityMod = 1.0;
            if (petConfig.rarity === 'Hiếm') rarityMod = 0.8;
            if (petConfig.rarity === 'Cực Hiếm') rarityMod = 0.5;
            if (petConfig.rarity === 'Thần Thoại') rarityMod = 0.2;
            if (petConfig.rarity === 'Huyền Thoại') rarityMod = 0.05;
            
            const finalRate = ballConfig.catchRate * rarityMod;
            const roll = Math.random();
            
            if (ballConfig.catchRate >= 1.0 || roll <= finalRate) {
                // Thành công
                spawnData.active = false;
                clearTimeout(spawnData.expireTimeout);
                activeSpawns.delete(msgId);
                
                updatePlayer(interaction.user.id, dp => {
                    dp.pets[petConfig.id] = (dp.pets[petConfig.id] || 0) + 1;
                });
                
                const channel = interaction.client.channels.cache.get(spawnData.channelId);
                if (channel) {
                    const oldMsg = await channel.messages.fetch(msgId).catch(()=>{});
                    if (oldMsg) {
                        const embed = EmbedBuilder.from(oldMsg.embeds[0])
                            .setTitle('🎉 POKEMON ĐÃ BỊ THU PHỤC!')
                            .setDescription(`Một tràng pháo tay cho <@${interaction.user.id}>!\\nNgười chơi này đã nhanh tay ném **${ballConfig.emoji} ${ballConfig.name}** và bắt gọn **${petConfig.emoji} ${petConfig.name}**!`)
                            .addFields(
                                { name: '🌟 Độ Hiếm', value: `**${petConfig.rarity}**`, inline: true },
                                { name: '💰 Định Giá', value: `**${petConfig.price.toLocaleString()} 🪙**`, inline: true },
                                { name: '👤 Chủ Nhân Mới', value: `<@${interaction.user.id}>`, inline: true }
                            )
                            .setImage(petConfig.imageUrl)
                            .setColor('#FFD700')
                            .setThumbnail(interaction.user.displayAvatarURL())
                            .setTimestamp();
                        await oldMsg.edit({ embeds: [embed], components: [] });
                    }
                }
                
                return interaction.update({ content: `✅ Chúc mừng! Bạn ném **${ballConfig.name}** và bắt thành công **${petConfig.name}**!`, components: [] });
            } else {
                return interaction.update({ content: `💥 Bắt xịt! Bạn đã ném **${ballConfig.name}** nhưng thú cưng đã né được! Nó vẫn còn ở đó! (Thử nhấn lại Ném Bóng)`, components: [] });
            }
        }

        // =============================================
        // PET BATTLE BUTTONS
        // =============================================
        if (cid.startsWith('pb_accept_')) {
            const parts = cid.split('_');
            const challengerId = parts[2];
            const targetId = parts[3];
            const bet = parseInt(parts[4]);
            
            if (interaction.user.id !== targetId) return interaction.reply({ content: '❌ Bạn không phải người được thách đấu!', flags: MessageFlags.Ephemeral });
            
            if (getUserCoins(challengerId) < bet) return interaction.reply({ content: `❌ Người thách đấu không còn đủ tiền!`, flags: MessageFlags.Ephemeral });
            if (getUserCoins(targetId) < bet) return interaction.reply({ content: `❌ Bạn không đủ tiền!`, flags: MessageFlags.Ephemeral });
            
            addCoins(challengerId, -bet);
            addCoins(targetId, -bet);
            
            const p1 = getPlayer(challengerId);
            const p2 = getPlayer(targetId);
            
            let p1Best = null, p1MaxPrice = -1;
            for (const pet of PET_LIST) {
                if (p1.pets && p1.pets[pet.id] > 0 && pet.price > p1MaxPrice) { p1MaxPrice = pet.price; p1Best = pet; }
            }
            let p2Best = null, p2MaxPrice = -1;
            for (const pet of PET_LIST) {
                if (p2.pets && p2.pets[pet.id] > 0 && pet.price > p2MaxPrice) { p2MaxPrice = pet.price; p2Best = pet; }
            }
            
            if (!p1Best || !p2Best) {
                addCoins(challengerId, bet);
                addCoins(targetId, bet);
                return interaction.reply({ content: '❌ Lỗi: Có người đã bán mất thú cưng trước khi trận đấu bắt đầu!', flags: MessageFlags.Ephemeral });
            }
            
            const totalPower = p1Best.price + p2Best.price;
            const p1Chance = p1Best.price / totalPower;
            const roll = Math.random();
            let winnerId, loserId, winnerPet, loserPet;
            
            if (roll <= p1Chance) {
                winnerId = challengerId; loserId = targetId;
                winnerPet = p1Best; loserPet = p2Best;
            } else {
                winnerId = targetId; loserId = challengerId;
                winnerPet = p2Best; loserPet = p1Best;
            }
            
            addCoins(winnerId, bet * 2);
            
            const embed = new EmbedBuilder()
                .setTitle('⚔️ KẾT QUẢ PET BATTLE ⚔️')
                .setDescription(`${p1Best.emoji} **VS** ${p2Best.emoji}\n\nSau một trận chiến khốc liệt, **${winnerPet.name}** của <@${winnerId}> đã đánh bại **${loserPet.name}** của <@${loserId}>!\n\n🏆 <@${winnerId}> giành chiến thắng và ẵm trọn **${(bet * 2).toLocaleString()} 🪙**!`)
                .setColor('#F1C40F');
                
            return interaction.update({ embeds: [embed], components: [] });
        }
        
        if (cid.startsWith('pb_decline_')) {
            const parts = cid.split('_');
            const targetId = parts[3];
            if (interaction.user.id !== targetId) return interaction.reply({ content: '❌ Bạn không phải người được thách đấu!', flags: MessageFlags.Ephemeral });
            return interaction.update({ content: `❌ <@${targetId}> đã từ chối lời thách đấu.`, embeds: [], components: [] });
        }

        // =============================================
        // PVP BUTTONS
        // =============================================
        if (cid.startsWith('pvp_accept_')) {
            const parts = cid.split('_');
            const challengerId = parts[2];
            const targetId = parts[3];
            const bet = parseInt(parts[4]);
            
            if (interaction.user.id !== targetId) return interaction.reply({ content: '❌ Bạn không phải người được thách đấu!', flags: MessageFlags.Ephemeral });
            
            if (getUserCoins(challengerId) < bet) return interaction.reply({ content: '❌ Người thách đấu không còn đủ tiền!', flags: MessageFlags.Ephemeral });
            if (getUserCoins(targetId) < bet) return interaction.reply({ content: '❌ Bạn không đủ tiền!', flags: MessageFlags.Ephemeral });
            
            addCoins(challengerId, -bet);
            addCoins(targetId, -bet);
            
            const p1 = getPlayer(challengerId);
            const p2 = getPlayer(targetId);
            
            const result = executePvPBattle(p1, p2);
            
            let winnerId, loserId;
            if (result.winner === 1) { winnerId = challengerId; loserId = targetId; }
            else if (result.winner === 2) { winnerId = targetId; loserId = challengerId; }
            else { winnerId = null; loserId = null; } // Draw
            
            const now = Date.now();
            if (winnerId) {
                addCoins(winnerId, bet * 2);
                updatePlayer(winnerId, dp => { dp.pvpWins = (dp.pvpWins || 0) + 1; dp.lastPvp = now; });
                updatePlayer(loserId, dp => { dp.pvpLosses = (dp.pvpLosses || 0) + 1; dp.lastPvp = now; });
                trackQuestProgress(winnerId, 'pvp_win', 1);
            } else {
                addCoins(challengerId, bet);
                addCoins(targetId, bet);
                updatePlayer(challengerId, dp => { dp.lastPvp = now; });
                updatePlayer(targetId, dp => { dp.lastPvp = now; });
            }
            
            // Update HP after battle
            updatePlayer(challengerId, dp => { dp.hp = Math.max(1, result.winner === 1 ? result.hp1 : result.hp1); });
            updatePlayer(targetId, dp => { dp.hp = Math.max(1, result.winner === 2 ? result.hp2 : result.hp2); });
            
            const battleLog = result.log.length > 10 
                ? result.log.slice(0, 5).join('\n') + '\n... *' + (result.log.length - 10) + ' lượt khác* ...\n' + result.log.slice(-5).join('\n')
                : result.log.join('\n');
            
            const resultEmbed = new EmbedBuilder()
                .setTitle('⚔️ KẾT QUẢ PVP ⚔️')
                .setDescription(
                    `<@${challengerId}> **VS** <@${targetId}>\n\n` +
                    battleLog + '\n\n' +
                    (winnerId 
                        ? `🏆 **<@${winnerId}> THẮNG!** Nhận **${(bet * 2).toLocaleString()} 🪙**`
                        : `🤝 **HÒA!** Cả hai nhận lại tiền cược.`)
                )
                .setColor(winnerId === challengerId ? '#2ECC71' : winnerId === targetId ? '#E74C3C' : '#95A5A6')
                .setTimestamp();
            
            return interaction.update({ embeds: [resultEmbed], components: [] });
        }
        
        if (cid.startsWith('pvp_decline_')) {
            const parts = cid.split('_');
            const targetId = parts[3];
            if (interaction.user.id !== targetId) return interaction.reply({ content: '❌ Bạn không phải người được thách đấu!', flags: MessageFlags.Ephemeral });
            return interaction.update({ content: `❌ <@${targetId}> đã từ chối PvP.`, embeds: [], components: [] });
        }

        // =============================================
        // EVOLVE & SELL DUPE PETS
        // =============================================
        if (interaction.isStringSelectMenu() && cid.startsWith('evolve_select_')) {
            const ownerId = cid.replace('evolve_select_', '');
            if (interaction.user.id !== ownerId) return interaction.reply({ content: '❌ Không phải menu của bạn!', flags: MessageFlags.Ephemeral });
            
            const val = interaction.values[0]; // evolve_fromId_toId
            const parts = val.split('_');
            const fromId = parts[1];
            const toId = parts[2];
            
            const pData = getPlayer(ownerId);
            if (!pData.pets[fromId] || pData.pets[fromId] <= 0) {
                return interaction.reply({ content: '❌ Bạn không sở hữu thú cưng này!', flags: MessageFlags.Ephemeral });
            }
            
            updatePlayer(ownerId, dp => {
                dp.pets[fromId] -= 1;
                if (dp.pets[fromId] <= 0) delete dp.pets[fromId];
                dp.pets[toId] = (dp.pets[toId] || 0) + 1;
            });
            
            const nextPet = PET_LIST.find(p => p.id === toId) || { name: toId, emoji: '✨' };
            return interaction.update({ content: `🌟 Tèn ten ten tén! Thú cưng của bạn đã tiến hóa thành công **${nextPet.emoji} ${nextPet.name}**!`, embeds: [], components: [] });
        }

        if (cid.startsWith('sell_dupe_pets_')) {
            const ownerId = cid.replace('sell_dupe_pets_', '');
            if (interaction.user.id !== ownerId) return interaction.reply({ content: '❌ Không phải của bạn!', flags: MessageFlags.Ephemeral });
            
            let totalCoinEarned = 0;
            let soldCount = 0;
            updatePlayer(ownerId, dp => {
                for (const pet of PET_LIST) {
                    if (dp.pets[pet.id] && dp.pets[pet.id] > 1) {
                        const dupeCount = dp.pets[pet.id] - 1;
                        soldCount += dupeCount;
                        totalCoinEarned += (dupeCount * (pet.price || 1000)) / 2;
                        dp.pets[pet.id] = 1;
                    }
                }
            });
            
            if (soldCount === 0) return interaction.reply({ content: '❌ Không có Pokemon dư để bán!', flags: MessageFlags.Ephemeral });
            
            addCoins(ownerId, totalCoinEarned);
            
            return interaction.update({
                embeds: [new EmbedBuilder()
                    .setTitle('💰 Đã bán thú cưng dư!')
                    .setDescription(`Đã bán **${soldCount}** Pokemon dư và nhận được **${totalCoinEarned.toLocaleString()} 🪙**!`)
                    .setColor('#F1C40F').setTimestamp()
                ],
                components: []
            });
        }
        if (cid.startsWith('ww_')) {
            return WW.handleInteraction(interaction);
        }

        // === XỬ LÝ NÚT NGÂN HÀNG ===
        if (interaction.customId.startsWith('bank_') && !interaction.customId.includes('modal_')) {
            const parts = interaction.customId.split('_');
            const action = parts[1]; // deposit, withdraw, top, refresh
            const ownerId = parts[3];
            
            if (interaction.user.id !== ownerId) {
                return interaction.reply({ content: '❌ Menu ngân hàng này không phải của bạn! Hãy tự dùng lệnh `/bank` hoặc `!bank` để mở menu của riêng bạn.', flags: MessageFlags.Ephemeral });
            }
            
            if (action === 'deposit') {
                const modal = new ModalBuilder()
                    .setCustomId(`bank_deposit_modal_${ownerId}`)
                    .setTitle('GỬI TIỀN VÀO NGÂN HÀNG');
                
                const amountInput = new TextInputBuilder()
                    .setCustomId('deposit_amount_input')
                    .setLabel('Số tiền muốn gửi (nhập số hoặc "all")')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ví dụ: 50000 hoặc all')
                    .setRequired(true);
                
                const row = new ActionRowBuilder().addComponents(amountInput);
                modal.addComponents(row);
                
                return interaction.showModal(modal);
            }
            
            if (action === 'withdraw') {
                const modal = new ModalBuilder()
                    .setCustomId(`bank_withdraw_modal_${ownerId}`)
                    .setTitle('RÚT TIỀN KHỎI NGÂN HÀNG');
                
                const amountInput = new TextInputBuilder()
                    .setCustomId('withdraw_amount_input')
                    .setLabel('Số tiền muốn rút (nhập số hoặc "all")')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ví dụ: 50000 hoặc all')
                    .setRequired(true);
                
                const row = new ActionRowBuilder().addComponents(amountInput);
                modal.addComponents(row);
                
                return interaction.showModal(modal);
            }
            
            if (action === 'top') {
                const embed = buildLeaderboardEmbed(interaction.client);
                return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }
            
            if (action === 'refresh') {
                const embed = buildBankEmbed(interaction.user);
                return interaction.update({ embeds: [embed], components: buildBankButtons(ownerId) });
            }
        }

        // Xử lý nút xác nhận thanh toán
        if (interaction.customId.startsWith('confirm_payment_')) {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
                return interaction.reply({ content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
            const addInfo = interaction.customId.replace('confirm_payment_', '');
            
            const successEmbed = new EmbedBuilder()
                .setTitle('🎉 ĐÃ THANH TOÁN THÀNH CÔNG 🎉')
                .setDescription(`Cảm ơn bạn đã thanh toán!\n\n🔹 **Nội dung / Mã giao dịch:** ${addInfo}`)
                .setColor('#2ECC71')
                .setFooter({ text: 'Xác nhận thanh toán tự động' })
                .setTimestamp();
                
            await interaction.update({ content: null, embeds: [successEmbed], components: [] });
        }

        // === XỬ LÝ NÚT KẾT HÔN ===
        if (interaction.customId.startsWith('marry_')) {
            const parts = interaction.customId.split('_');
            const action = parts[1]; // ring, accept or decline
            const senderId = parts[2];
            const targetId = parts[3];
            
            if (action === 'ring') {
                if (interaction.user.id !== senderId) return interaction.reply({ content: '❌ Đây không phải là menu cầu hôn của bạn!', flags: MessageFlags.Ephemeral });
                const ringId = interaction.values[0];
                const ring = MARRY_RINGS[ringId];
                const p1 = getPlayer(senderId);
                const hasRing = p1.rings && p1.rings[ringId] > 0;
                
                if (!hasRing) {
                    return interaction.reply({ content: `❌ Bạn không còn chiếc ${ring.name} nào trong túi! Hãy vào shop để mua.`, flags: MessageFlags.Ephemeral });
                }
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`marry_accept_${senderId}_${targetId}_${ringId}`).setLabel('Đồng ý').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`marry_decline_${senderId}_${targetId}_${ringId}`).setLabel('Từ chối').setStyle(ButtonStyle.Danger)
                );
                
                const attach = new AttachmentBuilder('./assets/marriage_bg.png', { name: 'marriage_bg.png' });
                const embed = new EmbedBuilder()
                    .setTitle('💍 Lời Cầu Hôn')
                    .setDescription(`<@${senderId}> vừa quỳ gối trao **${ring.name}** ${ring.emoji} cho <@${targetId}>!\n<@${targetId}>, bạn có đồng ý về chung một nhà không?`)
                    .setColor('#FF69B4')
                    .setImage('attachment://marriage_bg.png');
                    
                return interaction.update({ content: `<@${targetId}>`, embeds: [embed], components: [row], files: [attach] });
            }

            if (interaction.user.id !== targetId) {
                return interaction.reply({ content: '❌ Bạn không phải là người được cầu hôn!', flags: MessageFlags.Ephemeral });
            }
            
            if (action === 'decline') {
                await interaction.update({ components: [] });
                return interaction.channel.send(`💔 <@${targetId}> đã từ chối lời cầu hôn của <@${senderId}>. Thật đáng tiếc!`);
            }
            
            if (action === 'accept') {
                const ringId = parts[4];
                const ring = MARRY_RINGS[ringId] || MARRY_RINGS['grass'];
                
                const p1 = getPlayer(senderId);
                const p2 = getPlayer(targetId);
                if (p1.partner || p2.partner) return interaction.reply({ content: '❌ Một trong hai người đã kết hôn với người khác rồi!', flags: MessageFlags.Ephemeral });

                const hasRing = p1.rings && p1.rings[ringId] > 0;

                if (!hasRing) {
                    return interaction.reply({ content: `❌ <@${senderId}> không còn nhẫn trong kho! Lễ cưới bị hủy.`, flags: MessageFlags.Ephemeral });
                }
                
                updatePlayer(senderId, dp => {
                    dp.rings[ringId] -= 1;
                });
                updatePlayer(senderId, dp => { dp.partner = targetId; dp.equippedRing = ringId; });
                updatePlayer(targetId, dp => { dp.partner = senderId; dp.equippedRing = ringId; });
                
                await interaction.update({ components: [] });
                const attach = new AttachmentBuilder('./assets/marriage_accept.png', { name: 'marriage_accept.png' });
                const embed = new EmbedBuilder()
                    .setTitle('🎉 CHÚC MỪNG HẠNH PHÚC! 🎉')
                    .setDescription(`<@${targetId}> đã đồng ý lời cầu hôn!\nHai bạn <@${senderId}> và <@${targetId}> chính thức trở thành vợ chồng với tín vật là **${ring.name}** ${ring.emoji}!`)
                    .setColor('#FF1493')
                    .setImage('attachment://marriage_accept.png');
                return interaction.channel.send({ embeds: [embed], files: [attach] });
            }
        }
        
        // === XỬ LÝ GIAO DỊCH PET ===
        if (interaction.customId.startsWith('ptrade_')) {
            const parts = interaction.customId.split('_');
            const action = parts[1]; // offerA, offerB, accept, decline
            const senderId = parts[2];
            const targetId = parts[3];
            
            if (action === 'offerA') {
                if (interaction.user.id !== senderId) return interaction.reply({ content: '❌ Đây không phải là giao dịch của bạn!', flags: MessageFlags.Ephemeral });
                const petAId = interaction.values[0].replace('ptradeA_', '');
                const petA = PET_LIST.find(p => p.id === petAId);
                
                const p2 = getPlayer(targetId);
                const pets2 = p2.pets || {};
                
                const options = [];
                for (const pet of PET_LIST) {
                    if (pet.rarity === petA.rarity) {
                        const amount = pets2[pet.id] || 0;
                        if (amount > 0) {
                            options.push(new StringSelectMenuOptionBuilder()
                                .setLabel(`Chọn ${pet.name}`)
                                .setValue(`ptradeB_${pet.id}`)
                                .setDescription(`Độ hiếm: ${pet.rarity} - Có: ${amount} con`)
                                .setEmoji(pet.emoji));
                        }
                    }
                }
                
                if (options.length === 0) {
                    await interaction.update({ components: [] });
                    return interaction.channel.send(`❌ Giao dịch thất bại! <@${targetId}> không có bất kỳ thú cưng nào cùng độ hiếm **${petA.rarity}** để đổi lấy **${petA.name}**!`);
                }
                
                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`ptrade_offerB_${senderId}_${targetId}_${petAId}`)
                        .setPlaceholder(`🐾 Chọn thú cùng độ hiếm ${petA.rarity}...`)
                        .addOptions(options.slice(0, 25))
                );
                
                return interaction.update({ content: `🔄 <@${senderId}> đưa ra **${petA.emoji} ${petA.name}** (${petA.rarity})!\n<@${targetId}>, hãy chọn một bé thú cưng cùng độ hiếm để trao đổi:`, components: [row] });
            }
            
            if (action === 'offerB') {
                if (interaction.user.id !== targetId) return interaction.reply({ content: '❌ Đây không phải lượt chọn của bạn!', flags: MessageFlags.Ephemeral });
                const petAId = parts[4];
                const petBId = interaction.values[0].replace('ptradeB_', '');
                
                const petA = PET_LIST.find(p => p.id === petAId);
                const petB = PET_LIST.find(p => p.id === petBId);
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`ptrade_accept_${senderId}_${targetId}_${petAId}_${petBId}`).setLabel('Đồng ý giao dịch').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`ptrade_decline_${senderId}_${targetId}`).setLabel('Hủy bỏ').setStyle(ButtonStyle.Danger)
                );
                
                return interaction.update({ content: `🤝 **XÁC NHẬN GIAO DỊCH**\n\n<@${senderId}> đưa ra: **${petA.emoji} ${petA.name}**\n<@${targetId}> đưa ra: **${petB.emoji} ${petB.name}**\n\n<@${senderId}>, bạn có đồng ý đổi không?`, components: [row] });
            }
            
            if (action === 'decline') {
                if (interaction.user.id !== senderId && interaction.user.id !== targetId) return interaction.reply({ content: '❌ Bạn không có quyền hủy giao dịch này!', flags: MessageFlags.Ephemeral });
                await interaction.update({ components: [] });
                return interaction.channel.send(`❌ Giao dịch giữa <@${senderId}> và <@${targetId}> đã bị hủy!`);
            }
            
            if (action === 'accept') {
                if (interaction.user.id !== senderId) return interaction.reply({ content: '❌ Chỉ người khởi xướng mới có thể chốt giao dịch!', flags: MessageFlags.Ephemeral });
                const petAId = parts[4];
                const petBId = parts[5];
                
                const petA = PET_LIST.find(p => p.id === petAId);
                const petB = PET_LIST.find(p => p.id === petBId);
                
                const p1 = getPlayer(senderId);
                const p2 = getPlayer(targetId);
                
                if (!p1.pets[petAId] || p1.pets[petAId] <= 0) {
                    await interaction.update({ components: [] });
                    return interaction.channel.send(`❌ Giao dịch thất bại! <@${senderId}> không còn **${petA.name}** trong chuồng!`);
                }
                if (!p2.pets[petBId] || p2.pets[petBId] <= 0) {
                    await interaction.update({ components: [] });
                    return interaction.channel.send(`❌ Giao dịch thất bại! <@${targetId}> không còn **${petB.name}** trong chuồng!`);
                }
                
                // Swap
                updatePlayer(senderId, dp => {
                    dp.pets[petAId]--;
                    dp.pets[petBId] = (dp.pets[petBId] || 0) + 1;
                });
                
                updatePlayer(targetId, dp => {
                    dp.pets[petBId]--;
                    dp.pets[petAId] = (dp.pets[petAId] || 0) + 1;
                });
                
                await interaction.update({ components: [] });
                return interaction.channel.send(`🎉 **GIAO DỊCH THÀNH CÔNG!** 🎉\n<@${senderId}> nhận được **${petB.emoji} ${petB.name}**.\n<@${targetId}> nhận được **${petA.emoji} ${petA.name}**.`);
            }
        }
        
        // === XỬ LÝ NÚT ADMIN CHEAT ===
        if (interaction.customId.startsWith('admin_')) {
            if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ Ngươi không phải Hệ Thống (Developer)!', flags: MessageFlags.Ephemeral });
            
            if (interaction.customId === 'admin_toggle_cheat') {
                const cData = loadCoins();
                if (!cData[ADMIN_ID]) cData[ADMIN_ID] = { coins: 500000, bank: 0, lastDaily: 0 };
                
                const isCheatOn = !cData[ADMIN_ID].alwaysWin;
                cData[ADMIN_ID].alwaysWin = isCheatOn;
                
                if (isCheatOn) {
                    cData[ADMIN_ID].coins = 999999999;
                    cData[ADMIN_ID].lastRob = 0;
                    cData[ADMIN_ID].lastHeist = 0;
                    cData[ADMIN_ID].workEnd = null;
                } else {
                    cData[ADMIN_ID].coins = 500000;
                }
                
                saveCoins(cData);

                const newRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('admin_toggle_cheat')
                        .setLabel(isCheatOn ? 'TẮT CHEAT' : 'BẬT CHEAT')
                        .setStyle(isCheatOn ? ButtonStyle.Danger : ButtonStyle.Success)
                        .setEmoji('👑')
                );

                return interaction.update({ 
                    content: `👑 Chế độ Hệ Thống (Developer) đã được **${isCheatOn ? 'BẬT' : 'TẮT'}**!\n${isCheatOn ? 'Bạn đã nhận 1 Tỷ Coin, xóa mọi thời gian chờ và hack Minigames!' : 'Tài sản đã reset về 500k và tắt hack!'}`, 
                    components: [newRow],
                    embeds: [] // Xóa embed cho gọn nếu muốn, hoặc giữ nguyên
                });
            }
        }

        // === XỬ LÝ NÚT GAME MA SÓI ===
        if (interaction.customId.startsWith('ww_myrole_')) {
            const channelId = interaction.customId.replace('ww_myrole_', '');
            const game = wwGames.get(channelId);
            if (!game || game.status === 'LOBBY') return interaction.reply({ content: '❌ Game không tồn tại hoặc chưa bắt đầu!', flags: MessageFlags.Ephemeral });
            
            const p = game.players.get(interaction.user.id);
            if (!p) return interaction.reply({ content: '❌ Bạn không tham gia game này!', flags: MessageFlags.Ephemeral });
            
            let desc = `Vai trò của bạn là: **${p.role}**\n\n`;
            if (p.role === WW_ROLES.WOLF) desc += 'Mục tiêu: Tiêu diệt hết Dân làng và phe bảo vệ. Bạn sẽ thức dậy mỗi đêm để chọn người cắn.';
            else if (p.role === WW_ROLES.SEER) desc += 'Mục tiêu: Giúp dân làng tìm ra Sói. Bạn sẽ thức dậy mỗi đêm để xem vai trò thực sự của một người.';
            else if (p.role === WW_ROLES.GUARD) desc += 'Mục tiêu: Bảo vệ những người vô tội. Bạn sẽ thức dậy mỗi đêm để chọn một người bảo vệ khỏi Sói cắn.';
            else desc += 'Mục tiêu: Sống sót và treo cổ Sói. Hãy suy luận và dùng phiếu bầu của mình vào ban ngày.';
            
            return interaction.reply({ content: desc, flags: MessageFlags.Ephemeral });
        }

        if (interaction.customId.startsWith('ww_action_')) {
            const channelId = interaction.customId.replace('ww_action_', '');
            const game = wwGames.get(channelId);
            if (!game || game.status !== 'NIGHT') return interaction.reply({ content: '❌ Hiện không phải ban đêm!', flags: MessageFlags.Ephemeral });
            
            const p = game.players.get(interaction.user.id);
            if (!p) return interaction.reply({ content: '❌ Bạn không chơi game này!', flags: MessageFlags.Ephemeral });
            if (!p.alive) return interaction.reply({ content: '👻 Người chết không được nói!', flags: MessageFlags.Ephemeral });
            
            if (p.role === WW_ROLES.VILLAGER) {
                return interaction.reply({ content: '💤 Dân làng bình thường không có kỹ năng ban đêm. Hãy đi ngủ!', flags: MessageFlags.Ephemeral });
            }
            
            // Build target list
            const alivePlayers = Array.from(game.players.values()).filter(x => x.alive);
            const options = alivePlayers.map(x => ({
                label: x.user.username,
                value: x.id,
                description: `Chọn ${x.user.username}`
            }));
            
            let actionText = '';
            if (p.role === WW_ROLES.WOLF) actionText = 'Chọn người để cắn 🐺';
            else if (p.role === WW_ROLES.SEER) actionText = 'Chọn người để soi 🔮';
            else if (p.role === WW_ROLES.GUARD) actionText = 'Chọn người để bảo vệ 🛡️';
            
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`ww_target_${channelId}`)
                    .setPlaceholder(actionText)
                    .addOptions(options)
            );
            
            return interaction.reply({ content: 'Hãy sử dụng kỹ năng của bạn (Bí mật):', components: [row], flags: MessageFlags.Ephemeral });
        }

        if (interaction.customId.startsWith('ww_target_')) {
            const channelId = interaction.customId.replace('ww_target_', '');
            const game = wwGames.get(channelId);
            if (!game || game.status !== 'NIGHT') return interaction.update({ content: '❌ Hết thời gian ban đêm!', components: [] });
            
            const p = game.players.get(interaction.user.id);
            if (!p || !p.alive) return interaction.update({ content: '❌ Bạn không thể làm điều này!', components: [] });
            
            const targetId = interaction.values[0];
            const targetP = game.players.get(targetId);
            
            if (p.role === WW_ROLES.WOLF) {
                game.nightActions.wolfVotes.set(p.id, targetId);
                return interaction.update({ content: `🐺 Đã chốt mục tiêu cắn: **${targetP.user.username}**!`, components: [] });
            } else if (p.role === WW_ROLES.SEER) {
                game.nightActions.seerTarget = targetId;
                let roleCheck = targetP.role === WW_ROLES.WOLF ? 'MA SÓI 🐺' : 'NGƯỜI TỐT 🧑‍🌾';
                return interaction.update({ content: `🔮 Quả cầu pha lê cho thấy **${targetP.user.username}** là: **${roleCheck}**!`, components: [] });
            } else if (p.role === WW_ROLES.GUARD) {
                game.nightActions.guardTarget = targetId;
                return interaction.update({ content: `🛡️ Đã đứng canh gác cho **${targetP.user.username}** đêm nay!`, components: [] });
            }
        }

        if (interaction.customId.startsWith('ww_vote_')) {
            const channelId = interaction.customId.replace('ww_vote_', '');
            const game = wwGames.get(channelId);
            if (!game || game.status !== 'DAY') return interaction.reply({ content: '❌ Hiện không phải ban ngày!', flags: MessageFlags.Ephemeral });
            
            const p = game.players.get(interaction.user.id);
            if (!p) return interaction.reply({ content: '❌ Bạn không chơi game này!', flags: MessageFlags.Ephemeral });
            if (!p.alive) return interaction.reply({ content: '👻 Người chết không được bầu cử!', flags: MessageFlags.Ephemeral });
            
            const targetId = interaction.values[0];
            game.dayVotes.set(p.id, targetId);
            
            if (targetId === 'skip') {
                return interaction.reply({ content: '🗳️ Đã chọn **Skip Vote**.', flags: MessageFlags.Ephemeral });
            } else {
                return interaction.reply({ content: `🗳️ Bạn đã vote treo cổ **${game.players.get(targetId).user.username}**!`, flags: MessageFlags.Ephemeral });
            }
        }

        // === XỬ LÝ NÚT NHẠC ===
        const musicButtonIds = ['music_toggle', 'music_skip', 'music_stop', 'music_queue', 'music_vol_down', 'music_vol_up', 'music_loop'];

        // === XỬ LÝ NÚT TÀI XỈU ===
        if (interaction.customId.startsWith('tx_')) {
            const game = taixiuGames.get(interaction.message.id);
            if (!game) return interaction.reply({ content: '❌ Phiên Tài Xỉu này đã hết hạn hoặc không tồn tại!', flags: MessageFlags.Ephemeral });
            if (game.uid !== interaction.user.id) return interaction.reply({ content: '❌ Đây không phải bàn cược của bạn!', flags: MessageFlags.Ephemeral });
            
            const betChoice = interaction.customId.replace('tx_', '');
            const { uid, bet } = game;
            
            if (getUserCoins(uid) < bet) {
                taixiuGames.delete(interaction.message.id);
                return interaction.reply({ content: '❌ Bạn không đủ coin để chơi!', flags: MessageFlags.Ephemeral });
            }
            
            taixiuGames.delete(interaction.message.id);
            addCoins(uid, -bet);
            
            let d1 = Math.floor(Math.random() * 6) + 1;
            let d2 = Math.floor(Math.random() * 6) + 1;
            let d3 = Math.floor(Math.random() * 6) + 1;
            
            const cData = loadCoins();
            if (cData[uid] && cData[uid].alwaysWin) {
                if (betChoice === 'tai') { d1 = 4; d2 = 4; d3 = 4; }
                else if (betChoice === 'xiu') { d1 = 2; d2 = 2; d3 = 2; }
                else if (betChoice === 'chan') { d1 = 2; d2 = 2; d3 = 2; }
                else if (betChoice === 'le') { d1 = 1; d2 = 2; d3 = 2; }
                else {
                    let target = parseInt(betChoice);
                    d1 = Math.floor(target/3) || 1;
                    d2 = Math.floor((target - d1)/2) || 1;
                    d3 = target - d1 - d2;
                }
            }
            const sum = d1 + d2 + d3;
            
            const isTai = sum >= 11 && sum <= 18;
            const isXiu = sum >= 3 && sum <= 10;
            const isChan = sum % 2 === 0;
            const isLe = sum % 2 !== 0;
            
            let winMultiplier = 0;
            let choiceName = '';
            if (betChoice === 'tai') { choiceName = 'Tài'; if (isTai) winMultiplier = 2; }
            else if (betChoice === 'xiu') { choiceName = 'Xỉu'; if (isXiu) winMultiplier = 2; }
            else if (betChoice === 'chan') { choiceName = 'Chẵn'; if (isChan) winMultiplier = 2; }
            else if (betChoice === 'le') { choiceName = 'Lẻ'; if (isLe) winMultiplier = 2; }
            else { choiceName = `Số ${betChoice}`; if (sum.toString() === betChoice) winMultiplier = TX_MULTIPLIERS[betChoice] || 2; }
            
            const prize = bet * winMultiplier;
            let resultText = '';
            if (prize > 0) {
                addCoins(uid, prize);
                resultText = `và **THẮNG** nhận **${prize.toLocaleString()} 🪙**!`;
            } else {
                resultText = `và **THUA** mất **${bet.toLocaleString()} 🪙**!`;
            }
            
            taixiuHistory.push(sum);
            if (taixiuHistory.length > 15) taixiuHistory.shift();
            
            const chartUrl = buildTxChartUrl();
            const diceMap = { 1:'⚀', 2:'⚁', 3:'⚂', 4:'⚃', 5:'⚄', 6:'⚅' };
            const typeStr = `${isTai ? 'Tài' : 'Xỉu'} - ${isChan ? 'Chẵn' : 'Lẻ'}`;
            
            const embed = new EmbedBuilder()
                .setTitle('🎲 Kết Quả Tài Xỉu')
                .setDescription(`**${diceMap[d1]} • ${diceMap[d2]} • ${diceMap[d3]}**\n\n**${d1} • ${d2} • ${d3}**\n\n**Tổng điểm: ${sum} — ${typeStr}**\n\n**Tổng Kết:**\n<@${uid}> đã cược **${choiceName}: ${bet.toLocaleString()} 🪙** ${resultText}`)
                .setColor(prize > 0 ? '#00FF00' : '#FF0000');
                
            if (chartUrl) embed.setImage(chartUrl);
            
            return interaction.update({ embeds: [embed], components: [] });
        }

        // Bầu Cua Game (Click Nút)
        if (interaction.customId.startsWith('bc_')) {
            const channelId = interaction.channelId;
            const game = baucuaChannels.get(channelId);
            if (!game || game.msgId !== interaction.message.id) {
                return interaction.reply({ content: '❌ Bàn Bầu Cua này đã đóng!', flags: MessageFlags.Ephemeral });
            }

            const choice = interaction.customId.replace('bc_', ''); // bau, cua, tom, ca, ga, nai
            const faceNames = { 'bau': 'Bầu', 'cua': 'Cua', 'tom': 'Tôm', 'ca': 'Cá', 'ga': 'Gà', 'nai': 'Nai' };
            
            const modal = new ModalBuilder()
                .setCustomId(`bcmodal_${choice}_${channelId}`)
                .setTitle(`Đặt cược vào ${faceNames[choice]}`);
                
            const betInput = new TextInputBuilder()
                .setCustomId('bet_amount')
                .setLabel('Nhập số Coin (Tối thiểu 10, tối đa 500k)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('VD: 1000')
                .setRequired(true);
                
            const actionRow = new ActionRowBuilder().addComponents(betInput);
            modal.addComponents(actionRow);
            
            return interaction.showModal(modal);
        }

        // === XỬ LÝ DROPDOWN KÍCH USER KHỎI PHÒNG ===
        if (interaction.customId && interaction.customId.startsWith('vkick_select_')) {
            const voiceChannelId = interaction.customId.replace('vkick_select_', '');
            const targetId = interaction.values[0];
            
            const voiceChannel = interaction.guild.channels.cache.get(voiceChannelId);
            if (!voiceChannel) return interaction.update({ content: '❌ Kênh thoại không còn tồn tại!', components: [] });

            const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
            if (!targetMember || targetMember.voice.channelId !== voiceChannelId) {
                return interaction.update({ content: '❌ Người dùng này không còn ở trong phòng nữa!', components: [] });
            }

            try {
                await targetMember.voice.disconnect('Bị kích khỏi phòng');
                return interaction.update({ content: `✅ Đã kích **${targetMember.user.username}** khỏi phòng!`, components: [] });
            } catch (error) {
                console.error(error);
                return interaction.update({ content: '❌ Đã xảy ra lỗi, hãy đảm bảo bot có đủ quyền **Move Members**.', components: [] });
            }
        }

        // === XỬ LÝ CHỌN CÔNG VIỆC ===
        if (interaction.customId.startsWith('work_select_')) {
            const ownerId = interaction.customId.replace('work_select_', '');
            if (interaction.user.id !== ownerId) return interaction.reply({ content: '❌ Menu việc làm này không phải của bạn!', flags: MessageFlags.Ephemeral });
            
            const jobId = interaction.values[0];
            const job = WORK_JOBS[jobId];
            if (!job) return interaction.reply({ content: '❌ Công việc không tồn tại!', flags: MessageFlags.Ephemeral });
            
            const data = loadCoins();
            if (!data[ownerId]) data[ownerId] = { coins: 0 };
            const user = data[ownerId];
            
            if (user.workEnd && Date.now() < user.workEnd) {
                return interaction.reply({ content: '❌ Bạn đang làm một công việc khác rồi!', flags: MessageFlags.Ephemeral });
            }
            
            user.workJob = job.name;
            user.workEnd = Date.now() + job.duration;
            user.workReward = Math.floor(Math.random() * (job.maxR - job.minR + 1)) + job.minR;
            saveCoins(data);
            
            const embed = new EmbedBuilder()
                .setTitle('💼 Bắt đầu làm việc!')
                .setDescription(`Bạn đã nhận công việc **${job.name}** ${job.emoji}.\nThời gian: **${job.duration / 60000} phút**.\nLương dự kiến: **${job.minR.toLocaleString()} - ${job.maxR.toLocaleString()} 🪙**.\n\nHãy dùng lệnh \`!work\` hoặc \`/work\` sau khi hết thời gian để nhận lương!`)
                .setColor('#2ECC71');
                
            return interaction.update({ embeds: [embed], components: [] });
        }

        // === XỬ LÝ NÚT BLACKJACK ===
        if (['bj_hit', 'bj_stand', 'bj_double'].includes(interaction.customId)) {
            const game = blackjackGames.get(interaction.user.id);
            if (!game) return interaction.reply({ content: '❌ Không có game Blackjack nào!', flags: MessageFlags.Ephemeral });
            if (game.uid !== interaction.user.id) return interaction.reply({ content: '❌ Đây không phải game của bạn!', flags: MessageFlags.Ephemeral });

            // Hit
            if (interaction.customId === 'bj_hit') {
                game.p.push(game.deck.pop());
                const pv = handVal(game.p);
                if (pv > 21) {
                    // Bust
                    blackjackGames.delete(interaction.user.id);
                    const embed = bjEmbed(game, `💥 Quá 21! Mất ${game.bet.toLocaleString()} 🪙`, '#FF4444', true);
                    return interaction.update({ embeds: [embed], components: [] });
                }
                if (pv === 21) {
                    // Auto stand on 21
                    dealerPlay(game);
                    let dv = handVal(game.d);
                    let hackedPv = pv;
                    
                    const cData = loadCoins();
                    if (cData[game.uid]?.alwaysWin) { hackedPv = 21; dv = 22; }
                    
                    let result, color;
                    if (dv > 21 || hackedPv > dv) { addCoins(game.uid, game.bet); result = `🎉 Thắng! +${game.bet.toLocaleString()} 🪙`; color = '#00FF88'; }
                    else if (hackedPv === dv) { result = '🤝 Hòa! Hoàn trả cược'; color = '#888888'; addCoins(game.uid, game.bet); }
                    else { result = `💀 Thua! -${game.bet.toLocaleString()} 🪙`; color = '#FF4444'; }
                    blackjackGames.delete(interaction.user.id);
                    return interaction.update({ embeds: [bjEmbed(game, result, color, true)], components: [] });
                }
                return interaction.update({ embeds: [bjEmbed(game, '🃏 Game đang diễn ra...', '#0099ff')], components: [bjButtons(getUserCoins(game.uid) >= game.bet)] });
            }

            // Stand
            if (interaction.customId === 'bj_stand') {
                dealerPlay(game);
                let pv = handVal(game.p), dv = handVal(game.d);
                
                const cData = loadCoins();
                if (cData[game.uid]?.alwaysWin) { pv = 21; dv = 22; }
                
                let result, color;
                if (dv > 21 || pv > dv) { addCoins(game.uid, game.bet); result = `🎉 Thắng! +${game.bet.toLocaleString()} 🪙`; color = '#00FF88'; }
                else if (pv === dv) { result = '🤝 Hòa! Hoàn trả cược'; color = '#888888'; addCoins(game.uid, game.bet); }
                else { result = `💀 Thua! -${game.bet.toLocaleString()} 🪙`; color = '#FF4444'; }
                blackjackGames.delete(interaction.user.id);
                return interaction.update({ embeds: [bjEmbed(game, result, color, true)], components: [] });
            }

            // Double Down
            if (interaction.customId === 'bj_double') {
                if (getUserCoins(game.uid) < game.bet) return interaction.reply({ content: '❌ Không đủ coin để gấp đôi!', flags: MessageFlags.Ephemeral });
                addCoins(game.uid, -game.bet);
                game.bet *= 2;
                game.p.push(game.deck.pop());
                dealerPlay(game);
                let pv = handVal(game.p), dv = handVal(game.d);
                
                const cData = loadCoins();
                if (cData[game.uid]?.alwaysWin) { pv = 21; dv = 22; }
                
                let result, color;
                if (pv > 21) { result = `💥 Quá 21! Mất ${game.bet.toLocaleString()} 🪙`; color = '#FF4444'; }
                else if (dv > 21 || pv > dv) { addCoins(game.uid, game.bet * 2); result = `🎉 Thắng! +${game.bet.toLocaleString()} 🪙`; color = '#00FF88'; }
                else if (pv === dv) { addCoins(game.uid, game.bet); result = '🤝 Hòa! Hoàn trả'; color = '#888888'; }
                else { result = `💀 Thua! -${game.bet.toLocaleString()} 🪙`; color = '#FF4444'; }
                blackjackGames.delete(interaction.user.id);
                return interaction.update({ embeds: [bjEmbed(game, result, color, true)], components: [] });
            }
        }
        // === XỬ LÝ NÚT NHẠC ===
        if (musicButtonIds.includes(interaction.customId)) {
            const state = getQueue(interaction.guildId);

            if (!state.player || !state.queue.length || !state.djId) {
                return interaction.reply({ content: '❌ Không có nhạc đang phát!', flags: MessageFlags.Ephemeral }).catch(console.error);
            }

            // Kiểm tra quyền: chỉ DJ (người gọi /play) mới điều khiển được
            if (interaction.user.id !== state.djId) {
                return interaction.reply({
                    content: `❌ Chỉ <@${state.djId}> (người gọi nhạc) mới có thể điều khiển!`,
                    flags: MessageFlags.Ephemeral
                }).catch(console.error);
            }

            // --- NÚt TẠM DỬ NG / TIẾP TỤC ---
            
    }
}

    if (interaction.isButton() && interaction.customId === 'pinggame_edit_basic') {
        const config = getGuildConfig(interaction.guildId);
        const modal = new ModalBuilder().setCustomId('pinggame_edit_basic_modal').setTitle('Sửa Nội dung Hướng dẫn');
        const defaultContent = `Đây là kênh để ping game trong server\nCách ping là @mention game muốn chơi lên ví dụ như là \`@TFT\` ....\nCảm ơn đã đọc ạ`;
        const currentMsg = config.pingGameMessage || defaultContent;
        const msgInput = new TextInputBuilder().setCustomId('msg_input').setLabel('Nội dung hướng dẫn ping game').setStyle(TextInputStyle.Paragraph).setValue(currentMsg.substring(0, 4000)).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(msgInput));
        return interaction.showModal(modal);
    }

    if (interaction.isButton() && interaction.customId === 'set1ar_edit_command') {
        const config = getGuildConfig(interaction.guildId);
        const modal = new ModalBuilder().setCustomId('set1ar_edit_command_modal').setTitle('Sửa Cú pháp Lệnh');
        const cmdInput = new TextInputBuilder().setCustomId('cmd_input').setLabel('Từ khoá lệnh (Viết liền, không dấu)').setStyle(TextInputStyle.Short).setValue(config.arCommandText || '1ar').setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(cmdInput));
        return interaction.showModal(modal);
    }

    if (interaction.isButton() && (interaction.customId === 'toggle_antinuke' || interaction.customId === 'toggle_antiraid')) {
        const config = getGuildConfig(interaction.guildId);
        const isNuke = interaction.customId === 'toggle_antinuke';
        const key = isNuke ? 'antiNukeEnabled' : 'antiRaidEnabled';
        const currentState = config[key] !== false;
        const newState = !currentState;
        
        updateGuildConfig(interaction.guildId, key, newState);
        
        const embed = new EmbedBuilder()
            .setTitle(isNuke ? '🛡️ HỆ THỐNG ANTI-NUKE' : '🛡️ HỆ THỐNG ANTI-RAID & ANTI-SPAM')
            .setDescription(`**Trạng thái hiện tại:** ${newState ? '🟢 ĐANG BẬT' : '🔴 ĐANG TẮT'}\n\n${isNuke ? 'Khi bật, nếu có Quản trị viên nào xoá kênh, xoá role, ban hoặc kick thành viên **3 lần trong 10 giây**, hệ thống sẽ tự động tước toàn bộ role của họ để ngăn chặn phá hoại.' : 'Khi bật:\n- Nếu có **10 người join trong 10 giây**, hệ thống sẽ **Kick** ngay lập tức những người mới.\n- Nếu có ai chat **10 tin nhắn trong 5 giây** hoặc **5 tin nhắn giống hệt nhau**, họ sẽ bị Mute 1 tiếng.'}`)
            .setColor(newState ? '#00FF00' : '#FF0000');
            
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(interaction.customId).setLabel(newState ? (isNuke ? 'Tắt Anti-Nuke' : 'Tắt Anti-Raid') : (isNuke ? 'Bật Anti-Nuke' : 'Bật Anti-Raid')).setStyle(newState ? ButtonStyle.Danger : ButtonStyle.Success)
        );
        
        return interaction.update({ embeds: [embed], components: [row] }).catch(() => {});
    }

    

    // === MODAL SUBMIT ===
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('shop_buy_modal_')) {
            const parts = interaction.customId.split('_');
            const type = parts[3];
            const itemCode = parts.slice(4).join('_');
            
            const amountStr = interaction.fields.getTextInputValue('buy_amount_input');
            const amount = parseInt(amountStr);
            if (isNaN(amount) || amount <= 0) {
                return interaction.reply({ content: '❌ Số lượng không hợp lệ!', flags: MessageFlags.Ephemeral });
            }
            
            let item;
            if (type === 'pokeball') item = RPG_ITEMS.pokeballs[itemCode];
            else if (type === 'seed') item = RPG_ITEMS.seeds?.[itemCode];
            else if (type === 'tool') item = RPG_ITEMS.tools?.[itemCode];
            
            if (!item) return interaction.reply({ content: '❌ Mã món đồ không tồn tại!', flags: MessageFlags.Ephemeral });
            
            const totalCost = item.price * amount;
            const uid = interaction.user.id;
            
            if (getUserCoins(uid) < totalCost) {
                return interaction.reply({ content: `❌ Bạn không đủ Coin! (Cần ${totalCost.toLocaleString()} 🪙)`, flags: MessageFlags.Ephemeral });
            }
            
            addCoins(uid, -totalCost);
            updatePlayer(uid, p => {
                if (!p.inventory) p.inventory = {};
                p.inventory[itemCode] = (p.inventory[itemCode] || 0) + amount;
            });
            
            trackQuestProgress(uid, 'buy', amount);
            return interaction.reply({ content: `✅ Bạn đã mua **${amount}x ${item.emoji || ''} ${item.name}** thành công! Số dư: **${getUserCoins(uid).toLocaleString()} 🪙**`, flags: MessageFlags.Ephemeral });
        }

        if (interaction.customId === 'set1ar_edit_command_modal') {
            const newCmd = interaction.fields.getTextInputValue('cmd_input').toLowerCase().trim();
            updateGuildConfig(interaction.guildId, 'arCommandText', newCmd);
            
            const config = getGuildConfig(interaction.guildId);
            const roleId = config.arRoleId || '1492427406563213462';
            const roleStr = `<@&${roleId}>`;
            
            const embed = new EmbedBuilder()
                .setTitle('⚙️ BẢNG ĐIỀU KHIỂN LỆNH CẤP ROLE')
                .setDescription(`✅ Đã cập nhật thành công!\n\n**Bản xem trước dữ liệu:**\n- **Cú pháp lệnh mới:** \`${newCmd} @user\`\n- **Role được cấp:** ${roleStr}`)
                .setColor('#9B59B6');
                
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('set1ar_edit_command').setLabel('Sửa Cú pháp Lệnh').setStyle(ButtonStyle.Primary)
            );
            
            return interaction.update({ embeds: [embed], components: [row] }).catch(() => {});
        }

        

        if (interaction.customId === 'pinggame_edit_basic_modal') {
            const newMsg = interaction.fields.getTextInputValue('msg_input');
            updateGuildConfig(interaction.guildId, 'pingGameMessage', newMsg);
            
            const config = getGuildConfig(interaction.guildId);
            const channel = interaction.guild?.channels.cache.get(config.pingGameChannelId) || 'Không xác định';
            
            const embed = new EmbedBuilder()
                .setTitle('⚙️ BẢNG ĐIỀU KHIỂN PING GAME')
                .setDescription(`✅ Đã cập nhật thành công!\n\n**Kênh hiện tại:** ${channel}\n**Bản xem trước dữ liệu:**\n- **Nội dung:** ${newMsg.substring(0, 100)}...\n\n👇 **Sử dụng các nút bên dưới để tuỳ chỉnh nội dung.**`)
                .setColor('#3498DB');
                
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('pinggame_edit_basic').setLabel('Sửa Nội dung hướng dẫn').setStyle(ButtonStyle.Primary)
            );
            
            return interaction.update({ embeds: [embed], components: [row] }).catch(() => {});
        }

        if (interaction.customId === 'j2c_name_modal') {
            const newName = interaction.fields.getTextInputValue('new_name');
            await interaction.channel.setName(newName).catch(() => {});
            return interaction.reply({ content: `✅ Đã đổi tên phòng thành: **${newName}**`, flags: MessageFlags.Ephemeral });
        }
        
        if (interaction.customId === 'j2c_limit_modal') {
            const limitStr = interaction.fields.getTextInputValue('new_limit');
            const limit = parseInt(limitStr);
            if (isNaN(limit) || limit < 0 || limit > 99) {
                return interaction.reply({ content: '❌ Vui lòng nhập số từ 0 đến 99 (0 = Không giới hạn)!', flags: MessageFlags.Ephemeral });
            }
            await interaction.channel.setUserLimit(limit).catch(() => {});
            
            const oldEmbed = interaction.message.embeds[0];
            if (oldEmbed) {
                const newEmbed = EmbedBuilder.from(oldEmbed);
                newEmbed.data.fields[1].value = limit === 0 ? 'Không giới hạn' : `${limit} người`;
                await interaction.message.edit({ embeds: [newEmbed] }).catch(() => {});
            }
            return interaction.reply({ content: `✅ Đã chỉnh giới hạn phòng thành: **${limit === 0 ? 'Không giới hạn' : limit + ' người'}**`, flags: MessageFlags.Ephemeral });
        }

        if (interaction.customId.startsWith('bcmodal_')) {
            const parts = interaction.customId.split('_');
            const choice = parts[1];
            const channelId = parts[2];
            
            const game = baucuaChannels.get(channelId);
            if (!game) {
                return interaction.reply({ content: '❌ Bàn Bầu Cua này đã kết thúc!', flags: MessageFlags.Ephemeral });
            }
            
            const amountInput = interaction.fields.getTextInputValue('bet_amount').trim().toLowerCase();
            const uid = interaction.user.id;
            const cash = getUserCoins(uid);
            let finalAmount;
            
            if (amountInput === 'all') {
                finalAmount = Math.min(cash, 500000);
            } else {
                finalAmount = parseInt(amountInput);
                if (isNaN(finalAmount) || finalAmount < 10) {
                    return interaction.reply({ content: '❌ Cú pháp không hợp lệ. Vui lòng nhập số coin (tối thiểu 10) hoặc "all".', flags: MessageFlags.Ephemeral });
                }
            }
            
            if (finalAmount > 500000) return interaction.reply({ content: '❌ Mức cược tối đa là **500,000 🪙**!', flags: MessageFlags.Ephemeral });
            if (cash < finalAmount) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${cash.toLocaleString()} 🪙**.`, flags: MessageFlags.Ephemeral });
            
            addCoins(uid, -finalAmount);
            game.bets.push({
                uid: uid,
                choice: choice,
                amount: finalAmount
            });
            
            // Cập nhật lại danh sách trên Embed
            const faceNames = { 'bau': 'Bầu 🍐', 'cua': 'Cua 🦀', 'tom': 'Tôm 🦐', 'ca': 'Cá 🐟', 'ga': 'Gà 🐓', 'nai': 'Nai 🦌' };
            const desc = `Bàn cược đã mở! Hãy nhấn vào linh vật bên dưới để đặt cược.\nThời gian còn lại: **Vài giây nữa...**\n\n**Danh sách cược hiện tại:**\n` + 
                         game.bets.map(b => `<@${b.uid}>: **${b.amount.toLocaleString()} 🪙** vào ${faceNames[b.choice]}`).join('\n');
            
            const embed = new EmbedBuilder()
                .setTitle('🎲 BÀN BẦU CUA TÔM CÁ 🎲')
                .setDescription(desc)
                .setColor('#E67E22');
                
            game.messageObj.edit({ embeds: [embed] }).catch(() => {});
            
            return interaction.reply({ content: `✅ Bạn đã đặt cược **${finalAmount.toLocaleString()} 🪙** vào **${faceNames[choice]}** thành công!`, flags: MessageFlags.Ephemeral });
        }
        
        if (interaction.customId.startsWith('bank_deposit_modal_')) {
            const ownerId = interaction.customId.replace('bank_deposit_modal_', '');
            if (interaction.user.id !== ownerId) return interaction.reply({ content: '❌ Bạn không phải chủ sở hữu giao dịch này!', flags: MessageFlags.Ephemeral });
            
            const amount = interaction.fields.getTextInputValue('deposit_amount_input').trim().toLowerCase();
            const cash = getUserCoins(ownerId);
            let finalAmount;
            
            if (amount === 'all') {
                finalAmount = cash;
            } else {
                finalAmount = parseInt(amount);
                if (isNaN(finalAmount) || finalAmount <= 0) {
                    return interaction.reply({ content: '❌ Số tiền không hợp lệ! Vui lòng nhập số nguyên dương hoặc "all".', flags: MessageFlags.Ephemeral });
                }
            }
            
            if (cash < finalAmount) {
                return interaction.reply({ content: `❌ Bạn không đủ tiền mặt! (Hiện có: **${cash.toLocaleString()} 🪙** tiền mặt)`, flags: MessageFlags.Ephemeral });
            }
            if (finalAmount === 0) {
                return interaction.reply({ content: '❌ Bạn không có tiền mặt để gửi!', flags: MessageFlags.Ephemeral });
            }
            
            addCoins(ownerId, -finalAmount);
            addBank(ownerId, finalAmount);
            
            const embed = buildBankEmbed(interaction.user);
            await interaction.update({ embeds: [embed], components: buildBankButtons(ownerId) });
            return interaction.followUp({ content: `✅ Đã gửi **${finalAmount.toLocaleString()} 🪙** vào ngân hàng thành công!`, flags: MessageFlags.Ephemeral });
        }
        
        if (interaction.customId.startsWith('bank_withdraw_modal_')) {
            const ownerId = interaction.customId.replace('bank_withdraw_modal_', '');
            if (interaction.user.id !== ownerId) return interaction.reply({ content: '❌ Bạn không phải chủ sở hữu giao dịch này!', flags: MessageFlags.Ephemeral });
            
            const amount = interaction.fields.getTextInputValue('withdraw_amount_input').trim().toLowerCase();
            const bank = getUserBank(ownerId);
            let finalAmount;
            
            if (amount === 'all') {
                finalAmount = bank;
            } else {
                finalAmount = parseInt(amount);
                if (isNaN(finalAmount) || finalAmount <= 0) {
                    return interaction.reply({ content: '❌ Số tiền không hợp lệ! Vui lòng nhập số nguyên dương hoặc "all".', flags: MessageFlags.Ephemeral });
                }
            }
            
            if (bank < finalAmount) {
                return interaction.reply({ content: `❌ Tài khoản ngân hàng của bạn không đủ tiền! (Hiện có: **${bank.toLocaleString()} 🪙** trong ngân hàng)`, flags: MessageFlags.Ephemeral });
            }
            if (finalAmount === 0) {
                return interaction.reply({ content: '❌ Ngân hàng của bạn đang trống, không thể rút!', flags: MessageFlags.Ephemeral });
            }
            
            addBank(ownerId, -finalAmount);
            addCoins(ownerId, finalAmount);
            
            const embed = buildBankEmbed(interaction.user);
            await interaction.update({ embeds: [embed], components: buildBankButtons(ownerId) });
            return interaction.followUp({ content: `✅ Đã rút **${finalAmount.toLocaleString()} 🪙** về ví tiền mặt thành công!`, flags: MessageFlags.Ephemeral });
        }
        

        
    }

    // === SLASH COMMANDS ===
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (commandName === 'nopphat' || commandName === 'bribe') {
        const data = loadCoins();
        if (!data[uid] || !data[uid].jailEnd || Date.now() >= data[uid].jailEnd) {
            return interaction.reply({ content: '❌ Bạn có ở trong tù đâu mà đòi nộp phạt!', flags: MessageFlags.Ephemeral });
        }
        if ((data[uid].coins || 0) < 100000) {
            return interaction.reply({ content: '❌ Không đủ tiền! Bạn cần **100,000 🪙** tiền mặt để nộp phạt.', flags: MessageFlags.Ephemeral });
        }
        data[uid].coins = Math.max(0, (data[uid].coins || 0) - 100000);
        data[uid].jailEnd = null;
        saveCoins(data);
        return interaction.reply({ content: '🔓 Bạn đã nộp **100,000 🪙** cho công an và được thả tự do!', flags: 0 });
    }

    if (commandName === 'rob') {
        const robTarget = interaction.options?.getUser('user');
        if (!robTarget) return interaction.reply({ content: '❌ Bạn phải chọn người để trộm!', ephemeral: true });
        return handleRob(uid, robTarget.id, interaction);
    }

    if (commandName === 'robbank' || commandName === 'heist') {
        const robTarget = interaction.options?.getUser('user');
        return handleRobbank(uid, interaction, robTarget ? robTarget.id : null);
    }

    // --- HELP ---
    if (commandName === 'dovui') {
        return handleTrivia(interaction.user.id, interaction);
    }
    if (commandName === 'help') {
        const prefix = getPrefix(interaction.guildId);
        const pages = buildHelpPages(prefix);
        const menu = buildHelpMenu();
        const row = new ActionRowBuilder().addComponents(menu);
        await interaction.reply({ embeds: [pages[0]], components: [row] });

        const msg = await interaction.fetchReply();
        const collector = msg.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 120_000
        });
        collector.on('collect', async i => {
            const page = parseInt(i.values[0]);
            if (page === 10) {
                await i.update({ embeds: [pages[page]], components: [row] });
                return;
            }
            if (page === 8 || page === 9) {
                // Trang Admin: chỉ Admin mới được xem, hiển thị ẩn
                const isAdmin = i.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
                if (!isAdmin) {
                    return i.reply({ content: '🔒 **Trang này chỉ dành cho Admin!** Bạn không có quyền xem mục này.', flags: MessageFlags.Ephemeral });
                }
                await i.update({ components: [row] });
                return i.followUp({ embeds: [pages[page]], flags: MessageFlags.Ephemeral });
            }
            if (i.user.id !== interaction.user.id) {
                return i.reply({ content: '❌ Chỉ người dùng lệnh mới có thể điều hướng!', flags: MessageFlags.Ephemeral });
            }
            await i.update({ embeds: [pages[page]], components: [row] });
        });
        collector.on('end', () => {
            interaction.editReply({ components: [] }).catch(() => {});
        });
        return;
    }

    // --- LEADERBOARD & TOP ---
    if (commandName === 'leaderboard' || commandName === 'top') {
        const embed = buildLeaderboardEmbed(interaction.client);
        return interaction.reply({ embeds: [embed] });
    }

    // --- PLAY ---
    if (commandName === 'play') {
        const query = interaction.options.getString('query');
        const file = interaction.options.getAttachment('file');
        const voiceChannel = interaction.member?.voice?.channel;

        if (!query && !file) {
            return interaction.reply({ content: '❌ Bạn phải nhập tên bài hát hoặc đính kèm một file nhạc!', flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        if (!voiceChannel) {
            return interaction.reply({ content: '❌ Bạn cần vào **voice channel** trước!', flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        const perms = voiceChannel.permissionsFor(client.user);
        if (!perms.has(PermissionsBitField.Flags.Connect) || !perms.has(PermissionsBitField.Flags.Speak)) {
            return interaction.reply({ content: '❌ Bot không có quyền vào kênh thoại này!', flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        try {
            await interaction.deferReply();
        } catch (err) {
            return; // Interaction expired, skip doing heavy work
        }

        try {
            let songInfo;
            if (file) {
                if (!file.contentType?.startsWith('audio/') && !file.name.endsWith('.mp3') && !file.name.endsWith('.wav') && !file.name.endsWith('.ogg')) {
                    return interaction.editReply('❌ File đính kèm phải là định dạng âm thanh (mp3, wav, ogg)!');
                }
                songInfo = {
                    title: file.name,
                    url: file.url,
                    duration: 'N/A',
                    thumbnail: 'https://i.imgur.com/8Qp4wO8.png',
                    requestedBy: interaction.user.tag,
                    requestedById: interaction.user.id,
                    isAttachment: true
                };
            } else {
                await interaction.editReply('⏳ Đang xử lý bài hát...');
                const infoResult = await ytdlpGetInfo(query);
                if (!infoResult || (Array.isArray(infoResult) && infoResult.length === 0)) {
                    return interaction.editReply('❌ Không tìm thấy bài hát nào!');
                }

                const state = getQueue(interaction.guildId);

                // Kết nối voice nếu chưa
                if (!state.connection) {
                    state.connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: interaction.guildId,
                        adapterCreator: interaction.guild.voiceAdapterCreator,
                        selfDeaf: true
                    });

                    state.connection.on(VoiceConnectionStatus.Disconnected, async () => {
                        try {
                            await Promise.race([
                                entersState(state.connection, VoiceConnectionStatus.Signalling, 5_000),
                                entersState(state.connection, VoiceConnectionStatus.Connecting, 5_000),
                            ]);
                        } catch {
                            state.connection.destroy();
                            musicQueues.delete(interaction.guildId);
                        }
                    });
                }
                
                if (!state.djId) state.djId = interaction.user.id;

                const isPlaylist = Array.isArray(infoResult);
                const items = isPlaylist ? infoResult : [infoResult];
                
                let firstSongInfo = null;
                for (const info of items) {
                    const durationSec = parseInt(info.duration) || 0;
                    const mins = Math.floor(durationSec / 60);
                    const secs = durationSec % 60;
                    const songObj = {
                        title: info.title,
                        url: info.webpage_url,
                        duration: `${mins}:${String(secs).padStart(2, '0')}`,
                        thumbnail: info.thumbnail || null,
                        requestedBy: interaction.user.tag,
                        requestedById: interaction.user.id
                    };
                    state.queue.push(songObj);
                    if (!firstSongInfo) firstSongInfo = songObj;
                }

                if (state.queue.length === items.length && (!state.player || state.player.state.status === AudioPlayerStatus.Idle)) {
                    await playNext(interaction.guildId, interaction.channel);
                    await interaction.editReply({ content: `🎵 Đang phát: **${firstSongInfo.title}**` });
                } else {
                    if (isPlaylist) {
                        const embed = new EmbedBuilder().setTitle('📋 Đã thêm Playlist vào hàng đợi').setDescription(`Thêm **${items.length}** bài hát vào hàng đợi.`).setColor('#FF6600');
                        await interaction.editReply({ embeds: [embed] });
                    } else {
                        const embed = new EmbedBuilder().setTitle('📋 Đã thêm vào hàng đợi').setDescription(`**[${firstSongInfo.title}](${firstSongInfo.url})**`)
                            .addFields({ name: '⏱ Thời lượng', value: firstSongInfo.duration || 'N/A', inline: true }, { name: '📍 Vị trí', value: `#${state.queue.length}`, inline: true })
                            .setThumbnail(firstSongInfo.thumbnail).setColor('#FF6600');
                        await interaction.editReply({ embeds: [embed] });
                    }
                }
                return; // Ngừng xử lý phần cũ
            }
        } catch (err) {
            console.error('Lỗi play:', err);
            await interaction.editReply(`❌ Lỗi: ${err.message}`);
        }
    }

    // --- SKIP ---
    if (commandName === 'skip') {
        const state = getQueue(interaction.guildId);
        if (!state.player || state.queue.length === 0) {
            return interaction.reply({ content: '❌ Không có bài nào đang phát!', flags: MessageFlags.Ephemeral });
        }
        state.player.stop();
        return interaction.reply('⏭ Đã bỏ qua bài nhạc!');
    }

    // --- STOP ---
    if (commandName === 'stop') {
        const state = getQueue(interaction.guildId);
        if (!state.connection) {
            return interaction.reply({ content: '❌ Bot không ở trong voice channel!', flags: MessageFlags.Ephemeral });
        }
        state.queue.length = 0;
        state.player?.stop();
        state.connection.destroy();
        musicQueues.delete(interaction.guildId);
        return interaction.reply('⏹ Đã dừng nhạc và rời kênh thoại!');
    }

    // --- LEAVE ---
    if (commandName === 'leave') {
        return handleLeave(interaction);
    }

    // --- JOIN ---
    if (commandName === 'join') {
        return handleJoin(interaction);
    }



    // --- GIVEALL ---
    if (commandName === 'addpetvip') {
        const target = interaction.options.getUser('user');
        const petId = interaction.options.getString('petid');
        const amount = interaction.options.getInteger('amount') || 1;
        
        const petInfo = PET_LIST.find(p => p.id === petId);
        if (!petInfo) return interaction.reply({ content: '❌ Pet ID không hợp lệ! (Ví dụ: pikachu, arceus, lugia...)', flags: MessageFlags.Ephemeral });
        
        return awaitConfirmation(interaction, interaction.user.id, `Bạn muốn tặng **${amount}x ${petInfo.emoji} ${petInfo.name}** cho <@${target.id}>?`, async () => {
            const data = loadRPG();
            if (!data[target.id]) getPlayer(target.id);
            if (!data[target.id].pets) data[target.id].pets = {};
            
            data[target.id].pets[petId] = (data[target.id].pets[petId] || 0) + amount;
            saveRPG(data);
            return `✅ Đã tặng **${amount}x ${petInfo.emoji} ${petInfo.name}** cho <@${target.id}>!`;
        });
    }

    if (commandName === 'giveall') {
        const amount = interaction.options.getInteger('amount');
        return handleGiveAll(interaction.user.id, amount, interaction);
    }

    // --- PAUSE ---
    if (commandName === 'pause') {
        const state = getQueue(interaction.guildId);
        if (!state.player) return interaction.reply({ content: '❌ Không có nhạc đang phát!', flags: MessageFlags.Ephemeral });
        state.player.pause();
        return interaction.reply('⏸ Đã tạm dừng nhạc!');
    }

    if (commandName === 'marry') {
        const targetUser = interaction.options.getUser('user');
        return handleMarry(interaction.user.id, targetUser ? targetUser.id : null, interaction);
    }

    if (commandName === 'divorce') {
        return handleDivorce(interaction.user.id, interaction);
    }

    // --- RESUME ---
    if (commandName === 'resume') {
        const state = getQueue(interaction.guildId);
        if (!state.player) return interaction.reply({ content: '❌ Không có nhạc để tiếp tục!', flags: MessageFlags.Ephemeral });
        state.player.unpause();
        return interaction.reply('▶ Đã tiếp tục phát nhạc!');
    }

    // --- QUEUE ---
    if (commandName === 'queue') {
        const state = getQueue(interaction.guildId);
        if (!state.queue.length) {
            return interaction.reply({ content: '📋 Hàng đợi trống!', flags: MessageFlags.Ephemeral });
        }
        const queueList = state.queue.slice(0, 10).map((s, i) =>
            `${i === 0 ? '▶ **[Đang phát]**' : `${i}.`} [${s.title}](${s.url}) • \`${s.duration || 'N/A'}\``
        ).join('\n');
        const embed = new EmbedBuilder()
            .setTitle(`📋 Hàng đợi nhạc (${state.queue.length} bài)`)
            .setDescription(queueList)
            .setColor('#0099ff')
            .setFooter({ text: state.queue.length > 10 ? `... và ${state.queue.length - 10} bài nữa` : '' });
        return interaction.reply({ embeds: [embed] });
    }

    // --- NOW PLAYING ---
    if (commandName === 'nowplaying') {
        const state = getQueue(interaction.guildId);
        if (!state.queue.length) {
            return interaction.reply({ content: '❌ Không có bài nào đang phát!', flags: MessageFlags.Ephemeral });
        }
        const song = state.queue[0];
        const embed = new EmbedBuilder()
            .setTitle('🎵 Đang phát')
            .setDescription(`**[${song.title}](${song.url})**`)
            .addFields(
                { name: '⏱ Thời lượng', value: song.duration || 'N/A', inline: true },
                { name: '👤 Yêu cầu bởi', value: song.requestedBy, inline: true }
            )
            .setThumbnail(song.thumbnail)
            .setColor('#FF0000');
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'admincheat') {
        return handleAdminCheat(interaction.user.id, interaction);
    }

    if (commandName === 'setspawnchannel') {
        const targetChannel = interaction.options.getChannel('channel');
        updateGuildConfig(interaction.guildId, 'spawnChannelId', targetChannel.id);
        return interaction.reply({ content: `✅ Đã thiết lập kênh xuất hiện Pokemon hoang dã tại ${targetChannel}!` });
    }

    if (commandName === 'setj2c') {
        const targetChannel = interaction.options.getChannel('channel');
        updateGuildConfig(interaction.guildId, 'j2cChannelId', targetChannel.id);
        return interaction.reply({ content: `✅ Đã thiết lập kênh gốc Join to Create tại ${targetChannel}!` });
    }

    if (commandName === 'antinuke') {
        if (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
        const config = getGuildConfig(interaction.guildId);
        const isEnabled = config.antiNukeEnabled !== false;
        
        const embed = new EmbedBuilder()
            .setTitle('🛡️ HỆ THỐNG ANTI-NUKE')
            .setDescription(`**Trạng thái hiện tại:** ${isEnabled ? '🟢 ĐANG BẬT' : '🔴 ĐANG TẮT'}\n\nKhi bật, nếu có Quản trị viên nào xoá kênh, xoá role, ban hoặc kick thành viên **3 lần trong 10 giây**, hệ thống sẽ tự động tước toàn bộ role của họ để ngăn chặn phá hoại.`)
            .setColor(isEnabled ? '#00FF00' : '#FF0000');
            
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('toggle_antinuke').setLabel(isEnabled ? 'Tắt Anti-Nuke' : 'Bật Anti-Nuke').setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
        );
        
        return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'antiraid') {
        if (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
        const config = getGuildConfig(interaction.guildId);
        const isEnabled = config.antiRaidEnabled !== false;
        
        const embed = new EmbedBuilder()
            .setTitle('🛡️ HỆ THỐNG ANTI-RAID & ANTI-SPAM')
            .setDescription(`**Trạng thái hiện tại:** ${isEnabled ? '🟢 ĐANG BẬT' : '🔴 ĐANG TẮT'}\n\nKhi bật:\n- Nếu có **10 người join trong 10 giây**, hệ thống sẽ **Kick** ngay lập tức những người mới.\n- Nếu có ai chat **10 tin nhắn trong 5 giây** hoặc **5 tin nhắn giống hệt nhau**, họ sẽ bị Mute 1 tiếng.`)
            .setColor(isEnabled ? '#00FF00' : '#FF0000');
            
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('toggle_antiraid').setLabel(isEnabled ? 'Tắt Anti-Raid' : 'Bật Anti-Raid').setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
        );
        
        return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'setjail') {
        if (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
        
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        const role = interaction.options.getRole('role');
        const channel = interaction.options.getChannel('channel');
        updateGuildConfig(interaction.guildId, 'jailRoleId', role.id);
        updateGuildConfig(interaction.guildId, 'jailChannelId', channel.id);
        
        const embed = new EmbedBuilder()
            .setTitle('⛓️ ĐÃ CÀI ĐẶT HỆ THỐNG TÙ / CẢI TẠO')
            .setDescription(`✅ Đã cập nhật cấu hình!\n\n- **Role Tù nhân:** ${role}\n- **Kênh Cải tạo:** ${channel}\n\n⏳ Đang tự động khoá toàn bộ kênh khác trong Server để giam giữ tù nhân...`)
            .setColor('#E74C3C');
            
        await interaction.editReply({ embeds: [embed] });
        
        let successCount = 0;
        let failCount = 0;
        
        try {
            const channels = await interaction.guild.channels.fetch();
            for (const [id, ch] of channels) {
                if (!ch) continue;
                try {
                    if (id === channel.id) {
                        await ch.permissionOverwrites.edit(role.id, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true,
                            Connect: false
                        });
                    } else {
                        await ch.permissionOverwrites.edit(role.id, {
                            ViewChannel: false,
                            Connect: false,
                            SendMessages: false
                        });
                    }
                    successCount++;
                } catch (err) {
                    failCount++;
                }
            }
        } catch (e) {
            console.error('Lỗi khi set quyền jail:', e);
        }
        
        const doneEmbed = new EmbedBuilder()
            .setTitle('⛓️ HOÀN TẤT SETUP NHÀ TÙ')
            .setDescription(`✅ Đã thiết lập xong quyền hạn cho Role ${role}!\n\n- **Đã khóa thành công:** ${successCount} kênh.\n- **Lỗi bỏ qua:** ${failCount} kênh.\n\n🔒 Tù nhân bây giờ sẽ **chỉ nhìn thấy duy nhất** kênh ${channel} và bị cấm tuyệt đối khỏi Voice Chat!`)
            .setColor('#2ECC71');
            
        return interaction.editReply({ embeds: [doneEmbed] });
    }

    if (commandName === 'set1ar') {
        if (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({ content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
        
        const role = interaction.options.getRole('role');
        const allowedRole = interaction.options.getRole('allowed_role');
        
        updateGuildConfig(interaction.guildId, 'arRoleId', role.id);
        if (allowedRole) {
            updateGuildConfig(interaction.guildId, 'arAllowedRoleId', allowedRole.id);
        } else {
            updateGuildConfig(interaction.guildId, 'arAllowedRoleId', null);
        }
        
        const config = getGuildConfig(interaction.guildId);
        const commandText = config.arCommandText || '1ar';
        
        const allowedRoleText = allowedRole ? allowedRole.toString() : 'Chỉ Admin/Manage Roles';
        
        const embed = new EmbedBuilder()
            .setTitle('⚙️ BẢNG ĐIỀU KHIỂN LỆNH CẤP ROLE (1AR)')
            .setDescription(`✅ Đã thiết lập Role được cấp là: ${role}\n\n**Bản xem trước dữ liệu:**\n- **Cú pháp lệnh:** \`${commandText} @user\`\n- **Role được cấp:** ${role}\n- **Role được phép dùng lệnh:** ${allowedRoleText}\n\n👇 **Nhấn nút bên dưới nếu bạn muốn đổi chữ \`${commandText}\` thành chữ khác (ví dụ: \`vip\`, \`role\`...)**`)
            .setColor('#9B59B6');
            
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('set1ar_edit_command').setLabel('Sửa Cú pháp Lệnh').setStyle(ButtonStyle.Primary)
        );
        
        return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'setpinggame') {
        if (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return interaction.reply({ content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
        
        const channel = interaction.options.getChannel('channel');
        updateGuildConfig(interaction.guildId, 'pingGameChannelId', channel.id);
        
        const config = getGuildConfig(interaction.guildId);
        const defaultContent = `Đây là kênh để ping game trong server\nCách ping là @mention game muốn chơi lên ví dụ như là \`@TFT\` ....\nCảm ơn đã đọc ạ`;
        const msg = config.pingGameMessage || defaultContent;

        const embed = new EmbedBuilder()
            .setTitle('⚙️ BẢNG ĐIỀU KHIỂN PING GAME')
            .setDescription(`✅ Đã thiết lập kênh auto-message tại: ${channel}\n\n**Bản xem trước dữ liệu:**\n- **Nội dung:** ${msg.substring(0, 100)}...\n\n👇 **Sử dụng các nút bên dưới để tuỳ chỉnh nội dung.**`)
            .setColor('#3498DB');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('pinggame_edit_basic').setLabel('Sửa Nội dung hướng dẫn').setStyle(ButtonStyle.Primary)
        );

        return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'setupadvlogs') {
        if (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return interaction.reply({ content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
        
        await interaction.reply({ content: '⏳ Đang dọn dẹp log cũ & Khởi tạo hệ thống Log Nâng Cao (5 kênh Gọn Gàng)... Vui lòng đợi!', flags: MessageFlags.Ephemeral });
        try {
            const guild = interaction.guild;
            
            // CLEANUP OLD LOGS
            const config = getGuildConfig(guild.id);
            if (config.advLogs) {
                let deletedCount = 0;
                for (const key in config.advLogs) {
                    const oldChannelId = config.advLogs[key];
                    const oldChannel = guild.channels.cache.get(oldChannelId);
                    if (oldChannel) {
                        try {
                            // If it's in a category, we might also want to delete the category, but it's safer to just delete the channel
                            await oldChannel.delete();
                            deletedCount++;
                        } catch(e) {}
                    }
                }
            }
            const category = await guild.channels.create({
                name: '📂 SERVER LOGS',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: guild.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });
            const logChannels = [
                { name: '📩・message-log', key: 'message-log' },
                { name: '👥・member-log', key: 'member-log' },
                { name: '🛡️・mod-log', key: 'mod-log' },
                { name: '⚙️・server-log', key: 'server-log' },
                { name: '🤖・bot-log', key: 'bot-log' }
            ];
            const logConfig = {};
            for (const channelData of logChannels) {
                const ch = await guild.channels.create({
                    name: channelData.name,
                    type: ChannelType.GuildText,
                    parent: category.id
                });
                logConfig[channelData.key] = ch.id;
            }
            updateGuildConfig(guild.id, 'advLogs', logConfig);
            return interaction.editReply({ content: `✅ Đã đại tu thành công danh mục **SERVER LOGS** với 5 kênh chuẩn xác và hiện đại!` });
        } catch (error) {
            console.error(error);
            return interaction.editReply({ content: '❌ Có lỗi xảy ra khi tạo kênh. Vui lòng kiểm tra quyền của Bot!' });
        }
    }

    if (commandName === 'setwelcome') {
        if (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return interaction.reply({ content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
        
        const channel = interaction.options.getChannel('channel');
        updateGuildConfig(interaction.guildId, 'welcomeChannelId', channel.id);
        
        const config = getGuildConfig(interaction.guildId);
        const title = config.welcomeTitle || '🎉 Welcome {user} 🎉';
        const msg = config.welcomeMessage || 'Chào mừng bạn đến với {server}!';
        const roles = config.welcomePingRoles || 'Mặc định';

        const embed = new EmbedBuilder()
            .setTitle('⚙️ BẢNG ĐIỀU KHIỂN CHÀO MỪNG')
            .setDescription(`✅ Đã thiết lập kênh chào mừng tại: ${channel}\n\n**Bản xem trước dữ liệu:**\n- **Tiêu đề:** ${title}\n- **Nội dung:** ${msg.substring(0, 100)}...\n- **Role Ping:** ${roles}\n\n👇 **Sử dụng các nút bên dưới để tuỳ chỉnh nội dung.**`)
            .setColor('#2b2d31');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('welcome_edit_basic').setLabel('Sửa Tiêu đề & Nội dung').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('welcome_edit_roles').setLabel('Sửa Role Ping').setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'disablewelcome') {
        if (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return interaction.reply({ content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
        
        updateGuildConfig(interaction.guildId, 'welcomeChannelId', 'disabled');
        
        return interaction.reply({ content: `✅ Đã **TẮT** tính năng chào mừng thành viên mới! (Gõ lại /setwelcome để bật lại)`, flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'testwelcome') {
        if (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return interaction.reply({ content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });
        
        client.emit('guildMemberAdd', interaction.member);
        return interaction.reply({ content: '✅ Đã giả lập gửi tin nhắn chào mừng (Kiểm tra tại kênh welcome của bạn)!', flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'setuppokemonrole') {
        if (interaction.user.id !== ADMIN_ID) 
            return interaction.reply({ content: '❌ Lệnh này chỉ dành riêng cho Chủ Bot!', flags: MessageFlags.Ephemeral });
        
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'pokemon');
        if (!role) {
            try {
                role = await interaction.guild.roles.create({
                    name: 'Pokemon',
                    color: '#FF0000',
                    mentionable: true,
                    reason: 'Role cho tính năng thông báo Pokemon'
                });
            } catch (err) {
                return interaction.reply({ content: '❌ Bot không có đủ quyền để tạo role. Vui lòng cấp quyền `Manage Roles` cho bot.', flags: MessageFlags.Ephemeral });
            }
        }
        
        updateGuildConfig(interaction.guildId, 'pokemonRoleId', role.id);
        
        const config = getGuildConfig(interaction.guildId);
        const title = config.pokemonRoleTitle || '🔔 Đăng Ký Nhận Thông Báo Pokemon';
        const msg = config.pokemonRoleMessage || 'Bấm vào nút bên dưới để nhận (hoặc hủy) role **Pokemon**.\nBạn sẽ được thông báo ngay lập tức mỗi khi có Pokemon Huyền Thoại xuất hiện!';
        
        const embed = new EmbedBuilder()
            .setTitle('⚙️ BẢNG ĐIỀU KHIỂN POKEMON')
            .setDescription(`✅ Đã tạo role thành công!\n\n**Bản xem trước dữ liệu:**\n- **Tiêu đề:** ${title}\n- **Nội dung:** ${msg.substring(0, 100)}...\n\n👇 **Sử dụng các nút bên dưới để tuỳ chỉnh, sau đó bấm Gửi!**`)
            .setColor('#FF0000');
            
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('pokemon_edit_basic').setLabel('Sửa Tiêu đề & Nội dung').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('pokemon_send').setLabel('✅ Gửi bảng đăng ký').setStyle(ButtonStyle.Success)
        );
        
        return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    }

    if (commandName === 'senddm') {
        if (interaction.user.id !== ADMIN_ID) 
            return interaction.reply({ content: '❌ Lệnh này chỉ dành riêng cho Chủ Bot!', flags: MessageFlags.Ephemeral });
        
        const targetUser = interaction.options.getUser('user');
        const messageStr = interaction.options.getString('message');
        
        try {
            await targetUser.send({ content: messageStr });
            return interaction.reply({ content: `✅ Đã gửi tin nhắn đến **${targetUser.tag}** thành công!\n**Nội dung:** ${messageStr}`, flags: MessageFlags.Ephemeral });
        } catch (err) {
            return interaction.reply({ content: `❌ Không thể gửi tin nhắn đến **${targetUser.tag}**. Người này có thể đã tắt DM hoặc chặn Bot.`, flags: MessageFlags.Ephemeral });
        }
    }

    if (commandName === 'setuprpgrole') {
        if (interaction.user.id !== ADMIN_ID) 
            return interaction.reply({ content: '❌ Lệnh này chỉ dành riêng cho Chủ Bot!', flags: MessageFlags.Ephemeral });
        
        let role = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'rpg player');
        if (!role) {
            try {
                role = await interaction.guild.roles.create({
                    name: 'RPG Player',
                    color: '#FFA500',
                    mentionable: true,
                    reason: 'Role cho tính năng thông báo RPG (Raid Boss)'
                });
            } catch (err) {
                return interaction.reply({ content: '❌ Bot không có đủ quyền để tạo role. Vui lòng cấp quyền `Manage Roles` cho bot.', flags: MessageFlags.Ephemeral });
            }
        }
        
        updateGuildConfig(interaction.guildId, 'rpgRoleId', role.id);
        
        const config = getGuildConfig(interaction.guildId);
        const title = config.rpgRoleTitle || '⚔️ Đăng Ký Nhận Thông Báo RPG';
        const msg = config.rpgRoleMessage || 'Bấm vào nút bên dưới để nhận (hoặc hủy) role **RPG Player**.\nBạn sẽ được tag mỗi khi Raid Boss xuất hiện để không bỏ lỡ phần thưởng!';
        
        const embed = new EmbedBuilder()
            .setTitle('⚙️ BẢNG ĐIỀU KHIỂN RPG')
            .setDescription(`✅ Đã tạo role thành công!\n\n**Bản xem trước dữ liệu:**\n- **Tiêu đề:** ${title}\n- **Nội dung:** ${msg.substring(0, 100)}...\n\n👇 **Sử dụng các nút bên dưới để tuỳ chỉnh, sau đó bấm Gửi!**`)
            .setColor('#FFA500');
            
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rpg_edit_basic').setLabel('Sửa Tiêu đề & Nội dung').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('rpg_send').setLabel('✅ Gửi bảng đăng ký').setStyle(ButtonStyle.Success)
        );
        
        return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    }

    // --- QR ---
    if (commandName === 'qr') {
        if (interaction.user.id !== ADMIN_ID && (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))) return interaction.reply({ content: '❌ Lệnh này chỉ dành cho Admin!', flags: MessageFlags.Ephemeral });
        const amount = interaction.options.getInteger('amount');
        const baseInfo = interaction.options.getString('content') || '';
        const safeBaseInfo = baseInfo.replace(/[^a-zA-Z0-9 ]/g, '');
        let addInfo = safeBaseInfo ? `${safeBaseInfo} MH${Math.floor(10000 + Math.random() * 90000)}` : `MH${Math.floor(10000 + Math.random() * 90000)}`;
        if (amount <= 0) return interaction.reply({ content: '❌ Số tiền phải lớn hơn 0.', flags: MessageFlags.Ephemeral });
        const bankId = process.env.BANK_ID, accountNo = process.env.ACCOUNT_NO, accountName = process.env.ACCOUNT_NAME;
        if (!bankId || !accountNo || bankId === 'YOUR_BANK_ID_HERE') return interaction.reply({ content: '❌ Chưa cấu hình ngân hàng trong `.env`.', flags: MessageFlags.Ephemeral });
        let qrUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(addInfo)}`;
        if (accountName && accountName !== 'YOUR_ACCOUNT_NAME_HERE') qrUrl += `&accountName=${encodeURIComponent(accountName)}`;
        const embed = new EmbedBuilder()
            .setTitle('Mã QR Thanh Toán')
            .setDescription(`- **Số tiền:** ${parseInt(amount).toLocaleString('vi-VN')} VNĐ\n- **Nội dung:** ${addInfo}`)
            .setImage(qrUrl).setColor('#00FF00').setFooter({ text: 'Powered by VietQR' });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`confirm_payment_${addInfo}`).setLabel('✅ Xác nhận đã thanh toán').setStyle(ButtonStyle.Success)
        );
        await interaction.reply({ embeds: [embed], components: [row] });
    }

    // --- GIVEAWAY ---
    if (commandName === 'gstart') {
        const duration = interaction.options.getString('duration');
        const winnerCount = interaction.options.getInteger('winners');
        const prize = interaction.options.getString('prize');
        await interaction.reply({ content: '🎉 Đang tạo giveaway...', flags: MessageFlags.Ephemeral });
        client.giveawaysManager.start(interaction.channel, {
            duration: ms(duration), winnerCount, prize,
            thumbnail: 'https://cdn.discordapp.com/attachments/1491631607596187688/1528457728144576602/ChatGPT_Image_20_18_37_12_thg_7_2026.png?ex=6a5e5eaf&is=6a5d0d2f&hm=f383da5bf037b4c327d84f99d6c2a9b9b8d4d962eaeb42be4b2ef2268c3b6cc4&',
            image: 'https://cdn.discordapp.com/attachments/1491631607596187688/1528456772174483566/00_34_53_20_thg_7_2026.png?ex=6a5e5dcb&is=6a5d0c4b&hm=9417936767e35ff7ffaa4b9669536f455eb9b15f30407840f383eac061a7b760&',
            hostedBy: interaction.user,
            messages: giveawayMessages()
        });
    }

    if (commandName === 'gend') {
        const messageId = interaction.options.getString('message_id');
        client.giveawaysManager.end(messageId)
            .then(() => interaction.reply({ content: '✅ Đã kết thúc!' }))
            .catch(() => interaction.reply({ content: '❌ Không tìm thấy.', flags: MessageFlags.Ephemeral }));
    }

    if (commandName === 'greroll') {
        const messageId = interaction.options.getString('message_id');
        client.giveawaysManager.reroll(messageId)
            .then(() => interaction.reply({ content: '✅ Đã chọn lại người thắng!' }))
            .catch(() => interaction.reply({ content: '❌ Không tìm thấy.', flags: MessageFlags.Ephemeral }));
    }

    // ========================
    // COIN SYSTEM HANDLERS
    // ========================

    // --- DAILY ---
    if (commandName === 'daily') {
        const result = claimDaily(interaction.user.id);
        if (!result.success) {
            const h = Math.floor(result.remaining / 3600000);
            const m = Math.floor((result.remaining % 3600000) / 60000);
            return interaction.reply({
                embeds: [new EmbedBuilder().setTitle('⏰ Chưa đến giờ nhận').setDescription(`Bạn cần chờ thêm **${h} giờ ${m} phút** nữa!`).setColor('#FFA500')], flags: MessageFlags.Ephemeral
            });
        }
        const desc = `Bạn nhận được **+${result.reward} 🪙**! (Cơ bản: ${result.baseReward}, Thưởng chuỗi: ${result.bonus})\n🔥 **Chuỗi điểm danh:** ${result.streak} ngày\n→ Số dư hiện tại: **${result.total.toLocaleString()} 🪙**`;
        return interaction.reply({
            embeds: [new EmbedBuilder().setTitle('💰 Nhận coin hằng ngày!').setDescription(desc).setColor('#FFD700').setFooter({ text: 'Quay lại sau 24 giờ để duy trì chuỗi!' })]
        });
    }

    // --- BALANCE ---
    if (commandName === 'balance') {
        const target = interaction.options.getUser('user') || interaction.user;
        const coins = getUserCoins(target.id);
        return interaction.reply({
            embeds: [new EmbedBuilder().setTitle(`💵 Số dư của ${target.username}`).setDescription(`**${coins.toLocaleString()} 🪙**`).setColor('#FFD700').setThumbnail(target.displayAvatarURL())]
        });
    }

    if (commandName === 'setbday') {
        const bdayInput = interaction.options.getString('date');
        return handleSetBday(interaction.user.id, interaction, bdayInput);
    }

    if (commandName === 'profile') {
        const target = interaction.options.getUser('user') || interaction.user;
        const profileData = await buildProfileEmbed(target);
        const options = { embeds: [profileData.embed] };
        if (profileData.attachment) options.files = [profileData.attachment];
        return interaction.reply(options);
    }

    // --- GIVE ---
    if (commandName === 'give') {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        if (target.id === interaction.user.id) return interaction.reply({ content: '❌ Không thể tặng coin cho chính mình!', flags: MessageFlags.Ephemeral });
        if (target.bot) return interaction.reply({ content: '❌ Không thể tặng coin cho bot!', flags: MessageFlags.Ephemeral });
        const senderCoins = getUserCoins(interaction.user.id);
        if (senderCoins < amount) return interaction.reply({ content: `❌ Bạn chỉ có **${senderCoins.toLocaleString()} 🪙**, không đủ!`, flags: MessageFlags.Ephemeral });
        addCoins(interaction.user.id, -amount);
        addCoins(target.id, amount);
        return interaction.reply({
            embeds: [new EmbedBuilder().setTitle('🎁 Tặng coin!').setDescription(`<@${interaction.user.id}> đã tặng **${amount.toLocaleString()} 🪙** cho <@${target.id}>!`).setColor('#00FF88')]
        });
    }

    // --- LEADERBOARD & TOP ---
    if (commandName === 'leaderboard' || commandName === 'top') {
        const embed = buildLeaderboardEmbed(interaction.client);
        return interaction.reply({ embeds: [embed] });
    }

    // --- BANK ---
    if (commandName === 'bank') {
        const target = interaction.options.getUser('user') || interaction.user;
        if (target.id === interaction.user.id) {
            const embed = buildBankEmbed(interaction.user);
            const buttons = buildBankButtons(interaction.user.id);
            return interaction.reply({ embeds: [embed], components: buttons });
        } else {
            const cash = getUserCoins(target.id);
            const bank = getUserBank(target.id);
            const total = cash + bank;
            const embed = new EmbedBuilder()
                .setTitle(`🏦 Thông tin ngân hàng của ${target.username}`)
                .setDescription(`Đây là số dư ngân hàng của người dùng được kiểm tra.`)
                .addFields(
                    { name: '💵 Tiền mặt', value: `**${cash.toLocaleString()}** 🪙`, inline: true },
                    { name: '💳 Ngân hàng', value: `**${bank.toLocaleString()}** 🪙`, inline: true },
                    { name: '💰 Tổng tài sản', value: `**${total.toLocaleString()}** 🪙`, inline: false }
                )
                .setColor('#00ffcc')
                .setThumbnail(target.displayAvatarURL())
                .setTimestamp();
            return interaction.reply({ embeds: [embed] });
        }
    }

    // --- BLACKJACK ---
    if (commandName === 'blackjack') {
        const uid = interaction.user.id;
        const betInput = interaction.options.getString('bet')?.toLowerCase();
        let bet = parseInt(betInput);
        if (betInput === 'all') {
            bet = Math.min(getUserCoins(uid), 500000);
            if (bet < 10) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`, flags: MessageFlags.Ephemeral });
        } else if (isNaN(bet) || bet < 10) {
            return interaction.reply({ content: `❌ Cú pháp: số_coin (tối thiểu 10) hoặc "all"`, flags: MessageFlags.Ephemeral });
        }
        
        if (blackjackGames.has(uid)) return interaction.reply({ content: '❌ Bạn đang có game Blackjack chưa xong! Hãy kết thúc trước.', flags: MessageFlags.Ephemeral });
        if (bet > 500000) return interaction.reply({ content: '❌ Mức cược tối đa là **500,000 🪙**!', flags: MessageFlags.Ephemeral });
        if (getUserCoins(uid) < bet) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`, flags: MessageFlags.Ephemeral });
        addCoins(uid, -bet);
        const deck = createDeck();
        const game = { uid, bet, deck, p: [deck.pop(), deck.pop()], d: [deck.pop(), deck.pop()] };
        blackjackGames.set(uid, game);

        const pv = handVal(game.p);
        // Blackjack ngay!
        if (pv === 21) {
            dealerPlay(game);
            const dv = handVal(game.d);
            const win = dv === 21 ? game.bet : Math.floor(game.bet * 2.5);
            addCoins(uid, win);
            const result = dv === 21 ? '🤝 Cả hai Blackjack! Hòa.' : `🎉 BLACKJACK! +${(win - game.bet).toLocaleString()} 🪙`;
            blackjackGames.delete(uid);
            return interaction.reply({ embeds: [bjEmbed(game, result, '#FFD700', true)] });
        }
        return interaction.reply({
            embeds: [bjEmbed(game, '🃏 Game đang diễn ra...', '#0099ff')],
            components: [bjButtons(getUserCoins(uid) >= bet)]
        });
    }

    if (commandName === 'setlodechannel') {
        const targetChannel = interaction.options.getChannel('channel');
        updateGuildConfig(interaction.guildId, 'lodeChannelId', targetChannel.id);
        return interaction.reply({ content: `✅ Đã thiết lập kênh xổ số lô đề 18h30 tại <#${targetChannel.id}>`, flags: MessageFlags.Ephemeral });
    }

    // --- LÔ ĐỀ ---
    if (commandName === 'lode') {
        const uid = interaction.user.id;
        const soInput = interaction.options.getString('so');
        const betInput = interaction.options.getString('bet')?.toLowerCase();
        
        let so = parseInt(soInput);
        if (isNaN(so) || so < 0 || so > 99) return interaction.reply({ content: `❌ Bạn phải chọn một số từ **00** đến **99**!`, flags: MessageFlags.Ephemeral });
        
        let bet = parseInt(betInput);
        if (betInput === 'all') {
            bet = Math.min(getUserCoins(uid), 500000);
            if (bet < 10) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`, flags: MessageFlags.Ephemeral });
        } else if (isNaN(bet) || bet < 10) {
            return interaction.reply({ content: `❌ Cú pháp cược: số_coin (tối thiểu 10) hoặc "all"`, flags: MessageFlags.Ephemeral });
        }
        
        if (bet > 500000) return interaction.reply({ content: '❌ Mức cược tối đa là **500,000 🪙**!', flags: MessageFlags.Ephemeral });
        if (getUserCoins(uid) < bet) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`, flags: MessageFlags.Ephemeral });
        
        addCoins(uid, -bet);
        
        const lodeData = loadLode();
        lodeData.bets.push({ userId: uid, so: so, bet: bet });
        saveLode(lodeData);
        
        return interaction.reply(`✅ Bạn đã ghi lô số **${so.toString().padStart(2, '0')}** với số tiền **${bet.toLocaleString()} 🪙**. Chờ kết quả xổ số lúc 18h30 hàng ngày nhé!`);
    }

    // --- TAI XIU ---
    if (commandName === 'taixiu') {
        const uid = interaction.user.id;
        const betInput = interaction.options.getString('bet')?.toLowerCase();
        let bet = parseInt(betInput);
        if (betInput === 'all') {
            bet = Math.min(getUserCoins(uid), 500000);
            if (bet < 10) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`, flags: MessageFlags.Ephemeral });
        } else if (isNaN(bet) || bet < 10) {
            return interaction.reply({ content: `❌ Cú pháp: số_coin (tối thiểu 10) hoặc "all"`, flags: MessageFlags.Ephemeral });
        }
        
        if (bet > 500000) return interaction.reply({ content: '❌ Mức cược tối đa là **500,000 🪙**!', flags: MessageFlags.Ephemeral });
        if (getUserCoins(uid) < bet) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`, flags: MessageFlags.Ephemeral });
        
        if (txCooldowns.has(uid)) {
            const remaining = txCooldowns.get(uid) - Date.now();
            if (remaining > 0) return interaction.reply({ content: `⏳ Vui lòng đợi **${Math.ceil(remaining/1000)}s** nữa trước khi cược Tài Xỉu tiếp!`, flags: MessageFlags.Ephemeral });
        }
        txCooldowns.set(uid, Date.now() + TX_COOLDOWN_MS);

        await interaction.reply({ 
            embeds: [new EmbedBuilder().setTitle('🎲 Bàn Tài Xỉu').setDescription(`Bạn đã cược **${bet.toLocaleString()} 🪙**.\nHãy chọn một cửa bên dưới để tung xúc xắc!`).setColor('#9B59B6')],
            components: txButtons()
        });
        const msg = await interaction.fetchReply();
        taixiuGames.set(msg.id, { uid, bet });
        return;
    }
    // --- BẦU CUA ---
    // --- BẦU CUA ---
    if (commandName === 'baucua') {
        return startBaucuaMultiplayer(interaction, interaction.channelId, client);
    }

    // --- WORK ---
    if (commandName === 'work') {
        return handleWorkCommand(interaction.user.id, interaction);
    }

    // --- PET COMMANDS ---
    if (commandName === 'catchpet') {
        return handleCatchPet(interaction.user.id, interaction);
    }
    if (commandName === 'pets') {
        return handlePets(interaction.user.id, interaction);
    }
    if (commandName === 'sellpet') {
        return handleSellPet(interaction.user.id, interaction);
    }
    if (commandName === 'ptrade') {
        const targetUser = interaction.options.getUser('user');
        if (targetUser.bot) return interaction.reply({ content: '❌ Không thể giao dịch với Bot!', flags: MessageFlags.Ephemeral });
        return handlePetTrade(interaction.user.id, targetUser.id, interaction);
    }
    if (commandName === 'petbattle') {
        const targetUser = interaction.options.getUser('user');
        const bet = interaction.options.getInteger('bet');
        if (targetUser.bot) return interaction.reply({ content: '❌ Không thể solo với Bot!', flags: MessageFlags.Ephemeral });
        return handlePetBattle(interaction.user.id, targetUser.id, bet, interaction);
    }

    // --- RPG COMMANDS ---


    if (commandName === 'hunt') {
        const uid = interaction.user.id;
        const p = getPlayer(uid);
        if (p.hp <= 0) return interaction.reply({ content: '❌ Bạn đã hết máu, hãy dùng `/heal` để hồi sinh lực!', flags: MessageFlags.Ephemeral });
        const now = Date.now();
        if (now - p.lastHunt < 60000) return interaction.reply({ content: `⏳ Đang mệt, nghỉ ngơi **${Math.ceil((60000-(now-p.lastHunt))/1000)}s** nữa!`, flags: MessageFlags.Ephemeral });
        
        const maxLevel = Math.min(Math.max(1, p.level), MONSTERS.length);
        const m = MONSTERS[Math.floor(Math.random() * maxLevel)];
        const stats = getPlayerStats(p);
        let mHp = m.hp, pHp = p.hp, rounds = 0;
        let pDmg = Math.max(1, stats.atk - m.def);
        let mDmg = Math.max(1, m.atk - stats.def);
        
        while(mHp > 0 && pHp > 0 && rounds < 20) { mHp -= pDmg; if (mHp <= 0) break; pHp -= mDmg; rounds++; }
        
        if (pHp <= 0) {
            updatePlayer(uid, dp => { dp.hp = 0; dp.lastHunt = now; dp.exp = Math.max(0, dp.exp - Math.floor(m.exp/2)); });
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle('☠️ Tử trận').setDescription(`Bạn bị **${m.name}** ${m.emoji} đánh bại!\nMất một ít EXP. Hãy dùng \`/heal\`.`).setColor('#FF0000')] });
        }
        
        updatePlayer(uid, dp => { dp.hp = pHp; dp.lastHunt = now; dp.exp += m.exp; });
        // Class coin bonus
        let coinGain = m.coin;
        const pClass = p.rpgClass && RPG_CLASSES[p.rpgClass] ? RPG_CLASSES[p.rpgClass] : null;
        if (pClass && pClass.coinBonus) coinGain = Math.floor(coinGain * (1 + pClass.coinBonus));
        addCoins(uid, coinGain);
        // Chest drop chance from hunt (small)
        let huntChestMsg = '';
        if (Math.random() < 0.02) { // 2% chance
            updatePlayer(uid, dp => { dp.chests.wood = (dp.chests.wood || 0) + 1; });
            huntChestMsg += '\n🎁 Drop: **📦 Rương Gỗ**! Dùng `/openbox` để mở.';
        }
        // XP Potion drop
        if (Math.random() < 0.15) {
            updatePlayer(uid, dp => {
                if (!dp.inventory) dp.inventory = {};
                dp.inventory['xp_potion'] = (dp.inventory['xp_potion'] || 0) + 1;
            });
            huntChestMsg += '\n🔮 Drop: **1x Bình EXP**! Dùng trong kho đồ (`/inv`) để nhận EXP.';
        }
        // Quest tracking
        trackQuestProgress(uid, 'hunt', 1);
        trackQuestProgress(uid, 'earn_coin', coinGain);
        const nP = getPlayer(uid);
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`⚔️ Chiến thắng **${m.name}** ${m.emoji}`).setDescription(`Còn lại **❤️ ${pHp}/${p.maxHp} HP**.\nNhận: **+${m.exp} EXP** và **+${coinGain} 🪙**${pClass && pClass.coinBonus ? ` (bonus ${pClass.emoji})` : ''}\nCấp độ: **Lv. ${nP.level}**${huntChestMsg}`).setColor('#00FF00')] });
    }

    if (commandName === 'shop') {
        return handleShop(interaction.user.id, interaction);
    }

    if (commandName === 'inv') {
        const p = getPlayer(interaction.user.id);
        const pots = [];
        for (const [k, v] of Object.entries(p.inventory)) {
            if (v > 0) {
                let item = RPG_ITEMS.pokeballs?.[k] || RPG_ITEMS.materials?.[k] || RPG_ITEMS.seeds?.[k] || RPG_ITEMS.crops?.[k] || RPG_ITEMS.tools?.[k];
                if (item) pots.push(`${item.emoji || ''} **${item.name}**: ${v}`);
                else pots.push(`❓ **${k}**: ${v}`);
            }
        }
        let invStr = pots.length ? pots.join('\n') : 'Trống trơn.\nHãy mua đồ ở `/shop` nhé!';
        if (invStr.length > 4096) invStr = invStr.substring(0, 4080) + '...';
        const embed = new EmbedBuilder().setTitle('🎒 Túi Đồ').setColor('#F1C40F').setDescription(invStr);
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'heal') {
        const uid = interaction.user.id;
        const p = getPlayer(uid);
        if (p.hp >= p.maxHp) return interaction.reply({ content: '✅ Máu của bạn đã đầy!', flags: MessageFlags.Ephemeral });
        trackQuestProgress(uid, 'heal', 1);
        
        let healed = false;
        if (p.inventory.large_potion > 0) {
            updatePlayer(uid, dp => { dp.hp = Math.min(dp.maxHp, dp.hp + RPG_ITEMS.potions.large_potion.heal); dp.inventory.large_potion--; });
            healed = true;
        } else if (p.inventory.small_potion > 0) {
            updatePlayer(uid, dp => { dp.hp = Math.min(dp.maxHp, dp.hp + RPG_ITEMS.potions.small_potion.heal); dp.inventory.small_potion--; });
            healed = true;
        }
        
        if (healed) {
            const np = getPlayer(uid);
            return interaction.reply(`💊 Đã dùng bình máu! Sinh lực: **❤️ ${np.hp}/${np.maxHp}**`);
        }
        
        const healCost = 10000;
        if (getUserCoins(uid) < healCost) return interaction.reply({ content: `❌ Không đủ **${healCost} 🪙** để bơm máu!`, flags: MessageFlags.Ephemeral });
        addCoins(uid, -healCost);
        updatePlayer(uid, dp => { dp.hp = dp.maxHp; });
        return interaction.reply(`🏥 Trả **${healCost} 🪙** bơm đầy máu! **❤️ ${p.maxHp}/${p.maxHp}**`);
    }

    // ========================
    // RPG EXPANSION COMMANDS
    // ========================
    if (commandName === 'dungeon') {
        return handleDungeon(interaction.user.id, interaction);
    }
    if (commandName === 'hack') {
        const targetUser = interaction.options.getUser('user');
        return handleHackCommand(interaction.user.id, targetUser ? targetUser.id : null, interaction);
    }
    if (commandName === 'dautu') {
        const amountStr = interaction.options.getString('amount');
        const uid = interaction.user.id;
        
        if (dautuCooldowns.has(uid)) {
            const remaining = dautuCooldowns.get(uid) - Date.now();
            if (remaining > 0) return interaction.reply({ content: `⏳ Đang chờ phân tích thị trường... Vui lòng đợi **${Math.ceil(remaining/1000)}s** nữa trước khi đầu tư tiếp!`, ephemeral: true });
        }
        
        const coins = getUserCoins(uid);
        let amount = 0;

        if (amountStr.toLowerCase() === 'all') amount = coins;
        else amount = parseInt(amountStr);

        if (isNaN(amount) || amount <= 0) return interaction.reply({ content: '❌ Số tiền đầu tư không hợp lệ!', ephemeral: true });
        if (coins < amount) return interaction.reply({ content: `❌ Bạn không đủ tiền! (Hiện có: **${coins.toLocaleString()} 🪙**)`, ephemeral: true });

        dautuCooldowns.set(uid, Date.now() + DAUTU_COOLDOWN_MS);

        const roll = Math.random();
        let isWin = roll < 0.40;
        let multiplier = 0;

        if (isWin) {
            multiplier = Math.random() * (0.8 - 0.1) + 0.1;
        } else {
            multiplier = -(Math.random() * (0.5 - 0.1) + 0.1);
        }

        const profit = Math.floor(amount * multiplier);
        addCoins(uid, profit);

        const embed = new EmbedBuilder()
            .setTitle('📈 KẾT QUẢ ĐẦU TƯ')
            .setDescription(`Bạn đã đầu tư **${amount.toLocaleString()} 🪙** vào thị trường chứng khoán.`)
            .addFields(
                { name: 'Thị trường', value: isWin ? 'Tăng giá! 🚀' : 'Sập sàn! 📉', inline: false },
                { name: isWin ? 'Lợi nhuận' : 'Thua lỗ', value: `**${Math.abs(profit).toLocaleString()} 🪙** (${(multiplier * 100).toFixed(1)}%)`, inline: false },
                { name: 'Số dư ví', value: `**${getUserCoins(uid).toLocaleString()} 🪙**`, inline: false }
            )
            .setColor(isWin ? '#00FF00' : '#FF0000');

        return interaction.reply({ embeds: [embed] });
    }
    if (commandName === 'raid') {
        return handleRaidCommand(interaction.user.id, interaction);
    }
    if (commandName === 'pvp') {
        const target = interaction.options.getUser('user');
        const bet = interaction.options.getInteger('bet');
        return handlePvP(interaction.user.id, target.id, bet, interaction);
    }
    if (commandName === 'quest') {
        return handleQuest(interaction.user.id, interaction);
    }
    if (commandName === 'class') {
        return handleClass(interaction.user.id, interaction);
    }
    if (commandName === 'openbox') {
        return handleOpenBox(interaction.user.id, interaction);
    }
    if (commandName === 'evolve') {
        return handleEvolve(interaction.user.id, interaction);
    }
    if (commandName === 'rpgtop') {
        return handleRpgTop(interaction.user.id, interaction);
    }
    if (commandName === 'gather') {
        return handleGather(interaction.user.id, interaction, [commandName]);
    }
    if (commandName === 'pokesolo') {
        return handlePokeSolo(interaction.user.id, interaction);
    }

    // ========================
    // ADMIN SYSTEM HANDLERS
    // ========================
    if (commandName === 'addxp') {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        return awaitConfirmation(interaction, interaction.user.id, `Bạn muốn **CỘNG** ${amount.toLocaleString()} EXP cho <@${target.id}>?`, async () => {
            let np;
            updatePlayer(target.id, dp => {
                dp.exp += amount;
                np = dp;
            });
            return `✅ Đã thêm **${amount.toLocaleString()} EXP** cho <@${target.id}>. Cấp độ hiện tại: **Lv. ${np.level || getPlayer(target.id).level}**`;
        });
    }

    if (commandName === 'addcoin') {
        if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ Lệnh này chỉ dành riêng cho Chủ Bot!', flags: MessageFlags.Ephemeral });
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        return awaitConfirmation(interaction, interaction.user.id, `Bạn muốn **CỘNG** ${amount.toLocaleString()} 🪙 cho <@${target.id}>?`, async () => {
            addCoins(target.id, amount);
            return `✅ Đã thêm **${amount.toLocaleString()} 🪙** cho <@${target.id}>.`;
        });
    }
    if (commandName === 'removecoin') {
        if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ Lệnh này chỉ dành riêng cho Chủ Bot!', flags: MessageFlags.Ephemeral });
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        return awaitConfirmation(interaction, interaction.user.id, `Bạn muốn **TRỪ** ${amount.toLocaleString()} 🪙 của <@${target.id}>?`, async () => {
            addCoins(target.id, -amount);
            return `✅ Đã trừ **${amount.toLocaleString()} 🪙** của <@${target.id}>.`;
        });
    }
    if (commandName === 'setcoin') {
        if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ Lệnh này chỉ dành riêng cho Chủ Bot!', flags: MessageFlags.Ephemeral });
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        return awaitConfirmation(interaction, interaction.user.id, `Bạn muốn **ĐẶT** số coin của <@${target.id}> thành ${amount.toLocaleString()} 🪙?`, async () => {
            setCoins(target.id, amount);
            return `✅ Đã đặt số coin của <@${target.id}> thành **${amount.toLocaleString()} 🪙**.`;
        });
    }
    if (commandName === 'resetcoin') {
        if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ Lệnh này chỉ dành riêng cho Chủ Bot!', flags: MessageFlags.Ephemeral });
        const target = interaction.options.getUser('user');
        return awaitConfirmation(interaction, interaction.user.id, `Bạn CHẮC CHẮN muốn **RESET** tài khoản của <@${target.id}> về 500,000 🪙?`, async () => {
            const data = loadCoins();
            data[target.id] = { coins: 500000, bank: 0, lastDaily: 0 };
            saveCoins(data);
            return `✅ Đã reset tài khoản của <@${target.id}> về mặc định (500,000 🪙 tiền mặt, 0 ngân hàng).`;
        });
    }
    if (commandName === 'resetallcoin') {
        if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ Lệnh này chỉ dành riêng cho Chủ Bot!', flags: MessageFlags.Ephemeral });
        return awaitConfirmation(interaction, interaction.user.id, `Bạn CHẮC CHẮN muốn **RESET TẤT CẢ** tài khoản server về 500,000 🪙? Hành động này không thể hoàn tác!`, async () => {
            const data = loadCoins();
            for (const userId in data) {
                data[userId] = { coins: 500000, bank: 0, lastDaily: 0 };
            }
            saveCoins(data);
            return `✅ Đã reset tài khoản của TẤT CẢ mọi người về mặc định (500,000 🪙 tiền mặt, 0 ngân hàng).`;
        });
    }
    if (commandName === 'resetwork') {
        const target = interaction.options.getUser('user');
        const data = loadCoins();
        if (data[target.id]) {
            data[target.id].workEnd = null;
            data[target.id].workJob = null;
            data[target.id].workReward = null;
            saveCoins(data);
        }
        return interaction.reply({ content: `✅ Đã reset thời gian làm việc cho <@${target.id}>!`, flags: MessageFlags.Ephemeral });
    }
    if (commandName === 'togglevoice') {
        const globalConfig = loadConfig();
        const config = getGuildConfig(interaction.guildId);
        const currentState = (config.voiceNotifyEnabled !== undefined) ? config.voiceNotifyEnabled !== false : globalConfig.voiceNotifyEnabled !== false;
        const newState = !currentState;
        updateGuildConfig(interaction.guildId, 'voiceNotifyEnabled', newState);
        return interaction.reply({ content: `✅ Đã **${newState ? 'BẬT' : 'TẮT'}** thông báo người ra vào kênh thoại.`, flags: MessageFlags.Ephemeral });
    }
    if (commandName === 'clear') {
        const amount = interaction.options.getInteger('amount');
        try {
            await interaction.channel.bulkDelete(amount, true);
            return interaction.reply({ content: `✅ Đã xóa **${amount}** tin nhắn.`, flags: MessageFlags.Ephemeral });
        } catch (err) {
            return interaction.reply({ content: '❌ Không thể xóa tin nhắn (tin nhắn quá 14 ngày).', flags: MessageFlags.Ephemeral });
        }
    }
    if (commandName === 'say') {
        const channel = interaction.options.getChannel('channel');
        const messageText = interaction.options.getString('message');
        if (!channel.isTextBased()) return interaction.reply({ content: '❌ Hãy chọn một kênh văn bản hợp lệ!', flags: MessageFlags.Ephemeral });
        await channel.send(messageText);
        return interaction.reply({ content: `✅ Đã gửi thông báo vào <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
    }

    // --- MA SÓI SLASH ---
    if (commandName === 'masoi') {
        await interaction.deferReply({ flags: 0 });
        const result = await WW.openLobby(interaction.guildId, interaction.channel, interaction.user.id, client);
        if (result?.game) result.game._addCoins = addCoins;
        return interaction.deleteReply().catch(() => {});
    }
    if (commandName === 'wwstop') {
        const game = WW.WW_GAMES.get(interaction.guildId);
        if (!game) return interaction.reply({ content: '❌ Không có game Ma Sói nào đang chạy!', flags: MessageFlags.Ephemeral });
        const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        if (!isAdmin && interaction.user.id !== game.hostId) return interaction.reply({ content: '❌ Chỉ host hoặc Admin mới có thể hủy!', flags: MessageFlags.Ephemeral });
        WW.WW_GAMES.delete(interaction.guildId);
        if (game.nightTimeout) clearTimeout(game.nightTimeout);
        if (game.dayTimeout) clearTimeout(game.dayTimeout);
        if (game.lobbyTimeout) clearTimeout(game.lobbyTimeout);
        if (game.voteMsg) await game.voteMsg.edit({ components: [] }).catch(() => {});
        if (game.lobbyMsg) await game.lobbyMsg.edit({ components: [] }).catch(() => {});
        return interaction.reply({ content: '🛑 Game Ma Sói đã bị hủy!', flags: 0 });
    }

    // --- NOITU SLASH ---
    if (commandName === 'noitu') {
        if (noituGames.has(interaction.channelId)) return interaction.reply({ content: '❌ Trò chơi Nối Từ Tiếng Việt đang diễn ra ở kênh này rồi!', flags: MessageFlags.Ephemeral });
        if (vnDictionary.size === 0) return interaction.reply({ content: '❌ Từ điển chưa tải xong, vui lòng chờ giây lát...', flags: MessageFlags.Ephemeral });
        
        noituMatchCounter++;
        const easyStartingWords = ["nhà cửa", "học sinh", "bạn bè", "làm việc", "người lớn", "xe cộ", "hoa quả", "cây cối", "nước biển", "mưa rào", "bàn ghế", "sách vở", "yêu thương", "hát ca"];
        const randomWord = easyStartingWords[Math.floor(Math.random() * easyStartingWords.length)];
        const channelId = interaction.channelId;
        
        const game = {
            matchId: noituMatchCounter,
            streak: 0,
            userStreaks: new Map(),
            lastUserId: null,
            lastWord: randomWord,
            usedWords: new Set([randomWord])
        };
        noituGames.set(interaction.channelId, game);
        globalUsedWords.set(randomWord, game.matchId);
        
        return interaction.reply(`🎮 **TRÒ CHƠI NỐI TỪ TIẾNG VIỆT BẮT ĐẦU!**\nTừ khởi đầu: **${randomWord.toUpperCase()}**\n\nHãy nối tiếp bằng một từ ghép 2 chữ bắt đầu là **${randomWord.split(' ')[1].toUpperCase()}** nhé!\n_Thưởng 1,000 🪙 mỗi từ đúng (Game không giới hạn thời gian, dùng lệnh /stopnoitu để kết thúc)._`);
    }

    if (commandName === 'stopnoitu') {
        if (!noituGames.has(interaction.channelId)) return interaction.reply({ content: '❌ Không có trò chơi Nối Từ Tiếng Việt nào đang diễn ra.', flags: MessageFlags.Ephemeral });
        const game = noituGames.get(interaction.channelId);
        noituGames.delete(interaction.channelId);
        
        const sortedPlayers = Array.from(game.userStreaks.entries()).sort((a, b) => b[1] - a[1]);
        let leaderboardText = sortedPlayers.map((entry, index) => {
            let medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅';
            return `${medal} <@${entry[0]}>: **${entry[1]}** từ`;
        }).join('\n');
        if (!leaderboardText) leaderboardText = "Chưa có ai ghi điểm.";
        
        const embed = new EmbedBuilder()
            .setTitle('🛑 TỔNG KẾT NỐI TỪ TIẾNG VIỆT')
            .setDescription(`Trò chơi đã kết thúc!`)
            .addFields(
                { name: '🔥 Tổng số từ đã nối', value: `**${game.streak}** từ`, inline: true },
                { name: '🏆 Bảng xếp hạng', value: leaderboardText, inline: false }
            )
            .setColor('#FF4500')
            .setTimestamp();
            
        return interaction.reply({ embeds: [embed] });
    }

    // --- NOITU ENGLISH SLASH ---
    if (commandName === 'noituen') {
        if (noituEnGames.has(interaction.channelId)) return interaction.reply({ content: '❌ Trò chơi Nối Từ Tiếng Anh đang diễn ra ở kênh này rồi!', flags: MessageFlags.Ephemeral });
        if (enDictionary.size === 0) return interaction.reply({ content: '❌ Từ điển Tiếng Anh chưa tải xong, vui lòng chờ giây lát...', flags: MessageFlags.Ephemeral });
        
        noituEnMatchCounter++;
        const easyStartingWords = ["apple", "banana", "cat", "dog", "elephant", "fish", "garden", "house", "island", "jungle", "kite", "lemon", "mountain", "night", "ocean"];
        const randomWord = easyStartingWords[Math.floor(Math.random() * easyStartingWords.length)];
        const channelId = interaction.channelId;
        const lastChar = randomWord[randomWord.length - 1].toUpperCase();
        
        const game = {
            matchId: noituEnMatchCounter,
            streak: 0,
            userStreaks: new Map(),
            lastUserId: null,
            lastWord: randomWord,
            usedWords: new Set([randomWord])
        };
        noituEnGames.set(interaction.channelId, game);
        globalUsedEnWords.set(randomWord, game.matchId);
        
        return interaction.reply(`🔤 **ENGLISH WORD CHAIN STARTS!**\nFirst word: **${randomWord.toUpperCase()}**\n\nType a word that starts with the letter **${lastChar}** (the last letter of the previous word)!\n_Reward: 1,000 🪙 per correct word (No time limit, use /stopnoituen to end)._`);
    }

    if (commandName === 'stopnoituen') {
        if (!noituEnGames.has(interaction.channelId)) return interaction.reply({ content: '❌ Không có trò chơi Nối Từ Tiếng Anh nào đang diễn ra.', flags: MessageFlags.Ephemeral });
        const game = noituEnGames.get(interaction.channelId);
        noituEnGames.delete(interaction.channelId);
        
        const sortedPlayers = Array.from(game.userStreaks.entries()).sort((a, b) => b[1] - a[1]);
        let leaderboardText = sortedPlayers.map((entry, index) => {
            let medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅';
            return `${medal} <@${entry[0]}>: **${entry[1]}** words`;
        }).join('\n');
        if (!leaderboardText) leaderboardText = "No one scored.";
        
        const embed = new EmbedBuilder()
            .setTitle('🛑 ENGLISH WORD CHAIN — GAME OVER')
            .setDescription(`Game ended manually!`)
            .addFields(
                { name: '🔥 Total words chained', value: `**${game.streak}** words`, inline: true },
                { name: '🏆 Leaderboard', value: leaderboardText, inline: false }
            )
            .setColor('#3498DB')
            .setTimestamp();
            
        return interaction.reply({ embeds: [embed] });
    }

    // === J2C SLASH COMMANDS ===
    if (commandName === 'doiten') {
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) return interaction.reply({ content: '❌ Bạn phải ở trong một kênh thoại!', flags: MessageFlags.Ephemeral });
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            const ownerId = j2cChannels.get(voiceChannel.id);
            if (!ownerId || ownerId !== interaction.user.id) return interaction.reply({ content: '❌ Bạn không phải chủ phòng!', flags: MessageFlags.Ephemeral });
        }
        const newName = interaction.options.getString('name');
        try {
            await voiceChannel.setName(newName);
            return interaction.reply({ content: `✅ Đã đổi tên phòng thành **${newName}**!`, flags: MessageFlags.Ephemeral });
        } catch (error) {
            return interaction.reply({ content: '❌ Lỗi! Có thể do Rate Limit (chỉ đổi tên 2 lần/10 phút).', flags: MessageFlags.Ephemeral });
        }
    }

    if (commandName === 'gioihan') {
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) return interaction.reply({ content: '❌ Bạn phải ở trong một kênh thoại!', flags: MessageFlags.Ephemeral });
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            const ownerId = j2cChannels.get(voiceChannel.id);
            if (!ownerId || ownerId !== interaction.user.id) return interaction.reply({ content: '❌ Bạn không phải chủ phòng!', flags: MessageFlags.Ephemeral });
        }
        const limit = interaction.options.getInteger('so');
        try {
            await voiceChannel.setUserLimit(limit);
            return interaction.reply({ content: `✅ Đã chỉnh giới hạn: **${limit === 0 ? 'Không giới hạn' : limit + ' người'}**`, flags: MessageFlags.Ephemeral });
        } catch (error) {
            return interaction.reply({ content: '❌ Có lỗi xảy ra khi chỉnh giới hạn phòng.', flags: MessageFlags.Ephemeral });
        }
    }

    if (commandName === 'khoaan') {
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) return interaction.reply({ content: '❌ Bạn phải ở trong một kênh thoại!', flags: MessageFlags.Ephemeral });
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            const ownerId = j2cChannels.get(voiceChannel.id);
            if (!ownerId || ownerId !== interaction.user.id) return interaction.reply({ content: '❌ Bạn không phải chủ phòng!', flags: MessageFlags.Ephemeral });
        }
        const everyoneRole = interaction.guild.roles.everyone;
        const perms = voiceChannel.permissionOverwrites.cache.get(everyoneRole.id);
        const isGhosted = perms && perms.deny.has('ViewChannel');
        try {
            await voiceChannel.permissionOverwrites.edit(everyoneRole, { ViewChannel: isGhosted ? null : false });
            return interaction.reply({ content: isGhosted ? '✅ Đã **BỎ ẨN** phòng — mọi người có thể thấy.' : '✅ Đã **ẨN** phòng khỏi danh sách.', flags: MessageFlags.Ephemeral });
        } catch (error) {
            return interaction.reply({ content: '❌ Có lỗi xảy ra khi thay đổi quyền.', flags: MessageFlags.Ephemeral });
        }
    }

    if (commandName === 'khoavc') {
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) return interaction.reply({ content: '❌ Bạn phải ở trong một kênh thoại!', flags: MessageFlags.Ephemeral });
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            const ownerId = j2cChannels.get(voiceChannel.id);
            if (!ownerId || ownerId !== interaction.user.id) return interaction.reply({ content: '❌ Bạn không phải chủ phòng!', flags: MessageFlags.Ephemeral });
        }
        const everyoneRole = interaction.guild.roles.everyone;
        const perms = voiceChannel.permissionOverwrites.cache.get(everyoneRole.id);
        const isLocked = perms && perms.deny.has('Connect');
        try {
            await voiceChannel.permissionOverwrites.edit(everyoneRole, { Connect: isLocked ? null : false });
            return interaction.reply({ content: isLocked ? '✅ Đã **MỞ KHÓA** — mọi người có thể vào.' : '✅ Đã **KHÓA** — không ai vào được.', flags: MessageFlags.Ephemeral });
        } catch (error) {
            return interaction.reply({ content: '❌ Có lỗi xảy ra khi thay đổi quyền.', flags: MessageFlags.Ephemeral });
        }
    }

    if (commandName === 'kickvc') {
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) return interaction.reply({ content: '❌ Bạn phải ở trong một kênh thoại!', flags: MessageFlags.Ephemeral });
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            const ownerId = j2cChannels.get(voiceChannel.id);
            if (!ownerId || ownerId !== interaction.user.id) return interaction.reply({ content: '❌ Bạn không phải chủ phòng!', flags: MessageFlags.Ephemeral });
        }
        const targetUser = interaction.options.getUser('user');
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember || targetMember.voice.channelId !== voiceChannel.id) {
            return interaction.reply({ content: '❌ Người này không ở trong phòng của bạn!', flags: MessageFlags.Ephemeral });
        }
        if (targetUser.id === interaction.user.id) {
            return interaction.reply({ content: '❌ Bạn không thể tự kích chính mình!', flags: MessageFlags.Ephemeral });
        }
        try {
            await targetMember.voice.disconnect('Bị kích khỏi phòng bởi chủ phòng');
            return interaction.reply({ content: `✅ Đã kích **${targetUser.username}** khỏi phòng!`, flags: MessageFlags.Ephemeral });
        } catch (error) {
            return interaction.reply({ content: '❌ Có lỗi. Hãy đảm bảo bot có quyền **Move Members**.', flags: MessageFlags.Ephemeral });
        }
    }

    if (commandName === '1an') {
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ Bạn phải ở trong một kênh thoại để dùng lệnh này!', flags: MessageFlags.Ephemeral });
        }

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            const ownerId = j2cChannels.get(voiceChannel.id);
            if (!ownerId || ownerId !== interaction.user.id) {
                return interaction.reply({ content: '❌ Bạn không phải là chủ phòng này hoặc không có quyền Quản lý kênh!', flags: MessageFlags.Ephemeral });
            }
        }

        const targetUser = interaction.options.getUser('user');

        try {
            await voiceChannel.permissionOverwrites.edit(targetUser.id, {
                ViewChannel: false,
                Connect: false
            });
            return interaction.reply({ content: `✅ Đã ẩn kênh thoại **${voiceChannel.name}** đối với **${targetUser.username}**!`, flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('Lỗi khi ẩn phòng:', error);
            return interaction.reply({ content: '❌ Có lỗi xảy ra. Hãy đảm bảo bot có quyền **Manage Channels**.', flags: MessageFlags.Ephemeral });
        }
    }
});

// ========================
// ANTI-NUKE SYSTEM
// ========================
async function checkAntiNuke(guild, actionType) {
    const config = getGuildConfig(guild.id);
    if (config.antiNukeEnabled === false) return;
    
    await new Promise(r => setTimeout(r, 2000));
    
    let auditType;
    if (actionType === 'CHANNEL_DELETE') auditType = AuditLogEvent.ChannelDelete;
    else if (actionType === 'ROLE_DELETE') auditType = AuditLogEvent.RoleDelete;
    else if (actionType === 'MEMBER_BAN') auditType = AuditLogEvent.MemberBanAdd;
    else if (actionType === 'MEMBER_KICK') auditType = AuditLogEvent.MemberKick;
    else if (actionType === 'CHANNEL_CREATE') auditType = AuditLogEvent.ChannelCreate;
    else if (actionType === 'ROLE_CREATE') auditType = AuditLogEvent.RoleCreate;
    else if (actionType === 'WEBHOOK_CREATE') auditType = AuditLogEvent.WebhookCreate;
    else return;

    try {
        const auditLogs = await guild.fetchAuditLogs({ type: auditType, limit: 1 });
        const log = auditLogs.entries.first();
        if (!log) return;
        
        if (Date.now() - log.createdTimestamp > 10000) return;
        
        const executor = log.executor;
        if (!executor || executor.bot) return;
        if (executor.id === guild.ownerId) return; // Miễn trừ chủ Server (Whitelist)
        if (config.antiNukeWhitelistRoles && config.antiNukeWhitelistRoles.length > 0) {
            try {
                const member = await guild.members.fetch(executor.id);
                if (member && member.roles.cache.some(r => config.antiNukeWhitelistRoles.includes(r.id))) {
                    return; // Miễn trừ cho các role được whitelist
                }
            } catch (err) {}
        }
        
        if (!nukeTracker.has(guild.id)) nukeTracker.set(guild.id, new Map());
        const guildTracker = nukeTracker.get(guild.id);
        
        if (!guildTracker.has(executor.id)) guildTracker.set(executor.id, []);
        const userActions = guildTracker.get(executor.id);
        
        userActions.push(Date.now());
        const recentActions = userActions.filter(t => Date.now() - t < 10000);
        guildTracker.set(executor.id, recentActions);
        
        if (recentActions.length >= 2) {
            try {
                const member = await guild.members.fetch(executor.id);
                if (member) {
                    let punished = false;
                    let pType = 'Tước Role';
                    
                    try {
                        await member.ban({ reason: 'Anti-Nuke: Phát hiện hành vi phá hoại (Nuke/Spam)' });
                        punished = true;
                        pType = 'Cấm vĩnh viễn (BAN)';
                    } catch (e1) {
                        try {
                            await member.kick('Anti-Nuke: Phát hiện hành vi phá hoại (Nuke/Spam)');
                            punished = true;
                            pType = 'Đuổi khỏi server (KICK)';
                        } catch (e2) {
                            try {
                                await member.roles.set([]);
                                punished = true;
                            } catch (e3) {}
                        }
                    }
                    
                    const owner = await guild.fetchOwner();
                    if (owner && punished) {
                        await owner.send(`🚨 **CẢNH BÁO ANTI-NUKE MỨC ĐỘ CAO** 🚨\n⚠️ Phát hiện Quản trị viên <@${executor.id}> (${executor.tag}) có hành vi phá hoại nguy hiểm (tạo/xoá kênh/role/ban 3 lần trong 10s).\n🛡️ Bot đã tự động **${pType}** người này để bảo vệ an toàn cho Server!`);
                    }
                }
            } catch (err) {
                console.error('Lỗi khi xử phạt kẻ nuke:', err);
            }
            guildTracker.delete(executor.id);
        }
    } catch (err) {}
}

client.on('channelDelete', channel => {
    if (channel.guild) checkAntiNuke(channel.guild, 'CHANNEL_DELETE');
});
client.on('roleDelete', role => {
    if (role.guild) checkAntiNuke(role.guild, 'ROLE_DELETE');
});
client.on('channelCreate', channel => {
    if (channel.guild) checkAntiNuke(channel.guild, 'CHANNEL_CREATE');
});
client.on('roleCreate', role => {
    if (role.guild) checkAntiNuke(role.guild, 'ROLE_CREATE');
});
client.on('webhookUpdate', channel => {
    if (channel.guild) checkAntiNuke(channel.guild, 'WEBHOOK_CREATE');
});
client.on('guildBanAdd', async ban => {
    if (ban.guild) checkAntiNuke(ban.guild, 'MEMBER_BAN');
    const executor = await fetchAuditLogExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    const logEmbed = new EmbedBuilder()
        .setTitle('🔨 THÀNH VIÊN BỊ BAN')
        .setDescription(`**${ban.user.tag}** (<@${ban.user.id}>) đã bị cấm khỏi server.`)
        .addFields({ name: 'Người thực hiện', value: executor ? `<@${executor.id}>` : 'Không xác định' })
        .setColor('#C0392B')
        .setThumbnail(ban.user.displayAvatarURL())
        .setTimestamp();
    sendAdvLog(ban.guild, 'member', logEmbed);
    sendAdvLog(ban.guild, 'mod', logEmbed);
});
client.on('guildMemberRemove', async member => {
    if (member.guild) checkAntiNuke(member.guild, 'MEMBER_KICK');
    const kickExecutor = await fetchAuditLogExecutor(member.guild, AuditLogEvent.MemberKick, member.id);
    
    if (member.guild) {
        const logEmbed = new EmbedBuilder()
            .setTitle(kickExecutor ? '👢 THÀNH VIÊN BỊ KICK' : '📤 THÀNH VIÊN RỜI ĐI')
            .setDescription(`**${member.user.tag}** (<@${member.id}>) đã ${kickExecutor ? 'bị đuổi' : 'rời'} khỏi server.\nSố lượng thành viên: ${member.guild.memberCount}`)
            .setColor('#E74C3C')
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp();
        if (kickExecutor) {
            logEmbed.addFields({ name: 'Người thực hiện', value: `<@${kickExecutor.id}>` });
            sendAdvLog(member.guild, 'mod', logEmbed);
        }
        sendAdvLog(member.guild, 'member', logEmbed);
    }
});

client.on('messageDelete', message => {
    if (message.partial || message.author?.bot || !message.guild) return;
    const logEmbed = new EmbedBuilder()
        .setTitle('🗑️ TIN NHẮN BỊ XÓA')
        .setDescription(`**Tác giả:** ${message.author.tag} (<@${message.author.id}>)\n**Kênh:** <#${message.channel.id}>\n\n**Nội dung:**\n\`\`\`\n${message.content || '[Không có nội dung hoặc chứa Media]'}\n\`\`\``)
        .setThumbnail(message.author.displayAvatarURL())
        .setColor('#FF4757')
        .setTimestamp();
    sendAdvLog(message.guild, 'message', logEmbed);
});

client.on('messageUpdate', (oldMessage, newMessage) => {
    if (oldMessage.partial || oldMessage.author?.bot || !oldMessage.guild) return;
    if (oldMessage.content === newMessage.content) return;
    const logEmbed = new EmbedBuilder()
        .setTitle('✏️ TIN NHẮN ĐƯỢC SỬA')
        .setDescription(`Tin nhắn của **${oldMessage.author.tag}** được sửa ở kênh <#${oldMessage.channel.id}> [Đi tới tin nhắn](${newMessage.url})`)
        .addFields(
            { name: 'Trước', value: oldMessage.content ? oldMessage.content.substring(0, 1000) + (oldMessage.content.length > 1000 ? '...' : '') : '[Trống]' },
            { name: 'Sau', value: newMessage.content ? newMessage.content.substring(0, 1000) + (newMessage.content.length > 1000 ? '...' : '') : '[Trống]' }
        )
        .setColor('#F1C40F')
        .setTimestamp();
    sendAdvLog(oldMessage.guild, 'message', logEmbed);
});

// Helper for fetching Audit Log executor
async function fetchAuditLogExecutor(guild, type, targetId) {
    if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ViewAuditLog)) return null;
    try {
        const auditLogs = await guild.fetchAuditLogs({ type: type, limit: 1 });
        const entry = auditLogs.entries.first();
        if (entry && (!targetId || entry.target?.id === targetId) && Date.now() - entry.createdTimestamp < 5000) {
            return entry.executor;
        }
    } catch (e) {
        console.error(e);
    }
    return null;
}

// ========================
// ADVANCED LOGS EVENTS
// ========================

// CHANNEL LOG
client.on('channelCreate', async channel => {
    if (!channel.guild) return;
    const executor = await fetchAuditLogExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    const logEmbed = new EmbedBuilder()
        .setTitle('📢 KÊNH ĐƯỢC TẠO')
        .setDescription(`Kênh <#${channel.id}> (\`${channel.name}\`) vừa được tạo.`)
        .addFields({ name: 'Người thực hiện', value: executor ? `<@${executor.id}>` : 'Không xác định' })
        .setColor('#2ECC71')
        .setTimestamp();
    sendAdvLog(channel.guild, 'channel', logEmbed);
    
    // TICKET LOG
    if (channel.name.includes('ticket-')) {
        const ticketEmbed = new EmbedBuilder()
            .setTitle('🎟️ TICKET MỚI')
            .setDescription(`Ticket <#${channel.id}> vừa được tạo bởi ${executor ? `<@${executor.id}>` : 'hệ thống'}.`)
            .setColor('#3498DB')
            .setTimestamp();
        sendAdvLog(channel.guild, 'ticket', ticketEmbed);
    }
});

client.on('channelDelete', async channel => {
    if (!channel.guild) return;
    const executor = await fetchAuditLogExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    const logEmbed = new EmbedBuilder()
        .setTitle('📢 KÊNH BỊ XÓA')
        .setDescription(`Kênh \`${channel.name}\` vừa bị xóa.`)
        .addFields({ name: 'Người thực hiện', value: executor ? `<@${executor.id}>` : 'Không xác định' })
        .setColor('#E74C3C')
        .setTimestamp();
    sendAdvLog(channel.guild, 'channel', logEmbed);

    // TICKET LOG
    if (channel.name.includes('ticket-')) {
        const ticketEmbed = new EmbedBuilder()
            .setTitle('🎟️ TICKET ĐÓNG/XÓA')
            .setDescription(`Ticket \`${channel.name}\` vừa bị xóa bởi ${executor ? `<@${executor.id}>` : 'hệ thống'}.`)
            .setColor('#E74C3C')
            .setTimestamp();
        sendAdvLog(channel.guild, 'ticket', ticketEmbed);
    }
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!oldChannel.guild) return;
    if (oldChannel.name !== newChannel.name) {
        const executor = await fetchAuditLogExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
        const logEmbed = new EmbedBuilder()
            .setTitle('📢 KÊNH ĐƯỢC ĐỔI TÊN')
            .setDescription(`Kênh <#${newChannel.id}> vừa được đổi tên.`)
            .addFields(
                { name: 'Tên cũ', value: oldChannel.name, inline: true },
                { name: 'Tên mới', value: newChannel.name, inline: true },
                { name: 'Người thực hiện', value: executor ? `<@${executor.id}>` : 'Không xác định', inline: false }
            )
            .setColor('#F1C40F')
            .setTimestamp();
        sendAdvLog(newChannel.guild, 'channel', logEmbed);
    }
});

// ROLE LOG
client.on('roleCreate', async role => {
    const executor = await fetchAuditLogExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
    const logEmbed = new EmbedBuilder()
        .setTitle('🎭 ROLE ĐƯỢC TẠO')
        .setDescription(`Role <@&${role.id}> (\`${role.name}\`) vừa được tạo.`)
        .addFields({ name: 'Người thực hiện', value: executor ? `<@${executor.id}>` : 'Không xác định' })
        .setColor('#2ECC71')
        .setTimestamp();
    sendAdvLog(role.guild, 'role', logEmbed);
});

client.on('roleDelete', async role => {
    const executor = await fetchAuditLogExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
    const logEmbed = new EmbedBuilder()
        .setTitle('🎭 ROLE BỊ XÓA')
        .setDescription(`Role \`${role.name}\` vừa bị xóa.`)
        .addFields({ name: 'Người thực hiện', value: executor ? `<@${executor.id}>` : 'Không xác định' })
        .setColor('#E74C3C')
        .setTimestamp();
    sendAdvLog(role.guild, 'role', logEmbed);
});

client.on('roleUpdate', async (oldRole, newRole) => {
    if (oldRole.name !== newRole.name || oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        const executor = await fetchAuditLogExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
        const logEmbed = new EmbedBuilder()
            .setTitle('🎭 ROLE ĐƯỢC CẬP NHẬT')
            .setDescription(`Role <@&${newRole.id}> (\`${newRole.name}\`) vừa thay đổi.`)
            .addFields(
                { name: 'Tên cũ', value: oldRole.name, inline: true },
                { name: 'Tên mới', value: newRole.name, inline: true },
                { name: 'Người thực hiện', value: executor ? `<@${executor.id}>` : 'Không xác định', inline: false }
            )
            .setColor('#F1C40F')
            .setTimestamp();
        sendAdvLog(newRole.guild, 'role', logEmbed);
    }
});

// SERVER LOG
client.on('guildUpdate', async (oldGuild, newGuild) => {
    if (oldGuild.name !== newGuild.name || oldGuild.icon !== newGuild.icon) {
        const executor = await fetchAuditLogExecutor(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
        const logEmbed = new EmbedBuilder()
            .setTitle('⚙️ SERVER ĐƯỢC CẬP NHẬT')
            .setDescription(`Thông tin Server **${newGuild.name}** vừa thay đổi.`)
            .addFields({ name: 'Người thực hiện', value: executor ? `<@${executor.id}>` : 'Không xác định' })
            .setColor('#9B59B6')
            .setTimestamp();
        sendAdvLog(newGuild, 'server', logEmbed);
    }
});

// EMOJI & STICKER LOG
client.on('emojiCreate', async emoji => {
    const executor = await fetchAuditLogExecutor(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
    const logEmbed = new EmbedBuilder()
        .setTitle('😀 EMOJI ĐƯỢC TẠO')
        .setDescription(`Emoji ${emoji} (\`${emoji.name}\`) vừa được tạo.`)
        .addFields({ name: 'Người thực hiện', value: executor ? `<@${executor.id}>` : 'Không xác định' })
        .setColor('#2ECC71')
        .setTimestamp();
    sendAdvLog(emoji.guild, 'emoji', logEmbed);
});

client.on('emojiDelete', async emoji => {
    const executor = await fetchAuditLogExecutor(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
    const logEmbed = new EmbedBuilder()
        .setTitle('😀 EMOJI BỊ XÓA')
        .setDescription(`Emoji \`${emoji.name}\` vừa bị xóa.`)
        .addFields({ name: 'Người thực hiện', value: executor ? `<@${executor.id}>` : 'Không xác định' })
        .setColor('#E74C3C')
        .setTimestamp();
    sendAdvLog(emoji.guild, 'emoji', logEmbed);
});

// COMMAND LOG
client.on('interactionCreate', async interaction => {
    if (interaction.isCommand()) {
        const logEmbed = new EmbedBuilder()
            .setTitle('💻 LỆNH SLASH ĐƯỢC SỬ DỤNG')
            .setDescription(`Người dùng <@${interaction.user.id}> đã sử dụng lệnh \`/${interaction.commandName}\` tại kênh <#${interaction.channelId}>.`)
            .setColor('#34495E')
            .setTimestamp();
        sendAdvLog(interaction.guild, 'command', logEmbed);
    }
});

// ========================
// LOGIN
// ========================
const token = process.env.DISCORD_TOKEN;
if (!token || token === 'YOUR_DISCORD_BOT_TOKEN_HERE') {
    console.error('❌ LỖI: Bạn chưa cung cấp DISCORD_TOKEN trong file .env');
    process.exit(1);
} else {
    client.login(token);
}

// Cảnh báo lỗi gửi vào Discord
function sendErrorLog(errTitle, errBody) {
    const logEmbed = new EmbedBuilder()
        .setTitle(errTitle)
        .setDescription(`\`\`\`js\n${String(errBody).substring(0, 4000)}\n\`\`\``)
        .setColor('#E74C3C')
        .setTimestamp();
    // Phát tới TẤT CẢ guild có cài đặt advLogs
    client.guilds.cache.forEach(guild => {
        sendAdvLog(guild, 'error', logEmbed);
        sendAdvLog(guild, 'bot', logEmbed);
    });
}

// Anti-crash system
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    sendErrorLog('❌ Unhandled Rejection', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    sendErrorLog('❌ Uncaught Exception', err.stack || err);
});
process.on('uncaughtExceptionMonitor', (err, origin) => {
    console.error('Uncaught Exception Monitor:', err, origin);
});


