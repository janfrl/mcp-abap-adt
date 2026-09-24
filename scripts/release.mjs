// The release, as one command: changelogen decides the version and writes the
// changelog; this wrapper then folds every other copy of the version into the
// same release commit, because changelogen only touches package.json.
//
// server.json (the MCP registry manifest) and package-lock.json each carry the
// version twice. Both went stale for several releases while that was left to hand.
//
// Everything here happens locally before any push, which is what makes the
// amend and the tag move safe.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

function run(command) {
  execSync(command, { stdio: 'inherit' });
}

/** Sets the version fields `paths` points at; returns whether anything changed. */
function sync(file, version, paths) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  let changed = false;
  for (const path of paths) {
    const parent = path.slice(0, -1).reduce((node, key) => node[key], json);
    const key = path.at(-1);
    if (parent[key] !== version) {
      parent[key] = version;
      changed = true;
    }
  }
  if (changed) writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  return changed;
}

run('npx changelogen --release --clean');

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const synced = [
  sync('server.json', version, [['version'], ['packages', 0, 'version']]) && 'server.json',
  sync('package-lock.json', version, [['version'], ['packages', '', 'version']]) && 'package-lock.json',
].filter(Boolean);

if (synced.length === 0) {
  console.log(`Every version field already at ${version}.`);
} else {
  run(`git add ${synced.join(' ')}`);
  run('git commit --amend --no-edit');
  // The amend changed the commit hash, so the tag changelogen just created
  // points at a dropped commit; recreate it the way changelogen does.
  run(`git tag -f -am "v${version}" "v${version}"`);
  console.log(`${synced.join(' and ')} synced to ${version} inside the release commit.`);
}

console.log('\nReview the release commit and tag, then push and publish yourself.');
