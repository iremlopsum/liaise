// The props every slide preview takes (see previews/index.ts). Frame-driven only: the same
// props always render the same picture.
import type { PreviewTheme } from '../SearchPreview'

export type { PreviewTheme }

export type PreviewProps = {
  /** Frames since the current preview action started (stateAt(...).previewFrame). */
  frame: number
  /** Which preview action of the slide is running: 0 = the first, 1 = the second. */
  index: number
  width: number
  height: number
  theme: PreviewTheme // from site/src/intro/engine/SearchPreview.tsx
}
