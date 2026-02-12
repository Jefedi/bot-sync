require('dotenv').config();

const { createBotClient } = require('./src/core/client');
const { initDb, getDb } = require('./src/core/database');
const { loadModules } = require('./src/core/moduleLoader');
const { setupCommandHandler } = require('./src/core/commandHandler');

async function main() {
    console.log('=== Bot Polyvalent v2.0 ===');

    // 1. Initialiser la base de données
    await initDb();

    // 2. Créer le client Discord
    const client = createBotClient();

    // 3. Charger les modules
    const modules = loadModules();

    // 4. Configurer le handler de commandes (messageCreate)
    setupCommandHandler(client, modules);

    // 5. Attacher les listeners des modules
    for (const [name, mod] of modules) {
        if (mod.listeners) {
            for (const [event, handler] of Object.entries(mod.listeners)) {
                client.on(event, (...args) => {
                    handler(client, ...args).catch(err => {
                        console.error(`[${name}] Erreur dans le listener '${event}':`, err.message);
                    });
                });
            }
        }
    }

    // 6. Au démarrage (ready)
    client.once('ready', async () => {
        console.log(`[Bot] Connecté en tant que ${client.user.tag}`);
        console.log(`[Bot] Présent sur ${client.guilds.cache.size} serveur(s).`);

        const db = getDb();
        const context = { client, db, modules };

        // Appeler onReady de chaque module
        for (const [name, mod] of modules) {
            if (mod.onReady) {
                try {
                    await mod.onReady(client, context);
                    console.log(`[${name}] Initialisation terminée.`);
                } catch (err) {
                    console.error(`[${name}] Erreur lors de l'initialisation:`, err.message);
                }
            }
        }

        console.log('[Bot] Prêt.');
    });

    // 7. Connexion
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
        console.error('[Bot] DISCORD_TOKEN manquant dans le .env');
        process.exit(1);
    }

    await client.login(token);
}

main().catch(err => {
    console.error('[Bot] Erreur fatale:', err);
    process.exit(1);
});
