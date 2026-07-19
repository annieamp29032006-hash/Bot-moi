const fs = require('fs');
let code = fs.readFileSync('d:\\Bot moi\\index.js', 'utf8');

// 1. Remove shop_tab_rpg from buildShopCategoryRow
code = code.replace(/new ButtonBuilder\(\)\.setCustomId\('shop_tab_rpg'\)\.setLabel\('\?\? Trang B\? RPG'\)\.setStyle\(ButtonStyle\.Primary\),\n\s*/, '');
// And any remaining shop_tab_rpg button logic in handleShop
code = code.replace(/if \(i\.customId === 'shop_tab_rpg' \|\| /, 'if (');

// 2. Remove commandName === 'heal' block
code = code.replace(/if \(commandName === 'heal'\) \{[\s\S]*?\}\n\n/, '');

// 3. Remove commandName === 'dungeon' block
code = code.replace(/if \(commandName === 'dungeon'\) \{[\s\S]*?\}\n\n/, '');

// 4. Remove commandName === 'pvp' block
code = code.replace(/if \(commandName === 'pvp'\) \{[\s\S]*?\}\n\n/, '');

// 5. Remove commandName === 'class' block
code = code.replace(/if \(commandName === 'class'\) \{[\s\S]*?\}\n\n/, '');

// 6. Remove commandName === 'boss' block
code = code.replace(/if \(commandName === 'boss' \|\| commandName === 'raidboss'\) \{[\s\S]*?\}\n\n/, '');

// 7. Remove raid_attack and raid_top interaction block
code = code.replace(/if \(interaction\.isButton\(\) && \(cid === 'raid_attack' \|\| cid === 'raid_top'\)\) \{[\s\S]*?\}\n\n/g, '');

fs.writeFileSync('d:\\Bot moi\\index.js', code);
console.log('Done part 2');
