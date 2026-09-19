import { type FormDataLimits, resolveLimits } from "./limits.ts";
import { describeKey, FormDataParseError } from "./parse-error.ts";
import { isJsonContentType } from "./server-validation.ts";

/**
 * Reads the submission out of a `Request`, with a limit on the body size. Use
 * it in an `action` before `parseSubmission`:
 *
 * ```ts
 * const submission = parseSubmission(await readRequestBody(request), { schema });
 * ```
 *
 * - A `GET`/`HEAD` request has no body, so its URL's query string is returned
 *   as `URLSearchParams`.
 * - A JSON media type (`application/json`, `*+json`) is parsed and returned.
 *   A body that is not valid UTF-8 is rejected. A JSON object with a
 *   duplicate key is rejected, because `JSON.parse` keeps
 *   only the last value and gives no signal (RFC 7493 §2.3).
 * - Any other body is returned as `FormData`.
 *
 * The body is read as a stream and counted, so a chunked body with no
 * `Content-Length` also stops at `limits.maxBodyBytes`.
 *
 * Throws `FormDataParseError` with `reason: "body-size"` for a body larger
 * than `limits.maxBodyBytes`, `"duplicate-key"` for a repeated JSON key, or
 * `"malformed-string"` for a JSON body that is not valid UTF-8.
 * Throws the platform error (`SyntaxError`, `TypeError`) for a body that is not
 * valid JSON or form data. Throws a `TypeError` if a limit is not a
 * non-negative integer.
 */
export async function readRequestBody(
  request: Request,
  limits?: Partial<FormDataLimits>,
): Promise<unknown> {
  const { maxBodyBytes } = resolveLimits(limits);

  if (request.method === "GET" || request.method === "HEAD") {
    return new URL(request.url).searchParams;
  }

  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBodyBytes) throw bodySizeError(maxBodyBytes);

  const bytes = await readBytes(request, maxBodyBytes);
  if (isJsonContentType(request)) {
    return parseJsonWithoutDuplicateKeys(decodeUtf8(bytes));
  }
  const contentType = request.headers.get("content-type");
  const body = new Response(bytes, contentType ? { headers: { "content-type": contentType } } : {});
  return body.formData();
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Decodes a JSON body. Invalid UTF-8 is rejected, not replaced with U+FFFD (RFC 8259 §8.1). */
function decodeUtf8(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new FormDataParseError("malformed-string", "payload is not valid UTF-8");
  }
}

function bodySizeError(maxBodyBytes: number): FormDataParseError {
  return new FormDataParseError("body-size", `request body is larger than ${maxBodyBytes} bytes`);
}

/** Reads the whole body, and stops as soon as it passes `maxBodyBytes`. */
async function readBytes(request: Request, maxBodyBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!request.body) {
    const buffer = new Uint8Array(await request.arrayBuffer());
    if (buffer.byteLength > maxBodyBytes) throw bodySizeError(maxBodyBytes);
    return buffer;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBodyBytes) {
      await reader.cancel().catch(() => {});
      throw bodySizeError(maxBodyBytes);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseJsonWithoutDuplicateKeys(text: string): unknown {
  const value: unknown = JSON.parse(text);
  const duplicate = findDuplicateKey(text);
  if (duplicate !== undefined) {
    throw new FormDataParseError(
      "duplicate-key",
      `payload repeats the key ${describeKey(duplicate)}`,
    );
  }
  return value;
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const OPEN_OBJECT = 0x7b;
const CLOSE_OBJECT = 0x7d;
const OPEN_ARRAY = 0x5b;
const CLOSE_ARRAY = 0x5d;

/**
 * Returns the first key that an object in `text` repeats, compared after JSON
 * escapes are decoded (`"role"` and `"r\u006fle"` are the same key). `text`
 * must be valid JSON, so every string ends. One pass, no recursion.
 */
function findDuplicateKey(text: string): string | undefined {
  // One entry per open container: the keys seen so far for an object, or null for an array.
  const open: Array<Set<string> | null> = [];
  let expectKey = false;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === QUOTE) {
      const start = i;
      let escaped = false;
      for (i++; text.charCodeAt(i) !== QUOTE; i++) {
        if (text.charCodeAt(i) === BACKSLASH) {
          escaped = true;
          i++;
        }
      }
      if (!expectKey) continue;
      const raw = text.slice(start, i + 1);
      const key: string = escaped ? JSON.parse(raw) : raw.slice(1, -1);
      const keys = open[open.length - 1]!;
      if (keys.has(key)) return key;
      keys.add(key);
      expectKey = false;
    } else if (code === OPEN_OBJECT) {
      open.push(new Set());
      expectKey = true;
    } else if (code === OPEN_ARRAY) {
      open.push(null);
      expectKey = false;
    } else if (code === CLOSE_OBJECT || code === CLOSE_ARRAY) {
      open.pop();
      expectKey = false;
    } else if (code === COMMA) {
      expectKey = open[open.length - 1] instanceof Set;
    }
  }
  return undefined;
}
