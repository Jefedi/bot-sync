const { getDb } = require('./database');
const { checkPermission } = require('./permissions');
const { createErrorEmbed } = require('../utils/embeds');

// Cache des préfixes par serveur
const prefixCache = new Map();
const PREFIX_DEFAULT = '!';

/**
 * Récupère le préfixe configuré pour un serveur.
 */
async function getPrefix(guildId) {
    if (prefixCache.has(guildId)) return prefixCache.get(guildId);

    const db = getDb();
    const { data } = await db
        .from('guild_settings')
        .select('prefix')
        .eq('guild_id', guildId)
        .single();

    const prefix = data?.prefix || PREFIX_DEFAULT;
    prefixCache.set(guildId, prefix);
    return prefix;
}

/**
 * Met à jour le préfixe en cache.
 */
function setPrefix(guildId, prefix) {
    prefixCache.set(guildId, prefix);
}

/**
 * Configure le handler de commandes sur le client Discord.
 */
function setupCommandHandler(client, modules) {
    client.on('messageCreate', async (message) => {
        // Ignorer les bots et les DMs
        if (message.author.bot || !message.guild) return;

        let prefix;
        try {
            prefix = await getPrefix(message.guild.id);
        } catch {
            prefix = PREFIX_DEFAULT;
        }

        if (!message.content.startsWith(prefix)) return;

        const content = message.content.slice(prefix.length).trim();
        if (!content) return;

        const args = content.split(/\s+/);
        const moduleName = args.shift().toLowerCase();

        // Trouver le module
        const mod = modules.get(moduleName);
        if (!mod) return; // Module inconnu → ignorer silencieusement

        let command;
        let commandFullName;
        let commandArgs;

        // Module avec commande unique sans nom (ex: !ai <question>, !aide)
        const unnamedCommand = mod.commands.find(c => c.name === null);
        if (unnamedCommand) {
            command = unnamedCommand;
            commandFullName = moduleName;
            commandArgs = args;
        } else {
            const subcommand = args.shift()?.toLowerCase();

            if (!subcommand) {
                // Pas de sous-commande, chercher un handler par défaut
                const defaultCmd = mod.commands.find(c => c.name === '_default');
                if (defaultCmd) {
                    command = defaultCmd;
                    commandFullName = moduleName;
                    commandArgs = [];
                } else {
                    await message.reply({
                        embeds: [createErrorEmbed(
                            `Utilisation : \`${prefix}${moduleName} <commande>\`\n` +
                            `Tapez \`${prefix}aide ${moduleName}\` pour voir les commandes disponibles.`
                        )],
                    });
                    return;
                }
            } else {
                // Chercher la commande par nom
                command = mod.commands.find(c => c.name === subcommand);

                if (!command) {
                    // Pas trouvé → essayer le handler par défaut avec le subcommand dans les args
                    const defaultCmd = mod.commands.find(c => c.name === '_default');
                    if (defaultCmd) {
                        command = defaultCmd;
                        commandFullName = moduleName;
                        commandArgs = [subcommand, ...args];
                    } else {
                        await message.reply({
                            embeds: [createErrorEmbed(
                                `Commande inconnue : \`${subcommand}\`.\n` +
                                `Tapez \`${prefix}aide ${moduleName}\` pour voir les commandes disponibles.`
                            )],
                        });
                        return;
                    }
                } else {
                    commandFullName = `${moduleName}.${subcommand}`;
                    commandArgs = args;
                }
            }
        }

        // Vérification des permissions
        let permResult;
        try {
            permResult = await checkPermission(message.guild, message.author.id, commandFullName, command);
        } catch (err) {
            console.error(`[Permissions] Erreur lors de la vérification:`, err.message);
            await message.reply({
                embeds: [createErrorEmbed('Erreur lors de la vérification des permissions.')],
            });
            return;
        }

        if (!permResult.allowed) {
            await message.reply({ embeds: [createErrorEmbed(permResult.reason)] });
            return;
        }

        // Exécution de la commande
        try {
            const context = {
                client,
                db: getDb(),
                prefix,
                modules,
                getPrefix,
                setPrefix,
            };
            await command.execute(message, commandArgs, context);
        } catch (err) {
            console.error(`[Commande] Erreur lors de '${commandFullName}':`, err);
            await message.reply({
                embeds: [createErrorEmbed('Une erreur est survenue lors de l\'exécution de cette commande.')],
            }).catch(() => {});
        }
    });
}

module.exports = { setupCommandHandler, getPrefix, setPrefix, PREFIX_DEFAULT };
