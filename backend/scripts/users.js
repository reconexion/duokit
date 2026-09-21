#!/usr/bin/env node
// Administra los usuarios de duokit (no hay registro público).
//   node scripts/users.js add [usuario] [nombre] [AAAA-MM-DD]
//   node scripts/users.js list
//   node scripts/users.js expire <usuario> <AAAA-MM-DD|nunca>
//   node scripts/users.js remove <usuario>
const readline = require('readline');
const auth = require('../auth');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

// Pide la contraseña sin mostrarla en pantalla.
function askHidden(question) {
  return new Promise((resolve) => {
    const write = rl._writeToOutput;
    process.stdout.write(question);
    rl._writeToOutput = () => {};
    rl.question('', (answer) => {
      rl._writeToOutput = write;
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

// "2026-12-31" -> "2026-12-31"; "nunca" o vacío -> null (sin vencimiento).
function parseExpiry(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value || value === 'nunca') return null;
  if (!auth.isValidDate(value)) throw new Error('La fecha debe tener el formato AAAA-MM-DD, por ejemplo 2026-12-31.');
  return value;
}

async function add(usernameArg, nameArg, expiryArg) {
  const username = auth.normalizeUsername(usernameArg || (await ask('Usuario: ')));
  if (!auth.USERNAME_REGEX.test(username)) {
    throw new Error('El usuario debe tener de 3 a 32 caracteres: letras, números, punto, guion o guion bajo.');
  }
  const name = (nameArg || (await ask('Nombre (el que se muestra en la app): '))).trim();
  if (!name) throw new Error('El nombre es obligatorio.');
  const expiresAt = parseExpiry(expiryArg ?? (await ask('Acceso hasta (AAAA-MM-DD, Enter = sin vencimiento): ')));
  const password = await askHidden('Contraseña (mínimo 8 caracteres): ');
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  if (password !== (await askHidden('Repite la contraseña: '))) throw new Error('Las contraseñas no coinciden.');
  const user = await auth.addUser({ username, name, password, expiresAt });
  console.log(`Usuario creado: ${user.username} (${user.name}) — acceso ${user.expiresAt ? `hasta el ${user.expiresAt}` : 'sin vencimiento'}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'add':
      await add(args[0], args[1], args[2]);
      break;
    case 'list': {
      const users = auth.listUsers();
      if (users.length === 0) console.log('No hay usuarios. Crea uno con: npm run user:add');
      for (const u of users) {
        const access = u.expiresAt ? `hasta ${u.expiresAt}${u.expired ? ' (VENCIDO)' : ''}` : 'sin vencimiento';
        console.log(`${u.username}\t${u.name}\t${access}`);
      }
      break;
    }
    case 'expire': {
      if (!args[0] || !args[1]) throw new Error('Uso: expire <usuario> <AAAA-MM-DD|nunca>');
      const expiresAt = parseExpiry(args[1]);
      if (!auth.setExpiry(args[0], expiresAt)) throw new Error('No existe ese usuario.');
      console.log(expiresAt ? `El acceso de ${args[0]} vence el ${expiresAt}.` : `${args[0]} ya no tiene fecha de vencimiento.`);
      break;
    }
    case 'remove':
      if (!args[0]) throw new Error('Indica el usuario: remove <usuario>');
      console.log(auth.removeUser(args[0]) ? 'Usuario eliminado.' : 'No existe ese usuario.');
      break;
    default:
      console.log('Uso: node scripts/users.js <add|list|expire|remove> [usuario] [nombre|fecha]');
  }
}

main()
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
