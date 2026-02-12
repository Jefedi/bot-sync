# CLAUDE.md

## Project Overview

**bot-sync** est un bot Discord polyvalent multi-serveurs. Il intègre la synchronisation de rôles, GitLab, GitHub, SonarQube, Radarr, Jellyfin, qBittorrent, LibreTranslate et Open WebUI. Il utilise un système de permissions virtuelles hiérarchiques (niveaux 1-9) et des commandes par préfixe configurable.

Le bot est écrit en **JavaScript (Node.js 18+)** et utilise **discord.js v14** avec **Supabase** comme base de données.

## Repository Structure

```
bot-sync/
├── index.js                          # Point d'entrée — init DB, chargement modules, démarrage
├── package.json                      # Dépendances Node.js
├── schema.sql                        # Schéma Supabase (à exécuter dans l'éditeur SQL)
├── .env.example                      # Template des variables d'environnement
├── .gitignore
├── CLAUDE.md                         # Ce fichier
│
├── src/
│   ├── core/                         # Noyau du bot (ne change pas pour ajouter un module)
│   │   ├── client.js                 # Création du client Discord + intents
│   │   ├── commandHandler.js         # Parse les messages, route vers les modules
│   │   ├── moduleLoader.js           # Charge dynamiquement tous les modules
│   │   ├── permissions.js            # Système de permissions virtuelles (niveaux 1-9)
│   │   └── database.js               # Client Supabase (singleton)
│   │
│   ├── modules/                      # Chaque sous-dossier = un module indépendant
│   │   ├── _shared.js                # Utilitaires partagés entre modules (getServiceConfig)
│   │   ├── perm/index.js             # Gestion des permissions (!perm)
│   │   ├── config/index.js           # Configuration bot et services (!config)
│   │   ├── aide/index.js             # Aide contextuelle (!aide)
│   │   ├── sync/                     # Synchronisation de rôles (!sync)
│   │   │   ├── index.js              # Définition du module
│   │   │   ├── commands.js           # Commandes sync
│   │   │   └── listeners.js          # Event listeners (guildMemberUpdate, etc.)
│   │   ├── gitlab/index.js           # Intégration GitLab (!gitlab)
│   │   ├── github/index.js           # Intégration GitHub (!github)
│   │   ├── sonar/index.js            # Intégration SonarQube (!sonar)
│   │   ├── radar/index.js            # Intégration Radarr (!radar)
│   │   ├── jellyfin/index.js         # Intégration Jellyfin (!jellyfin)
│   │   ├── qbittorrent/index.js      # Intégration qBittorrent (!qbit)
│   │   ├── translate/index.js        # Intégration LibreTranslate (!translate)
│   │   └── ai/index.js               # Intégration Open WebUI (!ai)
│   │
│   └── utils/
│       ├── helpers.js                # Utilitaires (parseDuration, withRetry, etc.)
│       ├── embeds.js                 # Constructeurs d'embeds Discord
│       └── logger.js                 # Système d'audit (embeds + table audit_log)
```

## Tech Stack

- **Langage :** JavaScript (Node.js 18+)
- **Framework bot :** discord.js v14 (commandes par préfixe, pas de slash commands)
- **Base de données :** Supabase (PostgreSQL) via `@supabase/supabase-js`
- **Config :** `dotenv` pour le `.env`
- **HTTP :** `fetch` natif (Node 18+) pour les appels aux APIs externes

## Architecture

### Système de commandes par préfixe

Format : `!<module> <sous-commande> [arguments...]`

- Le préfixe par défaut est `!`, configurable par serveur via `!config prefix`
- Le commandHandler parse le message, identifie le module et la commande, vérifie les permissions, puis exécute
- Les modules avec une seule commande (ex: `!ai`, `!translate`) utilisent `name: null`
- Les modules avec un handler par défaut utilisent `name: '_default'` pour attraper les sous-commandes inconnues

### Système de permissions virtuelles (niveaux 0-9)

- **Niveau 0** : défaut pour tous les utilisateurs → aucun accès
- **Niveaux 1-9** : hiérarchiques, l'accès à un niveau N donne accès à toutes les commandes de niveaux ≤ N
- **Owner du serveur** : bypass total, seul à pouvoir utiliser le bot au départ
- **Aucune commande n'est assignée par défaut** : l'owner doit manuellement assigner chaque commande à un niveau via `!perm assign`
- Commandes `!perm` et `!config` : réservées au owner (flag `ownerOnly`)
- Commande `!aide` : accessible à tous (flag `public`)

### Modules

Chaque module suit le contrat suivant :

```js
module.exports = {
    name: 'module_name',           // Identifiant unique = préfixe de commande
    description: 'Description',
    configSchema: [...],           // Optionnel : champs de config pour !config <service>
    commands: [...],               // Liste des commandes
    listeners: { event: fn },      // Optionnel : listeners Discord
    onReady: async (client, ctx) => {},  // Optionnel : initialisation au démarrage
};
```

Pour ajouter un nouveau module : créer un dossier dans `src/modules/`, exporter l'interface ci-dessus dans `index.js` → le module est automatiquement chargé.

### Configuration des services par serveur

Les services externes (GitLab, Jellyfin, etc.) sont configurés par serveur via `!config <service>`, pas dans le `.env`. Chaque module déclare un `configSchema` définissant les champs nécessaires. La configuration interactive supprime les messages contenant des secrets.

## Schéma de base de données

8 tables dans Supabase (voir `schema.sql` pour le schéma complet) :

| Table | Description |
|-------|-------------|
| `guild_settings` | Préfixe et canal de logs par serveur |
| `permission_levels` | Noms des niveaux 1-9 par serveur |
| `user_permissions` | Niveau attribué à chaque utilisateur par serveur |
| `command_permissions` | Niveau requis par commande par serveur |
| `service_configs` | Credentials des services externes par serveur |
| `role_sync` | Correspondances de rôles entre serveurs |
| `role_sync_active` | Syncs actifs avec suivi d'expiration |
| `audit_log` | Historique d'audit unifié (JSONB) |

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Token du bot Discord |
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_KEY` | Clé anon ou service Supabase |
| `LOG_CHANNEL_NAME` | Nom du canal de logs (fallback) |

Les credentials des services (GitLab, Jellyfin, etc.) sont stockés dans `service_configs`, pas dans le `.env`.

## Comment lancer

```bash
# 1. Installer les dépendances
npm install

# 2. Configurer le .env
cp .env.example .env
# Éditer .env avec token Discord + URL/clé Supabase

# 3. Créer les tables dans Supabase
# Copier le contenu de schema.sql dans l'éditeur SQL de Supabase et exécuter

# 4. Démarrer le bot
node index.js
```

## Conventions de développement

### Langue

- **Textes UI en français.** Nommage JS en **camelCase**.

### Patterns à suivre

1. **Architecture modulaire** — Nouvelles fonctionnalités dans des modules séparés dans `src/modules/`.
2. **Async/await partout** — Toutes les opérations bot et DB sont async.
3. **Requêtes Supabase** — Utiliser le client JS, vérifier `{ data, error }`.
4. **Permissions** — Respecter le système de niveaux. Les commandes de gestion sont `ownerOnly`.
5. **Log d'audit** — Toute action appelle `logAudit()` et/ou `logAction()`.
6. **Gestion des erreurs** — `try/catch` sur toutes les commandes avec message utilisateur.
7. **Retry sur les appels API** — Utiliser `withRetry()` pour les appels Discord.
8. **Configuration par serveur** — Les credentials de service sont dans `service_configs`, jamais en dur.
9. **Cache en mémoire** — Préfixes, permissions et configs de services sont cachés avec TTL.

### Ajouter un nouveau module

1. Créer un dossier dans `src/modules/<nom>/`.
2. Exporter le contrat module dans `index.js` (name, description, commands, configSchema optionnel).
3. C'est tout — le `moduleLoader` le charge automatiquement.

### Ajouter un nouveau service configurable

1. Définir `configSchema` dans le module : `[{ key, label, secret }]`.
2. Utiliser `requireConfig(message, context, 'nom_service')` dans les commandes.
3. L'owner configure via `!config <nom_service>`.
