/**
 * Creates (or re-activates) an administrator account.
 *
 *   npm run admin:create -- --email admin@kvcet.edu.in --name "System Administrator"
 *
 * The password is read from ADMIN_PASSWORD or prompted for interactively; it is never
 * accepted as a command-line argument so it does not end up in shell history.
 */
import 'dotenv/config';
import readline from 'node:readline';
import { db } from '../db/database';
import { hashPassword, passwordPolicyError } from '../lib/auth';
import { nowIso, uid } from '../lib/util';

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function promptHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const anyRl = rl as any;
  anyRl._writeToOutput = (s: string) => {
    if (s.includes(question)) process.stdout.write(s);
  };
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    }),
  );
}

async function main() {
  const email = arg('email');
  const name = arg('name') || 'System Administrator';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Usage: npm run admin:create -- --email admin@kvcet.edu.in [--name "Full Name"]');
    process.exit(1);
  }
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden('Password for the administrator: ');
    const confirm = await promptHidden('Repeat password: ');
    if (password !== confirm) {
      console.error('Passwords do not match.');
      process.exit(1);
    }
  }
  const policy = passwordPolicyError(password);
  if (policy) {
    console.error(policy);
    process.exit(1);
  }
  const database = db();
  const existing = database.get<any>('SELECT id, role FROM users WHERE email = ?', email);
  const now = nowIso();
  if (existing) {
    if (existing.role !== 'Admin') {
      console.error(`${email} already exists with role ${existing.role}. Use a different email.`);
      process.exit(1);
    }
    database.run('UPDATE users SET password_hash = ?, is_active = 1, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?', hashPassword(password), now, existing.id);
    console.log(`Administrator ${email} re-activated and password updated.`);
  } else {
    const id = uid('usr');
    database.run(
      `INSERT INTO users (id, email, password_hash, name, role, designation, created_at, updated_at) VALUES (?, ?, ?, ?, 'Admin', 'System Administrator', ?, ?)`,
      id,
      email,
      hashPassword(password),
      name,
      now,
      now,
    );
    database.run(`INSERT INTO audit_log (actor_id, action, entity_type, entity_id, details_json, created_at) VALUES (NULL, 'cli.admin_created', 'user', ?, ?, ?)`, id, JSON.stringify({ email }), now);
    console.log(`Administrator ${email} created. Sign in at /login and provision the remaining accounts from the Admin portal.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
