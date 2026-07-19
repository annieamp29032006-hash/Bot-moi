const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const oldFuncRegex = /async function handleTrivia\([\s\S]*?collector\.on\('end',[\s\S]*?\}\);[\s\S]*?\}/;

const newFunc = `async function handleTrivia(userId, msgOrInteraction) {
    const questionData = TRIVIA_LIST[Math.floor(Math.random() * TRIVIA_LIST.length)];
    const gameId = Date.now().toString();
    
    const embed = new EmbedBuilder()
        .setTitle('🧠 Đố Vui Tập Thể!')
        .setDescription(\`**Câu hỏi:** \${questionData.question}\\n\\nMọi người có **30 giây** để chọn đáp án đúng! Phần thưởng: **\${questionData.reward} ĐT**\`)
        .setColor('#9B59B6');
        
    const labels = ['A', 'B', 'C', 'D'];
    const buttons = questionData.answers.map((ans, index) => {
        return new ButtonBuilder()
            .setCustomId(\`trivia_\${index}_\${gameId}\`)
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
    
    const filter = i => i.customId.startsWith('trivia_') && i.customId.includes(gameId);
    const collector = msg.createMessageComponentCollector({ filter, time: 30000 });
    
    const answeredUsers = new Map();
    
    collector.on('collect', async i => {
        if (answeredUsers.has(i.user.id)) {
            return i.reply({ content: '❌ Bạn đã chọn đáp án rồi, không thể đổi lại!', flags: MessageFlags.Ephemeral });
        }
        
        const parts = i.customId.split('_');
        const selectedIndex = parseInt(parts[1]);
        
        answeredUsers.set(i.user.id, selectedIndex);
        await i.reply({ content: \`✅ Bạn đã khóa đáp án **\${labels[selectedIndex]}**! Hãy chờ hết giờ để xem kết quả.\`, flags: MessageFlags.Ephemeral });
    });
    
    collector.on('end', () => {
        const disabledRow = new ActionRowBuilder().addComponents(
            buttons.map((b, idx) => {
                const btn = ButtonBuilder.from(b).setDisabled(true);
                if (idx === questionData.correctIndex) btn.setStyle(ButtonStyle.Success);
                return btn;
            })
        );
        
        const winners = [];
        
        answeredUsers.forEach((selectedIndex, uId) => {
            if (selectedIndex === questionData.correctIndex) {
                winners.push(\`<@\${uId}>\`);
                updatePlayer(uId, p => {
                    p.coins += questionData.reward;
                });
            }
        });
        
        let resultMsg = \`**Câu hỏi:** \${questionData.question}\\n\\n⏰ **HẾT GIỜ!** Đáp án đúng là **\${labels[questionData.correctIndex]}**.\\n\\n\`;
        
        if (winners.length > 0) {
            embed.setColor('#2ECC71');
            resultMsg += \`🎉 **Chúc mừng những người trả lời đúng nhận được \${questionData.reward} ĐT:**\\n\${winners.join(', ')}\`;
        } else {
            embed.setColor('#E74C3C');
            if (answeredUsers.size === 0) {
                resultMsg += \`😢 Không có ai tham gia trả lời.\`;
            } else {
                resultMsg += \`😢 Rất tiếc, không có ai trả lời đúng!\`;
            }
        }
        
        embed.setDescription(resultMsg);
        
        if (msgOrInteraction.editReply) msgOrInteraction.editReply({ embeds: [embed], components: [disabledRow] }).catch(()=>{});
        else if (msg.edit) msg.edit({ embeds: [embed], components: [disabledRow] }).catch(()=>{});
    });
}`;

if (oldFuncRegex.test(code)) {
    code = code.replace(oldFuncRegex, newFunc);
    fs.writeFileSync('index.js', code);
    console.log('Successfully updated handleTrivia to Multiplayer mode');
} else {
    console.log('Failed to find old handleTrivia function');
}
