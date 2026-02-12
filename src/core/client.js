const { Client, GatewayIntentBits, Partials } = require('discord.js');

/**
 * Crée et retourne le client Discord avec les intents nécessaires.
 * MessageContent est requis pour lire le contenu des messages (commandes par préfixe).
 * GuildMembers est requis pour la synchronisation des rôles.
 */
function createBotClient() {
    return new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ],
        partials: [Partials.Message],
    });
}

module.exports = { createBotClient };
