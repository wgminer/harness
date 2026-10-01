import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowUp,
  Check,
  Copy,
  FileAudio,
  FileText,
  Loader2,
  Mic,
  SquarePen,
  X,
} from "lucide-react";
import { useState } from "react";
import { AttachmentCard } from "../chat/AttachmentCard";
import { ChatComposer } from "../chat/ChatComposer";
import { ChatModePicker } from "../chat/ChatModePicker";
import type { ChatModeId } from "../../shared/chatModes";
import { StreamingAssistantContent } from "../chat/StreamingAssistantContent";
import { MessageContent, Section } from "./storyHelpers";

function ComposerIdle() {
  const [mode, setMode] = useState<ChatModeId>("chat");
  const [input, setInput] = useState("");
  const [attachedAudioName, setAttachedAudioName] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  return (
    <ChatComposer
      input={input}
      onInputChange={setInput}
      onSend={() => {}}
      onStop={() => {}}
      sending={false}
      voiceState="idle"
      voiceError={null}
      recordingMs={0}
      onStartRecording={() => {}}
      onStopRecording={() => {}}
      onCancelRecording={() => {}}
      attachedAudioName={attachedAudioName}
      attachmentTranscribing={false}
      attachmentError={attachmentError}
      onAttachAudio={(file) => {
        setAttachedAudioName(file?.name ?? null);
        setAttachmentError(null);
      }}
      onRemoveAttachedAudio={() => {
        setAttachedAudioName(null);
        setAttachmentError(null);
      }}
      onAttachmentError={setAttachmentError}
      placeholder="Message…"
      modeControl={<ChatModePicker value={mode} onChange={setMode} />}
    />
  );
}

function ComposerRecording() {
  return (
    <div className="chat-composer-inner" style={{ maxWidth: 640 }}>
      <div className="chat-composer-row">
        <textarea className="chat-input" rows={1} disabled placeholder="Recording…" />
        <div className="input-actions">
          <span className="voice-timer">0:12.4</span>
          <div className="input-actions-spacer" />
          <button type="button" className="btn btn-icon btn-primary chat-pane-btn chat-pane-btn--icon" aria-label="Stop">
            <Mic size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ComposerProcessing() {
  return (
    <div className="chat-composer-inner" style={{ maxWidth: 640 }}>
      <div className="chat-composer-row">
        <textarea className="chat-input" rows={1} disabled />
        <div className="input-actions">
          <span className="voice-status">
            <Loader2 size={13} className="voice-spinner" />
            Transcribing…
          </span>
          <div className="input-actions-spacer" />
        </div>
      </div>
    </div>
  );
}

function ComposerSending() {
  return (
    <div className="chat-composer-inner" style={{ maxWidth: 640 }}>
      <div className="chat-composer-row">
        <textarea className="chat-input" rows={1} defaultValue="Summarize the notes above" />
        <div className="input-actions">
          <div className="input-actions-spacer" />
          <button type="button" className="btn chat-pane-btn input-actions-stop">
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatGallery() {
  return (
    <div>
      <Section title="Composer · idle" stack>
        <ComposerIdle />
      </Section>

      <Section title="Composer · recording" stack>
        <ComposerRecording />
      </Section>

      <Section title="Composer · processing" stack>
        <ComposerProcessing />
      </Section>

      <Section title="Composer · sending" stack>
        <ComposerSending />
      </Section>

      <Section title="Attachment strip" stack>
        <div className="chat-attachment-strip" style={{ maxWidth: 640 }}>
          <AttachmentCard
            icon={<FileAudio size={12} strokeWidth={1.75} />}
            title="interview.m4a"
            meta="Audio · transcribed on send"
            onRemove={() => {}}
            removeLabel="Remove"
          />
          <AttachmentCard
            icon={<FileText size={12} strokeWidth={1.75} />}
            title="notes.md"
            meta="MD · 42 lines"
            onRemove={() => {}}
            removeLabel="Remove"
          />
          <AttachmentCard
            variant="paste"
            icon={<FileText size={12} strokeWidth={1.75} />}
            title="Skip to content Skip to site index Section Navigation"
            meta="Pasted · 103 lines"
            onOpen={() => {}}
            openLabel="Move into the message"
            onRemove={() => {}}
            removeLabel="Remove"
          />
        </div>
      </Section>

      <Section title="Voice error" stack>
        <div className="voice-error">
          Microphone permission denied.{" "}
          <button type="button" className="voice-save-link">
            Open settings
          </button>
        </div>
      </Section>

      <Section title="Stream wait label" stack>
        <MessageContent>
          <StreamingAssistantContent
            content=""
            isStreaming
            messageId="story-wait"
            copiedId={null}
            savedNoteIds={{}}
            onCopied={() => {}}
            onSaveToNotes={() => {}}
          />
        </MessageContent>
      </Section>

      <Section title="Message footer" stack>
        <MessageContent>
          <p>Assistant reply ends here.</p>
          <div className="message-block-footer">
            <div className="message-block-meta">
              <span className="message-block-meta-role message-block-meta-model">gpt-5</span>
              <span className="message-block-meta-text">
                <span className="message-block-meta-sep">·</span>
                <span className="message-block-meta-time">2:14 PM</span>
              </span>
            </div>
            <div className="message-block-footer-actions">
              <button type="button" className="message-footer-icon-btn" aria-label="Edit">
                <SquarePen size={14} />
              </button>
              <button type="button" className="message-copy-btn" aria-label="Copy">
                <Copy size={14} />
              </button>
              <button type="button" className="message-copy-btn" aria-label="Copied">
                <Check size={14} />
              </button>
            </div>
          </div>
        </MessageContent>
      </Section>

      <Section title="User message card" stack>
        <div className="message-block">
          <div className="message-user-card">
            <div className="message-user-card__content">
              <p>
                Long user prompt that would normally collapse with a fade when it exceeds the
                threshold. Hover the footer icons above after expanding the message footer section.
              </p>
            </div>
            <div className="message-user-card__fade" aria-hidden />
            <button type="button" className="message-user-card__toggle">
              Show more
            </button>
          </div>
        </div>
      </Section>

      <Section title="New chat empty state" stack>
        <div className="new-chat-pane" style={{ minHeight: 220 }}>
          <p className="new-chat-corner new-chat-corner--bottom-right" aria-hidden="true">
            v0.10.1 · dev
          </p>
          <div className="new-chat-center">
            <div className="new-chat-center-stack">
              <span className="tooltip new-chat-quote-tooltip">
                <p className="new-chat-quote">
                  “The impediment to action advances action. What stands in the way becomes the way.”
                </p>
                <span className="tooltip__label">
                  <span className="new-chat-quote-tooltip__attr">Marcus Aurelius, Meditations</span>
                  <span>
                    These are private notes a Roman emperor wrote to himself while on campaign. Treat
                    the obstacle as the path — resistance can become fuel.
                  </span>
                </span>
              </span>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

const meta = {
  title: "UI/Chat",
  component: ChatGallery,
} satisfies Meta<typeof ChatGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};
