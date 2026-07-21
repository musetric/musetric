import { createReadStream } from 'node:fs';
import { type ServerResponse } from 'node:http';

export const sendFile = async (
  path: string,
  response: ServerResponse,
  contentType = 'application/octet-stream',
): Promise<void> => {
  response.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(response);
  });
};
