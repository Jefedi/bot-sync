const { createSuccessEmbed, createErrorEmbed, createInfoEmbed, createEmbed, COLORS } = require('../../utils/embeds');
const { logAudit } = require('../../utils/logger');
const { parseChannelMention } = require('../../utils/helpers');
const { setPrefix } = require('../../core/commandHandler');

module.exports = {
    name: 'config',
    description: 'Configuration du bot et des services',

    commands: [
        // !config list → liste des services et leur état
        {
            name: 'list',
            description: 'Voir tous les services et leur état de configuration',
            usage: '!config list',
            ownerOnly: true,
            execute: async (message, args, context) => {
                const guildId = message.guild.id;

                // Récupérer les configs existantes
                const { data: configs } = await context.db
                    .from('service_configs')
                    .select('service, config_key')
                    .eq('guild_id', guildId);

                const configuredServices = new Set();
                if (configs) {
                    for (const c of configs) {
                        configuredServices.add(c.service);
                    }
                }

                // Lister tous les modules avec configSchema
                let description = '';
                for (const [modName, mod] of context.modules) {
                    if (!mod.configSchema || mod.configSchema.length === 0) continue;

                    const isConfigured = configuredServices.has(modName);
                    const status = isConfigured ? '✅ Configuré' : '❌ Non configuré';
                    description += `**${modName}** — ${mod.description}\n${status}\n\n`;
                }

                if (!description) {
                    description = 'Aucun module configurable trouvé.';
                }

                // Ajouter les paramètres du bot
                const { data: settings } = await context.db
                    .from('guild_settings')
                    .select('*')
                    .eq('guild_id', guildId)
                    .single();

                const prefix = settings?.prefix || '!';
                const logChannel = settings?.log_channel_id ? `<#${settings.log_channel_id}>` : '_non configuré_';

                description += `---\n**Paramètres du bot :**\n` +
                    `Préfixe : \`${prefix}\`\n` +
                    `Canal de logs : ${logChannel}\n`;

                await message.reply({
                    embeds: [createEmbed({
                        title: 'Configuration des services',
                        description,
                        color: COLORS.info,
                    })],
                });
            },
        },

        // !config prefix <nouveau>
        {
            name: 'prefix',
            description: 'Changer le préfixe des commandes',
            usage: '!config prefix <nouveau_préfixe>',
            ownerOnly: true,
            execute: async (message, args, context) => {
                const newPrefix = args[0];
                if (!newPrefix || newPrefix.length > 5) {
                    return message.reply({
                        embeds: [createErrorEmbed('Usage : `!config prefix <nouveau>`\nLe préfixe doit faire entre 1 et 5 caractères.')],
                    });
                }

                await context.db
                    .from('guild_settings')
                    .upsert({
                        guild_id: message.guild.id,
                        prefix: newPrefix,
                        updated_at: new Date().toISOString(),
                    }, { onConflict: 'guild_id' });

                setPrefix(message.guild.id, newPrefix);

                await message.reply({
                    embeds: [createSuccessEmbed(`Préfixe changé en \`${newPrefix}\`.\nExemple : \`${newPrefix}aide\``)],
                });

                await logAudit(context.db, {
                    guildId: message.guild.id,
                    module: 'config',
                    action: 'prefix_changed',
                    userId: message.author.id,
                    userTag: message.author.tag,
                    details: { prefix: newPrefix },
                });
            },
        },

        // !config log <#canal>
        {
            name: 'log',
            description: 'Définir le canal de logs',
            usage: '!config log <#canal>',
            ownerOnly: true,
            execute: async (message, args, context) => {
                const channelId = parseChannelMention(args[0]);
                if (!channelId) {
                    return message.reply({
                        embeds: [createErrorEmbed('Usage : `!config log <#canal>`\nMentionnez un canal textuel.')],
                    });
                }

                const channel = message.guild.channels.cache.get(channelId);
                if (!channel || !channel.isTextBased()) {
                    return message.reply({
                        embeds: [createErrorEmbed('Canal invalide ou non textuel.')],
                    });
                }

                await context.db
                    .from('guild_settings')
                    .upsert({
                        guild_id: message.guild.id,
                        log_channel_id: channelId,
                        updated_at: new Date().toISOString(),
                    }, { onConflict: 'guild_id' });

                await message.reply({
                    embeds: [createSuccessEmbed(`Canal de logs défini sur <#${channelId}>.`)],
                });
            },
        },

        // _default → !config <service> [status|reset] → configuration interactive
        {
            name: '_default',
            description: 'Configurer un service de manière interactive',
            usage: '!config <service> [status|reset]',
            ownerOnly: true,
            execute: async (message, args, context) => {
                const serviceName = args[0]?.toLowerCase();
                const action = args[1]?.toLowerCase();

                if (!serviceName) {
                    return message.reply({
                        embeds: [createErrorEmbed(
                            'Usage :\n' +
                            '`!config <service>` — Configurer un service\n' +
                            '`!config <service> status` — Voir l\'état de la configuration\n' +
                            '`!config <service> reset` — Supprimer la configuration\n' +
                            '`!config list` — Voir tous les services'
                        )],
                    });
                }

                // Trouver le module correspondant
                const mod = context.modules.get(serviceName);
                if (!mod || !mod.configSchema || mod.configSchema.length === 0) {
                    return message.reply({
                        embeds: [createErrorEmbed(`Le service **${serviceName}** n'existe pas ou n'est pas configurable.`)],
                    });
                }

                // Sous-action : status
                if (action === 'status') {
                    return handleConfigStatus(message, context, serviceName, mod);
                }

                // Sous-action : reset
                if (action === 'reset') {
                    return handleConfigReset(message, context, serviceName);
                }

                // Configuration interactive
                return handleConfigInteractive(message, context, serviceName, mod);
            },
        },
    ],
};

// --- Configuration interactive ---

async function handleConfigInteractive(message, context, serviceName, mod) {
    const schema = mod.configSchema;
    const guildId = message.guild.id;

    await message.reply({
        embeds: [createInfoEmbed(
            `⚙️ **Configuration de ${mod.description || serviceName}**\n` +
            `${schema.length} paramètre(s) à configurer. Vous avez 60 secondes par étape.\n` +
            `Tapez \`annuler\` pour abandonner.`
        )],
    });

    const collected = {};

    for (let i = 0; i < schema.length; i++) {
        const field = schema[i];
        const stepMsg = await message.channel.send({
            embeds: [createInfoEmbed(
                `**Étape ${i + 1}/${schema.length}** — ${field.label}\n` +
                (field.secret ? '⚠️ _Votre message sera supprimé après lecture._' : '')
            )],
        });

        // Attendre la réponse
        let response;
        try {
            const filter = m => m.author.id === message.author.id;
            const collected_msgs = await message.channel.awaitMessages({
                filter,
                max: 1,
                time: 60000,
                errors: ['time'],
            });
            response = collected_msgs.first();
        } catch {
            await message.channel.send({
                embeds: [createErrorEmbed('Temps écoulé. Configuration annulée.')],
            });
            return;
        }

        // Annulation
        if (response.content.toLowerCase() === 'annuler') {
            await message.channel.send({
                embeds: [createErrorEmbed('Configuration annulée.')],
            });
            return;
        }

        const value = response.content.trim();

        // Supprimer le message si c'est un secret
        if (field.secret) {
            try {
                await response.delete();
            } catch {
                // Pas les permissions de supprimer, on prévient
                await message.channel.send({
                    embeds: [createErrorEmbed(
                        '⚠️ Impossible de supprimer votre message. Supprimez-le manuellement pour protéger vos données.'
                    )],
                });
            }
        }

        collected[field.key] = { value, secret: field.secret || false };

        // Confirmation de l'étape
        const displayValue = field.secret ? '••••••••' : value;
        await message.channel.send({
            embeds: [createSuccessEmbed(`${field.label} : \`${displayValue}\``)],
        });
    }

    // Sauvegarder dans la base de données
    for (const [key, { value, secret }] of Object.entries(collected)) {
        await context.db
            .from('service_configs')
            .upsert({
                guild_id: guildId,
                service: serviceName,
                config_key: key,
                config_value: value,
                is_secret: secret,
                configured_by: message.author.id,
                configured_at: new Date().toISOString(),
            }, { onConflict: 'guild_id,service,config_key' });
    }

    await message.channel.send({
        embeds: [createSuccessEmbed(`**${serviceName}** configuré avec succès !`)],
    });

    await logAudit(context.db, {
        guildId,
        module: 'config',
        action: 'service_configured',
        userId: message.author.id,
        userTag: message.author.tag,
        details: { service: serviceName, fields: Object.keys(collected) },
    });
}

async function handleConfigStatus(message, context, serviceName, mod) {
    const { data: configs } = await context.db
        .from('service_configs')
        .select('config_key, is_secret, configured_at')
        .eq('guild_id', message.guild.id)
        .eq('service', serviceName);

    if (!configs || configs.length === 0) {
        return message.reply({
            embeds: [createErrorEmbed(`**${serviceName}** n'est pas configuré. Utilisez \`!config ${serviceName}\` pour le configurer.`)],
        });
    }

    const fields = configs.map(c => ({
        name: c.config_key,
        value: c.is_secret ? '`••••••••`' : '`configuré`',
        inline: true,
    }));

    await message.reply({
        embeds: [createEmbed({
            title: `Configuration de ${serviceName}`,
            description: `Configuré le ${new Date(configs[0].configured_at).toLocaleDateString('fr-FR')}`,
            color: COLORS.success,
            fields,
        })],
    });
}

async function handleConfigReset(message, context, serviceName) {
    const { error } = await context.db
        .from('service_configs')
        .delete()
        .eq('guild_id', message.guild.id)
        .eq('service', serviceName);

    if (error) throw error;

    await message.reply({
        embeds: [createSuccessEmbed(`Configuration de **${serviceName}** supprimée.`)],
    });

    await logAudit(context.db, {
        guildId: message.guild.id,
        module: 'config',
        action: 'service_config_reset',
        userId: message.author.id,
        userTag: message.author.tag,
        details: { service: serviceName },
    });
}
