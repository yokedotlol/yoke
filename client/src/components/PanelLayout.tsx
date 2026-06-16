import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

// ─── localStorage persistence ────────────────────────────────────

const STORAGE_KEY = "yoke-panel-layout";

interface LayoutState {
  collapsed: Record<string, boolean>;
  order: Record<string, string[]>;
}

function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { collapsed: parsed.collapsed ?? {}, order: parsed.order ?? {} };
    }
  } catch {
    /* */
  }
  return { collapsed: {}, order: {} };
}

function saveLayout(state: LayoutState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* */
  }
}

export function resetLayout() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* */
  }
}

// ─── Context ─────────────────────────────────────────────────────

interface PanelCtx {
  panelId: string;
  collapsed: boolean;
  toggle: () => void;
  onGripMouseDown: () => void;
  onGripMouseUp: () => void;
}

const PanelContext = createContext<PanelCtx | null>(null);

export function usePanelContext(): PanelCtx | null {
  return useContext(PanelContext);
}

// ─── PanelDef ────────────────────────────────────────────────────

export interface PanelDef {
  id: string;
  node: ReactNode;
  visible?: boolean;
  fullWidth?: boolean;
}

// ─── PanelGrid ───────────────────────────────────────────────────

export function PanelGrid({ tabId, panels, grid = true }: { tabId: string; panels: PanelDef[]; grid?: boolean }) {
  const [layout, setLayout] = useState<LayoutState>(() => loadLayout());
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragSrcRef = useRef<string | null>(null);
  const gripActiveRef = useRef<string | null>(null);

  // Filter visible
  const visible: PanelDef[] = [];
  for (let i = 0; i < panels.length; i++) {
    if (panels[i].visible !== false) visible.push(panels[i]);
  }

  // Compute order
  const defaultOrder = visible.map((p) => p.id);
  const saved = layout.order[tabId];
  let orderedIds: string[];
  if (saved) {
    const a = saved.filter((id) => defaultOrder.indexOf(id) >= 0);
    for (const id of defaultOrder) {
      if (a.indexOf(id) < 0) a.push(id);
    }
    orderedIds = a;
  } else {
    orderedIds = defaultOrder;
  }

  const ordered: PanelDef[] = [];
  for (const id of orderedIds) {
    const p = visible.find((v) => v.id === id);
    if (p) ordered.push(p);
  }

  function isCollapsed(pid: string): boolean {
    return !!layout.collapsed[`${tabId}:${pid}`];
  }

  function toggle(pid: string) {
    setLayout((prev) => {
      const key = `${tabId}:${pid}`;
      const next = {
        collapsed: Object.assign({}, prev.collapsed, { [key]: !prev.collapsed[key] }),
        order: prev.order,
      };
      saveLayout(next);
      return next;
    });
  }

  function onDragStart(pid: string, e: React.DragEvent<HTMLDivElement>) {
    // Only allow drag when initiated from the grip handle
    if (gripActiveRef.current !== pid) {
      e.preventDefault();
      return;
    }
    dragSrcRef.current = pid;
    e.dataTransfer.setData("text/plain", pid);
    e.dataTransfer.effectAllowed = "move";
    const el = e.currentTarget;
    requestAnimationFrame(() => {
      el.style.opacity = "0.35";
    });
  }

  function onDragEnd(e: React.DragEvent<HTMLDivElement>) {
    dragSrcRef.current = null;
    gripActiveRef.current = null;
    setDragOverId(null);
    e.currentTarget.style.opacity = "1";
  }

  function onDragOver(pid: string, e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragSrcRef.current !== pid) setDragOverId(pid);
  }

  function onDrop(toId: string, e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOverId(null);
    const fromId = e.dataTransfer.getData("text/plain");
    if (!fromId || fromId === toId) return;
    setLayout((prev) => {
      const cur = prev.order[tabId] || defaultOrder.slice();
      const arr = cur.filter((id) => defaultOrder.indexOf(id) >= 0);
      for (const id of defaultOrder) {
        if (arr.indexOf(id) < 0) arr.push(id);
      }
      const fi = arr.indexOf(fromId);
      const ti = arr.indexOf(toId);
      if (fi < 0 || ti < 0) return prev;
      arr.splice(fi, 1);
      arr.splice(ti, 0, fromId);
      const next = {
        collapsed: prev.collapsed,
        order: Object.assign({}, prev.order, { [tabId]: arr }),
      };
      saveLayout(next);
      return next;
    });
  }

  const items = ordered.map((p) => {
    const coll = isCollapsed(p.id);
    const cls =
      "yoke-slot" +
      (dragOverId === p.id ? " drop-target" : "") +
      (coll ? " slot-collapsed" : "") +
      (p.fullWidth ? " full-width" : "");

    return (
      <PanelContext.Provider
        key={p.id}
        value={{
          panelId: p.id,
          collapsed: coll,
          toggle: () => {
            toggle(p.id);
          },
          onGripMouseDown: () => {
            gripActiveRef.current = p.id;
          },
          onGripMouseUp: () => {
            gripActiveRef.current = null;
          },
        }}
      >
        <div
          className={cls}
          draggable={true}
          onDragStart={(e) => {
            onDragStart(p.id, e);
          }}
          onDragEnd={onDragEnd}
          onDragOver={(e) => {
            onDragOver(p.id, e);
          }}
          onDragLeave={() => {
            setDragOverId(null);
          }}
          onDrop={(e) => {
            onDrop(p.id, e);
          }}
        >
          {p.node}
        </div>
      </PanelContext.Provider>
    );
  });

  if (!grid) {
    return <div className="yoke-stack">{items}</div>;
  }

  // CSS columns give true masonry packing — each column fills
  // independently so panels pack densely without visual holes.
  return <div className="yoke-grid-masonry">{items}</div>;
}

// ─── ResetLayoutButton ───────────────────────────────────────────

export function ResetLayoutButton() {
  const [confirm, setConfirm] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function click() {
    if (confirm) {
      resetLayout();
      window.location.reload();
    } else {
      setConfirm(true);
      t.current = setTimeout(() => {
        setConfirm(false);
      }, 3000);
    }
  }
  useEffect(
    () => () => {
      if (t.current) clearTimeout(t.current);
    },
    [],
  );
  return (
    <button
      onClick={click}
      style={{
        color: "var(--dim)",
        background: "none",
        border: "none",
        cursor: "pointer",
        fontFamily: "var(--font-ui)",
        fontSize: "12px",
        padding: 0,
        transition: "color 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--dim)";
      }}
    >
      {confirm ? "Click again to confirm" : "Reset Layout"}
    </button>
  );
}
