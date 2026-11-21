import { expect, test } from 'vitest';
import RoomWS from 'roomws';

test('room_ws-Client lässt sich importieren', () => {
  expect(typeof RoomWS).toBe('function');
});
