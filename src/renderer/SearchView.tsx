import { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, MessageCircle, Search, StickyNote } from "lucide-react";
import type { SearchResult } from "../shared/types";
import { conversationDisplayTitle } from "../shared/conversationSession";
import { getDisplayNoteTitle, type NoteSummary } from "../shared/writing";
import { getDisplayImageTitle, type GeneratedImage } from "../shared/images";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceListSearch } from "./WorkspaceListSearch";

interface SearchViewProps {
  notes: NoteSummary[];
  images: GeneratedImage[];
  conversationId: string | null;
  activeNoteId: string | null;
  activeImageId: string | null;
  onSelectConversation: (id: string) => void;
  onSelectNote: (id: string) => void;
  onSelectImage: (id: string) => void;
}

function HighlightText({ text, range }: { text: string; range?: [number, number] }) {
  if (range == null || range[0] < 0 || range[1] <= range[0] || range[0] >= text.length) {
    return <>{text}</>;
  }
  const start = Math.max(0, range[0]);
  const end = Math.min(text.length, range[1]);
  return (
    <>
      {text.slice(0, start)}
      <mark className="search-highlight">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

export function SearchView({
  notes,
  images,
  conversationId,
  activeNoteId,
  activeImageId,
  onSelectConversation,
  onSelectNote,
  onSelectImage,
}: SearchViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const t = setTimeout(() => {
      window.harness.memory.searchConversations(trimmed, true).then((results) => {
        setSearchResults(results);
        setSearchLoading(false);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const noteSearchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return notes.filter((n) => getDisplayNoteTitle(n.title).toLowerCase().includes(q));
  }, [notes, searchQuery]);

  const imageSearchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return images.filter((img) => getDisplayImageTitle(img.title).toLowerCase().includes(q));
  }, [images, searchQuery]);

  const trimmed = searchQuery.trim();
  const hasQuery = trimmed.length > 0;
  const hasLocalMatches = noteSearchMatches.length > 0 || imageSearchMatches.length > 0;
  const empty =
    hasQuery &&
    !searchLoading &&
    searchResults.length === 0 &&
    !hasLocalMatches;
  const showSearching =
    hasQuery && searchLoading && searchResults.length === 0 && !hasLocalMatches;

  return (
    <div className="workspace-page search-page">
      <div className="workspace-scroll search-scroll">
        <WorkspaceHeader title="Search" icon={<Search size={24} />} />
        <div className="workspace-content workspace-stack search-content">
          <WorkspaceListSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search chats, notes, and images…"
            aria-label="Search"
            autoFocus
            inputRef={inputRef}
          />

          {!hasQuery ? (
            <p className="search-page-lead">Type to search chats, notes, and images.</p>
          ) : showSearching ? (
            <p className="search-page-lead">Searching…</p>
          ) : empty ? (
            <p className="search-page-lead">No results</p>
          ) : (
            <>
              {noteSearchMatches.length > 0 ? (
                <section className="workspace-section" aria-labelledby="search-notes-heading">
                  <h2 id="search-notes-heading" className="workspace-section-label">
                    Notes
                  </h2>
                  <ul className="search-results-list">
                    {noteSearchMatches.map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          className={`search-result-item${activeNoteId === n.id ? " active" : ""}`}
                          onClick={() => onSelectNote(n.id)}
                        >
                          <span className="search-result-item__icon" aria-hidden>
                            <StickyNote size={16} />
                          </span>
                          <span className="search-result-item__body">
                            <span className="search-result-title">
                              {getDisplayNoteTitle(n.title)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {imageSearchMatches.length > 0 ? (
                <section className="workspace-section" aria-labelledby="search-images-heading">
                  <h2 id="search-images-heading" className="workspace-section-label">
                    Images
                  </h2>
                  <ul className="search-results-list">
                    {imageSearchMatches.map((img) => (
                      <li key={img.id}>
                        <button
                          type="button"
                          className={`search-result-item${activeImageId === img.id ? " active" : ""}`}
                          onClick={() => onSelectImage(img.id)}
                        >
                          <span className="search-result-item__icon" aria-hidden>
                            <ImageIcon size={16} />
                          </span>
                          <span className="search-result-item__body">
                            <span className="search-result-title">
                              {getDisplayImageTitle(img.title)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {searchResults.length > 0 ? (
                <section className="workspace-section" aria-labelledby="search-chats-heading">
                  <h2 id="search-chats-heading" className="workspace-section-label">
                    Chats
                  </h2>
                  <ul className="search-results-list">
                    {searchResults.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          className={`search-result-item${conversationId === r.id ? " active" : ""}`}
                          onClick={() => onSelectConversation(r.id)}
                        >
                          <span className="search-result-item__icon" aria-hidden>
                            <MessageCircle size={16} />
                          </span>
                          <span className="search-result-item__body">
                            <span className="search-result-title">
                              <HighlightText
                                text={conversationDisplayTitle(r.title, r.createdAt)}
                                range={r.titleMatched ? r.titleMatchRange ?? undefined : undefined}
                              />
                            </span>
                            <span className="search-result-snippet">
                              <HighlightText
                                text={r.snippet}
                                range={
                                  r.snippetMatchRange[0] >= 0 &&
                                  r.snippetMatchRange[1] > r.snippetMatchRange[0]
                                    ? r.snippetMatchRange
                                    : undefined
                                }
                              />
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
