// Script to append phase 1 logic to werewolf_engine.js
const fs = require('fs');

let code = fs.readFileSync('d:\\Bot moi\\werewolf_engine.js', 'utf8');

const additionalMethods = `
    // --- LOBBY LOGIC ---
    async openLobby() {
        const channel = this.client.channels.cache.get(this.channelId);
        if (!channel) return;
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(\`ww_join_\${this.channelId}\`).setLabel('🎮 Tham Gia').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(\`ww_start_\${this.channelId}\`).setLabel('▶️ Bắt Đầu').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(\`ww_cancel_\${this.channelId}\`).setLabel('❌ Hủy').setStyle(ButtonStyle.Danger)
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
            .setDescription(\`<@\${this.hostId}> đã mở phòng!\n\n> 🎮 Nhấn **Tham Gia** để vào game\n> ▶️ Host nhấn **Bắt Đầu** khi đủ người\n> ⚠️ Cần **tối thiểu 4 người**\`)
            .addFields({
                name: \`👥 Người tham gia (\${players.length})\`,
                value: players.length ? players.map(p => \`<@\${p.id}>\`).join(' ') : '_Chưa có ai..._',
                inline: false
            })
            .setColor('#5865F2');
    }

    async startGame() {
        if (this.players.size < 4) return false;
        if (this.timer) clearTimeout(this.timer);
        this.status = 'STARTING';
        if (this.lobbyMsg) await this.lobbyMsg.edit({ components: [] }).catch(()=>{});

        // Tạm thời gán Role cơ bản cho Phase 1 (Sẽ mở rộng ở Phase 2)
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
            try {
                await player.user.send(\`🎮 **Game Ma Sói bắt đầu!**\n\nVai của bạn: **\${player.role.name}**\nChuẩn bị bước vào đêm đầu tiên!\`);
            } catch(e) {}
        }

        await new Promise(r => setTimeout(r, 3000));
        await this.startNight();
        return true;
    }

    // --- NIGHT LOGIC ---
    async startNight() {
        this.status = 'NIGHT';
        this.day++;
        this.nightActions = [];
        this.dayVotes.clear();
        for (const player of this.players.values()) player.resetNightModifiers();

        const channel = this.client.channels.cache.get(this.channelId);
        
        const embed = new EmbedBuilder()
            .setTitle(\`🌙 ĐÊM THỨ \${this.day}\`)
            .setDescription('Màn đêm buông xuống. Mọi người đi ngủ.\\nCác vai trò có kỹ năng hãy vào DM để hành động! (45 giây)')
            .setColor('#2C3E50');
        await channel.send({ embeds: [embed] });

        // Gửi DM hành động cho những người còn sống
        for (const player of this.players.values()) {
            if (!player.alive) continue;
            // ... Logic gửi Menu chọn mục tiêu sẽ được code chi tiết trong tích hợp Index.js ...
        }

        this.timer = setTimeout(() => this.endNight(), this.settings.nightTime);
    }

    async endNight() {
        const channel = this.client.channels.cache.get(this.channelId);
        const { deaths, reports } = this.resolveNightActions();

        // Gửi báo cáo DM
        for (const [uid, msgs] of reports.entries()) {
            try { const user = await this.client.users.fetch(uid); await user.send(msgs.join('\\n')); } catch(e){}
        }

        let nightReport = \`☀️ **TRỜI SÁNG RỒI! MỌI NGƯỜI DẬY ĐI!** ☀️\\n\\n\`;
        if (deaths.length > 0) {
            nightReport += \`Đêm qua, có **\${deaths.length}** người đã chết:\\n\`;
            deaths.forEach(d => nightReport += \`- <@\${d}> (Vai: **\${this.players.get(d).role.name}**)\\n\`);
        } else {
            nightReport += \`Đêm qua bình yên vô sự! 🌙\\n\`;
        }

        await channel.send({ embeds: [new EmbedBuilder().setDescription(nightReport).setColor('#F1C40F')] });

        if (!this.checkWin(channel)) {
            await this.startDay();
        }
    }

    // --- DAY LOGIC ---
    async startDay() {
        this.status = 'DAY';
        this.dayVotes.clear();
        const channel = this.client.channels.cache.get(this.channelId);

        const alivePlayers = Array.from(this.players.values()).filter(p => p.alive && !p.modifiers.silenced);
        const voteRows = [];
        for (let i = 0; i < alivePlayers.length; i += 4) {
            const chunk = alivePlayers.slice(i, i + 4);
            voteRows.push(new ActionRowBuilder().addComponents(
                ...chunk.map(p => new ButtonBuilder().setCustomId(\`ww_vote_\${this.channelId}_\${p.id}\`).setLabel(p.user.username.substring(0, 20)).setStyle(ButtonStyle.Primary))
            ));
        }
        voteRows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(\`ww_endvote_\${this.channelId}\`).setLabel('✅ Bỏ Phiếu Xong').setStyle(ButtonStyle.Success)
        ));

        this.msgRef = await channel.send({ 
            embeds: [new EmbedBuilder().setTitle(\`☀️ NGÀY THỨ \${this.day} - THẢO LUẬN & VOTE\`).setDescription(\`Thảo luận trong 60 giây và vote người bạn nghi là Sói!\`).setColor('#E67E22')],
            components: voteRows 
        });

        this.timer = setTimeout(() => this.endDay(), this.settings.discussionTime);
    }

    async endDay() {
        const channel = this.client.channels.cache.get(this.channelId);
        if (this.msgRef) await this.msgRef.edit({ components: [] }).catch(()=>{});

        // Tính toán Vote
        const tally = new Map();
        for (const [voterId, targetId] of this.dayVotes.entries()) {
            const voter = this.players.get(voterId);
            const weight = voter ? voter.states.voteWeight : 1;
            tally.set(targetId, (tally.get(targetId) || 0) + weight);
        }

        let dayReport = \`⚖️ **KẾT QUẢ VOTE** ⚖️\\n\`;
        if (tally.size === 0) {
            dayReport += \`Không ai biểu quyết. Không ai bị treo cổ!\\n\`;
            await channel.send({ embeds: [new EmbedBuilder().setDescription(dayReport).setColor('#95A5A6')] });
            if (!this.checkWin(channel)) this.startNight();
            return;
        }

        const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
        if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
            dayReport += \`Hòa phiếu. Không ai bị treo cổ!\\n\`;
            await channel.send({ embeds: [new EmbedBuilder().setDescription(dayReport).setColor('#95A5A6')] });
        } else {
            const victimId = sorted[0][0];
            const victim = this.players.get(victimId);
            victim.alive = false;
            dayReport += \`<@\${victimId}> đã bị treo cổ! Vai trò: **\${victim.role.name}**.\\n\`;
            await channel.send({ embeds: [new EmbedBuilder().setDescription(dayReport).setColor('#E74C3C')] });
        }

        if (!this.checkWin(channel)) this.startNight();
    }

    // --- WIN CONDITION ---
    checkWin(channel) {
        let wolves = 0, good = 0;
        for (const p of this.players.values()) {
            if (p.alive) {
                if (p.role.faction === 'WOLF') wolves++;
                else if (p.role.faction === 'VILLAGE') good++;
            }
        }

        if (wolves === 0) {
            this.endGame(channel, 'VILLAGE');
            return true;
        } else if (wolves >= good) {
            this.endGame(channel, 'WOLF');
            return true;
        }
        return false;
    }

    async endGame(channel, winnerFaction) {
        this.status = 'ENDED';
        if (this.timer) clearTimeout(this.timer);
        
        const title = winnerFaction === 'VILLAGE' ? '🎉 DÂN LÀNG CHIẾN THẮNG!' : '🐺 MA SÓI CHIẾN THẮNG!';
        const color = winnerFaction === 'VILLAGE' ? '#2ECC71' : '#E74C3C';
        
        let reveal = '';
        for (const p of this.players.values()) {
            reveal += \`\${p.alive ? '✅' : '💀'} <@\${p.id}> — **\${p.role.name}**\\n\`;
        }

        await channel.send({ embeds: [new EmbedBuilder().setTitle(title).setDescription(reveal).setColor(color)] });
        // Sẽ gọi hàm xoá game khỏi Map toàn cục sau...
    }
`;

// Chèn các method này vào trước dấu đóng } của class WerewolfGame
const insertIndex = code.lastIndexOf('}');
if (insertIndex !== -1) {
    code = code.substring(0, insertIndex) + additionalMethods + code.substring(insertIndex);
    fs.writeFileSync('d:\\Bot moi\\werewolf_engine.js', code, 'utf8');
    console.log('Successfully appended Phase 1 methods to WerewolfGame class.');
} else {
    console.error('Failed to find the end of WerewolfGame class.');
}
