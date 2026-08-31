import type { Probe } from "@sidik/shared";
import { honeypotProbe } from "./honeypot";
import { hiddenFeeProbe } from "./hiddenFee";
import { approvalDrainProbe } from "./approvalDrain";
import { lpRugProbe } from "./lpRug";
import { crossVenueProbe } from "./crossVenue";
import { ownerTrapProbe } from "./ownerTrap";

export const PROBES: Probe[] = [honeypotProbe, hiddenFeeProbe, approvalDrainProbe, lpRugProbe, crossVenueProbe, ownerTrapProbe];
