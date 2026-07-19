const fs = require('fs');
let code = fs.readFileSync('d:/Bot moi/index.js', 'utf8');

// 1. Patch checkAntiNuke to support multiple whitelist roles
const targetCheckAntiNuke = `        if (executor.id === guild.ownerId) return; // Miễn trừ chủ Server (Whitelist)`;
const replaceCheckAntiNuke = `        if (executor.id === guild.ownerId) return; // Miễn trừ chủ Server (Whitelist)
        if (config.antiNukeWhitelistRoles && config.antiNukeWhitelistRoles.length > 0) {
            try {
                const member = await guild.members.fetch(executor.id);
                if (member && member.roles.cache.some(r => config.antiNukeWhitelistRoles.includes(r.id))) {
                    return; // Miễn trừ cho các role được whitelist
                }
            } catch (err) {}
        }`;

if (code.includes(targetCheckAntiNuke) && !code.includes('config.antiNukeWhitelistRoles')) {
    code = code.replace(targetCheckAntiNuke, replaceCheckAntiNuke);
    console.log('Successfully updated checkAntiNuke with whitelist roles.');
} else {
    console.log('Could not find checkAntiNuke target or already patched.');
}

// 2. Add !treo, !untreo, !antirole commands in messageCreate
const targetCommands = `    // !setimagechannel <restricted> <allowed>
    const imgPrefix = getPrefix(message.guildId);
    if (message.content.startsWith(\`\${imgPrefix}setimagechannel\`)) {`;

const replaceCommands = `    const imgPrefix = getPrefix(message.guildId);

    // !treo <channel_id>
    if (message.content.startsWith(\`\${imgPrefix}treo\`)) {
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
            return message.reply(\`✅ Đã treo bot 24/24 tại kênh <#\${channel.id}>!\`);
        } catch (e) {
            console.error(e);
            return message.reply('❌ Lỗi khi tham gia kênh Voice!');
        }
    }
    
    // !untreo
    if (message.content.startsWith(\`\${imgPrefix}untreo\`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Bạn cần quyền Administrator!');
        updateGuildConfig(message.guild.id, 'treoChannel', null);
        const { getVoiceConnection } = require('@discordjs/voice');
        const connection = getVoiceConnection(message.guild.id);
        if (connection) connection.destroy();
        return message.reply(\`✅ Đã hủy treo bot!\`);
    }

    // !antirole <@role1> <@role2> ...
    if (message.content.startsWith(\`\${imgPrefix}antirole\`)) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Bạn cần quyền Administrator!');
        const roles = message.mentions.roles.map(r => r.id);
        if (roles.length === 0) {
            return message.reply(\`❌ Cú pháp: \\\`\${imgPrefix}antirole <@role1> <@role2> ...\\\`\`);
        }
        updateGuildConfig(message.guild.id, 'antiNukeWhitelistRoles', roles);
        return message.reply(\`✅ Đã thêm \${roles.length} role vào danh sách Whitelist của Anti-Nuke/Anti-Raid! Những role này sẽ không bị bot trừng phạt.\`);
    }

    // !setimagechannel <restricted> <allowed>
    if (message.content.startsWith(\`\${imgPrefix}setimagechannel\`)) {`;

if (code.includes(targetCommands) && !code.includes('!treo <channel_id>')) {
    code = code.replace(targetCommands, replaceCommands);
    console.log('Successfully added !treo and !antirole commands.');
} else {
    console.log('Could not find commands target or already patched.');
}

// 3. Add auto-reconnect for treo channel in voiceStateUpdate
const targetVoiceState = `client.on('voiceStateUpdate', async (oldState, newState) => {`;
const replaceVoiceState = `client.on('voiceStateUpdate', async (oldState, newState) => {
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
    }`;

if (code.includes(targetVoiceState) && !code.includes('Tự động treo lại nếu bot bị ngắt kết nối')) {
    code = code.replace(targetVoiceState, replaceVoiceState);
    console.log('Successfully added voice state auto-reconnect.');
} else {
    console.log('Could not find voiceStateUpdate target or already patched.');
}

fs.writeFileSync('d:/Bot moi/index.js', code, 'utf8');
console.log('Done.');
