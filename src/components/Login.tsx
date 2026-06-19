import React, { useState } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import { auth } from '../firebase';
import { isAuthorizedEmail } from '../constants';
import { Loader2 } from 'lucide-react';

export default function Login({ initialError = '' }: { initialError?: string }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      if (!isAuthorizedEmail(user.email)) {
        await signOut(auth);
        setError('Questo indirizzo email non è autorizzato ad accedere all’app.');
      }
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/unauthorized-domain') {
        setError('Questo dominio non e autorizzato in Firebase. Aggiungilo in Authentication > Settings > Authorized domains.');
      } else if (err.code === 'auth/popup-blocked') {
        setError('Il popup di accesso e stato bloccato dal browser. Abilita i popup e riprova.');
      } else {
        setError('Errore durante l\'accesso con Google. Riprova tra qualche istante.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!isAuthorizedEmail(email)) {
        setError('Questo indirizzo email non è autorizzato ad accedere all’app.');
        return;
      }

      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        await updateProfile(user, { displayName: name });
      }
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/operation-not-allowed') {
        setError('L\'accesso con Email/Password non è abilitato nella console Firebase. Abilitalo o usa Google Login.');
      } else if (err.code === 'auth/network-request-failed') {
        setError('Errore di rete: Controlla la tua connessione o assicurati che i domini dell\'app siano autorizzati nella console Firebase.');
      } else {
        setError(err.message || 'Errore durante l\'autenticazione');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200">
        <div className="bg-[#003781] p-8 text-center">
          <h1 className="text-2xl font-bold text-white uppercase tracking-wider">ManciniGroup</h1>
          <p className="text-blue-100 mt-2">Front Line Reporting</p>
        </div>
        
        <div className="p-8">
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 py-3 rounded-lg font-medium text-slate-700 hover:bg-slate-50 transition-colors mb-6 disabled:opacity-70"
          >
            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
            Accedi con Google
          </button>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-slate-400">oppure con email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#003781] focus:border-transparent outline-none transition-all"
                  placeholder="es. Marina"
                />
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#003781] focus:border-transparent outline-none transition-all"
                placeholder="email@mancinigroup.it"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#003781] focus:border-transparent outline-none transition-all"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="text-red-500 text-sm bg-red-50 p-3 rounded-lg border border-red-100">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#003781] text-white py-3 rounded-lg font-semibold hover:bg-[#002a63] transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : (isLogin ? 'Accedi' : 'Registrati')}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm text-slate-600 hover:text-[#003781] transition-colors"
            >
              {isLogin ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
