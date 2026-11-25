// 定義を実行時に読み、認証・入力の検証・応答の検証を route の外から掛ける。
import type { Context, MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import { operationKey, toMediaType } from "./definition.ts";
import type { Definition, Operation, ParameterSpec } from "./definition.ts";
import { problem } from "./reply.ts";
import type { AppEnv, Input } from "./reply.ts";

/**
 * operation の有効な `security` を検査するコールバック。
 * 通すなら `undefined` を、止めるなら応答を返す。
 */
export type Authorize = (
  c: Context<AppEnv>,
  security: readonly unknown[],
) => Response | undefined | Promise<Response | undefined>;

export type ContractOptions = { authorize: Authorize };

const DECIMAL = /^-?\d+(\.\d+)?$/;

function isJson(mediaType: string): boolean {
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

/** path と query の文字列を、schema の `type` に合わせて変換する。変換できない値はそのまま返す。 */
function coerce(type: string | undefined, raw: string): unknown {
  switch (type) {
    case "boolean":
      return raw === "true" ? true : raw === "false" ? false : raw;
    case "integer":
      // 安全な整数に収まらない値は、丸められて検証を通らないよう変換しない。
      return DECIMAL.test(raw) && Number.isSafeInteger(Number(raw))
        ? Number(raw)
        : raw;
    case "number":
      // 10 進の表記だけを受ける。16 進・指数・空白は変換せず、型の不一致として落とす。
      return DECIMAL.test(raw) && Number.isFinite(Number(raw))
        ? Number(raw)
        : raw;
    default:
      return raw;
  }
}

/**
 * route の path (`/threads/:threadId/turns`) と実際の path から、path の引数を取り出す。
 * 全体に掛ける middleware の中では `c.req.param()` が空になるため、自前で分解する。
 */
function extractPathParams(
  routePattern: string,
  actualPath: string,
): Record<string, string> {
  const pattern = routePattern.split("/");
  const actual = actualPath.split("/");
  const params: Record<string, string> = {};
  for (const [index, segment] of pattern.entries()) {
    if (segment.startsWith(":")) {
      const raw = actual[index] ?? "";
      try {
        params[segment.slice(1)] = decodeURIComponent(raw);
      } catch {
        params[segment.slice(1)] = raw;
      }
    }
  }
  return params;
}

function checkParameter(
  spec: ParameterSpec,
  raw: string | undefined,
  errors: string[],
  out: Record<string, unknown>,
): void {
  if (raw === undefined) {
    if (spec.required) {
      errors.push(`${spec.in} ${spec.name}: 必須の値が無い`);
    }
    return;
  }
  const value = coerce(spec.type, raw);
  const problems = spec.check(value);
  if (problems.length > 0) {
    errors.push(...problems.map((p) => `${spec.in} ${spec.name}: ${p}`));
    return;
  }
  out[spec.name] = value;
}

/** path・query・body を検証する。不正な箇所があれば、説明を `errors` に足す。 */
async function readInput(
  c: Context<AppEnv>,
  op: Operation,
  errors: string[],
): Promise<Input> {
  const pathParams = extractPathParams(op.path, c.req.path);
  const input: Input = { path: {}, query: {}, body: undefined };
  for (const spec of op.parameters) {
    if (spec.in === "path") {
      checkParameter(spec, pathParams[spec.name], errors, input.path);
    } else {
      checkParameter(spec, c.req.query(spec.name), errors, input.query);
    }
  }

  if (op.body !== undefined) {
    // handler が body を再び読めるように、clone して読む。
    const text = await c.req.raw.clone().text();
    if (text === "") {
      if (op.body.required) {
        errors.push("body: 必須の値が無い");
      }
    } else if (
      toMediaType(c.req.header("Content-Type")) !== op.body.mediaType
    ) {
      errors.push(
        `body: Content-Type が定義に無い media type (${op.body.mediaType} のみ)`,
      );
    } else {
      let parsed: unknown;
      let valid = true;
      try {
        parsed = JSON.parse(text);
      } catch {
        valid = false;
        errors.push("body: JSON として不正");
      }
      if (valid) {
        const problems = op.body.check(parsed);
        if (problems.length > 0) {
          errors.push(...problems.map((p) => `body ${p}`));
        } else {
          input.body = parsed;
        }
      }
    }
  }
  return input;
}

/**
 * 応答が定義と合わなければ、ずれの説明を返す。合えば `undefined`。
 * `HEAD` の応答は body が無いので、body は検証しない。
 */
async function checkResponse(
  op: Operation,
  res: Response,
  method: string,
): Promise<string | undefined> {
  const spec =
    op.responses.get(String(res.status)) ??
    op.responses.get(`${Math.floor(res.status / 100)}XX`) ??
    op.responses.get("default");
  if (spec === undefined) {
    return `定義に無い status: ${res.status}`;
  }
  // content が無い応答は、body を検証しない。
  if (spec.size === 0) {
    return undefined;
  }
  const mediaType = toMediaType(res.headers.get("content-type"));
  if (!spec.has(mediaType)) {
    return `status ${res.status} の media type が定義に無い: ${mediaType === "" ? "(なし)" : mediaType}`;
  }
  const check = spec.get(mediaType);
  if (check === undefined || !isJson(mediaType) || method === "HEAD") {
    return undefined;
  }
  let body: unknown;
  try {
    body = await res.clone().json();
  } catch {
    return `status ${res.status} の body が JSON として不正`;
  }
  const problems = check(body);
  return problems.length === 0
    ? undefined
    : `status ${res.status} の body が定義と合わない: ${problems.join("; ")}`;
}

/**
 * 全体に掛ける middleware (`app.use("*", ...)`)。
 * 順序は、operation を引く → 認証 → 入力の検証 → handler → 応答の検証。
 * 定義に無い route (404 になるもの等) は素通しにする。
 * 入力が不正なら 400 の problem を返す。middleware 自身の応答も含め、応答が定義と合わなければ 500 の problem に差し替える。
 * `HEAD` は、定義に `HEAD` の operation が無ければ `GET` の operation として扱う。
 */
export function contract(
  definition: Definition,
  options: ContractOptions,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // 全体の middleware の中では `c.req.routePath` が `/*` になるため、handler の route を引く。
    // hono は `HEAD` を `GET` の route に配送するので、`HEAD` の operation が無ければ `GET` を引く。
    const path = routePath(c, -1);
    const method = c.req.method;
    let key = operationKey(method, path);
    let op = definition.operations.get(key);
    if (op === undefined && method === "HEAD") {
      key = operationKey("GET", path);
      op = definition.operations.get(key);
    }
    if (op === undefined) {
      await next();
      return;
    }

    // middleware 自身の応答にも、handler の応答と同じ検証を掛ける。
    // 差し替えた 500 は検証し直さない。
    const verify = async (res: Response): Promise<Response> => {
      const mismatch = await checkResponse(op, res, method);
      if (mismatch === undefined) {
        return res;
      }
      const label =
        key === operationKey(method, path)
          ? key
          : `${method} ${path} (${op.method} の定義)`;
      console.error(`${label}: 応答が定義と合わない: ${mismatch}`);
      return problem(c, 500, "Internal Server Error");
    };

    if (op.security.length > 0) {
      const denied = await options.authorize(c, op.security);
      if (denied !== undefined) {
        return await verify(denied);
      }
    }

    const errors: string[] = [];
    const input = await readInput(c, op, errors);
    if (errors.length > 0) {
      return await verify(problem(c, 400, "Bad Request", errors.join("; ")));
    }
    c.set("input", input);

    await next();

    const checked = await verify(c.res);
    if (checked !== c.res) {
      c.res = checked;
    }
  };
}

/**
 * `app.routes` と定義を突き合わせる。
 * `missing` は定義にあって実装に無い operation、`extra` は実装にあって定義に無い route。
 */
export function checkImplemented(
  app: { routes: readonly { method: string; path: string }[] },
  definition: Definition,
): { missing: string[]; extra: string[] } {
  const registered = new Set(
    app.routes
      .filter((r) => r.method !== "ALL")
      .map((r) => operationKey(r.method, r.path)),
  );
  const defined = new Set(definition.operations.keys());
  return {
    missing: [...defined].filter((k) => !registered.has(k)),
    extra: [...registered].filter((k) => !defined.has(k)),
  };
}
