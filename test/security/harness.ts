/**
 * Consumer-shaped harness for the black-box security suite.
 *
 * Every attack goes through the public entry points the way an application's
 * `action` calls them:
 *
 * - Zod: `parseSubmission(await readRequestBody(request, limits), { schema, limits })`
 * - Effect: `yield* parseSubmission(request, { schema, limits })`
 *
 * Both are reduced to one `Outcome`, so a test states the required behavior once
 * and runs it against each consumer.
 */
import { Effect, Schema } from "effect";
import z from "zod";
import type { $ZodType } from "zod/v4/core";

import * as effectEntry from "../../src/effect/index.ts";
import * as zodEntry from "../../src/zod/index.ts";

export type Limits = Partial<zodEntry.FormDataLimits>;

/** The same form schema, written once for each entry point. */
export type SchemaPair = { zod: $ZodType; effect: Schema.Top };

export type Outcome =
  /** The schema accepted the submission. */
  | { tag: "accepted"; value: unknown }
  /** The schema rejected the submission (a user-facing validation error). */
  | { tag: "invalid"; fieldErrors: Partial<Record<string, string>>; status?: number }
  /**
   * The parser rejected the submission before the schema ran. `reason` is the
   * `FormDataParseError` reason, or `"unreadable"` for a body that the platform
   * could not parse (for example, malformed JSON).
   */
  | { tag: "rejected"; reason: string; message: string };

/** Anything an `action` can hand to `parseSubmission`: a `Request`, `FormData`, or a parsed value. */
export type Payload = unknown;

export type Consumer = {
  name: "zod" | "effect";
  submit(payload: Payload, schema: SchemaPair, limits?: Limits): Promise<Outcome>;
};

function rejected(error: unknown): Outcome {
  if (error instanceof zodEntry.FormDataParseError) {
    return { tag: "rejected", reason: error.reason, message: error.message };
  }
  return { tag: "rejected", reason: "unreadable", message: String(error) };
}

/**
 * Adds `limits` only when a test passes it. Consumer code that omits the option
 * has no own `limits` property, which is the case a polluted
 * `Object.prototype.limits` targets (F-13).
 */
function withLimits<T extends object>(
  options: T,
  limits: Limits | undefined,
): T & { limits?: Limits } {
  return limits === undefined ? options : { ...options, limits };
}

export const zodConsumer: Consumer = {
  name: "zod",
  async submit(payload, schema, limits) {
    let body: unknown = payload;
    if (payload instanceof Request) {
      try {
        body = await zodEntry.readRequestBody(payload, limits);
      } catch (error) {
        return rejected(error);
      }
    }
    let submission;
    try {
      submission = zodEntry.parseSubmission(body, withLimits({ schema: schema.zod }, limits));
    } catch (error) {
      if (error instanceof zodEntry.FormDataParseError) return rejected(error);
      throw error;
    }
    return submission.status === "success"
      ? { tag: "accepted", value: submission.value }
      : { tag: "invalid", fieldErrors: submission.reply().fieldErrors };
  },
};

export const effectConsumer: Consumer = {
  name: "effect",
  submit(payload, schema, limits) {
    return Effect.runPromise(
      effectEntry
        .parseSubmission(
          payload as Request,
          withLimits({ schema: schema.effect as Schema.Codec<unknown, unknown> }, limits),
        )
        .pipe(
          Effect.map(({ value }): Outcome => ({ tag: "accepted", value })),
          Effect.catchTag("InvalidBodyError", (error) => Effect.succeed(rejected(error.cause))),
          Effect.catchTag("FormValidationError", (error) =>
            Effect.succeed<Outcome>({
              tag: "invalid",
              fieldErrors: error.reply.fieldErrors,
              status: error.init?.status,
            }),
          ),
        ),
    );
  },
};

export const consumers: readonly Consumer[] = [zodConsumer, effectConsumer];

/** Narrows an outcome to its rejection reason, or `undefined` when it was not rejected. */
export function reasonOf(outcome: Outcome): string | undefined {
  return outcome.tag === "rejected" ? outcome.reason : undefined;
}

/**
 * `process.env` of the Node.js test worker. The project has no Node.js type
 * definitions, because the library itself must not depend on Node.js.
 */
export const env = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;

/**
 * The time limit for a payload that must fail fast. A defect of that kind takes
 * seconds to hours. Examples are a backtracking regular expression, `BigInt` on
 * a huge string, and an array with billions of slots. The limit is far above
 * the normal cost, so a slow CI machine does not fail it.
 */
export const FAST_LIMIT_MS = 1000;

/**
 * Runs `run` on a fresh input `runs` times. Returns the last result and the
 * shortest time in milliseconds.
 *
 * `build` runs outside the clock, so the cost of the payload (a long string or
 * a `Request`) does not count. Machine noise only adds time, so the shortest
 * run is the best estimate of the real cost.
 */
export async function fastest<I, T>(
  build: () => I,
  run: (input: I) => Promise<T>,
  runs = 5,
): Promise<[result: T, ms: number]> {
  let result!: T;
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const input = build();
    const start = performance.now();
    result = await run(input);
    best = Math.min(best, performance.now() - start);
  }
  return [result, best];
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const schemas = {
  user: {
    zod: z.object({ name: z.string() }),
    effect: Schema.Struct({ name: Schema.String }),
  },
  withRole: {
    zod: z.object({ name: z.string(), role: z.string().optional() }),
    effect: Schema.Struct({ name: Schema.String, role: Schema.optional(Schema.String) }),
  },
  nestedRole: {
    zod: z.object({ user: z.object({ role: z.string() }) }),
    effect: Schema.Struct({ user: Schema.Struct({ role: Schema.String }) }),
  },
  items: {
    zod: z.object({ items: z.array(z.string().optional()) }),
    effect: Schema.Struct({ items: Schema.Array(Schema.optional(Schema.String)) }),
  },
  tags: {
    zod: z.object({ items: z.array(z.object({ tags: z.array(z.string()) })) }),
    effect: Schema.Struct({
      items: Schema.Array(Schema.Struct({ tags: Schema.Array(Schema.String) })),
    }),
  },
  qty: {
    zod: z.object({ qty: z.number() }),
    effect: Schema.Struct({ qty: Schema.Number }),
  },
  bigint: {
    zod: z.object({ n: z.bigint() }),
    effect: Schema.Struct({ n: Schema.BigInt }),
  },
  /** Accepts any value, so a test can see what the JSON parser produced. */
  any: {
    zod: z.unknown(),
    effect: Schema.Unknown,
  },
  /** Keeps every key, so a test can see the exact structure the parser built. */
  passthrough: {
    zod: z.record(z.string(), z.unknown()),
    effect: Schema.Record(Schema.String, Schema.Unknown),
  },
} satisfies Record<string, SchemaPair>;

// ─── Requests ─────────────────────────────────────────────────────────────────

const ORIGIN = "https://app.example";

/** A `POST` with an `application/x-www-form-urlencoded` body, sent exactly as given. */
export function urlencoded(body: string | URLSearchParams, url = `${ORIGIN}/`): Request {
  return new Request(url, {
    method: "POST",
    body: String(body),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

/** A `POST` with a `multipart/form-data` body. */
export function multipart(fd: FormData): Request {
  return new Request(`${ORIGIN}/`, { method: "POST", body: fd });
}

/** A `POST` with a JSON body, sent exactly as given. */
export function json(body: string | Uint8Array, contentType = "application/json"): Request {
  return new Request(`${ORIGIN}/`, {
    method: "POST",
    body: body as BodyInit,
    headers: { "content-type": contentType },
  });
}

/** A `GET` with the given query string. */
export function get(query: string): Request {
  return new Request(`${ORIGIN}/?${query}`);
}

/**
 * A `POST` whose body is a stream with no `Content-Length` (a chunked upload).
 * `pulled()` reports how many bytes the server read from it.
 */
export function chunked(
  totalBytes: number,
  chunkBytes: number,
  contentType = "application/x-www-form-urlencoded",
): { request: Request; pulled: () => number } {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size).fill(0x61)); // "a"
    },
  });
  const request = new Request(`${ORIGIN}/`, {
    method: "POST",
    body: stream,
    headers: { "content-type": contentType },
    duplex: "half",
  } as RequestInit);
  return { request, pulled: () => sent };
}

/** URLSearchParams with each key set to `"x"`. */
export function fields(...keys: string[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of keys) params.append(key, "x");
  return params;
}
