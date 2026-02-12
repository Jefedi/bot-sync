const { createEmbed, COLORS } = require('./embeds');

/**
 * Trouve le canal de logs configuré pour un serveur.
 */
async function getLogChannel(guild, db) {
    // Chercher un canal configuré dans guild_settings
    const { data } = await db
        .from('guild_settings')
        .select('log_channel_id')
        .eq('guild_id', guild.id)
        .single();

    if (data?.log_channel_id) {
        const channel = guild.channels.cache.get(data.log_channel_id);
        if (channel) return channel;
    }

    // Fallback : chercher par nom
    const channelName = process.env.LOG_CHANNEL_NAME || 'logs-bot';
    return guild.channels.cache.find(c => c.name === channelName && c.isTextBased());
}

/**
 * Poste un embed d'audit dans le canal de logs.
 */
async function logAction(guild, db, { module: modName, action, user, fields, color }) {
    const channel = await getLogChannel(guild, db);
    if (!channel) return;

    const embed = createEmbed({
        title: `[${modName}] ${action}`,
        color: color || COLORS.info,
        fields: [
            {
                name: 'Utilisateur',
                value: user ? `<@${user.id}> (${user.tag})` : 'Système',
                inline: true,
            },
            ...(fields || []),
        ],
        footer: `Module: ${modName}`,
    });

    try {
        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('[Log] Impossible d\'envoyer le log:', err.message);
    }
}

/**
 * Enregistre une entrée dans la table audit_log.
 */
async function logAudit(db, { guildId, module: modName, action, userId, userTag, details }) {
    try {
        await db.from('audit_log').insert({
            guild_id: guildId,
            module: modName,
            action,
            user_id: userId || null,
            user_tag: userTag || null,
            details: details || {},
        });
    } catch (err) {
        console.error('[Audit] Erreur d\'enregistrement:', err.message);
    }
}

module.exports = { getLogChannel, logAction, logAudit };
