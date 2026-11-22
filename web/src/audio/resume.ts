/**
 * Ohne Nutzergeste kann AudioContext.resume() ewig offen bleiben (Auto-Beitritt beim Laden).
 * true, sobald der Kontext läuft; false, wenn er es nach ms noch nicht tut.
 */
export async function resumeWithin(ctx: { resume(): Promise<void>; state: string }, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((r) => {
    timer = setTimeout(r, ms);
  });
  try {
    await Promise.race([ctx.resume().catch(() => {}), timeout]);
  } finally {
    clearTimeout(timer);
  }
  return ctx.state === 'running';
}
