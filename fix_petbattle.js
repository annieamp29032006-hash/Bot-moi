const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const searchStr = `    if (content.startsWith(\`\${prefix}petbattle\`) || content.startsWith(\`\${prefix}pb\`)) {
        const target = message.mentions.users.first();
        if (!target) return message.reply(\`❌ Cú pháp: \\\`\${prefix}petbattle @user\\\`\`);
        return handlePetBattle(message.author.id, target.id, message);
    }`;

const replaceStr = `    if (content.startsWith(\`\${prefix}petbattle\`) || content.startsWith(\`\${prefix}pb\`)) {
        const target = message.mentions.users.first();
        if (!target) return message.reply(\`❌ Cú pháp: \\\`\${prefix}petbattle @user [tiền cược]\\\`\`);
        const args = content.split(' ');
        const bet = parseInt(args[2]) || 1000;
        return handlePetBattle(message.author.id, target.id, bet, message);
    }`;

code = code.replace(searchStr, replaceStr);

fs.writeFileSync('index.js', code);
console.log('Fixed petbattle prefix command');
