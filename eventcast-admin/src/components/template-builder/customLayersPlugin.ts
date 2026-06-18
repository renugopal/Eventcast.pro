import type { Editor } from 'grapesjs';
import {
  findComponentByCid,
  renameLayer,
  reorderLayerSiblings,
  toggleLayerLock,
  toggleLayerVisibility,
  type LayerComponent,
} from './layerPanelApi';

export function customLayersPlugin(editorInst: Editor): { cleanup: () => void } {
  const hideDefaultLayerManager = () => {
    try {
      editorInst.Panels.removeButton('views', 'open-layers');
    } catch {
      /* button may not exist yet */
    }
  };

  editorInst.on('load', hideDefaultLayerManager);
  setTimeout(hideDefaultLayerManager, 500);

  const getComp = (cid: string): LayerComponent | null => {
    const wrapper = editorInst.DomComponents.getWrapper() as unknown as LayerComponent;
    return findComponentByCid(wrapper, cid);
  };

  (editorInst as any).CustomLayers = {
    toggleLock(cid: string) {
      const comp = getComp(cid);
      if (!comp) return;
      toggleLayerLock(editorInst, comp);
    },
    toggleVisibility(cid: string) {
      const comp = getComp(cid);
      if (!comp) return;
      toggleLayerVisibility(comp);
    },
    rename(cid: string, name: string) {
      const comp = getComp(cid);
      if (!comp) return;
      renameLayer(comp, name);
    },
    reorder(parentCid: string, activeCid: string, overCid: string) {
      reorderLayerSiblings(editorInst, parentCid, activeCid, overCid);
    },
  };

  return {
    cleanup() {
      delete (editorInst as any).CustomLayers;
    },
  };
}
