import { getDomain } from "../graph/domain.js";

export interface SyncInput {
  changedFiles: string[];
  graphScanHash?: string;
  scanFileHash?: string;
  contextPackPaths?: string[];
  contextPackTask?: string;
}

export interface SyncReport {
  changedFiles: string[];
  affectedDomains: Map<string, number>;
  graphStale: boolean;
  contextPackAffected: boolean;
  recommendations: string[];
}

export function buildSyncReport(input: SyncInput): SyncReport {
  const changedFiles = input.changedFiles.filter(Boolean);

  const affectedDomains = new Map<string, number>();
  for (const file of changedFiles) {
    const domain = getDomain(file);
    affectedDomains.set(domain, (affectedDomains.get(domain) ?? 0) + 1);
  }

  const hasBothHashes =
    typeof input.graphScanHash === "string" &&
    typeof input.scanFileHash === "string";
  const graphStale = hasBothHashes
    ? input.scanFileHash !== input.graphScanHash
    : false;

  const packPaths = input.contextPackPaths ?? [];
  const changedSet = new Set(changedFiles);
  const contextPackAffected =
    packPaths.length > 0 && packPaths.some((p) => changedSet.has(p));

  const recommendations: string[] = [];

  if (graphStale) {
    recommendations.push(
      "Re-run: pnpm forge scan && pnpm forge graph (graph stale vs scan)"
    );
  }

  if (contextPackAffected) {
    const taskHint = input.contextPackTask
      ? ` "${input.contextPackTask}"`
      : ' "<descripcion de la tarea>"';
    recommendations.push(
      `Re-run: pnpm forge context${taskHint} (context-pack toca archivos cambiados)`
    );
  }

  if (changedFiles.length === 0) {
    recommendations.push(
      "Sin cambios desde el ref indicado; nada que regenerar."
    );
  } else if (!graphStale && !contextPackAffected) {
    recommendations.push(
      "Artifacts coherentes con el delta; no es necesario rebuild."
    );
  }

  return {
    changedFiles,
    affectedDomains,
    graphStale,
    contextPackAffected,
    recommendations
  };
}
