const fs = require('fs');

let content = fs.readFileSync('index.js', 'utf8');

// Normalize line endings
content = content.replace(/\r\n/g, '\n');

// 1. Fix ReferenceError session in buildProfileEmbed
const target1 = `    const msgCount = pData.messageCount || 0;
    let vTime = pData.voiceTime || 0;
    
    if (session) {
        const joinTime = typeof session === 'number' ? session : session.time;`;

const replace1 = `    const msgCount = pData.messageCount || 0;
    let vTime = pData.voiceTime || 0;
    
    const session = typeof voiceJoinTimes !== 'undefined' ? voiceJoinTimes.get(uid) : null;
    if (session) {
        const joinTime = typeof session === 'number' ? session : session.time;`;

if (content.includes(target1)) {
    content = content.replace(target1, replace1);
    console.log('Patch 1 successful');
} else {
    console.log('Patch 1 failed to match target');
}

// 2. Add Auto Reply
const target2 = `    if (message.author.bot) return;
    if (BANNED_USERS.includes(message.author.id)) return;
    
    // --- IMAGE RESTRICTION LOGIC ---
    if (imageChannelConfig[message.channelId]) {`;

const replace2 = `    if (message.author.bot) return;
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
            \`Chào sếp <@\${message.author.id}> nha! 👋\`,
            'Hello! Chúc một ngày tốt lành! ✨',
            'Hi, có cần bot giúp gì không?',
            'Chào người đẹp! 😎'
        ];
        message.reply(helloReplies[Math.floor(Math.random() * helloReplies.length)]).catch(() => {});
    } else if (lowerContent.includes('yêu bot') || lowerContent.includes('thích bot')) {
        message.reply('Hihi, bot cũng yêu sếp lắm! 💖').catch(() => {});
    }

    // --- IMAGE RESTRICTION LOGIC ---
    if (imageChannelConfig[message.channelId]) {`;

if (content.includes(target2)) {
    content = content.replace(target2, replace2);
    console.log('Patch 2 successful');
} else {
    console.log('Patch 2 failed to match target');
}

// 3. Add !pr and !profile commands
const target3 = `    // !profile
    

    // !hunt`;

const replace3 = `    // !profile
    if (content.startsWith(\`\${prefix}profile\`) || content.startsWith(\`\${prefix}pr\`)) {
        const target = message.mentions.users.first() || message.author;
        const profileData = buildProfileEmbed(target);
        const options = { embeds: [profileData.embed] };
        if (profileData.attachment) options.files = [profileData.attachment];
        return message.reply(options).catch(() => {});
    }

    // !hunt`;

if (content.includes(target3)) {
    content = content.replace(target3, replace3);
    console.log('Patch 3 successful');
} else {
    console.log('Patch 3 failed to match target');
}

fs.writeFileSync('index.js', content, 'utf8');
console.log('Successfully patched index.js!');
