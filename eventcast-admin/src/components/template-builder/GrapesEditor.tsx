"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import grapesjs, { Editor } from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
import webpagePreset from 'grapesjs-preset-webpage';
import blocksBasic from 'grapesjs-blocks-basic';
import grapesjsImageEditor from 'grapesjs-tui-image-editor';
import {
  Save, FolderOpen, Code, Undo2, Redo2,
  ZoomIn, ZoomOut, Monitor, Smartphone, Tablet,
  Eye,
} from 'lucide-react';

import { countdownTimerPlugin } from './countdownTimerPlugin';
import { customLayersPlugin } from './customLayersPlugin';
import { CustomLayersPanel } from './CustomLayersPanel';
import { proImageStylesPlugin } from './proImageStylesPlugin';
import {
  safeGetSelected,
  getBuilderTemplateRef,
  hasBuilderTemplateTarget,
  buildSyncQuery,
  buildSyncPayload,
  getBuilderUploadFormFields,
  type BuilderTemplateRef,
} from './editorUtils';
import { styleManagerConfigPlugin } from './styleManagerConfigPlugin';
import { dimensionPlugin } from './dimensionPlugin';
import {
  alignSelectedHorizontal,
  findDropTarget,
  getDeviceManagerConfig,
  getDeviceProfile,
  syncCanvasFrameDimensions,
  fixCanvasFrameCentering,
  setupEditorWorkspace,
  cleanupEditorWorkspace,
} from './editorWorkspace';
import { bootstrapTemplateCanvas, cleanupHeroLayerInteraction, nudgeComponentPosition, runWithoutUndo } from './templateCanvasBootstrap';
import { ensurePetalLayoutInStylesheet } from './petalLayoutStyles';
import {
  applyLoadedTemplateAssetResolution,
  finalizeProjectLoadAssets,
  injectIframeAssetBase,
  isPlaceholderImageSrc,
  normalizeProjectDataAssetUrls,
  rewriteStylesheetAssetUrls,
  syncAllImageComponentSrcForSave,
  syncDroppedImageComponent,
} from './templateIframeAssets';
import { setupLayerPipelineDebug } from './layerPipelineDebug';

// ─── Sprint 8: Premium Dark Theme (Webflow / Figma / VS Code aesthetic) ──────
const STUDIO_DARK = {
  bg:           '#202024',
  bgCanvas:     '#252528',
  bgElevated:   '#2a2a2e',
  bgSurface:    '#323238',
  bgHover:      '#45454d',
  bgActive:     '#52525b',
  border:       '#45454d',
  borderSubtle: '#35353b',
  text:         '#fafafa',
  textSecondary:'#e4e4e7',
  textMuted:    '#a1a1aa',
  textDim:      '#71717a',
  accent:       '#f59e0b',
  accentBright: '#fbbf24',
  focus:        '#6366f1',
  focusSoft:    '#818cf8',
  cyan:         '#22d3ee',
  success:      '#10b981',
  danger:       '#ef4444',
} as const;

function getPremiumDarkThemeCSS(): string {
  const c = STUDIO_DARK;
  return `
    /* ── GrapesJS design tokens (scoped to studio shell) ─────────────── */
    .ec-studio-dark .gjs-editor {
      --gjs-main-color: ${c.bg};
      --gjs-primary-color: ${c.bgElevated};
      --gjs-secondary-color: ${c.bgSurface};
      --gjs-tertiary-color: ${c.focus};
      --gjs-quaternary-color: ${c.focusSoft};
      --gjs-font-color: ${c.textMuted};
      --gjs-font-color-active: ${c.text};
      --gjs-main-dark-color: rgba(0, 0, 0, 0.35);
      --gjs-secondary-dark-color: rgba(0, 0, 0, 0.2);
      --gjs-main-light-color: rgba(255, 255, 255, 0.06);
      --gjs-secondary-light-color: rgba(255, 255, 255, 0.72);
      --gjs-soft-light-color: rgba(255, 255, 255, 0.03);
      --gjs-light-border: rgba(255, 255, 255, 0.08);
      --gjs-arrow-color: rgba(255, 255, 255, 0.5);
      --gjs-color-highlight: ${c.accent};
      --gjs-color-blue: ${c.focus};
      --gjs-color-green: ${c.success};
      --gjs-color-red: ${c.danger};
      --gjs-color-yellow: ${c.accentBright};
      --gjs-color-warn: ${c.accentBright};
      --gjs-placeholder-background-color: ${c.bgSurface};
      --gjs-main-font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --gjs-font-size: 12px;
      background: ${c.bg} !important;
      color: ${c.textMuted};
      font-family: var(--gjs-main-font);
    }

    .ec-studio-dark .gjs-editor-cont,
    .ec-studio-dark .gjs-cv-canvas {
      background-color: ${c.bgCanvas} !important;
      background-image:
        radial-gradient(circle at 1px 1px, ${c.borderSubtle} 1px, transparent 0) !important;
      background-size: 20px 20px !important;
    }
    .ec-studio-dark .gjs-frame-wrapper {
      box-shadow:
        0 0 0 1px ${c.border},
        0 20px 50px rgba(0, 0, 0, 0.45) !important;
      border-radius: 2px !important;
      margin: 0 auto !important;
    }
    .ec-studio-dark .gjs-cv-canvas__frames {
      margin-left: auto !important;
      margin-right: auto !important;
    }
    .ec-studio-dark .gjs-cv-canvas .ec-smart-guides-host {
      z-index: 999999 !important;
      pointer-events: none !important;
      overflow: visible !important;
    }
    .ec-studio-dark .gjs-pn-commands {
      background: ${c.bgElevated} !important;
      border-color: ${c.borderSubtle} !important;
    }
    /* Device switcher lives in Eventcast top toolbar — hide GrapesJS duplicate */
    .ec-studio-dark .gjs-pn-devices-c {
      display: none !important;
    }
    /* Built-in GrapesJS preview ≠ Guest Preview — hide duplicate */
    .ec-studio-dark .gjs-pn-options .gjs-pn-btn[data-id="preview"],
    .ec-studio-dark .gjs-pn-btn[data-id="preview"] {
      display: none !important;
    }
    /* Rulers plugin removed */
    .ec-studio-dark .gr-guides,
    .ec-studio-dark .gr-guide,
    .ec-studio-dark .gjs-ruler,
    .ec-studio-dark .gjs-ruler-wrapper,
    .ec-studio-dark [class*="gjs-ruler"] {
      display: none !important;
    }
    .ec-studio-dark .gjs-pn-commands {
      border-right: 1px solid ${c.borderSubtle} !important;
    }
    .ec-studio-dark .gjs-pn-views-container {
      border-left: 1px solid ${c.borderSubtle} !important;
    }

    /* ── Top command bar ───────────────────────────────────────────── */
    .ec-studio-dark .gjs-pn-panels {
      background: ${c.bg} !important;
      border-bottom: 1px solid ${c.borderSubtle} !important;
      box-shadow: 0 1px 0 rgba(255,255,255,0.04);
    }
    .ec-studio-dark .gjs-pn-panel {
      background: transparent !important;
      border: none !important;
    }
    .ec-studio-dark .gjs-pn-btn {
      color: ${c.textMuted} !important;
      border-radius: 6px !important;
      margin: 2px !important;
      min-height: 28px !important;
      transition: background 0.15s, color 0.15s !important;
    }
    .ec-studio-dark .gjs-pn-btn:hover {
      background: ${c.bgHover} !important;
      color: ${c.text} !important;
      box-shadow: none !important;
    }
    .ec-studio-dark .gjs-pn-active {
      background: ${c.bgSurface} !important;
      color: ${c.text} !important;
      box-shadow: inset 0 0 0 1px ${c.border} !important;
    }

    /* ── Side panels (blocks / layers / styles) ──────────────────────── */
    .ec-studio-dark .gjs-pn-views-container,
    .ec-studio-dark .gjs-pn-views {
      background: ${c.bgElevated} !important;
      border-color: ${c.borderSubtle} !important;
    }
    .ec-studio-dark .gjs-pn-views .gjs-pn-btn {
      border-bottom: 2px solid transparent !important;
      border-radius: 0 !important;
    }
    .ec-studio-dark .gjs-pn-views .gjs-pn-active {
      border-bottom-color: ${c.accent} !important;
      background: transparent !important;
      box-shadow: none !important;
      color: ${c.text} !important;
    }

    .ec-studio-dark .gjs-blocks-c,
    /* ── Sprint 10+17: Hide default layer manager (custom React panel) ── */
    .ec-studio-dark .gjs-layer-manager {
      display: none !important;
    }

    .ec-studio-dark .gjs-sm-sectors,
    .ec-studio-dark .gjs-traits-c,
    .ec-studio-dark .gjs-clm-tags {
      background: ${c.bgElevated} !important;
    }

    .ec-studio-dark .gjs-block {
      background: ${c.bgSurface} !important;
      border: 1px solid ${c.borderSubtle} !important;
      border-radius: 8px !important;
      box-shadow: 0 1px 2px rgba(0,0,0,0.2) !important;
      transition: border-color 0.15s, transform 0.12s !important;
    }
    .ec-studio-dark .gjs-block:hover {
      border-color: ${c.border} !important;
      transform: translateY(-1px);
    }
    .ec-studio-dark .gjs-block-label {
      color: ${c.textSecondary} !important;
      font-size: 11px !important;
      font-weight: 500 !important;
    }

    /* ── Layer manager ───────────────────────────────────────────────── */
    .ec-studio-dark .gjs-layer {
      border-bottom: 1px solid ${c.borderSubtle} !important;
      background: transparent !important;
    }
    .ec-studio-dark .gjs-layer:hover {
      background: ${c.bgSurface} !important;
    }
    .ec-studio-dark .gjs-layer.gjs-selected,
    .ec-studio-dark .gjs-layer.gjs-hovered {
      background: ${c.bgHover} !important;
    }
    .ec-studio-dark .gjs-layer-title {
      color: ${c.textSecondary} !important;
      font-weight: 500 !important;
    }
    .ec-studio-dark .gjs-layer.gjs-selected .gjs-layer-title {
      color: ${c.text} !important;
    }
    .ec-studio-dark .gjs-layer__t-wrapper {
      border-color: ${c.borderSubtle} !important;
    }

    /* ── Style manager ───────────────────────────────────────────────── */
    .ec-studio-dark .gjs-sm-sector {
      border-bottom: 1px solid ${c.borderSubtle} !important;
    }
    .ec-studio-dark .gjs-sm-sector-title {
      background: ${c.bgElevated} !important;
      color: ${c.textMuted} !important;
      font-size: 10px !important;
      font-weight: 600 !important;
      letter-spacing: 0.06em !important;
      text-transform: uppercase !important;
      border-bottom: 1px solid ${c.borderSubtle} !important;
      padding: 10px 12px !important;
    }
    .ec-studio-dark .gjs-sm-sector-title:hover {
      color: ${c.text} !important;
      background: ${c.bgSurface} !important;
    }
    .ec-studio-dark .gjs-sm-properties {
      background: ${c.bgElevated} !important;
      padding: 8px 10px !important;
    }
    .ec-studio-dark .gjs-sm-label {
      color: ${c.textDim} !important;
      font-size: 10px !important;
      font-weight: 500 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.04em !important;
    }
    .ec-studio-dark .gjs-field,
    .ec-studio-dark .gjs-field input,
    .ec-studio-dark .gjs-field select,
    .ec-studio-dark .gjs-select,
    .ec-studio-dark .gjs-input-holder input {
      background: ${c.bgSurface} !important;
      border: 1px solid ${c.borderSubtle} !important;
      border-radius: 6px !important;
      color: ${c.text} !important;
      font-size: 12px !important;
    }
    .ec-studio-dark .gjs-field input:focus,
    .ec-studio-dark .gjs-field select:focus {
      border-color: ${c.focus} !important;
      outline: none !important;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25) !important;
    }
    .ec-studio-dark .gjs-radio-item label,
    .ec-studio-dark .gjs-check-item label {
      color: ${c.textMuted} !important;
      border-radius: 6px !important;
    }
    .ec-studio-dark .gjs-radio-item input:checked + label,
    .ec-studio-dark .gjs-check-item input:checked + label {
      background: ${c.bgHover} !important;
      color: ${c.text} !important;
      box-shadow: inset 0 0 0 1px ${c.border} !important;
    }
    .ec-studio-dark .gjs-clm-tag {
      background: ${c.bgSurface} !important;
      border: 1px solid ${c.borderSubtle} !important;
      border-radius: 6px !important;
      color: ${c.textSecondary} !important;
    }

    /* ── Asset manager ───────────────────────────────────────────────── */
    .ec-studio-dark .gjs-am-assets {
      background: ${c.bgElevated} !important;
    }
    .ec-studio-dark .gjs-am-asset {
      border: 1px solid ${c.borderSubtle} !important;
      border-radius: 8px !important;
    }
    .ec-studio-dark .gjs-am-preview-cont {
      background: ${c.bgSurface} !important;
    }
    .ec-studio-dark .gjs-am-add-asset button,
    .ec-studio-dark .gjs-am-file-uploader {
      background: ${c.bgSurface} !important;
      border: 1px dashed ${c.border} !important;
      border-radius: 8px !important;
      color: ${c.textMuted} !important;
    }

    /* ── Canvas toolbar & badges ─────────────────────────────────────── */
    .ec-studio-dark .gjs-toolbar {
      background: ${c.bgElevated} !important;
      border: 1px solid ${c.border} !important;
      border-radius: 8px !important;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45) !important;
      overflow: hidden !important;
    }
    .ec-studio-dark .gjs-toolbar-item {
      color: ${c.textMuted} !important;
      border-right: 1px solid ${c.borderSubtle} !important;
    }
    .ec-studio-dark .gjs-toolbar-item:hover {
      background: ${c.bgHover} !important;
      color: ${c.text} !important;
    }
    .ec-studio-dark .gjs-badge {
      background: ${c.focus} !important;
      color: ${c.text} !important;
      border-radius: 4px !important;
      font-weight: 600 !important;
    }
    .ec-studio-dark .gjs-com-badge,
    .ec-studio-dark .gjs-com-badge-red {
      background: ${c.bgElevated} !important;
      border: 1px solid ${c.border} !important;
      color: ${c.textSecondary} !important;
      border-radius: 6px !important;
    }

    /* ── RTE toolbar ─────────────────────────────────────────────────── */
    .ec-studio-dark .gjs-rte-toolbar {
      background: ${c.bgElevated} !important;
      border: 1px solid ${c.border} !important;
      border-radius: 8px !important;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4) !important;
    }
    .ec-studio-dark .gjs-rte-action {
      color: ${c.textMuted} !important;
      border-radius: 4px !important;
    }
    .ec-studio-dark .gjs-rte-action:hover {
      background: ${c.bgHover} !important;
      color: ${c.text} !important;
    }
    .ec-studio-dark .gjs-rte-active {
      background: ${c.bgSurface} !important;
      color: ${c.accentBright} !important;
    }

    /* ── Modals & code editor ────────────────────────────────────────── */
    .ec-studio-dark .gjs-mdl-dialog {
      background: ${c.bgElevated} !important;
      border: 1px solid ${c.border} !important;
      border-radius: 12px !important;
      box-shadow: 0 24px 64px rgba(0,0,0,0.55) !important;
      color: ${c.text} !important;
    }
    .ec-studio-dark .gjs-mdl-header {
      border-bottom: 1px solid ${c.borderSubtle} !important;
      background: ${c.bg} !important;
      border-radius: 12px 12px 0 0 !important;
    }
    .ec-studio-dark .gjs-mdl-title {
      color: ${c.text} !important;
      font-weight: 600 !important;
    }
    .ec-studio-dark .gjs-mdl-btn-close {
      color: ${c.textDim} !important;
    }
    .ec-studio-dark .CodeMirror {
      background: ${c.bgSurface} !important;
      color: ${c.textSecondary} !important;
      border: 1px solid ${c.borderSubtle} !important;
      border-radius: 8px !important;
    }
    .ec-studio-dark .CodeMirror-gutters {
      background: ${c.bgElevated} !important;
      border-right: 1px solid ${c.borderSubtle} !important;
    }

    /* ── Resizers & selection chrome ─────────────────────────────────── */
    .ec-studio-dark .gjs-resizer-h {
      border-color: ${c.accent} !important;
    }
    .ec-studio-dark .gjs-highlighter,
    .ec-studio-dark .gjs-highlighter-sel {
      outline-color: ${c.focus} !important;
    }

    /* ── Custom studio panels (variables, etc.) ──────────────────────── */
    .ec-studio-dark #gjs-variables-panel {
      background: ${c.bgElevated} !important;
      border-left: 1px solid ${c.borderSubtle} !important;
      box-shadow: -12px 0 40px rgba(0,0,0,0.35) !important;
    }

    /* ── Premium scrollbars ──────────────────────────────────────────── */
    .ec-studio-dark ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    .ec-studio-dark ::-webkit-scrollbar-track {
      background: ${c.bg};
    }
    .ec-studio-dark ::-webkit-scrollbar-thumb {
      background: ${c.bgHover};
      border-radius: 4px;
      border: 2px solid ${c.bg};
    }
    .ec-studio-dark ::-webkit-scrollbar-thumb:hover {
      background: ${c.bgActive};
    }

    /* ── Dimension lock buttons (custom plugin) ──────────────────────── */
    .ec-studio-dark #btn-ratio-lock,
    .ec-studio-dark #btn-size-reset {
      border-color: ${c.border} !important;
      border-radius: 6px !important;
    }
    .ec-studio-dark #btn-size-reset {
      background: ${c.bgSurface} !important;
      color: ${c.textMuted} !important;
    }

    /* ── Sprint 9: Guest Preview Mode ─────────────────────────────────── */
    .ec-studio-dark.ec-guest-preview-active {
      position: fixed !important;
      inset: 0 !important;
      z-index: 9990 !important;
      height: 100vh !important;
      width: 100vw !important;
    }
    .ec-studio-dark.ec-guest-preview-active .ec-studio-toolbar {
      display: none !important;
    }
    .ec-studio-dark.ec-guest-preview-active .ec-studio-canvas-host {
      height: 100% !important;
      flex: 1 !important;
    }
    .ec-studio-dark.ec-guest-preview-active .gjs-pn-panels,
    .ec-studio-dark.ec-guest-preview-active .gjs-pn-views-container,
    .ec-studio-dark.ec-guest-preview-active .gjs-pn-views,
    .ec-studio-dark.ec-guest-preview-active .gjs-pn-commands,
    .ec-studio-dark.ec-guest-preview-active .gjs-pn-devices-c {
      display: none !important;
    }
    .ec-studio-dark.ec-guest-preview-active .gjs-editor {
      height: 100% !important;
    }
    .ec-studio-dark.ec-guest-preview-active .gjs-editor-cont,
    .ec-studio-dark.ec-guest-preview-active .gjs-cv-canvas {
      background-color: #09090b !important;
      background-image: none !important;
    }
    .ec-studio-dark.ec-guest-preview-active .gjs-frame-wrapper {
      box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 24px 64px rgba(0,0,0,0.55) !important;
    }
    .ec-gjs-guest-preview .gjs-cv-canvas {
      width: 100% !important;
    }
  `;
}

function injectPremiumDarkTheme(): void {
  if (document.getElementById('ec-studio-dark-css')) return;
  const style = document.createElement('style');
  style.id = 'ec-studio-dark-css';
  style.textContent = getPremiumDarkThemeCSS();
  document.head.appendChild(style);
}

function premiumDarkThemePlugin(editorInst: any): { cleanup: () => void } {
  injectPremiumDarkTheme();
  editorInst.on('load', () => {
    editorInst.getEl()?.classList.add('ec-gjs-themed');
  });
  return {
    cleanup() {
      document.getElementById('ec-studio-dark-css')?.remove();
    },
  };
}

// ─── GrapesJS Custom Plugin: Photoshop-Style Smart Guides ────────────────────
function smartGuidesPlugin(editorInst: any) {
  const SNAP_DIST = 8;
  let svgOverlay: SVGSVGElement | null = null;
  let isDragging = false;

  /** Host-document overlay — avoids iframe stacking / overflow clipping. */
  const getCanvasElement = (): HTMLElement | null => {
    try {
      return (editorInst.Canvas.getElement?.() ?? editorInst.getEl?.()?.querySelector('.gjs-cv-canvas')) as HTMLElement | null;
    } catch { return null; }
  };

  const getOrCreateOverlay = (): SVGSVGElement | null => {
    try {
      const canvasEl = getCanvasElement();
      if (!canvasEl) return null;

      let host = canvasEl.querySelector('.ec-smart-guides-host') as HTMLElement | null;
      if (!host) {
        host = document.createElement('div');
        host.className = 'ec-smart-guides-host';
        host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:999999;overflow:visible;';
        canvasEl.appendChild(host);
      }

      let svg = host.querySelector('#smart-guides-overlay') as SVGSVGElement | null;
      if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'smart-guides-overlay';
        svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;';
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        host.appendChild(svg);
      }
      return svg;
    } catch { return null; }
  };

  const clearGuides = () => { if (svgOverlay) svgOverlay.innerHTML = ''; };

  const drawLine = (x1: number, y1: number, x2: number, y2: number, color = '#e8368f') => {
    if (!svgOverlay) return;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x1)); line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', color); line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '4 3'); line.setAttribute('opacity', '0.9');
    svgOverlay.appendChild(line);
  };

  const drawMeasurement = (x1: number, y1: number, x2: number, y2: number, value: number) => {
    if (!svgOverlay || value < 1) return;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    
    // Draw solid pink line for measurement (#e8368f, 1.5px)
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x1)); line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', '#e8368f'); 
    line.setAttribute('stroke-width', '1.5');
    svgOverlay.appendChild(line);

    // Draw pink pill badge background
    const textStr = `${Math.round(value)}px`;
    const textW = textStr.length * 6.5 + 8; // More accurate text width estimation
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('fill', '#e8368f');
    rect.setAttribute('rx', '8'); // Pill shape
    rect.setAttribute('ry', '8');
    rect.setAttribute('x', String(cx - textW / 2));
    rect.setAttribute('y', String(cy - 7));
    rect.setAttribute('width', String(textW));
    rect.setAttribute('height', '14');
    svgOverlay.appendChild(rect);

    // Draw white text on top
    const textNode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textNode.setAttribute('x', String(cx));
    textNode.setAttribute('y', String(cy + 4)); // Vertical center alignment
    textNode.setAttribute('fill', '#ffffff');
    textNode.setAttribute('font-size', '10px');
    textNode.setAttribute('font-family', 'sans-serif');
    textNode.setAttribute('font-weight', 'bold');
    textNode.setAttribute('text-anchor', 'middle');
    textNode.textContent = textStr;
    svgOverlay.appendChild(textNode);
  };

  const getRectIframe = (comp: any) => {
    try {
      const el = comp.getEl() as HTMLElement | null;
      if (!el) return null;
      return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    } catch { return null; }
  };

  const iframeToCanvas = (ix: number, iy: number) => {
    const frameEl = editorInst.Canvas.getFrameEl() as HTMLIFrameElement;
    const canvasEl = getCanvasElement();
    if (!frameEl || !canvasEl) return { x: ix, y: iy };
    const zoom = (editorInst.Canvas.getZoom?.() ?? 100) / 100;
    const frameRect = frameEl.getBoundingClientRect();
    const canvasRect = canvasEl.getBoundingClientRect();
    return {
      x: frameRect.left - canvasRect.left + ix * zoom,
      y: frameRect.top - canvasRect.top + iy * zoom,
    };
  };

  const drawIframeLine = (ix1: number, iy1: number, ix2: number, iy2: number, color = '#e8368f') => {
    const p1 = iframeToCanvas(ix1, iy1);
    const p2 = iframeToCanvas(ix2, iy2);
    drawLine(p1.x, p1.y, p2.x, p2.y, color);
  };

  const drawIframeMeasurement = (ix1: number, iy1: number, ix2: number, iy2: number, value: number) => {
    const p1 = iframeToCanvas(ix1, iy1);
    const p2 = iframeToCanvas(ix2, iy2);
    drawMeasurement(p1.x, p1.y, p2.x, p2.y, value);
  };

  const trySnap = (val: number, target: number) => {
    return Math.abs(val - target) <= SNAP_DIST ? { snapped: true, val: target } : { snapped: false, val };
  };

  const onDrag = (component: any) => {
    if (!isDragging) return;
    // Skip smart guides during resize — the snap addStyle() calls would
    // override the position values dimensionPlugin sets during resize:update.
    try {
      if ((editorInst as any).Commands?.isActive?.('resize')) return;
    } catch { /* ignore */ }
    svgOverlay = getOrCreateOverlay();
    clearGuides();
    if (!svgOverlay) return;

    const dragRect = getRectIframe(component);
    if (!dragRect) return;

    const body = editorInst.Canvas.getBody() as HTMLElement;
    const parentEl = (component.getEl() as HTMLElement)?.parentElement;
    const wrapperEl = body?.querySelector('.app-container, .invitation-card, body > div:first-child') || body;
    const pageW = Math.max(parentEl?.offsetWidth || 0, wrapperEl?.offsetWidth || 0, body?.offsetWidth || 480);
    const pageH = Math.max(parentEl?.offsetHeight || 0, wrapperEl?.offsetHeight || 0, body?.offsetHeight || 800);

    const dragCX = dragRect.x + dragRect.w / 2;
    const dragCY = dragRect.y + dragRect.h / 2;
    const dragR  = dragRect.x + dragRect.w;
    const dragB  = dragRect.y + dragRect.h;

    const styleUpdates: Record<string, string> = {};
    const refs = { x: [0, pageW / 2, pageW], y: [0, pageH / 2, pageH] };

    const comps: any[] = editorInst.DomComponents.getWrapper()?.find('*') || [];
    comps.forEach((sibling: any) => {
      if (sibling === component) return;
      const r = getRectIframe(sibling);
      if (!r) return;
      refs.x.push(r.x, r.x + r.w / 2, r.x + r.w);
      refs.y.push(r.y, r.y + r.h / 2, r.y + r.h);
    });

    refs.y.forEach((refY) => {
      const t = trySnap(dragRect.y, refY);
      if (t.snapped) { styleUpdates.top = `${t.val}px`; drawIframeLine(0, refY, pageW, refY); }
      if (trySnap(dragCY, refY).snapped) drawIframeLine(0, refY, pageW, refY);
      const b = trySnap(dragB, refY);
      if (b.snapped) { styleUpdates.top = `${refY - dragRect.h}px`; drawIframeLine(0, refY, pageW, refY); }
    });

    refs.x.forEach((refX) => {
      const l = trySnap(dragRect.x, refX);
      if (l.snapped) { styleUpdates.left = `${l.val}px`; drawIframeLine(refX, 0, refX, pageH); }
      if (trySnap(dragCX, refX).snapped) drawIframeLine(refX, 0, refX, pageH);
      const r = trySnap(dragR, refX);
      if (r.snapped) { styleUpdates.left = `${refX - dragRect.w}px`; drawIframeLine(refX, 0, refX, pageH); }
    });

    if (Object.keys(styleUpdates).length > 0) {
      // Wrap in runWithoutUndo — snapping fires many times per drag and each
      // addStyle() call would create an undo entry. Snap positions are cosmetic;
      // the final drag position (set by GrapesJS Dragger) is what matters.
      runWithoutUndo(editorInst, () => component.addStyle(styleUpdates, { partial: true }));
    }

    const currentX = parseInt(styleUpdates.left || String(dragRect.x), 10);
    const currentY = parseInt(styleUpdates.top || String(dragRect.y), 10);

    let closestTop = { gap: Infinity, y: 0 };
    let closestBottom = { gap: Infinity, y: pageH };
    let closestLeft = { gap: Infinity, x: 0 };
    let closestRight = { gap: Infinity, x: pageW };

    comps.forEach((sibling: any) => {
      if (sibling === component) return;
      const r = getRectIframe(sibling);
      if (!r) return;
      if (r.y + r.h <= currentY) {
        const gap = currentY - (r.y + r.h);
        if (gap < closestTop.gap) closestTop = { gap, y: r.y + r.h };
      }
      if (r.y >= currentY + dragRect.h) {
        const gap = r.y - (currentY + dragRect.h);
        if (gap < closestBottom.gap) closestBottom = { gap, y: r.y };
      }
      if (r.x + r.w <= currentX) {
        const gap = currentX - (r.x + r.w);
        if (gap < closestLeft.gap) closestLeft = { gap, x: r.x + r.w };
      }
      if (r.x >= currentX + dragRect.w) {
        const gap = r.x - (currentX + dragRect.w);
        if (gap < closestRight.gap) closestRight = { gap, x: r.x };
      }
    });

    const cx = currentX + dragRect.w / 2;
    const cy = currentY + dragRect.h / 2;

    if (closestTop.gap !== Infinity && closestTop.gap > 0) {
      drawIframeMeasurement(cx, closestTop.y, cx, currentY, closestTop.gap);
    } else if (currentY > 0) {
      drawIframeMeasurement(cx, 0, cx, currentY, currentY);
    }

    if (closestBottom.gap !== Infinity && closestBottom.gap > 0) {
      drawIframeMeasurement(cx, currentY + dragRect.h, cx, closestBottom.y, closestBottom.gap);
    } else if (currentY + dragRect.h < pageH) {
      drawIframeMeasurement(cx, currentY + dragRect.h, cx, pageH, pageH - (currentY + dragRect.h));
    }

    if (closestLeft.gap !== Infinity && closestLeft.gap > 0) {
      drawIframeMeasurement(closestLeft.x, cy, currentX, cy, closestLeft.gap);
    } else if (currentX > 0) {
      drawIframeMeasurement(0, cy, currentX, cy, currentX);
    }

    if (closestRight.gap !== Infinity && closestRight.gap > 0) {
      drawIframeMeasurement(currentX + dragRect.w, cy, closestRight.x, cy, closestRight.gap);
    } else if (currentX + dragRect.w < pageW) {
      drawIframeMeasurement(currentX + dragRect.w, cy, pageW, cy, pageW - (currentX + dragRect.w));
    }
  };

  editorInst.on('component:drag:start', () => { isDragging = true; svgOverlay = getOrCreateOverlay(); });
  editorInst.on('component:drag', onDrag);
  editorInst.on('component:drag:end', () => { isDragging = false; clearGuides(); });
}

// ─── Sprint 4: Google Fonts Picker ───────────────────────────────────────────
//
// Replaces the static font-family <select> in the Style Manager with a
// searchable, live-previewing Google Fonts picker.
//
// How it works:
//   1. A curated list of ~40 Google Fonts is hardcoded — no API key needed.
//   2. All preview fonts are batch-loaded into the host document in a single
//      <link> request when the plugin initialises.
//   3. The custom StyleManager type "font-picker" renders a compact button
//      (showing the current font in its own typeface) that opens a floating
//      dropdown with a search box and a scrollable font list.
//   4. On selection the chosen font is applied to the selected component via
//      addStyle() AND injected into the canvas iframe so the live preview
//      updates immediately.
//   5. On template load, all font-family values already stored in project
//      styles are re-injected into the canvas iframe automatically.
//
function googleFontsPlugin(editorInst: any) {
  // ── Curated font catalogue ────────────────────────────────────────────────
  const FONTS: { name: string; family: string }[] = [
    // Elegant Serif
    { name: 'Cormorant Garamond', family: '"Cormorant Garamond", serif'       },
    { name: 'Playfair Display',   family: '"Playfair Display", serif'         },
    { name: 'EB Garamond',        family: '"EB Garamond", serif'              },
    { name: 'Lora',               family: 'Lora, serif'                       },
    { name: 'Merriweather',       family: 'Merriweather, serif'               },
    { name: 'Crimson Text',       family: '"Crimson Text", serif'             },
    { name: 'Libre Baskerville',  family: '"Libre Baskerville", serif'        },
    { name: 'Gloock',             family: 'Gloock, serif'                     },
    { name: 'Instrument Serif',   family: '"Instrument Serif", serif'         },
    { name: 'Spectral',           family: 'Spectral, serif'                   },
    { name: 'Vollkorn',           family: 'Vollkorn, serif'                   },
    // Display
    { name: 'Cinzel',             family: 'Cinzel, serif'                     },
    { name: 'Marcellus',          family: 'Marcellus, serif'                  },
    { name: 'Josefin Slab',       family: '"Josefin Slab", serif'             },
    { name: 'Cormorant',          family: 'Cormorant, serif'                  },
    // Calligraphy / Script
    { name: 'Great Vibes',        family: '"Great Vibes", cursive'            },
    { name: 'Parisienne',         family: 'Parisienne, cursive'               },
    { name: 'Dancing Script',     family: '"Dancing Script", cursive'         },
    { name: 'Sacramento',         family: 'Sacramento, cursive'               },
    { name: 'Pinyon Script',      family: '"Pinyon Script", cursive'          },
    { name: 'Petit Formal Script',family: '"Petit Formal Script", cursive'    },
    { name: 'Allura',             family: 'Allura, cursive'                   },
    { name: 'Alex Brush',         family: '"Alex Brush", cursive'             },
    { name: 'Italianno',          family: 'Italianno, cursive'                },
    { name: 'Tangerine',          family: 'Tangerine, cursive'                },
    // Modern Sans-Serif
    { name: 'Inter',              family: 'Inter, sans-serif'                 },
    { name: 'Plus Jakarta Sans',  family: '"Plus Jakarta Sans", sans-serif'   },
    { name: 'DM Sans',            family: '"DM Sans", sans-serif'             },
    { name: 'Outfit',             family: 'Outfit, sans-serif'                },
    { name: 'Manrope',            family: 'Manrope, sans-serif'               },
    { name: 'Figtree',            family: 'Figtree, sans-serif'               },
    { name: 'Poppins',            family: 'Poppins, sans-serif'               },
    { name: 'Montserrat',         family: 'Montserrat, sans-serif'            },
    { name: 'Raleway',            family: 'Raleway, sans-serif'               },
    { name: 'Nunito',             family: 'Nunito, sans-serif'                },
    { name: 'Josefin Sans',       family: '"Josefin Sans", sans-serif'        },
    { name: 'Quicksand',          family: 'Quicksand, sans-serif'             },
    // Arabic / Multilingual
    { name: 'Amiri',              family: 'Amiri, serif'                      },
    { name: 'Scheherazade New',   family: '"Scheherazade New", serif'         },
    { name: 'Noto Naskh Arabic',  family: '"Noto Naskh Arabic", serif'        },
  ];

  // ── Batch-load preview fonts into the host document ───────────────────────
  // One request delivers all 40 fonts for rendering in the picker UI.
  const PREVIEW_LINK_ID = 'gjs-gf-preview-fonts';
  if (!document.getElementById(PREVIEW_LINK_ID)) {
    const families = FONTS.map(f => `family=${encodeURIComponent(f.name)}`).join('&');
    const link = document.createElement('link');
    link.id    = PREVIEW_LINK_ID;
    link.rel   = 'stylesheet';
    link.href  = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    document.head.appendChild(link);
  }

  // ── Inject a single font into the canvas iframe head ─────────────────────
  const injectFontIntoCanvas = (fontName: string) => {
    try {
      const iframeHead = editorInst.Canvas.getBody()?.ownerDocument?.head;
      if (!iframeHead) return;
      const linkId = `gjs-gf-canvas-${fontName.replace(/\s+/g, '-').toLowerCase()}`;
      if (iframeHead.querySelector(`#${linkId}`)) return; // already injected
      const link = document.createElement('link');
      link.id   = linkId;
      link.rel  = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:ital,wght@0,300;0,400;0,600;0,700;1,400&display=swap`;
      iframeHead.appendChild(link);
    } catch { /* ignore if iframe not ready */ }
  };

  // ── Match a CSS font-family value back to our catalogue ───────────────────
  const findFont = (value: string) =>
    FONTS.find(f => value && value.toLowerCase().includes(f.name.toLowerCase()));

  // ── Register the custom StyleManager type ────────────────────────────────
  editorInst.StyleManager.addType('font-picker', {

    create() {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'width:100%;position:relative;';

      // Button that shows the current font
      const btn = document.createElement('button');
      btn.style.cssText = `
        width:100%; padding:7px 10px; border-radius:5px;
        background:#27272a; border:1px solid #3f3f5a; color:#fafafa;
        cursor:pointer; text-align:left; font-size:13px;
        display:flex; align-items:center; justify-content:space-between; gap:4px;
        transition: border-color .15s;
      `;

      const fontLabel = document.createElement('span');
      fontLabel.textContent = 'Default';

      const arrow = document.createElement('span');
      arrow.textContent = '▾';
      arrow.style.cssText = 'opacity:.5;font-size:10px;';

      btn.appendChild(fontLabel);
      btn.appendChild(arrow);
      wrap.appendChild(btn);

      // Live preview strip below the button
      const preview = document.createElement('div');
      preview.textContent = 'Aa — The quick brown fox';
      preview.style.cssText = `
        padding:6px 2px; font-size:18px; color:#e4e4e7; line-height:1;
        min-height:28px; transition: font-family .2s;
      `;
      wrap.appendChild(preview);

      // ── Floating dropdown ──────────────────────────────────────────────
      let dropEl: HTMLElement | null = null;
      let outsideHandler: ((e: MouseEvent) => void) | null = null;

      const closeDropdown = () => {
        dropEl?.remove();
        dropEl = null;
        if (outsideHandler) {
          document.removeEventListener('mousedown', outsideHandler);
          outsideHandler = null;
        }
      };

      const setFont = (font: { name: string; family: string } | null, cssValue?: string) => {
        const family   = font?.family ?? cssValue ?? 'inherit';
        const label    = font?.name   ?? (cssValue && cssValue !== 'inherit' ? cssValue : 'Default');
        fontLabel.textContent  = label;
        fontLabel.style.fontFamily = family;
        preview.textContent    = `${label} — Aa Bb Cc`;
        preview.style.fontFamily = family;
        btn.style.borderColor  = font ? '#818cf8' : '#3f3f5a';
        if (font) injectFontIntoCanvas(font.name);
      };

      const openDropdown = () => {
        closeDropdown();

        dropEl = document.createElement('div');
        Object.assign(dropEl.style, {
          position:     'fixed',
          zIndex:       '2147483647',
          background:   '#1f1f23',
          border:       '1px solid #3f3f46',
          borderRadius: '8px',
          padding:      '6px',
          width:        '260px',
          maxHeight:    '360px',
          display:      'flex',
          flexDirection:'column',
          boxShadow:    '0 16px 48px rgba(0,0,0,0.7)',
          fontFamily:   "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        });

        // Search input
        const search = document.createElement('input');
        search.placeholder = '🔍  Search fonts…';
        search.style.cssText = `
          width:100%; padding:7px 10px; border-radius:5px; box-sizing:border-box;
          background:#27272a; border:1px solid #3f3f46; color:#fafafa;
          font-size:12px; outline:none; margin-bottom:4px;
        `;
        dropEl.appendChild(search);

        // Scrollable font list
        const list = document.createElement('div');
        list.style.cssText = 'overflow-y:auto; flex:1; overscroll-behavior:contain;';

        const renderList = (query: string) => {
          list.innerHTML = '';
          const filtered = query
            ? FONTS.filter(f => f.name.toLowerCase().includes(query.toLowerCase()))
            : FONTS;

          // "Default / Inherit" item at the top
          const defaultRow = document.createElement('button');
          defaultRow.textContent = '— Default (inherit)';
          applyRowStyle(defaultRow, false);
          defaultRow.addEventListener('mousedown', (e) => {
            e.preventDefault();
            editorInst.getSelected()?.addStyle({ 'font-family': 'inherit' });
            setFont(null, 'inherit');
            closeDropdown();
          });
          list.appendChild(defaultRow);

          filtered.forEach(font => {
            const row = document.createElement('button');
            row.textContent  = font.name;
            row.style.fontFamily = font.family;
            const isCurrent = fontLabel.textContent === font.name;
            applyRowStyle(row, isCurrent);

            row.addEventListener('mouseenter', () => {
              preview.textContent    = `${font.name} — Aa Bb Cc`;
              preview.style.fontFamily = font.family;
              injectFontIntoCanvas(font.name);
            });
            row.addEventListener('mouseleave', () => {
              // restore to current selection preview
              const cur = findFont(fontLabel.style.fontFamily ?? '');
              preview.textContent = cur
                ? `${cur.name} — Aa Bb Cc`
                : 'Aa Bb Cc';
            });
            row.addEventListener('mousedown', (e) => {
              e.preventDefault();
              editorInst.getSelected()?.addStyle({ 'font-family': font.family });
              setFont(font);
              closeDropdown();
            });
            list.appendChild(row);
          });
        };

        renderList('');
        search.addEventListener('input', () => renderList(search.value));
        dropEl.appendChild(list);
        document.body.appendChild(dropEl);

        // Position below the button
        const btnRect = btn.getBoundingClientRect();
        let top  = btnRect.bottom + 4;
        let left = btnRect.left;
        // Clamp to viewport
        if (left + 260 > window.innerWidth)  left = window.innerWidth - 268;
        if (top + 360  > window.innerHeight) top  = btnRect.top - 364;
        dropEl.style.top  = `${top}px`;
        dropEl.style.left = `${left}px`;

        setTimeout(() => search.focus(), 0);

        outsideHandler = (e: MouseEvent) => {
          if (!dropEl?.contains(e.target as Node) && e.target !== btn) closeDropdown();
        };
        // Slight delay so the click that opened the dropdown doesn't immediately close it
        setTimeout(() => document.addEventListener('mousedown', outsideHandler!), 10);
      };

      btn.addEventListener('click', () => {
        if (dropEl) closeDropdown();
        else        openDropdown();
      });

      // Sync when a new component is selected (StyleManager calls update() too, but
      // this makes the preview strip update proactively)
      editorInst.on('component:deselected', () => setFont(null, 'inherit'));

      // Store close reference so destroy() can clean up any open dropdown
      (wrap as any).__closeDropdown = closeDropdown;

      return wrap;
    },

    // GrapesJS calls update() every time the property value changes externally
    // (selecting a new component, undo/redo, etc.)
    update({ value, el }: any) {
      if (!value) return;
      const font    = findFont(value);
      const label   = font?.name ?? (value !== 'inherit' ? value : 'Default');
      const family  = font?.family ?? (value !== 'inherit' ? value : 'inherit');
      const fontLabel = el?.querySelector?.('span');
      const preview   = el?.querySelectorAll?.('div')?.[0] ?? el?.querySelector?.('div');
      if (fontLabel) { fontLabel.textContent = label; fontLabel.style.fontFamily = family; }
      // Preview is second child (after button)
      const previewEl = el?.children?.[1] as HTMLElement | undefined;
      if (previewEl) { previewEl.textContent = `${label} — Aa Bb Cc`; previewEl.style.fontFamily = family; }
      const btnEl = el?.querySelector?.('button') as HTMLElement | undefined;
      if (btnEl) btnEl.style.borderColor = font ? '#818cf8' : '#3f3f5a';
      if (font) injectFontIntoCanvas(font.name);
    },

    destroy({ el }: any) {
      (el as any).__closeDropdown?.();
    },
  });

  // ── Re-inject fonts already used in the project on template load ──────────
  editorInst.on('load', () => {
    // Small delay to let GrapesJS finish loading project data
    setTimeout(() => {
      try {
        const wrapper = editorInst.DomComponents.getWrapper();
        if (!wrapper) return;
        const seen = new Set<string>();
        wrapper.find('*').forEach((comp: any) => {
          const ff = comp.getStyle()?.['font-family'];
          if (!ff) return;
          const font = findFont(ff);
          if (font && !seen.has(font.name)) {
            seen.add(font.name);
            injectFontIntoCanvas(font.name);
          }
        });
        console.log(`✅ Re-injected ${seen.size} project font(s) into canvas`);
      } catch { /* ignore */ }
    }, 2000);
  });
}

// ─── Sprint 5: Dynamic Variables ({{GuestName}} placeholders) ────────────────
//
// Lets designers embed merge-field tokens like {{GuestName}} in text layers.
// A live-fill side panel substitutes preview values on the canvas without
// mutating the saved template — placeholders are always what gets persisted.
//
const VAR_TOKEN_RE = /\{\{([A-Za-z0-9_]+)\}\}/g;

const DEFAULT_VARIABLES: Array<{
  key: string;
  label: string;
  preview: string;
  category: string;
}> = [
  { key: 'GuestName',     label: 'Guest Name',      preview: 'Aisha Rahman',        category: 'Guest' },
  { key: 'GroomName',     label: 'Groom Name',      preview: 'Ahmed Khan',          category: 'Couple' },
  { key: 'BrideName',     label: 'Bride Name',      preview: 'Fatima Ali',          category: 'Couple' },
  { key: 'CelebrantName', label: 'Celebrant Name',  preview: 'Rahul Sharma',        category: 'Guest' },
  { key: 'EventName',     label: 'Event Name',      preview: 'Nikah Ceremony',      category: 'Event' },
  { key: 'EventDate',     label: 'Event Date',      preview: 'June 15, 2026',       category: 'Event' },
  { key: 'EventTime',     label: 'Event Time',      preview: '7:00 PM onwards',     category: 'Event' },
  { key: 'VenueName',     label: 'Venue Name',      preview: 'Taj Krishna, Hyderabad', category: 'Event' },
  { key: 'VenueAddress',  label: 'Venue Address',   preview: 'Road No. 1, Banjara Hills', category: 'Event' },
  { key: 'RSVPCode',      label: 'RSVP Code',       preview: 'NIKAH-2026',          category: 'Guest' },
  { key: 'HostName',      label: 'Host Name',       preview: 'The Rahman Family',   category: 'Guest' },
  { key: 'TableNumber',   label: 'Table Number',    preview: '12',                  category: 'Guest' },
];

type VarSnapshot = { cid: string; field: 'content' | `attr:${string}`; value: string };

function dynamicVariablesPlugin(editorInst: any): { cleanup: () => void } {
  const getSlug = () =>
    new URLSearchParams(window.location.search).get('slug') || 'default';

  const storageKey = () => `gjs-vars-preview-${getSlug()}`;

  const loadValues = (): Record<string, string> => {
    const defaults = Object.fromEntries(
      DEFAULT_VARIABLES.map(v => [v.key, v.preview]),
    );
    try {
      const saved = localStorage.getItem(storageKey());
      if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return defaults;
  };

  let variableValues = loadValues();
  let previewActive  = false;
  let panelVisible   = false;
  let panelEl: HTMLElement | null = null;
  const snapshots: VarSnapshot[] = [];

  const substitute = (text: string) =>
    text.replace(VAR_TOKEN_RE, (_m, key: string) =>
      variableValues[key] ?? `{{${key}}}`,
    );

  const collectUsedKeys = (): string[] => {
    const keys = new Set<string>();
    try {
      editorInst.DomComponents.getWrapper()?.find('*').forEach((comp: any) => {
        readComponentFields(comp).forEach(({ value }) => {
          let m: RegExpExecArray | null;
          const re = new RegExp(VAR_TOKEN_RE.source, 'g');
          while ((m = re.exec(value)) !== null) keys.add(m[1]);
        });
      });
    } catch { /* ignore */ }
    return [...keys];
  };

  const readComponentFields = (comp: any): Array<{ field: VarSnapshot['field']; value: string }> => {
    const out: Array<{ field: VarSnapshot['field']; value: string }> = [];
    const type = comp.get('type');
    const tag  = (comp.get('tagName') || '').toLowerCase();

    if (type === 'text' || tag === 'textnode') {
      const content = comp.get('content');
      if (typeof content === 'string') out.push({ field: 'content', value: content });
    }

    const attrs = comp.getAttributes?.() || comp.get('attributes') || {};
    for (const attr of ['alt', 'title', 'placeholder', 'href', 'aria-label']) {
      if (typeof attrs[attr] === 'string' && attrs[attr]) {
        out.push({ field: `attr:${attr}`, value: attrs[attr] });
      }
    }
    return out;
  };

  const writeField = (comp: any, field: VarSnapshot['field'], value: string, silent = true) => {
    if (field === 'content') {
      comp.set('content', value, silent ? { silent: true } : undefined);
      return;
    }
    if (field.startsWith('attr:')) {
      comp.addAttributes({ [field.slice(5)]: value }, silent ? { silent: true } : undefined);
    }
  };

  const applyPreview = () => {
    if (!previewActive) return;
    snapshots.length = 0;
    try {
      editorInst.DomComponents.getWrapper()?.find('*').forEach((comp: any) => {
        readComponentFields(comp).forEach(({ field, value }) => {
          if (!VAR_TOKEN_RE.test(value)) {
            VAR_TOKEN_RE.lastIndex = 0;
            return;
          }
          VAR_TOKEN_RE.lastIndex = 0;
          snapshots.push({ cid: comp.cid, field, value });
          writeField(comp, field, substitute(value));
        });
      });
      highlightPlaceholders(false);
    } catch (e) {
      console.warn('Dynamic variables preview failed:', e);
    }
  };

  const restorePlaceholders = () => {
    if (!snapshots.length) {
      previewActive = false;
      updatePreviewToggle();
      return;
    }
    try {
      const wrapper = editorInst.DomComponents.getWrapper();
      snapshots.forEach(({ cid, field, value }) => {
        const found = findByCid(wrapper, cid);
        if (found) writeField(found, field, value);
      });
    } catch (e) {
      console.warn('Dynamic variables restore failed:', e);
    } finally {
      snapshots.length = 0;
      previewActive = false;
      updatePreviewToggle();
      highlightPlaceholders(true);
    }
  };

  const findByCid = (comp: any, cid: string): any | null => {
    if (!comp) return null;
    if (comp.cid === cid) return comp;
    let found: any = null;
    comp.components().forEach((child: any) => {
      if (!found) found = findByCid(child, cid);
    });
    return found;
  };

  const persistValues = () => {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(variableValues));
    } catch { /* ignore */ }
  };

  const highlightPlaceholders = (on: boolean) => {
    try {
      const iframeDoc = editorInst.Canvas.getBody()?.ownerDocument;
      if (!iframeDoc) return;
      let style = iframeDoc.getElementById('gjs-var-placeholder-style');
      if (!on) {
        style?.remove();
        return;
      }
      if (!style) {
        style = iframeDoc.createElement('style');
        style.id = 'gjs-var-placeholder-style';
        style.textContent = `
          [data-gjs-var-placeholder="true"] {
            outline: 1px dashed rgba(124,124,255,0.55) !important;
            outline-offset: 2px;
          }
        `;
        iframeDoc.head.appendChild(style);
      }
      editorInst.DomComponents.getWrapper()?.find('*').forEach((comp: any) => {
        const el = comp.getEl?.();
        if (!el) return;
        const hasToken = readComponentFields(comp).some(({ value }) => VAR_TOKEN_RE.test(value));
        VAR_TOKEN_RE.lastIndex = 0;
        if (hasToken) el.setAttribute('data-gjs-var-placeholder', 'true');
        else el.removeAttribute('data-gjs-var-placeholder');
      });
    } catch { /* ignore */ }
  };

  const findTextnodeChild = (comp: any): any | null => {
    let found: any = null;
    comp.components().forEach((child: any) => {
      if (found) return;
      const tag = (child.get('tagName') || '').toLowerCase();
      if (tag === 'textnode' || child.get('type') === 'text') found = child;
      else found = findTextnodeChild(child);
    });
    return found;
  };

  const insertVariable = (key: string) => {
    const token = `{{${key}}}`;
    const sel = editorInst.getSelected();
    if (!sel) return;
    const fields = readComponentFields(sel);
    if (fields.length) {
      const { field, value } = fields[0];
      writeField(sel, field, value + token, false);
    } else {
      const textChild = findTextnodeChild(sel);
      if (textChild) {
        writeField(textChild, 'content', (textChild.get('content') || '') + token, false);
      } else if (
        sel.get('type') === 'text' ||
        ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'a', 'button'].includes(
          (sel.get('tagName') || '').toLowerCase(),
        )
      ) {
        const current = sel.get('content') || '';
        sel.set('content', (typeof current === 'string' ? current : '') + token);
      } else {
        const wrapper = sel.parent() || editorInst.DomComponents.getWrapper();
        const textComp = wrapper?.append({
          type: 'text',
          content: token,
          style: { position: 'absolute', top: '40%', left: '10%' },
        });
        if (textComp) editorInst.select(textComp);
      }
    }
    refreshUsedList();
    if (previewActive) applyPreview();
    else highlightPlaceholders(true);
  };

  const updatePreviewToggle = () => {
    const btn = panelEl?.querySelector('#gjs-var-preview-toggle') as HTMLButtonElement | null;
    if (!btn) return;
    btn.textContent = previewActive ? '● Live Preview ON' : '○ Live Preview OFF';
    btn.style.background = previewActive ? '#065f46' : '#27272a';
    btn.style.borderColor = previewActive ? '#10b981' : '#3f3f46';
  };

  const refreshUsedList = () => {
    const el = panelEl?.querySelector('#gjs-var-used-list');
    if (!el) return;
    const used = collectUsedKeys();
    el.textContent = used.length
      ? `Used in template: ${used.map(k => `{{${k}}}`).join(', ')}`
      : 'No variables used yet — insert one below.';
  };

  const buildPanel = () => {
    panelEl = document.createElement('div');
    panelEl.id = 'gjs-variables-panel';
    Object.assign(panelEl.style, {
      position:      'fixed',
      top:           '48px',
      right:         '0',
      width:         '300px',
      height:        'calc(100vh - 4rem - 48px)',
      background:    '#18181b',
      borderLeft:    '1px solid #27272a',
      zIndex:        '9999',
      display:       'flex',
      flexDirection: 'column',
      color:         '#fafafa',
      fontFamily:    "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      fontSize:      '12px',
      boxShadow:     '-8px 0 32px rgba(0,0,0,0.35)',
    });

    const header = document.createElement('div');
    header.style.cssText = 'padding:12px 14px;border-bottom:1px solid #27272a;display:flex;align-items:center;justify-content:space-between;';
    header.innerHTML = `
      <div>
        <div style="font-weight:700;font-size:13px;color:#fbbf24">⬡ Dynamic Variables</div>
        <div style="opacity:.55;font-size:10px;margin-top:2px">Merge fields for personalised invites</div>
      </div>
      <button id="gjs-var-close" style="background:none;border:none;color:#888;cursor:pointer;font-size:18px;line-height:1">×</button>
    `;
    panelEl.appendChild(header);

    const previewRow = document.createElement('div');
    previewRow.style.cssText = 'padding:10px 14px;border-bottom:1px solid #27272a;';
    const previewBtn = document.createElement('button');
    previewBtn.id = 'gjs-var-preview-toggle';
    previewBtn.style.cssText = `
      width:100%;padding:8px 10px;border-radius:6px;cursor:pointer;
      border:1px solid #3f3f46;color:#fafafa;font-size:12px;font-weight:600;
    `;
    previewBtn.addEventListener('click', () => {
      if (previewActive) restorePlaceholders();
      else {
        previewActive = true;
        updatePreviewToggle();
        applyPreview();
      }
    });
    previewRow.appendChild(previewBtn);
    panelEl.appendChild(previewRow);

    const scroll = document.createElement('div');
    scroll.style.cssText = 'flex:1;overflow-y:auto;padding:10px 14px;';

    const mkInput = (def: typeof DEFAULT_VARIABLES[0]) => {
      const row = document.createElement('div');
      row.style.marginBottom = '10px';

      const label = document.createElement('label');
      label.style.cssText = 'display:block;font-size:10px;opacity:.65;margin-bottom:3px;text-transform:uppercase;letter-spacing:.04em;';
      label.textContent = `${def.label}  ·  {{${def.key}}}`;

      const input = document.createElement('input');
      input.type = 'text';
      input.value = variableValues[def.key] ?? def.preview;
      input.placeholder = def.preview;
      input.style.cssText = `
        width:100%;box-sizing:border-box;padding:7px 9px;border-radius:5px;
        background:#27272a;border:1px solid #3f3f46;color:#fafafa;font-size:12px;outline:none;
      `;
      input.addEventListener('input', () => {
        variableValues[def.key] = input.value;
        persistValues();
        if (previewActive) applyPreview();
      });
      input.addEventListener('focus', () => { input.style.borderColor = '#818cf8'; });
      input.addEventListener('blur',  () => { input.style.borderColor = '#3f3f46'; });

      const insertBtn = document.createElement('button');
      insertBtn.textContent = `+ Insert {{${def.key}}}`;
      insertBtn.style.cssText = `
        margin-top:4px;padding:4px 8px;border-radius:4px;border:1px solid #3f3f46;
        background:#27272a;color:#a1a1aa;cursor:pointer;font-size:10px;
      `;
      insertBtn.addEventListener('click', () => insertVariable(def.key));

      row.appendChild(label);
      row.appendChild(input);
      row.appendChild(insertBtn);
      return row;
    };

    const categories = [...new Set(DEFAULT_VARIABLES.map(v => v.category))];
    categories.forEach(cat => {
      const catLabel = document.createElement('div');
      catLabel.textContent = cat;
      catLabel.style.cssText = 'font-size:10px;font-weight:700;color:#fbbf24;margin:12px 0 8px;letter-spacing:.08em;text-transform:uppercase;';
      scroll.appendChild(catLabel);
      DEFAULT_VARIABLES.filter(v => v.category === cat).forEach(def => scroll.appendChild(mkInput(def)));
    });

    panelEl.appendChild(scroll);

    const footer = document.createElement('div');
    footer.style.cssText = 'padding:10px 14px;border-top:1px solid #27272a;background:#18181b;';
    const usedList = document.createElement('div');
    usedList.id = 'gjs-var-used-list';
    usedList.style.cssText = 'font-size:10px;opacity:.7;line-height:1.4;';
    footer.appendChild(usedList);
    panelEl.appendChild(footer);

    document.body.appendChild(panelEl);
    updatePreviewToggle();
    refreshUsedList();

    panelEl.querySelector('#gjs-var-close')?.addEventListener('click', () => togglePanel(false));
  };

  const togglePanel = (force?: boolean) => {
    panelVisible = force !== undefined ? force : !panelVisible;
    if (panelVisible && !panelEl) buildPanel();
    if (panelEl) panelEl.style.display = panelVisible ? 'flex' : 'none';
    if (panelVisible) refreshUsedList();
  };

  const ensurePlaceholdersForSave = () => {
    if (previewActive || snapshots.length) restorePlaceholders();
  };

  let guestPreviewForced = false;

  const enterGuestPreview = () => {
    if (!previewActive) {
      guestPreviewForced = true;
      previewActive = true;
      applyPreview();
      updatePreviewToggle();
    }
  };

  const releaseGuestPreview = () => {
    if (guestPreviewForced) {
      guestPreviewForced = false;
      restorePlaceholders();
    }
  };

  // Expose API for save/export hooks
  editorInst.DynamicVariables = {
    restorePlaceholders,
    ensurePlaceholdersForSave,
    isPreviewActive: () => previewActive,
    insertVariable,
    togglePanel,
    enterGuestPreview,
    releaseGuestPreview,
  };

  editorInst.Commands.add('toggle-variables-panel', {
    run() { togglePanel(); },
  });

  editorInst.Commands.add('insert-variable', {
    run(_ed: any, _s: any, opts: { key?: string } = {}) {
      if (opts.key) insertVariable(opts.key);
    },
  });

  editorInst.Panels.addButton('options', {
    id: 'open-variables',
    className: 'fa fa-code',
    command: 'toggle-variables-panel',
    attributes: { title: 'Dynamic Variables {{}}' },
  });

  // Disable preview when user edits content so placeholders stay canonical
  editorInst.on('component:update', () => {
    if (previewActive) restorePlaceholders();
    else highlightPlaceholders(true);
    refreshUsedList();
  });

  editorInst.on('component:add', () => {
    refreshUsedList();
    if (!previewActive) highlightPlaceholders(true);
  });

  editorInst.on('load', () => {
    setTimeout(() => {
      highlightPlaceholders(true);
      refreshUsedList();
    }, 2500);
  });

  return {
    cleanup: () => {
      restorePlaceholders();
      panelEl?.remove();
      panelEl = null;
      delete editorInst.DynamicVariables;
    },
  };
}

// ─── Sprint 13: Text Gradient Fill ───────────────────────────────────────────
//
// Custom Style Manager control for multi-stop linear gradients on text layers.
// Generates background-clip:text CSS for premium wedding invitation typography.
//
type TextGradientStop = { id: string; color: string; pos: number };
type TextGradientState = { angle: number; stops: TextGradientStop[]; enabled: boolean };

const TEXT_GRADIENT_PRESETS: Array<{
  name: string;
  angle: number;
  stops: Array<{ color: string; pos: number }>;
}> = [
  {
    name: 'Royal Gold',
    angle: 135,
    stops: [
      { color: '#8B6914', pos: 0 },
      { color: '#D4AF37', pos: 35 },
      { color: '#FFF8DC', pos: 55 },
      { color: '#D4AF37', pos: 75 },
      { color: '#8B6914', pos: 100 },
    ],
  },
  {
    name: 'Rose Gold',
    angle: 120,
    stops: [
      { color: '#9e5a63', pos: 0 },
      { color: '#e8b4b8', pos: 45 },
      { color: '#f5d0c5', pos: 55 },
      { color: '#b76e79', pos: 100 },
    ],
  },
  {
    name: 'Champagne',
    angle: 90,
    stops: [
      { color: '#A67C00', pos: 0 },
      { color: '#F7E7CE', pos: 50 },
      { color: '#C9A96E', pos: 100 },
    ],
  },
  {
    name: 'Antique Bronze',
    angle: 145,
    stops: [
      { color: '#4a3728', pos: 0 },
      { color: '#C8A951', pos: 50 },
      { color: '#4a3728', pos: 100 },
    ],
  },
  {
    name: 'Blush Sunset',
    angle: 90,
    stops: [
      { color: '#f093fb', pos: 0 },
      { color: '#f5576c', pos: 100 },
    ],
  },
  {
    name: 'Emerald Glow',
    angle: 135,
    stops: [
      { color: '#064e3b', pos: 0 },
      { color: '#34d399', pos: 50 },
      { color: '#064e3b', pos: 100 },
    ],
  },
];

const TEXT_GRADIENT_PROPS = [
  'background',
  'background-image',
  '-webkit-background-clip',
  'background-clip',
  '-webkit-text-fill-color',
] as const;

function mkStop(color: string, pos: number): TextGradientStop {
  return { id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, color, pos };
}

function defaultTextGradientState(): TextGradientState {
  const preset = TEXT_GRADIENT_PRESETS[0];
  return {
    angle: preset.angle,
    stops: preset.stops.map(s => mkStop(s.color, s.pos)),
    enabled: false,
  };
}

function buildGradientValue(state: TextGradientState): string {
  const sorted = [...state.stops].sort((a, b) => a.pos - b.pos);
  const stopsStr = sorted.map(s => `${s.color} ${s.pos}%`).join(', ');
  return `linear-gradient(${state.angle}deg, ${stopsStr})`;
}

function gradientBarCSS(state: TextGradientState): string {
  if (state.stops.length < 2) return STUDIO_DARK.bgSurface;
  return buildGradientValue(state);
}

function parseTextGradientFromStyle(style: Record<string, string>): TextGradientState | null {
  const clip = style['-webkit-background-clip'] || style['background-clip'] || '';
  if (clip !== 'text') return null;

  const raw = style['background-image'] || style.background || '';
  const match = raw.match(/linear-gradient\(\s*(\d+(?:\.\d+)?)deg\s*,\s*(.+)\s*\)/i);
  if (!match) return null;

  const angle = parseFloat(match[1]);
  const stopsPart = match[2];
  const stops: TextGradientStop[] = [];
  const stopRe = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\s+(\d+(?:\.\d+)?)%/gi;
  let m: RegExpExecArray | null;
  while ((m = stopRe.exec(stopsPart)) !== null) {
    stops.push(mkStop(m[1], parseFloat(m[2])));
  }
  if (stops.length < 2) return null;
  return { angle, stops, enabled: true };
}

function applyTextGradient(comp: any, state: TextGradientState) {
  if (!comp || !state.enabled || state.stops.length < 2) return;
  const grad = buildGradientValue(state);
  const styles: Record<string, string> = {
    'background-image':    grad,
    'background':          grad,
    '-webkit-background-clip': 'text',
    'background-clip':       'text',
    '-webkit-text-fill-color': 'transparent',
    'color':               'transparent',
  };
  const currentDisplay = comp.getStyle()?.display;
  if (!currentDisplay || currentDisplay === 'inline') {
    styles.display = 'inline-block';
  }
  comp.addStyle(styles);
}

function clearTextGradient(comp: any) {
  if (!comp) return;
  TEXT_GRADIENT_PROPS.forEach(p => comp.removeStyle(p));
  comp.removeStyle('color');
}

function textGradientPlugin(editorInst: any): { cleanup: () => void } {
  const D = STUDIO_DARK;

  editorInst.StyleManager.addType('text-gradient', {
    create() {
      const wrap = document.createElement('div');
      wrap.className = 'gjs-sm-property gjs-sm-property--full';
      wrap.style.cssText = 'width:100%;padding:4px 0 10px;';

      let state: TextGradientState = defaultTextGradientState();

      const lbl = (text: string) => {
        const el = document.createElement('label');
        el.textContent = text;
        el.style.cssText = `display:block;font-size:10px;color:${D.textDim};margin:10px 0 4px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;`;
        return el;
      };

      // ── Live preview strip ──────────────────────────────────────────────
      const preview = document.createElement('div');
      preview.textContent = 'Aa — Wedding Text';
      preview.style.cssText = `
        font-size:26px;font-weight:700;line-height:1.2;padding:10px 4px 12px;
        font-family:'Cormorant Garamond',Georgia,serif;min-height:36px;
        -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
      `;

      // ── Preset picker ─────────────────────────────────────────────────
      const presetSel = document.createElement('select');
      presetSel.style.cssText = `width:100%;padding:8px 10px;border-radius:6px;background:${D.bgSurface};border:1px solid ${D.borderSubtle};color:${D.text};font-size:12px;cursor:pointer;`;
      presetSel.innerHTML = `<option value="">— Preset —</option>${TEXT_GRADIENT_PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('')}`;

      // ── Gradient bar ──────────────────────────────────────────────────
      const barWrap = document.createElement('div');
      barWrap.style.cssText = `position:relative;height:32px;border-radius:8px;border:1px solid ${D.border};overflow:hidden;cursor:crosshair;margin-top:4px;`;
      const bar = document.createElement('div');
      bar.style.cssText = 'position:absolute;inset:0;';
      barWrap.appendChild(bar);

      // ── Angle control ─────────────────────────────────────────────────
      const angleRow = document.createElement('div');
      angleRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:4px;';
      const angleRange = document.createElement('input');
      angleRange.type = 'range';
      angleRange.min = '0';
      angleRange.max = '360';
      angleRange.value = String(state.angle);
      angleRange.style.cssText = 'flex:1;accent-color:#f59e0b;';
      const angleVal = document.createElement('span');
      angleVal.style.cssText = `font-size:11px;color:${D.textMuted};width:42px;text-align:right;font-variant-numeric:tabular-nums;`;
      angleVal.textContent = `${state.angle}°`;
      angleRow.appendChild(angleRange);
      angleRow.appendChild(angleVal);

      // ── Stops list ────────────────────────────────────────────────────
      const stopsList = document.createElement('div');
      stopsList.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px;';

      const addStopBtn = document.createElement('button');
      addStopBtn.type = 'button';
      addStopBtn.textContent = '+ Add Color Stop';
      addStopBtn.style.cssText = `
        width:100%;padding:7px;margin-top:4px;border-radius:6px;cursor:pointer;
        border:1px dashed ${D.border};background:transparent;color:${D.textMuted};font-size:11px;
      `;

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:6px;margin-top:10px;';
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.textContent = 'Apply Gradient';
      applyBtn.style.cssText = `
        flex:1;padding:8px;border-radius:6px;border:none;cursor:pointer;font-size:11px;font-weight:600;
        background:${D.accent};color:#18181b;
      `;
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.textContent = 'Clear';
      clearBtn.style.cssText = `
        padding:8px 14px;border-radius:6px;cursor:pointer;font-size:11px;
        border:1px solid ${D.border};background:${D.bgSurface};color:${D.textMuted};
      `;

      wrap.appendChild(lbl('Preview'));
      wrap.appendChild(preview);
      wrap.appendChild(lbl('Wedding Presets'));
      wrap.appendChild(presetSel);
      wrap.appendChild(lbl('Gradient'));
      wrap.appendChild(barWrap);
      wrap.appendChild(lbl('Angle'));
      wrap.appendChild(angleRow);
      wrap.appendChild(lbl('Color Stops'));
      wrap.appendChild(stopsList);
      wrap.appendChild(addStopBtn);
      btnRow.appendChild(applyBtn);
      btnRow.appendChild(clearBtn);
      wrap.appendChild(btnRow);

      const refreshBar = () => {
        const css = gradientBarCSS(state);
        bar.style.background = css;
        preview.style.backgroundImage = css;
        angleVal.textContent = `${state.angle}°`;
      };

      const commit = (applyToComponent = true) => {
        refreshBar();
        if (!applyToComponent) return;
        const comp = editorInst.getSelected();
        if (!comp) return;
        if (state.enabled && state.stops.length >= 2) {
          applyTextGradient(comp, state);
        }
      };

      const renderStops = () => {
        stopsList.innerHTML = '';
        const sorted = [...state.stops].sort((a, b) => a.pos - b.pos);
        sorted.forEach(stop => {
          const row = document.createElement('div');
          row.style.cssText = `display:grid;grid-template-columns:36px 1fr 52px 28px;gap:6px;align-items:center;`;

          const colorIn = document.createElement('input');
          colorIn.type = 'color';
          colorIn.value = stop.color.length === 7 ? stop.color : '#D4AF37';
          colorIn.title = 'Stop color';
          colorIn.style.cssText = `width:36px;height:30px;padding:0;border:1px solid ${D.border};border-radius:6px;cursor:pointer;background:${D.bgSurface};`;

          const posRange = document.createElement('input');
          posRange.type = 'range';
          posRange.min = '0';
          posRange.max = '100';
          posRange.value = String(stop.pos);
          posRange.style.cssText = 'accent-color:#818cf8;';

          const posNum = document.createElement('input');
          posNum.type = 'number';
          posNum.min = '0';
          posNum.max = '100';
          posNum.value = String(stop.pos);
          posNum.style.cssText = `width:52px;padding:5px 6px;border-radius:5px;background:${D.bgSurface};border:1px solid ${D.borderSubtle};color:${D.text};font-size:11px;text-align:center;`;

          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.textContent = '×';
          delBtn.title = 'Remove stop';
          delBtn.style.cssText = `
            width:28px;height:28px;border-radius:5px;border:1px solid ${D.borderSubtle};
            background:${D.bgElevated};color:${D.textDim};cursor:pointer;font-size:16px;line-height:1;
          `;
          delBtn.disabled = state.stops.length <= 2;
          delBtn.style.opacity = delBtn.disabled ? '0.35' : '1';

          const syncPos = (v: number) => {
            const clamped = Math.max(0, Math.min(100, v));
            stop.pos = clamped;
            posRange.value = String(clamped);
            posNum.value = String(clamped);
            state.enabled = true;
            commit();
          };

          colorIn.addEventListener('input', () => {
            stop.color = colorIn.value;
            state.enabled = true;
            commit();
          });
          posRange.addEventListener('input', () => syncPos(parseInt(posRange.value, 10)));
          posNum.addEventListener('change', () => syncPos(parseInt(posNum.value, 10) || 0));
          delBtn.addEventListener('click', () => {
            if (state.stops.length <= 2) return;
            state.stops = state.stops.filter(s => s.id !== stop.id);
            state.enabled = true;
            renderStops();
            commit();
          });

          row.appendChild(colorIn);
          row.appendChild(posRange);
          row.appendChild(posNum);
          row.appendChild(delBtn);
          stopsList.appendChild(row);
        });
      };

      presetSel.addEventListener('change', () => {
        const idx = presetSel.value;
        if (idx === '') return;
        const preset = TEXT_GRADIENT_PRESETS[parseInt(idx, 10)];
        if (!preset) return;
        state.angle = preset.angle;
        state.stops = preset.stops.map(s => mkStop(s.color, s.pos));
        state.enabled = true;
        angleRange.value = String(state.angle);
        renderStops();
        commit();
        presetSel.value = '';
      });

      angleRange.addEventListener('input', () => {
        state.angle = parseInt(angleRange.value, 10);
        state.enabled = true;
        commit();
      });

      barWrap.addEventListener('click', (e) => {
        const rect = barWrap.getBoundingClientRect();
        const pct = Math.round(((e.clientX - rect.left) / rect.width) * 100);
        const midColor = state.stops[Math.floor(state.stops.length / 2)]?.color ?? '#D4AF37';
        state.stops.push(mkStop(midColor, pct));
        state.enabled = true;
        renderStops();
        commit();
      });

      addStopBtn.addEventListener('click', () => {
        const last = state.stops[state.stops.length - 1];
        state.stops.push(mkStop(last?.color ?? '#D4AF37', Math.min(100, (last?.pos ?? 50) + 10)));
        state.enabled = true;
        renderStops();
        commit();
      });

      applyBtn.addEventListener('click', () => {
        state.enabled = true;
        commit();
      });

      clearBtn.addEventListener('click', () => {
        state = defaultTextGradientState();
        state.enabled = false;
        angleRange.value = String(state.angle);
        presetSel.value = '';
        const comp = editorInst.getSelected();
        clearTextGradient(comp);
        renderStops();
        refreshBar();
        preview.style.backgroundImage = 'none';
        preview.style.removeProperty('-webkit-background-clip');
        preview.style.removeProperty('background-clip');
        preview.style.removeProperty('-webkit-text-fill-color');
        preview.style.color = D.text;
      });

      (wrap as any).__setState = (next: TextGradientState) => {
        state = next;
        angleRange.value = String(state.angle);
        renderStops();
        refreshBar();
        if (!state.enabled) {
          preview.style.backgroundImage = 'none';
          preview.style.removeProperty('-webkit-background-clip');
          preview.style.removeProperty('background-clip');
          preview.style.removeProperty('-webkit-text-fill-color');
          preview.style.color = D.text;
        }
      };

      renderStops();
      refreshBar();

      return wrap;
    },

    update({ el }: { el?: HTMLElement }) {
      const comp = safeGetSelected(editorInst);
      if (!comp || !el) return;
      const parsed = parseTextGradientFromStyle(comp.getStyle() || {});
      const next = parsed ?? defaultTextGradientState();
      (el as any).__setState?.(next);
    },

    destroy() {},
  });

  editorInst.TextGradient = {
    apply: (comp: any, state: TextGradientState) => applyTextGradient(comp, state),
    clear: clearTextGradient,
    parse: parseTextGradientFromStyle,
  };

  return {
    cleanup() {
      delete editorInst.TextGradient;
    },
  };
}

// ─── Sprint 6: Entrance Animations (animate.css presets) ─────────────────────
//
// Per-layer entrance animations stored as data-animate / data-animate-duration /
// data-animate-delay attributes + animate.css classes on the component element.
//
const ANIMATE_CSS_URL =
  'https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css';

const ANIMATION_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'None',           value: '' },
  { label: 'Fade In',        value: 'fadeIn' },
  { label: 'Fade In Up',     value: 'fadeInUp' },
  { label: 'Fade In Down',   value: 'fadeInDown' },
  { label: 'Fade In Left',   value: 'fadeInLeft' },
  { label: 'Fade In Right',  value: 'fadeInRight' },
  { label: 'Slide In Up',    value: 'slideInUp' },
  { label: 'Slide In Down',  value: 'slideInDown' },
  { label: 'Slide In Left',  value: 'slideInLeft' },
  { label: 'Slide In Right', value: 'slideInRight' },
  { label: 'Zoom In',        value: 'zoomIn' },
  { label: 'Zoom In Up',     value: 'zoomInUp' },
  { label: 'Zoom In Down',   value: 'zoomInDown' },
  { label: 'Bounce In',      value: 'bounceIn' },
  { label: 'Flip In X',      value: 'flipInX' },
  { label: 'Flip In Y',      value: 'flipInY' },
  { label: 'Light Speed In', value: 'lightSpeedInRight' },
  { label: 'Roll In',        value: 'rollIn' },
];

const ANIMATE_CLASS_PREFIX = 'animate__';

function entranceAnimationsPlugin(editorInst: any): { cleanup: () => void } {
  const injectAnimateCss = () => {
    try {
      const head = editorInst.Canvas.getBody()?.ownerDocument?.head;
      if (!head || head.querySelector('#gjs-animate-css')) return;
      const link = document.createElement('link');
      link.id   = 'gjs-animate-css';
      link.rel  = 'stylesheet';
      link.href = ANIMATE_CSS_URL;
      head.appendChild(link);
    } catch { /* ignore */ }
  };

  const readAnim = (comp: any) => {
    const attrs = comp?.getAttributes?.() || {};
    return {
      name:     attrs['data-animate'] || '',
      duration: parseInt(attrs['data-animate-duration'] || '1000', 10) || 1000,
      delay:    parseInt(attrs['data-animate-delay']    || '0',    10) || 0,
    };
  };

  const stripAnimateClasses = (el: HTMLElement) => {
    [...el.classList].forEach(cls => {
      if (cls.startsWith(ANIMATE_CLASS_PREFIX)) el.classList.remove(cls);
    });
    el.style.removeProperty('animation-duration');
    el.style.removeProperty('animation-delay');
    el.style.removeProperty('animation-fill-mode');
  };

  const applyAnimation = (comp: any, name: string, durationMs: number, delayMs: number) => {
    if (!comp) return;
    comp.addAttributes({
      'data-animate':          name || '',
      'data-animate-duration': String(durationMs),
      'data-animate-delay':    String(delayMs),
    });
    const el = comp.getEl?.() as HTMLElement | null;
    if (!el) return;
    stripAnimateClasses(el);
    if (!name) return;
    el.classList.add(`${ANIMATE_CLASS_PREFIX}animated`, `${ANIMATE_CLASS_PREFIX}${name}`);
    el.style.animationDuration   = `${durationMs}ms`;
    el.style.animationDelay      = `${delayMs}ms`;
    el.style.animationFillMode   = 'both';
  };

  const replayAnimation = (comp: any) => {
    const { name, duration, delay } = readAnim(comp);
    if (!name) return;
    const el = comp.getEl?.() as HTMLElement | null;
    if (!el) return;
    stripAnimateClasses(el);
    // Force reflow so the browser restarts the animation
    void el.offsetWidth;
    el.classList.add(`${ANIMATE_CLASS_PREFIX}animated`, `${ANIMATE_CLASS_PREFIX}${name}`);
    el.style.animationDuration = `${duration}ms`;
    el.style.animationDelay    = `${delay}ms`;
    el.style.animationFillMode = 'both';
  };

  const replayAllAnimations = () => {
    try {
      const wrapper = editorInst.DomComponents.getWrapper();
      const items: Array<{ comp: any; delay: number }> = [];
      wrapper?.find('[data-animate]').forEach((comp: any) => {
        const { name, delay } = readAnim(comp);
        if (name) items.push({ comp, delay });
      });
      items.sort((a, b) => a.delay - b.delay);
      items.forEach(({ comp, delay }) => {
        setTimeout(() => replayAnimation(comp), delay);
      });
    } catch { /* ignore */ }
  };

  const syncAllFromAttributes = () => {
    try {
      editorInst.DomComponents.getWrapper()?.find('[data-animate]').forEach((comp: any) => {
        const { name, duration, delay } = readAnim(comp);
        if (name) applyAnimation(comp, name, duration, delay);
      });
    } catch { /* ignore */ }
  };

  // ── Style Manager custom control ──────────────────────────────────────────
  editorInst.StyleManager.addType('entrance-animation', {
    create({ change }) {
      const wrap = document.createElement('div');
      wrap.className = 'gjs-sm-property gjs-sm-property--full';
      wrap.style.cssText = 'width:100%;padding:4px 0 8px;';

      wrap.innerHTML = `
        <label style="display:block;font-size:10px;opacity:.65;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em;color:#fafafa">
          Entrance Animation
        </label>
        <select id="gjs-anim-preset" style="width:100%;padding:7px 9px;border-radius:5px;background:#27272a;border:1px solid #3f3f46;color:#fafafa;font-size:12px;margin-bottom:8px;">
          ${ANIMATION_PRESETS.map(p => `<option value="${p.value}">${p.label}</option>`).join('')}
        </select>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <div>
            <label style="font-size:10px;opacity:.65;color:#fafafa">Duration (ms)</label>
            <input id="gjs-anim-duration" type="number" min="100" max="10000" step="100" value="1000"
              style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:5px;background:#27272a;border:1px solid #3f3f46;color:#fafafa;font-size:12px;margin-top:3px;" />
          </div>
          <div>
            <label style="font-size:10px;opacity:.65;color:#fafafa">Delay (ms)</label>
            <input id="gjs-anim-delay" type="number" min="0" max="10000" step="100" value="0"
              style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:5px;background:#27272a;border:1px solid #3f3f46;color:#fafafa;font-size:12px;margin-top:3px;" />
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <button id="gjs-anim-preview" type="button"
            style="flex:1;padding:7px 8px;border-radius:5px;border:1px solid #3f3f46;background:#27272a;color:#a1a1aa;cursor:pointer;font-size:11px;font-weight:600;">
            ▶ Preview Layer
          </button>
          <button id="gjs-anim-preview-all" type="button"
            style="flex:1;padding:7px 8px;border-radius:5px;border:1px solid #3f3f46;background:#27272a;color:#e4e4e7;cursor:pointer;font-size:11px;">
            ▶ Timeline
          </button>
        </div>
      `;

      const presetEl   = wrap.querySelector('#gjs-anim-preset')   as HTMLSelectElement;
      const durationEl = wrap.querySelector('#gjs-anim-duration') as HTMLInputElement;
      const delayEl    = wrap.querySelector('#gjs-anim-delay')    as HTMLInputElement;

      const commit = () => {
        const comp = editorInst.getSelected();
        if (!comp) return;
        applyAnimation(
          comp,
          presetEl.value,
          parseInt(durationEl.value, 10) || 1000,
          parseInt(delayEl.value, 10) || 0,
        );
        change?.({ value: presetEl.value, partial: false });
      };

      presetEl.addEventListener('change', commit);
      durationEl.addEventListener('change', commit);
      delayEl.addEventListener('change', commit);

      wrap.querySelector('#gjs-anim-preview')?.addEventListener('click', () => {
        commit();
        replayAnimation(editorInst.getSelected());
      });

      wrap.querySelector('#gjs-anim-preview-all')?.addEventListener('click', () => {
        replayAllAnimations();
      });

      return wrap;
    },

    update({ el }) {
      const comp = safeGetSelected(editorInst);
      if (!comp || !el) return;
      const { name, duration, delay } = readAnim(comp);
      const presetEl   = el.querySelector('#gjs-anim-preset')   as HTMLSelectElement | null;
      const durationEl = el.querySelector('#gjs-anim-duration') as HTMLInputElement | null;
      const delayEl    = el.querySelector('#gjs-anim-delay')    as HTMLInputElement | null;
      if (presetEl)   presetEl.value   = name;
      if (durationEl) durationEl.value = String(duration);
      if (delayEl)    delayEl.value    = String(delay);
    },

    destroy() {},
  });

  editorInst.Commands.add('preview-layer-animation', {
    run(ed: any) {
      replayAnimation(ed.getSelected());
    },
  });

  editorInst.Commands.add('preview-timeline-animations', {
    run() { replayAllAnimations(); },
  });

  editorInst.Panels.addButton('options', {
    id: 'preview-timeline-animations',
    className: 'fa fa-play',
    command: 'preview-timeline-animations',
    attributes: { title: 'Preview entrance animation timeline' },
  });

  editorInst.on('load', () => {
    setTimeout(() => {
      injectAnimateCss();
      syncAllFromAttributes();
    }, 1600);
  });

  editorInst.on('component:selected', (model: any) => {
    const toolbar: any[] = model.get('toolbar') || [];
    if (!toolbar.some((t: any) => t.command === 'preview-layer-animation')) {
      toolbar.unshift({
        attributes: { class: 'fa fa-play', title: 'Preview Entrance Animation' },
        command: 'preview-layer-animation',
      });
      model.set('toolbar', toolbar);
    }
    const { name, duration, delay } = readAnim(model);
    if (name) applyAnimation(model, name, duration, delay);
  });

  return {
    cleanup() {
      delete editorInst.EntranceAnimations;
    },
  };
}

// ─── Sprint 7: Multi-Select Alignment ────────────────────────────────────────
//
// Shift+click adds/removes layers from a multi-selection set. Alignment and
// distribution commands operate on every layer in the set (2+ required).
//
function multiSelectAlignPlugin(editorInst: any): { cleanup: () => void } {
  const selectedCids = new Set<string>();
  let shiftHeld = false;

  const findByCid = (comp: any, cid: string): any | null => {
    if (!comp) return null;
    if (comp.cid === cid) return comp;
    let found: any = null;
    comp.components().forEach((child: any) => {
      if (!found) found = findByCid(child, cid);
    });
    return found;
  };

  const getComponents = (): any[] => {
    const wrapper = editorInst.DomComponents.getWrapper();
    return [...selectedCids]
      .map(cid => findByCid(wrapper, cid))
      .filter(Boolean);
  };

  const notify = () => {
    editorInst.trigger('multiselect:change', { count: selectedCids.size });
  };

  const syncOutlines = () => {
    try {
      const iframeDoc = editorInst.Canvas.getBody()?.ownerDocument;
      if (!iframeDoc) return;
      let style = iframeDoc.getElementById('gjs-multiselect-style');
      if (!style) {
        style = iframeDoc.createElement('style');
        style.id = 'gjs-multiselect-style';
        style.textContent = `
          .gjs-ms-selected {
            outline: 2px solid #22d3ee !important;
            outline-offset: 2px;
          }
        `;
        iframeDoc.head.appendChild(style);
      }
      editorInst.DomComponents.getWrapper()?.find('*').forEach((comp: any) => {
        const el = comp.getEl?.() as HTMLElement | undefined;
        if (!el) return;
        if (selectedCids.has(comp.cid)) el.classList.add('gjs-ms-selected');
        else el.classList.remove('gjs-ms-selected');
      });
    } catch { /* ignore */ }
  };

  const clearSelection = () => {
    selectedCids.clear();
    syncOutlines();
    notify();
  };

  const px = (el: HTMLElement | null, prop: 'offsetLeft' | 'offsetTop' | 'offsetWidth' | 'offsetHeight') =>
    el ? el[prop] : 0;

  const getRect = (comp: any) => {
    const el = comp.getEl() as HTMLElement | null;
    const left   = px(el, 'offsetLeft');
    const top    = px(el, 'offsetTop');
    const width  = px(el, 'offsetWidth')  || 1;
    const height = px(el, 'offsetHeight') || 1;
    return { comp, left, top, width, height,
      right: left + width, bottom: top + height,
      centerX: left + width / 2, centerY: top + height / 2 };
  };

  const requireMulti = (): ReturnType<typeof getRect>[] | null => {
    const items = getComponents().map(getRect);
    if (items.length < 2) return null;
    return items;
  };

  const setPos = (comp: any, left: number, top: number) => {
    comp.addStyle({ left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, position: 'absolute' });
  };

  const alignTop = () => {
    const items = requireMulti();
    if (!items) return;
    const minTop = Math.min(...items.map(i => i.top));
    items.forEach(i => setPos(i.comp, i.left, minTop));
  };

  const alignMiddle = () => {
    const items = requireMulti();
    if (!items) return;
    const avgCenterY = items.reduce((s, i) => s + i.centerY, 0) / items.length;
    items.forEach(i => setPos(i.comp, i.left, avgCenterY - i.height / 2));
  };

  const alignBottom = () => {
    const items = requireMulti();
    if (!items) return;
    const maxBottom = Math.max(...items.map(i => i.bottom));
    items.forEach(i => setPos(i.comp, i.left, maxBottom - i.height));
  };

  const alignLeft = () => {
    const items = requireMulti();
    if (!items) return;
    const minLeft = Math.min(...items.map(i => i.left));
    items.forEach(i => setPos(i.comp, minLeft, i.top));
  };

  const alignCenterH = () => {
    const items = requireMulti();
    if (!items) return;
    const avgCenterX = items.reduce((s, i) => s + i.centerX, 0) / items.length;
    items.forEach(i => setPos(i.comp, avgCenterX - i.width / 2, i.top));
  };

  const alignRight = () => {
    const items = requireMulti();
    if (!items) return;
    const maxRight = Math.max(...items.map(i => i.right));
    items.forEach(i => setPos(i.comp, maxRight - i.width, i.top));
  };

  const distributeH = () => {
    const items = requireMulti();
    if (!items || items.length < 3) return;
    const sorted = [...items].sort((a, b) => a.centerX - b.centerX);
    const first = sorted[0];
    const last  = sorted[sorted.length - 1];
    const span  = last.centerX - first.centerX;
    const step  = span / (sorted.length - 1);
    sorted.forEach((item, idx) => {
      const targetCenter = first.centerX + step * idx;
      setPos(item.comp, targetCenter - item.width / 2, item.top);
    });
  };

  const distributeV = () => {
    const items = requireMulti();
    if (!items || items.length < 3) return;
    const sorted = [...items].sort((a, b) => a.centerY - b.centerY);
    const first = sorted[0];
    const last  = sorted[sorted.length - 1];
    const span  = last.centerY - first.centerY;
    const step  = span / (sorted.length - 1);
    sorted.forEach((item, idx) => {
      const targetCenter = first.centerY + step * idx;
      setPos(item.comp, item.left, targetCenter - item.height / 2);
    });
  };

  const trackShift = (down: boolean) => { shiftHeld = down; };

  const onHostKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Shift') trackShift(true);
    if (e.key === 'Escape') clearSelection();
  };
  const onHostKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Shift') trackShift(false);
  };
  window.addEventListener('keydown', onHostKeyDown);
  window.addEventListener('keyup',   onHostKeyUp);

  editorInst.on('load', () => {
    try {
      const iframeDoc = (editorInst.Canvas.getFrameEl() as HTMLIFrameElement).contentDocument;
      if (!iframeDoc) return;
      iframeDoc.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Shift') trackShift(true);
        if (e.key === 'Escape') clearSelection();
      });
      iframeDoc.addEventListener('keyup', (e: KeyboardEvent) => {
        if (e.key === 'Shift') trackShift(false);
      });
    } catch { /* ignore */ }
  });

  editorInst.on('component:selected', (model: any) => {
    const wrapper = editorInst.DomComponents.getWrapper();
    if (!model || model === wrapper || model.get('locked')) return;

    if (shiftHeld) {
      const cid = model.cid as string;
      if (selectedCids.has(cid)) {
        selectedCids.delete(cid);
        const remaining = [...selectedCids];
        const next = remaining.length
          ? findByCid(wrapper, remaining[remaining.length - 1])
          : null;
        editorInst.select(next);
      } else {
        selectedCids.add(cid);
      }
    } else {
      selectedCids.clear();
      selectedCids.add(model.cid);
    }

    syncOutlines();
    notify();
  });

  editorInst.on('component:deselected', () => {
    if (!editorInst.getSelected() && selectedCids.size) {
      clearSelection();
    }
  });

  const commands: Record<string, () => void> = {
    'multi-align-top':      alignTop,
    'multi-align-middle':   alignMiddle,
    'multi-align-bottom':   alignBottom,
    'multi-align-left':     alignLeft,
    'multi-align-center-h': alignCenterH,
    'multi-align-right':    alignRight,
    'multi-distribute-h':   distributeH,
    'multi-distribute-v':   distributeV,
    'multi-clear-selection': clearSelection,
  };

  Object.entries(commands).forEach(([id, fn]) => {
    editorInst.Commands.add(id, { run: fn });
  });

  editorInst.MultiSelect = {
    getCount: () => selectedCids.size,
    getComponents,
    clearSelection,
  };

  return {
    cleanup: () => {
      window.removeEventListener('keydown', onHostKeyDown);
      window.removeEventListener('keyup',   onHostKeyUp);
      clearSelection();
      delete editorInst.MultiSelect;
    },
  };
}

// Row style helper (defined outside the plugin to keep create() readable)
function applyRowStyle(btn: HTMLButtonElement, isSelected: boolean) {
  Object.assign(btn.style, {
    display:     'block',
    width:       '100%',
    padding:     '7px 10px',
    background:  isSelected ? '#3f3f46' : 'none',
    border:      'none',
    color:       '#fafafa',
    cursor:      'pointer',
    borderRadius:'5px',
    textAlign:   'left',
    fontSize:    '14px',
    lineHeight:  '1.2',
  });
  btn.addEventListener('mouseenter', () => { if (!isSelected) btn.style.background = '#27272a'; });
  btn.addEventListener('mouseleave', () => { if (!isSelected) btn.style.background = 'none'; });
}

// ─── Sprint 3A: Layer Locking & Right-Click Context Menu ─────────────────────
//
// Context menu appears on right-click over any component in the canvas iframe.
// It is rendered in the HOST document so it is never clipped by the iframe edge.
//
// Menu items:
//   Bring to Front / Bring Forward / Send Backward / Send to Back  (z-index)
//   Duplicate (Ctrl+D)
//   Delete    (Del)
//   Lock / Unlock Layer (Ctrl+L) — prevents select / drag / resize
//   Copy Style / Paste Style
//
// Lock mechanics:
//   Locked components get data-locked="true" on their DOM element (for the
//   dashed-outline CSS indicator), and component.get('locked') === true in
//   the GrapesJS model.  component:selected immediately deselects them.
//   data-locked is kept in index.html on local save; stripped only on Export HTML.
//
function contextMenuPlugin(editorInst: any): { cleanup: () => void } {
  let menuEl: HTMLElement | null = null;
  let copiedStyles: Record<string, string> = {};

  // ── Dismiss menu on any interaction outside it ────────────────────────────
  const onDocMouseDown = (e: MouseEvent) => {
    if (menuEl && !menuEl.contains(e.target as Node)) removeMenu();
  };
  const onDocScroll = () => removeMenu();
  const onDocKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Control' && e.key !== 'Meta' && e.key !== 'Shift' && e.key !== 'Alt') {
      removeMenu();
    }
  };
  document.addEventListener('mousedown', onDocMouseDown);
  document.addEventListener('scroll',    onDocScroll, true);
  document.addEventListener('keydown',   onDocKeyDown);

  const removeMenu = () => { menuEl?.remove(); menuEl = null; menuTarget = null; };

  // ── Z-order helpers ───────────────────────────────────────────────────────
  const getZ  = (c: any) => parseInt(c.getStyle()['z-index'] || '0', 10);
  const allZs = () => {
    const wrapper = editorInst.DomComponents.getWrapper();
    return (wrapper?.find('*') ?? []).map(getZ);
  };

  // Target component for the open menu (supports layer-panel right-click on locked layers)
  let menuTarget: any = null;

  const getMenuTarget = () => {
    const wrapper = editorInst.DomComponents.getWrapper();
    const sel = menuTarget ?? editorInst.getSelected();
    if (!sel || sel === wrapper) return null;
    return sel;
  };

  // ── Action dispatcher ─────────────────────────────────────────────────────
  const execute = (key: string) => {
    const sel     = getMenuTarget();
    const wrapper = editorInst.DomComponents.getWrapper();
    if (!sel || sel === wrapper) return;

    switch (key) {
      case 'bring-front':
        sel.addStyle({ 'z-index': String(Math.max(...allZs(), 0) + 1) });
        break;
      case 'bring-forward':
        sel.addStyle({ 'z-index': String(getZ(sel) + 1) });
        break;
      case 'send-backward':
        sel.addStyle({ 'z-index': String(Math.max(0, getZ(sel) - 1)) });
        break;
      case 'send-back':
        sel.addStyle({ 'z-index': String(Math.min(...allZs(), 0) - 1) });
        break;
      case 'duplicate': {
        const clone = sel.clone();
        clone.addStyle({
          top:  `${parseFloat(clone.getStyle().top  || '0') + 16}px`,
          left: `${parseFloat(clone.getStyle().left || '0') + 16}px`,
        });
        sel.parent()?.append(clone);
        editorInst.select(clone);
        break;
      }
      case 'delete':
        sel.remove();
        break;
      case 'lock': {
        const isLocked = sel.get('locked') === true;
        const resizableOn = {
          ratioDefault: true,
          keepRatio: true,
          ratio: true,
          handles: ['tl', 'tr', 'bl', 'br'],
          step: 1,
          updateOnMove: true,
        };
        if (isLocked) {
          sel.set('locked',    false);
          sel.set('draggable', true);
          sel.set('resizable', resizableOn);
          sel.set('editable',  true);
          sel.removeAttributes('data-locked');
        } else {
          sel.set('locked',    true);
          sel.set('draggable', false);
          sel.set('resizable', false);
          sel.set('editable',  false);
          sel.addAttributes({ 'data-locked': 'true' });
          editorInst.select(null);   // immediately deselect
        }
        break;
      }
      case 'copy-style':
        copiedStyles = { ...sel.getStyle() };
        break;
      case 'paste-style':
        if (Object.keys(copiedStyles).length) sel.addStyle(copiedStyles);
        break;
      // Dispatched to commands registered by groupUngroupPlugin (Sprint 3B)
      case 'group':
        editorInst.runCommand('group-selection');
        break;
      case 'ungroup':
        editorInst.runCommand('ungroup-selection');
        break;
      case 'multi-align-top':
      case 'multi-align-middle':
      case 'multi-align-bottom':
      case 'multi-align-left':
      case 'multi-align-center-h':
      case 'multi-align-right':
      case 'multi-distribute-h':
      case 'multi-distribute-v':
        editorInst.runCommand(key);
        break;
    }
  };

  // ── Build and show the menu at host-document coordinates ──────────────────
  const showMenu = (hostX: number, hostY: number, targetComponent?: any) => {
    removeMenu();
    const wrapper = editorInst.DomComponents.getWrapper();
    const sel = targetComponent ?? editorInst.getSelected();
    if (!sel || sel === wrapper) return;

    menuTarget = sel;
    const multiComps = editorInst.MultiSelect?.getComponents?.() ?? [];
    const preserveMulti =
      !!targetComponent &&
      multiComps.length >= 2 &&
      multiComps.some((c: any) => c.cid === sel.cid);
    if (!sel.get('locked') && !preserveMulti) editorInst.select(sel);

    const isLocked  = sel.get('locked') === true;
    const isGroup   = sel.get('attributes')?.['data-group'] === 'true';
    const multiCount = editorInst.MultiSelect?.getCount?.() ?? 0;

    const ITEMS: Array<
      | { type: 'sep' }
      | { label: string; key: string; hint?: string; danger?: boolean }
    > = [
      { label: '⬆ Bring to Front',   key: 'bring-front' },
      { label: '↑ Bring Forward',     key: 'bring-forward', hint: 'Ctrl+]' },
      { label: '↓ Send Backward',     key: 'send-backward', hint: 'Ctrl+[' },
      { label: '⬇ Send to Back',      key: 'send-back' },
      { type: 'sep' },
      { label: '⧉ Duplicate',         key: 'duplicate',     hint: 'Ctrl+D' },
      { label: '🗑 Delete',            key: 'delete',        hint: 'Del', danger: true },
      { type: 'sep' },
      { label: isLocked ? '🔓 Unlock Layer' : '🔒 Lock Layer', key: 'lock', hint: 'Ctrl+L' },
      { type: 'sep' },
      // Sprint 3B — group / ungroup
      ...(isGroup
        ? [{ label: '⬡ Ungroup',      key: 'ungroup', hint: 'Ctrl+Shift+G' } as const]
        : [{ label: multiCount >= 2 ? '⬡ Group Layers' : '⬡ Group Layer', key: 'group', hint: 'Ctrl+G' } as const]),
      { type: 'sep' },
      { label: '🎨 Copy Style',        key: 'copy-style' },
      ...(Object.keys(copiedStyles).length
        ? [{ label: '📋 Paste Style', key: 'paste-style' } as const]
        : []),
      ...(multiCount >= 2
        ? [
            { type: 'sep' } as const,
            { label: '⇡ Align Tops',            key: 'multi-align-top' },
            { label: '⊞ Align Vertical Centers', key: 'multi-align-middle' },
            { label: '⇣ Align Bottoms',          key: 'multi-align-bottom' },
            { label: '⇤ Align Lefts',            key: 'multi-align-left' },
            { label: '⊟ Align Horizontal Centers', key: 'multi-align-center-h' },
            { label: '⇥ Align Rights',           key: 'multi-align-right' },
            { label: '⋮≡ Distribute Horizontally', key: 'multi-distribute-h' },
            { label: '≡⋮ Distribute Vertically',   key: 'multi-distribute-v' },
          ]
        : []),
    ];

    menuEl = document.createElement('div');
    Object.assign(menuEl.style, {
      position:   'fixed',
      top:        `${hostY}px`,
      left:       `${hostX}px`,
      zIndex:     '2147483647',
      background: '#1f1f23',
      border:     '1px solid #3f3f46',
      borderRadius: '8px',
      padding:    '4px',
      minWidth:   '210px',
      boxShadow:  '0 12px 40px rgba(0,0,0,0.6)',
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      fontSize:   '12.5px',
      userSelect: 'none',
    });

    for (const item of ITEMS) {
      if ('type' in item) {
        const sep = document.createElement('div');
        Object.assign(sep.style, { height: '1px', background: '#27272a', margin: '3px 4px' });
        menuEl.appendChild(sep);
        continue;
      }

      const row = document.createElement('button');
      row.innerHTML = `<span style="flex:1;text-align:left">${item.label}</span>${
        item.hint ? `<span style="opacity:.4;font-size:10px;font-variant-numeric:tabular-nums">${item.hint}</span>` : ''
      }`;
      Object.assign(row.style, {
        display:       'flex',
        alignItems:    'center',
        width:         '100%',
        padding:       '6px 10px',
        background:    'none',
        border:        'none',
        color:         item.danger ? '#f87171' : '#fafafa',
        cursor:        'pointer',
        borderRadius:  '5px',
        gap:           '6px',
      });
      row.addEventListener('mouseenter', () => { row.style.background = '#27272a'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'none'; });
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        execute(item.key);
        removeMenu();
      });
      menuEl.appendChild(row);
    }

    document.body.appendChild(menuEl);

    // Clamp to viewport so the menu never clips off screen
    const r = menuEl.getBoundingClientRect();
    if (r.right  > window.innerWidth)  menuEl.style.left = `${window.innerWidth  - r.width  - 8}px`;
    if (r.bottom > window.innerHeight) menuEl.style.top  = `${window.innerHeight - r.height - 8}px`;
  };

  // ── Wire up iframe listeners once canvas is ready ─────────────────────────
  editorInst.on('load', () => {
    let iframeDoc: Document;
    try {
      iframeDoc = editorInst.Canvas.getBody().ownerDocument as Document;
    } catch {
      return;
    }

    // Right-click — convert iframe-local coords to host-document coords
    iframeDoc.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const frameBCR = (editorInst.Canvas.getFrameEl() as HTMLIFrameElement).getBoundingClientRect();
      showMenu(frameBCR.left + e.clientX, frameBCR.top + e.clientY);
    });

    // Ctrl+L — toggle lock on selected component
    iframeDoc.addEventListener('keydown', (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        execute('lock');
      }
    });
  });

  // Deselect locked components the moment they get selected
  editorInst.on('component:selected', (model: any) => {
    if (model?.get('locked')) editorInst.select(null);
  });

  // Register a GrapesJS command for toolbar button integration
  editorInst.Commands.add('toggle-lock', {
    run(ed: any) { execute('lock'); },
  });

  editorInst.ContextMenu = {
    showAt: (hostX: number, hostY: number, component?: any) => showMenu(hostX, hostY, component),
    dismiss: removeMenu,
  };

  return {
    cleanup() {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('scroll',    onDocScroll, true);
      document.removeEventListener('keydown',   onDocKeyDown);
      removeMenu();
      delete editorInst.ContextMenu;
    },
  };
}

// ─── Sprint 3B: Group / Ungroup ──────────────────────────────────────────────
//
// Group (Ctrl+G):
//   Wraps the selected component in a new absolutely-positioned <div> (the
//   "group").  The group takes the selected component's rendered position and
//   size; the wrapped component is reset to left:0/top:0 inside the group.
//
// Ungroup (Ctrl+Shift+G):
//   Lifts all children of a group back into the group's parent, offsetting each
//   child's position by the group's own rendered position so they land in
//   exactly the same spot on the canvas.  The empty group wrapper is then
//   removed.
//
// Integration:
//   • Registers GrapesJS commands "group-selection" and "ungroup-selection"
//     so contextMenuPlugin and the toolbar buttons can call them.
//   • Ctrl+G / Ctrl+Shift+G listeners are wired on both the iframe document
//     and the host window for reliability.
//
function groupUngroupPlugin(editorInst: any): { cleanup: () => void } {
  // ── Helper: read rendered px offset of a component's element ─────────────
  const px = (el: HTMLElement | null, prop: 'offsetLeft' | 'offsetTop' | 'offsetWidth' | 'offsetHeight') =>
    el ? el[prop] : 0;

  const groupOne = (sel: any, parent: any) => {
    const el    = sel.getEl() as HTMLElement | null;
    const left  = px(el, 'offsetLeft');
    const top   = px(el, 'offsetTop');
    const w     = px(el, 'offsetWidth')  || 100;
    const h     = px(el, 'offsetHeight') || 100;
    const idx   = parent.components().indexOf(sel);

    const childJson: any = sel.toJSON();
    childJson.style = { ...(childJson.style || {}), left: '0px', top: '0px' };

    sel.remove();

    const group = parent.components().add({
      tagName:    'div',
      name:       'Group',
      attributes: { 'data-group': 'true' },
      style: {
        position: 'absolute',
        left:     `${left}px`,
        top:      `${top}px`,
        width:    `${w}px`,
        height:   `${h}px`,
      },
      components: [childJson],
    }, { at: Math.max(0, idx) });

    editorInst.select(group);
    editorInst.MultiSelect?.clearSelection?.();
    editorInst.trigger('layer:group', { count: 1 });
    console.log(`📦 Grouped component at (${left}px, ${top}px) ${w}×${h}`);
  };

  const groupMultiple = (components: any[]) => {
    const parent = components[0]?.parent();
    if (!parent) return;
    if (!components.every((c) => c.parent() === parent)) return;

    let minLeft = Infinity;
    let minTop = Infinity;
    let maxRight = -Infinity;
    let maxBottom = -Infinity;

    components.forEach((comp) => {
      const el = comp.getEl() as HTMLElement | null;
      const left = px(el, 'offsetLeft');
      const top = px(el, 'offsetTop');
      const w = px(el, 'offsetWidth') || 1;
      const h = px(el, 'offsetHeight') || 1;
      minLeft = Math.min(minLeft, left);
      minTop = Math.min(minTop, top);
      maxRight = Math.max(maxRight, left + w);
      maxBottom = Math.max(maxBottom, top + h);
    });

    const indices = components.map((c) => parent.components().indexOf(c));
    const at = Math.max(0, Math.min(...indices));

    const childrenJson = components
      .sort((a, b) => parent.components().indexOf(a) - parent.components().indexOf(b))
      .map((comp) => {
        const el = comp.getEl() as HTMLElement | null;
        const childLeft = px(el, 'offsetLeft') - minLeft;
        const childTop = px(el, 'offsetTop') - minTop;
        const json: any = comp.toJSON();
        json.style = {
          ...(json.style || {}),
          position: 'absolute',
          left: `${childLeft}px`,
          top: `${childTop}px`,
        };
        return json;
      });

    components
      .sort((a, b) => parent.components().indexOf(b) - parent.components().indexOf(a))
      .forEach((comp) => comp.remove());

    const group = parent.components().add({
      tagName:    'div',
      name:       'Group',
      attributes: { 'data-group': 'true' },
      style: {
        position: 'absolute',
        left:     `${minLeft}px`,
        top:      `${minTop}px`,
        width:    `${Math.max(maxRight - minLeft, 10)}px`,
        height:   `${Math.max(maxBottom - minTop, 10)}px`,
      },
      components: childrenJson,
    }, { at });

    editorInst.select(group);
    editorInst.MultiSelect?.clearSelection?.();
    editorInst.trigger('layer:group', { count: childrenJson.length });
    console.log(`📦 Grouped ${childrenJson.length} layers`);
  };

  // ── Group ─────────────────────────────────────────────────────────────────
  const groupSelected = () => {
    const multi = editorInst.MultiSelect?.getComponents?.() ?? [];
    if (multi.length >= 2) {
      groupMultiple(multi);
      return;
    }

    const sel      = editorInst.getSelected();
    const rootWrap = editorInst.DomComponents.getWrapper();
    if (!sel || sel === rootWrap) return;

    const parent = sel.parent();
    if (!parent) return;

    groupOne(sel, parent);
  };

  // ── Ungroup ───────────────────────────────────────────────────────────────
  const ungroupSelected = () => {
    const sel      = editorInst.getSelected();
    const rootWrap = editorInst.DomComponents.getWrapper();
    if (!sel || sel === rootWrap) return;
    if (sel.get('attributes')?.['data-group'] !== 'true') return;

    const parent = sel.parent();
    if (!parent) return;

    const groupEl   = sel.getEl() as HTMLElement | null;
    const groupLeft = px(groupEl, 'offsetLeft');
    const groupTop  = px(groupEl, 'offsetTop');
    const idx       = parent.components().indexOf(sel);

    // Snapshot children BEFORE removing the group (once removed, getEl() is gone)
    const childrenJson: any[] = sel.components().models.map((child: any) => {
      const childEl   = child.getEl() as HTMLElement | null;
      const childLeft = px(childEl, 'offsetLeft');
      const childTop  = px(childEl, 'offsetTop');
      const json: any = child.toJSON();
      json.style = {
        ...(json.style || {}),
        position: 'absolute',
        left:     `${groupLeft + childLeft}px`,
        top:      `${groupTop  + childTop}px`,
      };
      return json;
    });

    sel.remove();   // remove the group wrapper

    let lastAdded: any = null;
    childrenJson.forEach((json, i) => {
      lastAdded = parent.components().add(json, { at: idx + i });
    });

    if (lastAdded) editorInst.select(lastAdded);
    editorInst.MultiSelect?.clearSelection?.();
    editorInst.trigger('layer:ungroup', { count: childrenJson.length });
    console.log(`📤 Ungrouped ${childrenJson.length} component(s) at (${groupLeft}px, ${groupTop}px)`);
  };

  // ── Register as GrapesJS commands ────────────────────────────────────────
  editorInst.Commands.add('group-selection',   { run: groupSelected });
  editorInst.Commands.add('ungroup-selection', { run: ungroupSelected });

  // ── Wire keyboard shortcuts ───────────────────────────────────────────────
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.key !== 'g') return;
    // Prevent browser from opening "Find in bookmarks" (Ctrl+G in Firefox)
    e.preventDefault();
    if (e.shiftKey) ungroupSelected();
    else            groupSelected();
  };

  // Host window (for when focus is outside the iframe)
  window.addEventListener('keydown', onKey);

  // Iframe (fired when the user is working inside the canvas)
  editorInst.on('load', () => {
    try {
      const iframeDoc = editorInst.Canvas.getBody().ownerDocument as Document;
      iframeDoc.addEventListener('keydown', onKey);
    } catch { /* ignore if iframe not ready */ }
  });

  return {
    cleanup() {
      window.removeEventListener('keydown', onKey);
      // Iframe listeners are GC'd with the iframe when editor.destroy() runs
    },
  };
}

// ─── Sprint 1: Keyboard Shortcuts & Alt+Resize (Center-Origin Scaling) ───────
//
// This plugin handles ALL keyboard interactions that require iframe-context access
// plus Alt+Resize (Photoshop-style center-origin scaling).
//
// Architecture:
//   - altHeld / resizeStart are module-scoped via closure so component:selected's
//     updateTarget callback (set up later) can close over the live values.
//   - Everything inside editor.on('load') runs once the iframe is ready.
//   - Host-window Alt tracking handles the case where the iframe does not have
//     keyboard focus (e.g., user just finished using a panel).
//   - cleanup() removes only host-window listeners; iframe listeners are
//     garbage-collected when editor.destroy() removes the iframe.
//
// Shortcuts registered:
//   Ctrl+S             — Save
//   Ctrl+Z             — Undo
//   Ctrl+Y / Ctrl+Shift+Z — Redo
//   Delete / Backspace — Delete selected component
//   Ctrl+D             — Duplicate selected component (offset +16px)
//   Ctrl+A             — Select first child (foundation for multi-select)
//   Ctrl+]             — Bring forward (z-index +1)
//   Ctrl+[             — Send backward  (z-index -1)
//   Escape             — Deselect / exit text edit
//   Arrow keys         — Nudge 1px (Shift = 10px)
//   Space + drag       — Pan canvas
//   Ctrl+Scroll        — Zoom in / out
//   Alt (held)         — Activates center-origin resize mode
//
function keyboardAndResizePlugin(
  editorInst: any,
  callbacks: { onZoomChange: (z: number) => void; onSave: () => void },
): {
  readonly altHeld: boolean;
  readonly resizeStart: { left: number; top: number; w: number; h: number } | null;
  cleanup: () => void;
} {
  let altHeld = false;
  let spaceHeld = false;
  let resizeStart: { left: number; top: number; w: number; h: number } | null = null;
  let onHostArrowNudge: ((e: KeyboardEvent) => void) | null = null;

  // ── Host-window Alt tracking ─────────────────────────────────────────────
  // Covers the case where focus is in a GrapesJS panel (not the iframe).
  const onHostKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Alt') { e.preventDefault(); altHeld = true; }
    const ctrl = e.ctrlKey || e.metaKey;
    const target = e.target as HTMLElement;
    const isTyping = target?.isContentEditable ||
                     target?.tagName === 'INPUT' ||
                     target?.tagName === 'TEXTAREA';
    if (ctrl && e.key === 'z' && !e.shiftKey && !isTyping) {
      e.preventDefault();
      editorInst.UndoManager.undo();
    } else if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !isTyping) {
      e.preventDefault();
      editorInst.UndoManager.redo();
    }
  };
  const onHostKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Alt') altHeld = false;
  };
  // Safety reset: if window loses focus mid-operation, release all modifiers.
  const onHostBlur = () => { altHeld = false; spaceHeld = false; };
  window.addEventListener('keydown', onHostKeyDown);
  window.addEventListener('keyup',   onHostKeyUp);
  window.addEventListener('blur',    onHostBlur);

  // Clear resizeStart when mouse is released anywhere on the host window
  // (handles the edge case where mouseup fires outside the iframe).
  const onHostMouseUp = () => { resizeStart = null; };
  window.addEventListener('mouseup', onHostMouseUp);

  // ── Set up iframe-scoped listeners once the canvas iframe is ready ────────
  editorInst.on('load', () => {
    let iframeDoc: Document;
    try {
      iframeDoc = editorInst.Canvas.getBody().ownerDocument as Document;
    } catch (e) {
      console.warn('[keyboardPlugin] iframe not accessible:', e);
      return;
    }

    // ── Alt key tracking (iframe context) ──────────────────────────────────
    iframeDoc.addEventListener('keydown', (e) => {
      if (e.key === 'Alt') { e.preventDefault(); altHeld = true; }
    });
    iframeDoc.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') altHeld = false;
    });

    // ── Ctrl+Scroll zoom ────────────────────────────────────────────────────
    // Attached to the outer canvas wrapper so it fires even when the cursor
    // is over the iframe (the host document owns the scroll event for iframes
    // in most browsers, but attaching to both ensures coverage).
    const onScroll = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const current = (editorInst.Canvas.getZoom() as number) ?? 100;
      const delta   = e.deltaY < 0 ? 5 : -5;
      const next    = Math.max(30, Math.min(200, current + delta));
      editorInst.Canvas.setZoom(next);
      callbacks.onZoomChange(next);
    };
    try {
      const canvasEl = editorInst.Canvas.getElement() as HTMLElement;
      canvasEl.addEventListener('wheel', onScroll as EventListener, { passive: false });
    } catch (_) {}
    // Also listen on the iframe doc for when cursor is over the template.
    iframeDoc.addEventListener('wheel', onScroll as EventListener, { passive: false });

    // ── Spacebar canvas panning ─────────────────────────────────────────────
    iframeDoc.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (e.code === 'Space' && !e.repeat && !target?.isContentEditable) {
        e.preventDefault();
        spaceHeld = true;
        iframeDoc.body.style.cursor = 'grab';
      }
    });
    iframeDoc.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        spaceHeld = false;
        iframeDoc.body.style.cursor = '';
      }
    });
    iframeDoc.addEventListener('mousemove', (e: MouseEvent) => {
      if (!spaceHeld || e.buttons !== 1) return;
      iframeDoc.body.style.cursor = 'grabbing';
      try {
        const canvasEl = editorInst.Canvas.getElement() as HTMLElement;
        canvasEl.scrollLeft -= e.movementX;
        canvasEl.scrollTop  -= e.movementY;
      } catch (_) {}
    });
    iframeDoc.addEventListener('mouseup', () => {
      if (spaceHeld) iframeDoc.body.style.cursor = 'grab';
    });

    // ── Alt+Resize: capture element rect on handle mousedown ───────────────
    // Handles live on the host canvas overlay (gjs-resizer-h), not the iframe.
    const captureResizeStart = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target?.classList?.contains('gjs-resizer-h')) {
        resizeStart = null;
        return;
      }
      const selected = editorInst.getSelected();
      if (!selected) return;
      const el = selected.getEl() as HTMLElement;
      if (!el) return;
      const win = (editorInst.Canvas.getFrameEl() as HTMLIFrameElement)?.contentWindow;
      const cs = win?.getComputedStyle(el);
      resizeStart = {
        left: Math.round(parseFloat(cs?.left || '') || el.offsetLeft),
        top:  Math.round(parseFloat(cs?.top || '') || el.offsetTop),
        w:    el.offsetWidth,
        h:    el.offsetHeight,
      };
    };

    iframeDoc.addEventListener('mousedown', captureResizeStart, true);
    try {
      const canvasEl = editorInst.Canvas.getElement() as HTMLElement;
      canvasEl.addEventListener('mousedown', captureResizeStart, true);
    } catch { /* ignore */ }
    try {
      const resizerEl = editorInst.Canvas.getResizerEl?.() as HTMLElement | undefined;
      resizerEl?.addEventListener('mousedown', captureResizeStart, true);
    } catch { /* ignore */ }
    iframeDoc.addEventListener('mouseup', () => { resizeStart = null; });

    const isArrowKey = (key: string) =>
      key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';

    // ── General keyboard shortcuts (iframe-scoped) ──────────────────────────
    iframeDoc.addEventListener('keydown', (e: KeyboardEvent) => {
      const ctrl     = e.ctrlKey || e.metaKey;
      const target   = e.target as HTMLElement;
      const isTyping = target?.isContentEditable ||
                       target?.tagName === 'INPUT' ||
                       target?.tagName === 'TEXTAREA';

      // ── Ctrl+S — Save (always, even while typing) ──────────────────────
      if (ctrl && e.key === 's') {
        e.preventDefault();
        callbacks.onSave();
        return;
      }

      // ── Ctrl+Z — Undo ──────────────────────────────────────────────────
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        editorInst.UndoManager.undo();
        return;
      }

      // ── Ctrl+Y / Ctrl+Shift+Z — Redo ───────────────────────────────────
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        editorInst.UndoManager.redo();
        return;
      }

      // All shortcuts below must NOT fire when the user is typing in a text
      // component or input field.
      if (isTyping) return;

      const selected = editorInst.getSelected();
      const wrapper  = editorInst.DomComponents.getWrapper();

      // ── Escape — Deselect / exit text editing ───────────────────────────
      if (e.key === 'Escape') {
        if (editorInst.GuestPreview?.isActive?.()) return;
        e.preventDefault();
        if (selected) {
          try { (selected.getEl() as HTMLElement)?.blur(); } catch (_) {}
          editorInst.select(null);
        }
        return;
      }

      // ── Delete / Backspace — Delete selected component ──────────────────
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected && selected !== wrapper) {
          e.preventDefault();
          selected.remove();
        }
        return;
      }

      // ── Ctrl+D — Duplicate with 16px offset ────────────────────────────
      if (ctrl && e.key === 'd') {
        e.preventDefault();
        if (selected && selected !== wrapper) {
          const clone = selected.clone();
          const t = parseFloat(clone.getStyle().top  || '0');
          const l = parseFloat(clone.getStyle().left || '0');
          clone.addStyle({ top: `${t + 16}px`, left: `${l + 16}px` });
          selected.parent()?.append(clone);
          editorInst.select(clone);
        }
        return;
      }

      // ── Ctrl+A — Select first top-level child ──────────────────────────
      // Foundation for future multi-select; selects first visible child.
      if (ctrl && e.key === 'a') {
        e.preventDefault();
        const first = wrapper?.components().at(0);
        if (first) editorInst.select(first);
        return;
      }

      // ── Ctrl+] / Ctrl+[ — Z-index forward / backward ───────────────────
      if (ctrl && (e.key === ']' || e.key === '[')) {
        e.preventDefault();
        if (selected) {
          const z  = parseInt(selected.getStyle()['z-index'] || '0', 10);
          const nz = e.key === ']' ? z + 1 : Math.max(0, z - 1);
          selected.addStyle({ 'z-index': String(nz) });
        }
        return;
      }

      // ── Arrow keys — Nudge 1px / Shift = 10px (iframe focus) ───────────
      if (isArrowKey(e.key) && selected && selected !== wrapper) {
        e.preventDefault();
        e.stopPropagation();
        nudgeComponentPosition(editorInst, selected, e.key, e.shiftKey);
        return;
      }
    });

    // ── Arrow keys on host window (Layers panel / toolbar focus) ───────────
    // Capture phase so the canvas scroll container does not also consume arrows.
    onHostArrowNudge = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.isContentEditable ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT';

      if (isTyping || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!isArrowKey(e.key)) return;

      const selected = editorInst.getSelected();
      const wrapper = editorInst.DomComponents.getWrapper();
      if (!selected || selected === wrapper) return;

      e.preventDefault();
      e.stopPropagation();
      nudgeComponentPosition(editorInst, selected, e.key, e.shiftKey);
    };
    window.addEventListener('keydown', onHostArrowNudge, true);

    try {
      const canvasEl = editorInst.Canvas.getElement() as HTMLElement;
      canvasEl.addEventListener(
        'keydown',
        (e: KeyboardEvent) => {
          if (!isArrowKey(e.key)) return;
          const selected = editorInst.getSelected();
          const wrapper = editorInst.DomComponents.getWrapper();
          if (selected && selected !== wrapper) {
            e.preventDefault();
          }
        },
        true,
      );
    } catch {
      /* canvas not ready */
    }
  });

  return {
    get altHeld()    { return altHeld; },
    get resizeStart(){ return resizeStart; },
    cleanup() {
      window.removeEventListener('keydown', onHostKeyDown);
      window.removeEventListener('keyup',   onHostKeyUp);
      window.removeEventListener('blur',    onHostBlur);
      window.removeEventListener('mouseup', onHostMouseUp);
      if (onHostArrowNudge) window.removeEventListener('keydown', onHostArrowNudge, true);
    },
  };
}

// ─── Sprint 9: Full Guest Preview Mode ───────────────────────────────────────
//
// Immersive full-screen preview — hides all editor chrome, component outlines,
// rulers, and panels. Substitutes {{variables}} with preview values so the
// designer sees exactly what a guest would receive.
//
function previewModePlugin(
  editorInst: any,
  opts: { onChange?: (active: boolean) => void } = {},
): { cleanup: () => void } {
  let active = false;
  let exitBarEl: HTMLElement | null = null;
  let iframeStyleEl: HTMLStyleElement | null = null;
  let keyCapture: ((e: KeyboardEvent) => void) | null = null;

  const saved = {
    outline:    false,
    varsPanel:  false,
    panels:     new Map<string, boolean>(),
  };

  const notify = (on: boolean) => {
    opts.onChange?.(on);
    editorInst.trigger('guest-preview:change', { active: on });
  };

  const injectIframeChromeHide = () => {
    try {
      const iframeDoc = editorInst.Canvas.getBody()?.ownerDocument;
      const head = iframeDoc?.head;
      if (!iframeDoc || !head || head.querySelector('#ec-guest-preview-hide')) return;
      iframeStyleEl = iframeDoc.createElement('style');
      iframeStyleEl.id = 'ec-guest-preview-hide';
      iframeStyleEl.textContent = `
        [data-gjs-highlightable] { outline: none !important; outline-offset: 0 !important; }
        .gjs-selected, .gjs-hovered, .gjs-selected-parent { outline: none !important; box-shadow: none !important; }
        [data-gjs-var-placeholder="true"] { outline: none !important; }
        [data-locked="true"] { outline: none !important; opacity: 1 !important; }
        [data-locked="true"]::after { display: none !important; }
        .gjs-ms-selected { outline: none !important; }
        .gjs-toolbar, .gjs-badge, .gjs-com-badge, .gjs-com-badge-red { display: none !important; }
        #smart-guides-overlay { display: none !important; }
      `;
      head.appendChild(iframeStyleEl);
    } catch { /* ignore */ }
  };

  const removeIframeChromeHide = () => {
    try {
      const head = editorInst.Canvas.getBody()?.ownerDocument?.head;
      head?.querySelector('#ec-guest-preview-hide')?.remove();
    } catch { /* ignore */ }
    iframeStyleEl = null;
  };

  const buildExitBar = () => {
    exitBarEl = document.createElement('div');
    exitBarEl.id = 'ec-guest-preview-exit';
    Object.assign(exitBarEl.style, {
      position:      'fixed',
      top:           '20px',
      right:         '20px',
      zIndex:        '2147483646',
      display:       'flex',
      alignItems:    'center',
      gap:           '10px',
      padding:       '8px 10px 8px 14px',
      background:    'rgba(24, 24, 27, 0.92)',
      border:        '1px solid #3f3f46',
      borderRadius:  '12px',
      boxShadow:     '0 12px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04)',
      backdropFilter:'blur(12px)',
      fontFamily:    "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      color:         '#fafafa',
      userSelect:    'none',
      pointerEvents: 'auto',
    });

    const label = document.createElement('span');
    label.innerHTML = '<span style="color:#fbbf24;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Guest Preview</span>';
    label.style.fontSize = '11px';

    const hint = document.createElement('kbd');
    hint.textContent = 'Esc';
    Object.assign(hint.style, {
      fontSize:     '10px',
      padding:      '2px 6px',
      borderRadius: '4px',
      background:   '#27272a',
      border:       '1px solid #3f3f46',
      color:        '#a1a1aa',
      fontFamily:   'inherit',
    });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Exit Preview';
    Object.assign(btn.style, {
      padding:      '7px 14px',
      borderRadius: '8px',
      border:       'none',
      background:   '#fafafa',
      color:        '#18181b',
      fontSize:     '12px',
      fontWeight:   '600',
      cursor:       'pointer',
      transition:   'background 0.15s',
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = '#e4e4e7'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#fafafa'; });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      exitPreview();
    });

    exitBarEl.appendChild(label);
    exitBarEl.appendChild(hint);
    exitBarEl.appendChild(btn);
    document.body.appendChild(exitBarEl);
  };

  const removeExitBar = () => {
    exitBarEl?.remove();
    exitBarEl = null;
  };

  const bindKeyCapture = (on: boolean) => {
    const handler = (e: KeyboardEvent) => {
      if (!active) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        exitPreview();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        exitPreview();
      }
    };
    if (on) {
      keyCapture = handler;
      window.addEventListener('keydown', handler, true);
      try {
        const iframeDoc = (editorInst.Canvas.getFrameEl() as HTMLIFrameElement)?.contentDocument;
        iframeDoc?.addEventListener('keydown', handler, true);
      } catch { /* ignore */ }
    } else if (keyCapture) {
      window.removeEventListener('keydown', keyCapture, true);
      try {
        const iframeDoc = (editorInst.Canvas.getFrameEl() as HTMLIFrameElement)?.contentDocument;
        iframeDoc?.removeEventListener('keydown', keyCapture, true);
      } catch { /* ignore */ }
      keyCapture = null;
    }
  };

  const enterPreview = () => {
    if (active) return;
    active = true;

    editorInst.select(null);
    editorInst.MultiSelect?.clearSelection?.();

    saved.outline = editorInst.Commands.isActive('core:component-outline');
    if (saved.outline) editorInst.stopCommand('core:component-outline');

    saved.varsPanel = !!document.getElementById('gjs-variables-panel') &&
      (document.getElementById('gjs-variables-panel') as HTMLElement).style.display !== 'none';
    if (saved.varsPanel) editorInst.DynamicVariables?.togglePanel?.(false);

    saved.panels.clear();
    editorInst.Panels.getPanels().forEach((panel: any) => {
      const id = panel.get('id') || panel.id;
      if (id) {
        saved.panels.set(id, panel.get('visible') !== false);
        panel.set('visible', false);
      }
    });

    document.getElementById('gjs-variables-panel')?.style.setProperty('display', 'none', 'important');

    editorInst.getEl()?.classList.add('ec-gjs-guest-preview');
    document.querySelector('.ec-studio-dark')?.classList.add('ec-guest-preview-active');

    injectIframeChromeHide();
    editorInst.DynamicVariables?.enterGuestPreview?.();
    buildExitBar();
    bindKeyCapture(true);
    notify(true);

    // Replay entrance animations so the guest experience feels alive
    setTimeout(() => {
      try { editorInst.runCommand('preview-timeline-animations'); } catch { /* ignore */ }
    }, 350);
  };

  const exitPreview = () => {
    if (!active) return;
    active = false;

    bindKeyCapture(false);
    removeExitBar();
    removeIframeChromeHide();

    editorInst.getEl()?.classList.remove('ec-gjs-guest-preview');
    document.querySelector('.ec-studio-dark')?.classList.remove('ec-guest-preview-active');

    saved.panels.forEach((wasVisible, id) => {
      try {
        const panel = editorInst.Panels.getPanel(id);
        if (panel) panel.set('visible', wasVisible);
      } catch { /* ignore */ }
    });
    saved.panels.clear();

    if (saved.varsPanel) editorInst.DynamicVariables?.togglePanel?.(true);

    if (saved.outline) editorInst.runCommand('core:component-outline');

    editorInst.DynamicVariables?.releaseGuestPreview?.();
    notify(false);
  };

  editorInst.Commands.add('guest-preview-mode', {
    run(_ed: any, _s: any, opts: { active?: boolean } = {}) {
      const shouldEnter = opts.active !== undefined ? opts.active : !active;
      if (shouldEnter) enterPreview();
      else exitPreview();
    },
    stop() { exitPreview(); },
  });

  editorInst.GuestPreview = {
    isActive: () => active,
    enter: enterPreview,
    exit:  exitPreview,
  };

  // Host-window shortcut (iframe handled via capture listener when active)
  const onHostPreviewShortcut = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      editorInst.runCommand('guest-preview-mode');
    }
  };
  window.addEventListener('keydown', onHostPreviewShortcut);

  editorInst.on('load', () => {
    try {
      const iframeDoc = (editorInst.Canvas.getFrameEl() as HTMLIFrameElement).contentDocument;
      iframeDoc?.addEventListener('keydown', (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
          e.preventDefault();
          editorInst.runCommand('guest-preview-mode');
        }
      });
    } catch { /* ignore */ }
  });

  return {
    cleanup() {
      window.removeEventListener('keydown', onHostPreviewShortcut);
      exitPreview();
      delete editorInst.GuestPreview;
    },
  };
}

export function GrapesEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [templateLabel, setTemplateLabel] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const templateRefRef = useRef<BuilderTemplateRef | null>(null);
  const activeSyncKeyRef = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [multiSelectCount, setMultiSelectCount] = useState(0);
  const [guestPreviewActive, setGuestPreviewActive] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const ref = getBuilderTemplateRef();
      templateRefRef.current = ref;
      setTemplateLabel(ref.label);
      setTemplateKey(ref.templateKey);
    }
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;

    injectPremiumDarkTheme();

    const editor = grapesjs.init({
      container: editorRef.current,
      fromElement: true,
      height: '100%',
      width: '100%',
      dragMode: 'absolute',
      storageManager: false,
      selectorManager: { componentFirst: true },
      plugins: [webpagePreset, blocksBasic, grapesjsImageEditor, smartGuidesPlugin, googleFontsPlugin],
      pluginsOpts: {
        [webpagePreset as any]: {},
        [blocksBasic as any]: {
          blocks: ['column1', 'column2', 'column3', 'column3-7', 'text', 'link', 'image', 'video', 'map'],
        },
        [grapesjsImageEditor as any]: {
          config: { includeUI: { initMenu: 'filter' } },
        },
      },
      canvas: {
        snap: true,
        snapDist: 25,
      },

      // ─── Asset Manager (Sprint 2: Local-First Upload) ─────────────────────
      // Disable the built-in AJAX upload; we replace it with a custom
      // uploadFile function (set up below) that POSTs to our local API and
      // returns a permanent disk-based URL instead of a volatile blob:.
      assetManager: {
        upload:       false,   // no default AJAX upload URL
        showUrlInput: true,    // keep "URL" tab so users can paste remote links
        autoAdd:      true,    // auto-add assets returned by uploadFile
      },

      // Style Manager: use GrapesJS + webpagePreset defaults; custom sectors merged via styleManagerConfigPlugin

      // ─── Device Manager — 9:16 portrait per device ───────────────────────
      deviceManager: getDeviceManagerConfig(),
    });

    setEditorInstance(editor);

    const templateRefOnInit = getBuilderTemplateRef();
    setupEditorWorkspace(editor, {
      hasExternalTemplate: hasBuilderTemplateTarget(templateRefOnInit),
      onZoomChange: (z) => setZoom(z),
    });

    // ─── Sprint 1: Register keyboard shortcuts & Alt+Resize ───────────────
    // Must be called before any component:selected or load handlers so that
    // altResizeState is available in their closures.
    const altResizeState = keyboardAndResizePlugin(editor, {
      onZoomChange: (z) => setZoom(z),
      onSave:       () => handleSaveLocalRef.current?.(),
    });

    // ─── Dimensions: Style Manager sync, ratio lock, reset, Alt+resize ─────
    const dimensionState = dimensionPlugin(editor, altResizeState);
    const layoutDebugState = setupLayerPipelineDebug(editor);

    // ─── Sprint 3A: Right-click context menu & layer locking ──────────────
    const ctxMenuState = contextMenuPlugin(editor);

    // ─── Sprint 3B: Group / Ungroup ───────────────────────────────────────
    const groupState = groupUngroupPlugin(editor);

    // ─── Sprint 8: Premium dark theme ───────────────────────────────────
    const themeState = premiumDarkThemePlugin(editor);

    // ─── Sprint 5: Dynamic Variables panel ────────────────────────────────
    const dynVarsState = dynamicVariablesPlugin(editor);

    // ─── Sprint 6: Entrance animations ──────────────────────────────────
    const animState = entranceAnimationsPlugin(editor);

    // ─── Sprint 13: Text gradient fill ────────────────────────────────────
    const textGradientState = textGradientPlugin(editor);

    // ─── Sprint 12: Countdown Timer ───────────────────────────────────────
    const countdownState = countdownTimerPlugin(editor);

    // ─── Sprint 10+17: Custom React Layers Panel ──────────────────────────
    const customLayersState = customLayersPlugin(editor);

    // ─── Sprint 14+15: Pro image controls & advanced shadow ───────────────
    const proImageStylesState = proImageStylesPlugin(editor);

    // ─── Merge custom Style Manager sectors into GrapesJS defaults ─────────
    const styleMgrState = styleManagerConfigPlugin(editor);

    // ─── Sprint 7: Multi-select alignment ─────────────────────────────────
    const multiSelectState = multiSelectAlignPlugin(editor);

    // ─── Sprint 9: Full guest preview mode ────────────────────────────────
    const previewState = previewModePlugin(editor, {
      onChange: (active) => setGuestPreviewActive(active),
    });

    // ─── Track selection state ─────────────────────────────────────────
    editor.on('component:selected', () => setHasSelection(true));
    editor.on('component:deselected', () => setHasSelection(false));
    editor.on('multiselect:change', (data: { count?: number }) => {
      setMultiSelectCount(data?.count ?? 0);
    });

    // ─── Alignment Commands ─────────────────────────────────────────
    editor.Commands.add('align-left', {
      run(ed) {
        alignSelectedHorizontal(ed, 'left');
      },
    });

    editor.Commands.add('align-center', {
      run(ed) {
        alignSelectedHorizontal(ed, 'center');
      },
    });

    editor.Commands.add('align-right', {
      run(ed) {
        alignSelectedHorizontal(ed, 'right');
      },
    });

    // ─── Track Undo/Redo state ────────────────────────────────────────────
    const updateUndoRedo = () => {
      setCanUndo(editor.UndoManager.hasUndo());
      setCanRedo(editor.UndoManager.hasRedo());
    };
    editor.on(
      'component:add component:remove component:update style:add style:update update undo redo',
      updateUndoRedo,
    );
    editor.on('load', () => {
      requestAnimationFrame(() => updateUndoRedo());
    });

    // ─── Unified Layer Naming Helper ──────────────────────────────────────
    // ═══ 100% EXACT LAYER NAMING FOR IMAGES ════════════════════════════════════
    // Robust naming system that extracts exact original filenames from uploaded files
    
    const renameComponent = (component: any) => {
      const attrs = component.get('attributes') || {};
      const id = attrs.id;
      const className = attrs.class;
      const tagName = component.get('tagName');
      
      // Priority 1: Use ID if present
      if (id) {
        component.set('name', id);
        return;
      }
      
      // Priority 2: Image components - get EXACT filename
      if (component.get('type') === 'image') {
        const src = component.get('src');
        if (!src) {
          component.set('name', 'Image');
          return;
        }
        
        let cleanName = '';
        
        // Method 1: Lookup in AssetManager (most reliable for uploaded files)
        try {
          const assets = editor.AssetManager.getAll();
          const asset = assets.find((a: any) => {
            const assetSrc = a.get('src');
            return assetSrc === src || assetSrc?.includes(src) || src?.includes(assetSrc);
          });
          
          if (asset) {
            // Try multiple properties to get original filename
            const originalName = asset.get('name') || 
                                asset.get('filename') || 
                                asset.get('originalName') ||
                                (asset.get('file') && asset.get('file').name);
            
            if (originalName && !originalName.startsWith('blob:')) {
              cleanName = originalName.replace(/\.[^/.]+$/, ''); // Remove extension
            }
          }
        } catch (e) {
          console.warn('AssetManager lookup failed:', e);
        }
        
        // Method 2: Parse from URL/path (fallback for external URLs)
        if (!cleanName && !src.startsWith('data:') && !src.startsWith('blob:')) {
          try {
            const filename = src.split('/').pop()?.split('?')[0]?.split('#')[0];
            if (filename && filename.length > 0) {
              cleanName = filename.replace(/\.[^/.]+$/, '');
            }
          } catch (e) {
            console.warn('URL parsing failed:', e);
          }
        }
        
        // Set name or fallback to 'Image'
        if (cleanName && cleanName.length > 0 && !cleanName.startsWith('blob')) {
          component.set('name', cleanName);
          console.log(`📷 Named image layer: "${cleanName}" from src: ${src.substring(0, 50)}...`);
        } else {
          component.set('name', 'Image');
        }
        return;
      }
      
      // Priority 3: SVG components
      if (tagName === 'svg') {
        if (className) {
          component.set('name', className.split(' ')[0]);
        } else {
          component.set('name', 'Vector Graphic');
        }
        return;
      }
    };
    
    // Hook into component lifecycle events
    editor.on('component:add', renameComponent);
    editor.on('component:update:src', renameComponent);
    editor.on('component:update:attributes:src', renameComponent);
    editor.on('component:update:attributes:class', renameComponent);

    // ═══ INTERCEPT FILE UPLOADS - GUARANTEED NAMING ════════════════════════════
    // This ensures images are named IMMEDIATELY when uploaded, before any other processing
    
    editor.on('asset:add', (asset: any) => {
      try {
        const src = asset.get('src');
        
        // Extract original filename from multiple possible sources
        let originalName = asset.get('name') || 
                          asset.get('filename') || 
                          asset.get('originalName');
        
        // If name is not set, try to get it from the File object
        if (!originalName && asset.get('file')) {
          const file = asset.get('file');
          originalName = file.name || file.filename;
        }
        
        if (!src || !originalName) {
          console.warn('Asset added without proper src or name:', asset);
          return;
        }
        
        // Clean the filename (remove extension)
        const cleanName = originalName.replace(/\.[^/.]+$/, '');
        
        console.log(`📦 Asset uploaded: "${originalName}" → Layer name: "${cleanName}"`);
        
        // Force update all image components that match this asset's src
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
          const wrapper = editor.DomComponents.getWrapper();
          if (!wrapper) return;
          
          // Find all components with this src
          const matchingComps = wrapper.find('*').filter((c: any) => {
            if (c.get('type') !== 'image') return false;
            const compSrc = c.get('src');
            return compSrc === src || compSrc?.includes(src) || src?.includes(compSrc);
          });
          
          matchingComps.forEach((c: any) => {
            c.set('name', cleanName);
            console.log(`✅ Updated image component name to: "${cleanName}"`);
          });
        }, 100);
        
      } catch (e) {
        console.error('Error in asset:add handler:', e);
      }
    });

    // ═══ SPRINT 2: LOCAL-FIRST ASSET MANAGEMENT ════════════════════════════════
    //
    // Problem: GrapesJS uses blob: URLs for uploaded images. These are
    // volatile — they die on page refresh, breaking all canvas assets.
    //
    // Solution: Intercept every file that enters the editor (via the Asset
    // Manager panel OR via direct canvas drop) and immediately POST it to
    // our local API which writes it to ../[slug]/assets/ on disk. The
    // response carries a permanent /api/local-sync/assets/... URL that
    // survives refreshes, survives gjs-project.json round-trips, and is
    // rewritten to a clean relative `assets/filename` path in the saved
    // index.html (see sanitizeHtmlBeforeSave — editor metadata kept for two-way sync).
    //
    // Two interception points:
    //   1. editor.AssetManager.config.uploadFile — fires when the user
    //      selects files via the AM panel upload button or drops onto the
    //      AM panel.
    //   2. component:add listener — catches images dropped directly onto
    //      the canvas which GrapesJS creates with a blob: src before
    //      consulting the AssetManager at all.

    /** Upload a single File to local disk; resolves to the asset descriptor or null on failure. */
    const uploadFileToLocal = async (
      file: File,
    ): Promise<{ url: string; name: string; filename: string } | null> => {
      const formData = new FormData();
      formData.append('file', file);
      const uploadRef = templateRefRef.current ?? getBuilderTemplateRef();
      const uploadFields = getBuilderUploadFormFields({
        ...uploadRef,
        templateKey: activeSyncKeyRef.current || uploadRef.templateKey,
      });
      Object.entries(uploadFields).forEach(([key, value]) => formData.append(key, value));

      const res = await fetch('/api/local-sync/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload HTTP ${res.status}`);
      if (data.error) throw new Error(data.error);
      return { url: data.url, name: data.name, filename: data.filename };
    };

    // ── 1. Override Asset Manager panel uploads ──────────────────────────────
    // GrapesJS calls config.uploadFile(e) instead of POSTing to config.upload
    // when uploadFile is defined. `e` is the native DOM change event from
    // the hidden <input type="file"> inside the AM modal.
    (editor.AssetManager as any).config.uploadFile = (e: Event) => {
      const input = e.target as HTMLInputElement;
      const files = Array.from(input?.files ?? []);
      if (!files.length) return;

      files.forEach(async (file: File) => {
        try {
          const asset = await uploadFileToLocal(file);
          if (!asset) return;
          // Add to AssetManager with the original name → asset:add fires next
          // and the exact-naming handler picks up asset.get('name').
          editor.AssetManager.add({
            src:  asset.url,
            name: asset.name,    // original filename with extension
            type: 'image',
          });
          console.log(`📁 Asset panel upload: "${asset.name}" → ${asset.url}`);
        } catch (err: any) {
          console.error(`❌ AM upload failed for "${file.name}":`, err.message);
        }
      });
    };

    // ── 2. Canvas file-drop (capture phase — before GrapesJS SVG placeholder) ─
    let canvasDropCleanup: (() => void) | null = null;

    const attachCanvasDropHandlers = () => {
      try {
        const iframeDoc = editor.Canvas.getBody()?.ownerDocument as Document | undefined;
        const frameEl = editor.Canvas.getFrameEl() as HTMLIFrameElement | null;
        if (!iframeDoc || !frameEl) return;

        const onDragOver = (e: DragEvent) => {
          if ([...(e.dataTransfer?.types ?? [])].includes('Files')) {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
          }
        };

        const onDrop = async (e: DragEvent) => {
          const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
          if (!files.length) return;

          e.preventDefault();
          e.stopImmediatePropagation();

          const zoom = (editor.Canvas.getZoom?.() ?? 100) / 100;
          const frameRect = frameEl.getBoundingClientRect();
          const dropX = Math.round((e.clientX - frameRect.left) / zoom);
          const dropY = Math.round((e.clientY - frameRect.top) / zoom);

          for (const file of files) {
            try {
              const asset = await uploadFileToLocal(file);
              if (!asset) continue;

              editor.AssetManager.add({ src: asset.url, name: asset.name, type: 'image' });

              const dropTarget = findDropTarget(editor);
              const added = dropTarget?.append({
                type: 'image',
                tagName: 'img',
                src: asset.url,
                attributes: { src: asset.url, alt: asset.name },
                style: {
                  position: 'absolute',
                  left: `${dropX}px`,
                  top: `${dropY}px`,
                },
                name: asset.name.replace(/\.[^/.]+$/, ''),
              });
              if (added) {
                syncDroppedImageComponent(editor, added, asset.url);
                editor.select(added);
              }
              console.log(`🖼 Canvas drop: "${asset.name}" → ${asset.url}`);
            } catch (err: any) {
              console.error('❌ Canvas drop upload failed:', err.message);
            }
          }
        };

        iframeDoc.addEventListener('dragover', onDragOver, true);
        iframeDoc.addEventListener('drop', onDrop, true);
        canvasDropCleanup = () => {
          iframeDoc.removeEventListener('dragover', onDragOver, true);
          iframeDoc.removeEventListener('drop', onDrop, true);
        };
      } catch { /* ignore */ }
    };

    editor.on('load', attachCanvasDropHandlers);

    // ── 3. Fix blob/data/placeholder image components GrapesJS still creates ─
    editor.on('component:add', async (component: any) => {
      const tag = String(component.get('tagName') || '').toLowerCase();
      const attrs = component.getAttributes?.() || component.get('attributes') || {};
      let src = (component.get('src') as string | undefined) || attrs.src;

      const attrSrc = typeof attrs.src === 'string' ? attrs.src : '';
      if (
        attrSrc &&
        !attrSrc.startsWith('blob:') &&
        !isPlaceholderImageSrc(attrSrc) &&
        isPlaceholderImageSrc(src)
      ) {
        syncDroppedImageComponent(editor, component, attrSrc);
        return;
      }

      const isBlobOrData =
        typeof src === 'string' &&
        (src.startsWith('blob:') || src.startsWith('data:image'));

      if (!isBlobOrData) {
        if (tag === 'svg' && !src) {
          setTimeout(() => {
            try {
              if (String(component.get('tagName') || '').toLowerCase() === 'svg' && !component.get('src')) {
                component.remove();
              }
            } catch { /* ignore */ }
          }, 80);
        }
        return;
      }

      if (component.get('type') !== 'image' || tag !== 'img') {
        component.set('type', 'image');
        component.set('tagName', 'img');
      }

      try {
        const blobRes = await fetch(src);
        const blob = await blobRes.blob();
        const mimeExt = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
        const fileName = `canvas_drop_${Date.now()}.${mimeExt}`;
        const file = new File([blob], fileName, { type: blob.type });

        const asset = await uploadFileToLocal(file);
        if (!asset) return;

        editor.AssetManager.add({ src: asset.url, name: asset.name, type: 'image' });
        component.set('name', asset.name.replace(/\.[^/.]+$/, ''));
        syncDroppedImageComponent(editor, component, asset.url);

        console.log(`🔄 Blob image replaced: ${String(src).slice(0, 30)}… → ${asset.url}`);
      } catch (err: any) {
        console.error('❌ Canvas-drop blob re-upload failed:', err.message);
      }
    });

    // ─── Floating toolbar on selection ─────────────────────────────────────
    editor.on('component:selected', (model) => {
      // Add alignment + lock + group/ungroup buttons to component floating toolbar
      const toolbar: any[] = model.get('toolbar') || [];
      if (!toolbar.some((t: any) => t.command === 'align-center')) {
        const isGroup = model.get('attributes')?.['data-group'] === 'true';
        toolbar.unshift(
          // Lock toggle — always reachable
          {
            attributes: { class: 'fa fa-lock', title: 'Lock Layer (Ctrl+L)' },
            command: 'toggle-lock',
          },
          // Group or Ungroup depending on component type
          isGroup
            ? { attributes: { class: 'fa fa-object-ungroup', title: 'Ungroup (Ctrl+Shift+G)' }, command: 'ungroup-selection' }
            : { attributes: { class: 'fa fa-object-group',   title: 'Group Layer (Ctrl+G)'   }, command: 'group-selection'   },
          {
            attributes: { class: 'fa fa-minus', title: 'Separator', style: 'pointer-events:none;opacity:0.3' },
            command: '',
          },
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
      // Remove GrapesJS toolbar duplicates (devices + built-in preview)
      try {
        editor.Panels.removePanel('devices');
        editor.Panels.removeButton('options', 'preview');
      } catch { /* panel ids may vary by preset version */ }

      editor.setDragMode('absolute');

      const templateRef = templateRefRef.current ?? getBuilderTemplateRef();
      if (!hasBuilderTemplateTarget(templateRef)) {
        setTimeout(() => {
          setupEditorWorkspace(editor, { hasExternalTemplate: false });
          syncCanvasFrameDimensions(editor);
        }, 0);
        return;
      }

      const setupIframeAssets = (syncKey: string) => {
        try {
          injectIframeAssetBase(editor, syncKey);

          const iframeBody = editor.Canvas.getBody();
          if (!iframeBody?.ownerDocument) return;

          const iframeDoc = iframeBody.ownerDocument;
          const iframeHead = iframeDoc.head;

          if (!iframeHead.querySelector('link[href*="font-awesome"]')) {
            const faLink = iframeDoc.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
            iframeHead.appendChild(faLink);
          }

          if (!iframeHead.querySelector('link[href*="fonts.googleapis.com"]')) {
            const gfLink = iframeDoc.createElement('link');
            gfLink.rel = 'stylesheet';
            gfLink.href = 'https://fonts.googleapis.com/css2?family=Amiri:ital@0;1&family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Marcellus&family=Inter:wght@300;400;500;600&display=swap';
            iframeHead.appendChild(gfLink);
          }

          if (!iframeHead.querySelector('#gjs-animate-css')) {
            const animLink = iframeDoc.createElement('link');
            animLink.id = 'gjs-animate-css';
            animLink.rel = 'stylesheet';
            animLink.href = ANIMATE_CSS_URL;
            iframeHead.appendChild(animLink);
          }

          if (!iframeHead.querySelector('#gjs-editor-fixes')) {
            const fixStyle = iframeDoc.createElement('style');
            fixStyle.id = 'gjs-editor-fixes';
            fixStyle.textContent = `
            #loader { display: none !important; }

            [data-locked="true"] {
              opacity: 0.65 !important;
              outline: 2px dashed rgba(251,146,60,0.8) !important;
              outline-offset: 1px;
            }
            [data-locked="true"]::after {
              content: '🔒';
              position: absolute;
              top: 2px;
              right: 4px;
              font-size: 11px;
              line-height: 1;
              pointer-events: none;
              z-index: 9999;
            }
          `;
            iframeHead.appendChild(fixStyle);
          }
        } catch (e) {
          console.error('Error setting up iframe:', e);
        }
      };

      fetch(`/api/local-sync?${buildSyncQuery(templateRef)}`)
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            alert(`Error loading template: ${data.error}`);
            return;
          }

          const syncKey = data.templateKey as string;
          const label = (data.label as string) || templateRef.label;
          activeSyncKeyRef.current = syncKey;
          setTemplateKey(syncKey);
          setTemplateLabel(label);

          const runBootstrap = () => {
            bootstrapTemplateCanvas(editor, syncKey)
              .then(() => {
                finalizeProjectLoadAssets(editor, syncKey);
                syncCanvasFrameDimensions(editor);
              })
              .catch((err) => {
                console.warn('Template canvas bootstrap failed:', err);
              });
          };

          if (data.projectData) {
            editor.loadProjectData(data.projectData);
            console.log(`📂 Loaded "${label}" in lossless mode`);
          } else {
            if (data.html) editor.setComponents(data.html);
            console.log(`📂 Loaded "${label}" in legacy/HTML mode (${data.mode ?? 'legacy'})`);
          }

          // Base must exist before setStyle so url(assets/...) resolves via local-sync API.
          setupIframeAssets(syncKey);
          injectIframeAssetBase(editor, syncKey);
          const cssToApply = ensurePetalLayoutInStylesheet(
            rewriteStylesheetAssetUrls(data.css || editor.getCss() || '', syncKey),
          );
          if (cssToApply) editor.setStyle(cssToApply);
          applyLoadedTemplateAssetResolution(editor, syncKey);

          // Let GrapesJS finish rendering before script.js + layer normalization
          setTimeout(runBootstrap, 50);
        })
        .catch(err => {
          console.error('Error loading template:', err);
          alert('Failed to load template files. Check if dev server is running.');
        });
    });

    // ─── Host-window Ctrl+S fallback ──────────────────────────────────────
    // The plugin already handles Ctrl+S inside the iframe; this covers the
    // edge case where the browser window has focus but the iframe does not
    // (e.g., the user just used a GrapesJS panel on the host page).
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement;
      const isTyping = target?.isContentEditable ||
                       target?.tagName === 'INPUT' ||
                       target?.tagName === 'TEXTAREA';
      if (ctrl && e.key === 's') {
        e.preventDefault();
        handleSaveLocalRef.current?.();
        return;
      }
      if (ctrl && e.key === 'z' && !e.shiftKey && !isTyping) {
        e.preventDefault();
        editor.UndoManager.undo();
        return;
      }
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !isTyping) {
        e.preventDefault();
        editor.UndoManager.redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      canvasDropCleanup?.();
      altResizeState.cleanup();  // host-window Alt / mouseup listeners
      dimensionState.cleanup();
      layoutDebugState();
      ctxMenuState.cleanup();    // host-document contextmenu / scroll / keydown
      groupState.cleanup();      // host-window Ctrl+G listener
      previewState.cleanup();    // guest preview mode
      themeState.cleanup();      // premium dark theme stylesheet
      dynVarsState.cleanup();    // variables panel + preview restore
      textGradientState.cleanup();// text gradient style manager
      countdownState.cleanup();  // countdown timer block
      customLayersState.cleanup(); // custom layers panel
      proImageStylesState.cleanup(); // image focal point, blend, shadow
      styleMgrState.cleanup();
      animState.cleanup();       // entrance animations
      cleanupEditorWorkspace(editor);
      cleanupHeroLayerInteraction();
      multiSelectState.cleanup();// multi-select outlines + listeners
      editor.destroy();
    };
  }, []);

  // ─── Save Handler ─────────────────────────────────────────────────────────
  const handleSaveLocalRef = useRef<(() => void) | null>(null);

  /**
   * Convert pixel-based vertical offsets to responsive percentage-based positions,
   * while stripping horizontal offsets (left/position/width/height) to preserve
   * the horizontal centering and styling defined in the CSS stylesheet.
   *
   * This allows the user to drag elements up and down in GrapesJS (absolute drag mode)
   * and save their layout changes safely without breaking mobile responsiveness or centering.
   */
  const sanitizeHtmlBeforeSave = (html: string): string => {
    // IDs of hero overlay elements whose positions are managed
    const heroOverlayIds = [
      'top-live-badge', 'ifj49', 'i4t7s', 'ivxuo',
      'monogram-id', 'i05ra', 'isphc', 'i6n16r',
    ];

    // Detect actual dimensions from the active GrapesJS editor preview canvas
    let cardHeight = 0;
    try {
      if (editorInstance) {
        const iframeBody = editorInstance.Canvas.getBody();
        const heroContent = iframeBody?.querySelector('.hero-content') || iframeBody?.querySelector('.hero-section');
        if (heroContent) {
          cardHeight = heroContent.clientHeight;
        }
      }
    } catch (e) {
      console.warn('Error reading canvas dimensions:', e);
    }

    // Default fallback calculation if canvas isn't fully drawn
    if (!cardHeight && editorInstance) {
      try {
        const iframeBody = editorInstance.Canvas.getBody();
        const heroContent = iframeBody?.querySelector('.hero-content') || iframeBody?.querySelector('.hero-section');
        const cardWidth = heroContent?.clientWidth || 390;
        cardHeight = Math.round(cardWidth * 5122 / 2369);
      } catch (e) {
        cardHeight = 843; // Absolute fallback for 390px width
      }
    }

    let clean = html;

    // 1. Process inline styles for named overlay elements
    for (const id of heroOverlayIds) {
      // Matches the style="..." attribute on elements with this id
      clean = clean.replace(
        new RegExp(`(id="${id}"[^>]*?)\\s*style="([^"]*)"`, 'g'),
        (_match: string, beforeStyle: string, styleStr: string) => {
          let topValue = '';
          const topMatch = styleStr.match(/\btop\s*:\s*([^;]+)/i);

          if (topMatch && cardHeight > 0) {
            const val = topMatch[1].trim();
            if (val.endsWith('px')) {
              const px = parseFloat(val);
              if (!isNaN(px)) {
                // Convert pixels to percentage relative to active canvas height
                topValue = `top: ${(px / cardHeight * 100).toFixed(2)}%;`;
              }
            } else if (val.endsWith('%')) {
              // Keep pre-existing percentage values
              topValue = `top: ${val};`;
            }
          }

          // Strip position properties that break horizontal centering or sizes
          let stripped = styleStr
            .replace(/\btop\s*:\s*[^;]+;?\s*/gi, '')
            .replace(/\bleft\s*:\s*[^;]+;?\s*/gi, '')
            .replace(/\bposition\s*:\s*[^;]+;?\s*/gi, '')
            .replace(/\bwidth\s*:\s*\d+(?:\.\d+)?px\s*;?\s*/gi, '')
            .replace(/\bheight\s*:\s*\d+(?:\.\d+)?px\s*;?\s*/gi, '')
            .trim();

          // Prepend converted top position
          if (topValue) {
            stripped = topValue + (stripped ? ' ' + stripped : '');
          }

          stripped = stripped.trim().replace(/;$/, '');

          return stripped
            ? `${beforeStyle} style="${stripped}"`
            : beforeStyle;
        }
      );
    }

    // 2. Strip inline background-image URLs that GrapesJS may have resolved
    //    to absolute /api/local-sync/assets/... paths (breaks on GitHub Pages)
    clean = clean.replace(
      /\bbackground-image\s*:\s*url\(['"]?[^'")\s]*['"]?\)\s*;?\s*/gi,
      ''
    );

    // 3. Keep data-locked and other editor metadata in local index.html for
    //    two-way sync / lossless roundtrip. Stripped only in sanitizeHtmlForExport.

    // 4. Rewrite local dev-server asset URLs → production-safe relative paths.
    //
    //    During editing, uploaded assets carry the URL:
    //      /api/local-sync/assets/[slug]/assets/filename.jpg
    //    so they render in the iframe without depending on the <base> tag.
    //
    //    For the deployed index.html we want clean relative URLs:
    //      assets/filename.jpg
    //    which resolve correctly relative to the template's index.html on any
    //    static host (GitHub Pages, Cloudflare Pages, etc.).
    //
    //    We use split/join instead of a regex to avoid escaping the slug.
    try {
      const syncKey = activeSyncKeyRef.current || templateKey;
      if (syncKey) {
        const devPrefix = `/api/local-sync/assets/${syncKey}/assets/`;
        clean = clean.split(devPrefix).join('assets/');
      }
    } catch (_) {}

    return clean;
  };

  /** Production export — strips editor-only metadata not meant for deployed HTML */
  const sanitizeHtmlForExport = (html: string): string => {
    let clean = sanitizeHtmlBeforeSave(html);
    clean = clean.replace(/\s*data-locked="true"/gi, '');
    clean = clean.replace(/\s*data-gjs-var-placeholder="true"/gi, '');
    return clean;
  };

  const handleSaveLocal = useCallback(async () => {
    if (!editorInstance) return;
    setSaving(true);

    const templateRef = templateRefRef.current ?? getBuilderTemplateRef();
    const syncRef: BuilderTemplateRef = {
      ...templateRef,
      templateKey: activeSyncKeyRef.current || templateKey || templateRef.templateKey,
    };

    if (hasBuilderTemplateTarget(syncRef)) {
      // Never persist live-preview substitutions — only {{Token}} placeholders
      (editorInstance as any).DynamicVariables?.ensurePlaceholdersForSave?.();
      const rawHtml = editorInstance.getHtml();
      const html = sanitizeHtmlBeforeSave(rawHtml);
      const css = editorInstance.getCss();
      const saveSyncKey = syncRef.templateKey || activeSyncKeyRef.current || templateKey;
      if (saveSyncKey) {
        syncAllImageComponentSrcForSave(editorInstance, saveSyncKey);
      }
      const projectData = saveSyncKey
        ? normalizeProjectDataAssetUrls(editorInstance.getProjectData(), saveSyncKey)
        : editorInstance.getProjectData();

      try {
        const res = await fetch('/api/local-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildSyncPayload(syncRef, { html, css, projectData })),
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
  }, [editorInstance, templateKey]);

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
        const syncKey = activeSyncKeyRef.current || templateKey;
        if (syncKey) {
          applyLoadedTemplateAssetResolution(editorInstance, syncKey);
        }
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
    (editorInstance as any).DynamicVariables?.ensurePlaceholdersForSave?.();
    const html = sanitizeHtmlForExport(editorInstance.getHtml());
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
    setTimeout(() => editorInstance && fixCanvasFrameCentering(editorInstance), 50);
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(zoom - 10, 30);
    setZoom(newZoom);
    editorInstance?.Canvas.setZoom(newZoom);
    setTimeout(() => editorInstance && fixCanvasFrameCentering(editorInstance), 50);
  };

  // ─── Device Handlers ──────────────────────────────────────────────────────
  const handleDevice = (d: 'desktop' | 'tablet' | 'mobile') => {
    setDevice(d);
    if (!editorInstance) return;
    const deviceMap = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };
    editorInstance.setDevice(deviceMap[d]);
    setTimeout(() => syncCanvasFrameDimensions(editorInstance), 80);
  };

  // ─── Undo / Redo ──────────────────────────────────────────────────────────
  const handleUndo = () => editorInstance?.UndoManager.undo();
  const handleRedo = () => editorInstance?.UndoManager.redo();

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={`ec-studio-dark flex flex-col w-full overflow-hidden bg-[#202024] ${
      guestPreviewActive ? 'ec-guest-preview-active h-screen' : 'h-[calc(100vh-4rem)]'
    }`}>

      {/* ── Top Toolbar ─────────────────────────────────────────────────── */}
      <div className="ec-studio-toolbar h-12 bg-[#202024] flex items-center justify-between px-3 text-zinc-100 shrink-0 gap-2 border-b border-zinc-700/80 shadow-[0_1px_0_rgba(255,255,255,0.04)]">

        {/* Left: Studio name */}
        <div className="text-xs font-semibold tracking-[0.18em] text-amber-400/95 whitespace-nowrap">
          <span className="text-amber-500">✦</span> EVENTCAST STUDIO
          {templateLabel && hasBuilderTemplateTarget(templateRefRef.current ?? getBuilderTemplateRef())
            ? <span className="text-zinc-500 font-normal tracking-widest"> · {templateLabel.toUpperCase()}</span>
            : ''}
        </div>

        {/* Center: Main controls */}
        <div className="flex items-center gap-1">

          {/* Undo / Redo */}
          <button onClick={handleUndo} disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className={`p-1.5 rounded-md transition-colors ${canUndo ? 'hover:bg-zinc-800 text-zinc-100' : 'text-zinc-600 cursor-not-allowed'}`}>
            <Undo2 className="w-4 h-4" />
          </button>
          <button onClick={handleRedo} disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className={`p-1.5 rounded-md transition-colors ${canRedo ? 'hover:bg-zinc-800 text-zinc-100' : 'text-zinc-600 cursor-not-allowed'}`}>
            <Redo2 className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-zinc-800 mx-1" />

          {/* Alignment — active only when element is selected */}
          <div className="flex items-center gap-0.5" title={!hasSelection ? 'Select an element to align' : ''}>
            <button
              onClick={() => editorInstance?.runCommand('align-left')}
              disabled={!hasSelection}
              title="Align Left (to parent)"
              className={`px-2 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                hasSelection ? 'hover:bg-zinc-800 text-zinc-100' : 'text-zinc-600 cursor-not-allowed'
              }`}>
              ⇐ Left
            </button>
            <button
              onClick={() => editorInstance?.runCommand('align-center')}
              disabled={!hasSelection}
              title="Center horizontally on page"
              className={`px-2 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                hasSelection ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30 hover:bg-amber-500/25' : 'text-zinc-600 cursor-not-allowed'
              }`}>
              ⊕ Center
            </button>
            <button
              onClick={() => editorInstance?.runCommand('align-right')}
              disabled={!hasSelection}
              title="Align Right (to parent)"
              className={`px-2 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                hasSelection ? 'hover:bg-zinc-800 text-zinc-100' : 'text-zinc-600 cursor-not-allowed'
              }`}>
              Right ⇒
            </button>
          </div>

          {/* Multi-select alignment — visible when 2+ layers selected (Shift+click) */}
          {multiSelectCount >= 2 && (
            <>
              <div className="w-px h-6 bg-zinc-800 mx-1" />
              <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-lg bg-zinc-800/60 ring-1 ring-zinc-700/80" title={`${multiSelectCount} layers selected — Shift+click to add/remove`}>
                <span className="text-[10px] text-cyan-400 font-semibold px-1">{multiSelectCount} sel</span>
                <button onClick={() => editorInstance?.runCommand('multi-align-left')}
                  title="Align left edges"
                  className="px-1.5 py-1.5 rounded-md text-xs hover:bg-zinc-700 text-zinc-200">⇤</button>
                <button onClick={() => editorInstance?.runCommand('multi-align-center-h')}
                  title="Align horizontal centers"
                  className="px-1.5 py-1.5 rounded-md text-xs bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/25 hover:bg-cyan-500/25">⊟</button>
                <button onClick={() => editorInstance?.runCommand('multi-align-right')}
                  title="Align right edges"
                  className="px-1.5 py-1.5 rounded-md text-xs hover:bg-zinc-700 text-zinc-200">⇥</button>
                <button onClick={() => editorInstance?.runCommand('multi-align-top')}
                  title="Align top edges"
                  className="px-1.5 py-1.5 rounded-md text-xs hover:bg-zinc-700 text-zinc-200">⇡</button>
                <button onClick={() => editorInstance?.runCommand('multi-align-middle')}
                  title="Align vertical centers"
                  className="px-1.5 py-1.5 rounded-md text-xs bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/25 hover:bg-cyan-500/25">⊞</button>
                <button onClick={() => editorInstance?.runCommand('multi-align-bottom')}
                  title="Align bottom edges"
                  className="px-1.5 py-1.5 rounded-md text-xs hover:bg-zinc-700 text-zinc-200">⇣</button>
                <button onClick={() => editorInstance?.runCommand('multi-distribute-h')}
                  title="Distribute horizontally (3+ layers)"
                  className="px-1.5 py-1.5 rounded-md text-xs hover:bg-zinc-700 text-zinc-200">⋮≡</button>
                <button onClick={() => editorInstance?.runCommand('multi-distribute-v')}
                  title="Distribute vertically (3+ layers)"
                  className="px-1.5 py-1.5 rounded-md text-xs hover:bg-zinc-700 text-zinc-200">≡⋮</button>
              </div>
            </>
          )}

          <div className="w-px h-6 bg-zinc-800 mx-1" />

          {/* Device Preview */}
          <button onClick={() => handleDevice('desktop')}
            title={getDeviceProfile('Desktop').title}
            className={`p-1.5 rounded-md transition-colors ${device === 'desktop' ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/35' : 'hover:bg-zinc-800 text-zinc-400'}`}>
            <Monitor className="w-4 h-4" />
          </button>
          <button onClick={() => handleDevice('tablet')}
            title={getDeviceProfile('Tablet').title}
            className={`p-1.5 rounded-md transition-colors ${device === 'tablet' ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/35' : 'hover:bg-zinc-800 text-zinc-400'}`}>
            <Tablet className="w-4 h-4" />
          </button>
          <button onClick={() => handleDevice('mobile')}
            title={getDeviceProfile('Mobile').title}
            className={`p-1.5 rounded-md transition-colors ${device === 'mobile' ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/35' : 'hover:bg-zinc-800 text-zinc-400'}`}>
            <Smartphone className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-zinc-800 mx-1" />

          {/* Zoom */}
          <button onClick={handleZoomOut} title="Zoom Out" className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors text-zinc-400 hover:text-zinc-100">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-zinc-500 w-10 text-center font-mono tabular-nums">{zoom}%</span>
          <button onClick={handleZoomIn} title="Zoom In" className="p-1.5 hover:bg-zinc-800 rounded-md transition-colors text-zinc-400 hover:text-zinc-100">
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>


        {/* Right: File operations */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => editorInstance?.runCommand('toggle-variables-panel')}
            title="Dynamic Variables — {{GuestName}}, {{EventDate}}, etc."
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 ring-1 ring-indigo-500/25 rounded-md text-xs transition-colors font-mono">
            {'{{}}'} Variables
          </button>

          <button
            onClick={() => editorInstance?.runCommand('preview-timeline-animations')}
            title="Preview all entrance animations in timeline order"
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 ring-1 ring-violet-500/25 rounded-md text-xs transition-colors">
            ▶ Animations
          </button>

          <button
            onClick={() => editorInstance?.runCommand('guest-preview-mode')}
            title="Guest Preview — full-screen as guests see it (Ctrl+Shift+P)"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ring-1 ${
              guestPreviewActive
                ? 'bg-amber-500/20 text-amber-300 ring-amber-500/40'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 ring-zinc-700'
            }`}>
            <Eye className="w-3.5 h-3.5" />
            Preview
          </button>

          <button onClick={handleExportCode}
            title="Export HTML/CSS"
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 ring-1 ring-zinc-700 rounded-md text-xs transition-colors">
            <Code className="w-3.5 h-3.5" /> Export
          </button>

          <label className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 ring-1 ring-zinc-700 rounded-md text-xs transition-colors cursor-pointer">
            <FolderOpen className="w-3.5 h-3.5" /> Open JSON
            <input type="file" accept=".json" className="hidden" onChange={handleLoadLocal} />
          </label>

          <button onClick={handleSaveLocal} disabled={saving}
            title="Save Template (Ctrl+S)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ring-1 ${
              saving
                ? 'bg-zinc-700 text-zinc-500 ring-zinc-600 cursor-not-allowed'
                : 'bg-emerald-600/90 hover:bg-emerald-500 text-white ring-emerald-500/40 shadow-sm shadow-emerald-900/30'
            }`}>
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save (Ctrl+S)'}
          </button>
        </div>
      </div>

      {/* ── Main workspace: Layers + Canvas ─────────────────────────────── */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {!guestPreviewActive && (
          <CustomLayersPanel editor={editorInstance} className="w-60 shrink-0" />
        )}
        <div className="ec-studio-canvas-host flex-1 min-w-0 relative overflow-hidden">
          <div ref={editorRef} className="absolute inset-0" />
        </div>
      </div>
    </div>
  );
}
