import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { isCatalog, isPairReply } from "../../packages/contracts/src/device.ts";
import { createMockGateway } from "../../scripts/mock-device-api.ts";
import { referenceLesson } from "../../scripts/reference-lesson.ts";

test("loopback mock one-use pairing, authorized catalog, version-scoped immutable binary download", async () => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const gateway = createMockGateway(address.port);
  server.on("request", (request, response) => {
    void gateway(request, response, () => response.writeHead(404).end());
  });
  const origin = `http://127.0.0.1:${address.port}`;
  const post = (path: string, data: object, token?: string) => fetch(origin + path, {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  });
  try {
    const reply = await Promise.all(Array.from({ length: 2 }, () =>
      post("/device/v1/pair", { pairingCode: "ABCDE-FG234", deviceLabel: "Tablet" })));
    assert.deepEqual(reply.map(response => response.status).sort(), [200, 400]);
    const paired: unknown = await reply.find(response => response.ok)?.json();
    assert(isPairReply(paired));
    const anonymous = await fetch(origin + "/device/v1/catalog");
    assert.equal(anonymous.status, 401);
    const unauthorized = await anonymous.json();
    assert.equal(unauthorized.error.code, "UNAUTHORIZED");
    assert.equal(typeof unauthorized.error.requestId, "string");
    const catalogResponse = await fetch(origin + "/device/v1/catalog", { headers: { Authorization: `Bearer ${paired.deviceToken}` } });
    const catalog: unknown = await catalogResponse.json();
    assert(isCatalog(catalog));
    assert.equal(catalog.family.id, paired.familyId);
    assert.equal(catalog.lessons.length, 2);
    assert.ok(!JSON.stringify(catalog).includes("signedUrl"));

    const request = { lessonId: referenceLesson.lessonId, versionId: referenceLesson.versionId };
    assert.equal((await post("/device/v1/download-url", { ...request, versionId: catalog.lessons[1]?.version.id }, paired.deviceToken)).status, 404);
    const signedReply = await post("/device/v1/download-url", request, paired.deviceToken);
    assert.equal(signedReply.status, 200);
    const signed = await signedReply.json();
    assert.ok(signed.signedUrl.startsWith(origin + "/__device-mock/content/"));
    assert.equal((await fetch(origin + "/fixtures/rocks-soil.html")).status, 404);
    assert.equal((await fetch(origin + "/__device-mock/content/" + "0".repeat(64))).status, 404);

    const object = await fetch(signed.signedUrl);
    assert.equal(object.status, 200);
    assert.equal(object.headers.get("content-type"), "application/octet-stream");
    assert.equal(object.headers.get("content-disposition"), "attachment");
    assert.equal(object.headers.get("cache-control"), "no-store");
    const bytes = Buffer.from(await object.arrayBuffer());
    assert.equal(bytes.byteLength, referenceLesson.sizeBytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), referenceLesson.sha256);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("Vite development server denies direct fixture file access", async () => {
  const { createServer: createViteServer } = await import("vite");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../../apps/child", import.meta.url));
  const fixture = fileURLToPath(new URL("../../fixtures/rocks-soil.html", import.meta.url));
  const dev = await createViteServer({ root, logLevel: "silent", server: { port: 0, host: "127.0.0.1" } });
  try {
    await dev.listen();
    const address = dev.httpServer?.address();
    assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    for (const path of ["/fixtures/rocks-soil.html", "/@fs" + fixture]) {
      const response = await fetch(origin + path);
      assert.ok([403, 404].includes(response.status));
      assert.notEqual(createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex"), referenceLesson.sha256);
    }
  } finally {
    await dev.close();
  }
});
