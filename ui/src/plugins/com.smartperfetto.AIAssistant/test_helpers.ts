// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * Shared helpers for AIAssistant unit tests.
 *
 * Small utilities that multiple `*_unittest.ts` files need — kept in a
 * dedicated module rather than copied per test file, so the definitions
 * stay in sync.
 */

/**
 * Override `window.innerWidth` / `window.innerHeight` for a test.
 *
 * Jest's jsdom environment exposes both as writable/configurable so we
 * can redefine them for viewport-dependent assertions, but you have to
 * respell the descriptor every time. This helper just hides that.
 */
export function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', {value: width, writable: true, configurable: true});
  Object.defineProperty(window, 'innerHeight', {value: height, writable: true, configurable: true});
}
