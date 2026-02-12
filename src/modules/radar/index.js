const { createEmbed, createErrorEmbed, COLORS } = require('../../utils/embeds');
const { requireConfig } = require('../_shared');

module.exports = {
    name: 'radar',
    description: 'Intégration Radar (Radarr)',

    configSchema: [
        { key: 'url', label: 'URL du serveur Radarr', secret: false },
        { key: 'api_key', label: 'Clé API Radarr', secret: true },
    ],

    commands: [
        {
            name: 'movies',
            description: 'Lister les films dans la bibliothèque',
            usage: '!radar movies [recherche]',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'radar');
                if (!config) return;

                const data = await radarrApi(config, '/api/v3/movie');
                if (!data || data.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'Bibliothèque vide.', color: COLORS.info })] });
                }

                let movies = data;
                const search = args.join(' ').toLowerCase();
                if (search) {
                    movies = movies.filter(m => m.title.toLowerCase().includes(search));
                }

                movies = movies.slice(0, 15);

                const lines = movies.map(m => {
                    const status = m.hasFile ? '✅' : '⏳';
                    const year = m.year || '?';
                    return `${status} **${m.title}** (${year})`;
                });

                await message.reply({
                    embeds: [createEmbed({
                        title: `Films${search ? ` — "${search}"` : ''} (${movies.length}/${data.length})`,
                        description: lines.join('\n') || 'Aucun résultat.',
                        color: COLORS.info,
                    })],
                });
            },
        },
        {
            name: 'status',
            description: 'État du système Radarr',
            usage: '!radar status',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'radar');
                if (!config) return;

                const data = await radarrApi(config, '/api/v3/system/status');

                await message.reply({
                    embeds: [createEmbed({
                        title: 'État de Radarr',
                        color: COLORS.success,
                        fields: [
                            { name: 'Version', value: data.version || '?', inline: true },
                            { name: 'OS', value: data.osName || '?', inline: true },
                            { name: 'Démarrage', value: data.startTime ? new Date(data.startTime).toLocaleString('fr-FR') : '?', inline: true },
                        ],
                    })],
                });
            },
        },
        {
            name: 'queue',
            description: 'Voir la file de téléchargement',
            usage: '!radar queue',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'radar');
                if (!config) return;

                const data = await radarrApi(config, '/api/v3/queue?pageSize=10');

                if (!data?.records || data.records.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'File de téléchargement vide.', color: COLORS.info })] });
                }

                const lines = data.records.map(r => {
                    const progress = r.sizeleft && r.size ? Math.round((1 - r.sizeleft / r.size) * 100) : 0;
                    return `⬇️ **${r.title || 'Inconnu'}** — ${progress}%`;
                });

                await message.reply({
                    embeds: [createEmbed({
                        title: 'File de téléchargement',
                        description: lines.join('\n'),
                        color: COLORS.info,
                    })],
                });
            },
        },
    ],
};

async function radarrApi(config, endpoint) {
    const url = `${config.url.replace(/\/$/, '')}${endpoint}`;
    const separator = endpoint.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${separator}apikey=${config.api_key}`);
    if (!res.ok) throw new Error(`Radarr API: ${res.status} ${res.statusText}`);
    return res.json();
}
