// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * AI Floating Window — state singleton.
 *
 * Tracks the current display mode of the AI Assistant (tab vs floating
 * popup) plus the popup's geometry (position + size). Persists to
 * localStorage so the window remembers where it was last placed.
 *
 * Subscribers are notified on every update so the body-level portal
 * (which lives outside Mithril's normal redraw graph) can re-render.
 */

const STORAGE_KEY = 'smartperfetto-floating-window-v1';

export type FloatingMode = 'tab' | 'floating';

export interface FloatingState {
  mode: FloatingMode;
  /** Top-left corner in viewport pixels. */
  position: {x: number; y: number};
  /** Window size in pixels. */
  size: {width: number; height: number};
}

export const FLOATING_MIN_WIDTH = 400;
export const FLOATING_MIN_HEIGHT = 320;
export const FLOATING_MAX_DIM = 4096;
const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 540;
const DEFAULT_MARGIN = 24;
const FALLBACK_VIEWPORT_WIDTH = 1280;
const FALLBACK_VIEWPORT_HEIGHT = 800;

/** Clamp a value to [min, max]. Exported so the window module can reuse it. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Canonical default geometry: 640×540 bottom-right corner with a
 * DEFAULT_MARGIN gap. Pure — takes explicit viewport dimensions so it
 * can be shared between `defaultState()` (which reads window) and
 * `computeSnapGeometry('default', ...)` (which stays pure for tests).
 */
function computeDefaultGeometry(
  viewportW: number,
  viewportH: number,
): {position: {x: number; y: number}; size: {width: number; height: number}} {
  return {
    position: {
      x: Math.max(DEFAULT_MARGIN, viewportW - DEFAULT_WIDTH - DEFAULT_MARGIN),
      y: Math.max(DEFAULT_MARGIN, viewportH - DEFAULT_HEIGHT - DEFAULT_MARGIN),
    },
    size: {width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT},
  };
}

function defaultState(): FloatingState {
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : FALLBACK_VIEWPORT_WIDTH;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : FALLBACK_VIEWPORT_HEIGHT;
  return {
    mode: 'tab',
    ...computeDefaultGeometry(viewportW, viewportH),
  };
}

function loadFromStorage(): FloatingState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    // Always reset mode to 'tab' on load — never auto-restore the floating
    // window across page reloads, that would be surprising.
    return {
      mode: 'tab',
      position: {
        x: Number(parsed.position?.x ?? 0),
        y: Number(parsed.position?.y ?? 0),
      },
      size: {
        width: clamp(Number(parsed.size?.width ?? DEFAULT_WIDTH), FLOATING_MIN_WIDTH, FLOATING_MAX_DIM),
        height: clamp(Number(parsed.size?.height ?? DEFAULT_HEIGHT), FLOATING_MIN_HEIGHT, FLOATING_MAX_DIM),
      },
    };
  } catch {
    // Corrupt JSON, quota, or disabled storage — fall back to default.
    return null;
  }
}

function saveToStorage(s: FloatingState): void {
  if (typeof window === 'undefined') return;
  try {
    // Don't persist mode — popup never auto-opens on reload.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      position: s.position,
      size: s.size,
    }));
  } catch {
    // Quota or disabled storage — ignore.
  }
}

// ── Module singleton ────────────────────────────────────────────────────
let state: FloatingState = loadFromStorage() ?? defaultState();
const listeners = new Set<() => void>();

/** Read the current floating state (immutable snapshot). */
export function getFloatingState(): Readonly<FloatingState> {
  return state;
}

/** Merge a partial update and notify subscribers. */
export function updateFloatingState(update: Partial<FloatingState>): void {
  state = {
    ...state,
    ...update,
    position: update.position ? {...state.position, ...update.position} : state.position,
    size: update.size ? {...state.size, ...update.size} : state.size,
  };
  saveToStorage(state);
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      console.warn('[AIFloatingState] listener error', e);
    }
  }
}

/** Subscribe to state changes. Returns an unsubscribe function. */
export function subscribeFloatingState(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Reset geometry (position + size) to the default — bottom-right corner,
 * 640×540 — and then clamp against the current viewport. Used by the
 * "重置位置" title-bar button as a recovery hatch if the window somehow
 * ended up off-screen.
 *
 * Without the final clamp, calling reset in a viewport smaller than the
 * default (e.g. 500×400) would place the default-sized window with its
 * resize handle off-screen, defeating the whole purpose of the button.
 */
export function resetFloatingGeometry(): void {
  const d = defaultState();
  updateFloatingState({position: d.position, size: d.size});
  clampFloatingGeometryToViewport();
}

/**
 * Preset snap layouts — Windows Snap Assist style quick positioning.
 * All layouts are computed from the CURRENT viewport, not absolute
 * pixels, so they adapt when the browser window is resized.
 */
export type FloatingSnapLayout =
  | 'default'       // reset to default 640×540 bottom-right
  | 'maximize'      // fill viewport (minus 24px margin)
  | 'left-half'     // left 50% full height
  | 'right-half'    // right 50% full height
  | 'top-half'      // top 50% full width
  | 'bottom-half'   // bottom 50% full width
  | 'top-left'      // top-left quarter
  | 'top-right'     // top-right quarter
  | 'bottom-left'   // bottom-left quarter
  | 'bottom-right'; // bottom-right quarter

export interface SnapLayoutOption {
  id: FloatingSnapLayout;
  label: string;
  icon: string;  // material-icons name
  tooltip: string;
}

/**
 * All available snap presets in the order they appear in the layout menu.
 * Exported so the floating window title-bar dropdown can render them.
 */
export const FLOATING_SNAP_LAYOUTS: ReadonlyArray<SnapLayoutOption> = [
  {id: 'default',      label: '默认大小',   icon: 'crop_square',       tooltip: '恢复默认 640×540 右下角布局'},
  {id: 'maximize',     label: '最大化',     icon: 'fullscreen',        tooltip: '填满视口（留 24px 边距）'},
  {id: 'left-half',    label: '左半屏',     icon: 'border_left',       tooltip: '占据视口左侧 50%'},
  {id: 'right-half',   label: '右半屏',     icon: 'border_right',      tooltip: '占据视口右侧 50%'},
  {id: 'top-half',     label: '上半屏',     icon: 'border_top',        tooltip: '占据视口上方 50%'},
  {id: 'bottom-half',  label: '下半屏',     icon: 'border_bottom',     tooltip: '占据视口下方 50%'},
  {id: 'top-left',     label: '左上角',     icon: 'north_west',        tooltip: '占据视口左上四分之一'},
  {id: 'top-right',    label: '右上角',     icon: 'north_east',        tooltip: '占据视口右上四分之一'},
  {id: 'bottom-left',  label: '左下角',     icon: 'south_west',        tooltip: '占据视口左下四分之一'},
  {id: 'bottom-right', label: '右下角',     icon: 'south_east',        tooltip: '占据视口右下四分之一'},
];

/** Equal margin used by all snap layouts on every side of the viewport. */
export const SNAP_MARGIN = 24;

/**
 * Compute {position, size} for a given snap layout against the supplied
 * viewport dimensions. Pure function — exported separately for tests.
 */
export function computeSnapGeometry(
  layout: FloatingSnapLayout,
  viewportWidth: number,
  viewportHeight: number,
): {position: {x: number; y: number}; size: {width: number; height: number}} {
  const vw = viewportWidth;
  const vh = viewportHeight;
  // Usable area leaves an equal margin on every side so the popup doesn't
  // hug the screen edges or clip under Perfetto's status bar.
  const halfW = Math.max(FLOATING_MIN_WIDTH, Math.floor((vw - SNAP_MARGIN * 3) / 2));
  const halfH = Math.max(FLOATING_MIN_HEIGHT, Math.floor((vh - SNAP_MARGIN * 3) / 2));
  const fullW = Math.max(FLOATING_MIN_WIDTH, vw - SNAP_MARGIN * 2);
  const fullH = Math.max(FLOATING_MIN_HEIGHT, vh - SNAP_MARGIN * 2);

  switch (layout) {
    case 'default':
      return computeDefaultGeometry(vw, vh);
    case 'maximize':
      return {
        position: {x: SNAP_MARGIN, y: SNAP_MARGIN},
        size: {width: fullW, height: fullH},
      };
    case 'left-half':
      return {
        position: {x: SNAP_MARGIN, y: SNAP_MARGIN},
        size: {width: halfW, height: fullH},
      };
    case 'right-half':
      return {
        position: {x: SNAP_MARGIN * 2 + halfW, y: SNAP_MARGIN},
        size: {width: halfW, height: fullH},
      };
    case 'top-half':
      return {
        position: {x: SNAP_MARGIN, y: SNAP_MARGIN},
        size: {width: fullW, height: halfH},
      };
    case 'bottom-half':
      return {
        position: {x: SNAP_MARGIN, y: SNAP_MARGIN * 2 + halfH},
        size: {width: fullW, height: halfH},
      };
    case 'top-left':
      return {
        position: {x: SNAP_MARGIN, y: SNAP_MARGIN},
        size: {width: halfW, height: halfH},
      };
    case 'top-right':
      return {
        position: {x: SNAP_MARGIN * 2 + halfW, y: SNAP_MARGIN},
        size: {width: halfW, height: halfH},
      };
    case 'bottom-left':
      return {
        position: {x: SNAP_MARGIN, y: SNAP_MARGIN * 2 + halfH},
        size: {width: halfW, height: halfH},
      };
    case 'bottom-right':
      return {
        position: {x: SNAP_MARGIN * 2 + halfW, y: SNAP_MARGIN * 2 + halfH},
        size: {width: halfW, height: halfH},
      };
  }
}

/**
 * Apply a snap preset — computes geometry from the current viewport and
 * updates state. The result is always clamp-safe because the helpers
 * already respect FLOATING_MIN_WIDTH / FLOATING_MIN_HEIGHT and leave
 * margin on all sides.
 */
export function applyFloatingSnapLayout(layout: FloatingSnapLayout): void {
  const vw = typeof window !== 'undefined' ? window.innerWidth : FALLBACK_VIEWPORT_WIDTH;
  const vh = typeof window !== 'undefined' ? window.innerHeight : FALLBACK_VIEWPORT_HEIGHT;
  const {position, size} = computeSnapGeometry(layout, vw, vh);
  updateFloatingState({position, size});
}

/**
 * Clamp current geometry against the current viewport so the popup is
 * guaranteed to be grabbable (title bar reachable), even if the saved
 * position came from a different viewport (multi-monitor, smaller
 * browser window, etc.). Called before entering floating mode and from
 * the resize handler.
 *
 * Note: this guarantees "grabbable", not "fully on-screen" — the user
 * may still want to tuck the window off the left edge, we only insist
 * that ≥100px peeks out from the left AND the title bar stays within
 * viewport_width − 80px on the right so the drag handle is reachable.
 *   - size clamped to [min, viewport - 24px margin]
 *   - position x clamped to [-width + 100, viewport - 80]
 *   - position y clamped to [0, viewport - TITLEBAR_HEIGHT]
 */
export function clampFloatingGeometryToViewport(): void {
  if (typeof window === 'undefined') return;
  const MARGIN = 24;
  const MIN_VISIBLE_X = 100;       // keep ≥100px peek on the left edge
  const TITLEBAR_REACH = 80;       // keep ≥80px of right edge grabbable
  const TITLEBAR_HEIGHT = 36;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const width = clamp(state.size.width, FLOATING_MIN_WIDTH, Math.max(FLOATING_MIN_WIDTH, vw - MARGIN));
  const height = clamp(state.size.height, FLOATING_MIN_HEIGHT, Math.max(FLOATING_MIN_HEIGHT, vh - MARGIN));

  const x = clamp(state.position.x, -width + MIN_VISIBLE_X, Math.max(0, vw - TITLEBAR_REACH));
  const y = clamp(state.position.y, 0, Math.max(0, vh - TITLEBAR_HEIGHT));

  updateFloatingState({
    position: {x, y},
    size: {width, height},
  });
}
