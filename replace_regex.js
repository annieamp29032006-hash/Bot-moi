const fs = require('fs');

let content = fs.readFileSync('index.js', 'utf8');

// Replace exact cases
content = content.replace(/Hima/g, 'Nexora');
content = content.replace(/hima/g, 'nexora');
content = content.replace(/HIMA/g, 'NEXORA');

fs.writeFileSync('index.js', content, 'utf8');
console.log('Replaced all occurrences of Hima with Nexora in index.js');
