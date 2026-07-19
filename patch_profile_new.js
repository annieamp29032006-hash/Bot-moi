const fs = require('fs');

let content = fs.readFileSync('index.js', 'utf8');

// Normalize line endings
content = content.replace(/\r\n/g, '\n');

// 1. Change buildProfileEmbed to async and modify embed
const target1_start = `function buildProfileEmbed(user) {`;
const target1_end = `    return { embed, attachment };\n}`;

const startIndex = content.indexOf(target1_start);
const endIndex = content.indexOf(target1_end, startIndex) + target1_end.length;

if (startIndex !== -1 && endIndex > startIndex) {
    const originalFunc = content.substring(startIndex, endIndex);
    const newFunc = `async function buildProfileEmbed(user) {
    const uid = user.id;
    const pData = getPlayer(uid);
    
    let marryText = 'Đang độc thân 💔';
    let partnerAvatar = null;
    if (pData.partner) {
        marryText = \`Đã kết hôn với <@\${pData.partner}> 💍\`;
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
        bdayText = \`**\${pData.birthday}**\`;
        const today = new Date();
        const d = today.getDate().toString().padStart(2, '0');
        const m = (today.getMonth() + 1).toString().padStart(2, '0');
        if (\`\${d}/\${m}\` === pData.birthday) {
            isBirthday = true;
            try {
                const { AttachmentBuilder } = require('discord.js');
                attachment = new AttachmentBuilder('./birthday.png', { name: 'birthday.png' });
            } catch (e) {}
        }
    }

    const embed = new EmbedBuilder()
        .setTitle(isBirthday ? \`🎉 CHÚC MỪNG SINH NHẬT \${user.username.toUpperCase()} 🎉\` : \`👤 Hồ Sơ: \${user.username}\`)
        .setColor(isBirthday ? '#FF69B4' : '#9B59B6')
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 512 }))
        .addFields(
            { name: '🎤 Thời gian Voice', value: \`**\${formatVoiceTime(vTime)}\**\`, inline: true },
            { name: '🎂 Ngày sinh nhật', value: bdayText, inline: true },
            { name: '📅 Ngày tạo tài khoản', value: \`<t:\${Math.floor(user.createdTimestamp / 1000)}:D>\`, inline: true },
            { name: '💍 Hôn nhân', value: marryText, inline: false }
        )
        .setTimestamp();
        
    if (partnerAvatar) {
        embed.setImage(partnerAvatar);
    } else if (isBirthday && attachment) {
        embed.setImage('attachment://birthday.png');
    }

    return { embed, attachment };
}`;
    content = content.replace(originalFunc, newFunc);
    console.log('Patch 1 (buildProfileEmbed) successful');
} else {
    console.log('Patch 1 (buildProfileEmbed) failed');
}


// 2. Change prefix command to use await
const target2 = `    // !profile
    if (content.startsWith(\`\${prefix}profile\`) || content.startsWith(\`\${prefix}pr\`)) {
        const target = message.mentions.users.first() || message.author;
        const profileData = buildProfileEmbed(target);`;
const replace2 = `    // !profile
    if (content.startsWith(\`\${prefix}profile\`) || content.startsWith(\`\${prefix}pr\`)) {
        const target = message.mentions.users.first() || message.author;
        const profileData = await buildProfileEmbed(target);`;
if (content.includes(target2)) {
    content = content.replace(target2, replace2);
    console.log('Patch 2 (!profile) successful');
} else {
    console.log('Patch 2 (!profile) failed');
}

// 3. Change slash command to use await
const target3 = `    if (commandName === 'profile') {
        const target = interaction.options.getUser('user') || interaction.user;
        const profileData = buildProfileEmbed(target);`;
const replace3 = `    if (commandName === 'profile') {
        const target = interaction.options.getUser('user') || interaction.user;
        const profileData = await buildProfileEmbed(target);`;
if (content.includes(target3)) {
    content = content.replace(target3, replace3);
    console.log('Patch 3 (/profile) successful');
} else {
    console.log('Patch 3 (/profile) failed');
}

fs.writeFileSync('index.js', content, 'utf8');
console.log('Successfully patched index.js!');
