const { getDb } = require('./database');

// Caches en mémoire avec TTL
const userLevelCache = new Map();     // 'guildId:userId' -> { level, time }
const commandLevelCache = new Map();  // 'guildId:command' -> { level, time }
const CACHE_TTL = 5 * 60 * 1000;     // 5 minutes

function getCacheKey(guildId, id) {
    return `${guildId}:${id}`;
}

/**
 * Vérifie si l'utilisateur est le propriétaire du serveur.
 */
function isOwner(guild, userId) {
    return guild.ownerId === userId;
}

/**
 * Récupère le niveau de permission d'un utilisateur (0 par défaut).
 */
async function getUserLevel(guildId, userId) {
    const key = getCacheKey(guildId, userId);
    const cached = userLevelCache.get(key);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.level;
    }

    const db = getDb();
    const { data } = await db
        .from('user_permissions')
        .select('permission_level')
        .eq('guild_id', guildId)
        .eq('user_id', userId)
        .single();

    const level = data ? data.permission_level : 0;
    userLevelCache.set(key, { level, time: Date.now() });
    return level;
}

/**
 * Récupère le niveau requis pour une commande (null = non configurée).
 */
async function getCommandLevel(guildId, commandName) {
    const key = getCacheKey(guildId, commandName);
    const cached = commandLevelCache.get(key);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.level;
    }

    const db = getDb();
    const { data } = await db
        .from('command_permissions')
        .select('permission_level')
        .eq('guild_id', guildId)
        .eq('command_name', commandName)
        .single();

    const level = data ? data.permission_level : null;
    commandLevelCache.set(key, { level, time: Date.now() });
    return level;
}

/**
 * Vérifie si un utilisateur peut exécuter une commande.
 * Retourne { allowed: true } ou { allowed: false, reason: '...' }.
 */
async function checkPermission(guild, userId, commandFullName, command) {
    // Le propriétaire du serveur a toujours accès
    if (isOwner(guild, userId)) {
        return { allowed: true };
    }

    // Commandes réservées au propriétaire
    if (command.ownerOnly) {
        return {
            allowed: false,
            reason: 'Cette commande est réservée au propriétaire du serveur.',
        };
    }

    // Commandes publiques (ex: !aide)
    if (command.public) {
        return { allowed: true };
    }

    // Vérifier le niveau de l'utilisateur
    const userLevel = await getUserLevel(guild.id, userId);
    if (userLevel === 0) {
        return {
            allowed: false,
            reason: 'Vous n\'avez aucune permission configurée. Contactez le propriétaire du serveur.',
        };
    }

    // Vérifier si la commande est assignée à un niveau
    const commandLevel = await getCommandLevel(guild.id, commandFullName);
    if (commandLevel === null) {
        return {
            allowed: false,
            reason: `La commande \`${commandFullName}\` n'est pas encore configurée. Le propriétaire doit l'assigner à un niveau avec \`!perm assign\`.`,
        };
    }

    // Vérifier le niveau
    if (userLevel >= commandLevel) {
        return { allowed: true };
    }

    return {
        allowed: false,
        reason: `Permission insuffisante. Niveau requis : **${commandLevel}**, votre niveau : **${userLevel}**.`,
    };
}

// Invalidation du cache

function invalidateUserCache(guildId, userId) {
    userLevelCache.delete(getCacheKey(guildId, userId));
}

function invalidateCommandCache(guildId, commandName) {
    commandLevelCache.delete(getCacheKey(guildId, commandName));
}

function invalidateAllCommandCache(guildId) {
    for (const key of commandLevelCache.keys()) {
        if (key.startsWith(`${guildId}:`)) {
            commandLevelCache.delete(key);
        }
    }
}

function invalidateAllUserCache(guildId) {
    for (const key of userLevelCache.keys()) {
        if (key.startsWith(`${guildId}:`)) {
            userLevelCache.delete(key);
        }
    }
}

module.exports = {
    isOwner,
    getUserLevel,
    getCommandLevel,
    checkPermission,
    invalidateUserCache,
    invalidateCommandCache,
    invalidateAllCommandCache,
    invalidateAllUserCache,
};
