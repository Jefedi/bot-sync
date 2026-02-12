import asyncio
import re


def parser_duree(texte: str) -> int | None:
    """Convertit une durée texte (ex: 7j, 12h, 30m, 1j12h) en minutes.
    Retourne None si le format est invalide."""
    texte = texte.strip().lower()
    pattern = re.compile(r"(?:(\d+)j)?(?:(\d+)h)?(?:(\d+)m)?$")
    match = pattern.match(texte)
    if not match or not any(match.groups()):
        return None
    jours = int(match.group(1) or 0)
    heures = int(match.group(2) or 0)
    minutes = int(match.group(3) or 0)
    total = jours * 1440 + heures * 60 + minutes
    if total <= 0:
        return None
    # Limiter à 365 jours maximum
    if total > 525600:
        return None
    return total


def formater_duree(minutes: int) -> str:
    """Formate une durée en minutes vers un texte lisible."""
    if minutes >= 1440:
        jours = minutes // 1440
        reste = minutes % 1440
        heures = reste // 60
        if heures > 0:
            return f"{jours}j {heures}h"
        return f"{jours}j"
    elif minutes >= 60:
        heures = minutes // 60
        reste = minutes % 60
        if reste > 0:
            return f"{heures}h {reste}m"
        return f"{heures}h"
    else:
        return f"{minutes}m"


async def avec_retry(coro_func, *args, max_tentatives=3, delai_base=1.0, **kwargs):
    """Exécute une coroutine avec retry et backoff exponentiel.
    Réessaie sur les erreurs HTTP transitoires de Discord."""
    import discord
    derniere_erreur = None
    for tentative in range(max_tentatives):
        try:
            return await coro_func(*args, **kwargs)
        except discord.HTTPException as e:
            derniere_erreur = e
            # Ne pas retry sur les erreurs 4xx (sauf 429 rate limit)
            if e.status != 429 and 400 <= e.status < 500:
                raise
            if tentative < max_tentatives - 1:
                delai = delai_base * (2 ** tentative)
                await asyncio.sleep(delai)
    raise derniere_erreur
