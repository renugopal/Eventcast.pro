/**
 * Merges Eventcast custom Style Manager sectors/properties into GrapesJS defaults
 * (General, Dimension, Typography, Decorations, Flex) without replacing them.
 */

function getStyleManager(editorInst: any): any | null {
  const sm =
    editorInst?.StyleManager ??
    editorInst?.get?.('StyleManager') ??
    editorInst?.styleManager ??
    null;
  return sm && typeof sm.getSector === 'function' ? sm : null;
}

export function configureStyleManager(editorInst: any): boolean {
  const sm = getStyleManager(editorInst);
  if (!sm) return false;

  const findProp = (sector: any, property: string) => {
    const props = sector?.get?.('properties');
    if (!props?.models) return null;
    return props.models.find((p: any) => p.get('property') === property) ?? null;
  };

  const removeProp = (sector: any, property: string) => {
    const prop = findProp(sector, property);
    if (prop) sector.get('properties').remove(prop);
  };

  const addProp = (sectorId: string, prop: Record<string, unknown>, at?: number) => {
    const sector = sm.getSector(sectorId);
    if (!sector) return;
    const props = sector.get('properties');
    if (at !== undefined) props.add(prop, { at });
    else props.add(prop);
  };

  // ── Typography: swap font-family for Google Fonts picker ──────────────────
  const typo = sm.getSector('typography');
  if (typo) {
    removeProp(typo, 'font-family');
    addProp('typography', {
      name: 'Font Family',
      property: 'font-family',
      type: 'font-picker',
      defaults: 'inherit',
    }, 0);
  }

  // ── Dimension: ratio lock / reset row ─────────────────────────────────────
  addProp('dimension', {
    type: 'dimension-actions',
    name: ' ',
    property: 'dimension-actions-prop',
    full: true,
  });

  // ── Decorations: advanced shadow + blend mode ─────────────────────────────
  const deco = sm.getSector('decorations');
  if (deco) {
    removeProp(deco, 'box-shadow');
    addProp('decorations', {
      name: 'Box Shadow',
      property: 'box-shadow',
      type: 'advanced-shadow',
      full: true,
    });
    addProp('decorations', {
      name: 'Blend Mode',
      property: 'mix-blend-mode',
      type: 'blend-mode-picker',
      full: true,
    });
  }

  // ── Custom Eventcast sectors (append without removing defaults) ───────────
  if (!sm.getSector('text-gradient-sector')) {
    sm.addSector('text-gradient-sector', {
      name: 'Text Gradient',
      open: false,
      properties: [
        {
          name: 'Gradient Fill',
          property: 'text-gradient',
          type: 'text-gradient',
          full: true,
        },
      ],
    });
  }

  if (!sm.getSector('image-focus')) {
    sm.addSector('image-focus', {
      name: 'Image Focus',
      open: false,
      properties: [
        {
          name: 'Fit Mode',
          property: 'object-fit',
          type: 'object-fit-picker',
          full: true,
        },
        {
          name: 'Focal Point',
          property: 'object-position',
          type: 'image-focal-point',
          full: true,
        },
      ],
    });
  }

  if (!sm.getSector('entrance-animation-sector')) {
    sm.addSector('entrance-animation-sector', {
      name: 'Entrance Animation',
      open: false,
      properties: [
        {
          name: 'Animation',
          property: 'entrance-animation',
          type: 'entrance-animation',
          full: true,
        },
      ],
    });
  }

  sm.getSector('image-focus')?.set('visible', false);
  return true;
}

export function styleManagerConfigPlugin(editorInst: any): { cleanup: () => void } {
  let configured = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const run = () => {
    if (configured) return;
    if (configureStyleManager(editorInst)) configured = true;
  };

  const scheduleRetries = () => {
    [100, 400, 1200].forEach((ms) => {
      timers.push(setTimeout(run, ms));
    });
  };

  const onLoad = () => {
    run();
    scheduleRetries();
  };

  editorInst.on('load', onLoad);

  // Sibling plugins (proImageStyles, textGradient, etc.) register StyleManager types
  // synchronously; merge sectors now and retry on load if the manager isn't ready yet.
  run();
  if (!configured) scheduleRetries();

  return {
    cleanup() {
      timers.forEach(clearTimeout);
      editorInst.off('load', onLoad);
    },
  };
}
