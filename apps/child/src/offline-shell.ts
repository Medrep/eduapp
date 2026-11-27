import { controllingProofWorker } from "../../../scripts/register-proof-worker.ts";

export async function probeOfflineShell(repair: boolean) {
  // Vite development precaches only the passive wrapper, not a runnable shell.
  if (import.meta.env.DEV) return false;
  const worker = controllingProofWorker();
  if (!worker) return false;
  const ready = await new Promise<boolean>(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => finish(false), 4000);
    const finish = (value: boolean) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(value);
    };
    channel.port1.onmessage = event => finish(event.data === true);
    try {
      worker.postMessage(repair ? "repair-child-shell" : "check-child-shell", [channel.port2]);
    } catch {
      finish(false);
    }
  });
  return ready && worker === controllingProofWorker();
}
