import type { Browser, Page } from '@playwright/test';
import { newContext } from './helpers';

/**
 * Ein Linkinhaber, der nicht die App benutzt: Er kennt das Raumgeheimnis, hängt mit einer rohen
 * WebSocket-Verbindung an room_ws, liest alles mit und kann eigene Umschläge einschleusen.
 * Die Krypto-Module lädt er aus dem Vite-Dev-Server, damit er genau so verschlüsselt wie die App.
 */
export interface Intruder {
  page: Page;
  cid: string;
  peerId: string;
  pub: string;
  /** Alle bisher mitgelesenen Nachrichten, so wie room_ws sie weiterreicht. */
  seen(): Promise<unknown[]>;
  /** Signiert mit der eigenen Identität, versiegelt mit dem Raumschlüssel und publiziert. */
  forge(payload: { kind: string; from: string; to: string; body: unknown }): Promise<void>;
}

export async function openIntruder(browser: Browser, hash: string): Promise<Intruder> {
  const page = await (await newContext(browser)).newPage();
  await page.goto('/');
  const info = await page.evaluate(async (secret) => {
    const imp = (p: string) => import(/* @vite-ignore */ p);
    const { deriveRoom } = await imp('/src/crypto/room-keys.ts');
    const { seal } = await imp('/src/crypto/envelope.ts');
    const { loadOrCreateIdentity } = await imp('/src/crypto/identity.ts');
    const { randomBase64url } = await imp('/src/util/base64url.ts');
    const { ROOMWS_URL, ROOMWS_CHANNEL } = await imp('/src/config.ts');
    const { roomId, roomKey } = await deriveRoom(secret);
    const me = await loadOrCreateIdentity({ load: async () => undefined, save: async () => {} });
    const ws = new WebSocket(ROOMWS_URL);
    const w = window as any;
    w.seen = [];
    const cid: string = await new Promise((resolve) => {
      ws.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.callback === 0) resolve(d.client_id);
        else if (d.type === 'publish') w.seen.push(d.message);
      };
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'handshake', channel: ROOMWS_CHANNEL, version: 2, callback: 0 }));
        ws.send(JSON.stringify({ type: 'subscribe', room: roomId, callback: 1 }));
      };
    });
    w.forge = async (x: { kind: string; from: string; to: string; body: unknown }) => {
      const p = JSON.stringify({ ...x, cid, ts: Date.now(), nonce: randomBase64url(16) });
      const message = await seal(roomKey, JSON.stringify({ p, sig: await me.sign(p) }));
      ws.send(JSON.stringify({ type: 'publish', room: roomId, message, no_echo: true }));
    };
    return { cid, peerId: me.peerId as string, pub: me.pub as string };
  }, hash.slice(1));
  return {
    page,
    ...info,
    seen: () => page.evaluate(() => (window as any).seen as unknown[]),
    forge: (payload) => page.evaluate((x) => (window as any).forge(x), payload),
  };
}
