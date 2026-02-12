const { createEmbed, createErrorEmbed, COLORS } = require('../../utils/embeds');
const { getServiceConfig, requireConfig } = require('../_shared');

module.exports = {
    name: 'gitlab',
    description: 'Intégration GitLab',

    configSchema: [
        { key: 'url', label: 'URL du serveur GitLab (ex: https://gitlab.com)', secret: false },
        { key: 'token', label: 'Token d\'accès personnel GitLab', secret: true },
    ],

    commands: [
        {
            name: 'pipelines',
            description: 'Voir les derniers pipelines d\'un projet',
            usage: '!gitlab pipelines <projet>',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'gitlab');
                if (!config) return;

                const project = args.join(' ');
                if (!project) {
                    return message.reply({ embeds: [createErrorEmbed('Usage : `!gitlab pipelines <nom_ou_id_projet>`')] });
                }

                const encoded = encodeURIComponent(project);
                const data = await gitlabApi(config, `/projects/${encoded}/pipelines?per_page=5`);

                if (!data || data.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'Aucun pipeline trouvé.', color: COLORS.info })] });
                }

                const lines = data.map(p => {
                    const status = pipelineStatus(p.status);
                    const date = new Date(p.created_at).toLocaleDateString('fr-FR');
                    return `${status} **#${p.id}** — ${p.ref} — ${p.status} _(${date})_`;
                });

                await message.reply({
                    embeds: [createEmbed({
                        title: `Pipelines — ${project}`,
                        description: lines.join('\n'),
                        color: COLORS.info,
                    })],
                });
            },
        },
        {
            name: 'issues',
            description: 'Voir les issues ouvertes d\'un projet',
            usage: '!gitlab issues <projet>',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'gitlab');
                if (!config) return;

                const project = args.join(' ');
                if (!project) {
                    return message.reply({ embeds: [createErrorEmbed('Usage : `!gitlab issues <nom_ou_id_projet>`')] });
                }

                const encoded = encodeURIComponent(project);
                const data = await gitlabApi(config, `/projects/${encoded}/issues?state=opened&per_page=10`);

                if (!data || data.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'Aucune issue ouverte.', color: COLORS.info })] });
                }

                const lines = data.map(i => `**#${i.iid}** — [${i.title}](${i.web_url})`);

                await message.reply({
                    embeds: [createEmbed({
                        title: `Issues ouvertes — ${project}`,
                        description: lines.join('\n'),
                        color: COLORS.info,
                    })],
                });
            },
        },
        {
            name: 'mrs',
            description: 'Voir les merge requests ouvertes',
            usage: '!gitlab mrs <projet>',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'gitlab');
                if (!config) return;

                const project = args.join(' ');
                if (!project) {
                    return message.reply({ embeds: [createErrorEmbed('Usage : `!gitlab mrs <nom_ou_id_projet>`')] });
                }

                const encoded = encodeURIComponent(project);
                const data = await gitlabApi(config, `/projects/${encoded}/merge_requests?state=opened&per_page=10`);

                if (!data || data.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'Aucune MR ouverte.', color: COLORS.info })] });
                }

                const lines = data.map(mr => `**!${mr.iid}** — [${mr.title}](${mr.web_url}) par _${mr.author?.name || 'inconnu'}_`);

                await message.reply({
                    embeds: [createEmbed({
                        title: `Merge Requests — ${project}`,
                        description: lines.join('\n'),
                        color: COLORS.info,
                    })],
                });
            },
        },
        {
            name: 'projects',
            description: 'Lister les projets accessibles',
            usage: '!gitlab projects',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'gitlab');
                if (!config) return;

                const data = await gitlabApi(config, '/projects?membership=true&per_page=20&order_by=last_activity_at');

                if (!data || data.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'Aucun projet accessible.', color: COLORS.info })] });
                }

                const lines = data.map(p => `**${p.path_with_namespace}** — _${p.description || 'pas de description'}_`);

                await message.reply({
                    embeds: [createEmbed({
                        title: 'Projets GitLab',
                        description: lines.join('\n'),
                        color: COLORS.info,
                    })],
                });
            },
        },
    ],
};

async function gitlabApi(config, endpoint) {
    const url = `${config.url.replace(/\/$/, '')}/api/v4${endpoint}`;
    const res = await fetch(url, {
        headers: { 'PRIVATE-TOKEN': config.token },
    });
    if (!res.ok) throw new Error(`GitLab API: ${res.status} ${res.statusText}`);
    return res.json();
}

function pipelineStatus(status) {
    const icons = {
        success: '✅', failed: '❌', running: '🔄', pending: '⏳',
        canceled: '🚫', skipped: '⏭️', manual: '👆',
    };
    return icons[status] || '❓';
}
