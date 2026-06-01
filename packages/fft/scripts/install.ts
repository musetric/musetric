import { execSync } from 'child_process';

if (process.platform !== 'linux') {
  console.log('Installing Playwright browsers...');
  execSync('npx playwright install', { stdio: 'inherit' });
} else {
  console.log('Skipping Playwright install on Linux');
}
