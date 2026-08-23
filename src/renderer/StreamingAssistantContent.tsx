import { useEffect, useMemo, useRef } from "react";
import { stripSentAtPrefix } from "../shared/chatTemporalContext";
import {
  flushStreamingMarkdown,
  splitStreamingMarkdown,
  type StreamingMarkdownBlocks,
} from "../shared/streamingMarkdownBlocks";
import { MarkdownContent, type MemorySearchHit } from "./chatHelpers";
import { Skeleton } from "./Skeleton";

interface StreamingAssistantContentProps {
  content: string;
  isStreaming: boolean;
  messageId: string;
  messageTimestamp?: number;
  copiedId: string | null;
  savedToNotesId: string | null;
  onCopied: (id: string | null) => void;
  onSaveToNotes: (id: string, content: string, messageTimestamp?: number) => void | Promise<void>;
  onOptionSelect?: (label: string) => void | Promise<void>;
  libraryHits?: MemorySearchHit[];
  onOpenConversation?: (conversationId: string) => void;
  onOpenNote?: (noteId: string) => void;
  onOpenImage?: (imageId: string) => void;
}

function StreamWaitSkeleton() {
  return <Skeleton className="ui-skeleton--prose-line" label="Generating reply" aria-busy="true" />;
}

export function StreamingAssistantContent({
  content,
  isStreaming,
  messageId,
  messageTimestamp,
  copiedId,
  savedToNotesId,
  onCopied,
  onSaveToNotes,
  onOptionSelect,
  libraryHits,
  onOpenConversation,
  onOpenNote,
  onOpenImage,
}: StreamingAssistantContentProps) {
  const stripped = stripSentAtPrefix(content);
  const blocksRef = useRef<StreamingMarkdownBlocks>({ completed: [], trailing: "" });

  useEffect(() => {
    blocksRef.current = { completed: [], trailing: "" };
  }, [messageId]);

  const split = useMemo(() => {
    const next = splitStreamingMarkdown(stripped, blocksRef.current);
    blocksRef.current = next;
    return next;
  }, [stripped]);

  const blocks = useMemo(() => {
    const presented = isStreaming ? split : flushStreamingMarkdown(split);
    return presented.completed;
  }, [isStreaming, split]);

  if (isStreaming && blocks.length === 0) {
    return <StreamWaitSkeleton />;
  }

  return (
    <div className="chat-streaming-assistant">
      {blocks.map((block, i) => (
        <div key={`${messageId}:block:${i}`} className="chat-stream-block">
          <MarkdownContent
            content={block}
            messageId={messageId}
            messageTimestamp={messageTimestamp}
            copiedId={copiedId}
            savedToNotesId={savedToNotesId}
            onCopied={onCopied}
            onSaveToNotes={onSaveToNotes}
            onOptionSelect={onOptionSelect}
            libraryHits={libraryHits}
            onOpenConversation={onOpenConversation}
            onOpenNote={onOpenNote}
            onOpenImage={onOpenImage}
          />
        </div>
      ))}
    </div>
  );
}
