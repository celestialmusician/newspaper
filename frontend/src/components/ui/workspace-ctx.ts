import * as React from 'react'

/**
 * Records workspace: the list fills the page and the form lives in a drawer that slides in from
 * the right when the reader adds or edits a record. The list (DataTable) reads this context to
 * show the "Add" button and the "Add" tile; the form (FormCard) reads it to render as a drawer.
 */
export interface Workspace {
  open: boolean
  setOpen: (v: boolean) => void
  /** What one record is called, in lower case: "delivery boy", "route". */
  noun: string
}
export const WorkspaceCtx = React.createContext<Workspace | null>(null)
export const useWorkspace = () => React.useContext(WorkspaceCtx)
