import { registerStaticShellWorker } from "../../../scripts/static-shell-worker.ts";

function childOfflineRecovery() {
  return new Response(
    '<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Moja Nauka — offline</title><h1>Nie można teraz otworzyć aplikacji.</h1>' +
    '<p>Połącz się z internetem i otwórz Moja Nauka ponownie.</p></html>',
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'; sandbox",
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

registerStaticShellWorker("mojanauka-shell-", childOfflineRecovery);
