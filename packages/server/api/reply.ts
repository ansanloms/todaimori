// 応答を型で縛る部品と、problem の組み立て。
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Principal } from "../auth/tokens.ts";
import type { ResponseError } from "./generated/types/index.ts";

/** 検証済みの入力。`contract` が入れる。 */
export type Input = {
  path: Record<string, unknown>;
  query: Record<string, unknown>;
  body: unknown;
};

/** hono の Env。`principal` は認証を通った route で、`input` は定義にある route で読める。 */
export type AppEnv = {
  Variables: { principal: Principal | undefined; input: Input };
};

/** Kubb の `XxxResponses` (`{ '200': T, '401': U }`) から、`{ status, body }` の union を作る。 */
export type Reply<R> = {
  [S in keyof R & string]: { status: S; body: R[S] };
}[keyof R & string];

/** 応答を返す。2xx は `application/json`、それ以外は `application/problem+json`。 */
export function send<R>(c: Context, reply: Reply<R>): Response {
  const status = Number(reply.status) as ContentfulStatusCode;
  return c.body(JSON.stringify(reply.body), status, {
    "Content-Type":
      status < 300 ? "application/json" : "application/problem+json",
  });
}

/**
 * 検証済みの入力を Kubb の `XxxOptions` 型で読む。
 * 型は検証から推論されない。handler が operation に合う型を選ぶ。
 */
export function input<T>(c: Context<AppEnv>): T {
  return c.get("input") as T;
}

/** 認証済みの route の handler で、呼び出し元を読む。無ければ例外を投げる。 */
export function requirePrincipal(c: Context<AppEnv>): Principal {
  const principal = c.get("principal");
  if (principal === undefined) {
    throw new Error("principal が無い: この route は認証を通っていない");
  }
  return principal;
}

/** RFC 9457 の problem を `application/problem+json` で返す。 */
export function problem(
  c: Context,
  status: ContentfulStatusCode,
  title: string,
  detail?: string,
  headers: Record<string, string> = {},
): Response {
  const body: ResponseError = {
    type: "about:blank",
    title,
    status,
    ...(detail === undefined ? {} : { detail }),
  };
  return c.json(body, status, {
    ...headers,
    "Content-Type": "application/problem+json",
  });
}

/**
 * hono の onError に渡す関数。hono 自身が投げる HTTPException も problem で返す。
 * それ以外の例外は 500 にし、例外を `console.error` に出す。
 */
export function handleError(err: Error, c: Context): Response {
  if (err instanceof HTTPException) {
    return problem(c, err.status as ContentfulStatusCode, err.message);
  }
  console.error(err);
  return problem(c, 500, "Internal Server Error");
}
