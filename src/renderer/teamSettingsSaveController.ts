import type { SocialTeamDraft, SocialTeamProfile } from "../shared/types";

type SaveRequest = {
  navigationRevision: number;
  isCurrent: () => boolean;
  teamId: string;
  draft: SocialTeamDraft;
  expectedUpdatedAt: number;
  update: (teamId: string, patch: SocialTeamDraft) => Promise<SocialTeamProfile>;
  started: () => void;
  saved: (team: SocialTeamProfile) => void;
  refresh: (isCurrent: () => boolean) => Promise<void>;
  failed: (message: string) => void;
  finished: () => void;
};

/** A save may finish on the server after its team view has been left. */
export class TeamSettingsSaveController {
  private active: { navigationRevision: number } | null = null;

  async save(request: SaveRequest): Promise<boolean> {
    if (!request.isCurrent() || this.active?.navigationRevision === request.navigationRevision) return false;
    const operation = { navigationRevision: request.navigationRevision };
    this.active = operation;
    const current = () => this.active === operation && request.isCurrent();
    request.started();
    try {
      const team = await request.update(request.teamId, {
        ...request.draft, expectedUpdatedAt: request.expectedUpdatedAt
      });
      if (!current()) return false;
      request.saved(team);
      await request.refresh(current);
      return current();
    } catch (error) {
      if (current()) request.failed(error instanceof Error ? error.message : "Could not update team.");
      return false;
    } finally {
      if (current()) request.finished();
      if (this.active === operation) this.active = null;
    }
  }
}
