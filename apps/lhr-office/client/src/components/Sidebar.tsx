import { NavLink } from 'react-router-dom';
import { panels } from '../panels';

export function Sidebar() {
  return (
    <nav className="sidebar" aria-label="Main navigation">
      <div className="sidebar-brand">lhr office</div>
      <ul>
        {panels.map((panel) => (
          <li key={panel.id}>
            <NavLink to={panel.path} end={panel.path === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              {panel.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
