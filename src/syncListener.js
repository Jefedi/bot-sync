const { getPool } = require('./database');
const { formaterDuree, avecRetry } = require('./utils');
const { logSync } = require('./logging');

// Délai entre chaque appel API Discord au resync (en ms)
const RESYNC_DELAI = 500;

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
// Tâche de fond : vérifier les rôles expirés (toutes les minutes)
// ──────────────────────────────────────────────

function startExpirationChecker(client) {
    setInterval(() => verifierExpirations(client).catch(console.error), 60_000);
}

async function verifierExpirations(client) {
    const maintenant = Date.now() / 1000;
    const db = getPool();

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
        `INSERT INTO role_sync_actif (member_id, source_guild_id, source_role_id, target_guild_id, target_role_id, synced_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE synced_at = VALUES(synced_at)`,
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

module.exports = { onMemberUpdate, resyncOnReady, startExpirationChecker };
