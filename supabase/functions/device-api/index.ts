import { downloadRequest, grantDescriptor, pairRequest } from "../_shared/contracts.ts";
import { codeHash, deviceHash, ingressPeer, peerHash, randomDeviceToken } from "../_shared/credentials.ts";
import { ApiError, bearer, data, gateway, readBody, validated } from "../_shared/http.ts";
import { type Row, rpc, signDownload } from "../_shared/supabase.ts";

Deno.serve(gateway("device", async (request, path, query, peer) => {
  if (query.size) throw new ApiError(400);
  if (request.method === "POST" && path === "pair") {
    const { pairingCode, deviceLabel } = await readBody(request, pairRequest);
    const token = randomDeviceToken();
    const [code, networkPeer, tokenHash] = await Promise.all([
      codeHash(pairingCode), peerHash(ingressPeer(request, peer)), deviceHash(token),
    ]);
    const paired = await rpc<Row>("mn_consume_pair", {
      p_hash: code, p_ip_hash: networkPeer, p_token_hash: tokenHash, p_label: deviceLabel ?? "Mój tablet",
    });
    if (paired.status === 429) throw new ApiError(429);
    if (paired.status === 400) throw new ApiError(400, "Nieprawidłowy lub wygasły kod. Poproś o nowy.");
    if (paired.status !== 200) throw new ApiError(503);
    return data({ deviceId: paired.deviceId, familyId: paired.familyId, familyLabel: paired.familyLabel,
      deviceToken: token, serverTime: paired.serverTime });
  }

  const token = await deviceHash(bearer(request));
  if (request.method === "GET" && path === "catalog") {
    const catalog = await rpc("mn_authorized_catalog", { p_hash: token });
    return data(catalog);
  }
  if (request.method === "POST" && path === "download-url") {
    const input = await readBody(request, downloadRequest);
    const scope = { p_hash: token, p_lesson: input.lessonId, p_version: input.versionId };
    const file = validated(grantDescriptor, await rpc("mn_device_download", scope), 503);
    const expected = `lessons/${input.lessonId}/versions/${input.versionId}.html`;
    if (file.path !== expected) throw new ApiError(503);
    const grant = await signDownload(expected);
    // Recheck after the asynchronous Storage signer so a revoked or superseded grant is not returned.
    await rpc("mn_device_download", scope);
    return data({ ...grant, sha256: file.sha256, sizeBytes: file.sizeBytes });
  }

  throw new ApiError(404);
}));
