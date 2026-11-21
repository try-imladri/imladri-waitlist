import { AsyncLocalStorage } from "node:async_hooks";

type BackgroundContext = { waitUntil(task: Promise<unknown>): void };
const storage = new AsyncLocalStorage<BackgroundContext>();

export function runWithWaitlistContext<T>(context: BackgroundContext, work: () => T): T {
  return storage.run(context, work);
}

// Return before looking up a deletion-request email address. This prevents
// provider latency (or account membership) from changing the public response.
export function deferRequestWork(work: () => Promise<void>): boolean {
  const context = storage.getStore();
  if (!context) return false;
  context.waitUntil(Promise.resolve().then(work).catch(() => {
    // Mail delivery failures remain visible in the durable owner-only outbox.
    // Do not put personal data or provider response bodies into runtime logs.
  }));
  return true;
}
