/** The server itself: what it is, and the long-running jobs it can be asked to do. */

import type { ToolDef } from './types.js';
import { requireString } from './types.js';

export const serverInfo: ToolDef = {
  name: 'server_info',
  writes: false,
  description: `Version, uptime and per-dataset request statistics.

Worth a call at the start of a session to confirm you are talking to the server
you think you are -- a wrong endpoint that happens to answer is otherwise hard to
spot.`,
  inputSchema: {
    type: 'object',
    properties: {
      dataset: { type: 'string', description: 'Limit the statistics to one dataset.' },
    },
  },
  async run(args, ctx) {
    const info = (await ctx.client.serverInfo()) as {
      version?: string; uptime?: number; datasets?: { 'ds.name'?: string }[];
    };
    let stats: unknown = null;
    try { stats = await ctx.client.stats(args.dataset); } catch { /* optional */ }

    const uptime = typeof info.uptime === 'number'
      ? `${Math.floor(info.uptime / 3600)}h ${Math.floor((info.uptime % 3600) / 60)}m`
      : 'unknown';

    return ctx.cap([
      `Apache Jena Fuseki ${info.version ?? '?'} at ${ctx.config.endpoint}`,
      `Uptime: ${uptime}`,
      `Datasets: ${(info.datasets ?? []).map((d) => d['ds.name']).join(', ') || 'none'}`,
      '',
      stats ? JSON.stringify(stats, null, 2) : '(no statistics available)',
    ].join('\n'), 'server info');
  },
};

export const backupDataset: ToolDef = {
  name: 'backup_dataset',
  writes: false,
  description: `Start a server-side backup of a dataset.

The backup is written on the server, into Fuseki's backups directory, and runs in
the background: this returns a task id to poll with task_status.

Do this before anything destructive. There is no undo for drop_graph or
delete_dataset.

Listed as a read tool deliberately -- it copies data out, it does not change it,
so it stays available when the server runs read-only.`,
  inputSchema: {
    type: 'object',
    properties: {
      dataset: { type: 'string', description: 'Dataset name. Defaults to the configured one.' },
    },
  },
  async run(args, ctx) {
    const task = (await ctx.client.backup(args.dataset)) as { taskId?: string };
    const name = args.dataset || ctx.config.dataset;
    return `Backup of "${name}" started (task ${task.taskId ?? '?'}). Poll it with task_status.`;
  },
};

export const compactDataset: ToolDef = {
  name: 'compact_dataset',
  writes: true,
  description: `Compact a TDB2 dataset, reclaiming space held by superseded data.

Runs in the background; poll with task_status. delete_old removes the
pre-compaction copy once it succeeds, which frees the most space and cannot be
undone.

Only meaningful for TDB2 datasets.`,
  inputSchema: {
    type: 'object',
    properties: {
      dataset: { type: 'string', description: 'Dataset name. Defaults to the configured one.' },
      delete_old: { type: 'boolean', description: 'Delete the pre-compaction copy. Default false.' },
    },
  },
  async run(args, ctx) {
    const task = (await ctx.client.compact(args.dataset, args.delete_old === true)) as { taskId?: string };
    const name = args.dataset || ctx.config.dataset;
    return `Compaction of "${name}" started (task ${task.taskId ?? '?'}). Poll it with task_status.`;
  },
};

export const taskStatus: ToolDef = {
  name: 'task_status',
  writes: false,
  description: `The state of a background task started by backup_dataset or compact_dataset.

A task that has finished reports a "finished" timestamp; one still running does
not.`,
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'Task id returned by backup_dataset or compact_dataset.' },
    },
    required: ['task_id'],
  },
  async run(args, ctx) {
    const task = (await ctx.client.task(requireString(args, 'task_id'))) as Record<string, unknown>;
    const done = Boolean(task.finished);
    return `${task.task ?? 'Task'} ${task.taskId ?? ''}: ${done ? 'finished' : 'running'}\n` +
           JSON.stringify(task, null, 2);
  },
};
