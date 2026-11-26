import assert from 'node:assert/strict';
import { test } from './testHarness';
import { buildStartedPatch } from '../src/application/zones/playback/patchBuilder';
import { ExternalStateRouter } from '../src/application/zones/state/ExternalStateRouter';

// Artwork that arrives with the track being started must win over the queue row's stored
// artwork. A queue row can be old, restored from a previous session, or never enriched, and
// its empty coverurl used to be spread last over the metadata the session had already
// resolved, so a track started from the queue showed the previous cover until something else
// (a seek) refreshed it. Measured on a Sonos zone: title changed, artwork did not, artwork
// appeared after the first seek.

const audioHelpers = {
  getStateAudiotype: () => null,
  getStateFileType: () => 0,
  resolveAlertEventType: () => 0,
  isRadioAudiopath: () => false,
} as any;

function harness(queueItem: Record<string, unknown>) {
  const ctx = {
    id: 2,
    name: 'Wohnzimmer',
    state: {
      title: 'Previous',
      artist: 'Previous artist',
      album: 'Previous album',
      coverurl: '',
      audiopath: '',
      duration: 0,
      volume: 10,
    },
    metadata: {},
    queue: { authority: 'local', items: [queueItem] },
    queueController: { current: () => queueItem, currentIndex: () => 0 },
  } as any;
  const sessionFor = (metadata: Record<string, unknown>) =>
    ({ metadata, elapsed: 0 }) as any;
  return { ctx, sessionFor };
}

test('a started track takes the artwork the session resolved, not the queue row', () => {
  const { ctx, sessionFor } = harness({
    title: 'The Sweet Oranges of Jaffa',
    artist: 'Anouar Brahem',
    album: 'Astrakan Cafe',
    audiopath: 'spotify:track:60KpMOPJ1PAwqfuSXiFjKm',
    coverurl: '',
    duration: 433,
    unique_id: 'q1',
  });

  const patch = buildStartedPatch({
    ctx,
    session: sessionFor({
      title: 'The Sweet Oranges of Jaffa',
      artist: 'Anouar Brahem',
      album: 'Astrakan Cafe',
      audiopath: 'spotify:track:60KpMOPJ1PAwqfuSXiFjKm',
      coverurl: 'https://i.scdn.co/image/ab67616d0000b273d17b79633c5a8b3dac5d327c',
      duration: 433,
    }),
    audioHelpers,
  });

  assert.equal(
    patch.coverurl,
    'https://i.scdn.co/image/ab67616d0000b273d17b79633c5a8b3dac5d327c',
    'the session artwork reaches the zone',
  );
});

test('a stale queue cover is replaced by the artwork the session resolved', () => {
  const { ctx, sessionFor } = harness({
    title: 'New track',
    artist: 'New artist',
    audiopath: 'spotify:track:new',
    coverurl: 'https://example.test/previous-album.jpg',
    duration: 200,
    unique_id: 'q2',
  });

  const patch = buildStartedPatch({
    ctx,
    session: sessionFor({
      title: 'New track',
      artist: 'New artist',
      audiopath: 'spotify:track:new',
      coverurl: 'https://i.scdn.co/image/new-album',
      duration: 200,
    }),
    audioHelpers,
  });

  assert.equal(patch.coverurl, 'https://i.scdn.co/image/new-album', 'the stale cover is replaced');
});

test('when the session has no artwork the queue row is still used', () => {
  const { ctx, sessionFor } = harness({
    title: 'Library track',
    artist: 'Local artist',
    audiopath: 'file:track:1',
    coverurl: 'https://sonn.dts.home:7090/music/cover-1.jpg',
    duration: 180,
    unique_id: 'q3',
  });

  const patch = buildStartedPatch({
    ctx,
    session: sessionFor({
      title: 'Library track',
      artist: 'Local artist',
      audiopath: 'file:track:1',
      coverurl: '',
      duration: 180,
    }),
    audioHelpers,
  });

  assert.equal(
    patch.coverurl,
    'https://sonn.dts.home:7090/music/cover-1.jpg',
    'the queue row remains the fallback',
  );
});

test('an empty session cover does not blank artwork the queue row does not have either', () => {
  const { ctx, sessionFor } = harness({
    title: 'Bare track',
    audiopath: 'file:track:2',
    coverurl: '',
    duration: 120,
    unique_id: 'q4',
  });

  const patch = buildStartedPatch({
    ctx,
    session: sessionFor({ title: 'Bare track', audiopath: 'file:track:2', coverurl: '', duration: 120 }),
    audioHelpers,
  });

  assert.equal(patch.coverurl, '', 'nothing to show stays nothing');
});

// The other half of the same defect, one layer up. A controller that cannot say what it plays
// still reports the item the speaker was on before our stream reached it. Recorded on a live
// zone at 12:19 UTC while starting a track from the queue:
//
//   t+0.00s  pause  t=147 dur=197  'Power Trip'   cover=a8cg6j     (before the start)
//   t+6.17s  play   t=0   dur=173  'FLUGEL'       cover=3xpk1j     (our start, correct)
//   t+6.19s  pause  t=0   dur=173  'Power Trip'   cover=a8cg6j     (controller snapshot)
//   t+6.50s  play   t=0   dur=173  'FLUGEL'       cover=a8cg6j     (title corrected, cover not)
//
// The cover stayed on the previous item for the rest of the track. These pin that a controller
// which cannot name what it plays may no longer replace the identity of what is playing.

const quietLog = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  spam: () => undefined,
} as any;

function sessionRouter() {
  const applied: Array<Partial<Record<string, unknown>>> = [];
  const zone: any = { config: { state: { controller: 'sonos' } }, state: {} };
  const router = new ExternalStateRouter({
    zones: { get: (zoneId: number) => (zoneId === 2 ? zone : undefined) } as any,
    audioManager: {
      hasActiveLocalSession: () => true,
      getSession: () => null,
      stopPlayback: () => null,
    } as any,
    applyPatch: (_zoneId: number, patch: object) => applied.push(patch),
    notifyQueueUpdated: () => undefined,
    yieldToExternalSource: () => true,
    log: quietLog,
  } as any);
  return { router, applied };
}

test('a controller that cannot name the item does not put the previous artwork back', () => {
  const { router, applied } = sessionRouter();

  router.onStatePatch(2, {
    mode: 'play',
    audiopath: '',
    title: 'Power Trip',
    artist: 'Previous artist',
    album: 'Previous album',
    coverurl: 'https://i.scdn.co/image/previous',
    duration: 197,
    time: 147,
  });

  assert.equal(applied.length, 1, 'the transport part still reaches the zone');
  assert.equal(applied[0]!.mode, 'play');
  for (const field of ['title', 'artist', 'album', 'coverurl', 'audiopath', 'time', 'duration']) {
    assert.equal(applied[0]![field], undefined, `${field} is not taken from a nameless item`);
  }
});

test('a controller that does name the item is still believed', () => {
  const { router, applied } = sessionRouter();

  router.onStatePatch(2, {
    mode: 'play',
    audiopath: 'http://10.64.1.26:1400/stream',
    title: 'Something the controller knows',
    coverurl: 'https://example.test/cover.jpg',
    duration: 200,
    time: 30,
  });

  assert.equal(applied[0]!.title, 'Something the controller knows', 'its identity passes through');
  assert.equal(applied[0]!.coverurl, 'https://example.test/cover.jpg');
  assert.equal(applied[0]!.time, undefined, 'timing still belongs to our own session');
});