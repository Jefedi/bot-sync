const { createEmbed, createErrorEmbed, COLORS } = require('../../utils/embeds');
const { requireConfig } = require('../_shared');

module.exports = {
    name: 'github',
    description: 'Intégration GitHub',

    configSchema: [
        { key: 'token', label: 'Token d\'accès personnel GitHub', secret: true },
    ],

    commands: [
        {
            name: 'repos',
            description: 'Lister vos dépôts',
            usage: '!github repos',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'github');
                if (!config) return;

                const data = await githubApi(config, '/user/repos?sort=updated&per_page=15');

                if (!data || data.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'Aucun dépôt trouvé.', color: COLORS.info })] });
                }

                const lines = data.map(r => {
                    const vis = r.private ? '🔒' : '🌐';
                    return `${vis} **[${r.full_name}](${r.html_url})** — _${r.description || 'pas de description'}_`;
                });

                await message.reply({
                    embeds: [createEmbed({
                        title: 'Dépôts GitHub',
                        description: lines.join('\n'),
                        color: COLORS.info,
                    })],
                });
            },
        },
        {
            name: 'issues',
            description: 'Voir les issues d\'un dépôt',
            usage: '!github issues <owner/repo>',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'github');
                if (!config) return;

                const repo = args[0];
                if (!repo || !repo.includes('/')) {
                    return message.reply({ embeds: [createErrorEmbed('Usage : `!github issues <owner/repo>`')] });
                }

                const data = await githubApi(config, `/repos/${repo}/issues?state=open&per_page=10`);

                if (!data || data.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'Aucune issue ouverte.', color: COLORS.info })] });
                }

                const lines = data
                    .filter(i => !i.pull_request)
                    .map(i => `**#${i.number}** — [${i.title}](${i.html_url})`);

                await message.reply({
                    embeds: [createEmbed({
                        title: `Issues — ${repo}`,
                        description: lines.join('\n') || 'Aucune issue (seulement des PRs).',
                        color: COLORS.info,
                    })],
                });
            },
        },
        {
            name: 'prs',
            description: 'Voir les pull requests ouvertes',
            usage: '!github prs <owner/repo>',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'github');
                if (!config) return;

                const repo = args[0];
                if (!repo || !repo.includes('/')) {
                    return message.reply({ embeds: [createErrorEmbed('Usage : `!github prs <owner/repo>`')] });
                }

                const data = await githubApi(config, `/repos/${repo}/pulls?state=open&per_page=10`);

                if (!data || data.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'Aucune PR ouverte.', color: COLORS.info })] });
                }

                const lines = data.map(pr => `**#${pr.number}** — [${pr.title}](${pr.html_url}) par _${pr.user?.login || 'inconnu'}_`);

                await message.reply({
                    embeds: [createEmbed({
                        title: `Pull Requests — ${repo}`,
                        description: lines.join('\n'),
                        color: COLORS.info,
                    })],
                });
            },
        },
        {
            name: 'actions',
            description: 'Voir les derniers workflow runs',
            usage: '!github actions <owner/repo>',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'github');
                if (!config) return;

                const repo = args[0];
                if (!repo || !repo.includes('/')) {
                    return message.reply({ embeds: [createErrorEmbed('Usage : `!github actions <owner/repo>`')] });
                }

                const data = await githubApi(config, `/repos/${repo}/actions/runs?per_page=5`);

                if (!data?.workflow_runs || data.workflow_runs.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'Aucun workflow run.', color: COLORS.info })] });
                }

                const lines = data.workflow_runs.map(r => {
                    const status = runStatus(r.conclusion || r.status);
                    const date = new Date(r.created_at).toLocaleDateString('fr-FR');
                    return `${status} **${r.name}** — ${r.head_branch} _(${date})_`;
                });

                await message.reply({
                    embeds: [createEmbed({
                        title: `Actions — ${repo}`,
                        description: lines.join('\n'),
                        color: COLORS.info,
                    })],
                });
            },
        },
    ],
};

async function githubApi(config, endpoint) {
    const res = await fetch(`https://api.github.com${endpoint}`, {
        headers: {
            'Authorization': `Bearer ${config.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'bot-sync-discord',
        },
    });
    if (!res.ok) throw new Error(`GitHub API: ${res.status} ${res.statusText}`);
    return res.json();
}

function runStatus(status) {
    const icons = {
        success: '✅', failure: '❌', in_progress: '🔄', queued: '⏳',
        cancelled: '🚫', skipped: '⏭️',
    };
    return icons[status] || '❓';
}
