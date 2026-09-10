// Inspects what `npm publish` would upload, before it is too late to take back.
// Catches the mechanical leaks: stray files, credential-looking tokens, private
// keys, local paths, real e-mail addresses. Company-specific patterns (system
// ids, internal hostnames) must not live in this public file; put them, one
// regular expression per line, into the file named by PACKAGE_CHECK_PATTERNS.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const allowedPaths = [/^dist\//u, /^README\.md$/u, /^LICENSE$/u, /^package\.json$/u];

const forbidden = [
  { label: 'credential-looking token', pattern: /\b(?:ghp_|github_pat_|npm_|AKIA|xox[baprs]-)[\w-]{10,}/u },
  { label: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
  { label: 'absolute local path', pattern: /(?:[A-Za-z]:\\Users\\(?!you\b)|\/home\/[a-z]|\/Users\/(?!you\b)[a-z])/u },
  {
    label: 'real-looking e-mail address',
    pattern: /[\w.%+-]+@(?!example\.(?:com|org|net)\b)[A-Za-z0-9.-]+\.(?!invalid\b)[A-Za-z]{2,}/u,
  },
];

const extraFile = process.env.PACKAGE_CHECK_PATTERNS;
if (extraFile && existsSync(extraFile)) {
  for (const line of readFileSync(extraFile, 'utf8').split('\n')) {
    const source = line.trim();
    if (source && !source.startsWith('#')) forbidden.push({ label: `pattern ${source}`, pattern: new RegExp(source, 'iu') });
  }
}

function packedFiles() {
  const output = execSync('npm pack --dry-run --json --ignore-scripts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const plain = output.replaceAll(/\[[0-9;]*m/gu, '');
  const start = plain.search(/^\[/mu);
  if (start < 0) throw new Error('npm pack printed no JSON');
  return JSON.parse(plain.slice(start))[0].files.map((file) => file.path);
}

if (!existsSync('dist/index.js')) {
  console.error('dist/ is missing; run the build first.');
  process.exit(1);
}

const problems = [];
const files = packedFiles();
for (const file of files) {
  if (!allowedPaths.some((pattern) => pattern.test(file))) {
    problems.push(`${file}: not on the list of files the package may contain`);
    continue;
  }
  const text = readFileSync(path.resolve(file), 'utf8');
  for (const { label, pattern } of forbidden) {
    const match = pattern.exec(text);
    if (match) problems.push(`${file}: ${label} ("${match[0].slice(0, 40)}")`);
  }
}

if (problems.length > 0) {
  console.error(`The package must not be published as it is:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Package check passed: ${files.length} files, nothing that should not be there.`);
