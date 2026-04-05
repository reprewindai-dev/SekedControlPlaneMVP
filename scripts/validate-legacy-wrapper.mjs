import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const wrappers = [
  {
    name: 'canonical legacy wrapper',
    dir: path.join(repoRoot, 'legacy', 'express-wrapper'),
  },
  {
    name: 'archived legacy mirror',
    dir: path.join(repoRoot, '_archived', 'seked-control-plane-wrapper', 'SekedControlPlaneMVP'),
  },
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseEnvFile(filePath) {
  const contents = readFileSync(filePath, 'utf8');
  const env = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex < 1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function resolveDatabaseUrl(wrapperDir) {
  const envPath = path.join(wrapperDir, '.env');
  const examplePath = path.join(wrapperDir, '.env.example');

  if (existsSync(envPath)) {
    const parsed = parseEnvFile(envPath);
    if (parsed.DATABASE_URL) {
      return { value: parsed.DATABASE_URL, source: '.env' };
    }
  }

  if (existsSync(examplePath)) {
    const parsed = parseEnvFile(examplePath);
    if (parsed.DATABASE_URL) {
      return { value: parsed.DATABASE_URL, source: '.env.example' };
    }
  }

  return null;
}

function resolvePrismaCommand(wrapperDir, schemaPath) {
  const localPrisma = path.join(
    wrapperDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
  );

  if (existsSync(localPrisma)) {
    return {
      command: localPrisma,
      args: ['validate', '--schema', schemaPath],
      label: 'local prisma binary',
    };
  }

  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['--yes', 'prisma@5.22.0', 'validate', '--schema', schemaPath],
    label: 'npx prisma@5.22.0',
  };
}

function quoteWindowsArg(value) {
  if (value.length === 0) {
    return '""';
  }

  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

for (const wrapper of wrappers) {
  if (!existsSync(wrapper.dir)) {
    fail(`Wrapper path not found: ${wrapper.dir}`);
  }

  const schemaPath = path.join(wrapper.dir, 'schema.prisma');
  if (!existsSync(schemaPath)) {
    fail(`Wrapper schema not found: ${schemaPath}`);
  }

  const databaseUrl = resolveDatabaseUrl(wrapper.dir);
  if (!databaseUrl) {
    fail(`DATABASE_URL not found in ${wrapper.dir} (.env or .env.example)`);
  }

  const prismaCommand = resolvePrismaCommand(wrapper.dir, schemaPath);
  console.log(
    `Validating ${wrapper.name} with ${prismaCommand.label} using DATABASE_URL from ${databaseUrl.source}...`,
  );

  const sharedOptions = {
    cwd: wrapper.dir,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl.value,
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
    },
  };

  const result =
    process.platform === 'win32'
      ? spawnSync(
          process.env.ComSpec ?? 'cmd.exe',
          [
            '/d',
            '/s',
            '/c',
            `${quoteWindowsArg(prismaCommand.command)} ${prismaCommand.args.map(quoteWindowsArg).join(' ')}`,
          ],
          sharedOptions,
        )
      : spawnSync(prismaCommand.command, prismaCommand.args, sharedOptions);

  if (result.error) {
    fail(`Failed to launch Prisma validation for ${wrapper.name}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`Prisma validation failed for ${wrapper.name}.`);
  }
}

console.log('Legacy wrapper Prisma validation passed for both canonical and archived copies.');
