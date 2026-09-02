import cardRegistryData from "../../resources/riftbound_card_registry.json";
import { buildMulliganLabRegistry } from "../shared/mulliganLab";

/** Shared once by Deck Insights, Replay Coach, Data Lab, and the training labs. */
export const INSIGHT_CARD_REGISTRY = buildMulliganLabRegistry(cardRegistryData);
export const INSIGHT_CARD_CATALOG = [...INSIGHT_CARD_REGISTRY.byCode.values()];
