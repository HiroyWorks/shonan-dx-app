// Minimal host declarations for local tsc; the deployed Deno runtime supplies these.
declare namespace Deno {
  const env: { get(name: string): string | undefined }
  function serve(handler: (request: Request) => Response | Promise<Response>): void
}
