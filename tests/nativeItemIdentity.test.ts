import assert from 'node:assert/strict';
import { test } from './testHarness';
import { toLoxoneZoneState } from '../src/adapters/loxone/ws/zoneStateProjection';
import { deriveQueueId } from '../src/shared/utils/queueId';
import type { ZoneState } from '../src/domain/zones/zoneState';

// A native item needs an id that changes with it.
//
// Recorded from a live zone on 2026-11-26 (validation-50048282), native Spotify, three tracks and
// four seeks. Across all 225 `audio_event` entries for that zone:
//
//   qid        "9e20f1b1d3b0"   225 of 225   a leftover generateQueueId()
//   qindex     0                225 of 225
//   audiopath  ""               225 of 225
//
// The client keys its per-item progress state on that id, so it never learned that the item had
// changed and kept clamping every position to the first track's length - 258 seconds - until the
// position fell below it again. Seeking past 258 broke the bar; seeking below it looked fine.


function zoneState(overrides: Partial<ZoneState> = {}): ZoneState {
  return {
    id: 2,
    name: 'Audioserver Wohnzimmer',
    album: 'Rumours (Super Deluxe)',
    artist: 'Fleetwood Mac',
    audiopath: '',
    audiotype: 5 as never,
    clientState: 'on',
    coverurl: '',
    duration: 258,
    eq: [] as never,
    mode: 'play',
    plrepeat: 0,
    plshuffle: 0,
    power: 'on',
    qindex: 0,
    qid: '9e20f1b1d3b0',
    sourceName: 'Spotify',
    station: '',
    time: 10,
    title: 'Dreams - 2004 Remaster',
    type: 0 as never,
    volume: 30,
    muted: false,
    ...overrides,
  };
}

function project(state: ZoneState, nativeItemKey: string | null): string | undefined {
  return toLoxoneZoneState(state, {
    group: null,
    leaderVolume: state.volume,
    audiopathToLoxone: (p: string) => p,
    nativeItemKey,
  } as never).qid;
}

const DREAMS = 'Dreams - 2004 Remaster|Rumours (Super Deluxe)';
const STAIRWAY = 'Stairway to Heaven - Remaster|Led Zeppelin IV (Remaster)';

test('a native item is given an id derived from it, not the queue id it never had', () => {
  const qid = project(zoneState(), DREAMS);
  assert.equal(qid, deriveQueueId(DREAMS));
  assert.notEqual(qid, '9e20f1b1d3b0', 'the stale queue id must not be reused for native playback');
  assert.match(String(qid), /^[0-9a-f]{12}$/, 'the id keeps the shape a client already parses');
});

test('a native id survives ordinary playback, seeking, pause and metadata noise', () => {
  // Every one of these is the same item: position moving, a seek forwards, a seek backwards
  // across the previous track's length, a pause, a resume, a volume change, new artwork.
  const sameItem: Array<Partial<ZoneState>> = [
    { time: 10 },
    { time: 11 },
    { time: 198, duration: 258 },
    { time: 236, duration: 258 },
    { time: 137, duration: 483 }, // backwards from 321, past the old track's length
    { time: 321, duration: 483 },
    { mode: 'pause', time: 321 },
    { mode: 'play', time: 321 },
    { volume: 10 },
    { volume: 45 },
    { coverurl: 'http://cover/other.jpg' },
    { station: '' },
  ];
  const ids = sameItem.map((patch) => project(zoneState(patch), DREAMS));
  assert.equal(new Set(ids).size, 1, `one item, one id: saw ${JSON.stringify(ids)}`);
});

test('a native id changes when the speaker reports a different item', () => {
  const first = project(zoneState({ time: 256, duration: 258 }), DREAMS);
  const second = project(zoneState({ title: 'Stairway to Heaven - Remaster', album: 'Led Zeppelin IV (Remaster)', duration: 483, time: 0 }), STAIRWAY);
  assert.notEqual(first, second);
});

test('a shorter item followed by a longer one gets two ids', () => {
  // The recorded pair: 258 s into 483 s, the transition the bar failed to follow.
  const short = project(zoneState({ duration: 258 }), DREAMS);
  const long = project(zoneState({ title: 'Stairway to Heaven - Remaster', duration: 483, time: 0 }), STAIRWAY);
  assert.ok(short && long && short !== long);
});

test('a longer item followed by a shorter one gets two ids', () => {
  const long = project(zoneState({ title: 'Stairway to Heaven - Remaster', duration: 483 }), STAIRWAY);
  const short = project(zoneState({ duration: 258 }), DREAMS);
  assert.ok(long && short && long !== short);
});

test('a song changing inside one radio stream keeps the id', () => {
  // A station keeps its name and reports the song it is playing as the artist, so the item has
  // not changed even though the artist has. The key never included the artist for this reason.
  const key = 'Radio Paradise|';
  const first = project(zoneState({ title: 'Radio Paradise', album: '', artist: 'Dave Matthews Band - All Along the Watchtower' }), key);
  const second = project(zoneState({ title: 'Radio Paradise', album: '', artist: 'Nirvana - Come As You Are' }), key);
  assert.equal(first, second);
});

test('a native zone is not given an id when this server is the one playing', () => {
  // Local playback: the queue item's own id is the identity and must reach the client untouched.
  const state = zoneState({ audiopath: 'spotify:track:03LaINWqrMBFDK3T2w3YQJ', qid: 'a1b2c3d4e5f6', qindex: 3 });
  assert.equal(project(state, null), 'a1b2c3d4e5f6');
});

test('the local id is preserved when a zone stops playing natively', () => {
  // Native-to-local: the derived id disappears and the queue id comes back.
  assert.equal(project(zoneState(), null), '9e20f1b1d3b0');
  assert.notEqual(project(zoneState(), DREAMS), '9e20f1b1d3b0');
});

test('an empty native key falls back to the zone id rather than inventing one', () => {
  const state = zoneState({ qid: 'abc123abc123' });
  assert.equal(project(state, ''), 'abc123abc123');
  assert.equal(project(state, '   '), 'abc123abc123');
});

test('a zone with no id at all stays without one', () => {
  const state = zoneState({ qid: undefined });
  assert.equal(project(state, null), undefined);
});

test('the same track twice in a row keeps one id, and that is deliberate', () => {
  // Same track, played again: the identity is unchanged, so the id is. The client's per-item
  // state stays valid because the length it holds for that item is still that track's length.
  assert.equal(project(zoneState({ time: 200 }), DREAMS), project(zoneState({ time: 0 }), DREAMS));
});
