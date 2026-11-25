import { ApiError, checkConnection } from "./api/connection.ts";

const token = process.env.TODAIMORI_API_TOKEN;
if (token === undefined || token === "") {
  console.error("TODAIMORI_API_TOKEN が未設定");
  process.exit(1);
}
const baseUrl = process.env.TODAIMORI_API_URL || "http://127.0.0.1:3000";

try {
  const { apiVersion, role } = await checkConnection({ baseUrl, token });
  console.log(`connected: apiVersion=${apiVersion} role=${role}`);
} catch (e) {
  if (e instanceof ApiError) {
    console.error(
      e.problem === undefined
        ? `接続に失敗: status=${e.status} ${e.message}`
        : `接続に失敗: status=${e.status} title=${e.problem.title}`,
    );
  } else {
    console.error("接続に失敗:", e instanceof Error ? e.message : e);
  }
  process.exit(1);
}
