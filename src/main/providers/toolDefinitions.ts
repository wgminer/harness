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
      description: "Update the app theme with custom CSS. Call when theme, colors, or appearance are requested.",
      parameters: {
        type: "object",
        properties: { css_content: { type: "string", description: "Valid CSS to apply as overlay" } },
        required: ["css_content"],
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
          status: {
            type: "string",
            description: "Initial status for the task",
            enum: ["pending", "in_progress", "completed", "cancelled"],
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
        "Update an existing persistent assistant task (for example, mark it completed, change the title, or attach metadata).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID of the task to update (from task_list/task_create results)" },
          title: { type: "string", description: "New title, if you want to rename the task" },
          status: {
            type: "string",
            description: "New status for the task",
            enum: ["pending", "in_progress", "completed", "cancelled"],
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
      description: "Remove all tasks that are already completed or cancelled to keep the task list tidy.",
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
];
