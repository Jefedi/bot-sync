const { createSuccessEmbed, createErrorEmbed, createEmbed, COLORS } = require('../../utils/embeds');
const { logAction, logAudit } = require('../../utils/logger');
const { parseRoleMention, parseUserMention, parseDuration, formatDuration, withRetry } = require('../../utils/helpers');

module.exports = [
    // !sync add <@source_role> <target_guild_id> <@target_role> [durée] [note]
    {
        name: 'add',
        description: 'Créer une correspondance de rôles',
        usage: '!sync add <@rôle_source> <id_serveur_cible> <@rôle_cible> [durée] [note]',
        execute: async (message, args, context) => {
            const sourceRoleId = parseRoleMention(args[0]);
            const targetGuildId = args[1];
            const targetRoleId = parseRoleMention(args[2]);
            const durationText = args[3];
            const note = args.slice(4).join(' ') || null;

            if (!sourceRoleId || !targetGuildId || !targetRoleId) {
                return message.reply({
                    embeds: [createErrorEmbed(
                        'Usage : `!sync add <@rôle_source> <id_serveur_cible> <@rôle_cible> [durée] [note]`\n' +
                        'Exemple : `!sync add @Admin 123456789 @Moderateur 7j Temporaire`\n\n' +
                        '_Utilisez `!sync servers` pour voir les IDs des serveurs._'
                    )],
                });
            }

            // Vérifier le rôle source
            const sourceRole = message.guild.roles.cache.get(sourceRoleId);
            if (!sourceRole) {
                return message.reply({ embeds: [createErrorEmbed('Rôle source introuvable sur ce serveur.')] });
            }

            // Vérifier le serveur cible
            const targetGuild = context.client.guilds.cache.get(targetGuildId);
            if (!targetGuild) {
                return message.reply({ embeds: [createErrorEmbed('Serveur cible introuvable. Vérifiez que le bot y est présent.')] });
            }

            // Vérifier le rôle cible
            const targetRole = targetGuild.roles.cache.get(targetRoleId);
            if (!targetRole) {
                return message.reply({ embeds: [createErrorEmbed('Rôle cible introuvable sur le serveur cible.')] });
            }

            // Vérifier la hiérarchie des rôles
            const botMember = targetGuild.members.cache.get(context.client.user.id);
            if (botMember && targetRole.position >= botMember.roles.highest.position) {
                return message.reply({
                    embeds: [createErrorEmbed(
                        `Le rôle **${targetRole.name}** est au-dessus du rôle du bot sur **${targetGuild.name}**.\n` +
                        'Déplacez le rôle du bot plus haut dans la hiérarchie.'
                    )],
                });
            }

            // Parser la durée
            let durationMinutes = null;
            if (durationText && durationText !== 'permanent') {
                durationMinutes = parseDuration(durationText);
                if (durationMinutes === null) {
                    return message.reply({
                        embeds: [createErrorEmbed('Format de durée invalide. Exemples : `7j`, `12h`, `30m`, `1j12h`')],
                    });
                }
            }

            // Vérifier la note
            if (note && note.length > 200) {
                return message.reply({ embeds: [createErrorEmbed('La note ne doit pas dépasser 200 caractères.')] });
            }

            // Insérer dans la base de données
            const { error } = await context.db
                .from('role_sync')
                .upsert({
                    source_guild_id: message.guild.id,
                    source_role_id: sourceRoleId,
                    target_guild_id: targetGuildId,
                    target_role_id: targetRoleId,
                    duration_minutes: durationMinutes,
                    note,
                }, { onConflict: 'source_guild_id,source_role_id,target_guild_id,target_role_id' });

            if (error) throw error;

            const durationStr = durationMinutes ? formatDuration(durationMinutes) : 'permanent';

            await message.reply({
                embeds: [createSuccessEmbed(
                    `Sync créée :\n` +
                    `**${sourceRole.name}** → **${targetRole.name}** sur **${targetGuild.name}**\n` +
                    `Durée : ${durationStr}${note ? `\nNote : ${note}` : ''}`
                )],
            });

            await logAction(message.guild, context.db, {
                module: 'sync',
                action: 'Sync créée',
                user: message.author,
                fields: [
                    { name: 'Source', value: sourceRole.name, inline: true },
                    { name: 'Cible', value: `${targetRole.name} (${targetGuild.name})`, inline: true },
                    { name: 'Durée', value: durationStr, inline: true },
                ],
                color: COLORS.success,
            });

            await logAudit(context.db, {
                guildId: message.guild.id,
                module: 'sync',
                action: 'sync_created',
                userId: message.author.id,
                userTag: message.author.tag,
                details: { sourceRoleId, targetGuildId, targetRoleId, durationMinutes, note },
            });
        },
    },

    // !sync remove <@source_role> <target_guild_id> <@target_role>
    {
        name: 'remove',
        description: 'Supprimer une correspondance de rôles',
        usage: '!sync remove <@rôle_source> <id_serveur_cible> <@rôle_cible>',
        execute: async (message, args, context) => {
            const sourceRoleId = parseRoleMention(args[0]);
            const targetGuildId = args[1];
            const targetRoleId = parseRoleMention(args[2]);

            if (!sourceRoleId || !targetGuildId || !targetRoleId) {
                return message.reply({
                    embeds: [createErrorEmbed('Usage : `!sync remove <@rôle_source> <id_serveur_cible> <@rôle_cible>`')],
                });
            }

            const { error, count } = await context.db
                .from('role_sync')
                .delete()
                .eq('source_guild_id', message.guild.id)
                .eq('source_role_id', sourceRoleId)
                .eq('target_guild_id', targetGuildId)
                .eq('target_role_id', targetRoleId);

            if (error) throw error;

            // Supprimer aussi les syncs actifs associés
            await context.db
                .from('role_sync_active')
                .delete()
                .eq('source_guild_id', message.guild.id)
                .eq('source_role_id', sourceRoleId)
                .eq('target_guild_id', targetGuildId)
                .eq('target_role_id', targetRoleId);

            await message.reply({
                embeds: [createSuccessEmbed('Correspondance de rôles supprimée.')],
            });

            await logAudit(context.db, {
                guildId: message.guild.id,
                module: 'sync',
                action: 'sync_deleted',
                userId: message.author.id,
                userTag: message.author.tag,
                details: { sourceRoleId, targetGuildId, targetRoleId },
            });
        },
    },

    // !sync list
    {
        name: 'list',
        description: 'Voir toutes les correspondances de rôles',
        usage: '!sync list',
        execute: async (message, args, context) => {
            const { data: syncs } = await context.db
                .from('role_sync')
                .select('*')
                .eq('source_guild_id', message.guild.id)
                .order('created_at', { ascending: true });

            if (!syncs || syncs.length === 0) {
                return message.reply({
                    embeds: [createEmbed({
                        description: 'Aucune correspondance de rôles configurée.',
                        color: COLORS.info,
                    })],
                });
            }

            let description = '';
            for (const sync of syncs) {
                const sourceRole = message.guild.roles.cache.get(sync.source_role_id);
                const targetGuild = context.client.guilds.cache.get(sync.target_guild_id);
                const targetRole = targetGuild?.roles.cache.get(sync.target_role_id);

                const sourceName = sourceRole?.name || `ID: ${sync.source_role_id}`;
                const targetGuildName = targetGuild?.name || `ID: ${sync.target_guild_id}`;
                const targetName = targetRole?.name || `ID: ${sync.target_role_id}`;
                const duration = sync.duration_minutes ? formatDuration(sync.duration_minutes) : 'permanent';

                description += `**${sourceName}** → **${targetName}** sur _${targetGuildName}_`;
                description += ` (${duration})`;
                if (sync.note) description += ` — ${sync.note}`;
                description += '\n';
            }

            await message.reply({
                embeds: [createEmbed({
                    title: `Correspondances de rôles (${syncs.length})`,
                    description,
                    color: COLORS.info,
                })],
            });
        },
    },

    // !sync servers
    {
        name: 'servers',
        description: 'Lister les serveurs où le bot est présent',
        usage: '!sync servers',
        execute: async (message, args, context) => {
            const guilds = context.client.guilds.cache;
            let description = '';

            for (const [id, guild] of guilds) {
                const memberCount = guild.memberCount;
                const isSource = id === message.guild.id;
                description += `${isSource ? '▸ ' : '  '}\`${id}\` — **${guild.name}** (${memberCount} membres)\n`;
            }

            await message.reply({
                embeds: [createEmbed({
                    title: 'Serveurs disponibles',
                    description: description || 'Aucun serveur.',
                    color: COLORS.info,
                    footer: '▸ = serveur actuel. Copiez l\'ID pour les commandes sync.',
                })],
            });
        },
    },

    // !sync resync <@membre>
    {
        name: 'resync',
        description: 'Resynchroniser les rôles d\'un membre',
        usage: '!sync resync <@membre>',
        execute: async (message, args, context) => {
            const userId = parseUserMention(args[0]);
            if (!userId) {
                return message.reply({ embeds: [createErrorEmbed('Usage : `!sync resync <@membre>`')] });
            }

            const member = message.guild.members.cache.get(userId);
            if (!member) {
                return message.reply({ embeds: [createErrorEmbed('Membre introuvable sur ce serveur.')] });
            }

            // Récupérer toutes les syncs où ce serveur est source
            const { data: syncs } = await context.db
                .from('role_sync')
                .select('*')
                .eq('source_guild_id', message.guild.id);

            if (!syncs || syncs.length === 0) {
                return message.reply({ embeds: [createErrorEmbed('Aucune correspondance configurée.')] });
            }

            let added = 0;
            let removed = 0;
            let errors = 0;

            for (const sync of syncs) {
                const hasSourceRole = member.roles.cache.has(sync.source_role_id);
                const targetGuild = context.client.guilds.cache.get(sync.target_guild_id);
                if (!targetGuild) continue;

                let targetMember;
                try {
                    targetMember = await targetGuild.members.fetch(userId).catch(() => null);
                } catch {
                    continue;
                }
                if (!targetMember) continue;

                const hasTargetRole = targetMember.roles.cache.has(sync.target_role_id);

                try {
                    if (hasSourceRole && !hasTargetRole) {
                        await withRetry(() => targetMember.roles.add(sync.target_role_id));
                        added++;

                        if (sync.duration_minutes) {
                            await context.db.from('role_sync_active').upsert({
                                member_id: userId,
                                source_guild_id: sync.source_guild_id,
                                source_role_id: sync.source_role_id,
                                target_guild_id: sync.target_guild_id,
                                target_role_id: sync.target_role_id,
                                synced_at: Date.now() / 1000,
                                reminder_sent: false,
                            }, { onConflict: 'member_id,source_guild_id,source_role_id,target_guild_id,target_role_id' });
                        }
                    } else if (!hasSourceRole && hasTargetRole) {
                        await withRetry(() => targetMember.roles.remove(sync.target_role_id));
                        removed++;

                        await context.db.from('role_sync_active').delete()
                            .eq('member_id', userId)
                            .eq('source_guild_id', sync.source_guild_id)
                            .eq('source_role_id', sync.source_role_id)
                            .eq('target_guild_id', sync.target_guild_id)
                            .eq('target_role_id', sync.target_role_id);
                    }
                } catch {
                    errors++;
                }
            }

            await message.reply({
                embeds: [createSuccessEmbed(
                    `Resync de <@${userId}> terminée.\n` +
                    `**+${added}** ajout(s), **-${removed}** retrait(s)` +
                    (errors > 0 ? `, **${errors}** erreur(s)` : '')
                )],
            });
        },
    },

    // !sync status <@membre>
    {
        name: 'status',
        description: 'Voir l\'état de sync d\'un membre',
        usage: '!sync status <@membre>',
        execute: async (message, args, context) => {
            const userId = parseUserMention(args[0]);
            if (!userId) {
                return message.reply({ embeds: [createErrorEmbed('Usage : `!sync status <@membre>`')] });
            }

            const { data: actifs } = await context.db
                .from('role_sync_active')
                .select('*')
                .eq('member_id', userId)
                .eq('source_guild_id', message.guild.id);

            // Récupérer aussi les syncs permanentes
            const { data: syncs } = await context.db
                .from('role_sync')
                .select('*')
                .eq('source_guild_id', message.guild.id);

            const member = message.guild.members.cache.get(userId);
            if (!member) {
                return message.reply({ embeds: [createErrorEmbed('Membre introuvable.')] });
            }

            let description = `**Membre :** <@${userId}>\n\n`;

            if (!syncs || syncs.length === 0) {
                description += '_Aucune correspondance configurée._';
            } else {
                for (const sync of syncs) {
                    const hasSource = member.roles.cache.has(sync.source_role_id);
                    const sourceRole = message.guild.roles.cache.get(sync.source_role_id);
                    const targetGuild = context.client.guilds.cache.get(sync.target_guild_id);
                    const targetRole = targetGuild?.roles.cache.get(sync.target_role_id);

                    const status = hasSource ? '✅' : '❌';
                    description += `${status} **${sourceRole?.name || sync.source_role_id}** → **${targetRole?.name || sync.target_role_id}** (${targetGuild?.name || sync.target_guild_id})`;

                    // Vérifier le temps restant
                    if (sync.duration_minutes && hasSource) {
                        const actif = actifs?.find(a =>
                            a.source_role_id === sync.source_role_id &&
                            a.target_guild_id === sync.target_guild_id &&
                            a.target_role_id === sync.target_role_id
                        );

                        if (actif) {
                            const elapsed = (Date.now() / 1000) - actif.synced_at;
                            const remaining = (sync.duration_minutes * 60) - elapsed;
                            if (remaining > 0) {
                                description += ` — ${formatDuration(Math.ceil(remaining / 60))} restant`;
                            } else {
                                description += ' — **expiré**';
                            }
                        }
                    }

                    description += '\n';
                }
            }

            await message.reply({
                embeds: [createEmbed({
                    title: 'État de synchronisation',
                    description,
                    color: COLORS.info,
                })],
            });
        },
    },

    // !sync history [nombre]
    {
        name: 'history',
        description: 'Voir l\'historique des synchronisations',
        usage: '!sync history [nombre]',
        execute: async (message, args, context) => {
            const limit = Math.min(parseInt(args[0]) || 20, 50);

            const { data: entries } = await context.db
                .from('audit_log')
                .select('*')
                .eq('guild_id', message.guild.id)
                .eq('module', 'sync')
                .order('created_at', { ascending: false })
                .limit(limit);

            if (!entries || entries.length === 0) {
                return message.reply({
                    embeds: [createEmbed({ description: 'Aucun historique.', color: COLORS.info })],
                });
            }

            let description = '';
            for (const entry of entries) {
                const date = new Date(entry.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
                const user = entry.user_tag || 'Système';
                description += `\`${date}\` **${entry.action}** — ${user}\n`;
            }

            await message.reply({
                embeds: [createEmbed({
                    title: `Historique (${entries.length} dernières)`,
                    description,
                    color: COLORS.info,
                })],
            });
        },
    },

    // !sync clean
    {
        name: 'clean',
        description: 'Supprimer les correspondances orphelines',
        usage: '!sync clean',
        execute: async (message, args, context) => {
            const { data: syncs } = await context.db
                .from('role_sync')
                .select('*')
                .eq('source_guild_id', message.guild.id);

            if (!syncs || syncs.length === 0) {
                return message.reply({ embeds: [createEmbed({ description: 'Aucune correspondance à vérifier.', color: COLORS.info })] });
            }

            let orphaned = 0;
            for (const sync of syncs) {
                const sourceRole = message.guild.roles.cache.get(sync.source_role_id);
                const targetGuild = context.client.guilds.cache.get(sync.target_guild_id);
                const targetRole = targetGuild?.roles.cache.get(sync.target_role_id);

                if (!sourceRole || !targetGuild || !targetRole) {
                    await context.db.from('role_sync').delete().eq('id', sync.id);
                    orphaned++;
                }
            }

            await message.reply({
                embeds: [createSuccessEmbed(`Nettoyage terminé. **${orphaned}** correspondance(s) orpheline(s) supprimée(s).`)],
            });
        },
    },
];
