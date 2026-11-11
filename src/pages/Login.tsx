import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import Logo from '../components/Logo';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (res.error) setMsg(traduz(res.error.message));
    else if (mode === 'signup' && !res.data.session) setMsg('Conta criada! Confirme pelo link enviado ao seu e-mail e depois entre.');
  }

  return (
    <div className="center-screen login-bg">
      <form className="panel narrow login" onSubmit={submit}>
        <div className="login-brand"><Logo size={52} /><h1 className="brand-title">Cosmos Hub</h1></div>
        <p className="muted center">Seu universo de estudo: leitura, flashcards e evolução.</p>
        <label>E-mail<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        <label>Senha<input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {msg && <p className="form-msg">{msg}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
        <button type="button" className="btn link block" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
          {mode === 'login' ? 'Primeiro acesso? Criar conta' : 'Já tenho conta — entrar'}
        </button>
      </form>
    </div>
  );
}

function traduz(m: string): string {
  if (/invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/not confirmed/i.test(m)) return 'Confirme seu e-mail antes de entrar.';
  if (/signups not allowed/i.test(m)) return 'Novos cadastros estão desativados.';
  if (/already registered/i.test(m)) return 'Este e-mail já tem conta.';
  return m;
}
