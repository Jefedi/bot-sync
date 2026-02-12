const { createSuccessEmbed, createErrorEmbed, createInfoEmbed, createEmbed, COLORS } = require('../../utils/embeds');
const { logAction, logAudit } = require('../../utils/logger');
const { parseUserMention } = require('../../utils/helpers');
const { invalidateUserCache, invalidateCommandCache, getUserLevel } = require('../../core/permissions');

module.exports = {
    name: 'perm',
    description: 'Gestion des permissions virtuelles du bot',

    commands: [
        // !perm create <nom> <niveau>
        {
            name: 'create',
            description: 'Nommer un niveau de permission',
            usage: '!perm create <nom> <niveau (1-9)>',
            ownerOnly: true,
            execute: async (message, args, context) => {
                const name = args[0];
                const level = parseInt(args[1]);

                if (!name || isNaN(level) || level < 1 || level > 9) {
                    return message.reply({
                        embeds: [createErrorEmbed('Usage : `!perm create <nom> <niveau (1-9)>`\nExemple : `!perm create Agent 3`')],
                    });
                }

                const { error } = await context.db
                    .from('permission_levels')
                    .upsert({
                        guild_id: message.guild.id,
                        level,
                        name: name,
                    }, { onConflict: 'guild_id,level' });

                if (error) {
                    // Vérifier si le nom est déjà pris par un autre niveau
                    if (error.message.includes('unique') || error.code === '23505') {
                        return message.reply({
                            embeds: [createErrorEmbed(`Le nom **${name}** est déjà utilisé pour un autre niveau.`)],
                        });
                    }
                    throw error;
                }

                await message.reply({
                    embeds: [createSuccessEmbed(`Niveau **${level}** nommé **${name}**.`)],
                });

                await logAction(message.guild, context.db, {
                    module: 'perm',
                    action: 'Niveau créé',
                    user: message.author,
                    fields: [
                        { name: 'Niveau', value: `${level}`, inline: true },
                        { name: 'Nom', value: name, inline: true },
                    ],
                    color: COLORS.success,
                });

                await logAudit(context.db, {
                    guildId: message.guild.id,
                    module: 'perm',
                    action: 'level_created',
                    userId: message.author.id,
                    userTag: message.author.tag,
                    details: { level, name },
                });
            },
        },

        // !perm delete <nom_ou_niveau>
        {
            name: 'delete',
            description: 'Supprimer un niveau de permission',
            usage: '!perm delete <nom ou niveau>',
            ownerOnly: true,
            execute: async (message, args, context) => {
                const input = args[0];
                if (!input) {
                    return message.reply({
                        embeds: [createErrorEmbed('Usage : `!perm delete <nom ou niveau>`')],
                    });
                }

                const level = parseInt(input);
                let query = context.db.from('permission_levels').delete().eq('guild_id', message.guild.id);

                if (!isNaN(level)) {
                    query = query.eq('level', level);
                } else {
                    query = query.eq('name', input);
                }

                const { error, count } = await query;
                if (error) throw error;

                if (count === 0) {
                    return message.reply({
                        embeds: [createErrorEmbed(`Niveau **${input}** introuvable.`)],
                    });
                }

                await message.reply({
                    embeds: [createSuccessEmbed(`Niveau **${input}** supprimé.`)],
                });
            },
        },

        // !perm assign <commande> <niveau_ou_nom>
        {
            name: 'assign',
            description: 'Assigner une commande à un niveau de permission',
            usage: '!perm assign <module.commande> <niveau ou nom>',
            ownerOnly: true,
            execute: async (message, args, context) => {
                const commandName = args[0]?.toLowerCase();
                const levelInput = args[1];

                if (!commandName || !levelInput) {
                    // Lister toutes les commandes disponibles
                    const allCommands = [];
                    for (const [modName, mod] of context.modules) {
                        for (const cmd of mod.commands) {
                            if (cmd.ownerOnly || cmd.public || cmd.name === '_default') continue;
                            const fullName = cmd.name === null ? modName : `${modName}.${cmd.name}`;
                            allCommands.push(`\`${fullName}\``);
                        }
                    }

                    return message.reply({
                        embeds: [createErrorEmbed(
                            'Usage : `!perm assign <commande> <niveau ou nom>`\n' +
                            `Exemple : \`!perm assign sync.add 5\`\n\n` +
                            `**Commandes disponibles :**\n${allCommands.join(', ') || 'Aucune'}`
                        )],
                    });
                }

                // Résoudre le niveau
                const level = await resolveLevel(context.db, message.guild.id, levelInput);
                if (level === null) {
                    return message.reply({
                        embeds: [createErrorEmbed(`Niveau **${levelInput}** introuvable. Créez-le avec \`!perm create\`.`)],
                    });
                }

                // Vérifier que la commande existe dans les modules chargés
                const cmdExists = commandExistsInModules(context.modules, commandName);
                if (!cmdExists) {
                    return message.reply({
                        embeds: [createErrorEmbed(`Commande \`${commandName}\` introuvable dans les modules chargés.`)],
                    });
                }

                const { error } = await context.db
                    .from('command_permissions')
                    .upsert({
                        guild_id: message.guild.id,
                        command_name: commandName,
                        permission_level: level,
                    }, { onConflict: 'guild_id,command_name' });

                if (error) throw error;

                invalidateCommandCache(message.guild.id, commandName);

                await message.reply({
                    embeds: [createSuccessEmbed(`Commande \`${commandName}\` assignée au niveau **${level}**.`)],
                });

                await logAudit(context.db, {
                    guildId: message.guild.id,
                    module: 'perm',
                    action: 'command_assigned',
                    userId: message.author.id,
                    userTag: message.author.tag,
                    details: { command: commandName, level },
                });
            },
        },

        // !perm unassign <commande>
        {
            name: 'unassign',
            description: 'Retirer l\'assignation d\'une commande',
            usage: '!perm unassign <module.commande>',
            ownerOnly: true,
            execute: async (message, args, context) => {
                const commandName = args[0]?.toLowerCase();
                if (!commandName) {
                    return message.reply({
                        embeds: [createErrorEmbed('Usage : `!perm unassign <module.commande>`')],
                    });
                }

                const { error } = await context.db
                    .from('command_permissions')
                    .delete()
                    .eq('guild_id', message.guild.id)
                    .eq('command_name', commandName);

                if (error) throw error;

                invalidateCommandCache(message.guild.id, commandName);

                await message.reply({
                    embeds: [createSuccessEmbed(`Commande \`${commandName}\` retirée du système de permissions.`)],
                });
            },
        },

        // !perm grant @user <niveau_ou_nom>
        {
            name: 'grant',
            description: 'Donner un niveau de permission à un utilisateur',
            usage: '!perm grant <@utilisateur> <niveau ou nom>',
            ownerOnly: true,
            execute: async (message, args, context) => {
                const userMention = args[0];
                const levelInput = args[1];
                const userId = parseUserMention(userMention);

                if (!userId || !levelInput) {
                    return message.reply({
                        embeds: [createErrorEmbed('Usage : `!perm grant <@utilisateur> <niveau ou nom>`\nExemple : `!perm grant @Jean Agent`')],
                    });
                }

                const level = await resolveLevel(context.db, message.guild.id, levelInput);
                if (level === null) {
                    return message.reply({
                        embeds: [createErrorEmbed(`Niveau **${levelInput}** introuvable. Créez-le avec \`!perm create\`.`)],
                    });
                }

                const { error } = await context.db
                    .from('user_permissions')
                    .upsert({
                        guild_id: message.guild.id,
                        user_id: userId,
                        permission_level: level,
                        assigned_by: message.author.id,
                    }, { onConflict: 'guild_id,user_id' });

                if (error) throw error;

                invalidateUserCache(message.guild.id, userId);

                // Trouver le nom du niveau
                const levelName = await getLevelName(context.db, message.guild.id, level);

                await message.reply({
                    embeds: [createSuccessEmbed(`<@${userId}> a maintenant le niveau **${level}**${levelName ? ` (${levelName})` : ''}.`)],
                });

                await logAction(message.guild, context.db, {
                    module: 'perm',
                    action: 'Permission accordée',
                    user: message.author,
                    fields: [
                        { name: 'Cible', value: `<@${userId}>`, inline: true },
                        { name: 'Niveau', value: `${level}${levelName ? ` (${levelName})` : ''}`, inline: true },
                    ],
                    color: COLORS.success,
                });

                await logAudit(context.db, {
                    guildId: message.guild.id,
                    module: 'perm',
                    action: 'permission_granted',
                    userId: message.author.id,
                    userTag: message.author.tag,
                    details: { targetUserId: userId, level },
                });
            },
        },

        // !perm revoke @user
        {
            name: 'revoke',
            description: 'Retirer les permissions d\'un utilisateur',
            usage: '!perm revoke <@utilisateur>',
            ownerOnly: true,
            execute: async (message, args, context) => {
                const userId = parseUserMention(args[0]);
                if (!userId) {
                    return message.reply({
                        embeds: [createErrorEmbed('Usage : `!perm revoke <@utilisateur>`')],
                    });
                }

                const { error } = await context.db
                    .from('user_permissions')
                    .delete()
                    .eq('guild_id', message.guild.id)
                    .eq('user_id', userId);

                if (error) throw error;

                invalidateUserCache(message.guild.id, userId);

                await message.reply({
                    embeds: [createSuccessEmbed(`Permissions de <@${userId}> retirées (retour au niveau 0).`)],
                });

                await logAudit(context.db, {
                    guildId: message.guild.id,
                    module: 'perm',
                    action: 'permission_revoked',
                    userId: message.author.id,
                    userTag: message.author.tag,
                    details: { targetUserId: userId },
                });
            },
        },

        // !perm list
        {
            name: 'list',
            description: 'Voir tous les niveaux et commandes assignées',
            usage: '!perm list',
            ownerOnly: true,
            execute: async (message, args, context) => {
                const guildId = message.guild.id;

                // Récupérer les niveaux
                const { data: levels } = await context.db
                    .from('permission_levels')
                    .select('*')
                    .eq('guild_id', guildId)
                    .order('level', { ascending: true });

                // Récupérer les commandes assignées
                const { data: commands } = await context.db
                    .from('command_permissions')
                    .select('*')
                    .eq('guild_id', guildId)
                    .order('permission_level', { ascending: true });

                // Récupérer les utilisateurs avec permissions
                const { data: users } = await context.db
                    .from('user_permissions')
                    .select('*')
                    .eq('guild_id', guildId)
                    .order('permission_level', { ascending: false });

                let description = '';

                // Section niveaux
                description += '**Niveaux de permission :**\n';
                if (!levels || levels.length === 0) {
                    description += 'Aucun niveau configuré.\n';
                } else {
                    for (const l of levels) {
                        const cmds = commands?.filter(c => c.permission_level === l.level) || [];
                        const cmdList = cmds.map(c => `\`${c.command_name}\``).join(', ') || '_aucune commande_';
                        description += `**${l.level}** — ${l.name} → ${cmdList}\n`;
                    }
                }

                // Section utilisateurs
                description += '\n**Utilisateurs :**\n';
                if (!users || users.length === 0) {
                    description += 'Aucun utilisateur configuré.\n';
                } else {
                    for (const u of users) {
                        const levelName = levels?.find(l => l.level === u.permission_level)?.name || '';
                        description += `<@${u.user_id}> → niveau **${u.permission_level}**${levelName ? ` (${levelName})` : ''}\n`;
                    }
                }

                await message.reply({
                    embeds: [createEmbed({
                        title: 'Permissions du serveur',
                        description,
                        color: COLORS.info,
                    })],
                });
            },
        },

        // !perm info @user
        {
            name: 'info',
            description: 'Voir le niveau d\'un utilisateur et ses commandes accessibles',
            usage: '!perm info <@utilisateur>',
            ownerOnly: true,
            execute: async (message, args, context) => {
                const userId = parseUserMention(args[0]);
                if (!userId) {
                    return message.reply({
                        embeds: [createErrorEmbed('Usage : `!perm info <@utilisateur>`')],
                    });
                }

                const userLevel = await getUserLevel(message.guild.id, userId);
                const levelName = await getLevelName(context.db, message.guild.id, userLevel);

                // Trouver les commandes accessibles
                const { data: commands } = await context.db
                    .from('command_permissions')
                    .select('command_name, permission_level')
                    .eq('guild_id', message.guild.id)
                    .lte('permission_level', userLevel)
                    .order('permission_level', { ascending: true });

                const cmdList = commands?.map(c => `\`${c.command_name}\` (niv. ${c.permission_level})`).join('\n') || '_Aucune commande accessible_';

                await message.reply({
                    embeds: [createEmbed({
                        title: `Permissions de l'utilisateur`,
                        description: `**Utilisateur :** <@${userId}>\n` +
                            `**Niveau :** ${userLevel}${levelName ? ` (${levelName})` : ''}\n\n` +
                            `**Commandes accessibles :**\n${cmdList}`,
                        color: COLORS.info,
                    })],
                });
            },
        },
    ],
};

// --- Fonctions utilitaires ---

/**
 * Résout un niveau depuis un nom ou un numéro.
 */
async function resolveLevel(db, guildId, input) {
    const asNumber = parseInt(input);
    if (!isNaN(asNumber) && asNumber >= 1 && asNumber <= 9) {
        return asNumber;
    }

    // Chercher par nom
    const { data } = await db
        .from('permission_levels')
        .select('level')
        .eq('guild_id', guildId)
        .eq('name', input)
        .single();

    return data ? data.level : null;
}

/**
 * Récupère le nom d'un niveau.
 */
async function getLevelName(db, guildId, level) {
    const { data } = await db
        .from('permission_levels')
        .select('name')
        .eq('guild_id', guildId)
        .eq('level', level)
        .single();

    return data?.name || null;
}

/**
 * Vérifie qu'une commande existe dans les modules chargés.
 */
function commandExistsInModules(modules, commandName) {
    // Format: 'module.subcommand' ou 'module' (pour les commandes sans nom)
    const parts = commandName.split('.');
    const moduleName = parts[0];
    const subcommand = parts[1] || null;

    const mod = modules.get(moduleName);
    if (!mod) return false;

    if (subcommand === null) {
        return mod.commands.some(c => c.name === null);
    }

    return mod.commands.some(c => c.name === subcommand && c.name !== '_default');
}
