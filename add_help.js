const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

// The field we want to match:
// { name: '🎲 Cờ Bạc & Trò Chơi', value: `\`\`\`\n${prefix}tx    - Tài xỉu\n${prefix}bc    - Bầu cua\n${prefix}bj    - Blackjack\n${prefix}lode  - Lô đề\n${prefix}hack  - Hack tiền người khác\n\`\`\``, inline: false },
const fieldString = "{ name: '🎲 Cờ Bạc & Trò Chơi', value: `\\`\\`\\`\\n${prefix}tx    - Tài xỉu\\n${prefix}bc    - Bầu cua\\n${prefix}bj    - Blackjack\\n${prefix}lode  - Lô đề\\n${prefix}hack  - Hack tiền người khác\\n\\`\\`\\``, inline: false },";

const addString = `\n                { name: '🐾 Pokemon & Cửa Hàng', value: \`> \\\`/shop\\\` - Mua sắm (Pokeball, Hạt giống...)\\n> \\\`\${prefix}cp\\\` (Bắt) | \\\`\${prefix}pets\\\` (Xem túi) | \\\`\${prefix}pb\\\` (Đấu)\\n> \\\`\${prefix}farm\\\` - Trồng trọt, thu hoạch\`, inline: false },`;

code = code.replace(fieldString, fieldString + addString);

fs.writeFileSync('index.js', code);
console.log("Done.");
