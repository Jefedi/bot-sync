const { DiscordAPIError } = require('discord.js');

/**
 * Convertit une durée texte (ex: 7j, 12h, 30m, 1j12h) en minutes.
 * Retourne null si le format est invalide.
 */
function parserDuree(texte) {
    texte = texte.trim().toLowerCase();
    const match = texte.match(/^(?:(\d+)j)?(?:(\d+)h)?(?:(\d+)m)?$/);
    if (!match || (!match[1] && !match[2] && !match[3])) return null;

    const jours = parseInt(match[1] || '0');
    const heures = parseInt(match[2] || '0');
    const minutes = parseInt(match[3] || '0');
    const total = jours * 1440 + heures * 60 + minutes;

    if (total <= 0) return null;
    // Limiter à 365 jours maximum
    if (total > 525600) return null;
    return total;
}

/**
 * Formate une durée en minutes vers un texte lisible.
 */
function formaterDuree(minutes) {
    if (minutes >= 1440) {
        const jours = Math.floor(minutes / 1440);
        const reste = minutes % 1440;
        const heures = Math.floor(reste / 60);
        if (heures > 0) return `${jours}j ${heures}h`;
        return `${jours}j`;
    } else if (minutes >= 60) {
        const heures = Math.floor(minutes / 60);
        const reste = minutes % 60;
        if (reste > 0) return `${heures}h ${reste}m`;
        return `${heures}h`;
    } else {
        return `${minutes}m`;
    }
}

/**
 * Exécute une fonction avec retry et backoff exponentiel.
 * Réessaie sur les erreurs HTTP transitoires de Discord.
 */
async function avecRetry(fn, maxTentatives = 3, delaiBase = 1000) {
    let derniereErreur;
    for (let tentative = 0; tentative < maxTentatives; tentative++) {
        try {
            return await fn();
        } catch (error) {
            derniereErreur = error;
            // Ne pas retry sur les erreurs 4xx (sauf 429 rate limit)
            if (error instanceof DiscordAPIError) {
                if (error.status !== 429 && error.status >= 400 && error.status < 500) {
                    throw error;
                }
            }
            if (tentative < maxTentatives - 1) {
                const delai = delaiBase * Math.pow(2, tentative);
                await new Promise(resolve => setTimeout(resolve, delai));
            }
        }
    }
    throw derniereErreur;
}

module.exports = { parserDuree, formaterDuree, avecRetry };
