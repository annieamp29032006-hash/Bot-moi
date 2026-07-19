const fs = require('fs');
let code = fs.readFileSync('d:\\Bot moi\\index.js', 'utf8');

// 1. Remove RPG_CLASSES, RPG_CHESTS, DUNGEON_MONSTERS
code = code.replace(/const RPG_CLASSES = \{[\s\S]*?\};\n/, '');
code = code.replace(/const RPG_CHESTS = \{[\s\S]*?\};\n/, '');
code = code.replace(/const DUNGEON_MONSTERS = \{[\s\S]*?\};\n/, '');

// 2. Remove weapons, armors, artifacts, potions from RPG_ITEMS
// Actually, it's easier to just rebuild RPG_ITEMS or replace it entirely.
const newRpgItems = `const RPG_ITEMS = {
    pokeballs: {
        'basic_ball': { name: 'Bóng Thường', catchRate: 0.3, price: 10000, emoji: '🔴' },
        'great_ball': { name: 'Bóng Siêu Cấp', catchRate: 0.5, price: 50000, emoji: '🔵' },
        'ultra_ball': { name: 'Bóng Tối Thượng', catchRate: 0.8, price: 200000, emoji: '⚫' },
        'master_ball': { name: 'Bóng Vô Cực', catchRate: 1.0, price: 1000000, emoji: '🟣' }
    },
    seeds: {
        'carrot_seed': { name: 'Hạt Giống Cà Rốt', price: 1000, harvestTime: 2, emoji: '🥕' },
        'tomato_seed': { name: 'Hạt Giống Cà Chua', price: 2000, harvestTime: 4, emoji: '🍅' },
        'corn_seed': { name: 'Hạt Giống Ngô', price: 5000, harvestTime: 8, emoji: '🌽' },
        'watermelon_seed': { name: 'Hạt Giống Dưa Hấu', price: 15000, harvestTime: 24, emoji: '🍉' }
    },
    crops: {
        'carrot': { name: 'Cà Rốt', sellPrice: 2000, emoji: '🥕' },
        'tomato': { name: 'Cà Chua', sellPrice: 5000, emoji: '🍅' },
        'corn': { name: 'Ngô', sellPrice: 15000, emoji: '🌽' },
        'watermelon': { name: 'Dưa Hấu', sellPrice: 50000, emoji: '🍉' }
    },
    tools: {
        'watering_can': { name: 'Bình Tưới Nước', price: 5000, effect: 'reduce_time', value: 0.5, emoji: '💧' },
        'fertilizer': { name: 'Phân Bón', price: 10000, effect: 'increase_yield', value: 2, emoji: '💩' }
    },
    materials: {}
};`;
code = code.replace(/const RPG_ITEMS = \{[\s\S]*?materials: \{\}\n\};\n/, newRpgItems + '\n');

// 3. Remove Raid boss functions
code = code.replace(/const raidPath = '\.\/raid\.json';\n/, '');
code = code.replace(/function getRaidBoss\(\) \{[\s\S]*?\}\n/, '');
code = code.replace(/function saveRaidBoss\(data\) \{[\s\S]*?\}\n/, '');
code = code.replace(/async function spawnRaidBoss\(\) \{[\s\S]*?\}\n/g, ''); // Wait, might be multiple
code = code.replace(/setInterval\(spawnRaidBoss, 60 \* 60 \* 1000\);\n/, '');

// 4. Remove getPlayerStats() and processPvPRound(), executePvPBattle()
code = code.replace(/function getPlayerStats\(p\) \{[\s\S]*?\}\n/, '');
code = code.replace(/function processPvPRound\(.*\) \{[\s\S]*?\}\n/, '');
code = code.replace(/function executePvPBattle\(.*\) \{[\s\S]*?\}\n/, '');

// 5. Remove slash command definitions for dungeon, pvp, heal, boss, class, setuprpgrole
code = code.replace(/new SlashCommandBuilder\(\)[\s\S]*?\.setName\('dungeon'\)[\s\S]*?\.setDescription\('.*?'\),\n/, '');
code = code.replace(/new SlashCommandBuilder\(\)[\s\S]*?\.setName\('pvp'\)[\s\S]*?\.setDescription\('.*?'\),\n/, '');
code = code.replace(/new SlashCommandBuilder\(\)[\s\S]*?\.setName\('heal'\)[\s\S]*?\.setDescription\('.*?'\),\n/, '');
code = code.replace(/new SlashCommandBuilder\(\)[\s\S]*?\.setName\('boss'\)[\s\S]*?\.setDescription\('.*?'\),\n/, '');
code = code.replace(/new SlashCommandBuilder\(\)[\s\S]*?\.setName\('class'\)[\s\S]*?\.setDescription\('.*?'\)[\s\S]*?\),\n/, '');
code = code.replace(/new SlashCommandBuilder\(\)[\s\S]*?\.setName\('setuprpgrole'\)[\s\S]*?\.setDescription\('.*?'\)[\s\S]*?\),\n/, '');

// 6. Fix handleShop
// Change default tab from 'rpg' to 'pet'
code = code.replace(/let currentTab = 'rpg';/, "let currentTab = 'pet';");
code = code.replace(/else currentTab = 'rpg';/, "else currentTab = 'pet';");
// Remove shop_tab_rpg button
code = code.replace(/new ButtonBuilder\(\)\.setCustomId\('shop_tab_rpg'\)\.setLabel\('Vũ Khí & Giáp'\)\.setEmoji\('⚔️'\)\.setStyle\(tab === 'rpg' \? ButtonStyle\.Primary : ButtonStyle\.Secondary\),/g, '');
// Remove buildShopEmbed('rpg') logic
code = code.replace(/if \(tab === 'rpg'\) \{[\s\S]*?return new EmbedBuilder\(\)[\s\S]*?\}\n/, '');
// Remove buildShopSelectRow('rpg') logic
code = code.replace(/if \(tab === 'rpg'\) \{[\s\S]*?return new ActionRowBuilder\(\)\.addComponents\([\s\S]*?\}\n/, '');
// Remove weapons/armors/potions handling from rpg_shop_select
code = code.replace(/if \(type === 'weapon'\) item = RPG_ITEMS\.weapons\[itemCode\];\n.*else if \(type === 'armor'\) item = RPG_ITEMS\.armors\[itemCode\];\n.*else if \(type === 'ring'\)/, "if (type === 'ring')");
code = code.replace(/if \(type === 'weapon' \|\| type === 'armor' \|\| type === 'ring' \|\| type === 'seed' \|\| type === 'tool'\) \{/, "if (type === 'ring' || type === 'seed' || type === 'tool') {");
code = code.replace(/if \(type === 'weapon'\) \{[\s\S]*?\} else if \(type === 'armor'\) \{[\s\S]*?\} else if \(type === 'ring'\)/, "if (type === 'ring')");

// 7. Fix inv command
code = code.replace(/let item = RPG_ITEMS\.potions\?\.\[k\] \|\| RPG_ITEMS\.pokeballs\?\.\[k\] \|\| RPG_ITEMS\.materials\?\.\[k\] \|\| RPG_ITEMS\.weapons\?\.\[k\] \|\| RPG_ITEMS\.armors\?\.\[k\] \|\| RPG_ITEMS\.artifacts\?\.\[k\] \|\| RPG_ITEMS\.seeds\?\.\[k\] \|\| RPG_ITEMS\.crops\?\.\[k\] \|\| RPG_ITEMS\.tools\?\.\[k\];/, 
    "let item = RPG_ITEMS.pokeballs?.[k] || RPG_ITEMS.materials?.[k] || RPG_ITEMS.seeds?.[k] || RPG_ITEMS.crops?.[k] || RPG_ITEMS.tools?.[k];");


fs.writeFileSync('d:\\Bot moi\\index.js', code);
console.log('Done replacement part 1');
