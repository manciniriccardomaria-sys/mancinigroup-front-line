import React, { useEffect, useState } from 'react';
import { 
  HashRouter as Router, 
  Routes, 
  Route, 
  Navigate,
  useLocation
} from 'react-router-dom';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile } from './constants';
import Login from './components/Login';
import EmployeeDashboard from './components/EmployeeDashboard';
import AdminDashboard from './components/AdminDashboard';
import ErrorBoundary from './components/ErrorBoundary';
import { AlertTriangle, Loader2, LogOut, RefreshCw } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setProfileError('');

      if (currentUser) {
        try {
          const docRef = doc(db, 'users', currentUser.uid);
          const docSnap = await withTimeout(getDoc(docRef), 12000);

          if (docSnap.exists()) {
            setProfile(docSnap.data() as UserProfile);
          } else {
            const newProfile: UserProfile = {
              uid: currentUser.uid,
              name: currentUser.displayName || currentUser.email?.split('@')[0] || 'Utente',
              email: currentUser.email || '',
              role: 'employee',
            };

            await withTimeout(setDoc(docRef, newProfile), 12000);
            setProfile(newProfile);
          }
        } catch (err) {
          console.error("Error fetching user profile:", err);
          setProfile(null);
          setProfileError(getProfileErrorMessage(err));
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-12 h-12 text-[#003781] animate-spin" />
        <p className="mt-4 text-slate-600 font-medium">Caricamento ManciniGroup...</p>
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-xl border border-red-100 text-center">
          <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="text-red-600" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Database non disponibile</h1>
          <p className="text-slate-600 mb-6">{profileError}</p>
          <div className="space-y-3">
            <button
              onClick={() => window.location.reload()}
              className="flex items-center justify-center gap-2 w-full bg-[#003781] text-white py-3 rounded-xl font-semibold hover:bg-[#002a63] transition-colors"
            >
              <RefreshCw size={20} />
              Riprova
            </button>
            <button
              onClick={() => auth.signOut()}
              className="flex items-center justify-center gap-2 w-full border border-slate-300 text-slate-700 py-3 rounded-xl font-semibold hover:bg-slate-50 transition-colors"
            >
              <LogOut size={20} />
              Esci
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          <Route 
            path="/login" 
            element={user ? <Navigate to="/" replace /> : <Login />} 
          />
          
          <Route 
            path="/" 
            element={
              <ProtectedRoute user={user} profile={profile}>
                {profile?.role === 'admin' ? <AdminDashboard /> : <EmployeeDashboard />}
              </ProtectedRoute>
            } 
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </ErrorBoundary>
  );
}

function ProtectedRoute({ 
  user, 
  profile, 
  children 
}: { 
  user: User | null; 
  profile: UserProfile | null;
  children: React.ReactNode 
}) {
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('firestore-timeout')), timeoutMs);
    }),
  ]);
}

function getProfileErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String(error.code)
    : '';

  if (code.includes('permission-denied')) {
    return 'Firebase ha rifiutato l\'accesso. Pubblica le regole Firestore aggiornate e riprova.';
  }

  if (error instanceof Error && error.message === 'firestore-timeout') {
    return 'La connessione a Firestore sta impiegando troppo tempo. Controlla la configurazione Firebase e la rete.';
  }

  return 'Non e stato possibile caricare il profilo. Controlla Firestore e riprova.';
}
