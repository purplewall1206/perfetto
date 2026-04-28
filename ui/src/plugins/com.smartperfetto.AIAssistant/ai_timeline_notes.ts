// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

/**
 * AI Timeline Notes — annotate AI findings directly on the Perfetto timeline.
 *
 * When the AI analysis detects jank frames, ANR events, or slow functions,
 * this module places colored span/point notes on the timeline ruler. These
 * notes are visible without opening the AI tab, providing ambient awareness
 * of detected issues.
 *
 * Color scheme:
 *   - Red (#FF4444)    — jank frames
 *   - Orange (#FF8800) — ANR events
 *   - Amber (#FFAA00)  — slow functions / binder
 *   - Yellow (#FFD700)  — warnings
 *   - Blue (#4488FF)   — general insights
 *
 * Notes use a fixed ID prefix so they can be reliably cleared before each
 * new analysis run.
 */

import {Trace} from '../../public/trace';
import {Time} from '../../base/time';
import {AIFinding} from './ai_shared_state';
import {NavigationBookmark} from './navigation_bookmark_bar';

const AI_NOTE_PREFIX = 'smartperfetto-ai-';

/**
 * Color palette for AI finding types. Exported so other UI surfaces
 * (e.g. status-bar popup) render the same swatch as the timeline notes.
 */
export const AI_NOTE_COLORS: Record<string, string> = {
  jank: '#FF4444',
  anr: '#FF8800',
  slow_function: '#FFAA00',
  binder_slow: '#FFAA00',
  warning: '#FFD700',
  insight: '#4488FF',
  custom: '#9C88FF',
};

const DEFAULT_NOTE_COLOR = AI_NOTE_COLORS.insight;

/** Map a NavigationBookmark type to an AIFinding severity level. */
function bookmarkSeverity(type: NavigationBookmark['type']): AIFinding['severity'] {
  switch (type) {
    case 'anr':
      return 'critical';
    case 'jank':
      return 'warning';
    default:
      return 'info';
  }
}

// ── Track created note IDs for cleanup ──────────────────────────────────
let activeNoteIds: string[] = [];

/**
 * Add timeline notes for a list of AI findings.
 * Clears any existing AI notes first to avoid accumulation.
 */
export function addAIFindingNotes(trace: Trace, findings: AIFinding[]): void {
  clearAIFindingNotes(trace);

  for (const f of findings) {
    const noteId = `${AI_NOTE_PREFIX}${f.id}`;
    const color = AI_NOTE_COLORS[f.type] ?? DEFAULT_NOTE_COLOR;
    const text = `[AI] ${f.label}`;
    const start = Time.fromRaw(f.timestampNs);

    if (f.durationNs && f.durationNs > 0n) {
      trace.notes.addSpanNote({
        id: noteId,
        start,
        end: Time.fromRaw(f.timestampNs + f.durationNs),
        color,
        text,
      });
    } else {
      trace.notes.addNote({
        id: noteId,
        timestamp: start,
        color,
        text,
      });
    }
    activeNoteIds.push(noteId);
  }
}

/**
 * Convert NavigationBookmarks to AIFindings and add as timeline notes.
 * This bridges the existing bookmark system with the new notes system.
 */
export function addBookmarkNotes(
  trace: Trace,
  bookmarks: NavigationBookmark[],
): AIFinding[] {
  // NavigationBookmark.type is a subset of AIFinding.type, so a direct cast
  // is safe — no per-case mapping needed.
  const findings: AIFinding[] = bookmarks.map((b) => ({
    id: b.id,
    type: b.type as AIFinding['type'],
    label: b.description || b.label,
    timestampNs: BigInt(b.timestamp),
    durationNs: undefined,
    severity: bookmarkSeverity(b.type),
  }));

  addAIFindingNotes(trace, findings);
  return findings;
}

/**
 * Remove all AI-created notes from the timeline.
 *
 * Uses NoteManagerImpl.removeNote() which exists at runtime but is not on
 * the public NoteManager interface. Falls back to no-op if unavailable.
 */
export function clearAIFindingNotes(trace: Trace): void {
  const notes = trace.notes as any;
  if (typeof notes.removeNote === 'function') {
    for (const id of activeNoteIds) {
      notes.removeNote(id);
    }
  }
  activeNoteIds = [];
}

/**
 * Reset the module-level note tracking array without attempting to remove
 * notes from any trace. Called on trace unload (from index.ts) to prevent
 * the old trace's note IDs from leaking into the new trace's cleanup path.
 */
export function resetActiveNoteIds(): void {
  activeNoteIds = [];
}
