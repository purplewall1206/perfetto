// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

// Copyright (C) 2024 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import m from 'mithril';
import {PerfettoPlugin} from '../../public/plugin';
import {Trace} from '../../public/trace';
import {Intent} from '../../widgets/common';
import {Icon} from '../../widgets/icon';
import {AIPanel} from './ai_panel';
import {
  emitClearChatCommand,
  emitOpenSettingsCommand,
} from './assistant_command_bus';
import {restoreOverlayTracks} from './track_overlay';
import {createAIAreaSelectionTab} from './ai_area_selection_tab';
import {getAISharedState, resetAISharedState} from './ai_shared_state';
import {AI_NOTE_COLORS, resetActiveNoteIds} from './ai_timeline_notes';
import {locateFloatingWindow, setupFloatingWindow} from './ai_floating_window';
import {getFloatingState, toggleSidebarCollapsed, updateFloatingState} from './ai_floating_state';
import {resetTransientState, switchFloatingMode} from './ai_transient_state';

export default class implements PerfettoPlugin {
  static readonly id = 'com.smartperfetto.AIAssistant';
  async onTraceLoad(ctx: Trace): Promise<void> {
    // Reset shared state to prevent cross-trace leakage (Codex #5).
    resetAISharedState();
    // Reset timeline note tracking so old trace IDs don't leak into the new
    // trace's cleanup path (the old trace's NoteManager is gone).
    resetActiveNoteIds();
    // Drop any transient state left over from a previous trace — a new
    // trace should not inherit the old trace's input draft, SSE cursor, etc.
    resetTransientState();
    // Force floating mode off on trace load (popup never auto-opens)
    updateFloatingState({mode: 'tab'});

    // Mount the unified surface host on document.body. The host dispatches
    // to FloatingWindow (mode=floating), SidebarPanel (mode=sidebar), or
    // null (mode=tab). Only one AIPanel instance exists at any time.
    const surfaceHandle = setupFloatingWindow(ctx);
    ctx.trash.defer(() => surfaceHandle.dispose());

    // Register the AI Assistant tab. Tab content switches between the
    // normal AIPanel and a placeholder when the panel is externalized
    // (floating or sidebar). Only ONE AIPanel instance exists at any time.
    ctx.tabs.registerTab({
      uri: 'ai-assistant',
      content: {
        render: () => {
          const mode = getFloatingState().mode;
          if (mode === 'floating') return renderFloatingPlaceholder();
          if (mode === 'sidebar') return renderSidebarPlaceholder();
          return m(AIPanel, {engine: ctx.engine, trace: ctx});
        },
        getTitle: () => 'AI Assistant',
      },
    });

    // Register sidebar menu item
    ctx.sidebar.addMenuItem({
      section: 'current_trace',
      sortOrder: 10,
      text: 'AI Assistant',
      icon: 'terminal',
      commandId: 'com.smartperfetto.AIAssistant.OpenPanel',
    });

    // Register commands
    ctx.commands.registerCommand({
      id: 'com.smartperfetto.AIAssistant.OpenPanel',
      name: 'Open AI Assistant',
      callback: () => {
        const mode = getFloatingState().mode;
        if (mode === 'floating') {
          // Locate+flash the popup (handles off-screen + inattentional blindness).
          locateFloatingWindow();
        } else if (mode === 'sidebar') {
          // If collapsed, expand; if already expanded, no-op.
          const s = getFloatingState();
          if (s.sidebar.collapsed) toggleSidebarCollapsed();
        } else {
          ctx.tabs.showTab('ai-assistant');
        }
      },
    });

    // Dedicated "locate" command for users who explicitly know the popup
    // exists but can't find it on screen. Always works regardless of mode
    // — in tab mode it's a no-op, no confusing behavior.
    ctx.commands.registerCommand({
      id: 'com.smartperfetto.AIAssistant.LocateFloating',
      name: 'Locate AI Floating Window',
      callback: () => {
        if (getFloatingState().mode === 'floating') {
          locateFloatingWindow();
        }
      },
    });

    ctx.commands.registerCommand({
      id: 'com.smartperfetto.AIAssistant.ClearChat',
      name: 'Clear AI Chat',
      callback: () => {
        emitClearChatCommand();
      },
    });

    ctx.commands.registerCommand({
      id: 'com.smartperfetto.AIAssistant.Settings',
      name: 'AI Assistant Settings',
      callback: () => {
        emitOpenSettingsCommand();
      },
    });

    // Toggle sidebar mode — switches between sidebar and tab.
    ctx.commands.registerCommand({
      id: 'com.smartperfetto.AIAssistant.ToggleSidebar',
      name: 'Toggle AI Sidebar',
      callback: () => {
        const mode = getFloatingState().mode;
        if (mode === 'sidebar') {
          switchFloatingMode('tab');
        } else {
          switchFloatingMode('sidebar');
        }
      },
    });

    // ── F1: Area Selection Analysis Tab ──
    // When user selects a time range, show quick stats + AI analyze button
    // in the bottom details panel — no tab switch needed.
    ctx.selection.registerAreaSelectionTab(createAIAreaSelectionTab(ctx));

    // ── F3: Status Bar Widget ──
    // Persistent indicator in the bottom status bar showing AI analysis state.
    ctx.statusbar.registerItem({
      renderItem: () => {
        const state = getAISharedState();
        const labels: Record<string, string> = {
          idle: 'AI Ready',
          ready: 'AI Ready',
          analyzing: `AI: ${state.currentPhase || 'Analyzing...'}`,
          completed: state.issueCount > 0
            ? `AI: ${state.issueCount} issue${state.issueCount > 1 ? 's' : ''}`
            : 'AI: Done',
          error: 'AI: Error',
        };
        const intents: Record<string, Intent> = {
          idle: Intent.None,
          ready: Intent.None,
          analyzing: Intent.Primary,
          completed: state.issueCount > 0 ? Intent.Warning : Intent.Success,
          error: Intent.Danger,
        };
        return {
          label: labels[state.status] ?? 'AI',
          icon: 'smart_toy',
          intent: intents[state.status] ?? Intent.None,
          onclick: () => {
            const mode = getFloatingState().mode;
            if (mode === 'floating') {
              locateFloatingWindow();
            } else if (mode === 'sidebar') {
              const s = getFloatingState();
              if (s.sidebar.collapsed) toggleSidebarCollapsed();
            } else {
              ctx.tabs.showTab('ai-assistant');
            }
          },
        };
      },
      popupContent: () => {
        const state = getAISharedState();
        if (state.status === 'analyzing') {
          return m('div', {style: 'padding: 8px; font-size: 12px'},
            m('div', {style: 'color: #1a73e8; font-weight: 500'}, state.currentPhase || 'Analyzing...'),
          );
        }
        if (state.findings.length === 0) {
          return m('div', {style: 'padding: 8px; font-size: 12px; color: #5f6368'},
            state.status === 'completed'
              ? 'Analysis complete. No issues found.'
              : 'Click to open AI Assistant.',
          );
        }
        const MAX_FINDINGS = 8;
        const visibleFindings = state.findings.slice(0, MAX_FINDINGS);
        const overflowCount = state.findings.length - MAX_FINDINGS;
        return m('div', {style: 'padding: 6px; max-height: 200px; overflow-y: auto'},
          visibleFindings.map((f) =>
            m('div', {
              style: `
                padding: 4px 8px;
                margin: 2px 0;
                font-size: 12px;
                border-left: 3px solid ${AI_NOTE_COLORS[f.type] ?? AI_NOTE_COLORS.insight};
                background: #f8f9fa;
                border-radius: 0 4px 4px 0;
              `,
            }, f.label),
          ),
          overflowCount > 0
            ? m('div', {style: 'font-size: 11px; color: #80868b; padding: 4px 8px'},
                `+${overflowCount} more`)
            : null,
        );
      },
    });

    // Restore persisted overlay tracks after hot-reload (build.js --watch).
    // Deferred to onTraceReady to ensure workspace is fully initialized.
    ctx.onTraceReady.addListener(() => {
      restoreOverlayTracks(ctx).catch((e) => {
        console.warn('[AIAssistant] Failed to restore overlay tracks:', e);
      });
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Placeholder shown in the AI Assistant tab when the panel is currently
 * displayed in the floating popup window. Clicking "Dock back" returns
 * the panel to the tab.
 */
function renderFloatingPlaceholder(): m.Children {
  return m('div', {
    style: `
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 48px 24px;
      height: 100%;
      font-family: 'Roboto', sans-serif;
      color: var(--pf-color-text-muted, #5f6368);
      text-align: center;
    `,
  }, [
    m('div', {style: 'font-size: 48px; line-height: 1'}, '\u{1F916}'),
    m('div', {style: 'font-size: 16px; font-weight: 500; color: var(--pf-color-text, #202124)'},
      'AI 助手已弹出为浮动窗口'),
    m('div', {style: 'font-size: 13px; max-width: 360px; line-height: 1.5'},
      '浮动窗口可以拖动位置和调整大小，并且在你切换其他面板时保持可见。点击下面的按钮可以收回到这个标签页。'),
    m('button', {
      style: `
        background: var(--pf-color-primary, #3d5688);
        color: white;
        border: none;
        border-radius: 6px;
        padding: 10px 20px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
      `,
      onclick: () => switchFloatingMode('tab'),
    }, [
      m(Icon, {icon: 'open_in_new_off', style: 'font-size: 16px'}),
      m('span', '收回到标签页'),
    ]),
  ]);
}

/**
 * Placeholder shown in the AI Assistant tab when the panel is displayed
 * in the right sidebar.
 */
function renderSidebarPlaceholder(): m.Children {
  return m('div', {
    style: `
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 48px 24px;
      height: 100%;
      font-family: 'Roboto', sans-serif;
      color: var(--pf-color-text-muted, #5f6368);
      text-align: center;
    `,
  }, [
    m('div', {style: 'font-size: 48px; line-height: 1'}, '\u{1F916}'),
    m('div', {style: 'font-size: 16px; font-weight: 500; color: var(--pf-color-text, #202124)'},
      'AI 助手已显示在右侧边栏'),
    m('div', {style: 'font-size: 13px; max-width: 360px; line-height: 1.5'},
      '侧边栏不会遮挡 Trace 内容，可以拖动左边缘调整宽度。点击下面的按钮可以收回到这个标签页。'),
    m('button', {
      style: `
        background: var(--pf-color-primary, #3d5688);
        color: white;
        border: none;
        border-radius: 6px;
        padding: 10px 20px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
      `,
      onclick: () => switchFloatingMode('tab'),
    }, [
      m(Icon, {icon: 'open_in_new_off', style: 'font-size: 16px'}),
      m('span', '收回到标签页'),
    ]),
  ]);
}