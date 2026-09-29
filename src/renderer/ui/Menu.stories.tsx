import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";
import { FolderOpen, MoreVertical, Printer, Trash2 } from "lucide-react";
import { Menu, MenuCheckItem, MenuHeader, MenuItem, MenuSeparator } from "./Menu";

function MenuDemo() {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState("Narrow");
  const [lineNumbers, setLineNumbers] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div style={{ minHeight: 360, display: "flex", justifyContent: "center", paddingTop: 24 }}>
      <button
        ref={anchorRef}
        type="button"
        className="btn btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Details"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical size={16} aria-hidden />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="bottom-end" label="Details">
        <MenuHeader label="Note info">
          <span style={{ fontSize: "var(--font-size-caption)", color: "var(--fg-muted)" }}>412 words</span>
        </MenuHeader>
        <MenuCheckItem checked={width === "Narrow"} onSelect={() => setWidth("Narrow")}>
          Narrow
        </MenuCheckItem>
        <MenuCheckItem checked={width === "Comfortable"} onSelect={() => setWidth("Comfortable")}>
          Comfortable
        </MenuCheckItem>
        <MenuCheckItem kind="checkbox" checked={lineNumbers} onSelect={() => setLineNumbers((v) => !v)}>
          Line numbers
        </MenuCheckItem>
        <MenuSeparator />
        <MenuItem icon={<Printer size={16} />} trailing="⌘P">
          Print
        </MenuItem>
        <MenuItem icon={<FolderOpen size={16} />}>Show file</MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Trash2 size={16} />} danger>
          Delete note
        </MenuItem>
      </Menu>
    </div>
  );
}

const meta = {
  title: "UI/Menu",
  component: MenuDemo,
} satisfies Meta<typeof MenuDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <MenuDemo />,
};
