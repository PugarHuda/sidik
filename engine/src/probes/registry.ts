import type { Probe } from "@sidik/shared";
import { honeypotProbe } from "./honeypot.js";
import { hiddenFeeProbe } from "./hiddenFee.js";
import { approvalDrainProbe } from "./approvalDrain.js";
import { lpRugProbe } from "./lpRug.js";

export const PROBES: Probe[] = [honeypotProbe, hiddenFeeProbe, approvalDrainProbe, lpRugProbe];
export const PROBE_IDS = PROBES.map((p) => p.id) as readonly string[];
