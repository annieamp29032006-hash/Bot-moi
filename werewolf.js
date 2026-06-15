// ========================
// MA SÓI (WEREWOLF) ENGINE
// ========================
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');

const WW_GAMES = new Map(); // guildId → gameState

const WW_ROLES = {
    WEREWOLF: { id: 'WEREWOLF', name: '🐺 Ma Sói',      team: 'evil', desc: 'Mỗi đêm chọn 1 người để giết.' },
    VILLAGER: { id: 'VILLAGER', name: '👤 Dân Làng',    team: 'good', desc: 'Dùng lý luận để tìm Ma Sói và vote loại.' },
    SEER:     { id: 'SEER',     name: '🔮 Tiên Tri',    team: 'good', desc: 'Mỗi đêm điều tra 1 người — biết họ là Dân hay Ma Sói.' },
    DOCTOR:   { id: 'DOCTOR',   name: '🛡️ Thầy Thuốc', team: 'good', desc: 'Mỗi đêm bảo vệ 1 người khỏi bị Ma Sói giết.' },
    WITCH:    { id: 'WITCH',    name: '🧙 Phù Thủy',   team: 'good', desc: 'Có 1 lần cứu và 1 lần giết (dùng qua DM).' },
};

function getRoleAssignment(count) {
    const wolves = count <= 5 ? 1 : count <= 8 ? 2 : count <= 12 ? 3 : 4;
    const roles = [];
    for (let i = 0; i < wolves; i++) roles.push('WEREWOLF');
    if (count >= 4) roles.push('SEER');
    if (count >= 6) roles.push('DOCTOR');
    if (count >= 8) roles.push('WITCH');
    while (roles.length < count) roles.push('VILLAGER');
    return roles.sort(() => Math.random() - 0.5);
}

function newGame(guildId, channelId, hostId) {
    return {
        guildId, channelId, hostId,
        phase: 'lobby',
        round: 0,
        players: new Map(),     // userId → { role, alive }
        nightActions: {},       // wolfTarget, seerTarget, doctorTarget, witchSave, witchKillTarget
        votes: new Map(),       // voterId → targetId
        voteMsg: null,
        witchSave: true,
        witchKill: true,
        doctorLastSaved: null,
        nightTimeout: null,
        dayTimeout: null,
        lobbyMsg: null,
        lobbyTimeout: null,
    };
}

function checkWin(game) {
    const alive = [...game.players.values()].filter(p => p.alive);
    const wolves = alive.filter(p => p.role === 'WEREWOLF').length;
    const good = alive.filter(p => p.role !== 'WEREWOLF').length;
    if (wolves === 0) return 'villagers';
    if (wolves >= good) return 'werewolves';
    return null;
}

async function sendDMs(game, client) {
    for (const [uid, pdata] of game.players) {
        try {
            const user = await client.users.fetch(uid);
            const roleInfo = WW_ROLES[pdata.role];
            let extra = '';
            if (pdata.role === 'WEREWOLF') {
                const allies = [...game.players.entries()]
                    .filter(([id, p]) => p.role === 'WEREWOLF' && id !== uid)
                    .map(([id]) => `<@${id}>`).join(', ');
                extra = allies ? `\n\n🐺 **Đồng đội Ma Sói:** ${allies}` : '\n\n🐺 Bạn là **Ma Sói duy nhất**!';
            }
            await user.send(`🎮 **Game Ma Sói bắt đầu!**\n\nVai của bạn: **${roleInfo.name}**\n> ${roleInfo.desc}${extra}`);
        } catch { /* DM disabled */ }
    }
}

function buildAliveOptions(game, guildId, client, excludeId = null) {
    const guild = client.guilds.cache.get(guildId);
    return [...game.players.entries()]
        .filter(([id, p]) => p.alive && id !== excludeId)
        .map(([uid]) => {
            const member = guild?.members.cache.get(uid);
            const name = member?.displayName || uid;
            return new StringSelectMenuOptionBuilder().setLabel(name.substring(0, 25)).setValue(uid);
        });
}

async function startNight(game, client, channel) {
    game.phase = 'night';
    game.round++;
    game.nightActions = { wolfTarget: null, seerTarget: null, doctorTarget: null, witchSave: false, witchKillTarget: null };
    game.votes.clear();

    const embed = new EmbedBuilder()
        .setTitle(`🌙 Đêm ${game.round} — Cả làng đi ngủ...`)
        .setDescription('Ma Sói và các vai đặc biệt hãy kiểm tra **DM** để thực hiện hành động!\n\n> ⏱️ Thời gian hành động đêm: **45 giây**')
        .setColor('#1a1a2e')
        .setImage('https://i.imgur.com/1q2W3eK.gif');
    await channel.send({ embeds: [embed] });

    const alivePlayers = [...game.players.entries()].filter(([, p]) => p.alive);

    // === MA SÓI ===
    const wolves = alivePlayers.filter(([, p]) => p.role === 'WEREWOLF');
    const nonWolves = alivePlayers.filter(([, p]) => p.role !== 'WEREWOLF');
    if (wolves.length && nonWolves.length) {
        const opts = buildAliveOptions(game, game.guildId, client);
        const wolfOpts = opts.filter(o => {
            const val = o.data?.value || o.toJSON?.()?.value || '';
            return game.players.get(val)?.role !== 'WEREWOLF';
        });
        if (wolfOpts.length) {
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`ww_wolf_kill_${game.guildId}`)
                    .setPlaceholder('🐺 Chọn người để giết...')
                    .addOptions(wolfOpts)
            );
            const em = new EmbedBuilder().setTitle('🐺 Lượt Giết Ma Sói').setDescription('Chọn 1 người làng để giết tối nay.').setColor('#8B0000');
            for (const [wuid] of wolves) {
                try { const u = await client.users.fetch(wuid); await u.send({ embeds: [em], components: [row] }); } catch {}
            }
        }
    }

    // === TIÊN TRI ===
    const seerEntry = alivePlayers.find(([, p]) => p.role === 'SEER');
    if (seerEntry) {
        const [suid] = seerEntry;
        const opts = buildAliveOptions(game, game.guildId, client, suid);
        if (opts.length) {
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`ww_seer_check_${game.guildId}`).setPlaceholder('🔮 Điều tra ai?').addOptions(opts)
            );
            const em = new EmbedBuilder().setTitle('🔮 Điều Tra Đêm Nay').setDescription('Chọn 1 người để xem họ thuộc phe nào.').setColor('#7B2FBE');
            try { const u = await client.users.fetch(suid); await u.send({ embeds: [em], components: [row] }); } catch {}
        }
    }

    // === THẦY THUỐC ===
    const docEntry = alivePlayers.find(([, p]) => p.role === 'DOCTOR');
    if (docEntry) {
        const [duid] = docEntry;
        const opts = buildAliveOptions(game, game.guildId, client).filter(o => {
            const val = o.data?.value || o.toJSON?.()?.value || '';
            return !(val === duid && game.doctorLastSaved === duid);
        });
        if (opts.length) {
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`ww_doctor_protect_${game.guildId}`).setPlaceholder('🛡️ Bảo vệ ai?').addOptions(opts)
            );
            const em = new EmbedBuilder().setTitle('🛡️ Bảo Vệ Đêm Nay').setDescription('Chọn 1 người để bảo vệ tối nay.').setColor('#006994');
            try { const u = await client.users.fetch(duid); await u.send({ embeds: [em], components: [row] }); } catch {}
        }
    }

    // === PHÙ THỦY ===
    const witchEntry = alivePlayers.find(([, p]) => p.role === 'WITCH');
    if (witchEntry && (game.witchSave || game.witchKill)) {
        const [wuid] = witchEntry;
        const btns = [];
        if (game.witchSave) btns.push(new ButtonBuilder().setCustomId(`ww_witch_save_${game.guildId}`).setLabel('💊 Thuốc Cứu').setStyle(ButtonStyle.Success));
        if (game.witchKill) btns.push(new ButtonBuilder().setCustomId(`ww_witch_kill_${game.guildId}`).setLabel('☠️ Thuốc Độc').setStyle(ButtonStyle.Danger));
        btns.push(new ButtonBuilder().setCustomId(`ww_witch_skip_${game.guildId}`).setLabel('⏭️ Bỏ qua').setStyle(ButtonStyle.Secondary));
        const em = new EmbedBuilder()
            .setTitle('🧙 Phù Thủy Hành Động')
            .setDescription(`Bạn còn:\n${game.witchSave ? '💊 1 Thuốc Cứu\n' : ''}${game.witchKill ? '☠️ 1 Thuốc Độc\n' : ''}\nChọn hành động hoặc bỏ qua.`)
            .setColor('#2ecc71');
        try { const u = await client.users.fetch(wuid); await u.send({ embeds: [em], components: [new ActionRowBuilder().addComponents(btns)] }); } catch {}
    }

    if (game.nightTimeout) clearTimeout(game.nightTimeout);
    game.nightTimeout = setTimeout(() => resolveNight(game, client, channel), 45000);
}

async function resolveNight(game, client, channel) {
    if (game.phase !== 'night') return;
    if (game.nightTimeout) { clearTimeout(game.nightTimeout); game.nightTimeout = null; }

    const { wolfTarget, doctorTarget, witchSave, witchKillTarget } = game.nightActions;
    const deaths = [];
    const notes = [];

    // Xử lý Ma Sói giết
    if (wolfTarget) {
        const isProtected = (doctorTarget === wolfTarget) || witchSave;
        if (isProtected) {
            notes.push('🛡️ Có người bị tấn công nhưng đã được **cứu sống**!');
        } else {
            game.players.get(wolfTarget).alive = false;
            deaths.push(wolfTarget);
        }
    }

    game.doctorLastSaved = doctorTarget || null;

    // Phù thủy độc
    if (witchKillTarget && game.players.has(witchKillTarget) && game.players.get(witchKillTarget).alive) {
        game.players.get(witchKillTarget).alive = false;
        deaths.push(witchKillTarget);
        notes.push('☠️ Ai đó bị đầu độc trong đêm!');
    }

    const guild = client.guilds.cache.get(game.guildId);
    let deathText = '';
    for (const uid of deaths) {
        const member = guild?.members.cache.get(uid);
        const name = member?.displayName || `<@${uid}>`;
        deathText += `\n💀 **${name}** đã bị giết — Vai: **${WW_ROLES[game.players.get(uid).role].name}**`;
    }

    const embed = new EmbedBuilder()
        .setTitle(`☀️ Ngày ${game.round} — Bình minh ló dạng`)
        .setDescription(deaths.length > 0
            ? `Đêm qua không bình yên...\n${deathText}${notes.length ? '\n\n' + notes.join('\n') : ''}`
            : `✨ Đêm qua cả làng bình an! Không ai bị giết.${notes.length ? '\n\n' + notes.join('\n') : ''}`)
        .setColor('#FFD700');
    await channel.send({ embeds: [embed] });

    const win = checkWin(game);
    if (win) return endGame(game, client, channel, win);

    await new Promise(r => setTimeout(r, 2000));
    await startDay(game, client, channel);
}

async function startDay(game, client, channel) {
    game.phase = 'day';
    game.votes.clear();

    const alivePlayers = [...game.players.entries()].filter(([, p]) => p.alive);
    const guild = client.guilds.cache.get(game.guildId);

    // Tạo buttons vote (tối đa 4 hàng x 5 nút = 20 người)
    const voteRows = [];
    for (let i = 0; i < alivePlayers.length; i += 4) {
        const chunk = alivePlayers.slice(i, i + 4);
        voteRows.push(new ActionRowBuilder().addComponents(
            ...chunk.map(([uid]) => {
                const member = guild?.members.cache.get(uid);
                const label = (member?.displayName || uid).substring(0, 20);
                return new ButtonBuilder()
                    .setCustomId(`ww_vote_${game.guildId}_${uid}`)
                    .setLabel(label)
                    .setStyle(ButtonStyle.Primary);
            })
        ));
    }
    // Hàng nút kết thúc
    voteRows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ww_endvote_${game.guildId}`).setLabel('✅ Kết Thúc Bỏ Phiếu').setStyle(ButtonStyle.Success)
    ));

    const embed = new EmbedBuilder()
        .setTitle(`🗳️ Bỏ Phiếu — Ngày ${game.round}`)
        .setDescription('Hãy thảo luận và **nhấn tên** người bạn nghi là Ma Sói!\n\n> Người nhiều phiếu nhất sẽ bị xử tử.\n> 🕐 Tự động kết thúc sau **60 giây**.')
        .addFields({ name: `👥 Còn sống (${alivePlayers.length} người)`, value: alivePlayers.map(([uid]) => `<@${uid}>`).join(' '), inline: false })
        .setColor('#E67E22')
        .setFooter({ text: 'Mỗi người chỉ vote 1 lần • Có thể đổi vote' });

    game.voteMsg = await channel.send({ embeds: [embed], components: voteRows });

    if (game.dayTimeout) clearTimeout(game.dayTimeout);
    game.dayTimeout = setTimeout(() => resolveDay(game, client, channel), 60000);
}

async function resolveDay(game, client, channel) {
    if (!['day', 'resolving'].includes(game.phase)) return;
    game.phase = 'resolving';
    if (game.dayTimeout) { clearTimeout(game.dayTimeout); game.dayTimeout = null; }

    // Disable nút vote
    if (game.voteMsg) { await game.voteMsg.edit({ components: [] }).catch(() => {}); game.voteMsg = null; }

    // Đếm phiếu
    const tally = new Map();
    for (const targetId of game.votes.values()) {
        tally.set(targetId, (tally.get(targetId) || 0) + 1);
    }

    let executed = null;
    const guild = client.guilds.cache.get(game.guildId);
    let voteText = tally.size > 0
        ? [...tally.entries()].sort((a, b) => b[1] - a[1])
            .map(([uid, v]) => {
                const name = guild?.members.cache.get(uid)?.displayName || `<@${uid}>`;
                return `**${name}**: ${v} phiếu`;
            }).join('\n')
        : '_Không ai bị vote._';

    if (tally.size > 0) {
        const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
        if (sorted.length === 1 || sorted[0][1] > sorted[1][1]) {
            executed = sorted[0][0];
            game.players.get(executed).alive = false;
        }
    }

    const embed = new EmbedBuilder().setTitle('⚖️ Kết Quả Bỏ Phiếu').setColor('#E74C3C');
    if (executed) {
        const eName = guild?.members.cache.get(executed)?.displayName || `<@${executed}>`;
        embed.setDescription(`**Phiếu bầu:**\n${voteText}\n\n☠️ Dân làng đã xử tử **${eName}**!\n> Vai: **${WW_ROLES[game.players.get(executed).role].name}**`);
    } else {
        embed.setDescription(`**Phiếu bầu:**\n${voteText}\n\n🤝 Hòa phiếu — Không ai bị xử tử hôm nay.`);
    }
    await channel.send({ embeds: [embed] });

    const win = checkWin(game);
    if (win) return endGame(game, client, channel, win);

    await new Promise(r => setTimeout(r, 3000));
    await startNight(game, client, channel);
}

async function endGame(game, client, channel, winner) {
    game.phase = 'ended';
    if (game.nightTimeout) clearTimeout(game.nightTimeout);
    if (game.dayTimeout) clearTimeout(game.dayTimeout);
    if (game.lobbyTimeout) clearTimeout(game.lobbyTimeout);

    const guild = client.guilds.cache.get(game.guildId);
    const isVillWin = winner === 'villagers';

    const reveal = [...game.players.entries()]
        .map(([uid, p]) => {
            const name = guild?.members.cache.get(uid)?.displayName || `<@${uid}>`;
            return `${p.alive ? '✅' : '💀'} **${name}** — ${WW_ROLES[p.role].name}`;
        }).join('\n');

    const rewardLines = [];
    const addCoinsWW = game._addCoins;
    for (const [uid, p] of game.players) {
        let reward = 10000;
        if (isVillWin && p.role !== 'WEREWOLF' && p.alive) reward += 100000;
        if (!isVillWin && p.role === 'WEREWOLF' && p.alive) reward += 300000;
        if (addCoinsWW) addCoinsWW(uid, reward);
        const name = guild?.members.cache.get(uid)?.displayName || `<@${uid}>`;
        rewardLines.push(`**${name}**: +${reward.toLocaleString()} 🪙`);
    }

    const embed = new EmbedBuilder()
        .setTitle(isVillWin ? '🎉 DÂN LÀNG CHIẾN THẮNG!' : '🐺 MA SÓI CHIẾN THẮNG!')
        .setDescription(isVillWin
            ? '✅ Tất cả Ma Sói đã bị tiêu diệt! Dân làng được sống bình yên!'
            : '💀 Ma Sói đã kiểm soát hoàn toàn làng trong bóng tối...')
        .addFields(
            { name: '🎭 Lộ Diện Tất Cả Vai', value: reveal || 'Không có', inline: false },
            { name: '💰 Phần Thưởng', value: rewardLines.join('\n'), inline: false }
        )
        .setColor(isVillWin ? '#2ECC71' : '#8B0000')
        .setFooter({ text: 'Game Ma Sói kết thúc! Cảm ơn mọi người đã tham gia!' });

    await channel.send({ embeds: [embed] });
    WW_GAMES.delete(game.guildId);
}

async function startGame(game, client, channel) {
    if (game.lobbyTimeout) { clearTimeout(game.lobbyTimeout); game.lobbyTimeout = null; }
    if (game.lobbyMsg) { await game.lobbyMsg.edit({ components: [] }).catch(() => {}); }

    const playerCount = game.players.size;
    const roleList = getRoleAssignment(playerCount);
    const playerIds = [...game.players.keys()];
    playerIds.forEach((uid, i) => { game.players.get(uid).role = roleList[i]; });

    const roleCount = {};
    roleList.forEach(r => roleCount[r] = (roleCount[r] || 0) + 1);
    const roleInfo = Object.entries(roleCount)
        .map(([r, c]) => `${WW_ROLES[r].name}: **${c}**`)
        .join(' • ');

    const embed = new EmbedBuilder()
        .setTitle('🐺 Game Ma Sói Bắt Đầu!')
        .setDescription(`**${playerCount} người chơi** — Vai đã được gửi qua DM!\n\n${roleInfo}\n\n> Hãy kiểm tra DM để xem vai của bạn!`)
        .addFields({ name: '👥 Người Chơi', value: playerIds.map(uid => `<@${uid}>`).join(' '), inline: false })
        .setColor('#5865F2');
    await channel.send({ embeds: [embed] });

    await sendDMs(game, client);
    await new Promise(r => setTimeout(r, 3000));
    await startNight(game, client, channel);
}

async function openLobby(guildId, channel, hostId, client) {
    if (WW_GAMES.has(guildId)) {
        return channel.send('❌ Đang có game Ma Sói trong server này! Dùng `!wwstop` để hủy.');
    }

    const game = newGame(guildId, channel.id, hostId);
    WW_GAMES.set(guildId, game);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ww_join_${guildId}`).setLabel('🎮 Tham Gia').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ww_start_${guildId}`).setLabel('▶️ Bắt Đầu').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ww_cancel_${guildId}`).setLabel('❌ Hủy').setStyle(ButtonStyle.Danger)
    );

    const buildLobbyEmbed = (players) => new EmbedBuilder()
        .setTitle('🐺 Phòng Chờ — Game Ma Sói')
        .setDescription(`<@${hostId}> đã mở phòng!\n\n> 🎮 Nhấn **Tham Gia** để vào game\n> ▶️ Host nhấn **Bắt Đầu** khi đủ người\n> ⚠️ Cần **tối thiểu 4 người**`)
        .addFields({
            name: `👥 Người tham gia (${players.length})`,
            value: players.length ? players.map(uid => `<@${uid}>`).join(' ') : '_Chưa có ai..._',
            inline: false
        })
        .setColor('#5865F2')
        .setFooter({ text: 'Vai: 🐺 Ma Sói | 👤 Dân | 🔮 Tiên Tri | 🛡️ Thầy Thuốc | 🧙 Phù Thủy' });

    const lobbyMsg = await channel.send({ embeds: [buildLobbyEmbed([])], components: [row] });
    game.lobbyMsg = lobbyMsg;
    game._buildLobbyEmbed = buildLobbyEmbed;

    game.lobbyTimeout = setTimeout(async () => {
        if (WW_GAMES.get(guildId)?.phase === 'lobby') {
            WW_GAMES.delete(guildId);
            const expEmbed = buildLobbyEmbed([...game.players.keys()]).setDescription('⏰ Phòng chờ đã hết thời gian.').setColor('#888888');
            await lobbyMsg.edit({ embeds: [expEmbed], components: [] }).catch(() => {});
        }
    }, 300000);

    return { game, lobbyMsg, buildLobbyEmbed };
}

module.exports = {
    WW_GAMES,
    WW_ROLES,
    openLobby,
    startGame,
    startNight,
    resolveNight,
    startDay,
    resolveDay,
    endGame,
    checkWin,
};
