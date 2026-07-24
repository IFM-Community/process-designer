import { createContext } from 'react'

// Shared board callbacks used by custom nodes:
//  - setNodeLabel(id, label): commit an edited label back into board state
//  - setInfo(shape | null): show a shape's explanation in the sidebar on hover
export const BoardContext = createContext({
  setNodeLabel: () => {},
  setEdgeLabel: () => {},
  changeNodeType: () => {},
  setNodeSystem: () => {},
  setAnalysis: () => {},
  setInfo: () => {},
})
