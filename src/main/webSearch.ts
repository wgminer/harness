import { rigSection } from "../shared/rigPage";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResultPayload {
  query: string;
  answer?: string;
  results: WebSearchHit[];
  error?: string;
}

/** Tavily search for LLM apps — https://docs.tavily.com */
export async function searchWebTavily(
  apiKey: string,
  query: string,
  maxResults: number
): Promise<WebSearchResultPayload> {
  const q = query.trim();
  if (!q) {
    return { query: "", results: [], error: "Search query is required" };
  }
  if (!apiKey.trim()) {
    return {
      query: q,
      results: [],
      error: `Tavily API key is not set. Add it in ${rigSection("Tools")}.`,
    };
  }

  const n = Math.min(10, Math.max(1, Math.floor(maxResults) || 5));

  const res = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey.trim(),
      query: q,
      search_depth: "basic",
      max_results: n,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const detail =
      typeof raw.detail === "string"
        ? raw.detail
        : typeof raw.message === "string"
          ? raw.message
          : res.statusText || `HTTP ${res.status}`;
    return { query: q, results: [], error: `Tavily error: ${detail}` };
  }

  const resultsRaw = Array.isArray(raw.results) ? raw.results : [];
  const results: WebSearchHit[] = resultsRaw.map((row) => {
    const r = row as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title : "";
    const url = typeof r.url === "string" ? r.url : "";
    const content = typeof r.content === "string" ? r.content : "";
    return {
      title: title || url || "Untitled",
      url,
      snippet: content.slice(0, 4000),
    };
  });

  const answer = typeof raw.answer === "string" && raw.answer.trim() ? raw.answer.trim() : undefined;

  return { query: q, ...(answer ? { answer } : {}), results };
}
