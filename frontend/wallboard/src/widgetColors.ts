export const WIDGET_COLORS = [
  { id: "teal", label: "Teal", hex: "#2dd4bf" },
  { id: "blue", label: "Blue", hex: "#60a5fa" },
  { id: "sky", label: "Sky", hex: "#38bdf8" },
  { id: "violet", label: "Violet", hex: "#a78bfa" },
  { id: "amber", label: "Amber", hex: "#fbbf24" },
  { id: "orange", label: "Orange", hex: "#fb923c" },
  { id: "rose", label: "Rose", hex: "#fb7185" },
  { id: "lime", label: "Lime", hex: "#a3e635" }
] as const;

export type WidgetColorId = (typeof WIDGET_COLORS)[number]["id"];

export function resolveWidgetColor(id?: string): string {
  return WIDGET_COLORS.find((c) => c.id === id)?.hex ?? WIDGET_COLORS[0].hex;
}
