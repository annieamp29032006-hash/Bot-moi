const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const targetStr = `> \\\`\${prefix}work\\\` - Lm vi?c ki?m coin`;
const replaceStr = `> \\\`\${prefix}work\\\` - Lm vi?c ki?m coin\\n> \\\`\${prefix}dovui\\\` - Đố vui có thưởng`;

// The file has encoding issues so we match a more robust part.
// Let's replace:
// { name: '💰 Kiếm Tiền', value: `> \`${prefix}daily\` - Nhận thưởng hàng ngày\n> \`${prefix}work\` - Làm việc kiếm coin\n> \`${prefix}noitu\` - Chơi nối từ nhận xu`, inline: true },

// Let's use Regex to find the Kiếm Tiền line:
code = code.replace(/> \\\`\$\{prefix\}work\\\`[^\n>]+/, (match) => {
    return match + `\\n> \\\`\${prefix}dovui\\\` - Đố vui có thưởng`;
});

fs.writeFileSync('index.js', code);
console.log('Added dovui to help menu');
