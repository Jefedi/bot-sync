const mysql = require('mysql2/promise');

let pool;

/**
 * Retourne le pool de connexions MySQL (créé au premier appel).
 */
function getPool() {
    if (!pool) {
        pool = mysql.createPool({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            connectTimeout: 10000,
            supportBigNumbers: true,
            bigNumberStrings: true,
        });
    }
    return pool;
}

/**
 * Initialise la base de données : crée les tables et index si nécessaires.
 */
async function initDb() {
    const db = getPool();

    // Tester la connexion avant de créer les tables
    try {
        const conn = await db.getConnection();
        console.log(`Connexion MySQL établie vers ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}`);
        conn.release();
    } catch (error) {
        console.error(`Impossible de se connecter à MySQL sur ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}`);
        console.error(`Utilisateur: ${process.env.DB_USER}, Base: ${process.env.DB_NAME}`);
        console.error(`Erreur: ${error.message} (code: ${error.code})`);
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
            console.error('');
            console.error('=== DIAGNOSTIC ===');
            console.error('Depuis un container Docker Pterodactyl, utilisez :');
            console.error('  - DB_HOST=172.18.0.1  (gateway réseau pterodactyl0)');
            console.error('  - ou DB_HOST=<IP_PUBLIQUE_DU_SERVEUR>');
            console.error('Vérifiez aussi que MySQL écoute sur 0.0.0.0 (bind-address dans mysqld.cnf)');
            console.error('et que le firewall autorise le port 3306 depuis le réseau Docker.');
            console.error('==================');
        }
        throw error;
    }

    // Table des correspondances de rôles
    await db.execute(`
        CREATE TABLE IF NOT EXISTS role_sync (
            id INT AUTO_INCREMENT PRIMARY KEY,
            source_guild_id BIGINT NOT NULL,
            source_role_id BIGINT NOT NULL,
            target_guild_id BIGINT NOT NULL,
            target_role_id BIGINT NOT NULL,
            duree_minutes INT DEFAULT NULL,
            note VARCHAR(200) DEFAULT NULL,
            UNIQUE KEY unique_sync (source_guild_id, source_role_id, target_guild_id, target_role_id)
        )
    `);

    // Table de suivi des syncs actifs (pour l'expiration des durées)
    await db.execute(`
        CREATE TABLE IF NOT EXISTS role_sync_actif (
            id INT AUTO_INCREMENT PRIMARY KEY,
            member_id BIGINT NOT NULL,
            source_guild_id BIGINT NOT NULL,
            source_role_id BIGINT NOT NULL,
            target_guild_id BIGINT NOT NULL,
            target_role_id BIGINT NOT NULL,
            synced_at DOUBLE NOT NULL,
            rappel_envoye TINYINT DEFAULT 0,
            UNIQUE KEY unique_actif (member_id, source_guild_id, source_role_id, target_guild_id, target_role_id)
        )
    `);

    // Migration : ajouter rappel_envoye si la table existe déjà sans cette colonne
    try {
        await db.execute('ALTER TABLE role_sync_actif ADD COLUMN rappel_envoye TINYINT DEFAULT 0');
    } catch {
        // Colonne déjà existante — ignoré
    }

    // Table d'historique des synchronisations
    await db.execute(`
        CREATE TABLE IF NOT EXISTS sync_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            action VARCHAR(100) NOT NULL,
            member_id BIGINT NOT NULL,
            member_tag VARCHAR(100),
            source_guild_id BIGINT,
            source_role_name VARCHAR(100),
            target_guild_id BIGINT,
            target_guild_name VARCHAR(100),
            target_role_name VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log('Base de données MySQL initialisée.');
}

/**
 * Enregistre une action dans l'historique des synchronisations.
 */
async function enregistrerHistorique(action, memberId, memberTag, sourceGuildId, sourceRoleName, targetGuildId, targetGuildName, targetRoleName) {
    const db = getPool();
    await db.execute(
        `INSERT INTO sync_history (action, member_id, member_tag, source_guild_id, source_role_name, target_guild_id, target_guild_name, target_role_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [action, memberId, memberTag || null, sourceGuildId || null, sourceRoleName || null, targetGuildId || null, targetGuildName || null, targetRoleName || null]
    ).catch(err => console.error('Erreur enregistrement historique:', err));
}

module.exports = { getPool, initDb, enregistrerHistorique };
