const axios = require('axios');
const fs = require('fs');

const LIMIT = 1025;

async function fetchPokemon() {
    console.log(`Bắt đầu fetch danh sách Pokemon...`);
    const listRes = await axios.get(`https://pokeapi.co/api/v2/pokemon-species?limit=${LIMIT}`);
    const results = listRes.data.results;
    
    const petList = [];
    
    const batchSize = 50;
    for (let i = 0; i < results.length; i += batchSize) {
        const batch = results.slice(i, i + batchSize);
        console.log(`Đang xử lý từ ${i} đến ${i + batch.length - 1}...`);
        
        const promises = batch.map(async (item) => {
            let retries = 3;
            while(retries > 0) {
                try {
                    const detailRes = await axios.get(item.url);
                    const data = detailRes.data;
                    
                    let rarity = 'Thường';
                    let price = 5000;
                    let emoji = '🐾';
                    let weight = 50;
                    
                    if (data.name === 'arceus') {
                        rarity = 'Đấng Sáng Tạo';
                        price = 5000000;
                        emoji = '✨';
                        weight = 0.2;
                    } else if (data.is_mythical) {
                        rarity = 'Thần Thoại';
                        price = 350000;
                        emoji = '🌟';
                        weight = 4;
                    } else if (data.is_legendary) {
                        rarity = 'Huyền Thoại';
                        price = 1000000;
                        emoji = '🔥';
                        weight = 1;
                    } else if (data.capture_rate <= 45) {
                        rarity = 'Cực Hiếm';
                        price = 80000;
                        emoji = '⚡';
                        weight = 15;
                    } else if (data.capture_rate <= 100) {
                        rarity = 'Hiếm';
                        price = 20000;
                        emoji = '💎';
                        weight = 30;
                    }
                    
                    let name = data.name.charAt(0).toUpperCase() + data.name.slice(1);
                    name = name.replace(/-/g, ' ');
                    
                    return {
                        id: data.name,
                        name: name,
                        rarity: rarity,
                        price: price,
                        emoji: emoji,
                        weight: weight,
                        imageUrl: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${data.id}.png`
                    };
                } catch (e) {
                    retries--;
                    if(retries === 0) throw e;
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        });
        
        const batchResults = await Promise.all(promises);
        petList.push(...batchResults);
    }
    
    fs.writeFileSync('./pokemon.json', JSON.stringify(petList, null, 2));
    console.log(`Đã lưu ${petList.length} Pokemon vào pokemon.json`);
}

fetchPokemon().catch(console.error);
