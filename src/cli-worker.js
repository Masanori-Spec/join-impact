import { parentPort, workerData } from "node:worker_threads";
import { auditJoin } from "../build/engine.js";
try {
  const report = await auditJoin(workerData);
  parentPort.postMessage({ report });
} catch (error) {
  parentPort.postMessage({
    error: {
      code: error.code || "INTERNAL",
      message: error.message || "Audit failed",
    },
  });
}
