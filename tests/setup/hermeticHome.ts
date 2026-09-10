import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Points the home directory at an empty scratch directory for every test file.
 *
 * c12 reads a user-level .mcp-abap-adtrc, and rc9 resolves where that is from
 * XDG_CONFIG_HOME or the home directory — neither of which loadAppConfig can be
 * told about, since rc9 discards the directory c12 hands it. Without this, a
 * developer who actually uses the feature has their own configuration merged
 * into the assertions, which reads as a failing test suite. CI never noticed
 * because a fresh runner has no such file.
 *
 * `homeDir` on loadAppConfig stays the way to steer the Fiori tools store; this
 * only closes the door that goes around it.
 */
export const HERMETIC_HOME = mkdtempSync(join(tmpdir(), 'mcp-abap-adt-home-'));

/**
 * What the variables held before the redirect. The live integration suite is
 * the one place that wants the ambient configuration - talking to real systems
 * is its whole point - and restores these for itself; vitest gives every test
 * file its own process, so that restoration reaches nobody else.
 *
 * The SAP_* entries close a second door, for the same reason but by a different
 * route. loadAppConfig hands c12 `dotenv: true`, so a .env in the repository
 * root is read wherever the home directory points - and a developer who put
 * real credentials there to run the integration suite watches three doctor
 * tests fail, because a system is suddenly configured where the assertions
 * expect none. Blanking rather than deleting is what does the work: dotenv
 * never overwrites a variable that is already set, so an empty value blocks the
 * file. The restoration above deletes those blanks again, which lets the very
 * same .env through for the live suite.
 */
export const AMBIENT_HOME_ENV: Readonly<Record<string, string | undefined>> = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  SAP_URL: process.env.SAP_URL,
  SAP_USERNAME: process.env.SAP_USERNAME,
  SAP_PASSWORD: process.env.SAP_PASSWORD,
  SAP_CLIENT: process.env.SAP_CLIENT,
};

process.env.HOME = HERMETIC_HOME;
process.env.USERPROFILE = HERMETIC_HOME;
process.env.XDG_CONFIG_HOME = HERMETIC_HOME;
process.env.SAP_URL = '';
process.env.SAP_USERNAME = '';
process.env.SAP_PASSWORD = '';
process.env.SAP_CLIENT = '';

/**
 * The environment for a child process that runs the built server. Blanking the
 * variables above protects this process; a child gets a deliberately minimal
 * environment of its own and so needs its own copy of the same precaution.
 *
 * It lives here, once, rather than in each e2e file: two suites spawn the
 * server today and a third would otherwise be free to forget one of the two
 * lists. Which is not hypothetical - cli.test.ts was missing exactly these
 * four entries, and it only showed up once dist/ existed, because the suite
 * skips itself without a build.
 */
export const HERMETIC_CHILD_ENV: Readonly<Record<string, string>> = {
  PATH: process.env.PATH ?? '',
  SystemRoot: process.env.SystemRoot ?? '',
  HOME: HERMETIC_HOME,
  USERPROFILE: HERMETIC_HOME,
  XDG_CONFIG_HOME: HERMETIC_HOME,
  SAP_URL: '',
  SAP_USERNAME: '',
  SAP_PASSWORD: '',
  SAP_CLIENT: '',
};
