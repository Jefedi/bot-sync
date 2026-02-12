const { createEmbed, createErrorEmbed, COLORS } = require('../../utils/embeds');
const { requireConfig } = require('../_shared');

module.exports = {
    name: 'ai',
    description: 'Intégration Open WebUI (modèles IA)',

    configSchema: [
        { key: 'url', label: 'URL du serveur Open WebUI (ex: http://localhost:3000)', secret: false },
        { key: 'api_key', label: 'Clé API Open WebUI', secret: true },
    ],

    commands: [
        // !ai <question>
        {
            name: null, // Commande directe
            description: 'Poser une question à l\'IA',
            usage: '!ai <question>',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'ai');
                if (!config) return;

                const question = args.join(' ');
                if (!question) {
                    return message.reply({
                        embeds: [createErrorEmbed('Usage : `!ai <question>`\nExemple : `!ai Explique-moi les trous noirs`')],
                    });
                }

                // Indicateur de chargement
                const loading = await message.reply('💭 Réflexion en cours...');

                try {
                    const url = `${config.url.replace(/\/$/, '')}/api/chat/completions`;
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${config.api_key}`,
                        },
                        body: JSON.stringify({
                            messages: [
                                { role: 'user', content: question },
                            ],
                        }),
                    });

                    if (!res.ok) {
                        const errText = await res.text().catch(() => '');
                        throw new Error(`Open WebUI: ${res.status} ${errText}`);
                    }

                    const data = await res.json();
                    const answer = data.choices?.[0]?.message?.content;

                    if (!answer) {
                        await loading.edit({
                            content: null,
                            embeds: [createErrorEmbed('Aucune réponse reçue du modèle.')],
                        });
                        return;
                    }

                    // Discord a une limite de 4096 caractères pour les embeds
                    const truncated = answer.length > 4000
                        ? answer.substring(0, 4000) + '\n\n_... (réponse tronquée)_'
                        : answer;

                    await loading.edit({
                        content: null,
                        embeds: [createEmbed({
                            title: '🤖 Réponse IA',
                            description: truncated,
                            color: COLORS.info,
                            footer: `Question : ${question.substring(0, 100)}${question.length > 100 ? '...' : ''}`,
                        })],
                    });
                } catch (err) {
                    await loading.edit({
                        content: null,
                        embeds: [createErrorEmbed(`Erreur IA : ${err.message}`)],
                    }).catch(() => {});
                    throw err;
                }
            },
        },
    ],
};
