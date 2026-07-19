const fs = require('fs');

let content = fs.readFileSync('index.js', 'utf8');
content = content.replace(/\r\n/g, '\n');

// 1. Swap rob and robbank order
const targetPrefix = `    if (content.startsWith(\`\${prefix}rob\`)) {
        const target = message.mentions.users.first();
        if (!target) return message.reply(\`❌ Cú pháp: \\\`\${prefix}rob @user\\\`\`);
        return handleRob(message.author.id, target.id, message);
    }
    if (content.startsWith(\`\${prefix}robbank\`) || content.startsWith(\`\${prefix}heist\`)) {
        const robTarget = message.mentions.users.first();
        return handleRobbank(message.author.id, message, robTarget ? robTarget.id : null);
    }`;

const replacePrefix = `    if (content.startsWith(\`\${prefix}robbank\`) || content.startsWith(\`\${prefix}heist\`)) {
        const robTarget = message.mentions.users.first();
        return handleRobbank(message.author.id, message, robTarget ? robTarget.id : null);
    }
    if (content.startsWith(\`\${prefix}rob \`) || content === \`\${prefix}rob\`) {
        const target = message.mentions.users.first();
        if (!target) return message.reply(\`❌ Cú pháp: \\\`\${prefix}rob @user\\\`\`);
        return handleRob(message.author.id, target.id, message);
    }`;

if (content.includes(targetPrefix)) {
    content = content.replace(targetPrefix, replacePrefix);
    console.log('Patch 1 (Prefix commands) successful');
} else {
    console.log('Patch 1 failed to match targetPrefix');
}


// 2. Add /rob slash command handler
const targetSlash = `    if (commandName === 'robbank' || commandName === 'heist') {
        const robTarget = interaction.options?.getUser('user');
        return handleRobbank(uid, interaction, robTarget ? robTarget.id : null);
    }`;

const replaceSlash = `    if (commandName === 'rob') {
        const robTarget = interaction.options?.getUser('user');
        if (!robTarget) return interaction.reply({ content: '❌ Bạn phải chọn người để trộm!', ephemeral: true });
        return handleRob(uid, robTarget.id, interaction);
    }

    if (commandName === 'robbank' || commandName === 'heist') {
        const robTarget = interaction.options?.getUser('user');
        return handleRobbank(uid, interaction, robTarget ? robTarget.id : null);
    }`;

if (content.includes(targetSlash)) {
    content = content.replace(targetSlash, replaceSlash);
    console.log('Patch 2 (Slash command /rob) successful');
} else {
    console.log('Patch 2 failed to match targetSlash');
}

fs.writeFileSync('index.js', content, 'utf8');
console.log('Successfully patched rob and robbank!');
