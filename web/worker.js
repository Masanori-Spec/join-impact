import { auditJoin } from "../src/engine.ts";

self.onmessage = async ({ data }) => {
  const { requestId, request } = data ?? {};
  if (!Number.isSafeInteger(requestId) || !request) return;
  try {
    const report = await auditJoin(request);
    self.postMessage({ requestId, report });
  } catch (error) {
    self.postMessage({
      requestId,
      error: {
        code: typeof error?.code === "string" ? error.code : "AUDIT_FAILED",
        message:
          typeof error?.message === "string" ? error.message : "Audit failed",
      },
    });
  }
};
