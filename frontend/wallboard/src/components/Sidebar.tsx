import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/maps", label: "Maps" },
  { to: "/sites", label: "Sites" },
  { to: "/devices", label: "Devices" },
  { to: "/alerts", label: "Alerts" },
  { to: "/websites", label: "Website checks" },
  { to: "/settings", label: "Settings" }
];

export function Sidebar() {
  const { logout } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebarBrand">
        <img
          src="/digital-penang-logo.png"
          alt="Digital Penang"
          className="sidebarLogoImg"
        />
        <div className="sidebarSub">NOC operations</div>
      </div>
      <nav className="sidebarNav">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => (isActive ? "navItem active" : "navItem")}
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
      <button type="button" className="sidebarLogout" onClick={logout}>
        Log out
      </button>
    </aside>
  );
}
