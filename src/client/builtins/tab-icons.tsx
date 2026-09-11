/**
 * The built-in tab glyphs, in color.
 *
 * Every built-in tab type and the incoming 8th (changes) declare their icon
 * here, so the three surfaces that draw a tab's glyph — the bottom workbench's
 * tab strip, the native right Sidebar's guide capsules and its tab chips — all
 * read the same colorful glyph from `descriptor.icon`.
 *
 * The color always arrives from a theme token, never from the plugin: the
 * glyph is a VSCodicon drawn in `currentColor`, and the wrapper class supplies
 * that color. A skin therefore keeps control of everything (the guide's §12);
 * this module is what `tests/theme.spec.ts` checks for color literals.
 *
 * `files` is the one exception in kind rather than in color: it renders DSH's
 * own folder artwork (`FileTypeIcon`), matching the file rows this tab shows.
 */
import { cloneElement, type ReactElement, type ReactNode } from 'react'
import { FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './tab-icons.module.css'
import {
  VscCommentDiscussion,
  VscGitCommit,
  VscGlobe,
  VscLayers,
  VscTerminal,
} from 'react-icons/vsc'
/** The styled wrapper classes; typed so a renamed rule fails the build. */
const css = styles as Record<'files' | 'changes' | 'tasks' | 'sidechat' | 'terminal' | 'browser', string>

/** One tab type's glyph, sized by the caller's surface (14px in a strip). */
export type TabIcon = (size: number) => ReactNode

/** Surround a glyph with the class that hands it its token-driven color. */
function themed(className: string, glyph: ReactNode): ReactNode {
  return <span className={className}>{glyph}</span>
}

/**
 * Give a filled VSCodicon a hairline of its own ink.
 *
 * The plugin's hand-drawn icons are 1.5px strokes on a 16px grid; the
 * VSCodicon set is filled at that size, and next to the plugin's own chrome a
 * bare fill reads heavy and slightly out of place — most visibly on the
 * terminal chip. A `currentColor` stroke in the SVG's own user units keeps the
 * host's shape and the token's color while lending it the same drawn weight,
 * and `paint-order: stroke` centres that hairline on the fill's edge instead
 * of fattening it.
 * @param icon - the glyph element to outline.
 * @returns the same glyph with its outline applied.
 */
function outlined(icon: ReactElement): ReactElement {
  return cloneElement(icon as ReactElement<{ style?: React.CSSProperties }>, {
    style: {
      // `non-scaling-stroke` keeps the hairline one device pixel whatever the
      // glyph's own grid is (the sets mix 16- and 24-unit viewBoxes and the
      // strip renders at 14px), and `paint-order: stroke` centres it on the
      // fill's edge instead of fattening the shape.
      stroke: 'currentColor',
      strokeWidth: 1,
      strokeLinejoin: 'round',
      paintOrder: 'stroke',
      vectorEffect: 'non-scaling-stroke',
    },
  })
}

/** The Files tab: the host's folder artwork, like the rows it opens. */
export const filesTabIcon: TabIcon = (size) => (
  <span className={css.files}>
    <FileTypeIcon kind="folder" size={size} />
  </span>
)

/** Changes / diff: the commit glyph, green like the diff affordances. */
export const changesTabIcon: TabIcon = (size) =>
  themed(css.changes, outlined(<VscGitCommit size={size} />))

/**
 * Tasks (subagents and background jobs) — the live-activity amber. The glyph
 * is layered sheets, not a checklist: this page lists RUNNING work (subagent
 * sessions plus the host's background jobs), not a to-do list.
 */
export const tasksTabIcon: TabIcon = (size) =>
  themed(css.tasks, outlined(<VscLayers size={size} />))

/** Side chat — the conversational/secondary accent. */
export const sidechatTabIcon: TabIcon = (size) =>
  themed(css.sidechat, outlined(<VscCommentDiscussion size={size} />))

/**
 * Terminal — primary ink, the shell is text. Drawn one step down from the
 * strip's 14px and with the outline above: the VSCodicon terminal is a wide
 * filled rectangle that dominated the chip at full size.
 */
export const terminalTabIcon: TabIcon = (size) =>
  themed(css.terminal, outlined(<VscTerminal size={Math.max(10, Math.round(size * 0.85))} />))

/** Browser — the same secondary accent as the side chat's sibling surfaces. */
export const browserTabIcon: TabIcon = (size) =>
  themed(css.browser, outlined(<VscGlobe size={size} />))
