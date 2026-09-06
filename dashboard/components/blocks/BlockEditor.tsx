"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Redo2, RotateCcw, Save, Trash2, Undo2, X } from "lucide-react";
import type { Block, BlockKind, TaskPriority, TaskTemplate, TargetSpec } from "@/lib/types";
import { BLOCK_DEFS, BLOCK_DEF_MAP, FAMILY_STYLE, describeBlock, makeBlock, type BlockFamily } from "@/lib/sim/templates";
import { useFleetStore } from "@/lib/store";

const KIND_MIME = "application/x-block-kind";
const UID_MIME = "application/x-block-uid";

function blockStyle(kind: BlockKind): React.CSSProperties {
  const fam = FAMILY_STYLE[BLOCK_DEF_MAP[kind].family];
  return {
    ["--blk-bg" as string]: fam.bg,
    ["--blk-border" as string]: fam.border,
    ["--blk-text" as string]: fam.text,
  };
}

export function BlockEditor({
  template,
  onSave,
  onClose,
}: {
  template: TaskTemplate;
  onSave: (t: TaskTemplate) => void;
  onClose: () => void;
}) {
  const stations = useFleetStore((s) => s.map?.stations ?? []);
  const [meta, setMeta] = useState({
    name: template.name,
    priority: template.priority,
    battery_floor: template.battery_floor,
    allow_rebid: template.allow_rebid,
  });
  const [blocks, setBlocks] = useState<Block[]>(() => JSON.parse(JSON.stringify(template.blocks)));
  const [past, setPast] = useState<Block[][]>([]);
  const [future, setFuture] = useState<Block[][]>([]);
  const [selected, setSelected] = useState<string | null>(template.blocks[0]?.uid ?? null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [draggingUid, setDraggingUid] = useState<string | null>(null);
  const blockRefs = useRef(new Map<string, HTMLDivElement>());
  const canvasRef = useRef<HTMLDivElement>(null);

  const commit = useCallback(
    (next: Block[]) => {
      setPast((p) => [...p.slice(-40), blocks]);
      setFuture([]);
      setBlocks(next);
    },
    [blocks],
  );
  const undo = () => {
    if (!past.length) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture((f) => [blocks, ...f]);
    setBlocks(prev);
  };
  const redo = () => {
    if (!future.length) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast((p) => [...p, blocks]);
    setBlocks(next);
  };
  const reset = () => {
    commit(JSON.parse(JSON.stringify(template.blocks)));
    setSelected(null);
  };

  const insertAt = (kind: BlockKind, index: number) => {
    const b = makeBlock(kind);
    const next = blocks.slice();
    next.splice(index, 0, b);
    commit(next);
    setSelected(b.uid);
  };
  const moveTo = (uid: string, index: number) => {
    const from = blocks.findIndex((b) => b.uid === uid);
    if (from < 0) return;
    const next = blocks.slice();
    const [b] = next.splice(from, 1);
    const to = index > from ? index - 1 : index;
    next.splice(to, 0, b);
    commit(next);
  };
  const remove = (uid: string) => {
    commit(blocks.filter((b) => b.uid !== uid));
    if (selected === uid) setSelected(null);
  };
  const update = (uid: string, patch: Partial<Block>) => {
    commit(blocks.map((b) => (b.uid === uid ? { ...b, ...patch } : b)));
  };

  const indexFromPointer = (clientY: number): number => {
    let idx = blocks.length;
    for (let i = 0; i < blocks.length; i++) {
      const el = blockRefs.current.get(blocks[i].uid);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        idx = i;
        break;
      }
    }
    return idx;
  };

  const onCanvasDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(KIND_MIME) && !e.dataTransfer.types.includes(UID_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(UID_MIME) ? "move" : "copy";
    setDropIndex(indexFromPointer(e.clientY));
  };
  const onCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const idx = indexFromPointer(e.clientY);
    const kind = e.dataTransfer.getData(KIND_MIME) as BlockKind;
    const uid = e.dataTransfer.getData(UID_MIME);
    if (kind) insertAt(kind, idx);
    else if (uid) moveTo(uid, idx);
    setDropIndex(null);
    setDraggingUid(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) remove(selected);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selectedBlock = blocks.find((b) => b.uid === selected) ?? null;
  const families = useMemo(() => ["navigation", "handling", "control"] as BlockFamily[], []);

  const save = () => {
    onSave({
      ...template,
      ...meta,
      blocks,
      updated_at: Date.now(),
      builtin: false,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-white text-admin-text flex flex-col fade-in">
      <div className="flex flex-wrap items-center gap-2 lg:gap-3 px-3 lg:px-4 py-2 lg:py-3 border-b border-admin-line">
        <button onClick={onClose} className="text-admin-text-2 hover:text-admin-text" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
        <div className="text-[15px] lg:text-[16px] font-semibold">Edit Task Template</div>
        <input
          className="admin-input lg:ml-2 w-full sm:w-[240px] order-last sm:order-none"
          value={meta.name}
          onChange={(e) => setMeta({ ...meta, name: e.target.value })}
          placeholder="Template name"
        />
        <div className="flex-1" />
        <button className="admin-btn" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">
          <Undo2 className="h-4 w-4" /> <span className="hidden md:inline">Undo</span>
        </button>
        <button className="admin-btn" onClick={redo} disabled={!future.length} title="Redo (Ctrl+Shift+Z)">
          <Redo2 className="h-4 w-4" /> <span className="hidden md:inline">Redo</span>
        </button>
        <button className="admin-btn" onClick={reset} title="Reset to saved blocks">
          <RotateCcw className="h-4 w-4" /> <span className="hidden md:inline">Reset</span>
        </button>
        <button className="admin-btn admin-btn-primary" onClick={save} disabled={!blocks.length || !meta.name.trim()}>
          <Save className="h-4 w-4" /> Save
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col lg:grid lg:grid-cols-[180px_minmax(0,1fr)_380px]">
        {/* palette: horizontal strip on mobile, column on desktop */}
        <div className="shrink-0 border-b lg:border-b-0 lg:border-r border-admin-line lg:overflow-auto py-3 px-3 flex lg:block gap-4 lg:space-y-3 bg-[#fafafa] overflow-x-auto hide-scrollbar">
          {families.map((fam) => (
            <div key={fam} className="shrink-0">
              <div className="text-[10px] uppercase tracking-wider text-admin-text-2 mb-1.5 pl-1">{FAMILY_STYLE[fam].name}</div>
              <div className="flex lg:flex-col gap-3">
                {BLOCK_DEFS.filter((d) => d.family === fam).map((d) => (
                  <div
                    key={d.kind}
                    className="block block-palette"
                    style={blockStyle(d.kind)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(KIND_MIME, d.kind);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => insertAt(d.kind, selected ? blocks.findIndex((b) => b.uid === selected) + 1 : blocks.length)}
                    title={`${d.description}\nClick to add · drag onto the canvas`}
                  >
                    <span className="block-icon" />
                    {d.label}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="hidden lg:block text-[10px] text-admin-text-2 pt-2 leading-snug">
            Blocks define <b>what</b> a task is. <b>Who</b> does it is decided by the robots&apos; auction.
          </div>
        </div>

        {/* canvas */}
        <div
          ref={canvasRef}
          className="relative min-h-[46vh] lg:min-h-0 lg:overflow-auto p-4 lg:p-6 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]"
          onDragOver={onCanvasDragOver}
          onDragLeave={(e) => {
            if (!canvasRef.current?.contains(e.relatedTarget as Node)) setDropIndex(null);
          }}
          onDrop={onCanvasDrop}
          onClick={() => setSelected(null)}
        >
          <div className="inline-flex flex-col items-start gap-[10px] min-w-[260px]">
            <div className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-admin-text shadow-sm flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-[#2563eb]" /> Start
              <span className="text-[10px] font-normal text-admin-text-2 ml-1">published to fleet topic → auction</span>
            </div>
            {blocks.map((b, i) => (
              <div key={b.uid} className="flex flex-col items-start w-full">
                {dropIndex === i && <div className="drop-indicator w-[220px]" />}
                <div
                  ref={(el) => {
                    if (el) blockRefs.current.set(b.uid, el);
                    else blockRefs.current.delete(b.uid);
                  }}
                  className="block group"
                  style={blockStyle(b.kind)}
                  data-selected={selected === b.uid}
                  data-dragging={draggingUid === b.uid}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(UID_MIME, b.uid);
                    e.dataTransfer.effectAllowed = "move";
                    setDraggingUid(b.uid);
                  }}
                  onDragEnd={() => {
                    setDraggingUid(null);
                    setDropIndex(null);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(b.uid);
                  }}
                >
                  <span className="block-icon" />
                  <span className="flex items-center justify-between gap-3">
                    <span>
                      {BLOCK_DEF_MAP[b.kind].label}
                      <span className="font-normal opacity-80 ml-2 text-[12px]">{describeBlock(b).replace(`${BLOCK_DEF_MAP[b.kind].label}`, "").trim()}</span>
                    </span>
                    <button
                      className="opacity-0 group-hover:opacity-70 hover:!opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(b.uid);
                      }}
                      title="Remove block"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              </div>
            ))}
            {dropIndex === blocks.length && <div className="drop-indicator w-[220px]" />}
            {!blocks.length && (
              <div className="text-[12px] text-admin-text-2 border border-dashed border-gray-300 rounded-md px-4 py-6 bg-white/70">
                Drag blocks here (or click them in the palette) to build the task.
              </div>
            )}
            <div className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-admin-text shadow-sm flex items-center gap-2 mt-1">
              <span className="h-3 w-3 rounded-full bg-[#16a34a]" /> End → task done, robot returns to auction
            </div>
          </div>
        </div>

        {/* properties */}
        <div className="border-t lg:border-t-0 lg:border-l border-admin-line lg:overflow-auto">
          {selectedBlock ? (
            <BlockProps block={selectedBlock} stations={stations} onChange={(patch) => update(selectedBlock.uid, patch)} />
          ) : (
            <div className="p-4">
              <div className="flex items-center gap-2 text-[15px] font-semibold mb-3">
                <span className="w-1 h-4 bg-[#16a34a] rounded" /> Template
              </div>
              <div className="text-[12px] text-admin-text-2">Select a block to edit its properties. Template-level settings:</div>
            </div>
          )}
          <div className="p-4 border-t border-admin-line">
            <div className="text-[12px] font-semibold mb-2">Template settings</div>
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <label className="space-y-1">
                <div className="text-admin-text-2">Priority</div>
                <select className="admin-input w-full" value={meta.priority} onChange={(e) => setMeta({ ...meta, priority: e.target.value as TaskPriority })}>
                  <option value="normal">normal</option>
                  <option value="urgent">urgent</option>
                </select>
              </label>
              <label className="space-y-1">
                <div className="text-admin-text-2">Battery floor %</div>
                <input className="admin-input w-full" type="number" min={5} max={60} value={meta.battery_floor} onChange={(e) => setMeta({ ...meta, battery_floor: Number(e.target.value) })} />
              </label>
              <label className="col-span-2 flex items-center gap-2">
                <input type="checkbox" checked={meta.allow_rebid} onChange={(e) => setMeta({ ...meta, allow_rebid: e.target.checked })} />
                Allow re-bid when a blocked aisle raises the cost &gt; 40 %
              </label>
            </div>
          </div>
          <div className="p-4 border-t border-admin-line">
            <div className="text-[12px] font-semibold mb-2 flex items-center gap-2">
              Allocation <span className="text-[10px] font-normal rounded bg-gray-100 border border-gray-200 px-1.5 py-0.5 text-admin-text-2">read-only</span>
            </div>
            <div className="text-[12px] space-y-1 text-admin-text">
              <div>
                Method: <b>Contract Net Protocol auction</b> (no auctioneer)
              </div>
              <div className="mono text-[11px] bg-gray-50 border border-gray-200 rounded px-2 py-1">bid = dist + 0.5·queue + max(0, 50 − battery)·0.25</div>
              <div className="text-admin-text-2">Every idle robot computes the same bid function on-board; the lowest bid self-assigns. Bids are shown in the live queue so you can verify this screen never picked the robot.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BlockProps({
  block,
  stations,
  onChange,
}: {
  block: Block;
  stations: { id: string; type: "pickup" | "drop" }[];
  onChange: (patch: Partial<Block>) => void;
}) {
  const def = BLOCK_DEF_MAP[block.kind];
  const fam = FAMILY_STYLE[def.family];
  const target: TargetSpec = block.target ?? { kind: "any_pickup" };
  return (
    <div className="p-4 space-y-3 text-[12px]">
      <div className="flex items-center gap-2 text-[15px] font-semibold">
        <span className="w-1 h-4 rounded" style={{ background: fam.border }} /> {def.label}
      </div>
      <div className="text-admin-text-2">{def.description}</div>

      {block.kind === "navigate" && (
        <>
          <Field label="Target type" required>
            <select
              className="admin-input w-full"
              value={target.kind}
              onChange={(e) => {
                const k = e.target.value as TargetSpec["kind"];
                if (k === "station") onChange({ target: { kind: "station", id: stations[0]?.id ?? "P1" } });
                else if (k === "cell") onChange({ target: { kind: "cell", x: 5, y: 10 } });
                else onChange({ target: { kind: k } });
              }}
            >
              <option value="any_pickup">Nearest pickup station</option>
              <option value="any_drop">Nearest drop station</option>
              <option value="station">Specific station</option>
              <option value="cell">Map cell</option>
            </select>
          </Field>
          {target.kind === "station" && (
            <Field label="Station" required>
              <select className="admin-input w-full" value={target.id} onChange={(e) => onChange({ target: { kind: "station", id: e.target.value } })}>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} · {s.type}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {target.kind === "cell" && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="x">
                <input className="admin-input w-full" type="number" value={target.x} onChange={(e) => onChange({ target: { ...target, x: Number(e.target.value) } })} />
              </Field>
              <Field label="y">
                <input className="admin-input w-full" type="number" value={target.y} onChange={(e) => onChange({ target: { ...target, y: Number(e.target.value) } })} />
              </Field>
            </div>
          )}
          <div className="text-[11px] text-admin-text-2">The robot plans its own route on-board (A* heuristic inside PIBT). No path is sent from here.</div>
        </>
      )}

      {(block.kind === "pickup" || block.kind === "drop" || block.kind === "wait" || block.kind === "sleep" || block.kind === "confirm" || block.kind === "rack" || block.kind === "lift") && (
        <Field label="Duration (s)">
          <input className="admin-input w-full" type="number" min={0} step={0.5} value={block.seconds ?? 0} onChange={(e) => onChange({ seconds: Number(e.target.value) })} />
        </Field>
      )}
      {block.kind === "rack" && (
        <Field label="Rack label">
          <input className="admin-input w-full" value={block.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} placeholder="e.g. B04" />
        </Field>
      )}
      {block.kind === "lift" && (
        <Field label="Lift">
          <select className="admin-input w-full" value={block.lift ?? "up"} onChange={(e) => onChange({ lift: e.target.value as "up" | "down" })}>
            <option value="up">Raise</option>
            <option value="down">Lower</option>
          </select>
        </Field>
      )}
      {block.kind === "confirm" && (
        <Field label="Prompt shown on robot">
          <input className="admin-input w-full" value={block.message ?? ""} onChange={(e) => onChange({ message: e.target.value })} />
        </Field>
      )}
      {block.kind === "charge_if" && (
        <Field label="Battery threshold %">
          <input className="admin-input w-full" type="number" min={5} max={80} value={block.threshold ?? 20} onChange={(e) => onChange({ threshold: Number(e.target.value) })} />
        </Field>
      )}
      {block.kind === "repeat" && (
        <Field label="Repeat all blocks above, N more times">
          <input className="admin-input w-full" type="number" min={0} max={10} value={block.count ?? 1} onChange={(e) => onChange({ count: Number(e.target.value) })} />
        </Field>
      )}
      <div className="pt-2 flex items-center justify-between text-admin-text-2">
        <span>Allow tasks to skip</span>
        <span className="toggle" data-on="false" />
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-admin-text-2">
        {required && <span className="text-red-500 mr-0.5">*</span>}
        {label}
      </div>
      {children}
    </label>
  );
}
