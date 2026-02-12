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
            UNIQUE KEY unique_actif (member_id, source_guild_id, source_role_id, target_guild_id, target_role_id)
        )
    `);

    console.log('Base de données MySQL initialisée.');
}

module.exports = { getPool, initDb };
