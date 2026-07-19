const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

// 1. Remove catchpet cooldown check
code = code.replace(/if \(now - p\.lastCatch < CATCH_COOLDOWN && !isCheatOn\) \{[\s\S]*?\}\n\s*/, '');

// 2. Remove string from pet embed
code = code.replace(/\\n\\\*\\\(Sử dụng menu bên dưới để xem chi tiết từng con\\\)\\\*/, '');
// Handle both literal string and escaped depending on how it was matched
code = code.replace(/\\n\*\(\Sử dụng menu bên dưới để xem chi tiết từng con\)\*/, '');
// The exact string in index.js:
// \n*(Sử dụng menu bên dưới để xem chi tiết từng con)*
code = code.replace(/\\n\*\(\Sử dụng menu bên dưới để xem chi tiết từng con\)\*/g, '');

// fallback just replace the exact line 
code = code.replace(/embed\.addFields\(\{ name: '📊 Tổng Quan Thú Cung', value: `Bạn đang sở hữu \*\*.*\*\* thú cung thuộc \*\*.*\*\* loài khác nhau\.\\n\*\(\Sử dụng menu bên dưới để xem chi tiết từng con\)\*\`, inline: false \}\);/g, 
  "embed.addFields({ name: '📊 Tổng Quan Thú Cung', value: `Bạn đang sở hữu **${totalPetsCount}** thú cung thuộc **${ownedPets.length}** loài khác nhau.`, inline: false });");


// 3. Remove StringSelectMenu from handlePets
const regexPetsEnd = /ownedPets\.sort\(\(a, b\) => b\.pet\.price - a\.pet\.price\);[\s\S]*?return i\.reply\(\{ content: `❌ Lỗi: \$\{e\.message\}`[\s\S]*?collector\.on\('end',[\s\S]*?\}\);\s*\}/;
code = code.replace(regexPetsEnd, 'return msgOrInteraction.reply ? msgOrInteraction.reply({ embeds: [embed] }) : msgOrInteraction.channel.send({ embeds: [embed] });\n}');

fs.writeFileSync('index.js', code);
console.log("Done");
