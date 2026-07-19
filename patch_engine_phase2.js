const fs = require('fs');

const path = 'd:\\Bot moi\\werewolf_engine.js';
let code = fs.readFileSync(path, 'utf8');

const UI_CODE = `
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
                            new StringSelectMenuBuilder().setCustomId(\`ww_act_WOLF_\${this.channelId}\`).setPlaceholder('🐺 Chọn người để cắn').addOptions(targets.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                        ));
                        title = 'Lượt của Sói'; color = '#E74C3C'; desc = 'Hãy thống nhất chọn một nạn nhân để cắn đêm nay!';
                    }
                    break;
                case 'VAMPIRE':
                    if (targets.length) {
                        components.push(new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder().setCustomId(\`ww_act_VAMPIRE_\${this.channelId}\`).setPlaceholder('🧛 Chọn người để cắn').addOptions(targets.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                        ));
                        title = 'Lượt Ma Cà Rồng'; color = '#8E44AD'; desc = 'Mục tiêu sẽ bị nhiễm độc và biến thành Ma Cà Rồng sau vài đêm!';
                    }
                    break;
                case 'SERIAL_KILLER':
                    if (targets.length) {
                        components.push(new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder().setCustomId(\`ww_act_SERIAL_KILLER_\${this.channelId}\`).setPlaceholder('🔪 Chọn người để giết').addOptions(targets.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                        ));
                        title = 'Lượt Sát Nhân Hàng Loạt'; color = '#C0392B'; desc = 'Tiêu diệt bất kỳ ai cản đường bạn!';
                    }
                    break;
                case 'ROLEBLOCKER':
                    if (targets.length) {
                        components.push(new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder().setCustomId(\`ww_act_ROLEBLOCKER_\${this.channelId}\`).setPlaceholder('⛓️ Chọn người để khóa kỹ năng').addOptions(targets.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                        ));
                        title = 'Lượt Kẻ Khóa Kỹ Năng'; color = '#95A5A6';
                    }
                    break;
                case 'SEER':
                case 'DETECTIVE':
                    if (targets.length) {
                        components.push(new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder().setCustomId(\`ww_act_SEER_\${this.channelId}\`).setPlaceholder('🔮 Chọn người để điều tra').addOptions(targets.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
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
                            new StringSelectMenuBuilder().setCustomId(\`ww_act_GUARD_\${this.channelId}\`).setPlaceholder('🛡️ Chọn người để bảo vệ').addOptions(protTargets.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                        ));
                        title = 'Lượt Bảo Vệ / Bác sĩ'; color = '#3498DB';
                    }
                    break;
                case 'WITCH':
                    const btns = [];
                    if (player.resources.healPotion > 0) btns.push(new ButtonBuilder().setCustomId(\`ww_act_WITCH_HEAL_\${this.channelId}\`).setLabel('💊 Dùng Thuốc Cứu').setStyle(ButtonStyle.Success));
                    if (player.resources.poisonPotion > 0) btns.push(new ButtonBuilder().setCustomId(\`ww_act_WITCH_POISON_\${this.channelId}\`).setLabel('☠️ Dùng Thuốc Độc').setStyle(ButtonStyle.Danger));
                    btns.push(new ButtonBuilder().setCustomId(\`ww_act_WITCH_SKIP_\${this.channelId}\`).setLabel('⏭️ Bỏ qua').setStyle(ButtonStyle.Secondary));
                    components.push(new ActionRowBuilder().addComponents(btns));
                    title = 'Lượt Phù Thủy'; color = '#2ECC71'; desc = \`💊 Còn \${player.resources.healPotion} bình cứu\\n☠️ Còn \${player.resources.poisonPotion} bình độc\`;
                    break;
                case 'ARSONIST':
                    const aBtns = [];
                    aBtns.push(new ButtonBuilder().setCustomId(\`ww_act_ARSONIST_DOUSE_\${this.channelId}\`).setLabel('🛢️ Tẩm xăng').setStyle(ButtonStyle.Secondary));
                    aBtns.push(new ButtonBuilder().setCustomId(\`ww_act_ARSONIST_IGNITE_\${this.channelId}\`).setLabel('🔥 Châm lửa!').setStyle(ButtonStyle.Danger));
                    components.push(new ActionRowBuilder().addComponents(aBtns));
                    title = 'Lượt Kẻ Đốt Nhà'; color = '#E67E22'; desc = 'Bạn có thể tẩm xăng một người hoặc châm lửa đốt TẤT CẢ những kẻ đã bị tẩm xăng!';
                    break;
                case 'RESURRECTOR':
                    if (player.resources.revivesLeft > 0 && deadPlayers.length > 0) {
                        components.push(new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder().setCustomId(\`ww_act_RESURRECTOR_\${this.channelId}\`).setPlaceholder('🧟 Chọn người để hồi sinh').addOptions(deadPlayers.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
                        ));
                        title = 'Lượt Kẻ Hồi Sinh'; color = '#27AE60';
                    }
                    break;
                case 'CUPID':
                    if (this.day === 1 && targets.length >= 2) {
                        components.push(new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder().setCustomId(\`ww_act_CUPID_\${this.channelId}\`).setPlaceholder('🏹 Chọn 2 người để ghép đôi!').setMinValues(2).setMaxValues(2).addOptions(alivePlayers.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
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
`;

// Replace startNight entirely
const oldStartNightRegex = /async startNight\(\) \{[\s\S]*?this\.timer = setTimeout\(\(\) => this\.endNight\(\), this\.settings\.nightTime\);\n    \}/;

const newStartNight = `async startNight() {
        this.status = 'NIGHT';
        this.day++;
        this.nightActions = [];
        this.dayVotes.clear();
        for (const player of this.players.values()) player.resetNightModifiers();

        const channel = this.client.channels.cache.get(this.channelId);
        const embed = new EmbedBuilder().setTitle(\`🌙 ĐÊM THỨ \${this.day}\`).setDescription('Màn đêm buông xuống. Mọi người đi ngủ.\\nCác vai trò có kỹ năng hãy vào DM để hành động! (45 giây)').setColor('#2C3E50');
        await channel.send({ embeds: [embed] });

        await this.dispatchNightUIs();

        this.timer = setTimeout(() => this.endNight(), this.settings.nightTime);
    }`;

code = code.replace(oldStartNightRegex, newStartNight + '\n' + UI_CODE);

// Replace handleInteraction Night Action logic
const oldHandleActionRegex = /\/\/ Action Menu Actions[\s\S]*?\/\/ Day Voting/;

const newHandleAction = `// Action Menu Actions
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
                        new StringSelectMenuBuilder().setCustomId(\`ww_act_WITCHPOISON_\${this.channelId}\`).setPlaceholder('☠️ Chọn người đầu độc').addOptions(alivePlayers.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
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
                        new StringSelectMenuBuilder().setCustomId(\`ww_act_ARSONISTDOUSE_\${this.channelId}\`).setPlaceholder('🛢️ Chọn người tẩm xăng').addOptions(alivePlayers.map(t => ({label: t.user.username.substring(0, 25), value: t.id})))
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

        // Day Voting`;

code = code.replace(oldHandleActionRegex, newHandleAction);

fs.writeFileSync(path, code, 'utf8');
console.log('Successfully patched Night UI logic into werewolf_engine.js');
