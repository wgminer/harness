import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ArrowUp,
  Check,
  Copy,
  FileAudio,
  Loader2,
  Mic,
  SquarePen,
  X,
} from "lucide-react";
import { useState } from "react";
import { ChatComposer } from "../ChatComposer";
import { ChatModePicker } from "../ChatModePicker";
import { Skeleton } from "../Skeleton";
import type { ChatModeId } from "../../shared/chatModes";
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
      <textarea className="chat-input" rows={2} disabled placeholder="Recording…" />
      <div className="input-actions">
        <span className="voice-timer">0:12.4</span>
        <div className="input-actions-spacer" />
        <button type="button" className="btn btn-icon btn-primary chat-pane-btn chat-pane-btn--icon" aria-label="Stop">
          <Mic size={15} />
        </button>
      </div>
    </div>
  );
}

function ComposerProcessing() {
  return (
    <div className="chat-composer-inner" style={{ maxWidth: 640 }}>
      <textarea className="chat-input" rows={2} disabled />
      <div className="input-actions">
        <span className="voice-status">
          <Loader2 size={13} className="voice-spinner" />
          Transcribing…
        </span>
        <div className="input-actions-spacer" />
      </div>
    </div>
  );
}

function ComposerSending() {
  return (
    <div className="chat-composer-inner" style={{ maxWidth: 640 }}>
      <textarea className="chat-input" rows={2} defaultValue="Summarize the notes above" />
      <div className="input-actions">
        <div className="input-actions-spacer" />
        <button type="button" className="btn chat-pane-btn input-actions-stop">
          Stop
        </button>
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
          <span className="chat-attachment-chip">
            <FileAudio size={11} strokeWidth={1.75} />
            <span className="chat-attachment-name">interview.m4a</span>
            <button type="button" className="chat-attachment-remove" aria-label="Remove">
              <X size={11} strokeWidth={1.75} />
            </button>
          </span>
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

      <Section title="Chat pane header" stack>
        <div className="chat-pane-header" style={{ maxWidth: 640 }}>
          <button type="button" className="btn chat-pane-title">
            Product brainstorm
          </button>
          <Skeleton className="ui-skeleton--title" />
        </div>
      </Section>

      <Section title="Message footer" stack>
        <MessageContent>
          <p>Assistant reply ends here.</p>
          <div className="message-block-footer">
            <div className="message-block-meta">
              <span className="message-block-meta-model">gpt-5</span>
              <span className="message-block-meta-sep">·</span>
              <span className="message-block-meta-time">2:14 PM</span>
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
          <p className="new-chat-corner new-chat-corner--top-left" aria-hidden="true">
            8:24 PM
          </p>
          <p className="new-chat-corner new-chat-corner--top-right" aria-hidden="true">
            Monday, Aug 10
          </p>
          <p className="new-chat-corner new-chat-corner--bottom-left" aria-hidden="true">
            3h 12m
          </p>
          <p className="new-chat-corner new-chat-corner--bottom-right" aria-hidden="true">
            72° · Highland
          </p>
          <div className="new-chat-center">
            <div className="new-chat-center-stack">
              <span className="tooltip new-chat-quote-tooltip">
                <p className="new-chat-quote">
                  “The impediment to action advances action. What stands in the way becomes the way.”
                </p>
                <span className="tooltip__label">
                  {`Marcus Aurelius, Meditations\nPrivate notes a Roman emperor wrote to himself while on campaign.\nTreat the obstacle as the path — resistance can become fuel.`}
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
