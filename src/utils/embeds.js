const { EmbedBuilder } = require('discord.js');

const COLORS = {
    success: 0x57F287,
    error: 0xED4245,
    warning: 0xFEE75C,
    info: 0x5865F2,
    orange: 0xE67E22,
};

function createSuccessEmbed(description) {
    return new EmbedBuilder()
        .setColor(COLORS.success)
        .setDescription(`✓ ${description}`)
        .setTimestamp();
}

function createErrorEmbed(description) {
    return new EmbedBuilder()
        .setColor(COLORS.error)
        .setDescription(description)
        .setTimestamp();
}

function createWarningEmbed(description) {
    return new EmbedBuilder()
        .setColor(COLORS.warning)
        .setDescription(description)
        .setTimestamp();
}

function createInfoEmbed(description) {
    return new EmbedBuilder()
        .setColor(COLORS.info)
        .setDescription(description)
        .setTimestamp();
}

function createEmbed({ title, description, color, fields, footer, thumbnail }) {
    const embed = new EmbedBuilder()
        .setColor(color || COLORS.info)
        .setTimestamp();

    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (fields && fields.length > 0) embed.addFields(fields);
    if (footer) embed.setFooter({ text: footer });
    if (thumbnail) embed.setThumbnail(thumbnail);

    return embed;
}

module.exports = { COLORS, createSuccessEmbed, createErrorEmbed, createWarningEmbed, createInfoEmbed, createEmbed };
