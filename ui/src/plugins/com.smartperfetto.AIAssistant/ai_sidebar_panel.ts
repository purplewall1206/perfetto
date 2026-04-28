// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * AI Sidebar Panel — right-side docked panel for the AI Assistant.
 *
 * Renders inside the unified surface portal (ai_floating_window.ts) when
 * mode === 'sidebar'. Unlike the floating window, the sidebar does NOT
 * overlap the trace timeline — it uses a CSS variable (--pf-right-rail-width)
 * on the page container to push the main content left.
 *
 * Two visual states:
 *   - Expanded: titlebar + AIPanel + left-edge resize handle
 *   - Collapsed: 36px vertical strip with status icon + badge
 */

import m from 'mithril';
import {Trace} from '../../public/trace';
import {Icon} from '../../widgets/icon';
import {AIPanel} from './ai_panel';
import {
  clamp,
  getFloatingState,
  SIDEBAR_MIN_WIDTH,
  toggleSidebarCollapsed,
  updateFloatingState,
} from './ai_floating_state';
import {switchFloatingMode} from './ai_transient_state';
import {getAISharedState} from './ai_shared_state';

// ── Constants ──────────────────────────────────────────────────────────

const BTN_BG_IDLE = 'rgba(255,255,255,0.12)';
const BTN_BG_HOVER = 'rgba(255,255,255,0.22)';

// ── Resize gesture ─────────────────────────────────────────────────────

let resizeActive = false;
let resizeStartX = 0;
let resizeStartWidth = 0;
let rafId = 0;

/** Last mouse position during resize — committed synchronously on mouseup. */
let lastResizeClientX = 0;

function onResizeMove(e: MouseEvent): void {
  if (!resizeActive) return;
  lastResizeClientX = e.clientX;
  // Cancel any pending rAF to avoid stacking updates (Codex #5).
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    // Dragging left (negative dx) → wider sidebar.
    const dx = resizeStartX - e.clientX;
    const maxW = Math.floor(window.innerWidth * 0.5);
    const newWidth = clamp(resizeStartWidth + dx, SIDEBAR_MIN_WIDTH, maxW);
    updateFloatingState({sidebar: {width: newWidth, collapsed: false}});
  });
}

function onResizeVisibilityChange(): void {
  // Alt-Tab / background tab while dragging — treat as gesture end,
  // matching the floating window's visibilitychange handling.
  if (document.hidden && resizeActive) onResizeEnd();
}

function onResizeEnd(): void {
  // Commit the final mouse position synchronously — the last rAF may not
  // have fired yet, so without this the sidebar snaps to the second-to-last
  // reported position.
  if (resizeActive) {
    const dx = resizeStartX - lastResizeClientX;
    const maxW = Math.floor(window.innerWidth * 0.5);
    const newWidth = clamp(resizeStartWidth + dx, SIDEBAR_MIN_WIDTH, maxW);
    updateFloatingState({sidebar: {width: newWidth, collapsed: false}});
  }
  resizeActive = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
  window.removeEventListener('blur', onResizeEnd);
  document.removeEventListener('visibilitychange', onResizeVisibilityChange);
  document.body.style.userSelect = '';
  m.redraw();
}

function startResize(e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();
  if (resizeActive) onResizeEnd();
  const s = getFloatingState();
  resizeStartX = e.clientX;
  lastResizeClientX = e.clientX;
  resizeStartWidth = s.sidebar.width;
  resizeActive = true;
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
  window.addEventListener('blur', onResizeEnd);
  document.addEventListener('visibilitychange', onResizeVisibilityChange);
  document.body.style.userSelect = 'none';
}

// ── Sidebar Component ──────────────────────────────────────────────────

export interface SidebarPanelAttrs {
  trace: Trace;
}

export class SidebarPanel implements m.ClassComponent<SidebarPanelAttrs> {
  view({attrs}: m.Vnode<SidebarPanelAttrs>): m.Children {
    const s = getFloatingState();
    if (s.sidebar.collapsed) {
      return this.renderCollapsed();
    }
    return this.renderExpanded(attrs.trace, s.sidebar.width);
  }

  onremove(): void {
    // Defensive: if a resize gesture is in-flight when we unmount, clean up.
    if (resizeActive) onResizeEnd();
  }

  // ── Collapsed strip ────────────────────────────────────────────────

  private renderCollapsed(): m.Children {
    const shared = getAISharedState();
    const isAnalyzing = shared.status === 'analyzing';
    const issueCount = shared.issueCount;

    return m('.ai-sidebar-collapsed', {
      onclick: () => toggleSidebarCollapsed(),
      title: '展开 AI 侧边栏',
    }, [
      m(Icon, {icon: 'smart_toy', style: `font-size: 18px; ${isAnalyzing ? 'animation: ai-sidebar-pulse 1.5s ease-in-out infinite;' : ''}`}),
      issueCount > 0
        ? m('.ai-sidebar-badge', String(issueCount))
        : null,
    ]);
  }

  // ── Expanded panel ─────────────────────────────────────────────────

  private renderExpanded(trace: Trace, width: number): m.Children {
    return m('.ai-sidebar-expanded', {
      style: `width: ${width}px;`,
    }, [
      // Left-edge resize handle
      m('.ai-sidebar-resize-handle', {
        onmousedown: startResize,
        title: '拖动调整宽度',
      }),

      // Title bar
      m('.ai-sidebar-titlebar', [
        m('span.ai-sidebar-titlebar__icon', '\u{1F916}'),
        m('span.ai-sidebar-titlebar__text', 'AI Assistant'),

        // Collapse
        this.renderBtn('chevron_right', '折叠侧边栏', () => toggleSidebarCollapsed()),
        // Pop out to floating
        this.renderBtn('open_in_new', '弹出为浮动窗口', () => switchFloatingMode('floating')),
        // Dock back to tab
        this.renderBtn('open_in_new_off', '收回到标签页', () => switchFloatingMode('tab')),
      ]),

      // Content: AIPanel
      m('.ai-sidebar-content', m(AIPanel, {
        engine: trace.engine,
        trace,
      })),
    ]);
  }

  // ── Button helper ──────────────────────────────────────────────────

  private renderBtn(icon: string, title: string, onclick: () => void): m.Children {
    return m('button.ai-sidebar-titlebar__btn', {
      title,
      onclick,
      onmouseover: (e: MouseEvent) => {
        (e.currentTarget as HTMLElement).style.background = BTN_BG_HOVER;
      },
      onmouseout: (e: MouseEvent) => {
        (e.currentTarget as HTMLElement).style.background = BTN_BG_IDLE;
      },
    }, m(Icon, {icon, style: 'font-size: 14px'}));
  }
}
