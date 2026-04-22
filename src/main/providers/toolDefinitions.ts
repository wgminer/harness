import { FONT_IDS_FOR_SCHEMA, FONT_SIZE_OPTIONS } from "../../shared/theme";

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
      name: "update_theme",
      description:
        "Update the app theme (accent, fonts, base size). Omit fields you do not want to change. Call when colors, typography, or appearance are requested.",
      parameters: {
        type: "object",
        properties: {
          accent: { type: "string", description: "Accent color as #RGB or #RRGGBB hex" },
          font: { type: "string", enum: FONT_IDS_FOR_SCHEMA, description: "Global app font id" },
          fontSize: {
            type: "number",
            enum: [...FONT_SIZE_OPTIONS],
            description: "Base UI font size in px",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_layout",
      description: "Change app layout: sidebar position (left/right) and density (compact/comfortable).",
      parameters: {
        type: "object",
        properties: {
          sidebar: { type: "string", enum: ["left", "right"], description: "Sidebar position" },
          density: { type: "string", enum: ["compact", "comfortable"], description: "Layout density" },
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
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "Labels for the task (e.g. pending, in_progress, completed, cancelled, or custom tags like urgent). Defaults to [pending] if omitted.",
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
        "Update an existing persistent assistant task (for example, change tags, rename, or attach metadata). Pass tags to replace the full tag list.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID of the task to update (from task_list/task_create results)" },
          title: { type: "string", description: "New title, if you want to rename the task" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Complete replacement tag list for the task (normalized to lowercase labels).",
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
        "Remove all tasks tagged completed or cancelled to keep the task list tidy.",
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
        "Get current conditions and a short daily forecast for a US ZIP code. Temperatures in °F, wind in mph, precipitation in inches. If the user does not specify a location, call this with no arguments to use their Settings default ZIP.",
      parameters: {
        type: "object",
        properties: {
          zip: {
            type: "string",
            description:
              "Optional US ZIP code (5 digits). Omit to use the user's default ZIP from Settings.",
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
      name: "doc_read",
      description:
        "Read the current writing surface (a single persistent markdown document separate from the chat). Returns { content, updatedAt }. Use this before editing so you append to what is actually there.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "doc_write",
      description:
        "Replace the entire writing surface with the given markdown content. Destructive — prefer doc_append for additions. Use when the user asks to rewrite / restart / clear the doc, or when you have a freshly assembled full draft.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "New full markdown body for the document. Pass an empty string to clear.",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "doc_append",
      description:
        "Append markdown to the end of the writing surface (with a blank line separator if needed). Use this for additive edits like 'add a section', 'write a paragraph about X to the doc', 'jot this down'.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Markdown to append to the end of the document.",
          },
        },
        required: ["content"],
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
