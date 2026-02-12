/**
 * Convertit un texte de durée en minutes.
 * Formats acceptés : 7j, 12h, 30m, 1j12h, 2j6h30m
 * Retourne null si invalide. Max 365 jours.
 */
function parseDuration(text) {
    if (!text) return null;

    const regex = /(\d+)\s*(j|h|m)/gi;
    let total = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        switch (unit) {
            case 'j': total += value * 24 * 60; break;
            case 'h': total += value * 60; break;
            case 'm': total += value; break;
        }
    }

    if (total === 0) return null;
    if (total > 365 * 24 * 60) return null;
    return total;
}

/**
 * Formate des minutes en texte lisible (ex: 3j 12h 30m).
 */
function formatDuration(minutes) {
    if (!minutes || minutes <= 0) return 'permanent';

    const j = Math.floor(minutes / (24 * 60));
    const h = Math.floor((minutes % (24 * 60)) / 60);
    const m = minutes % 60;

    const parts = [];
    if (j > 0) parts.push(`${j}j`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);

    return parts.join(' ') || '0m';
}

/**
 * Retry avec backoff exponentiel.
 * Ignore les erreurs 4xx (sauf 429 rate limit).
 */
async function withRetry(fn, maxAttempts = 3, baseDelay = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const status = err.status || err.httpStatus;
            if (status && status >= 400 && status < 500 && status !== 429) {
                throw err;
            }
            if (attempt === maxAttempts) throw err;
            const delay = baseDelay * Math.pow(2, attempt - 1);
            await sleep(delay);
        }
    }
}

/**
 * Pause asynchrone.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extrait un ID de rôle depuis une mention Discord (<@&123456>).
 */
function parseRoleMention(text) {
    const match = text?.match(/^<@&(\d+)>$/);
    return match ? match[1] : null;
}

/**
 * Extrait un ID d'utilisateur depuis une mention Discord (<@123456>).
 */
function parseUserMention(text) {
    const match = text?.match(/^<@!?(\d+)>$/);
    return match ? match[1] : null;
}

/**
 * Extrait un ID de canal depuis une mention Discord (<#123456>).
 */
function parseChannelMention(text) {
    const match = text?.match(/^<#(\d+)>$/);
    return match ? match[1] : null;
}

module.exports = {
    parseDuration,
    formatDuration,
    withRetry,
    sleep,
    parseRoleMention,
    parseUserMention,
    parseChannelMention,
};
