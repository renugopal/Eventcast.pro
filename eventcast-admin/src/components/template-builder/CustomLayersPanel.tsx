'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Editor } from 'grapesjs';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  Layers,
  Lock,
  MousePointerClick,
  Square,
  Type,
  Unlock,
} from 'lucide-react';
import {
  FlatLayerRow,
  LayerNode,
  buildLayerTree,
  countLayerNodes,
  flattenLayerTree,
  getMultiSelectedCids,
  getSelectedLayerInfo,
  renameLayer,
  reorderLayerSiblings,
  selectLayer,
  toggleLayerLock,
  toggleLayerVisibility,
  findComponentByCid,
} from './layerPanelApi';

interface CustomLayersPanelProps {
  editor: Editor | null;
  className?: string;
}

function layerIcon(type: string, tagName: string, isGroup: boolean) {
  if (isGroup) return Boxes;
  const t = type.toLowerCase();
  const tag = tagName.toLowerCase();
  if (t === 'image' || tag === 'img') return ImageIcon;
  if (t === 'ec-countdown') return Clock;
  if (t === 'text' || ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a'].includes(tag)) return Type;
  return Square;
}

function collectExpandableCids(nodes: LayerNode[], acc = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.children.length > 0) {
      acc.add(node.cid);
      collectExpandableCids(node.children, acc);
    }
  }
  return acc;
}

interface LayerRowProps {
  row: FlatLayerRow;
  editingCid: string | null;
  onSelect: (cid: string, shiftKey: boolean) => void;
  onContextMenu: (cid: string, clientX: number, clientY: number) => void;
  onToggleExpand: (cid: string) => void;
  onToggleVisibility: (cid: string) => void;
  onToggleLock: (cid: string) => void;
  onStartRename: (cid: string) => void;
  onCommitRename: (cid: string, name: string) => void;
  onCancelRename: () => void;
  expanded: Set<string>;
  sortable?: {
    setNodeRef: (node: HTMLElement | null) => void;
    style: React.CSSProperties;
    dragHandleProps: Record<string, unknown>;
  };
}

function LayerRow({
  row,
  editingCid,
  onSelect,
  onContextMenu,
  onToggleExpand,
  onToggleVisibility,
  onToggleLock,
  onStartRename,
  onCommitRename,
  onCancelRename,
  expanded,
  sortable,
}: LayerRowProps) {
  const Icon = layerIcon(row.type, row.tagName, row.isGroup);
  const isEditing = editingCid === row.cid;
  const hasChildren = row.childCount > 0;
  const isExpanded = expanded.has(row.cid);
  const isHighlighted = row.selected || row.multiSelected;

  return (
    <div
      ref={sortable?.setNodeRef}
      style={sortable?.style}
      className={`group flex items-center gap-0.5 pr-1.5 py-[3px] rounded-md mx-1 cursor-pointer select-none transition-colors ${
        isHighlighted
          ? 'bg-indigo-500/20 ring-1 ring-inset ring-indigo-500/35'
          : 'hover:bg-zinc-800/80'
      } ${row.isGroup ? 'text-amber-200/90' : ''} ${!row.visible ? 'opacity-50' : ''}`}
      onClick={(e) => onSelect(row.cid, e.shiftKey)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(row.cid, e.clientX, e.clientY);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartRename(row.cid);
      }}
    >
      <div style={{ width: row.depth * 14 }} className="shrink-0" />

      <button
        type="button"
        className={`shrink-0 w-4 h-4 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-300 ${
          hasChildren ? 'visible' : 'invisible'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand(row.cid);
        }}
        title={isExpanded ? 'Collapse' : 'Expand'}
      >
        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {sortable ? (
        <button
          type="button"
          className="shrink-0 w-4 h-4 flex items-center justify-center text-zinc-600 hover:text-zinc-400 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
          {...sortable.dragHandleProps}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
        >
          <GripVertical className="w-3 h-3" />
        </button>
      ) : (
        <span className="shrink-0 w-4" />
      )}

      <Icon className={`w-3.5 h-3.5 shrink-0 ${row.isGroup ? 'text-amber-500/80' : 'text-zinc-500'}`} />

      {isEditing ? (
        <input
          autoFocus
          defaultValue={row.name}
          className="flex-1 min-w-0 mx-1 px-1.5 py-0.5 text-xs bg-zinc-800 border border-indigo-500/50 rounded text-zinc-100 outline-none ring-1 ring-indigo-500/30"
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => onCommitRename(row.cid, e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') onCommitRename(row.cid, (e.target as HTMLInputElement).value);
            if (e.key === 'Escape') onCancelRename();
          }}
        />
      ) : (
        <span
          className={`flex-1 min-w-0 mx-1 text-xs truncate ${
            isHighlighted ? 'text-zinc-100 font-medium' : 'text-zinc-300'
          }`}
          title={row.name}
        >
          {row.name}
        </span>
      )}

      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          className="w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/60"
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(row.cid);
          }}
          title={row.visible ? 'Hide layer' : 'Show layer'}
        >
          {row.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-zinc-600" />}
        </button>
        <button
          type="button"
          className={`w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-700/60 ${
            row.locked ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-200'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(row.cid);
          }}
          title={row.locked ? 'Unlock layer' : 'Lock layer'}
        >
          {row.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
        </button>
      </div>
    </div>
  );
}

function SortableLayerRow(props: Omit<LayerRowProps, 'sortable'>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.row.cid });

  return (
    <LayerRow
      {...props}
      sortable={{
        setNodeRef,
        style: {
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.45 : 1,
        },
        dragHandleProps: { ...attributes, ...listeners },
      }}
    />
  );
}

function EmptyCanvasState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="w-10 h-10 rounded-xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center mb-3">
        {filtered ? (
          <Layers className="w-4 h-4 text-zinc-600" />
        ) : (
          <MousePointerClick className="w-4 h-4 text-zinc-600" />
        )}
      </div>
      <p className="text-xs text-zinc-400 font-medium mb-1">
        {filtered ? 'No matching layers' : 'Canvas is empty'}
      </p>
      <p className="text-[10px] text-zinc-600 leading-relaxed max-w-[180px]">
        {filtered
          ? 'Try a different search term or clear the filter.'
          : 'Drag blocks from the right panel to start building your invitation.'}
      </p>
    </div>
  );
}

export function CustomLayersPanel({ editor, className = '' }: CustomLayersPanelProps) {
  const [tree, setTree] = useState<LayerNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingCid, setEditingCid] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [layerActions, setLayerActions] = useState({
    multiCount: 0,
    selectedIsGroup: false,
    canGroup: false,
    canUngroup: false,
  });

  const refreshTree = useCallback(() => {
    if (!editor) return;
    const selected = editor.getSelected();
    const selectedCid = selected?.cid ?? null;
    const multi = getMultiSelectedCids(editor);
    const next = buildLayerTree(editor, selectedCid, multi);
    setTree(next);
    setLayerActions(getSelectedLayerInfo(editor));
    setExpanded((prev) => {
      const all = collectExpandableCids(next);
      const merged = new Set(prev);
      all.forEach((cid) => {
        if (!merged.has(cid)) merged.add(cid);
      });
      return merged;
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    const events = [
      'component:add',
      'component:remove',
      'component:update',
      'component:styleUpdate',
      'component:selected',
      'component:deselected',
      'layer:reorder',
      'layer:group',
      'layer:ungroup',
      'multiselect:change',
      'load',
    ] as const;

    events.forEach((event) => editor.on(event, refreshTree));
    refreshTree();

    return () => {
      events.forEach((event) => editor.off(event, refreshTree));
    };
  }, [editor, refreshTree]);

  const totalLayerCount = useMemo(() => countLayerNodes(tree), [tree]);

  const flatRows = useMemo(() => {
    if (!tree.length) return [];
    const wrapper = editor?.DomComponents.getWrapper();
    if (!wrapper?.cid) return [];
    const rows = flattenLayerTree(tree, expanded, wrapper.cid);
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q));
  }, [tree, expanded, editor, search]);

  const sortableIds = useMemo(() => flatRows.map((r) => r.cid), [flatRows]);

  const activeDragRow = useMemo(
    () => flatRows.find((r) => r.cid === activeDragId) ?? null,
    [flatRows, activeDragId],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleSelect = useCallback(
    (cid: string, _shiftKey: boolean) => {
      if (!editor) return;
      selectLayer(editor, cid);
    },
    [editor],
  );

  const handleContextMenu = useCallback(
    (cid: string, clientX: number, clientY: number) => {
      if (!editor) return;
      const wrapper = editor.DomComponents.getWrapper() as any;
      const comp = findComponentByCid(wrapper, cid);
      if (!comp) return;
      (editor as any).ContextMenu?.showAt(clientX, clientY, comp);
    },
    [editor],
  );

  const handleGroup = useCallback(() => {
    editor?.runCommand('group-selection');
    refreshTree();
  }, [editor, refreshTree]);

  const handleUngroup = useCallback(() => {
    editor?.runCommand('ungroup-selection');
    refreshTree();
  }, [editor, refreshTree]);

  const handleToggleExpand = useCallback((cid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  }, []);

  const handleToggleVisibility = useCallback(
    (cid: string) => {
      if (!editor) return;
      const wrapper = editor.DomComponents.getWrapper() as any;
      const comp = findComponentByCid(wrapper, cid);
      if (!comp) return;
      toggleLayerVisibility(comp);
      refreshTree();
    },
    [editor, refreshTree],
  );

  const handleToggleLock = useCallback(
    (cid: string) => {
      if (!editor) return;
      const wrapper = editor.DomComponents.getWrapper() as any;
      const comp = findComponentByCid(wrapper, cid);
      if (!comp) return;
      toggleLayerLock(editor, comp);
      refreshTree();
    },
    [editor, refreshTree],
  );

  const handleCommitRename = useCallback(
    (cid: string, name: string) => {
      if (!editor) return;
      const wrapper = editor.DomComponents.getWrapper() as any;
      const comp = findComponentByCid(wrapper, cid);
      if (comp) renameLayer(comp, name);
      setEditingCid(null);
      refreshTree();
    },
    [editor, refreshTree],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      if (!editor) return;

      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeRow = flatRows.find((r) => r.cid === active.id);
      const overRow = flatRows.find((r) => r.cid === over.id);
      if (!activeRow || !overRow) return;
      if (activeRow.parentCid !== overRow.parentCid) return;

      reorderLayerSiblings(editor, activeRow.parentCid, activeRow.cid, overRow.cid);
      refreshTree();
    },
    [editor, flatRows, refreshTree],
  );

  if (!editor) {
    return (
      <aside
        className={`flex flex-col bg-[#1f1f23] border-r border-zinc-800 ${className}`}
        aria-label="Layers panel"
      >
        <div className="px-3 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2 text-zinc-500">
            <Layers className="w-3.5 h-3.5" />
            <span className="text-[10px] font-semibold uppercase tracking-widest">Layers</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-xs text-zinc-600 p-4">
          Loading editor…
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={`flex flex-col bg-[#1f1f23] border-r border-zinc-800 ${className}`}
      aria-label="Layers panel"
    >
      <div className="px-3 py-2.5 border-b border-zinc-800 shrink-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 text-zinc-400">
            <Layers className="w-3.5 h-3.5 text-amber-500/80" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Layers
            </span>
          </div>
          <span className="text-[10px] text-zinc-600 font-mono tabular-nums">
            {search.trim() ? `${flatRows.length}/${totalLayerCount}` : totalLayerCount}
          </span>
        </div>

        {(layerActions.canGroup || layerActions.canUngroup) && (
          <div className="flex items-center gap-1 mb-2">
            {layerActions.canGroup && (
              <button
                type="button"
                onClick={handleGroup}
                title="Group selected layers (Ctrl+G)"
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-semibold rounded-md bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25 hover:bg-amber-500/25 transition-colors"
              >
                <Boxes className="w-3 h-3" />
                Group {layerActions.multiCount}
              </button>
            )}
            {layerActions.canUngroup && (
              <button
                type="button"
                onClick={handleUngroup}
                title="Ungroup (Ctrl+Shift+G)"
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-semibold rounded-md bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700 hover:bg-zinc-700 transition-colors"
              >
                <Boxes className="w-3 h-3" />
                Ungroup
              </button>
            )}
          </div>
        )}

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter layers…"
          className="w-full px-2 py-1.5 text-xs bg-zinc-800/80 border border-zinc-700/80 rounded-md text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/25"
        />
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1.5 ec-layers-scroll">
        {flatRows.length === 0 ? (
          <EmptyCanvasState filtered={!!search.trim()} />
        ) : search.trim() ? (
          <div className="px-1">
            {flatRows.map((row) => (
              <LayerRow
                key={row.cid}
                row={row}
                editingCid={editingCid}
                expanded={expanded}
                onSelect={handleSelect}
                onContextMenu={handleContextMenu}
                onToggleExpand={handleToggleExpand}
                onToggleVisibility={handleToggleVisibility}
                onToggleLock={handleToggleLock}
                onStartRename={setEditingCid}
                onCommitRename={handleCommitRename}
                onCancelRename={() => setEditingCid(null)}
              />
            ))}
            <p className="px-2 py-2 text-[10px] text-zinc-600 text-center">
              Clear filter to reorder layers
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {flatRows.map((row) => (
                <SortableLayerRow
                  key={row.cid}
                  row={row}
                  editingCid={editingCid}
                  expanded={expanded}
                  onSelect={handleSelect}
                  onContextMenu={handleContextMenu}
                  onToggleExpand={handleToggleExpand}
                  onToggleVisibility={handleToggleVisibility}
                  onToggleLock={handleToggleLock}
                  onStartRename={setEditingCid}
                  onCommitRename={handleCommitRename}
                  onCancelRename={() => setEditingCid(null)}
                />
              ))}
            </SortableContext>

            <DragOverlay dropAnimation={null}>
              {activeDragRow ? (
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-zinc-800 border border-zinc-600 shadow-xl text-xs text-zinc-200">
                  <GripVertical className="w-3 h-3 text-zinc-500" />
                  {activeDragRow.name}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </aside>
  );
}
