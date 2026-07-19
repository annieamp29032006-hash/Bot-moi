const fs = require('fs');
const code = fs.readFileSync('d:/Bot moi/index.js', 'utf8');

const idx = code.indexOf("client.on('messageDelete',");
if (idx !== -1) {
    console.log(code.substring(idx, idx + 1000));
}
