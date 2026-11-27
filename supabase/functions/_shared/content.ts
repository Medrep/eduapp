import { parse as parseScript } from "npm:acorn@8.15.0";
import { full } from "npm:acorn-walk@8.3.4";
import { Parser } from "npm:htmlparser2@10.0.0";
import { ApiError } from "./http.ts";

const blockedElements = new Set(["applet", "base", "embed", "fencedframe", "frame", "frameset", "iframe",
  "object", "portal", "foreignobject"]);
const resourceAttributes = new Set(["action", "background", "cite", "href", "formaction", "manifest",
  "poster", "src", "xlink:href", "ping", "longdesc"]);
const blockedScriptNames = new Set(["BroadcastChannel", "EventSource", "Function", "SharedWorker", "WebSocket",
  "WebTransport", "Worker", "XMLHttpRequest", "cookie", "cookieStore", "eval", "fetch", "indexedDB", "location",
  "localStorage", "opener", "sendBeacon", "serviceWorker", "sessionStorage"]);
const referenceProperties = new Set(["src", "href", "poster", "action", "formAction", "srcset"]);

function invalid(message: string): never {
  throw new ApiError(422, message);
}

function offlineReference(value: string): boolean {
  const clean = value.replace(/[\t\n\r\f]/g, "").trim();
  return clean === "" || clean.startsWith("#") ||
    /^data:image\/(?:jpeg|png|webp|svg\+xml)(?:;[^,]*)?,/i.test(clean);
}

function cssText(value: string): void {
  const text = value.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /\\([\da-fA-F]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\n\r\f])/g,
    (_whole, digits: string | undefined, character: string | undefined) => {
      if (!digits) return character ?? "";
      const point = Number.parseInt(digits, 16);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "\uFFFD";
    },
  );
  if (/@import\b|\bexpression\s*\(|(?:^|[;{])\s*behavior\s*:/i.test(text)) {
    invalid("Lekcja zawiera niedozwolony import lub polecenie CSS.");
  }
  for (const match of text.matchAll(/\burl\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    if (!offlineReference(match[1] ?? match[2] ?? match[3] ?? "")) {
      invalid("Zasoby CSS muszą znajdować się w lekcji.");
    }
  }
  for (const start of text.matchAll(/\b(?:-webkit-)?image-set\s*\(/gi)) {
    let depth = 1;
    for (let index = start.index + start[0].length; index < text.length && depth > 0; index += 1) {
      const character = text[index];
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (character === '"' || character === "'") {
        const end = text.indexOf(character, index + 1);
        if (end === -1) break;
        if (depth === 1 && !offlineReference(text.slice(index + 1, end))) {
          invalid("Zasoby CSS muszą znajdować się w lekcji.");
        }
        index = end;
      }
    }
  }
}

type ScriptNode = {
  type: string;
  name?: string;
  value?: unknown;
  object?: ScriptNode;
  property?: ScriptNode;
  left?: ScriptNode;
  right?: ScriptNode;
  callee?: ScriptNode;
  arguments?: ScriptNode[];
};

const propertyName = (node: ScriptNode | undefined): string | undefined =>
  node?.name ?? (typeof node?.value === "string" ? node.value : undefined);

function scriptText(source: string, inlineHandler = false) {
  let tree;
  try {
    tree = parseScript(source, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: inlineHandler });
  } catch {
    invalid("Skrypt lekcji musi być poprawnym skryptem osadzonym w dokumencie.");
  }
  full(tree, (raw) => {
    const node = raw as ScriptNode;
    if (node.type === "ImportExpression" || (node.type === "Identifier" && blockedScriptNames.has(node.name ?? ""))) {
      invalid("Skrypt lekcji używa niedozwolonego API przeglądarki.");
    }
    if (node.type === "MemberExpression") {
      const property = propertyName(node.property);
      if (blockedScriptNames.has(property ?? "") ||
          (["window", "self", "globalThis"].includes(node.object?.name ?? "") && ["open", "parent", "top"].includes(property ?? ""))) {
        invalid("Skrypt lekcji używa niedozwolonego API przeglądarki.");
      }
    }
    if (node.type === "AssignmentExpression" && node.left?.type === "MemberExpression" &&
        referenceProperties.has(propertyName(node.left.property) ?? "") && typeof node.right?.value === "string" &&
        !offlineReference(node.right.value)) {
      invalid("Skrypt lekcji wskazuje zasób spoza dokumentu.");
    }
    if (node.type === "CallExpression" && node.callee?.type === "MemberExpression") {
      const method = propertyName(node.callee.property);
      const arg = node.arguments?.[0]?.value;
      const target = node.arguments?.[1]?.value;
      if (method === "createElement" && typeof arg === "string" &&
          (blockedElements.has(arg.toLowerCase()) || ["form", "script"].includes(arg.toLowerCase()))) {
        invalid("Skrypt tworzy niedozwolony element dokumentu.");
      }
      if (method === "setAttribute" && typeof arg === "string" && referenceProperties.has(arg.toLowerCase()) &&
          typeof target === "string" && !offlineReference(target)) {
        invalid("Skrypt lekcji wskazuje zasób spoza dokumentu.");
      }
    }
  });
}

export type ValidationReport = { valid: true; checked: string[] };

export function validateLessonHtml(bytes: Uint8Array): ValidationReport {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const pieces: string[] = [];
  let inline: "script" | "style" | null = null;
  let doctype = false;
  let document = false;
  let documentClosed = false;
  let charset = false;
  let viewport = false;
  const parser = new Parser({
    onprocessinginstruction(name, value) {
      if (name.toLowerCase() !== "!doctype" || doctype || document || !/^!doctype\s+html\s*$/i.test(value)) {
        invalid("Lekcja wymaga pojedynczej deklaracji HTML5.");
      }
      doctype = true;
    },
    onopentag(tag, source) {
      const attributes = new Map(Object.entries(source));
      if (!doctype || documentClosed || (!document && tag !== "html")) {
        invalid("Dokument HTML lekcji musi zaczynać się od deklaracji HTML5 i elementu html.");
      }
      if (blockedElements.has(tag) || (tag === "form" && attributes.get("method") !== "dialog") ||
          (tag === "input" && attributes.get("type")?.toLowerCase() === "file")) {
        invalid("Lekcja zawiera niedozwolony element dokumentu.");
      }
      if (tag === "html") {
        if (document || attributes.get("lang")?.toLowerCase() !== "pl") invalid("Lekcja wymaga jednego dokumentu w języku polskim.");
        document = true;
      }
      if (tag === "meta") {
        if (attributes.has("http-equiv")) invalid("Metadane lekcji nie mogą zmieniać zasad ani przekierowywać strony.");
        if (attributes.has("charset")) {
          if (charset || attributes.get("charset")?.toLowerCase() !== "utf-8") invalid("Lekcja wymaga kodowania UTF-8.");
          charset = true;
        }
        if (attributes.get("name")?.toLowerCase() === "viewport") viewport = Boolean(attributes.get("content")?.trim());
      }
      if (tag === "script") {
        const type = attributes.get("type")?.toLowerCase() ?? "";
        if (attributes.has("src") || !["", "text/javascript", "application/javascript"].includes(type)) {
          invalid("Lekcja może zawierać tylko skrypty osadzone bez importów.");
        }
        inline = "script";
      }
      if (tag === "style") inline = "style";
      for (const [name, value] of attributes) {
        if ((resourceAttributes.has(name) && !offlineReference(value)) || name === "srcset" || name === "imagesrcset" ||
            ["action", "formaction", "ping", "download"].includes(name)) {
          invalid("Lekcja zawiera odwołanie spoza dokumentu lub nawigację.");
        }
        if (name === "style") cssText(value);
        if (name.startsWith("on")) scriptText(value, true);
      }
    },
    ontext(text) {
      if ((!document || documentClosed) && text.trim()) invalid("Treść musi znajdować się w dokumencie lekcji.");
      if (inline) pieces.push(text);
    },
    onclosetag(tag, implied) {
      if (tag === "html") documentClosed = true;
      if (tag !== inline) return;
      if (implied) invalid("Skrypty i style lekcji wymagają zamknięcia.");
      const source = pieces.join("");
      pieces.length = 0;
      if (inline === "style") cssText(source);
      else scriptText(source);
      inline = null;
    },
  });

  // The event parser does not build a DOM or retain ordinary text or comment payloads.
  try {
    for (let index = 0; index < bytes.length; index += 65536) {
      const chunk = decoder.decode(bytes.subarray(index, index + 65536), { stream: true });
      if (chunk.includes("\u0000")) invalid("Dokument HTML nie może zawierać znaków NUL.");
      parser.write(chunk);
    }
    parser.end(decoder.decode());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    invalid("Lekcja nie jest poprawnym dokumentem HTML w kodowaniu UTF-8.");
  }
  if (!doctype || !document || !charset || !viewport || inline) {
    invalid("Lekcja wymaga dokumentu HTML5, kodowania UTF-8, języka polskiego i ustawienia widoku.");
  }
  return { valid: true, checked: ["utf8", "html5", "resources", "inline-scripts", "navigation"] };
}
