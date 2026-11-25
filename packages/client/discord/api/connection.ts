import type {
  EnumRole,
  GetConnectionErrors,
  GetConnectionResponses,
  ResponseError,
} from "./generated/index.ts";

export type Connection = GetConnectionResponses[200];

/** API が失敗を返したとき、または応答の body が定義と違ったときの例外。 */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: ResponseError | undefined;

  constructor(
    status: number,
    problem: ResponseError | undefined,
    message?: string,
  ) {
    super(message ?? `${status} ${problem?.title ?? "Unknown"}`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
}

function isProblem(value: unknown): value is GetConnectionErrors[400] {
  return (
    typeof value === "object" &&
    value !== null &&
    "title" in value &&
    typeof value.title === "string"
  );
}

/** `EnumRole` に値が増えると型検査が落ちて、ここの漏れに気づける。 */
const ROLES: Record<EnumRole, true> = { user: true };

function isConnection(value: unknown): value is Connection {
  return (
    typeof value === "object" &&
    value !== null &&
    "apiVersion" in value &&
    typeof value.apiVersion === "string" &&
    "role" in value &&
    typeof value.role === "string" &&
    Object.hasOwn(ROLES, value.role)
  );
}

/** base の path を保って `/connection` を連結する。 */
function connectionUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/connection`;
  return url;
}

/** `GET /connection` を呼び、server の API 版と呼び出し元のロールを返す。 */
export async function checkConnection(options: {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}): Promise<Connection> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const res = await doFetch(connectionUrl(options.baseUrl), {
    headers: { Authorization: `Bearer ${options.token}` },
  });
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new ApiError(res.status, isProblem(body) ? body : undefined);
  }
  if (!isConnection(body)) {
    throw new ApiError(
      res.status,
      undefined,
      `${res.status} 応答の body が定義と違う`,
    );
  }
  return body;
}
