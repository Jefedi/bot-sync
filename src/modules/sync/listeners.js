const { getDb } = require('../../core/database');
const { withRetry, sleep } = require('../../utils/helpers');
const { logAction, logAudit, getLogChannel } = require('../../utils/logger');
const { createEmbed, COLORS } = require('../../utils/embeds');
const { formatDuration } = require('../../utils/helpers');

const RESYNC_DELAY = 500; // ms entre chaque appel API

/**
 * Détecte les ajouts/retraits de rôles en temps réel.
 */
async function onMemberUpdate(client, oldMember, newMember) {
    const db = getDb();
    const sourceGuildId = newMember.guild.id;

    // Rôles ajoutés
    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    for (const [roleId, role] of addedRoles) {
        const { data: syncs } = await db
            .from('role_sync')
            .select('*')
            .eq('source_guild_id', sourceGuildId)
            .eq('source_role_id', roleId);

        if (!syncs) continue;

        for (const sync of syncs) {
            await addSyncedRole(client, db, {
                memberId: newMember.id,
                memberTag: newMember.user.tag,
                sourceGuildId,
                sourceRoleName: role.name,
                targetGuildId: sync.target_guild_id,
                targetRoleId: sync.target_role_id,
                durationMinutes: sync.duration_minutes,
                note: sync.note,
            });
        }
    }

    // Rôles retirés
    const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    for (const [roleId, role] of removedRoles) {
        const { data: syncs } = await db
            .from('role_sync')
            .select('*')
            .eq('source_guild_id', sourceGuildId)
            .eq('source_role_id', roleId);

        if (!syncs) continue;

        for (const sync of syncs) {
            await removeSyncedRole(client, db, {
                memberId: newMember.id,
                memberTag: newMember.user.tag,
                sourceGuildId,
                sourceRoleName: role.name,
                targetGuildId: sync.target_guild_id,
                targetRoleId: sync.target_role_id,
            });
        }
    }
}

/**
 * Quand un membre rejoint un serveur cible, attribue les rôles synchronisés.
 */
async function onMemberJoin(client, member) {
    const db = getDb();
    const targetGuildId = member.guild.id;

    // Chercher les syncs où ce serveur est cible
    const { data: syncs } = await db
        .from('role_sync')
        .select('*')
        .eq('target_guild_id', targetGuildId);

    if (!syncs) return;

    for (const sync of syncs) {
        const sourceGuild = client.guilds.cache.get(sync.source_guild_id);
        if (!sourceGuild) continue;

        let sourceMember;
        try {
            sourceMember = await sourceGuild.members.fetch(member.id).catch(() => null);
        } catch {
            continue;
        }
        if (!sourceMember) continue;

        if (sourceMember.roles.cache.has(sync.source_role_id)) {
            const sourceRole = sourceGuild.roles.cache.get(sync.source_role_id);

            await addSyncedRole(client, db, {
                memberId: member.id,
                memberTag: member.user.tag,
                sourceGuildId: sync.source_guild_id,
                sourceRoleName: sourceRole?.name || sync.source_role_id,
                targetGuildId,
                targetRoleId: sync.target_role_id,
                durationMinutes: sync.duration_minutes,
                note: sync.note,
                action: 'Ajout (arrivée)',
            });

            await sleep(RESYNC_DELAY);
        }
    }
}

/**
 * Resync complète au démarrage du bot.
 */
async function resyncOnReady(client, db) {
    console.log('[Sync] Resynchronisation au démarrage...');

    const { data: syncs } = await db.from('role_sync').select('*');
    if (!syncs || syncs.length === 0) {
        console.log('[Sync] Aucune correspondance à resynchroniser.');
        return;
    }

    let added = 0;
    let removed = 0;

    for (const sync of syncs) {
        const sourceGuild = client.guilds.cache.get(sync.source_guild_id);
        const targetGuild = client.guilds.cache.get(sync.target_guild_id);
        if (!sourceGuild || !targetGuild) continue;

        let sourceMembers;
        try {
            sourceMembers = await sourceGuild.members.fetch();
        } catch {
            continue;
        }

        for (const [memberId, sourceMember] of sourceMembers) {
            const hasSourceRole = sourceMember.roles.cache.has(sync.source_role_id);

            let targetMember;
            try {
                targetMember = await targetGuild.members.fetch(memberId).catch(() => null);
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
                        await db.from('role_sync_active').upsert({
                            member_id: memberId,
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

                    await db.from('role_sync_active').delete()
                        .eq('member_id', memberId)
                        .eq('source_guild_id', sync.source_guild_id)
                        .eq('source_role_id', sync.source_role_id)
                        .eq('target_guild_id', sync.target_guild_id)
                        .eq('target_role_id', sync.target_role_id);
                }
            } catch {
                // Ignorer les erreurs de permission
            }

            await sleep(RESYNC_DELAY);
        }
    }

    console.log(`[Sync] Resync terminée : +${added} ajout(s), -${removed} retrait(s).`);
}

/**
 * Vérifie les expirations et envoie les rappels toutes les minutes.
 */
function startExpirationChecker(client, db) {
    console.log('[Sync] Vérificateur d\'expirations démarré.');

    setInterval(async () => {
        try {
            // Récupérer toutes les syncs actives avec durée
            const { data: actives } = await db.from('role_sync_active').select('*');
            if (!actives || actives.length === 0) return;

            const now = Date.now() / 1000;

            for (const active of actives) {
                // Récupérer la config de sync pour avoir la durée
                const { data: syncConfig } = await db
                    .from('role_sync')
                    .select('duration_minutes, note')
                    .eq('source_guild_id', active.source_guild_id)
                    .eq('source_role_id', active.source_role_id)
                    .eq('target_guild_id', active.target_guild_id)
                    .eq('target_role_id', active.target_role_id)
                    .single();

                if (!syncConfig || !syncConfig.duration_minutes) continue;

                const expiresAt = active.synced_at + (syncConfig.duration_minutes * 60);
                const timeLeft = expiresAt - now;

                // Rappel 1h avant (une seule fois)
                if (timeLeft <= 3600 && timeLeft > 0 && !active.reminder_sent) {
                    await sendReminder(client, db, active, syncConfig, timeLeft);
                    await db.from('role_sync_active')
                        .update({ reminder_sent: true })
                        .eq('id', active.id);
                }

                // Expiré → retirer le rôle
                if (timeLeft <= 0) {
                    await handleExpiration(client, db, active, syncConfig);
                }
            }
        } catch (err) {
            console.error('[Sync] Erreur dans le vérificateur d\'expirations:', err.message);
        }
    }, 60 * 1000); // Toutes les minutes
}

// --- Fonctions internes ---

async function addSyncedRole(client, db, { memberId, memberTag, sourceGuildId, sourceRoleName, targetGuildId, targetRoleId, durationMinutes, note, action }) {
    const targetGuild = client.guilds.cache.get(targetGuildId);
    if (!targetGuild) return;

    let targetMember;
    try {
        targetMember = await targetGuild.members.fetch(memberId).catch(() => null);
    } catch {
        return;
    }
    if (!targetMember) return;

    const targetRole = targetGuild.roles.cache.get(targetRoleId);
    if (!targetRole) return;

    try {
        await withRetry(() => targetMember.roles.add(targetRoleId));

        // Enregistrer la sync active si durée
        if (durationMinutes) {
            await db.from('role_sync_active').upsert({
                member_id: memberId,
                source_guild_id: sourceGuildId,
                source_role_id: targetRoleId, // Utiliser source role id de la config
                target_guild_id: targetGuildId,
                target_role_id: targetRoleId,
                synced_at: Date.now() / 1000,
                reminder_sent: false,
            }, { onConflict: 'member_id,source_guild_id,source_role_id,target_guild_id,target_role_id' });
        }

        // Log dans le canal
        const logChannel = await getLogChannel(targetGuild, db);
        if (logChannel) {
            await logChannel.send({
                embeds: [createEmbed({
                    title: `[Sync] ${action || 'Ajout automatique'}`,
                    description: `<@${memberId}> a reçu le rôle **${targetRole.name}** sur **${targetGuild.name}**`,
                    color: COLORS.success,
                    fields: [
                        { name: 'Rôle source', value: sourceRoleName, inline: true },
                        { name: 'Durée', value: durationMinutes ? formatDuration(durationMinutes) : 'permanent', inline: true },
                    ],
                })],
            });
        }

        await logAudit(db, {
            guildId: sourceGuildId,
            module: 'sync',
            action: action || 'auto_add',
            userId: memberId,
            userTag: memberTag,
            details: { targetGuildId, targetRoleId, targetRoleName: targetRole.name },
        });
    } catch (err) {
        console.error(`[Sync] Erreur ajout rôle pour ${memberId}:`, err.message);
    }
}

async function removeSyncedRole(client, db, { memberId, memberTag, sourceGuildId, sourceRoleName, targetGuildId, targetRoleId }) {
    const targetGuild = client.guilds.cache.get(targetGuildId);
    if (!targetGuild) return;

    let targetMember;
    try {
        targetMember = await targetGuild.members.fetch(memberId).catch(() => null);
    } catch {
        return;
    }
    if (!targetMember) return;

    const targetRole = targetGuild.roles.cache.get(targetRoleId);

    try {
        await withRetry(() => targetMember.roles.remove(targetRoleId));

        await db.from('role_sync_active').delete()
            .eq('member_id', memberId)
            .eq('source_guild_id', sourceGuildId)
            .eq('target_guild_id', targetGuildId)
            .eq('target_role_id', targetRoleId);

        const logChannel = await getLogChannel(targetGuild, db);
        if (logChannel) {
            await logChannel.send({
                embeds: [createEmbed({
                    title: '[Sync] Retrait automatique',
                    description: `<@${memberId}> a perdu le rôle **${targetRole?.name || targetRoleId}** sur **${targetGuild.name}**`,
                    color: COLORS.orange,
                    fields: [
                        { name: 'Rôle source retiré', value: sourceRoleName, inline: true },
                    ],
                })],
            });
        }

        await logAudit(db, {
            guildId: sourceGuildId,
            module: 'sync',
            action: 'auto_remove',
            userId: memberId,
            userTag: memberTag,
            details: { targetGuildId, targetRoleId, targetRoleName: targetRole?.name },
        });
    } catch (err) {
        console.error(`[Sync] Erreur retrait rôle pour ${memberId}:`, err.message);
    }
}

async function sendReminder(client, db, active, syncConfig, timeLeft) {
    const targetGuild = client.guilds.cache.get(active.target_guild_id);
    if (!targetGuild) return;

    const logChannel = await getLogChannel(targetGuild, db);
    if (!logChannel) return;

    const targetRole = targetGuild.roles.cache.get(active.target_role_id);
    const remaining = formatDuration(Math.ceil(timeLeft / 60));

    await logChannel.send({
        embeds: [createEmbed({
            title: '[Sync] Rappel d\'expiration',
            description: `Le rôle **${targetRole?.name || active.target_role_id}** de <@${active.member_id}> expire dans **${remaining}**.`,
            color: COLORS.warning,
        })],
    });
}

async function handleExpiration(client, db, active, syncConfig) {
    const targetGuild = client.guilds.cache.get(active.target_guild_id);
    if (!targetGuild) {
        await db.from('role_sync_active').delete().eq('id', active.id);
        return;
    }

    let targetMember;
    try {
        targetMember = await targetGuild.members.fetch(active.member_id).catch(() => null);
    } catch {
        // Membre parti → supprimer l'entrée
        await db.from('role_sync_active').delete().eq('id', active.id);
        return;
    }

    const targetRole = targetGuild.roles.cache.get(active.target_role_id);

    if (targetMember && targetMember.roles.cache.has(active.target_role_id)) {
        try {
            await withRetry(() => targetMember.roles.remove(active.target_role_id));

            const logChannel = await getLogChannel(targetGuild, db);
            if (logChannel) {
                await logChannel.send({
                    embeds: [createEmbed({
                        title: '[Sync] Rôle expiré',
                        description: `Le rôle **${targetRole?.name || active.target_role_id}** de <@${active.member_id}> a expiré et a été retiré.`,
                        color: COLORS.error,
                    })],
                });
            }

            await logAudit(db, {
                guildId: active.source_guild_id,
                module: 'sync',
                action: 'expiration',
                userId: active.member_id,
                details: { targetGuildId: active.target_guild_id, targetRoleId: active.target_role_id },
            });
        } catch (err) {
            console.error(`[Sync] Erreur expiration pour ${active.member_id}:`, err.message);
        }
    }

    await db.from('role_sync_active').delete().eq('id', active.id);
}

module.exports = {
    onMemberUpdate,
    onMemberJoin,
    resyncOnReady,
    startExpirationChecker,
};
