const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const target1 = `    // !petbattle\r\n    if (content.startsWith(\`\${prefix}petbattle\`) || content.startsWith(\`\${prefix}pb\`)) {\r\n        const target = message.mentions.users.first();\r\n        if (!target) return message.reply(\`❌ Cú pháp: \\\`\${prefix}petbattle @user\\\`\`);\r\n        return handlePetBattle(message.author.id, target.id, message);\r\n    }`;
const target2 = `    // !petbattle\n    if (content.startsWith(\`\${prefix}petbattle\`) || content.startsWith(\`\${prefix}pb\`)) {\n        const target = message.mentions.users.first();\n        if (!target) return message.reply(\`❌ Cú pháp: \\\`\${prefix}petbattle @user\\\`\`);\n        return handlePetBattle(message.author.id, target.id, message);\n    }`;

const replaceStr = `    // !petbattle
    if (content.startsWith(\`\${prefix}petbattle\`) || content.startsWith(\`\${prefix}pb\`)) {
        const target = message.mentions.users.first();
        if (!target) return message.reply(\`❌ Cú pháp: \\\`\${prefix}petbattle @user [tiền cược]\\\`\`);
        const args = content.split(' ');
        const bet = parseInt(args[2]) || 1000;
        return handlePetBattle(message.author.id, target.id, bet, message);
    }`;

let replaced = false;
if (code.includes(target1)) {
    code = code.replace(target1, replaceStr);
    replaced = true;
} else if (code.includes(target2)) {
    code = code.replace(target2, replaceStr);
    replaced = true;
}

if (replaced) {
    fs.writeFileSync('index.js', code);
    console.log('Fixed petbattle arguments');
} else {
    console.log('Could not find the target string');
}
