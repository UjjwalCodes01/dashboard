"use client";

import { useMemo, useState } from "react";
import { Download, Pencil, Plus, RefreshCw, Send, Trash2, Upload } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { BlockEditor } from "@/components/blocks/BlockEditor";
import { TaskQueue } from "@/components/tasks/TaskQueue";
import { useFleetStore } from "@/lib/store";
import { describeBlock, makeBlock, newUid } from "@/lib/sim/templates";
import type { TaskPriority, TaskTemplate } from "@/lib/types";

function fmtLast(ts: number | null) {
  if (!ts) return "never";
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

export default function TasksPage() {
  const templates = useFleetStore((s) => s.templates);
  const upsert = useFleetStore((s) => s.upsertTemplate);
  const del = useFleetStore((s) => s.deleteTemplate);
  const issue = useFleetStore((s) => s.issueTemplate);
  const [editing, setEditing] = useState<TaskTemplate | null>(null);
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [prios, setPrios] = useState<Record<string, TaskPriority>>({});
  const [flash, setFlash] = useState<string | null>(null);

  const list = useMemo(() => templates.filter((t) => t.name.toLowerCase().includes(query.toLowerCase())), [templates, query]);

  const create = () =>
    setEditing({
      id: `tpl-${newUid()}`,
      name: "New template",
      priority: "normal",
      battery_floor: 20,
      allow_rebid: true,
      blocks: [makeBlock("navigate", { target: { kind: "any_pickup" } }), makeBlock("pickup"), makeBlock("navigate", { target: { kind: "any_drop" } }), makeBlock("drop")],
      updated_at: Date.now(),
      last_issued: null,
    });

  const exportTpl = (t: TaskTemplate) => {
    const blob = new Blob([JSON.stringify(t, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${t.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTpl = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const t = JSON.parse(await f.text()) as TaskTemplate;
        if (!t.blocks || !Array.isArray(t.blocks)) throw new Error("bad file");
        upsert({ ...t, id: t.id || `tpl-${newUid()}`, builtin: false, updated_at: Date.now(), last_issued: null });
      } catch {
        setFlash("Import failed: not a template JSON");
        setTimeout(() => setFlash(null), 2500);
      }
    };
    input.click();
  };

  const doIssue = (t: TaskTemplate) => {
    const n = counts[t.id] ?? 3;
    const p = prios[t.id] ?? t.priority;
    issue(t.id, n, p);
    setFlash(`${n} × "${t.name}" published to the fleet task topic — watch the bids arrive below`);
    setTimeout(() => setFlash(null), 3500);
  };

  return (
    <AdminShell
      title="Task Templates"
      actions={
        <>
          <input className="admin-input w-[160px] sm:w-[220px]" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="admin-btn" onClick={importTpl}>
            <Upload className="h-4 w-4" /> <span className="hidden sm:inline">Import</span>
          </button>
          <button className="admin-btn admin-btn-primary" onClick={create}>
            <Plus className="h-4 w-4" /> Create
          </button>
          <button className="admin-btn" title="Templates are stored in this browser" onClick={() => location.reload()}>
            <RefreshCw className="h-4 w-4" />
          </button>
        </>
      }
    >
      {flash && <div className="mb-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-[12px] text-green-800 fade-in">{flash}</div>}

      <div className="rounded-md border border-admin-line bg-white overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Steps</th>
              <th className="hidden md:table-cell">Priority</th>
              <th className="hidden md:table-cell">Battery floor</th>
              <th className="hidden md:table-cell">Re-bid on block</th>
              <th className="hidden md:table-cell">Last issued</th>
              <th>Issue to fleet</th>
              <th>Operation</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <td>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-[10px] text-admin-text-2 mono">
                    {t.id}
                    {t.builtin && " · built-in"}
                  </div>
                </td>
                <td className="whitespace-normal! min-w-[180px] md:min-w-[260px] max-w-[420px]">
                  <div className="flex flex-wrap gap-1">
                    {t.blocks.map((b, i) => (
                      <span key={b.uid + i} className="rounded border border-gray-200 bg-gray-50 px-1.5 py-px text-[11px]">
                        {describeBlock(b)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="hidden md:table-cell">
                  <span className={`rounded px-1.5 py-px text-[11px] text-white ${t.priority === "urgent" ? "bg-red-600" : "bg-blue-600"}`}>{t.priority}</span>
                </td>
                <td className="hidden md:table-cell mono">{t.battery_floor}%</td>
                <td className="hidden md:table-cell">{t.allow_rebid ? <span className="text-green-700">● yes</span> : <span className="text-admin-text-2">○ no</span>}</td>
                <td className="hidden md:table-cell text-admin-text-2">{fmtLast(t.last_issued)}</td>
                <td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input className="admin-input w-[56px] mono" type="number" min={1} max={20} value={counts[t.id] ?? 3} onChange={(e) => setCounts({ ...counts, [t.id]: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
                    <select className="admin-input" value={prios[t.id] ?? t.priority} onChange={(e) => setPrios({ ...prios, [t.id]: e.target.value as TaskPriority })}>
                      <option value="normal">normal</option>
                      <option value="urgent">urgent</option>
                    </select>
                    <button className="admin-btn admin-btn-primary" onClick={() => doIssue(t)} title="Publishes N task instances to the fleet topic. Robots bid; the winner self-assigns.">
                      <Send className="h-3.5 w-3.5" /> Issue
                    </button>
                  </div>
                </td>
                <td>
                  <div className="flex items-center gap-3">
                    <button className="admin-link inline-flex items-center gap-1" onClick={() => setEditing(t)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button className="admin-link inline-flex items-center gap-1" onClick={() => exportTpl(t)}>
                      <Download className="h-3.5 w-3.5" /> Export
                    </button>
                    <button className={`inline-flex items-center gap-1 ${t.builtin ? "text-gray-300 cursor-not-allowed" : "admin-link"}`} disabled={t.builtin} onClick={() => del(t.id)} title={t.builtin ? "Built-in templates cannot be deleted" : "Delete"}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={8} className="text-center text-admin-text-2 py-6">
                  No templates match
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-4">
        <div className="rounded-md border border-admin-line bg-white overflow-hidden h-[420px] flex flex-col">
          <div className="px-3 py-2 border-b border-admin-line font-semibold text-[13px] flex flex-wrap items-center gap-2">
            Live task queue
            <span className="text-[11px] font-normal text-admin-text-2">announced → bids received → winner self-assigned → in progress → done / re-bid</span>
          </div>
          <div className="flex-1 min-h-0">
            <TaskQueue />
          </div>
        </div>
        <div className="rounded-md border border-admin-line bg-white p-4 text-[12px] space-y-3 h-fit">
          <div className="font-semibold text-[13px]">What this page can and cannot do</div>
          <ul className="space-y-2 text-admin-text">
            <li>
              <b>Can:</b> define <i>what</i> a task is (blocks), and publish N instances into the fleet&apos;s task topic.
            </li>
            <li>
              <b>Cannot:</b> choose <i>which</i> robot does it. There is deliberately no &quot;assign to robot&quot; control.
            </li>
            <li>
              <b>Proof:</b> every task row shows the bids each robot computed on-board and the lowest bid self-assigning.
            </li>
          </ul>
          <div className="rounded bg-gray-50 border border-gray-200 p-2">
            <div className="text-[11px] text-admin-text-2 mb-1">Bid function (identical on every robot)</div>
            <div className="mono text-[11px]">dist + 0.5·queue + max(0, 50 − battery)·0.25</div>
          </div>
          <div className="text-[11px] text-admin-text-2">Templates are stored in this browser (Round 1). Final build: /api/templates on the backend.</div>
        </div>
      </div>

      {editing && (
        <BlockEditor
          template={editing}
          onClose={() => setEditing(null)}
          onSave={(t) => {
            upsert(t);
            setEditing(null);
            setFlash(`Template "${t.name}" saved`);
            setTimeout(() => setFlash(null), 2500);
          }}
        />
      )}
    </AdminShell>
  );
}
