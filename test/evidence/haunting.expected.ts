/**
 * The expected maps of the two samples, copied from haunting-map design.md §9.1 and §9.2.
 * They were computed by hand from the scripts' fixed dates. Tests compare a fresh real-git
 * build against them; if git disagrees, the difference is reported, never edited away (R7.2).
 */
import type { HauntingMap } from '../../src/ghost/schema.js';

export const CRYPT_MAP: HauntingMap = {
  repoNow: '2024-10-21T10:00:00.000Z',
  departedAfterDays: 365,
  commitsRead: 8,
  historyCut: false,
  truncated: false,
  filesConsidered: 5,
  ghosts: [
    {
      id: 'G1',
      name: 'Priya Ramanathan',
      glyph: 'PR',
      suspicious: false,
      lastSeen: '2022-05-02T11:30:00.000Z',
      files: 2,
    },
    {
      id: 'G2',
      name: 'Dmitri Volkov',
      glyph: 'DV',
      suspicious: false,
      lastSeen: '2020-02-11T09:05:00.000Z',
      files: 2,
    },
  ],
  files: [
    {
      path: 'legacy/schedule.js',
      hauntedBy: 'Priya Ramanathan',
      ghostId: 'G1',
      departedTouches: 1,
      totalTouches: 1,
      lastSha7: '40bc4ef',
      lastSeen: '2021-09-30T16:20:00.000Z',
    },
    {
      path: 'legacy/vendor.js',
      hauntedBy: 'Priya Ramanathan',
      ghostId: 'G1',
      departedTouches: 2,
      totalTouches: 2,
      lastSha7: 'dcb8969',
      lastSeen: '2022-05-02T11:30:00.000Z',
    },
    {
      path: 'legacy/invoice.js',
      hauntedBy: 'Dmitri Volkov',
      ghostId: 'G2',
      departedTouches: 2,
      totalTouches: 2,
      lastSha7: '604eac6',
      lastSeen: '2019-06-18T14:40:00.000Z',
    },
    {
      path: 'legacy/tax.js',
      hauntedBy: 'Dmitri Volkov',
      ghostId: 'G2',
      departedTouches: 1,
      totalTouches: 3,
      lastSha7: 'e9a5c9c',
      lastSeen: '2020-02-11T09:05:00.000Z',
    },
    {
      path: 'tests/invoice.test.js',
      hauntedBy: null,
      ghostId: null,
      departedTouches: 0,
      totalTouches: 1,
      lastSha7: '21d4a12',
      lastSeen: '2024-10-21T10:00:00.000Z',
    },
  ],
};

export const POSSESSED_MAP: HauntingMap = {
  repoNow: '2024-02-29T08:20:00.000Z',
  departedAfterDays: 365,
  commitsRead: 7,
  historyCut: false,
  truncated: false,
  filesConsidered: 1,
  ghosts: [
    {
      id: 'G1',
      name: 'Osric Penhallow',
      glyph: 'OP',
      suspicious: false,
      lastSeen: '2022-10-31T23:10:00.000Z',
      files: 1,
    },
  ],
  files: [
    {
      path: 'auth/throttle.js',
      hauntedBy: 'Osric Penhallow',
      ghostId: 'G1',
      departedTouches: 4,
      totalTouches: 7,
      lastSha7: 'b477439',
      lastSeen: '2022-10-31T23:10:00.000Z',
    },
  ],
};
