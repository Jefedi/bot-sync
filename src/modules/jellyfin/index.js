const { createEmbed, createErrorEmbed, COLORS } = require('../../utils/embeds');
const { requireConfig } = require('../_shared');

module.exports = {
    name: 'jellyfin',
    description: 'Intégration Jellyfin',

    configSchema: [
        { key: 'url', label: 'URL du serveur Jellyfin', secret: false },
        { key: 'api_key', label: 'Clé API Jellyfin', secret: true },
    ],

    commands: [
        {
            name: 'libraries',
            description: 'Lister les bibliothèques',
            usage: '!jellyfin libraries',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'jellyfin');
                if (!config) return;

                const data = await jellyfinApi(config, '/Library/VirtualFolders');

                if (!data || data.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'Aucune bibliothèque trouvée.', color: COLORS.info })] });
                }

                const lines = data.map(lib => {
                    const type = lib.CollectionType || 'mixte';
                    return `📁 **${lib.Name}** — _${type}_`;
                });

                await message.reply({
                    embeds: [createEmbed({
                        title: 'Bibliothèques Jellyfin',
                        description: lines.join('\n'),
                        color: COLORS.info,
                    })],
                });
            },
        },
        {
            name: 'sessions',
            description: 'Voir les sessions actives',
            usage: '!jellyfin sessions',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'jellyfin');
                if (!config) return;

                const data = await jellyfinApi(config, '/Sessions');

                const active = data?.filter(s => s.NowPlayingItem) || [];

                if (active.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'Aucune session de lecture en cours.', color: COLORS.info })] });
                }

                const lines = active.map(s => {
                    const user = s.UserName || 'Inconnu';
                    const item = s.NowPlayingItem?.Name || 'Inconnu';
                    const type = s.NowPlayingItem?.Type || '';
                    const client = s.Client || '?';
                    return `▶️ **${user}** regarde _${item}_ (${type}) via ${client}`;
                });

                await message.reply({
                    embeds: [createEmbed({
                        title: `Sessions actives (${active.length})`,
                        description: lines.join('\n'),
                        color: COLORS.success,
                    })],
                });
            },
        },
        {
            name: 'users',
            description: 'Lister les utilisateurs Jellyfin',
            usage: '!jellyfin users',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'jellyfin');
                if (!config) return;

                const data = await jellyfinApi(config, '/Users');

                if (!data || data.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'Aucun utilisateur.', color: COLORS.info })] });
                }

                const lines = data.map(u => {
                    const lastActive = u.LastActivityDate ? new Date(u.LastActivityDate).toLocaleDateString('fr-FR') : 'jamais';
                    const admin = u.Policy?.IsAdministrator ? ' 👑' : '';
                    return `👤 **${u.Name}**${admin} — dernière activité : ${lastActive}`;
                });

                await message.reply({
                    embeds: [createEmbed({
                        title: 'Utilisateurs Jellyfin',
                        description: lines.join('\n'),
                        color: COLORS.info,
                    })],
                });
            },
        },
        {
            name: 'info',
            description: 'Informations sur le serveur Jellyfin',
            usage: '!jellyfin info',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'jellyfin');
                if (!config) return;

                const data = await jellyfinApi(config, '/System/Info');

                await message.reply({
                    embeds: [createEmbed({
                        title: 'Serveur Jellyfin',
                        color: COLORS.info,
                        fields: [
                            { name: 'Nom', value: data.ServerName || '?', inline: true },
                            { name: 'Version', value: data.Version || '?', inline: true },
                            { name: 'OS', value: data.OperatingSystem || '?', inline: true },
                        ],
                    })],
                });
            },
        },
    ],
};

async function jellyfinApi(config, endpoint) {
    const url = `${config.url.replace(/\/$/, '')}${endpoint}`;
    const res = await fetch(url, {
        headers: {
            'X-Emby-Token': config.api_key,
        },
    });
    if (!res.ok) throw new Error(`Jellyfin API: ${res.status} ${res.statusText}`);
    return res.json();
}
