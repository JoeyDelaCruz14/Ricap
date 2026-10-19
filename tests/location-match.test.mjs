// Run with: node --test tests/location-match.test.mjs
//
// Manual checks on Image_Processing.html (step 1), not covered by this file:
// - Permission denied: block location for the site, press "Suggest from my location".
//   Expect "Location permission was denied…", nothing selected, no river highlighted,
//   and the river/segment dropdowns still usable.
// - Accuracy 30 m on a real device: expect the accuracy message with a "Try again" button.
// - Photo with GPS data: the message names the photo as the source.
// Sa madaling salita: mga test para siguradong tama ang 20 metrong patakaran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLocation, SUGGEST_MAX_DISTANCE_M } from '../location-match.js';

const M_PER_DEG_LAT = 6371000 * Math.PI / 180;
const north = (lat, m) => lat + m / M_PER_DEG_LAT;

const BATAAN = { south: 14.33, west: 120.02, north: 14.97, east: 120.66 };
const inBataan = (lat, lng) =>
    lat >= BATAAN.south && lat <= BATAAN.north && lng >= BATAAN.west && lng <= BATAAN.east;

// A straight east-west river split into 4 segments, plus a second river 30 m north of it.
const LAT = 14.6;
const lineAt = lat => [0, 1, 2, 3].map(i => [[lat, 120.40 + i * 0.01], [lat, 120.41 + i * 0.01]]);
const oneRiver = { a: lineAt(LAT) };
const twoRivers = { a: lineAt(LAT), b: lineAt(north(LAT, 30)) };

const at = (m, accuracy = null) => ({ lat: north(LAT, m), lng: 120.405, accuracy });

test('threshold is 20 m', () => {
    assert.equal(SUGGEST_MAX_DISTANCE_M, 20);
});

test('exactly on the river line matches', () => {
    const r = matchLocation(oneRiver, at(0, 5), inBataan);
    assert.equal(r.kind, 'match');
    assert.deepEqual([r.hit.riverId, r.hit.index], ['a', 1]);
    assert.ok(r.hit.m < 0.5);
});

test('about 15 m away matches', () => {
    const r = matchLocation(oneRiver, at(15, 5), inBataan);
    assert.equal(r.kind, 'match');
    assert.ok(Math.abs(r.hit.m - 15) < 0.5);
});

test('about 25 m away does not match and reports the nearest river', () => {
    const r = matchLocation(oneRiver, at(25, 5), inBataan);
    assert.equal(r.kind, 'none');
    assert.equal(r.nearest.riverId, 'a');
    assert.ok(Math.abs(r.nearest.m - 25) < 0.5);
});

test('GPS accuracy of 30 m never auto-selects, even on the line', () => {
    const r = matchLocation(oneRiver, at(0, 30), inBataan);
    assert.equal(r.kind, 'inaccurate');
    assert.equal(r.accuracy, 30);
});

test('accuracy is not added to the distance', () => {
    // 15 m away with ±20 m accuracy is still a match; 25 m away with ±1 m is not.
    assert.equal(matchLocation(oneRiver, at(15, 20), inBataan).kind, 'match');
    assert.equal(matchLocation(oneRiver, at(25, 1), inBataan).kind, 'none');
});

test('two rivers within 20 m offers sorted choices instead of choosing', () => {
    const r = matchLocation(twoRivers, at(12, 5), inBataan);
    assert.equal(r.kind, 'choices');
    assert.deepEqual(r.hits.map(h => h.riverId), ['a', 'b']);
    assert.ok(r.hits[0].m <= r.hits[1].m);
    assert.ok(r.hits.length <= 3);
});

test('outside Bataan selects nothing', () => {
    const r = matchLocation(oneRiver, { lat: 15.5, lng: 120.405, accuracy: 5 }, inBataan);
    assert.equal(r.kind, 'outside');
});

test('photo EXIF (no accuracy) follows the same 20 m rule', () => {
    assert.equal(matchLocation(oneRiver, at(15), inBataan).kind, 'match');
    assert.equal(matchLocation(oneRiver, at(25), inBataan).kind, 'none');
});

test('no river geometry loaded means no match', () => {
    const r = matchLocation(null, at(0, 5), inBataan);
    assert.equal(r.kind, 'none');
    assert.equal(r.nearest, null);
});
