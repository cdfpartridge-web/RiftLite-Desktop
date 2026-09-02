import { CoachQuestCard, type CoachQuestViewModel } from "./CoachQuestCard";
import { ShareCardDialog } from "./ShareCardDialog";

export function CoachShareCardDialog({
  quest,
  caption,
  onClose
}: {
  quest: CoachQuestViewModel;
  caption: string;
  onClose: () => void;
}) {
  return (
    <ShareCardDialog
      eyebrow="Share your lesson"
      title="Coach card preview"
      description="Only the lesson, game data and card art are included. Everything is rendered and saved locally."
      label={`Coach-${quest.title}`}
      caption={caption}
      captureErrorMessage="The coaching card could not be captured."
      onClose={onClose}
    >
      <CoachQuestCard quest={quest} mode="share-preview" />
    </ShareCardDialog>
  );
}
