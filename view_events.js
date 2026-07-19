const fs = require('fs');
const code = fs.readFileSync('d:/Bot moi/index.js', 'utf8');

const events = ['channelCreate', 'guildMemberAdd', 'messageDelete', 'messageUpdate', 'roleCreate'];
events.forEach(ev => {
    const idx = code.indexOf(`client.on('${ev}'`);
    if (idx !== -1) {
        console.log(`\n--- ${ev} ---`);
        console.log(code.substring(idx, idx + 400));
    }
});
