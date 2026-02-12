import discord
from discord import app_commands
from discord.ext import commands
import aiosqlite
import os

DB_PATH = os.getenv("DB_PATH")


class SyncRoles(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    # Commande slash pour ajouter une synchronisation de rôles
    @app_commands.command(
        name="ajouter_sync_role",
        description="Synchronise un rôle du serveur racine avec un rôle d'un autre serveur.",
    )
    @app_commands.describe(
        source_role="Le rôle sur ce serveur (serveur racine)",
        target_guild_id="L'ID du serveur cible",
        target_role_id="L'ID du rôle sur le serveur cible",
        duree="Durée optionnelle (ex: 30m, 12h, 7j). Sans durée = permanent",
        note="Note optionnelle associée à cette synchronisation",
    )
    async def ajouter_sync_role(
        self,
        interaction: discord.Interaction,
        source_role: discord.Role,
        target_guild_id: str,
        target_role_id: str,
        duree: str = None,
        note: str = None,
    ):
        # Convertir les IDs en entiers
        try:
            target_guild_id_int = int(target_guild_id)
            target_role_id_int = int(target_role_id)
        except ValueError:
            await interaction.response.send_message(
                "Les IDs doivent être des nombres valides.", ephemeral=True
            )
            return

        # Convertir la durée en minutes si fournie
        duree_minutes = None
        if duree:
            duree_minutes = self._parser_duree(duree)
            if duree_minutes is None:
                await interaction.response.send_message(
                    "Format de durée invalide. Utilisez : `30m` (minutes), `12h` (heures), `7j` (jours).\n"
                    "Exemples : `30m`, `2h`, `7j`, `1j12h`",
                    ephemeral=True,
                )
                return

        # Vérifier que le serveur cible existe et que le bot y est présent
        target_guild = self.bot.get_guild(target_guild_id_int)
        if not target_guild:
            await interaction.response.send_message(
                f"Le bot n'est pas présent sur le serveur avec l'ID `{target_guild_id_int}`.",
                ephemeral=True,
            )
            return

        # Vérifier que le rôle cible existe sur le serveur cible
        target_role = target_guild.get_role(target_role_id_int)
        if not target_role:
            await interaction.response.send_message(
                f"Le rôle avec l'ID `{target_role_id_int}` n'existe pas sur le serveur **{target_guild.name}**.",
                ephemeral=True,
            )
            return

        # Vérifier qu'il n'y a pas déjà cette correspondance
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                """SELECT 1 FROM role_sync
                   WHERE source_guild_id = ? AND source_role_id = ?
                   AND target_guild_id = ? AND target_role_id = ?""",
                (interaction.guild.id, source_role.id, target_guild_id_int, target_role_id_int),
            ) as cursor:
                if await cursor.fetchone():
                    await interaction.response.send_message(
                        "Cette synchronisation existe déjà.", ephemeral=True
                    )
                    return

            await db.execute(
                """INSERT INTO role_sync (source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (interaction.guild.id, source_role.id, target_guild_id_int, target_role_id_int, duree_minutes, note),
            )
            await db.commit()

        # Construire le message de confirmation
        msg = (
            f"Synchronisation créée :\n"
            f"**{source_role.name}** (ce serveur) → **{target_role.name}** (serveur **{target_guild.name}**)"
        )
        if duree_minutes:
            msg += f"\nDurée : **{self._formater_duree(duree_minutes)}**"
        else:
            msg += "\nDurée : **Permanent** (jusqu'au retrait manuel)"
        if note:
            msg += f"\nNote : {note}"

        await interaction.response.send_message(msg, ephemeral=True)
        await self.bot.get_cog("Logging").log_action(
            "Ajout de synchronisation", interaction, source_role, target_role, target_guild_id_int
        )

    # Commande slash pour supprimer une synchronisation de rôles
    @app_commands.command(
        name="supprimer_sync_role",
        description="Supprime une synchronisation de rôles.",
    )
    @app_commands.describe(
        source_role="Le rôle sur ce serveur (serveur racine)",
        target_guild_id="L'ID du serveur cible",
        target_role_id="L'ID du rôle sur le serveur cible",
    )
    async def supprimer_sync_role(
        self,
        interaction: discord.Interaction,
        source_role: discord.Role,
        target_guild_id: str,
        target_role_id: str,
    ):
        try:
            target_guild_id_int = int(target_guild_id)
            target_role_id_int = int(target_role_id)
        except ValueError:
            await interaction.response.send_message(
                "Les IDs doivent être des nombres valides.", ephemeral=True
            )
            return

        async with aiosqlite.connect(DB_PATH) as db:
            cursor = await db.execute(
                """DELETE FROM role_sync
                   WHERE source_guild_id = ? AND source_role_id = ?
                   AND target_guild_id = ? AND target_role_id = ?""",
                (interaction.guild.id, source_role.id, target_guild_id_int, target_role_id_int),
            )
            # Nettoyer aussi les entrées actives associées
            await db.execute(
                """DELETE FROM role_sync_actif
                   WHERE source_guild_id = ? AND source_role_id = ?
                   AND target_guild_id = ? AND target_role_id = ?""",
                (interaction.guild.id, source_role.id, target_guild_id_int, target_role_id_int),
            )
            await db.commit()

            if cursor.rowcount == 0:
                await interaction.response.send_message(
                    "Aucune synchronisation correspondante trouvée.", ephemeral=True
                )
                return

        # Résoudre les noms pour le message de confirmation
        target_guild = self.bot.get_guild(target_guild_id_int)
        target_guild_name = target_guild.name if target_guild else f"ID {target_guild_id_int}"
        target_role_obj = target_guild.get_role(target_role_id_int) if target_guild else None
        target_role_name = target_role_obj.name if target_role_obj else f"ID {target_role_id_int}"

        await interaction.response.send_message(
            f"Synchronisation supprimée :\n"
            f"**{source_role.name}** ↛ **{target_role_name}** (serveur **{target_guild_name}**)",
            ephemeral=True,
        )
        await self.bot.get_cog("Logging").log_action(
            "Suppression de synchronisation", interaction, source_role, target_role_obj, target_guild_id_int
        )

    # Commande slash pour voir les synchronisations de rôles
    @app_commands.command(
        name="voir_sync_roles",
        description="Affiche toutes les synchronisations de rôles configurées.",
    )
    async def voir_sync_roles(self, interaction: discord.Interaction):
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note FROM role_sync"
            ) as cursor:
                rows = await cursor.fetchall()

        if not rows:
            await interaction.response.send_message(
                "Aucune synchronisation configurée.", ephemeral=False
            )
            return

        embed = discord.Embed(
            title="Synchronisations de rôles",
            description=f"{len(rows)} correspondance(s) configurée(s)",
            color=discord.Color.blue(),
        )

        for i, (source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note) in enumerate(rows, 1):
            # Résoudre les noms à partir des IDs
            source_guild = self.bot.get_guild(source_guild_id)
            source_guild_name = source_guild.name if source_guild else f"Inconnu ({source_guild_id})"
            source_role = source_guild.get_role(source_role_id) if source_guild else None
            source_role_name = source_role.name if source_role else f"Inconnu ({source_role_id})"

            target_guild = self.bot.get_guild(target_guild_id)
            target_guild_name = target_guild.name if target_guild else f"Inconnu ({target_guild_id})"
            target_role = target_guild.get_role(target_role_id) if target_guild else None
            target_role_name = target_role.name if target_role else f"Inconnu ({target_role_id})"

            # Construire la valeur du champ
            valeur = (
                f"**{source_role_name}** ({source_guild_name})\n"
                f"→ **{target_role_name}** ({target_guild_name})"
            )
            if duree_minutes:
                valeur += f"\nDurée : {self._formater_duree(duree_minutes)}"
            else:
                valeur += "\nDurée : Permanent"
            if note:
                valeur += f"\nNote : _{note}_"

            embed.add_field(name=f"#{i}", value=valeur, inline=False)

        await interaction.response.send_message(embed=embed)

    @staticmethod
    def _parser_duree(texte: str) -> int | None:
        """Convertit une durée texte (ex: 7j, 12h, 30m, 1j12h) en minutes.
        Retourne None si le format est invalide."""
        import re
        texte = texte.strip().lower()
        pattern = re.compile(r"(?:(\d+)j)?(?:(\d+)h)?(?:(\d+)m)?$")
        match = pattern.match(texte)
        if not match or not any(match.groups()):
            return None
        jours = int(match.group(1) or 0)
        heures = int(match.group(2) or 0)
        minutes = int(match.group(3) or 0)
        total = jours * 1440 + heures * 60 + minutes
        return total if total > 0 else None

    @staticmethod
    def _formater_duree(minutes: int) -> str:
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


async def setup(bot):
    await bot.add_cog(SyncRoles(bot))
