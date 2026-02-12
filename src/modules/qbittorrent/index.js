const { createEmbed, createErrorEmbed, createSuccessEmbed, COLORS } = require('../../utils/embeds');
const { requireConfig } = require('../_shared');

// Cache des cookies de session par guild
const sessionCookies = new Map();

module.exports = {
    name: 'qbit',
    description: 'Intégration qBittorrent',

    configSchema: [
        { key: 'url', label: 'URL de l\'interface web qBittorrent (ex: http://localhost:8080)', secret: false },
        { key: 'username', label: 'Nom d\'utilisateur qBittorrent', secret: false },
        { key: 'password', label: 'Mot de passe qBittorrent', secret: true },
    ],

    commands: [
        {
            name: 'torrents',
            description: 'Lister les torrents',
            usage: '!qbit torrents [filter]',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'qbit');
                if (!config) return;

                const filter = args[0] || 'all'; // all, downloading, seeding, paused
                const data = await qbitApi(config, message.guild.id, `/api/v2/torrents/info?filter=${filter}`);

                if (!data || data.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'Aucun torrent.', color: COLORS.info })] });
                }

                const torrents = data.slice(0, 15);
                const lines = torrents.map(t => {
                    const progress = Math.round(t.progress * 100);
                    const status = torrentStatus(t.state);
                    const size = formatSize(t.size);
                    return `${status} **${t.name.substring(0, 50)}** — ${progress}% (${size})`;
                });

                await message.reply({
                    embeds: [createEmbed({
                        title: `Torrents — ${filter} (${torrents.length}/${data.length})`,
                        description: lines.join('\n'),
                        color: COLORS.info,
                    })],
                });
            },
        },
        {
            name: 'stats',
            description: 'Statistiques de transfert',
            usage: '!qbit stats',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'qbit');
                if (!config) return;

                const data = await qbitApi(config, message.guild.id, '/api/v2/transfer/info');

                await message.reply({
                    embeds: [createEmbed({
                        title: 'Statistiques qBittorrent',
                        color: COLORS.info,
                        fields: [
                            { name: 'Téléchargement', value: `${formatSpeed(data.dl_info_speed)}`, inline: true },
                            { name: 'Upload', value: `${formatSpeed(data.up_info_speed)}`, inline: true },
                            { name: 'Total DL', value: formatSize(data.dl_info_data), inline: true },
                            { name: 'Total UP', value: formatSize(data.up_info_data), inline: true },
                        ],
                    })],
                });
            },
        },
        {
            name: 'pause',
            description: 'Mettre en pause tous les torrents',
            usage: '!qbit pause',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'qbit');
                if (!config) return;

                // qBittorrent >= 4.6.1 utilise /stop, anciennes versions /pause
                await qbitApiWithFallback(config, message.guild.id,
                    '/api/v2/torrents/stop', '/api/v2/torrents/pause',
                    'POST', 'hashes=all');
                await message.reply({ embeds: [createSuccessEmbed('Tous les torrents mis en pause.')] });
            },
        },
        {
            name: 'resume',
            description: 'Reprendre tous les torrents',
            usage: '!qbit resume',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'qbit');
                if (!config) return;

                // qBittorrent >= 4.6.1 utilise /start, anciennes versions /resume
                await qbitApiWithFallback(config, message.guild.id,
                    '/api/v2/torrents/start', '/api/v2/torrents/resume',
                    'POST', 'hashes=all');
                await message.reply({ embeds: [createSuccessEmbed('Tous les torrents repris.')] });
            },
        },
    ],
};

async function qbitLogin(config, guildId) {
    const url = `${config.url.replace(/\/$/, '')}/api/v2/auth/login`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=${encodeURIComponent(config.username)}&password=${encodeURIComponent(config.password)}`,
        redirect: 'manual',
    });

    const cookie = res.headers.get('set-cookie');
    if (cookie) {
        const sid = cookie.split(';')[0];
        sessionCookies.set(guildId, sid);
        return sid;
    }
    throw new Error('Impossible de se connecter à qBittorrent. Vérifiez les identifiants.');
}

async function qbitApi(config, guildId, endpoint, method = 'GET', body = null) {
    let cookie = sessionCookies.get(guildId);
    if (!cookie) {
        cookie = await qbitLogin(config, guildId);
    }

    const url = `${config.url.replace(/\/$/, '')}${endpoint}`;
    const options = {
        method,
        headers: { 'Cookie': cookie },
    };

    if (body) {
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        options.body = body;
    }

    let res = await fetch(url, options);

    // Si 403, re-login et réessayer
    if (res.status === 403) {
        cookie = await qbitLogin(config, guildId);
        options.headers['Cookie'] = cookie;
        res = await fetch(url, options);
    }

    if (!res.ok) throw new Error(`qBittorrent API: ${res.status} ${res.statusText}`);

    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function qbitApiWithFallback(config, guildId, primaryEndpoint, fallbackEndpoint, method, body) {
    try {
        return await qbitApi(config, guildId, primaryEndpoint, method, body);
    } catch (err) {
        if (err.message && err.message.includes('404')) {
            return await qbitApi(config, guildId, fallbackEndpoint, method, body);
        }
        throw err;
    }
}

function torrentStatus(state) {
    const icons = {
        uploading: '🌱', downloading: '⬇️', pausedDL: '⏸️', pausedUP: '⏸️',
        stalledDL: '⏳', stalledUP: '🌱', queuedDL: '📋', queuedUP: '📋',
        checkingDL: '🔍', checkingUP: '🔍', error: '❌', missingFiles: '❓',
    };
    return icons[state] || '❓';
}

function formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatSpeed(bytesPerSec) {
    return `${formatSize(bytesPerSec)}/s`;
}
