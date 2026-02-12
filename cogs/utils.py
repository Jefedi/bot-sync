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
