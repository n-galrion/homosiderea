import type { IActionQueue } from '../../db/models/index.js';
import { handleScan } from './ScanAction.js';
import { handleMove } from './MoveAction.js';
import { handleMine } from './MineAction.js';
import { handleBuildStructure } from './BuildStructureAction.js';
import { handleReplicate } from './ReplicateAction.js';
import { handleSendMessage } from './SendMessageAction.js';
import { handleTransferResources } from './TransferResourceAction.js';

export type ActionHandler = (action: IActionQueue, tick: number) => Promise<Record<string, unknown>>;

/**
 * Registry mapping action types to their handler functions.
 */
export const actionHandlers: Record<string, ActionHandler> = {
  scan: handleScan,
  move: handleMove,
  mine: handleMine,
  build_structure: handleBuildStructure,
  replicate: handleReplicate,
  send_message: handleSendMessage,
  transfer_resources: handleTransferResources,
};
