import { createContext } from "react";

// Only personal-data views provide this callback. Community and hub statistics
// retain their existing read-only details rather than resolving IDs as local games.
export const GameDetailsNavigationContext = createContext<((matchId: string) => void) | null>(null);
