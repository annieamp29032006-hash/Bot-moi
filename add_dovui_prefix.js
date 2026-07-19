const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

const targetStr = `    // !petbattle
    if (content.startsWith(\`\${prefix}petbattle\`) || content.startsWith(\`\${prefix}pb\`)) {`;

const replaceStr = `    // !dovui
    if (content.startsWith(\`\${prefix}dovui\`)) {
        return handleTrivia(message.author.id, message);
    }

    // !petbattle
    if (content.startsWith(\`\${prefix}petbattle\`) || content.startsWith(\`\${prefix}pb\`)) {`;

if (code.includes(targetStr)) {
    code = code.replace(targetStr, replaceStr);
    fs.writeFileSync('index.js', code);
    console.log('Added dovui prefix command');
} else {
    console.log('Target string not found');
}
