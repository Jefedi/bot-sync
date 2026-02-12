import discord
from discord import app_commands
from discord.ext import commands
import aiosqlite
import os

from cogs.utils import parser_duree, formater_duree

DB_PATH = os.getenv("DB_PATH")


class SyncRoles(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    def _get_logging_cog(self):
        """Récupère le cog Logging de manière sécurisée."""
        return self.bot.get_cog("Logging")

    async def _log(self, action, interaction, source_role=None, target_role=None, target_guild_id=None):
        """Appelle le cog Logging s'il est disponible."""
        cog = self._get_logging_cog()
        if cog:
            await cog.log_action(action, interaction, source_role, target_role, target_guild_id)

    # ──────────────────────────────────────────────
    # Ajouter une synchronisation
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="ajouter_sync_role",
        description="Synchronise un rôle du serveur racine avec un rôle d'un autre serveur.",
    )
    @app_commands.default_permissions(administrator=True)
    @app_commands.describe(
        source_role="Le rôle sur ce serveur (serveur racine)",
        target_guild_id="L'ID du serveur cible",
        target_role_id="L'ID du rôle sur le serveur cible",
        duree="Durée optionnelle (ex: 30m, 12h, 7j, 1j12h). Sans durée = permanent",
        note="Note optionnelle associée à cette synchronisation (max 200 caractères)",
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
        try:
            # Convertir les IDs en entiers
            try:
                target_guild_id_int = int(target_guild_id)
                target_role_id_int = int(target_role_id)
            except ValueError:
                await interaction.response.send_message(
                    "Les IDs doivent être des nombres valides.\n"
                    "Astuce : clic droit sur le serveur/rôle → **Copier l'identifiant**",
                    ephemeral=True,
                )
                return

            # Convertir la durée en minutes si fournie
            duree_minutes = None
            if duree:
                duree_minutes = parser_duree(duree)
                if duree_minutes is None:
                    await interaction.response.send_message(
                        "Format de durée invalide. Utilisez : `30m` (minutes), `12h` (heures), `7j` (jours).\n"
                        "Exemples : `30m`, `2h`, `7j`, `1j12h`\n"
                        "Maximum : `365j`",
                        ephemeral=True,
                    )
                    return

            # Valider la note
            if note and len(note) > 200:
                await interaction.response.send_message(
                    "La note ne doit pas dépasser 200 caractères.", ephemeral=True
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

            # Insérer (la contrainte UNIQUE en DB empêche les doublons)
            async with aiosqlite.connect(DB_PATH) as db:
                try:
                    await db.execute(
                        """INSERT INTO role_sync (source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (interaction.guild.id, source_role.id, target_guild_id_int, target_role_id_int, duree_minutes, note),
                    )
                    await db.commit()
                except aiosqlite.IntegrityError:
                    await interaction.response.send_message(
                        "Cette synchronisation existe déjà.", ephemeral=True
                    )
                    return

            # Construire le message de confirmation
            msg = (
                f"Synchronisation créée :\n"
                f"**{source_role.name}** (ce serveur) → **{target_role.name}** (serveur **{target_guild.name}**)"
            )
            if duree_minutes:
                msg += f"\nDurée : **{formater_duree(duree_minutes)}**"
            else:
                msg += "\nDurée : **Permanent** (jusqu'au retrait manuel)"
            if note:
                msg += f"\nNote : {note}"

            await interaction.response.send_message(msg, ephemeral=True)
            await self._log("Ajout de synchronisation", interaction, source_role, target_role, target_guild_id_int)

        except Exception as e:
            if not interaction.response.is_done():
                await interaction.response.send_message(
                    f"Une erreur est survenue : {e}", ephemeral=True
                )

    # ──────────────────────────────────────────────
    # Supprimer une synchronisation
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="supprimer_sync_role",
        description="Supprime une synchronisation de rôles.",
    )
    @app_commands.default_permissions(administrator=True)
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
            try:
                target_guild_id_int = int(target_guild_id)
                target_role_id_int = int(target_role_id)
            except ValueError:
                await interaction.response.send_message(
                    "Les IDs doivent être des nombres valides.\n"
                    "Astuce : clic droit sur le serveur/rôle → **Copier l'identifiant**",
                    ephemeral=True,
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
            await self._log("Suppression de synchronisation", interaction, source_role, target_role_obj, target_guild_id_int)

        except Exception as e:
            if not interaction.response.is_done():
                await interaction.response.send_message(
                    f"Une erreur est survenue : {e}", ephemeral=True
                )

    # ──────────────────────────────────────────────
    # Voir les synchronisations (filtrée par serveur actuel)
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="voir_sync_roles",
        description="Affiche les synchronisations de rôles configurées sur ce serveur.",
    )
    @app_commands.default_permissions(administrator=True)
    async def voir_sync_roles(self, interaction: discord.Interaction):
        try:
            async with aiosqlite.connect(DB_PATH) as db:
                # Filtrer par le serveur actuel uniquement
                async with db.execute(
                    """SELECT source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note
                       FROM role_sync WHERE source_guild_id = ?""",
                    (interaction.guild.id,),
                ) as cursor:
                    rows = await cursor.fetchall()

            if not rows:
                await interaction.response.send_message(
                    "Aucune synchronisation configurée sur ce serveur.", ephemeral=False
                )
                return

            embed = discord.Embed(
                title="Synchronisations de rôles",
                description=f"{len(rows)} correspondance(s) sur **{interaction.guild.name}**",
                color=discord.Color.blue(),
            )

            for i, (source_guild_id, source_role_id, target_guild_id, target_role_id, duree_minutes, note) in enumerate(rows, 1):
                source_role = interaction.guild.get_role(source_role_id)
                source_role_name = source_role.name if source_role else f"Supprimé ({source_role_id})"

                target_guild = self.bot.get_guild(target_guild_id)
                target_guild_name = target_guild.name if target_guild else f"Inconnu ({target_guild_id})"
                target_role = target_guild.get_role(target_role_id) if target_guild else None
                target_role_name = target_role.name if target_role else f"Supprimé ({target_role_id})"

                valeur = (
                    f"**{source_role_name}**\n"
                    f"→ **{target_role_name}** ({target_guild_name})"
                )
                if duree_minutes:
                    valeur += f"\nDurée : {formater_duree(duree_minutes)}"
                else:
                    valeur += "\nDurée : Permanent"
                if note:
                    valeur += f"\nNote : _{note}_"

                embed.add_field(name=f"#{i}", value=valeur, inline=False)

            await interaction.response.send_message(embed=embed)

        except Exception as e:
            if not interaction.response.is_done():
                await interaction.response.send_message(
                    f"Une erreur est survenue : {e}", ephemeral=True
                )

    # ──────────────────────────────────────────────
    # Resync manuelle d'un membre
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="resync",
        description="Force la resynchronisation des rôles d'un membre sur tous les serveurs cibles.",
    )
    @app_commands.default_permissions(administrator=True)
    @app_commands.describe(
        membre="Le membre dont on veut resynchroniser les rôles",
    )
    async def resync(self, interaction: discord.Interaction, membre: discord.Member):
        try:
            await interaction.response.defer(ephemeral=True)

            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute(
                    """SELECT source_role_id, target_guild_id, target_role_id, duree_minutes, note
                       FROM role_sync WHERE source_guild_id = ?""",
                    (interaction.guild.id,),
                ) as cursor:
                    mappings = await cursor.fetchall()

            if not mappings:
                await interaction.followup.send("Aucune synchronisation configurée sur ce serveur.")
                return

            ajouts = 0
            retraits = 0
            erreurs = 0

            for source_role_id, target_guild_id, target_role_id, duree_minutes, note in mappings:
                source_role = interaction.guild.get_role(source_role_id)
                if not source_role:
                    continue

                target_guild = self.bot.get_guild(target_guild_id)
                if not target_guild:
                    continue
                target_role = target_guild.get_role(target_role_id)
                if not target_role:
                    continue
                target_membre = target_guild.get_member(membre.id)
                if not target_membre:
                    continue

                a_le_role_source = source_role in membre.roles
                a_le_role_cible = target_role in target_membre.roles

                try:
                    if a_le_role_source and not a_le_role_cible:
                        await target_membre.add_roles(target_role, reason=f"Resync manuelle par {interaction.user}")
                        ajouts += 1
                    elif not a_le_role_source and a_le_role_cible:
                        await target_membre.remove_roles(target_role, reason=f"Resync manuelle par {interaction.user}")
                        retraits += 1
                except (discord.Forbidden, discord.HTTPException):
                    erreurs += 1

            msg = f"Resync de **{membre.display_name}** terminée :\n"
            msg += f"**{ajouts}** rôle(s) ajouté(s), **{retraits}** retiré(s)"
            if erreurs:
                msg += f", **{erreurs}** erreur(s)"

            await interaction.followup.send(msg)
            await self._log("Resync manuelle", interaction)

        except Exception as e:
            if interaction.response.is_done():
                await interaction.followup.send(f"Une erreur est survenue : {e}")
            else:
                await interaction.response.send_message(f"Une erreur est survenue : {e}", ephemeral=True)

    # ──────────────────────────────────────────────
    # Nettoyage des rôles/serveurs supprimés
    # ──────────────────────────────────────────────

    @app_commands.command(
        name="nettoyer_sync",
        description="Supprime les synchronisations dont le rôle ou le serveur n'existe plus.",
    )
    @app_commands.default_permissions(administrator=True)
    async def nettoyer_sync(self, interaction: discord.Interaction):
        try:
            await interaction.response.defer(ephemeral=True)

            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute(
                    """SELECT rowid, source_guild_id, source_role_id, target_guild_id, target_role_id
                       FROM role_sync WHERE source_guild_id = ?""",
                    (interaction.guild.id,),
                ) as cursor:
                    rows = await cursor.fetchall()

            orphelins = []
            for rowid, source_guild_id, source_role_id, target_guild_id, target_role_id in rows:
                source_role = interaction.guild.get_role(source_role_id)
                target_guild = self.bot.get_guild(target_guild_id)
                target_role = target_guild.get_role(target_role_id) if target_guild else None

                if not source_role or not target_guild or not target_role:
                    orphelins.append(rowid)

            if not orphelins:
                await interaction.followup.send("Aucune synchronisation orpheline trouvée. Tout est propre.")
                return

            async with aiosqlite.connect(DB_PATH) as db:
                for rowid in orphelins:
                    await db.execute("DELETE FROM role_sync WHERE rowid = ?", (rowid,))
                await db.commit()

            await interaction.followup.send(
                f"**{len(orphelins)}** synchronisation(s) orpheline(s) supprimée(s) "
                f"(rôle ou serveur supprimé)."
            )
            await self._log("Nettoyage des synchronisations orphelines", interaction)

        except Exception as e:
            if interaction.response.is_done():
                await interaction.followup.send(f"Une erreur est survenue : {e}")
            else:
                await interaction.response.send_message(f"Une erreur est survenue : {e}", ephemeral=True)


async def setup(bot):
    await bot.add_cog(SyncRoles(bot))
