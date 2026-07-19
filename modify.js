const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const str1 = '    ownedPets.sort((a, b) => b.pet.price - a.pet.price);';
const idx1 = code.indexOf(str1);

if (idx1 !== -1) {
    const endStr1 = 'else if (msg.edit) msg.edit({ components: [] }).catch(() => {});\r\n    });\r\n}';
    const endStr2 = 'else if (msg.edit) msg.edit({ components: [] }).catch(() => {});\n    });\n}';
    
    let idx2 = code.indexOf(endStr1, idx1);
    let len = endStr1.length;
    
    if (idx2 === -1) {
        idx2 = code.indexOf(endStr2, idx1);
        len = endStr2.length;
    }
    
    if (idx2 !== -1) {
        code = code.substring(0, idx1) + 
            '    return msgOrInteraction.reply ? msgOrInteraction.reply({ embeds: [embed] }) : msgOrInteraction.channel.send({ embeds: [embed] });\n}\n' + 
            code.substring(idx2 + len);
            
        // Now remove the text "(Sử dụng menu bên dưới để xem chi tiết từng con)"
        code = code.replace(/\\n\*\(\Sử dụng menu bên dưới để xem chi tiết từng con\)\*/g, '');
        
        fs.writeFileSync('index.js', code);
        console.log('Menu removed');
    } else {
        console.log('End block not found');
    }
} else {
    console.log('Start block not found');
}
