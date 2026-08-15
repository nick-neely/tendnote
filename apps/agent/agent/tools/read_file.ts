import { disableTool } from "eve/tools";

/**
 * `base.md` tells the user "You never receive or read file contents" and points
 * uploads at Asset Evidence instead. That has to be structural, not prose: the
 * framework default reads the sandbox filesystem, which is not a Tendnote record.
 */
export default disableTool();
