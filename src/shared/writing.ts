export interface WritingNoteSummary {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
}

export interface WritingNote extends WritingNoteSummary {
  content: string;
}

export const UNTITLED_NOTE_TITLE = "Untitled note";
