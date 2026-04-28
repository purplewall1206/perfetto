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
import type {AISettings, ServerStatus} from './types';

export interface SettingsModalAttrs {
  settings: AISettings;
  onClose: () => void;
  onSave: (settings: AISettings) => void;
  onCheckStatus: (backendUrl: string, apiKey: string) => Promise<ServerStatus>;
  initialStatus?: ServerStatus;
}

// Dark-mode-aware color scheme using CSS variables from the plugin's
// --chat-* token layer (defined in styles.scss). Fallback hex values match
// the light-mode defaults so the modal looks correct even outside .ai-panel.
const COLORS = {
  primary: 'var(--chat-primary, #3d5688)',
  primaryHover: 'var(--chat-primary-hover, #2e4470)',
  primaryLight: 'color-mix(in srgb, var(--chat-primary, #3d5688) 12%, transparent)',
  success: 'var(--chat-success, #10b981)',
  successLight: 'color-mix(in srgb, var(--chat-success, #10b981) 12%, transparent)',
  warning: 'var(--chat-warning, #f59e0b)',
  warningLight: 'color-mix(in srgb, var(--chat-warning, #f59e0b) 12%, transparent)',
  error: 'var(--chat-error, #ef4444)',
  errorLight: 'color-mix(in srgb, var(--chat-error, #ef4444) 12%, transparent)',
  info: 'var(--chat-primary, #3b82f6)',
  infoLight: 'color-mix(in srgb, var(--chat-primary, #3b82f6) 12%, transparent)',
};

// Inline styles for modal
const MODAL_STYLES = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: 10000,
    animation: 'fadeIn 0.2s ease-out',
  },
  modal: {
    backgroundColor: 'var(--chat-bg)',
    color: 'var(--chat-text)',
    borderRadius: '12px',
    width: '540px',
    maxWidth: '90vw',
    maxHeight: '85vh',
    overflow: 'hidden' as const,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4), 0 0 1px rgba(255, 255, 255, 0.1)',
    border: '1px solid var(--chat-border)',
    animation: 'slideUp 0.3s ease-out',
  },
  header: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: '20px 24px',
    borderBottom: '1px solid var(--chat-border)',
    background: 'var(--chat-bg-secondary)',
  },
  headerLeft: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: '12px',
  },
  headerIcon: {
    fontSize: '20px',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    color: 'var(--chat-text)',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    fontSize: '22px',
    cursor: 'pointer',
    color: 'var(--chat-text-secondary)',
    padding: '4px',
    width: '32px',
    height: '32px',
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: '6px',
    transition: 'all 0.15s ease',
  },
  content: {
    padding: '24px',
    overflowY: 'auto' as const,
    flex: 1,
  },
  section: {
    marginBottom: '24px',
  },
  sectionTitle: {
    margin: '0 0 16px 0',
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--chat-text-secondary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.8px',
  },
  field: {
    marginBottom: '20px',
  },
  fieldLabel: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: '6px',
    marginBottom: '8px',
    fontSize: '14px',
    fontWeight: 500,
    color: 'var(--chat-text)',
  },
  fieldIcon: {
    fontSize: '14px',
  },
  input: {
    width: '100%',
    padding: '11px 14px',
    border: '1px solid var(--chat-border)',
    borderRadius: '8px',
    backgroundColor: 'var(--chat-bg-secondary)',
    color: 'var(--chat-text)',
    fontSize: '14px',
    boxSizing: 'border-box' as const,
    transition: 'all 0.15s ease',
    fontFamily: 'inherit',
  },
  hint: {
    fontSize: '12px',
    color: 'var(--chat-text-secondary)',
    marginTop: '6px',
    lineHeight: '1.4',
  },
  alertBox: {
    display: 'flex' as const,
    gap: '10px',
    padding: '12px 14px',
    borderRadius: '8px',
    fontSize: '13px',
    lineHeight: '1.4',
  },
  alertInfo: {
    background: COLORS.infoLight,
    border: `1px solid color-mix(in srgb, var(--chat-primary, #3b82f6) 25%, transparent)`,
    color: COLORS.info,
  },
  alertWarning: {
    background: COLORS.warningLight,
    border: `1px solid color-mix(in srgb, var(--chat-warning, #f59e0b) 25%, transparent)`,
    color: COLORS.warning,
  },
  alertIcon: {
    fontSize: '16px',
    flexShrink: 0,
  },
  statusBtn: {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    gap: '6px',
    padding: '10px 18px',
    border: '1px solid var(--chat-border)',
    borderRadius: '8px',
    backgroundColor: 'var(--chat-bg-secondary)',
    color: 'var(--chat-text)',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    transition: 'all 0.15s ease',
  },
  statusBtnDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  statusCard: {
    marginTop: '14px',
    padding: '16px',
    borderRadius: '10px',
    border: '1px solid var(--chat-border)',
    backgroundColor: 'var(--chat-bg-secondary)',
  },
  statusRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    padding: '6px 0',
    fontSize: '13px',
  },
  statusLabel: {
    color: 'var(--chat-text-secondary)',
    fontWeight: 500,
  },
  statusValue: {
    color: 'var(--chat-text)',
    fontWeight: 600,
  },
  statusDot: {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    marginRight: '6px',
  },
  statusHeaderRow: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: '8px',
  },
  statusHeaderText: {
    fontWeight: 600,
    fontSize: '14px',
  },
  footer: {
    display: 'flex' as const,
    justifyContent: 'flex-end' as const,
    gap: '10px',
    padding: '16px 24px',
    borderTop: '1px solid var(--chat-border)',
    background: 'var(--chat-bg-secondary)',
  },
  btn: {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    gap: '6px',
    padding: '10px 20px',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  btnSecondary: {
    backgroundColor: 'transparent',
    color: 'var(--chat-text-secondary)',
    border: '1px solid var(--chat-border)',
  },
  btnPrimary: {
    backgroundColor: COLORS.primary,
    color: 'white',
  },
};

export class SettingsModal implements m.ClassComponent<SettingsModalAttrs> {
  private settings!: AISettings;
  private isChecking = false;
  private serverStatus: ServerStatus | null = null;
  private onCheckStatus!: SettingsModalAttrs['onCheckStatus'];

  oninit(vnode: m.Vnode<SettingsModalAttrs>) {
    this.settings = {...vnode.attrs.settings};
    this.onCheckStatus = vnode.attrs.onCheckStatus;
    this.serverStatus = vnode.attrs.initialStatus ?? null;
  }

  private async checkStatus() {
    this.isChecking = true;
    this.serverStatus = null;
    m.redraw();

    this.serverStatus = await this.onCheckStatus(
      this.settings.backendUrl,
      this.settings.backendApiKey || '',
    );
    this.isChecking = false;
    m.redraw();
  }

  private renderStatusCard(): m.Children {
    const status = this.serverStatus;
    if (!status) return null;

    if (!status.connected) {
      return m('div', {style: MODAL_STYLES.statusCard}, [
        m('div', {style: {...MODAL_STYLES.statusHeaderRow, color: COLORS.error}}, [
          m('span', {style: {...MODAL_STYLES.statusDot, backgroundColor: COLORS.error}}),
          m('span', {style: MODAL_STYLES.statusHeaderText}, 'Connection Failed'),
        ]),
        m('div', {style: {...MODAL_STYLES.hint, marginTop: '8px', lineHeight: '1.5'}},
          'Cannot reach backend. Make sure the backend is running and the URL is correct.'),
      ]);
    }

    const runtimeLabel = status.runtime === 'agentv3'
      ? 'Claude Agent SDK (agentv3)'
      : status.runtime === 'agentv2'
        ? 'Legacy Agent (agentv2)'
        : 'Unknown';

    return m('div', {style: MODAL_STYLES.statusCard}, [
      m('div', {style: {...MODAL_STYLES.statusHeaderRow, color: COLORS.success, marginBottom: '12px'}}, [
        m('span', {style: {...MODAL_STYLES.statusDot, backgroundColor: COLORS.success}}),
        m('span', {style: MODAL_STYLES.statusHeaderText}, 'Connected'),
      ]),
      m('div', {style: MODAL_STYLES.statusRow}, [
        m('span', {style: MODAL_STYLES.statusLabel}, 'Engine'),
        m('span', {style: MODAL_STYLES.statusValue}, runtimeLabel),
      ]),
      status.model
        ? m('div', {style: MODAL_STYLES.statusRow}, [
            m('span', {style: MODAL_STYLES.statusLabel}, 'Model'),
            m('span', {style: {...MODAL_STYLES.statusValue, fontFamily: 'monospace', fontSize: '12px'}}, status.model),
          ])
        : null,
      m('div', {style: MODAL_STYLES.statusRow}, [
        m('span', {style: MODAL_STYLES.statusLabel}, 'AI Ready'),
        m('span', {style: {...MODAL_STYLES.statusValue, color: status.configured ? COLORS.success : COLORS.error}},
          status.configured ? 'Yes' : 'No (API key missing)'),
      ]),
      status.environment
        ? m('div', {style: MODAL_STYLES.statusRow}, [
            m('span', {style: MODAL_STYLES.statusLabel}, 'Environment'),
            m('span', {style: MODAL_STYLES.statusValue}, status.environment),
          ])
        : null,
      // Auth warning
      status.authRequired
        ? m('div', {style: {...MODAL_STYLES.alertBox, ...MODAL_STYLES.alertWarning, marginTop: '12px'}}, [
            m('span', {style: MODAL_STYLES.alertIcon}, '!'),
            m('div', 'Backend requires API key authentication (SMARTPERFETTO_API_KEY). Make sure the API Key field above is correctly configured.'),
          ])
        : null,
    ]);
  }

  view(vnode: m.Vnode<SettingsModalAttrs>) {
    return m(
      'div',
      {style: MODAL_STYLES.overlay},
      m(
        'div',
        {style: MODAL_STYLES.modal},
        [
          m('div', {style: MODAL_STYLES.header}, [
            m('div', {style: MODAL_STYLES.headerLeft}, [
              m('span', {style: MODAL_STYLES.headerIcon}, '⚙️'),
              m('h3', {style: MODAL_STYLES.title}, 'AI Assistant Settings'),
            ]),
            m(
              'button',
              {
                style: MODAL_STYLES.closeBtn,
                onclick: () => vnode.attrs.onClose(),
              },
              '×'
            ),
          ]),

          m('div', {style: MODAL_STYLES.content}, [
            m('div', {style: MODAL_STYLES.section}, [
              m('h4', {style: MODAL_STYLES.sectionTitle}, 'Backend Connection'),
              m('div', {style: MODAL_STYLES.field}, [
                m('label', {style: MODAL_STYLES.fieldLabel}, [
                  m('span', {style: MODAL_STYLES.fieldIcon}, '🖥️'),
                  'Backend URL',
                ]),
                m('input[type=text]', {
                  style: MODAL_STYLES.input,
                  value: this.settings.backendUrl,
                  onchange: (e: Event) => {
                    this.settings.backendUrl = (e.target as HTMLInputElement).value;
                  },
                  placeholder: 'http://localhost:3000',
                }),
              ]),
              m('div', {style: MODAL_STYLES.field}, [
                m('label', {style: MODAL_STYLES.fieldLabel}, [
                  m('span', {style: MODAL_STYLES.fieldIcon}, '🔐'),
                  'API Key',
                ]),
                m('input[type=password]', {
                  style: MODAL_STYLES.input,
                  value: this.settings.backendApiKey || '',
                  onchange: (e: Event) => {
                    this.settings.backendApiKey = (e.target as HTMLInputElement).value;
                  },
                  placeholder: 'Optional: SMARTPERFETTO_API_KEY',
                }),
                m('div', {style: MODAL_STYLES.hint}, 'Required only if backend has SMARTPERFETTO_API_KEY configured.'),
              ]),
            ]),

            m('div', {style: MODAL_STYLES.section}, [
              m('h4', {style: MODAL_STYLES.sectionTitle}, 'Server Status'),
              m('div', {style: {display: 'flex', alignItems: 'center', gap: '12px'}}, [
                m(
                  'button',
                  {
                    style: {
                      ...MODAL_STYLES.statusBtn,
                      ...(this.isChecking ? MODAL_STYLES.statusBtnDisabled : {}),
                    },
                    onclick: () => this.checkStatus(),
                    disabled: this.isChecking,
                  },
                  this.isChecking ? '⏳ Checking...' : '🔌 Check Status'
                ),
              ]),
              this.renderStatusCard(),
            ]),

            m('div', {style: {...MODAL_STYLES.alertBox, ...MODAL_STYLES.alertInfo}}, [
              m('span', {style: MODAL_STYLES.alertIcon}, 'ℹ️'),
              m('div', [
                m('span', 'AI model and provider are configured server-side via '),
                m('code', {style: {background: 'var(--chat-bg-tertiary, rgba(0,0,0,0.15))', padding: '2px 6px', borderRadius: '4px', fontSize: '12px'}}, 'backend/.env'),
                m('span', '. See '),
                m('code', {style: {background: 'var(--chat-bg-tertiary, rgba(0,0,0,0.15))', padding: '2px 6px', borderRadius: '4px', fontSize: '12px'}}, '.env.example'),
                m('span', ' for all available options.'),
              ]),
            ]),
          ]),

          m('div', {style: MODAL_STYLES.footer}, [
            m(
              'button',
              {
                style: {...MODAL_STYLES.btn, ...MODAL_STYLES.btnSecondary},
                onclick: () => vnode.attrs.onClose(),
              },
              'Cancel'
            ),
            m(
              'button',
              {
                style: {...MODAL_STYLES.btn, ...MODAL_STYLES.btnPrimary},
                onclick: () => vnode.attrs.onSave(this.settings),
              },
              '💾 Save Settings'
            ),
          ]),
        ]
      )
    );
  }
}
