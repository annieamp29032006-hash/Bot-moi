const fs = require('fs');
let code = fs.readFileSync('d:/Bot moi/index.js', 'utf8');

// 1. Replace setupadvlogs
const oldSetupAdvLogs = "    if (commandName === 'setupadvlogs') {\n        if (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) \n            return interaction.reply({ content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });\n        \n        await interaction.reply({ content: '⏳ Đang khởi tạo hệ thống Log Nâng Cao (12 kênh)... Vui lòng đợi!', flags: MessageFlags.Ephemeral });\n        try {\n            const guild = interaction.guild;\n            const category = await guild.channels.create({\n                name: 'SERVER LOGS',\n                type: ChannelType.GuildCategory,\n                permissionOverwrites: [\n                    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },\n                    { id: guild.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel] }\n                ]\n            });\n            const logChannels = ['member-log', 'message-log', 'voice-log', 'channel-log', 'role-log', 'emoji-log', 'server-log', 'mod-log', 'ticket-log', 'command-log', 'bot-log', 'error-log'];\n            const logConfig = {};\n            for (const name of logChannels) {\n                const ch = await guild.channels.create({\n                    name: name,\n                    type: ChannelType.GuildText,\n                    parent: category.id\n                });\n                logConfig[name] = ch.id;\n            }\n            updateGuildConfig(guild.id, 'advLogs', logConfig);\n            return interaction.editReply({ content: `✅ Đã tạo thành công danh mục **SERVER LOGS** và 12 kênh log!` });\n        } catch (error) {\n            console.error(error);\n            return interaction.editReply({ content: '❌ Có lỗi xảy ra khi tạo kênh. Vui lòng kiểm tra quyền của Bot!' });\n        }\n    }";

const newSetupAdvLogs = "    if (commandName === 'setupadvlogs') {\n        if (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) \n            return interaction.reply({ content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });\n        \n        await interaction.reply({ content: '⏳ Đang khởi tạo hệ thống Log Nâng Cao (5 kênh Gọn Gàng)... Vui lòng đợi!', flags: MessageFlags.Ephemeral });\n        try {\n            const guild = interaction.guild;\n            const category = await guild.channels.create({\n                name: '📂 SERVER LOGS',\n                type: ChannelType.GuildCategory,\n                permissionOverwrites: [\n                    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },\n                    { id: guild.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel] }\n                ]\n            });\n            const logChannels = [\n                { name: '📩・message-log', key: 'message-log' },\n                { name: '👥・member-log', key: 'member-log' },\n                { name: '🛡️・mod-log', key: 'mod-log' },\n                { name: '⚙️・server-log', key: 'server-log' },\n                { name: '🤖・bot-log', key: 'bot-log' }\n            ];\n            const logConfig = {};\n            for (const channelData of logChannels) {\n                const ch = await guild.channels.create({\n                    name: channelData.name,\n                    type: ChannelType.GuildText,\n                    parent: category.id\n                });\n                logConfig[channelData.key] = ch.id;\n            }\n            updateGuildConfig(guild.id, 'advLogs', logConfig);\n            return interaction.editReply({ content: `✅ Đã đại tu thành công danh mục **SERVER LOGS** với 5 kênh chuẩn xác và hiện đại!` });\n        } catch (error) {\n            console.error(error);\n            return interaction.editReply({ content: '❌ Có lỗi xảy ra khi tạo kênh. Vui lòng kiểm tra quyền của Bot!' });\n        }\n    }";

if (code.includes("const logChannels = ['member-log', 'message-log'")) {
    code = code.replace(oldSetupAdvLogs, newSetupAdvLogs);
    console.log("Replaced setupadvlogs command.");
}

// 2. Replace sendAdvLog function
const oldSendAdvLogRegex = /function sendAdvLog\(guild, type, embed\) \{[\s\S]*?catch \(error\) \{[\s\S]*?console\.error.*?[\s\S]*?\}[\s\S]*?\}/;

const newSendAdvLog = "async function sendAdvLog(guild, type, embed) {\n    if (!guild) return;\n    const config = getGuildConfig(guild.id);\n    if (!config.advLogs) return;\n\n    // Advanced category mapping for cleaner logs\n    const categoryMap = {\n        'message': 'message-log',\n        'voice': 'member-log',\n        'member': 'member-log',\n        'channel': 'server-log',\n        'role': 'server-log',\n        'server': 'server-log',\n        'emoji': 'server-log',\n        'mod': 'mod-log',\n        'ticket': 'server-log',\n        'command': 'bot-log',\n        'bot': 'bot-log',\n        'error': 'bot-log'\n    };\n\n    const targetChannelKey = categoryMap[type] || (type + '-log');\n    \n    // Fallback to legacy channel names if they haven't re-run setupadvlogs\n    let channelId = config.advLogs[targetChannelKey] || config.advLogs[type + '-log'];\n    if (!channelId) return;\n\n    const channel = guild.channels.cache.get(channelId);\n    if (channel) {\n        try {\n            const enhancedEmbed = EmbedBuilder.from(embed);\n            \n            // Overhaul Aesthetics\n            enhancedEmbed.setFooter({ \n                text: `Nexora Advanced Logs • ${type.toUpperCase()}`, \n                iconURL: guild.iconURL() \n            });\n            if (!enhancedEmbed.data.timestamp) enhancedEmbed.setTimestamp();\n            \n            // Send the beautiful embed\n            await channel.send({ embeds: [enhancedEmbed] });\n        } catch (error) {\n            console.error(`Error sending adv log ${type}:`, error);\n        }\n    }\n}";

code = code.replace(oldSendAdvLogRegex, newSendAdvLog);
if (code.includes('async function sendAdvLog')) {
    console.log("Replaced sendAdvLog function.");
} else {
    console.log("Failed to replace sendAdvLog function using regex.");
    const startIdx = code.indexOf('function sendAdvLog');
    if (startIdx !== -1) {
        let endIdx = code.indexOf('function updateGuildConfig', startIdx);
        let block = code.substring(startIdx, endIdx);
        code = code.replace(block, newSendAdvLog + '\\n\\n');
        console.log("Replaced sendAdvLog function using substring fallback.");
    }
}

// 3. Update messageDelete aesthetics
const targetMessageDelete = "const logEmbed = new EmbedBuilder()\n        .setTitle('🗑️ TIN NHẮN BỊ XÓA')\n        .setDescription(`Tin nhắn của **${message.author.tag}** (<@${message.author.id}>) bị xóa ở kênh <#${message.channel.id}>:\\n\\n${message.content || '[Không có nội dung chữ]'}`)\n        .setColor('#E74C3C')\n        .setTimestamp();";

const replaceMessageDelete = "const logEmbed = new EmbedBuilder()\n        .setTitle('🗑️ TIN NHẮN BỊ XÓA')\n        .setDescription(`**Tác giả:** ${message.author.tag} (<@${message.author.id}>)\\n**Kênh:** <#${message.channel.id}>\\n\\n**Nội dung:**\\n\\`\\`\\`\\n${message.content || '[Không có nội dung hoặc chứa Media]'}\\n\\`\\`\\``)\n        .setThumbnail(message.author.displayAvatarURL())\n        .setColor('#FF4757')\n        .setTimestamp();";

if (code.includes("setTitle('🗑️ TIN NHẮN BỊ XÓA')")) {
    code = code.replace(targetMessageDelete, replaceMessageDelete);
    console.log("Upgraded messageDelete aesthetics.");
}

fs.writeFileSync('d:/Bot moi/index.js', code, 'utf8');
console.log('Patch complete.');
