/** The catalogue. Everything the server can do is in this list. */

import type { ToolDef } from './types.js';
import { sparqlQuery, sparqlUpdate, describeResource } from './query.js';
import { listGraphs, readGraph, writeGraph, dropGraph, loadRdfFile } from './graphs.js';
import { listDatasets, datasetStats, createDataset, deleteDataset } from './datasets.js';
import { serverInfo, backupDataset, compactDataset, taskStatus } from './admin.js';

export const ALL_TOOLS: ToolDef[] = [
  // querying
  sparqlQuery,
  sparqlUpdate,
  describeResource,
  // graphs
  listGraphs,
  readGraph,
  writeGraph,
  dropGraph,
  loadRdfFile,
  // datasets
  listDatasets,
  datasetStats,
  createDataset,
  deleteDataset,
  // the server
  serverInfo,
  backupDataset,
  compactDataset,
  taskStatus,
];

export function toolsFor(readOnly: boolean): ToolDef[] {
  return readOnly ? ALL_TOOLS.filter((t) => !t.writes) : ALL_TOOLS;
}

export function findTool(name: string): ToolDef | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export type { ToolDef, ToolContext } from './types.js';
