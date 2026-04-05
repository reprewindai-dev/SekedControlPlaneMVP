import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const canonicalRoot = path.join(repoRoot, 'legacy', 'express-wrapper');
const mirrorRoot = path.join(repoRoot, '_archived', 'seked-control-plane-wrapper', 'SekedControlPlaneMVP');

const ignoredTopLevelEntries = new Set(['.env', 'dist', 'node_modules', '.git']);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function listFiles(root, current = root, files = []) {
  const entries = readdirSync(current, { withFileTypes: true });

  for (const entry of entries) {
    if (ignoredTopLevelEntries.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      listFiles(root, absolutePath, files);
      continue;
    }

    files.push(relativePath);
  }

  return files.sort();
}

function hashFile(filePath) {
  const normalizedContents = readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalizedContents).digest('hex');
}

if (!existsSync(canonicalRoot)) {
  fail(`Canonical legacy wrapper path not found: ${canonicalRoot}`);
}

if (!existsSync(mirrorRoot)) {
  fail(`Archived legacy wrapper mirror not found: ${mirrorRoot}`);
}

const canonicalFiles = listFiles(canonicalRoot);
const mirrorFiles = listFiles(mirrorRoot);

const mirrorFileSet = new Set(mirrorFiles);
const canonicalFileSet = new Set(canonicalFiles);

const missingInMirror = canonicalFiles.filter((relativePath) => !mirrorFileSet.has(relativePath));
const extraInMirror = mirrorFiles.filter((relativePath) => !canonicalFileSet.has(relativePath));
const contentMismatches = canonicalFiles.filter((relativePath) => {
  if (!mirrorFileSet.has(relativePath)) {
    return false;
  }

  const canonicalHash = hashFile(path.join(canonicalRoot, relativePath));
  const mirrorHash = hashFile(path.join(mirrorRoot, relativePath));
  return canonicalHash !== mirrorHash;
});

if (missingInMirror.length > 0 || extraInMirror.length > 0 || contentMismatches.length > 0) {
  const details = [
    missingInMirror.length > 0 ? `Missing in mirror:\n- ${missingInMirror.join('\n- ')}` : null,
    extraInMirror.length > 0 ? `Unexpected in mirror:\n- ${extraInMirror.join('\n- ')}` : null,
    contentMismatches.length > 0 ? `Content mismatches:\n- ${contentMismatches.join('\n- ')}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  fail(
    [
      'Legacy wrapper snapshot drift detected.',
      'The canonical legacy wrapper is legacy/express-wrapper.',
      'The archived mirror must stay byte-for-byte aligned except for ignored local/runtime directories.',
      '',
      details,
    ].join('\n'),
  );
}

console.log(
  `Legacy wrapper sync check passed. Compared ${canonicalFiles.length} files between canonical and archived mirror.`,
);
