/** `TODAIMORI_PORT` を解釈する。未設定なら 3000。10 進の数字列で 1〜65535 以外は例外を投げる。 */
export function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 3000;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error("TODAIMORI_PORT が 10 進の数字列でない");
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new Error("TODAIMORI_PORT が 1〜65535 の範囲外");
  }
  return port;
}
