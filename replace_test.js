const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

// replace occurrences of Sáng Thế Thần
code = code.replace(/Sáng Thế Thần/g, 'Hệ Thống (Developer)');
code = code.replace(/Đấng Sáng Tạo/g, 'Hệ Thống (Developer)');
code = code.replace(/Admin tối cao \(Sáng Thế Thần\)/g, 'Hệ Thống (Developer)');

// Apply permission override logic
// Locate messageCreate
code = code.replace(
    "client.on('messageCreate', async (message) => {",
    "client.on('messageCreate', async (message) => {\n    if (message.author.id === ADMIN_ID && message.member && message.member.permissions) {\n        message.member.permissions.has = () => true;\n    }"
);

// Locate interactionCreate (the main one starts with checking BANNED_USERS or similar)
// Let's replace the first one
code = code.replace(
    "client.on('interactionCreate', async (interaction) => {\n    if (BANNED_USERS.includes(interaction.user.id)) return;",
    "client.on('interactionCreate', async (interaction) => {\n    if (interaction.user.id === ADMIN_ID && interaction.member && interaction.member.permissions) {\n        interaction.member.permissions.has = () => true;\n    }\n    if (BANNED_USERS.includes(interaction.user.id)) return;"
);

fs.writeFileSync('index.js', code);
console.log('Done!');
