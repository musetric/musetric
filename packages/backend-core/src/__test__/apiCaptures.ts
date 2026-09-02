import { type ApiClient, type ApiSnapshot } from './apiResponse.js';
import { createFixtureAudioFile, fixtureProjectId } from './projectFixture.js';

export const readUrls = [
  '/api/project/list',
  `/api/project/${fixtureProjectId}`,
  `/api/chords/project/${fixtureProjectId}`,
  `/api/key/project/${fixtureProjectId}`,
  `/api/rhythm/project/${fixtureProjectId}`,
  `/api/subtitle/project/${fixtureProjectId}`,
  '/api/preview/1',
  `/api/audio/project/${fixtureProjectId}/master/source/content`,
  `/api/audio/project/${fixtureProjectId}/master/lead/content`,
  `/api/audio/project/${fixtureProjectId}/delivery/lead/content`,
  `/api/audio/project/${fixtureProjectId}/delivery/lead/wave`,
  `/api/audio/project/${fixtureProjectId}/recording/content`,
  `/api/audio/project/${fixtureProjectId}/recording/wave`,
];

export const missingUrls = [
  '/api/project/404',
  '/api/chords/project/404',
  '/api/key/project/404',
  '/api/rhythm/project/404',
  '/api/subtitle/project/404',
  '/api/preview/404',
  '/api/audio/project/404/master/source/content',
  '/api/audio/project/404/delivery/lead/content',
];

const subtitleUrl = `/api/subtitle/project/${fixtureProjectId}`;

const captureConditional = async (
  client: ApiClient,
): Promise<ApiSnapshot[]> => {
  const first = await client.capture({ method: 'GET', url: subtitleUrl });
  const second = await client.capture({
    method: 'GET',
    url: subtitleUrl,
    headers: { 'if-none-match': first.headers.etag },
  });
  return [first, second];
};

const captureWrites = async (client: ApiClient): Promise<ApiSnapshot[]> => {
  const created = new FormData();
  created.set('name', 'Created project');
  created.set('song', createFixtureAudioFile());
  const renamed = new FormData();
  renamed.set('name', 'Renamed project');
  return [
    await client.capture({
      method: 'POST',
      url: `/api/project/${fixtureProjectId}/retry`,
      body: { step: 'chords' },
    }),
    await client.capture({
      method: 'POST',
      url: '/api/project/create',
      payload: created,
    }),
    await client.capture({
      method: 'PATCH',
      url: `/api/project/${fixtureProjectId}/edit`,
      payload: renamed,
    }),
    await client.capture({
      method: 'DELETE',
      url: `/api/project/${fixtureProjectId}/remove`,
    }),
  ];
};

export const captureEverything = async (
  client: ApiClient,
): Promise<ApiSnapshot[]> => {
  const snapshots: ApiSnapshot[] = [];
  for (const url of [...readUrls, ...missingUrls]) {
    snapshots.push(await client.capture({ method: 'GET', url }));
  }
  snapshots.push(...(await captureConditional(client)));
  snapshots.push(await client.captureStream('/api/project/status/stream'));
  snapshots.push(...(await captureWrites(client)));
  return snapshots;
};
