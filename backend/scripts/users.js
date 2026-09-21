#!/usr/bin/env node
// Administra los usuarios de duokit (no hay registro público).
//   node scripts/users.js add [usuario] [nombre] [AAAA-MM-DD|nunca] [basic|lifetime]
//   node scripts/users.js list
//   node scripts/users.js passwd <usuario>
//   node scripts/users.js admin
//   node scripts/users.js expire <usuario> <AAAA-MM-DD|nunca>
//   node scripts/users.js remove <usuario>
const readline = require('readline');
const auth = require('../auth');
const { PLANS } = require('../plans');

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

async function add(usernameArg, nameArg, expiryArg, planArg) {
  const username = auth.normalizeUsername(usernameArg || (await ask('Usuario: ')));
  if (!auth.USERNAME_REGEX.test(username)) {
    throw new Error('El usuario debe tener de 3 a 32 caracteres: letras, números, punto, guion o guion bajo.');
  }
  const name = (nameArg || (await ask('Nombre (el que se muestra en la app): '))).trim();
  if (!name) throw new Error('El nombre es obligatorio.');
  const expiresAt = parseExpiry(expiryArg ?? (await ask('Acceso hasta (AAAA-MM-DD, Enter = sin vencimiento): ')));
  const plan = (planArg ?? (await ask('Plan (basic = 1080p, lifetime = 4K) [basic]: '))).trim().toLowerCase() || 'basic';
  if (!PLANS[plan]) throw new Error('El plan debe ser basic o lifetime.');
  const password = await askHidden('Contraseña (mínimo 8 caracteres): ');
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  if (password !== (await askHidden('Repite la contraseña: '))) throw new Error('Las contraseñas no coinciden.');
  const user = await auth.addUser({ username, name, password, expiresAt, plan });
  console.log(`Usuario creado: ${user.username} (${user.name}) — plan ${PLANS[user.plan].name}, acceso ${user.expiresAt ? `hasta el ${user.expiresAt}` : 'sin vencimiento'}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'add':
      await add(args[0], args[1], args[2], args[3]);
      break;
    case 'passwd': {
      if (!args[0]) throw new Error('Uso: passwd <usuario>');
      const user = auth.listUsers().find((u) => u.username === auth.normalizeUsername(args[0]));
      if (!user) throw new Error('No existe ese usuario.');
      // Quien entra como administrador puede confirmar pagos (crear cuentas): su contraseña debe ser larga.
      const minLength = user.role === 'admin' ? 12 : 8;
      const password = await askHidden(`Contraseña nueva (mínimo ${minLength} caracteres): `);
      if (password.length < minLength) throw new Error(`La contraseña debe tener al menos ${minLength} caracteres.`);
      if (password !== (await askHidden('Repite la contraseña: '))) throw new Error('Las contraseñas no coinciden.');
      await auth.setPassword(user.id, password);
      console.log(`Contraseña de ${user.username} actualizada.`);
      break;
    }
    case 'admin': {
      // Crea el usuario administrador con una contraseña aleatoria segura (se muestra una sola vez).
      if (auth.listUsers().some((u) => u.role === 'admin')) throw new Error('Ya existe un administrador. Para cambiar su contraseña: npm run user:passwd -- admin');
      const password = auth.generatePassword(20);
      await auth.addUser({ username: 'admin', name: 'Administrador', password, plan: 'lifetime', role: 'admin' });
      console.log(`Administrador creado.\n  Usuario:    admin\n  Contraseña: ${password}\nGuárdala ahora: no se vuelve a mostrar.`);
      break;
    }
    case 'list': {
      const users = auth.listUsers();
      if (users.length === 0) console.log('No hay usuarios. Crea uno con: npm run user:add');
      for (const u of users) {
        const access = u.expiresAt ? `hasta ${u.expiresAt}${u.expired ? ' (VENCIDO)' : ''}` : 'sin vencimiento';
        const tags = [u.role === 'admin' ? 'admin' : PLANS[u.plan]?.name || 'Básico', u.status === 'banned' ? 'BLOQUEADO' : ''].filter(Boolean).join(' ');
        console.log(`${u.username}\t${u.name}\t${tags}\t${access}`);
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
      console.log('Uso: node scripts/users.js <add|list|passwd|admin|expire|remove> [usuario] [nombre|fecha] [plan]');
  }
}

main()
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
