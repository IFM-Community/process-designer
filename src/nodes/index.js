import ProcessNode from './ProcessNode'
import ProcessEdge from './ProcessEdge'
import { TitleNode, LaneNode, LaneBandNode, AnalysisNode, PhaseBandNode, PhaseBlockNode } from './StructureNodes'
import { SHAPES } from '../shapes'

export const nodeTypes = {
  processTitle: TitleNode,
  laneBand: LaneBandNode,
  lane: LaneNode,
  analysisBox: AnalysisNode,
  phaseBand: PhaseBandNode,
  phaseBlock: PhaseBlockNode,
  ...Object.fromEntries(SHAPES.map((s) => [s.type, ProcessNode])),
}

export const edgeTypes = {
  process: ProcessEdge,
}
