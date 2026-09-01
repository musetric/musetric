import { expect, test } from 'vitest';
import {
  type ApiSnapshot,
  captureResponse,
  captureStream,
  withTestServer,
} from './apiResponse.js';
import {
  createFixtureAudioFile,
  failFixtureStep,
  fixtureProjectId,
} from './projectFixture.js';

const readUrls = [
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

const missingUrls = [
  '/api/project/404',
  '/api/chords/project/404',
  '/api/key/project/404',
  '/api/rhythm/project/404',
  '/api/subtitle/project/404',
  '/api/preview/404',
  '/api/audio/project/404/master/source/content',
  '/api/audio/project/404/delivery/lead/content',
];

test('read routes answer the same way', async () => {
  const snapshots = await withTestServer(async (app) => {
    const result: ApiSnapshot[] = [];
    for (const url of readUrls) {
      result.push(await captureResponse(app, { method: 'GET', url }));
    }
    return result;
  });
  expect(snapshots).toMatchSnapshot();
});

test('missing resources answer the same way', async () => {
  const snapshots = await withTestServer(async (app) => {
    const result: ApiSnapshot[] = [];
    for (const url of missingUrls) {
      result.push(await captureResponse(app, { method: 'GET', url }));
    }
    return result;
  });
  expect(snapshots).toMatchSnapshot();
});

test('a matching etag answers not modified', async () => {
  const snapshot = await withTestServer(async (app) => {
    const url = `/api/subtitle/project/${fixtureProjectId}`;
    const first = await captureResponse(app, { method: 'GET', url });
    return await captureResponse(app, {
      method: 'GET',
      url,
      headers: { 'if-none-match': first.headers.etag },
    });
  });
  expect(snapshot).toMatchSnapshot();
});

test('the status stream opens as server-sent events', async () => {
  const snapshot = await withTestServer(async (app) =>
    captureStream(app, '/api/project/status/stream'),
  );
  expect(snapshot).toMatchSnapshot();
});

test('creating a project answers the same way', async () => {
  const snapshot = await withTestServer(async (app) => {
    const payload = new FormData();
    payload.set('name', 'Created project');
    payload.set('song', createFixtureAudioFile());
    return await captureResponse(app, {
      method: 'POST',
      url: '/api/project/create',
      payload,
    });
  });
  expect(snapshot).toMatchSnapshot();
});

test('editing a project answers the same way', async () => {
  const snapshot = await withTestServer(async (app) => {
    const payload = new FormData();
    payload.set('name', 'Renamed project');
    return await captureResponse(app, {
      method: 'PATCH',
      url: `/api/project/${fixtureProjectId}/edit`,
      payload,
    });
  });
  expect(snapshot).toMatchSnapshot();
});

test('removing a project answers the same way', async () => {
  const snapshots = await withTestServer(async (app) => [
    await captureResponse(app, {
      method: 'DELETE',
      url: `/api/project/${fixtureProjectId}/remove`,
    }),
    await captureResponse(app, {
      method: 'GET',
      url: `/api/project/${fixtureProjectId}`,
    }),
  ]);
  expect(snapshots).toMatchSnapshot();
});

test('retrying a failed step answers the same way', async () => {
  const snapshots = await withTestServer(async (app, workspace) => {
    const notFailed = await captureResponse(app, {
      method: 'POST',
      url: `/api/project/${fixtureProjectId}/retry`,
      body: { step: 'chords' },
    });
    await failFixtureStep(workspace, 'chords');
    const failed = await captureResponse(app, {
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
      async (app) =>
        await captureResponse(app, {
          method: 'GET',
          url: `/api/project/${fixtureProjectId}`,
        }),
    );
  expect(await read()).toEqual(await read());
});
