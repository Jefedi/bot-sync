const fs = require('fs');
const path = require('path');

/**
 * Charge dynamiquement tous les modules depuis src/modules/.
 * Chaque sous-dossier doit contenir un index.js qui exporte le module.
 * Retourne une Map<nom_module, module>.
 */
function loadModules() {
    const modulesDir = path.join(__dirname, '..', 'modules');
    const modules = new Map();

    if (!fs.existsSync(modulesDir)) {
        console.warn('[Modules] Dossier src/modules/ introuvable.');
        return modules;
    }

    const entries = fs.readdirSync(modulesDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const modulePath = path.join(modulesDir, entry.name);

        try {
            const mod = require(modulePath);

            // Validation de l'interface du module
            if (!mod.name || !Array.isArray(mod.commands)) {
                console.warn(`[Modules] Module '${entry.name}' invalide (name ou commands manquant). Ignoré.`);
                continue;
            }

            modules.set(mod.name, mod);

            const cmdCount = mod.commands.length;
            const hasListeners = mod.listeners && Object.keys(mod.listeners).length > 0;
            const hasConfig = mod.configSchema && mod.configSchema.length > 0;

            let info = `${cmdCount} commande(s)`;
            if (hasListeners) info += ', listeners';
            if (hasConfig) info += ', configurable';

            console.log(`[Modules] ✓ '${mod.name}' chargé (${info}).`);
        } catch (err) {
            console.error(`[Modules] ✗ Erreur au chargement de '${entry.name}': ${err.message}`);
        }
    }

    console.log(`[Modules] ${modules.size} module(s) chargé(s) au total.`);
    return modules;
}

module.exports = { loadModules };
