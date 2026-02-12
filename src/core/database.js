const { createClient } = require('@supabase/supabase-js');

let supabase = null;

/**
 * Retourne le client Supabase (singleton).
 */
function getDb() {
    if (!supabase) {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_KEY;

        if (!url || !key) {
            throw new Error('SUPABASE_URL et SUPABASE_KEY doivent être définis dans le .env');
        }

        supabase = createClient(url, key);
    }
    return supabase;
}

/**
 * Teste la connexion à Supabase et vérifie que les tables existent.
 */
async function initDb() {
    const db = getDb();

    const tables = [
        'guild_settings',
        'permission_levels',
        'user_permissions',
        'command_permissions',
        'service_configs',
        'role_sync',
        'role_sync_active',
        'audit_log',
    ];

    console.log('[DB] Vérification de la connexion Supabase...');

    for (const table of tables) {
        const { error } = await db.from(table).select('*').limit(1);
        if (error) {
            console.error(`[DB] Erreur sur la table '${table}': ${error.message}`);
            console.error('[DB] Assurez-vous d\'avoir exécuté le fichier schema.sql dans l\'éditeur SQL de Supabase.');
            throw error;
        }
    }

    console.log('[DB] Connexion Supabase établie. Toutes les tables sont accessibles.');
    return db;
}

module.exports = { getDb, initDb };
