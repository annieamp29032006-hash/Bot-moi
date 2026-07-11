const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ButtonStyle, MessageFlags } = require('discord.js');

// ==========================================
// ROLE DEFINITIONS & PRIORITY
// ==========================================
const ROLES = {
    VILLAGER: { id: 'VILLAGER', name: 'Dân Làng 🧑‍🌾', faction: 'VILLAGE' },
    SEER: { id: 'SEER', name: 'Tiên Tri 🔮', faction: 'VILLAGE' },
    GUARD: { id: 'GUARD', name: 'Bảo Vệ 🛡️', faction: 'VILLAGE' },
    WITCH: { id: 'WITCH', name: 'Phù Thủy 🧪', faction: 'VILLAGE' },
    HUNTER: { id: 'HUNTER', name: 'Thợ Săn 🔫', faction: 'VILLAGE' },
    CUPID: { id: 'CUPID', name: 'Cupid 🏹', faction: 'VILLAGE' },
    WATCHER: { id: 'WATCHER', name: 'Người theo dõi 👁️', faction: 'VILLAGE' },
    TRACKER: { id: 'TRACKER', name: 'Người canh gác 🐾', faction: 'VILLAGE' },
    DETECTIVE: { id: 'DETECTIVE', name: 'Thám tử 🕵️', faction: 'VILLAGE' },
    FACTION_SEER: { id: 'FACTION_SEER', name: 'Người soi phe 🔍', faction: 'VILLAGE' },
    BODYGUARD: { id: 'BODYGUARD', name: 'Vệ sĩ 🛡️⚔️', faction: 'VILLAGE' },
    DOCTOR: { id: 'DOCTOR', name: 'Bác sĩ 👨‍⚕️', faction: 'VILLAGE' },
    MAYOR: { id: 'MAYOR', name: 'Cảnh Trưởng 🎖️', faction: 'VILLAGE' },

    WOLF: { id: 'WOLF', name: 'Ma Sói 🐺', faction: 'WOLF' },
    ALPHA_WOLF: { id: 'ALPHA_WOLF', name: 'Sói Đầu Đàn 🐺👑', faction: 'WOLF' },
    WOLF_CUB: { id: 'WOLF_CUB', name: 'Sói Con 🐶', faction: 'WOLF' },
    SPECIAL_WOLF: { id: 'SPECIAL_WOLF', name: 'Sói Trá Hình 🐺🎭', faction: 'WOLF' },

    FOOL: { id: 'FOOL', name: 'Kẻ Khờ 🃏', faction: 'NEUTRAL' },
    IDIOT: { id: 'IDIOT', name: 'Thằng Ngốc 🤡', faction: 'VILLAGE' },
    VAMPIRE: { id: 'VAMPIRE', name: 'Ma Cà Rồng 🧛', faction: 'VAMPIRE' },
    ARSONIST: { id: 'ARSONIST', name: 'Kẻ Đốt Nhà 🔥', faction: 'ARSONIST' },
    SERIAL_KILLER: { id: 'SERIAL_KILLER', name: 'Sát Nhân Hàng Loạt 🔪', faction: 'SERIAL_KILLER' },
    ANGEL: { id: 'ANGEL', name: 'Thiên Thần 👼', faction: 'NEUTRAL' },

    ROLEBLOCKER: { id: 'ROLEBLOCKER', name: 'Kẻ Khóa Kỹ Năng ⛓️', faction: 'NEUTRAL' },
    REDIRECTOR: { id: 'REDIRECTOR', name: 'Kẻ Đổi Mục Tiêu 🔀', faction: 'NEUTRAL' },
    COPIER: { id: 'COPIER', name: 'Kẻ Sao Chép 📝', faction: 'NEUTRAL' },
    SHAPESHIFTER: { id: 'SHAPESHIFTER', name: 'Kẻ Biến Hình 🎭', faction: 'NEUTRAL' },
    RESURRECTOR: { id: 'RESURRECTOR', name: 'Kẻ Hồi Sinh 🧟', faction: 'VILLAGE' },
};

const PRIORITY = {
    BLOCK: 1, REDIRECT: 2, PROTECT: 3, KILL: 4, HEAL: 5, POISON: 6, INVESTIGATE: 7, REVIVE: 8, DEATH_EFFECT: 9
};

const WW_GAMES = new Map(); // guildId -> WerewolfGame

class Player {
    constructor(user) {
        this.id = user.id;
        this.user = user;
        this.role = null;
        this.alive = true;
        this.faction = null;
        
        this.modifiers = {
            protectedBy: [], poisoned: false, roleblocked: false, redirectedTo: null, silenced: false, attackedBy: []
        };
        
        this.states = { doused: false, isVampire: false, lovers: [], voteWeight: 1, idiotRevealed: false };
        this.resources = { healPotion: 1, poisonPotion: 1, protectTargets: [], revivesLeft: 1 };
    }
    resetNightModifiers() {
        this.modifiers.protectedBy = []; this.modifiers.poisoned = false; this.modifiers.roleblocked = false; this.modifiers.redirectedTo = null; this.modifiers.attackedBy = [];
    }
}

class WerewolfGame {
    constructor(channelId, hostId, client) {
        this.channelId = channelId; this.hostId = hostId; this.client = client; this.status = 'LOBBY'; 
        this.players = new Map(); this.day = 0; this.msgRef = null; this.timer = null;
        
        this.settings = { discussionTime: 60000, nightTime: 45000, hunterTime: 30000, canSelfProtect: false, canProtectConsecutive: false, witchCanSelfHeal: true, witchCanUseBoth: true, vampireConvertNights: 2 };
        this.nightActions = []; this.dayVotes = new Map();
        this.globalFlags = { wolfCubKilled: false, firstNight: true };
    }

    addPlayer(user) {
        if (this.status !== 'LOBBY') return false;
        if (!this.players.has(user.id)) { this.players.set(user.id, new Player(user)); return true; }
        return false;
    }

    removePlayer(userId) {
        if (this.status !== 'LOBBY') return false;
        return this.players.delete(userId);
    }
    
    submitNightAction(sourceId, targetId, skillType, priority, data = {}) {
        this.nightActions = this.nightActions.filter(a => !(a.sourceId === sourceId && a.skillType === skillType));
        this.nightActions.push({ sourceId, targetId, skillType, priority, data });
    }

    resolveNightActions() {
        let deaths = []; let reports = new Map();
        const addReport = (uid, msg) => { if (!reports.has(uid)) reports.set(uid, []); reports.get(uid).push(msg); };

        this.nightActions.sort((a, b) => a.priority - b.priority);

        for (const action of this.nightActions) {
            const source = this.players.get(action.sourceId); const target = this.players.get(action.targetId);
            if (!source || !source.alive || !target || !target.alive) continue;
            if (action.priority === PRIORITY.BLOCK) target.modifiers.roleblocked = true;
            else if (action.priority === PRIORITY.REDIRECT && !source.modifiers.roleblocked) {}
        }

        for (const action of this.nightActions) {
            const source = this.players.get(action.sourceId); const target = this.players.get(action.targetId);
            if (!source || !source.alive || source.modifiers.roleblocked) continue;
            if (action.priority === PRIORITY.PROTECT) { if (target) target.modifiers.protectedBy.push(source.id); }
        }

        let wolfTargetVotes = new Map();
        for (const action of this.nightActions) {
            const source = this.players.get(action.sourceId);
            if (!source || !source.alive || source.modifiers.roleblocked) continue;
            if (action.skillType === 'WOLF_VOTE') wolfTargetVotes.set(action.targetId, (wolfTargetVotes.get(action.targetId) || 0) + 1);
        }
        
        let wolfTarget1 = null; let wolfTarget2 = null;
        let sortedWolfTargets = Array.from(wolfTargetVotes.entries()).sort((a,b)=>b[1]-a[1]);
        if (sortedWolfTargets.length > 0) wolfTarget1 = sortedWolfTargets[0][0];
        if (this.globalFlags.wolfCubKilled && sortedWolfTargets.length > 1) wolfTarget2 = sortedWolfTargets[1][0];
        
        this.globalFlags.wolfCubKilled = false; 
        let currentKills = [wolfTarget1, wolfTarget2].filter(x => x);
        
        for (const killTargetId of currentKills) {
            const target = this.players.get(killTargetId);
            if (target && target.alive) target.modifiers.attackedBy.push('WOLVES');
        }

        for (const action of this.nightActions) {
            const source = this.players.get(action.sourceId); const target = this.players.get(action.targetId);
            if (!source || !source.alive || source.modifiers.roleblocked) continue;
            if (action.skillType === 'WITCH_SAVE') { if (target) { target.modifiers.attackedBy = []; source.resources.healPotion--; } }
        }

        for (const action of this.nightActions) {
            const source = this.players.get(action.sourceId); const target = this.players.get(action.targetId);
            if (!source || !source.alive || source.modifiers.roleblocked) continue;
            if (action.skillType === 'WITCH_KILL') { if (target) { target.modifiers.poisoned = true; source.resources.poisonPotion--; } }
        }
        
        for (const action of this.nightActions) {
            const source = this.players.get(action.sourceId); const target = this.players.get(action.targetId);
            if (!source || !source.alive || source.modifiers.roleblocked) continue;
            if (action.skillType === 'SEER_CHECK') {
                if (target) {
                    const isWolf = (target.role.faction === 'WOLF' && target.role.id !== 'SPECIAL_WOLF');
                    addReport(source.id, `Bạn soi <@${target.id}> và thấy người này ${isWolf ? '**LÀ SÓI 🐺**' : '**KHÔNG PHẢI SÓI 🧑‍🌾**'}.`);
                }
            }
        }

        for (const player of this.players.values()) {
            if (!player.alive) continue;
            if (player.modifiers.attackedBy.length > 0 && player.modifiers.protectedBy.length === 0) { player.alive = false; deaths.push(player.id); }
            if (player.modifiers.poisoned) { player.alive = false; if (!deaths.includes(player.id)) deaths.push(player.id); }
            if (!player.alive && player.role.id === 'WOLF_CUB') this.globalFlags.wolfCubKilled = true;
        }

        this.nightActions = []; 
        return { deaths, reports };
    }

    async openLobby() {
        const channel = this.client.channels.cache.get(this.channelId);
        if (!channel) return;
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ww_join_${this.channelId}`).setLabel('🎮 Tham Gia').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`ww_start_${this.channelId}`).setLabel('▶️ Bắt Đầu').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`ww_cancel_${this.channelId}`).setLabel('❌ Hủy').setStyle(ButtonStyle.Danger)
        );

        this.lobbyMsg = await channel.send({ embeds: [this.buildLobbyEmbed()], components: [row] });
        this.timer = setTimeout(() => {
            if (this.status === 'LOBBY') {
                this.status = 'ENDED';
                this.lobbyMsg.edit({ embeds: [this.buildLobbyEmbed().setDescription('⏰ Phòng chờ đã hết thời gian.')], components: [] }).catch(()=>{});
            }
        }, 300000);
    }

    buildLobbyEmbed() {
        const players = Array.from(this.players.values());
        return new EmbedBuilder()
            .setTitle('🐺 Phòng Chờ — Game Ma Sói (Advanced)')
            .setDescription(`<@${this.hostId}> đã mở phòng!\n\n> 🎮 Nhấn **Tham Gia** để vào game\n> ▶️ Host nhấn **Bắt Đầu** khi đủ người\n> ⚠️ Cần **tối thiểu 4 người**`)
            .addFields({
                name: `👥 Người tham gia (${players.length})`,
                value: players.length ? players.map(p => `<@${p.id}>`).join(' ') : '_Chưa có ai..._',
                inline: false
            })
            .setColor('#5865F2');
    }

    async startGame() {
        if (this.players.size < 4) return false;
        if (this.timer) clearTimeout(this.timer);
        this.status = 'STARTING';
        if (this.lobbyMsg) await this.lobbyMsg.edit({ components: [] }).catch(()=>{});

        const rolePool = ['WOLF', 'SEER', 'GUARD', 'WITCH'];
        while(rolePool.length < this.players.size) rolePool.push('VILLAGER');
        rolePool.sort(() => Math.random() - 0.5);

        let i = 0;
        for (const player of this.players.values()) {
            player.role = ROLES[rolePool[i]];
            player.faction = ROLES[rolePool[i]].faction;
            i++;
        }

        const channel = this.client.channels.cache.get(this.channelId);
        await channel.send({ embeds: [new EmbedBuilder().setTitle('🐺 Game Ma Sói Bắt Đầu!').setDescription('Đang gửi vai trò qua DM...').setColor('#5865F2')] });

        for (const player of this.players.values()) {
            try { await player.user.send(`🎮 **Game Ma Sói bắt đầu!**\n\nVai của bạn: **${player.role.name}**\nChuẩn bị bước vào đêm đầu tiên!`); } catch(e) {}
        }

        await new Promise(r => setTimeout(r, 3000));
        await this.startNight();
        return true;
    }

    async startNight() {
        this.status = 'NIGHT';
        this.day++;
        this.nightActions = [];
        this.dayVotes.clear();
        for (const player of this.players.values()) player.resetNightModifiers();

        const channel = this.client.channels.cache.get(this.channelId);
        const embed = new EmbedBuilder().setTitle(`🌙 ĐÊM THỨ ${this.day}`).setDescription('Màn đêm buông xuống. Mọi người đi ngủ.\nCác vai trò có kỹ năng hãy vào DM để hành động! (45 giây)').setColor('#2C3E50');
        await channel.send({ embeds: [embed] });

        await this.dispatchNightUIs();

        this.timer = setTimeout(() => this.endNight(), this.settings.nightTime);
    }

    async dispatchNightUIs() {
        const alivePlayers = Array.from(this.players.values()).filter(p => p.alive);
        const deadPlayers = Array.from(this.players.values()).filter(p => !p.alive);

        for (const player of alivePlayers) {
            let targets = alivePlayers.filter(p => p.id !== player.id);
            let components = [];
            let title = '';
            let color = '#34495E';
            let desc = 'Chọn mục tiêu của bạn cho đêm nay.';
            
            switch (player.role.id) {
                case 'WOLF':
                case 'ALPHA_WOLF':
                case 'WOLF_CUB':
                case 'SPECIAL_WOLF':
                    targets = alivePlayers.filter(p => p.role.faction !== 'WOLF');
                    if (targets.length) {
                        components.push(new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder().setCustomId(`ww_act_WOLF_${this.channelId}`).setPlaceholder('🐺 Chọn người để cắn').addOptions(targets.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                        ));
                        title = 'Lượt của Sói'; color = '#E74C3C'; desc = 'Hãy thống nhất chọn một nạn nhân để cắn đêm nay!';
                    }
                    break;
                case 'VAMPIRE':
                    if (targets.length) {
                        components.push(new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder().setCustomId(`ww_act_VAMPIRE_${this.channelId}`).setPlaceholder('🧛 Chọn người để cắn').addOptions(targets.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                        ));
                        title = 'Lượt Ma Cà Rồng'; color = '#8E44AD'; desc = 'Mục tiêu sẽ bị nhiễm độc và biến thành Ma Cà Rồng sau vài đêm!';
                    }
                    break;
                case 'SERIAL_KILLER':
                    if (targets.length) {
                        components.push(new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder().setCustomId(`ww_act_SERIAL_KILLER_${this.channelId}`).setPlaceholder('🔪 Chọn người để giết').addOptions(targets.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                        ));
                        title = 'Lượt Sát Nhân Hàng Loạt'; color = '#C0392B'; desc = 'Tiêu diệt bất kỳ ai cản đường bạn!';
                    }
                    break;
                case 'ROLEBLOCKER':
                    if (targets.length) {
                        components.push(new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder().setCustomId(`ww_act_ROLEBLOCKER_${this.channelId}`).setPlaceholder('⛓️ Chọn người để khóa kỹ năng').addOptions(targets.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                        ));
                        title = 'Lượt Kẻ Khóa Kỹ Năng'; color = '#95A5A6';
                    }
                    break;
                case 'SEER':
                case 'DETECTIVE':
                    if (targets.length) {
                        components.push(new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder().setCustomId(`ww_act_SEER_${this.channelId}`).setPlaceholder('🔮 Chọn người để điều tra').addOptions(targets.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                        ));
                        title = 'Lượt Tiên Tri / Thám Tử'; color = '#9B59B6';
                    }
                    break;
                case 'GUARD':
                case 'BODYGUARD':
                case 'DOCTOR':
                    const protTargets = alivePlayers.filter(p => this.settings.canSelfProtect || p.id !== player.id);
                    if (protTargets.length) {
                        components.push(new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder().setCustomId(`ww_act_GUARD_${this.channelId}`).setPlaceholder('🛡️ Chọn người để bảo vệ').addOptions(protTargets.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                        ));
                        title = 'Lượt Bảo Vệ / Bác sĩ'; color = '#3498DB';
                    }
                    break;
                case 'WITCH':
                    const btns = [];
                    if (player.resources.healPotion > 0) btns.push(new ButtonBuilder().setCustomId(`ww_act_WITCH_HEAL_${this.channelId}`).setLabel('💊 Dùng Thuốc Cứu').setStyle(ButtonStyle.Success));
                    if (player.resources.poisonPotion > 0) btns.push(new ButtonBuilder().setCustomId(`ww_act_WITCH_POISON_${this.channelId}`).setLabel('☠️ Dùng Thuốc Độc').setStyle(ButtonStyle.Danger));
                    btns.push(new ButtonBuilder().setCustomId(`ww_act_WITCH_SKIP_${this.channelId}`).setLabel('⏭️ Bỏ qua').setStyle(ButtonStyle.Secondary));
                    components.push(new ActionRowBuilder().addComponents(btns));
                    title = 'Lượt Phù Thủy'; color = '#2ECC71'; desc = `💊 Còn ${player.resources.healPotion} bình cứu\n☠️ Còn ${player.resources.poisonPotion} bình độc`;
                    break;
                case 'ARSONIST':
                    const aBtns = [];
                    aBtns.push(new ButtonBuilder().setCustomId(`ww_act_ARSONIST_DOUSE_${this.channelId}`).setLabel('🛢️ Tẩm xăng').setStyle(ButtonStyle.Secondary));
                    aBtns.push(new ButtonBuilder().setCustomId(`ww_act_ARSONIST_IGNITE_${this.channelId}`).setLabel('🔥 Châm lửa!').setStyle(ButtonStyle.Danger));
                    components.push(new ActionRowBuilder().addComponents(aBtns));
                    title = 'Lượt Kẻ Đốt Nhà'; color = '#E67E22'; desc = 'Bạn có thể tẩm xăng một người hoặc châm lửa đốt TẤT CẢ những kẻ đã bị tẩm xăng!';
                    break;
                case 'RESURRECTOR':
                    if (player.resources.revivesLeft > 0 && deadPlayers.length > 0) {
                        components.push(new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder().setCustomId(`ww_act_RESURRECTOR_${this.channelId}`).setPlaceholder('🧟 Chọn người để hồi sinh').addOptions(deadPlayers.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                        ));
                        title = 'Lượt Kẻ Hồi Sinh'; color = '#27AE60';
                    }
                    break;
                case 'CUPID':
                    if (this.day === 1 && targets.length >= 2) {
                        components.push(new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder().setCustomId(`ww_act_CUPID_${this.channelId}`).setPlaceholder('🏹 Chọn 2 người để ghép đôi!').setMinValues(2).setMaxValues(2).addOptions(alivePlayers.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                        ));
                        title = 'Lượt Cupid (Chỉ đêm 1)'; color = '#FF69B4'; desc = 'Chọn 2 người để trở thành cặp đôi. Nếu một người chết, người kia chết theo!';
                    }
                    break;
            }
            
            if (components.length > 0) {
                try { await player.user.send({ embeds: [new EmbedBuilder().setTitle(title).setDescription(desc).setColor(color)], components }); } catch(e){}
            }
        }
    }


    async endNight() {
        const channel = this.client.channels.cache.get(this.channelId);
        const { deaths, reports } = this.resolveNightActions();

        for (const [uid, msgs] of reports.entries()) {
            try { const user = await this.client.users.fetch(uid); await user.send(msgs.join('\n')); } catch(e){}
        }

        let nightReport = `☀️ **TRỜI SÁNG RỒI! MỌI NGƯỜI DẬY ĐI!** ☀️\n\n`;
        if (deaths.length > 0) {
            nightReport += `Đêm qua, có **${deaths.length}** người đã chết:\n`;
            deaths.forEach(d => {
                nightReport += `- <@${d}> (Vai: **${this.players.get(d).role.name}**)\n`;
                this.muteDeadPlayer(d, channel);
            });
        } else {
            nightReport += `Đêm qua bình yên vô sự! 🌙\n`;
        }

        await channel.send({ embeds: [new EmbedBuilder().setDescription(nightReport).setColor('#F1C40F')] });

        if (!this.checkWin(channel)) await this.startDay();
    }

    async startDay() {
        this.status = 'DAY';
        this.dayVotes.clear();
        const channel = this.client.channels.cache.get(this.channelId);

        const alivePlayers = Array.from(this.players.values()).filter(p => p.alive && !p.modifiers.silenced);
        const voteRows = [];
        for (let i = 0; i < alivePlayers.length; i += 4) {
            const chunk = alivePlayers.slice(i, i + 4);
            voteRows.push(new ActionRowBuilder().addComponents(
                ...chunk.map(p => new ButtonBuilder().setCustomId(`ww_vote_${this.channelId}_${p.id}`).setLabel(p.user.username.substring(0, 20)).setStyle(ButtonStyle.Primary))
            ));
        }
        voteRows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ww_endvote_${this.channelId}`).setLabel('✅ Bỏ Phiếu Xong').setStyle(ButtonStyle.Success)
        ));

        this.msgRef = await channel.send({ embeds: [new EmbedBuilder().setTitle(`☀️ NGÀY THỨ ${this.day} - THẢO LUẬN & VOTE`).setDescription(`Thảo luận trong 60 giây và vote người bạn nghi là Sói!`).setColor('#E67E22')], components: voteRows });
        this.timer = setTimeout(() => this.endDay(), this.settings.discussionTime);
    }

    async endDay() {
        const channel = this.client.channels.cache.get(this.channelId);
        if (this.msgRef) await this.msgRef.edit({ components: [] }).catch(()=>{});

        const tally = new Map();
        for (const [voterId, targetId] of this.dayVotes.entries()) {
            const voter = this.players.get(voterId);
            const weight = voter ? voter.states.voteWeight : 1;
            tally.set(targetId, (tally.get(targetId) || 0) + weight);
        }

        let dayReport = `⚖️ **KẾT QUẢ VOTE** ⚖️\n`;
        if (tally.size === 0) {
            dayReport += `Không ai biểu quyết. Không ai bị treo cổ!\n`;
            await channel.send({ embeds: [new EmbedBuilder().setDescription(dayReport).setColor('#95A5A6')] });
            if (!this.checkWin(channel)) this.startNight();
            return;
        }

        const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
        if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
            dayReport += `Hòa phiếu. Không ai bị treo cổ!\n`;
            await channel.send({ embeds: [new EmbedBuilder().setDescription(dayReport).setColor('#95A5A6')] });
        } else {
            const victimId = sorted[0][0];
            const victim = this.players.get(victimId);
            victim.alive = false;
            dayReport += `<@${victimId}> đã bị treo cổ! Vai trò: **${victim.role.name}**.\n`;
            this.muteDeadPlayer(victimId, channel);
            await channel.send({ embeds: [new EmbedBuilder().setDescription(dayReport).setColor('#E74C3C')] });
        }

        if (!this.checkWin(channel)) this.startNight();
    }

    checkWin(channel) {
        let wolves = 0, good = 0;
        for (const p of this.players.values()) {
            if (p.alive) {
                if (p.role.faction === 'WOLF') wolves++;
                else if (p.role.faction === 'VILLAGE') good++;
            }
        }
        if (wolves === 0) { this.endGame(channel, 'VILLAGE'); return true; }
        else if (wolves >= good) { this.endGame(channel, 'WOLF'); return true; }
        return false;
    }

    async endGame(channel, winnerFaction) {
        this.status = 'ENDED';
        if (this.timer) clearTimeout(this.timer);
        
        const title = winnerFaction === 'VILLAGE' ? '🎉 DÂN LÀNG CHIẾN THẮNG!' : '🐺 MA SÓI CHIẾN THẮNG!';
        const color = winnerFaction === 'VILLAGE' ? '#2ECC71' : '#E74C3C';
        
        let reveal = '';
        for (const p of this.players.values()) reveal += `${p.alive ? '✅' : '💀'} <@${p.id}> — **${p.role.name}**\n`;

        await channel.send({ embeds: [new EmbedBuilder().setTitle(title).setDescription(reveal).setColor(color)] });
        await this.unmuteAllPlayers(channel);
        WW_GAMES.delete(channel.guildId || this.channelId); // Clean up
    }

    async muteDeadPlayer(userId, channel) {
        if (!channel.guild) return;
        try {
            const member = await channel.guild.members.fetch(userId);
            if (member && member.voice.channel) {
                await member.voice.setMute(true, "Chết trong Ma Sói");
            }
        } catch (e) {}
    }

    async unmuteAllPlayers(channel) {
        if (!channel.guild) return;
        for (const player of this.players.values()) {
            try {
                const member = await channel.guild.members.fetch(player.id);
                if (member && member.voice.channel) {
                    await member.voice.setMute(false, "Kết thúc Ma Sói");
                }
            } catch (e) {}
        }
    }

    async handleInteraction(interaction) {
        const { customId, user } = interaction;
        
        // Lobby actions
        if (customId.startsWith('ww_join_')) {
            if (this.addPlayer(user)) {
                await interaction.reply({ content: `✅ Đã tham gia thành công!`, flags: MessageFlags.Ephemeral });
                if (this.lobbyMsg) await this.lobbyMsg.edit({ embeds: [this.buildLobbyEmbed()] }).catch(()=>{});
            } else {
                await interaction.reply({ content: `❌ Không thể tham gia (game đã bắt đầu hoặc bạn đã tham gia).`, flags: MessageFlags.Ephemeral });
            }
            return;
        }
        
        if (customId.startsWith('ww_start_')) {
            if (user.id !== this.hostId) return interaction.reply({ content: '❌ Chỉ chủ phòng mới có thể bắt đầu!', flags: MessageFlags.Ephemeral });
            if (this.players.size < 4) return interaction.reply({ content: '❌ Cần ít nhất 4 người chơi!', flags: MessageFlags.Ephemeral });
            await interaction.deferUpdate();
            await this.startGame();
            return;
        }

        if (customId.startsWith('ww_cancel_')) {
            if (user.id !== this.hostId) return interaction.reply({ content: '❌ Chỉ chủ phòng mới có thể hủy!', flags: MessageFlags.Ephemeral });
            this.status = 'ENDED';
            if (this.timer) clearTimeout(this.timer);
            if (this.lobbyMsg) await this.lobbyMsg.edit({ embeds: [this.buildLobbyEmbed().setDescription('🛑 Game đã bị hủy bởi chủ phòng.')], components: [] }).catch(()=>{});
            WW_GAMES.delete(interaction.guildId || this.channelId);
            await interaction.deferUpdate();
            return;
        }

        // Action Menu Actions
        if (customId.startsWith('ww_act_')) {
            const parts = customId.split('_');
            const targetId = interaction.values ? interaction.values[0] : null;
            
            if (parts[2] === 'WITCH') {
                if (parts[3] === 'HEAL') {
                    this.submitNightAction(user.id, null, 'WITCH_SAVE', PRIORITY.HEAL);
                    return interaction.reply({ content: '✅ Bạn đã ném thuốc cứu!', flags: MessageFlags.Ephemeral });
                }
                if (parts[3] === 'POISON') {
                    const alivePlayers = Array.from(this.players.values()).filter(p => p.alive && p.id !== user.id);
                    const row = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder().setCustomId(`ww_act_WITCHPOISON_${this.channelId}`).setPlaceholder('☠️ Chọn người đầu độc').addOptions(alivePlayers.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                    );
                    return interaction.reply({ content: 'Chọn mục tiêu:', components: [row], flags: MessageFlags.Ephemeral });
                }
                if (parts[3] === 'SKIP') {
                    return interaction.reply({ content: '✅ Bỏ qua lượt.', flags: MessageFlags.Ephemeral });
                }
            }
            if (parts[2] === 'WITCHPOISON') {
                this.submitNightAction(user.id, targetId, 'WITCH_KILL', PRIORITY.POISON);
                return interaction.update({ content: '✅ Đã ghi nhận mục tiêu độc!', components: [] });
            }
            if (parts[2] === 'ARSONIST') {
                if (parts[3] === 'DOUSE') {
                    const alivePlayers = Array.from(this.players.values()).filter(p => p.alive && p.id !== user.id);
                    const row = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder().setCustomId(`ww_act_ARSONISTDOUSE_${this.channelId}`).setPlaceholder('🛢️ Chọn người tẩm xăng').addOptions(alivePlayers.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                    );
                    return interaction.reply({ content: 'Chọn mục tiêu để tẩm xăng:', components: [row], flags: MessageFlags.Ephemeral });
                }
                if (parts[3] === 'IGNITE') {
                    this.submitNightAction(user.id, null, 'ARSONIST_IGNITE', PRIORITY.KILL);
                    return interaction.reply({ content: '🔥 Đã châm lửa tất cả nạn nhân bị tẩm xăng!', flags: MessageFlags.Ephemeral });
                }
            }
            if (parts[2] === 'ARSONISTDOUSE') {
                this.submitNightAction(user.id, targetId, 'ARSONIST_DOUSE', PRIORITY.DEATH_EFFECT); // Special priority
                return interaction.update({ content: '✅ Đã ghi nhận mục tiêu tẩm xăng!', components: [] });
            }
            if (parts[2] === 'CUPID') {
                const targetIds = interaction.values; // Array of 2
                this.submitNightAction(user.id, targetIds.join(','), 'CUPID_LINK', 0); // Execute immediately basically
            }

            if (parts[2] === 'WOLF') this.submitNightAction(user.id, targetId, 'WOLF_VOTE', PRIORITY.KILL);
            if (parts[2] === 'SEER') this.submitNightAction(user.id, targetId, 'SEER_CHECK', PRIORITY.INVESTIGATE);
            if (parts[2] === 'GUARD') this.submitNightAction(user.id, targetId, 'GUARD_PROTECT', PRIORITY.PROTECT);
            if (parts[2] === 'VAMPIRE') this.submitNightAction(user.id, targetId, 'VAMPIRE_BITE', PRIORITY.KILL);
            if (parts[2] === 'SERIAL_KILLER') this.submitNightAction(user.id, targetId, 'SERIAL_KILLER', PRIORITY.KILL);
            if (parts[2] === 'ROLEBLOCKER') this.submitNightAction(user.id, targetId, 'ROLEBLOCK', PRIORITY.BLOCK);
            if (parts[2] === 'RESURRECTOR') this.submitNightAction(user.id, targetId, 'RESURRECT', PRIORITY.REVIVE);

            if (interaction.isStringSelectMenu()) {
                await interaction.update({ content: '✅ Đã ghi nhận lựa chọn!', components: [] });
            }
            return;
        }

        // Day Voting
        if (customId.startsWith('ww_vote_')) {
            const parts = customId.split('_');
            const targetId = parts[3]; // ww_vote_channelId_targetId
            this.dayVotes.set(user.id, targetId);
            await interaction.reply({ content: `✅ Đã ghi nhận vote của bạn!`, flags: MessageFlags.Ephemeral });
            return;
        }

        if (customId.startsWith('ww_endvote_')) {
            await interaction.reply({ content: '✅ Đã ghi nhận lệnh kết thúc vote (Chỉ có tác dụng nếu ai cũng vote).', flags: MessageFlags.Ephemeral });
            // Ở phase 1, nút này chủ yếu để test, logic endDay tự xử lý
            return;
        }
    }
}

async function openLobby(guildId, channel, hostId, client) {
    if (WW_GAMES.has(guildId)) {
        return channel.send('❌ Đang có game Ma Sói trong server này! Dùng `!wwstop` để hủy.');
    }
    const game = new WerewolfGame(channel.id, hostId, client);
    WW_GAMES.set(guildId, game);
    await game.openLobby();
    return { game };
}

async function handleInteraction(interaction) {
    if (!interaction.customId.startsWith('ww_')) return;
    
    // Tìm game instance từ cache
    let game = null;
    for (const g of WW_GAMES.values()) {
        if (interaction.customId.includes(g.channelId)) {
            game = g;
            break;
        }
    }
    
    if (game) {
        return game.handleInteraction(interaction);
    } else {
        // Phản hồi dự phòng cho các nút cũ
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Game này đã kết thúc hoặc bị lỗi.', flags: MessageFlags.Ephemeral }).catch(()=>{});
        }
    }
}

module.exports = { 
    WerewolfGame, 
    ROLES, 
    WW_ROLES: ROLES,
    PRIORITY, 
    WW_GAMES, 
    openLobby,
    handleInteraction,
    startGame: async (game, client, channel) => { return game.startGame(); },
    resolveDay: async (game, client, channel) => { return game.endDay(); }
};
