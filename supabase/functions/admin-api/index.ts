import {
  createFamily, createLesson, createSubject, editLesson, editSubject, empty, lessonQuery,
  publish, unpublish, uuid,
} from "../_shared/contracts.ts";
import { codeHash, randomPairingCode } from "../_shared/credentials.ts";
import { ApiError, data, gateway, readBody, validated } from "../_shared/http.ts";
import { type Actor, type Row, checkOwner, requireOwner, rpc, select, signDownload } from "../_shared/supabase.ts";
import { beginUpload, finalizeUpload, versionDto } from "../_shared/upload.ts";

function subjectDto(row: Row) {
  return {
    id: row.id, slug: row.slug, namePl: row.name_pl, sortOrder: row.sort_order, archivedAt: row.archived_at,
  };
}

function lessonDto(row: Row) {
  return {
    id: row.id, subjectId: row.subject_id, title: row.title, description: row.description, grade: row.grade,
    visibility: row.visibility, status: row.status, activeVersionId: row.active_version_id,
    publishedAt: row.published_at, updatedAt: row.updated_at, createdAt: row.created_at, familyIds: row.family_ids,
  };
}

function familyDto(row: Row) {
  return { id: row.id, label: row.label, enabled: row.enabled, createdAt: row.created_at };
}

function deviceDto(row: Row) {
  return {
    id: row.id, familyId: row.family_id, label: row.label, createdAt: row.created_at,
    lastSeenAt: row.last_seen_at, revokedAt: row.revoked_at,
  };
}

function queryValues(params: URLSearchParams): Row {
  const entries = [...params];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new ApiError(400);
  return Object.fromEntries(entries);
}

async function issueCode(owner: Actor, familyId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = randomPairingCode();
    try {
      const expiresAt = await rpc<string>("mn_issue_pair", {
        ...owner, p_family: familyId, p_hash: await codeHash(code),
      });
      return data({ code, expiresAt });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409)) throw error;
    }
  }
  throw new ApiError(503);
}

async function listLessons(query: URLSearchParams) {
  const filters = validated(lessonQuery, queryValues(query));
  const params: Record<string, string> = {
    select: "id,subject_id,title,description,grade,visibility,status,active_version_id,published_at,created_at,updated_at,lesson_families(family_id)",
    deleted_at: "is.null",
    order: "updated_at.desc,id.asc",
  };
  if (filters.subjectId) params.subject_id = `eq.${filters.subjectId}`;
  if (filters.status) params.status = `eq.${filters.status}`;
  const rows = await select("lessons", params);
  const needle = filters.q?.toLocaleLowerCase("pl");
  return data({
    lessons: rows
      .filter((row) => !needle || String(row.title).toLocaleLowerCase("pl").includes(needle))
      .map((row) => lessonDto({
        ...row, family_ids: (row.lesson_families as Row[]).map((assignment) => assignment.family_id),
      })),
  });
}

async function listVersions(lessonId: string) {
  if (!(await select("lessons", { select: "id", id: `eq.${lessonId}`, deleted_at: "is.null" })).length) {
    throw new ApiError(404);
  }
  const rows = await select("lesson_versions", {
    select: "id,version_number,sha256,size_bytes,validation_report,created_at",
    lesson_id: `eq.${lessonId}`,
    order: "version_number.desc",
  });
  return data({ versions: rows.map(versionDto) });
}

async function ownerDownload(owner: Actor, lessonId: string, versionId: string) {
  const rows = await select("lesson_versions", {
    select: "size_bytes,sha256,lessons!lesson_versions_lesson_id_fkey!inner(deleted_at)", lesson_id: `eq.${lessonId}`,
    id: `eq.${versionId}`, "lessons.deleted_at": "is.null",
  });
  const row = rows[0];
  if (!row) throw new ApiError(404);
  const grant = await signDownload(`lessons/${lessonId}/versions/${versionId}.html`);
  await checkOwner(owner);
  return data({ ...grant, sha256: row.sha256, sizeBytes: row.size_bytes });
}

Deno.serve(gateway("admin", async (request, path, query, _peer, trace) => {
  const owner = await requireOwner(request);
  const method = request.method;
  const [resource, rawId, action, rawVersion, operation, extra] = path.split("/");
  if (extra !== undefined || (query.size && !(method === "GET" && path === "lessons"))) throw new ApiError(400);

  if (resource === "subjects") {
    if (method === "GET" && path === "subjects") {
      const rows = await select("subjects", { select: "id,slug,name_pl,sort_order,archived_at", order: "sort_order,name_pl" });
      return data({ subjects: rows.map(subjectDto) });
    }
    if (method === "POST" && path === "subjects") {
      const row = await rpc<Row>("mn_write_subject", { ...owner, p_id: null, p_values: await readBody(request, createSubject) });
      return data({ subject: subjectDto(row) }, 201);
    }
    if (method === "PATCH" && rawId && action === undefined) {
      const row = await rpc<Row>("mn_write_subject", {
        ...owner, p_id: validated(uuid, rawId), p_values: await readBody(request, editSubject),
      });
      return data({ subject: subjectDto(row) });
    }
  }

  if (resource === "lessons") {
    if (method === "GET" && path === "lessons") return await listLessons(query);
    if (method === "POST" && path === "lessons") {
      const row = await rpc<Row>("mn_write_lesson", { ...owner, p_id: null, p_values: await readBody(request, createLesson) });
      return data({ lesson: lessonDto(row) }, 201);
    }
    const lessonId = validated(uuid, rawId);
    if (method === "GET" && action === "versions" && rawVersion === undefined) return await listVersions(lessonId);
    if (method === "PATCH" && action === undefined) {
      const row = await rpc<Row>("mn_write_lesson", {
        ...owner, p_id: lessonId, p_values: await readBody(request, editLesson),
      });
      return data({ lesson: lessonDto(row) });
    }
    if (method === "POST") {
      if (action === "versions" && operation === "download-url") {
        await readBody(request, empty, true);
        return await ownerDownload(owner, lessonId, validated(uuid, rawVersion));
      }
      if (rawVersion !== undefined) throw new ApiError(404);
      if (action === "upload-init") return await beginUpload(request, owner, lessonId, trace);
      if (action === "upload-finalize") return await finalizeUpload(request, owner, lessonId, trace);
      if (action === "publish" || action === "unpublish") {
        const value = action === "publish" ? await readBody(request, publish) : await readBody(request, unpublish, true);
        const row = await rpc<Row>("mn_publication", {
          ...owner, p_id: lessonId, p_version: "versionId" in value ? value.versionId : null,
          p_expected: value.expectedUpdatedAt ?? null,
        });
        return data({ lesson: lessonDto(row) });
      }
    }
  }

  if (resource === "families") {
    if (method === "GET" && path === "families") {
      const rows = await select("families", { select: "id,label,enabled,created_at", order: "created_at,id" });
      return data({ families: rows.map(familyDto) });
    }
    if (method === "POST" && path === "families") {
      const { label } = await readBody(request, createFamily);
      return data({ family: familyDto(await rpc<Row>("mn_create_family", { ...owner, p_label: label })) }, 201);
    }
    if (method === "POST" && action === "pairing-codes" && rawVersion === undefined) {
      await readBody(request, empty, true);
      return await issueCode(owner, validated(uuid, rawId));
    }
  }

  if (resource === "devices") {
    if (method === "GET" && path === "devices") {
      const rows = await select("devices", { select: "id,family_id,label,created_at,last_seen_at,revoked_at", order: "created_at,id" });
      return data({ devices: rows.map(deviceDto) });
    }
    if (method === "POST" && action === "revoke" && rawVersion === undefined) {
      await readBody(request, empty, true);
      return data({ device: deviceDto(await rpc<Row>("mn_revoke_device", { ...owner, p_id: validated(uuid, rawId) })) });
    }
  }

  throw new ApiError(404);
}));
