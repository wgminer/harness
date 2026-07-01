import { rigSection } from "../../shared/rigPage";

const toolsSection = rigSection("General");

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "list_directory",
      description: "List contents of a directory (files and subdirectories). Path must be under allowed roots.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute path to the directory" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read plain text content of a file. Size limit 1MB.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute path to the file" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Create or overwrite a file with the given content. Path must be under allowed roots.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_file",
      description: "Delete a file. Path must be under allowed roots.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute path to the file" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_directory",
      description: "Create a directory. Path must be under allowed roots.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute path for the new directory" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_layout",
      description:
        "Change app layout: sidebar position (left/right) and optional grid overlay (off/4/8/16).",
      parameters: {
        type: "object",
        properties: {
          sidebar: { type: "string", enum: ["left", "right"], description: "Sidebar position" },
          gridOverlay: { type: "string", enum: ["off", "4", "8", "16"], description: "Design grid overlay spacing in px" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "task_list",
      description:
        "List all persistent assistant tasks. Use this to understand current open work items before adding or changing tasks.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "task_create",
      description:
        "Create a new persistent assistant task that will be remembered across messages. Use concise, user-facing titles.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short description of the task" },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "cancelled"],
            description:
              "Workflow state for the task. Defaults to pending. Use completed/cancelled for done work; do not encode status in tags.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional filterable labels (e.g. urgent, research). Not used for completion state.",
          },
          metadata: {
            type: "object",
            description: "Optional extra structured information about the task (e.g. source, notes, priority).",
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "task_update",
      description:
        "Update an existing persistent assistant task (rename, change status, edit filterable tags, or attach metadata). Use status for workflow (pending/in_progress/completed/cancelled). Use tags to replace all labels, or add_tags/remove_tags to patch labels without touching status.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID of the task to update (from task_list/task_create results)" },
          title: { type: "string", description: "New title, if you want to rename the task" },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "cancelled"],
            description: "Workflow state (not stored in tags).",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Replace the full filterable tag list (normalized to lowercase labels).",
          },
          add_tags: {
            type: "array",
            items: { type: "string" },
            description: "Add one or more filterable tags without replacing existing tags.",
          },
          remove_tags: {
            type: "array",
            items: { type: "string" },
            description: "Remove filterable tags by name (normalized match).",
          },
          metadata: {
            type: "object",
            description: "Partial metadata to merge into the existing task metadata.",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "task_delete",
      description: "Delete a persistent assistant task by ID when it is no longer relevant.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID of the task to delete (from task_list/task_create results)" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "task_clear_completed",
      description:
        "Remove all tasks whose status is completed or cancelled to keep the task list tidy.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "memory_set_fact",
      description:
        "Store a stable user fact or preference in persistent memory (for example, favorite language, tools, or long-term goals).",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Short key/name for the fact (e.g. 'favorite_language')" },
          value: { type: "string", description: "Text value to remember for this key" },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "memory_list_facts",
      description: "List all stored persistent user facts and preferences.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "memory_search_conversations",
      description:
        "Search across the full chat history (all conversations) for a free-text query and return matching conversations and message snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query text" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_weather",
      description:
        `Get current conditions and a short daily forecast for a US ZIP code. Temperatures in °F, wind in mph, precipitation in inches. If the user does not specify a location, call this with no arguments to use their default ZIP from ${toolsSection}.`,
      parameters: {
        type: "object",
        properties: {
          zip: {
            type: "string",
            description:
              `Optional US ZIP code (5 digits). Omit to use the user's default ZIP from ${toolsSection}.`,
          },
          days: {
            type: "number",
            description: "Number of forecast days to include (1–7). Defaults to 3.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        `Search the web for current information via Tavily and return top results with title, URL, and snippet. Use for fresh facts, news, documentation, or anything outside the user's local data. Requires a Tavily API key in ${toolsSection}.`,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query text.",
          },
          max_results: {
            type: "number",
            description: "Number of results to return (1–10). Defaults to 5.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "note_list",
      description:
        "List all persisted notes with their ids, titles, and timestamps. Use this before selecting a note to read, update, or delete.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "note_create",
      description:
        "Create a new note. Title is optional and content can be provided at creation time.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Optional human-friendly title for the note.",
          },
          content: {
            type: "string",
            description: "Optional initial markdown body for the note.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "note_read",
      description:
        "Read one note by id. Use this before editing a specific note.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "ID of the note to read.",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "note_save",
      description:
        "Replace the full markdown content of a note by id. Use this when rewriting or saving a complete updated draft.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "ID of the note to save.",
          },
          content: {
            type: "string",
            description: "Full markdown content for the note.",
          },
        },
        required: ["id", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "note_delete",
      description:
        "Delete a note by id when it is no longer needed.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "ID of the note to delete.",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_datetime",
      description:
        "Get the current date and time from the app host (accurate clock). Use for scheduling, what day or time it is, or answering questions in a specific IANA timezone (e.g. America/New_York, Europe/London, Asia/Tokyo).",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description:
              "Optional IANA timezone (e.g. America/Los_Angeles). Omit to use the system default timezone.",
          },
        },
      },
    },
  },
];
