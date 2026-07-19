const fs = require('fs');
let code = fs.readFileSync('d:/Bot moi/index.js', 'utf8');

const oldLogic = `    if (content.startsWith(\`\${prefix}setupadvlogs\`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Bạn không có quyền!');
        const msg = await message.reply('⏳ Đang khởi tạo hệ thống Log Nâng Cao (12 kênh)... Vui lòng đợi!');
        try {
            const guild = message.guild;
            const category = await guild.channels.create({
                name: 'SERVER LOGS',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: guild.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });
            const logChannels = ['member-log', 'message-log', 'voice-log', 'channel-log', 'role-log', 'emoji-log', 'server-log', 'mod-log', 'ticket-log', 'command-log', 'bot-log', 'error-log'];
            const logConfig = {};
            for (const name of logChannels) {
                const ch = await guild.channels.create({
                    name: name,
                    type: ChannelType.GuildText,
                    parent: category.id
                });
                logConfig[name] = ch.id;
            }
            updateGuildConfig(guild.id, 'advLogs', logConfig);
            return msg.edit(\`✅ Đã tạo thành công danh mục **SERVER LOGS** và 12 kênh log!\`);
        } catch (error) {
            console.error(error);
            return msg.edit('❌ Có lỗi xảy ra khi tạo kênh. Vui lòng kiểm tra quyền của Bot!');
        }
    }`;

const newLogic = `    if (content.startsWith(\`\${prefix}setupadvlogs\`)) {
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
            return msg.edit(\`✅ Đã đại tu thành công danh mục **SERVER LOGS** với 5 kênh chuẩn xác và hiện đại!\`);
        } catch (error) {
            console.error(error);
            return msg.edit('❌ Có lỗi xảy ra khi tạo kênh. Vui lòng kiểm tra quyền của Bot!');
        }
    }`;

if (code.includes(oldLogic)) {
    code = code.replace(oldLogic, newLogic);
    fs.writeFileSync('d:/Bot moi/index.js', code);
    console.log('PATCH SUCCESS');
} else {
    console.log('OLD LOGIC NOT FOUND. Trying fallback...');
    // Fallback: replace using regex if whitespace differs
    const fallbackRegex = /if \(content\.startsWith\(`\${prefix}setupadvlogs`\)\) \{[\s\S]*?return msg\.edit\('❌ Có lỗi xảy ra khi tạo kênh\. Vui lòng kiểm tra quyền của Bot!'\);\s*\}\s*\}/;
    if (fallbackRegex.test(code)) {
        code = code.replace(fallbackRegex, newLogic);
        fs.writeFileSync('d:/Bot moi/index.js', code);
        console.log('PATCH SUCCESS (FALLBACK)');
    } else {
        console.log('FALLBACK FAILED');
    }
}
