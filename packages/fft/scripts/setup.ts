import { execSync } from 'child_process';

const skipPlaywrightInstall =
  process.env.MUSETRIC_SKIP_PLAYWRIGHT_INSTALL !== undefined;

if (process.platform !== 'linux' && !skipPlaywrightInstall) {
  console.log('Installing Playwright browsers...');
  execSync('npx playwright install', { stdio: 'inherit' });
} else if (skipPlaywrightInstall) {
  console.log('Skipping Playwright install.');
} else {
  console.log('Skipping Playwright install on Linux');
}
