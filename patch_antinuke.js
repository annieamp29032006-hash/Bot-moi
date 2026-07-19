const fs = require('fs');

let code = fs.readFileSync('d:\\Bot moi\\index.js', 'utf8');

const targetCheckAntiNuke = `async function checkAntiNuke(guild, actionType) {
    const config = getGuildConfig(guild.id);
    if (config.antiNukeEnabled === false) return;
    
    await new Promise(r => setTimeout(r, 2000));
    
    let auditType;
    if (actionType === 'CHANNEL_DELETE') auditType = AuditLogEvent.ChannelDelete;
    else if (actionType === 'ROLE_DELETE') auditType = AuditLogEvent.RoleDelete;
    else if (actionType === 'MEMBER_BAN') auditType = AuditLogEvent.MemberBanAdd;
    else if (actionType === 'MEMBER_KICK') auditType = AuditLogEvent.MemberKick;
    else return;

    try {
        const auditLogs = await guild.fetchAuditLogs({ type: auditType, limit: 1 });
        const log = auditLogs.entries.first();
        if (!log) return;
        
        if (Date.now() - log.createdTimestamp > 10000) return;
        
        const executor = log.executor;
        if (!executor || executor.bot) return;
        
        if (!nukeTracker.has(guild.id)) nukeTracker.set(guild.id, new Map());
        const guildTracker = nukeTracker.get(guild.id);
        
        if (!guildTracker.has(executor.id)) guildTracker.set(executor.id, []);
        const userActions = guildTracker.get(executor.id);
        
        userActions.push(Date.now());
        const recentActions = userActions.filter(t => Date.now() - t < 10000);
        guildTracker.set(executor.id, recentActions);
        
        if (recentActions.length >= 3) {
            try {
                const member = await guild.members.fetch(executor.id);
                if (member) {
                    await member.roles.set([]); 
                    const owner = await guild.fetchOwner();
                    if (owner) {
                        await owner.send(\`🚨 **CẢNH BÁO ANTI-NUKE** 🚨\\nPhát hiện Quản trị viên <@\${executor.id}> (\${executor.tag}) có hành vi phá hoại (xoá kênh/role/ban 3 lần trong 10s).\\nBot đã tự động tước toàn bộ Role của người này để bảo vệ server!\`);
                    }
                }
            } catch (err) {
                console.error('Lỗi khi tước role kẻ nuke:', err);
            }
            guildTracker.delete(executor.id);
        }
    } catch (err) {}
}`;

const replaceCheckAntiNuke = `async function checkAntiNuke(guild, actionType) {
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
        
        if (!nukeTracker.has(guild.id)) nukeTracker.set(guild.id, new Map());
        const guildTracker = nukeTracker.get(guild.id);
        
        if (!guildTracker.has(executor.id)) guildTracker.set(executor.id, []);
        const userActions = guildTracker.get(executor.id);
        
        userActions.push(Date.now());
        const recentActions = userActions.filter(t => Date.now() - t < 10000);
        guildTracker.set(executor.id, recentActions);
        
        if (recentActions.length >= 3) {
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
                        await owner.send(\`🚨 **CẢNH BÁO ANTI-NUKE MỨC ĐỘ CAO** 🚨\\n⚠️ Phát hiện Quản trị viên <@\${executor.id}> (\${executor.tag}) có hành vi phá hoại nguy hiểm (tạo/xoá kênh/role/ban 3 lần trong 10s).\\n🛡️ Bot đã tự động **\${pType}** người này để bảo vệ an toàn cho Server!\`);
                    }
                }
            } catch (err) {
                console.error('Lỗi khi xử phạt kẻ nuke:', err);
            }
            guildTracker.delete(executor.id);
        }
    } catch (err) {}
}`;


// Replace the checkAntiNuke function
if (code.includes(targetCheckAntiNuke)) {
    code = code.replace(targetCheckAntiNuke, replaceCheckAntiNuke);
    console.log('Successfully replaced checkAntiNuke.');
} else {
    console.log('Failed to find checkAntiNuke.');
}

// Add event listeners for CREATE events
const targetEventListeners = `client.on('channelDelete', channel => {
    if (channel.guild) checkAntiNuke(channel.guild, 'CHANNEL_DELETE');
});
client.on('roleDelete', role => {
    if (role.guild) checkAntiNuke(role.guild, 'ROLE_DELETE');
});`;

const replaceEventListeners = `client.on('channelDelete', channel => {
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
});`;

if (code.includes(targetEventListeners)) {
    code = code.replace(targetEventListeners, replaceEventListeners);
    console.log('Successfully added new event listeners.');
} else {
    console.log('Failed to find targetEventListeners.');
}

fs.writeFileSync('d:\\Bot moi\\index.js', code, 'utf8');
