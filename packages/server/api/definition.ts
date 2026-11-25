// bundle 済みの定義 (openapi.gen.json) を読み、operation を引ける表にする。
import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";

/** 値を検査し、不正な箇所の説明を返す。空配列なら合格。 */
export type Check = (value: unknown) => string[];

/** path・query の parameter。 */
export type ParameterSpec = {
  name: string;
  in: "path" | "query";
  required: boolean;
  /** schema の `type`。文字列からの変換に使う。 */
  type: string | undefined;
  check: Check;
};

/** JSON の requestBody。 */
export type BodySpec = {
  required: boolean;
  /** 宣言された media type (小文字、parameter なし)。 */
  mediaType: string;
  check: Check;
};

/** 応答 1 件。media type (小文字、parameter なし) ごとの検証器を持つ。schema が無い media type の検証器は `undefined`。 */
export type ResponseSpec = Map<string, Check | undefined>;

export type Operation = {
  /** 大文字のメソッド。 */
  method: string;
  /** Hono の path (`{x}` を `:x` に変えたもの)。 */
  path: string;
  parameters: ParameterSpec[];
  body: BodySpec | undefined;
  /** status (`"200"`・`"default"` 等) ごとの応答。 */
  responses: Map<string, ResponseSpec>;
  /** 有効な `security` (operation のもの、無ければ root のもの)。 */
  security: unknown[];
};

export type Definition = {
  /** `info.version`。 */
  version: string;
  /** キーは `"GET /connection"` のような「大文字のメソッド + 空白 + Hono の path」。 */
  operations: Map<string, Operation>;
};

type Json = Record<string, unknown>;

const METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** operation を引く表のキー。 */
export function operationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** 検証器を作る。`$ref` を解決できるように、定義の `components` を schema に同居させる。 */
function createCheck(schema: unknown, components: unknown): Check {
  if (!isRecord(schema)) {
    throw new Error("schema がオブジェクトでない");
  }
  const validator = new Validator({ ...schema, components }, "2020-12", false);
  return (value) =>
    validator
      .validate(value)
      .errors.map((e) =>
        e.instanceLocation === "#"
          ? e.error
          : `${e.instanceLocation.replace(/^#/, "")}: ${e.error}`,
      );
}

function rejectRef(value: Json, where: string): void {
  if ("$ref" in value) {
    throw new Error(`${where}: $ref は未対応`);
  }
}

/** `Content-Type` 等の値から、parameter を除いた小文字の media type を取り出す。 */
export function toMediaType(value: string | null | undefined): string {
  return (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function parseParameters(
  where: string,
  components: unknown,
  pathLevel: unknown,
  opLevel: unknown,
): ParameterSpec[] {
  // operation の parameter は、path 全体の同名・同じ位置の parameter を上書きする。
  const merged = new Map<string, Json>();
  for (const list of [pathLevel, opLevel]) {
    if (list === undefined) {
      continue;
    }
    if (!Array.isArray(list)) {
      throw new Error(`${where}: parameters が配列でない`);
    }
    for (const item of list) {
      if (!isRecord(item)) {
        throw new Error(`${where}: parameter がオブジェクトでない`);
      }
      rejectRef(item, `${where}: parameter`);
      merged.set(`${String(item.in)} ${String(item.name)}`, item);
    }
  }
  const specs: ParameterSpec[] = [];
  for (const item of merged.values()) {
    // header と cookie は検証しない。
    if (item.in !== "path" && item.in !== "query") {
      continue;
    }
    if (typeof item.name !== "string") {
      throw new Error(`${where}: parameter に name が無い`);
    }
    const schema = item.schema;
    specs.push({
      name: item.name,
      in: item.in,
      required: item.in === "path" || item.required === true,
      type:
        isRecord(schema) && typeof schema.type === "string"
          ? schema.type
          : undefined,
      check: createCheck(schema ?? {}, components),
    });
  }
  return specs;
}

function parseBody(
  where: string,
  components: unknown,
  requestBody: unknown,
): BodySpec | undefined {
  if (requestBody === undefined) {
    return undefined;
  }
  if (!isRecord(requestBody)) {
    throw new Error(`${where}: requestBody がオブジェクトでない`);
  }
  rejectRef(requestBody, `${where}: requestBody`);
  const content = isRecord(requestBody.content) ? requestBody.content : {};
  for (const [mediaType, media] of Object.entries(content)) {
    if (toMediaType(mediaType) === "application/json" && isRecord(media)) {
      return {
        required: requestBody.required === true,
        mediaType: "application/json",
        check: createCheck(media.schema ?? {}, components),
      };
    }
  }
  return undefined;
}

function parseResponses(
  where: string,
  components: unknown,
  responses: unknown,
): Map<string, ResponseSpec> {
  const result = new Map<string, ResponseSpec>();
  if (!isRecord(responses)) {
    return result;
  }
  for (const [status, response] of Object.entries(responses)) {
    if (!isRecord(response)) {
      throw new Error(`${where}: ${status} の応答がオブジェクトでない`);
    }
    rejectRef(response, `${where}: ${status} の応答`);
    const spec: ResponseSpec = new Map();
    const content = isRecord(response.content) ? response.content : {};
    for (const [mediaType, media] of Object.entries(content)) {
      if (!isRecord(media)) {
        continue;
      }
      spec.set(
        toMediaType(mediaType),
        media.schema === undefined
          ? undefined
          : createCheck(media.schema, components),
      );
    }
    result.set(status, spec);
  }
  return result;
}

/**
 * 定義の object から表を作る。検証器はここで 1 回だけ作る。
 * `info.version`・`paths`・`components` が無ければ例外を投げる。
 */
export function parseDefinition(doc: unknown): Definition {
  if (
    !isRecord(doc) ||
    !isRecord(doc.info) ||
    typeof doc.info.version !== "string" ||
    !isRecord(doc.paths) ||
    !isRecord(doc.components)
  ) {
    throw new Error("定義に info.version・paths・components が無い");
  }
  if (doc.security !== undefined && !Array.isArray(doc.security)) {
    throw new Error("定義の security が配列でない");
  }
  const rootSecurity: unknown[] = doc.security ?? [];
  const operations = new Map<string, Operation>();
  for (const [path, item] of Object.entries(doc.paths)) {
    if (!isRecord(item)) {
      continue;
    }
    const honoPath = path.replace(/\{([^}]+)\}/g, ":$1");
    for (const method of METHODS) {
      const op = item[method];
      if (!isRecord(op)) {
        continue;
      }
      const key = operationKey(method, honoPath);
      if (op.security !== undefined && !Array.isArray(op.security)) {
        throw new Error(`${key}: security が配列でない`);
      }
      operations.set(key, {
        method: method.toUpperCase(),
        path: honoPath,
        parameters: parseParameters(
          key,
          doc.components,
          item.parameters,
          op.parameters,
        ),
        body: parseBody(key, doc.components, op.requestBody),
        responses: parseResponses(key, doc.components, op.responses),
        security: op.security ?? rootSecurity,
      });
    }
  }
  return { version: doc.info.version, operations };
}

/** JSON の定義を読んで表にする。 */
export function loadDefinition(url: URL): Definition {
  return parseDefinition(JSON.parse(readFileSync(url, "utf8")));
}
