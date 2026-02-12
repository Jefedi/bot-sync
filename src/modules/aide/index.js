const { createEmbed, COLORS } = require('../../utils/embeds');
const { getUserLevel, getCommandLevel, isOwner } = require('../../core/permissions');

module.exports = {
    name: 'aide',
    description: 'Affiche l\'aide du bot',

    commands: [
        {
            name: null, // Commande directe : !aide [module]
            description: 'Affiche l\'aide générale ou d\'un module spécifique',
            usage: '!aide [module]',
            public: true, // Accessible à tout le monde
            execute: async (message, args, context) => {
                const moduleName = args[0]?.toLowerCase();

                if (moduleName) {
                    return showModuleHelp(message, context, moduleName);
                }

                return showGeneralHelp(message, context);
            },
        },
    ],
};

async function showGeneralHelp(message, context) {
    const guildId = message.guild.id;
    const userId = message.author.id;
    const owner = isOwner(message.guild, userId);
    const userLevel = owner ? 9 : await getUserLevel(guildId, userId);

    let description = '**Modules disponibles :**\n\n';

    for (const [modName, mod] of context.modules) {
        // Compter les commandes accessibles
        let accessibleCount = 0;

        for (const cmd of mod.commands) {
            if (cmd.name === '_default') continue;

            if (cmd.ownerOnly) {
                if (owner) accessibleCount++;
                continue;
            }
            if (cmd.public) {
                accessibleCount++;
                continue;
            }

            const fullName = cmd.name === null ? modName : `${modName}.${cmd.name}`;
            const cmdLevel = await getCommandLevel(guildId, fullName);
            if (cmdLevel !== null && userLevel >= cmdLevel) {
                accessibleCount++;
            }
        }

        const prefix = context.prefix;
        const totalCmds = mod.commands.filter(c => c.name !== '_default').length;

        if (accessibleCount > 0 || owner) {
            description += `**\`${prefix}${modName}\`** — ${mod.description}`;
            if (!owner && accessibleCount < totalCmds) {
                description += ` _(${accessibleCount}/${totalCmds} commandes)_`;
            }
            description += '\n';
        }
    }

    description += `\n_Tapez \`${context.prefix}aide <module>\` pour voir les commandes d'un module._`;

    await message.reply({
        embeds: [createEmbed({
            title: 'Aide du bot',
            description,
            color: COLORS.info,
            footer: `Votre niveau de permission : ${userLevel}${owner ? ' (Propriétaire)' : ''}`,
        })],
    });
}

async function showModuleHelp(message, context, moduleName) {
    const mod = context.modules.get(moduleName);
    if (!mod) {
        return message.reply({
            embeds: [createEmbed({
                description: `Module \`${moduleName}\` introuvable.`,
                color: COLORS.error,
            })],
        });
    }

    const guildId = message.guild.id;
    const userId = message.author.id;
    const owner = isOwner(message.guild, userId);
    const userLevel = owner ? 9 : await getUserLevel(guildId, userId);

    let description = `**${mod.description}**\n\n`;

    if (mod.configSchema && mod.configSchema.length > 0) {
        description += `_Service configurable via \`${context.prefix}config ${moduleName}\`_\n\n`;
    }

    for (const cmd of mod.commands) {
        if (cmd.name === '_default') continue;

        const fullName = cmd.name === null ? moduleName : `${moduleName}.${cmd.name}`;
        let accessible = false;
        let levelInfo = '';

        if (cmd.ownerOnly) {
            accessible = owner;
            levelInfo = '(propriétaire)';
        } else if (cmd.public) {
            accessible = true;
            levelInfo = '(public)';
        } else {
            const cmdLevel = await getCommandLevel(guildId, fullName);
            if (cmdLevel === null) {
                levelInfo = '(non configuré)';
                accessible = owner;
            } else {
                accessible = userLevel >= cmdLevel;
                levelInfo = `(niv. ${cmdLevel})`;
            }
        }

        const prefix = accessible ? '✓' : '✗';
        const usage = cmd.usage || `${context.prefix}${fullName}`;

        description += `${prefix} \`${usage}\` ${levelInfo}\n`;
        if (cmd.description) {
            description += `  _${cmd.description}_\n`;
        }
    }

    await message.reply({
        embeds: [createEmbed({
            title: `Aide — ${moduleName}`,
            description,
            color: COLORS.info,
        })],
    });
}
