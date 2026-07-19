const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

if (!code.includes('const TRIVIA_LIST')) {
    code = code.replace(/const fs = require\('fs'\);/, "const fs = require('fs');\nconst TRIVIA_LIST = JSON.parse(fs.readFileSync('./trivia.json', 'utf8'));");
    fs.writeFileSync('index.js', code);
    console.log('Fixed TRIVIA_LIST');
} else {
    console.log('TRIVIA_LIST already exists');
}
