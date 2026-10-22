// AWS Signature V4 query-string presigning (S3-compatible), used for R2's
// short-lived upload and download links (ADR-08). The Worker never handles file
// bytes: it signs URLs and the browser talks to R2 directly.
const encoder = new TextEncoder();

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const sha256 = async (value: string) =>
  hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
}

// RFC 3986 encoding, as SigV4 requires.
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
export const encodePath = (path: string) =>
  path.split("/").map(encode).join("/");

export type PresignInput = {
  method: "GET" | "PUT";
  host: string;
  // Already-encoded absolute path, e.g. "/bucket/key".
  path: string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresIn: number;
  now: Date;
  // Extra headers the request must send exactly (signed), e.g. content-length.
  headers?: Record<string, string>;
};

export async function presignUrl(input: PresignInput) {
  const service = input.service ?? "s3";
  const amzDate = input.now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${input.region}/${service}/aws4_request`;
  const headers = Object.fromEntries(
    Object.entries({ host: input.host, ...input.headers }).map(
      ([name, value]) => [name.toLowerCase(), value.trim()],
    ),
  );
  const headerNames = Object.keys(headers).sort();
  const signedHeaders = headerNames.join(";");
  const query = Object.entries({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresIn),
    "X-Amz-SignedHeaders": signedHeaders,
  })
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .sort()
    .join("&");
  const canonicalRequest = [
    input.method,
    input.path,
    query,
    headerNames.map((name) => `${name}:${headers[name]}\n`).join(""),
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256(canonicalRequest),
  ].join("\n");
  let key: ArrayBuffer = await hmac(
    // Copied into a plain ArrayBuffer-backed array for both DOM and Workers types.
    new Uint8Array(encoder.encode(`AWS4${input.secretAccessKey}`)),
    date,
  );
  for (const part of [input.region, service, "aws4_request"])
    key = await hmac(key, part);
  const signature = hex(await hmac(key, stringToSign));
  return `https://${input.host}${input.path}?${query}&X-Amz-Signature=${signature}`;
}
