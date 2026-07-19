const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

// 1. Add TRIVIA_LIST loading near PET_LIST
if (!code.includes('const TRIVIA_LIST')) {
    code = code.replace(/const PET_LIST = JSON\.parse\(fs\.readFileSync\('\.\/pokemon\.json', 'utf8'\)\);/, 
        "const PET_LIST = JSON.parse(fs.readFileSync('./pokemon.json', 'utf8'));\nconst TRIVIA_LIST = JSON.parse(fs.readFileSync('./trivia.json', 'utf8'));");
}

// 2. Add handleTrivia function near the end of functions
const handleTriviaFunc = `
async function handleTrivia(userId, msgOrInteraction) {
    const questionData = TRIVIA_LIST[Math.floor(Math.random() * TRIVIA_LIST.length)];
    
    const embed = new EmbedBuilder()
        .setTitle('🧠 Đố Vui Có Thưởng!')
        .setDescription(\`**Câu hỏi:** \${questionData.question}\\n\\nBạn có 15 giây để chọn đáp án đúng! Thưởng: **\${questionData.reward} ĐT**\`)
        .setColor('#9B59B6');
        
    const labels = ['A', 'B', 'C', 'D'];
    const buttons = questionData.answers.map((ans, index) => {
        return new ButtonBuilder()
            .setCustomId(\`trivia_\${index}_\${userId}_\${Date.now()}\`)
            .setLabel(\`\${labels[index]}. \${ans}\`)
            .setStyle(ButtonStyle.Primary);
    });
    
    const row = new ActionRowBuilder().addComponents(buttons);
    
    let msg;
    if (msgOrInteraction.reply && typeof msgOrInteraction.reply === 'function') {
        if (msgOrInteraction.isCommand && msgOrInteraction.isCommand()) {
            await msgOrInteraction.reply({ embeds: [embed], components: [row] });
            msg = await msgOrInteraction.fetchReply();
        } else {
            msg = await msgOrInteraction.reply({ embeds: [embed], components: [row] });
        }
    } else {
        msg = await msgOrInteraction.channel.send({ embeds: [embed], components: [row] });
    }
    
    const filter = i => i.customId.startsWith('trivia_') && i.customId.includes(userId);
    const collector = msg.createMessageComponentCollector({ filter, time: 15000, max: 1 });
    
    collector.on('collect', async i => {
        if (i.user.id !== userId) return i.reply({ content: '❌ Đây không phải câu đố của bạn!', flags: MessageFlags.Ephemeral });
        
        const parts = i.customId.split('_');
        const selectedIndex = parseInt(parts[1]);
        
        const disabledRow = new ActionRowBuilder().addComponents(
            buttons.map((b, idx) => {
                const btn = ButtonBuilder.from(b).setDisabled(true);
                if (idx === questionData.correctIndex) btn.setStyle(ButtonStyle.Success);
                else if (idx === selectedIndex) btn.setStyle(ButtonStyle.Danger);
                return btn;
            })
        );
        
        if (selectedIndex === questionData.correctIndex) {
            updatePlayer(userId, p => {
                p.coins += questionData.reward;
            });
            embed.setColor('#2ECC71').setDescription(\`**Câu hỏi:** \${questionData.question}\\n\\n✅ **CHÍNH XÁC!** Bạn đã chọn đúng đáp án **\${labels[questionData.correctIndex]}** và nhận được **\${questionData.reward} ĐT**!\`);
        } else {
            embed.setColor('#E74C3C').setDescription(\`**Câu hỏi:** \${questionData.question}\\n\\n❌ **SAI RỒI!** Đáp án đúng là **\${labels[questionData.correctIndex]}**. Chúc bạn may mắn lần sau!\`);
        }
        
        await i.update({ embeds: [embed], components: [disabledRow] });
    });
    
    collector.on('end', collected => {
        if (collected.size === 0) {
            const disabledRow = new ActionRowBuilder().addComponents(
                buttons.map((b, idx) => {
                    const btn = ButtonBuilder.from(b).setDisabled(true);
                    if (idx === questionData.correctIndex) btn.setStyle(ButtonStyle.Success);
                    return btn;
                })
            );
            embed.setColor('#95A5A6').setDescription(\`**Câu hỏi:** \${questionData.question}\\n\\n⏰ **HẾT GIỜ!** Bạn đã không đưa ra câu trả lời. Đáp án đúng là **\${labels[questionData.correctIndex]}**.\`);
            if (msgOrInteraction.editReply) msgOrInteraction.editReply({ embeds: [embed], components: [disabledRow] }).catch(()=>{});
            else if (msg.edit) msg.edit({ embeds: [embed], components: [disabledRow] }).catch(()=>{});
        }
    });
}
`;

if (!code.includes('function handleTrivia(')) {
    code = code.replace(/function replyMsg\(interaction, options\) \{/, handleTriviaFunc + '\nfunction replyMsg(interaction, options) {');
}

// 3. Add to slash commands
if (!code.includes(".setName('dovui')")) {
    code = code.replace(/new SlashCommandBuilder\(\)\s*\.setName\('help'\)/, 
        "new SlashCommandBuilder()\n        .setName('dovui')\n        .setDescription('🧠 Tham gia đố vui để nhận tiền thưởng!'),\n    new SlashCommandBuilder()\n        .setName('help')");
}

// 4. Add to interactionCreate
if (!code.includes("commandName === 'dovui'")) {
    code = code.replace(/if \(commandName === 'help'\) \{/, 
        "if (commandName === 'dovui') {\n        return handleTrivia(interaction.user.id, interaction);\n    }\n    if (commandName === 'help') {");
}

// 5. Add to prefix commands
if (!code.includes("${prefix}dovui")) {
    code = code.replace(/\/\/ !help/, 
        "// !dovui\n    if (content.startsWith(`${prefix}dovui`)) {\n        return handleTrivia(message.author.id, message);\n    }\n\n    // !help");
}

// 6. Update Help Menu
if (!code.includes("\`/dovui\` / \`!dovui\` - Chơi đố vui")) {
    code = code.replace(/value: '1. \`\/catchpet\` \/ \`!catchpet\` \\\(hoặc \`!cp\`\\\)/, 
        "value: '1. `/dovui` / `!dovui` - Chơi đố vui nhận thưởng\\n2. `/catchpet` / `!catchpet` (hoặc `!cp`)");
    code = code.replace(/2\. \`\/pets\` \/ \`!pets\` \\\(hoặc \`!p\`\\\)/, "3. `/pets` / `!pets` (hoặc `!p`)");
    code = code.replace(/3\. \`\/petbattle\` \/ \`!petbattle\` \\\(hoặc \`!pb\`\\\)/, "4. `/petbattle` / `!petbattle` (hoặc `!pb`)");
    code = code.replace(/4\. \`\/ptrade\` \/ \`!ptrade\` \\\(hoặc \`!pt\`\\\)/, "5. `/ptrade` / `!ptrade` (hoặc `!pt`)");
}

fs.writeFileSync('index.js', code);
console.log('Trivia logic added');
