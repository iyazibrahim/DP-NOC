import fs from "fs";
import path from "path";
import type { DeviceKind } from "./sites";

export type DeviceTypeDef = {
  id: string;
  label: string;
  kind: DeviceKind;
  icon?: string;
};

const SEED_TYPES: DeviceTypeDef[] = [
  { id: "server", label: "Server", kind: "server", icon: "🖥️" },
  { id: "nuc", label: "NUC / Site box", kind: "server", icon: "📦" },
  { id: "pc", label: "PC / Workstation", kind: "server", icon: "💻" },
  { id: "router", label: "Router", kind: "network", icon: "🔀" },
  { id: "switch", label: "Switch", kind: "network", icon: "🔗" },
  { id: "ap", label: "Access Point", kind: "network", icon: "📡" },
  { id: "firewall", label: "Firewall", kind: "network", icon: "🛡️" },
  { id: "nas", label: "NAS / Storage", kind: "server", icon: "💾" },
  { id: "printer", label: "Printer", kind: "network", icon: "🖨️" },
  { id: "camera", label: "IP Camera", kind: "network", icon: "📷" }
];

function runtimePath(): string {
  const candidates = [
    path.join(process.cwd(), "data/runtime/device-types.json"),
    path.join(__dirname, "../../data/runtime/device-types.json"),
    "/app/data/runtime/device-types.json"
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  const preferred = path.join(process.cwd(), "data/runtime/device-types.json");
  const dir = path.dirname(preferred);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return preferred;
}

function loadSeed(): DeviceTypeDef[] {
  const candidates = [
    path.join(__dirname, "../../data/seed-device-types.json"),
    path.join(process.cwd(), "data/seed-device-types.json")
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8")) as DeviceTypeDef[];
    }
  }
  return SEED_TYPES;
}

function ensureFile(): string {
  const file = runtimePath();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(loadSeed(), null, 2) + "\n", "utf8");
  }
  return file;
}

let typesFile = ensureFile();
let deviceTypes: DeviceTypeDef[] = JSON.parse(fs.readFileSync(typesFile, "utf8")) as DeviceTypeDef[];

function persist() {
  typesFile = runtimePath();
  fs.writeFileSync(typesFile, JSON.stringify(deviceTypes, null, 2) + "\n", "utf8");
}

export function slugifyTypeId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function listDeviceTypes(): DeviceTypeDef[] {
  return deviceTypes;
}

export function getDeviceType(id: string): DeviceTypeDef | null {
  return deviceTypes.find((t) => t.id === id) ?? null;
}

export function addDeviceType(input: { id?: string; label: string; kind: DeviceKind }): DeviceTypeDef {
  const label = input.label.trim();
  if (!label) throw new Error("label is required");
  let id = (input.id ?? slugifyTypeId(label)).trim().toLowerCase();
  if (!id) id = slugifyTypeId(label);
  if (deviceTypes.some((t) => t.id === id)) {
    return deviceTypes.find((t) => t.id === id)!;
  }
  const entry: DeviceTypeDef = { id, label, kind: input.kind };
  deviceTypes.push(entry);
  persist();
  return entry;
}

export function inferKindFromType(typeId: string): DeviceKind {
  const found = getDeviceType(typeId);
  if (found) return found.kind;
  return typeId === "server" || typeId === "nuc" || typeId === "pc" || typeId === "nas"
    ? "server"
    : "network";
}
