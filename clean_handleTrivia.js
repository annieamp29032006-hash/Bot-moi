const fs = require('fs');
let code = fs.readFileSync('index.js', 'utf8');

// The garbage at the end of handleTrivia looks like this:
const garbageStr = `}).catch(()=>{});
        }
    });
}
}).catch(()=>{});
        }
    });
}`;

// Wait, let's just use replace with a proper regex for the end of handleTrivia.
// Actually, it's safer to just replace from `if (msg.edit) msg.edit({ embeds: [embed], components: [disabledRow] }).catch(()=>{});` to the next function definition (`function replyMsg`).

const targetRegex = /if \(msg\.edit\) msg\.edit\(\{ embeds: \[embed\], components: \[disabledRow\] \}\)\.catch\(\(\)=>{}\);\n    \}\);\n\}([\s\S]*?)function replyMsg/g;

code = code.replace(targetRegex, `if (msg.edit) msg.edit({ embeds: [embed], components: [disabledRow] }).catch(()=>{});\n    });\n}\n\nfunction replyMsg`);

fs.writeFileSync('index.js', code);
console.log('Cleaned up garbage in handleTrivia');
