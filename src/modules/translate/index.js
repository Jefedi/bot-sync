const { createEmbed, createErrorEmbed, COLORS } = require('../../utils/embeds');
const { requireConfig } = require('../_shared');

module.exports = {
    name: 'translate',
    description: 'Traduction via LibreTranslate',

    configSchema: [
        { key: 'url', label: 'URL du serveur LibreTranslate (ex: http://localhost:5000)', secret: false },
    ],

    commands: [
        // !translate <source> <cible> <texte>
        {
            name: null, // Commande directe : !translate fr en Bonjour le monde
            description: 'Traduire un texte',
            usage: '!translate <langue_source> <langue_cible> <texte>',
            execute: async (message, args, context) => {
                const config = await requireConfig(message, context, 'translate');
                if (!config) return;

                const source = args[0];
                const target = args[1];
                const text = args.slice(2).join(' ');

                if (!source || !target || !text) {
                    return message.reply({
                        embeds: [createErrorEmbed(
                            'Usage : `!translate <source> <cible> <texte>`\n' +
                            'Exemple : `!translate fr en Bonjour le monde`\n\n' +
                            'Codes langue : `fr`, `en`, `es`, `de`, `it`, `pt`, `ru`, `zh`, `ja`, `ar`...\n' +
                            'Utilisez `!translate langs` pour voir les langues disponibles.'
                        )],
                    });
                }

                // Cas spécial : lister les langues
                if (source === 'langs') {
                    return listLanguages(message, config);
                }

                const url = `${config.url.replace(/\/$/, '')}/translate`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: text, source, target, format: 'text' }),
                });

                if (!res.ok) {
                    const err = await res.text().catch(() => '');
                    throw new Error(`LibreTranslate: ${res.status} ${err}`);
                }

                const data = await res.json();
                const translated = data.translatedText;

                await message.reply({
                    embeds: [createEmbed({
                        description: `**${source.toUpperCase()}** → **${target.toUpperCase()}**\n\n` +
                            `📝 ${text}\n\n` +
                            `🔄 ${translated}`,
                        color: COLORS.info,
                    })],
                });
            },
        },
    ],
};

async function listLanguages(message, config) {
    const url = `${config.url.replace(/\/$/, '')}/languages`;
    const res = await fetch(url);

    if (!res.ok) throw new Error(`LibreTranslate: ${res.status}`);

    const langs = await res.json();
    const lines = langs.map(l => `\`${l.code}\` — ${l.name}`);

    await message.reply({
        embeds: [createEmbed({
            title: 'Langues disponibles',
            description: lines.join('\n') || 'Aucune langue disponible.',
            color: COLORS.info,
        })],
    });
}
