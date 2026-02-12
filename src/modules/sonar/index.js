const { createEmbed, createErrorEmbed, COLORS } = require('../../utils/embeds');
const { requireConfig } = require('../_shared');

module.exports = {
    name: 'sonar',
    description: 'Intégration SonarQube',

    configSchema: [
        { key: 'url', label: 'URL du serveur SonarQube', secret: false },
        { key: 'token', label: 'Token d\'authentification SonarQube', secret: true },
    ],

    commands: [
        {
            name: 'projects',
            description: 'Lister les projets SonarQube',
            usage: '!sonar projects',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'sonar');
                if (!config) return;

                const data = await sonarApi(config, '/api/projects/search?ps=20');

                if (!data?.components || data.components.length === 0) {
                    return message.reply({ embeds: [createEmbed({ description: 'Aucun projet trouvé.', color: COLORS.info })] });
                }

                const lines = data.components.map(p => `**${p.key}** — _${p.name}_`);

                await message.reply({
                    embeds: [createEmbed({
                        title: 'Projets SonarQube',
                        description: lines.join('\n'),
                        color: COLORS.info,
                    })],
                });
            },
        },
        {
            name: 'quality',
            description: 'Voir la qualité d\'un projet',
            usage: '!sonar quality <project_key>',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'sonar');
                if (!config) return;

                const projectKey = args[0];
                if (!projectKey) {
                    return message.reply({ embeds: [createErrorEmbed('Usage : `!sonar quality <project_key>`')] });
                }

                const data = await sonarApi(config,
                    `/api/measures/component?component=${encodeURIComponent(projectKey)}&metricKeys=bugs,vulnerabilities,code_smells,coverage,duplicated_lines_density,ncloc,reliability_rating,security_rating,sqale_rating`
                );

                if (!data?.component?.measures) {
                    return message.reply({ embeds: [createErrorEmbed('Projet introuvable ou aucune mesure disponible.')] });
                }

                const measures = {};
                for (const m of data.component.measures) {
                    measures[m.metric] = m.value;
                }

                const rating = v => ['', 'A', 'B', 'C', 'D', 'E'][parseInt(v)] || '?';

                await message.reply({
                    embeds: [createEmbed({
                        title: `Qualité — ${projectKey}`,
                        color: COLORS.info,
                        fields: [
                            { name: 'Bugs', value: measures.bugs || '0', inline: true },
                            { name: 'Vulnérabilités', value: measures.vulnerabilities || '0', inline: true },
                            { name: 'Code Smells', value: measures.code_smells || '0', inline: true },
                            { name: 'Couverture', value: `${measures.coverage || '0'}%`, inline: true },
                            { name: 'Duplication', value: `${measures.duplicated_lines_density || '0'}%`, inline: true },
                            { name: 'Lignes', value: measures.ncloc || '0', inline: true },
                            { name: 'Fiabilité', value: rating(measures.reliability_rating), inline: true },
                            { name: 'Sécurité', value: rating(measures.security_rating), inline: true },
                            { name: 'Maintenabilité', value: rating(measures.sqale_rating), inline: true },
                        ],
                    })],
                });
            },
        },
        {
            name: 'status',
            description: 'Voir le statut du Quality Gate',
            usage: '!sonar status <project_key>',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'sonar');
                if (!config) return;

                const projectKey = args[0];
                if (!projectKey) {
                    return message.reply({ embeds: [createErrorEmbed('Usage : `!sonar status <project_key>`')] });
                }

                const data = await sonarApi(config, `/api/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}`);

                if (!data?.projectStatus) {
                    return message.reply({ embeds: [createErrorEmbed('Impossible de récupérer le statut.')] });
                }

                const status = data.projectStatus.status;
                const icon = status === 'OK' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
                const color = status === 'OK' ? COLORS.success : status === 'WARN' ? COLORS.warning : COLORS.error;

                await message.reply({
                    embeds: [createEmbed({
                        title: `Quality Gate — ${projectKey}`,
                        description: `${icon} **${status}**`,
                        color,
                    })],
                });
            },
        },
    ],
};

async function sonarApi(config, endpoint) {
    const url = `${config.url.replace(/\/$/, '')}${endpoint}`;
    const auth = Buffer.from(`${config.token}:`).toString('base64');
    const res = await fetch(url, {
        headers: { 'Authorization': `Basic ${auth}` },
    });
    if (!res.ok) throw new Error(`SonarQube API: ${res.status} ${res.statusText}`);
    return res.json();
}
