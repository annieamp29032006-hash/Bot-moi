const fs = require('fs');
const lines = fs.readFileSync('d:/Bot moi/index.js', 'utf8').split('\n');
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("if (command === ")) {
        console.log("Line " + i + ": " + lines[i]);
    }
}
