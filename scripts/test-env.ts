// Loaded before every test file (`node --import`): a result must not depend on the machine that runs it. The
// maintainer's machine runs in Europe/Paris and CI runners in UTC, so the time zone is pinned here, before any test
// creates a date; locales are never taken from the machine, every test names the one it uses.
process.env['TZ'] = 'UTC';
