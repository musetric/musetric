import { type ApiClient, type ApiSnapshot } from './apiResponse.js';
import { createFixtureAudioFile, fixtureProjectId } from './projectFixture.js';

const createdProjectId = fixtureProjectId + 1;

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
  '/api/audio/project/404/recording/content',
  '/api/audio/project/404/recording/wave',
];

export const invalidUrls = [
  '/api/chords/project/abc',
  '/api/subtitle/project/abc',
  '/api/preview/abc',
  '/api/audio/project/1/master/vocals/content',
  '/api/audio/project/1/delivery/vocals/wave',
];

const subtitleUrl = `/api/subtitle/project/${fixtureProjectId}`;

const createForm = (fields: Record<string, string | File>): FormData => {
  const form = new FormData();
  Object.entries(fields).forEach((entry) => {
    const [name, value] = entry;
    form.set(name, value);
  });
  return form;
};

const createPreviewFile = (marker: string): File =>
  new File([Buffer.from(`preview ${marker}`, 'utf8')], `${marker}.png`, {
    type: 'image/png',
  });

const createBrokenAudioFile = (): File =>
  new File([Buffer.from('not an audio file', 'utf8')], 'broken.wav', {
    type: 'audio/wav',
  });

const volatileHeaders = ['etag', 'last-modified'];

const withoutBlobHeaders = (snapshot: ApiSnapshot): ApiSnapshot => {
  const headers = Object.fromEntries(
    Object.entries(snapshot.headers).filter(
      (entry) => !volatileHeaders.includes(entry[0]),
    ),
  );
  return { ...snapshot, headers };
};

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

export const captureInvalidWrites = async (
  client: ApiClient,
): Promise<ApiSnapshot[]> => [
  await client.capture({
    method: 'POST',
    url: '/api/project/create',
    payload: createForm({ name: 'ab', song: createFixtureAudioFile() }),
  }),
  await client.capture({
    method: 'POST',
    url: '/api/project/create',
    payload: createForm({ song: createFixtureAudioFile() }),
  }),
  await client.capture({
    method: 'POST',
    url: '/api/project/create',
    payload: createForm({ name: 'Without a song' }),
  }),
  await client.capture({
    method: 'POST',
    url: '/api/project/create',
    payload: createForm({}),
  }),
  await client.capture({
    method: 'POST',
    url: '/api/project/create',
    payload: createForm({
      name: 'Broken song',
      song: createBrokenAudioFile(),
    }),
  }),
  await client.capture({
    method: 'PATCH',
    url: `/api/project/${fixtureProjectId}/edit`,
    payload: createForm({ name: 'ab' }),
  }),
  await client.capture({
    method: 'PATCH',
    url: `/api/project/${fixtureProjectId}/edit`,
    payload: createForm({ withoutPreview: 'maybe' }),
  }),
  await client.capture({
    method: 'PATCH',
    url: '/api/project/404/edit',
    payload: createForm({ name: 'Renamed project' }),
  }),
  await client.capture({
    method: 'PATCH',
    url: '/api/project/abc/edit',
    payload: createForm({ name: 'Renamed project' }),
  }),
  await client.capture({ method: 'DELETE', url: '/api/project/404/remove' }),
  await client.capture({ method: 'DELETE', url: '/api/project/abc/remove' }),
];

export const captureWrites = async (
  client: ApiClient,
): Promise<ApiSnapshot[]> => [
  await client.capture({
    method: 'POST',
    url: `/api/project/${fixtureProjectId}/retry`,
    body: { step: 'chords' },
  }),
  await client.capture({
    method: 'POST',
    url: '/api/project/create',
    payload: createForm({
      name: 'Created project',
      song: createFixtureAudioFile(),
      preview: createPreviewFile('created'),
    }),
  }),
  await client.capture({
    method: 'GET',
    url: `/api/project/${createdProjectId}`,
  }),
  withoutBlobHeaders(
    await client.capture({
      method: 'GET',
      url: `/api/audio/project/${createdProjectId}/master/source/content`,
    }),
  ),
  withoutBlobHeaders(
    await client.capture({ method: 'GET', url: `/api/preview/2` }),
  ),
  await client.capture({
    method: 'PATCH',
    url: `/api/project/${fixtureProjectId}/edit`,
    payload: createForm({ name: 'Renamed project' }),
  }),
  await client.capture({
    method: 'PATCH',
    url: `/api/project/${fixtureProjectId}/edit`,
    payload: createForm({ preview: createPreviewFile('replaced') }),
  }),
  await client.capture({
    method: 'GET',
    url: `/api/project/${fixtureProjectId}`,
  }),
  withoutBlobHeaders(
    await client.capture({ method: 'GET', url: `/api/preview/3` }),
  ),
  await client.capture({
    method: 'PATCH',
    url: `/api/project/${fixtureProjectId}/edit`,
    payload: createForm({ withoutPreview: 'true' }),
  }),
  await client.capture({
    method: 'DELETE',
    url: `/api/project/${fixtureProjectId}/remove`,
  }),
];

export const captureEverything = async (
  client: ApiClient,
): Promise<ApiSnapshot[]> => {
  const snapshots: ApiSnapshot[] = [];
  for (const url of [...readUrls, ...missingUrls, ...invalidUrls]) {
    snapshots.push(await client.capture({ method: 'GET', url }));
  }
  snapshots.push(...(await captureConditional(client)));
  snapshots.push(await client.captureStream('/api/project/status/stream'));
  snapshots.push(...(await captureInvalidWrites(client)));
  snapshots.push(...(await captureWrites(client)));
  return snapshots;
};
