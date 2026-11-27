import { maxLessonBytes, uploadFinalize, uploadInit } from "./contracts.ts";
import { validateLessonHtml } from "./content.ts";
import { digest } from "./credentials.ts";
import { ApiError, boundedBytes, data, readBody, type RequestTrace } from "./http.ts";
import { type Actor, type Row, bundles, checkOwner, getObject, insertBundle, rpc, signUpload, staging } from "./supabase.ts";

export function versionDto(row: Row) {
  return {
    id: row.id,
    versionNumber: row.version_number,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    validationReport: row.validation_report,
    createdAt: row.created_at,
  };
}

export async function beginUpload(request: Request, owner: Actor, lessonId: string, trace: RequestTrace) {
  const input = await readBody(request, uploadInit);
  trace.uploadSize(input.sizeBytes);
  if (input.sizeBytes > maxLessonBytes) throw new ApiError(413);
  const uploadId = crypto.randomUUID();
  const context = { ...owner, p_lesson: lessonId, p_id: uploadId };
  await rpc("mn_begin_upload", {
    ...context, p_hash: input.sha256, p_size: input.sizeBytes,
  });
  const { uploadUrl, grantExpiresAt } = await signUpload(`uploads/${uploadId}.html`);
  const deadline = await rpc<string>("mn_record_upload_grant", {
    ...context, p_grant_expires_at: grantExpiresAt,
  });
  const usableUntil = Date.parse(deadline);
  if (!Number.isFinite(usableUntil) || usableUntil > Date.parse(grantExpiresAt) || usableUntil <= Date.now()) {
    throw new ApiError(503);
  }
  await checkOwner(owner);
  return data({ uploadId, uploadUrl, expiresAt: new Date(usableUntil).toISOString() });
}

async function verifiedBytes(
  bucket: typeof staging | typeof bundles, path: string, expectedSize: number, expectedHash: string,
) {
  const response = await getObject(bucket, path);
  const bytes = await boundedBytes(response, expectedSize);
  if (bytes.byteLength !== expectedSize || await digest(bytes) !== expectedHash) {
    throw new ApiError(422, "Rozmiar lub suma kontrolna pliku jest inna niż zadeklarowana.");
  }
  return bytes;
}

export async function finalizeUpload(request: Request, owner: Actor, lessonId: string, trace: RequestTrace) {
  const { uploadId } = await readBody(request, uploadFinalize);
  const context = { ...owner, p_lesson: lessonId, p_id: uploadId };
  const pending = await rpc<Row>("mn_get_upload", context);
  if (pending.version) {
    const version = versionDto(pending.version as Row);
    trace.uploadSize(version.sizeBytes);
    return data({ version });
  }

  const source = `uploads/${uploadId}.html`;
  const target = `lessons/${lessonId}/versions/${uploadId}.html`;
  const size = pending.expected_size_bytes;
  const hash = pending.expected_sha256;
  trace.uploadSize(size);
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > maxLessonBytes ||
      typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash) || pending.temp_storage_path !== source) {
    throw new ApiError(503);
  }

  let bytes;
  let report;
  try {
    bytes = await verifiedBytes(staging, source, size, hash);
    report = validateLessonHtml(bytes);
  } catch (error) {
    if (error instanceof ApiError && [413, 422].includes(error.status)) {
      await rpc("mn_reject_upload", context);
    }
    if (error instanceof ApiError && error.status === 404) {
      // Another request may already have finalized and its expired stage has since been cleaned.
      const current = await rpc<Row>("mn_get_upload", context);
      if (current.version) return data({ version: versionDto(current.version as Row) });
      throw new ApiError(422, "Najpierw prześlij plik za pomocą przyznanego adresu.");
    }
    throw error;
  }

  const reserved = await rpc<Row | null>("mn_reserve_upload", { ...context, p_report: report });
  if (reserved?.version) return data({ version: versionDto(reserved.version as Row) });
  if (!await insertBundle(target, bytes)) {
    // A retry after uncertain completion may discover a concurrently written immutable object.
    // Register it only after independently confirming its exact digest and size.
    try {
      await verifiedBytes(bundles, target, size, hash);
    } catch {
      throw new ApiError(503);
    }
  }
  const version = await rpc<Row>("mn_finish_upload", context);
  await checkOwner(owner);
  return data({ version: versionDto(version) });
}
