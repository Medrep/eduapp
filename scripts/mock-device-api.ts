import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { boundedText, pairingCodePattern, record, uuid, type Catalog, type Lesson } from "../packages/contracts/src/device.ts";
import { referenceLesson } from "./reference-lesson.ts";

const family = { id: "9fdd4a77-ff54-4f1b-825b-6102451dcdba", label: "Dom" };
const subject = { id: "60c0572e-eeab-43b2-ba75-c5c0f7d9275d", slug: "przyroda", namePl: "Przyroda", sortOrder: 1 };
const publishedAt = "2026-11-19T18:00:00Z";
const lesson: Lesson = {
  id: referenceLesson.lessonId, subjectId: subject.id, title: "Skały i gleba",
  description: "Interaktywna lekcja z przyrody", grade: 4, publishedAt,
  version: { id: referenceLesson.versionId, number: 1, sha256: referenceLesson.sha256, sizeBytes: referenceLesson.sizeBytes },
};
const extra = {
  id: "8cfc925b-225f-41f5-82e8-e227208c154e",
  text: "<!doctype html><html lang=\"pl\"><meta charset=\"utf-8\"><title>Obieg wody</title><h1>Obieg wody</h1><p>Woda paruje, skrapla się i spada w postaci opadów.</p></html>",
} as const;
const extraBytes = Buffer.from(extra.text);
const extraLesson: Lesson = {
  id: extra.id, subjectId: subject.id, title: "Obieg wody", description: null, grade: 4, publishedAt,
  version: {
    id: "17aa9ad1-90bb-4b8b-84cd-b070678e6055", number: 1,
    sha256: createHash("sha256").update(extraBytes).digest("hex"), sizeBytes: extraBytes.byteLength,
  },
};

const mockContent = "/__device-mock/content/";
const noStore = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const errors: Partial<Record<number, string>> = {
  400: "INVALID_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN",
  404: "NOT_FOUND", 429: "RATE_LIMITED", 503: "UNAVAILABLE",
};

function send(response: ServerResponse, status: number, value?: unknown) {
  response.writeHead(status, { ...noStore, "Content-Type": "application/json; charset=utf-8" });
  const code = errors[status];
  response.end(JSON.stringify(value ?? { error: { code, message: "Nie można wykonać żądania.", requestId: randomUUID() } }));
}

async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") return;
  try {
    // Keep simulating normal contract errors without allowing an unbounded preview request.
    const decoder = new TextDecoder();
    let json = "";
    for await (const chunk of request) {
      json += decoder.decode(chunk as Buffer, { stream: true });
      if (json.length > 1024) return;
    }
    return JSON.parse(json + decoder.decode());
  } catch {
    return undefined;
  }
}

function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function createMockGateway(port: number) {
  const tokens = new Set<string>();
  const codes = new Set(["ABCDE-FG234", "ABCDE-FG235", "ABCDE-FG236", "ABCDE-FG237", "ABCDE-FG238", "ABCDE-FG239"]);
  const grants = new Map<string, { lesson: Lesson; expiresAt: number }>();
  const catalog: Catalog = {
    schemaVersion: 1, revision: 1, generatedAt: publishedAt, family, subjects: [subject], lessons: [lesson, extraLesson],
  };
  let attempts = 0;
  let windowStart = Date.now();
  const origin = `http://127.0.0.1:${port}`;

  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = request.url ?? "/";
    if (!path.startsWith("/device/v1/") && !path.startsWith("/__device-mock/")) { next(); return; }
    if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) {
      send(response, 403);
      return;
    }

    if (path === "/device/v1/pair" && request.method === "POST") {
      const now = Date.now();
      if (now - windowStart >= 60_000) { attempts = 0; windowStart = now; }
      if (++attempts > 24) { send(response, 429); return; }
      const payload = await body(request);
      if (!record(payload) || !boundedText(payload.deviceLabel, 80) || typeof payload.pairingCode !== "string" ||
          !pairingCodePattern.test(payload.pairingCode) || !codes.delete(payload.pairingCode)) {
        send(response, 400);
        return;
      }
      const deviceToken = randomBytes(32).toString("base64url");
      tokens.add(hash(deviceToken));
      send(response, 200, { deviceId: randomUUID(), familyId: family.id, familyLabel: family.label, deviceToken, serverTime: new Date().toISOString() });
      return;
    }

    // The signed URL authorizes only this immutable object, with no device credential sent.
    if (path.startsWith(mockContent) && request.method === "GET") {
      const signature = path.slice(mockContent.length);
      const grant = /^[0-9a-f]{64}$/.test(signature) ? grants.get(signature) : undefined;
      if (!grant || grant.expiresAt <= Date.now()) { send(response, 404); return; }
      try {
        const bytes = grant.lesson.id === extra.id ? extraBytes : await readFile(new URL("../fixtures/rocks-soil.html", import.meta.url));
        if (bytes.length !== grant.lesson.version.sizeBytes || hash(bytes) !== grant.lesson.version.sha256) {
          send(response, 503);
          return;
        }
        response.writeHead(200, {
          ...noStore, "Content-Type": "application/octet-stream", "Content-Disposition": "attachment",
          "Content-Length": bytes.length,
        });
        response.end(bytes);
      } catch {
        send(response, 503);
      }
      return;
    }

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ") || !tokens.has(hash(authorization.slice(7)))) {
      send(response, 401);
      return;
    }
    if (path === "/device/v1/catalog" && request.method === "GET") {
      send(response, 200, catalog);
      return;
    }
    if (path !== "/device/v1/download-url" || request.method !== "POST") { send(response, 404); return; }
    const payload = await body(request);
    if (!record(payload) || !uuid(payload.lessonId) || !uuid(payload.versionId)) { send(response, 400); return; }
    const desired = catalog.lessons.find(item => item.id === payload.lessonId && item.version.id === payload.versionId);
    if (!desired) { send(response, 404); return; }
    const signature = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 5 * 60 * 1000;
    for (const [key, grant] of grants) if (grant.expiresAt <= Date.now()) grants.delete(key);
    grants.set(signature, { lesson: desired, expiresAt });
    send(response, 200, {
      signedUrl: origin + mockContent + signature, expiresAt: new Date(expiresAt).toISOString(),
      sha256: desired.version.sha256, sizeBytes: desired.version.sizeBytes,
    });
  };
}

export function localMockGateway(port: number): Plugin {
  return {
    name: "moja-nauka-local-device-gateway",
    configureServer(server) { server.middlewares.use(createMockGateway(port)); },
    configurePreviewServer(server) { server.middlewares.use(createMockGateway(port)); },
  };
}
