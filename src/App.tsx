import { lazy, Suspense, useEffect, useState } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase, isConfigured } from './lib/supabase';
import { AppProvider } from './lib/context';
import { PomodoroProvider } from './lib/pomodoro';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';

// As outras telas só são baixadas quando você abre cada uma (o leitor de PDF é o maior pedaço).
const Library = lazy(() => import('./pages/Library'));
const Reader = lazy(() => import('./pages/Reader'));
const Decks = lazy(() => import('./pages/Decks'));
const Browse = lazy(() => import('./pages/Browse'));
const Study = lazy(() => import('./pages/Study'));
const AudioStudy = lazy(() => import('./pages/AudioStudy'));
const Progress = lazy(() => import('./pages/Progress'));
const ProfilePage = lazy(() => import('./pages/Profile'));
const HighlightReview = lazy(() => import('./pages/HighlightReview'));
const HighlightExport = lazy(() => import('./pages/HighlightExport'));
const FreeSetup = lazy(() => import('./pages/FreeSetup'));
const PomodoroPage = lazy(() => import('./pages/Pomodoro'));

const Loading = () => <div className="center-pad"><div className="spinner" /></div>;

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!isConfigured) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!isConfigured) return <NotConfigured />;
  if (session === undefined) return <div className="center-screen"><div className="spinner" /></div>;
  if (!session) return <Login />;

  return (
    <AppProvider key={session.user.id}>
      <PomodoroProvider>
      <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/biblioteca" element={<Library />} />
          <Route path="/decks" element={<Decks />} />
          <Route path="/decks/:deckId/cards" element={<Browse />} />
          <Route path="/estudar/:deckId" element={<Study />} />
          <Route path="/audio/:deckId" element={<AudioStudy />} />
          <Route path="/livre/:deckId" element={<FreeSetup />} />
          <Route path="/pomodoro" element={<PomodoroPage />} />
          <Route path="/evolucao" element={<Progress />} />
          <Route path="/perfil" element={<ProfilePage />} />
        </Route>
        <Route path="/ler/:docId" element={<Reader />} />
        <Route path="/grifos/revisar" element={<HighlightReview />} />
        <Route path="/grifos/exportar" element={<HighlightExport />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </PomodoroProvider>
    </AppProvider>
  );
}

function NotConfigured() {
  return (
    <div className="center-screen">
      <div className="panel narrow">
        <h1 className="brand-title">Cosmos Hub</h1>
        <p>O app ainda não está ligado ao Supabase.</p>
        <p className="muted">Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (arquivo <code>.env</code> localmente, ou nas variáveis de ambiente da Vercel) e recarregue. O passo a passo está no README.</p>
      </div>
    </div>
  );
}
