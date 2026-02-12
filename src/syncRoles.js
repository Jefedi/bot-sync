const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    AttachmentBuilder,
} = require('discord.js');
const { getPool } = require('./database');
const { parserDuree, formaterDuree } = require('./utils');
const { logAction } = require('./logging');

// ──────────────────────────────────────────────
// Cooldown anti-spam (5 secondes)
// ──────────────────────────────────────────────

const cooldowns = new Map();
const COOLDOWN_SECONDS = 5;
const COOLDOWN_COMMANDS = new Set([
    'ajouter_sync_role', 'supprimer_sync_role', 'copier_sync', 'importer_config',
]);

function checkCooldown(userId, commandName) {
    if (!COOLDOWN_COMMANDS.has(commandName)) return null;
    const key = `${userId}-${commandName}`;
    const now = Date.now();
    const expiry = cooldowns.get(key);
    if (expiry && now < expiry) {
        return ((expiry - now) / 1000).toFixed(1);
    }
    cooldowns.set(key, now + COOLDOWN_SECONDS * 1000);
    return null;
}

// ──────────────────────────────────────────────
// Fonctions d'autocomplete
// ──────────────────────────────────────────────

function autocompleteServeur(interaction) {
    const current = interaction.options.getFocused().toLowerCase();
    const choices = [];
    for (const guild of interaction.client.guilds.cache.values()) {
        if (guild.id === interaction.guildId) continue;
        const nom = `${guild.name} (${guild.id})`;
        if (nom.toLowerCase().includes(current) || guild.id.includes(current)) {
            choices.push({ name: nom.slice(0, 100), value: guild.id });
        }
        if (choices.length >= 25) break;
    }
    return choices;
}

function autocompleteRoleCible(interaction) {
    const guildIdStr = interaction.options.getString('target_guild_id');
    if (!guildIdStr) return [];

    const targetGuild = interaction.client.guilds.cache.get(guildIdStr);
    if (!targetGuild) return [];

    const current = interaction.options.getFocused().toLowerCase();
    const choices = [];
    for (const role of targetGuild.roles.cache.values()) {
        if (role.id === targetGuild.id) continue; // @everyone
        const nom = `${role.name} (${role.id})`;
        if (nom.toLowerCase().includes(current) || role.id.includes(current)) {
            choices.push({ name: nom.slice(0, 100), value: role.id });
        }
        if (choices.length >= 25) break;
    }
    return choices;
}

// ──────────────────────────────────────────────
// Définitions des commandes slash
// ──────────────────────────────────────────────

function getCommands() {
    return [
        new SlashCommandBuilder()
            .setName('aide')
            .setDescription("Affiche l'aide complète du bot de synchronisation de rôles."),

        new SlashCommandBuilder()
            .setName('bot_status')
            .setDescription("Affiche l'état du bot, les stats et les permissions sur chaque serveur.")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
            .setName('ajouter_sync_role')
            .setDescription("Synchronise un rôle du serveur racine avec un rôle d'un autre serveur.")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addRoleOption(opt => opt.setName('source_role').setDescription('Le rôle sur ce serveur (serveur racine)').setRequired(true))
            .addStringOption(opt => opt.setName('target_guild_id').setDescription('Le serveur cible (tapez pour chercher)').setRequired(true).setAutocomplete(true))
            .addStringOption(opt => opt.setName('target_role_id').setDescription('Le rôle sur le serveur cible (tapez pour chercher)').setRequired(true).setAutocomplete(true))
            .addStringOption(opt => opt.setName('duree').setDescription('Durée optionnelle (ex: 30m, 12h, 7j, 1j12h). Sans durée = permanent'))
            .addStringOption(opt => opt.setName('note').setDescription('Note optionnelle (max 200 caractères)')),

        new SlashCommandBuilder()
            .setName('supprimer_sync_role')
            .setDescription('Supprime une synchronisation de rôles.')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addRoleOption(opt => opt.setName('source_role').setDescription('Le rôle sur ce serveur (serveur racine)').setRequired(true))
            .addStringOption(opt => opt.setName('target_guild_id').setDescription('Le serveur cible (tapez pour chercher)').setRequired(true).setAutocomplete(true))
            .addStringOption(opt => opt.setName('target_role_id').setDescription('Le rôle sur le serveur cible (tapez pour chercher)').setRequired(true).setAutocomplete(true)),

        new SlashCommandBuilder()
            .setName('voir_sync_roles')
            .setDescription('Affiche les synchronisations de rôles configurées sur ce serveur.')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
            .setName('resync')
            .setDescription("Force la resynchronisation des rôles d'un membre sur tous les serveurs cibles.")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(opt => opt.setName('membre').setDescription('Le membre dont on veut resynchroniser les rôles').setRequired(true)),

        new SlashCommandBuilder()
            .setName('nettoyer_sync')
            .setDescription("Supprime les synchronisations dont le rôle ou le serveur n'existe plus.")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
            .setName('copier_sync')
            .setDescription("Copie toutes les syncs d'un serveur cible vers un autre serveur.")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(opt => opt.setName('serveur_source').setDescription('Le serveur cible dont on copie les configs (tapez pour chercher)').setRequired(true).setAutocomplete(true))
            .addStringOption(opt => opt.setName('serveur_destination').setDescription('Le serveur cible vers lequel copier (tapez pour chercher)').setRequired(true).setAutocomplete(true)),

        new SlashCommandBuilder()
            .setName('exporter_config')
            .setDescription('Exporte la configuration de synchronisation en JSON.')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
            .setName('importer_config')
            .setDescription('Importe une configuration de synchronisation depuis un fichier JSON.')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addAttachmentOption(opt => opt.setName('fichier').setDescription('Le fichier JSON exporté avec /exporter_config').setRequired(true)),

        new SlashCommandBuilder()
            .setName('historique')
            .setDescription('Affiche les 20 dernières actions de synchronisation.')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
            .setName('sync_status')
            .setDescription("Affiche l'état de synchronisation d'un membre sur tous les serveurs cibles.")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addUserOption(opt => opt.setName('membre').setDescription('Le membre dont on veut voir le statut').setRequired(true)),
    ];
}

// ──────────────────────────────────────────────
// Routeur de commandes
// ──────────────────────────────────────────────

async function handleCommand(interaction) {
    const { commandName } = interaction;

    // Vérifier le cooldown
    const remaining = checkCooldown(interaction.user.id, commandName);
    if (remaining) {
        await interaction.reply({
            content: `Veuillez attendre ${remaining} seconde(s) avant de réutiliser cette commande.`,
            ephemeral: true,
        });
        return;
    }

    try {
        switch (commandName) {
            case 'aide': return await cmdAide(interaction);
            case 'bot_status': return await cmdBotStatus(interaction);
            case 'ajouter_sync_role': return await cmdAjouterSyncRole(interaction);
            case 'supprimer_sync_role': return await cmdSupprimerSyncRole(interaction);
            case 'voir_sync_roles': return await cmdVoirSyncRoles(interaction);
            case 'resync': return await cmdResync(interaction);
            case 'nettoyer_sync': return await cmdNettoyerSync(interaction);
            case 'copier_sync': return await cmdCopierSync(interaction);
            case 'exporter_config': return await cmdExporterConfig(interaction);
            case 'importer_config': return await cmdImporterConfig(interaction);
            case 'historique': return await cmdHistorique(interaction);
            case 'sync_status': return await cmdSyncStatus(interaction);
        }
    } catch (error) {
        console.error(`Erreur commande ${commandName}:`, error);
        const msg = `Une erreur est survenue : ${error.message}`;
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
        } else {
            await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
        }
    }
}

// ──────────────────────────────────────────────
// Routeur d'autocomplete
// ──────────────────────────────────────────────

async function handleAutocomplete(interaction) {
    const { commandName } = interaction;
    const focused = interaction.options.getFocused(true);
    let choices = [];

    if (commandName === 'ajouter_sync_role' || commandName === 'supprimer_sync_role') {
        if (focused.name === 'target_guild_id') {
            choices = autocompleteServeur(interaction);
        } else if (focused.name === 'target_role_id') {
            choices = autocompleteRoleCible(interaction);
        }
    } else if (commandName === 'copier_sync') {
        if (focused.name === 'serveur_source' || focused.name === 'serveur_destination') {
            choices = autocompleteServeur(interaction);
        }
    }

    await interaction.respond(choices).catch(() => {});
}

// ──────────────────────────────────────────────
// /aide — Affiche l'aide du bot
// ──────────────────────────────────────────────

async function cmdAide(interaction) {
    const embed = new EmbedBuilder()
        .setTitle('Bot Sync — Aide')
        .setDescription('Bot de synchronisation de rôles entre serveurs Discord.')
        .setColor(0x5865F2)
        .addFields(
            {
                name: 'Configuration',
                value:
                    '`/ajouter_sync_role` — Créer une correspondance de rôles\n' +
                    '`/supprimer_sync_role` — Supprimer une correspondance\n' +
                    '`/voir_sync_roles` — Voir toutes les correspondances du serveur\n' +
                    '`/copier_sync` — Copier les configs d\'un serveur cible vers un autre',
                inline: false,
            },
            {
                name: 'Gestion',
                value:
                    '`/resync @membre` — Resynchroniser les rôles d\'un membre\n' +
                    '`/sync_status @membre` — Voir l\'état de sync d\'un membre + temps restant\n' +
                    '`/historique` — 20 dernières actions de synchronisation\n' +
                    '`/nettoyer_sync` — Supprimer les syncs orphelines\n' +
                    '`/bot_status` — Dashboard du bot (état, stats, permissions)',
                inline: false,
            },
            {
                name: 'Import / Export',
                value:
                    '`/exporter_config` — Exporter la config en JSON\n' +
                    '`/importer_config` — Importer une config depuis du JSON',
                inline: false,
            },
            {
                name: 'Format des durées',
                value:
                    '`30m` = 30 minutes\n' +
                    '`12h` = 12 heures\n' +
                    '`7j` = 7 jours\n' +
                    '`1j12h` = 1 jour et 12 heures\n' +
                    'Sans durée = permanent (jusqu\'au retrait manuel)\n' +
                    'Maximum : `365j`',
                inline: false,
            },
            {
                name: 'Fonctionnement',
                value:
                    '1. Configurez les correspondances depuis le **serveur racine**\n' +
                    '2. Quand un rôle est **ajouté/retiré** sur le serveur racine, ' +
                    'le rôle correspondant est automatiquement synchronisé sur le serveur cible\n' +
                    '3. Quand un membre **rejoint** un serveur cible, ses rôles sont attribués automatiquement\n' +
                    '4. Au **démarrage** du bot, tous les rôles sont vérifiés et mis à jour\n' +
                    '5. Les rôles avec une **durée** expirent automatiquement (rappel 1h avant)',
                inline: false,
            },
        )
        .setFooter({ text: 'Toutes les commandes de configuration nécessitent la permission Administrateur.' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ──────────────────────────────────────────────
// /bot_status — Dashboard du bot
// ──────────────────────────────────────────────

async function cmdBotStatus(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const db = getPool();

    const [syncRows] = await db.execute(
        'SELECT COUNT(*) AS cnt FROM role_sync WHERE source_guild_id = ?',
        [interaction.guild.id]
    );
    const nbSyncs = syncRows[0].cnt;

    const [actifRows] = await db.execute(
        'SELECT COUNT(*) AS cnt FROM role_sync_actif WHERE source_guild_id = ?',
        [interaction.guild.id]
    );
    const nbActifs = actifRows[0].cnt;

    const [targetRows] = await db.execute(
        'SELECT DISTINCT target_guild_id FROM role_sync WHERE source_guild_id = ?',
        [interaction.guild.id]
    );
    const targetGuildIds = targetRows.map(r => r.target_guild_id);

    const embed = new EmbedBuilder()
        .setTitle('Bot Sync — État')
        .setColor(0x5865F2)
        .addFields(
            { name: 'Serveurs connectés', value: String(interaction.client.guilds.cache.size), inline: true },
            { name: 'Syncs configurées', value: String(nbSyncs), inline: true },
            { name: 'Syncs actives (avec durée)', value: String(nbActifs), inline: true },
        );

    // Vérifier les permissions sur chaque serveur cible
    if (targetGuildIds.length > 0) {
        const lignes = [];
        for (const guildId of targetGuildIds) {
            const guild = interaction.client.guilds.cache.get(guildId);
            if (!guild) {
                lignes.push(`**Inconnu** (\`${guildId}\`) — Serveur inaccessible`);
                continue;
            }
            const me = guild.members.me;
            const peutGerer = me.permissions.has(PermissionFlagsBits.ManageRoles);
            const posBot = me.roles.highest.position;
            const statut = peutGerer ? 'OK' : 'Pas la permission `Gérer les rôles`';
            lignes.push(`**${guild.name}** — ${statut} (position du bot : ${posBot})`);
        }
        embed.addFields({ name: 'Serveurs cibles', value: lignes.join('\n') || 'Aucun', inline: false });
    }

    // Vérifier les syncs orphelines
    const [allRows] = await db.execute(
        'SELECT source_role_id, target_guild_id, target_role_id FROM role_sync WHERE source_guild_id = ?',
        [interaction.guild.id]
    );

    let orphelins = 0;
    for (const row of allRows) {
        const sourceRole = interaction.guild.roles.cache.get(row.source_role_id);
        const targetGuild = interaction.client.guilds.cache.get(row.target_guild_id);
        const targetRole = targetGuild ? targetGuild.roles.cache.get(row.target_role_id) : null;
        if (!sourceRole || !targetGuild || !targetRole) orphelins++;
    }

    if (orphelins > 0) {
        embed.addFields({
            name: 'Syncs orphelines',
            value: `**${orphelins}** sync(s) avec un rôle/serveur supprimé. Utilisez \`/nettoyer_sync\`.`,
            inline: false,
        });
    }

    await interaction.followUp({ embeds: [embed] });
}

// ──────────────────────────────────────────────
// /ajouter_sync_role — Avec autocomplete + vérification hiérarchie + cooldown
// ──────────────────────────────────────────────

async function cmdAjouterSyncRole(interaction) {
    const sourceRole = interaction.options.getRole('source_role');
    const targetGuildIdStr = interaction.options.getString('target_guild_id');
    const targetRoleIdStr = interaction.options.getString('target_role_id');
    const dureeStr = interaction.options.getString('duree');
    const note = interaction.options.getString('note');

    // Valider les IDs
    if (!/^\d+$/.test(targetGuildIdStr) || !/^\d+$/.test(targetRoleIdStr)) {
        return interaction.reply({
            content: 'Les IDs doivent être des nombres valides.\nAstuce : clic droit sur le serveur/rôle → **Copier l\'identifiant**',
            ephemeral: true,
        });
    }

    // Valider la durée
    let dureeMinutes = null;
    if (dureeStr) {
        dureeMinutes = parserDuree(dureeStr);
        if (dureeMinutes === null) {
            return interaction.reply({
                content: 'Format de durée invalide. Utilisez : `30m`, `12h`, `7j`, `1j12h`\nMaximum : `365j`',
                ephemeral: true,
            });
        }
    }

    // Valider la note
    if (note && note.length > 200) {
        return interaction.reply({ content: 'La note ne doit pas dépasser 200 caractères.', ephemeral: true });
    }

    // Vérifier le serveur cible
    const targetGuild = interaction.client.guilds.cache.get(targetGuildIdStr);
    if (!targetGuild) {
        return interaction.reply({
            content: `Le bot n'est pas présent sur le serveur avec l'ID \`${targetGuildIdStr}\`.`,
            ephemeral: true,
        });
    }

    // Vérifier le rôle cible
    const targetRole = targetGuild.roles.cache.get(targetRoleIdStr);
    if (!targetRole) {
        return interaction.reply({
            content: `Le rôle avec l'ID \`${targetRoleIdStr}\` n'existe pas sur **${targetGuild.name}**.`,
            ephemeral: true,
        });
    }

    // Vérifier les permissions du bot
    const botMember = targetGuild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({
            content: `Le bot n'a pas la permission **Gérer les rôles** sur **${targetGuild.name}**.`,
            ephemeral: true,
        });
    }

    // Vérifier la hiérarchie
    if (targetRole.position >= botMember.roles.highest.position) {
        return interaction.reply({
            content: `Le rôle **${targetRole.name}** est au-dessus du rôle du bot sur **${targetGuild.name}**.\nDéplacez le rôle du bot plus haut dans la hiérarchie.`,
            ephemeral: true,
        });
    }

    // Insérer en base
    const db = getPool();
    try {
        await db.execute(
            `INSERT INTO role_sync (source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [interaction.guild.id, sourceRole.id, targetGuildIdStr, targetRoleIdStr, dureeMinutes, note || null]
        );
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return interaction.reply({ content: 'Cette synchronisation existe déjà.', ephemeral: true });
        }
        throw error;
    }

    let msg =
        `Synchronisation créée :\n` +
        `**${sourceRole.name}** (ce serveur) → **${targetRole.name}** (serveur **${targetGuild.name}**)`;
    if (dureeMinutes) {
        msg += `\nDurée : **${formaterDuree(dureeMinutes)}**`;
    } else {
        msg += '\nDurée : **Permanent** (jusqu\'au retrait manuel)';
    }
    if (note) msg += `\nNote : ${note}`;

    await interaction.reply({ content: msg, ephemeral: true });
    await logAction(interaction.guild, 'Ajout de synchronisation', interaction.user, sourceRole, targetRole, targetGuildIdStr);
}

// ──────────────────────────────────────────────
// /supprimer_sync_role — Avec autocomplete + cooldown
// ──────────────────────────────────────────────

async function cmdSupprimerSyncRole(interaction) {
    const sourceRole = interaction.options.getRole('source_role');
    const targetGuildIdStr = interaction.options.getString('target_guild_id');
    const targetRoleIdStr = interaction.options.getString('target_role_id');

    if (!/^\d+$/.test(targetGuildIdStr) || !/^\d+$/.test(targetRoleIdStr)) {
        return interaction.reply({
            content: 'Les IDs doivent être des nombres valides.\nAstuce : clic droit sur le serveur/rôle → **Copier l\'identifiant**',
            ephemeral: true,
        });
    }

    const db = getPool();

    const [result] = await db.execute(
        `DELETE FROM role_sync
         WHERE source_guild_id = ? AND source_role_id = ? AND target_guild_id = ? AND target_role_id = ?`,
        [interaction.guild.id, sourceRole.id, targetGuildIdStr, targetRoleIdStr]
    );

    await db.execute(
        `DELETE FROM role_sync_actif
         WHERE source_guild_id = ? AND source_role_id = ? AND target_guild_id = ? AND target_role_id = ?`,
        [interaction.guild.id, sourceRole.id, targetGuildIdStr, targetRoleIdStr]
    );

    if (result.affectedRows === 0) {
        return interaction.reply({ content: 'Aucune synchronisation correspondante trouvée.', ephemeral: true });
    }

    const targetGuild = interaction.client.guilds.cache.get(targetGuildIdStr);
    const targetGuildName = targetGuild ? targetGuild.name : `ID ${targetGuildIdStr}`;
    const targetRole = targetGuild ? targetGuild.roles.cache.get(targetRoleIdStr) : null;
    const targetRoleName = targetRole ? targetRole.name : `ID ${targetRoleIdStr}`;

    await interaction.reply({
        content: `Synchronisation supprimée :\n**${sourceRole.name}** ↛ **${targetRoleName}** (serveur **${targetGuildName}**)`,
        ephemeral: true,
    });
    await logAction(interaction.guild, 'Suppression de synchronisation', interaction.user, sourceRole, targetRole, targetGuildIdStr);
}

// ──────────────────────────────────────────────
// /voir_sync_roles — Filtrée par serveur actuel
// ──────────────────────────────────────────────

async function cmdVoirSyncRoles(interaction) {
    const db = getPool();
    const [rows] = await db.execute(
        `SELECT source_role_id, target_guild_id, target_role_id, duree_minutes, note
         FROM role_sync WHERE source_guild_id = ?`,
        [interaction.guild.id]
    );

    if (rows.length === 0) {
        return interaction.reply({ content: 'Aucune synchronisation configurée sur ce serveur.', ephemeral: false });
    }

    const embed = new EmbedBuilder()
        .setTitle('Synchronisations de rôles')
        .setDescription(`${rows.length} correspondance(s) sur **${interaction.guild.name}**`)
        .setColor(0x3498DB);

    for (let i = 0; i < rows.length; i++) {
        const { source_role_id, target_guild_id, target_role_id, duree_minutes, note } = rows[i];

        const sourceRole = interaction.guild.roles.cache.get(source_role_id);
        const sourceRoleName = sourceRole ? sourceRole.name : `Supprimé (${source_role_id})`;

        const targetGuild = interaction.client.guilds.cache.get(target_guild_id);
        const targetGuildName = targetGuild ? targetGuild.name : `Inconnu (${target_guild_id})`;
        const targetRole = targetGuild ? targetGuild.roles.cache.get(target_role_id) : null;
        const targetRoleName = targetRole ? targetRole.name : `Supprimé (${target_role_id})`;

        let valeur = `**${sourceRoleName}**\n→ **${targetRoleName}** (${targetGuildName})`;
        if (duree_minutes) {
            valeur += `\nDurée : ${formaterDuree(duree_minutes)}`;
        } else {
            valeur += '\nDurée : Permanent';
        }
        if (note) valeur += `\nNote : _${note}_`;

        embed.addFields({ name: `#${i + 1}`, value: valeur, inline: false });
    }

    await interaction.reply({ embeds: [embed] });
}

// ──────────────────────────────────────────────
// /resync — Avec embed détaillé par serveur
// ──────────────────────────────────────────────

async function cmdResync(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const membre = interaction.options.getMember('membre');
    if (!membre) {
        return interaction.followUp({ content: 'Membre introuvable sur ce serveur.' });
    }

    const db = getPool();
    const [mappings] = await db.execute(
        `SELECT source_role_id, target_guild_id, target_role_id, duree_minutes, note
         FROM role_sync WHERE source_guild_id = ?`,
        [interaction.guild.id]
    );

    if (mappings.length === 0) {
        return interaction.followUp({ content: 'Aucune synchronisation configurée sur ce serveur.' });
    }

    // Regrouper les résultats par serveur cible
    const resultatsParServeur = {};

    for (const mapping of mappings) {
        const { source_role_id, target_guild_id, target_role_id } = mapping;

        const sourceRole = interaction.guild.roles.cache.get(source_role_id);
        if (!sourceRole) continue;

        const targetGuild = interaction.client.guilds.cache.get(target_guild_id);
        if (!targetGuild) {
            const nomServeur = `Inconnu (${target_guild_id})`;
            if (!resultatsParServeur[nomServeur]) resultatsParServeur[nomServeur] = { ajouts: [], retraits: [], erreurs: [] };
            resultatsParServeur[nomServeur].erreurs.push(`${sourceRole.name} → Serveur inaccessible`);
            continue;
        }

        const nomServeur = targetGuild.name;
        if (!resultatsParServeur[nomServeur]) resultatsParServeur[nomServeur] = { ajouts: [], retraits: [], erreurs: [] };

        const targetRole = targetGuild.roles.cache.get(target_role_id);
        if (!targetRole) {
            resultatsParServeur[nomServeur].erreurs.push(`${sourceRole.name} → Rôle supprimé`);
            continue;
        }

        const targetMembre = targetGuild.members.cache.get(membre.id)
            || await targetGuild.members.fetch(membre.id).catch(() => null);
        if (!targetMembre) {
            resultatsParServeur[nomServeur].erreurs.push(`${sourceRole.name} → Membre absent du serveur`);
            continue;
        }

        const aLeRoleSource = membre.roles.cache.has(sourceRole.id);
        const aLeRoleCible = targetMembre.roles.cache.has(targetRole.id);

        try {
            if (aLeRoleSource && !aLeRoleCible) {
                await targetMembre.roles.add(targetRole, `Resync manuelle par ${interaction.user.tag}`);
                resultatsParServeur[nomServeur].ajouts.push(`${sourceRole.name} → ${targetRole.name}`);
            } else if (!aLeRoleSource && aLeRoleCible) {
                await targetMembre.roles.remove(targetRole, `Resync manuelle par ${interaction.user.tag}`);
                resultatsParServeur[nomServeur].retraits.push(`${sourceRole.name} → ${targetRole.name}`);
            }
        } catch (error) {
            if (error.code === 50013) {
                resultatsParServeur[nomServeur].erreurs.push(`${sourceRole.name} → Permissions insuffisantes`);
            } else {
                resultatsParServeur[nomServeur].erreurs.push(`${sourceRole.name} → Erreur HTTP (${error.status || 'inconnue'})`);
            }
        }
    }

    // Construire l'embed détaillé
    const embed = new EmbedBuilder()
        .setTitle(`Resync de ${membre.displayName}`)
        .setColor(0x3498DB);

    const serveurs = Object.keys(resultatsParServeur);
    for (const serveur of serveurs) {
        const res = resultatsParServeur[serveur];
        const lignes = [];
        for (const a of res.ajouts) lignes.push(`+ ${a}`);
        for (const r of res.retraits) lignes.push(`- ${r}`);
        for (const e of res.erreurs) lignes.push(`! ${e}`);
        if (lignes.length > 0) {
            embed.addFields({ name: serveur, value: lignes.join('\n').slice(0, 1024), inline: false });
        }
    }

    if (serveurs.length === 0) {
        embed.setDescription('Aucune action nécessaire — tous les rôles sont déjà synchronisés.');
    }

    const totalAjouts = serveurs.reduce((sum, s) => sum + resultatsParServeur[s].ajouts.length, 0);
    const totalRetraits = serveurs.reduce((sum, s) => sum + resultatsParServeur[s].retraits.length, 0);
    const totalErreurs = serveurs.reduce((sum, s) => sum + resultatsParServeur[s].erreurs.length, 0);
    embed.setFooter({ text: `${totalAjouts} ajout(s), ${totalRetraits} retrait(s), ${totalErreurs} erreur(s)` });

    await interaction.followUp({ embeds: [embed] });
    await logAction(interaction.guild, 'Resync manuelle', interaction.user);
}

// ──────────────────────────────────────────────
// /nettoyer_sync — Nettoyage orphelins
// ──────────────────────────────────────────────

async function cmdNettoyerSync(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const db = getPool();

    const [rows] = await db.execute(
        `SELECT id, source_role_id, target_guild_id, target_role_id
         FROM role_sync WHERE source_guild_id = ?`,
        [interaction.guild.id]
    );

    const orphelins = [];
    for (const row of rows) {
        const sourceRole = interaction.guild.roles.cache.get(row.source_role_id);
        const targetGuild = interaction.client.guilds.cache.get(row.target_guild_id);
        const targetRole = targetGuild ? targetGuild.roles.cache.get(row.target_role_id) : null;
        if (!sourceRole || !targetGuild || !targetRole) {
            orphelins.push(row.id);
        }
    }

    if (orphelins.length === 0) {
        return interaction.followUp({ content: 'Aucune synchronisation orpheline trouvée. Tout est propre.' });
    }

    // Supprimer par IDs
    const placeholders = orphelins.map(() => '?').join(',');
    await db.execute(`DELETE FROM role_sync WHERE id IN (${placeholders})`, orphelins);

    await interaction.followUp({
        content: `**${orphelins.length}** synchronisation(s) orpheline(s) supprimée(s) (rôle ou serveur supprimé).`,
    });
    await logAction(interaction.guild, 'Nettoyage des synchronisations orphelines', interaction.user);
}

// ──────────────────────────────────────────────
// /copier_sync — Copier les syncs vers un autre serveur
// ──────────────────────────────────────────────

async function cmdCopierSync(interaction) {
    const serveurSourceStr = interaction.options.getString('serveur_source');
    const serveurDestStr = interaction.options.getString('serveur_destination');

    if (!/^\d+$/.test(serveurSourceStr) || !/^\d+$/.test(serveurDestStr)) {
        return interaction.reply({ content: 'Les IDs doivent être des nombres valides.', ephemeral: true });
    }

    if (serveurSourceStr === serveurDestStr) {
        return interaction.reply({ content: 'Le serveur source et destination doivent être différents.', ephemeral: true });
    }

    const destGuild = interaction.client.guilds.cache.get(serveurDestStr);
    if (!destGuild) {
        return interaction.reply({
            content: `Le bot n'est pas présent sur le serveur destination \`${serveurDestStr}\`.`,
            ephemeral: true,
        });
    }

    await interaction.deferReply({ ephemeral: true });
    const db = getPool();

    const [syncs] = await db.execute(
        `SELECT source_role_id, target_role_id, duree_minutes, note
         FROM role_sync WHERE source_guild_id = ? AND target_guild_id = ?`,
        [interaction.guild.id, serveurSourceStr]
    );

    if (syncs.length === 0) {
        return interaction.followUp({ content: 'Aucune synchronisation trouvée pour ce serveur source.' });
    }

    let copies = 0;
    let existantes = 0;

    for (const sync of syncs) {
        try {
            await db.execute(
                `INSERT INTO role_sync (source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [interaction.guild.id, sync.source_role_id, serveurDestStr, '0', sync.duree_minutes, sync.note]
            );
            copies++;
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                existantes++;
            } else {
                throw error;
            }
        }
    }

    const sourceGuild = interaction.client.guilds.cache.get(serveurSourceStr);
    const sourceName = sourceGuild ? sourceGuild.name : `ID ${serveurSourceStr}`;

    let msg =
        `Copie depuis **${sourceName}** vers **${destGuild.name}** :\n` +
        `**${copies}** sync(s) copiée(s)`;
    if (existantes > 0) msg += `, **${existantes}** déjà existante(s)`;
    msg +=
        '\n\n**Attention :** les rôles cibles sont à `0` (non configurés). ' +
        'Utilisez `/supprimer_sync_role` puis `/ajouter_sync_role` pour les mettre à jour ' +
        'avec les bons rôles du serveur destination.';

    await interaction.followUp({ content: msg });
    await logAction(interaction.guild, 'Copie de synchronisations', interaction.user);
}

// ──────────────────────────────────────────────
// /exporter_config — Export JSON
// ──────────────────────────────────────────────

async function cmdExporterConfig(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const db = getPool();

    const [rows] = await db.execute(
        `SELECT source_role_id, target_guild_id, target_role_id, duree_minutes, note
         FROM role_sync WHERE source_guild_id = ?`,
        [interaction.guild.id]
    );

    if (rows.length === 0) {
        return interaction.followUp({ content: 'Aucune synchronisation à exporter.' });
    }

    const config = {
        source_guild_id: interaction.guild.id,
        source_guild_name: interaction.guild.name,
        syncs: rows.map(row => {
            const sourceRole = interaction.guild.roles.cache.get(row.source_role_id);
            const targetGuild = interaction.client.guilds.cache.get(row.target_guild_id);
            const targetRole = targetGuild ? targetGuild.roles.cache.get(row.target_role_id) : null;

            return {
                source_role_id: row.source_role_id,
                source_role_name: sourceRole ? sourceRole.name : null,
                target_guild_id: row.target_guild_id,
                target_guild_name: targetGuild ? targetGuild.name : null,
                target_role_id: row.target_role_id,
                target_role_name: targetRole ? targetRole.name : null,
                duree_minutes: row.duree_minutes,
                note: row.note,
            };
        }),
    };

    const jsonStr = JSON.stringify(config, null, 2);
    const buffer = Buffer.from(jsonStr, 'utf-8');
    const attachment = new AttachmentBuilder(buffer, { name: `sync_config_${interaction.guild.id}.json` });

    await interaction.followUp({
        content: `Configuration exportée : **${rows.length}** sync(s).`,
        files: [attachment],
    });
}

// ──────────────────────────────────────────────
// /importer_config — Import JSON
// ──────────────────────────────────────────────

async function cmdImporterConfig(interaction) {
    const fichier = interaction.options.getAttachment('fichier');

    if (!fichier.name.endsWith('.json')) {
        return interaction.reply({ content: 'Le fichier doit être un fichier `.json`.', ephemeral: true });
    }
    if (fichier.size > 100_000) {
        return interaction.reply({ content: 'Le fichier est trop volumineux (max 100 Ko).', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    let config;
    try {
        const response = await fetch(fichier.url);
        const text = await response.text();
        config = JSON.parse(text);
    } catch {
        return interaction.followUp({ content: 'Le fichier JSON est invalide.' });
    }

    const syncs = config.syncs || [];
    if (syncs.length === 0) {
        return interaction.followUp({ content: 'Aucune synchronisation trouvée dans le fichier.' });
    }

    const db = getPool();
    let importees = 0;
    let existantes = 0;

    for (const sync of syncs) {
        if (!sync.source_role_id || !sync.target_guild_id || !sync.target_role_id) {
            existantes++;
            continue;
        }
        try {
            await db.execute(
                `INSERT INTO role_sync (source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [interaction.guild.id, sync.source_role_id, sync.target_guild_id, sync.target_role_id, sync.duree_minutes || null, sync.note || null]
            );
            importees++;
        } catch {
            existantes++;
        }
    }

    let msg = `Import terminé : **${importees}** sync(s) importée(s)`;
    if (existantes > 0) msg += `, **${existantes}** ignorée(s) (déjà existantes ou invalides)`;

    await interaction.followUp({ content: msg });
    await logAction(interaction.guild, 'Import de configuration', interaction.user);
}

// ──────────────────────────────────────────────
// /historique — 20 dernières actions de sync
// ──────────────────────────────────────────────

async function cmdHistorique(interaction) {
    const db = getPool();
    const [rows] = await db.execute(
        `SELECT action, member_id, member_tag, source_role_name, target_guild_name, target_role_name, created_at
         FROM sync_history WHERE source_guild_id = ?
         ORDER BY created_at DESC LIMIT 20`,
        [interaction.guild.id]
    );

    if (rows.length === 0) {
        return interaction.reply({ content: 'Aucun historique de synchronisation.', ephemeral: true });
    }

    const lignes = rows.map(row => {
        const ts = Math.floor(new Date(row.created_at).getTime() / 1000);
        return `<t:${ts}:R> **${row.action}**\n> ${row.member_tag || row.member_id} — ${row.source_role_name || '?'} → ${row.target_role_name || '?'} (${row.target_guild_name || '?'})`;
    });

    const embed = new EmbedBuilder()
        .setTitle('Historique des synchronisations')
        .setDescription(lignes.join('\n\n').slice(0, 4096))
        .setColor(0x3498DB)
        .setFooter({ text: `${rows.length} dernière(s) action(s)` });

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ──────────────────────────────────────────────
// /sync_status @membre — État de sync détaillé
// ──────────────────────────────────────────────

async function cmdSyncStatus(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const membre = interaction.options.getMember('membre');
    if (!membre) {
        return interaction.followUp({ content: 'Membre introuvable sur ce serveur.' });
    }

    const db = getPool();

    // Récupérer tous les mappings pour ce serveur
    const [mappings] = await db.execute(
        `SELECT source_role_id, target_guild_id, target_role_id, duree_minutes, note
         FROM role_sync WHERE source_guild_id = ?`,
        [interaction.guild.id]
    );

    if (mappings.length === 0) {
        return interaction.followUp({ content: 'Aucune synchronisation configurée sur ce serveur.' });
    }

    // Récupérer les syncs actives de ce membre
    const [actifs] = await db.execute(
        `SELECT source_role_id, target_guild_id, target_role_id, synced_at
         FROM role_sync_actif WHERE member_id = ? AND source_guild_id = ?`,
        [membre.id, interaction.guild.id]
    );

    const actifsMap = new Map();
    for (const a of actifs) {
        actifsMap.set(`${a.source_role_id}-${a.target_guild_id}-${a.target_role_id}`, a.synced_at);
    }

    const maintenant = Date.now() / 1000;
    const lignes = [];

    for (const mapping of mappings) {
        const sourceRole = interaction.guild.roles.cache.get(mapping.source_role_id);
        const sourceRoleName = sourceRole ? sourceRole.name : `Supprimé (${mapping.source_role_id})`;
        const aLeRoleSource = sourceRole ? membre.roles.cache.has(sourceRole.id) : false;

        const targetGuild = interaction.client.guilds.cache.get(mapping.target_guild_id);
        const targetGuildName = targetGuild ? targetGuild.name : 'Inconnu';
        const targetRole = targetGuild ? targetGuild.roles.cache.get(mapping.target_role_id) : null;
        const targetRoleName = targetRole ? targetRole.name : 'Supprimé';

        const targetMembre = targetGuild
            ? (targetGuild.members.cache.get(membre.id) || await targetGuild.members.fetch(membre.id).catch(() => null))
            : null;
        const aLeRoleCible = targetMembre && targetRole ? targetMembre.roles.cache.has(targetRole.id) : false;

        let statut;
        if (aLeRoleSource && aLeRoleCible) {
            statut = 'Synchronisé';
        } else if (aLeRoleSource && !aLeRoleCible) {
            statut = 'Désynchronisé (source oui, cible non)';
        } else if (!aLeRoleSource && aLeRoleCible) {
            statut = 'Désynchronisé (source non, cible oui)';
        } else {
            statut = 'Inactif';
        }

        let ligne = `**${sourceRoleName}** → **${targetRoleName}** (${targetGuildName})\n> Source: ${aLeRoleSource ? 'Oui' : 'Non'} | Cible: ${aLeRoleCible ? 'Oui' : 'Non'} — ${statut}`;

        // Temps restant si durée configurée et rôle actif
        if (mapping.duree_minutes && aLeRoleCible) {
            const key = `${mapping.source_role_id}-${mapping.target_guild_id}-${mapping.target_role_id}`;
            const syncedAt = actifsMap.get(key);
            if (syncedAt) {
                const expireAt = syncedAt + (mapping.duree_minutes * 60);
                const resteSeconds = expireAt - maintenant;
                if (resteSeconds > 0) {
                    const resteMinutes = Math.ceil(resteSeconds / 60);
                    ligne += `\n> Expire dans **${formaterDuree(resteMinutes)}**`;
                } else {
                    ligne += '\n> **Expiré** (retrait imminent)';
                }
            }
        } else if (mapping.duree_minutes) {
            ligne += `\n> Durée configurée : ${formaterDuree(mapping.duree_minutes)}`;
        }

        lignes.push(ligne);
    }

    const embed = new EmbedBuilder()
        .setTitle(`Statut sync — ${membre.displayName}`)
        .setDescription(lignes.join('\n\n').slice(0, 4096))
        .setColor(0x3498DB)
        .setThumbnail(membre.displayAvatarURL())
        .setFooter({ text: `${mappings.length} correspondance(s) vérifiée(s)` });

    await interaction.followUp({ embeds: [embed] });
}

module.exports = { getCommands, handleCommand, handleAutocomplete };
