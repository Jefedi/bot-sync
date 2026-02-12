const { EmbedBuilder } = require('discord.js');
const { getPool, enregistrerHistorique } = require('./database');
const { formaterDuree, avecRetry } = require('./utils');
const { logSync } = require('./logging');

// Délai entre chaque appel API Discord au resync (en ms)
const RESYNC_DELAI = 500;

const LOG_CHANNEL_NAME = process.env.LOG_CHANNEL_NAME || 'logs-sync';

// ──────────────────────────────────────────────
// Écoute des changements de rôles en temps réel
// ──────────────────────────────────────────────

async function onMemberUpdate(client, oldMember, newMember) {
    const rolesBefore = new Set(oldMember.roles.cache.keys());
    const rolesAfter = new Set(newMember.roles.cache.keys());

    const rolesAjoutes = [...rolesAfter].filter(id => !rolesBefore.has(id));
    const rolesRetires = [...rolesBefore].filter(id => !rolesAfter.has(id));

    if (rolesAjoutes.length === 0 && rolesRetires.length === 0) return;

    const sourceGuild = newMember.guild;
    const db = getPool();

    // Rôles ajoutés
    for (const roleId of rolesAjoutes) {
        const [rows] = await db.execute(
            `SELECT target_guild_id, target_role_id, duree_minutes, note
             FROM role_sync WHERE source_guild_id = ? AND source_role_id = ?`,
            [sourceGuild.id, roleId]
        );
        const sourceRole = sourceGuild.roles.cache.get(roleId);
        for (const row of rows) {
            await ajouterRole(client, newMember, sourceRole, row.target_guild_id, row.target_role_id, row.duree_minutes, row.note);
        }
    }

    // Rôles retirés
    for (const roleId of rolesRetires) {
        const [rows] = await db.execute(
            `SELECT target_guild_id, target_role_id, duree_minutes, note
             FROM role_sync WHERE source_guild_id = ? AND source_role_id = ?`,
            [sourceGuild.id, roleId]
        );
        const sourceRole = oldMember.roles.cache.get(roleId) || sourceGuild.roles.cache.get(roleId);
        for (const row of rows) {
            await retirerRole(client, newMember, sourceRole, row.target_guild_id, row.target_role_id, row.note);
        }
    }
}

// ──────────────────────────────────────────────
// Sync au join : quand un membre rejoint un serveur cible
// ──────────────────────────────────────────────

async function onMemberJoin(client, member) {
    const db = getPool();

    // Vérifier si ce serveur est un serveur cible dans une correspondance
    const [mappings] = await db.execute(
        `SELECT source_guild_id, source_role_id, target_role_id, duree_minutes, note
         FROM role_sync WHERE target_guild_id = ?`,
        [member.guild.id]
    );

    if (mappings.length === 0) return;

    for (const mapping of mappings) {
        const sourceGuild = client.guilds.cache.get(mapping.source_guild_id);
        if (!sourceGuild) continue;

        const sourceMembre = sourceGuild.members.cache.get(member.id);
        if (!sourceMembre) continue;

        const sourceRole = sourceGuild.roles.cache.get(mapping.source_role_id);
        if (!sourceRole) continue;
        if (!sourceMembre.roles.cache.has(sourceRole.id)) continue;

        const targetRole = member.guild.roles.cache.get(mapping.target_role_id);
        if (!targetRole) continue;
        if (member.roles.cache.has(targetRole.id)) continue;

        try {
            await avecRetry(() =>
                member.roles.add(targetRole, `Sync au join — rôle ${sourceRole.name} depuis ${sourceGuild.name}`)
            );
            if (mapping.duree_minutes) {
                await enregistrerSyncActif(member.id, mapping.source_guild_id, sourceRole.id, member.guild.id, targetRole.id);
            }
            await logSync(client, 'Ajout au join du serveur', sourceMembre, sourceRole, targetRole, member.guild, {
                sourceGuild, note: mapping.note, dureeMinutes: mapping.duree_minutes,
            });
            await enregistrerHistorique(
                'Ajout au join', member.id, member.user.tag,
                mapping.source_guild_id, sourceRole.name,
                member.guild.id, member.guild.name, targetRole.name
            );
        } catch {
            await logSync(client, 'Échec — sync au join', sourceMembre, sourceRole, targetRole, member.guild, {
                sourceGuild, note: mapping.note,
            });
        }

        await sleep(RESYNC_DELAI);
    }
}

// ──────────────────────────────────────────────
// Resync au démarrage (avec rate limiting)
// ──────────────────────────────────────────────

async function resyncOnReady(client) {
    console.log('Resynchronisation des rôles au démarrage...');
    const db = getPool();

    const [mappings] = await db.execute(
        'SELECT source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note FROM role_sync'
    );

    let ajouts = 0;
    let retraits = 0;

    for (const mapping of mappings) {
        const { source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note } = mapping;

        const sourceGuild = client.guilds.cache.get(source_guild_id);
        const targetGuild = client.guilds.cache.get(target_guild_id);
        if (!sourceGuild || !targetGuild) continue;

        const sourceRole = sourceGuild.roles.cache.get(source_role_id);
        const targetRole = targetGuild.roles.cache.get(target_role_id);
        if (!sourceRole || !targetRole) continue;

        // Parcourir les membres du serveur source
        for (const [memberId, membre] of sourceGuild.members.cache) {
            const targetMembre = targetGuild.members.cache.get(memberId);
            if (!targetMembre) continue;

            const aLeRoleSource = membre.roles.cache.has(sourceRole.id);
            const aLeRoleCible = targetMembre.roles.cache.has(targetRole.id);

            if (aLeRoleSource && !aLeRoleCible) {
                try {
                    await avecRetry(() =>
                        targetMembre.roles.add(targetRole, `Resync au démarrage — rôle ${sourceRole.name}`)
                    );
                    if (duree_minutes) {
                        await enregistrerSyncActif(memberId, source_guild_id, source_role_id, target_guild_id, target_role_id);
                    }
                    ajouts++;
                    await logSync(client, 'Ajout au resync (démarrage)', membre, sourceRole, targetRole, targetGuild, { sourceGuild, note });
                    await enregistrerHistorique(
                        'Resync démarrage (ajout)', memberId, membre.user.tag,
                        source_guild_id, sourceRole.name,
                        target_guild_id, targetGuild.name, targetRole.name
                    );
                } catch {
                    await logSync(client, 'Échec ajout au resync (démarrage)', membre, sourceRole, targetRole, targetGuild, { sourceGuild, note });
                }
                await sleep(RESYNC_DELAI);
            } else if (!aLeRoleSource && aLeRoleCible) {
                try {
                    await avecRetry(() =>
                        targetMembre.roles.remove(targetRole, `Resync au démarrage — rôle ${sourceRole.name} retiré`)
                    );
                    await supprimerSyncActif(memberId, source_guild_id, source_role_id, target_guild_id, target_role_id);
                    retraits++;
                    await logSync(client, 'Retrait au resync (démarrage)', membre, sourceRole, targetRole, targetGuild, { sourceGuild, note });
                    await enregistrerHistorique(
                        'Resync démarrage (retrait)', memberId, membre.user.tag,
                        source_guild_id, sourceRole.name,
                        target_guild_id, targetGuild.name, targetRole.name
                    );
                } catch {
                    await logSync(client, 'Échec retrait au resync (démarrage)', membre, sourceRole, targetRole, targetGuild, { sourceGuild, note });
                }
                await sleep(RESYNC_DELAI);
            }
        }
    }

    console.log(`Resync terminé : ${ajouts} ajout(s), ${retraits} retrait(s)`);
}

// ──────────────────────────────────────────────
// Tâche de fond : vérifier les rôles expirés + rappels (toutes les minutes)
// ──────────────────────────────────────────────

function startExpirationChecker(client) {
    setInterval(() => verifierExpirations(client).catch(console.error), 60_000);
}

async function verifierExpirations(client) {
    const maintenant = Date.now() / 1000;
    const db = getPool();

    // ── 1. Notifications de rappel (1h avant expiration) ──
    const [rappels] = await db.execute(
        `SELECT a.member_id, a.source_guild_id, a.source_role_id,
                a.target_guild_id, a.target_role_id, a.synced_at,
                s.duree_minutes, s.note
         FROM role_sync_actif a
         JOIN role_sync s ON a.source_guild_id = s.source_guild_id
             AND a.source_role_id = s.source_role_id
             AND a.target_guild_id = s.target_guild_id
             AND a.target_role_id = s.target_role_id
         WHERE s.duree_minutes IS NOT NULL
           AND a.rappel_envoye = 0
           AND (a.synced_at + (s.duree_minutes * 60)) - ? <= 3600
           AND (a.synced_at + (s.duree_minutes * 60)) > ?`,
        [maintenant, maintenant]
    );

    for (const row of rappels) {
        const expireAt = row.synced_at + (row.duree_minutes * 60);
        const resteMinutes = Math.max(1, Math.round((expireAt - maintenant) / 60));

        const sourceGuild = client.guilds.cache.get(row.source_guild_id);
        const targetGuild = client.guilds.cache.get(row.target_guild_id);
        if (!sourceGuild || !targetGuild) continue;

        const sourceRole = sourceGuild.roles.cache.get(row.source_role_id);
        const targetRole = targetGuild.roles.cache.get(row.target_role_id);
        const targetMembre = targetGuild.members.cache.get(row.member_id);

        // Envoyer la notification dans le canal de log du serveur source
        const logChannel = sourceGuild.channels.cache.find(
            ch => ch.name === LOG_CHANNEL_NAME && ch.isTextBased()
        );

        if (logChannel && targetMembre && targetRole) {
            const embed = new EmbedBuilder()
                .setTitle('Rappel — Expiration prochaine')
                .setDescription(`Le rôle **${targetRole.name}** de **${targetMembre.user.tag}** expire dans **${formaterDuree(resteMinutes)}**`)
                .setColor(0xFEE75C) // Jaune
                .addFields(
                    { name: 'Membre', value: `${targetMembre}`, inline: true },
                    { name: 'Rôle cible', value: `${targetRole.name}`, inline: true },
                    { name: 'Serveur cible', value: `${targetGuild.name}`, inline: true },
                );
            if (sourceRole) {
                embed.addFields({ name: 'Rôle source', value: `${sourceRole.name}`, inline: true });
            }
            if (row.note) {
                embed.addFields({ name: 'Note', value: row.note, inline: false });
            }
            await logChannel.send({ embeds: [embed] }).catch(() => {});
        }

        // Marquer comme notifié
        await db.execute(
            `UPDATE role_sync_actif SET rappel_envoye = 1
             WHERE member_id = ? AND source_guild_id = ? AND source_role_id = ?
             AND target_guild_id = ? AND target_role_id = ?`,
            [row.member_id, row.source_guild_id, row.source_role_id, row.target_guild_id, row.target_role_id]
        );
    }

    // ── 2. Expirations effectives ──
    const [rows] = await db.execute(
        `SELECT a.member_id, a.source_guild_id, a.source_role_id,
                a.target_guild_id, a.target_role_id, a.synced_at,
                s.duree_minutes, s.note
         FROM role_sync_actif a
         JOIN role_sync s ON a.source_guild_id = s.source_guild_id
             AND a.source_role_id = s.source_role_id
             AND a.target_guild_id = s.target_guild_id
             AND a.target_role_id = s.target_role_id
         WHERE s.duree_minutes IS NOT NULL`
    );

    for (const row of rows) {
        const expireAt = row.synced_at + (row.duree_minutes * 60);
        if (maintenant < expireAt) continue;

        const targetGuild = client.guilds.cache.get(row.target_guild_id);
        if (!targetGuild) continue;
        const targetRole = targetGuild.roles.cache.get(row.target_role_id);
        if (!targetRole) continue;
        const targetMembre = targetGuild.members.cache.get(row.member_id);
        if (!targetMembre) continue;

        const sourceGuild = client.guilds.cache.get(row.source_guild_id);
        const sourceRole = sourceGuild ? sourceGuild.roles.cache.get(row.source_role_id) : null;

        if (targetMembre.roles.cache.has(targetRole.id)) {
            try {
                await avecRetry(() =>
                    targetMembre.roles.remove(targetRole, `Durée expirée — rôle synchronisé depuis ${formaterDuree(row.duree_minutes)}`)
                );
                await logSync(client, 'Expiration de rôle — durée écoulée', targetMembre, sourceRole, targetRole, targetGuild, {
                    sourceGuild, note: row.note,
                });
                await enregistrerHistorique(
                    'Expiration', row.member_id, targetMembre.user.tag,
                    row.source_guild_id, sourceRole ? sourceRole.name : null,
                    row.target_guild_id, targetGuild.name, targetRole.name
                );
            } catch {
                // Ignorer les erreurs de permissions
            }
        }

        // Supprimer l'entrée active
        await db.execute(
            `DELETE FROM role_sync_actif
             WHERE member_id = ? AND source_guild_id = ? AND source_role_id = ?
             AND target_guild_id = ? AND target_role_id = ?`,
            [row.member_id, row.source_guild_id, row.source_role_id, row.target_guild_id, row.target_role_id]
        );
    }
}

// ──────────────────────────────────────────────
// Méthodes internes
// ──────────────────────────────────────────────

async function ajouterRole(client, membre, sourceRole, targetGuildId, targetRoleId, dureeMinutes, note) {
    const targetGuild = client.guilds.cache.get(targetGuildId);
    if (!targetGuild) return;
    const targetRole = targetGuild.roles.cache.get(targetRoleId);
    if (!targetRole) return;
    const targetMembre = targetGuild.members.cache.get(membre.id);
    if (!targetMembre) return;
    if (targetMembre.roles.cache.has(targetRole.id)) return;

    try {
        await avecRetry(() =>
            targetMembre.roles.add(targetRole, `Synchronisation depuis ${membre.guild.name} — rôle ${sourceRole ? sourceRole.name : 'inconnu'}`)
        );
        if (dureeMinutes) {
            await enregistrerSyncActif(membre.id, membre.guild.id, sourceRole ? sourceRole.id : '0', targetGuildId, targetRoleId);
        }
        await logSync(client, 'Ajout automatique de rôle', membre, sourceRole, targetRole, targetGuild, {
            sourceGuild: membre.guild, note, dureeMinutes,
        });
        await enregistrerHistorique(
            'Ajout automatique', membre.id, membre.user.tag,
            membre.guild.id, sourceRole ? sourceRole.name : null,
            targetGuildId, targetGuild.name, targetRole.name
        );
    } catch (error) {
        if (error.code === 50013) {
            await logSync(client, 'Échec — permissions insuffisantes pour ajouter le rôle', membre, sourceRole, targetRole, targetGuild, {
                sourceGuild: membre.guild, note,
            });
        } else {
            await logSync(client, "Échec — erreur lors de l'ajout du rôle (après retry)", membre, sourceRole, targetRole, targetGuild, {
                sourceGuild: membre.guild, note,
            });
        }
    }
}

async function retirerRole(client, membre, sourceRole, targetGuildId, targetRoleId, note) {
    const targetGuild = client.guilds.cache.get(targetGuildId);
    if (!targetGuild) return;
    const targetRole = targetGuild.roles.cache.get(targetRoleId);
    if (!targetRole) return;
    const targetMembre = targetGuild.members.cache.get(membre.id);
    if (!targetMembre) return;
    if (!targetMembre.roles.cache.has(targetRole.id)) return;

    try {
        await avecRetry(() =>
            targetMembre.roles.remove(targetRole, `Synchronisation depuis ${membre.guild.name} — rôle ${sourceRole ? sourceRole.name : 'inconnu'} retiré`)
        );
        await supprimerSyncActif(membre.id, membre.guild.id, sourceRole ? sourceRole.id : '0', targetGuildId, targetRoleId);
        await logSync(client, 'Retrait automatique de rôle', membre, sourceRole, targetRole, targetGuild, {
            sourceGuild: membre.guild, note,
        });
        await enregistrerHistorique(
            'Retrait automatique', membre.id, membre.user.tag,
            membre.guild.id, sourceRole ? sourceRole.name : null,
            targetGuildId, targetGuild.name, targetRole.name
        );
    } catch (error) {
        if (error.code === 50013) {
            await logSync(client, 'Échec — permissions insuffisantes pour retirer le rôle', membre, sourceRole, targetRole, targetGuild, {
                sourceGuild: membre.guild, note,
            });
        } else {
            await logSync(client, 'Échec — erreur lors du retrait du rôle (après retry)', membre, sourceRole, targetRole, targetGuild, {
                sourceGuild: membre.guild, note,
            });
        }
    }
}

async function enregistrerSyncActif(memberId, sourceGuildId, sourceRoleId, targetGuildId, targetRoleId) {
    const db = getPool();
    await db.execute(
        `INSERT INTO role_sync_actif (member_id, source_guild_id, source_role_id, target_guild_id, target_role_id, synced_at, rappel_envoye)
         VALUES (?, ?, ?, ?, ?, ?, 0)
         ON DUPLICATE KEY UPDATE synced_at = VALUES(synced_at), rappel_envoye = 0`,
        [memberId, sourceGuildId, sourceRoleId, targetGuildId, targetRoleId, Date.now() / 1000]
    );
}

async function supprimerSyncActif(memberId, sourceGuildId, sourceRoleId, targetGuildId, targetRoleId) {
    const db = getPool();
    await db.execute(
        `DELETE FROM role_sync_actif
         WHERE member_id = ? AND source_guild_id = ? AND source_role_id = ?
         AND target_guild_id = ? AND target_role_id = ?`,
        [memberId, sourceGuildId, sourceRoleId, targetGuildId, targetRoleId]
    );
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { onMemberUpdate, onMemberJoin, resyncOnReady, startExpirationChecker };
