const { getDb } = require('../core/database');
const { createErrorEmbed } = require('../utils/embeds');

// Cache des configs de services par guild
const serviceConfigCache = new Map(); // 'guildId:service' -> { config, time }
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Récupère la configuration d'un service pour un serveur.
 * Retourne un objet { key: value, ... } ou null si non configuré.
 */
async function getServiceConfig(guildId, serviceName) {
    const cacheKey = `${guildId}:${serviceName}`;
    const cached = serviceConfigCache.get(cacheKey);

    if (cached && Date.now() - cached.time < CONFIG_CACHE_TTL) {
        return cached.config;
    }

    const db = getDb();
    const { data } = await db
        .from('service_configs')
        .select('config_key, config_value')
        .eq('guild_id', guildId)
        .eq('service', serviceName);

    if (!data || data.length === 0) {
        serviceConfigCache.set(cacheKey, { config: null, time: Date.now() });
        return null;
    }

    const config = {};
    for (const row of data) {
        config[row.config_key] = row.config_value;
    }

    serviceConfigCache.set(cacheKey, { config, time: Date.now() });
    return config;
}

/**
 * Vérifie que le service est configuré et retourne la config.
 * Si non configuré, envoie un message d'erreur et retourne null.
 */
async function requireConfig(message, context, serviceName) {
    const config = await getServiceConfig(message.guild.id, serviceName);

    if (!config) {
        await message.reply({
            embeds: [createErrorEmbed(
                `**${serviceName}** n'est pas configuré sur ce serveur.\n` +
                `Le propriétaire doit exécuter \`${context.prefix}config ${serviceName}\` pour le configurer.`
            )],
        });
        return null;
    }

    return config;
}

/**
 * Invalide le cache de configuration d'un service pour un serveur.
 */
function invalidateServiceConfig(guildId, serviceName) {
    serviceConfigCache.delete(`${guildId}:${serviceName}`);
}

module.exports = { getServiceConfig, requireConfig, invalidateServiceConfig };
