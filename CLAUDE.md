# CLAUDE.md

## Project Overview

**bot-sync** est un bot Discord de synchronisation de rôles multi-serveurs. Conçu pour les communautés GTA RP (LSPD, BCSO, etc.), il permet de gérer les rôles depuis un **serveur racine** et de les synchroniser automatiquement vers des **serveurs départementaux** où les rôles peuvent avoir des noms différents.

Le bot est écrit en **JavaScript (Node.js)** et utilise la bibliothèque **discord.js v14**. Il est hébergé sur **Pterodactyl** (Docker).

## Repository Structure

```
bot-sync/
├── index.js               # Point d'entrée — init DB, enregistrement commandes, démarrage
├── src/
│   ├── database.js        # Pool MySQL + initialisation des tables + historique
│   ├── utils.js           # Utilitaires partagés (parser durée, formater durée, retry)
│   ├── logging.js         # Fonctions d'audit — embed de log dans un canal dédié
│   ├── syncRoles.js       # Commandes slash (12 commandes avec autocomplete et cooldown)
│   └── syncListener.js    # Sync automatique — guildMemberUpdate, guildMemberAdd, resync, expirations, rappels
├── package.json           # Dépendances Node.js (discord.js, mysql2, dotenv)
├── .env                   # Variables d'environnement (non commité)
├── .env.example           # Template des variables d'environnement
├── .gitignore             # Exclusions (.env, node_modules/, *.db, IDE)
└── CLAUDE.md              # Ce fichier
```

## Tech Stack

- **Langage :** JavaScript (Node.js 18+)
- **Framework bot :** discord.js v14 (avec `SlashCommandBuilder` pour les slash commands)
- **Base de données :** MySQL via `mysql2/promise` (pool de connexions async)
- **Config :** `dotenv` pour le chargement du `.env`
- **Hébergement :** Pterodactyl (Docker, egg Node.js)

## Architecture

Le bot suit une architecture modulaire avec des modules séparés par responsabilité :

### `index.js` — Point d'entrée

- Charge `.env`, configure les intents (`Guilds` + `GuildMembers` requis)
- **Initialise automatiquement la base de données** (`initDb()`) avec création des tables et migrations
- Enregistre les commandes slash globalement via l'API REST Discord
- Configure les event listeners (`interactionCreate`, `guildMemberUpdate`, `guildMemberAdd`)
- Lance la resync au démarrage et le vérificateur d'expirations/rappels
- Démarre le bot via `client.login()`

### `src/syncRoles.js` — Commandes slash

12 commandes slash avec autocomplétion, cooldown et vérification des permissions :

| Commande | Description | Cooldown |
|----------|-------------|----------|
| `/aide` | Affiche l'aide complète du bot | Non |
| `/bot_status` | Dashboard : état, stats, permissions, syncs orphelines | Non |
| `/ajouter_sync_role` | Créer une correspondance de rôles (avec vérification hiérarchie) | 5s |
| `/supprimer_sync_role` | Supprimer une correspondance | 5s |
| `/voir_sync_roles` | Voir toutes les correspondances du serveur (filtré par guild) | Non |
| `/resync @membre` | Resynchroniser les rôles d'un membre (embed détaillé par serveur) | Non |
| `/sync_status @membre` | État de sync d'un membre : rôles source/cible + temps restant | Non |
| `/historique` | 20 dernières actions de synchronisation avec timestamps | Non |
| `/nettoyer_sync` | Supprimer les syncs orphelines (rôle/serveur supprimé) | Non |
| `/copier_sync` | Copier les configs d'un serveur cible vers un autre | 5s |
| `/exporter_config` | Exporter la configuration en fichier JSON | Non |
| `/importer_config` | Importer une configuration depuis un fichier JSON | 5s |

**Fonctionnalités clés :**
- **Autocomplete** sur les paramètres serveur (`autocompleteServeur()`) et rôle cible (`autocompleteRoleCible()`)
- **Vérification de la hiérarchie** des rôles avant la création d'un mapping
- **Cooldown anti-spam** de 5 secondes via une Map interne
- **`setDefaultMemberPermissions(Administrator)`** sur toutes les commandes d'administration
- **Gestion des erreurs** avec `try/catch` et messages utilisateur
- **Log d'audit** via `logAction()` après chaque action

### `src/syncListener.js` — Sync automatique

- **`onMemberUpdate`** : détecte les ajouts/retraits de rôles en temps réel et synchronise vers les serveurs cibles
- **`onMemberJoin`** : quand un membre rejoint un serveur cible, attribue automatiquement les rôles correspondants
- **`resyncOnReady`** : resync complète au démarrage avec rate limiting (`RESYNC_DELAI = 500ms` entre chaque appel API)
- **`startExpirationChecker`** : `setInterval` (toutes les minutes) qui :
  - Envoie un **rappel jaune** dans le canal de log **1h avant** l'expiration d'un rôle (une seule fois par entrée, via colonne `rappel_envoye`)
  - Retire les rôles dont la durée a expiré
- **Retry avec backoff exponentiel** via `avecRetry()` sur tous les appels API Discord
- **Historique** : chaque action de sync (ajout, retrait, expiration, join) est enregistrée dans la table `sync_history`
- **Logs détaillés** avec embed coloré (vert=ajout, orange=retrait, rouge=erreur, jaune=rappel)

### `src/logging.js` — Audit

- `logAction()` : poste des embeds d'audit pour les commandes utilisateur
- `logSync()` : poste des embeds détaillés pour les syncs automatiques dans le canal configuré par `LOG_CHANNEL_NAME`

### `src/utils.js` — Utilitaires partagés

| Fonction | Description |
|----------|-------------|
| `parserDuree(texte)` | Convertit `7j`, `12h`, `30m`, `1j12h` en minutes (max 365j) |
| `formaterDuree(minutes)` | Formate des minutes en texte lisible (`3j 12h`) |
| `avecRetry(fn, ...)` | Retry avec backoff exponentiel (3 tentatives, ignore 4xx sauf 429) |

### `src/database.js` — Base de données

- `getPool()` : retourne le pool de connexions MySQL (singleton, avec `connectTimeout: 10000`, `supportBigNumbers`, `bigNumberStrings`)
- `initDb()` : crée les tables `role_sync`, `role_sync_actif` et `sync_history` si elles n'existent pas ; gère les migrations (ajout colonne `rappel_envoye`) ; affiche un diagnostic détaillé en cas d'erreur de connexion
- `enregistrerHistorique()` : insère une entrée dans `sync_history` pour tracer chaque action de sync

## Schéma de base de données

La base MySQL contient 3 tables, créées automatiquement au démarrage par `initDb()` :

```sql
-- Table des correspondances de rôles
CREATE TABLE role_sync (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source_guild_id BIGINT NOT NULL,
    source_role_id BIGINT NOT NULL,
    target_guild_id BIGINT NOT NULL,
    target_role_id BIGINT NOT NULL,
    duree_minutes INT DEFAULT NULL,       -- Durée en minutes (NULL = permanent)
    note VARCHAR(200) DEFAULT NULL,       -- Note optionnelle (max 200 caractères)
    UNIQUE KEY unique_sync (source_guild_id, source_role_id, target_guild_id, target_role_id)
);

-- Table de suivi des syncs actifs (pour l'expiration des durées)
CREATE TABLE role_sync_actif (
    id INT AUTO_INCREMENT PRIMARY KEY,
    member_id BIGINT NOT NULL,
    source_guild_id BIGINT NOT NULL,
    source_role_id BIGINT NOT NULL,
    target_guild_id BIGINT NOT NULL,
    target_role_id BIGINT NOT NULL,
    synced_at DOUBLE NOT NULL,            -- Timestamp Unix du moment de la sync
    rappel_envoye TINYINT DEFAULT 0,      -- 1 si le rappel 1h avant a été envoyé
    UNIQUE KEY unique_actif (member_id, source_guild_id, source_role_id, target_guild_id, target_role_id)
);

-- Table d'historique des synchronisations
CREATE TABLE sync_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    action VARCHAR(100) NOT NULL,         -- Type d'action (Ajout automatique, Retrait, Expiration, etc.)
    member_id BIGINT NOT NULL,
    member_tag VARCHAR(100),              -- Tag Discord du membre (ex: User#1234)
    source_guild_id BIGINT,
    source_role_name VARCHAR(100),
    target_guild_id BIGINT,
    target_guild_name VARCHAR(100),
    target_role_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Variables d'environnement

Définies dans `.env` (voir `.env.example` pour le template) :

| Variable           | Description                                              |
|--------------------|----------------------------------------------------------|
| `DISCORD_TOKEN`    | Token d'authentification du bot                          |
| `DB_HOST`          | Hôte du serveur MySQL (depuis Docker : `172.18.0.1`)    |
| `DB_PORT`          | Port du serveur MySQL (défaut: 3306)                     |
| `DB_USER`          | Utilisateur MySQL                                        |
| `DB_PASSWORD`      | Mot de passe MySQL                                       |
| `DB_NAME`          | Nom de la base de données MySQL                          |
| `LOG_CHANNEL_NAME` | Nom du canal textuel Discord pour les logs d'audit       |

**Note Docker/Pterodactyl :** Ne pas utiliser `localhost` ou `127.0.0.1` pour `DB_HOST` — ces adresses pointent vers le container lui-même. Utiliser `172.18.0.1` (gateway réseau `pterodactyl0`) ou l'IP publique du serveur. Vérifier aussi que MySQL écoute sur `0.0.0.0` (`bind-address` dans `mysqld.cnf`) et que le firewall autorise le port 3306 depuis le réseau Docker.

## Comment lancer

```bash
# Installer les dépendances
npm install

# Configurer le .env (copier depuis .env.example)
cp .env.example .env
# Éditer .env avec vos valeurs (token Discord + mot de passe MySQL)

# Démarrer le bot
node index.js
# ou
npm start
```

### Sur Pterodactyl

1. Créer un serveur avec l'egg **Node.js**
2. Configurer les variables d'environnement dans le panneau
3. Le startup command doit être : `npm start` ou `node index.js`
4. Allouer au minimum **256 MiB** de RAM et **1024 MiB** de disque

## Conventions de développement

### Langue

- **Les commentaires et textes UI sont en français.** Suivre cette convention pour tout nouveau texte.
- Nommage JavaScript en **camelCase** pour les variables/fonctions.
- Noms de commandes slash en français avec **snake_case** : `ajouter_sync_role`, `supprimer_sync_role`, `voir_sync_roles`, `resync`, `sync_status`, `historique`, `nettoyer_sync`, `copier_sync`, `exporter_config`, `importer_config`.

### Patterns à suivre

1. **Architecture modulaire** — Nouvelles fonctionnalités dans des fichiers séparés dans `src/`.
2. **Async/await partout** — Toutes les opérations bot et DB sont async.
3. **Requêtes SQL paramétrées** — Toujours utiliser `?` comme placeholders, jamais de template literals.
4. **Réponses éphémères** — Les commandes de mutation répondent avec `ephemeral: true`.
5. **Log d'audit** — Toute action utilisateur appelle `logAction()` après exécution.
6. **Historique** — Toute action de sync appelle `enregistrerHistorique()` pour la table `sync_history`.
7. **Gestion des erreurs** — `try/catch` sur toutes les commandes avec message utilisateur en cas d'erreur.
8. **Retry sur les appels API** — Utiliser `avecRetry()` pour les appels Discord susceptibles de rate limit.
9. **Contraintes UNIQUE en DB** — Gérer `ER_DUP_ENTRY` pour les doublons.
10. **Cooldown anti-spam** — 5 secondes sur les commandes de modification via la Map `cooldowns`.
11. **`setDefaultMemberPermissions(Administrator)`** sur les commandes d'administration.
12. **Migrations DB** — Pour ajouter une colonne à une table existante, utiliser `ALTER TABLE ... ADD COLUMN` dans un `try/catch` (ignore si déjà existante).

### Ajouter une nouvelle commande

1. Définir le `SlashCommandBuilder` dans la fonction `getCommands()` de `src/syncRoles.js`.
2. Ajouter le handler dans le `switch` de `handleCommand()`.
3. Si autocomplete nécessaire, ajouter dans `handleAutocomplete()`.

### Ajouter un nouvel événement

1. Créer la fonction dans `src/syncListener.js`.
2. L'exporter dans le `module.exports`.
3. L'importer dans `index.js` et l'attacher au `client.on('eventName', ...)`.

### Limitations connues

- **Pas de tests** — Aucun framework de test configuré.
- **Pas de CI/CD** — Aucun pipeline GitHub Actions.
- **Un seul canal de log** — Tous les logs vont dans le même canal (`LOG_CHANNEL_NAME`).
