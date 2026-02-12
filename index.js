require('dotenv').config();

const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const { initDb } = require('./src/database');
const { getCommands, handleCommand, handleAutocomplete } = require('./src/syncRoles');
const { onMemberUpdate, resyncOnReady, startExpirationChecker } = require('./src/syncListener');

// Créer le client Discord avec les intents nécessaires
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
    ],
});

// ──────────────────────────────────────────────
// Événement ready : enregistrement des commandes + resync
// ──────────────────────────────────────────────

client.once('ready', async () => {
    console.log(`Connecté en tant que ${client.user.tag}`);

    // Enregistrer les commandes slash globalement
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    const commands = getCommands();

    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        console.log(`${commands.length} commande(s) slash enregistrée(s).`);
    } catch (error) {
        console.error("Erreur lors de l'enregistrement des commandes:", error);
    }

    // Resync au démarrage
    await resyncOnReady(client);

    // Lancer la vérification des expirations (toutes les minutes)
    startExpirationChecker(client);
});

// ──────────────────────────────────────────────
// Gestion des interactions (commandes + autocomplete)
// ──────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete()) {
        return handleAutocomplete(interaction);
    }
    if (interaction.isChatInputCommand()) {
        return handleCommand(interaction);
    }
});

// ──────────────────────────────────────────────
// Écoute des changements de rôles en temps réel
// ──────────────────────────────────────────────

client.on('guildMemberUpdate', (oldMember, newMember) => {
    onMemberUpdate(client, oldMember, newMember).catch(error => {
        console.error('Erreur lors de la synchronisation de rôle:', error);
    });
});

// ──────────────────────────────────────────────
// Démarrage
// ──────────────────────────────────────────────

async function main() {
    await initDb();
    await client.login(process.env.DISCORD_TOKEN);
}

main().catch(error => {
    console.error('Erreur fatale:', error);
    process.exit(1);
});
