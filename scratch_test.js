const { PermissionsBitField } = require('discord.js');
const perms = new PermissionsBitField();
console.log(perms.has(PermissionsBitField.Flags.Administrator));
perms.has = () => true;
console.log(perms.has(PermissionsBitField.Flags.Administrator));
