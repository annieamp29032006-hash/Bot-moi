const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const targetStr = '    // !addpetvip @user <petId> [amount]';
const replacementStr = `    // !addpetvip @user <petId> [amount]
    if (content.startsWith(\`\${prefix}addpetvip\`)) {
        if (!isAdmin && message.author.id !== '1150393275806650429') return message.reply('❌ Lệnh này chỉ dành cho Admin hoặc Owner!');
        const args = content.split(' ');
        const target = message.mentions.users.first();
        if (!target) return message.reply(\`❌ Cú pháp: \\\`\${prefix}addpetvip @user <petId> [số lượng]\\\`\`);
        const petId = args[2];
        if (!petId) return message.reply(\`❌ Cú pháp: \\\`\${prefix}addpetvip @user <petId> [số lượng]\\\`\`);
        const amount = parseInt(args[3]) || 1;
        
        const petInfo = PET_LIST.find(p => p.id === petId);
        if (!petInfo) return message.reply('❌ Pet ID không hợp lệ! (Ví dụ: pikachu, arceus, lugia...)');
        
        return awaitConfirmation(message, message.author.id, \`Bạn muốn tặng **\${amount}x \${petInfo.emoji} \${petInfo.name}** cho <@\${target.id}>?\`, async () => {
            const data = loadRPG();
            if (!data[target.id]) getPlayer(target.id);
            if (!data[target.id].pets) data[target.id].pets = {};
            
            data[target.id].pets[petId] = (data[target.id].pets[petId] || 0) + amount;
            saveRPG(data);
            return \`✅ Đã tặng **\${amount}x \${petInfo.emoji} \${petInfo.name}** cho <@\${target.id}>!\`;
        });
    }`;

code = code.replace(targetStr, replacementStr);
fs.writeFileSync('index.js', code);
console.log('Added addpetvip prefix command');
