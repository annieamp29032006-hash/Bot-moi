const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

// The code starting with `ownedPets.sort((a, b) => b.pet.price - a.pet.price);` inside handlePets
const searchRegex = /ownedPets\.sort\(\(a, b\) => b\.pet\.price - a\.pet\.price\);[\s\S]*?if \(msgOrInteraction\.editReply\) msgOrInteraction\.editReply\(\{ components: \[\] \}\)\.catch\(\(\) => \{\}\);\s*else if \(msg\.edit\) msg\.edit\(\{ components: \[\] \}\)\.catch\(\(\) => \{\}\);\s*\}\);\s*\}/;

const replaceString = `return msgOrInteraction.reply ? msgOrInteraction.reply({ embeds: [embed] }) : msgOrInteraction.channel.send({ embeds: [embed] });\n}`;

code = code.replace(searchRegex, replaceString);

fs.writeFileSync('index.js', code);
console.log("Done.");
