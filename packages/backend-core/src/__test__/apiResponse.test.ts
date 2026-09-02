import { expect, test } from 'vitest';
import { missingUrls, readUrls } from './apiCaptures.js';
import { type ApiSnapshot, withTestServer } from './apiResponse.js';
import {
  createFixtureAudioFile,
  failFixtureStep,
  fixtureProjectId,
} from './projectFixture.js';

test('read routes answer the same way', async () => {
  const snapshots = await withTestServer(async (client) => {
    const result: ApiSnapshot[] = [];
    for (const url of readUrls) {
      result.push(await client.capture({ method: 'GET', url }));
    }
    return result;
  });
  expect(snapshots).toMatchSnapshot();
});

test('missing resources answer the same way', async () => {
  const snapshots = await withTestServer(async (client) => {
    const result: ApiSnapshot[] = [];
    for (const url of missingUrls) {
      result.push(await client.capture({ method: 'GET', url }));
    }
    return result;
  });
  expect(snapshots).toMatchSnapshot();
});

test('a matching etag answers not modified', async () => {
  const snapshot = await withTestServer(async (client) => {
    const url = `/api/subtitle/project/${fixtureProjectId}`;
    const first = await client.capture({ method: 'GET', url });
    return await client.capture({
      method: 'GET',
      url,
      headers: { 'if-none-match': first.headers.etag },
    });
  });
  expect(snapshot).toMatchSnapshot();
});

test('the status stream opens as server-sent events', async () => {
  const snapshot = await withTestServer(async (client) =>
    client.captureStream('/api/project/status/stream'),
  );
  expect(snapshot).toMatchSnapshot();
});

test('creating a project answers the same way', async () => {
  const snapshot = await withTestServer(async (client) => {
    const payload = new FormData();
    payload.set('name', 'Created project');
    payload.set('song', createFixtureAudioFile());
    return await client.capture({
      method: 'POST',
      url: '/api/project/create',
      payload,
    });
  });
  expect(snapshot).toMatchSnapshot();
});

test('editing a project answers the same way', async () => {
  const snapshot = await withTestServer(async (client) => {
    const payload = new FormData();
    payload.set('name', 'Renamed project');
    return await client.capture({
      method: 'PATCH',
      url: `/api/project/${fixtureProjectId}/edit`,
      payload,
    });
  });
  expect(snapshot).toMatchSnapshot();
});

test('removing a project answers the same way', async () => {
  const snapshots = await withTestServer(async (client) => [
    await client.capture({
      method: 'DELETE',
      url: `/api/project/${fixtureProjectId}/remove`,
    }),
    await client.capture({
      method: 'GET',
      url: `/api/project/${fixtureProjectId}`,
    }),
  ]);
  expect(snapshots).toMatchSnapshot();
});

test('retrying a failed step answers the same way', async () => {
  const snapshots = await withTestServer(async (client, workspace) => {
    const notFailed = await client.capture({
      method: 'POST',
      url: `/api/project/${fixtureProjectId}/retry`,
      body: { step: 'chords' },
    });
    await failFixtureStep(workspace, 'chords');
    const failed = await client.capture({
      method: 'POST',
      url: `/api/project/${fixtureProjectId}/retry`,
      body: { step: 'chords' },
    });
    return [notFailed, failed];
  });
  expect(snapshots).toMatchSnapshot();
});

test('the fixture is built the same way twice', async () => {
  const read = async (): Promise<ApiSnapshot> =>
    await withTestServer(
      async (client) =>
        await client.capture({
          method: 'GET',
          url: `/api/project/${fixtureProjectId}`,
        }),
    );
  expect(await read()).toEqual(await read());
});
