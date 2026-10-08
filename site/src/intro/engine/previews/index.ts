// The preview panel for each slide that has one, by slide id. Slide 3 ('dedupe') keeps its
// own SearchPreview (site/src/intro/engine/SearchPreview.tsx); the stage picks it by name.
import type React from 'react'
import type { PreviewProps } from './types'
import { SharePreview } from './Share'
import { MiddlewarePreview } from './Middleware'
import { PaginationPreview } from './Pagination'
import { PollingPreview } from './Polling'
import { CachePreview } from './Cache'
import { TogetherPreview } from './Together'

export type { PreviewProps }

export const PREVIEWS: Record<string, React.FC<PreviewProps>> = {
  share: SharePreview,
  middleware: MiddlewarePreview,
  pagination: PaginationPreview,
  polling: PollingPreview,
  cache: CachePreview,
  together: TogetherPreview,
}
