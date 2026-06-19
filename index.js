require('dotenv').config();
const {
    Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, UserSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder
} = require('discord.js');
const { GiveawaysManager } = require('discord-giveaways');
const ms = require('ms');
const fs = require('fs');
const axios = require('axios');
const {
    joinVoiceChannel, createAudioPlayer, createAudioResource,
    AudioPlayerStatus, VoiceConnectionStatus, getVoiceConnection, entersState
} = require('@discordjs/voice');
const { execFile, spawn } = require('child_process');
const path = require('path');
const YouTubeSR = require('youtube-sr').default;
const ffmpegPath = require('ffmpeg-static');
const cron = require('node-cron');
const WW = require('./werewolf.js');

// Chỉ định đường dẫn FFmpeg cho prism-media (dùng cho @discordjs/voice)
process.env.FFMPEG_PATH = ffmpegPath;

// Đường dẫn tới yt-dlp (cross-platform)
const YTDLP_PATH = path.join(__dirname, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

// Lấy thông tin video bằng yt-dlp (JSON)
// Danh sách player_client thử theo thứ tự khi không có cookies
// android_vr & mediaconnect hoạt động tốt nhất trên server/VPS năm 2025
const YT_PLAYER_CLIENTS = ['default', 'ios', 'android_vr', 'tv_embedded', 'android', 'mweb', 'web_creator'];

// User-agent giả lập Android mobile để tránh bot-check
const YTDLP_USER_AGENT = 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36';

function getCookiesPath() {
    // Ưu tiên: biến môi trường COOKIES_PATH → file cookies.txt bên cạnh bot
    return process.env.COOKIES_PATH || path.join(__dirname, 'cookies.txt');
}

function buildYtdlpArgs(baseArgs, query) {
    const cookiesPath = getCookiesPath();
    const args = [...baseArgs];
    if (fs.existsSync(cookiesPath)) {
        args.push('--cookies', cookiesPath);
    } else {
        // Không có cookies → dùng android_vr (ít bị chặn nhất trên VPS)
        args.push('--extractor-args', 'youtube:player_client=android_vr');
        args.push('--user-agent', YTDLP_USER_AGENT);
    }
    args.push(query);
    return args;
}

// Thử chạy yt-dlp với nhiều player_client nếu gặp lỗi bot-check
function ytdlpExecWithFallback(baseArgs, query, opts = {}) {
    return new Promise(async (resolve, reject) => {
        const cookiesPath = getCookiesPath();
        const hasCookies = fs.existsSync(cookiesPath);

        const clients = hasCookies ? [null] : YT_PLAYER_CLIENTS;

        for (let i = 0; i < clients.length; i++) {
            const args = [...baseArgs];
            if (hasCookies) {
                args.push('--cookies', cookiesPath);
            } else {
                args.push('--extractor-args', `youtube:player_client=${clients[i]}`);
                args.push('--user-agent', YTDLP_USER_AGENT);
            }
            args.push(query);

            const result = await new Promise((res) => {
                execFile(YTDLP_PATH, args, { timeout: 45000, maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
                    if (err) {
                        const isRateLimit = stderr && (
                            stderr.includes('Sign in to confirm') ||
                            stderr.includes('bot') ||
                            stderr.includes('429') ||
                            stderr.includes('This video is not available')
                        );
                        if (isRateLimit && !hasCookies && i < clients.length - 1) {
                            console.warn(`[yt-dlp] player_client=${clients[i]} bị chặn, thử ${clients[i+1]}...`);
                            res({ retry: true });
                        } else {
                            res({ err, stdout, stderr });
                        }
                    } else {
                        res({ err: null, stdout, stderr });
                    }
                });
            });

            if (result.retry) continue;
            if (result.err) return reject(result.err);
            return resolve(result.stdout);
        }
        reject(new Error('Tất cả player_client đều bị YouTube chặn. Vui lòng thêm cookies.txt (xem export_cookies_guide.md).'));
    });
}

async function ytdlpGetInfo(url) {
    try {
        let searchQuery = url;
        if (url.includes('spotify.com')) {
            const { getPreview } = require('spotify-url-info')(fetch);
            const spotInfo = await getPreview(url);
            searchQuery = `${spotInfo.title} ${spotInfo.artist}`;
        }
        
        // Nếu là link (kể cả soundcloud), dùng yt-dlp để lấy info (hỗ trợ mọi trang)
        if (searchQuery.startsWith('http')) {
            const baseArgs = ['--dump-json', '--no-playlist', '--quiet', '--no-warnings'];
            const stdout = await ytdlpExecWithFallback(baseArgs, searchQuery);
            const info = JSON.parse(stdout);
            return {
                title: info.title,
                webpage_url: info.webpage_url || info.url,
                duration: info.duration || 0,
                thumbnail: info.thumbnail || ''
            };
        }
        
        // Tìm kiếm bằng chữ thì dùng YouTubeSR cho nhanh
        const video = await YouTubeSR.searchOne(searchQuery);
        if (!video || !video.id) return null;
        return {
            title: video.title,
            webpage_url: `https://www.youtube.com/watch?v=${video.id}`,
            duration: video.duration / 1000,
            thumbnail: video.thumbnail?.url || ''
        };
    } catch (err) {
        console.error('Lỗi khi lấy info bài hát:', err.message || err);
        return null;
    }
}

// Stream audio từ YouTube bằng yt-dlp pipe vào ffmpeg
// Có fallback qua nhiều player_client nếu bị YouTube chặn trên VPS
function ytdlpStream(url, clientIndex = 0) {
    const cookiesPath = getCookiesPath();
    const hasCookies = fs.existsSync(cookiesPath);

    const args = [
        '-f', 'bestaudio[ext=webm]/bestaudio/best',
        '--no-playlist',
        '-q',
        '-o', '-'
    ];

    if (hasCookies) {
        args.push('--cookies', cookiesPath);
    } else {
        const client = YT_PLAYER_CLIENTS[clientIndex] || YT_PLAYER_CLIENTS[0];
        args.push('--extractor-args', `youtube:player_client=${client}`);
        args.push('--user-agent', YTDLP_USER_AGENT);
    }

    args.push(url);

    const ytdlp = spawn(YTDLP_PATH, args);
    let stderrData = '';

    ytdlp.stderr.on('data', (data) => {
        stderrData += data.toString();
    });

    ytdlp.stdout.on('close', () => {
        ytdlp.kill();
    });

    ytdlp.on('error', (err) => {
        console.error('Lỗi tiến trình yt-dlp:', err);
    });

    ytdlp.on('close', (code) => {
        if (code !== 0 && !hasCookies) {
            const isBlocked = stderrData.includes('Sign in to confirm') ||
                stderrData.includes('bot') ||
                stderrData.includes('429');
            if (isBlocked && clientIndex < YT_PLAYER_CLIENTS.length - 1) {
                console.warn(`[yt-dlp stream] player_client=${YT_PLAYER_CLIENTS[clientIndex]} bị chặn, thử ${YT_PLAYER_CLIENTS[clientIndex + 1]}...`);
                // Không retry stream trực tiếp được, chỉ log lỗi
            } else if (isBlocked) {
                console.error('[yt-dlp stream] Tất cả player_client bị chặn. Cần thêm cookies.txt!');
            }
        }
    });

    return ytdlp.stdout;
}

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

function getPrefix() {
    const config = loadConfig();
    return config.prefix || process.env.PREFIX || '!';
}

function savePrefix(newPrefix) {
    const config = loadConfig();
    config.prefix = newPrefix;
    saveConfig(config);
}

// ========================
// HELP PAGES SYSTEM
// ========================
function buildHelpPages(prefix) {
    return [
        // Page 0 - Tổng quan
        new EmbedBuilder()
            .setTitle('📖 Trợ Lý Bot — Tổng Quan')
            .setDescription(`Xin chào! Tôi là **Moonie Bot** 🌙\nBot đa năng: phát nhạc, minigame, kinh tế, RPG, kết hôn, game Ma Sói và nhiều tiện ích khác!\n\n> Prefix hiện tại: **\`${prefix}\`**\n> Bạn có thể dùng **lệnh prefix** (ví dụ \`${prefix}play\`) hoặc **slash command** (ví dụ \`/play\`)\n\n📌 **Cách dùng menu:** Chọn danh mục bên dưới để xem hướng dẫn chi tiết từng nhóm lệnh.`)
            .addFields(
                { name: '👤 DÀNH CHO USER', value: '🎵  **Nhạc** — Phát nhạc YouTube, Spotify, SoundCloud trong voice\n💰  **Coin & Minigame** — Daily, Work, Tài Xỉu, Blackjack, Đoán số, Lô đề, Nối từ\n🏦  **Ngân Hàng** — Gửi/rút tiền, đầu tư cổ phiếu, cướp bank\n⚔️  **RPG** — Đánh quái, mua trang bị, bắt Pokemon, thách đấu\n💍  **Kết hôn** — Mua nhẫn, cầu hôn, ly hôn\n🐺  **Ma Sói** — Game đối kháng nhiều người\n📱  **Tiện ích** — Avatar, TikTok, J2C, thông báo voice', inline: false },
                { name: '🛠️ DÀNH CHO ADMIN', value: '🔧  **Quản lý** — Cộng/Trừ/Set coin, Xóa tin nhắn, QR bank\n⚙️  **Hệ thống** — Prefix, Giveaway, Chào mừng, Pokemon spawn\n👑  **Đặc quyền** — Admin Cheat Panel (bật/tắt luôn thắng)', inline: false }
            )
            .setColor('#5865F2')
            .setFooter({ text: 'Trang 1/10 • Chọn danh mục bên dưới để xem chi tiết' })
            .setTimestamp(),

        // Page 1 - Nhạc
        new EmbedBuilder()
            .setTitle('🎵 Nhạc YouTube / Spotify / SoundCloud')
            .setDescription(`Phát nhạc trong voice channel! Bot hỗ trợ tìm kiếm bằng **tên bài**, **link YouTube**, **link Spotify** và **link SoundCloud**.\n\n⚠️ **Yêu cầu:** Bạn phải **ở trong voice channel** trước khi dùng lệnh nhạc.\n🎛️ Sau khi phát, bot sẽ hiện **bảng điều khiển** với các nút: Tạm dừng, Bỏ qua, Dừng hẳn, Xem hàng đợi, Lặp bài, Chỉnh âm lượng.`)
            .addFields(
                { name: `\`${prefix}play <tên bài hoặc link>\` hoặc \`/play\``, value: '▶️ Phát nhạc hoặc thêm bài vào cuối hàng đợi.\n• Hỗ trợ: tên bài hát, link YouTube, link Spotify, link SoundCloud\n• Ví dụ: `' + prefix + 'play Nắng Ấm Xa Dần` hoặc `' + prefix + 'play https://youtube.com/...`', inline: false },
                { name: `\`${prefix}skip\` hoặc \`/skip\``, value: '⏭️ Bỏ qua bài hiện tại, phát bài tiếp theo trong hàng đợi.', inline: true },
                { name: `\`${prefix}stop\` hoặc \`/stop\``, value: '⏹️ Dừng toàn bộ nhạc, xóa hàng đợi và bot rời kênh voice.', inline: true },
                { name: `\`${prefix}pause\` hoặc \`/pause\``, value: '⏸️ Tạm dừng bài đang phát. Dùng resume để tiếp tục.', inline: true },
                { name: `\`${prefix}resume\` hoặc \`/resume\``, value: '▶️ Tiếp tục phát bài đã tạm dừng.', inline: true },
                { name: `\`${prefix}q\` hoặc \`/queue\``, value: '📋 Xem danh sách các bài trong hàng đợi (tối đa 10 bài/trang).', inline: true },
                { name: `\`${prefix}np\` hoặc \`/nowplaying\``, value: '🎵 Xem thông tin bài đang phát: tên, thời lượng, người yêu cầu.', inline: true },
                { name: '💡 Mẹo hữu ích', value: '• Chỉ **người gọi lệnh /play** mới điều khiển được bảng nút nhạc.\n• Bot tự rời kênh sau **30 giây** nếu hết bài trong hàng đợi.\n• Âm lượng có thể chỉnh từ **0% đến 200%** qua nút 🔉/🔊.', inline: false }
            )
            .setColor('#FF0000')
            .setFooter({ text: 'Trang 2/10 • Nhạc YouTube' })
            .setTimestamp(),

        // Page 2 - Coin & Minigame
        new EmbedBuilder()
            .setTitle('💰 Tiền tệ & Minigame')
            .setDescription(`Hệ thống tiền ảo (🪙) và các trò chơi giải trí để kiếm coin.\nMọi thành viên mới bắt đầu với **500,000 🪙**.`)
            .addFields(
                { name: `\`${prefix}daily\` hoặc \`/daily\``, value: '📅 Nhận coin hằng ngày (10,000–50,000 🪙).\n• Chơi liên tiếp nhiều ngày sẽ được **thưởng chuỗi** (+5,000/ngày, tối đa +50,000).\n• Nghỉ quá 48h → chuỗi bị reset về 0.', inline: false },
                { name: `\`${prefix}work\` hoặc \`/work\``, value: '💼 Chọn 1 trong 10 công việc để kiếm coin.\n• Từ **Nhặt ve chai** (1,000–5,000 🪙, 1 phút) đến **Giám đốc** (500,000–1,200,000 🪙, 60 phút).\n• Công việc lương cao hơn → thời gian chờ lâu hơn.', inline: false },
                { name: `\`${prefix}bal [@user]\` hoặc \`/balance\``, value: '💵 Xem số dư coin (ví + bank) của bạn hoặc người khác.', inline: true },
                { name: `\`${prefix}give @user <số>\` hoặc \`/give\``, value: '🎁 Tặng coin từ ví của bạn cho người khác.', inline: true },
                { name: `\`${prefix}top\` hoặc \`/top\``, value: '🏆 Bảng xếp hạng Top 10 người giàu nhất server.', inline: true },
                { name: '🎲 CÁC TRÒ CHƠI CỜ BẠC', value: `\`${prefix}tx <cược>\` — **Tài Xỉu**: Đoán tài/xỉu, thắng x2 tiền cược.\n\`${prefix}bc <cược>\` — **Bầu Cua**: Chọn con vật, trúng nhận x2.\n\`${prefix}bj <cược>\` — **Blackjack**: Xì Dách, thắng x2 (Blackjack x2.5).\n\`${prefix}guess <cược>\` — **Đoán số**: Đoán số 1–100, trúng nhận **x3**.\n\`${prefix}lode <số 00-99> <cược>\` — **Lô đề**: Xổ số 18h30 hằng ngày, trúng **x5**.`, inline: false },
                { name: `\`${prefix}noitu\` hoặc \`/noitu\``, value: '🧠 Nối Từ Tiếng Việt: Nối từ ghép 2 chữ, mỗi từ đúng +50,000 🪙. Hết 60 giây không ai nối → kết thúc.', inline: false }
            )
            .setColor('#FFD700')
            .setFooter({ text: 'Trang 3/10 • Coin & Minigame' })
            .setTimestamp(),

        // Page 3 - Ngân hàng & Đầu tư
        new EmbedBuilder()
            .setTitle('🏦 Ngân Hàng & Đầu Tư')
            .setDescription('Gửi tiền vào bank để bảo toàn tài sản (tránh mất khi thua cờ bạc), đầu tư sinh lời hoặc liều mình cướp bank!')
            .addFields(
                { name: `\`${prefix}bank\` hoặc \`/bank\``, value: '🏦 Mở bảng ngân hàng cá nhân với 4 nút bấm:\n• 📥 **Gửi Tiền** — Nhập số tiền muốn chuyển từ ví → bank\n• 📤 **Rút Tiền** — Nhập số tiền muốn rút từ bank → ví\n• 🏆 **Top Bank** — Xem bảng xếp hạng người giàu nhất bank\n• 🔄 **Làm mới** — Cập nhật lại số dư hiện tại', inline: false },
                { name: `\`${prefix}dautu <số tiền>\` hoặc \`/dautu\``, value: '📊 Đầu tư cổ phiếu ngẫu nhiên:\n• Có thể **lãi tối đa +80%** số tiền đầu tư\n• Có thể **lỗ tối đa -50%** số tiền đầu tư\n• Kết quả hiện ngay sau khi bấm xác nhận\n• Ví dụ: Đầu tư 1,000,000 → lãi +800,000 hoặc lỗ -500,000', inline: false },
                { name: `\`${prefix}robbank\` hoặc \`/robbank\``, value: '🏦 **Cướp ngân hàng hệ thống:**\n• 15% thành công → nhận thưởng lớn\n• Thất bại → mất 50% tiền mặt + bị tù 5 phút', inline: false },
                { name: `\`${prefix}robbank @user\` hoặc \`/robbank @user\``, value: '🥷 **Cướp ngân hàng người khác:**\n• 40% thành công → lấy 10–30% tiền bank của họ\n• Thất bại → mất 30% tiền mặt + bị tù 3 phút', inline: false },
                { name: `\`${prefix}nopphat\` hoặc \`/nopphat\``, value: '🚓 Đang bị tù? Nộp **100,000 🪙** để hối lộ và được thả tự do ngay lập tức!', inline: false },
                { name: '💡 Mẹo quan trọng', value: '• Tiền trong **bank** an toàn, không bị mất khi thua cờ bạc!\n• Nhưng tiền bank **có thể bị cướp** bởi người khác qua lệnh `robbank`.\n• Bị tù → không dùng được bất kỳ lệnh nào ngoài `nopphat`.', inline: false }
            )
            .setColor('#2ECC71')
            .setFooter({ text: 'Trang 4/10 • Ngân Hàng & Đầu Tư' })
            .setTimestamp(),

        // Page 4 - RPG Nhập vai
        new EmbedBuilder()
            .setTitle('⚔️ Nhập vai RPG & Pokemon')
            .setDescription('Hệ thống cày cuốc đánh quái, nâng cấp nhân vật, mua trang bị và săn bắt Pokemon!')
            .addFields(
                { name: '🗡️ HỆ THỐNG NHÂN VẬT', value: `\`${prefix}pr [@user]\` hoặc \`/profile\` — Xem hồ sơ: Level, HP, ATK, DEF, EXP, trang bị đang mang, trạng thái hôn nhân.\n\`${prefix}hu\` hoặc \`/hunt\` — Đi săn quái vật để nhận EXP + coin. Quái càng mạnh → thưởng càng lớn.\n\`${prefix}heal\` hoặc \`/heal\` — Hồi phục HP bằng coin (cần khi HP thấp sau khi đánh quái).`, inline: false },
                { name: '🎒 TRANG BỊ & CỬA HÀNG', value: `\`${prefix}i\` hoặc \`/inv\` — Xem túi đồ (vũ khí, giáp, nhẫn, bóng Pokemon...)\n\`${prefix}sh\` hoặc \`/shop\` — Cửa hàng có nhiều tab:\n• ⚔️ **Vũ khí** — Tăng sát thương khi đánh quái\n• 🛡️ **Giáp** — Tăng phòng thủ, giảm sát thương nhận\n• 🔮 **Bóng Pokemon** — Mua bóng để bắt Pokemon hoang dã\n• 💍 **Nhẫn** — Dùng để cầu hôn`, inline: false },
                { name: '🐾 HỆ THỐNG POKEMON', value: `\`${prefix}cp\` hoặc \`/catchpet\` — Bắt Pokemon hoang dã (cần có bóng trong túi)\n\`${prefix}p\` hoặc \`/pets\` — Xem chuồng thú cưng của bạn\n\`${prefix}sp\` hoặc \`/sellpet\` — Bán Pokemon lấy coin\n\`${prefix}pb @user <cược>\` hoặc \`/petbattle\` — Thách đấu Pokemon với người khác\n\`${prefix}pt @user\` hoặc \`/ptrade\` — Trao đổi Pokemon 1:1 với người khác\n\n🌟 **Pokemon hoang dã** sẽ tự xuất hiện ngẫu nhiên (1–2 tiếng/lần). Nhấn nút **Ném Bóng** để bắt!`, inline: false }
            )
            .setColor('#E67E22')
            .setFooter({ text: 'Trang 5/10 • RPG Nhập vai' })
            .setTimestamp(),

        // Page 5 - Kết hôn
        new EmbedBuilder()
            .setTitle('💍 Hệ Thống Kết Hôn')
            .setDescription('Mua nhẫn, cầu hôn người ấy, xem bạn đời và ly hôn khi cần!')
            .addFields(
                { name: '💍 Bảng giá nhẫn (mua tại `/shop` → tab 💍)', value: '🌿 **Nhẫn Cỏ** — 10,000 🪙 (cơ bản)\n🥈 **Nhẫn Bạc** — 250,000 🪙\n🥇 **Nhẫn Vàng** — 1,000,000 🪙\n💎 **Nhẫn Kim Cương** — 5,000,000 🪙\n👑 **Nhẫn Vô Cực** — 20,000,000 🪙 (sang nhất!)', inline: true },
                { name: '📜 Các lệnh kết hôn', value: `\`${prefix}marry @user\` hoặc \`/marry @user\`\n→ Cầu hôn người bạn tag, chọn nhẫn muốn dùng.\n\n\`${prefix}marry\` (không tag ai)\n→ Cầu hôn ngẫu nhiên 1 người trong server.\n\n\`${prefix}divorce\` hoặc \`/divorce\`\n→ Ly hôn (phí **1,000,000 🪙**).\n\n\`${prefix}pr\` hoặc \`/profile\`\n→ Xem trạng thái hôn nhân trong hồ sơ.`, inline: true },
                { name: '💡 Quy trình cầu hôn', value: '1️⃣ Mua nhẫn tại `/shop` → chọn tab 💍 Nhẫn\n2️⃣ Dùng `/marry @người_ấy` → Chọn nhẫn muốn dùng từ túi đồ\n3️⃣ Đối phương nhấn nút **Đồng ý** hoặc **Từ chối** (có 60 giây)\n4️⃣ Nếu đồng ý → Chúc mừng! Đã kết hôn 💑\n\n⚠️ Mỗi người chỉ được kết hôn với **1 người** cùng lúc.', inline: false }
            )
            .setColor('#FF69B4')
            .setFooter({ text: 'Trang 6/10 • Kết Hôn' })
            .setTimestamp(),

        // Page 6 - Game Ma Sói
        new EmbedBuilder()
            .setTitle('🐺 Game Ma Sói (Werewolf)')
            .setDescription('Tổ chức game Ma Sói ngay trong Discord! Trò chơi suy luận và đối kháng nhiều người.')
            .addFields(
                { name: `\`${prefix}masoi\` hoặc \`/masoi\``, value: '🎮 **Mở phòng chờ** game Ma Sói:\n• Cần tối thiểu **4 người chơi** để bắt đầu.\n• Host (người tạo) nhấn nút **Bắt đầu** khi đủ người.\n• Các vai được **chia ngẫu nhiên qua tin nhắn riêng (DM)**.\n• Trò chơi diễn ra theo chu kỳ **Đêm → Ngày**:\n  🌙 Đêm: Ma Sói chọn nạn nhân, các vai đặc biệt hành động.\n  ☀️ Ngày: Thảo luận 60 giây → Vote treo cổ kẻ tình nghi.', inline: false },
                { name: `\`${prefix}wwstop\` hoặc \`/wwstop\``, value: '🛑 Hủy game Ma Sói đang diễn ra.\n• Chỉ **Host** (người tạo phòng) hoặc **Admin** mới được hủy.', inline: false },
                { name: '🎭 Các vai trò trong game', value: '🐺 **Ma Sói** — Mỗi đêm chọn 1 người để giết.\n👨‍⚕️ **Bác Sĩ** — Mỗi đêm chọn 1 người để bảo vệ (cứu khỏi bị giết).\n🔮 **Tiên Tri** — Mỗi đêm soi 1 người để biết vai trò thật.\n🏹 **Thợ Săn** — Khi chết, được kéo theo 1 người cùng chết.\n👤 **Dân Làng** — Không có kỹ năng, nhưng phải suy luận để vote đúng.', inline: false },
                { name: '🏆 Phần thưởng', value: '• 🏅 Tham gia: **+10,000 🪙** (cho tất cả)\n• 🎉 Thắng phe Dân: **+100,000 🪙**\n• 🐺 Thắng phe Sói: **+300,000 🪙**', inline: false }
            )
            .setColor('#34495E')
            .setFooter({ text: 'Trang 7/10 • Game Ma Sói' })
            .setTimestamp(),

        // Page 7 - Tiện ích User
        new EmbedBuilder()
            .setTitle('📱 Tiện Ích & Voice (J2C)')
            .setDescription('Các tính năng tự động, công cụ tiện lợi và hệ thống tự tạo phòng Voice.')
            .addFields(
                { name: `\`${prefix}av [@user]\` hoặc \`/av\``, value: '🖼️ Hiển thị **Avatar** (ảnh đại diện) ở kích thước lớn nhất.\nKèm thông tin: ngày tạo tài khoản Discord, ngày tham gia server.\nKhông tag ai → xem avatar của chính bạn.', inline: false },
                { name: '📱 Tải Video TikTok (Tự động)', value: 'Chỉ cần **dán link TikTok** vào bất kỳ kênh chat nào, bot sẽ tự động:\n1. Phát hiện link TikTok\n2. Tải video **không watermark**\n3. Gửi video + thông tin (tên tác giả, lượt thích, lượt xem)\n\n✅ Không cần gõ lệnh gì cả!', inline: false },
                { name: '🎧 Join To Create (J2C) — Tự tạo phòng Voice', value: `Vào kênh voice **"Tạo Phòng"** → Bot tự tạo phòng riêng cho bạn.\n\n**Bảng điều khiển phòng (các nút bấm):**\n📝 **Đổi tên** — Đặt tên phòng theo ý muốn\n👥 **Giới hạn** — Giới hạn số người (0 = không giới hạn)\n👻 **Khóa ẩn** — Ẩn phòng khỏi danh sách (không ai thấy)\n🔒 **Khóa kết nối** — Không ai vào được nữa\n👢 **Kích User** — Chọn và đá 1 người ra khỏi phòng\n👑 **Nhận quyền Chủ phòng** — Nếu chủ phòng rời, người khác có thể nhận quyền\n\n🚫 \`/1an @user\` — Ẩn phòng với 1 người cụ thể (họ không thấy phòng bạn)\n\n💡 **MẸO:** Phòng đang khóa nhưng muốn cho bạn bè vào? **@mention** tên họ vào kênh chat của phòng Voice!`, inline: false },
                { name: '🔔 Tính năng tự động', value: '• 🎙️ **Thông báo Voice** — Bot báo khi có người vào/rời kênh thoại.\n• 👋 **Chào mừng** — Bot chào mừng thành viên mới tham gia server.\n• 🤖 **Auto-reply** — Bot tự trả lời khi ai gõ: `ping`, `hello`, `moonie`.', inline: false }
            )
            .setColor('#00FF88')
            .setFooter({ text: 'Trang 8/10 • Tiện ích & Voice' })
            .setTimestamp(),

        // Page 8 - Admin Quản lý
        new EmbedBuilder()
            .setTitle('🔧 Quản Lý (Admin)')
            .setDescription('⚠️ Các lệnh bên dưới yêu cầu quyền **Administrator** hoặc là **Admin Chính** của bot.')
            .addFields(
                { name: '💰 Quản lý Coin của thành viên', value: `\`${prefix}addcoin @user <số>\` hoặc \`/addcoin\` — Cộng thêm coin cho 1 người\n\`${prefix}removecoin @user <số>\` hoặc \`/removecoin\` — Trừ bớt coin của 1 người\n\`${prefix}setcoin @user <số>\` hoặc \`/setcoin\` — Đặt chính xác số coin cho 1 người\n\`${prefix}resetcoin @user\` hoặc \`/resetcoin\` — Reset coin 1 người về 500,000\n\`${prefix}resetallcoin\` hoặc \`/resetallcoin\` — ⚠️ Reset coin **toàn bộ server** về 500,000\n\`${prefix}giveall <số>\` — Phát <số> coin cho **tất cả** thành viên (Chỉ Admin Chính)`, inline: false },
                { name: '🛠️ Quản lý Server', value: `\`${prefix}clear <1-100>\` hoặc \`/clear\` — Xóa hàng loạt tin nhắn (từ 1 đến 100 tin)\n\`${prefix}say #kênh <nội dung>\` hoặc \`/say\` — Bot gửi tin nhắn vào kênh bạn chọn, thay mặt bot\n\`${prefix}resetwork @user\` hoặc \`/resetwork\` — Xóa cooldown làm việc cho 1 người (để họ work lại ngay)`, inline: false },
                { name: '💳 QR Ngân Hàng', value: `\`${prefix}qr <số tiền>\` hoặc \`/qr\` — Tạo mã QR chuyển khoản ngân hàng thật\n*(Chỉ Admin Chính — số tài khoản cấu hình trong .env)*`, inline: false }
            )
            .setColor('#FF4444')
            .setFooter({ text: 'Trang 9/10 • Admin Quản Lý' })
            .setTimestamp(),

        // Page 9 - Admin Hệ thống
        new EmbedBuilder()
            .setTitle('⚙️ Hệ Thống & Cài Đặt (Admin)')
            .setDescription('Quản lý sự kiện, cài đặt tính năng bot và đặc quyền Admin Chính.')
            .addFields(
                { name: '🎁 Sự kiện Giveaway', value: `\`${prefix}gstart <thời gian> <số người thắng> <tên giải>\`\n→ Bắt đầu Giveaway. Ví dụ: \`${prefix}gstart 1h 1 Nitro Classic\`\n• Thời gian hỗ trợ: \`30s\`, \`5m\`, \`1h\`, \`1d\`...\n\n\`/gend <message_id>\` — Kết thúc Giveaway sớm\n\`/greroll <message_id>\` — Chọn lại người thắng`, inline: false },
                { name: '⚙️ Cài đặt Bot', value: `\`${prefix}setprefix <dấu mới>\` — Đổi prefix bot (ví dụ: \`${prefix}setprefix !\`)\n\`/setwelcome #kênh [lời chào] [link ảnh]\` — Cài đặt kênh + tin nhắn chào mừng thành viên mới\n\`/setspawnchannel #channel\` — Đặt kênh xuất hiện Pokemon hoang dã\n\`/setuppokemonrole\` — Tạo role "Pokemon" để ping khi có Pokemon hiếm xuất hiện\n\`${prefix}spawnpet\` — Ép xuất hiện 1 Pokemon hiếm ngay lập tức (Admin)\n\`/addpetvip @user <pet_id>\` — Tặng trực tiếp 1 pet VIP cho user\n\`/togglevoice\` — Bật/Tắt thông báo người ra vào kênh thoại`, inline: false },
                { name: '👑 Admin Cheat Panel (Chỉ Admin Chính)', value: `\`${prefix}admincheat\` hoặc \`/admincheat\`\nMở bảng điều khiển đặc biệt:\n• 🎰 Bật/Tắt chế độ **luôn thắng** tất cả trò cờ bạc\n• ⏱️ Bỏ qua mọi cooldown (daily, work...)\n• Các quyền năng đặc biệt khác`, inline: false },
                { name: '🤖 Tính năng tự động hệ thống', value: '• Bot tự **chào mừng thành viên mới** (nếu đã cài `/setwelcome`)\n• Bot tự **ghi log voice** (ai vào/rời kênh thoại)\n• Bot tự **reply từ khóa** mặc định: `ping` → pong!, `hello` → Xin chào!\n• Bot tự **xóa phòng J2C trống** khi không còn ai trong phòng\n• Bot tự **xổ số lô đề** lúc 18h30 hằng ngày', inline: false }
            )
            .setColor('#9B59B6')
            .setFooter({ text: 'Trang 10/10 • Admin Hệ thống' })
            .setTimestamp()
    ];
}

function buildHelpMenu() {
    return new StringSelectMenuBuilder()
        .setCustomId('help_menu')
        .setPlaceholder('📂 Chọn danh mục muốn xem...')
        .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('📖 Tổng quan').setValue('0').setDescription('Danh sách tất cả tính năng').setEmoji('📖'),
            new StringSelectMenuOptionBuilder().setLabel('🎵 Nhạc YouTube').setValue('1').setDescription('Phát nhạc, skip, stop, queue...').setEmoji('🎵'),
            new StringSelectMenuOptionBuilder().setLabel('💰 Coin & Minigame').setValue('2').setDescription('Daily, Tài Xỉu, Blackjack, Đoán số...').setEmoji('💰'),
            new StringSelectMenuOptionBuilder().setLabel('🏦 Ngân Hàng & Đầu Tư').setValue('3').setDescription('Bank, gửi/rút tiền, đầu tư cổ phiếu...').setEmoji('🏦'),
            new StringSelectMenuOptionBuilder().setLabel('⚔️ RPG Nhập vai').setValue('4').setDescription('Đi săn, mua trang bị, shop nhẫn...').setEmoji('⚔️'),
            new StringSelectMenuOptionBuilder().setLabel('💍 Kết Hôn & Ly Hôn').setValue('5').setDescription('Marry, divorce, mua nhẫn...').setEmoji('💍'),
            new StringSelectMenuOptionBuilder().setLabel('🐺 Game Ma Sói').setValue('6').setDescription('Tạo phòng, chia vai, vote ngày đêm...').setEmoji('🐺'),
            new StringSelectMenuOptionBuilder().setLabel('📱 Tiện ích').setValue('7').setDescription('TikTok, thông báo voice, auto-reply...').setEmoji('📱'),
            new StringSelectMenuOptionBuilder().setLabel('🔧 Admin: Quản lý').setValue('8').setDescription('Quản lý Coin, Xóa tin nhắn, QR...').setEmoji('🔧'),
            new StringSelectMenuOptionBuilder().setLabel('⚙️ Admin: Hệ thống').setValue('9').setDescription('Giveaway, Prefix, Admin Cheat...').setEmoji('⚙️')
        );
}


// ========================
// MUSIC QUEUE SYSTEM
// ========================
// Map<guildId, { queue: [], player, connection, playing }>
const musicQueues = new Map();

function getQueue(guildId) {
    if (!musicQueues.has(guildId)) {
        musicQueues.set(guildId, {
            queue: [],
            player: null,
            connection: null,
            djId: null,        // ID người gọi /play
            controlMsg: null,  // Tin nhắn panel điều khiển
            paused: false,     // Trạng thái tạm dừng
            volume: 1.0,       // Âm lượng (0.0 - 2.0 tương đương 0-200%)
            resource: null,    // AudioResource hiện tại
            loop: false        // Vòng lặp bài hát
        });
    }
    return musicQueues.get(guildId);
}

// Tạo panel nút điều khiển nhạc (2 hàng)
function buildMusicControls(paused = false, volume = 1.0, loop = false) {
    const volPct = Math.round(volume * 100);
    const filledBlocks = Math.min(5, Math.max(0, Math.round(volPct / 20)));
    const volBar = '█'.repeat(filledBlocks) + '░'.repeat(5 - filledBlocks);

    // Hàng 1: Điều khiển phát
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('music_toggle')
            .setLabel(paused ? '▶ Tiếp tục' : '⏸ Tạm dừng')
            .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('music_skip')
            .setLabel('⏭ Bỏ qua')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_stop')
            .setLabel('⏹ Dừng hẳn')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('music_queue')
            .setLabel('📋 Hàng đợi')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('music_loop')
            .setLabel(loop ? '🔁 Tắt lặp' : '🔁 Lặp bài')
            .setStyle(loop ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    // Hàng 2: Điều khiển âm lượng
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('music_vol_down')
            .setLabel('🔉 -10%')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(volPct <= 0),
        new ButtonBuilder()
            .setCustomId('music_vol_display')
            .setLabel(`🔊 ${volBar} ${volPct}%`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('music_vol_up')
            .setLabel('🔊 +10%')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(volPct >= 200)
    );

    return [row1, row2];
}

async function playNext(guildId, textChannel) {
    const state = getQueue(guildId);
    if (!state.queue.length) {
        // Xóa panel điều khiển cũ nếu có
        if (state.controlMsg) {
            state.controlMsg.edit({ components: [] }).catch(() => {});
            state.controlMsg = null;
        }
        if (state.connection) {
            setTimeout(() => {
                const s = getQueue(guildId);
                if (!s.queue.length) {
                    s.connection?.destroy();
                    musicQueues.delete(guildId);
                }
            }, 30000);
        }
        if (state.connection && state.connection.joinConfig.channelId) {
            try {
                await client.rest.put(`/channels/${state.connection.joinConfig.channelId}/voice-status`, {
                    body: { status: 'Moonie tới đâyyy 💕 (✿◡‿◡)' }
                });
            } catch (err) {}
        }
        textChannel?.send('✅ Đã phát hết danh sách nhạc! Bot sẽ rời kênh sau 30 giây.');
        return;
    }

    const song = state.queue[0];
    state.paused = false;

    try {
        const audioStream = ytdlpStream(song.url);
        const resource = createAudioResource(audioStream, { inlineVolume: true });
        // Áp dụng âm lượng hiện tại
        resource.volume?.setVolume(state.volume);
        state.resource = resource;

        resource.playStream.on('error', (err) => {
            console.error('Lỗi resource playStream:', err);
        });

        if (!state.player) {
            state.player = createAudioPlayer();
            state.connection.subscribe(state.player);

            state.player.on(AudioPlayerStatus.Idle, () => {
                if (!state.loop) state.queue.shift();
                playNext(guildId, textChannel);
            });

            state.player.on('error', (err) => {
                console.error('Lỗi audio player:', err);
                state.queue.shift();
                playNext(guildId, textChannel);
            });
        }

        state.player.play(resource);

        try {
            if (state.connection && state.connection.joinConfig.channelId) {
                let songTitleStatus = `Đang phát: ${song.title} 🎶`;
                if (songTitleStatus.length > 500) songTitleStatus = songTitleStatus.substring(0, 497) + '...';
                await client.rest.put(`/channels/${state.connection.joinConfig.channelId}/voice-status`, {
                    body: { status: songTitleStatus }
                });
            }
        } catch (err) {
            console.error('Không thể cập nhật trạng thái bài hát:', err);
        }

        const embed = new EmbedBuilder()
            .setTitle('🎵 Đang phát nhạc')
            .setDescription(`**[${song.title}](${song.url})**`)
            .addFields(
                { name: '⏱ Thời lượng', value: song.duration || 'N/A', inline: true },
                { name: '👤 Yêu cầu bởi', value: `<@${song.requestedById}>`, inline: true },
                { name: '📋 Hàng đợi', value: `${state.queue.length} bài`, inline: true },
                { name: '🔊 Âm lượng', value: `${Math.round(state.volume * 100)}%`, inline: true }
            )
            .setThumbnail(song.thumbnail)
            .setColor('#FF0000')
            .setFooter({ text: `🎶 Chỉ <@!${state.djId}> mới điều khiển được nhạc này` });

        const controls = buildMusicControls(false, state.volume, state.loop);

        // Nếu đã có panel, update lại (giữ nguyên tin nhắn)
        if (state.controlMsg) {
            await state.controlMsg.edit({ embeds: [embed], components: controls }).catch(async () => {
                state.controlMsg = await textChannel?.send({ embeds: [embed], components: controls });
            });
        } else {
            state.controlMsg = await textChannel?.send({ embeds: [embed], components: controls });
        }
    } catch (err) {
        console.error('Lỗi khi phát nhạc:', err);
        textChannel?.send(`❌ Không thể phát bài **${song.title}**. Đang bỏ qua...`);
        state.queue.shift();
        playNext(guildId, textChannel);
    }
}

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
// COIN SYSTEM
// ========================
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
    data[userId].bank = Math.floor((data[userId].bank || 0) + amount);
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

    data[userId].coins += totalReward;
    data[userId].lastDaily = now;
    data[userId].streak = streak;
    saveCoins(data);
    return { success: true, reward: totalReward, baseReward, bonus, streak, total: data[userId].coins };
}

function getLeaderboard() {
    const data = loadCoins();
    return Object.entries(data)
        .map(([id, d]) => ({ id, coins: (d.coins || 0) + (d.bank || 0) }))
        .sort((a, b) => b.coins - a.coins)
        .slice(0, 10);
}

function buildLeaderboardEmbed(client) {
    const lb = getLeaderboard();
    if (!lb.length) return new EmbedBuilder().setTitle('🏆 BẢNG XẾP HẠNG').setDescription('Chưa có ai có tài sản!').setColor('#FFD700');
    
    const embed = new EmbedBuilder()
        .setTitle('🏆 BẢNG XẾP HẠNG ĐẠI GIA 🏆')
        .setDescription('Top 10 người giàu nhất server (Bao gồm Tiền mặt + Ngân hàng)\n\n━━━━━━━━━━━━━━━━━━━━━━')
        .setColor('#FFD700')
        .setThumbnail(client.user.displayAvatarURL());

    lb.forEach((e, i) => {
        if (i === 0) {
            embed.addFields({ name: `🥇 ĐẠI TỶ PHÚ TOP 1`, value: `**<@${e.id}>**\n💰 **${e.coins.toLocaleString()}** 🪙`, inline: false });
        } else if (i === 1) {
            embed.addFields({ name: `🥈 Á QUÂN TOP 2`, value: `**<@${e.id}>**\n💰 **${e.coins.toLocaleString()}** 🪙`, inline: true });
        } else if (i === 2) {
            embed.addFields({ name: `🥉 QUÝ TỘC TOP 3`, value: `**<@${e.id}>**\n💰 **${e.coins.toLocaleString()}** 🪙`, inline: true });
        } else {
            if (i === 3) embed.addFields({ name: '\u200b', value: '━━━━━━━━━━━━━━━━━━━━━━', inline: false });
            embed.addFields({ name: `🏅 Hạng ${i+1}`, value: `<@${e.id}>\n${e.coins.toLocaleString()} 🪙`, inline: true });
        }
    });

    embed.setFooter({ text: 'Cập nhật thời gian thực' }).setTimestamp();
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
        .setFooter({ text: 'Hệ thống Ngân hàng Moonie 🌙' });
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
        user.coins += reward;
        saveCoins(data);
        const embedCheat = new EmbedBuilder()
            .setTitle('👑 [CHEAT] Hoàn thành công việc tức thì!')
            .setDescription(`Búng tay một cái, Đấng Sáng Tạo đã làm xong **${job.name}** ${job.emoji} và đút túi luôn **${reward.toLocaleString()} 🪙**!`)
            .setColor('#FF0000');
        return msgOrInteraction.reply({ embeds: [embedCheat] });
    }

    if (user.workEnd) {
        if (now >= user.workEnd) {
            const reward = user.workReward || 0;
            const jobName = user.workJob || 'Công việc';
            user.coins += reward;
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
        'diamond_sword': { name: 'Kiếm Kim Cương', atk: 70, price: 10000000, emoji: '💠' }
    },
    armors: {
        'leather_armor': { name: 'Giáp Da', def: 5, price: 500000, emoji: '🦺' },
        'iron_armor': { name: 'Giáp Sắt', def: 15, price: 1500000, emoji: '🛡️' },
        'steel_armor': { name: 'Giáp Thép', def: 30, price: 4000000, emoji: '🦾' },
        'diamond_armor': { name: 'Giáp Kim Cương', def: 70, price: 15000000, emoji: '💎' }
    },
    potions: {
        'small_potion': { name: 'Bình Máu Nhỏ', heal: 50, price: 10000, emoji: '🧪' },
        'large_potion': { name: 'Bình Máu Lớn', heal: 150, price: 50000, emoji: '💊' }
    },
    pokeballs: {
        'basic_ball': { name: 'Bóng Thường', catchRate: 0.3, price: 10000, emoji: '🔴' },
        'great_ball': { name: 'Bóng Siêu Cấp', catchRate: 0.5, price: 50000, emoji: '🔵' },
        'ultra_ball': { name: 'Bóng Tối Thượng', catchRate: 0.8, price: 200000, emoji: '🟡' },
        'master_ball': { name: 'Bóng Vô Cực', catchRate: 1.0, price: 1000000, emoji: '🟣' }
    }
};

const MONSTERS = [
    { name: 'Slime Nhỏ', hp: 30, atk: 5, def: 2, exp: 10, coin: 20, emoji: '💧' },
    { name: 'Yêu Tinh Goblin', hp: 60, atk: 12, def: 5, exp: 25, coin: 50, emoji: '👺' },
    { name: 'Sói Hoang', hp: 100, atk: 25, def: 10, exp: 40, coin: 80, emoji: '🐺' },
    { name: 'Chiến Binh Orc', hp: 200, atk: 40, def: 20, exp: 80, coin: 150, emoji: '👹' },
    { name: 'Hồn Ma', hp: 350, atk: 60, def: 15, exp: 120, coin: 250, emoji: '👻' },
    { name: 'Rồng Con', hp: 600, atk: 90, def: 40, exp: 200, coin: 400, emoji: '🐉' }
];

const PET_LIST = [
    { id: 'bulbasaur', name: 'Bulbasaur', rarity: 'Thường', price: 5000, emoji: '🐸', weight: 50 },
    { id: 'charmander', name: 'Charmander', rarity: 'Thường', price: 5000, emoji: '🦎', weight: 50 },
    { id: 'squirtle', name: 'Squirtle', rarity: 'Thường', price: 5000, emoji: '🐢', weight: 50 },
    { id: 'pikachu', name: 'Pikachu', rarity: 'Hiếm', price: 20000, emoji: '⚡', weight: 30 },
    { id: 'eevee', name: 'Eevee', rarity: 'Hiếm', price: 20000, emoji: '🦊', weight: 30 },
    { id: 'snorlax', name: 'Snorlax', rarity: 'Hiếm', price: 25000, emoji: '🐻', weight: 25 },
    { id: 'lapras', name: 'Lapras', rarity: 'Hiếm', price: 25000, emoji: '🦕', weight: 25 },
    { id: 'charizard', name: 'Charizard', rarity: 'Cực Hiếm', price: 80000, emoji: '🔥', weight: 15 },
    { id: 'dragonite', name: 'Dragonite', rarity: 'Cực Hiếm', price: 80000, emoji: '🐉', weight: 15 },
    { id: 'tyranitar', name: 'Tyranitar', rarity: 'Cực Hiếm', price: 85000, emoji: '🦖', weight: 12 },
    { id: 'garchomp', name: 'Garchomp', rarity: 'Cực Hiếm', price: 85000, emoji: '🦈', weight: 12 },
    { id: 'lugia', name: 'Lugia', rarity: 'Thần Thoại', price: 300000, emoji: '🌊', weight: 4 },
    { id: 'mew', name: 'Mew', rarity: 'Thần Thoại', price: 350000, emoji: '🌸', weight: 4 },
    { id: 'celebi', name: 'Celebi', rarity: 'Thần Thoại', price: 350000, emoji: '🌱', weight: 4 },
    { id: 'jirachi', name: 'Jirachi', rarity: 'Thần Thoại', price: 350000, emoji: '⭐', weight: 4 },
    { id: 'rayquaza', name: 'Rayquaza', rarity: 'Huyền Thoại', price: 1000000, emoji: '🌪️', weight: 1 },
    { id: 'mewtwo', name: 'Mewtwo', rarity: 'Huyền Thoại', price: 1000000, emoji: '🧬', weight: 1 },
    { id: 'groudon', name: 'Groudon', rarity: 'Huyền Thoại', price: 1000000, emoji: '🌋', weight: 1 },
    { id: 'kyogre', name: 'Kyogre', rarity: 'Huyền Thoại', price: 1000000, emoji: '🐋', weight: 1 },
    { id: 'dialga', name: 'Dialga', rarity: 'Huyền Thoại', price: 1000000, emoji: '⏳', weight: 1 },
    { id: 'palkia', name: 'Palkia', rarity: 'Huyền Thoại', price: 1000000, emoji: '🌌', weight: 1 },
    { id: 'giratina', name: 'Giratina', rarity: 'Huyền Thoại', price: 1200000, emoji: '🌑', weight: 0.8 },
    { id: 'arceus', name: 'Arceus', rarity: 'Đấng Sáng Tạo', price: 5000000, emoji: '✨', weight: 0.2 }
];

function loadRPG() {
    if (!fs.existsSync(rpgPath)) return {};
    try { return JSON.parse(fs.readFileSync(rpgPath, 'utf8')); } catch { return {}; }
}
function saveRPG(data) { fs.writeFileSync(rpgPath, JSON.stringify(data, null, 2)); }

function loadConfig() {
    if (!fs.existsSync(configPath)) return {};
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { return {}; }
}
function saveConfig(data) { fs.writeFileSync(configPath, JSON.stringify(data, null, 2)); }

function getPlayer(userId) {
    const data = loadRPG();
    if (!data[userId]) {
        data[userId] = {
            level: 1, exp: 0, 
            hp: 100, maxHp: 100,
            baseAtk: 10, baseDef: 5,
            weapon: null, armor: null,
            inventory: { small_potion: 0, large_potion: 0 },
            lastHunt: 0,
            lastCatch: 0,
            pets: {},
            partner: null,
            investAmount: 0,
            investTime: 0
        };
        saveRPG(data);
    } else {
        let changed = false;
        if (!data[userId].pets) { data[userId].pets = {}; changed = true; }
        if (data[userId].lastCatch === undefined) { data[userId].lastCatch = 0; changed = true; }
        if (data[userId].partner === undefined) { data[userId].partner = null; changed = true; }
        if (data[userId].investAmount === undefined) { data[userId].investAmount = 0; changed = true; }
        if (data[userId].investTime === undefined) { data[userId].investTime = 0; changed = true; }
        if (changed) saveRPG(data);
    }
    return data[userId];
}

function updatePlayer(userId, updater) {
    const data = loadRPG();
    if (!data[userId]) {
        getPlayer(userId); // will create and save
        Object.assign(data, loadRPG()); // reload to get the newly created user
    }
    updater(data[userId]);
    // Check level up
    let p = data[userId];
    const expNeeded = p.level * 100;
    if (p.exp >= expNeeded) {
        p.exp -= expNeeded;
        p.level++;
        p.maxHp += 20;
        p.hp = p.maxHp;
        p.baseAtk += 3;
        p.baseDef += 2;
    }
    saveRPG(data);
    return data[userId];
}

function getPlayerStats(p) {
    let atk = p.baseAtk;
    let def = p.baseDef;
    if (p.weapon) atk += RPG_ITEMS.weapons[p.weapon].atk;
    if (p.armor) def += RPG_ITEMS.armors[p.armor].def;
    return { atk, def };
}

function buildProfileEmbed(user) {
    const uid = user.id;
    const cData = loadCoins();
    const pData = getPlayer(uid);
    const stats = getPlayerStats(pData);
    
    const c = cData[uid] || { coins: 0, bank: 0, streak: 0 };
    const coins = c.coins || 0;
    const bank = c.bank || 0;
    const streak = c.streak || 0;
    
    let marryText = 'Đang độc thân 💔';
    if (pData.partner) marryText = `Đã kết hôn với <@${pData.partner}> 💍`;

    let jobText = 'Đang rảnh rỗi';
    if (c.workEnd && c.workJob) {
        if (Date.now() < c.workEnd) {
            const m = Math.floor((c.workEnd - Date.now())/60000);
            jobText = `Đang làm: **${c.workJob}** (${m}p nữa)`;
        } else {
            jobText = `Đã làm xong: **${c.workJob}** (Chờ nhận lương)`;
        }
    }

    const wName = pData.weapon ? RPG_ITEMS.weapons[pData.weapon].name : 'Tay không';
    const aName = pData.armor ? RPG_ITEMS.armors[pData.armor].name : 'Đồ vải';
    const smallPot = pData.inventory?.small_potion || 0;
    const largePot = pData.inventory?.large_potion || 0;

    let petsText = 'Không có thú cưng 😢';
    if (pData.pets && Object.keys(pData.pets).length > 0) {
        const petStrs = [];
        for (const pid of Object.keys(pData.pets)) {
            const petInfo = PET_LIST.find(x => x.id === pid);
            if (petInfo) petStrs.push(`${petInfo.emoji} ${petInfo.name} (x${pData.pets[pid]})`);
        }
        if (petStrs.length > 0) petsText = petStrs.join(', ');
    }

    const embed = new EmbedBuilder()
        .setTitle(`👤 Hồ Sơ Toàn Diện: ${user.username}`)
        .setColor('#9B59B6')
        .setThumbnail(user.displayAvatarURL())
        .addFields(
            { name: '💰 Tài Sản', value: `Tiền mặt: **${coins.toLocaleString()} 🪙**\nNgân hàng: **${bank.toLocaleString()} 🪙**`, inline: true },
            { name: '🔥 Hoạt Động', value: `Điểm danh: **${streak}** ngày\nCông việc: ${jobText}`, inline: true },
            { name: '💍 Hôn Nhân', value: marryText, inline: false }
        );

    let attachment = null;
    let bdayText = 'Chưa cài đặt';
    if (pData.birthday) {
        bdayText = `**${pData.birthday}**`;
        const today = new Date();
        const d = today.getDate().toString().padStart(2, '0');
        const m = (today.getMonth() + 1).toString().padStart(2, '0');
        if (`${d}/${m}` === pData.birthday) {
            embed.setTitle(`🎉 CHÚC MỪNG SINH NHẬT ${user.username.toUpperCase()} 🎉`);
            embed.setColor('#FF69B4');
            try {
                attachment = new AttachmentBuilder('./birthday.png', { name: 'birthday.png' });
                embed.setImage('attachment://birthday.png');
            } catch (e) {}
        }
    }

    embed.addFields(
        { name: '🎂 Ngày sinh', value: bdayText, inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: '🔰 RPG (Nhập Vai)', value: `Cấp: **${pData.level}** (${pData.exp}/${pData.level*100} EXP)\nMáu: ❤️ **${pData.hp}/${pData.maxHp}**\nSức mạnh: ⚔️ **${stats.atk}** | 🛡️ **${stats.def}**`, inline: true },
        { name: '🎒 Túi Đồ', value: `Vũ khí: ${wName}\nÁo giáp: ${aName}\nBình máu: 🧪x${smallPot} | 🧴x${largePot}`, inline: true },
        { name: '🐾 Thú Cưng', value: petsText, inline: false }
    ).setTimestamp();

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
            .setFooter({ text: 'Chọn nhẫn từ menu bên dưới để mua' });
    }
    return new EmbedBuilder()
        .setTitle('🛒 Cửa Hàng RPG')
        .setDescription('Vui lòng chọn danh mục và món đồ bạn muốn mua.\n\n> 💰 Giá sẽ tự động trừ vào Coin của bạn!')
        .setColor('#3498DB')
        .setFooter({ text: 'Chọn tab ở trên để xem Nhẫn kết hôn' });
}

function buildShopCategoryRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('shop_tab_rpg').setLabel('⚔️ Trang Bị RPG').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('shop_tab_pet').setLabel('🐾 Bắt Pet').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('shop_tab_ring').setLabel('💍 Nhẫn Kết Hôn').setStyle(ButtonStyle.Secondary)
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
    let currentTab = 'rpg';

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
        if (i.user.id !== userId) return i.reply({ content: '❌ Cửa hàng này không phải của bạn!', ephemeral: true });

        // Tab buttons
        if (i.customId === 'shop_tab_rpg' || i.customId === 'shop_tab_ring' || i.customId === 'shop_tab_pet') {
            if (i.customId === 'shop_tab_ring') currentTab = 'ring';
            else if (i.customId === 'shop_tab_pet') currentTab = 'pet';
            else currentTab = 'rpg';
            const newEmbed = buildShopEmbed(currentTab);
            const newCatRow = buildShopCategoryRow();
            const newSelectRow = buildShopSelectRow(currentTab);
            return i.update({ embeds: [newEmbed], components: [newCatRow, newSelectRow] });
        }

        // Select menu purchase
        if (i.customId === 'rpg_shop_select') {
            const val = i.values[0];
            const firstUnderscore = val.indexOf('_');
            const type = val.substring(0, firstUnderscore);
            const itemCode = val.substring(firstUnderscore + 1);

            if (type === 'weapon' || type === 'armor' || type === 'ring') {
                let item;
                if (type === 'weapon') item = RPG_ITEMS.weapons[itemCode];
                else if (type === 'armor') item = RPG_ITEMS.armors[itemCode];
                else if (type === 'ring') item = MARRY_RINGS[itemCode];

                if (!item) return i.reply({ content: '❌ Mã món đồ không tồn tại!', ephemeral: true });
                if (getUserCoins(userId) < item.price) return i.reply({ content: `❌ Bạn không đủ Coin! (Cần ${item.price.toLocaleString()} 🪙)`, ephemeral: true });

                addCoins(userId, -item.price);
                updatePlayer(userId, p => {
                    if (type === 'weapon') p.weapon = itemCode;
                    else if (type === 'armor') p.armor = itemCode;
                    else if (type === 'ring') {
                        if (!p.rings) p.rings = {};
                        p.rings[itemCode] = (p.rings[itemCode] || 0) + 1;
                    }
                });

                let msgContent = `✅ Bạn đã mua **${item.emoji} ${item.name}** thành công! Số dư: **${getUserCoins(userId).toLocaleString()} 🪙**`;
                if (type === 'ring') msgContent += `\n> Dùng lệnh \`/marry\` để cầu hôn với nhẫn này!`;

                return i.reply({ content: msgContent, ephemeral: true });
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
        targets.push({ channelId: config.spawnChannelId });
    } else {
        for (const [guildId, channelId] of activeChannels.entries()) {
            targets.push({ guildId, channelId });
        }
    }
    
    for (const target of targets) {
        try {
            const channel = client.channels.cache.get(target.channelId);
            if (!channel) continue;
            
            const RARE_PETS = PET_LIST.filter(p => ['Cực Hiếm', 'Thần Thoại', 'Huyền Thoại', 'Đấng Sáng Tạo'].includes(p.rarity));
            const totalWeight = RARE_PETS.reduce((sum, pet) => sum + pet.weight, 0);
            let rand = Math.random() * totalWeight;
            let spawnPet = null;
            for (const pet of RARE_PETS) {
                if (rand < pet.weight) { spawnPet = pet; break; }
                rand -= pet.weight;
            }
            if (!spawnPet) spawnPet = RARE_PETS[0];
            
            let color = '#FFFFFF';
            if (spawnPet.rarity === 'Thường') color = '#AAB7B8';
            if (spawnPet.rarity === 'Hiếm') color = '#3498DB';
            if (spawnPet.rarity === 'Cực Hiếm') color = '#9B59B6';
            if (spawnPet.rarity === 'Thần Thoại') color = '#E74C3C';
            if (spawnPet.rarity === 'Huyền Thoại') color = '#F1C40F';
            if (spawnPet.rarity === 'Đấng Sáng Tạo') color = '#00FFFF';
            
            const isLegendary = ['Huyền Thoại', 'Đấng Sáng Tạo'].includes(spawnPet.rarity);
            const embedTitle = spawnPet.rarity === 'Đấng Sáng Tạo'
                ? '🌟 ĐẤNG SÁNG TẠO GIÁNG TRẦN!!!'
                : spawnPet.rarity === 'Huyền Thoại'
                ? '🔥 POKEMON HUYỀN THOẠI XUẤT HIỆN!!!'
                : '✨ POKEMON HIẾM XUẤT HIỆN!';
            const embedDesc = isLegendary
                ? `⚠️ **CẢNH BÁO KHẨN CẤP!** ⚠️\nMột Pokemon **${spawnPet.rarity}** cực kỳ hiếm vừa xuất hiện!\nĐộ hiếm: **${spawnPet.rarity}** ✨\n\nĐây là cơ hội ngàn năm có một — Hãy bắt ngay trước khi nó biến mất!`
                : `Một Pokemon vô cùng quý hiếm vừa xuất hiện ở khu vực này!\nĐộ hiếm: **${spawnPet.rarity}**\n\nHãy mau lấy bóng ra bắt nó trước khi nó chạy mất!`;
            const embed = new EmbedBuilder()
                .setTitle(embedTitle)
                .setDescription(embedDesc)
                .setColor(color)
                .setImage('attachment://wild_pokemon_spawn.png');
                
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`wild_catch_${spawnPet.id}`).setLabel('Ném Bóng').setStyle(ButtonStyle.Success).setEmoji('🎯')
            );
            
            const attachment = new AttachmentBuilder('./wild_pokemon_spawn.png', { name: 'wild_pokemon_spawn.png' });
            let msgContent = undefined;
            if (config.pokemonRoleId) msgContent = `<@&${config.pokemonRoleId}>`;
            const msg = await channel.send({ content: msgContent, embeds: [embed], components: [row], files: [attachment] });
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
const CATCH_COOLDOWN = 10 * 60 * 1000; // 10 minutes

async function handleCatchPet(userId, msgOrInteraction) {
    const p = getPlayer(userId);
    const now = Date.now();
    
    const cData = loadCoins();
    const isCheatOn = cData[userId]?.alwaysWin === true;

    if (now - p.lastCatch < CATCH_COOLDOWN && !isCheatOn) {
        const remaining = CATCH_COOLDOWN - (now - p.lastCatch);
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        const msg = `⏳ Các Pokemon khu vực này đã hoảng sợ bỏ chạy. Hãy đợi **${m} phút ${s} giây** nữa để săn tiếp!`;
        return msgOrInteraction.reply ? msgOrInteraction.reply({ content: msg, ephemeral: true }) : msgOrInteraction.channel.send(msg);
    }
    
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
        return msgOrInteraction.reply ? msgOrInteraction.reply({ content: msg, ephemeral: true }) : msgOrInteraction.channel.send(msg);
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
    
    let color = '#FFFFFF';
    if (caughtPet.rarity === 'Thường') color = '#AAB7B8';
    if (caughtPet.rarity === 'Hiếm') color = '#3498DB';
    if (caughtPet.rarity === 'Cực Hiếm') color = '#9B59B6';
    if (caughtPet.rarity === 'Thần Thoại') color = '#E74C3C';
    if (caughtPet.rarity === 'Huyền Thoại') color = '#F1C40F';
    
    const ballObj = RPG_ITEMS.pokeballs[usedBall];
    const embed = new EmbedBuilder()
        .setTitle('🐾 Bắt Thú Thành Công!')
        .setDescription(`Bạn đã ném **${ballObj.emoji} ${ballObj.name}** và bắt được **${caughtPet.emoji} ${caughtPet.name}**!\n\n**Độ Hiếm:** ${caughtPet.rarity}\n**Giá Trị:** ${caughtPet.price.toLocaleString()} 🪙\n\n*(Dùng lệnh \`!pets\` để xem chuồng thú của bạn)*`)
        .setColor(color);
        
    return msgOrInteraction.reply ? msgOrInteraction.reply({ embeds: [embed] }) : msgOrInteraction.channel.send({ embeds: [embed] });
}

async function handlePets(userId, msgOrInteraction) {
    const p = getPlayer(userId);
    const pets = p.pets || {};
    
    let desc = [];
    for (const pet of PET_LIST) {
        const amount = pets[pet.id] || 0;
        if (amount > 0) {
            desc.push(`${pet.emoji} **${pet.name}** (${pet.rarity}): ${amount} con`);
        }
    }
    
    const embed = new EmbedBuilder()
        .setTitle('🏕️ Chuồng Thú Cưng')
        .setColor('#2ECC71')
        .setDescription(desc.length > 0 ? desc.join('\n') : 'Chuồng thú của bạn đang trống trơn! Hãy dùng lệnh `!catch` để bắt thêm.');
        
    return msgOrInteraction.reply ? msgOrInteraction.reply({ embeds: [embed] }) : msgOrInteraction.channel.send({ embeds: [embed] });
}

async function handleSellPet(userId, msgOrInteraction) {
    const p = getPlayer(userId);
    const pets = p.pets || {};
    
    const options = [];
    for (const pet of PET_LIST) {
        const amount = pets[pet.id] || 0;
        if (amount > 0) {
            options.push(new StringSelectMenuOptionBuilder()
                .setLabel(`Bán ${pet.name} (Có: ${amount})`)
                .setValue(`sellpet_${pet.id}`)
                .setDescription(`Giá: ${pet.price.toLocaleString()} 🪙`)
                .setEmoji(pet.emoji));
        }
    }
    
    if (options.length === 0) {
        const msg = '❌ Bạn không có con thú nào để bán cả!';
        return msgOrInteraction.reply ? msgOrInteraction.reply({ content: msg, ephemeral: true }) : msgOrInteraction.channel.send(msg);
    }
    
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
        if (i.user.id !== userId) return i.reply({ content: '❌ Cửa hàng thú này không phải của bạn!', ephemeral: true });
        
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
        
        return i.reply({ content: soldMsg, ephemeral: true });
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
        confirmMsg = await msgOrInteraction.reply({ content: `⚠️ **XÁC NHẬN:** ${promptText}`, components: [row], fetchReply: true });
    } else {
        confirmMsg = await msgOrInteraction.reply({ content: `⚠️ **XÁC NHẬN:** ${promptText}`, components: [row] });
    }

    const filter = i => {
        if (i.user.id !== userId) {
            i.reply({ content: '❌ Bạn không có quyền bấm nút này!', ephemeral: true }).catch(()=>{});
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

const ADMIN_ID = process.env.ADMIN_ID || '1204627726254997546';
const ROB_COOLDOWN = 5 * 60 * 1000; // 5 minutes
const HEIST_COOLDOWN = 4 * 60 * 60 * 1000; // 4 hours

async function handleDeposit(userId, amount, msgOrInteraction) {
    const cash = getUserCoins(userId);
    if (amount === 'all') amount = cash;
    else {
        amount = parseInt(amount);
        if (isNaN(amount) || amount <= 0) return replyMsg(msgOrInteraction, '❌ Số tiền không hợp lệ!');
    }
    if (cash < amount) return replyMsg(msgOrInteraction, `❌ Bạn không có đủ tiền mặt! (Hiện có: **${cash.toLocaleString()} 🪙**)`);
    
    addCoins(userId, -amount);
    addBank(userId, amount);
    return replyMsg(msgOrInteraction, `✅ Đã gửi **${amount.toLocaleString()} 🪙** vào ngân hàng!`);
}

async function handleWithdraw(userId, amount, msgOrInteraction) {
    const bank = getUserBank(userId);
    if (amount === 'all') amount = bank;
    else {
        amount = parseInt(amount);
        if (isNaN(amount) || amount <= 0) return replyMsg(msgOrInteraction, '❌ Số tiền không hợp lệ!');
    }
    if (bank < amount) return replyMsg(msgOrInteraction, `❌ Ngân hàng của bạn không đủ tiền! (Hiện có: **${bank.toLocaleString()} 🪙**)`);
    
    addBank(userId, -amount);
    addCoins(userId, amount);
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
        data[targetId].coins -= stolen;
        data[userId].coins = (data[userId].coins || 0) + stolen;
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

// Invest
async function handleInvest(userId, amount, msgOrInteraction) {
    let p = getPlayer(userId);
    const cash = getUserCoins(userId);
    
    if (amount === 'all') amount = Math.min(cash, 1000000); 
    else {
        amount = parseInt(amount);
        if (isNaN(amount) || amount <= 0) return replyMsg(msgOrInteraction, '❌ Số tiền không hợp lệ!');
    }
    
    if (amount > 2000000) return replyMsg(msgOrInteraction, '❌ Quỹ đầu tư chỉ nhận tối đa 2,000,000 🪙 một lần để tránh rủi ro phá sản!');
    if (cash < amount) return replyMsg(msgOrInteraction, '❌ Không đủ tiền mặt!');
    if (p.investAmount && p.investAmount > 0) return replyMsg(msgOrInteraction, '❌ Bạn đang có khoản đầu tư chưa rút! Dùng `!claim-invest` trước.');
    
    addCoins(userId, -amount);
    updatePlayer(userId, dp => {
        dp.investAmount = amount;
        dp.investTime = Date.now();
    });
    
    return replyMsg(msgOrInteraction, `📈 Bạn đã ném **${amount.toLocaleString()} 🪙** vào Quỹ Đầu Tư rủi ro cao. Hãy quay lại dùng lệnh \`!claim-invest\` sau 1 giờ để xem kết quả!`);
}

async function handleClaimInvest(userId, msgOrInteraction) {
    let p = getPlayer(userId);
    if (!p.investAmount || p.investAmount <= 0) return replyMsg(msgOrInteraction, '❌ Bạn chưa có khoản đầu tư nào đang hoạt động!');
    
    const now = Date.now();
    const passed = now - p.investTime;
    if (passed < 3600000 && userId !== ADMIN_ID) { // 1 hour
        const r = 3600000 - passed;
        return replyMsg(msgOrInteraction, `⏳ Thị trường chưa đóng cửa! Đợi thêm **${Math.floor(r/60000)} phút** nữa!`);
    }
    
    // Tỉ suất -40% đến +50%
    const rate = (Math.random() * 0.9) - 0.4; // -0.4 to 0.5
    const original = p.investAmount;
    const finalAmount = Math.floor(original * (1 + rate));
    
    updatePlayer(userId, dp => {
        dp.investAmount = 0;
        dp.investTime = 0;
    });
    
    addCoins(userId, finalAmount);
    
    let desc = rate >= 0 
        ? `🟢 Cổ phiếu lên đỉnh! Lợi nhuận: **+${(rate*100).toFixed(1)}%**. Bạn thu về **${finalAmount.toLocaleString()} 🪙** (Lãi: ${(finalAmount - original).toLocaleString()})!`
        : `🔴 Thị trường sụp đổ! Thua lỗ: **${(rate*100).toFixed(1)}%**. Bạn chỉ còn lại **${finalAmount.toLocaleString()} 🪙** (Lỗ: ${(original - finalAmount).toLocaleString()})!`;
        
    return replyMsg(msgOrInteraction, `📊 **KẾT QUẢ ĐẦU TƯ**\n${desc}`);
}

const MARRY_RINGS = {
    'grass': { name: 'Nhẫn Cỏ', price: 10000000, emoji: '🌿' },
    'silver': { name: 'Nhẫn Bạc', price: 50000000, emoji: '🥈' },
    'gold': { name: 'Nhẫn Vàng', price: 200000000, emoji: '🥇' },
    'diamond': { name: 'Nhẫn Kim Cương', price: 500000000, emoji: '💎' },
    'infinity': { name: 'Nhẫn Vô Cực', price: 1000000000, emoji: '👑' }
};

async function handleMarry(userId, targetId, msgOrInteraction) {
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
        .setDescription(`Để cầu hôn <@${finalTargetId}>, bạn cần chuẩn bị một chiếc nhẫn thật xứng đáng.\nHãy chọn loại nhẫn bạn muốn mua:`)
        .setColor('#FF69B4');
        
    const options = Object.entries(MARRY_RINGS).map(([id, r]) => {
        return new StringSelectMenuOptionBuilder()
            .setLabel(`${r.name}`)
            .setValue(id)
            .setDescription(`Giá: ${r.price.toLocaleString()} 🪙`)
            .setEmoji(r.emoji);
    });

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`marry_ring_${userId}_${finalTargetId}`).setPlaceholder('💍 Chọn nhẫn...').addOptions(options)
    );
        
    return replyMsg(msgOrInteraction, { embeds: [embed], components: [row] });
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

async function handleSetBday(userId, msgOrInteraction, bdayInput) {
    if (!bdayInput) return replyMsg(msgOrInteraction, { content: '❌ Cú pháp: `setbday <ngày/tháng>` (VD: 15/08)', ephemeral: true });
    
    // Validate dd/mm
    const regex = /^(\d{1,2})\/(\d{1,2})$/;
    const match = bdayInput.match(regex);
    if (!match) return replyMsg(msgOrInteraction, { content: '❌ Vui lòng nhập đúng định dạng `ngày/tháng` (VD: 15/08)', ephemeral: true });
    
    let d = parseInt(match[1]);
    let m = parseInt(match[2]);
    if (d < 1 || d > 31 || m < 1 || m > 12) {
        return replyMsg(msgOrInteraction, { content: '❌ Ngày tháng không hợp lệ!', ephemeral: true });
    }
    
    const bdayStr = `${d.toString().padStart(2, '0')}/${m.toString().padStart(2, '0')}`;
    const data = loadRPG();
    if (!data[userId]) getPlayer(userId);
    
    
    data[userId].birthday = bdayStr;
    saveRPG(data);
    return replyMsg(msgOrInteraction, { content: `🎉 Đã lưu ngày sinh của bạn là **${bdayStr}**!`, ephemeral: true });
}

async function handleAdminCheat(userId, msgOrInteraction) {
    if (userId !== ADMIN_ID) return replyMsg(msgOrInteraction, '❌ Bạn không phải là Đấng Sáng Tạo!');
    
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
        
    return replyMsg(msgOrInteraction, { embeds: [embed], components: [row], ephemeral: true });
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
        const replyObj = { content: '❌ Kênh này đang có một bàn Bầu Cua chưa kết thúc!', ephemeral: true };
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
            msg = await interactionOrMessage.reply({ ...options, fetchReply: true });
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
// NUMBER GUESSING GAME
// ========================
const guessGames = new Map(); // userId -> { secret, attempts, bet, maxAttempts }

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
    ],
    allowedMentions: { parse: ['users', 'roles'], repliedUser: true }
});

// Khởi tạo Giveaway Manager
const manager = new GiveawaysManager(client, {
    storage: './giveaways.json',
    default: {
        botsCanWin: false,
        embedColor: '#FF0000',
        embedColorEnd: '#000000',
        reaction: '🎉'
    }
});
client.giveawaysManager = manager;

// Từ khóa auto-reply
const autoReplies = {
    'ping': 'pong!',
    'hello': 'Xin chào bạn nhé!',
    'moonie': 'Dạa ~ Moonie nghe nèee 💕 Cậu gọi Moonie có chuyện gì hơm dọ? (✿◡‿◡)'
};

// ========================
// SLASH COMMANDS
// ========================
const slashCommands = [
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
    // --- MUSIC COMMANDS ---
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('🎵 Phát nhạc YouTube vào voice channel.')
        .addStringOption(o => o.setName('query').setDescription('Tên bài hát hoặc link YouTube').setRequired(true)),
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
        .setName('invest')
        .setDescription('📈 Ném tiền vào quỹ đầu tư (Có thể Lãi to hoặc Lỗ nặng).')
        .addStringOption(o => o.setName('amount').setDescription('Số tiền (hoặc "all")').setRequired(true)),
    new SlashCommandBuilder()
        .setName('claiminvest')
        .setDescription('📊 Rút khoản đầu tư sau khi đợi 1 tiếng.'),
    new SlashCommandBuilder()
        .setName('marry')
        .setDescription('💍 Ghép đôi ngẫu nhiên hoặc cầu hôn (Phí nhẫn 50,000 Coin).')
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
        .setDescription('👑 [Đặc quyền] Menu Cheat của Sáng Thế Thần.'),
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
        .setName('guess')
        .setDescription('🎯 Đoán số 1-100, thắng coin.')
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
        .setName('setwelcome')
        .setDescription('🛠️ (Admin) Cài đặt hệ thống chào mừng (kênh, tin nhắn, ảnh).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addChannelOption(o => o.setName('channel').setDescription('Kênh gửi lời chào').setRequired(true))
        .addStringOption(o => o.setName('message').setDescription('Lời chào tuỳ chỉnh (Dùng {user} và {server})').setRequired(false))
        .addStringOption(o => o.setName('image').setDescription('Link ảnh đính kèm (vd: https://imgur.com/...)').setRequired(false)),
    new SlashCommandBuilder()
        .setName('setj2c')
        .setDescription('🛠️ (Admin) Cài đặt kênh gốc để tạo Join to Create.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addChannelOption(o => o.setName('channel').setDescription('Kênh Join to Create gốc').setRequired(true)),
    new SlashCommandBuilder()
        .setName('1an')
        .setDescription('Ẩn phòng Voice hiện tại của bạn đối với một người cụ thể.')
        .addUserOption(o => o.setName('user').setDescription('Người bạn muốn ẩn phòng').setRequired(true))
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
    const voiceChannel = member.voice.channel;
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
    
    return awaitConfirmation(msgOrInteraction, userId, `Sáng Thế Thần muốn **PHÁT LỘC** ${amount.toLocaleString()} 🪙 cho TOÀN SERVER?`, async () => {
        const cData = loadCoins();
        let count = 0;
        for (const uid in cData) {
            if (cData[uid].coins !== undefined) {
                cData[uid].coins += amount;
                count++;
            }
        }
        saveCoins(cData);
        return `🎁 **PHÁT LỘC TOÀN SERVER**\nSáng Thế Thần <@${userId}> vừa phát **${amount.toLocaleString()} 🪙** cho tất cả người chơi! (Tổng cộng ${count} người nhận)`;
    });
}

// ========================
// WORD CHAIN (NỐI TỪ)
// ========================
const vnDictionary = new Set();
const noituGames = new Map();
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
            const clean = w.trim().toLowerCase();
            if (clean && clean.split(' ').length === 2) {
                vnDictionary.add(clean);
            }
        }
        console.log(`📖 Đã nạp ${vnDictionary.size} từ ghép 2 âm tiết vào bộ nhớ.`);
    }
}

// ========================
// BOT READY
// ========================
client.once('clientReady', async () => {
    await initDictionary();
    console.log(`✅ Bot đã đăng nhập với tên: ${client.user.tag}`);
    
    const statuses = [
        "🎓 UTEHY 2026 đang mở cổng tuyển sinh!",
        "📚 Chọn UTEHY – Chọn tương lai!",
        "🚀 Đồng hành cùng tân sinh viên UTEHY.",
        "💙 UTEHY chào đón K20!",
        "📩 Hỏi đáp tuyển sinh 24/7.",
        "🌟 Sẵn sàng nhập học tại UTEHY?",
        "🔥 Tuyển sinh 2026 – Đừng bỏ lỡ!",
        "🎯 Chạm tới ước mơ cùng UTEHY.",
        "🏫 Khám phá ngành học tại UTEHY.",
        "💡 Học kỹ thuật – Chọn UTEHY.",
        "⚙️ Nơi đam mê công nghệ bắt đầu.",
        "🎉 Chào mừng các sĩ tử 2K8!",
        "📖 Tra cứu thông tin tuyển sinh.",
        "🤖 Bot hỗ trợ tuyển sinh UTEHY.",
        "✨ UTEHY – Kiến tạo tương lai."
    ];
    let statusIndex = 0;
    setInterval(() => {
        // type 4 = Custom, type 0 = Playing, type 2 = Listening, type 3 = Watching
        client.user.setActivity(statuses[statusIndex], { type: 4 }); 
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
            if (!config.lodeChannelId) {
                console.log('❌ Chưa cấu hình lodeChannelId, không thể gửi kết quả lô đề!');
                return;
            }
            const channel = client.channels.cache.get(config.lodeChannelId);
            if (!channel) return;

            const lodeData = loadLode();
            if (!lodeData.bets || lodeData.bets.length === 0) {
                channel.send('📊 **XỔ SỐ 18H30**\nHôm nay không có ai ghi lô đề. Hẹn gặp lại ngày mai!');
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
                    coinsData[betObj.userId].coins += prize;
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
                channel.send({ content: `🔔 Loa loa loa! Đã có kết quả xổ số: ${winners.map(w => `<@${w.userId}>`).join(' ')}`, embeds: [embed] });
            } else {
                embed.addFields({ name: '😢 Chia buồn', value: 'Rất tiếc hôm nay không có ai trúng lô cả. Chúc các bạn may mắn lần sau!' });
                channel.send({ embeds: [embed] });
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
        const config = loadConfig();
        const welcomeChannelId = config.welcomeChannelId || process.env.WELCOME_CHANNEL_ID;
        const receptionistRoleId = process.env.RECEPTIONIST_ROLE_ID;
        let channel;
        if (welcomeChannelId && welcomeChannelId !== 'YOUR_WELCOME_CHANNEL_ID_HERE') {
            channel = member.guild.channels.cache.get(welcomeChannelId);
        } else {
            channel = member.guild.channels.cache.find(ch =>
                ch.name.includes('welcome') || ch.name.includes('chào-mừng') || ch.name === 'general'
            );
        }
        if (!channel) return;
        
        let customMessage = config.welcomeMessage || `Chào mừng {user} đã tham gia server **{server}**!`;
        customMessage = customMessage.replace(/{user}/g, `<@${member.user.id}>`).replace(/{server}/g, member.guild.name);
        
        if (receptionistRoleId && receptionistRoleId !== 'YOUR_RECEPTIONIST_ROLE_ID_HERE') {
            customMessage += `\n<@&${receptionistRoleId}> ra đón khách kìa! 🎉`;
        }
        
        const embed = new EmbedBuilder()
            .setTitle(`🎉 Chào mừng thành viên mới!`)
            .setDescription(customMessage)
            .setColor('#00FF00')
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .setTimestamp();
            
        if (config.welcomeImage) {
            embed.setImage(config.welcomeImage);
        }
        
        channel.send({ content: `<@${member.user.id}>`, embeds: [embed] });
    } catch (error) {
        console.error('Lỗi khi gửi lời chào:', error);
    }
});

// ========================
// VOICE STATE - NOTIFY
// ========================
client.on('voiceStateUpdate', async (oldState, newState) => {
    // LUÔN LUÔN xử lý việc xóa phòng J2C nếu có người/bot rời đi và phòng trống
    if (oldState.channelId) {
        const oldChannel = oldState.channel;
        if (oldChannel && oldChannel.members.size === 0 && (j2cChannels.has(oldState.channelId) || oldChannel.name.startsWith('🔊 Phòng của'))) {
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
                    body: { status: 'Moonie tới đâyyy 💕 (✿◡‿◡)' }
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
                    .setTitle('👑 QUỲ XUỐNG! THẦN SÁNG THẾ ĐÃ GIÁNG LÂM! 👑')
                    .setDescription(`**<@${ADMIN_ID}>** vừa bước vào **${newState.channel.name}**!\nTất cả bách tính mau mau nghênh giá!`)
                    .setColor('#FFD700')
                    .setTimestamp();

                if (fs.existsSync(imgPath)) {
                    embed.setImage('attachment://god_arrival.png');
                    await newState.channel.send({
                        embeds: [embed],
                        files: [{ attachment: imgPath, name: 'god_arrival.png' }]
                    });
                } else {
                    await newState.channel.send({ embeds: [embed] });
                }
            } catch (err) {
                // Bỏ qua nếu bot không có quyền gửi tin nhắn vào voice channel
            }
        }
        
        const config = loadConfig();
        const voiceNotifyEnabled = config.voiceNotifyEnabled !== false;

        if (voiceNotifyEnabled) {
            if (!oldState.channelId && newState.channelId) {
                const channel = newState.channel;
                if (channel && channel.permissionsFor(newState.guild.members.me).has('SendMessages')) {
                    await channel.send({ content: `🔔 <@${userId}> vừa tham gia kênh thoại! Vô chém gió nào mọi người.`, allowedMentions: { users: [] } }).catch(() => {});
                }
            } else if (oldState.channelId && !newState.channelId) {
                const channel = oldState.channel;
                if (channel && channel.permissionsFor(oldState.guild.members.me).has('SendMessages')) {
                    await channel.send({ content: `👋 <@${userId}> đã rời khỏi kênh thoại.`, allowedMentions: { users: [] } }).catch(() => {});
                }
            } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                const oldChannel = oldState.channel;
                const newChannel = newState.channel;
                if (oldChannel && oldChannel.permissionsFor(oldState.guild.members.me).has('SendMessages')) {
                    await oldChannel.send({ content: `👋 <@${userId}> đã rời đi và chuyển sang kênh khác.`, allowedMentions: { users: [] } }).catch(() => {});
                }
                if (newChannel && newChannel.permissionsFor(newState.guild.members.me).has('SendMessages')) {
                    await newChannel.send({ content: `🔔 <@${userId}> vừa chuyển đến kênh thoại này!`, allowedMentions: { users: [] } }).catch(() => {});
                }
            }
        }
        
        // --- JOIN TO CREATE LOGIC ---
        const j2cChannelId = config.j2cChannelId;
        
        // Handle Join To Create
        if (newState.channelId === j2cChannelId) {
            const member = newState.member;
            
            // Không cho phép ai ngồi trong phòng Tạo Phòng quá 1.5s
            const antiSitTimeout = setTimeout(() => {
                if (member.voice.channelId === j2cChannelId) {
                    member.voice.disconnect('Ngồi trong phòng tạo quá lâu').catch(() => {});
                }
            }, 1500);

            const newChannelName = `🔊 Phòng của ${member.user.username}`;
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

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

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

    if (message.guildId && message.channelId) {
        activeChannels.set(message.guildId, message.channelId);
    }

    const content = message.content.toLowerCase().trim();
    const prefix = getPrefix();

    // --- AUTO REPLY ---
    for (const [key, reply] of Object.entries(autoReplies)) {
        if (content.includes(key)) {
            message.reply(reply);
            break;
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
                    content: `📱 **Video TikTok từ @${result.author}**\n${result.videoUrl}`,
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

    // --- NOITU GAME LOGIC ---
    if (message.guildId && noituGames.has(message.channelId)) {
        const game = noituGames.get(message.channelId);
        const msgText = content;
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
                        message.reply(`Từ **${msgText}** đã được dùng rồi! Bạn hãy tìm từ khác nối chữ **${lastSyllableOfGame}** nhé.`).catch(() => {});
                    } else if (game.lastUser === message.author.id) {
                        message.react('❌').catch(() => {});
                        message.reply(`Bạn vừa nối từ rồi, hãy đợi người khác nối tiếp nhé!`).catch(() => {});
                    } else {
                        game.lastWord = msgText;
                        game.usedWords.add(msgText);
                        game.lastUser = message.author.id;
                        clearTimeout(game.timeout);
                        
                        addCoins(message.author.id, 50000);
                        message.react('❤️').catch(() => {});
                        
                        game.timeout = setTimeout(() => {
                            noituGames.delete(message.channelId);
                            message.channel.send(`⏰ Hết 60 giây không ai nối được chữ **${msgText.split(' ')[1]}**. Trò chơi Nối Từ kết thúc!`).catch(() => {});
                        }, 60000);
                    }
                } else {
                    message.react('❌').catch(() => {});
                    message.reply(`Từ **${msgText}** không có trong từ điển Tiếng Việt!`).catch(() => {});
                }
            }
        }
    }

    // --- PREFIX COMMANDS ---
    if (!content.startsWith(prefix)) return;

    // --- JAIL CHECK ---
    const uid = message.author.id;
    const userData = loadCoins()[uid] || {};
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
        data[uid].coins -= 100000;
        data[uid].jailEnd = null;
        saveCoins(data);
        return message.reply('🔓 Bạn đã nộp **100,000 🪙** cho công an và được thả tự do!');
    }

    if (content === `${prefix}noitu`) {
        if (noituGames.has(message.channelId)) return message.reply('❌ Trò chơi Nối Từ đang diễn ra ở kênh này rồi!');
        if (vnDictionary.size === 0) return message.reply('❌ Từ điển chưa tải xong, vui lòng chờ giây lát...');
        
        const easyStartingWords = ["nhà", "học", "bạn", "làm", "người", "xe", "hoa", "cây", "nước", "mưa", "nắng", "gió", "trời", "đất", "biển", "sông", "núi", "đường", "áo", "quần", "máy", "điện", "bàn", "ghế", "sách", "vở", "bút", "chữ", "toán", "nhạc", "hát", "tình", "yêu", "đời", "trăng", "sao", "chim", "cá", "chuột", "mèo", "chó", "heo", "bò", "gà", "vịt", "thuyền", "cầu", "sân"];
        const randomWord = easyStartingWords[Math.floor(Math.random() * easyStartingWords.length)];
        
        const game = {
            lastWord: randomWord,
            usedWords: new Set([randomWord]),
            lastUser: null,
            timeout: setTimeout(() => {
                noituGames.delete(message.channelId);
                message.channel.send(`⏰ Hết 60 giây không ai nối được chữ **${randomWord}**. Trò chơi Nối Từ kết thúc!`).catch(() => {});
            }, 60000)
        };
        noituGames.set(message.channelId, game);
        
        return message.channel.send(`🎮 **TRÒ CHƠI NỐI TỪ BẮT ĐẦU!**\nTừ đầu tiên để nối là: **${randomWord.toUpperCase()}**\n\nHãy nối tiếp bằng một từ ghép có chữ đầu là **${randomWord.toUpperCase()}** nhé!\n_Thưởng 50,000 🪙 mỗi từ đúng. Mọi người chỉ cần gõ 2 chữ tự do vào chat!_`).catch(() => {});
    }

    if (content === `${prefix}stopnoitu`) {
        if (!noituGames.has(message.channelId)) return message.reply('❌ Không có trò chơi Nối Từ nào đang diễn ra.');
        const game = noituGames.get(message.channelId);
        clearTimeout(game.timeout);
        noituGames.delete(message.channelId);
        return message.reply('🛑 Trò chơi Nối Từ đã kết thúc.').catch(() => {});
    }

    // Đổi prefix
    if (content.startsWith(`${prefix}setprefix`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Chỉ Quản trị viên mới có thể đổi tiền tố lệnh!');
        }
        const args = message.content.split(' ').filter(Boolean);
        const newPrefix = args[1];
        if (!newPrefix) return message.reply(`❌ Cú pháp sai! Vui lòng dùng: \`${prefix}setprefix <dấu mới>\``);
        savePrefix(newPrefix);
        return message.reply(`✅ Đã đổi tiền tố lệnh thành: **${newPrefix}**`);
    }

    // Cài đặt kênh xuất hiện Pokemon
    if (content.startsWith(`${prefix}setspawnchannel`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Chỉ Quản trị viên mới có quyền dùng lệnh này!');
        }
        const targetChannel = message.mentions.channels.first();
        if (!targetChannel) return message.reply(`❌ Cú pháp sai! Vui lòng dùng: \`${prefix}setspawnchannel #ten-kenh\``);
        const config = loadConfig();
        config.spawnChannelId = targetChannel.id;
        saveConfig(config);
        return message.reply(`✅ Đã thiết lập kênh xuất hiện Pokemon hoang dã tại ${targetChannel}!`);
    }

    // Cài đặt kênh Join To Create
    if (content.startsWith(`${prefix}setj2c`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Chỉ Quản trị viên mới có quyền dùng lệnh này!');
        }
        const targetChannel = message.mentions.channels.first();
        if (!targetChannel) return message.reply(`❌ Cú pháp sai! Vui lòng dùng: \`${prefix}setj2c #ten-kenh\``);
        const config = loadConfig();
        config.j2cChannelId = targetChannel.id;
        saveConfig(config);
        return message.reply(`✅ Đã thiết lập kênh gốc Join to Create tại ${targetChannel}!`);
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
            if (page === 8 || page === 9) {
                // Trang Admin: chỉ Admin mới được xem, hiển thị ẩn
                const isAdmin = i.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
                if (!isAdmin) {
                    return i.reply({ content: '🔒 **Trang này chỉ dành cho Admin!** Bạn không có quyền xem mục này.', ephemeral: true });
                }
                await i.update({ components: [row] });
                return i.followUp({ embeds: [pages[page]], ephemeral: true });
            }
            if (i.user.id !== message.author.id) {
                return i.reply({ content: '❌ Chỉ người dùng lệnh mới có thể điều hướng!', ephemeral: true });
            }
            await i.update({ embeds: [pages[page]], components: [row] });
        });
        collector.on('end', () => {
            msg.edit({ components: [] }).catch(() => {});
        });
        return;
    }

    // Cập nhật yt-dlp
    if (content === `${prefix}updateytdlp`) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) && message.author.id !== ADMIN_ID) return message.reply('❌ Chỉ Admin mới có thể sử dụng lệnh này!');
        const loadMsg = await message.reply('⏳ Đang cập nhật yt-dlp... Vui lòng đợi.');
        execFile(YTDLP_PATH, ['-U'], (err, stdout, stderr) => {
            if (err) {
                return loadMsg.edit(`❌ Lỗi cập nhật: ${stderr || err.message}`);
            }
            loadMsg.edit(`✅ Cập nhật thành công:\n\`\`\`\n${stdout}\n\`\`\``);
        });
        return;
    }

    // QR
    if (content.startsWith(`${prefix}qr`)) {
        if (message.author.id !== ADMIN_ID && (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.Administrator))) return message.reply('❌ Lệnh này chỉ dành cho Admin!');
        const args = message.content.split(' ').slice(1);
        if (!args.length) return message.reply(`❌ Cú pháp: \`${prefix}qr <số tiền> [nội dung]\``);
        const amount = args[0];
        let baseInfo = args.slice(1).join(' ').replace(/[^a-zA-Z0-9 ]/g, '');
        let addInfo = baseInfo ? `${baseInfo} ${qrOrderCount}` : `Thanh toan don ${qrOrderCount}`;
        qrOrderCount++;
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
            thumbnail: (process.env.GIVEAWAY_IMAGE_URL && process.env.GIVEAWAY_IMAGE_URL !== 'YOUR_IMAGE_LINK_HERE') ? process.env.GIVEAWAY_IMAGE_URL : null,
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
    if (content.startsWith(`${prefix}play`) || content.startsWith(`${prefix}p `) || content === `${prefix}p`) {
        // Fix: dùng slice thay vì regex bị double-escape
        let query;
        if (content.toLowerCase().startsWith(`${prefix}play`)) {
            query = message.content.slice((`${prefix}play`).length).trim();
        } else {
            query = message.content.slice((`${prefix}p`).length).trim();
        }
        if (!query) return message.reply(`❌ Cú pháp: \`${prefix}play <tên bài / link YouTube>\``);

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply('❌ Bạn cần vào **voice channel** trước!');
        const perms = voiceChannel.permissionsFor(client.user);
        if (!perms.has(PermissionsBitField.Flags.Connect) || !perms.has(PermissionsBitField.Flags.Speak))
            return message.reply('❌ Bot không có quyền vào kênh thoại này!');

        const loadMsg = await message.reply('⏳ Đang tìm kiếm bài hát...');
        try {
            let songInfo;
            const info = await ytdlpGetInfo(query);
            if (!info) return loadMsg.edit('❌ Không tìm thấy bài hát nào!');
            const d = parseInt(info.duration) || 0;
            songInfo = { title: info.title, url: info.webpage_url, duration: `${Math.floor(d/60)}:${String(d%60).padStart(2,'0')}`, thumbnail: info.thumbnail, requestedBy: message.author.tag, requestedById: message.author.id };

            const state = getQueue(message.guildId);
            if (!state.connection) {
                state.connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: message.guildId, adapterCreator: message.guild.voiceAdapterCreator, selfDeaf: true });
                state.connection.on(VoiceConnectionStatus.Disconnected, async () => {
                    try { await Promise.race([entersState(state.connection, VoiceConnectionStatus.Signalling, 5_000), entersState(state.connection, VoiceConnectionStatus.Connecting, 5_000)]); }
                    catch { state.connection.destroy(); musicQueues.delete(message.guildId); }
                });
            }
            state.queue.push(songInfo);
            if (!state.djId) state.djId = message.author.id;

            if (state.queue.length === 1 && (!state.player || state.player.state.status === AudioPlayerStatus.Idle)) {
                await loadMsg.delete().catch(() => {});
                await playNext(message.guildId, message.channel);
            } else {
                const embed = new EmbedBuilder().setTitle('📋 Đã thêm vào hàng đợi').setDescription(`**[${songInfo.title}](${songInfo.url})**`)
                    .addFields({ name: '⏱ Thời lượng', value: songInfo.duration || 'N/A', inline: true }, { name: '📍 Vị trí', value: `#${state.queue.length}`, inline: true })
                    .setThumbnail(songInfo.thumbnail).setColor('#FF6600');
                await loadMsg.edit({ content: '', embeds: [embed] });
            }
        } catch (err) { console.error('Lỗi play prefix:', err); loadMsg.edit(`❌ Lỗi: ${err.message}`); }
        return;
    }

    // !skip
    if (content === `${prefix}skip` || content === `${prefix}s`) {
        const state = getQueue(message.guildId);
        if (!state.player || !state.queue.length) return message.reply('❌ Không có nhạc đang phát!');
        if (message.author.id !== state.djId) return message.reply(`❌ Chỉ <@${state.djId}> mới có thể điều khiển!`);
        state.player.stop();
        return message.reply('⏭ Đã bỏ qua bài nhạc!');
    }

    // !stop
    if (content === `${prefix}stop` || content === `${prefix}st`) {
        const state = getQueue(message.guildId);
        if (!state.connection) return message.reply('❌ Bot không ở trong voice channel!');
        if (message.author.id !== state.djId) return message.reply(`❌ Chỉ <@${state.djId}> mới có thể điều khiển!`);
        state.queue.length = 0; state.player?.stop(); state.connection.destroy(); musicQueues.delete(message.guildId);
        return message.reply('⏹ Đã dừng nhạc và rời kênh thoại!');
    }

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
    if (content === `${prefix}pause` || content === `${prefix}pa`) {
        const state = getQueue(message.guildId);
        if (!state.player) return message.reply('❌ Không có nhạc đang phát!');
        if (message.author.id !== state.djId) return message.reply(`❌ Chỉ <@${state.djId}> mới có thể điều khiển!`);
        state.player.pause(); state.paused = true;
        return message.reply('⏸ Đã tạm dừng nhạc!');
    }

    // !resume
    if (content === `${prefix}resume` || content === `${prefix}r`) {
        const state = getQueue(message.guildId);
        if (!state.player) return message.reply('❌ Không có nhạc để tiếp tục!');
        if (message.author.id !== state.djId) return message.reply(`❌ Chỉ <@${state.djId}> mới có thể điều khiển!`);
        state.player.unpause(); state.paused = false;
        return message.reply('▶ Đã tiếp tục phát nhạc!');
    }

    // !queue / !q
    if (content === `${prefix}queue` || content === `${prefix}q`) {
        const state = getQueue(message.guildId);
        if (!state.queue.length) return message.reply('📋 Hàng đợi trống!');
        const queueList = state.queue.slice(0, 10).map((s, i) =>
            `${i === 0 ? '▶ **[Đang phát]**' : `${i}.`} [${s.title}](${s.url}) • \`${s.duration || 'N/A'}\``
        ).join('\n');
        const embed = new EmbedBuilder().setTitle(`📋 Hàng đợi nhạc (${state.queue.length} bài)`).setDescription(queueList)
            .setColor('#0099ff').setFooter({ text: state.queue.length > 10 ? `... và ${state.queue.length - 10} bài nữa` : '​' });
        return message.channel.send({ embeds: [embed] });
    }

    // !np / !nowplaying
    if (content === `${prefix}np` || content === `${prefix}nowplaying`) {
        const state = getQueue(message.guildId);
        if (!state.queue.length) return message.reply('❌ Không có bài nào đang phát!');
        const song = state.queue[0];
        const embed = new EmbedBuilder().setTitle('🎵 Đang phát').setDescription(`**[${song.title}](${song.url})**`)
            .addFields(
                { name: '⏱ Thời lượng', value: song.duration || 'N/A', inline: true },
                { name: '👤 Yêu cầu bởi', value: `<@${song.requestedById}>`, inline: true },
                { name: '🔊 Âm lượng', value: `${Math.round(state.volume * 100)}%`, inline: true }
            ).setThumbnail(song.thumbnail).setColor('#FF0000');
        return message.channel.send({ embeds: [embed] });
    }

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
        const total = cash + bank;
        const p = getPlayer(target.id);
        const investMsg = (p.investAmount && p.investAmount > 0) ? `\n📈 **Đang đầu tư:** ${p.investAmount.toLocaleString()} 🪙` : '';
        
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

    // !guess <bet>
    if (content.startsWith(`${prefix}guess`) || content.startsWith(`${prefix}g `)) {
        const uid = message.author.id;
        const args = message.content.split(' ');
        const betInput = args[1]?.toLowerCase();
        let bet = parseInt(betInput);
        if (betInput === 'all') {
            bet = Math.min(getUserCoins(uid), 500000);
            if (bet < 10) return message.reply(`❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`);
        } else if (isNaN(bet) || bet < 10) return message.reply(`❌ Cú pháp: \`${prefix}guess <số_coin|all>\` (tối thiểu 10)`);
        
        if (bet > 500000) return message.reply('❌ Mức cược tối đa là **500,000 🪙**!');
        if (guessGames.has(uid)) return message.reply('❌ Bạn đang có game đoán số chưa xong!');
        if (getUserCoins(uid) < bet) return message.reply(`❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`);
        addCoins(uid, -bet);
        const secret = Math.floor(Math.random() * 100) + 1;
        guessGames.set(uid, { secret, attempts: 0, maxAttempts: 7, bet, channelId: message.channelId });
        return message.reply({ embeds: [new EmbedBuilder().setTitle('🎯 Đoán số bí mật!').setDescription(`Ta nghĩ một số từ **1-100**. Bạn có **7 lượt**!\n→ Gõ một số vào chat!`).setColor('#9B59B6').addFields({ name: '💰 Cược', value: `${bet.toLocaleString()} 🪙`, inline: true }, { name: '✅ Thưởng', value: `${(bet*3).toLocaleString()} 🪙`, inline: true })] });
    }

    // !lode <số> <bet>
    if (content.startsWith(`${prefix}setlodechannel`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) && message.author.id !== ADMIN_ID) {
            return message.reply('❌ Chỉ Admin mới có thể sử dụng lệnh này!');
        }
        let targetChannel = message.mentions.channels.first();
        if (!targetChannel) targetChannel = message.channel;
        
        const config = loadConfig();
        config.lodeChannelId = targetChannel.id;
        saveConfig(config);
        
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

    // !catchpet
    if (content === `${prefix}catchpet` || content === `${prefix}catch` || content === `${prefix}cp`) {
        return handleCatchPet(message.author.id, message);
    }

    // !pets
    if (content === `${prefix}pets` || content === `${prefix}p`) {
        return handlePets(message.author.id, message);
    }

    // !ptrade
    if (content.startsWith(`${prefix}ptrade`) || content.startsWith(`${prefix}pt`)) {
        const targetUser = message.mentions.users.first();
        if (!targetUser) return message.reply('❌ Hãy tag người bạn muốn giao dịch (VD: `!ptrade @user`).');
        if (targetUser.bot) return message.reply('❌ Không thể giao dịch với Bot!');
        return handlePetTrade(message.author.id, targetUser.id, message);
    }
    if (content === `${prefix}sellpet` || content.startsWith(`${prefix}sellpet `) || content === `${prefix}sp` || content.startsWith(`${prefix}sp `)) {
        const args = content.split(' ');
        if (args[1] === 'all') {
            const uid = message.author.id;
            let sellCoin = 0;
            let soldMsg = '';
            updatePlayer(uid, dp => {
                let bestPetId = null;
                let maxPrice = -1;
                for (const pet of PET_LIST) {
                    if (dp.pets[pet.id] > 0 && pet.price > maxPrice) {
                        maxPrice = pet.price;
                        bestPetId = pet.id;
                    }
                }
                if (!bestPetId) {
                    soldMsg = `❌ Bạn không có thú cưng nào để bán!`;
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
                    if (sellCoin > 0) {
                        const bestPetInfo = PET_LIST.find(p => p.id === bestPetId);
                        soldMsg = `✅ Bạn đã bán sạch thú cưng dư thừa, chỉ giữ lại đúng 1 bé **${bestPetInfo.name}** ${bestPetInfo.emoji} (xịn nhất) và thu về **${sellCoin.toLocaleString()} 🪙**!`;
                    } else {
                        soldMsg = `❌ Bạn chỉ có đúng 1 con thú cưng nên không có gì dư để bán cả!`;
                    }
                }
            });
            if (sellCoin > 0) addCoins(uid, sellCoin);
            return message.reply(soldMsg);
        }
        return handleSellPet(message.author.id, message);
    }

    // !petbattle
    if (content.startsWith(`${prefix}petbattle`) || content.startsWith(`${prefix}pb `)) {
        const target = message.mentions.users.first();
        const args = message.content.split(' ');
        const bet = parseInt(args[2]);
        if (!target || target.bot) return message.reply(`❌ Cú pháp: \`${prefix}pb @user <bet>\``);
        if (isNaN(bet) || bet < 10) return message.reply('❌ Mức cược phải lớn hơn hoặc bằng 10!');
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
        if (message.author.id !== ADMIN_ID) return message.reply('❌ Lệnh này chỉ dành cho Admin tối cao (Sáng Thế Thần)!');
        
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
    if (content.startsWith(`${prefix}rob`)) {
        const target = message.mentions.users.first();
        if (!target) return message.reply(`❌ Cú pháp: \`${prefix}rob @user\``);
        return handleRob(message.author.id, target.id, message);
    }
    if (content.startsWith(`${prefix}robbank`) || content.startsWith(`${prefix}heist`)) {
        const robTarget = message.mentions.users.first();
        return handleRobbank(message.author.id, message, robTarget ? robTarget.id : null);
    }
    if (content.startsWith(`${prefix}invest`)) {
        const p = getPlayer(message.author.id);
        if (p.investAmount && p.investAmount > 0) {
            return handleClaimInvest(message.author.id, message);
        }
        const args = message.content.split(' ');
        if (!args[1]) return message.reply(`❌ Cú pháp: \`${prefix}invest <số tiền|all>\`\n*(Nếu bạn đang đầu tư rồi, gõ \`${prefix}invest\` để xem kết quả!)*`);
        return handleInvest(message.author.id, args[1].toLowerCase(), message);
    }
    if (content === `${prefix}claiminvest`) {
        return handleClaimInvest(message.author.id, message);
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
    // XỬ LÝ ĐOÁN SỐ (nhận số trong chat)
    // ========================
    const guessGame = guessGames.get(message.author.id);
    if (guessGame && guessGame.channelId === message.channelId) {
        const guess = parseInt(message.content.trim());
        if (!isNaN(guess) && guess >= 1 && guess <= 100) {
            guessGame.attempts++;
            let { secret, attempts, maxAttempts, bet } = guessGame;
            
            const cData = loadCoins();
            if (cData[message.author.id]?.alwaysWin) {
                secret = guess;
            }

            if (guess === secret) {
                const prize = bet * 3;
                addCoins(message.author.id, prize);
                guessGames.delete(message.author.id);
                return message.reply({ embeds: [new EmbedBuilder().setTitle('🎉 Chính xác!').setDescription(`Số bí mật là **${secret}**!\nBạn đoán đúng sau **${attempts} lượt**!\n\n**+${prize.toLocaleString()} 🪙** → Số dư: **${getUserCoins(message.author.id).toLocaleString()} 🪙**`).setColor('#00FF88')] });
            }
            const remaining = maxAttempts - attempts;
            if (remaining <= 0) {
                guessGames.delete(message.author.id);
                return message.reply({ embeds: [new EmbedBuilder().setTitle('💀 Hết lượt!').setDescription(`Số bí mật là **${secret}**. Bạn thua **${bet.toLocaleString()} 🪙**!`).setColor('#FF4444')] });
            }
            const hint = guess < secret ? '📈 Thấp hơn! Cao lên!' : '📉 Cao hơn! Thấp xuống!';
            return message.reply({ embeds: [new EmbedBuilder().setTitle(`🎯 ${hint}`).setDescription(`Bạn đoán: **${guess}**\nCòn **${remaining} lượt** nữa!`).setColor('#FFA500')] });
        }
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
        const profileData = buildProfileEmbed(target);
        const options = { embeds: [profileData.embed] };
        if (profileData.attachment) options.files = [profileData.attachment];
        return message.reply(options);
    }

    // !hunt
    if (content === `${prefix}hunt` || content === `${prefix}hu`) {
        const uid = message.author.id;
        const p = getPlayer(uid);
        if (p.hp <= 0) return message.reply('❌ Bạn đã hết máu, hãy dùng `!heal` để hồi sinh lực!');
        const now = Date.now();
        if (now - p.lastHunt < 60000) return message.reply(`⏳ Đang mệt, hãy nghỉ ngơi **${Math.ceil((60000-(now-p.lastHunt))/1000)}s** nữa!`);
        
        const maxLevel = Math.min(Math.max(1, p.level), MONSTERS.length);
        const m = MONSTERS[Math.floor(Math.random() * maxLevel)];
        const stats = getPlayerStats(p);
        
        let mHp = m.hp, pHp = p.hp;
        let rounds = 0;
        let pDmg = Math.max(1, stats.atk - m.def);
        let mDmg = Math.max(1, m.atk - stats.def);
        
        while(mHp > 0 && pHp > 0 && rounds < 20) {
            mHp -= pDmg;
            if (mHp <= 0) break;
            pHp -= mDmg;
            rounds++;
        }
        
        if (pHp <= 0) {
            updatePlayer(uid, dp => { dp.hp = 0; dp.lastHunt = now; dp.exp = Math.max(0, dp.exp - Math.floor(m.exp/2)); });
            return message.reply({ embeds: [new EmbedBuilder().setTitle('☠️ Tử trận').setDescription(`Bạn bị **${m.name}** ${m.emoji} đánh bại!\nChỉ số quái: ⚔️ ${m.atk} | 🛡️ ${m.def}\nMất một ít EXP. Hãy dùng \`!heal\`.`).setColor('#FF0000')] });
        }
        
        updatePlayer(uid, dp => { dp.hp = pHp; dp.lastHunt = now; dp.exp += m.exp; });
        addCoins(uid, m.coin);
        const nP = getPlayer(uid);
        
        return message.reply({ embeds: [new EmbedBuilder().setTitle(`⚔️ Chiến thắng **${m.name}** ${m.emoji}`).setDescription(`Sau trận chiến, bạn còn lại **❤️ ${pHp}/${p.maxHp} HP**.\nNhận được: **+${m.exp} EXP** và **+${m.coin} 🪙**\nCấp độ hiện tại: **Lv. ${nP.level}**`).setColor('#00FF00')] });
    }

    // !shop
    if (content === `${prefix}shop` || content === `${prefix}sh`) {
        return handleShop(message.author.id, message);
    }

    // !inv
    if (content === `${prefix}inv` || content === `${prefix}i`) {
        const p = getPlayer(message.author.id);
        const embed = new EmbedBuilder().setTitle(`🎒 Túi Đồ của ${message.author.username}`).setColor('#F1C40F');
        
        let equipText = '';
        if (p.weapon) {
            const w = RPG_ITEMS.weapons[p.weapon];
            if (w) equipText += `⚔️ **Vũ khí:** ${w.emoji} ${w.name} (+${w.atk} Atk)\n`;
        }
        if (p.armor) {
            const a = RPG_ITEMS.armors[p.armor];
            if (a) equipText += `🛡️ **Áo giáp:** ${a.emoji} ${a.name} (+${a.def} Def)\n`;
        }
        embed.addFields({ name: 'Trang Bị', value: equipText || 'Chưa trang bị gì.', inline: false });
        
        const items = [];
        if (p.inventory) {
            for (const [k, v] of Object.entries(p.inventory)) {
                if (v > 0) {
                    let item = RPG_ITEMS.potions[k] || RPG_ITEMS.pokeballs[k];
                    if (item) items.push(`${item.emoji} **${item.name}**: ${v}`);
                }
            }
        }
        embed.addFields({ name: 'Vật Phẩm', value: items.length ? items.join('\n') : 'Trống rỗng.', inline: true });
        
        const rings = [];
        if (p.rings) {
            for (const [k, v] of Object.entries(p.rings)) {
                if (v > 0) {
                    let r = MARRY_RINGS[k];
                    if (r) rings.push(`${r.emoji} **${r.name}**: ${v}`);
                }
            }
        }
        if (rings.length > 0) {
            embed.addFields({ name: 'Nhẫn Kết Hôn', value: rings.join('\n'), inline: true });
        }
        
        const petsList = [];
        if (p.pets) {
            for (const petInfo of PET_LIST) {
                const amount = p.pets[petInfo.id] || 0;
                if (amount > 0) petsList.push(`${petInfo.emoji} **${petInfo.name}**: ${amount}`);
            }
        }
        embed.addFields({ name: 'Thú Cưng', value: petsList.length ? petsList.join(', ') : 'Chưa có con nào. Dùng `!cp`.', inline: false });
        
        return message.reply({ embeds: [embed] });
    }

    // !heal
    if (content === `${prefix}heal`) {
        const uid = message.author.id;
        const p = getPlayer(uid);
        if (p.hp >= p.maxHp) return message.reply('✅ Máu của bạn đã đầy!');
        
        // Use potion first
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
            return message.reply(`💊 Đã sử dụng bình máu! Sinh lực hiện tại: **❤️ ${np.hp}/${np.maxHp}**`);
        }
        
        // Use coins if no potion
        const healCost = 10000;
        if (getUserCoins(uid) < healCost) return message.reply(`❌ Bạn không có bình máu nào, và không đủ **${healCost} 🪙** để dùng dịch vụ hồi máu!`);
        addCoins(uid, -healCost);
        updatePlayer(uid, dp => { dp.hp = dp.maxHp; });
        return message.reply(`🏥 Đã trả **${healCost} 🪙** cho Y Tá để hồi phục toàn bộ sinh lực! **❤️ ${p.maxHp}/${p.maxHp}**`);
    }

    // !dautu
    if (content.startsWith(`${prefix}dautu`) || content.startsWith(`${prefix}invest`)) {
        const args = content.split(' ');
        const amountStr = args[1];
        if (!amountStr) return message.reply(`❌ Cú pháp: \`${prefix}dautu <số tiền/all>\``);

        const uid = message.author.id;
        
        if (dautuCooldowns.has(uid)) {
            const remaining = dautuCooldowns.get(uid) - Date.now();
            if (remaining > 0) return message.reply(`⏱️ Đang chờ phân tích thị trường... Vui lòng đợi **${Math.ceil(remaining/1000)}s** nữa trước khi đầu tư tiếp!`);
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

    // ========================
    // ADMIN - PREFIX COMMANDS
    // ========================
    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    
    // !spawnpet
    if (content === `${prefix}spawnpet`) {
        if (!isAdmin && message.author.id !== ADMIN_ID) return message.reply('❌ Bạn không có quyền!');
        
        spawnWildPet(client, true);
        return message.reply('✨ Đã ép xuất hiện một Pokemon hiếm! (Kiểm tra kênh spawn mặc định hoặc kênh đang active)');
    }
    
    // !getallvip
    if (content === `${prefix}getallvip`) {
        if (!isAdmin && message.author.id !== ADMIN_ID) return message.reply('❌ Bạn không có quyền!');
        
        const uid = message.author.id;
        
        // Add 1B coins
        addCoins(uid, 1000000000);
        
        // Max RPG stats and pets
        updatePlayer(uid, p => {
            p.weapon = 'diamond_sword';
            p.armor = 'diamond_armor';
            
            if (!p.inventory) p.inventory = {};
            p.inventory['large_potion'] = (p.inventory['large_potion'] || 0) + 1000;
            p.inventory['ultra_ball'] = (p.inventory['ultra_ball'] || 0) + 1000;
            
            if (!p.pets) p.pets = {};
            PET_LIST.forEach(pet => {
                p.pets[pet.id] = (p.pets[pet.id] || 0) + 100;
            });
            
            p.hp = p.maxHp;
        });
        
        return message.reply('👑 **LỆNH TỐI CAO ĐÃ KÍCH HOẠT!** 👑\nNgài đã nhận được:\n- 1 Tỷ 🪙\n- Kiếm Kim Cương & Giáp Kim Cương ⚔️🛡️\n- 1000x Bình Máu Lớn & 1000x Bóng Tối Thượng 💊🔮\n- x100 Tất cả các loại Pet hoang dã 🐉');
    }

    // !addpetvip @user <petId> [amount]
    if (content.startsWith(`${prefix}addpetvip`)) {
        if (!isAdmin) return message.reply('❌ Bạn không có quyền!');
        const args = message.content.split(' ');
        const target = message.mentions.users.first();
        if (!target || args.length < 3) return message.reply(`❌ Cú pháp: \`${prefix}addpetvip @user <petId> [số lượng]\``);
        const petId = args[2];
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

    // !addcoin @user <amount>
    if (content.startsWith(`${prefix}addcoin`)) {
        if (!isAdmin) return message.reply('❌ Bạn không có quyền!');
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
        if (!isAdmin) return message.reply('❌ Bạn không có quyền!');
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
        if (!isAdmin) return message.reply('❌ Bạn không có quyền!');
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
        if (!isAdmin) return message.reply('❌ Bạn không có quyền!');
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
        if (!isAdmin) return message.reply('❌ Bạn không có quyền!');
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

    if (content.startsWith(`${prefix}togglevoice`)) {
        if (!isAdmin) return message.reply('❌ Bạn không có quyền Administrator để dùng lệnh này!');
        const config = loadConfig();
        const currentState = config.voiceNotifyEnabled !== false;
        config.voiceNotifyEnabled = !currentState;
        saveConfig(config);
        return message.reply(`✅ Đã **${config.voiceNotifyEnabled ? 'BẬT' : 'TẮT'}** thông báo người ra vào kênh thoại.`);
    }

});

// ========================
// GIVEAWAY MESSAGES HELPER
// ========================
function giveawayMessages() {
    return {
        giveaway: '🎁 **SỰ KIỆN GIVEAWAY** 🎁',
        giveawayEnded: '🛑 **GIVEAWAY ĐÃ KẾT THÚC** 🛑',
        title: '{this.prize}',
        drawing: '⏳ Kết thúc: **{timestamp}**',
        dropMessage: 'Hãy là người đầu tiên phản hồi bằng 🎉 để nhận giải!',
        inviteToParticipate: '👇 Nhấn vào biểu tượng 🎉 bên dưới để tham gia ngay!',
        winMessage: {
            content: '🎊 Chúc mừng {winners}! 🎊',
            embed: new EmbedBuilder()
                .setTitle('🏆 ĐÃ TÌM THẤY NGƯỜI TRÚNG GIẢI')
                .setDescription('Bạn đã xuất sắc trúng giải: **{this.prize}**\n\n🎫 **CÁCH NHẬN GIẢI:**\nVui lòng mở ticket để nhận thưởng nhé!')
                .setColor('#FFD700')
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
    // --- JAIL CHECK ---
    const uid = interaction.user.id;
    const userData = loadCoins()[uid] || {};
    if (userData.jailEnd && Date.now() < userData.jailEnd) {
        if (!interaction.isChatInputCommand() || (interaction.commandName !== 'nopphat' && interaction.commandName !== 'bribe')) {
            const r = userData.jailEnd - Date.now();
            return interaction.reply({ content: `🚓 **BẠN ĐANG Ở TRONG TÙ!** Hãy đợi **${Math.ceil(r/60000)} phút** nữa hoặc dùng lệnh \`/nopphat\` (phí 100,000 🪙) để hối lộ ra tù sớm.`, ephemeral: true });
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

        // =============================================
        // JOIN TO CREATE BUTTONS
        // =============================================
        if (cid.startsWith('j2c_')) {
            const channelId = interaction.channel.id;
            const channel = interaction.channel;
            
            if (!j2cChannels.has(channelId)) {
                return interaction.reply({ content: '❌ Đây không phải là phòng được tạo bởi tính năng Join To Create!', ephemeral: true });
            }
            
            const ownerId = j2cChannels.get(channelId);
            const isOwner = interaction.user.id === ownerId;
            
            if (cid === 'j2c_claim') {
                if (isOwner) return interaction.reply({ content: '❌ Bạn đã là chủ phòng rồi!', ephemeral: true });
                const ownerInChannel = channel.members.has(ownerId);
                if (ownerInChannel) {
                    return interaction.reply({ content: '❌ Chủ phòng cũ vẫn đang ở trong kênh. Không thể chiếm quyền!', ephemeral: true });
                }
                
                j2cChannels.set(channelId, interaction.user.id);
                await channel.permissionOverwrites.edit(interaction.user.id, { Connect: true, ViewChannel: true, SendMessages: true }).catch(() => {});
                
                const oldEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(oldEmbed);
                newEmbed.data.fields[0].value = `<@${interaction.user.id}>`;
                
                await interaction.update({ embeds: [newEmbed] });
                return interaction.followUp({ content: `✅ <@${interaction.user.id}> đã trở thành chủ phòng mới!`, ephemeral: false });
            }
            
            if (!isOwner) {
                return interaction.reply({ content: '❌ Chỉ chủ phòng mới có thể dùng chức năng này!', ephemeral: true });
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
                return interaction.followUp({ content: isGhosted ? '✅ Đã BỎ ẨN phòng.' : '✅ Đã ẨN phòng khỏi mọi người.', ephemeral: true });
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
                return interaction.followUp({ content: isLocked ? '✅ Đã MỞ KHÓA kết nối.' : '✅ Đã KHÓA kết nối phòng.', ephemeral: true });
            }

            if (cid === 'j2c_kick') {
                const voiceChannel = interaction.channel;
                const otherMembers = voiceChannel.members.filter(m => m.id !== interaction.user.id && !m.user.bot);
                if (otherMembers.size === 0) {
                    return interaction.reply({ content: '❌ Không có ai khác trong phòng để kích!', ephemeral: true });
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

                return interaction.reply({ content: 'Chọn người mà bạn muốn kích khỏi phòng (Chỉ mình bạn thấy tin nhắn này):', components: [row], ephemeral: true });
            }
        }

        // =============================================
        // POKEMON ROLE BUTTON
        // =============================================
        if (cid === 'get_pokemon_role') {
            const config = loadConfig();
            const roleId = config.pokemonRoleId;
            if (!roleId) return interaction.reply({ content: '❌ Hệ thống chưa cài đặt role.', ephemeral: true });
            
            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) return interaction.reply({ content: '❌ Role không tồn tại hoặc đã bị xóa.', ephemeral: true });
            
            try {
                if (interaction.member.roles.cache.has(roleId)) {
                    await interaction.member.roles.remove(roleId);
                    return interaction.reply({ content: '✅ Bạn đã **hủy** role Pokemon!', ephemeral: true });
                } else {
                    await interaction.member.roles.add(roleId);
                    return interaction.reply({ content: '✅ Bạn đã **nhận** role Pokemon!', ephemeral: true });
                }
            } catch (err) {
                return interaction.reply({ content: '❌ Bot không đủ quyền để cấp role cho bạn (Role bot phải xếp cao hơn role Pokemon).', ephemeral: true });
            }
        }

        // =============================================
        // WILD PET SYSTEM BUTTONS
        // =============================================
        if (cid.startsWith('wild_catch_')) {
            const petId = cid.replace('wild_catch_', '');
            const spawnData = activeSpawns.get(interaction.message.id);
            
            if (!spawnData || !spawnData.active) {
                return interaction.reply({ content: '❌ Thú cưng này đã bị người khác bắt hoặc đã chạy mất!', ephemeral: true }).catch(() => {});
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
                return interaction.reply({ content: '❌ Bạn không có quả bóng nào trong túi! Hãy vào `/shop` (Tab Bắt Pet) để mua!', ephemeral: true });
            }
            
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`wild_throw_select`).setPlaceholder('🎯 Chọn bóng để ném...').addOptions(options)
            );
            
            return interaction.reply({ content: 'Hãy nhanh tay chọn bóng để ném!', components: [row], ephemeral: true });
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
                            .setTitle('🎉 ĐÃ BỊ BẮT!')
                            .setDescription(`Đó là **${petConfig.emoji} ${petConfig.name}**!\n\nNó đã bị <@${interaction.user.id}> thu phục bằng **${ballConfig.emoji} ${ballConfig.name}**!`)
                            .setImage(null)
                            .setColor('#FFD700');
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
            
            if (interaction.user.id !== targetId) return interaction.reply({ content: '❌ Bạn không phải người được thách đấu!', ephemeral: true });
            
            if (getUserCoins(challengerId) < bet) return interaction.reply({ content: `❌ Người thách đấu không còn đủ tiền!`, ephemeral: true });
            if (getUserCoins(targetId) < bet) return interaction.reply({ content: `❌ Bạn không đủ tiền!`, ephemeral: true });
            
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
                return interaction.reply({ content: '❌ Lỗi: Có người đã bán mất thú cưng trước khi trận đấu bắt đầu!', ephemeral: true });
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
            if (interaction.user.id !== targetId) return interaction.reply({ content: '❌ Bạn không phải người được thách đấu!', ephemeral: true });
            return interaction.update({ content: `❌ <@${targetId}> đã từ chối lời thách đấu.`, embeds: [], components: [] });
        }

        // =============================================
        // MA SÓI — LOBBY BUTTONS
        // =============================================
        if (cid.startsWith('ww_join_') || cid.startsWith('ww_start_') || cid.startsWith('ww_cancel_')) {
            const guildId = cid.split('_').slice(2).join('_');
            const game = WW.WW_GAMES.get(guildId);
            if (!game || game.phase !== 'lobby') return interaction.reply({ content: '❌ Phòng này không còn hoạt động!', ephemeral: true });

            if (cid.startsWith('ww_join_')) {
                if (game.players.has(interaction.user.id)) return interaction.reply({ content: '✅ Bạn đã tham gia rồi!', ephemeral: true });
                game.players.set(interaction.user.id, { role: null, alive: true });
                const playerIds = [...game.players.keys()];
                const newEmbed = game._buildLobbyEmbed(playerIds);
                await game.lobbyMsg.edit({ embeds: [newEmbed] }).catch(() => {});
                return interaction.reply({ content: `🎮 Bạn đã tham gia game! Tổng: **${playerIds.length}** người.`, ephemeral: true });
            }

            if (cid.startsWith('ww_cancel_')) {
                if (interaction.user.id !== game.hostId && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
                    return interaction.reply({ content: '❌ Chỉ host mới có thể hủy!', ephemeral: true });
                WW.WW_GAMES.delete(guildId);
                if (game.lobbyTimeout) clearTimeout(game.lobbyTimeout);
                const cancelEmbed = game._buildLobbyEmbed([]).setDescription('❌ Phòng chờ đã bị hủy.').setColor('#888888');
                await game.lobbyMsg.edit({ embeds: [cancelEmbed], components: [] }).catch(() => {});
                return interaction.reply({ content: '❌ Đã hủy game!', ephemeral: true });
            }

            if (cid.startsWith('ww_start_')) {
                if (interaction.user.id !== game.hostId && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
                    return interaction.reply({ content: '❌ Chỉ host mới có thể bắt đầu!', ephemeral: true });
                if (game.players.size < 4) return interaction.reply({ content: `❌ Cần ít nhất **4 người**! Hiện có ${game.players.size}.`, ephemeral: true });
                game._addCoins = addCoins;
                await interaction.reply({ content: '▶️ Game bắt đầu!', ephemeral: true });
                return WW.startGame(game, client, interaction.channel);
            }
        }

        // =============================================
        // MA SÓI — NIGHT DM ACTIONS (from DMs)
        // =============================================
        if (cid.startsWith('ww_wolf_kill_') || cid.startsWith('ww_seer_check_') ||
            cid.startsWith('ww_doctor_protect_') || cid.startsWith('ww_witch_')) {

            const parts = cid.split('_');
            const guildId = parts.slice(2).join('_').replace(/^(wolf_kill_|seer_check_|doctor_protect_|witch_save_|witch_kill_|witch_skip_)/, '');

            // Find game by checking all games for this guild
            let game = null;
            for (const [gid, g] of WW.WW_GAMES) {
                if (cid.endsWith(gid)) { game = g; break; }
            }
            if (!game || game.phase !== 'night') return interaction.reply({ content: '❌ Không phải lúc hành động!', ephemeral: true });

            // Wolf kill
            if (cid.startsWith('ww_wolf_kill_')) {
                const pdata = game.players.get(interaction.user.id);
                if (!pdata || pdata.role !== 'WEREWOLF') return interaction.reply({ content: '❌ Bạn không phải Ma Sói!', ephemeral: true });
                const targetId = interaction.values[0];
                game.nightActions.wolfTarget = targetId;
                return interaction.reply({ content: `✅ Đã chọn giết! Chờ các vai khác hoàn thành.`, ephemeral: true });
            }

            // Seer check
            if (cid.startsWith('ww_seer_check_')) {
                const pdata = game.players.get(interaction.user.id);
                if (!pdata || pdata.role !== 'SEER') return interaction.reply({ content: '❌ Bạn không phải Tiên Tri!', ephemeral: true });
                const targetId = interaction.values[0];
                const targetRole = game.players.get(targetId)?.role;
                const roleInfo = WW.WW_ROLES[targetRole];
                const team = roleInfo?.team === 'evil' ? '🐺 **Phe Ác (Ma Sói)**' : '✅ **Phe Dân Làng**';
                const targetUser = await client.users.fetch(targetId).catch(() => null);
                await interaction.reply({ content: `🔮 **Kết quả điều tra:** <@${targetId}> (${targetUser?.username || '?'}) là ${team}`, ephemeral: true });
                game.nightActions.seerTarget = targetId;
                return;
            }

            // Doctor protect
            if (cid.startsWith('ww_doctor_protect_')) {
                const pdata = game.players.get(interaction.user.id);
                if (!pdata || pdata.role !== 'DOCTOR') return interaction.reply({ content: '❌ Bạn không phải Thầy Thuốc!', ephemeral: true });
                const targetId = interaction.values[0];
                game.nightActions.doctorTarget = targetId;
                return interaction.reply({ content: `✅ Bạn đang bảo vệ <@${targetId}> tối nay!`, ephemeral: true });
            }

            // Witch save (cứu người bị Ma Sói tấn công)
            if (cid.startsWith('ww_witch_save_')) {
                const pdata = game.players.get(interaction.user.id);
                if (!pdata || pdata.role !== 'WITCH' || !game.witchSave) return interaction.reply({ content: '❌ Không thể dùng thuốc cứu!', ephemeral: true });
                game.nightActions.witchSave = true;
                game.witchSave = false;
                return interaction.reply({ content: '💊 Bạn đã dùng Thuốc Cứu! Người bị tấn công đêm nay sẽ được sống!', ephemeral: true });
            }

            // Witch kill
            if (cid.startsWith('ww_witch_kill_')) {
                const pdata = game.players.get(interaction.user.id);
                if (!pdata || pdata.role !== 'WITCH' || !game.witchKill) return interaction.reply({ content: '❌ Không thể dùng thuốc độc!', ephemeral: true });
                // Cần chọn mục tiêu — gửi select menu
                const opts = [...game.players.entries()]
                    .filter(([id, p]) => p.alive)
                    .map(([uid]) => {
                        const u = client.users.cache.get(uid);
                        return new StringSelectMenuOptionBuilder().setLabel(u?.username || uid).setValue(uid);
                    });
                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId(`ww_witch_poison_${game.guildId}`).setPlaceholder('Chọn mục tiêu...').addOptions(opts)
                );
                return interaction.reply({ content: '☠️ Chọn người bạn muốn đầu độc:', components: [row], ephemeral: true });
            }

            // Witch poison select
            if (cid.startsWith('ww_witch_poison_')) {
                const pdata = game.players.get(interaction.user.id);
                if (!pdata || pdata.role !== 'WITCH') return interaction.reply({ content: '❌ Bạn không phải Phù Thủy!', ephemeral: true });
                const targetId = interaction.values[0];
                game.nightActions.witchKillTarget = targetId;
                game.witchKill = false;
                return interaction.reply({ content: `☠️ Đã đầu độc <@${targetId}>!`, ephemeral: true });
            }

            // Witch skip
            if (cid.startsWith('ww_witch_skip_')) {
                return interaction.reply({ content: '⏭️ Bạn đã bỏ qua lượt này.', ephemeral: true });
            }
        }

        // =============================================
        // MA SÓI — DAY VOTE BUTTONS
        // =============================================
        if (cid.startsWith('ww_vote_')) {
            const parts = cid.replace('ww_vote_', '').split('_');
            // Format: ww_vote_{guildId}_{targetId}
            // guildId could have underscores, targetId is last numeric segment
            // Find game
            let game = null;
            let targetId = null;
            for (const [gid, g] of WW.WW_GAMES) {
                if (cid === `ww_vote_${gid}` || cid === `ww_endvote_${gid}`) { game = g; break; }
                if (cid.startsWith(`ww_vote_${gid}_`)) {
                    game = g;
                    targetId = cid.replace(`ww_vote_${gid}_`, '');
                    break;
                }
            }
            if (!game || game.phase !== 'day') return interaction.reply({ content: '❌ Không phải lúc bỏ phiếu!', ephemeral: true });

            // End vote button
            if (cid.startsWith('ww_endvote_')) {
                if (interaction.user.id !== game.hostId && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
                    return interaction.reply({ content: '❌ Chỉ host mới được kết thúc sớm!', ephemeral: true });
                await interaction.reply({ content: '⏹️ Host đã kết thúc bỏ phiếu!', ephemeral: true });
                return WW.resolveDay(game, client, interaction.channel);
            }

            // Vote for someone
            const voter = game.players.get(interaction.user.id);
            if (!voter?.alive) return interaction.reply({ content: '❌ Bạn đã chết rồi, không thể vote!', ephemeral: true });
            if (!game.players.get(targetId)?.alive) return interaction.reply({ content: '❌ Người này đã chết!', ephemeral: true });
            const prevVote = game.votes.get(interaction.user.id);
            game.votes.set(interaction.user.id, targetId);
            const targetUser = await client.users.fetch(targetId).catch(() => null);
            const msg = prevVote && prevVote !== targetId
                ? `🔄 Đã đổi vote sang **${targetUser?.displayName || targetUser?.username || targetId}**!`
                : `✅ Đã vote **${targetUser?.displayName || targetUser?.username || targetId}**!`;
            return interaction.reply({ content: msg, ephemeral: true });
        }

        // === XỬ LÝ NÚT NGÂN HÀNG ===
        if (interaction.customId.startsWith('bank_') && !interaction.customId.includes('modal_')) {
            const parts = interaction.customId.split('_');
            const action = parts[1]; // deposit, withdraw, top, refresh
            const ownerId = parts[3];
            
            if (interaction.user.id !== ownerId) {
                return interaction.reply({ content: '❌ Menu ngân hàng này không phải của bạn! Hãy tự dùng lệnh `/bank` hoặc `!bank` để mở menu của riêng bạn.', ephemeral: true });
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
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            
            if (action === 'refresh') {
                const embed = buildBankEmbed(interaction.user);
                return interaction.update({ embeds: [embed], components: buildBankButtons(ownerId) });
            }
        }

        // Xử lý nút xác nhận thanh toán
        if (interaction.customId.startsWith('confirm_payment_')) {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
                return interaction.reply({ content: '❌ Bạn không có quyền!', ephemeral: true });
            const addInfo = interaction.customId.replace('confirm_payment_', '');
            const updatedRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('confirmed').setLabel('Đã xác nhận thanh toán').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );
            await interaction.update({ components: [updatedRow] });
            await interaction.channel.send(`🎉 **Xác nhận thành công!** Đã nhận thanh toán cho: **${addInfo}**.`);
        }

        // === XỬ LÝ NÚT KẾT HÔN ===
        if (interaction.customId.startsWith('marry_')) {
            const parts = interaction.customId.split('_');
            const action = parts[1]; // ring, accept or decline
            const senderId = parts[2];
            const targetId = parts[3];
            
            if (action === 'ring') {
                if (interaction.user.id !== senderId) return interaction.reply({ content: '❌ Đây không phải là menu cầu hôn của bạn!', ephemeral: true });
                const ringId = interaction.values[0];
                const ring = MARRY_RINGS[ringId];
                const p1 = getPlayer(senderId);
                const hasRing = p1.rings && p1.rings[ringId] > 0;
                
                if (!hasRing && getUserCoins(senderId) < ring.price) {
                    return interaction.reply({ content: `❌ Bạn không có sẵn nhẫn và cần **${ring.price.toLocaleString()} 🪙** để mua ${ring.name}!`, ephemeral: true });
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
                return interaction.reply({ content: '❌ Bạn không phải là người được cầu hôn!', ephemeral: true });
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
                if (p1.partner || p2.partner) return interaction.reply({ content: '❌ Một trong hai người đã kết hôn với người khác rồi!', ephemeral: true });

                const hasRing = p1.rings && p1.rings[ringId] > 0;

                if (!hasRing && getUserCoins(senderId) < ring.price) {
                    return interaction.reply({ content: `❌ <@${senderId}> không có sẵn nhẫn và không còn đủ ${ring.price.toLocaleString()} 🪙 để mua mới! Lễ cưới bị hủy.`, ephemeral: true });
                }
                
                if (hasRing) {
                    updatePlayer(senderId, dp => {
                        dp.rings[ringId] -= 1;
                    });
                } else {
                    addCoins(senderId, -ring.price);
                }
                updatePlayer(senderId, dp => dp.partner = targetId);
                updatePlayer(targetId, dp => dp.partner = senderId);
                
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
                if (interaction.user.id !== senderId) return interaction.reply({ content: '❌ Đây không phải là giao dịch của bạn!', ephemeral: true });
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
                if (interaction.user.id !== targetId) return interaction.reply({ content: '❌ Đây không phải lượt chọn của bạn!', ephemeral: true });
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
                if (interaction.user.id !== senderId && interaction.user.id !== targetId) return interaction.reply({ content: '❌ Bạn không có quyền hủy giao dịch này!', ephemeral: true });
                await interaction.update({ components: [] });
                return interaction.channel.send(`❌ Giao dịch giữa <@${senderId}> và <@${targetId}> đã bị hủy!`);
            }
            
            if (action === 'accept') {
                if (interaction.user.id !== senderId) return interaction.reply({ content: '❌ Chỉ người khởi xướng mới có thể chốt giao dịch!', ephemeral: true });
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
            if (interaction.user.id !== ADMIN_ID) return interaction.reply({ content: '❌ Ngươi không phải Sáng Thế Thần!', ephemeral: true });
            
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
                    content: `👑 Chế độ Đấng Sáng Tạo đã được **${isCheatOn ? 'BẬT' : 'TẮT'}**!\n${isCheatOn ? 'Bạn đã nhận 1 Tỷ Coin, xóa mọi thời gian chờ và hack Minigames!' : 'Tài sản đã reset về 500k và tắt hack!'}`, 
                    components: [newRow],
                    embeds: [] // Xóa embed cho gọn nếu muốn, hoặc giữ nguyên
                });
            }
        }

        // === XỬ LÝ NÚT GAME MA SÓI ===
        if (interaction.customId.startsWith('ww_myrole_')) {
            const channelId = interaction.customId.replace('ww_myrole_', '');
            const game = wwGames.get(channelId);
            if (!game || game.status === 'LOBBY') return interaction.reply({ content: '❌ Game không tồn tại hoặc chưa bắt đầu!', ephemeral: true });
            
            const p = game.players.get(interaction.user.id);
            if (!p) return interaction.reply({ content: '❌ Bạn không tham gia game này!', ephemeral: true });
            
            let desc = `Vai trò của bạn là: **${p.role}**\n\n`;
            if (p.role === WW_ROLES.WOLF) desc += 'Mục tiêu: Tiêu diệt hết Dân làng và phe bảo vệ. Bạn sẽ thức dậy mỗi đêm để chọn người cắn.';
            else if (p.role === WW_ROLES.SEER) desc += 'Mục tiêu: Giúp dân làng tìm ra Sói. Bạn sẽ thức dậy mỗi đêm để xem vai trò thực sự của một người.';
            else if (p.role === WW_ROLES.GUARD) desc += 'Mục tiêu: Bảo vệ những người vô tội. Bạn sẽ thức dậy mỗi đêm để chọn một người bảo vệ khỏi Sói cắn.';
            else desc += 'Mục tiêu: Sống sót và treo cổ Sói. Hãy suy luận và dùng phiếu bầu của mình vào ban ngày.';
            
            return interaction.reply({ content: desc, ephemeral: true });
        }

        if (interaction.customId.startsWith('ww_action_')) {
            const channelId = interaction.customId.replace('ww_action_', '');
            const game = wwGames.get(channelId);
            if (!game || game.status !== 'NIGHT') return interaction.reply({ content: '❌ Hiện không phải ban đêm!', ephemeral: true });
            
            const p = game.players.get(interaction.user.id);
            if (!p) return interaction.reply({ content: '❌ Bạn không chơi game này!', ephemeral: true });
            if (!p.alive) return interaction.reply({ content: '👻 Người chết không được nói!', ephemeral: true });
            
            if (p.role === WW_ROLES.VILLAGER) {
                return interaction.reply({ content: '💤 Dân làng bình thường không có kỹ năng ban đêm. Hãy đi ngủ!', ephemeral: true });
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
            
            return interaction.reply({ content: 'Hãy sử dụng kỹ năng của bạn (Bí mật):', components: [row], ephemeral: true });
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
            if (!game || game.status !== 'DAY') return interaction.reply({ content: '❌ Hiện không phải ban ngày!', ephemeral: true });
            
            const p = game.players.get(interaction.user.id);
            if (!p) return interaction.reply({ content: '❌ Bạn không chơi game này!', ephemeral: true });
            if (!p.alive) return interaction.reply({ content: '👻 Người chết không được bầu cử!', ephemeral: true });
            
            const targetId = interaction.values[0];
            game.dayVotes.set(p.id, targetId);
            
            if (targetId === 'skip') {
                return interaction.reply({ content: '🗳️ Đã chọn **Skip Vote**.', ephemeral: true });
            } else {
                return interaction.reply({ content: `🗳️ Bạn đã vote treo cổ **${game.players.get(targetId).user.username}**!`, ephemeral: true });
            }
        }

        // === XỬ LÝ NÚT NHẠC ===
        const musicButtonIds = ['music_toggle', 'music_skip', 'music_stop', 'music_queue', 'music_vol_down', 'music_vol_up', 'music_loop'];

        // === XỬ LÝ NÚT TÀI XỈU ===
        if (interaction.customId.startsWith('tx_')) {
            const game = taixiuGames.get(interaction.message.id);
            if (!game) return interaction.reply({ content: '❌ Phiên Tài Xỉu này đã hết hạn hoặc không tồn tại!', ephemeral: true });
            if (game.uid !== interaction.user.id) return interaction.reply({ content: '❌ Đây không phải bàn cược của bạn!', ephemeral: true });
            
            const betChoice = interaction.customId.replace('tx_', '');
            const { uid, bet } = game;
            
            if (getUserCoins(uid) < bet) {
                taixiuGames.delete(interaction.message.id);
                return interaction.reply({ content: '❌ Bạn không đủ coin để chơi!', ephemeral: true });
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
                return interaction.reply({ content: '❌ Bàn Bầu Cua này đã đóng!', ephemeral: true });
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
            if (interaction.user.id !== ownerId) return interaction.reply({ content: '❌ Menu việc làm này không phải của bạn!', ephemeral: true });
            
            const jobId = interaction.values[0];
            const job = WORK_JOBS[jobId];
            if (!job) return interaction.reply({ content: '❌ Công việc không tồn tại!', ephemeral: true });
            
            const data = loadCoins();
            if (!data[ownerId]) data[ownerId] = { coins: 0 };
            const user = data[ownerId];
            
            if (user.workEnd && Date.now() < user.workEnd) {
                return interaction.reply({ content: '❌ Bạn đang làm một công việc khác rồi!', ephemeral: true });
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
            if (!game) return interaction.reply({ content: '❌ Không có game Blackjack nào!', ephemeral: true });
            if (game.uid !== interaction.user.id) return interaction.reply({ content: '❌ Đây không phải game của bạn!', ephemeral: true });

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
                if (getUserCoins(game.uid) < game.bet) return interaction.reply({ content: '❌ Không đủ coin để gấp đôi!', ephemeral: true });
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
                return interaction.reply({ content: '❌ Không có nhạc đang phát!', ephemeral: true }).catch(console.error);
            }

            // Kiểm tra quyền: chỉ DJ (người gọi /play) mới điều khiển được
            if (interaction.user.id !== state.djId) {
                return interaction.reply({
                    content: `❌ Chỉ <@${state.djId}> (người gọi nhạc) mới có thể điều khiển!`,
                    ephemeral: true
                }).catch(console.error);
            }

            // --- NÚt TẠM DỬ NG / TIẾP TỤC ---
            if (interaction.customId === 'music_toggle') {
                if (state.paused) {
                    state.player.unpause();
                    state.paused = false;
                } else {
                    state.player.pause();
                    state.paused = true;
                }
                const song = state.queue[0];
                const embed = new EmbedBuilder()
                    .setTitle(state.paused ? '⏸ Đang tạm dừng' : '🎵 Đang phát nhạc')
                    .setDescription(`**[${song.title}](${song.url})**`)
                    .addFields(
                        { name: '⏱ Thời lượng', value: song.duration || 'N/A', inline: true },
                        { name: '👤 Yêu cầu bởi', value: `<@${song.requestedById}>`, inline: true },
                        { name: '📋 Hàng đợi', value: `${state.queue.length} bài`, inline: true },
                        { name: '🔊 Âm lượng', value: `${Math.round(state.volume * 100)}%`, inline: true }
                    )
                    .setThumbnail(song.thumbnail)
                    .setColor(state.paused ? '#FFA500' : '#FF0000')
                    .setFooter({ text: `🎶 Chỉ <@!${state.djId}> mới điều khiển được${state.loop ? ' | 🔁 Đang lặp' : ''}` });
                const controls = buildMusicControls(state.paused, state.volume, state.loop);
                await interaction.update({ embeds: [embed], components: controls });
            }

            // --- NÚT LẶP BÀI ---
            else if (interaction.customId === 'music_loop') {
                state.loop = !state.loop;
                const song = state.queue[0];
                const embed = new EmbedBuilder()
                    .setTitle(state.paused ? '⏸ Đang tạm dừng' : '🎵 Đang phát nhạc')
                    .setDescription(`**[${song.title}](${song.url})**`)
                    .addFields(
                        { name: '⏱ Thời lượng', value: song.duration || 'N/A', inline: true },
                        { name: '👤 Yêu cầu bởi', value: `<@${song.requestedById}>`, inline: true },
                        { name: '📋 Hàng đợi', value: `${state.queue.length} bài`, inline: true },
                        { name: '🔊 Âm lượng', value: `${Math.round(state.volume * 100)}%`, inline: true }
                    )
                    .setThumbnail(song.thumbnail)
                    .setColor(state.paused ? '#FFA500' : '#FF0000')
                    .setFooter({ text: `🎶 Chỉ <@!${state.djId}> mới điều khiển được${state.loop ? ' | 🔁 Đang lặp' : ''}` });
                
                const controls = buildMusicControls(state.paused, state.volume, state.loop);
                await interaction.update({ embeds: [embed], components: controls });
                return interaction.followUp({ content: state.loop ? '🔁 Đã BẬT chế độ lặp bài hiện tại!' : '➡ Đã TẮT chế độ lặp bài!', ephemeral: true });
            }

            // --- NÚt BọO QUA ---
            else if (interaction.customId === 'music_skip') {
                await interaction.deferUpdate();
                state.player.stop();
                // playNext sẽ tự động chạy qua Idle event
            }

            // --- NÚt DẮNG HẲN ---
            else if (interaction.customId === 'music_stop') {
                state.queue.length = 0;
                state.player.stop();
                state.connection?.destroy();
                musicQueues.delete(interaction.guildId);
                await interaction.update({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('⏹ Đã dừng nhạc')
                            .setDescription('Bot đã rời khỏi kênh thoại.')
                            .setColor('#555555')
                    ],
                    components: []
                });
            }

            // --- NÚt XEM HÀNG ĐỢI ---
            else if (interaction.customId === 'music_queue') {
                if (!state.queue.length) {
                    return interaction.reply({ content: '📋 Hàng đợi trống!', ephemeral: true });
                }
                const queueList = state.queue.slice(0, 10).map((s, i) =>
                    `${i === 0 ? '▶ **[Đang phát]**' : `${i}.`} [${s.title}](${s.url}) • \`${s.duration || 'N/A'}\``
                ).join('\n');
                const embed = new EmbedBuilder()
                    .setTitle(`📋 Hàng đợi nhạc (${state.queue.length} bài)`)
                    .setDescription(queueList)
                    .setColor('#0099ff')
                    .setFooter({ text: state.queue.length > 10 ? `... và ${state.queue.length - 10} bài nữa` : '​' });
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // --- NÚT ÂM LƯỢNG ---
            else if (interaction.customId === 'music_vol_down' || interaction.customId === 'music_vol_up') {
                const delta = interaction.customId === 'music_vol_up' ? 0.1 : -0.1;
                state.volume = Math.max(0, Math.min(2.0, state.volume + delta));
                // Áp dụng ngay lập tức vào AudioResource đang chạy
                if (state.resource?.volume) {
                    state.resource.volume.setVolume(state.volume);
                }
                const song = state.queue[0];
                const embed = new EmbedBuilder()
                    .setTitle(state.paused ? '⏸ Đang tạm dừng' : '🎵 Đang phát nhạc')
                    .setDescription(`**[${song.title}](${song.url})**`)
                    .addFields(
                        { name: '⏱ Thời lượng', value: song.duration || 'N/A', inline: true },
                        { name: '👤 Yêu cầu bởi', value: `<@${song.requestedById}>`, inline: true },
                        { name: '📋 Hàng đợi', value: `${state.queue.length} bài`, inline: true },
                        { name: '🔊 Âm lượng', value: `${Math.round(state.volume * 100)}%`, inline: true }
                    )
                    .setThumbnail(song.thumbnail)
                    .setColor(state.paused ? '#FFA500' : '#FF0000')
                    .setFooter({ text: `🎶 Chỉ <@!${state.djId}> mới điều khiển được${state.loop ? ' | 🔁 Đang lặp' : ''}` });
                await interaction.update({ embeds: [embed], components: buildMusicControls(state.paused, state.volume, state.loop) });
        }
    }
}

    // === MODAL SUBMIT ===
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'j2c_name_modal') {
            const newName = interaction.fields.getTextInputValue('new_name');
            await interaction.channel.setName(newName).catch(() => {});
            return interaction.reply({ content: `✅ Đã đổi tên phòng thành: **${newName}**`, ephemeral: true });
        }
        
        if (interaction.customId === 'j2c_limit_modal') {
            const limitStr = interaction.fields.getTextInputValue('new_limit');
            const limit = parseInt(limitStr);
            if (isNaN(limit) || limit < 0 || limit > 99) {
                return interaction.reply({ content: '❌ Vui lòng nhập số từ 0 đến 99 (0 = Không giới hạn)!', ephemeral: true });
            }
            await interaction.channel.setUserLimit(limit).catch(() => {});
            
            const oldEmbed = interaction.message.embeds[0];
            if (oldEmbed) {
                const newEmbed = EmbedBuilder.from(oldEmbed);
                newEmbed.data.fields[1].value = limit === 0 ? 'Không giới hạn' : `${limit} người`;
                await interaction.message.edit({ embeds: [newEmbed] }).catch(() => {});
            }
            return interaction.reply({ content: `✅ Đã chỉnh giới hạn phòng thành: **${limit === 0 ? 'Không giới hạn' : limit + ' người'}**`, ephemeral: true });
        }

        if (interaction.customId.startsWith('bcmodal_')) {
            const parts = interaction.customId.split('_');
            const choice = parts[1];
            const channelId = parts[2];
            
            const game = baucuaChannels.get(channelId);
            if (!game) {
                return interaction.reply({ content: '❌ Bàn Bầu Cua này đã kết thúc!', ephemeral: true });
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
                    return interaction.reply({ content: '❌ Cú pháp không hợp lệ. Vui lòng nhập số coin (tối thiểu 10) hoặc "all".', ephemeral: true });
                }
            }
            
            if (finalAmount > 500000) return interaction.reply({ content: '❌ Mức cược tối đa là **500,000 🪙**!', ephemeral: true });
            if (cash < finalAmount) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${cash.toLocaleString()} 🪙**.`, ephemeral: true });
            
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
            
            return interaction.reply({ content: `✅ Bạn đã đặt cược **${finalAmount.toLocaleString()} 🪙** vào **${faceNames[choice]}** thành công!`, ephemeral: true });
        }
        
        if (interaction.customId.startsWith('bank_deposit_modal_')) {
            const ownerId = interaction.customId.replace('bank_deposit_modal_', '');
            if (interaction.user.id !== ownerId) return interaction.reply({ content: '❌ Bạn không phải chủ sở hữu giao dịch này!', ephemeral: true });
            
            const amount = interaction.fields.getTextInputValue('deposit_amount_input').trim().toLowerCase();
            const cash = getUserCoins(ownerId);
            let finalAmount;
            
            if (amount === 'all') {
                finalAmount = cash;
            } else {
                finalAmount = parseInt(amount);
                if (isNaN(finalAmount) || finalAmount <= 0) {
                    return interaction.reply({ content: '❌ Số tiền không hợp lệ! Vui lòng nhập số nguyên dương hoặc "all".', ephemeral: true });
                }
            }
            
            if (cash < finalAmount) {
                return interaction.reply({ content: `❌ Bạn không đủ tiền mặt! (Hiện có: **${cash.toLocaleString()} 🪙** tiền mặt)`, ephemeral: true });
            }
            if (finalAmount === 0) {
                return interaction.reply({ content: '❌ Bạn không có tiền mặt để gửi!', ephemeral: true });
            }
            
            addCoins(ownerId, -finalAmount);
            addBank(ownerId, finalAmount);
            
            const embed = buildBankEmbed(interaction.user);
            await interaction.update({ embeds: [embed], components: buildBankButtons(ownerId) });
            return interaction.followUp({ content: `✅ Đã gửi **${finalAmount.toLocaleString()} 🪙** vào ngân hàng thành công!`, ephemeral: true });
        }
        
        if (interaction.customId.startsWith('bank_withdraw_modal_')) {
            const ownerId = interaction.customId.replace('bank_withdraw_modal_', '');
            if (interaction.user.id !== ownerId) return interaction.reply({ content: '❌ Bạn không phải chủ sở hữu giao dịch này!', ephemeral: true });
            
            const amount = interaction.fields.getTextInputValue('withdraw_amount_input').trim().toLowerCase();
            const bank = getUserBank(ownerId);
            let finalAmount;
            
            if (amount === 'all') {
                finalAmount = bank;
            } else {
                finalAmount = parseInt(amount);
                if (isNaN(finalAmount) || finalAmount <= 0) {
                    return interaction.reply({ content: '❌ Số tiền không hợp lệ! Vui lòng nhập số nguyên dương hoặc "all".', ephemeral: true });
                }
            }
            
            if (bank < finalAmount) {
                return interaction.reply({ content: `❌ Tài khoản ngân hàng của bạn không đủ tiền! (Hiện có: **${bank.toLocaleString()} 🪙** trong ngân hàng)`, ephemeral: true });
            }
            if (finalAmount === 0) {
                return interaction.reply({ content: '❌ Ngân hàng của bạn đang trống, không thể rút!', ephemeral: true });
            }
            
            addBank(ownerId, -finalAmount);
            addCoins(ownerId, finalAmount);
            
            const embed = buildBankEmbed(interaction.user);
            await interaction.update({ embeds: [embed], components: buildBankButtons(ownerId) });
            return interaction.followUp({ content: `✅ Đã rút **${finalAmount.toLocaleString()} 🪙** về ví tiền mặt thành công!`, ephemeral: true });
        }
        if (interaction.customId.startsWith('shop_buy_modal_')) {
            const parts = interaction.customId.replace('shop_buy_modal_', '').split('_');
            const type = parts[0];
            const itemCode = parts.slice(1).join('_');
            
            const amountStr = interaction.fields.getTextInputValue('buy_amount_input').trim();
            const amount = parseInt(amountStr);
            if (isNaN(amount) || amount <= 0) {
                return interaction.reply({ content: '❌ Số lượng không hợp lệ! Vui lòng nhập số nguyên lớn hơn 0.', ephemeral: true });
            }
            
            let item;
            if (type === 'ring') item = MARRY_RINGS[itemCode];
            else if (type === 'potion') item = RPG_ITEMS.potions[itemCode];
            else if (type === 'pokeball') item = RPG_ITEMS.pokeballs[itemCode];
            
            if (!item) return interaction.reply({ content: '❌ Món đồ không tồn tại!', ephemeral: true });
            
            const totalCost = item.price * amount;
            const coins = getUserCoins(interaction.user.id);
            
            if (coins < totalCost) {
                return interaction.reply({ content: `❌ Bạn không đủ tiền! Cần **${totalCost.toLocaleString()} 🪙** để mua ${amount}x ${item.name}.`, ephemeral: true });
            }
            
            addCoins(interaction.user.id, -totalCost);
            
            updatePlayer(interaction.user.id, p => {
                if (type === 'ring') {
                    if (!p.rings) p.rings = {};
                    p.rings[itemCode] = (p.rings[itemCode] || 0) + amount;
                } else {
                    p.inventory[itemCode] = (p.inventory[itemCode] || 0) + amount;
                }
            });
            
            let msgContent = `✅ Bạn đã mua **${amount}x ${item.emoji} ${item.name}** thành công! Đã trừ **${totalCost.toLocaleString()} 🪙**.\nSố dư: **${getUserCoins(interaction.user.id).toLocaleString()} 🪙**`;
            if (type === 'ring') msgContent += `\n> Dùng lệnh \`/marry\` để cầu hôn với nhẫn này!`;
            
            return interaction.reply({ content: msgContent, ephemeral: true });
        }
    }

    // === SLASH COMMANDS ===
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (commandName === 'nopphat' || commandName === 'bribe') {
        const data = loadCoins();
        if (!data[uid] || !data[uid].jailEnd || Date.now() >= data[uid].jailEnd) {
            return interaction.reply({ content: '❌ Bạn có ở trong tù đâu mà đòi nộp phạt!', ephemeral: true });
        }
        if ((data[uid].coins || 0) < 100000) {
            return interaction.reply({ content: '❌ Không đủ tiền! Bạn cần **100,000 🪙** tiền mặt để nộp phạt.', ephemeral: true });
        }
        data[uid].coins -= 100000;
        data[uid].jailEnd = null;
        saveCoins(data);
        return interaction.reply({ content: '🔓 Bạn đã nộp **100,000 🪙** cho công an và được thả tự do!', ephemeral: false });
    }

    if (commandName === 'robbank' || commandName === 'heist') {
        const robTarget = interaction.options?.getUser('user');
        return handleRobbank(uid, interaction, robTarget ? robTarget.id : null);
    }

    // --- HELP ---
    if (commandName === 'help') {
        const prefix = getPrefix();
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
            if (page === 8 || page === 9) {
                // Trang Admin: chỉ Admin mới được xem, hiển thị ẩn
                const isAdmin = i.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
                if (!isAdmin) {
                    return i.reply({ content: '🔒 **Trang này chỉ dành cho Admin!** Bạn không có quyền xem mục này.', ephemeral: true });
                }
                await i.update({ components: [row] });
                return i.followUp({ embeds: [pages[page]], ephemeral: true });
            }
            if (i.user.id !== interaction.user.id) {
                return i.reply({ content: '❌ Chỉ người dùng lệnh mới có thể điều hướng!', ephemeral: true });
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
        const voiceChannel = interaction.member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({ content: '❌ Bạn cần vào **voice channel** trước!', ephemeral: true });
        }

        const perms = voiceChannel.permissionsFor(client.user);
        if (!perms.has(PermissionsBitField.Flags.Connect) || !perms.has(PermissionsBitField.Flags.Speak)) {
            return interaction.reply({ content: '❌ Bot không có quyền vào kênh thoại này!', ephemeral: true });
        }

        await interaction.deferReply();

        try {
            let songInfo;
            await interaction.editReply('⏳ Đang xử lý bài hát...');
            const info = await ytdlpGetInfo(query);
            if (!info) return interaction.editReply('❌ Không tìm thấy bài hát nào!');
            const durationSec = parseInt(info.duration) || 0;
            const mins = Math.floor(durationSec / 60);
            const secs = durationSec % 60;
            songInfo = {
                title: info.title,
                url: info.webpage_url,
                duration: `${mins}:${String(secs).padStart(2, '0')}`,
                thumbnail: info.thumbnail,
                requestedBy: interaction.user.tag,
                requestedById: interaction.user.id
            };

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

            state.queue.push(songInfo);
            // Lưu DJ (người khởi đầu) nếu chưa có
            if (!state.djId) state.djId = interaction.user.id;

            if (state.queue.length === 1 && (!state.player || state.player.state.status === AudioPlayerStatus.Idle)) {
                await playNext(interaction.guildId, interaction.channel);
                await interaction.editReply({ content: `🎵 Đang phát: **${songInfo.title}**` });
            } else {
                const embed = new EmbedBuilder()
                    .setTitle('📋 Đã thêm vào hàng đợi')
                    .setDescription(`**[${songInfo.title}](${songInfo.url})**`)
                    .addFields(
                        { name: '⏱ Thời lượng', value: songInfo.duration || 'N/A', inline: true },
                        { name: '📍 Vị trí', value: `#${state.queue.length}`, inline: true }
                    )
                    .setThumbnail(songInfo.thumbnail)
                    .setColor('#FF6600');
                await interaction.editReply({ embeds: [embed] });
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
            return interaction.reply({ content: '❌ Không có bài nào đang phát!', ephemeral: true });
        }
        state.player.stop();
        return interaction.reply('⏭ Đã bỏ qua bài nhạc!');
    }

    // --- STOP ---
    if (commandName === 'stop') {
        const state = getQueue(interaction.guildId);
        if (!state.connection) {
            return interaction.reply({ content: '❌ Bot không ở trong voice channel!', ephemeral: true });
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
        if (!petInfo) return interaction.reply({ content: '❌ Pet ID không hợp lệ! (Ví dụ: pikachu, arceus, lugia...)', ephemeral: true });
        
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
        if (!state.player) return interaction.reply({ content: '❌ Không có nhạc đang phát!', ephemeral: true });
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
        if (!state.player) return interaction.reply({ content: '❌ Không có nhạc để tiếp tục!', ephemeral: true });
        state.player.unpause();
        return interaction.reply('▶ Đã tiếp tục phát nhạc!');
    }

    // --- QUEUE ---
    if (commandName === 'queue') {
        const state = getQueue(interaction.guildId);
        if (!state.queue.length) {
            return interaction.reply({ content: '📋 Hàng đợi trống!', ephemeral: true });
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
            return interaction.reply({ content: '❌ Không có bài nào đang phát!', ephemeral: true });
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
        const config = loadConfig();
        config.spawnChannelId = targetChannel.id;
        saveConfig(config);
        return interaction.reply({ content: `✅ Đã thiết lập kênh xuất hiện Pokemon hoang dã tại ${targetChannel}!` });
    }

    if (commandName === 'setj2c') {
        const targetChannel = interaction.options.getChannel('channel');
        const config = loadConfig();
        config.j2cChannelId = targetChannel.id;
        saveConfig(config);
        return interaction.reply({ content: `✅ Đã thiết lập kênh gốc Join to Create tại ${targetChannel}!` });
    }

    if (commandName === 'setwelcome') {
        if (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return interaction.reply({ content: '❌ Bạn không có quyền!', ephemeral: true });
        
        const channel = interaction.options.getChannel('channel');
        const messageStr = interaction.options.getString('message');
        const image = interaction.options.getString('image');
        
        const config = loadConfig();
        config.welcomeChannelId = channel.id;
        if (messageStr) config.welcomeMessage = messageStr;
        if (image) config.welcomeImage = image;
        saveConfig(config);
        
        return interaction.reply({ content: `✅ Đã cài đặt chào mừng!\n- **Kênh:** ${channel}\n- **Lời chào:** ${messageStr || 'Mặc định'}\n- **Ảnh:** ${image || 'Không có'}`, ephemeral: true });
    }

    if (commandName === 'setuppokemonrole') {
        if (interaction.user.id !== ADMIN_ID) 
            return interaction.reply({ content: '❌ Lệnh này chỉ dành riêng cho Chủ Bot!', ephemeral: true });
        
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
                return interaction.reply({ content: '❌ Bot không có đủ quyền để tạo role. Vui lòng cấp quyền `Manage Roles` cho bot.', ephemeral: true });
            }
        }
        
        const config = loadConfig();
        config.pokemonRoleId = role.id;
        saveConfig(config);
        
        const embed = new EmbedBuilder()
            .setTitle('🔔 Đăng Ký Nhận Thông Báo Pokemon')
            .setDescription('Bấm vào nút bên dưới để nhận (hoặc hủy) role **Pokemon**.\nBạn sẽ được thông báo ngay lập tức mỗi khi có Pokemon Huyền Thoại xuất hiện!')
            .setColor('#FF0000');
            
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('get_pokemon_role').setLabel('Nhận / Hủy Role Pokemon').setStyle(ButtonStyle.Primary).setEmoji('🐾')
        );
        
        await interaction.channel.send({ embeds: [embed], components: [row] });
        return interaction.reply({ content: '✅ Đã cài đặt thành công role Pokemon và gửi bảng đăng ký!', ephemeral: true });
    }

    // --- QR ---
    if (commandName === 'qr') {
        if (interaction.user.id !== ADMIN_ID && (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))) return interaction.reply({ content: '❌ Lệnh này chỉ dành cho Admin!', ephemeral: true });
        const amount = interaction.options.getInteger('amount');
        const baseInfo = interaction.options.getString('content') || '';
        const safeBaseInfo = baseInfo.replace(/[^a-zA-Z0-9 ]/g, '');
        let addInfo = safeBaseInfo ? `${safeBaseInfo} ${qrOrderCount}` : `Thanh toan don ${qrOrderCount}`;
        qrOrderCount++;
        if (amount <= 0) return interaction.reply({ content: '❌ Số tiền phải lớn hơn 0.', ephemeral: true });
        const bankId = process.env.BANK_ID, accountNo = process.env.ACCOUNT_NO, accountName = process.env.ACCOUNT_NAME;
        if (!bankId || !accountNo || bankId === 'YOUR_BANK_ID_HERE') return interaction.reply({ content: '❌ Chưa cấu hình ngân hàng trong `.env`.', ephemeral: true });
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
        await interaction.reply({ content: '🎉 Đang tạo giveaway...', ephemeral: true });
        client.giveawaysManager.start(interaction.channel, {
            duration: ms(duration), winnerCount, prize,
            thumbnail: (process.env.GIVEAWAY_IMAGE_URL && process.env.GIVEAWAY_IMAGE_URL !== 'YOUR_IMAGE_LINK_HERE') ? process.env.GIVEAWAY_IMAGE_URL : null,
            hostedBy: interaction.user,
            messages: giveawayMessages()
        });
    }

    if (commandName === 'gend') {
        const messageId = interaction.options.getString('message_id');
        client.giveawaysManager.end(messageId)
            .then(() => interaction.reply({ content: '✅ Đã kết thúc!' }))
            .catch(() => interaction.reply({ content: '❌ Không tìm thấy.', ephemeral: true }));
    }

    if (commandName === 'greroll') {
        const messageId = interaction.options.getString('message_id');
        client.giveawaysManager.reroll(messageId)
            .then(() => interaction.reply({ content: '✅ Đã chọn lại người thắng!' }))
            .catch(() => interaction.reply({ content: '❌ Không tìm thấy.', ephemeral: true }));
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
                embeds: [new EmbedBuilder().setTitle('⏰ Chưa đến giờ nhận').setDescription(`Bạn cần chờ thêm **${h} giờ ${m} phút** nữa!`).setColor('#FFA500')], ephemeral: true
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
        const profileData = buildProfileEmbed(target);
        const options = { embeds: [profileData.embed] };
        if (profileData.attachment) options.files = [profileData.attachment];
        return interaction.reply(options);
    }

    // --- GIVE ---
    if (commandName === 'give') {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        if (target.id === interaction.user.id) return interaction.reply({ content: '❌ Không thể tặng coin cho chính mình!', ephemeral: true });
        if (target.bot) return interaction.reply({ content: '❌ Không thể tặng coin cho bot!', ephemeral: true });
        const senderCoins = getUserCoins(interaction.user.id);
        if (senderCoins < amount) return interaction.reply({ content: `❌ Bạn chỉ có **${senderCoins.toLocaleString()} 🪙**, không đủ!`, ephemeral: true });
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
            if (bet < 10) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`, ephemeral: true });
        } else if (isNaN(bet) || bet < 10) {
            return interaction.reply({ content: `❌ Cú pháp: số_coin (tối thiểu 10) hoặc "all"`, ephemeral: true });
        }
        
        if (blackjackGames.has(uid)) return interaction.reply({ content: '❌ Bạn đang có game Blackjack chưa xong! Hãy kết thúc trước.', ephemeral: true });
        if (bet > 500000) return interaction.reply({ content: '❌ Mức cược tối đa là **500,000 🪙**!', ephemeral: true });
        if (getUserCoins(uid) < bet) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`, ephemeral: true });
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

    // --- GUESS ---
    if (commandName === 'guess') {
        const uid = interaction.user.id;
        const betInput = interaction.options.getString('bet')?.toLowerCase();
        let bet = parseInt(betInput);
        if (betInput === 'all') {
            bet = Math.min(getUserCoins(uid), 500000);
            if (bet < 10) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`, ephemeral: true });
        } else if (isNaN(bet) || bet < 10) {
            return interaction.reply({ content: `❌ Cú pháp: số_coin (tối thiểu 10) hoặc "all"`, ephemeral: true });
        }
        
        if (guessGames.has(uid)) return interaction.reply({ content: '❌ Bạn đang có game đoán số chưa xong! Gõ một số để đoán.', ephemeral: true });
        if (bet > 500000) return interaction.reply({ content: '❌ Mức cược tối đa là **500,000 🪙**!', ephemeral: true });
        if (getUserCoins(uid) < bet) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`, ephemeral: true });
        addCoins(uid, -bet);
        const secret = Math.floor(Math.random() * 100) + 1;
        guessGames.set(uid, { secret, attempts: 0, maxAttempts: 7, bet, channelId: interaction.channelId });
        return interaction.reply({
            embeds: [new EmbedBuilder().setTitle('🎯 Đoán số bí mật!').setDescription(`Ta đang nghĩ một số từ **1 đến 100**.\nBạn có **7 lượt** để đoán!\n\n→ Hãy gõ một số vào chat!`).setColor('#9B59B6').addFields({ name: '💰 Cược', value: `${bet.toLocaleString()} 🪙`, inline: true }, { name: '✅ Thưởng nếu thắng', value: `${(bet * 3).toLocaleString()} 🪙`, inline: true })]
        });
    }

    if (commandName === 'setlodechannel') {
        const targetChannel = interaction.options.getChannel('channel');
        const config = loadConfig();
        config.lodeChannelId = targetChannel.id;
        saveConfig(config);
        return interaction.reply({ content: `✅ Đã thiết lập kênh xổ số lô đề 18h30 tại <#${targetChannel.id}>`, ephemeral: true });
    }

    // --- LÔ ĐỀ ---
    if (commandName === 'lode') {
        const uid = interaction.user.id;
        const soInput = interaction.options.getString('so');
        const betInput = interaction.options.getString('bet')?.toLowerCase();
        
        let so = parseInt(soInput);
        if (isNaN(so) || so < 0 || so > 99) return interaction.reply({ content: `❌ Bạn phải chọn một số từ **00** đến **99**!`, ephemeral: true });
        
        let bet = parseInt(betInput);
        if (betInput === 'all') {
            bet = Math.min(getUserCoins(uid), 500000);
            if (bet < 10) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`, ephemeral: true });
        } else if (isNaN(bet) || bet < 10) {
            return interaction.reply({ content: `❌ Cú pháp cược: số_coin (tối thiểu 10) hoặc "all"`, ephemeral: true });
        }
        
        if (bet > 500000) return interaction.reply({ content: '❌ Mức cược tối đa là **500,000 🪙**!', ephemeral: true });
        if (getUserCoins(uid) < bet) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`, ephemeral: true });
        
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
            if (bet < 10) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`, ephemeral: true });
        } else if (isNaN(bet) || bet < 10) {
            return interaction.reply({ content: `❌ Cú pháp: số_coin (tối thiểu 10) hoặc "all"`, ephemeral: true });
        }
        
        if (bet > 500000) return interaction.reply({ content: '❌ Mức cược tối đa là **500,000 🪙**!', ephemeral: true });
        if (getUserCoins(uid) < bet) return interaction.reply({ content: `❌ Không đủ coin! Bạn có **${getUserCoins(uid).toLocaleString()} 🪙**.`, ephemeral: true });
        
        if (txCooldowns.has(uid)) {
            const remaining = txCooldowns.get(uid) - Date.now();
            if (remaining > 0) return interaction.reply({ content: `⏳ Vui lòng đợi **${Math.ceil(remaining/1000)}s** nữa trước khi cược Tài Xỉu tiếp!`, ephemeral: true });
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
        if (targetUser.bot) return interaction.reply({ content: '❌ Không thể giao dịch với Bot!', ephemeral: true });
        return handlePetTrade(interaction.user.id, targetUser.id, interaction);
    }
    if (commandName === 'petbattle') {
        const targetUser = interaction.options.getUser('user');
        const bet = interaction.options.getInteger('bet');
        if (targetUser.bot) return interaction.reply({ content: '❌ Không thể solo với Bot!', ephemeral: true });
        return handlePetBattle(interaction.user.id, targetUser.id, bet, interaction);
    }

    // --- RPG COMMANDS ---


    if (commandName === 'hunt') {
        const uid = interaction.user.id;
        const p = getPlayer(uid);
        if (p.hp <= 0) return interaction.reply({ content: '❌ Bạn đã hết máu, hãy dùng `/heal` để hồi sinh lực!', ephemeral: true });
        const now = Date.now();
        if (now - p.lastHunt < 60000) return interaction.reply({ content: `⏳ Đang mệt, nghỉ ngơi **${Math.ceil((60000-(now-p.lastHunt))/1000)}s** nữa!`, ephemeral: true });
        
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
        addCoins(uid, m.coin);
        const nP = getPlayer(uid);
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`⚔️ Chiến thắng **${m.name}** ${m.emoji}`).setDescription(`Còn lại **❤️ ${pHp}/${p.maxHp} HP**.\nNhận: **+${m.exp} EXP** và **+${m.coin} 🪙**\nCấp độ: **Lv. ${nP.level}**`).setColor('#00FF00')] });
    }

    if (commandName === 'shop') {
        return handleShop(interaction.user.id, interaction);
    }

    if (commandName === 'inv') {
        const p = getPlayer(interaction.user.id);
        const pots = [];
        for (const [k, v] of Object.entries(p.inventory)) {
            if (v > 0) pots.push(`${RPG_ITEMS.potions[k].emoji} **${RPG_ITEMS.potions[k].name}**: ${v} bình`);
        }
        const embed = new EmbedBuilder().setTitle('🎒 Túi Đồ').setColor('#F1C40F')
            .setDescription(pots.length ? pots.join('\n') : 'Trống trơn.\nHãy mua bình máu ở `/shop` để hồi phục khi đi săn!');
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'heal') {
        const uid = interaction.user.id;
        const p = getPlayer(uid);
        if (p.hp >= p.maxHp) return interaction.reply({ content: '✅ Máu của bạn đã đầy!', ephemeral: true });
        
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
        if (getUserCoins(uid) < healCost) return interaction.reply({ content: `❌ Không đủ **${healCost} 🪙** để bơm máu!`, ephemeral: true });
        addCoins(uid, -healCost);
        updatePlayer(uid, dp => { dp.hp = dp.maxHp; });
        return interaction.reply(`🏥 Trả **${healCost} 🪙** bơm đầy máu! **❤️ ${p.maxHp}/${p.maxHp}**`);
    }

    // ========================
    // ADMIN SYSTEM HANDLERS
    // ========================
    if (commandName === 'addcoin') {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        return awaitConfirmation(interaction, interaction.user.id, `Bạn muốn **CỘNG** ${amount.toLocaleString()} 🪙 cho <@${target.id}>?`, async () => {
            addCoins(target.id, amount);
            return `✅ Đã thêm **${amount.toLocaleString()} 🪙** cho <@${target.id}>.`;
        });
    }
    if (commandName === 'removecoin') {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        return awaitConfirmation(interaction, interaction.user.id, `Bạn muốn **TRỪ** ${amount.toLocaleString()} 🪙 của <@${target.id}>?`, async () => {
            addCoins(target.id, -amount);
            return `✅ Đã trừ **${amount.toLocaleString()} 🪙** của <@${target.id}>.`;
        });
    }
    if (commandName === 'setcoin') {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        return awaitConfirmation(interaction, interaction.user.id, `Bạn muốn **ĐẶT** số coin của <@${target.id}> thành ${amount.toLocaleString()} 🪙?`, async () => {
            setCoins(target.id, amount);
            return `✅ Đã đặt số coin của <@${target.id}> thành **${amount.toLocaleString()} 🪙**.`;
        });
    }
    if (commandName === 'resetcoin') {
        const target = interaction.options.getUser('user');
        return awaitConfirmation(interaction, interaction.user.id, `Bạn CHẮC CHẮN muốn **RESET** tài khoản của <@${target.id}> về 500,000 🪙?`, async () => {
            const data = loadCoins();
            data[target.id] = { coins: 500000, bank: 0, lastDaily: 0 };
            saveCoins(data);
            return `✅ Đã reset tài khoản của <@${target.id}> về mặc định (500,000 🪙 tiền mặt, 0 ngân hàng).`;
        });
    }
    if (commandName === 'resetallcoin') {
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
        return interaction.reply({ content: `✅ Đã reset thời gian làm việc cho <@${target.id}>!`, ephemeral: true });
    }
    if (commandName === 'togglevoice') {
        const config = loadConfig();
        const currentState = config.voiceNotifyEnabled !== false;
        config.voiceNotifyEnabled = !currentState;
        saveConfig(config);
        return interaction.reply({ content: `✅ Đã **${config.voiceNotifyEnabled ? 'BẬT' : 'TẮT'}** thông báo người ra vào kênh thoại.`, ephemeral: true });
    }
    if (commandName === 'clear') {
        const amount = interaction.options.getInteger('amount');
        try {
            await interaction.channel.bulkDelete(amount, true);
            return interaction.reply({ content: `✅ Đã xóa **${amount}** tin nhắn.`, ephemeral: true });
        } catch (err) {
            return interaction.reply({ content: '❌ Không thể xóa tin nhắn (tin nhắn quá 14 ngày).', ephemeral: true });
        }
    }
    if (commandName === 'say') {
        const channel = interaction.options.getChannel('channel');
        const messageText = interaction.options.getString('message');
        if (!channel.isTextBased()) return interaction.reply({ content: '❌ Hãy chọn một kênh văn bản hợp lệ!', ephemeral: true });
        await channel.send(messageText);
        return interaction.reply({ content: `✅ Đã gửi thông báo vào <#${channel.id}>.`, ephemeral: true });
    }

    // --- MA SÓI SLASH ---
    if (commandName === 'masoi') {
        await interaction.deferReply({ ephemeral: false });
        const result = await WW.openLobby(interaction.guildId, interaction.channel, interaction.user.id, client);
        if (result?.game) result.game._addCoins = addCoins;
        return interaction.deleteReply().catch(() => {});
    }
    if (commandName === 'wwstop') {
        const game = WW.WW_GAMES.get(interaction.guildId);
        if (!game) return interaction.reply({ content: '❌ Không có game Ma Sói nào đang chạy!', ephemeral: true });
        const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        if (!isAdmin && interaction.user.id !== game.hostId) return interaction.reply({ content: '❌ Chỉ host hoặc Admin mới có thể hủy!', ephemeral: true });
        WW.WW_GAMES.delete(interaction.guildId);
        if (game.nightTimeout) clearTimeout(game.nightTimeout);
        if (game.dayTimeout) clearTimeout(game.dayTimeout);
        if (game.lobbyTimeout) clearTimeout(game.lobbyTimeout);
        if (game.voteMsg) await game.voteMsg.edit({ components: [] }).catch(() => {});
        if (game.lobbyMsg) await game.lobbyMsg.edit({ components: [] }).catch(() => {});
        return interaction.reply({ content: '🛑 Game Ma Sói đã bị hủy!', ephemeral: false });
    }

    // --- NOITU SLASH ---
    if (commandName === 'noitu') {
        if (noituGames.has(interaction.channelId)) return interaction.reply({ content: '❌ Trò chơi Nối Từ đang diễn ra ở kênh này rồi!', ephemeral: true });
        if (vnDictionary.size === 0) return interaction.reply({ content: '❌ Từ điển chưa tải xong, vui lòng chờ giây lát...', ephemeral: true });
        
        const easyStartingWords = ["nhà", "học", "bạn", "làm", "người", "xe", "hoa", "cây", "nước", "mưa", "nắng", "gió", "trời", "đất", "biển", "sông", "núi", "đường", "áo", "quần", "máy", "điện", "bàn", "ghế", "sách", "vở", "bút", "chữ", "toán", "nhạc", "hát", "tình", "yêu", "đời", "trăng", "sao", "chim", "cá", "chuột", "mèo", "chó", "heo", "bò", "gà", "vịt", "thuyền", "cầu", "sân"];
        const randomWord = easyStartingWords[Math.floor(Math.random() * easyStartingWords.length)];
        
        const game = {
            lastWord: randomWord,
            usedWords: new Set([randomWord]),
            lastUser: null,
            timeout: setTimeout(() => {
                noituGames.delete(interaction.channelId);
                interaction.channel.send(`⏰ Hết 60 giây không ai nối được chữ **${randomWord}**. Trò chơi Nối Từ kết thúc!`).catch(() => {});
            }, 60000)
        };
        noituGames.set(interaction.channelId, game);
        
        return interaction.reply(`🎮 **TRÒ CHƠI NỐI TỪ BẮT ĐẦU!**\nTừ đầu tiên để nối là: **${randomWord.toUpperCase()}**\n\nHãy nối tiếp bằng một từ ghép có chữ đầu là **${randomWord.toUpperCase()}** nhé!\n_Thưởng 50,000 🪙 mỗi từ đúng. Mọi người chỉ cần gõ 2 chữ tự do vào chat!_`);
    }

    if (commandName === 'stopnoitu') {
        if (!noituGames.has(interaction.channelId)) return interaction.reply({ content: '❌ Không có trò chơi Nối Từ nào đang diễn ra.', ephemeral: true });
        const game = noituGames.get(interaction.channelId);
        clearTimeout(game.timeout);
        noituGames.delete(interaction.channelId);
        return interaction.reply('🛑 Trò chơi Nối Từ đã kết thúc.');
    }

    if (commandName === '1an') {
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ Bạn phải ở trong một kênh thoại để dùng lệnh này!', ephemeral: true });
        }

        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            const ownerId = j2cChannels.get(voiceChannel.id);
            if (!ownerId || ownerId !== interaction.user.id) {
                return interaction.reply({ content: '❌ Bạn không phải là chủ phòng này hoặc không có quyền Quản lý kênh!', ephemeral: true });
            }
        }

        const targetUser = interaction.options.getUser('user');

        try {
            await voiceChannel.permissionOverwrites.edit(targetUser.id, {
                ViewChannel: false,
                Connect: false
            });
            return interaction.reply({ content: `✅ Đã ẩn kênh thoại **${voiceChannel.name}** đối với **${targetUser.username}**!`, ephemeral: true });
        } catch (error) {
            console.error('Lỗi khi ẩn phòng:', error);
            return interaction.reply({ content: '❌ Có lỗi xảy ra. Hãy đảm bảo bot có quyền **Manage Channels**.', ephemeral: true });
        }
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


