const fs = require('fs');
let code = fs.readFileSync('d:/Bot moi/index.js', 'utf8');

const targetSetup = "    if (commandName === 'setupadvlogs') {\n        if (!interaction.member || !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) \n            return interaction.reply({ content: '❌ Bạn không có quyền!', flags: MessageFlags.Ephemeral });\n        \n        await interaction.reply({ content: '⏳ Đang khởi tạo hệ thống Log Nâng Cao (5 kênh Gọn Gàng)... Vui lòng đợi!', flags: MessageFlags.Ephemeral });\n        try {\n            const guild = interaction.guild;";

const newSetup = `    if (commandName === 'setupadvlogs') {
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
            }`;

if (code.includes("await interaction.reply({ content: '⏳ Đang khởi tạo hệ thống Log Nâng Cao (5 kênh Gọn Gàng)... Vui lòng đợi!', flags: MessageFlags.Ephemeral });")) {
    code = code.replace(targetSetup, newSetup);
    console.log('Replaced setupadvlogs to include cleanup logic.');
    fs.writeFileSync('d:/Bot moi/index.js', code, 'utf8');
} else {
    console.log('Target setupadvlogs not found.');
}
