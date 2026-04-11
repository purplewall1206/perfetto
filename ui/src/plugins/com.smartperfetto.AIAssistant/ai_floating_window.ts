// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * AI Floating Window — body-level portal that hosts the AIPanel as a
 * draggable, resizable popup window.
 *
 * Why a body-level mount instead of CSS positioning inside the tab:
 * Perfetto's tab system uses a Gate component (display: none) to hide
 * inactive tabs. A `position: fixed` element inside a hidden tab is
 * still hidden by `display: none` on the parent. So if the AIPanel
 * lived inside the tab DOM and the user switched tabs, the floating
 * window would disappear. By living at document.body level, the
 * popup persists across all tab switches.
 *
 * State preservation across mode switches:
 * The AIPanel auto-restores recent sessions (<30min) on mount via
 * sessionManager. So when we unmount the tab AIPanel and mount a new
 * floating AIPanel, the chat history is preserved automatically. We
 * still call flushSessionSave() before mode switches to make sure the
 * very latest state is on disk.
 */

import m from 'mithril';
import {Trace} from '../../public/trace';
import {AIPanel} from './ai_panel';
import {
  applyFloatingSnapLayout,
  clamp,
  clampFloatingGeometryToViewport,
  FLOATING_SNAP_LAYOUTS,
  FloatingState,
  FLOATING_MIN_HEIGHT,
  FLOATING_MIN_WIDTH,
  getFloatingState,
  resetFloatingGeometry,
  SNAP_MARGIN,
  subscribeFloatingState,
  updateFloatingState,
} from './ai_floating_state';
import {switchFloatingMode} from './ai_transient_state';

// ── Layout constants ────────────────────────────────────────────────────

const HOST_DIV_ID = 'smartperfetto-floating-window-host';

const TITLEBAR_HEIGHT = 36;
const RESIZE_HANDLE_SIZE = 18;
/** Min horizontal reveal of the window when dragged off-screen. */
const DRAG_MIN_VISIBLE_X = 100;
/** Right-side margin the title bar must stay within to remain grabbable. */
const DRAG_TITLEBAR_REACH = 80;
/** Viewport-edge margin applied to max size. */
const VIEWPORT_MARGIN = 24;

const BTN_BG_IDLE = 'rgba(255,255,255,0.12)';
const BTN_BG_HOVER = 'rgba(255,255,255,0.22)';

/**
 * Resting-state drop shadow for the floating window. Reused by the
 * `locateFloatingWindow()` scale-pulse animation so its first and last
 * keyframes blend back into the window's normal shadow seamlessly.
 */
const WINDOW_BASE_SHADOW =
  '0 12px 40px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.08)';

// ── Styles ──────────────────────────────────────────────────────────────

const STYLES = {
  window: `
    position: fixed;
    background: white;
    box-shadow: ${WINDOW_BASE_SHADOW};
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 90;
    font-family: 'Roboto', sans-serif;
  `,
  titlebar: `
    background: linear-gradient(90deg, #1a73e8 0%, #1557b0 100%);
    color: white;
    padding: 0 12px;
    height: ${TITLEBAR_HEIGHT}px;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: grab;
    user-select: none;
    flex-shrink: 0;
  `,
  titleIcon: `
    font-size: 18px;
    line-height: 1;
  `,
  titleText: `
    font-size: 13px;
    font-weight: 500;
    flex: 1;
    letter-spacing: 0.2px;
  `,
  iconBtn: `
    background: ${BTN_BG_IDLE};
    color: white;
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: background 0.15s;
  `,
  content: `
    flex: 1;
    overflow: hidden;
    position: relative;
    background: white;
  `,
  resizeHandle: `
    position: absolute;
    bottom: 0;
    right: 0;
    width: ${RESIZE_HANDLE_SIZE}px;
    height: ${RESIZE_HANDLE_SIZE}px;
    cursor: nwse-resize;
    background: linear-gradient(135deg, transparent 50%, #1a73e8 50%, #1a73e8 70%, transparent 70%);
    z-index: 1;
  `,
  // Backdrop is intentionally absent — popup is non-modal so the user
  // can keep interacting with the trace timeline behind it.
} as const;

// ── Drag / resize gesture state ─────────────────────────────────────────

interface DragGesture {
  type: 'drag' | 'resize';
  startMouseX: number;
  startMouseY: number;
  startPosX: number;
  startPosY: number;
  startWidth: number;
  startHeight: number;
}

let activeGesture: DragGesture | null = null;

/**
 * Clamp a candidate position so the window stays grabbable within the
 * current viewport. `width` is the window width (needed because we allow
 * the window to hang off the left edge as long as DRAG_MIN_VISIBLE_X
 * pixels remain visible on the right of the title bar).
 */
function clampPosition(x: number, y: number, width: number): {x: number; y: number} {
  return {
    x: clamp(x, -width + DRAG_MIN_VISIBLE_X, window.innerWidth - DRAG_TITLEBAR_REACH),
    y: clamp(y, 0, window.innerHeight - TITLEBAR_HEIGHT),
  };
}

/** Clamp a candidate size to the current viewport (minus margin). */
function clampSize(width: number, height: number): {width: number; height: number} {
  return {
    width: clamp(width, FLOATING_MIN_WIDTH, window.innerWidth - VIEWPORT_MARGIN),
    height: clamp(height, FLOATING_MIN_HEIGHT, window.innerHeight - VIEWPORT_MARGIN),
  };
}

function onGestureMove(e: MouseEvent): void {
  if (!activeGesture) return;
  const dx = e.clientX - activeGesture.startMouseX;
  const dy = e.clientY - activeGesture.startMouseY;

  if (activeGesture.type === 'drag') {
    updateFloatingState({
      position: clampPosition(
        activeGesture.startPosX + dx,
        activeGesture.startPosY + dy,
        activeGesture.startWidth,
      ),
    });
  } else {
    updateFloatingState({
      size: clampSize(
        activeGesture.startWidth + dx,
        activeGesture.startHeight + dy,
      ),
    });
  }
}

function onVisibilityChange(): void {
  // If the tab becomes hidden mid-gesture (alt-tab, switch tab), treat it
  // as a gesture cancellation. Otherwise `activeGesture` sticks around
  // and the popup keeps tracking on the next mousedown anywhere.
  if (document.hidden && activeGesture !== null) {
    onGestureEnd();
  }
}

function onGestureEnd(): void {
  activeGesture = null;
  document.removeEventListener('mousemove', onGestureMove);
  document.removeEventListener('mouseup', onGestureEnd);
  // blur fires when the browser window loses focus (alt-tab, clicking
  // another app); visibilitychange fires on background tab. Both are
  // ways the user can release the mouse without us seeing mouseup.
  window.removeEventListener('blur', onGestureEnd);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.body.style.userSelect = '';
}

function startGesture(type: 'drag' | 'resize', e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();
  // Defensive: if a previous gesture leaked (shouldn't happen but be safe),
  // tear it down before starting a new one.
  if (activeGesture !== null) {
    onGestureEnd();
  }
  const s = getFloatingState();
  activeGesture = {
    type,
    startMouseX: e.clientX,
    startMouseY: e.clientY,
    startPosX: s.position.x,
    startPosY: s.position.y,
    startWidth: s.size.width,
    startHeight: s.size.height,
  };
  document.addEventListener('mousemove', onGestureMove);
  document.addEventListener('mouseup', onGestureEnd);
  window.addEventListener('blur', onGestureEnd);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.body.style.userSelect = 'none';
}

// ── Layout dropdown styles ──────────────────────────────────────────────

/**
 * Shared base for both idle and hover variants of a menu item. The two
 * variants differ only in `background` + `color`, so we compose them
 * from this base rather than duplicating the full rule set.
 */
const LAYOUT_MENU_ITEM_BASE = `
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
`;

const LAYOUT_MENU_STYLES = {
  menu: `
    position: absolute;
    top: ${TITLEBAR_HEIGHT + 4}px;
    right: 8px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.08);
    padding: 6px;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
    min-width: 260px;
    z-index: 1;
  `,
  menuItem: `
    ${LAYOUT_MENU_ITEM_BASE}
    background: transparent;
    color: #202124;
    transition: background 0.1s;
  `,
  menuItemHover: `
    ${LAYOUT_MENU_ITEM_BASE}
    background: #e8f0fe;
    color: #1a73e8;
  `,
} as const;

// ── Floating window component ───────────────────────────────────────────

interface FloatingWindowAttrs {
  trace: Trace;
}

class FloatingWindow implements m.ClassComponent<FloatingWindowAttrs> {
  private showLayoutMenu = false;

  view({attrs}: m.Vnode<FloatingWindowAttrs>): m.Children {
    const s = getFloatingState();
    return m('div', {
      style: `${STYLES.window}
        left: ${s.position.x}px;
        top: ${s.position.y}px;
        width: ${s.size.width}px;
        height: ${s.size.height}px;
      `,
      // Click-away: close the layout menu when user clicks anywhere
      // inside the window that isn't the menu or its trigger.
      onclick: (e: MouseEvent) => {
        if (!this.showLayoutMenu) return;
        const target = e.target as HTMLElement;
        if (target.closest('[data-layout-menu]') || target.closest('[data-layout-trigger]')) return;
        this.showLayoutMenu = false;
      },
    }, [
      // ── Title bar (drag handle) ──
      m('div', {
        style: STYLES.titlebar,
        onmousedown: (e: MouseEvent) => {
          // Ignore mousedown on buttons inside the title bar
          if ((e.target as HTMLElement).closest('button')) return;
          startGesture('drag', e);
        },
      }, [
        m('span', {style: STYLES.titleIcon}, '\u{1F916}'),
        m('span', {style: STYLES.titleText}, 'AI Assistant — 浮动窗口'),
        // Layout dropdown trigger — Windows Snap Assist style presets.
        m('button', {
          'data-layout-trigger': 'true',
          style: STYLES.iconBtn,
          title: '预设布局（左半屏 / 右半屏 / 最大化等）',
          onclick: () => {
            this.showLayoutMenu = !this.showLayoutMenu;
          },
          onmouseover: (e: MouseEvent) => {
            (e.currentTarget as HTMLElement).style.background = BTN_BG_HOVER;
          },
          onmouseout: (e: MouseEvent) => {
            (e.currentTarget as HTMLElement).style.background = BTN_BG_IDLE;
          },
        }, [
          m('span.material-icons', {style: 'font-size: 14px'}, 'dashboard'),
        ]),
        // Reset geometry — recovery hatch if user somehow lost the window.
        m('button', {
          style: STYLES.iconBtn,
          title: '重置位置和大小（恢复默认）',
          onclick: () => resetFloatingGeometry(),
          onmouseover: (e: MouseEvent) => {
            (e.currentTarget as HTMLElement).style.background = BTN_BG_HOVER;
          },
          onmouseout: (e: MouseEvent) => {
            (e.currentTarget as HTMLElement).style.background = BTN_BG_IDLE;
          },
        }, [
          m('span.material-icons', {style: 'font-size: 14px'}, 'restart_alt'),
        ]),
        m('button', {
          style: STYLES.iconBtn,
          title: '收回到标签页',
          onclick: () => switchFloatingMode('tab'),
          onmouseover: (e: MouseEvent) => {
            (e.currentTarget as HTMLElement).style.background = BTN_BG_HOVER;
          },
          onmouseout: (e: MouseEvent) => {
            (e.currentTarget as HTMLElement).style.background = BTN_BG_IDLE;
          },
        }, [
          m('span.material-icons', {style: 'font-size: 14px'}, 'close_fullscreen'),
          m('span', '收回'),
        ]),
      ]),

      // ── Layout dropdown menu ──
      this.showLayoutMenu ? m('div', {
        'data-layout-menu': 'true',
        style: LAYOUT_MENU_STYLES.menu,
      }, FLOATING_SNAP_LAYOUTS.map((opt) =>
        m('button', {
          key: opt.id,
          style: LAYOUT_MENU_STYLES.menuItem,
          title: opt.tooltip,
          onclick: () => {
            applyFloatingSnapLayout(opt.id);
            this.showLayoutMenu = false;
          },
          onmouseover: (e: MouseEvent) => {
            (e.currentTarget as HTMLElement).style.cssText = LAYOUT_MENU_STYLES.menuItemHover;
          },
          onmouseout: (e: MouseEvent) => {
            (e.currentTarget as HTMLElement).style.cssText = LAYOUT_MENU_STYLES.menuItem;
          },
        }, [
          m('span.material-icons', {style: 'font-size: 16px; color: #5f6368'}, opt.icon),
          m('span', opt.label),
        ]),
      )) : null,

      // ── Content: AIPanel ──
      m('div', {style: STYLES.content}, m(AIPanel, {
        engine: attrs.trace.engine,
        trace: attrs.trace,
      })),

      // ── Resize handle (bottom-right) ──
      m('div', {
        style: STYLES.resizeHandle,
        onmousedown: (e: MouseEvent) => startGesture('resize', e),
        title: '拖动调整大小',
      }),
    ]);
  }
}

// ── Setup / dispose ─────────────────────────────────────────────────────

export interface FloatingWindowHandle {
  dispose: () => void;
}

/**
 * Strong "locate" action — guarantees the user can find the floating
 * window even if it's drifted off-screen or they're looking at the
 * wrong corner of a multi-monitor setup.
 *
 * Three things happen in order:
 *   1. Clamp geometry to viewport. If the saved position was from a
 *      different viewport (multi-monitor handoff), this pulls it back.
 *   2. If the window would still be near an edge (<10% visible), center
 *      it in the viewport so the user can't miss it.
 *   3. Run a noticeable scale-pulse + glow animation on the window.
 *
 * Replaces the earlier flashFloatingWindow() which only did step 3 —
 * that was too subtle to cover "user can't see the window" cases.
 * No-op if the floating window isn't currently mounted.
 */
export function locateFloatingWindow(): void {
  // Step 1: force-clamp to current viewport.
  clampFloatingGeometryToViewport();

  // Step 2: if the window is still hugging an edge (common when the
  // saved position was clipped by a smaller viewport), center it.
  const s = getFloatingState();
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const visibleLeft = Math.max(0, s.position.x);
  const visibleRight = Math.min(vw, s.position.x + s.size.width);
  const visibleWidth = Math.max(0, visibleRight - visibleLeft);
  if (visibleWidth < s.size.width * 0.9) {
    updateFloatingState({
      position: {
        x: Math.max(SNAP_MARGIN, Math.floor((vw - s.size.width) / 2)),
        y: Math.max(SNAP_MARGIN, Math.floor((vh - s.size.height) / 2)),
      },
    });
  }

  // Step 3: strong animation — scale pulse + glow. Much more noticeable
  // than the earlier subtle box-shadow-only flash.
  const host = document.getElementById(HOST_DIV_ID);
  if (!host) return;
  const windowEl = host.firstElementChild as HTMLElement | null;
  if (!windowEl) return;
  windowEl.animate?.(
    [
      {transform: 'scale(1)', boxShadow: WINDOW_BASE_SHADOW},
      {
        transform: 'scale(1.04)',
        boxShadow: '0 20px 60px rgba(26, 115, 232, 0.55), 0 0 0 4px rgba(26, 115, 232, 0.9)',
      },
      {
        transform: 'scale(1)',
        boxShadow: '0 12px 40px rgba(26, 115, 232, 0.35), 0 0 0 2px rgba(26, 115, 232, 0.5)',
      },
      {
        transform: 'scale(1.02)',
        boxShadow: '0 16px 50px rgba(26, 115, 232, 0.45), 0 0 0 3px rgba(26, 115, 232, 0.7)',
      },
      {transform: 'scale(1)', boxShadow: WINDOW_BASE_SHADOW},
    ],
    {duration: 1200, easing: 'ease-in-out'},
  );
}

function createHostDiv(): HTMLDivElement {
  const div = document.createElement('div');
  div.id = HOST_DIV_ID;
  document.body.appendChild(div);
  return div;
}

/**
 * Mount the floating window host on document.body and start its render
 * loop. Call dispose() on trace unload to clean up.
 *
 * The host div always exists in the DOM. Its content is empty when
 * mode === 'tab' and contains the floating window when mode === 'floating'.
 */
export function setupFloatingWindow(trace: Trace): FloatingWindowHandle {
  // Reuse an existing host if a previous trace left one behind (defensive),
  // otherwise create a fresh div and append it to document.body.
  const hostDiv: HTMLElement =
    document.getElementById(HOST_DIV_ID) ?? createHostDiv();
  // Always start from a clean slate even when reusing an existing host.
  m.render(hostDiv, null);

  function renderHost(): void {
    if (getFloatingState().mode !== 'floating') {
      m.render(hostDiv, null);
      return;
    }
    m.render(hostDiv, m(FloatingWindow, {trace}));
  }

  // Re-render when state changes
  const unsubscribeState = subscribeFloatingState(renderHost);

  // Re-render when the viewport resizes — clamp current geometry in case
  // the window is now partially or fully off-screen.
  const onResize = (): void => {
    const s: FloatingState = getFloatingState();
    if (s.mode !== 'floating') return;
    const size = clampSize(s.size.width, s.size.height);
    updateFloatingState({
      position: clampPosition(s.position.x, s.position.y, size.width),
      size,
    });
  };
  window.addEventListener('resize', onResize);

  // Deliberately no Esc shortcut. We explored binding Esc on document,
  // but Perfetto has many widgets that listen for Escape on document
  // without stopPropagation (popup, menu, nodegraph, …) — any approach
  // short of a true modal window ends up with double-dismiss edge cases.
  // Scoping to hostDiv.contains(target) fixes the outer-widget conflict
  // but then the AIPanel auto-focuses its textarea on mount, and the
  // textarea exemption (needed so Esc-while-typing cancels typing,
  // not the window) makes Esc a no-op until the user clicks something
  // else inside the window. See Codex review rounds 3-5.
  //
  // The title-bar "收回" button and the tab-placeholder dock button are
  // always visible and always work, so a keyboard shortcut is a net
  // negative here.

  // Initial render
  renderHost();

  return {
    dispose: () => {
      unsubscribeState();
      window.removeEventListener('resize', onResize);
      // Tear down any in-flight drag/resize gesture — if the trace unloads
      // mid-drag, the document-level mousemove/mouseup listeners would
      // otherwise leak into the next trace session (Codex MEDIUM 2).
      if (activeGesture !== null) {
        onGestureEnd();
      }
      // Force mode back to tab so any pending render won't recreate UI
      updateFloatingState({mode: 'tab'});
      m.render(hostDiv, null);
      if (hostDiv.parentNode) {
        hostDiv.parentNode.removeChild(hostDiv);
      }
    },
  };
}
