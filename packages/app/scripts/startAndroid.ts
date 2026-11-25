import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';

const usage = `usage: pnpm start:android <serial> [--install] [--port <n>] [--eval <expression>]

  <serial>             the phone, as adb devices lists it
  --install            installs the APK of pnpm build:android first, keeping the app's data
  --port <n>           the local port of the WebView's DevTools (default: 9333)
  --eval <expression>  evaluates the expression in the page, prints its value and removes the port`;

const packageName = 'com.musetric.client.dev';
const apk = join(
  fileURLToPath(new URL('..', import.meta.url)),
  'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk',
);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    install: { type: 'boolean', default: false },
    port: { type: 'string', default: '9333' },
    eval: { type: 'string' },
  },
});
if (positionals.length !== 1) {
  console.error(usage);
  process.exit(1);
}
const [serial] = positionals;
const port = Number(values.port);

const adb = (...args: string[]) =>
  execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim();

const readPid = () => adb('shell', `pidof ${packageName} || true`);

const waitForSocket = async () => {
  for (let tries = 0; tries < 30; tries++) {
    await setTimeout(500);
    const pid = readPid();
    if (
      pid !== '' &&
      adb('shell', 'cat', '/proc/net/unix').includes(
        `@webview_devtools_remote_${pid}`,
      )
    ) {
      return pid;
    }
  }
  return undefined;
};

const start = async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    adb(
      'shell',
      'am',
      'start',
      '-W',
      '-n',
      `${packageName}/com.musetric.client.MainActivity`,
    );
    const pid = await waitForSocket();
    await setTimeout(2000);
    if (pid !== undefined && readPid() === pid) {
      return pid;
    }
    console.log(`Musetric Dev did not stay up, start ${attempt} of 3`);
  }
  throw new Error(`Musetric Dev does not start on ${serial}`);
};

const targetsSchema = z.array(
  z.object({
    type: z.string(),
    title: z.string(),
    url: z.string(),
    webSocketDebuggerUrl: z.string(),
  }),
);

const evaluateSchema = z.object({
  id: z.number(),
  result: z.object({
    result: z.object({ value: z.unknown().optional() }),
    exceptionDetails: z.unknown().optional(),
  }),
});

const evaluate = async (webSocketUrl: string, expression: string) =>
  new Promise<z.infer<typeof evaluateSchema>['result']>((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
    socket.addEventListener('message', (event) => {
      const parsed = evaluateSchema.safeParse(JSON.parse(String(event.data)));
      if (parsed.success && parsed.data.id === 1) {
        socket.close();
        resolve(parsed.data.result);
      }
    });
    socket.addEventListener('error', () => {
      reject(new Error(`No DevTools connection at ${webSocketUrl}`));
    });
  });

if (values.install) {
  const started = Date.now();
  adb('install', '-r', apk);
  console.log(`Installed ${apk} in ${(Date.now() - started) / 1000} s`);
}
const pid = await start();
adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
const response = await fetch(`http://127.0.0.1:${port}/json`);
const pages = targetsSchema
  .parse(await response.json())
  .filter((target) => target.type === 'page');
for (const page of pages) {
  console.log(`${page.title} ${page.url} ${page.webSocketDebuggerUrl}`);
}
if (values.eval === undefined) {
  console.log(
    `DevTools of Musetric Dev on ${serial} at http://127.0.0.1:${port}; remove with adb -s ${serial} forward --remove tcp:${port}`,
  );
} else {
  const main = pages.find((page) => page.title === 'Musetric');
  if (main === undefined) {
    throw new Error(`The page of Musetric is not open on ${serial}`);
  }
  const result = await evaluate(main.webSocketDebuggerUrl, values.eval);
  adb('forward', '--remove', `tcp:${port}`);
  console.log(JSON.stringify(result.exceptionDetails ?? result.result.value));
  if (result.exceptionDetails !== undefined) {
    process.exit(1);
  }
}
