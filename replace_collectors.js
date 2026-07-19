const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const target1 = `        collector.on('collect', async i => {
            const page = parseInt(i.values[0]);
            if (page === 13) {
                if (i.user.id !== ADMIN_ID) {
                    return i.reply({ content: '🔒 **Danh mục này chỉ dành riêng cho Chủ Bot!**', flags: MessageFlags.Ephemeral });
                }
                await i.update({ embeds: [pages[page]], components: [row] });
                return;
            }`;

const target2 = `        collector.on('collect', async i => {
            const page = parseInt(i.values[0]);
            if (page === 13) {
                await i.update({ embeds: [pages[page]], components: [row] });
                return;
            }`;

code = code.split(target1).join(target2);
fs.writeFileSync('index.js', code);
console.log('Done!');
