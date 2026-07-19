const fs = require('fs');
let code = fs.readFileSync('d:\\Bot moi\\index.js', 'utf8');

// 1. Anti-Nuke: 3 -> 2
code = code.replace(/if \(recentActions\.length >= 3\) \{/, 'if (recentActions.length >= 2) {');

// 2. Anti-Raid: 10 -> 5 and Kick -> Ban
const oldAntiRaid = `if (joinTimes.length >= 10) {
                await member.kick('Anti-Raid: Phát hiện mass join').catch(() => {});`;
const newAntiRaid = `if (joinTimes.length >= 5) {
                await member.ban({ reason: 'Anti-Raid: Phát hiện mass join' }).catch(() => {});`;
if (code.includes(oldAntiRaid)) {
    code = code.replace(oldAntiRaid, newAntiRaid);
} else {
    console.log('Failed to find Anti-Raid check');
}

// 3. Anti-Spam: 10 -> 7, 1 hour -> 7 days
const oldAntiSpam = `if (userMsgs.length >= 10 || sameContentCount >= 5) {
                await message.member.timeout(60 * 60 * 1000, 'Anti-Spam: Gửi quá nhiều tin nhắn').catch(() => {});
                await message.channel.send(\`🚨 <@\${message.author.id}> đã bị Mute 1 tiếng do nghi ngờ spam!\`).catch(() => {});`;
const newAntiSpam = `if (userMsgs.length >= 7 || sameContentCount >= 5) {
                await message.member.timeout(7 * 24 * 60 * 60 * 1000, 'Anti-Spam: Gửi quá nhiều tin nhắn').catch(() => {});
                await message.channel.send(\`🚨 <@\${message.author.id}> đã bị Mute **1 Tuần** do nghi ngờ spam!\`).catch(() => {});`;
if (code.includes(oldAntiSpam)) {
    code = code.replace(oldAntiSpam, newAntiSpam);
} else {
    console.log('Failed to find Anti-Spam check');
}

fs.writeFileSync('d:\\Bot moi\\index.js', code, 'utf8');
console.log('Patch complete.');
