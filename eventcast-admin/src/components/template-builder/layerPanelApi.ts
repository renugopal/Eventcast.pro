import type { Editor } from 'grapesjs';

export interface LayerNode {
  cid: string;
  name: string;
  type: string;
  tagName: string;
  locked: boolean;
  visible: boolean;
  selected: boolean;
  multiSelected: boolean;
  isGroup: boolean;
  zIndex: number;
  childCount: number;
  children: LayerNode[];
}

export interface FlatLayerRow extends LayerNode {
  parentCid: string;
  depth: number;
}

export type LayerComponent = {
  cid: string;
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  getStyle: () => Record<string, string>;
  addStyle: (style: Record<string, string>) => void;
  removeStyle: (prop: string) => void;
  addAttributes: (attrs: Record<string, string>) => void;
  removeAttributes: (key: string) => void;
  components: () => { models: LayerComponent[] };
};

type GjsComponent = LayerComponent;

const SKIP_TAGS = new Set(['textnode', 'script', 'style', 'meta', 'link', 'base']);

export function findComponentByCid(root: GjsComponent | null, cid: string): GjsComponent | null {
  if (!root) return null;
  if (root.cid === cid) return root;
  let found: GjsComponent | null = null;
  root.components().models.forEach((child) => {
    if (!found) found = findComponentByCid(child, cid);
  });
  return found;
}

export function getCompAttributes(comp: GjsComponent): Record<string, string> {
  const fn = (comp as { getAttributes?: () => Record<string, string> }).getAttributes;
  if (typeof fn === 'function') return fn.call(comp) || {};
  return (comp.get('attributes') as Record<string, string>) || {};
}

export function isGroupComponent(comp: GjsComponent): boolean {
  return getCompAttributes(comp)['data-group'] === 'true';
}

function isLayerComponent(comp: GjsComponent): boolean {
  const tag = String(comp.get('tagName') || '').toLowerCase();
  const type = String(comp.get('type') || '');
  if (SKIP_TAGS.has(tag)) return false;
  if (type === 'textnode') return false;
  if (comp.get('layerable') === false) return false;
  return true;
}

export function getLayerZIndex(comp: GjsComponent): number {
  const z = comp.getStyle()['z-index'];
  const parsed = parseInt(String(z ?? '0'), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function isLayerVisible(comp: GjsComponent): boolean {
  if (comp.get('visible') === false) return false;
  return comp.getStyle().display !== 'none';
}

export function isLayerLocked(comp: GjsComponent): boolean {
  return comp.get('locked') === true;
}

export function getLayerName(comp: GjsComponent): string {
  if (isGroupComponent(comp)) {
    const name = String(comp.get('name') || '').trim();
    return name || 'Group';
  }
  const name = String(comp.get('name') || '').trim();
  if (name) return name;
  const type = String(comp.get('type') || '');
  if (type && type !== 'default') return type;
  const tag = String(comp.get('tagName') || 'element');
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

function getSortedChildren(parent: GjsComponent): GjsComponent[] {
  const children = parent.components().models.filter(isLayerComponent);
  return [...children].sort((a, b) => {
    const dz = getLayerZIndex(b) - getLayerZIndex(a);
    if (dz !== 0) return dz;
    return children.indexOf(b) - children.indexOf(a);
  });
}

export function buildLayerTree(
  editor: Editor,
  selectedCid: string | null,
  multiSelectedCids: Set<string>,
): LayerNode[] {
  const wrapper = editor.DomComponents.getWrapper() as unknown as GjsComponent | null;
  if (!wrapper) return [];

  const mapComponent = (comp: GjsComponent): LayerNode => {
    const children = getSortedChildren(comp).map(mapComponent);
    return {
      cid: comp.cid,
      name: getLayerName(comp),
      type: String(comp.get('type') || 'default'),
      tagName: String(comp.get('tagName') || 'div'),
      locked: isLayerLocked(comp),
      visible: isLayerVisible(comp),
      selected: comp.cid === selectedCid,
      multiSelected: multiSelectedCids.has(comp.cid),
      isGroup: isGroupComponent(comp),
      zIndex: getLayerZIndex(comp),
      childCount: children.length,
      children,
    };
  };

  return getSortedChildren(wrapper).map(mapComponent);
}

export function countLayerNodes(nodes: LayerNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1;
    if (node.children.length > 0) total += countLayerNodes(node.children);
  }
  return total;
}

export function getSelectedLayerInfo(editor: Editor): {
  multiCount: number;
  selectedIsGroup: boolean;
  canGroup: boolean;
  canUngroup: boolean;
} {
  const multiCount = getMultiSelectedCids(editor).size;
  const selected = editor.getSelected() as unknown as GjsComponent | undefined;
  const selectedIsGroup = selected ? isGroupComponent(selected) : false;
  return {
    multiCount,
    selectedIsGroup,
    canGroup: multiCount >= 2,
    canUngroup: selectedIsGroup,
  };
}

export function flattenLayerTree(
  nodes: LayerNode[],
  expanded: Set<string>,
  parentCid: string,
  depth = 0,
): FlatLayerRow[] {
  const rows: FlatLayerRow[] = [];
  for (const node of nodes) {
    rows.push({ ...node, parentCid, depth });
    if (node.children.length > 0 && expanded.has(node.cid)) {
      rows.push(...flattenLayerTree(node.children, expanded, node.cid, depth + 1));
    }
  }
  return rows;
}

export function toggleLayerLock(editor: Editor, comp: GjsComponent): void {
  const locked = isLayerLocked(comp);
  const resizableOn = {
    ratioDefault: true,
    keepRatio: true,
    ratio: true,
    handles: ['tl', 'tr', 'bl', 'br'],
    step: 1,
    updateOnMove: true,
  };
  if (locked) {
    comp.set('locked', false);
    comp.set('draggable', true);
    comp.set('resizable', resizableOn);
    comp.set('editable', true);
    comp.removeAttributes('data-locked');
  } else {
    comp.set('locked', true);
    comp.set('draggable', false);
    comp.set('resizable', false);
    comp.set('editable', false);
    comp.addAttributes({ 'data-locked': 'true' });
    if (editor.getSelected()?.cid === comp.cid) {
      editor.select(null);
    }
  }
}

export function toggleLayerVisibility(comp: GjsComponent): void {
  const visible = isLayerVisible(comp);
  if (visible) {
    comp.set('visible', false);
    comp.addStyle({ display: 'none' });
  } else {
    comp.set('visible', true);
    comp.removeStyle('display');
  }
}

export function renameLayer(comp: GjsComponent, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  comp.set('name', trimmed);
}

export function reorderLayerSiblings(
  editor: Editor,
  parentCid: string,
  activeCid: string,
  overCid: string,
): void {
  const wrapper = editor.DomComponents.getWrapper() as unknown as GjsComponent;
  const parent =
    parentCid === wrapper.cid
      ? wrapper
      : findComponentByCid(wrapper, parentCid);
  if (!parent) return;

  const siblings = getSortedChildren(parent);
  const oldIndex = siblings.findIndex((c) => c.cid === activeCid);
  const newIndex = siblings.findIndex((c) => c.cid === overCid);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;

  const reordered = [...siblings];
  const [moved] = reordered.splice(oldIndex, 1);
  reordered.splice(newIndex, 0, moved);

  const count = reordered.length;
  reordered.forEach((comp, idx) => {
    comp.addStyle({ 'z-index': String(count - idx) });
  });

  editor.trigger('layer:reorder', { parentCid, activeCid, overCid });
}

export function getMultiSelectedCids(editor: Editor): Set<string> {
  const ms = (editor as any).MultiSelect;
  if (!ms?.getComponents) return new Set();
  return new Set(ms.getComponents().map((c: GjsComponent) => c.cid));
}

export function selectLayer(editor: Editor, cid: string): void {
  const wrapper = editor.DomComponents.getWrapper() as unknown as GjsComponent;
  const comp = findComponentByCid(wrapper, cid);
  if (!comp || isLayerLocked(comp)) return;
  editor.select(comp as any);
}
