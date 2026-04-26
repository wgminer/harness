export interface NoteSummary {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
}

export interface Note extends NoteSummary {
  content: string;
}

export const UNTITLED_NOTE_TITLE = "Untitled note";
