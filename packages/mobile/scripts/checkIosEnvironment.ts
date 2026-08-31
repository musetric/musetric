import { execFileSync } from 'node:child_process';

const run = (command: string, args: readonly string[]): string =>
  execFileSync(command, [...args], { encoding: 'utf8', stdio: 'pipe' }).trim();

const requireMac = (): void => {
  if (process.platform !== 'darwin') {
    throw new Error('iOS validation must run on macOS.');
  }
};

const check = (
  label: string,
  command: string,
  args: readonly string[],
): void => {
  try {
    console.log(`${label}: ${run(command, args)}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is unavailable: ${detail}`, { cause: error });
  }
};

requireMac();
check('Xcode path', 'xcode-select', ['-p']);
check('Xcode', 'xcodebuild', ['-version']);
check('iPhone SDK', 'xcrun', ['--sdk', 'iphoneos', '--show-sdk-path']);
check('Rust', 'rustc', ['--version']);
check('Git LFS', 'git', ['lfs', 'version']);

const yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
const tauriHelp = run(yarnCommand, ['tauri', '--help']);
console.log(`Tauri CLI:\n${tauriHelp}`);
const hasIosCommand = tauriHelp
  .split(/\r?\n/u)
  .some((line) => line.trimStart().startsWith('ios'));
if (!hasIosCommand) {
  throw new Error(
    'The pinned Tauri CLI exposes no iOS command. Record this toolchain gate and obtain an approved compatible workflow before changing dependencies.',
  );
}
