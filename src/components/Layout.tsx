import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../lib/context';
import Logo from './Logo';

const LINKS = [
  { to: '/', label: 'Início', icon: '◎', end: true },
  { to: '/biblioteca', label: 'Biblioteca', icon: '▤' },
  { to: '/decks', label: 'Flashcards', icon: '❖' },
  { to: '/evolucao', label: 'Evolução', icon: '↗' },
  { to: '/perfil', label: 'Perfil', icon: '☺' },
];

export default function Layout() {
  const { profile } = useApp();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><Logo /><span>Cosmos Hub</span></div>
        <nav>
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <span className="nav-icon" aria-hidden>{l.icon}</span>
              <span className="nav-label">{l.label}</span>
            </NavLink>
          ))}
        </nav>
        {profile?.name && <div className="sidebar-user">{profile.name}</div>}
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
