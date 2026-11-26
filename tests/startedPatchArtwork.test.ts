import assert from 'node:assert/strict';
import { test } from './testHarness';
import { buildStartedPatch } from '../src/application/zones/playback/patchBuilder';

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
