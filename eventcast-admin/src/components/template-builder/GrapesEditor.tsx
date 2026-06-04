"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import grapesjs, { Editor } from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
import webpagePreset from 'grapesjs-preset-webpage';
import blocksBasic from 'grapesjs-blocks-basic';
import grapesjsRulers from 'grapesjs-rulers';
import grapesjsImageEditor from 'grapesjs-tui-image-editor';
import {
  Save, FolderOpen, Code, Undo2, Redo2,
  ZoomIn, ZoomOut, Monitor, Smartphone, Tablet,
  LayoutGrid, Eye
} from 'lucide-react';

export function GrapesEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      setSlug(params.get('slug'));
    }
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;

    const editor = grapesjs.init({
      container: editorRef.current,
      fromElement: true,
      height: '100%',
      width: '100%',
      dragMode: 'absolute',
      storageManager: false,
      plugins: [webpagePreset, blocksBasic, grapesjsRulers, grapesjsImageEditor],
      pluginsOpts: {
        [webpagePreset as any]: {},
        [blocksBasic as any]: {
          blocks: ['column1', 'column2', 'column3', 'column3-7', 'text', 'link', 'image', 'video', 'map'],
        },
        [grapesjsImageEditor as any]: {
          config: { includeUI: { initMenu: 'filter' } },
        },
      },

      // ─── Full Style Manager ───────────────────────────────────────────────
      styleManager: {
        sectors: [
          {
            name: 'Typography',
            open: true,
            properties: [
              {
                name: 'Font Family', property: 'font-family', type: 'select',
                defaults: 'inherit',
                options: [
                  { value: 'inherit', name: 'Default' },
                  { value: '"Cormorant Garamond", serif', name: 'Cormorant Garamond' },
                  { value: 'Marcellus, serif', name: 'Marcellus' },
                  { value: 'Inter, sans-serif', name: 'Inter' },
                  { value: 'Amiri, serif', name: 'Amiri' },
                  { value: 'Georgia, serif', name: 'Georgia' },
                  { value: 'Arial, sans-serif', name: 'Arial' },
                ],
              },
              { name: 'Font Size', property: 'font-size', type: 'integer', defaults: '14', units: ['px', 'rem', 'em', '%'] },
              {
                name: 'Font Weight', property: 'font-weight', type: 'select', defaults: '400',
                options: [
                  { value: '300', name: 'Light (300)' },
                  { value: '400', name: 'Normal (400)' },
                  { value: '500', name: 'Medium (500)' },
                  { value: '600', name: 'Semi Bold (600)' },
                  { value: '700', name: 'Bold (700)' },
                  { value: '800', name: 'Extra Bold (800)' },
                ],
              },
              { name: 'Color', property: 'color', type: 'color' },
              {
                name: 'Text Align', property: 'text-align', type: 'radio', defaults: 'left',
                options: [
                  { value: 'left', name: 'Left', className: 'fa fa-align-left' },
                  { value: 'center', name: 'Center', className: 'fa fa-align-center' },
                  { value: 'right', name: 'Right', className: 'fa fa-align-right' },
                  { value: 'justify', name: 'Justify', className: 'fa fa-align-justify' },
                ],
              },
              { name: 'Letter Spacing', property: 'letter-spacing', type: 'integer', defaults: '0', units: ['px', 'em'] },
              { name: 'Line Height', property: 'line-height', type: 'integer', defaults: '1.2', units: ['', 'px', 'em'] },
              { name: 'Text Transform', property: 'text-transform', type: 'select', defaults: 'none',
                options: [
                  { value: 'none', name: 'None' },
                  { value: 'uppercase', name: 'UPPERCASE' },
                  { value: 'lowercase', name: 'lowercase' },
                  { value: 'capitalize', name: 'Capitalize' },
                ]
              },
            ],
          },
          {
            name: 'Dimension',
            open: false,
            properties: [
              { name: 'Width', property: 'width', type: 'integer', units: ['px', '%', 'vw', 'auto'] },
              { name: 'Height', property: 'height', type: 'integer', units: ['px', '%', 'vh', 'auto'] },
              { name: 'Min Width', property: 'min-width', type: 'integer', units: ['px', '%'] },
              { name: 'Max Width', property: 'max-width', type: 'integer', units: ['px', '%'] },
              { name: 'Min Height', property: 'min-height', type: 'integer', units: ['px', '%'] },
              'padding',
              'margin',
            ],
          },
          {
            name: 'Position',
            open: false,
            properties: [
              {
                name: 'Position', property: 'position', type: 'select',
                options: [
                  { value: 'static' }, { value: 'relative' }, { value: 'absolute' }, { value: 'fixed' }, { value: 'sticky' },
                ],
              },
              { name: 'Top', property: 'top', type: 'integer', units: ['px', '%'] },
              { name: 'Right', property: 'right', type: 'integer', units: ['px', '%'] },
              { name: 'Bottom', property: 'bottom', type: 'integer', units: ['px', '%'] },
              { name: 'Left', property: 'left', type: 'integer', units: ['px', '%'] },
              { name: 'Z-Index', property: 'z-index', type: 'integer' },
            ],
          },
          {
            name: 'Decorations',
            open: false,
            properties: [
              { name: 'Background Color', property: 'background-color', type: 'color' },
              { name: 'Border Radius', property: 'border-radius', type: 'integer', units: ['px', '%'] },
              {
                name: 'Border', property: 'border', type: 'composite',
                properties: [
                  { name: 'Width', property: 'border-width', type: 'integer', units: ['px'] },
                  {
                    name: 'Style', property: 'border-style', type: 'select',
                    options: [{ value: 'none' }, { value: 'solid' }, { value: 'dashed' }, { value: 'dotted' }, { value: 'double' }],
                  },
                  { name: 'Color', property: 'border-color', type: 'color' },
                ],
              },
              { name: 'Box Shadow', property: 'box-shadow', type: 'shadow' },
              { name: 'Opacity', property: 'opacity', type: 'slider', defaults: 1, step: 0.01, max: 1, min: 0 },
              {
                name: 'Overflow', property: 'overflow', type: 'select',
                options: [{ value: 'visible' }, { value: 'hidden' }, { value: 'scroll' }, { value: 'auto' }],
              },
            ],
          },
          {
            name: 'Flex / Layout',
            open: false,
            properties: [
              {
                name: 'Display', property: 'display', type: 'select',
                options: [{ value: 'block' }, { value: 'flex' }, { value: 'inline-block' }, { value: 'none' }],
              },
              {
                name: 'Flex Direction', property: 'flex-direction', type: 'select',
                options: [{ value: 'row' }, { value: 'column' }, { value: 'row-reverse' }, { value: 'column-reverse' }],
              },
              {
                name: 'Justify Content', property: 'justify-content', type: 'select',
                options: [{ value: 'flex-start' }, { value: 'center' }, { value: 'flex-end' }, { value: 'space-between' }, { value: 'space-around' }],
              },
              {
                name: 'Align Items', property: 'align-items', type: 'select',
                options: [{ value: 'flex-start' }, { value: 'center' }, { value: 'flex-end' }, { value: 'stretch' }],
              },
              { name: 'Gap', property: 'gap', type: 'integer', units: ['px', 'rem'] },
            ],
          },
        ],
      },

      // ─── Device Manager ───────────────────────────────────────────────────
      deviceManager: {
        devices: [
          { name: 'Desktop', width: '' },
          { name: 'Tablet', width: '768px', widthMedia: '992px' },
          { name: 'Mobile', width: '390px', widthMedia: '480px' },
        ],
      },
    });

    setEditorInstance(editor);

    // ─── Track selection state ─────────────────────────────────────────
    editor.on('component:selected', () => setHasSelection(true));
    editor.on('component:deselected', () => setHasSelection(false));

    // ─── Alignment Commands ─────────────────────────────────────────
    const getAlignInfo = () => {
      const selected = editor.getSelected();
      if (!selected) return null;
      const el = selected.getEl();
      if (!el) return null;
      const iframeWin = (editor.Canvas.getFrameEl() as HTMLIFrameElement)?.contentWindow as Window & typeof globalThis;
      if (!iframeWin) return null;
      const computed = iframeWin.getComputedStyle(el);
      const elWidth = parseFloat(computed.width) || (el as HTMLElement).offsetWidth;
      const parentEl = el.parentElement;
      const parentWidth = parentEl
        ? parseFloat(iframeWin.getComputedStyle(parentEl).width) || (parentEl as HTMLElement).offsetWidth
        : 480;
      return { selected, elWidth, parentWidth };
    };

    editor.Commands.add('align-left', {
      run(ed) {
        const info = getAlignInfo();
        if (info) info.selected.addStyle({ left: '0px', position: 'absolute' });
      },
    });

    editor.Commands.add('align-center', {
      run(ed) {
        const info = getAlignInfo();
        if (!info) return;
        const leftVal = Math.round((info.parentWidth - info.elWidth) / 2);
        info.selected.addStyle({ left: `${leftVal}px`, position: 'absolute' });
      },
    });

    editor.Commands.add('align-right', {
      run(ed) {
        const info = getAlignInfo();
        if (!info) return;
        const leftVal = Math.round(info.parentWidth - info.elWidth);
        info.selected.addStyle({ left: `${leftVal}px`, position: 'absolute' });
      },
    });

    // ─── Track Undo/Redo state ────────────────────────────────────────────
    const updateUndoRedo = () => {
      setCanUndo(editor.UndoManager.hasUndo());
      setCanRedo(editor.UndoManager.hasRedo());
    };
    editor.on('component:add component:remove component:update style:add style:update', updateUndoRedo);
    editor.on('undo redo', updateUndoRedo);

    // ─── Helper: snapshot computed styles as inline (iframe-aware) ──────────
    // DISABLED: This was converting percentage-based positions (top: 44.5%) into
    // pixel values (top: 487px) which broke mobile responsiveness and caused
    // alignment issues every time an element was selected in the editor.
    // Elements are positioned using % in CSS which correctly scales on all devices.
    const snapshotInlineStyles = (_model: any) => {
      // Intentionally no-op — do NOT snapshot computed px values over CSS % positions
    };

    // ─── Universal Resize on selection ───────────────────────────────────────
    editor.on('component:selected', (model) => {
      // Always enable full resize handles
      model.set('resizable', {
        handles: ['tl', 'tr', 'bl', 'br', 'tc', 'bc', 'cl', 'cr'],
        step: 1,
        updateTarget: (el: HTMLElement, rect: any) => {
          el.style.width = `${rect.w}px`;
          el.style.height = `${rect.h}px`;
        },
      });

      // Snapshot computed -> inline so resize handles can read & update dimensions
      snapshotInlineStyles(model);

      // Add alignment buttons to component floating toolbar
      const toolbar: any[] = model.get('toolbar') || [];
      if (!toolbar.some((t: any) => t.command === 'align-center')) {
        toolbar.unshift(
          {
            attributes: { class: 'fa fa-align-right', title: 'Align Right' },
            command: 'align-right',
          },
          {
            attributes: { class: 'fa fa-align-center', title: 'Align Center (Page)' },
            command: 'align-center',
          },
          {
            attributes: { class: 'fa fa-align-left', title: 'Align Left' },
            command: 'align-left',
          },
          {
            attributes: { class: 'fa fa-minus', title: 'Separator', style: 'pointer-events:none;opacity:0.3' },
            command: '',
          }
        );
        model.set('toolbar', toolbar);
      }
    });

    // ─── Load template after editor initializes ───────────────────────────
    editor.on('load', () => {
      const params = new URLSearchParams(window.location.search);
      const slugParam = params.get('slug');
      if (!slugParam) return;

      // Inject CSS fixes into iframe
      try {
        const iframeBody = editor.Canvas.getBody();
        if (iframeBody?.ownerDocument) {
          const iframeDoc = iframeBody.ownerDocument;
          const iframeHead = iframeDoc.head;

          // Remove old base tag if exists
          const existingBase = iframeHead.querySelector('base');
          if (existingBase) iframeHead.removeChild(existingBase);

          const base = iframeDoc.createElement('base');
          base.href = `/api/local-sync/assets/${slugParam}/`;
          iframeHead.appendChild(base);

          // FontAwesome
          const faLink = iframeDoc.createElement('link');
          faLink.rel = 'stylesheet';
          faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
          iframeHead.appendChild(faLink);

          // Google Fonts
          const gfLink = iframeDoc.createElement('link');
          gfLink.rel = 'stylesheet';
          gfLink.href = 'https://fonts.googleapis.com/css2?family=Amiri:ital@0;1&family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Marcellus&family=Inter:wght@300;400;500;600&display=swap';
          iframeHead.appendChild(gfLink);

          // FIX: Neutralize flex centering offset that causes element jumping
          const fixStyle = iframeDoc.createElement('style');
          fixStyle.id = 'gjs-editor-fixes';
          fixStyle.textContent = `
            .app-container { justify-content: flex-start !important; padding: 0 !important; }
            .invitation-card { margin: 0 !important; }
            #loader { display: none !important; }
          `;
          iframeHead.appendChild(fixStyle);
        }
      } catch (e) {
        console.error('Error setting up iframe:', e);
      }

      // Fetch and load template
      fetch(`/api/local-sync?slug=${slugParam}`)
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            alert(`Error loading template: ${data.error}`);
            return;
          }
          if (data.html) {
            editor.setComponents(data.html);
          }
          if (data.css) {
            // Load FULL CSS into GrapesJS so it manages and saves it correctly
            editor.setStyle(data.css);
          }

          // After a short delay (for DOM to paint), snapshot all absolutely
          // positioned elements with inline styles so resize works immediately
          setTimeout(() => {
            try {
              editor.Components.getWrapper()?.find('[style*="position"], .details-card, .countdown-card, .calendar-btn-wrapper, .hero-content > *').forEach((model: any) => {
                snapshotInlineStyles(model);
                // Ensure all components are resizable
                model.set('resizable', {
                  handles: ['tl', 'tr', 'bl', 'br', 'tc', 'bc', 'cl', 'cr'],
                  step: 1,
                });
              });
            } catch (e) { /* ignore */ }
          }, 800);
        })
        .catch(err => {
          console.error('Error loading template:', err);
          alert('Failed to load template files. Check if dev server is running.');
        });
    });

    // ─── Keyboard shortcut: Ctrl+S to Save ───────────────────────────────
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveLocalRef.current?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      editor.destroy();
    };
  }, []);

  // ─── Save Handler ─────────────────────────────────────────────────────────
  const handleSaveLocalRef = useRef<(() => void) | null>(null);

  const handleSaveLocal = useCallback(async () => {
    if (!editorInstance) return;
    setSaving(true);

    const params = new URLSearchParams(window.location.search);
    const slugParam = params.get('slug');

    if (slugParam) {
      const html = editorInstance.getHtml();
      // Get ALL CSS that GrapesJS manages (includes the full loaded stylesheet)
      const css = editorInstance.getCss({ avoidProtected: false } as any);

      try {
        const res = await fetch('/api/local-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: slugParam, html, css }),
        });
        const data = await res.json();
        if (data.success) {
          // Show a non-blocking success toast
          showToast('✅ Template saved successfully!', 'success');
        } else {
          showToast('❌ Save failed: ' + (data.error || 'Unknown error'), 'error');
        }
      } catch (err: any) {
        showToast('❌ Save error: ' + err.message, 'error');
      }
    } else {
      // No slug — download as JSON
      const projectData = editorInstance.getProjectData();
      const blob = new Blob([JSON.stringify(projectData)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `eventcast-template-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    setSaving(false);
  }, [editorInstance]);

  // Keep ref in sync so keyboard shortcut can access latest version
  useEffect(() => {
    handleSaveLocalRef.current = handleSaveLocal;
  }, [handleSaveLocal]);

  // ─── Toast notification ───────────────────────────────────────────────────
  const showToast = (message: string, type: 'success' | 'error') => {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;
      color: white; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      background: ${type === 'success' ? '#10b981' : '#ef4444'};
      transition: opacity 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; }, 2500);
    setTimeout(() => { toast.remove(); }, 3000);
  };

  // ─── Load (JSON) Handler ──────────────────────────────────────────────────
  const handleLoadLocal = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editorInstance) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const projectData = JSON.parse(event.target?.result as string);
        editorInstance.loadProjectData(projectData);
        showToast('✅ Template loaded!', 'success');
      } catch {
        showToast('❌ Invalid JSON file', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ─── Export Code Handler ──────────────────────────────────────────────────
  const handleExportCode = () => {
    if (!editorInstance) return;
    const html = editorInstance.getHtml();
    const css = editorInstance.getCss({ avoidProtected: false } as any);
    const output = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://fonts.googleapis.com/css2?family=Amiri:ital@0;1&family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Marcellus&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>${css}</style>
</head>
<body>
  ${html}
  <script src="script.js"></script>
</body>
</html>`;
    const blob = new Blob([output], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `exported-template-${Date.now()}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ─── Zoom Handlers ────────────────────────────────────────────────────────
  const handleZoomIn = () => {
    const newZoom = Math.min(zoom + 10, 200);
    setZoom(newZoom);
    editorInstance?.Canvas.setZoom(newZoom);
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(zoom - 10, 30);
    setZoom(newZoom);
    editorInstance?.Canvas.setZoom(newZoom);
  };

  // ─── Device Handlers ──────────────────────────────────────────────────────
  const handleDevice = (d: 'desktop' | 'tablet' | 'mobile') => {
    setDevice(d);
    if (!editorInstance) return;
    const deviceMap = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };
    editorInstance.setDevice(deviceMap[d]);
  };

  // ─── Undo / Redo ──────────────────────────────────────────────────────────
  const handleUndo = () => editorInstance?.UndoManager.undo();
  const handleRedo = () => editorInstance?.UndoManager.redo();

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] w-full overflow-hidden bg-white">

      {/* ── Top Toolbar ─────────────────────────────────────────────────── */}
      <div className="h-12 bg-gray-900 flex items-center justify-between px-3 text-white shrink-0 gap-2 border-b border-gray-700">

        {/* Left: Studio name */}
        <div className="text-xs font-semibold tracking-widest text-amber-400 whitespace-nowrap">
          ✦ EVENTCAST STUDIO {slug ? `· ${slug.toUpperCase()}` : ''}
        </div>

        {/* Center: Main controls */}
        <div className="flex items-center gap-1">

          {/* Undo / Redo */}
          <button onClick={handleUndo} disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className={`p-1.5 rounded transition-colors ${canUndo ? 'hover:bg-gray-700 text-white' : 'text-gray-600 cursor-not-allowed'}`}>
            <Undo2 className="w-4 h-4" />
          </button>
          <button onClick={handleRedo} disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className={`p-1.5 rounded transition-colors ${canRedo ? 'hover:bg-gray-700 text-white' : 'text-gray-600 cursor-not-allowed'}`}>
            <Redo2 className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-gray-700 mx-1" />

          {/* Alignment — active only when element is selected */}
          <div className="flex items-center gap-0.5" title={!hasSelection ? 'Select an element to align' : ''}>
            <button
              onClick={() => editorInstance?.runCommand('align-left')}
              disabled={!hasSelection}
              title="Align Left (to parent)"
              className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
                hasSelection ? 'hover:bg-gray-700 text-white' : 'text-gray-600 cursor-not-allowed'
              }`}>
              ⇐ Left
            </button>
            <button
              onClick={() => editorInstance?.runCommand('align-center')}
              disabled={!hasSelection}
              title="Center horizontally on page"
              className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
                hasSelection ? 'hover:bg-amber-600 bg-amber-700 text-white' : 'text-gray-600 cursor-not-allowed'
              }`}>
              ⊕ Center
            </button>
            <button
              onClick={() => editorInstance?.runCommand('align-right')}
              disabled={!hasSelection}
              title="Align Right (to parent)"
              className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
                hasSelection ? 'hover:bg-gray-700 text-white' : 'text-gray-600 cursor-not-allowed'
              }`}>
              Right ⇒
            </button>
          </div>

          <div className="w-px h-6 bg-gray-700 mx-1" />

          {/* Device Preview */}
          <button onClick={() => handleDevice('desktop')}
            title="Desktop view"
            className={`p-1.5 rounded transition-colors ${device === 'desktop' ? 'bg-amber-500 text-gray-900' : 'hover:bg-gray-700 text-gray-300'}`}>
            <Monitor className="w-4 h-4" />
          </button>
          <button onClick={() => handleDevice('tablet')}
            title="Tablet view"
            className={`p-1.5 rounded transition-colors ${device === 'tablet' ? 'bg-amber-500 text-gray-900' : 'hover:bg-gray-700 text-gray-300'}`}>
            <Tablet className="w-4 h-4" />
          </button>
          <button onClick={() => handleDevice('mobile')}
            title="Mobile view"
            className={`p-1.5 rounded transition-colors ${device === 'mobile' ? 'bg-amber-500 text-gray-900' : 'hover:bg-gray-700 text-gray-300'}`}>
            <Smartphone className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-gray-700 mx-1" />

          {/* Zoom */}
          <button onClick={handleZoomOut} title="Zoom Out" className="p-1.5 hover:bg-gray-700 rounded transition-colors">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-400 w-10 text-center">{zoom}%</span>
          <button onClick={handleZoomIn} title="Zoom In" className="p-1.5 hover:bg-gray-700 rounded transition-colors">
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>


        {/* Right: File operations */}
        <div className="flex items-center gap-2">
          <button onClick={handleExportCode}
            title="Export HTML/CSS"
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors">
            <Code className="w-3.5 h-3.5" /> Export
          </button>

          <label className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-xs transition-colors cursor-pointer">
            <FolderOpen className="w-3.5 h-3.5" /> Open JSON
            <input type="file" accept=".json" className="hidden" onChange={handleLoadLocal} />
          </label>

          <button onClick={handleSaveLocal} disabled={saving}
            title="Save Template (Ctrl+S)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
              saving ? 'bg-gray-600 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500'
            }`}>
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save (Ctrl+S)'}
          </button>
        </div>
      </div>

      {/* ── GrapesJS Canvas ─────────────────────────────────────────────── */}
      <div className="flex-1 w-full relative overflow-hidden">
        <div ref={editorRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
