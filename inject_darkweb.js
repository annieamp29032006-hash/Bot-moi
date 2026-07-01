const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

// 1. Add tools to RPG_ITEMS
content = content.replace(
    "'magic_leaf': { name: 'Lá Cây Th?n', emoji: '??', price: 300000 }\n    }\n};",
    "'magic_leaf': { name: 'Lá Cây Th?n', emoji: '??', price: 300000 }\n    },\n    tools: {\n        'laptop': { name: 'Laptop Hacker', emoji: '??', price: 1000000 },\n        'virus': { name: 'Virus Trojan', emoji: '??', price: 100000 },\n        'firewall': { name: 'Tu?ng L?a', emoji: '??', price: 300000 }\n    }\n};"
);

// 2. Add buildShopEmbed tools tab
content = content.replace(
    "if (tab === 'farm') {",
    "if (tab === 'tools') {\n        return new EmbedBuilder()\n            .setTitle('?? M?ng Ng?m - C?a Hàng Hacker')\n            .setDescription('Mua công c? d? di hack ti?n ngu?i khác ho?c b?o v? b?n thân!\\n> ?? Gõ !hack @user d? b?t d?u t?n công!')\n            .addFields(\n                ...Object.entries(RPG_ITEMS.tools).map(([k, p]) => ({\n                    name: ${p.emoji} ,\n                    value: Giá: ** ??**,\n                    inline: true\n                }))\n            )\n            .setColor('#000000')\n            .setThumbnail('https://cdn-icons-png.flaticon.com/512/2906/2906274.png')\n            .setFooter({ text: 'Ch?n công c? t? menu bên du?i d? mua' });\n    }\n    if (tab === 'farm') {"
);

// 3. Add tools to buildShopCategoryRow
content = content.replace(
    "new ButtonBuilder().setCustomId('shop_tab_farm').setLabel('?? Nông Tr?i').setStyle(ButtonStyle.Danger)",
    "new ButtonBuilder().setCustomId('shop_tab_farm').setLabel('?? Nông Tr?i').setStyle(ButtonStyle.Danger),\n        new ButtonBuilder().setCustomId('shop_tab_tools').setLabel('?? Hacker').setStyle(ButtonStyle.Primary)"
);

// 4. Add tools to buildShopSelectRow
content = content.replace(
    "if (tab === 'farm') {",
    "if (tab === 'tools') {\n        for (const [k, v] of Object.entries(RPG_ITEMS.tools)) {\n            options.push(new StringSelectMenuOptionBuilder()\n                .setLabel(${v.name})\n                .setValue(	ool_)\n                .setDescription(Giá:  ??)\n                .setEmoji(v.emoji));\n        }\n        return new ActionRowBuilder().addComponents(\n            new StringSelectMenuBuilder().setCustomId('rpg_shop_select').setPlaceholder('?? Ch?n công c? mu?n mua...').addOptions(options)\n        );\n    }\n    if (tab === 'farm') {"
);

// 5. Add tool modal logic
content = content.replace(
    "else if (type === 'seed') item = RPG_ITEMS.seeds[itemCode];",
    "else if (type === 'seed') item = RPG_ITEMS.seeds[itemCode];\n            else if (type === 'tool') item = RPG_ITEMS.tools[itemCode];"
);

// 6. Add hack slash command
content = content.replace(
    ".addUserOption(o => o.setName('user').setDescription('M?c tiêu (tùy ch?n)').setRequired(false)),",
    ".addUserOption(o => o.setName('user').setDescription('M?c tiêu (tùy ch?n)').setRequired(false)),\n    new SlashCommandBuilder()\n        .setName('hack')\n        .setDescription('?? Xâm nh?p h? th?ng l?y tr?m ti?n t? ngu?i choi khác (C?n Laptop & Virus).')\n        .addUserOption(o => o.setName('user').setDescription('M?c tiêu b? hack').setRequired(true)),"
);

// 7. Add hack logic implementation
const hackLogic = 
// ========================
// HACKING SYSTEM (DARK WEB)
// ========================
const hackingSessions = new Map(); // Store active hacking sessions

async function handleHackCommand(userId, targetId, msgOrInteraction) {
    if (!targetId) return replyMsg(msgOrInteraction, '? Cú pháp: \/hack @user\ ho?c \!hack @user\');
    if (userId === targetId) return replyMsg(msgOrInteraction, '? B?n không th? t? hack chính mình!');
    if (targetId === client.user.id) return replyMsg(msgOrInteraction, '? Tôi là h? th?ng v?n nang, không th? b? hack!');
    
    if (hackingSessions.has(userId)) return replyMsg(msgOrInteraction, '? B?n dang trong m?t phiên hack r?i! Hãy gi?i mã di.');

    const pData = getPlayer(userId);
    if (!pData.inventory['laptop']) return replyMsg(msgOrInteraction, '? B?n không có **?? Laptop Hacker**! Hãy mua trong C?a hàng.');
    if (!pData.inventory['virus'] || pData.inventory['virus'] < 1) return replyMsg(msgOrInteraction, '? B?n dã h?t **?? Virus Trojan**! Hãy mua thêm d? t?n công.');
    
    const targetCoins = getUserCoins(targetId);
    if (targetCoins < 1000000) return replyMsg(msgOrInteraction, '? M?c tiêu quá nghèo (du?i 1M ??), không bõ công hack!');
    
    // Tiêu th? 1 Virus
    updatePlayer(userId, p => {
        p.inventory['virus'] -= 1;
        if (p.inventory['virus'] <= 0) delete p.inventory['virus'];
    });
    
    const targetData = getPlayer(targetId);
    if (targetData.inventory['firewall'] && targetData.inventory['firewall'] > 0) {
        updatePlayer(targetId, p => {
            p.inventory['firewall'] -= 1;
            if (p.inventory['firewall'] <= 0) delete p.inventory['firewall'];
        });
        return replyMsg(msgOrInteraction, \?? **HACK TH?T B?I!**\\nM?c tiêu dã trang b? **?? Tu?ng L?a**. Mã d?c c?a b?n dã b? tiêu di?t và Tu?ng L?a c?a n?n nhân cung b? phá v?!\);
    }
    
    // B?t d?u Minigame
    const digits = [];
    while (digits.length < 3) {
        const d = Math.floor(Math.random() * 10);
        if (!digits.includes(d)) digits.push(d); // 3 s? không trùng nhau
    }
    const secretCode = digits.join('');
    
    hackingSessions.set(userId, { code: secretCode, attempts: 4, targetId });
    
    const embed = new EmbedBuilder()
        .setTitle('?? B?T Ð?U XÂM NH?P (MASTERMIND)')
        .setDescription(\Ðã vu?t qua l?p v? b?c, dang truy c?p vào h? th?ng lõi c?a <@\>!\\n\\n> Hãy nh?p **3 ch? s? không trùng nhau** (Ví d?: \\\123\\\) lên kênh chat d? gi?i mã két s?t.\\n> Tr?ng thái:\\n??: Ðúng s?, dúng v? trí\\n??: Có s? này nhung sai v? trí\\n??: S? sai hoàn toàn\\n\\nB?n có **4 l?n th?**. Nh?p mã c?a b?n ngay!\)
        .setColor('#00FF00');
        
    return replyMsg(msgOrInteraction, { embeds: [embed] });
}

// ========================
// END HACKING SYSTEM
// ========================
;

content = content.replace(
    "async function handleMarketCommand(userId, msgOrInteraction) {",
    hackLogic + "\nasync function handleMarketCommand(userId, msgOrInteraction) {"
);

// 8. Add hack handler to slash commands
content = content.replace(
    "if (commandName === 'market') {",
    "if (commandName === 'hack') {\n        const targetUser = interaction.options.getUser('user');\n        return handleHackCommand(interaction.user.id, targetUser ? targetUser.id : null, interaction);\n    }\n    if (commandName === 'market') {"
);

// 9. Add hack handler to prefix commands & chat collector
content = content.replace(
    "if (BANNED_USERS.includes(message.author.id)) return;",
    "if (BANNED_USERS.includes(message.author.id)) return;\n\n    // --- DARK WEB HACKING LOGIC ---\n    if (hackingSessions.has(message.author.id)) {\n        const session = hackingSessions.get(message.author.id);\n        const guess = message.content.trim();\n        if (/^\\d{3}$/.test(guess)) {\n            session.attempts -= 1;\n            \n            if (guess === session.code) {\n                // Th?ng\n                hackingSessions.delete(message.author.id);\n                const stealPercent = (Math.random() * 0.1) + 0.05; // 5% - 15%\n                const targetCoins = getUserCoins(session.targetId);\n                const stolen = Math.floor(targetCoins * stealPercent);\n                \n                addCoins(session.targetId, -stolen);\n                addCoins(message.author.id, stolen);\n                \n                const embed = new EmbedBuilder()\n                    .setTitle('?? XÂM NH?P THÀNH CÔNG!')\n                    .setDescription(\B?n dã phá gi?i h? th?ng an ninh và cu?m di **\ ??** t? <@\>!\)\n                    .setColor('#2ECC71');\n                return message.reply({ embeds: [embed] });\n            } else {\n                if (session.attempts <= 0) {\n                    // Thua\n                    hackingSessions.delete(message.author.id);\n                    updatePlayer(message.author.id, p => {\n                        delete p.inventory['laptop'];\n                        p.jailTime = Date.now() + 10 * 60 * 1000;\n                    });\n                    \n                    const embed = new EmbedBuilder()\n                        .setTitle('?? BÁO Ð?NG Ð?! B? TÓM C?!')\n                        .setDescription(\B?n dã nh?p sai quá nhi?u l?n. C?nh sát m?ng dã theo dõi IP và ?p vào nhà b?n!\\n\\n> ?? **Laptop Hacker** dã b? t?ch thu!\\n> ?? B?n b? t?ng vào tù **10 phút**!\)\n                        .setColor('#FF0000');\n                    return message.reply({ embeds: [embed] });\n                } else {\n                    let feedback = '';\n                    let tempCode = session.code.split('');\n                    let tempGuess = guess.split('');\n                    \n                    for (let i = 0; i < 3; i++) {\n                        if (tempGuess[i] === tempCode[i]) {\n                            feedback += '?? ';\n                            tempCode[i] = null;\n                            tempGuess[i] = null;\n                        }\n                    }\n                    for (let i = 0; i < 3; i++) {\n                        if (tempGuess[i] !== null) {\n                            const idx = tempCode.indexOf(tempGuess[i]);\n                            if (idx !== -1) {\n                                feedback += '?? ';\n                                tempCode[idx] = null;\n                            } else {\n                                feedback += '?? ';\n                            }\n                        }\n                    }\n                    let sortedFeedback = feedback.trim().split(' ').sort().reverse().join(' ');\n                    return message.reply(\??? Gi?i mã th?t b?i: **\** ?? \\\n> B?n còn **\ l?n th?**! (Vd: ?? = Trúng, ?? = Sai ch?, ?? = Sai)\);\n                }\n            }\n        }\n    }\n"
);

content = content.replace(
    "if (content === ${prefix}market || content === ${prefix}mk) {",
    "if (content.startsWith(${prefix}hack)) {\n        const targetId = message.mentions.users.first()?.id;\n        return handleHackCommand(message.author.id, targetId, message);\n    }\n    if (content === ${prefix}market || content === ${prefix}mk) {"
);

// 10. Update help
content = content.replace(
    "{ name: \\${prefix}nopphat\\ ho?c \\/nopphat\\`, value: '?? Ðang b? tù? N?p **100,000 ??** d? h?i l? và du?c th? t? do ngay l?p t?c!', inline: false }",
    "{ name: \\${prefix}nopphat\\ ho?c \\/nopphat\\`, value: '?? Ðang b? tù? N?p **100,000 ??** d? h?i l? và du?c th? t? do ngay l?p t?c!', inline: false },\n                { name: \\${prefix}hack @user\\ ho?c \\/hack\\`, value: '?? **M?ng Ng?m Dark Web:**\\n• Hack ngu?i khác d? tr?m **5-15%** ti?n c?a h?!\\n• Yêu c?u: C?n mua **Laptop** và **Virus** trong Shop.\\n• Minigame: Nh?p 3 s? không trùng nhau trong 4 l?n th?.\\n• C?nh báo: Th?t b?i s? b? **m?t Laptop và di Tù 10 phút**.\\n• Phòng th?: Mua **Tu?ng L?a** trong Shop d? ch?n hack t? d?ng.', inline: false }"
);

fs.writeFileSync('index.js', content);
console.log('Injected Dark Web successfully');
