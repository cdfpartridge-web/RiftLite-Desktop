export interface NewPlayerVideo {
  id: string;
  title: string;
  creator: string;
  url: string;
  topicIds: readonly string[];
  lessonIds: readonly string[];
}

/** Populate only with the user's selected creator guides, including their chain guide. */
export const NEW_PLAYER_VIDEOS: readonly NewPlayerVideo[] = [];
