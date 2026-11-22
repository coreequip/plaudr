/**
 * Hält bis zum Schließen des Tabs eine Web-Lock-Sperre. false, wenn ein anderer Tab desselben Browsers
 * sie schon hält. Ohne Web Locks (sehr alte Browser) wird nicht gesperrt.
 */
export function acquireTabLock(locks: LockManager | undefined = navigator.locks): Promise<boolean> {
  if (!locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    void locks.request('plaudr.identity', { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      return lock ? new Promise<never>(() => {}) : undefined;
    });
  });
}
